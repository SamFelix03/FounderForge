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

const MIGRATIONS: Array<{ id: string; sql: string }> = [
  { id: "001_jobs", sql: JOBS_SQL },
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
