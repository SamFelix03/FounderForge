import type { NormalizedEvent, ProductConfig } from "../types.js";
import { eventText } from "../ingest/normalize.js";

const BOT_AUTHORS = new Set([
  "automoderator",
  "[deleted]",
  "deleted",
  "modnews",
]);

const NEED_PHRASES = [
  "looking for",
  "recommend",
  "alternative to",
  "how do you",
  "any tools",
  "what do you use",
  "is there a",
  "api key",
  "integrations",
  "tooling",
  "workflow",
  "automate",
  "agents",
  "mcp",
];

/** Cheap gate — configured subreddits are in-scope; else keyword/ask phrases. */
export function stage0Prefilter(
  event: NormalizedEvent,
  product: ProductConfig,
): { pass: boolean; reason?: string } {
  const text = eventText(event);
  if (!text || text.length < 40) {
    return { pass: false, reason: "too_short" };
  }
  if (/\[removed\]|\[deleted\]/i.test(text)) {
    return { pass: false, reason: "deleted_or_removed" };
  }
  if (BOT_AUTHORS.has(event.author.toLowerCase())) {
    return { pass: false, reason: "bot_author" };
  }

  if (
    event.community &&
    product.subreddits.some(
      (s) => s.toLowerCase() === event.community!.toLowerCase(),
    )
  ) {
    return { pass: true };
  }

  const terms = [...product.keywords, ...product.subreddits, product.product_name]
    .map((t) => t.toLowerCase())
    .filter(Boolean);

  const hay = text.toLowerCase();
  if (terms.some((t) => hay.includes(t))) return { pass: true };

  if (!NEED_PHRASES.some((p) => hay.includes(p))) {
    return { pass: false, reason: "no_keyword_or_need_phrase" };
  }

  return { pass: true };
}
