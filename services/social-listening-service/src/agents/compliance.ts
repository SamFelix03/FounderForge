import { completeJson } from "../llm/groq.js";
import { eventText } from "../ingest/normalize.js";
import type { NormalizedEvent, ProductConfig } from "../types.js";

const URL_RE = /https?:\/\/\S+|www\.\S+/i;

export async function reviewCompliance(
  event: NormalizedEvent,
  product: ProductConfig,
  draftText: string,
): Promise<{ ok: boolean; notes: string }> {
  if (draftText.length < 40 || draftText.length > 1400) {
    return { ok: false, notes: "length_out_of_bounds" };
  }
  if (URL_RE.test(draftText) || /\b[\w-]+\.(ai|io|com|dev|app)\b/i.test(draftText)) {
    return { ok: false, notes: "contains_link_or_domain" };
  }
  if (/disclosure\s*:/i.test(draftText)) {
    return { ok: false, notes: "looks_like_ad_disclosure" };
  }
  if (
    !new RegExp(
      `\\b${product.product_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i",
    ).test(draftText)
  ) {
    return { ok: false, notes: "missing_product_name" };
  }
  if (
    /check (it )?out|sign up|try (our|my)|use my tool|pricing|pay only \$|game[- ]?changer|click here/i.test(
      draftText,
    )
  ) {
    return { ok: false, notes: "promotional_cta" };
  }

  const { data } = await completeJson<{
    ok: boolean;
    notes: string;
  }>({
    maxTokens: 1024,
    temperature: 0.1,
    system: `You gatekeep auto-posted Reddit replies.
PASS if the reply is mostly helpful peer advice specific to the thread, casually mentions ${product.product_name} once, and has no links/domains/CTAs/pricing dumps.
FAIL if it is mostly an ad, has URLs/domains, disclosure boilerplate, hard sell language, or ignores the thread.
Return JSON only.`,
    prompt: `Thread:
${eventText(event)}

Draft:
${draftText}

Return JSON: { "ok": boolean, "notes": "short reason" }`,
  });

  return {
    ok: Boolean(data.ok),
    notes: String(data.notes || "").slice(0, 280),
  };
}
