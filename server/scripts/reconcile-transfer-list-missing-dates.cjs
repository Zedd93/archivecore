const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function parseArgs(argv) {
  const options = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.apply = true;
    } else if (['--tenant', '--list', '--file', '--expect', '--actor-email'].includes(arg) && argv[i + 1]) {
      options[arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = argv[++i];
    } else {
      throw new Error(`Nieznany lub niekompletny argument: ${arg}`);
    }
  }
  if (!/^[A-Z0-9]{3,20}$/.test(options.tenant ?? '')) throw new Error('Podaj kod tenanta przez --tenant');
  if (!/^[A-Za-z0-9-]{3,50}$/.test(options.list ?? '')) throw new Error('Podaj numer spisu przez --list');
  if (!options.file || !/\.xlsx?$/i.test(options.file)) throw new Error('Podaj plik Excel przez --file');
  const expected = Number(options.expect);
  if (!Number.isSafeInteger(expected) || expected < 1) throw new Error('Podaj oczekiwana liczbe pozycji przez --expect');
  options.expect = expected;
  if (options.apply && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.actorEmail ?? '')) {
    throw new Error('Zapis wymaga adresu Super Admina przez --actor-email');
  }
  return options;
}

function requireMatch(condition, message) {
  if (!condition) throw new Error(message);
}

async function reconcileMissingDates(db, { tenant, list, parsed, sourceHash, expect, apply = false, actorEmail }) {
  requireMatch(parsed.errors.length === 0, 'Plik ma bledy parsowania');
  const sourcePositions = parsed.items.flatMap((item, index) => item.dateRangeUnknown ? [index + 1] : []);
  requireMatch(sourcePositions.length === expect, `Plik zawiera ${sourcePositions.length} oznaczen "brak dat", oczekiwano ${expect}`);

  const lists = await db.transferList.findMany({
    where: { listNumber: list, tenant: { is: { shortCode: tenant } } },
    select: { id: true, tenantId: true, status: true, legalHold: true },
    take: 2,
  });
  requireMatch(lists.length === 1, 'Nie znaleziono jednoznacznie wskazanego spisu');
  const target = lists[0];
  requireMatch(target?.status === 'draft', 'Spis nie istnieje albo nie ma statusu roboczego');
  requireMatch(!target.legalHold, 'Spis jest objety blokada prawna');

  const records = await db.transferListItem.findMany({
    where: { transferListId: target.id },
    orderBy: { ordinalNumber: 'asc' },
    select: {
      id: true, ordinalNumber: true, folderSignature: true, folderTitle: true, categoryCode: true,
      dateFrom: true, dateTo: true, dateRangeUnknown: true,
      folder: { select: { id: true, tenantId: true, folderNumber: true, title: true, dateFrom: true, dateTo: true, legalHold: true } },
    },
  });
  requireMatch(records.length === parsed.items.length, `Liczba pozycji spisu (${records.length}) rozni sie od pliku (${parsed.items.length})`);

  const pending = [];
  let alreadyMarked = 0;
  for (let index = 0; index < parsed.items.length; index++) {
    const source = parsed.items[index];
    const record = records[index];
    const position = index + 1;
    const signature = source.folderSignature.trim().substring(0, 100);
    const title = source.folderTitle.trim().substring(0, 1000);
    const category = source.categoryCode.trim().substring(0, 20);
    requireMatch(record.ordinalNumber === position
      && record.folderSignature === signature
      && record.folderTitle === title
      && record.categoryCode === category,
    `Pozycja ${position} nie odpowiada plikowi zrodlowemu`);
    requireMatch(record.folder?.tenantId === target.tenantId
      && record.folder.folderNumber === signature
      && record.folder.title === title,
    `Teczka pozycji ${position} nie odpowiada spisowi`);

    if (!source.dateRangeUnknown) continue;
    requireMatch(!source.dateFrom && !source.dateTo
      && !record.dateFrom && !record.dateTo
      && !record.folder.dateFrom && !record.folder.dateTo,
    `Pozycja ${position} ma juz date; oznaczenie wymaga recznej weryfikacji`);
    requireMatch(!record.folder.legalHold, `Teczka pozycji ${position} jest objeta blokada prawna`);
    if (record.dateRangeUnknown) alreadyMarked++;
    else pending.push({ id: record.id, folderId: record.folder.id, position, sourceRow: parsed.rowNumbers[index] });
  }

  let actor;
  if (apply && pending.length) {
    actor = await db.user.findFirst({
      where: { email: { equals: actorEmail, mode: 'insensitive' }, isActive: true },
      select: { id: true, userRoles: { select: { role: { select: { code: true } } } } },
    });
    requireMatch(actor?.userRoles.some(({ role }) => role.code === 'SA'), 'Konto wykonujace zapis musi byc aktywnym Super Adminem');
    for (const item of pending) {
      const result = await db.transferListItem.updateMany({
        where: {
          id: item.id, transferListId: target.id, dateRangeUnknown: false, dateFrom: null, dateTo: null,
          transferList: { is: { tenantId: target.tenantId, status: 'draft', legalHold: false } },
          folder: { is: { id: item.folderId, tenantId: target.tenantId, dateFrom: null, dateTo: null, legalHold: false } },
        },
        data: { dateRangeUnknown: true },
      });
      requireMatch(result.count === 1, `Pozycja ${item.position} zmienila sie w trakcie zapisu`);
      await db.auditLog.create({ data: {
        tenantId: target.tenantId, userId: actor.id,
        action: 'transfer_list.date_range_reconciled', entityType: 'transfer_list_item', entityId: item.id,
        oldValues: { dateRangeUnknown: false },
        newValues: { dateRangeUnknown: true, sourceSha256: sourceHash, sourceRow: item.sourceRow, listNumber: list },
      } });
    }
  }
  return { list, checked: records.length, sourceMissing: sourcePositions.length, alreadyMarked, pending: pending.length, applied: apply ? pending.length : 0, positions: sourcePositions };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const buffer = fs.readFileSync(path.resolve(options.file));
  const sourceHash = createHash('sha256').update(buffer).digest('hex');
  const { parseTransferListImport } = require('../dist/modules/transfer-lists/transfer-list-import.parser');
  const parsed = parseTransferListImport(buffer);
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
  const { PrismaClient, Prisma } = require('@prisma/client');
  const db = new PrismaClient();
  try {
    const input = { tenant: options.tenant, list: options.list, parsed, sourceHash, expect: options.expect, apply: options.apply, actorEmail: options.actorEmail };
    const report = options.apply
      ? await db.$transaction((tx) => reconcileMissingDates(tx, input), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 })
      : await reconcileMissingDates(db, input);
    console.log(`${report.list}: sprawdzono ${report.checked} pozycji, w zrodle "brak dat": ${report.sourceMissing}, juz oznaczono: ${report.alreadyMarked}, do oznaczenia: ${report.pending}`);
    console.log(`Pozycje: ${report.positions.join(', ')}`);
    console.log(`SHA-256 pliku: ${sourceHash}`);
    console.log(options.apply ? `Oznaczono ${report.applied} pozycji. Daty teczek nie zostaly zmienione.` : 'Podglad: dane nie zostaly zmienione.');
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Uzgodnienie przerwane bez czesciowego zapisu: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, reconcileMissingDates };
