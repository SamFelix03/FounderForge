/**
 * Temporal workflow — one durable activity wraps outreach runPipeline.
 */
import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/index.js";
import { workflowFailureMessage } from "./failureMessage.js";
import type {
  OutreachWorkflowInput,
  OutreachWorkflowResult,
} from "./types.js";

const short = proxyActivities<typeof activities>({
  startToCloseTimeout: "5 minutes",
  retry: { maximumAttempts: 3, initialInterval: "2s", backoffCoefficient: 2 },
});

const long = proxyActivities<typeof activities>({
  startToCloseTimeout: "45 minutes",
  heartbeatTimeout: "5 minutes",
  retry: { maximumAttempts: 1, initialInterval: "10s", backoffCoefficient: 2 },
});

export async function outreachWorkflow(
  input: OutreachWorkflowInput,
): Promise<OutreachWorkflowResult> {
  try {
    await short.markJobRunning(input.job_id);

    const result = await long.runOutreachActivity({
      job_id: input.job_id,
      website_url: input.website_url,
      sheet_url: input.sheet_url,
    });

    if (!result.pdf_url) {
      throw new Error("runOutreachActivity did not return pdf_url");
    }

    const artifacts = [
      {
        type: "pdf_report",
        url: result.pdf_url,
        object_key: result.object_key,
        mime_type: "application/pdf",
      },
    ];

    await short.completeJob(input.job_id, {
      artifacts,
      cost_breakdown: result.cost_breakdown ?? [],
    });

    return {
      pdf_url: result.pdf_url,
      object_key: result.object_key,
      cost_breakdown: result.cost_breakdown ?? [],
    };
  } catch (err) {
    await short.failJob(input.job_id, workflowFailureMessage(err)).catch(() => undefined);
    throw err;
  }
}
