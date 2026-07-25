import { completeJson } from "../llm/groq.js";
import { eventText } from "../ingest/normalize.js";
import type { NormalizedEvent, ProductConfig, SignalScores } from "../types.js";

function clamp01(n: unknown): number {
  return Math.max(0, Math.min(1, Number(n) || 0));
}

const ASK_RE =
  /looking for|recommend|how do (you|i)|any (tool|app|software|alternative)|what do you use|is there a|instead of|migrat|too expensive|alternative to|wish .+ could|does anyone|has anyone|best way to|struggle|pain point|need a way/i;

const PAIN_OVERLAP_RE =
  /integrat|automat|workflow|api|no-?code|zap|connect .+ to|sync|orchestrat|agent|tooling|scrap|pipeline/i;

/** Score fit for THIS product on Reddit (asks + soft opportunity). */
export async function scoreSignals(
  event: NormalizedEvent,
  product: ProductConfig,
): Promise<SignalScores> {
  const isComment = event.external_id.startsWith("comment_");
  const text = eventText(event);

  const { data } = await completeJson<{
    relevance: number;
    need: number;
    community_risk: number;
    competitor: number;
    rationales?: {
      relevance?: string;
      need?: string;
      community_risk?: string;
      competitor?: string;
    };
  }>({
    system: `You score Reddit threads for whether a disclosed reply about a SPECIFIC product is warranted.
Return JSON only. Be product-specific using the product brief — never assume it is an AI-agent/MCP tool unless the brief says so.

Score each 0–1:

need (most important):
- 0.75–1.0: explicit ask, recommendation request, comparison, migration, or clear pain the product solves
- 0.50–0.74: soft opportunity — thread where the audience problem clearly overlaps the product. A helpful disclosed comment would be natural.
- 0.30–0.49: weak overlap; product mention would feel forced
- 0–0.29: unrelated cheerleading / no overlap

Prefer real asks over generic discussion. Be stricter on promo-hostile subs.

relevance:
- How well the thread's problem/audience matches THIS product's job-to-be-done (from the brief). Same category with overlapping JTBD → high. "Both are SaaS" alone → low.

community_risk:
- 1 = safe for disclosed helpful reply
- Low if hostile / anti-promo / "no self-promo" / vendors asked to leave

competitor:
- 1 = room for another useful option; 0 = thread already saturated with near-identical pitches`,
    prompt: `PRODUCT BRIEF (score only for this product):
Name: ${product.product_name}
One-liner: ${product.one_liner}
Description: ${product.description}
Keywords: ${product.keywords.join(", ")}

Event type: ${isComment ? "COMMENT" : "REDDIT POST"}
Subreddit: ${event.community || "reddit"}

Thread:
${text}

Permalink: ${event.permalink}

Return JSON:
{
  "relevance": 0-1,
  "need": 0-1,
  "community_risk": 0-1,
  "competitor": 0-1,
  "rationales": {
    "relevance": "one short sentence about THIS product",
    "need": "cite the ask/pain OR the soft opportunity overlap",
    "community_risk": "one short sentence",
    "competitor": "one short sentence"
  }
}`,
    temperature: 0.1,
  });

  const r = data.rationales || {};
  let need = clamp01(data.need);
  let relevance = clamp01(data.relevance);

  // Deterministic floors — LLMs were zeroing every launch.
  if (ASK_RE.test(text)) {
    need = Math.max(need, 0.62);
  } else if (PAIN_OVERLAP_RE.test(text) && keywordOverlap(text, product) >= 1) {
    need = Math.max(need, 0.52);
    relevance = Math.max(relevance, 0.45);
  } else if (keywordOverlap(text, product) >= 2) {
    need = Math.max(need, 0.48);
    relevance = Math.max(relevance, 0.42);
  }

  return {
    relevance,
    need,
    community_risk: clamp01(data.community_risk),
    competitor: clamp01(data.competitor),
    rationales: {
      relevance: String(r.relevance || "").slice(0, 280),
      need: String(r.need || "").slice(0, 280),
      community_risk: String(r.community_risk || "").slice(0, 280),
      competitor: String(r.competitor || "").slice(0, 280),
    },
  };
}

function keywordOverlap(text: string, product: ProductConfig): number {
  const hay = text.toLowerCase();
  const terms = [
    ...product.keywords,
    ...product.product_name.split(/\s+/),
    ...product.one_liner.split(/[^a-z0-9]+/i).filter((t) => t.length > 4),
  ]
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 2);
  const uniq = [...new Set(terms)];
  return uniq.filter((t) => hay.includes(t)).length;
}
