import { z } from "zod";

export const InputSchema = z.object({
  brand_name: z.string().min(1).max(80),
  description: z.string().min(10).max(2000),
  pick: z.number().int().min(0).max(5).default(0),
});

export type Input = z.infer<typeof InputSchema>;

export const OutputSchema = z.object({
  status: z.literal("ok"),
  brand_name: z.string(),
  chosen_concept: z.string(),
  palette: z.record(z.string()),
  typography: z.record(z.unknown()),
  zip_url: z.string().url(),
  object_key: z.string().optional(),
  cost_breakdown: z
    .array(
      z.object({
        vendor: z.string(),
        operation: z.string(),
        amount_usd: z.number(),
        units: z.number().optional(),
      }),
    )
    .optional()
    .default([]),
});

export type Output = z.infer<typeof OutputSchema>;
