const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { Prisma } = require('@prisma/client');
const { buildBillingWorkbook } = require('../dist/modules/pricing/billing-export.service');

const tenant = {
  name: 'Spółdzielnia Mieszkaniowa',
  shortCode: 'SM',
  nip: '1234567890',
  address: 'Gliwice, ul. Nowy Świat 1',
};

function event(id, serviceCode, serviceName, net, vatRate, quantity = 1) {
  return {
    id,
    serviceCode,
    serviceName,
    unit: 'box',
    quantity: new Prisma.Decimal(quantity),
    unitPrice: new Prisma.Decimal(net).div(quantity),
    netAmount: new Prisma.Decimal(net),
    vatRate: new Prisma.Decimal(vatRate),
    currency: 'PLN',
    description: `Karton ${id}`,
    occurredAt: new Date('2026-09-15T12:00:00.000Z'),
    order: { orderNumber: `Z-${id}` },
  };
}

function readSheets(events, invoiceNumber = null) {
  const buffer = buildBillingWorkbook(tenant, '2026-09', new Date('2026-10-01T00:00:00Z'), events, invoiceNumber);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  return {
    names: workbook.SheetNames,
    summary: XLSX.utils.sheet_to_json(workbook.Sheets.Podsumowanie, { header: 1 }),
    details: XLSX.utils.sheet_to_json(workbook.Sheets.Pozycje, { header: 1 }),
  };
}

test('groups services and reconciles net, VAT and gross with detail rows', () => {
  const sheets = readSheets([
    event('1', 'storage_box_month', 'Przechowywanie', '10.00', '23'),
    event('2', 'storage_box_month', 'Przechowywanie', '10.00', '23'),
    event('3', 'retrieval_box', 'Pobranie', '12.50', '8'),
  ]);

  assert.deepEqual(sheets.names, ['Podsumowanie', 'Pozycje']);
  assert.equal(sheets.summary[1][1], tenant.name);
  assert.equal(sheets.summary[4][1], tenant.address);
  assert.equal(sheets.summary[7][1], 3);
  const storage = sheets.summary.find((row) => row[0] === 'storage_box_month');
  assert.deepEqual(storage.slice(4, 9), [2, 23, 20, 4.6, 24.6]);
  const total = sheets.summary.find((row) => row[0] === 'RAZEM');
  assert.deepEqual(total.slice(6, 9), [32.5, 5.6, 38.1]);
  assert.equal(sheets.details.length, 4);
  assert.equal(sheets.details[3][11], 1);
});

test('rounds VAT for each event before aggregation', () => {
  const sheets = readSheets([
    event('1', 'storage_box_month', 'Przechowywanie', '0.03', '23'),
    event('2', 'storage_box_month', 'Przechowywanie', '0.03', '23'),
  ]);
  const total = sheets.summary.find((row) => row[0] === 'RAZEM');
  assert.equal(total[7], 0.02);
  assert.equal(total[8], 0.08);
});

test('exports an empty closed period with zero totals', () => {
  const sheets = readSheets([]);
  assert.deepEqual(sheets.summary.find((row) => row[0] === 'RAZEM').slice(6, 9), [0, 0, 0]);
  assert.equal(sheets.details.length, 1);
});

test('rejects a billing event without a price', () => {
  const missingPrice = event('1', 'storage_box_month', 'Przechowywanie', '10.00', '23');
  missingPrice.unitPrice = null;
  assert.throws(() => readSheets([missingPrice]), /nie ma ceny/);
});

test('shows an external invoice reference without changing settlement totals', () => {
  const sheets = readSheets([event('1', 'storage_box_month', 'Przechowywanie', '10.00', '23')], 'FV/10/2026');
  assert.deepEqual(sheets.summary.find((row) => row[0] === 'Numer faktury'), ['Numer faktury', 'FV/10/2026']);
  assert.deepEqual(sheets.summary.find((row) => row[0] === 'RAZEM').slice(6, 9), [10, 2.3, 12.3]);
});
