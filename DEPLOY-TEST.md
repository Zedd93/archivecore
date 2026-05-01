# ArchiveCore — Deployment testowy na serwer firmowy

Stan na 2026-05-01. Repo zostało przetestowane lokalnie (typecheck, build, pełny stack przez docker-compose). Pełen smoke test przeszedł: PostgreSQL + Redis + MinIO + app healthy, migracja, seed, login JWT.

## Co zostało naprawione w tej iteracji

| Plik | Zmiana | Powód |
|------|--------|-------|
| `Dockerfile` | `apk add openssl` w obu stage'ach | Prisma 5.22 engine wymaga `libssl.so.1.1` / 3.0 — Alpine bez tego pakietu pada z `Error loading shared library libssl` |
| `Dockerfile` | `./node_modules/.bin/prisma generate` zamiast `npx prisma generate` | `npx` w prod stage ściągał Prisma 7 (najnowsza), która zerwała kompatybilność ze schematem v5 (`url = env(...)`) |
| `Dockerfile` | Kopiowanie `.prisma`, `@prisma`, `prisma` z buildera + wrapper w `/usr/local/bin/prisma` | Prod stage nie miał Prisma CLI; symlink `node_modules/.bin/prisma` po COPY tracił wskazanie na WASM |
| `Dockerfile` | Pre-kompilacja `prisma/seed.ts` → `seed.cjs` przez esbuild w builderze | Eliminuje runtime'ową zależność od `tsx`/`ts-node` (które miały rozjazd dep tree) |
| `prisma/schema.prisma` | `binaryTargets = ["native", "linux-musl-openssl-3.0.x", "linux-musl-arm64-openssl-3.0.x"]` | Wymusza wygenerowanie engine'ów dla nowoczesnego Alpine (OpenSSL 3) |
| `shared/package.json` | `main: dist/index.js` + `exports` z warunkami `node`/`default` | W produkcji Node ładował `src/index.ts` jako ESM bez rozszerzeń → `ERR_MODULE_NOT_FOUND` |
| `shared/tsconfig.json` | `module: CommonJS`, `moduleResolution: node` | Server jest CJS — `import` z ESM dystrybucji zrywał require() |
| `package.json` | `prisma.seed = "node prisma/seed.cjs"` | Zgodne z prekompilacją w Dockerfile |
| `deploy.sh` | `prisma db push/seed` zamiast `npx prisma ...` | Używa lokalnego CLI z obrazu, nie pobiera Prisma 7 |

Bez tych poprawek `docker compose -f docker-compose.prod.yml up` natychmiast crash-loopował.

## Wynik weryfikacji lokalnej

```
✅ npm install         (legacy-peer-deps)
✅ npm run typecheck   (shared, server, client — bez błędów)
✅ npm run build       (shared CJS + server tsc + client vite)
✅ docker build        (227 MB, multi-stage)
✅ docker compose up   (postgres+redis+minio+app — wszystkie healthy)
✅ prisma db push      (schema zaaplikowana)
✅ prisma db seed      (8 ról, tenant DEMO, użytkownicy, lokalizacje)
✅ POST /api/auth/login → JWT zwrócony
```

> Uwaga: README mówi o `/api/v1/...`, kod montuje routery pod `/api/...` (bez `v1`). Dokumentacja jest niezgodna z kodem — zostawiłem kod jak jest, do decyzji.

## Wymagania serwera

- Linux x86_64 (Ubuntu 22.04+ / Debian 12 / RHEL 9 — dowolny z Dockerem)
- Docker ≥ 24 + `docker compose` plugin
- 2+ rdzenie, 4+ GB RAM, 20+ GB dysk
- Otwarte porty na firewallu: **80** (HTTP), **443** (HTTPS po SSL), **22** (SSH)
- Domena lub publiczny IP wskazujący na serwer

## Procedura deploymentu testowego

### 1. Skopiuj repo na serwer
```bash
ssh user@serwer-firmowy
git clone <url-repo> /opt/archivecore
cd /opt/archivecore
```

### 2. Wygeneruj sekrety
```bash
bash generate-env.sh
# Skrypt zapyta o domenę/IP — np. archivecore.firma.local lub 10.0.5.42
# Wygenerowany .env.production zawiera wszystkie hasła, ZACHOWAJ KOPIĘ
```

`.env.production` jest w `.gitignore` i `.dockerignore` — nigdy nie trafia do git ani do obrazu.

### 3. Uruchom deployment
```bash
bash deploy.sh
```

Skrypt: builduje obraz, startuje stack, robi `prisma db push`, seeduje dane domyślne, pokazuje status.

