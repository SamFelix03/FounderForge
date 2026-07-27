import { reviewCompliance } from "../agents/compliance.js";
import { dedupAndRateLimit } from "../agents/dedup.js";
import { writeDraft } from "../agents/draft.js";
import {
  insertCandidate,
  insertScheduledPost,
  resetMemoryStore,
  updateScheduledPost,
  upsertEvent,
} from "../db/repos.js";
import { recordSuccessfulPost } from "../feedback/learn.js";
import { canIngestViaCompound } from "../ingest/compoundIngest.js";
import { canIngestViaTavily } from "../ingest/tavilyIngest.js";
import { canIngestReddit, ingestReddit } from "../ingest/reddit.js";
import { envOr } from "../config.js";
import { createLogger } from "../log.js";
import { executePost } from "../post/executor.js";
import { discoverProductFromUrl } from "../product/discover.js";
import { formatInterval } from "../schedule/spread24h.js";
import type {
  DraftCandidate,
  NormalizedEvent,
  ProductConfig,
} from "../types.js";

const log = createLogger("pipeline.plan");

export interface PlanPostResult {
  targetPermalink: string;
  draftText: string;
  status: "posted" | "dry_run" | "skipped" | "failed";
  resultPermalink?: string;
  error?: string;
  community?: string | null;
}

export interface PlanResult {
  product: ProductConfig;
  posts: PlanPostResult[];
  n: number;
  intervalLabel: string;
  live: boolean;
}

/**
 * Plan cycle: discover product → Tavily threads → draft → post.
 * No embedding / signal scoring — Tavily results are trusted.
 */
export async function runPlanCycle(opts: {
  live: boolean;
  websiteUrl: string;
  product?: ProductConfig;
  maxPosts?: number;
  onStep?: (step: string) => void | Promise<void>;
  resetStore?: boolean;
}): Promise<PlanResult> {
  if (opts.resetStore !== false) resetMemoryStore();

  const phase = async (name: string) => {
    log.info(name);
    if (opts.onStep) await opts.onStep(name);
  };

  await phase("discover_product");
  const product =
    opts.product || (await discoverProductFromUrl(opts.websiteUrl)).product;
  if (opts.maxPosts && opts.maxPosts > 0) {
    product.max_posts_per_cycle = opts.maxPosts;
  }
  const maxN = product.max_posts_per_cycle;

  log.info("plan cycle start", {
    product: product.product_name,
    website: opts.websiteUrl,
    maxN,
    live: opts.live,
  });

  if (!canIngestReddit()) {
    throw new Error(
      "Need TAVILY_API_KEY (preferred), or GROQ + Reddit session / RAPIDAPI_KEY",
    );
  }

  const ingestLabel = (() => {
    const pref = envOr("REDDIT_INGEST", "tavily").toLowerCase();
    if (pref === "tavily" || (pref === "auto" && canIngestViaTavily())) {
      return "Tavily → draft";
    }
    if (pref === "reddapi") return "ReddAPI";
    if (pref === "compound" || pref === "playwright" || canIngestViaCompound()) {
      return "Compound → Playwright";
    }
    return canIngestViaTavily() ? "Tavily → draft" : "ReddAPI";
  })();
  log.info("reddit ingest", { provider: ingestLabel, subs: product.subreddits });

  await phase("discover_threads");
  const events = await ingestReddit(product).catch((err) => {
    log.warn("reddit ingest error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [] as NormalizedEvent[];
  });
  const threads = events
    .filter((e) => e.external_id.startsWith("post_") || !e.parent_id)
    .slice(0, maxN);
  log.info("ingested threads", { total: events.length, using: threads.length });

  await phase("draft");
  const ready: Array<{ candidateId: string; candidate: DraftCandidate }> = [];
  const funnel = { ingested: threads.length, dedup: 0, draft: 0, compliance: 0 };

  for (const event of threads) {
    if (ready.length >= maxN) break;

    const dedup = await dedupAndRateLimit(event);
    if (!dedup.pass) {
      await upsertEvent(event, {
        stage: "dedup",
        reason: dedup.reason || "fail",
      });
      continue;
    }
    funnel.dedup += 1;

    const eventId = await upsertEvent(event);

    let draft;
    try {
      draft = await writeDraft(event, product);
    } catch (err) {
      log.warn("draft failed", {
        id: event.external_id,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    funnel.draft += 1;

    const compliance = await reviewCompliance(event, product, draft.draft_text);
    if (!compliance.ok) {
      await upsertEvent(event, {
        stage: "compliance",
        reason: compliance.notes || "fail",
      });
      log.warn("compliance failed", {
        id: event.external_id,
        reason: compliance.notes,
      });
      continue;
    }
    funnel.compliance += 1;

    const candidate: DraftCandidate = {
      event,
      draft_text: draft.draft_text,
      draft_rationale: draft.draft_rationale,
      compliance_ok: true,
      compliance_notes: compliance.notes,
    };

    const candidateId = await insertCandidate(eventId, candidate);
    ready.push({ candidateId, candidate });
  }

  const N = ready.length;
  const intervalLabel = formatInterval(product.window_hours, N);
  log.info("funnel", funnel);

  const posts: PlanPostResult[] = [];

  await phase("post");
  for (let index = 0; index < ready.length; index++) {
    const { candidateId, candidate: c } = ready[index]!;
    const scheduledId = await insertScheduledPost({
      candidateId,
      platform: c.event.platform,
      targetRef: c.event.external_id,
      community: c.event.community,
      draftText: c.draft_text,
      permalinkTarget: c.event.permalink,
      scheduledAt: new Date(Date.now() + index * 3_000),
    });

    const row = {
      id: scheduledId,
      candidate_id: candidateId,
      platform: c.event.platform,
      target_ref: c.event.external_id,
      community: c.event.community,
      draft_text: c.draft_text,
      permalink_target: c.event.permalink,
      scheduled_at: new Date(),
      status: "pending" as const,
      posted_at: null,
      result_permalink: null,
      error: null,
    };

    const result = await executePost(row, opts.live);
    await updateScheduledPost(scheduledId, {
      status: result.status,
      resultPermalink: result.permalink ?? null,
      error: result.error ?? null,
    });
    if (result.status === "posted" || result.status === "dry_run") {
      await recordSuccessfulPost(row);
    }

    posts.push({
      targetPermalink: c.event.permalink,
      draftText: c.draft_text,
      status: result.status,
      resultPermalink: result.permalink,
      error: result.error,
      community: c.event.community,
    });
  }

  return {
    product,
    posts,
    n: N,
    intervalLabel,
    live: opts.live,
  };
}
