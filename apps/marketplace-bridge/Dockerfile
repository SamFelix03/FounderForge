# syntax=docker/dockerfile:1
# Build from monorepo root:
#   docker build -f apps/marketplace-bridge/Dockerfile -t founderforge-marketplace-bridge .
#
# Runtime needs a persistent volume at ONCHAINOS_HOME (default /data/onchainos)
# plus a one-time wallet login (see docs/runbooks/marketplace-bridge-railway.md).

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=/usr/local/bin:/root/.local/bin:$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    tar \
    gzip \
    keyutils \
    libkeyutils1 \
  && rm -rf /var/lib/apt/lists/*

FROM base AS onchainos
# Install Linux onchainos CLI into /usr/local/bin (stable release).
RUN curl -fsSL https://raw.githubusercontent.com/okx/onchainos-skills/main/install.sh | sh \
  && install -m 0755 /root/.local/bin/onchainos /usr/local/bin/onchainos \
  && onchainos --version \
  && npm install -g @okxweb3/a2a-node@latest \
  && command -v okx-a2a \
  && okx-a2a --version || true

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter @founderforge/marketplace-bridge...
RUN pnpm --filter @founderforge/marketplace-bridge... build

FROM base AS runner
ENV NODE_ENV=production
ENV HOME=/root
ENV ONCHAINOS_HOME=/data/onchainos
ENV PATH=/usr/local/bin:/usr/local/lib/node_modules/.bin:/root/.local/bin:$PATH
ENV BRIDGE_REQUIRE_WALLET=0
WORKDIR /app

COPY --from=onchainos /usr/local/bin/onchainos /usr/local/bin/onchainos
COPY --from=onchainos /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN set -eux; \
  if [ -f /usr/local/lib/node_modules/@okxweb3/a2a-node/dist/cli.js ]; then \
    ln -sfn /usr/local/lib/node_modules/@okxweb3/a2a-node/dist/cli.js /usr/local/bin/okx-a2a; \
    chmod +x /usr/local/bin/okx-a2a || true; \
  elif [ -x /usr/local/lib/node_modules/.bin/okx-a2a ]; then \
    ln -sfn /usr/local/lib/node_modules/.bin/okx-a2a /usr/local/bin/okx-a2a; \
  else \
    echo "WARN: okx-a2a binary not found (non-fatal for deliver)"; \
  fi; \
  onchainos --version

COPY --from=build /app /app
COPY apps/marketplace-bridge/docker/entrypoint.sh /entrypoint.sh
COPY apps/marketplace-bridge/docker/login.sh /usr/local/bin/ff-onchainos-login
RUN chmod +x /entrypoint.sh /usr/local/bin/ff-onchainos-login \
  && mkdir -p /data/onchainos

# Persist wallet session via a Railway Volume mounted at /data/onchainos
# (do not use Dockerfile VOLUME — Railway rejects it).

# Railway injects PORT; health listens there (or BRIDGE_HEALTH_PORT).
EXPOSE 4091
ENTRYPOINT ["/entrypoint.sh"]
CMD ["pnpm", "--filter", "@founderforge/marketplace-bridge", "start"]
