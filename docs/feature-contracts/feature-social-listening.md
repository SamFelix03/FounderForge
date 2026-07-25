# Feature — Social Listening (Reddit engagement)

Paid A2MCP service: `POST /v1/services/social-listening/jobs` → Temporal workflow → **posted Reddit comment URLs**.

List price: **$1.99** per call (see `docs/pricing/pricing.md`). Settlement via OKX Payment SDK when `PAYMENTS_BYPASS=false`.

**Defaults:** `live` **false** (dry-run drafts only), `max_posts` from product discovery (capped).

**Runtime requirements:** Postgres (`DATABASE_URL` for job store), Temporal, orchestrator worker, Groq keys, Reddit session (`token_v2` / Playwright profile), and for live posts: `RAPIDAPI_KEY` + `REDDAPI_PROXY`.

---

## Sample input

```json
{
  "input": {
    "product_url": "https://example.com/product",
    "live": false,
    "max_posts": 3
  },
  "callback_url": "https://example.com/webhooks/founderforge",
  "priority": "normal"
}
```

| Field | Required | Notes |
|---|---|---|
| `input.product_url` | yes | Product site to research + engage around |
| `input.live` | no | `false` = dry-run (default); `true` = post via ReddAPI |
| `input.max_posts` | no | Cap selected posts this job (1–20) |

**Input schema (code):** `SocialListeningInputSchema` in `packages/schemas`.

---

## Expected output

### Immediate create response (`202 Accepted`)

```json
{
  "job_id": "9f3c2a1b-…",
  "list_price_usd": 1.99,
  "eta_seconds": 600,
  "status_url": "/v1/jobs/9f3c2a1b-…",
  "status": "queued"
}
```

### Completed job (`GET /v1/jobs/{job_id}`)

```json
{
  "id": "9f3c2a1b-…",
  "service": "social-listening",
  "status": "completed",
  "artifacts": [
    {
      "type": "reddit_comment",
      "url": "https://www.reddit.com/r/…/comments/…/",
      "mime_type": "text/uri-list"
    }
  ],
  "cost_breakdown": [
    { "vendor": "llm", "operation": "discover_product", "amount_usd": 0.02 },
    { "vendor": "llm", "operation": "score_draft", "amount_usd": 0.05 },
    { "vendor": "reddapi", "operation": "comment", "amount_usd": 0.01 }
  ]
}
```

**Artifact rule:** each successful post (or dry-run target URL) is an artifact. Prefer live result permalinks when `live: true`.

---

## Pipeline phases

1. **discover_product** — scrape/LLM profile from `product_url`
2. **discover_threads** — Groq Compound Reddit search across target subreddits
3. **fetch_content** — Playwright session fetch of thread `.json`
4. **score_draft** — prefilter → embeddings → score → draft → compliance
5. **post** — ReddAPI comment (preferred) or Playwright fallback / dry-run

---

## Auth / ops notes

- Run Reddit session setup so `token_v2` + `.reddit-profile` exist on the orchestrator host.
- Live posting requires RapidAPI ReddAPI credentials and a residential/datacenter proxy (`REDDAPI_PROXY`).
- Default dry-run is safe for CI and demos; set `live: true` only with a test Reddit account.
