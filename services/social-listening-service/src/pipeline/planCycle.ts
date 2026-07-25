import { aggregateScores } from "../agents/aggregator.js";
import { reviewCompliance } from "../agents/compliance.js";
import { dedupAndRateLimit } from "../agents/dedup.js";
import { writeDraft } from "../agents/draft.js";
import {
  ensureProductEmbedding,
  stage1EmbedFilter,
} from "../agents/embedFilter.js";
import { stage0Prefilter } from "../agents/prefilter.js";
import { scoreSignals } from "../agents/scorers.js";
import {
  insertCandidate,
  insertScheduledPost,
  resetMemoryStore,
  updateScheduledPost,
  upsertEvent,
} from "../db/repos.js";
import { recordSuccessfulPost } from "../feedback/learn.js";
import { canIngestViaCompound } from "../ingest/compoundIngest.js";
import { canIngestReddit, ingestReddit } from "../ingest/reddit.js";
import { envInt, envOr } from "../config.js";
import { groqPoolSize } from "../llm/groq.js";
import { createLogger } from "../log.js";
import { executePost } from "../post/executor.js";
import { discoverProductFromUrl } from "../product/discover.js";
import { formatInterval } from "../schedule/spread24h.js";
import type { NormalizedEvent, ProductConfig, ScoredCandidate } from "../types.js";

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

interface ReadyRow {
  candidateId: string;
  candidate: ScoredCandidate;
}

interface EmbedPass {
  event: NormalizedEvent;
  embedScore: number;
}

/**
 * Single-job plan cycle: discover → ingest → score/draft → immediate post.
 * Uses in-memory store (no Postgres migrations).
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
      "Need GROQ_API_KEY (+ Reddit session for Compound/Playwright) or RAPIDAPI_KEY",
    );
  }

  const ingestLabel = (() => {
    const pref = envOr("REDDIT_INGEST", "auto").toLowerCase();
    if (pref === "reddapi") return "ReddAPI";
    if (pref === "compound" || pref === "playwright" || canIngestViaCompound()) {
      return "Compound → Playwright";
    }
    return "ReddAPI";
  })();
  log.info("reddit ingest", { provider: ingestLabel, subs: product.subreddits });

  await phase("discover_threads");
  const events = await ingestReddit(product).catch((err) => {
    log.warn("reddit ingest error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [] as NormalizedEvent[];
  });
  log.info("ingested events", { total: events.length });

  await phase("score_draft");
  const productEmb = await ensureProductEmbedding(product);
  const funnel = {
    ingested: events.length,
    stage0: 0,
    stage1: 0,
    dedup: 0,
    scorer: 0,
    aggregator: 0,
    draft: 0,
    compliance: 0,
  };

  const embedPasses: EmbedPass[] = [];
  for (const event of events) {
    const s0 = stage0Prefilter(event, product);
    if (!s0.pass) {
      await upsertEvent(event, { stage: "stage0", reason: s0.reason || "fail" });
      continue;
    }
    funnel.stage0 += 1;

    const s1 = await stage1EmbedFilter(event, productEmb);
    if (!s1.pass) {
      await upsertEvent(event, {
        stage: "stage1",
        reason: s1.reason || "fail",
      });
      continue;
    }
    funnel.stage1 += 1;
    embedPasses.push({ event, embedScore: s1.score });
  }

  embedPasses.sort((a, b) => {
    const boost = (e: NormalizedEvent) =>
      (e.external_id.startsWith("comment_") ? 0.08 : 0) +
      (/looking for|recommend|how do|any tool|alternative|api key|integrat/i.test(
        `${e.title}\n${e.body}`,
      )
        ? 0.1
        : 0);
    return b.embedScore + boost(b.event) - (a.embedScore + boost(a.event));
  });

  const llmBudget = Math.min(envInt("LLM_CANDIDATE_BUDGET", 8), maxN * 2);
  const forLlm = embedPasses.slice(0, llmBudget);

  const ready: ReadyRow[] = [];
  const concurrency = Math.max(1, groqPoolSize());
  log.info("llm stage", { candidates: forLlm.length, concurrency });

  let cursor = 0;
  async function processOne(event: NormalizedEvent): Promise<void> {
    if (ready.length >= maxN * 2) return;

    const dedup = await dedupAndRateLimit(event);
    if (!dedup.pass) {
      await upsertEvent(event, {
        stage: "dedup",
        reason: dedup.reason || "fail",
      });
      return;
    }
    funnel.dedup += 1;

    const eventId = await upsertEvent(event);

    let scores;
    try {
      scores = await scoreSignals(event, product);
    } catch (err) {
      log.warn("scorer failed", {
        id: event.external_id,
        error: err instanceof Error ? err.message : String(err),
      });
      await upsertEvent(event, {
        stage: "scorer",
        reason: err instanceof Error ? err.message : "scorer_error",
      });
      return;
    }
    funnel.scorer += 1;

    const agg = aggregateScores(scores, product);
    if (!agg.pass) {
      await upsertEvent(event, {
        stage: "aggregator",
        reason: agg.reason || "fail",
      });
      return;
    }
    funnel.aggregator += 1;

    let draft;
    try {
      draft = await writeDraft(event, product, scores);
    } catch (err) {
      log.warn("draft failed", {
        id: event.external_id,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    funnel.draft += 1;

    const compliance = await reviewCompliance(event, product, draft.draft_text);
    if (!compliance.ok) {
      await upsertEvent(event, {
        stage: "compliance",
        reason: compliance.notes || "fail",
      });
      return;
    }
    funnel.compliance += 1;

    const candidate: ScoredCandidate = {
      event,
      scores,
      aggregate: agg.aggregate,
      draft_text: draft.draft_text,
      draft_rationale: draft.draft_rationale,
      compliance_ok: true,
      compliance_notes: compliance.notes,
    };

    const candidateId = await insertCandidate(eventId, candidate);
    ready.push({ candidateId, candidate });
  }

  async function worker(): Promise<void> {
    while (ready.length < maxN * 2) {
      const i = cursor++;
      if (i >= forLlm.length) return;
      await processOne(forLlm[i]!.event);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  ready.sort((a, b) => b.candidate.aggregate - a.candidate.aggregate);
  const selected = ready.slice(0, maxN);
  const N = selected.length;
  const intervalLabel = formatInterval(product.window_hours, N);

  log.info("funnel", funnel);

  const posts: PlanPostResult[] = [];

  await phase("post");
  for (let index = 0; index < selected.length; index++) {
    const { candidateId, candidate: c } = selected[index]!;
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
