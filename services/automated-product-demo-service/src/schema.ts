import { AutomatedProductDemoInputSchema } from "@founderforge/schemas";
import { z } from "zod";

export const InputSchema = AutomatedProductDemoInputSchema;
export type Input = z.infer<typeof InputSchema>;

export const DemoStepSchema = z.object({
  id: z.number().int(),
  instruction: z.string(),
  narration_draft: z.string().optional(),
});

export const CostLineSchema = z.object({
  vendor: z.string(),
  operation: z.string(),
  amount_usd: z.number(),
});

export const OutputSchema = z.object({
  video_url: z.string().url(),
  duration_seconds: z.number().optional(),
  object_key: z.string().optional(),
  cost_breakdown: z.array(CostLineSchema).default([]),
  steps: z
    .array(
      z.object({
        id: z.number().int(),
        instruction: z.string(),
        success: z.boolean().optional(),
        duration: z.number().optional(),
      }),
    )
    .default([]),
});

export type Output = z.infer<typeof OutputSchema>;
export type DemoStep = z.infer<typeof DemoStepSchema>;
