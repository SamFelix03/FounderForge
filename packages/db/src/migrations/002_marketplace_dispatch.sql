-- Dispatch tracking + marketplace correlation for A2MCP / OKX bridge
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS marketplace_job_id TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS marketplace_agent_id TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS workflow_id TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS dispatch_error TEXT;

CREATE INDEX IF NOT EXISTS jobs_marketplace_job_id_idx
  ON jobs (marketplace_job_id)
  WHERE marketplace_job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS jobs_queued_created_at_idx
  ON jobs (created_at)
  WHERE status = 'queued';

CREATE TABLE IF NOT EXISTS marketplace_links (
  okx_job_id TEXT PRIMARY KEY,
  founderforge_job_id UUID NOT NULL REFERENCES jobs(id),
  asp_agent_id TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'pending',
  delivery_attempts INTEGER NOT NULL DEFAULT 0,
  last_delivery_error TEXT,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS marketplace_links_ff_job_idx
  ON marketplace_links (founderforge_job_id);

CREATE INDEX IF NOT EXISTS marketplace_links_delivery_status_idx
  ON marketplace_links (delivery_status);
