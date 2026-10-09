import { parseFolderQrData, parseQrData } from '@archivecore/shared';

interface LoanWithQr {
  qrCode?: string | null;
}

export type LoanQrMatch<T> =
  | { kind: 'invalid' }
  | { kind: 'missing' }
  | { kind: 'match'; code: string; loans: T[] };

export function matchActiveLoansByQr<T extends LoanWithQr>(loans: T[], rawCode: string): LoanQrMatch<T> {
  const code = rawCode.trim();
  const folderQr = parseFolderQrData(code);
  const boxQr = parseQrData(code);
  if ((!folderQr && !boxQr) || (folderQr && !folderQr.isValid) || (boxQr && !boxQr.isValid)) {
    return { kind: 'invalid' };
  }

  const matches = loans.filter((loan) => loan.qrCode === code);
  return matches.length > 0 ? { kind: 'match', code, loans: matches } : { kind: 'missing' };
}
