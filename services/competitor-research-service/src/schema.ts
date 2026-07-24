import { CompetitorResearchInputSchema } from "@founderforge/schemas";
import { z } from "zod";

export const InputSchema = CompetitorResearchInputSchema;
export type Input = z.infer<typeof InputSchema>;

export const CompetitorSchema = z.object({
  name: z.string(),
  url: z.string().url(),
  confidence: z.number().min(0).max(1),
  sources: z.array(z.string()),
  category_match: z.string().optional(),
});

export const FeatureCellSchema = z.object({
  status: z.enum(["yes", "partial", "no", "unknown"]),
  evidence_url: z.string().optional(),
  scraped_at: z.string().optional(),
});

export const FeatureDiffSchema = z.object({
  features: z.array(z.string()),
  matrix: z.record(z.record(FeatureCellSchema)),
  conflicts: z
    .array(
      z.object({
        feature: z.string(),
        competitor: z.string(),
        conflicting_sources: z.array(z.string()),
      }),
    )
    .default([]),
});

export const PricingTierSchema = z.object({
  product_pricing: z.object({
    tiers: z.array(
      z.object({
        name: z.string(),
        price: z.number().optional(),
        currency: z.string().default("USD"),
        period: z.string().optional(),
        notes: z.string().optional(),
      }),
    ),
  }),
  competitor_pricing: z.array(
    z.object({
      competitor: z.string(),
      tiers: z.array(z.record(z.unknown())),
      pricing_model: z.string().optional(),
      enterprise_custom: z.boolean().optional(),
    }),
  ),
  price_history_signals: z
    .array(
      z.object({
        competitor: z.string(),
        change: z.string(),
        observed_between: z.tuple([z.string(), z.string()]),
      }),
    )
    .default([]),
});

export const PositioningSchema = z.object({
  swot: z.object({
    strengths: z.array(z.string()),
    weaknesses: z.array(z.string()),
    opportunities: z.array(z.string()),
    threats: z.array(z.string()),
  }),
  positioning_map: z.object({
    axes: z.tuple([z.string(), z.string()]),
    points: z.array(
      z.object({
        name: z.string(),
        x: z.number(),
        y: z.number(),
      }),
    ),
  }),
  recommended_positioning: z.array(
    z.object({
      angle: z.string(),
      supporting_facts: z.array(z.string()),
    }),
  ),
  risks: z.array(z.string()),
});

export const OutputSchema = z.object({
  competitors: z.array(CompetitorSchema),
  feature_diff: FeatureDiffSchema,
  pricing: PricingTierSchema,
  positioning: PositioningSchema,
  report: z.object({
    pdf_url: z.string().url(),
    object_key: z.string().optional(),
    html_preview: z.string().optional(),
  }),
  cost_breakdown: z.array(
    z.object({
      vendor: z.string(),
      operation: z.string(),
      amount_usd: z.number(),
    }),
  ),
});

export type Output = z.infer<typeof OutputSchema>;
export type Competitor = z.infer<typeof CompetitorSchema>;
export type FeatureDiff = z.infer<typeof FeatureDiffSchema>;
export type PricingResult = z.infer<typeof PricingTierSchema>;
export type Positioning = z.infer<typeof PositioningSchema>;
