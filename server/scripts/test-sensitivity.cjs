const test = require('node:test');
const assert = require('node:assert/strict');
const { detectSensitiveSignals } = require('../dist/modules/attachments/sensitivity.service');
const { attachmentController } = require('../dist/modules/attachments/attachment.controller');
const { attachmentService } = require('../dist/modules/attachments/attachment.service');
const { prisma } = require('../dist/config/database');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { analyzeSensitivePage } = require('../dist/modules/attachments/sensitivity.service');

const tenantId = '1f11541e-00c7-4bbd-8059-bbb7d189a013';
const attachmentId = 'db7c235e-661f-4bcb-bbf7-6c3d414a5d46';

function request(page = '1') {
  return {
    tenantId,
    params: { id: attachmentId },
    query: { page },
    accessDepartment: 'Księgowość',
    user: { userId: '0ab09ae1-75cb-4e65-9342-8b613196271f', permissions: [] },
    headers: { 'user-agent': 'sensitivity-test' },
    ips: [], ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' },
  };
}

function response() {
  return {
    body: undefined, headers: {}, statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('detects only supported signal types and validates PESEL and IBAN checksums', () => {
  const text = 'PESEL 44051401359; historia choroby; dowód osobisty; PL61 1090 1014 0000 0712 1981 2874';
  assert.deepEqual(detectSensitiveSignals(text), ['pesel', 'health', 'identity', 'bankAccount']);
  assert.deepEqual(detectSensitiveSignals('PESEL 44051401358; PL60 1090 1014 0000 0712 1981 2874'), []);
  assert.deepEqual(detectSensitiveSignals('Historia choroby'), ['health']);
  assert.equal(JSON.stringify(detectSensitiveSignals(text)).includes('44051401359'), false);
});

test('reads one PDF page but returns signal categories without document text', async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const first = pdf.addPage();
  first.drawText('Historia choroby. PESEL 44051401359. Tekst testowy wystarczajaco dlugi do odczytu.', { x: 40, y: 700, font });
  const second = pdf.addPage();
  second.drawText('Strona druga zawiera tylko neutralny opis i nie powinna wplywac na wynik strony pierwszej.', { x: 40, y: 700, font });
  const result = await analyzeSensitivePage(Buffer.from(await pdf.save()), 1);
  assert.deepEqual(result, {
    page: 1, pages: 2, source: 'embedded', reviewFlag: null, signals: ['pesel', 'health'],
  });
  assert.equal(JSON.stringify(result).includes('44051401359'), false);
});

test('sensitivity result is audited before response and contains no OCR text', async () => {
  const oldAnalyze = attachmentService.analyzeSensitivity;
  const oldAudit = prisma.auditLog.create;
  const events = [];
  try {
    attachmentService.analyzeSensitivity = async (id, tenant, page, department, canViewHr) => {
      assert.deepEqual([id, tenant, page, department, canViewHr], [attachmentId, tenantId, 2, 'Księgowość', false]);
      events.push('analyzed');
      return { attachment: { id }, analysis: { page, pages: 3, source: 'ocr', reviewFlag: null, signals: ['pesel'] } };
    };
    prisma.auditLog.create = async ({ data }) => {
      events.push('audited');
      assert.equal(data.action, 'attachment.sensitivity.analyze');
      assert.equal(data.entityId, attachmentId);
      assert.deepEqual(data.newValues, { page: '2', signalCount: '1' });
    };
    const res = response();
    res.json = function (body) { events.push('sent'); this.body = body; return this; };
    let error;
    await attachmentController.analyzeSensitivity(request('2'), res, (err) => { error = err; });
    assert.equal(error, undefined);
    assert.deepEqual(events, ['analyzed', 'audited', 'sent']);
    assert.deepEqual(res.body.data.signals, ['pesel']);
    assert.equal(res.headers['Cache-Control'], 'private, no-store');

    prisma.auditLog.create = async () => { throw new Error('audit unavailable'); };
    const failed = response();
    await attachmentController.analyzeSensitivity(request('2'), failed, (err) => { error = err; });
    assert.match(error.message, /audit unavailable/);
    assert.equal(failed.body, undefined);

    attachmentService.analyzeSensitivity = async () => { throw Object.assign(new Error('not found'), { statusCode: 404 }); };
    const denied = response();
    await attachmentController.analyzeSensitivity(request('2'), denied, (err) => { error = err; });
    assert.equal(error.statusCode, 404);
    assert.equal(denied.body, undefined);
  } finally {
    attachmentService.analyzeSensitivity = oldAnalyze;
    prisma.auditLog.create = oldAudit;
  }
});

test('rejects page numbers outside the scan limit before reading an attachment', async () => {
  const oldAnalyze = attachmentService.analyzeSensitivity;
  try {
    attachmentService.analyzeSensitivity = async () => { throw new Error('unexpected analysis'); };
    for (const page of ['0', '13', '-1', 'abc']) {
      const res = response();
      await attachmentController.analyzeSensitivity(request(page), res, (err) => { throw err; });
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.success, false);
    }
  } finally {
    attachmentService.analyzeSensitivity = oldAnalyze;
  }
});
