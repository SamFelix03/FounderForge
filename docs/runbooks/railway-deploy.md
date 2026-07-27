# Railway deploy (FounderForge)

You need **4 pieces**: Railway Postgres (jobs) · Temporal · api-gateway · orchestrator.  
Supabase + vendor API keys stay external. Redis is unused — skip it.

## Exactly what to do for Temporal

Jobs Postgres ≠ Temporal. Temporal needs its own server (and usually its own DB). Pick **one**:

### Option A — Temporal Cloud (simplest ops) ✅ recommended

1. Sign up at [cloud.temporal.io](https://cloud.temporal.io), create a namespace.
2. Create an **API key**.
3. Copy the gRPC address (e.g. `us-west-2.aws.api.temporal.io:7233`) and full namespace id (`name.account`).
4. Set on **both** `api-gateway` and `orchestrator`:

```bash
TEMPORAL_ADDRESS=<region>.aws.api.temporal.io:7233
TEMPORAL_NAMESPACE=<namespace>.<account>
TEMPORAL_API_KEY=<api-key>
TEMPORAL_TLS=true
TEMPORAL_TASK_QUEUE=founderforge
```

No Temporal container on Railway. App code already supports API key + TLS via `@founderforge/temporal`.

### Option B — Self-host Temporal on Railway

1. Add a **second** Railway Postgres (or create a separate database on the jobs instance for Temporal — do **not** reuse the jobs schema).
2. New Railway service → Docker image / Dockerfile path `infra/temporal/Dockerfile` (image `temporalio/auto-setup:1.25.2`).
3. Private networking only (no public HTTP).
4. Env for the Temporal service (parse from that Postgres URL):

```bash
DB=postgres12
DB_PORT=5432
POSTGRES_USER=<user>
POSTGRES_PWD=<password>
POSTGRES_SEEDS=<host>          # e.g. postgres-xxxx.railway.internal
```

5. On **api-gateway** + **orchestrator**:

```bash
TEMPORAL_ADDRESS=temporal.railway.internal:7233   # use your Temporal service DNS
TEMPORAL_NAMESPACE=default
TEMPORAL_TASK_QUEUE=founderforge
# leave TEMPORAL_API_KEY unset (plaintext on private network)
```

6. Deploy Temporal **before** (or with) the apps so workers can connect.

---

## Railway services checklist

| # | Service | Dockerfile | Public? |
|---|---------|------------|---------|
| 1 | Postgres (jobs) | plugin | — |
| 2 | Temporal | `infra/temporal/Dockerfile` **or** Temporal Cloud | private / SaaS |
| 3 | api-gateway | `apps/api-gateway/Dockerfile` | **yes** |
| 4 | orchestrator | `apps/orchestrator/Dockerfile` | **no** |

### api-gateway

- Builder: Dockerfile at `apps/api-gateway/Dockerfile` (context = repo root).
- Health: `GET /health`
- Env: `DATABASE_URL` (jobs Postgres), `TEMPORAL_*`, `PORT`, payments (`PAYMENTS_BYPASS=false` + OKX + `PAY_TO`).

### orchestrator

- Builder: Dockerfile at `apps/orchestrator/Dockerfile` (Debian + Playwright Chromium).
- Env: same `DATABASE_URL` + `TEMPORAL_*`, plus `SUPABASE_*` and all feature API keys from `env.example`.
- Give it enough memory (Playwright / ffmpeg / long activities).

### Shared

```bash
DATABASE_URL=${{Postgres.DATABASE_URL}}   # jobs DB — both apps
TEMPORAL_TASK_QUEUE=founderforge          # must match on gateway + worker
```

---

## Local Docker smoke (optional)

```bash
# from repo root
docker build -f apps/api-gateway/Dockerfile -t ff-gateway .
docker build -f apps/orchestrator/Dockerfile -t ff-orchestrator .
docker build -f infra/temporal/Dockerfile -t ff-temporal .
```

---

## Verify

```bash
curl -s https://YOUR_GATEWAY/health
curl -i -X POST https://YOUR_GATEWAY/v1/services/competitor-research/jobs \
  -H 'content-type: application/json' \
  -d '{"input":{"product_name":"Linear","product_url":"https://linear.app"}}'
# expect 402 when PAYMENTS_BYPASS=false
```

If create returns `202` but job stays `queued`, Temporal address / worker / task queue is wrong.
