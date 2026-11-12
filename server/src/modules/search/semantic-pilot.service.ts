import { PrismaClient } from '@prisma/client';
import { Permissions, RoleCode } from '@archivecore/shared';
import { config } from '../../config/env';
import { prisma } from '../../config/database';
import { readableSemanticSources } from './semantic-access.service';
import { semanticDepartmentKey } from './semantic-checksum';

const MODEL = 'bge-m3:latest';
const OLLAMA = 'http://127.0.0.1:11434';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Candidate = { type: 'folder' | 'transfer_list'; id: string; checksum: string };
type PilotContext = {
  tenantId: string;
  department?: string | null;
  roles: readonly string[];
  permissions: readonly string[];
};
type PilotDependencies = {
  staging: Pick<PrismaClient, '$queryRawUnsafe'>;
  production: typeof prisma;
  stagingUrl: string;
  stagingDataDir: string;
  fetcher?: typeof fetch;
};

function normalizeDataDir(directory: string): string {
  return directory.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function validateStagingConfig(urlText: string, expectedDataDir: string): void {
  if (!urlText || !expectedDataDir) throw new Error('Pilot semantyczny nie jest skonfigurowany.');
  let url: URL;
  try { url = new URL(urlText); } catch { throw new Error('Niepoprawna konfiguracja bazy pilota.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || url.hostname !== '127.0.0.1' || url.port !== '55433'
    || decodeURIComponent(url.pathname.slice(1)) !== 'archivecore_staging'
    || normalizeDataDir(expectedDataDir) !== 'c:/apps/postgresql-staging/data') {
    throw new Error('Pilot moze korzystac tylko z izolowanego klastra staging.');
  }
}

async function assertStagingCluster(staging: PilotDependencies['staging'], expectedDataDir: string): Promise<void> {
  const [row] = await staging.$queryRawUnsafe<Array<{
    database: string; dataDirectory: string; vectorEnabled: boolean;
  }>>(`SELECT current_database() AS "database",
    current_setting('data_directory') AS "dataDirectory",
    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS "vectorEnabled"`);
  if (!row || row.database !== 'archivecore_staging'
    || normalizeDataDir(row.dataDirectory) !== normalizeDataDir(expectedDataDir)
    || !row.vectorEnabled) {
    throw new Error('Nie polaczono z oczekiwanym klastrem pgvector staging.');
  }
}

async function modelVersion(fetcher: typeof fetch): Promise<string> {
  const response = await fetcher(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Lokalny model semantyczny jest niedostepny.');
  const tags = await response.json() as { models?: Array<{ name: string; digest: string }> };
  const digest = tags.models?.find((model) => model.name === MODEL)?.digest;
  if (!digest || !/^[a-f0-9]{64}$/i.test(digest)) throw new Error('Nie znaleziono wersji lokalnego modelu.');
  return `bge-m3@${digest.toLowerCase()}`;
}

async function queryVector(fetcher: typeof fetch, query: string): Promise<string> {
  const response = await fetcher(`${OLLAMA}/api/embed`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: [query] }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error('Lokalny model nie przeliczyl zapytania.');
  const data = await response.json() as { embeddings?: number[][] };
  const vector = data.embeddings?.[0];
  if (!vector || vector.length !== 1024 || vector.some((value) => !Number.isFinite(value))
    || !vector.some((value) => value !== 0)) {
    throw new Error('Lokalny model zwrocil niepoprawny wektor.');
  }
  return JSON.stringify(vector);
}

export async function runSemanticPilot(
  context: PilotContext,
  query: string,
  limit: number,
  dependencies: PilotDependencies,
): Promise<Array<{ type: Candidate['type']; id: string; title: string; href: string }>> {
  if (!UUID.test(context.tenantId) || !context.roles.includes(RoleCode.SUPER_ADMIN)
    || !context.permissions.includes(Permissions.SEARCH_ALL)) throw new Error('Brak dostepu do pilota.');
  if (typeof query !== 'string' || query.trim().length < 3 || query.length > 300
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 10) throw new Error('Niepoprawne zapytanie pilota.');
  validateStagingConfig(dependencies.stagingUrl, dependencies.stagingDataDir);
  await assertStagingCluster(dependencies.staging, dependencies.stagingDataDir);

  const fetcher = dependencies.fetcher || fetch;
  const version = await modelVersion(fetcher);
  const vector = await queryVector(fetcher, query.trim());
  const department = semanticDepartmentKey(context.department);
  const candidateLimit = Math.min(100, limit * 5);
  const sql = `SELECT source_type AS "type", source_id AS "id", source_checksum AS "checksum"
    FROM semantic_metadata_index WHERE tenant_id = $1::uuid AND model_version = $2
    ${department ? 'AND department_key = $3' : ''}
    ORDER BY embedding <=> ${department ? '$4' : '$3'}::vector
    LIMIT ${department ? '$5' : '$4'}`;
  const candidates = department
    ? await dependencies.staging.$queryRawUnsafe<Candidate[]>(sql, context.tenantId, version, department, vector, candidateLimit)
    : await dependencies.staging.$queryRawUnsafe<Candidate[]>(sql, context.tenantId, version, vector, candidateLimit);
  const readable = await readableSemanticSources(candidates, context, dependencies.production);
  return readable.slice(0, limit).map((source) => ({
    ...source,
    href: source.type === 'folder' ? `/folders/${source.id}` : `/transfer-lists/${source.id}`,
  }));
}

let stagingClient: PrismaClient | undefined;

export const semanticPilotService = {
  async search(context: PilotContext, query: string, limit: number) {
    validateStagingConfig(config.semanticPilot.stagingUrl, config.semanticPilot.stagingDataDir);
    stagingClient ||= new PrismaClient({ datasources: { db: { url: config.semanticPilot.stagingUrl } } });
    return runSemanticPilot(context, query, limit, {
      staging: stagingClient, production: prisma,
      stagingUrl: config.semanticPilot.stagingUrl,
      stagingDataDir: config.semanticPilot.stagingDataDir,
    });
  },
  async disconnect() {
    await stagingClient?.$disconnect();
    stagingClient = undefined;
  },
};
