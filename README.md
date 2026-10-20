# ArchiveCore

Multi-tenant archive management system for organizations. Manage physical document storage, boxes, custody chains, HR records, and transfer lists with role-based access control.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS, TanStack Query |
| **Backend** | Node.js, Express, TypeScript, Prisma ORM |
| **Database** | PostgreSQL 16, Redis 7 |
| **Storage** | MinIO (S3-compatible) |
| **i18n** | react-i18next (PL/EN) |
| **Auth** | JWT + refresh tokens, RBAC, required TOTP 2FA for privileged roles |

## Features

- Multi-tenant isolation with role-based permissions
- Box & document lifecycle management (create, check out, return, dispose)
- Order workflow (draft, submit, approve, process, deliver, complete)
- Custody chain tracking with digital signatures
- HR personnel folder management (PESEL encrypted at rest)
- Transfer list management (JRWA-compliant) with CSV/XLSX import
- Local OCR-assisted transfer list import from scans, with mandatory human review ([server setup](docs/scan-import.md))
- Location tree with capacity tracking
- Full-text search across all entities
- QR code label generation (single & bulk A4)
- Export to CSV/XLSX, PDF reports
- Installable PWA with an offline status page; warehouse writes require a live server connection
- Keyboard shortcuts (press `?` to see all)
- Audit log for all operations
- Tenant-scoped read-only partner API ([integration guide](docs/partner-api.md))

## Quick Start

### Prerequisites

- Node.js >= 20
- Docker & Docker Compose

### Setup

```bash
# Clone and install
git clone <repo-url> archivecore
cd archivecore

# Copy environment variables
cp .env.example .env

# Start infrastructure (PostgreSQL, Redis, MinIO) + install + migrate + seed
npm run setup
```

### Development

```bash
# Start both client and server in dev mode
npm run dev

# Or start individually
npm run dev:client   # http://localhost:5173
npm run dev:server   # http://localhost:3001
```

### Default Login

After seeding, use these credentials:

| Role | Email | Password |
|------|-------|----------|
| Super Admin | `admin@archivecore.local` | `Admin123!@#` |

### Useful Commands

```bash
npm run build          # Build all (shared + server + client)
npm run typecheck      # TypeScript check all workspaces
npm run db:studio      # Open Prisma Studio (DB browser)
npm run db:migrate     # Apply pending migrations safely (production)
npm run db:migrate:dev # Create/apply migrations during local development
npm run db:check-integrity # Read-only check of transfer-list/folder consistency
npm run db:seed        # Seed demo data
npm run docker:up      # Start PostgreSQL, Redis, MinIO
npm run docker:down    # Stop infrastructure
```

## Project Structure

```
archivecore/
  client/              # React SPA (Vite)
    src/
      components/      # Reusable UI components
      pages/           # Route pages (lazy-loaded)
      hooks/           # Custom React hooks
      contexts/        # Auth context
      i18n/            # PL/EN translations
  server/              # Express API
    src/
      modules/         # Feature modules (boxes, orders, hr, ...)
      middleware/       # Auth, RBAC, tenant, audit, validation
      config/          # Database, Redis, MinIO, env
  shared/              # Shared Zod schemas & types
    src/validators/    # Validation schemas
  prisma/
    schema.prisma      # Database schema
    seed.ts            # Demo data seeder
```

## Docker Production

```bash
# Build production image
docker build -t archivecore .

# Run with docker-compose
docker compose -f docker-compose.prod.yml up -d
```

## Environment Variables

See `.env.example` for all required variables. Key ones:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | Secret for signing access tokens |
| `JWT_REFRESH_SECRET` | Secret for signing refresh tokens |
| `ENCRYPTION_KEY` | 32-byte key for PESEL encryption |
| `MINIO_*` | MinIO/S3 storage credentials |

### Required MFA (Native Server)

Deploy the database migration before starting the updated server. Privileged
accounts must enroll an authenticator app at their next login; until they verify
its six-digit code, no application session is issued. Existing privileged
sessions must log in again. Each account receives ten one-time recovery codes
during enrollment. Store them securely outside ArchiveCore: they are shown only
once. Keep `ENCRYPTION_KEY` unchanged across deployments, as existing TOTP
secrets depend on it. The native `C:\Apps\update.ps1` procedure should stop the
server, run `prisma migrate deploy` and `prisma generate`, build, then restart it.

### Loan Return Emails (Native Server)

Return reminders always appear in the application. To also send them by email, set
`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and
`PUBLIC_APP_URL` in the server's root `.env`. Use port 587 with `SMTP_SECURE=false`
for mandatory STARTTLS, or port 465 with `SMTP_SECURE=true` for implicit TLS.
`PUBLIC_APP_URL` must be the HTTPS origin of the application, for example
`https://archivecore.doxart.pl`. Never commit SMTP credentials.
After updating the server, run `npm run email:check` from `C:\Apps\archivecore`.
It checks the SMTP connection and login without sending a message or printing
credentials. A successful check does not prove that the provider accepts the
sender address or that a message reaches the recipient; verify one real reminder
using a controlled test account before enabling operational reliance on email.
To send one neutral message without creating an order or changing archive data,
run `npm run email:send-test -- --to your-address@example.com` from `C:\Apps\archivecore`.
The command requires an explicit recipient each time. SMTP acceptance is not
proof of delivery: check the recipient inbox and spam folder. This test also
does not exercise the loan reminder scheduler or queue.

