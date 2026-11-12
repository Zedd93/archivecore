import { BoxStatus, FolderStatus, Prisma } from '@prisma/client';
import { Permissions, RoleCode } from '@archivecore/shared';
import { prisma } from '../../config/database';

type SemanticSource = 'folder' | 'transfer_list';
type Candidate = { type: SemanticSource; id: string };
type SearchContext = {
  tenantId: string;
  department?: string | null;
  permissions: readonly string[];
  roles: readonly string[];
};
type SourceDatabase = Pick<typeof prisma, 'folder' | 'transferList'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Vector candidates are hints, not authorization. Recheck live records before returning IDs to an API caller.
export async function readableSemanticSources(
  candidates: readonly Candidate[],
  context: SearchContext,
  db: SourceDatabase = prisma,
): Promise<Candidate[]> {
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
        select: { id: true },
      })
      : Promise.resolve([]),
    canReadLists && listIds.length
      ? db.transferList.findMany({
        where: { id: { in: listIds }, tenantId: context.tenantId },
        select: { id: true },
      })
      : Promise.resolve([]),
  ]);

  const visibleFolders = new Set(folders.map((folder) => folder.id));
  const visibleLists = new Set(lists.map((list) => list.id));
  const seen = new Set<string>();
  return candidates.flatMap((candidate) => {
    const visible = candidate.type === 'folder'
      ? visibleFolders.has(candidate.id)
      : candidate.type === 'transfer_list' && visibleLists.has(candidate.id);
    const key = `${candidate.type}:${candidate.id}`;
    if (!visible || seen.has(key)) return [];
    seen.add(key);
    return [{ type: candidate.type, id: candidate.id }];
  });
}
