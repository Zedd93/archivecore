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
| **Auth** | JWT + refresh tokens, RBAC, optional TOTP 2FA |

## Features

- Multi-tenant isolation with role-based permissions
- Box & document lifecycle management (create, check out, return, dispose)
- Order workflow (draft, submit, approve, process, deliver, complete)
- Custody chain tracking with digital signatures
- HR personnel folder management (PESEL encrypted at rest)
- Transfer list management (JRWA-compliant) with CSV/XLSX import
- Location tree with capacity tracking
- Full-text search across all entities
- QR code label generation (single & bulk A4)
- Export to CSV/XLSX, PDF reports
- PWA with offline support
- Keyboard shortcuts (press `?` to see all)
- Audit log for all operations

## Quick Start

### Prerequisites

- Node.js >= 18
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
npm run db:migrate     # Run pending migrations
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

## API

All endpoints are under `/api/`. Authentication via `Authorization: Bearer <token>` header.

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
