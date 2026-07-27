import { reviewCompliance } from "../agents/compliance.js";
import { dedupAndRateLimit } from "../agents/dedup.js";
import { writeDraft } from "../agents/draft.js";
import { insertCandidate, resetMemoryStore, upsertEvent } from "../db/repos.js";
import { canIngestReddit, ingestReddit } from "../ingest/reddit.js";
import { createLogger } from "../log.js";
import { discoverProductFromUrl } from "../product/discover.js";
import { compileRedditReport } from "../report/compileReport.js";
import { formatInterval } from "../schedule/spread24h.js";
import type {
  DraftCandidate,
  NormalizedEvent,
  ProductConfig,
} from "../types.js";

const log = createLogger("pipeline.plan");

export interface PlanRecommendation {
  targetPermalink: string;
  draftText: string;
  draftRationale: string;
  title: string;
  threadContext: string;
  status: "included" | "skipped";
  community?: string | null;
  skipReason?: string;
}

export interface PlanResult {
  product: ProductConfig;
  recommendations: PlanRecommendation[];
  n: number;
  intervalLabel: string;
  report: {
    pdf_url: string;
    object_key: string;
    bytes: number;
  };
}

/**
 * Tavily research → suggested comments → PDF on Supabase. No browser, no posting.
 */
export async function runPlanCycle(opts: {
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
  });

  if (!canIngestReddit()) {
    throw new Error("TAVILY_API_KEY is required for Reddit thread discovery");
  }

  log.info("reddit ingest", { provider: "tavily", subs: product.subreddits });

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
  const ready: DraftCandidate[] = [];
  const skipped: PlanRecommendation[] = [];
  const funnel = { ingested: threads.length, dedup: 0, draft: 0, compliance: 0 };

  for (const event of threads) {
    if (ready.length >= maxN) break;

    const dedup = await dedupAndRateLimit(event);
    if (!dedup.pass) {
      await upsertEvent(event, {
        stage: "dedup",
        reason: dedup.reason || "fail",
      });
      skipped.push({
        targetPermalink: event.permalink,
        draftText: "",
        draftRationale: "",
        title: event.title,
        threadContext: event.thread_context,
        status: "skipped",
        community: event.community,
        skipReason: dedup.reason || "dedup",
      });
      continue;
    }
    funnel.dedup += 1;

    const eventId = await upsertEvent(event);

    let draftText = event.suggested_reply?.trim() || "";
    let draftRationale = draftText ? "From Tavily research" : "";

    if (!draftText || draftText.length < 40) {
      try {
        const draft = await writeDraft(event, product);
        draftText = draft.draft_text;
        draftRationale = draft.draft_rationale;
      } catch (err) {
        log.warn("draft failed", {
          id: event.external_id,
          error: err instanceof Error ? err.message : String(err),
        });
        skipped.push({
          targetPermalink: event.permalink,
          draftText: "",
          draftRationale: "",
          title: event.title,
          threadContext: event.thread_context,
          status: "skipped",
          community: event.community,
          skipReason: err instanceof Error ? err.message : "draft failed",
        });
        continue;
      }
    }
    funnel.draft += 1;

    const compliance = await reviewCompliance(event, product, draftText);
    if (!compliance.ok) {
      await upsertEvent(event, {
        stage: "compliance",
        reason: compliance.notes || "fail",
      });
      log.warn("compliance failed", {
        id: event.external_id,
        reason: compliance.notes,
      });
      skipped.push({
        targetPermalink: event.permalink,
        draftText,
        draftRationale,
        title: event.title,
        threadContext: event.thread_context,
        status: "skipped",
        community: event.community,
        skipReason: compliance.notes || "compliance",
      });
      continue;
    }
    funnel.compliance += 1;

    const candidate: DraftCandidate = {
      event,
      draft_text: draftText,
      draft_rationale: draftRationale,
      compliance_ok: true,
      compliance_notes: compliance.notes,
    };

    await insertCandidate(eventId, candidate);
    ready.push(candidate);
  }

  const N = ready.length;
  const intervalLabel = formatInterval(product.window_hours, N);
  log.info("funnel", funnel);

  const recommendations: PlanRecommendation[] = [
    ...ready.map((c) => ({
      targetPermalink: c.event.permalink,
      draftText: c.draft_text,
      draftRationale: c.draft_rationale,
      title: c.event.title,
      threadContext: c.event.thread_context,
      status: "included" as const,
      community: c.event.community,
    })),
    ...skipped,
  ];

  await phase("compile_report");
  const compiled = await compileRedditReport({
    generatedAt: new Date().toISOString(),
    websiteUrl: opts.websiteUrl,
    product,
    subreddits: product.subreddits,
    recommendations: ready.map((c) => ({
      community: c.event.community,
      title: c.event.title,
      permalink: c.event.permalink,
      threadContext: c.event.thread_context,
      draftText: c.draft_text,
      draftRationale: c.draft_rationale,
    })),
  });

  log.info("report ready", {
    pdf_url: compiled.report.pdf_url,
    object_key: compiled.report.object_key,
    recommendations: N,
  });

  return {
    product,
    recommendations,
    n: N,
    intervalLabel,
    report: compiled.report,
  };
}
