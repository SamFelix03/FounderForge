import type { Pool } from "pg";
import { getPool } from "./pool.js";

export type MarketplaceDeliveryStatus =
  | "pending"
  | "delivered"
  | "failed"
  | "skipped";

export interface MarketplaceLink {
  okx_job_id: string;
  founderforge_job_id: string;
  asp_agent_id: string;
  delivery_status: MarketplaceDeliveryStatus;
  delivery_attempts: number;
  last_delivery_error?: string;
  delivered_at?: string;
  created_at: string;
  updated_at: string;
}

interface LinkRow {
  okx_job_id: string;
  founderforge_job_id: string;
  asp_agent_id: string;
  delivery_status: MarketplaceDeliveryStatus;
  delivery_attempts: number;
  last_delivery_error: string | null;
  delivered_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function rowToLink(row: LinkRow): MarketplaceLink {
  return {
    okx_job_id: row.okx_job_id,
    founderforge_job_id: row.founderforge_job_id,
    asp_agent_id: row.asp_agent_id,
    delivery_status: row.delivery_status,
    delivery_attempts: row.delivery_attempts,
    ...(row.last_delivery_error
      ? { last_delivery_error: row.last_delivery_error }
      : {}),
    ...(row.delivered_at ? { delivered_at: row.delivered_at.toISOString() } : {}),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export class MarketplaceLinkStore {
  constructor(private readonly pool: Pool = getPool()) {}

  async upsertLink(args: {
    okx_job_id: string;
    founderforge_job_id: string;
    asp_agent_id: string;
  }): Promise<MarketplaceLink> {
    const result = await this.pool.query<LinkRow>(
      `INSERT INTO marketplace_links (
        okx_job_id, founderforge_job_id, asp_agent_id
      ) VALUES ($1, $2, $3)
      ON CONFLICT (okx_job_id) DO UPDATE SET
        founderforge_job_id = EXCLUDED.founderforge_job_id,
        asp_agent_id = EXCLUDED.asp_agent_id,
        updated_at = NOW()
      RETURNING *`,
      [args.okx_job_id, args.founderforge_job_id, args.asp_agent_id],
    );
    return rowToLink(result.rows[0]!);
  }

  async get(okxJobId: string): Promise<MarketplaceLink | undefined> {
    const result = await this.pool.query<LinkRow>(
      `SELECT * FROM marketplace_links WHERE okx_job_id = $1`,
      [okxJobId],
    );
    const row = result.rows[0];
    return row ? rowToLink(row) : undefined;
  }

  async listPending(limit = 50): Promise<MarketplaceLink[]> {
    const result = await this.pool.query<LinkRow>(
      `SELECT * FROM marketplace_links
       WHERE delivery_status IN ('pending', 'failed')
       ORDER BY updated_at ASC
       LIMIT $1`,
      [limit],
    );
    return result.rows.map(rowToLink);
  }

  async markDelivered(okxJobId: string): Promise<MarketplaceLink> {
    const result = await this.pool.query<LinkRow>(
      `UPDATE marketplace_links SET
        delivery_status = 'delivered',
        delivery_attempts = delivery_attempts + 1,
        last_delivery_error = NULL,
        delivered_at = NOW(),
        updated_at = NOW()
       WHERE okx_job_id = $1
       RETURNING *`,
      [okxJobId],
    );
    if (!result.rows[0]) throw new Error(`marketplace link not found: ${okxJobId}`);
    return rowToLink(result.rows[0]);
  }

  async markSkipped(okxJobId: string, reason: string): Promise<MarketplaceLink> {
    const result = await this.pool.query<LinkRow>(
      `UPDATE marketplace_links SET
        delivery_status = 'skipped',
        last_delivery_error = $2,
        updated_at = NOW()
       WHERE okx_job_id = $1
       RETURNING *`,
      [okxJobId, reason.slice(0, 2000)],
    );
    if (!result.rows[0]) throw new Error(`marketplace link not found: ${okxJobId}`);
    return rowToLink(result.rows[0]);
  }

  async markDeliveryFailed(
    okxJobId: string,
    error: string,
  ): Promise<MarketplaceLink> {
    const result = await this.pool.query<LinkRow>(
      `UPDATE marketplace_links SET
        delivery_status = 'failed',
        delivery_attempts = delivery_attempts + 1,
        last_delivery_error = $2,
        updated_at = NOW()
       WHERE okx_job_id = $1
       RETURNING *`,
      [okxJobId, error.slice(0, 2000)],
    );
    if (!result.rows[0]) throw new Error(`marketplace link not found: ${okxJobId}`);
    return rowToLink(result.rows[0]);
  }
}

let defaultLinks: MarketplaceLinkStore | undefined;

export function getMarketplaceLinkStore(): MarketplaceLinkStore {
  if (!defaultLinks) defaultLinks = new MarketplaceLinkStore();
  return defaultLinks;
}

export function setMarketplaceLinkStoreForTests(
  store: MarketplaceLinkStore | undefined,
): void {
  defaultLinks = store;
}
