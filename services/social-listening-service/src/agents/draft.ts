import { completeJson } from "../llm/groq.js";
import { embedText } from "../embeddings/local.js";
import { topFewShots } from "../db/repos.js";
import { eventText } from "../ingest/normalize.js";
import type { NormalizedEvent, ProductConfig } from "../types.js";

const URL_RE = /https?:\/\/\S+|www\.\S+/gi;

function stripLinks(text: string): string {
  return text
    .replace(URL_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export async function writeDraft(
  event: NormalizedEvent,
  product: ProductConfig,
): Promise<{ draft_text: string; draft_rationale: string }> {
  const text = eventText(event);

  const emb = await embedText(text);
  const few = await topFewShots(emb, 4);

  const { data } = await completeJson<{
    draft_text: string;
    draft_rationale: string;
  }>({
    maxTokens: 2048,
    temperature: 0.55,
    system: `You write natural Reddit comments as a helpful peer who happens to know ${product.product_name}.

Hard rules:
- Lead with useful advice for THIS thread — be specific to the OP's ask.
- Mention ${product.product_name} once, casually, as something that fits their situation (like a friend recommending a tool by name).
- NO URLs, NO domain names (no .ai / .com / .io), NO "check out", NO "sign up", NO pricing, NO feature laundry lists.
- No formal "Disclosure:" line — keep it conversational.
- 2–4 short paragraphs. Reddit tone. No hype (revolutionary, game-changer, seamless).
Return JSON only.`,
    prompt: `Product name to mention once: ${product.product_name}
What it roughly does (do not dump as a pitch): ${product.one_liner}
More context (ideas only): ${product.description.slice(0, 350)}

Subreddit: ${event.community || "-"}

Thread:
${text}

Past reply style examples (tone only):
${few.length ? few.map((f, i) => `${i + 1}. ${f}`).join("\n") : "(none yet)"}

Return JSON:
{
  "draft_text": "peer reply that helps first, then casually names ${product.product_name} once, with no links",
  "draft_rationale": "one line: what ask you answered"
}`,
  });

  let draft = stripLinks(String(data.draft_text || ""));
  if (!draft || draft.length < 40) {
    throw new Error("draft_empty_or_too_short");
  }

  // Ensure the product name appears once if the model forgot
  if (!new RegExp(product.product_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(draft)) {
    draft = `${draft}\n\nI've had decent luck with ${product.product_name} for that kind of setup.`;
  }

  // Strip leftover domains / disclosure boilerplate
  draft = draft
    .replace(/\(?\s*disclosure\s*:[^)\n]+\)?/gi, "")
    .replace(/\b[\w-]+\.(?:ai|io|com|dev|app)\b/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (draft.length > 1200) {
    draft = draft.slice(0, 1200).replace(/\s+\S*$/, "").trim();
  }

  return {
    draft_text: draft,
    draft_rationale: String(data.draft_rationale || "").slice(0, 280),
  };
}
