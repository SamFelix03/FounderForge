import { heartbeat } from "@temporalio/activity";
import {
  runPipeline,
  type Output,
} from "@founderforge/outreach-service";
import { createLogger } from "@founderforge/observability";
import { setJobStep } from "./jobs.js";

const log = createLogger("activities.outreach");

export async function runOutreachActivity(args: {
  job_id: string;
  website_url: string;
  sheet_url: string;
}): Promise<{
  pdf_url?: string;
  local_path?: string;
  object_key?: string;
  cost_breakdown: Output["cost_breakdown"];
}> {
  log.info("starting outreach pipeline", {
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
      {
        website_url: args.website_url,
        sheet_url: args.sheet_url,
      },
      {
        onStep: async (s: { step: string; detail?: string }) => {
          await setJobStep(args.job_id, s.step);
          heartbeat({ phase: s.step, detail: s.detail });
        },
      },
    );

    return {
      pdf_url: result.report.pdf_url,
      local_path: result.report.local_path,
      object_key: result.report.object_key,
      cost_breakdown: result.cost_breakdown,
    };
  } finally {
    clearInterval(heartbeatTimer);
  }
}
