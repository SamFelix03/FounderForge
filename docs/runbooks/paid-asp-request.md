# Paid ASP request → final artifact (FounderForge)

How a buyer pays for a FounderForge A2MCP service via the **OKX Agent Payments Protocol** (x402 v2), then retrieves the finished job output.

Verified in production against:

- Gateway: `https://founderforge-api-production.up.railway.app`
- Service: `social-listening` (1 USD₮0 on X Layer testnet)
- Stack: Agentic Wallet (`onchainos`) + OKX seller middleware on `api-gateway`

Related: [ASP onboarding](../planning/asp-onboarding.md) · [Pricing](../pricing/pricing.md) · [Railway deploy](./railway-deploy.md)

---

## End-to-end picture

```text
Buyer                         FounderForge                         Chain / OKX
  │                                │                                    │
  │ 1. POST /v1/services/.../jobs  │                                    │
  │    (no payment header)         │                                    │
  │───────────────────────────────▶│                                    │
  │                                │ OKX middleware: no proof           │
  │◀──────── HTTP 402 ─────────────│                                    │
  │   PAYMENT-REQUIRED (base64)    │                                    │
  │                                │                                    │
  │ 2. Sign challenge (Agentic     │                                    │
  │    Wallet / onchainos TEE)     │                                    │
  │────────────────────────────────┼───────────────────────────────────▶│
  │                                │         settle USD₮0 (exact)       │
  │                                │                                    │
  │ 3. POST same URL + body        │                                    │
  │    + PAYMENT-SIGNATURE         │                                    │
  │───────────────────────────────▶│ verify + settle via facilitator    │
  │                                │───────────────────▶│               │
  │◀──────── HTTP 202 ─────────────│◀──────────────────│               │
  │   job_id + PAYMENT-RESPONSE    │ enqueue Temporal workflow          │
  │                                │                                    │
  │ 4. GET /v1/jobs/{job_id}       │                                    │
  │    (poll until completed)      │                                    │
  │───────────────────────────────▶│                                    │
  │◀── artifacts[] (signed URLs) ──│                                    │
```

**Important:** Payment unlocks **job creation** only. Delivery is asynchronous. Free routes (`GET /health`, `GET /v1/services`, `GET /v1/jobs/:id`) stay unpaid.

---

## Roles and wallets

| Role | What it is | Env / tool |
|---|---|---|
| **Seller (ASP)** | Receives USD₮0 | Gateway: `PAY_TO` (EVM `0x…`), `OKX_*` keys, `NETWORK`, `PAYMENTS_BYPASS=false` |
| **Buyer** | Pays the challenge | OKX Agentic Wallet via `onchainos` CLI (or any x402 buyer that can sign `exact`) |

