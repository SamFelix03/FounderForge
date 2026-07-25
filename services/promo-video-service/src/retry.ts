import { createLogger } from "@founderforge/observability";

const log = createLogger("promo.retry");

const TRANSIENT_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "ECONNABORTED",
]);

function errorCode(err: unknown): string {
  const e = err as {
    code?: string;
    cause?: { code?: string };
    errno?: string | number;
    error?: { code?: string };
  };
  return String(e?.code || e?.cause?.code || e?.errno || e?.error?.code || "");
}

export function isTransientNetworkError(err: unknown): boolean {
  const code = errorCode(err);
  if (TRANSIENT_CODES.has(code)) return true;
  const msg = String(err instanceof Error ? err.message : err || "");
  return /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|getaddrinfo|socket hang up|network/i.test(
    msg,
  );
}

export async function withRetries<T>(
  fn: (attempt: number) => Promise<T>,
  {
    label = "operation",
    attempts = 5,
    baseDelayMs = 800,
  }: { label?: string; attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastErr = err;
      const transient = isTransientNetworkError(err);
      if (!transient || i === attempts) break;
      const delay = baseDelayMs * 2 ** (i - 1);
      log.warn(`${label} failed — retrying`, {
        code: errorCode(err) || (err instanceof Error ? err.message : "error"),
        attempt: i,
        delay_ms: delay,
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
