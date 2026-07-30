import type { Pool } from "pg";
import { createLogger } from "@founderforge/observability";

const log = createLogger("db.migrate");

const JOBS_SQL = `
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
`;

const MARKETPLACE_DISPATCH_SQL = `
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
`;

const MIGRATIONS: Array<{ id: string; sql: string }> = [
  { id: "001_jobs", sql: JOBS_SQL },
  { id: "002_marketplace_dispatch", sql: MARKETPLACE_DISPATCH_SQL },
];

export async function migrate(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  for (const { id, sql } of MIGRATIONS) {
    const existing = await pool.query(`SELECT 1 FROM schema_migrations WHERE id = $1`, [id]);
    if (existing.rowCount) continue;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (id) VALUES ($1)`, [id]);
      await client.query("COMMIT");
      log.info("applied migration", { id });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
