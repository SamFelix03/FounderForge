/**
 * Temporal workflow — one durable activity wraps runPipeline.
 * Job step visibility is updated inside the activity via setJobStep.
 */
import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/index.js";
import { workflowFailureMessage } from "./failureMessage.js";
import type {
  PromoVideoWorkflowInput,
  PromoVideoWorkflowResult,
} from "./types.js";

const short = proxyActivities<typeof activities>({
  startToCloseTimeout: "5 minutes",
  retry: { maximumAttempts: 3, initialInterval: "2s", backoffCoefficient: 2 },
});

const long = proxyActivities<typeof activities>({
  startToCloseTimeout: "15 minutes",
  heartbeatTimeout: "2 minutes",
  retry: { maximumAttempts: 2, initialInterval: "10s", backoffCoefficient: 2 },
});

export async function promoVideoWorkflow(
  input: PromoVideoWorkflowInput,
): Promise<PromoVideoWorkflowResult> {
  try {
    await short.markJobRunning(input.job_id);

    const result = await long.runPromoVideoActivity({
      job_id: input.job_id,
      product_url: input.product_url,
      duration: input.duration,
      resolution: input.resolution,
      max_pages: input.max_pages,
    });

    if (!result.video_url) {
      throw new Error("runPromoVideoActivity did not return video_url");
    }

    const artifacts = [
      {
        type: "video",
        url: result.video_url,
        mime_type: "video/mp4",
      },
    ];

    await short.completeJob(input.job_id, {
      artifacts,
      cost_breakdown: result.cost_breakdown,
    });

    return {
      video_url: result.video_url,
      request_id: result.request_id,
      duration_seconds: result.duration_seconds,
      concept: result.concept,
      cost_breakdown: result.cost_breakdown,
    };
  } catch (err) {
    await short.failJob(input.job_id, workflowFailureMessage(err)).catch(() => undefined);
    throw err;
  }
}
