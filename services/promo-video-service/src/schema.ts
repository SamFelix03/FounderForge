import { z } from "zod";
import {
  CostLineSchema,
  PromoVideoInputSchema,
} from "@founderforge/schemas";

export const InputSchema = PromoVideoInputSchema;
export type Input = z.infer<typeof InputSchema>;

export const OutputSchema = z.object({
  video_url: z.string().url(),
  request_id: z.string().optional(),
  duration_seconds: z.number().int().positive(),
  concept: z.string().optional(),
  image_urls: z.array(z.string().url()).optional(),
  cost_breakdown: z.array(CostLineSchema),
});

export type Output = z.infer<typeof OutputSchema>;
