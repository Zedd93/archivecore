import test from 'node:test';
import assert from 'node:assert/strict';
import qr from '../../shared/src/utils/qr.ts';

const {
  generateFolderQrData,
  generateLocationQrData,
  generateQrData,
  parseFolderQrData,
  parseLocationQrData,
  parseQrData,
} = qr;

const locationId = 'f411a4d4-904a-4779-b697-5df8ba29a976';

test('location QR round-trips with a stable identifier', () => {
  const code = generateLocationQrData(locationId);
  assert.deepEqual(parseLocationQrData(code), { locationId, isValid: true });
});

test('location QR rejects a changed checksum or malformed UUID', () => {
  const code = generateLocationQrData(locationId);
  const changedChecksum = `${code.slice(0, -1)}${code.endsWith('0') ? '1' : '0'}`;
  assert.equal(parseLocationQrData(changedChecksum)?.isValid, false);
  assert.equal(parseLocationQrData('ACLOC:not-a-uuid:0000')?.isValid, false);
});

test('box and location QR formats cannot be confused', () => {
  const boxCode = generateQrData('DOX', 'K-2026-000001');
  const locationCode = generateLocationQrData(locationId);
  const folderCode = generateFolderQrData(locationId);
  assert.equal(parseQrData(boxCode)?.isValid, true);
  assert.equal(parseLocationQrData(boxCode), null);
  assert.equal(parseQrData(locationCode), null);
  assert.equal(parseFolderQrData(locationCode), null);
  assert.equal(parseLocationQrData(folderCode), null);
  assert.equal(parseQrData(folderCode), null);
});

test('folder QR round-trips and rejects a changed checksum', () => {
  const code = generateFolderQrData(locationId);
  assert.deepEqual(parseFolderQrData(code), { folderId: locationId, isValid: true });
  const changedChecksum = `${code.slice(0, -1)}${code.endsWith('0') ? '1' : '0'}`;
  assert.equal(parseFolderQrData(changedChecksum)?.isValid, false);
  assert.equal(parseFolderQrData('ACF:not-a-uuid:0000')?.isValid, false);
});
