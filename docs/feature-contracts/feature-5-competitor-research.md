# Feature 5 — Automated Competitor Research Report (Production)

Paid A2MCP service: `POST /v1/services/competitor-research/jobs` → Temporal workflow → branded **PDF** (Supabase signed URL).

List price: **$4.99** per call (see `docs/pricing/pricing.md`). Settlement via OKX Payment SDK when `PAYMENTS_BYPASS=false`.

**Runtime requirements:** Postgres (`DATABASE_URL`), Temporal (`TEMPORAL_ADDRESS`), orchestrator worker, Supabase Storage, Groq, Jina Reader, search provider (Serper preferred).

---

## Sample input

```json
{
  "input": {
    "product_name": "Notion",
    "product_url": "https://www.notion.so"
  },
  "callback_url": "https://example.com/webhooks/founderforge",
  "priority": "normal"
}
```

| Field | Required | Notes |
|---|---|---|
| `input.product_name` | yes | Human product / company name used in search queries |
| `input.product_url` | recommended | Homepage used as ground-truth for category, features, pricing |
| `callback_url` | no | Optional webhook POSTed when job completes / fails |
| `priority` | no | Accepted (`low` \| `normal` \| `high`); shared Temporal task queue today |

**Input schema (code):** `CompetitorResearchInputSchema` in `packages/schemas` — only `product_name` + optional `product_url`.

**Headers**

- `Content-Type: application/json`
- `X-Idempotency-Key: <unique>` (recommended)
- Payment headers only when OKX middleware is live (`PAYMENTS_BYPASS=false`)

---

## Expected output

### Immediate create response (`202 Accepted`)

```json
{
  "job_id": "9f3c2a1b-…",
  "list_price_usd": 4.99,
  "eta_seconds": 1200,
  "status_url": "/v1/jobs/9f3c2a1b-…",
  "status": "queued"
}
```

`eta_seconds` = SLA × 60 (20 min → 1200).

### Completed job (`GET /v1/jobs/{job_id}`)

```json
{
  "id": "9f3c2a1b-…",
  "service": "competitor-research",
  "status": "completed",
  "list_price_usd": 4.99,
  "step": "compileReport",
  "artifacts": [
    {
      "type": "report_pdf",
      "url": "https://….supabase.co/storage/v1/object/sign/reports/competitor-research/notion-….pdf?token=…",
      "object_key": "competitor-research/notion-….pdf",
      "mime_type": "application/pdf"
    }
  ],
  "cost_breakdown": [
    { "vendor": "discovery", "operation": "findCompetitors", "amount_usd": 0.01 },
    { "vendor": "scrape", "operation": "diffFeatures", "amount_usd": 0.02 },
    { "vendor": "scrape", "operation": "scrapePricing", "amount_usd": 0.02 },
    { "vendor": "llm-core", "operation": "buildPositioning", "amount_usd": 0.05 },
    { "vendor": "render", "operation": "compileReport", "amount_usd": 0.01 }
  ],
  "created_at": "…",
  "updated_at": "…"
}
```

**What the client gets:** the PDF artifact (+ costs). Intermediate agent data (competitors, feature matrix, pricing, positioning) is used to build the PDF but is **not** returned on the job record.

Jobs live in **Postgres**. Execution runs in the **Temporal orchestrator worker**.

---

## Production flow

```
Caller
  → API Gateway (pay + validate + INSERT jobs)
  → Temporal start competitorResearchWorkflow
  → Orchestrator worker activities (sequential):
       findCompetitors
       → diffFeatures
       → scrapePricing
       → buildPositioning
       → compileReport (PDF buffer → Supabase signed URL)
  → UPDATE jobs completed + optional callback_url
  ← Client polls GET /v1/jobs/:id
```

Features and pricing are **sequential** (not parallel) to stay under Groq rate limits. Each of those activities fetches its own vendor evidence via Jina (CLI `runPipeline` can share one evidence pass; Temporal path currently fetches per activity).

**Agents**

1. **findCompetitors** — Serper → Brave → DDG search; Groq ranks ≤5 peers  
2. **diffFeatures** — category-fit dimensions (dynamic) + matrix from vendor pages  
3. **scrapePricing** — public tiers / pricing model  
4. **buildPositioning** — SWOT, deterministic map, recommendations  
5. **compileReport** — HTML template → Playwright PDF → Supabase signed URL  

---

## Production stack

| Concern | Provider | Env |
|---|---|---|
| LLM | Groq (`GROQ_MODEL_*`, default `openai/gpt-oss-120b`) | `GROQ_API_KEY` |
| Web search | Serper → Brave → DuckDuckGo (failover) | `SERPER_API_KEY`, `BRAVE_SEARCH_API_KEY` |
| Page fetch | Jina Reader (`r.jina.ai`) → HTTP fallback | `JINA_API_KEY` |
| Evidence | Vendor homepage / features + `/pricing` / `/plans` (no review-site scraping) | — |
| PDF | Playwright `page.pdf()` → Buffer | Playwright Chromium |
| Object store | Supabase Storage (signed URL; default TTL 7d) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Job store | Postgres | `DATABASE_URL` |
| Orchestration | Temporal | `TEMPORAL_ADDRESS`, `TEMPORAL_TASK_QUEUE` |

---

## How to run

```bash
# 1) Postgres + Temporal (e.g. local Postgres + `temporal server start-dev`)
# 2) Env: DATABASE_URL, TEMPORAL_*, GROQ_API_KEY, JINA_API_KEY, SUPABASE_*, SERPER_API_KEY

pnpm install
pnpm --filter @founderforge/db migrate
pnpm --filter @founderforge/orchestrator dev   # Temporal worker
pnpm --filter @founderforge/api-gateway dev    # HTTP admission

curl -s -X POST http://localhost:4021/v1/services/competitor-research/jobs \
  -H 'content-type: application/json' \
  -H 'x-idempotency-key: demo-1' \
  -d '{"input":{"product_name":"Notion","product_url":"https://www.notion.so"}}'
```

Live CLI (same agents, outside Temporal):

```bash
pnpm --filter @founderforge/competitor-research-service run live -- "Notion" "https://www.notion.so"
pnpm --filter @founderforge/competitor-research-service run live -- "Linear" "https://linear.app"
```

Batch quality check:

```bash
pnpm --filter @founderforge/competitor-research-service run batch
```

---

## Failure modes

| Failure | Behavior |
|---|---|
| Invalid input | 400 on create |
| Payment missing | 402 (when `PAYMENTS_BYPASS=false`) |
| Temporal unreachable | job → `failed` (`temporal_enqueue_failed:…`) |
| Search providers all fail | activity fails → Temporal retries → job `failed` |
| Missing Supabase / Groq / Jina | activity fails → job `failed` |
| PDF / upload failure | job `failed` |

---

## Code map

| Step | Path |
|---|---|
| HTTP admission | `apps/api-gateway` |
| Durable jobs | `packages/db` |
| Temporal client | `apps/api-gateway/src/temporal/client.ts` |
| Workflow | `apps/orchestrator/src/workflows/competitorResearch.ts` |
| Activities | `apps/orchestrator/src/activities/*` |
| Agents | `services/competitor-research-service/src/agents/*` |
| PDF template | `services/competitor-research-service/src/report/template.ts` |
| Object upload | `services/competitor-research-service/src/storage.ts` |
| Shared I/O | `packages/connectors`, `packages/llm-core` |
