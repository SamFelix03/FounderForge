/**
 * Stable job failure codes for scrape / discovery / empty-deliverable failures.
 * Encoded into `jobs.error` as `[code] human message` so Temporal boundaries
 * and existing TEXT columns keep working without a required schema migration.
 */

export const PRODUCT_URL_ERROR_CODES = [
  "product_url_invalid",
  "product_url_unreachable",
  "product_url_timeout",
  "product_url_http_error",
  "product_url_no_content",
] as const;

export const SOCIAL_LISTENING_ERROR_CODES = [
  "reddit_ingest_failed",
  "reddit_no_threads",
  "reddit_no_drafts",
] as const;

export type ProductUrlErrorCode = (typeof PRODUCT_URL_ERROR_CODES)[number];
export type SocialListeningErrorCode = (typeof SOCIAL_LISTENING_ERROR_CODES)[number];
export type JobErrorCode = ProductUrlErrorCode | SocialListeningErrorCode;

const CODE_SET = new Set<string>([
  ...PRODUCT_URL_ERROR_CODES,
  ...SOCIAL_LISTENING_ERROR_CODES,
]);

/** Any known encoded job failure (scrape, empty Reddit pack, etc.). */
export class CodedJobError extends Error {
  readonly code: JobErrorCode;

  constructor(code: JobErrorCode, message: string, options?: { cause?: unknown }) {
    super(encodeJobError(code, message));
    this.name = "CodedJobError";
    this.code = code;
    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export function isCodedJobError(err: unknown): err is CodedJobError {
  return err instanceof CodedJobError;
}

export class ProductUrlError extends CodedJobError {
  constructor(
    code: ProductUrlErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(code, message, options);
    this.name = "ProductUrlError";
  }
}

export function isProductUrlError(err: unknown): err is ProductUrlError {
  return err instanceof ProductUrlError;
}

export function encodeJobError(code: string, message: string): string {
  const clean = message.replace(/^\[[a-z0-9_]+\]\s*/i, "").trim() || message;
  return `[${code}] ${clean}`;
}

export function decodeJobError(raw?: string | null): {
  error?: string;
  error_code?: string;
} {
  if (!raw) return {};
  const m = raw.match(/^\[([a-z0-9_]+)\]\s*([\s\S]*)$/i);
  if (m?.[1] && CODE_SET.has(m[1])) {
    return {
      error_code: m[1],
      error: (m[2] || m[1]).trim() || m[1],
    };
  }
  return { error: raw };
}

/** Classify low-level fetch failures into ProductUrlError (additive wrapper). */
export function productUrlErrorFromFetchFailure(
  url: string,
  err: unknown,
): ProductUrlError {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (/timeout|aborted|abort_err|timed out/i.test(lower)) {
    return new ProductUrlError(
      "product_url_timeout",
      `Timed out fetching product content from ${url}. ${msg}`,
      { cause: err },
    );
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|dns|nxdomain/i.test(msg)) {
    return new ProductUrlError(
      "product_url_unreachable",
      `Could not resolve or reach ${url}. Check that the domain exists and is publicly reachable. ${msg}`,
      { cause: err },
    );
  }
  if (/ECONNREFUSED|ECONNRESET|ENETUNREACH|fetch failed|network/i.test(msg)) {
    return new ProductUrlError(
      "product_url_unreachable",
      `Could not reach ${url}. ${msg}`,
      { cause: err },
    );
  }
  const http = msg.match(/HTTP\s+(\d{3})/i) || msg.match(/failed:\s*(\d{3})/i);
  if (http?.[1]) {
    return new ProductUrlError(
      "product_url_http_error",
      `Product URL ${url} returned HTTP ${http[1]}. Provide a publicly reachable marketing page.`,
      { cause: err },
    );
  }
  if (/invalid website url|invalid url|URL is required/i.test(msg)) {
    return new ProductUrlError("product_url_invalid", msg, { cause: err });
  }
  return new ProductUrlError(
    "product_url_unreachable",
    `Could not fetch product content from ${url}. ${msg}`,
    { cause: err },
  );
}

export const PRODUCT_URL_ERROR_DOCS: Array<{
  code: ProductUrlErrorCode;
  description: string;
}> = [
  {
    code: "product_url_invalid",
    description: "URL failed validation (missing/invalid scheme or host).",
  },
  {
    code: "product_url_unreachable",
    description: "DNS/network failure — host does not resolve or is unreachable.",
  },
  {
    code: "product_url_timeout",
    description: "Fetch timed out before readable content was returned.",
  },
  {
    code: "product_url_http_error",
    description: "Origin responded with a non-2xx HTTP status (e.g. 404/5xx).",
  },
  {
    code: "product_url_no_content",
    description:
      "Page loaded but no usable product text (empty SPA shell, bot wall, or <200 chars).",
  },
];

export const SOCIAL_LISTENING_ERROR_DOCS: Array<{
  code: SocialListeningErrorCode;
  description: string;
}> = [
  {
    code: "reddit_ingest_failed",
    description: "Reddit thread discovery (Tavily/research) threw before returning hits.",
  },
  {
    code: "reddit_no_threads",
    description:
      "Discovery returned zero matching Reddit threads for this product — no comments to draft.",
  },
  {
    code: "reddit_no_drafts",
    description:
      "Threads were found but none passed drafting/compliance; deliverable would be empty.",
  },
];
