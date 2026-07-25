import chalk from "chalk";
import { parseProductConfig, envInt, envOr } from "../config.js";
import { completeJson } from "../llm/groq.js";
import { createLogger } from "../log.js";
import type { ProductConfig } from "../types.js";
import { chunkText, fetchSiteCorpus } from "./fetchPage.js";
import { sanitizeSubreddits } from "./subreddits.js";

const log = createLogger("product.discover");

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Website URL is required");
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let u: URL;
  try {
    u = new URL(withProto);
  } catch {
    throw new Error(`Invalid website URL: ${input}`);
  }
  if (!["http:", "https:"].includes(u.protocol)) {
    throw new Error(`Invalid website URL protocol: ${input}`);
  }
  return u.toString();
}

function clampNeedVeto(n: unknown): number {
  const v = typeof n === "number" ? n : 0.4;
  return Math.min(0.45, Math.max(0.32, v));
}

interface ChunkFacts {
  product_name?: string;
  one_liner?: string;
  audience?: string;
  problem?: string;
  capabilities?: string[];
  keywords?: string[];
  notes?: string;
}

/**
 * Research a product URL without blowing Groq limits:
 * 1) Fetch page text ourselves
 * 2) Chunk it
 * 3) gpt-oss-120b extracts facts per chunk
 * 4) gpt-oss-120b merges into ProductConfig
 *
 * (Compound visit_website dumps whole pages server-side → HTTP 413 on heavy sites.)
 */
export async function discoverProductFromUrl(websiteUrl: string): Promise<{
  product: ProductConfig;
  research: string;
  url: string;
}> {
  const url = normalizeUrl(websiteUrl);
  const structModel = envOr("GROQ_MODEL", "openai/gpt-oss-120b");
  const chunkSize = envInt("PRODUCT_CHUNK_SIZE", 2800);
  const maxChunks = envInt("PRODUCT_MAX_CHUNKS", 6);

  console.log(chalk.cyan(`\nResearching product from ${url}`));
  console.log(chalk.dim("  1) fetch site text (homepage + light related paths)"));

  const corpus = await fetchSiteCorpus(url);
  console.log(
    chalk.dim(
      `     fetched ${corpus.pages.length} page(s), ${corpus.combined.length} chars`,
    ),
  );

  const chunks = chunkText(corpus.combined, chunkSize).slice(0, maxChunks);
  console.log(
    chalk.dim(
      `  2) ${structModel} — extract facts from ${chunks.length} chunk(s)`,
    ),
  );

  const partials: ChunkFacts[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    log.info("chunk extract", { i: i + 1, n: chunks.length, chars: chunk.length });
    console.log(chalk.dim(`     chunk ${i + 1}/${chunks.length} (${chunk.length} chars)`));

    const { data } = await completeJson<ChunkFacts>({
      model: structModel,
      temperature: 0.1,
      maxTokens: 700,
      system: `Extract product facts from ONE website text chunk. Return JSON only.
Only use facts present in the chunk. Omit unknown fields. No marketing fluff.`,
      prompt: `Website: ${url}
Chunk ${i + 1}/${chunks.length}:

${chunk}

Return JSON:
{
  "product_name": string | omit,
  "one_liner": string | omit,
  "audience": string | omit,
  "problem": string | omit,
  "capabilities": string[] | omit,
  "keywords": string[] | omit,
  "notes": string | omit
}`,
    });
    partials.push(data);
  }

  const research = partials
    .map((p, i) => `CHUNK ${i + 1}:\n${JSON.stringify(p, null, 2)}`)
    .join("\n\n");

  console.log(chalk.dim(`  3) ${structModel} — merge chunks → product profile`));
  log.info("structuring product config", {
    url,
    chunks: chunks.length,
    researchChars: research.length,
  });

  const { data } = await completeJson<{
    product_name: string;
    one_liner: string;
    description: string;
    disclosure_line: string;
    keywords: string[];
    subreddits: string[];
    scoring_weights?: ProductConfig["scoring_weights"];
    risk_veto_threshold?: number;
    need_veto_threshold?: number;
    max_posts_per_cycle?: number;
    window_hours?: number;
  }>({
    model: structModel,
    temperature: 0.15,
    maxTokens: 1200,
    system: `You merge chunked website extractions into JSON for a Reddit social-listening auto-poster.
Return JSON only. Rules:
- Prefer consistent facts that appear across chunks; ignore contradictions that look like nav chrome
- keywords: pain/search phrases — 8–20 items
- subreddits: 4–6 real Reddit communities (bare names, no r/) where people ask for tools like this
- disclosure_line: must include the word "disclosure" and the product/site domain
- need_veto_threshold: 0.38–0.42
- scoring_weights: need ~0.4, relevance ~0.3
- max_posts_per_cycle 12, window_hours 24`,
    prompt: `Website: ${url}

Example subreddits (pick relevant ones or better fits):
SaaS, startups, Entrepreneur, productivity, webdev, devops, artificial, MachineLearning, nocode, indiehackers, SideProject, Zapier, automations

Chunk extractions:
${research}

Return JSON:
{
  "product_name": string,
  "one_liner": string,
  "description": string,
  "disclosure_line": string,
  "keywords": string[],
  "subreddits": string[],
  "scoring_weights": {
    "relevance": number,
    "need": number,
    "community_risk": number,
    "competitor": number
  },
  "risk_veto_threshold": number,
  "need_veto_threshold": number,
  "max_posts_per_cycle": number,
  "window_hours": number
}`,
  });

  const product = parseProductConfig({
    product_name: data.product_name,
    one_liner: data.one_liner,
    description: data.description,
    disclosure_line: data.disclosure_line,
    keywords: data.keywords,
    subreddits: sanitizeSubreddits(data.subreddits),
    scoring_weights: data.scoring_weights ?? {
      relevance: 0.3,
      need: 0.4,
      community_risk: 0.15,
      competitor: 0.15,
    },
    risk_veto_threshold: Math.min(
      0.4,
      Math.max(0.2, data.risk_veto_threshold ?? 0.25),
    ),
    need_veto_threshold: clampNeedVeto(data.need_veto_threshold),
    max_posts_per_cycle: data.max_posts_per_cycle ?? 12,
    window_hours: data.window_hours ?? 24,
  });

  console.log(chalk.green(`\nProduct profile ready: ${product.product_name}`));
  console.log(chalk.dim(`  ${product.one_liner}`));
  console.log(
    chalk.dim(`  subreddits: ${product.subreddits.join(", ") || "(none)"}`),
  );
  console.log(
    chalk.dim(
      `  keywords: ${product.keywords.slice(0, 8).join(", ")}${product.keywords.length > 8 ? "…" : ""}`,
    ),
  );
  console.log(
    chalk.dim(
      `  thresholds: need_veto=${product.need_veto_threshold} risk_veto=${product.risk_veto_threshold}`,
    ),
  );
  console.log(chalk.dim(`  disclosure: ${product.disclosure_line}\n`));

  return { product, research, url };
}
