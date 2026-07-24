import { fetchPageJina, webSearch } from "@founderforge/connectors";
import { completeJson } from "@founderforge/llm-core";
import type { Competitor, Input } from "../schema.js";

function nameFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const part = host.split(".")[0] ?? host;
    return part.charAt(0).toUpperCase() + part.slice(1);
  } catch {
    return url;
  }
}

function rootDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

const MAX_COMPETITORS = 5;

/**
 * Discover direct competitors via web search + LLM ranking.
 * Kept simple: no review-site aggregators (often CAPTCHA-blocked).
 */
export async function findCompetitors(
  input: Input,
  opts?: { stub?: boolean },
): Promise<{
  competitors: Competitor[];
  cost_usd: number;
}> {
  const stub = opts?.stub === true;
  const queries = [
    `${input.product_name} alternatives`,
    `${input.product_name} vs competitors`,
    `${input.product_name} competitors`,
  ];

  const hits = [];
  let cost = 0;
  let productText = "";

  for (const query of queries) {
    const result = await webSearch({ query, stub, num: 8 });
    hits.push(...result.data);
    cost += result.meta.cost_usd;
  }

  if (input.product_url) {
    try {
      const page = await fetchPageJina({ url: input.product_url, stub });
      productText = page.data.text.slice(0, 2500);
      cost += page.meta.cost_usd;
    } catch {
      /* continue */
    }
  }

  const productHost = input.product_url ? rootDomain(input.product_url) : null;
  const candidates = hits
    .filter((h) => {
      const host = rootDomain(h.url);
      if (!host) return false;
      if (productHost && host === productHost) return false;
      if (
        /(youtube|reddit|wikipedia|linkedin|facebook|x\.com|twitter|g2\.com|capterra\.com|getapp\.com)/i.test(
          host,
        )
      ) {
        return false;
      }
      return true;
    })
    .slice(0, 20);

  if (candidates.length === 0) {
    throw new Error("findCompetitors: no search candidates found");
  }

  let competitors: Competitor[] = [];

  if (!stub) {
    try {
      const { data, meta } = await completeJson<{
        competitors: Array<{
          name: string;
          url: string;
          confidence: number;
          category_match?: string;
        }>;
      }>({
        tier: "fast",
        system:
          "You are a competitive-intelligence analyst. Return JSON only. Pick real direct competitors (same category / ICP), not blogs or directories.",
        prompt: `Product: ${input.product_name}
URL: ${input.product_url ?? "n/a"}
Excerpt: ${productText || "(none)"}

Candidates:
${JSON.stringify(candidates.slice(0, 15), null, 2)}

Return { "competitors": [{ "name", "url" (homepage), "confidence": 0-1, "category_match"? }] }
Rules: 4-${MAX_COMPETITORS} max; vendor homepages only; drop weak matches.`,
      });
      cost += meta.estimated_cost_usd;
      competitors = (data.competitors ?? [])
        .filter((c) => c.url && c.name)
        .map((c) => ({
          name: c.name,
          url: c.url,
          confidence: Math.max(0, Math.min(1, Number(c.confidence) || 0.5)),
          sources: ["web_search", "groq"],
          category_match: c.category_match,
        }));
    } catch {
      /* heuristic */
    }
  }

  if (competitors.length === 0) {
    const byDomain = new Map<string, Competitor>();
    for (const hit of candidates) {
      const host = rootDomain(hit.url);
      if (!host) continue;
      const existing = byDomain.get(host);
      if (existing) {
        existing.confidence = Math.min(1, existing.confidence + 0.12);
        continue;
      }
      byDomain.set(host, {
        name: nameFromUrl(hit.url),
        url: `https://${host}`,
        confidence: 0.5,
        sources: stub ? ["test-fixture"] : ["web_search"],
        category_match: "inferred",
      });
    }
    competitors = [...byDomain.values()]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, MAX_COMPETITORS);
  }

  if (competitors.length === 0) {
    throw new Error("findCompetitors: unable to derive competitors from search results");
  }

  return {
    competitors: competitors.slice(0, MAX_COMPETITORS),
    cost_usd: cost,
  };
}
