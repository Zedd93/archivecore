# ============================================
# Stage 1: Install dependencies & build
# ============================================
FROM node:20-alpine AS builder

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

# Generate Prisma client
RUN npx prisma generate

# Build server (TypeScript -> JavaScript)
RUN npm run build --workspace=server

# Build client (React -> static HTML/JS/CSS)
RUN npm run build --workspace=client

# ============================================
# Stage 2: Production image (slim)
# ============================================
FROM node:20-alpine AS production

WORKDIR /app

# Install only what's needed for runtime
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY prisma/schema.prisma prisma/

RUN npm install --workspace=server --omit=dev --legacy-peer-deps && \
    npx prisma generate && \
    npm cache clean --force

# Copy built server
COPY --from=builder /app/server/dist server/dist

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
