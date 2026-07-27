import { createLogger } from "@founderforge/observability";
import { runPlanCycle } from "./pipeline/planCycle.js";
import {
  ensureRedditSessionLocal,
  redditSessionRemoteEnabled,
  syncRedditSessionToStorageIfRemote,
} from "./redditSessionStorage.js";
import { InputSchema, type Input, type Output } from "./schema.js";

const log = createLogger("social-listening.pipeline");

export interface PipelineOptions {
  onStep?: (step: string) => void | Promise<void>;
}

/**
 * URL in → Reddit engagement pipeline → posted_urls out.
 * Default live=false (dry-run). Set input.live=true to post via Playwright (no ReddAPI).
 * When REDDIT_SESSION_REMOTE is on, pulls Chrome profile + cookies from Supabase first.
 */
export async function runPipeline(
  rawInput: Input,
  opts: PipelineOptions = {},
): Promise<Output> {
  const input = InputSchema.parse(rawInput);
  log.info("starting social listening pipeline", {
    product_url: input.product_url,
    live: input.live,
    max_posts: input.max_posts ?? null,
  });

  if (redditSessionRemoteEnabled()) {
    await opts.onStep?.("reddit_session_pull");
    const session = await ensureRedditSessionLocal();
    log.info("reddit session paths", {
      pulled: session.pulled,
      profileDir: session.profileDir,
      cookiesPath: session.cookiesPath,
    });
  }

  const costs: Output["cost_breakdown"] = [];
  const result = await runPlanCycle({
    live: input.live,
    websiteUrl: input.product_url,
    maxPosts: input.max_posts,
    onStep: opts.onStep,
  });

  if (input.live && redditSessionRemoteEnabled()) {
    await syncRedditSessionToStorageIfRemote();
  }

  costs.push({
    vendor: "llm",
    operation: "discover_product",
    amount_usd: 0.02,
  });
  costs.push({
    vendor: "llm",
    operation: "draft",
    amount_usd: 0.05 * Math.max(1, result.posts.length),
  });
  if (input.live) {
    const posted = result.posts.filter((p) => p.status === "posted").length;
    if (posted > 0) {
      costs.push({
        vendor: "playwright",
        operation: "comment",
        amount_usd: 0,
        units: posted,
      });
    }
  }

  const posted_urls = result.posts
    .filter((p) => p.status === "posted" || p.status === "dry_run")
    .map((p) => p.resultPermalink || p.targetPermalink)
    .filter(Boolean);

  return {
    product_name: result.product.product_name,
    posted_urls,
    posts: result.posts.map((p) => ({
      target_permalink: p.targetPermalink,
      draft_text: p.draftText,
      status: p.status,
      result_permalink: p.resultPermalink,
      error: p.error,
      community: p.community ?? null,
    })),
    posts_attempted: result.posts.length,
    live: result.live,
    cost_breakdown: costs,
  };
}
