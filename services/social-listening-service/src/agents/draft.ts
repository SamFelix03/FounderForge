import { completeJson } from "../llm/groq.js";
import { embedText } from "../embeddings/local.js";
import { topFewShots } from "../db/repos.js";
import { eventText } from "../ingest/normalize.js";
import type { NormalizedEvent, ProductConfig, SignalScores } from "../types.js";

export async function writeDraft(
  event: NormalizedEvent,
  product: ProductConfig,
  scores: SignalScores,
): Promise<{ draft_text: string; draft_rationale: string }> {
  const emb = await embedText(eventText(event));
  const few = await topFewShots(emb, 4);

  const { data } = await completeJson<{
    draft_text: string;
    draft_rationale: string;
  }>({
    system: `You write disclosed, helpful Reddit replies for ${product.product_name}.
Rules:
- Open by acknowledging the thread's ask OR the overlapping problem.
- Give useful advice on its merits first.
- Then mention ${product.product_name} only as it fits THAT problem — never a generic pitch.
- Always include this exact disclosure somewhere natural: ${JSON.stringify(product.disclosure_line)}
- Concise (2–5 short paragraphs). Peer-to-peer Reddit tone — not salesy. No hype, no unverifiable stats, no absolute competitor claims.
- Only return empty draft_text if the thread has ZERO overlap with the product.
Return JSON only.`,
    prompt: `Product: ${product.product_name}
One-liner: ${product.one_liner}
What it solves: ${product.description}
Subreddit: ${event.community || "-"}

Need rationale from scorer: ${scores.rationales.need}
Relevance rationale: ${scores.rationales.relevance}

Thread:
${eventText(event)}

Past successful reply examples (style only):
${few.length ? few.map((f, i) => `${i + 1}. ${f}`).join("\n") : "(none yet)"}

Return JSON:
{
  "draft_text": "the full reply to post, or empty if no genuine need",
  "draft_rationale": "one line: what need you're answering + why the product fits"
}`,
    temperature: 0.45,
  });

  let draft = String(data.draft_text || "").trim();
  if (!draft) {
    throw new Error("draft_empty_no_genuine_need");
  }
  if (!draft.toLowerCase().includes(product.disclosure_line.toLowerCase().slice(0, 12))) {
    draft = `${draft}\n\n${product.disclosure_line}`;
  }

  return {
    draft_text: draft,
    draft_rationale: String(data.draft_rationale || "").slice(0, 280),
  };
}
