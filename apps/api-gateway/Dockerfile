FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api-gateway/package.json apps/api-gateway/
COPY packages packages
COPY services services
RUN pnpm install --filter @founderforge/api-gateway...
COPY . .
RUN pnpm --filter @founderforge/api-gateway... build
CMD ["pnpm", "--filter", "@founderforge/api-gateway", "start"]
