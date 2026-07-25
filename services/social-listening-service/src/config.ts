import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { ProductConfig } from "./types.js";

const serviceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Monorepo root (FounderForge/) — Reddit profile + cookies live here by default. */
const monorepoRoot = path.resolve(serviceDir, "../..");

export const ProductSchema = z.object({
  product_name: z.string().min(1),
  one_liner: z.string().min(1),
  description: z.string().min(1),
  disclosure_line: z.string().min(1),
  keywords: z.array(z.string()).default([]),
  subreddits: z.array(z.string()).default([]),
  scoring_weights: z
    .object({
      relevance: z.number(),
      need: z.number(),
      community_risk: z.number(),
      competitor: z.number(),
    })
    .default({
      relevance: 0.25,
      need: 0.45,
      community_risk: 0.15,
      competitor: 0.15,
    }),
  risk_veto_threshold: z.number().min(0).max(1).default(0.25),
  need_veto_threshold: z.number().min(0).max(1).default(0.4),
  max_posts_per_cycle: z.number().int().positive().default(12),
  window_hours: z.number().positive().default(24),
});

export function projectRoot(): string {
  return monorepoRoot;
}

export function serviceRoot(): string {
  return serviceDir;
}

export function parseProductConfig(raw: unknown): ProductConfig {
  return ProductSchema.parse(raw);
}

export function envOrThrow(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is required`);
  return v;
}

export function envOr(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export function envInt(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(n) ? n : fallback;
}

export function redditProfileDir(): string {
  const override = envOr("REDDIT_PROFILE_DIR");
  if (override) {
    return path.isAbsolute(override) ? override : path.join(projectRoot(), override);
  }
  return path.join(projectRoot(), ".reddit-profile");
}

export function groqModel(): string {
  return (
    envOr("GROQ_MODEL") ||
    envOr("GROQ_MODEL_BALANCED") ||
    "openai/gpt-oss-120b"
  );
}
