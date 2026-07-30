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
  marketplace_job_id: string | null;
  marketplace_agent_id: string | null;
  workflow_id: string | null;
  dispatched_at: Date | null;
  dispatch_error: string | null;
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
    ...(row.marketplace_job_id ? { marketplace_job_id: row.marketplace_job_id } : {}),
    ...(row.marketplace_agent_id
      ? { marketplace_agent_id: row.marketplace_agent_id }
      : {}),
    ...(row.workflow_id ? { workflow_id: row.workflow_id } : {}),
    ...(row.dispatched_at
      ? { dispatched_at: row.dispatched_at.toISOString() }
      : {}),
    ...(row.dispatch_error ? { dispatch_error: row.dispatch_error } : {}),
    eta_seconds: row.eta_seconds ?? undefined,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    ...(row.step ? { step: row.step } : {}),
  };
}

export type CreateJobOptions = {
  marketplace_job_id?: string;
  marketplace_agent_id?: string;
};

export class PostgresJobStore {
  constructor(private readonly pool: Pool = getPool()) {}

  async create(
    service: ServiceName,
    req: CreateJobRequest,
    idempotencyKey?: string,
    opts: CreateJobOptions = {},
  ): Promise<JobRecord> {
    if (idempotencyKey) {
      const existing = await this.pool.query<JobRow>(
        `SELECT * FROM jobs WHERE service = $1 AND idempotency_key = $2 LIMIT 1`,
        [service, idempotencyKey],
      );
      if (existing.rows[0]) return rowToJob(existing.rows[0]);
    }

    const marketplaceJobId =
      opts.marketplace_job_id ?? req.marketplace?.job_id ?? null;
    const marketplaceAgentId =
      opts.marketplace_agent_id ?? req.marketplace?.agent_id ?? null;

    const manifest = SERVICE_MANIFESTS[service];
    const id = randomUUID();
    const result = await this.pool.query<JobRow>(
      `INSERT INTO jobs (
        id, service, status, input, artifacts, cost_breakdown,
        list_price_usd, callback_url, idempotency_key, eta_seconds,
        marketplace_job_id, marketplace_agent_id
      ) VALUES (
        $1, $2, 'queued', $3::jsonb, '[]'::jsonb, '[]'::jsonb,
        $4, $5, $6, $7, $8, $9
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
        marketplaceJobId,
        marketplaceAgentId,
      ],
    );
    return rowToJob(result.rows[0]!);
  }

  async get(id: string): Promise<(JobRecord & { step?: string }) | undefined> {
    const result = await this.pool.query<JobRow>(`SELECT * FROM jobs WHERE id = $1`, [id]);
    const row = result.rows[0];
    return row ? rowToJob(row) : undefined;
  }

  async getByMarketplaceJobId(
    marketplaceJobId: string,
  ): Promise<(JobRecord & { step?: string }) | undefined> {
    const result = await this.pool.query<JobRow>(
      `SELECT * FROM jobs WHERE marketplace_job_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [marketplaceJobId],
    );
    const row = result.rows[0];
    return row ? rowToJob(row) : undefined;
  }

  async findRecentByProductUrl(opts: {
    service: ServiceName;
    productUrl: string;
    withinMs?: number;
  }): Promise<(JobRecord & { step?: string }) | undefined> {
    const withinMs = opts.withinMs ?? 2 * 60 * 60 * 1000;
    const result = await this.pool.query<JobRow>(
      `SELECT * FROM jobs
       WHERE service = $1
         AND created_at >= NOW() - ($2::bigint * INTERVAL '1 millisecond')
         AND (
           input->>'product_url' = $3
           OR input->>'website_url' = $3
         )
       ORDER BY created_at DESC
       LIMIT 1`,
      [opts.service, withinMs, opts.productUrl],
    );
    const row = result.rows[0];
    return row ? rowToJob(row) : undefined;
  }

  async update(
    id: string,
    patch: Partial<
      Pick<
        JobRecord,
        | "status"
        | "artifacts"
        | "cost_breakdown"
        | "workflow_id"
        | "marketplace_job_id"
        | "marketplace_agent_id"
      >
    > & {
      error?: string | null;
      step?: string | null;
      dispatched_at?: string | null;
      dispatch_error?: string | null;
    },
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
    const nextWorkflowId =
      patch.workflow_id !== undefined ? patch.workflow_id : current.workflow_id;
    const nextDispatchError =
      patch.dispatch_error === null
        ? null
        : patch.dispatch_error !== undefined
          ? patch.dispatch_error
          : (current.dispatch_error ?? null);
    const nextDispatchedAt =
      patch.dispatched_at === null
        ? null
        : patch.dispatched_at !== undefined
          ? patch.dispatched_at
          : current.dispatched_at;
    const nextMarketplaceJobId =
      patch.marketplace_job_id !== undefined
        ? patch.marketplace_job_id
        : current.marketplace_job_id;
    const nextMarketplaceAgentId =
      patch.marketplace_agent_id !== undefined
        ? patch.marketplace_agent_id
        : current.marketplace_agent_id;

    const result = await this.pool.query<JobRow>(
      `UPDATE jobs SET
        status = $2,
        artifacts = $3::jsonb,
        cost_breakdown = $4::jsonb,
        error = $5,
        step = $6,
        workflow_id = $7,
        dispatched_at = $8,
        dispatch_error = $9,
        marketplace_job_id = $10,
        marketplace_agent_id = $11,
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
        nextWorkflowId ?? null,
        nextDispatchedAt ?? null,
        nextDispatchError,
        nextMarketplaceJobId ?? null,
        nextMarketplaceAgentId ?? null,
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

  async markDispatched(
    id: string,
    workflowId: string,
  ): Promise<JobRecord> {
    return this.update(id, {
      workflow_id: workflowId,
      dispatched_at: new Date().toISOString(),
      dispatch_error: null,
    });
  }

  async markDispatchFailed(id: string, error: string): Promise<JobRecord> {
    return this.update(id, {
      status: "failed",
      error: `temporal_enqueue_failed:${error}`,
      dispatch_error: error,
    });
  }

  /** Queued jobs that never got a successful Temporal start (or are stale). */
  async listStaleQueued(olderThanMs = 30_000): Promise<Array<JobRecord & { step?: string }>> {
    const result = await this.pool.query<JobRow>(
      `SELECT * FROM jobs
       WHERE status = 'queued'
         AND created_at <= NOW() - ($1::bigint * INTERVAL '1 millisecond')
         AND (dispatched_at IS NULL OR dispatch_error IS NOT NULL)
       ORDER BY created_at ASC
       LIMIT 50`,
      [olderThanMs],
    );
    return result.rows.map(rowToJob);
  }

  async oldestQueuedAgeSeconds(): Promise<number | null> {
    const result = await this.pool.query<{ age_seconds: string | null }>(
      `SELECT EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))::text AS age_seconds
       FROM jobs WHERE status = 'queued'`,
    );
    const raw = result.rows[0]?.age_seconds;
    if (raw == null) return null;
    return Math.max(0, Math.floor(Number(raw)));
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
