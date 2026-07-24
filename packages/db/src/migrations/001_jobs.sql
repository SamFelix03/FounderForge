-- FounderForge application jobs (separate from Temporal system DBs on same Postgres)
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY,
  service TEXT NOT NULL,
  status TEXT NOT NULL,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  artifacts JSONB NOT NULL DEFAULT '[]'::jsonb,
  cost_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
  list_price_usd DOUBLE PRECISION NOT NULL,
  error TEXT,
  callback_url TEXT,
  idempotency_key TEXT,
  eta_seconds INTEGER,
  step TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS jobs_service_idempotency_uidx
  ON jobs (service, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status);
CREATE INDEX IF NOT EXISTS jobs_created_at_idx ON jobs (created_at DESC);
