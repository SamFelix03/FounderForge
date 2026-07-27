# syntax=docker/dockerfile:1
# Build from monorepo root:
#   docker build -f apps/orchestrator/Dockerfile -t founderforge-orchestrator .
#
# Debian + Playwright system deps (PDF / outreach / demo). Do not use Alpine.
FROM node:22-bookworm AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter @founderforge/orchestrator...
# Chromium + OS libs for Playwright (competitor-research, outreach, demo)
RUN pnpm --filter @founderforge/competitor-research-service exec playwright install --with-deps chromium \
 && pnpm --filter @founderforge/outreach-service exec playwright install chromium || true \
 && pnpm --filter @founderforge/automated-product-demo-service exec playwright install chromium || true
RUN pnpm --filter @founderforge/orchestrator... build

FROM base AS runner
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-6 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
COPY --from=build /ms-playwright /ms-playwright
CMD ["pnpm", "--filter", "@founderforge/orchestrator", "start"]
