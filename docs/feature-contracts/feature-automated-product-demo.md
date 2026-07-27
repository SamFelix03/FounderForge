# Feature — Automated Product Demo Video (Production)

Paid A2MCP service: `POST /v1/services/automated-product-demo/jobs` → Temporal workflow → narrated **MP4** (Supabase public or signed URL).

List price: **$4.99** per call (see `docs/pricing/pricing.md`). Settlement via OKX Payment SDK when `PAYMENTS_BYPASS=false`.

**Runtime requirements:** Postgres (`DATABASE_URL`), Temporal (`TEMPORAL_ADDRESS`), orchestrator worker, Supabase Storage, Firecrawl, Gemini, Deepgram TTS, ffmpeg/ffprobe (static binaries bundled).

---

## Sample input

```json
{
  "input": {
    "website_url": "https://surveys.free/google-forms-alternative/",
    "script": "Create a Birthday RSVP form with name, email, and attendance fields, then show the share link."
  },
  "callback_url": "https://example.com/webhooks/founderforge",
  "priority": "normal"
}
```

| Field | Required | Notes |
|---|---|---|
| `input.website_url` | yes | Target product URL already open when the demo starts |
| `input.script` | yes | Natural-language demo script guiding browser steps + narration |
| `callback_url` | no | Optional webhook POSTed when job completes / fails |
| `priority` | no | Accepted (`low` \| `normal` \| `high`); shared Temporal task queue today |

**Input schema (code):** `AutomatedProductDemoInputSchema` in `packages/schemas` — `website_url` + `script`.

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
  "eta_seconds": 1800,
  "status_url": "/v1/jobs/9f3c2a1b-…",
  "status": "queued"
}
```

`eta_seconds` = SLA × 60 (30 min → 1800).

### Completed job (`GET /v1/jobs/{job_id}`)

```json
{
  "id": "9f3c2a1b-…",
  "service": "automated-product-demo",
  "status": "completed",
  "list_price_usd": 4.99,
  "step": "upload",
  "artifacts": [
    {
      "type": "video",
      "url": "https://….supabase.co/storage/v1/object/public/demos/product-demos/….mp4",
      "object_key": "product-demos/….mp4",
      "mime_type": "video/mp4"
    }
  ],
  "cost_breakdown": [
    { "vendor": "llm", "operation": "plan", "amount_usd": 0.01 },
    { "vendor": "browser", "operation": "record", "amount_usd": 0.5 },
    { "vendor": "tts", "operation": "narrate", "amount_usd": 0.05 },
    { "vendor": "media", "operation": "assemble", "amount_usd": 0.01 },
    { "vendor": "storage", "operation": "upload", "amount_usd": 0.01 }
  ],
  "created_at": "…",
  "updated_at": "…"
}
```

**What the client gets:** the video artifact (+ costs). Intermediate plan/steps and temp media are **not** returned on the job record.

Jobs live in **Postgres**. Execution runs in the **Temporal orchestrator worker**.

---

## Production flow

```
Caller
  → API Gateway (pay + validate + INSERT jobs)
  → Temporal start automatedProductDemoWorkflow
  → Orchestrator worker activity runAutomatedProductDemoActivity:
       plan → record → narrate → assemble → upload
       (setJobStep around phases; one durable activity for v1)
  → UPDATE jobs completed + optional callback_url
  ← Client polls GET /v1/jobs/:id
```

**Pipeline phases**

1. **plan** — Gemini turns `script` into atomic Firecrawl interact steps + narration drafts  
2. **record** — Firecrawl scrape/warm-up → CDP screencast → interact steps → close session  
3. **narrate** — Gemini grounds narration lines → Deepgram Aura TTS per step  
4. **assemble** — ffmpeg pad/mux/concat (even-dimension scale) into one MP4  
5. **upload** — Supabase Storage REST upload → public or signed `video_url`

Work files use `os.tmpdir()` and are deleted in `finally`. Firecrawl `stopInteraction` / session close always runs on success, error, or cancel.

---

## Production stack

| Concern | Provider | Env |
|---|---|---|
| Planner / narration text | Gemini (`GEMINI_TEXT_MODEL`, default `gemini-3.1-flash-lite`) | `GEMINI_API_KEY` |
| Browser + screencast | Firecrawl interact + CDP | `FIRECRAWL_API_KEY` |
| TTS | Deepgram Aura (`DEEPGRAM_TTS_MODEL`, default `aura-2-thalia-en`) | `DEEPGRAM_API_KEY` |
| Mux / probe | ffmpeg / ffprobe (static or PATH) | — |
| Object store | Supabase Storage REST — **shared Feature 5 project**, prefix `demos/` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET=reports` |
| Signed URL TTL (optional) | defaults to `REPORT_URL_TTL_SECONDS` (7d) | `DEMO_SUPABASE_SIGNED_URL_EXPIRES_IN` or `REPORT_URL_TTL_SECONDS` |
| Job store | Postgres | `DATABASE_URL` |
| Orchestration | Temporal | `TEMPORAL_ADDRESS`, `TEMPORAL_TASK_QUEUE` |

---

## How to run

```bash
# 1) Postgres + Redis + Temporal via docker compose
# 2) Env: DATABASE_URL, TEMPORAL_*, FIRECRAWL_API_KEY, GEMINI_API_KEY,
#    DEEPGRAM_API_KEY, SUPABASE_*

pnpm install
pnpm --filter @founderforge/db migrate
pnpm --filter @founderforge/orchestrator dev   # Temporal worker
pnpm --filter @founderforge/api-gateway dev    # HTTP admission

curl -s -X POST http://localhost:4021/v1/services/automated-product-demo/jobs \
  -H 'content-type: application/json' \
  -H 'x-idempotency-key: apd-1' \
  -d '{"input":{"website_url":"https://surveys.free/google-forms-alternative/","script":"Create a Birthday RSVP form…"}}'
```

Live CLI (same pipeline, outside Temporal):

```bash
pnpm --filter @founderforge/automated-product-demo-service live -- \
  --url 'https://surveys.free/google-forms-alternative/' \
  --script 'Create a Birthday RSVP form…'
```

---

## Failure modes

| Failure | Behavior |
|---|---|
| Invalid input | 400 on create |
| Payment missing | 402 (when `PAYMENTS_BYPASS=false`) |
| Temporal unreachable | job → `failed` (`temporal_enqueue_failed:…`) |
| Missing Firecrawl / Gemini / Deepgram / Supabase | activity fails → job `failed` |
| Firecrawl session / interact race | warm-up retries; session always closed |
| ffmpeg / odd dimensions | even-dimension scale filter; else job `failed` |
| Upload failure | job `failed` |

---

## Code map

| Step | Path |
|---|---|
| HTTP admission | `apps/api-gateway` |
| Durable jobs | `packages/db` |
| Temporal client | `apps/api-gateway/src/temporal/client.ts` |
| Workflow | `apps/orchestrator/src/workflows/automatedProductDemo.ts` |
| Activities | `apps/orchestrator/src/activities/*` |
| Pipeline | `services/automated-product-demo-service/src/pipeline.ts` |
| Browser | `services/automated-product-demo-service/src/browser.ts` |
| Planner / narrator | `services/automated-product-demo-service/src/planner.ts`, `narrator.ts` |
| TTS | `services/automated-product-demo-service/src/tts.ts` |
| Media | `services/automated-product-demo-service/src/media.ts` |
| Object upload | `services/automated-product-demo-service/src/storage.ts` |
