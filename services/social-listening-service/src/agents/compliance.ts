import { completeJson } from "../llm/groq.js";
import { eventText } from "../ingest/normalize.js";
import type { NormalizedEvent, ProductConfig } from "../types.js";

export async function reviewCompliance(
  event: NormalizedEvent,
  product: ProductConfig,
  draftText: string,
): Promise<{ ok: boolean; notes: string }> {
  // Hard local checks first
  if (!draftText.toLowerCase().includes("disclosure")) {
    return { ok: false, notes: "missing_disclosure_keyword" };
  }
  if (draftText.length < 40 || draftText.length > 1800) {
    return { ok: false, notes: "length_out_of_bounds" };
  }

  const { data } = await completeJson<{
    ok: boolean;
    notes: string;
  }>({
    system: `You are a compliance gate for auto-posted community replies.
FAIL if:
- missing/unclear disclosure
- absolute competitor claims or unverifiable stats
- hostile/locked-thread vibe
- pure ad with no helpful answer
- draft is a pure ad with no thread-specific hook
- draft could be copy-pasted onto any unrelated launch (not specific to this thread's problem)
PASS only if the reply addresses a concrete need in the thread and is safe to auto-post.
Return JSON only.`,
    prompt: `Required disclosure: ${product.disclosure_line}

Thread:
${eventText(event)}

Draft:
${draftText}

Return JSON: { "ok": boolean, "notes": "short reason" }`,
    temperature: 0.1,
  });

  return {
    ok: Boolean(data.ok),
    notes: String(data.notes || "").slice(0, 280),
  };
}
