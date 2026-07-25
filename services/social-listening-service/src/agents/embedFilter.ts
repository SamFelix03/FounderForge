import {
  cosineSimilarity,
  embedText,
} from "../embeddings/local.js";
import {
  getProductEmbedding,
  topFewShotEmbeddings,
  upsertProductEmbedding,
} from "../db/repos.js";
import { eventText } from "../ingest/normalize.js";
import type { NormalizedEvent, ProductConfig } from "../types.js";

/** Lower = wider recall; scorers/compliance still gate quality. */
const THRESHOLD = 0.22;

export async function ensureProductEmbedding(
  product: ProductConfig,
): Promise<number[]> {
  const desc = `${product.product_name}\n${product.one_liner}\n${product.description}`;
  const cached = await getProductEmbedding();
  if (cached?.embedding?.length && cached.description === desc) {
    return cached.embedding;
  }
  const emb = await embedText(desc);
  await upsertProductEmbedding(desc, emb);
  return emb;
}

export async function stage1EmbedFilter(
  event: NormalizedEvent,
  productEmbedding: number[],
): Promise<{ pass: boolean; score: number; reason?: string }> {
  const emb = await embedText(eventText(event));
  const vsProduct = cosineSimilarity(emb, productEmbedding);

  const few = await topFewShotEmbeddings(12);
  let vsFew = 0;
  if (few.length) {
    vsFew = Math.max(...few.map((f) => cosineSimilarity(emb, f)));
  }

  const score = Math.max(vsProduct, vsFew * 0.95);
  if (score < THRESHOLD) {
    return { pass: false, score, reason: `embedding_below_${THRESHOLD}` };
  }
  return { pass: true, score };
}
