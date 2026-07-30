# Marketplace bridge on Railway (onchainos + deliver)

The bridge is what moves OKX marketplace tasks from **`accepted` → `submitted`** after FounderForge jobs finish (or fail). It runs `onchainos agent deliver` for ASP `#9733`.

Gateway + orchestrator stay on Railway as today. This service adds:

- Linux `onchainos` CLI (file-keyring fallback — works without Docker `seccomp=unconfined`)
- Persistent `ONCHAINOS_HOME` volume for wallet session
- Poll loop + correlation + deliver

## 1. Create the Railway service

In the **same project** as jobs Postgres + api-gateway:

1. **New Service** → Deploy from GitHub repo `FounderForge`.
2. Settings → Build:
   - Builder: **Dockerfile**
   - Dockerfile path: `apps/marketplace-bridge/Dockerfile`
   - Root directory: `/` (monorepo root)
3. Networking: **no public domain required** (optional health on `$PORT`).
4. **Volume**: mount a volume at `/data/onchainos` (must survive redeploys).

## 2. Environment variables

| Variable | Required | Example / notes |
|---|---|---|
| `DATABASE_URL` | **yes** | `${{Postgres.DATABASE_URL}}` — same DB as gateway |
| `FOUNDERFORGE_API_BASE` | **yes** | `https://founderforge-api-production.up.railway.app` |
| `ASP_AGENT_ID` | yes | `9733` |
| `ONCHAINOS_HOME` | yes | `/data/onchainos` (must match volume mount) |
| `ONCHAINOS` | no | `onchainos` (baked into image) |
| `BRIDGE_POLL_INTERVAL_MS` | no | `20000` |
| `BRIDGE_DRY_RUN` | no | `1` for first smoke (no real deliver) |
| `BRIDGE_REQUIRE_WALLET` | no | `0` until login succeeds, then set `1` |
| `BRIDGE_HEALTH_PORT` | no | defaults to Railway `PORT` |
| `OKX_API_KEY` / `OKX_SECRET_KEY` / `OKX_PASSPHRASE` | recommended | same seller keys as gateway (market data / some CLI paths) |
| `ONCHAINOS_SESSION_ARCHIVE_B64` | optional | only if restoring a session tarball (often fails across machines — prefer live login) |

Copy from gateway if useful:

```bash
DATABASE_URL=${{Postgres.DATABASE_URL}}
FOUNDERFORGE_API_BASE=https://founderforge-api-production.up.railway.app
ASP_AGENT_ID=9733
ONCHAINOS_HOME=/data/onchainos
BRIDGE_REQUIRE_WALLET=0
BRIDGE_DRY_RUN=1
```

## 3. One-time wallet login (required)

Agentic Wallet login is browser-based. Do it **inside** the Railway container so `keyring.enc` binds to that machine identity:

```bash
# Railway dashboard → marketplace-bridge → Shell
ff-onchainos-login
```

1. Copy the printed URL.
2. Open it on your laptop; finish Google / Apple / Email login with the **ASP wallet that owns agent #9733**.
3. Wait for poll to succeed (`onchainos wallet status` → `ok: true`).
4. Redeploy or restart the service.
5. Set `BRIDGE_REQUIRE_WALLET=1` and `BRIDGE_DRY_RUN=0`.

Session files live on the volume under `/data/onchainos` (`session.json`, `keyring.enc`, `machine-identity`, `wallets.json`).

## 4. Verify

```bash
# Health (if PORT assigned)
curl -s https://<bridge-or-internal>/   # {"ok":true,"service":"marketplace-bridge"}

# In shell:
onchainos --version
onchainos wallet status
# Logs should show: bridge tick { accepted: N }
```

End-to-end: pay a social-listening job that is also an OKX marketplace task → FF reaches `completed|failed` → bridge calls `deliver` → on-chain status becomes `submitted`.

## 5. Ops notes

- **Redeploys**: keep the volume. Re-login only if `wallet status` fails.
- **Keyring**: onchainos ≥4.x uses encrypted **file** fallback when Linux keyutils/`add_key` is blocked (Railway). That is why this works without privileged/seccomp.
- **Do not** copy `keyring.enc` from your Mac into Railway expecting it to work — it is machine-bound. Login on Railway instead.
- **okx-a2a** is installed in the image for CLI companion commands; `agent deliver` uses the wallet session, not the A2A daemon.
- Local export helper (last resort): `scripts/export-onchainos-session.sh` → `ONCHAINOS_SESSION_ARCHIVE_B64`.

## Architecture

```text
Buyer x402 pay → api-gateway 202 → Temporal/orchestrator → job completed|failed
                                         ↑
OKX accepted task ── marketplace-bridge ─┴── onchainos agent deliver → submitted
```