For the native Windows deployment, stop `archivecore-server`, update dependencies,
apply Prisma migrations, build, then start it again. The existing
`C:\Apps\update.ps1` should perform these steps. When SMTP is incomplete, email
delivery stays disabled and new reminders remain in-app only. Temporary SMTP
failures are retried from the database queue; emails are skipped if the loan was
returned or the reminder is no longer timely.
Check `node --version` on the server before updating: email delivery requires
Node.js 20 or newer.

Global Super Admin and Doxart Admin users can review delivery status in
Settings > Notifications. The panel shows recipients, status, attempt count,
and safe error codes without message bodies. Failed deliveries can be retried
manually; the server checks whether the loan return reminder is still relevant
before requeueing. SMTP configuration can be added after deployment; without
it, only in-app reminders are created.

### Personnel Retention Audit (Native Server)

After deployment, run `npm run db:audit-hr-retention` from `C:\Apps\archivecore`.
This read-only check compares stored personnel retention basis, period, and dates
with the current 10/50-year and ZUS RIA rules. It reports counts plus up to 20
tenant codes and record IDs, never names or PESEL numbers. A nonzero exit code
means differences or future RIA submission dates need manual review; the command
does not repair or delete records. Records already marked for review remain
excluded from automatic retention alerts. Confirm any correction with the
responsible archivist before changing production data.
The calculation follows the [Ministry's personnel documentation guidance](https://www.gov.pl/web/rodzina/akta-osobowe)
and the [ZUS RIA guidance](https://bip.zus.pl/web/guest/firmy/przedsiebiorco-przeczytaj-wazne/e-akta/e-akta-pytania-i-odpowiedzi).

### Disposal Readiness Audit (Native Server)

After deployment, run `npm run db:audit-disposal-readiness` from
`C:\Apps\archivecore`. This read-only check scans folders in non-disposed boxes
and reports missing transfer-list links, retention periods, end dates, or
unrecognized retention triggers and categories. It prints counts by tenant and
up to ten folder IDs per issue, without document titles or personal data. A
nonzero exit code means the listed records need manual review; it does not
change or delete anything. A folder without a transfer-list item can be a
legitimate manual record, but it currently blocks automatic box disposal.
For full, non-sensitive details of one tenant's findings, use
`npm run db:audit-disposal-readiness -- --tenant SMPOLI --details`. The detail
view includes list status and both stored date fields so a reviewer can decide
whether to correct a draft list or consult the source records. It never fills
missing dates automatically.

### Reconcile Explicit "No Dates" in Older Transfer Lists

On the native Windows server, after deployment and database migration, copy an
original customer XLSX file to a protected local directory outside the Git
checkout. Preview one list at a time from `C:\Apps\archivecore`:

```powershell
npm run db:reconcile-transfer-list-missing-dates -- --tenant SMPOLI --list SZO-2026-0001 --file "C:\Apps\reconciliation\nowy-swiat.xlsx" --expect 20
```

Only after checking the preview and taking a database backup, repeat the same
command with `--apply --actor-email <active-super-admin-email>`. For the known
SMPOLI source files, `SZO-2026-0002` (Jasna 8) expects 7 and
`SZO-2026-0003` (Mikolaja Kopernika 121) expects 7. The tool verifies every
position's signature, title, category, canonical folder and draft status. It
refuses duplicate list numbers, legal holds, filled dates and stale records.
All changes to a list run in one transaction and create per-item audit entries
with the source file hash and row number. It marks only the source's explicit
"brak dat" text; it never invents dates or makes a folder disposal-ready. Run
`npm run db:audit-disposal-readiness -- --tenant SMPOLI --details` afterward:
the 34 missing end dates should remain, but appear under explicit source
"no dates" instead of unclassified missing dates.

## API

All endpoints are under `/api/v1/`. Authentication via `Authorization: Bearer <token>` header.

| Module | Base Path | Description |
|--------|-----------|-------------|
| Auth | `/auth` | Login, refresh, 2FA, password change |
| Boxes | `/boxes` | CRUD, move, status, bulk operations |
| Orders | `/orders` | Workflow, custody events, items |
| HR | `/hr` | Personnel folders, documents, PESEL search |
| Locations | `/locations` | Tree CRUD, available slots |
| Transfer Lists | `/transfer-lists` | CRUD, items, import, PDF export |
| Labels | `/labels` | QR code generation, templates |
| Search | `/search` | Full-text across all entities |
| Reports | `/reports` | Statistics, charts data |
| Admin | `/admin/*` | Users, tenants, audit, retention |

## License

MIT
