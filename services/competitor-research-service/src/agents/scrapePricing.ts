import { completeJson } from "@founderforge/llm-core";
import { createLogger } from "@founderforge/observability";
import type { Competitor, Input, PricingResult } from "../schema.js";
import {
  fetchVendorEvidence,
  truncateForLlm,
  type VendorEvidence,
} from "./fetchEvidence.js";

const log = createLogger("scrapePricing");

type Tier = {
  name: string;
  price?: number;
  currency: string;
  period?: string;
  notes?: string;
};

function extractPrices(text: string): Array<{ price: number; period?: string }> {
  const results: Array<{ price: number; period?: string }> = [];
  const re =
    /(?:starting at|from|only)?\s*\$\s*([\d,]+(?:\.\d+)?)\s*(?:\/\s*|per\s+)?(user\/mo|seat\/mo|mo|month|\/mo|yr|year|\/yr|user|seat)?/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) && results.length < 8) {
    const raw = match[1]?.replace(/,/g, "");
    if (!raw) continue;
    const price = Number(raw);
    if (!Number.isFinite(price)) continue;
    const periodRaw = (match[2] ?? "").toLowerCase();
    let period: string | undefined;
    if (/yr|year/.test(periodRaw)) period = "year";
    else if (/mo|month|user|seat/.test(periodRaw)) period = "month";
    results.push({ price, period });
  }
  return results;
}

function extractTiersHeuristic(text: string, label: string): Tier[] {
  const prices = extractPrices(text);
  const planNames = [
    ...text.matchAll(
      /\b(Free|Starter|Basic|Plus|Pro|Professional|Team|Business|Enterprise|Unlimited|Standard|Premium|Growth)\b/gi,
    ),
  ].map((m) => m[1]!);
  const uniquePlans = [...new Set(planNames.map((p) => p[0]!.toUpperCase() + p.slice(1)))].slice(
    0,
    5,
  );

  if (uniquePlans.length && prices.length) {
    return uniquePlans.map((name, i) => {
      const p = prices[Math.min(i, prices.length - 1)]!;
      const isFree = /^free$/i.test(name);
      return {
        name,
        price: isFree ? 0 : p.price,
        currency: "USD",
        period: isFree ? undefined : (p.period ?? "month"),
      };
    });
  }

  if (prices.length) {
    return prices.slice(0, 4).map((p, i) => ({
      name: i === 0 ? "Listed plan" : `Plan ${i + 1}`,
      price: p.price,
      currency: "USD",
      period: p.period ?? "month",
      notes: `Extracted from ${label} public page`,
    }));
  }

  if (/contact (sales|us)|custom pricing|talk to sales|request a quote/i.test(text)) {
    return [
      {
        name: "Enterprise",
        currency: "USD",
        notes: "Contact sales / custom (public page)",
      },
    ];
  }

  return [
    {
      name: "Not disclosed",
      currency: "USD",
      notes: "No public list price found",
    },
  ];
}

function inferPricingModel(text: string): string {
  const t = text.toLowerCase();
  if (/contact (sales|us)|custom pricing|talk to sales/.test(t) && !/\$\d/.test(t)) {
    return "contact-sales";
  }
  if (/free (forever|plan|tier)|freemium/.test(t) || (/\bfree\b/.test(t) && /\$\d/.test(t))) {
    return "freemium";
  }
  if (/per (user|seat)|\/user|\/seat/.test(t)) return "per-seat";
  if (/usage[- ]based|pay as you go|credits/.test(t)) return "usage-based";
  if (/flat[- ]rate|fixed price|per (workspace|org|team)/.test(t)) return "flat-rate";
  if (/\$\d/.test(t)) return "per-seat";
  return "contact-sales";
}

function pricingSignals(text: string): string {
  const prices = extractPrices(text);
  return [
    prices.length
      ? `prices: ${prices.map((p) => `$${p.price}${p.period ? `/${p.period}` : ""}`).join(", ")}`
      : "prices: none",
    `model hint: ${inferPricingModel(text)}`,
  ].join("; ");
}

export async function scrapePricing(
  input: {
    input: Input;
    competitors: Competitor[];
    evidence?: Record<string, VendorEvidence>;
  },
  opts?: { stub?: boolean },
): Promise<{ pricing: PricingResult; cost_usd: number }> {
  const stub = opts?.stub === true;
  let cost = 0;

  const productBase =
    input.input.product_url ??
    `https://example.com/${encodeURIComponent(input.input.product_name)}`;
  const shared = input.evidence ?? {};

  const getEvidence = async (key: string, url: string): Promise<VendorEvidence> => {
    if (shared[key]) return shared[key]!;
    const page = await fetchVendorEvidence(url, { stub, maxChars: 4200 });
    cost += page.cost_usd;
    return page;
  };

  const productPage = await getEvidence(input.input.product_name, productBase);

  const competitorPages: Array<{ name: string; text: string; url: string }> = [];
  for (const c of input.competitors.slice(0, 5)) {
    const page = await getEvidence(c.name, c.url);
    competitorPages.push({ name: c.name, text: page.pricingText, url: page.pricingUrl });
  }

  if (!stub) {
    try {
      const compactCompetitors = competitorPages
        .map(
          (c) =>
            `### ${c.name}\n${pricingSignals(c.text)}\n${truncateForLlm(c.text, 700)}`,
        )
        .join("\n\n");

      const { data, meta } = await completeJson<PricingResult>({
        tier: "fast",
        system:
          "Extract public SaaS pricing tiers from vendor markdown. pricing_model must be one of: per-seat, flat-rate, usage-based, freemium, contact-sales. Do not invent prices. Return JSON only.",
        prompt: `Product: ${input.input.product_name}

Product (${productPage.pricingUrl}):
${pricingSignals(productPage.pricingText)}
${truncateForLlm(productPage.pricingText, 1200)}

Competitors:
${compactCompetitors}

Return:
{
  "product_pricing": { "tiers": [{ "name", "price"?, "currency":"USD", "period"?, "notes"? }] },
  "competitor_pricing": [{ "competitor", "tiers": [...], "pricing_model", "enterprise_custom"? }],
  "price_history_signals": []
}`,
      });
      cost += meta.estimated_cost_usd;
      if (data.product_pricing?.tiers?.length) {
        return {
          pricing: {
            product_pricing: data.product_pricing,
            competitor_pricing: (data.competitor_pricing ?? []).map((c) => ({
              ...c,
              pricing_model:
                c.pricing_model && c.pricing_model !== "unknown"
                  ? c.pricing_model
                  : inferPricingModel(
                      competitorPages.find((p) => p.name === c.competitor)?.text ?? "",
                    ),
              tiers:
                c.tiers?.length
                  ? c.tiers
                  : extractTiersHeuristic(
                      competitorPages.find((p) => p.name === c.competitor)?.text ?? "",
                      c.competitor,
                    ),
            })),
            price_history_signals: data.price_history_signals ?? [],
          },
          cost_usd: cost,
        };
      }
    } catch (err) {
      log.warn("pricing LLM failed; using heuristic fallback", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    pricing: {
      product_pricing: {
        tiers: extractTiersHeuristic(productPage.pricingText, input.input.product_name),
      },
      competitor_pricing: competitorPages.map((c) => ({
        competitor: c.name,
        tiers: extractTiersHeuristic(c.text, c.name),
        pricing_model: inferPricingModel(c.text),
        enterprise_custom: /contact|sales|custom|enterprise/i.test(c.text),
      })),
      price_history_signals: [],
    },
    cost_usd: cost,
  };
}
