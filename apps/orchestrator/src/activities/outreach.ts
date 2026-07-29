import { ApplicationFailure, heartbeat } from "@temporalio/activity";
import {
  runPipeline,
  type Output,
} from "@founderforge/outreach-service";
import { isProductUrlError } from "@founderforge/schemas";
import { createLogger } from "@founderforge/observability";
import { setJobStep } from "./jobs.js";

const log = createLogger("activities.outreach");

export async function runOutreachActivity(args: {
  job_id: string;
  website_url: string;
  sheet_url: string;
}): Promise<{
  pdf_url: string;
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

    if (!result.report.pdf_url) {
      throw new Error("outreach pipeline did not return pdf_url");
    }

    return {
      pdf_url: result.report.pdf_url,
      object_key: result.report.object_key,
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