- `PAY_TO` must be an **EVM address**, never an Agentic Wallet / ASP id (`XKO…`).
- Testnet: `NETWORK=eip155:1952` (X Layer testnet). Mainnet: `eip155:196`.
- Fund the **buyer** with test USD₮0 (+ native if needed) from the [X Layer faucet](https://www.okx.com/xlayer/faucet/xlayerfaucet).
- Seller and buyer can be the same EVM address for self-tests (as in the verified run).

List prices live in `packages/schemas/src/index.ts` (`SERVICE_MANIFESTS`) and drive OKX route amounts (e.g. `"$1.00"` → `1000000` atomic units at 6 decimals).

---

## Prerequisites

### Seller (already deployed)

```bash
PAYMENTS_BYPASS=false
OKX_API_KEY=...
OKX_SECRET_KEY=...
OKX_PASSPHRASE=...
PAY_TO=0x...                 # EVM receive address
NETWORK=eip155:1952          # or eip155:196
```

Sanity check (must be **402**, not 202):

```bash
curl -i -X POST https://founderforge-api-production.up.railway.app/v1/services/social-listening/jobs \
  -H 'content-type: application/json' \
  -H 'accept: application/json' \
  -d '{"input":{"product_url":"https://linear.app","max_posts":2}}'
```

Expect:

```http
HTTP/2 402
payment-required: eyJ4NDAyVmVyc2lvbiI6Miwi...
```

Decoded challenge shape (example):

```json
{
  "x402Version": 2,
  "error": "Payment required",
  "resource": {
    "url": "http://founderforge-api-production.up.railway.app/v1/services/social-listening/jobs",
    "description": "A2MCP job create for social-listening",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:1952",
      "amount": "1000000",
      "asset": "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c",
      "payTo": "0x800657b40b5ac9fd327bec09eb2b974d5f136350",
      "maxTimeoutSeconds": 600,
      "extra": { "name": "USD₮0", "version": "1" }
    }
  ]
}
```

### Buyer tooling

```bash
# Skills (agent) + CLI binary
npx skills add okx/onchainos-skills --yes -g
curl -sSL https://raw.githubusercontent.com/okx/onchainos-skills/main/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"

onchainos preflight --skill-version 4.4.0
onchainos wallet status
# If not logged in:
onchainos wallet login --phase init
# Complete browser social login, then:
onchainos wallet login --phase poll --session-id <authSessionId>
```

Confirm testnet USD₮0 balance (example):

```bash
onchainos wallet balance --chain 1952
```

---

## Step-by-step: paid create → completed job

FounderForge create-job bodies are nested JSON:

```json
{ "input": { "...service fields..." } }
```

The `onchainos payment quote` / `pay --payment-id` auto-replay path currently stringifies nested `--param input=...` and the gateway responds `400 invalid_body` (`Expected object, received string`).  
**Use the sign-then-manual-replay path below** (verified working).

### 1. Probe unpaid → capture `PAYMENT-REQUIRED`

```bash
BASE=https://founderforge-api-production.up.railway.app
PATH_URL=/v1/services/social-listening/jobs
BODY='{"input":{"product_url":"https://linear.app","max_posts":2}}'

HDR=$(curl -sS -D - -o /dev/null -X POST "$BASE$PATH_URL" \
  -H 'content-type: application/json' \
  -H 'accept: application/json' \
  -d "$BODY" \
  | awk -F': ' 'BEGIN{IGNORECASE=1} tolower($1)=="payment-required"{print $2; exit}' \
  | tr -d '\r')

echo "$HDR" | base64 -d | jq .
```

### 2. Sign the challenge (Agentic Wallet / TEE)

```bash
SIGN_JSON=$(onchainos payment pay \
  --payload "$HDR" \
  --selected-index 0 \
  --yes)

AUTH=$(echo "$SIGN_JSON" | jq -r '.data.authorization_header')
HEADER_NAME=$(echo "$SIGN_JSON" | jq -r '.data.header_name')
# HEADER_NAME is PAYMENT-SIGNATURE for x402 v2
```

Do **not** hand-assemble the signature. The CLI returns the ready-to-send header value.

### 3. Replay with payment proof + correct JSON body

```bash
RESP=$(curl -sS -i -X POST "$BASE$PATH_URL" \
  -H 'content-type: application/json' \
  -H 'accept: application/json' \
  -H "$HEADER_NAME: $AUTH" \
  -d "$BODY")

echo "$RESP" | head -40
```

Success looks like:

```http
HTTP/2 202
payment-response: eyJ...
content-type: application/json

{
  "job_id": "f57687a0-6cc3-43d5-8511-91e8f4444fa2",
  "list_price_usd": 1,
  "eta_seconds": 900,
  "status_url": "/v1/jobs/f57687a0-6cc3-43d5-8511-91e8f4444fa2",
  "status": "queued"
}
```

Decode settlement proof:

```bash
echo '<payment-response value>' | base64 -d | jq .
```

Example (verified):

```json
{
  "network": "eip155:1952",
  "payer": "0x800657b40b5ac9fd327bec09eb2b974d5f136350",
  "status": "success",
  "success": true,
  "transaction": "0xb2e45484d3b814f3708f70d5915b34744b05fdffc447fcc21bc3aabe75c55cc7"
}
```

If you get **402** again: signature expired or mismatched resource — capture a **fresh** `PAYMENT-REQUIRED` and re-sign (do not reuse an old header).

If you get **400** `invalid_body`: body shape wrong (often `input` sent as a string).

### 4. Poll until the pipeline finishes

```bash
JOB_ID=<job_id from step 3>

while true; do
  curl -sS "$BASE/v1/jobs/$JOB_ID" | jq '{status, step, error, artifacts}'
  # break when status is completed | failed | cancelled
  sleep 8
done
```

Job lifecycle:

| `status` | Meaning |
|---|---|
| `queued` | Accepted; waiting for Temporal worker |
| `running` | Orchestrator activity in progress (`step` updates) |
| `completed` | Artifacts ready |
| `failed` | See `error` |

`GET /v1/jobs/:id` does **not** require payment.

### 5. Read the final output

Completed payload (shape shared across services):

```json
{
  "status": "completed",
  "step": "done",
  "error": null,
  "artifacts": [
    {
      "type": "pdf_report",
      "url": "https://….supabase.co/storage/v1/object/sign/reports/…",
      "mime_type": "application/pdf",
      "object_key": "reddit/….pdf"
    }
  ],
  "cost_breakdown": [
    { "vendor": "llm", "operation": "discover_product", "amount_usd": 0.02 }
  ]
}
```

- **Client deliverable** = `artifacts[].url` (usually a **signed Supabase** URL under bucket `reports/`, or a vendor URL e.g. Segmind for promo-video).
- `cost_breakdown` is internal COGS-ish telemetry, not the A2MCP list price.
- List price charged on-chain is `list_price_usd` from the create response / `SERVICE_MANIFESTS`.

---

## Per-service create bodies

All paid creates are:

`POST /v1/services/<name>/jobs` with `{ "input": { ... } }`.

| Service | Price | Example `input` | Typical artifact `type` |
|---|---|---|---|
| `social-listening` | $1.00 | `{ "product_url": "https://…", "max_posts": 2 }` | `pdf_report`, `reddit_thread` |
| `competitor-research` | $1.00 | `{ "product_name": "Linear", "product_url": "https://linear.app" }` | `report_pdf` |
| `brand-kit` | $1.49 | `{ "brand_name": "Acme", "description": "…" }` | `brand_kit_zip` |
| `promo-video` | $2.99 | `{ "product_url": "https://…", "duration": 15, "resolution": "720p" }` | `video` |
| `automated-product-demo` | $1.49 | `{ "website_url": "https://…", "script": "…" }` | demo video URL |
| `outreach` | $1.00 | `{ "website_url": "https://…", "sheet_url": "https://….xlsx" }` | investor PDF |

Catalog / discovery (unpaid): `GET /v1/discovery` (alias: `GET /v1/services`) — full Pattern A protocol, JSON Schemas, examples, and artifact rules.

---

## What happens inside FounderForge after a paid 202

1. **api-gateway** OKX middleware verifies `PAYMENT-SIGNATURE`, settles via OKX facilitator (`syncSettle` default on).
2. Gateway writes a job row to **Postgres** (`DATABASE_URL`) and starts a **Temporal** workflow on task queue `founderforge`.
3. **orchestrator** worker runs the service pipeline (LLM / search / Playwright / etc.).
4. Final binary lands in **Supabase Storage** (or external CDN); job row gets `artifacts` + `status=completed`.
5. Buyer polls `GET /v1/jobs/:id` and downloads `artifacts[].url`.

If create returns 202 but status stays `queued`, Temporal address / worker / task queue is misconfigured — payment already succeeded.

---

## Optional: quote → pay CLI path

When nested body handling works for your CLI version:

```bash
onchainos payment quote "$BASE$PATH_URL" \
  --method POST \
  --param 'input={"product_url":"https://linear.app","max_posts":2}'

# Review summary / candidates, then:
onchainos payment pay --payment-id <id> --selected-index 0 --yes
```

If replay returns `400` with `input` as string, fall back to **sign (`--payload`) + manual curl replay** (section above).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Create returns **202** with no payment | `PAYMENTS_BYPASS=true` | Set `false`, redeploy gateway |
| Create returns **402** forever after “paying” | Missing / wrong `PAYMENT-SIGNATURE`, or stale challenge | Fresh challenge → re-sign → replay same body |
| **400** `Expected object, received string` | Nested `input` flattened to string by buyer CLI | Manual JSON body replay |
| **402** after valid-looking header | Expired `validBefore`, wrong `payTo` / network / amount | New challenge; confirm buyer network matches `eip155:1952` |
| Job `queued` forever | Orchestrator / Temporal down | Check worker logs; `TEMPORAL_*` on both services |
| Job `failed` | Pipeline / vendor key error | Read `error` on job; check orchestrator env (Groq, Tavily, Supabase, …) |
| `PAY_TO` startup crash | Non-EVM id (`XKO…`) | Use `0x` + 40 hex |

---

## Verified production example (reference)

| Field | Value |
|---|---|
| Endpoint | `POST …/v1/services/social-listening/jobs` |
| Unpaid | `HTTP 402` + `PAYMENT-REQUIRED` |
| Paid | `HTTP 202` + `PAYMENT-RESPONSE` (`status: success`) |
| Tx | `0xb2e45484d3b814f3708f70d5915b34744b05fdffc447fcc21bc3aabe75c55cc7` |
| Job | `f57687a0-6cc3-43d5-8511-91e8f4444fa2` → `completed` |
| Output | Signed PDF under `reports/reddit/…` + Reddit thread URLs |

That run confirms the full ASP loop: **challenge → Agentic Wallet signature → settlement → async job → downloadable artifacts**.
