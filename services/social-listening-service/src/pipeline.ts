import { createLogger } from "@founderforge/observability";
import { isProductUrlError } from "@founderforge/schemas";
import { parseProductConfig } from "./config.js";
import { runPlanCycle } from "./pipeline/planCycle.js";
import { sanitizeSubreddits } from "./product/subreddits.js";
import { InputSchema, type Input, type Output } from "./schema.js";
import type { ProductConfig } from "./types.js";

const log = createLogger("social-listening.pipeline");

export interface PipelineOptions {
  onStep?: (step: string) => void | Promise<void>;
}

function productFromNameFallback(name: string, websiteUrl: string): ProductConfig {
  let host = "the product site";
  try {
    host = new URL(websiteUrl).hostname.replace(/^www\./, "");
  } catch {
    /* keep default */
  }
  return parseProductConfig({
    product_name: name,
    one_liner: `${name} — product details inferred from name because the website could not be scraped.`,
    description: `${name} (website: ${websiteUrl}). Site content was unavailable; Reddit discovery uses the product name and generic SaaS communities.`,
    disclosure_line: `Disclosure: I work on ${name} (${host}).`,
    keywords: [
      name,
      `${name} alternative`,
      `${name} tool`,
      "freelancer tools",
      "productivity software",
      "project management",
      "saas tools",
      "indie hackers",
    ],
    subreddits: sanitizeSubreddits([
      "SaaS",
      "startups",
      "Entrepreneur",
      "productivity",
      "indiehackers",
      "SideProject",
    ]),
    max_posts_per_cycle: 5,
    window_hours: 24,
  });
}

/**
 * URL in → Tavily thread discovery → Groq drafts → PDF report on Supabase.
 * No auto-posting — returns a clickable pdf_url with copy-paste comments.
 */
export async function runPipeline(
  rawInput: Input,
  opts: PipelineOptions = {},
): Promise<Output> {
  const input = InputSchema.parse(rawInput);
  log.info("starting social listening pipeline", {
    product_url: input.product_url,
    product_name: input.product_name ?? null,
    max_posts: input.max_posts ?? null,
  });

  const costs: Output["cost_breakdown"] = [];
  let result;
  try {
    result = await runPlanCycle({
      websiteUrl: input.product_url,
      maxPosts: input.max_posts,
      onStep: opts.onStep,
    });
  } catch (err) {
    if (isProductUrlError(err) && input.product_name?.trim()) {
      log.warn("product URL scrape failed; using product_name fallback", {
        code: err.code,
        product_name: input.product_name,
      });
      result = await runPlanCycle({
        websiteUrl: input.product_url,
        product: productFromNameFallback(input.product_name.trim(), input.product_url),
        maxPosts: input.max_posts,
        onStep: opts.onStep,
      });
    } else {
      throw err;
    }
  }

  costs.push({
    vendor: "llm",
    operation: "discover_product",
    amount_usd: 0.02,
  });
  if (result.n > 0) {
    costs.push({
      vendor: "llm",
      operation: "draft",
      amount_usd: 0.05 * result.n,
    });
  }
  costs.push({
    vendor: "tavily",
    operation: "reddit_research",
    amount_usd: 0.03,
  });

  const thread_urls = result.recommendations
    .filter((r) => r.status === "included")
    .map((r) => r.targetPermalink);

  return {
    product_name: result.product.product_name,
    pdf_url: result.report.pdf_url,
    object_key: result.report.object_key,
    thread_urls,
    recommendations: result.recommendations.map((r) => ({
      target_permalink: r.targetPermalink,
      draft_text: r.draftText,
      title: r.title,
      status: r.status,
      community: r.community ?? null,
      skip_reason: r.skipReason,
    })),
    recommendations_count: result.n,
    cost_breakdown: costs,
  };
}
