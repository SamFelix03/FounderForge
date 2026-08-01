/**
 * Marketplace / agent clients often send flattened JSON, query `--param`s,
 * stringified `input`, or empty body on x402 replay while params live on the URL.
 * Normalize additively into CreateJobRequest shape before Zod parse.
 */

const META_KEYS = new Set([
  "priority",
  "callback_url",
  "marketplace",
  // common non-input wrappers / transport noise
  "payment",
  "signature",
  "authorization",
]);

/** Query-string values arrive as strings — coerce known typed fields. */
const INT_INPUT_KEYS = new Set([
  "max_posts",
  "max_pages",
  "duration",
  "pick",
]);
const BOOL_INPUT_KEYS = new Set(["live"]);

const WRAPPER_KEYS = [
  "params",
  "parameters",
  "arguments",
  "args",
  "data",
  "payload",
  "body",
  "serviceParams",
  "service_params",
] as const;

function coerceInputValue(key: string, v: unknown): unknown {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (INT_INPUT_KEYS.has(key) && /^-?\d+$/.test(t)) return Number(t);
  if (BOOL_INPUT_KEYS.has(key)) {
    if (/^(true|1|yes)$/i.test(t)) return true;
    if (/^(false|0|no)$/i.test(t)) return false;
  }
  return v;
}

function coerceInputRecord(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = coerceInputValue(k, v);
  }
  return out;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return undefined;
}

function tryParseJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (!t || (t[0] !== "{" && t[0] !== "[")) return v;
  try {
    return JSON.parse(t);
  } catch {
    return v;
  }
}

/** Parse `a=1&b=2` or JSON object strings used as serviceParams. */
function parseLooseObjectString(v: string): Record<string, unknown> | undefined {
  const parsed = tryParseJson(v);
  const obj = asRecord(parsed);
  if (obj) return obj;

  // key=value pairs (natural-language OKX serviceParams style)
  if (!v.includes("=")) return undefined;
  const out: Record<string, unknown> = {};
  for (const part of v.split(/[\s&]+/)) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const raw = part.slice(eq + 1).trim();
    if (!k) continue;
    const num = Number(raw);
    out[k] = Number.isFinite(num) && raw !== "" ? num : raw;
  }
  return Object.keys(out).length ? out : undefined;
}

function collectCandidateFields(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };

  for (const key of WRAPPER_KEYS) {
    if (!(key in raw)) continue;
    const v = tryParseJson(raw[key]);
    const obj =
      asRecord(v) ?? (typeof v === "string" ? parseLooseObjectString(v) : undefined);
    if (!obj) continue;
    for (const [k, val] of Object.entries(obj)) {
      if (out[k] === undefined) out[k] = val;
    }
  }

  return out;
}

/**
 * Merge Express JSON body + query (OKX `payment quote --param` / replay often
 * puts fields on the query string while the POST body is `{}`).
 */
export function mergeJobCreateSources(
  body: unknown,
  query: unknown,
): Record<string, unknown> {
  const b = asRecord(body) ?? {};
  const q = asRecord(query) ?? {};
  // Body wins over query when both set
  const merged: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === "") continue;
    merged[k] = Array.isArray(v) ? v[0] : v;
  }
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue;
    merged[k] = v;
  }
  return merged;
}

export function normalizeCreateJobBody(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const o = collectCandidateFields(raw as Record<string, unknown>);

  let input = tryParseJson(o.input);
  if (typeof input === "string") {
    input = parseLooseObjectString(input) ?? input;
  }

  const inputObj = asRecord(input);
  const flat: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === "input" || META_KEYS.has(k) || (WRAPPER_KEYS as readonly string[]).includes(k)) {
      continue;
    }
    flat[k] = v;
  }

  // Nested input present — merge any sibling flat fields (reviewer may send both)
  if (inputObj) {
    const mergedInput = coerceInputRecord({ ...flat, ...inputObj });
    return {
      ...(o.priority !== undefined ? { priority: o.priority } : {}),
      ...(o.callback_url !== undefined ? { callback_url: o.callback_url } : {}),
      ...(o.marketplace !== undefined ? { marketplace: o.marketplace } : {}),
      input: mergedInput,
    };
  }

  if (Object.keys(flat).length === 0) {
    // Preserve original shape so Zod reports a clear `input` Required
    return {
      ...(o.priority !== undefined ? { priority: o.priority } : {}),
      ...(o.callback_url !== undefined ? { callback_url: o.callback_url } : {}),
      ...(o.marketplace !== undefined ? { marketplace: o.marketplace } : {}),
      ...(o.input !== undefined ? { input: o.input } : {}),
    };
  }

  return {
    ...(o.priority !== undefined ? { priority: o.priority } : {}),
    ...(o.callback_url !== undefined ? { callback_url: o.callback_url } : {}),
    ...(o.marketplace !== undefined ? { marketplace: o.marketplace } : {}),
    input: coerceInputRecord(flat),
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
