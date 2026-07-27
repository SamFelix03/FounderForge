import { createLogger } from "@founderforge/observability";
import { runPlanCycle } from "./pipeline/planCycle.js";
import { InputSchema, type Input, type Output } from "./schema.js";

const log = createLogger("social-listening.pipeline");

export interface PipelineOptions {
  onStep?: (step: string) => void | Promise<void>;
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
    max_posts: input.max_posts ?? null,
  });

  const costs: Output["cost_breakdown"] = [];
  const result = await runPlanCycle({
    websiteUrl: input.product_url,
    maxPosts: input.max_posts,
    onStep: opts.onStep,
  });

  costs.push({
    vendor: "llm",
    operation: "discover_product",
    amount_usd: 0.02,
  });
  costs.push({
    vendor: "llm",
    operation: "draft",
    amount_usd: 0.05 * Math.max(1, result.n),
  });
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
