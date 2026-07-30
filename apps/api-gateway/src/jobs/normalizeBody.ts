/**
 * Marketplace / agent clients often send flattened JSON or stringify `input`.
 * Normalize additively into CreateJobRequest shape before Zod parse.
 */
export function normalizeCreateJobBody(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const o = { ...(raw as Record<string, unknown>) };

  if (typeof o.input === "string") {
    try {
      o.input = JSON.parse(o.input);
    } catch {
      /* leave as string — Zod will reject with a clear error */
    }
  }

  if (o.input && typeof o.input === "object" && !Array.isArray(o.input)) {
    return o;
  }

  const metaKeys = new Set(["priority", "callback_url", "marketplace"]);
  const input: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (metaKeys.has(k)) continue;
    input[k] = v;
  }
  if (Object.keys(input).length === 0) return o;

  return {
    ...(o.priority !== undefined ? { priority: o.priority } : {}),
    ...(o.callback_url !== undefined ? { callback_url: o.callback_url } : {}),
    ...(o.marketplace !== undefined ? { marketplace: o.marketplace } : {}),
    input,
  };
}

/** Extract OKX marketplace ids from body + common headers. */
export function extractMarketplaceIds(
  body: {
    marketplace?: { job_id?: string; agent_id?: string };
  },
  headers: { get?(name: string): string | null | undefined } | Record<string, unknown>,
): { marketplace_job_id?: string; marketplace_agent_id?: string } {
  const headerGet = (name: string): string | undefined => {
    if (typeof (headers as { get?: unknown }).get === "function") {
      const v = (headers as { get: (n: string) => string | null | undefined }).get(name);
      return v?.trim() || undefined;
    }
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
      if (k.toLowerCase() === lower && typeof v === "string" && v.trim()) {
        return v.trim();
      }
    }
    return undefined;
  };

  const marketplace_job_id =
    body.marketplace?.job_id?.trim() ||
    headerGet("x-okx-job-id") ||
    headerGet("x-marketplace-job-id");
  const marketplace_agent_id =
    body.marketplace?.agent_id?.trim() ||
    headerGet("x-okx-agent-id") ||
    headerGet("x-marketplace-agent-id");

  return {
    ...(marketplace_job_id ? { marketplace_job_id } : {}),
    ...(marketplace_agent_id ? { marketplace_agent_id } : {}),
  };
}

export const POLL_CONTRACT = {
  method: "GET" as const,
  recommended_interval_seconds: 10,
  terminal_statuses: ["completed", "failed", "cancelled"] as const,
  success_status: "completed" as const,
  failure_fields: ["error", "error_code"] as const,
  result_url_field: "artifacts[].url",
};
