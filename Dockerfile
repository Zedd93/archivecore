# ============================================
# Stage 1: Install dependencies & build
# ============================================
FROM node:20-alpine AS builder

# OpenSSL needed by Prisma engines (and openssl-dev for headers during install)
RUN apk add --no-cache openssl

WORKDIR /app

# Copy package files first (Docker layer caching)
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
COPY prisma/schema.prisma prisma/

# Install ALL dependencies (including devDeps for build)
RUN npm install --legacy-peer-deps

# Copy source code
COPY shared/ shared/
COPY server/ server/
COPY client/ client/
COPY prisma/ prisma/
COPY tsconfig.base.json ./

# Build shared package
RUN npm run build --workspace=shared 2>/dev/null || true

# Generate Prisma client (use local prisma 5.x from devDeps, not latest from npx)
RUN ./node_modules/.bin/prisma generate

# Build server (TypeScript -> JavaScript)
RUN npm run build --workspace=server

# Compile prisma seed to JS so the production image doesn't need tsx/ts-node
RUN ./node_modules/.bin/tsc --project server/tsconfig.json --outDir /tmp/seed-out --rootDir prisma --noEmit false --declaration false prisma/seed.ts 2>/dev/null || \
    ./node_modules/.bin/esbuild prisma/seed.ts --bundle=false --platform=node --target=node20 --format=cjs --outfile=prisma/seed.cjs

# Build client (React -> static HTML/JS/CSS)
RUN npm run build --workspace=client

# ============================================
# Stage 2: Production image (slim)
# ============================================
FROM node:20-alpine AS production

# OpenSSL 3 — Prisma query engine links against libssl at runtime
RUN apk add --no-cache openssl

WORKDIR /app

# Install only what's needed for runtime
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY prisma/schema.prisma prisma/

RUN npm install --workspace=server --omit=dev --legacy-peer-deps && \
    npm cache clean --force

# Copy built server
COPY --from=builder /app/server/dist server/dist

# Copy generated Prisma client + CLI + all @prisma/* deps from builder.
# (Re-running `prisma generate` here would pull Prisma 7 and break the v5 schema.)
COPY --from=builder /app/node_modules/.prisma node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma node_modules/@prisma
COPY --from=builder /app/node_modules/prisma node_modules/prisma
# Use a wrapper script instead of copying the .bin/prisma symlink (Docker COPY
# turns symlinks into files, breaking relative WASM lookups).
RUN printf '#!/bin/sh\nexec node /app/node_modules/prisma/build/index.js "$@"\n' \
      > /usr/local/bin/prisma && chmod +x /usr/local/bin/prisma

# Copy compiled seed (CommonJS) — no tsx/ts-node needed at runtime
COPY --from=builder /app/prisma/seed.cjs prisma/seed.cjs

# Copy built client (static files)
COPY --from=builder /app/client/dist client/dist

# Copy shared built
COPY --from=builder /app/shared/ shared/

# Copy prisma files for migrations
COPY prisma/ prisma/

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "server/dist/index.js"]
