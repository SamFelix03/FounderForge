import pg from "pg";
import { createLogger } from "@founderforge/observability";

const log = createLogger("db.pool");

let pool: pg.Pool | undefined;

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is required for durable job storage");
  }
  return url;
}

export function createPool(connectionString = getDatabaseUrl()): pg.Pool {
  if (pool) return pool;
  pool = new pg.Pool({ connectionString, max: 10 });
  pool.on("error", (err) => {
    log.error("idle client error", { error: err.message });
  });
  return pool;
}

export function getPool(): pg.Pool {
  return createPool();
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = undefined;
}

/** Test helper: reset singleton so a new DATABASE_URL can be used. */
export async function resetPoolForTests(): Promise<void> {
  await closePool();
}