### 4. Sprawdź zdrowie
```bash
curl http://localhost:3001/api/health
# {"status":"ok","timestamp":"...","version":"1.0.0","env":"production"}

docker compose -f docker-compose.prod.yml ps
# wszystkie kontenery powinny być Up (healthy)
```

### 5. Pierwsze logowanie

| Konto | Email | Hasło |
|-------|-------|-------|
| Super Admin | `admin@archivecore.local` | `Admin123!@#` |
| Demo Admin (tenant DEMO) | `admin@demo.pl` | `Admin123!@#` |

**Natychmiast zmień hasła** po pierwszym logowaniu.

### 6. SSL (przed wystawieniem na zewnątrz!)

`docker-compose.prod.yml` zawiera już kontener `certbot` i `nginx`. Po pierwszym uruchomieniu:

```bash
docker compose -f docker-compose.prod.yml run --rm certbot \
  certonly --webroot -w /var/www/certbot \
  -d twoja-domena.firma.local --email it@firma.local --agree-tos
```

Następnie odkomentuj sekcję HTTPS w `nginx.conf` i:
```bash
docker compose -f docker-compose.prod.yml restart nginx
```

## Operacje bieżące

```bash
# Logi aplikacji
docker compose -f docker-compose.prod.yml logs -f app

# Restart pojedynczego serwisu
docker compose -f docker-compose.prod.yml restart app

# Backup PG
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U archivecore archivecore | gzip > backup-$(date +%F).sql.gz

# Migracja po aktualizacji kodu
git pull
docker compose -f docker-compose.prod.yml build app
docker compose -f docker-compose.prod.yml up -d app
docker compose -f docker-compose.prod.yml exec app prisma db push --skip-generate

# Zatrzymanie wszystkiego
docker compose -f docker-compose.prod.yml down
```

## Smoke test lokalny (debug, nie używać na prod)

`docker-compose.smoketest.yml` to override który:
- przemapowuje port app na **13001** (żeby nie kolidować z innymi kontenerami)
- zmienia `container_name` na `actest-*`
- wyłącza nginx + certbot przez profile

Użycie:
```bash
docker compose -p actest \
  -f docker-compose.prod.yml -f docker-compose.smoketest.yml \
  --env-file .env.production up -d --build app postgres redis minio
```

## Znane ograniczenia / do zrobienia po teście

1. **Pozostałe 7 vulnerabilities** (z 18, 0 critical/0 high w runtime; szczegóły w sekcji "Audyt bezpieczeństwa" niżej).
2. **Pokrycie testami minimalne** — są smoke testy (`shared` walidatory + `server` health/login validation), brak pełnej regresji przez DB. CI: `npm test` zwraca 10/10.
3. **Brak monitoringu** — log rotation, health alerting, metrics. Na deployment testowy OK, na prod dorzucić Prometheus/Grafana lub minimalnie healthcheck cron + alert.
4. **MinIO bez SSL** wewnątrz sieci docker — to OK bo isolated, ale jeśli wystawiony zewnętrznie, włączyć `MINIO_USE_SSL=true`.

## Audyt bezpieczeństwa

Po `npm audit fix` zostało 7 vuln (z 18). Status:

| Pakiet | Severity | Action plan |
|--------|----------|-------------|
| `vite`, `esbuild` | moderate | **Tylko dev** — atak wymaga dostępu do dev serwera. W produkcyjnym obrazie nie ma. Bezpieczne. |
| `node-cron` | moderate | Wymaga major bump (4.x). Małe ryzyko (timer scheduler). Zaplanować na osobny PR po regression test. |
| `uuid` | moderate | Dotyczy v3/v5/v6 z `buf` argumentem — kod używa v4 bez `buf`. Bezpieczne, fix przy najbliższej okazji. |
| `xlsx` | high | **Brak fix dostępnego od sheet.js**. Rozważyć migrację na `exceljs`. Atak: prototype pollution + ReDoS. Mitigacja: import XLSX tylko od auth'd użytkownika w tenantcie. Średnie ryzyko. |

Przed publicznym wystawieniem aplikacji warto: 
- migracja `xlsx` → `exceljs` (lub sandbox importu) 
- bump `node-cron` + `uuid` po regression test 

Te trzy nie blokują testowego deploymentu wewnętrznego.

## Testy automatyczne

```bash
npm test
# 6 shared (Zod schemas) + 4 server (health/login validation) = 10/10
```

Testy server'a wymagają `shared/dist` — pełen `npm run build` lub przynajmniej `npm run build --workspace=shared` przed `npm test` w czystym sklonie.
