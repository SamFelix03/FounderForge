import { createLogger } from "@founderforge/observability";
import { jobStore } from "./store.js";
import {
  enqueueAutomatedProductDemo,
  enqueueCompetitorResearch,
} from "../temporal/client.js";

const log = createLogger("dispatch");

/**
 * Enqueue work on Temporal. Execution happens in the orchestrator worker —
 * the gateway does not run product pipelines in-process.
 */
export async function dispatchJob(jobId: string): Promise<void> {
  const job = await jobStore.get(jobId);
  if (!job) throw new Error(`job not found: ${jobId}`);

  switch (job.service) {
    case "competitor-research": {
      const input = job.input as { product_name: string; product_url?: string };
      if (!input.product_name) {
        await jobStore.setStatus(jobId, "failed", "missing product_name");
        return;
      }
      try {
        await enqueueCompetitorResearch({
          job_id: jobId,
          product_name: input.product_name,
          product_url: input.product_url,
        });
        log.info("job enqueued on Temporal", { job_id: jobId });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await jobStore.setStatus(jobId, "failed", `temporal_enqueue_failed:${message}`);
        log.error("failed to enqueue Temporal workflow", { job_id: jobId, error: message });
      }
      break;
    }
    case "automated-product-demo": {
      const input = job.input as { website_url: string; script: string };
      if (!input.website_url || !input.script) {
        await jobStore.setStatus(jobId, "failed", "missing website_url or script");
        return;
      }
      try {
        await enqueueAutomatedProductDemo({
          job_id: jobId,
          website_url: input.website_url,
          script: input.script,
        });
        log.info("job enqueued on Temporal", { job_id: jobId, service: job.service });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await jobStore.setStatus(jobId, "failed", `temporal_enqueue_failed:${message}`);
        log.error("failed to enqueue Temporal workflow", { job_id: jobId, error: message });
      }
      break;
    }
    default: {
      await jobStore.setStatus(jobId, "failed", `service_not_implemented:${job.service}`);
      break;
    }
  }
}
