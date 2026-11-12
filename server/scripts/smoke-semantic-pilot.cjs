const path = require('node:path');
const { Permissions, RoleCode } = require('@archivecore/shared');
const { validateProductionUrl } = require('./reconcile-semantic-metadata.cjs');
const { runSemanticPilot } = require('../dist/modules/search/semantic-pilot.service');

function parseArgs(argv) {
  const options = { top: 5 };
  const seen = new Set();
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (!['--tenant', '--query', '--top'].includes(flag) || !argv[index + 1] || seen.has(flag)) {
      throw new Error(`Nieznany, niepelny lub powtorzony argument: ${flag}`);
    }
    seen.add(flag);
    options[flag.slice(2)] = argv[++index];
  }
  options.top = Number(options.top);
  if (options.tenant?.toUpperCase() !== 'SMPOLI'
    || typeof options.query !== 'string' || options.query.trim().length < 3 || options.query.length > 300
    || !Number.isSafeInteger(options.top) || options.top < 1 || options.top > 10) {
    throw new Error('Uzycie: --tenant SMPOLI --query "polskie zapytanie" [--top 1..10]');
  }
  return options;
}

async function smokePilot(options, dependencies) {
  const tenant = await dependencies.production.tenant.findFirst({
    where: { shortCode: { equals: options.tenant, mode: 'insensitive' } },
    select: { id: true, shortCode: true },
  });
  if (!tenant) throw new Error('Nie znaleziono tenanta pilota.');
  const results = await dependencies.run({
    tenantId: tenant.id,
    roles: [RoleCode.SUPER_ADMIN],
    permissions: [Permissions.SEARCH_ALL, Permissions.FOLDER_READ, Permissions.TRANSFER_LIST_READ],
  }, options.query, options.top, {
    staging: dependencies.staging,
    production: dependencies.production,
    stagingUrl: dependencies.stagingUrl,
    stagingDataDir: dependencies.stagingDataDir,
  });
  return { tenant: tenant.shortCode, results };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
  validateProductionUrl(process.env.DATABASE_URL);
  const { validateStagingConfig } = require('../dist/modules/search/semantic-pilot.service');
  const stagingUrl = process.env.STAGING_DATABASE_URL;
  const stagingDataDir = 'C:\\Apps\\PostgreSQL-Staging\\data';
  validateStagingConfig(stagingUrl, stagingDataDir);
  const { PrismaClient } = require('@prisma/client');
  const production = new PrismaClient();
  const staging = new PrismaClient({ datasources: { db: { url: stagingUrl } } });
  try {
    const { tenant, results } = await smokePilot(options, {
      production, staging, stagingUrl, stagingDataDir, run: runSemanticPilot,
    });
    console.log(`Odczyt pilota: ${tenant}, ${results.length} aktualnych wynikow (maksymalnie ${options.top}).`);
    console.table(results.map(({ type, id, title }) => ({ typ: type, id, tytul: title })));
    console.log('Tylko odczyt. Pilot HTTP pozostaje wylaczony. Nie oceniaj trafnosci przed zakonczeniem indeksowania.');
  } finally {
    await Promise.all([production.$disconnect(), staging.$disconnect()]);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Test odczytu pilota:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, smokePilot };
