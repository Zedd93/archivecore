const path = require('node:path');

async function auditSemanticReadiness(db) {
  const [extension] = await db.$queryRaw`
    SELECT current_setting('server_version') AS "postgresVersion",
      EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') AS "vectorAvailable",
      EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS "vectorEnabled"
  `;
  const [content] = await db.$queryRaw`
    SELECT COUNT(*)::int AS "attachments",
      COUNT(*) FILTER (WHERE a."ocrText" IS NOT NULL AND btrim(a."ocrText") <> '')::int AS "withOcrText",
      COUNT(*) FILTER (WHERE a."ocrStatus" = 'completed')::int AS "ocrCompleted"
    FROM attachments a
    WHERE NOT EXISTS (SELECT 1 FROM hr_documents h WHERE h."attachmentId" = a.id)
      AND (
        EXISTS (SELECT 1 FROM documents d WHERE d.id = a."documentId" AND d."tenantId" = a."tenantId")
        OR EXISTS (SELECT 1 FROM folders f WHERE f.id = a."folderId" AND f."tenantId" = a."tenantId")
        OR EXISTS (SELECT 1 FROM boxes b WHERE b.id = a."boxId" AND b."tenantId" = a."tenantId" AND b."deletedAt" IS NULL)
      )
  `;
  return { ...extension, ...content };
}

function printReport(report) {
  console.log('Gotowosc wyszukiwania semantycznego (tylko odczyt):');
  console.log(`PostgreSQL: ${report.postgresVersion}`);
  console.log(`pgvector dostepny na serwerze bazy: ${report.vectorAvailable ? 'tak' : 'nie'}`);
  console.log(`pgvector wlaczony w tej bazie: ${report.vectorEnabled ? 'tak' : 'nie'}`);
  console.log(`Dostepne zalaczniki poza aktami osobowymi: ${report.attachments}`);
  console.log(`Z tekstem OCR: ${report.withOcrText}`);
  console.log(`Ze statusem OCR completed: ${report.ocrCompleted}`);
  console.log('Nie odczytano tresci dokumentow ani nie zmieniono danych.');
}

async function main() {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  try {
    printReport(await auditSemanticReadiness(db));
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Audyt gotowosci wyszukiwania semantycznego nie powiodl sie:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { auditSemanticReadiness, printReport };
