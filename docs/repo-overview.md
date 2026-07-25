# FounderForge — Repo Overview

pnpm + Turborepo monorepo. Entry points live in `apps/`, product logic in `services/`, shared libs in `packages/`.

---

## Top level

| Path | Role |
|---|---|
| `apps/` | Runnable processes (API, Temporal worker, ops) |
| `services/` | One folder per product pipeline |
| `packages/` | Shared libraries imported by apps/services |
| `docs/` | Contracts, planning, ADRs, runbooks, pricing |
| `infra/` | CI, Docker, k8s, Terraform |
| `tests/` | Cross-cutting e2e tests |
| `env.example` / `.env` | Env template / local secrets |
| `package.json` / `pnpm-workspace.yaml` / `turbo.json` | Workspace + build orchestration |

---

## `apps/`

| Folder | Contains | Role |
|---|---|---|
| `api-gateway/` | Express app, job routes, idempotency middleware, Temporal client, Postgres job store | HTTP entry: create/poll jobs, kick off workflows |
| `orchestrator/` | Temporal worker, workflows, activities | Runs Feature 5 steps reliably (retry, durable state) |
| `cost-worker/` | Small worker stub | Internal COGS / cost tracking (scaffold) |
| `ops-dashboard/` | Small app stub | Ops visibility (scaffold) |

---

## `services/`

Each service follows the same shape: `schema.ts`, `pipeline.ts`, `pricing.ts`, `policy.ts`, `index.ts`.

| Folder | Role |
|---|---|
| `competitor-research-service/` | **Feature 5 — fully implemented** (agents, PDF report, storage, live/batch scripts) |
| `brand-kit-service/` | Feature scaffold |
| `outreach-service/` | Feature scaffold |
| `promo-video-service/` | Feature scaffold |
| `automated-product-demo-service/` | **Automated product demo — fully implemented** (Firecrawl + Gemini + Deepgram → MP4) |
| `social-listening-service/` | Feature scaffold |
| `social-post-service/` | Feature scaffold |
| `_service-template/` | Copy-paste starter for new services |

---

## `packages/`

| Folder | Contains | Role |
|---|---|---|
| `connectors/` | `webSearch`, `fetchPage`, `fetchPageJina` | External I/O: search + page fetch |
| `llm-core/` | Groq `complete` / `completeJson` + 429 retries | Shared LLM calls |
| `db/` | Postgres pool, migrations, job CRUD | Durable job store |
| `schemas/` | Shared Zod types / contracts | Cross-service shapes |
| `observability/` | Logger, `loadRootEnv` | Logging + env loading |
| `policy/` | Approval / policy helpers | Shared guardrails |
| `queue/` | Queue helpers | Async job plumbing (scaffold) |
| `payments/` (`okx/`) | OKX / A2MCP payment wiring | Paid A2MCP settlement |

---

## `docs/`

| Folder | Role |
|---|---|
| `feature-contracts/` | Per-feature specs (e.g. Feature 5) |
| `planning/` | PRD, ASP onboarding, payment prompts |
| `pricing/` | Product pricing notes |
| `adr/` | Architecture decision records |
| `runbooks/` | Ops how-tos |

---

## `infra/`

| Folder | Role |
|---|---|
| `ci/` | CI pipelines |
| `docker/` | Shared Docker assets |
| `k8s/` | Kubernetes manifests |
| `terraform/` | Cloud infra as code |

---

## Feature 5 — Competitor Research

**Service:** `services/competitor-research-service/`  
**Workflow:** `apps/orchestrator` → `competitorResearchWorkflow`

### Agents (in order)

| Agent | File | Does |
|---|---|---|
| Competitor finder | `agents/findCompetitors.ts` | Search → rank peers |
| Feature-diff | `agents/diffFeatures.ts` | Category dimensions + matrix |
| Pricing scraper | `agents/scrapePricing.ts` | Public tiers / models |
| Positioning | `agents/buildPositioning.ts` | SWOT, map, recommendations |
| Report compiler | `agents/compileReport.ts` | HTML → PDF → Supabase URL |

Supporting: `agents/fetchEvidence.ts` (shared page gather), `report/template.ts` (PDF HTML), `storage.ts` (Supabase upload), `pipeline.ts` (local/CLI orchestration).

### Shared modules Feature 5 uses

| Module | Used for |
|---|---|
| `@founderforge/connectors` | **Serper/Brave/DDG** = find competitors; **Jina Reader** = read vendor pages |
| `@founderforge/llm-core` | Groq JSON calls for ranking, scoring, synthesis |
| `@founderforge/db` | Durable job records (via gateway / Temporal activities) |
| `@founderforge/observability` | Logs + root `.env` load |
| `@founderforge/schemas` / local `schema.ts` | Input/output Zod contracts |
| Playwright (service dep) | Render PDF buffer |
| Supabase Storage | Host PDF, return signed URL |
| Temporal (`apps/orchestrator`) | Orchestrate + retry the 5 steps |

### Flow (short)

`POST job` → API → Postgres job + Temporal start → find → evidence (Jina) → features → pricing → positioning → PDF upload → signed URL on job complete.

---

## Automated Product Demo

**Service:** `services/automated-product-demo-service/`  
**Workflow:** `apps/orchestrator` → `automatedProductDemoWorkflow`  
**Endpoint:** `POST /v1/services/automated-product-demo/jobs`  
**Contract / runbook:** `docs/feature-contracts/feature-automated-product-demo.md`, `docs/runbooks/automated-product-demo.md`

### Pipeline phases

| Phase | Module | Does |
|---|---|---|
| plan | `planner.ts` | Gemini → atomic Firecrawl steps + narration drafts |
| record | `browser.ts` | Scrape → warm-up → CDP screencast → interact → close session |
| narrate | `narrator.ts` + `tts.ts` | Grounded lines (Gemini) + Deepgram Aura WAV |
| assemble | `assemble.ts` + `media.ts` | ffmpeg pad/mux/concat (even-dimension scale) |
| upload | `storage.ts` | Supabase Storage REST → public/signed `video_url` |

`pipeline.ts` orchestrates all phases under `os.tmpdir()` (deleted in `finally`). Temporal uses one 30-minute activity with `setJobStep` around phases.

### Flow (short)

`POST job` → API validate → Postgres + Temporal → `runPipeline` → Supabase video URL on job complete.
