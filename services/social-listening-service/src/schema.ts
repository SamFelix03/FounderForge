import { z } from "zod";
import {
  CostLineSchema,
  SocialListeningInputSchema,
} from "@founderforge/schemas";

export const InputSchema = SocialListeningInputSchema;
export type Input = z.infer<typeof InputSchema>;

export const PostResultSchema = z.object({
  target_permalink: z.string(),
  draft_text: z.string(),
  status: z.enum(["posted", "dry_run", "skipped", "failed"]),
  result_permalink: z.string().optional(),
  error: z.string().optional(),
  community: z.string().nullable().optional(),
});

export const OutputSchema = z.object({
  product_name: z.string(),
  posted_urls: z.array(z.string()),
  posts: z.array(PostResultSchema),
  posts_attempted: z.number().int().nonnegative(),
  live: z.boolean(),
  cost_breakdown: z.array(CostLineSchema),
});

export type Output = z.infer<typeof OutputSchema>;
export type PostResult = z.infer<typeof PostResultSchema>;
