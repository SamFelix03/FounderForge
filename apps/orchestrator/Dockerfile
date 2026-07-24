FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --filter @founderforge/orchestrator...
RUN pnpm --filter @founderforge/orchestrator... build
CMD ["pnpm", "--filter", "@founderforge/orchestrator", "start"]
