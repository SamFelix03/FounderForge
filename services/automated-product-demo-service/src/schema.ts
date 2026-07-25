import { z } from "zod";

export const InputSchema = z.object({
  // Placeholder — replace per product
  note: z.string().optional(),
}).passthrough();

export type Input = z.infer<typeof InputSchema>;

export const OutputSchema = z.object({
  status: z.literal("not_implemented"),
  message: z.string(),
});

export type Output = z.infer<typeof OutputSchema>;
