# syntax=docker/dockerfile:1.7
#
# Targets:
#   web    (default) - slim Next.js standalone server
#   tools            - full source + dependencies: background worker, migrations, seed
#
#   docker build --build-arg APP_URL=https://sms.example.com -t smsflow-web .
#   docker build --build-arg APP_URL=https://sms.example.com --target tools -t smsflow-tools .
#
# APP_URL is baked into statically generated marketing pages (canonical URLs,
# sitemap, Open Graph), so build with the public URL of the deployment.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ── Dependencies ──────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
# Scripts are skipped here; `prisma generate` runs once the schema is copied.
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --no-audit --no-fund

# ── Build ─────────────────────────────────────────────────────────────────────
FROM base AS build
ARG APP_URL=http://localhost:3000
ENV APP_URL=${APP_URL}
# Only needed so prisma.config.ts can load during `prisma generate`; never used to connect.
ENV DATABASE_URL=mysql://build:build@localhost:3306/build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── Tools: worker, migrations, seed ───────────────────────────────────────────
FROM base AS tools
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY scripts ./scripts
COPY src ./src
COPY --from=build /app/src/generated ./src/generated
RUN useradd --system --uid 1001 --create-home app && mkdir -p /app/data && chown app /app/data
USER app
ENV LOCAL_DATA_DIR=/app/data
# Default: the background worker. Override with `npx prisma migrate deploy` for migrations.
CMD ["npm", "run", "worker"]

# ── Web runtime ───────────────────────────────────────────────────────────────
FROM base AS web
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    LOCAL_DATA_DIR=/app/data
RUN useradd --system --uid 1001 app && mkdir -p /app/data && chown app /app/data
COPY --from=build --chown=app /app/.next/standalone ./
COPY --from=build --chown=app /app/.next/static ./.next/static
COPY --from=build --chown=app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
