import { parseFolderQrData, parseQrData } from '@archivecore/shared';

interface PickableOrderItem {
  id: string;
  itemStatus: string;
  boxId?: string | null;
  folderId?: string | null;
  box?: { qrCode?: string | null } | null;
}

export type PickQrMatch<T> =
  | { kind: 'invalid' }
  | { kind: 'missing' }
  | { kind: 'ambiguous' }
  | { kind: 'match'; item: T };

export function matchOrderItemQr<T extends PickableOrderItem>(items: T[], rawCode: string): PickQrMatch<T> {
  const code = rawCode.trim();
  const folderQr = parseFolderQrData(code);
  const boxQr = parseQrData(code);
  if ((!folderQr && !boxQr) || (folderQr && !folderQr.isValid) || (boxQr && !boxQr.isValid)) {
    return { kind: 'invalid' };
  }

  const matches = items.filter((item) => (
    folderQr ? item.folderId === folderQr.folderId : Boolean(item.boxId && item.box?.qrCode === code)
  ));
  if (matches.length === 0) return { kind: 'missing' };
  if (matches.length > 1) return { kind: 'ambiguous' };
  return { kind: 'match', item: matches[0] };
}
