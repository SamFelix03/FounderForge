import { createLogger } from "../log.js";

const log = createLogger("embeddings");

const DIM = 384;
let pipelinePromise: Promise<{
  (text: string, opts: { pooling: string; normalize: boolean }): Promise<{ data: Float32Array }>;
}> | null = null;
let useFallback = false;

async function getPipeline() {
  if (useFallback) return null;
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      try {
        const { pipeline } = await import("@xenova/transformers");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2")) as any;
      } catch (err) {
        log.warn("transformers unavailable — using hash fallback embeddings", {
          error: err instanceof Error ? err.message : String(err),
        });
        useFallback = true;
        return null;
      }
    })();
  }
  return pipelinePromise;
}

/** Deterministic bag-of-words hashing when transformers can't load. */
function hashEmbed(text: string): number[] {
  const vec = new Array<number>(DIM).fill(0);
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (const tok of tokens) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % DIM;
    vec[idx]! += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
  return vec.map((x) => x / norm);
}

export async function embedText(text: string): Promise<number[]> {
  const pipe = await getPipeline();
  if (!pipe) return hashEmbed(text);
  const out = await pipe(text.slice(0, 8000), {
    pooling: "mean",
    normalize: true,
  });
  return Array.from(out.data);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export { DIM as EMBEDDING_DIM };
