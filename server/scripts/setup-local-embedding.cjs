const { createHash } = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');

const VERSION = 'v0.40.13';
const ASSET = 'ollama-windows-amd64.zip';
const ROOT = path.join(process.env.SystemDrive || 'C:', 'Apps', 'archivecore-ollama-pilot');
const BIN = path.join(ROOT, VERSION, 'ollama.exe');
const MODEL = 'bge-m3:latest';
const HOST = '127.0.0.1:11434';

function modelEnv() {
  return {
    ...process.env,
    OLLAMA_HOST: HOST,
    OLLAMA_MODELS: path.join(ROOT, 'models'),
    OLLAMA_NO_CLOUD: '1',
    OLLAMA_NUM_PARALLEL: '1',
    OLLAMA_MAX_LOADED_MODELS: '1',
  };
}

async function install() {
  if (fs.existsSync(BIN)) {
    console.log(`Pakiet juz istnieje: ${BIN}`);
    return;
  }
  const metadataResponse = await fetch(`https://api.github.com/repos/ollama/ollama/releases/tags/${VERSION}`, {
    headers: { 'User-Agent': 'ArchiveCore-local-pilot', Accept: 'application/vnd.github+json' },
  });
  if (!metadataResponse.ok) throw new Error(`GitHub release: HTTP ${metadataResponse.status}`);
  const release = await metadataResponse.json();
  const asset = release.assets?.find((entry) => entry.name === ASSET);
  if (!asset || !/^sha256:[0-9a-f]{64}$/i.test(asset.digest || '') || asset.size > 3 * 1024 ** 3) {
    throw new Error('Brak pakietu, sumy SHA-256 lub pakiet jest zbyt duzy. Nie instaluje.');
  }
  await fsp.mkdir(ROOT, { recursive: true });
  const zip = path.join(ROOT, `${VERSION}.zip`);
  const response = await fetch(asset.browser_download_url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Pobieranie pakietu: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(zip));
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(zip)) hash.update(chunk);
  if (`sha256:${hash.digest('hex')}` !== asset.digest.toLowerCase()) {
    throw new Error('Suma SHA-256 pakietu nie zgadza sie z oficjalna suma. Nie rozpakowuje.');
  }
  await fsp.mkdir(path.dirname(BIN), { recursive: true });
  execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    'Expand-Archive -LiteralPath $env:ARCHIVECORE_PILOT_ZIP -DestinationPath $env:ARCHIVECORE_PILOT_DEST -Force',
  ], {
    stdio: 'inherit',
    env: { ...process.env, ARCHIVECORE_PILOT_ZIP: zip, ARCHIVECORE_PILOT_DEST: path.dirname(BIN) },
  });
  if (!fs.existsSync(BIN)) throw new Error('Nie znaleziono ollama.exe po rozpakowaniu.');
  execFileSync(BIN, ['--version'], { stdio: 'inherit', timeout: 30000 });
  console.log(`Pakiet pilotowy gotowy: ${BIN}`);
}

async function serve() {
  if (!fs.existsSync(BIN)) throw new Error('Najpierw uruchom --install.');
  await fsp.mkdir(path.join(ROOT, 'models'), { recursive: true });
  const log = fs.openSync(path.join(ROOT, 'serve.log'), 'a');
  const child = spawn(BIN, ['serve'], {
    cwd: path.dirname(BIN), env: modelEnv(), detached: true,
    stdio: ['ignore', log, log], windowsHide: true,
  });
  child.unref();
  fs.closeSync(log);
  console.log(`Uruchomiono lokalny proces pilota PID ${child.pid}. Log: ${path.join(ROOT, 'serve.log')}`);
}

function pull() {
  if (!fs.existsSync(BIN)) throw new Error('Najpierw uruchom --install.');
  execFileSync(BIN, ['pull', MODEL], { env: modelEnv(), stdio: 'inherit', timeout: 30 * 60 * 1000 });
}

async function main() {
  if (process.platform !== 'win32') throw new Error('Ten skrypt jest przeznaczony dla serwera Windows.');
  if (os.release().startsWith('10.0.20348')) {
    console.warn('Uwaga: Windows Server 2022 nie jest wymieniony w wymaganiach Ollama. To tylko izolowany pilot.');
  }
  const action = process.argv[2];
  if (action === '--install') await install();
  else if (action === '--serve') await serve();
  else if (action === '--pull') pull();
  else throw new Error('Uzycie: node server/scripts/setup-local-embedding.cjs --install|--serve|--pull');
}

main().catch((error) => {
  console.error('Lokalny model nie jest gotowy:', error.message);
  process.exitCode = 1;
});
