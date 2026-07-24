# FounderForge — Agent-as-a-Service Platform

A2MCP services on OKX.AI: standardized MCP/API products with fixed pay-per-call pricing via the OKX Payment SDK (X Layer USD₮0).

## Monorepo layout

```
apps/           api-gateway, orchestrator, cost-worker, ops-dashboard
services/       one product pipeline each (+ _service-template)
packages/       connectors, payments/okx, llm-core, schemas, db, queue, observability, policy
infra/          docker, k8s, terraform, ci
docs/           PRD, pricing, ASP onboarding, ADRs
```

## Prerequisites

- Node.js ≥ 20
- pnpm 9 (`corepack enable && corepack prepare pnpm@9.15.0 --activate`)
- Postgres (`DATABASE_URL`)
- Temporal (`TEMPORAL_ADDRESS`, e.g. `temporal server start-dev`)

## Quick start

```bash
cp env.example .env   # fill GROQ_API_KEY, SUPABASE_*, SERPER_API_KEY, DATABASE_URL
pnpm install
pnpm --filter @founderforge/db migrate

# Terminal A — Temporal (example)
temporal server start-dev

# Terminal B — worker
pnpm --filter @founderforge/orchestrator dev

# Terminal C — API
pnpm --filter @founderforge/api-gateway dev
```

With `PAYMENTS_BYPASS=true` (default in `env.example`), job create endpoints skip OKX 402. Set credentials and `PAYMENTS_BYPASS=false` to exercise real Payment SDK challenges.

Feature 5 flow: `POST /v1/services/competitor-research/jobs` → Temporal workflow → poll `GET /v1/jobs/:id` for a Supabase signed PDF URL. Details in `docs/feature-5-competitor-research.md`.

## Scripts

| Command | Purpose |
|---|---|
| `pnpm typecheck` | Typecheck all packages |
| `pnpm build` | Build all packages |
| `pnpm test` | Run unit/integration tests |
| `pnpm dev` | Run all `dev` tasks in parallel |

See `docs/initial-prd.md` for architecture and `docs/feature-5-competitor-research.md` for Feature 5 sample I/O + production flow.
