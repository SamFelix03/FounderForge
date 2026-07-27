import { z } from "zod";
import {
  CostLineSchema,
  SocialListeningInputSchema,
} from "@founderforge/schemas";

export const InputSchema = SocialListeningInputSchema;
export type Input = z.infer<typeof InputSchema>;

export const RecommendationSchema = z.object({
  target_permalink: z.string(),
  draft_text: z.string(),
  title: z.string().optional(),
  status: z.enum(["included", "skipped"]),
  community: z.string().nullable().optional(),
  skip_reason: z.string().optional(),
});

export const OutputSchema = z.object({
  product_name: z.string(),
  pdf_url: z.string().url(),
  object_key: z.string(),
  thread_urls: z.array(z.string()),
  recommendations: z.array(RecommendationSchema),
  recommendations_count: z.number().int().nonnegative(),
  cost_breakdown: z.array(CostLineSchema),
});

export type Output = z.infer<typeof OutputSchema>;
export type Recommendation = z.infer<typeof RecommendationSchema>;
