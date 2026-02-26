/**
 * QR Data Format: AC:{tenantShortCode}:{boxNumber}:{checksum}
 * Example: AC:FIRMAXYZ:K-2024-001532:A7B3
 */

function crc16(str: string): number {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc <<= 1;
      }
      crc &= 0xFFFF;
    }
  }
  return crc;
}

export function generateQrData(tenantShortCode: string, boxNumber: string): string {
  const payload = `${tenantShortCode}:${boxNumber}`;
  const checksum = crc16(payload).toString(16).toUpperCase().padStart(4, '0');
  return `AC:${payload}:${checksum}`;
}

export interface ParsedQrData {
  prefix: string;
  tenantShortCode: string;
  boxNumber: string;
  checksum: string;
  isValid: boolean;
}

export function parseQrData(data: string): ParsedQrData | null {
  const parts = data.split(':');
  if (parts.length < 4 || parts[0] !== 'AC') {
    return null;
  }

  const prefix = parts[0];
  const tenantShortCode = parts[1];
  const boxNumber = parts.slice(2, -1).join(':');
  const checksum = parts[parts.length - 1];

  const payload = `${tenantShortCode}:${boxNumber}`;
  const expectedChecksum = crc16(payload).toString(16).toUpperCase().padStart(4, '0');

  return {
    prefix,
    tenantShortCode,
    boxNumber,
    checksum,
    isValid: checksum === expectedChecksum,
  };
}

export function isArchiveCoreQr(data: string): boolean {
  return data.startsWith('AC:');
}
