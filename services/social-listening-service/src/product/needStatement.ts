/**
 * Groq turns product profile → Tavily {need} bracket text.
 * Falls back to a deterministic need if the LLM JSON call fails
 * (gpt-oss often burns max_tokens on reasoning before emitting JSON).
 */
import { completeJson } from "../llm/groq.js";
import { createLogger } from "../log.js";
import type { ProductConfig } from "../types.js";

const log = createLogger("product.need");

function fallbackNeed(product: ProductConfig): string {
  const kws = (product.keywords || []).slice(0, 6).join(", ");
  const core = product.one_liner || product.description.slice(0, 160);
  return `someone building or running an AI agent who complains about ${core}${
    kws ? ` (related: ${kws})` : ""
  }, and wishes there was one unified way to discover and pay for tools per API call instead of juggling separate keys and subscriptions`;
}

/**
 * One sentence describing the seeker pain Reddit posts should match.
 * Goes inside: Fetch Reddit posts where {NEED} I want ONLY reddit posts…
 */
export async function generateNeedStatement(
  product: ProductConfig,
): Promise<string> {
  try {
    const { data } = await completeJson<{ need_statement: string }>({
      temperature: 0.2,
      // gpt-oss-120b uses reasoning tokens before JSON — 220 was truncating to empty
      maxTokens: 2048,
      maxAttempts: 3,
      system: `You write a single Reddit-search need statement for Tavily Research.
Describe the PERSON and their PAIN — not the product brand.
Phrase it like: "someone … complains about … and wishes …"
No product name, no URLs, no marketing. One dense sentence (max ~60 words).
You MUST return a valid JSON object with key need_statement.`,
      prompt: `Product one-liner: ${product.one_liner}
What it solves: ${product.description}
Keywords: ${(product.keywords || []).slice(0, 12).join(", ")}

Return ONLY this JSON shape (no markdown):
{"need_statement":"someone …"}`,
    });

    const need = String(data.need_statement || "")
      .trim()
      .replace(/^\{|\}$/g, "")
      .replace(/^["']|["']$/g, "");

    if (!need || need.length < 20) {
      log.warn("need statement weak — using fallback", { chars: need.length });
      return fallbackNeed(product);
    }

    log.info("need statement ready", { chars: need.length });
    return need;
  } catch (err) {
    log.warn("need statement LLM failed — using fallback", {
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return fallbackNeed(product);
  }
}
