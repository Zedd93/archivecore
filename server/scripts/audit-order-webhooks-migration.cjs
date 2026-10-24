const path = require('path');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();
const migrationName = '20261012150000_add_order_webhooks';
const expected = {
  webhook_endpoints: {
    columns: {
      id: ['uuid', true, null],
      tenantId: ['uuid', true, null],
      createdById: ['uuid', true, null],
      name: ['character varying(100)', true, null],
      url: ['text', true, null],
      secretEncrypted: ['text', true, null],
      isActive: ['boolean', true, 'true'],
      createdAt: ['timestamp(3) without time zone', true, 'CURRENT_TIMESTAMP'],
      updatedAt: ['timestamp(3) without time zone', true, null],
    },
    indexes: [
      ['webhook_endpoints_pkey', ['id'], true, true],
      ['webhook_endpoints_tenantId_isActive_idx', ['tenantId', 'isActive'], false, false],
    ],
    foreignKeys: [
      ['webhook_endpoints_tenantId_fkey', 'tenantId', 'tenants'],
      ['webhook_endpoints_createdById_fkey', 'createdById', 'users'],
    ],
  },
  webhook_deliveries: {
    columns: {
      id: ['uuid', true, null],
      endpointId: ['uuid', true, null],
      eventId: ['uuid', true, null],
      payloadText: ['text', true, null],
      status: ['character varying(20)', true, "'pending'::character varying"],
      attempts: ['integer', true, '0'],
      nextAttemptAt: ['timestamp(3) without time zone', true, 'CURRENT_TIMESTAMP'],
      leaseUntil: ['timestamp(3) without time zone', false, null],
      lastError: ['character varying(255)', false, null],
      createdAt: ['timestamp(3) without time zone', true, 'CURRENT_TIMESTAMP'],
      deliveredAt: ['timestamp(3) without time zone', false, null],
    },
    indexes: [
      ['webhook_deliveries_pkey', ['id'], true, true],
      ['webhook_deliveries_endpointId_eventId_key', ['endpointId', 'eventId'], false, true],
      ['webhook_deliveries_status_nextAttemptAt_idx', ['status', 'nextAttemptAt'], false, false],
    ],
    foreignKeys: [
      ['webhook_deliveries_endpointId_fkey', 'endpointId', 'webhook_endpoints'],
    ],
  },
};

async function inspectTable(name) {
  const [table, columns, indexes, constraints] = await Promise.all([
    prisma.$queryRaw`SELECT to_regclass(${`public.${name}`})::text AS name`,
    prisma.$queryRaw`
      SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
        a.attnotnull AS required, pg_get_expr(d.adbin, d.adrelid) AS "defaultValue"
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = to_regclass(${`public.${name}`})
        AND a.attnum > 0 AND NOT a.attisdropped
    `,
    prisma.$queryRaw`
      SELECT ic.relname AS name, i.indisunique AS "isUnique", i.indisprimary AS "isPrimary",
        ARRAY(
          SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, position)
          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
          ORDER BY k.position
        ) AS columns
      FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
      WHERE i.indrelid = to_regclass(${`public.${name}`})
    `,
    prisma.$queryRaw`
      SELECT conname AS name, contype AS type, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conrelid = to_regclass(${`public.${name}`})
    `,
  ]);
  return { table: table[0]?.name, columns, indexes, constraints };
}

async function main() {
  const history = await prisma.$queryRaw`
    SELECT finished_at, rolled_back_at FROM "_prisma_migrations"
    WHERE migration_name = ${migrationName} ORDER BY started_at DESC LIMIT 1
  `;
  let differences = 0;
  function check(label, matches) {
    console.log(`${matches ? '[OK]' : '[BRAK]'} ${label}`);
    if (!matches) differences += 1;
  }

  console.log(`Audyt migracji ${migrationName} (tylko odczyt):`);
  for (const [tableName, specification] of Object.entries(expected)) {
    const actual = await inspectTable(tableName);
    check(`Tabela ${tableName}`, Boolean(actual.table));
    const columns = new Map(actual.columns.map((column) => [column.name, column]));
    for (const [name, [type, required, defaultValue]] of Object.entries(specification.columns)) {
      const column = columns.get(name);
      check(`${tableName}.${name}`, column?.type === type && column.required === required
        && column.defaultValue === defaultValue);
    }
    for (const [name, keys, primary, unique] of specification.indexes) {
      const index = actual.indexes.find((item) => item.name === name);
      check(`Indeks ${name}`, index?.isPrimary === primary && index.isUnique === unique
        && JSON.stringify(index.columns) === JSON.stringify(keys));
    }
    for (const [name, column, target] of specification.foreignKeys) {
      const constraint = actual.constraints.find((item) => item.name === name);
      check(`Klucz obcy ${name}`, constraint?.type === 'f'
        && constraint.definition.includes(`FOREIGN KEY ("${column}") REFERENCES ${target}(id)`)
        && constraint.definition.includes('ON DELETE RESTRICT')
        && constraint.definition.includes('ON UPDATE CASCADE'));
    }
  }

  const latest = history[0];
  const status = !latest ? 'brak wpisu' : latest.finished_at ? 'zastosowana'
    : latest.rolled_back_at ? 'wycofana' : 'nieudana / w toku';
  console.log(`Historia Prisma: ${status}`);
  console.log(`Rozbieznosci: ${differences}`);
  console.log('Dane nie zostaly zmienione.');
  if (differences > 0 || status === 'nieudana / w toku') process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error('Audyt migracji nie powiodl sie:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
