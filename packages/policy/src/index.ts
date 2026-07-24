export interface PolicyCheckResult {
  ok: boolean;
  reasons: string[];
}

/** Shared content-safety / ToS checks before public publish. */
export function checkPublishableContent(text: string): PolicyCheckResult {
  const reasons: string[] = [];
  const trimmed = text.trim();
  if (!trimmed) {
    reasons.push("empty_content");
  }
  if (trimmed.length > 5000) {
    reasons.push("content_too_long");
  }
  // Placeholder spam heuristic — expand per platform later
  if (/(buy now|crypto giveaway|guaranteed returns)/i.test(trimmed)) {
    reasons.push("spam_like_phrase");
  }
  return { ok: reasons.length === 0, reasons };
}

export const PLATFORM_RATE_LIMITS = {
  reddit: { perHour: 10 },
  hackernews: { perHour: 5 },
  x: { perHour: 20 },
  youtube: { perDay: 5 },
} as const;
