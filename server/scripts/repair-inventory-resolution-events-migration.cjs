const path = require('path');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();
const table = 'inventory_resolution_events';
const uniqueName = 'inventory_resolution_events_sequence_key';
const expectedIndex =
  'CREATE UNIQUE INDEX inventory_resolution_events_sequence_key ON public.inventory_resolution_events USING btree (sequence)';

async function main() {
  if (!process.argv.includes('--apply')) {
    console.error('Dodaj --apply, aby wykonac naprawe po audycie.');
    process.exitCode = 1;
    return;
  }

  const changed = await prisma.$transaction(async (tx) => {
    const [columns, indexes, constraints, functions] = await Promise.all([
      tx.$queryRaw`
        SELECT format_type(a.atttypid, a.atttypmod) AS type,
               a.attnotnull AS required,
               pg_get_expr(d.adbin, d.adrelid) AS "defaultValue"
        FROM pg_attribute a
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = to_regclass('public.inventory_resolution_events')
          AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped
      `,
      tx.$queryRaw`
        SELECT x.indexdef AS definition, i.indisunique AS unique,
               i.indisvalid AS valid, i.indisready AS ready,
               i.indisprimary AS primary, i.indnkeyatts AS "keyCount",
               i.indnatts AS "attributeCount",
               i.indpred IS NULL AS "notPartial", i.indexprs IS NULL AS "notExpression"
        FROM pg_indexes x
        JOIN pg_class c ON c.relname = x.indexname
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = x.schemaname
        JOIN pg_index i ON i.indexrelid = c.oid
        WHERE x.schemaname = 'public' AND x.tablename = ${table}
          AND x.indexname = ${uniqueName}
      `,
      tx.$queryRaw`
        SELECT conname AS name, contype AS type,
               pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = to_regclass('public.inventory_resolution_events')
          AND (conname = ${uniqueName}
            OR conindid = to_regclass('public.inventory_resolution_events_sequence_key'))
      `,
      tx.$queryRaw`
        SELECT EXISTS (
          SELECT 1 FROM pg_proc WHERE proname = 'gen_random_uuid' AND pronargs = 0
        ) AS available
      `,
    ]);

    const id = columns[0];
    if (columns.length !== 1 || id.type !== 'uuid' || id.required !== true
      || (id.defaultValue !== null && id.defaultValue !== 'gen_random_uuid()')
      || functions[0]?.available !== true) {
      throw new Error('Nieoczekiwana definicja id lub brak gen_random_uuid(); przerwano bez zmian.');
    }
    const index = indexes[0];
    if (indexes.length !== 1 || index.definition !== expectedIndex
      || index.unique !== true || index.valid !== true || index.ready !== true
      || index.primary !== false || index.keyCount !== 1
      || index.attributeCount !== 1 || index.notPartial !== true
      || index.notExpression !== true) {
      throw new Error('Indeks numeracji nie nadaje sie do przypiecia jako UNIQUE; przerwano bez zmian.');
    }

    const unique = constraints.find((row) => row.name === uniqueName);
    if (constraints.length > (unique ? 1 : 0)
      || (unique && (unique.type !== 'u' || unique.definition !== 'UNIQUE (sequence)'))) {
      throw new Error('Nieoczekiwane ograniczenie numeracji; przerwano bez zmian.');
    }

    const changes = [];
    if (id.defaultValue === null) {
      await tx.$executeRaw`ALTER TABLE "inventory_resolution_events" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()`;
      changes.push('domyslny UUID');
    }
    if (!unique) {
      await tx.$executeRaw`ALTER TABLE "inventory_resolution_events" ADD CONSTRAINT "inventory_resolution_events_sequence_key" UNIQUE USING INDEX "inventory_resolution_events_sequence_key"`;
      changes.push('ograniczenie UNIQUE z istniejacego indeksu');
    }
    return changes;
  });

  console.log(`Naprawiono: ${changed.length ? changed.join(', ') : 'brak zmian'}.`);
  console.log('Istniejace rekordy nie zostaly zmienione.');
}

main()
  .catch((error) => {
    console.error('Naprawa nie powiodla sie:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
