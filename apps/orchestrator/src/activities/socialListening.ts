import { heartbeat } from "@temporalio/activity";
import {
  runPipeline,
  type Output,
} from "@founderforge/social-listening-service";
import { createLogger } from "@founderforge/observability";
import { setJobStep } from "./jobs.js";

const log = createLogger("activities.socialListening");

export async function runSocialListeningActivity(args: {
  job_id: string;
  product_url: string;
  live?: boolean;
  max_posts?: number;
}): Promise<{
  product_name: string;
  pdf_url: string;
  object_key: string;
  thread_urls: string[];
  recommendations_count: number;
  cost_breakdown: Output["cost_breakdown"];
}> {
  log.info("starting social listening pipeline", {
    job_id: args.job_id,
    product_url: args.product_url,
    max_posts: args.max_posts ?? null,
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
        live: args.live ?? false,
        max_posts: args.max_posts,
      },
      {
        onStep: async (step: string) => {
          await setJobStep(args.job_id, step);
          heartbeat({ phase: step });
        },
      },
    );

    return {
      product_name: result.product_name,
      pdf_url: result.pdf_url,
      object_key: result.object_key,
      thread_urls: result.thread_urls,
      recommendations_count: result.recommendations_count,
      cost_breakdown: result.cost_breakdown,
    };
  } finally {
    clearInterval(heartbeatTimer);
  }
}
