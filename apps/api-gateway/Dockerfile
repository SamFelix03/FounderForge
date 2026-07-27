# syntax=docker/dockerfile:1
# Build from monorepo root:
#   docker build -f apps/api-gateway/Dockerfile -t founderforge-api-gateway .
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter @founderforge/api-gateway...
RUN pnpm --filter @founderforge/api-gateway... build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
EXPOSE 4021
CMD ["pnpm", "--filter", "@founderforge/api-gateway", "start"]
