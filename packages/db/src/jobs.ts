import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  SERVICE_MANIFESTS,
  decodeJobError,
  type CreateJobRequest,
  type JobArtifact,
  type JobRecord,
  type JobStatus,
  type CostLine,
  type ServiceName,
} from "@founderforge/schemas";
import { getPool } from "./pool.js";

interface JobRow {
  id: string;
  service: ServiceName;
  status: JobStatus;
  input: Record<string, unknown>;
  artifacts: JobArtifact[];
  cost_breakdown: CostLine[];
  list_price_usd: number;
  error: string | null;
  callback_url: string | null;
  idempotency_key: string | null;
  eta_seconds: number | null;
  step: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToJob(row: JobRow): JobRecord & { step?: string } {
  const decoded = decodeJobError(row.error);
  return {
    id: row.id,
    service: row.service,
    status: row.status,
    input: row.input ?? {},
    artifacts: row.artifacts ?? [],
    cost_breakdown: row.cost_breakdown ?? [],
    list_price_usd: Number(row.list_price_usd),
    error: decoded.error,
    ...(decoded.error_code ? { error_code: decoded.error_code } : {}),
    callback_url: row.callback_url ?? undefined,
    idempotency_key: row.idempotency_key ?? undefined,
    eta_seconds: row.eta_seconds ?? undefined,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    ...(row.step ? { step: row.step } : {}),
  };
}

export class PostgresJobStore {
  constructor(private readonly pool: Pool = getPool()) {}

  async create(
    service: ServiceName,
    req: CreateJobRequest,
    idempotencyKey?: string,
  ): Promise<JobRecord> {
    if (idempotencyKey) {
      const existing = await this.pool.query<JobRow>(
        `SELECT * FROM jobs WHERE service = $1 AND idempotency_key = $2 LIMIT 1`,
        [service, idempotencyKey],
      );
      if (existing.rows[0]) return rowToJob(existing.rows[0]);
    }

    const manifest = SERVICE_MANIFESTS[service];
    const id = randomUUID();
    const result = await this.pool.query<JobRow>(
      `INSERT INTO jobs (
        id, service, status, input, artifacts, cost_breakdown,
        list_price_usd, callback_url, idempotency_key, eta_seconds
      ) VALUES (
        $1, $2, 'queued', $3::jsonb, '[]'::jsonb, '[]'::jsonb,
        $4, $5, $6, $7
      )
      RETURNING *`,
      [
        id,
        service,
        JSON.stringify(req.input),
        manifest.a2mcp_price_usd,
        req.callback_url ?? null,
        idempotencyKey ?? null,
        manifest.sla_minutes * 60,
      ],
    );
    return rowToJob(result.rows[0]!);
  }

  async get(id: string): Promise<JobRecord | undefined> {
    const result = await this.pool.query<JobRow>(`SELECT * FROM jobs WHERE id = $1`, [id]);
    const row = result.rows[0];
    return row ? rowToJob(row) : undefined;
  }

  async update(
    id: string,
    patch: Partial<
      Pick<JobRecord, "status" | "artifacts" | "cost_breakdown">
    > & { error?: string | null; step?: string | null },
  ): Promise<JobRecord> {
    const current = await this.get(id);
    if (!current) throw new Error(`job not found: ${id}`);

    const nextStatus = patch.status ?? current.status;
    const nextArtifacts = patch.artifacts ?? current.artifacts;
    const nextCosts = patch.cost_breakdown ?? current.cost_breakdown;
    const nextError =
      patch.error === null
        ? undefined
        : patch.error !== undefined
          ? patch.error
          : current.error;
    const nextStep =
      patch.step !== undefined ? patch.step : (current as JobRecord & { step?: string }).step;

    const result = await this.pool.query<JobRow>(
      `UPDATE jobs SET
        status = $2,
        artifacts = $3::jsonb,
        cost_breakdown = $4::jsonb,
        error = $5,
        step = $6,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
      [
        id,
        nextStatus,
        JSON.stringify(nextArtifacts),
        JSON.stringify(nextCosts),
        nextError ?? null,
        nextStep ?? null,
      ],
    );
    return rowToJob(result.rows[0]!);
  }

  async setStatus(id: string, status: JobStatus, error?: string): Promise<JobRecord> {
    return this.update(id, { status, error });
  }

  async setStep(id: string, step: string): Promise<JobRecord> {
    return this.update(id, { step });
  }

  async list(): Promise<JobRecord[]> {
    const result = await this.pool.query<JobRow>(
      `SELECT * FROM jobs ORDER BY created_at DESC LIMIT 500`,
    );
    return result.rows.map(rowToJob);
  }
}

let defaultStore: PostgresJobStore | undefined;

export function getJobStore(): PostgresJobStore {
  if (!defaultStore) defaultStore = new PostgresJobStore();
  return defaultStore;
}

export function setJobStoreForTests(store: PostgresJobStore | undefined): void {
  defaultStore = store;
}
