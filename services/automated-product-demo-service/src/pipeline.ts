import { InputSchema, type Input, type Output } from "./schema.js";

/** Placeholder until media/browser/TTS modules land. */
export async function runPipeline(rawInput: Input): Promise<Output> {
  InputSchema.parse(rawInput);
  throw new Error(
    "automated-product-demo pipeline is not implemented yet — media/browser modules pending",
  );
}
