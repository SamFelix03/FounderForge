# syntax=docker/dockerfile:1
# Build from monorepo root:
#   docker build -f apps/marketplace-bridge/Dockerfile -t founderforge-marketplace-bridge .
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter @founderforge/marketplace-bridge...
RUN pnpm --filter @founderforge/marketplace-bridge... build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
CMD ["pnpm", "--filter", "@founderforge/marketplace-bridge", "start"]
