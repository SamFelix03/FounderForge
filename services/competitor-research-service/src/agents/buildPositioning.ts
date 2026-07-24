import { completeJson } from "@founderforge/llm-core";
import { createLogger } from "@founderforge/observability";
import {
  PositioningSchema,
  type FeatureDiff,
  type Positioning,
  type PricingResult,
} from "../schema.js";

const log = createLogger("buildPositioning");

function lowestPrice(tiers: Array<{ price?: number }>): number | undefined {
  const prices = tiers
    .map((t) => t.price)
    .filter((p): p is number => typeof p === "number" && Number.isFinite(p));
  if (!prices.length) return undefined;
  return Math.min(...prices);
}

function featureBreadth(matrix: FeatureDiff["matrix"][string] | undefined, features: string[]): number {
  if (!features.length) return 0.5;
  let score = 0;
  for (const f of features) {
    const st = matrix?.[f]?.status ?? "unknown";
    if (st === "yes") score += 1;
    else if (st === "partial") score += 0.5;
  }
  return score / features.length;
}

/**
 * Always build a complete positioning map from pricing + feature evidence
 * so the PDF chart never renders empty.
 */
export function buildDeterministicMap(
  productName: string,
  feature_diff: FeatureDiff,
  pricing: PricingResult,
): Positioning["positioning_map"] {
  type Point = { name: string; price?: number; breadth: number };
  const points: Point[] = [
    {
      name: productName,
      price: lowestPrice(pricing.product_pricing.tiers),
      breadth: featureBreadth(feature_diff.matrix[productName], feature_diff.features),
    },
    ...pricing.competitor_pricing.map((c) => ({
      name: c.competitor,
      price: lowestPrice((c.tiers ?? []) as Array<{ price?: number }>),
      breadth: featureBreadth(feature_diff.matrix[c.competitor], feature_diff.features),
    })),
  ];

  const knownPrices = points
    .map((p) => p.price)
    .filter((p): p is number => typeof p === "number");
  const minP = knownPrices.length ? Math.min(...knownPrices) : 0;
  const maxP = knownPrices.length ? Math.max(...knownPrices) : 1;
  const span = Math.max(1, maxP - minP);

  // Undisclosed prices sit on the far-right "custom/enterprise" band; spread
  // them vertically-independent x so labels don't stack.
  const undisclosed = points.filter((p) => typeof p.price !== "number");
  const undisclosedIndex = new Map<string, number>();
  undisclosed.forEach((p, i) => undisclosedIndex.set(p.name, i));

  return {
    axes: ["monthly price (public list)", "feature breadth (evidenced)"],
    points: points.map((p) => {
      let x: number;
      if (typeof p.price === "number") {
        // Normalise into the left 0.75 of the plot; right quarter is "custom".
        x = span > 0 ? 0.08 + ((p.price - minP) / span) * 0.62 : 0.2;
      } else {
        const i = undisclosedIndex.get(p.name) ?? 0;
        const n = Math.max(1, undisclosed.length);
        x = 0.82 + (n > 1 ? (i / (n - 1)) * 0.1 - 0.05 : 0);
      }
      return {
        name: p.name,
        x: Math.max(0.06, Math.min(0.94, x)),
        y: Math.max(0.08, Math.min(0.94, p.breadth)),
      };
    }),
  };
}

function compactEvidence(
  productName: string,
  feature_diff: FeatureDiff,
  pricing: PricingResult,
): string {
  const featureLines = feature_diff.features.map((f) => {
    const cells = Object.entries(feature_diff.matrix)
      .map(([entity, row]) => `${entity}:${row?.[f]?.status ?? "?"}`)
      .join(", ");
    return `${f} → ${cells}`;
  });
  const priceLines = [
    `${productName}: ${pricing.product_pricing.tiers
      .map((t) => `${t.name}${t.price != null ? ` $${t.price}` : ""}`)
      .join("; ")}`,
    ...pricing.competitor_pricing.map(
      (c) =>
        `${c.competitor} (${c.pricing_model ?? "?"}): ${(c.tiers as Array<{ name?: string; price?: number }>)
          .map((t) => `${t.name ?? "?"}${t.price != null ? ` $${t.price}` : ""}`)
          .join("; ")}`,
    ),
  ];
  return `Features:\n${featureLines.join("\n")}\n\nPricing:\n${priceLines.join("\n")}`;
}

