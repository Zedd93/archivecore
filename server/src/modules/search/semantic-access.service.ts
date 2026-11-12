import { BoxStatus, FolderStatus, Prisma } from '@prisma/client';
import { Permissions, RoleCode } from '@archivecore/shared';
import { prisma } from '../../config/database';
import { semanticMetadataChecksum, semanticMetadataText } from './semantic-checksum';

type SemanticSource = 'folder' | 'transfer_list';
type Candidate = { type: SemanticSource; id: string; checksum: string };
type ReadableSource = { type: SemanticSource; id: string; title: string };
type SearchContext = {
  tenantId: string;
  department?: string | null;
  permissions: readonly string[];
  roles: readonly string[];
};
type SourceDatabase = Pick<typeof prisma, 'folder' | 'transferList'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Vector candidates are hints, not authorization. Recheck live records and content freshness before returning a title.
export async function readableSemanticSources(
  candidates: readonly Candidate[],
  context: SearchContext,
  db: SourceDatabase = prisma,
): Promise<ReadableSource[]> {
  if (!UUID.test(context.tenantId)) throw new Error('Brak poprawnego kontekstu tenanta.');
  if (candidates.length > 100) throw new Error('Za duzo kandydatow wyszukiwania semantycznego.');
  if (!context.permissions.includes(Permissions.SEARCH_ALL)
    && !context.permissions.includes(Permissions.SEARCH_OWN)) return [];

  const department = context.department?.trim();
  if ((context.department != null || context.roles.includes(RoleCode.TENANT_EMPLOYEE)) && !department) return [];

  const folderIds = [...new Set(candidates
    .filter((candidate) => candidate.type === 'folder' && UUID.test(candidate.id))
    .map((candidate) => candidate.id))];
  const listIds = department ? [] : [...new Set(candidates
    .filter((candidate) => candidate.type === 'transfer_list' && UUID.test(candidate.id))
    .map((candidate) => candidate.id))];

  const canReadFolders = context.permissions.includes(Permissions.FOLDER_READ);
  const canReadLists = context.permissions.includes(Permissions.TRANSFER_LIST_READ);
  const liveBox: Prisma.BoxWhereInput = {
    tenantId: context.tenantId,
    deletedAt: null,
    status: { notIn: [BoxStatus.disposed, BoxStatus.lost] },
    ...(department ? { department: { equals: department, mode: 'insensitive' } } : {}),
  };

  const [folders, lists] = await Promise.all([
    canReadFolders && folderIds.length
      ? db.folder.findMany({
        where: {
          id: { in: folderIds }, tenantId: context.tenantId,
          status: { not: FolderStatus.disposed },
          ...(department
            ? { box: { is: liveBox } }
            : { OR: [{ boxId: null }, { box: { is: liveBox } }] }),
        },
        select: {
          id: true, title: true, description: true, docType: true,
          box: { select: { department: true } },
        },
      })
      : Promise.resolve([]),
    canReadLists && listIds.length
      ? db.transferList.findMany({
        where: { id: { in: listIds }, tenantId: context.tenantId },
        select: { id: true, title: true, notes: true },
      })
      : Promise.resolve([]),
  ]);

  const visibleFolders = new Map(folders.map((folder) => [folder.id, folder]));
  const visibleLists = new Map(lists.map((list) => [list.id, list]));
  const seen = new Set<string>();
  return candidates.flatMap((candidate) => {
    const key = `${candidate.type}:${candidate.id}`;
    if (seen.has(key)) return [];
    let title: string | undefined;
    let checksum: string | undefined;
    if (candidate.type === 'folder') {
      const folder = visibleFolders.get(candidate.id);
      if (folder) {
        title = folder.title;
        checksum = semanticMetadataChecksum({
          sourceType: 'folder',
          text: semanticMetadataText(folder.title, folder.description, folder.docType),
          department: folder.box?.department,
        });
      }
    } else if (candidate.type === 'transfer_list') {
      const list = visibleLists.get(candidate.id);
      if (list) {
        title = list.title;
        checksum = semanticMetadataChecksum({
          sourceType: 'transfer_list',
          text: semanticMetadataText(list.title, list.notes),
        });
      }
    }
    if (!title || checksum !== candidate.checksum) return [];
    seen.add(key);
    return [{ type: candidate.type, id: candidate.id, title }];
  });
}
