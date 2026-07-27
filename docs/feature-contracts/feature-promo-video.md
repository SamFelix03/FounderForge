# Feature — Promo Video (Production)

Paid A2MCP service: `POST /v1/services/promo-video/jobs` → Temporal workflow → **Segmind-hosted MP4 URL** (images only uploaded to Supabase).

List price: **$2.99** per call (see `docs/pricing/pricing.md`). Settlement via OKX Payment SDK when `PAYMENTS_BYPASS=false`.

**Defaults:** `duration` **15**, `resolution` **720p**, `max_pages` **6**. Screenshots are viewport-only (above-the-fold).

**Runtime requirements:** Postgres (`DATABASE_URL`), Temporal (`TEMPORAL_ADDRESS`), orchestrator worker, Firecrawl, Gemini, Segmind Seedance, shared Supabase Storage for **reference images** (`SUPABASE_*` + `PROMO_SUPABASE_OBJECT_PREFIX=images`).

---

## Sample input

```json
{
  "input": {
    "product_url": "https://surveys.free/google-forms-alternative/",
    "duration": 15,
    "resolution": "720p",
    "max_pages": 6
  },
  "callback_url": "https://example.com/webhooks/founderforge",
  "priority": "normal"
}
```

| Field | Required | Notes |
|---|---|---|
| `input.product_url` | yes | Product site to promo |
| `input.duration` | no | Seedance: 4 \| 5 \| 6 \| 8 \| 10 \| 12 \| **15** (default) |
| `input.resolution` | no | 480p \| **720p** (default) \| 1080p \| 4k |
| `input.max_pages` | no | 1–9 screenshots (default 6) |

**Input schema (code):** `PromoVideoInputSchema` in `packages/schemas`.

---

## Expected output

### Immediate create response (`202 Accepted`)

```json
{
  "job_id": "9f3c2a1b-…",
  "list_price_usd": 2.99,
  "eta_seconds": 900,
  "status_url": "/v1/jobs/9f3c2a1b-…",
  "status": "queued"
}
```

### Completed job (`GET /v1/jobs/{job_id}`)

```json
{
  "id": "9f3c2a1b-…",
  "service": "promo-video",
  "status": "completed",
  "artifacts": [
    {
      "type": "video",
      "url": "https://images.segmind.com/….mp4",
      "mime_type": "video/mp4"
    }
  ],
  "cost_breakdown": [
    { "vendor": "firecrawl", "operation": "map", "amount_usd": 0.02 },
    { "vendor": "llm", "operation": "script", "amount_usd": 0.02 },
    { "vendor": "segmind", "operation": "seedance", "amount_usd": 0.4 }
  ]
}
```

**Artifact rule:** final MP4 is **never** uploaded to Supabase. Job artifact `url` is the Segmind CDN URL.

---

## Pipeline phases

| Phase | Module | Does |
|---|---|---|
| discover | `discover.ts` | Firecrawl map + Gemini rank important pages |
| screenshots | `screenshots.ts` | Viewport (1440×900) Firecrawl captures |
| upload_images | `storage.ts` | Upload PNGs to `reports/images/` |
| script | `script.ts` | Multimodal Gemini → Seedance prompt + VO |
| video | `video.ts` | Segmind Seedance 2.0 submit + poll |

---

## Live CLI smoke test

```bash
pnpm --filter @founderforge/promo-video-service live -- \
  --url https://surveys.free/google-forms-alternative/ \
  --duration 15 \
  --resolution 720p
```

Expect stdout with a Segmind `https://images.segmind.com/...mp4`. Do **not** pass `--resume` for a fresh run.

### Env keys

| Key | Role |
|---|---|
| `FIRECRAWL_API_KEY` | Map + viewport screenshots |
| `GEMINI_API_KEY` / `GEMINI_TEXT_MODEL` | Rank pages + killer script |
| `SEGMIND_API_KEY` | Seedance 2.0 |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Shared Feature 5 Storage |
| `SUPABASE_STORAGE_BUCKET` | Default `reports` |
| `PROMO_SUPABASE_OBJECT_PREFIX` | Default `images` |

---

## Code map

| Area | Path |
|---|---|
| Schema | `packages/schemas` → `PromoVideoInputSchema` |
| Pipeline | `services/promo-video-service/src/pipeline.ts` |
| Workflow | `apps/orchestrator/src/workflows/promoVideo.ts` |
| Activity | `apps/orchestrator/src/activities/promoVideo.ts` |
| Gateway | `apps/api-gateway` validate / dispatch / `startPromoVideoWorkflow` |
