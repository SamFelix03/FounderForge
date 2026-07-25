import { heartbeat } from "@temporalio/activity";
import {
  runPipeline,
  type Output,
} from "@founderforge/automated-product-demo-service";
import { createLogger } from "@founderforge/observability";
import { setJobStep } from "./jobs.js";

const log = createLogger("activities.apd");

export async function runAutomatedProductDemoActivity(args: {
  job_id: string;
  website_url: string;
  script: string;
}): Promise<{
  video_url: string;
  object_key?: string;
  duration_seconds?: number;
  cost_breakdown: Output["cost_breakdown"];
}> {
  log.info("starting automated product demo pipeline", {
    job_id: args.job_id,
    website_url: args.website_url,
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
      { website_url: args.website_url, script: args.script },
      {
        onStep: async (step: string) => {
          await setJobStep(args.job_id, step);
          heartbeat({ phase: step });
        },
      },
    );

    return {
      video_url: result.video_url,
      object_key: result.object_key,
      duration_seconds: result.duration_seconds,
      cost_breakdown: result.cost_breakdown,
    };
  } finally {
    clearInterval(heartbeatTimer);
  }
}
