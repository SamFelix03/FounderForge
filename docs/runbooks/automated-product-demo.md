# Runbook — Automated Product Demo

Generate a narrated MP4 from `{ website_url, script }` via Firecrawl screencast + Gemini + Deepgram + ffmpeg, uploaded to Supabase.

Contract: `docs/feature-contracts/feature-automated-product-demo.md`  
Price / SLA: **$4.99 / 30 min**

---

## Prerequisites

1. Copy `env.example` → `.env` and fill:
   - `FIRECRAWL_API_KEY`, `GEMINI_API_KEY`, `DEEPGRAM_API_KEY`
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET=reports`
   - Optional: `GEMINI_TEXT_MODEL`, `DEEPGRAM_TTS_MODEL`, `REPORT_URL_TTL_SECONDS`, `DEMO_SUPABASE_OBJECT_PREFIX=demos`
   - Local: `PAYMENTS_BYPASS=true`, `DATABASE_URL`, `TEMPORAL_*`
2. From `FounderForge/`: `pnpm install` (installs Playwright Chromium via service `postinstall`)
3. Infra: `docker compose -f infra/docker/docker-compose.yml up -d` (Postgres, Redis, Temporal)
4. Migrate if needed: `pnpm --filter @founderforge/db migrate`

---

## Terminals

```bash
pnpm --filter @founderforge/api-gateway dev
pnpm --filter @founderforge/orchestrator dev
```

---

## Service-only smoke (optional)

Runs the pipeline without Temporal:

```bash
pnpm --filter @founderforge/automated-product-demo-service live -- \
  --url 'https://surveys.free/google-forms-alternative/' \
  --script 'Create a Birthday RSVP form with name, email, and attendance fields.'
```

Stdout prints the Supabase video URL when complete.

---

## Full path (gateway → Temporal → worker)

```bash
curl -s -X POST http://localhost:4021/v1/services/automated-product-demo/jobs \
  -H 'content-type: application/json' \
  -H 'x-idempotency-key: apd-1' \
  -d '{"input":{"website_url":"https://surveys.free/google-forms-alternative/","script":"Create a Birthday RSVP form…"}}'
```

Poll until `status=completed`:

```bash
curl -s http://localhost:4021/v1/jobs/<job_id>
```

Open `artifacts[0].url` (type `video`). Job `step` progresses through `plan` → `record` → `narrate` → `assemble` → `upload`.

---

## Verify cleanup

Orchestrator / service logs should show `stopInteraction` / `Closing browser session` after recording (and again in `finally`). Lingering Firecrawl browser sessions mean billing continues — treat missing close as an incident.

---

## Common failures

| Symptom | Check |
|---|---|
| 400 invalid_input | `website_url` must be a URL; `script` non-empty |
| `temporal_enqueue_failed` | Temporal up; orchestrator connected to same task queue |
| Missing API key errors | `.env` loaded by gateway + orchestrator |
| Odd-dimension ffmpeg errors | Pipeline applies `scale=trunc(iw/2)*2:…`; check ffmpeg-static installed |
| Supabase upload 4xx | Check `SUPABASE_*` (Feature 5 project); `reports` bucket exists; folder prefix `demos/` |