export async function buildPositioning(
  input: {
    productName: string;
    feature_diff: FeatureDiff;
    pricing: PricingResult;
  },
  opts?: { stub?: boolean },
): Promise<{ positioning: Positioning; cost_usd: number }> {
  const map = buildDeterministicMap(
    input.productName,
    input.feature_diff,
    input.pricing,
  );

  if (opts?.stub === true) {
    const competitorNames = input.pricing.competitor_pricing.map((c) => c.competitor);
    return {
      positioning: {
        swot: {
          strengths: ["Evidenced public feature coverage"],
          weaknesses: ["Test fixture positioning"],
          opportunities: ["Expand cited differentiation"],
          threats: competitorNames.slice(0, 3),
        },
        positioning_map: map,
        recommended_positioning: [
          {
            angle: "Lead with evidenced capabilities",
            supporting_facts: ["Derived from public pricing and feature pages"],
          },
        ],
        risks: ["Test fixture — not a live LLM synthesis"],
      },
      cost_usd: 0,
    };
  }

  try {
    // Brief pause so parallel feature/pricing calls don't trip Groq TPM limits
    await new Promise((r) => setTimeout(r, 2500));
    const { data, meta } = await completeJson<{
      swot: Positioning["swot"];
      recommended_positioning: Positioning["recommended_positioning"];
      risks: string[];
    }>({
      tier: "strong",
      temperature: 0.3,
      system:
        "Competitive strategist. Cite concrete prices/features only. No slogans. Return JSON only.",
      prompt: `Product: ${input.productName}

${compactEvidence(input.productName, input.feature_diff, input.pricing)}

Return:
{
  "swot": { "strengths": string[], "weaknesses": string[], "opportunities": string[], "threats": string[] },
  "recommended_positioning": [{ "angle": string, "supporting_facts": string[] }],
  "risks": string[]
}
Rules: 3-4 recommendations; each must name a peer and a concrete evidence point.`,
    });
    return {
      positioning: PositioningSchema.parse({
        swot: data.swot,
        positioning_map: map,
        recommended_positioning: data.recommended_positioning,
        risks: data.risks,
      }),
      cost_usd: meta.estimated_cost_usd,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/429|rate_limit/i.test(msg)) {
      try {
        await new Promise((r) => setTimeout(r, 3500));
        const { data, meta } = await completeJson<{
          swot: Positioning["swot"];
          recommended_positioning: Positioning["recommended_positioning"];
          risks: string[];
        }>({
          tier: "fast",
          temperature: 0.2,
          system:
            "Competitive strategist. Cite concrete prices/features only. Return JSON only.",
          prompt: `Product: ${input.productName}

${compactEvidence(input.productName, input.feature_diff, input.pricing)}

Return { "swot": { "strengths","weaknesses","opportunities","threats" }, "recommended_positioning": [{ "angle", "supporting_facts" }], "risks": string[] }
3 recommendations max.`,
        });
        return {
          positioning: PositioningSchema.parse({
            swot: data.swot,
            positioning_map: map,
            recommended_positioning: data.recommended_positioning,
            risks: data.risks,
          }),
          cost_usd: meta.estimated_cost_usd,
        };
      } catch (err2) {
        log.warn("positioning LLM retry failed; using deterministic fallback", {
          error: err2 instanceof Error ? err2.message : String(err2),
        });
      }
    } else {
      log.warn("positioning LLM failed; using deterministic fallback", { error: msg });
    }
    const peers = input.pricing.competitor_pricing.map((c) => c.competitor);
    return {
      positioning: {
        swot: {
          strengths: [
            `${input.productName} public feature coverage scored against ${peers.length} peers`,
          ],
          weaknesses: ["Some vendors disclose limited public pricing"],
          opportunities: ["Differentiate on evidenced feature gaps"],
          threats: peers.slice(0, 3),
        },
        positioning_map: map,
        recommended_positioning: [
          {
            angle: "Compete on evidenced capability density",
            supporting_facts: [
              "Positioning map derived from public list prices and feature evidence",
            ],
          },
        ],
        risks: [
          "Synthesis fallback used after LLM error — map/pricing still from public pages",
        ],
      },
      cost_usd: 0,
    };
  }
}
