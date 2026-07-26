import { heartbeat } from "@temporalio/activity";
import {
  runPipeline,
  type Output,
} from "@founderforge/brand-kit-service";
import { createLogger } from "@founderforge/observability";
import { setJobStep } from "./jobs.js";

const log = createLogger("activities.brandKit");

export async function runBrandKitActivity(args: {
  job_id: string;
  brand_name: string;
  description: string;
  pick?: number;
}): Promise<{
  zip_url: string;
  object_key?: string;
  brand_name: string;
  chosen_concept: string;
  cost_breakdown: Output["cost_breakdown"];
}> {
  log.info("starting brand kit pipeline", {
    job_id: args.job_id,
    brand_name: args.brand_name,
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
        brand_name: args.brand_name,
        description: args.description,
        pick: args.pick ?? 0,
      },
      {
        onStep: async (s: { step: string; detail?: string }) => {
          await setJobStep(args.job_id, s.step);
          heartbeat({ phase: s.step, detail: s.detail });
        },
      },
    );

    if (!result.zip_url) {
      throw new Error("brand kit pipeline did not return zip_url");
    }

    return {
      zip_url: result.zip_url,
      object_key: result.object_key,
      brand_name: result.brand_name,
      chosen_concept: result.chosen_concept,
      cost_breakdown: result.cost_breakdown,
    };
  } finally {
    clearInterval(heartbeatTimer);
  }
}
