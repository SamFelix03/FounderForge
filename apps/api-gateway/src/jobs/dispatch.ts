import { createLogger } from "@founderforge/observability";
import { jobStore } from "./store.js";
import {
  enqueueAutomatedProductDemo,
  enqueueCompetitorResearch,
  enqueuePromoVideo,
  enqueueSocialListening,
  enqueueOutreach,
  enqueueBrandKit,
} from "../temporal/client.js";

const log = createLogger("dispatch");

/**
 * Enqueue work on Temporal. Returns workflow id on success.
 * On enqueue failure the job is marked failed (payment already settled).
 */
export async function dispatchJob(jobId: string): Promise<string | undefined> {
  const job = await jobStore.get(jobId);
  if (!job) throw new Error(`job not found: ${jobId}`);

  try {
    let workflowId: string;
    switch (job.service) {
      case "competitor-research": {
        const input = job.input as { product_name: string; product_url?: string };
        if (!input.product_name) {
          await jobStore.setStatus(jobId, "failed", "missing product_name");
          return undefined;
        }
        workflowId = await enqueueCompetitorResearch({
          job_id: jobId,
          product_name: input.product_name,
          product_url: input.product_url,
        });
        break;
      }
      case "automated-product-demo": {
        const input = job.input as { website_url: string; script: string };
        if (!input.website_url || !input.script) {
          await jobStore.setStatus(jobId, "failed", "missing website_url or script");
          return undefined;
        }
        workflowId = await enqueueAutomatedProductDemo({
          job_id: jobId,
          website_url: input.website_url,
          script: input.script,
        });
        break;
      }
      case "promo-video": {
        const input = job.input as {
          product_url: string;
          duration?: number;
          resolution?: string;
          max_pages?: number;
        };
        if (!input.product_url) {
          await jobStore.setStatus(jobId, "failed", "missing product_url");
          return undefined;
        }
        workflowId = await enqueuePromoVideo({
          job_id: jobId,
          product_url: input.product_url,
          duration: input.duration,
          resolution: input.resolution,
          max_pages: input.max_pages,
        });
        break;
      }
      case "social-listening": {
        const input = job.input as {
          product_url: string;
          product_name?: string;
          live?: boolean;
          max_posts?: number;
        };
        if (!input.product_url) {
          await jobStore.setStatus(jobId, "failed", "missing product_url");
          return undefined;
        }
        workflowId = await enqueueSocialListening({
          job_id: jobId,
          product_url: input.product_url,
          product_name: input.product_name,
          live: input.live,
          max_posts: input.max_posts,
        });
        break;
      }
      case "outreach": {
        const input = job.input as {
          website_url: string;
          sheet_url: string;
        };
        if (!input.website_url || !input.sheet_url) {
          await jobStore.setStatus(jobId, "failed", "missing website_url or sheet_url");
          return undefined;
        }
        workflowId = await enqueueOutreach({
          job_id: jobId,
          website_url: input.website_url,
          sheet_url: input.sheet_url,
        });
        break;
      }
      case "brand-kit": {
        const input = job.input as {
          brand_name: string;
          description: string;
          pick?: number;
        };
        if (!input.brand_name || !input.description) {
          await jobStore.setStatus(jobId, "failed", "missing brand_name or description");
          return undefined;
        }
        workflowId = await enqueueBrandKit({
          job_id: jobId,
          brand_name: input.brand_name,
          description: input.description,
          pick: input.pick,
        });
        break;
      }
      default: {
        await jobStore.setStatus(jobId, "failed", `service_not_implemented:${job.service}`);
        return undefined;
      }
    }

    await jobStore.markDispatched(jobId, workflowId);
    log.info("job enqueued on Temporal", {
      job_id: jobId,
      service: job.service,
      workflow_id: workflowId,
    });
    return workflowId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await jobStore.markDispatchFailed(jobId, message);
    log.error("failed to enqueue Temporal workflow", { job_id: jobId, error: message });
    return undefined;
  }
}

/** Re-dispatch stale queued jobs (never started or prior enqueue error cleared). */
export async function reconcileStaleQueuedJobs(
  olderThanMs = 30_000,
): Promise<{ attempted: number; enqueued: number }> {
  const stale = await jobStore.listStaleQueued(olderThanMs);
  let enqueued = 0;
  for (const job of stale) {
    // Clear prior dispatch_error so markDispatched can succeed; keep queued.
    if (job.dispatch_error) {
      await jobStore.update(job.id, { dispatch_error: null });
    }
    const wf = await dispatchJob(job.id);
    if (wf) enqueued += 1;
  }
  if (stale.length) {
    log.info("reconciled stale queued jobs", {
      attempted: stale.length,
      enqueued,
    });
  }
  return { attempted: stale.length, enqueued };
}
