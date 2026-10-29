import { containsPesel, recognizeScan } from '../import-export/scan-ocr.service';

export type SensitiveSignal = 'pesel' | 'health' | 'identity' | 'bankAccount';

const HEALTH_CUES = [
  /(?:^|[^\p{L}])historia\s+choroby(?:$|[^\p{L}])/iu,
  /(?:^|[^\p{L}])zaświadczenie\s+lekarskie(?:$|[^\p{L}])/iu,
  /(?:^|[^\p{L}])orzeczenie\s+o\s+niepełnosprawności(?:$|[^\p{L}])/iu,
  /(?:^|[^\p{L}])karta\s+informacyjna\s+leczenia(?:$|[^\p{L}])/iu,
  /(?:^|[^\p{L}])wynik(?:i)?\s+bada(?:nia|ń)\s+(?:lekarskich|medycznych|laboratoryjnych)(?:$|[^\p{L}])/iu,
];

const IDENTITY_CUE = /(?:^|[^\p{L}])(?:dowód\s+osobisty|numer\s+dokumentu\s+tożsamości|nr\s+paszportu)(?:$|[^\p{L}])/iu;

function hasPolishBankAccount(text: string): boolean {
  const candidates = text.matchAll(/(?:^|[^\p{L}\d])(?:PL[\s-]*)?\d{2}(?:[\s-]*\d{4}){6}(?!\d)/giu);
  for (const match of candidates) {
    const digits = match[0].replace(/\D/g, '');
    if (digits.length !== 26) continue;
    let remainder = 0;
    for (const digit of `${digits.slice(2)}2521${digits.slice(0, 2)}`) remainder = (remainder * 10 + Number(digit)) % 97;
    if (remainder === 1) return true;
  }
  return false;
}

export function detectSensitiveSignals(text: string): SensitiveSignal[] {
  const signals: SensitiveSignal[] = [];
  if (containsPesel(text)) signals.push('pesel');
  if (HEALTH_CUES.some((cue) => cue.test(text))) signals.push('health');
  if (IDENTITY_CUE.test(text)) signals.push('identity');
  if (hasPolishBankAccount(text)) signals.push('bankAccount');
  return signals;
}

export async function analyzeSensitivePage(buffer: Buffer, page: number) {
  const scan = await recognizeScan(buffer, page);
  const diagnostic = scan.pageDiagnostics[0];
  return {
    page,
    pages: scan.pages,
    source: diagnostic.source,
    reviewFlag: diagnostic.reviewFlag,
    signals: detectSensitiveSignals(scan.text),
  };
}
