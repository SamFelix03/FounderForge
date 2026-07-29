import { ApplicationFailure, heartbeat } from "@temporalio/activity";
import {
  runPipeline,
  type Output,
} from "@founderforge/promo-video-service";
import { isProductUrlError } from "@founderforge/schemas";
import { createLogger } from "@founderforge/observability";
import { setJobStep } from "./jobs.js";

const log = createLogger("activities.promo");

export async function runPromoVideoActivity(args: {
  job_id: string;
  product_url: string;
  duration?: number;
  resolution?: string;
  max_pages?: number;
}): Promise<{
  video_url: string;
  request_id?: string;
  duration_seconds: number;
  concept?: string;
  cost_breakdown: Output["cost_breakdown"];
}> {
  log.info("starting promo video pipeline", {
    job_id: args.job_id,
    product_url: args.product_url,
  });

  const heartbeatTimer = setInterval(() => {
    try {
      heartbeat({ phase: "running" });
    } catch {
      /* activity may already be cancelled */
    }
  }, 30_000);

  try {
    const result = await runPipeline(
      {
        product_url: args.product_url,
        duration: (args.duration ?? 15) as 4 | 5 | 6 | 8 | 10 | 12 | 15,
        resolution: (args.resolution ?? "720p") as
          | "480p"
          | "720p"
          | "1080p"
          | "4k",
        max_pages: args.max_pages ?? 6,
      },
      {
        onStep: async (step: string) => {
          await setJobStep(args.job_id, step);
          heartbeat({ phase: step });
        },
      },
    );

    return {
      video_url: result.video_url,
      request_id: result.request_id,
      duration_seconds: result.duration_seconds,
      concept: result.concept,
      cost_breakdown: result.cost_breakdown,
    };
  } catch (err) {
    if (isProductUrlError(err)) {
      throw ApplicationFailure.nonRetryable(err.message, err.code);
    }
    throw err;
  } finally {
    clearInterval(heartbeatTimer);
  }
}
