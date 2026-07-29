/**
 * Temporal workflow — one durable activity wraps social-listening runPipeline.
 */
import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/index.js";
import { workflowFailureMessage } from "./failureMessage.js";
import type {
  SocialListeningWorkflowInput,
  SocialListeningWorkflowResult,
} from "./types.js";

const short = proxyActivities<typeof activities>({
  startToCloseTimeout: "5 minutes",
  retry: { maximumAttempts: 3, initialInterval: "2s", backoffCoefficient: 2 },
});

const long = proxyActivities<typeof activities>({
  startToCloseTimeout: "20 minutes",
  heartbeatTimeout: "3 minutes",
  retry: { maximumAttempts: 1, initialInterval: "10s", backoffCoefficient: 2 },
});

export async function socialListeningWorkflow(
  input: SocialListeningWorkflowInput,
): Promise<SocialListeningWorkflowResult> {
  try {
    await short.markJobRunning(input.job_id);

    const result = await long.runSocialListeningActivity({
      job_id: input.job_id,
      product_url: input.product_url,
      product_name: input.product_name,
      live: input.live,
      max_posts: input.max_posts,
    });

    const artifacts = [
      {
        type: "pdf_report",
        url: result.pdf_url,
        mime_type: "application/pdf",
        object_key: result.object_key,
      },
      ...result.thread_urls.map((url) => ({
        type: "reddit_thread",
        url,
        mime_type: "text/uri-list",
      })),
    ];

    await short.completeJob(input.job_id, {
      artifacts,
      cost_breakdown: result.cost_breakdown,
    });

    return {
      product_name: result.product_name,
      pdf_url: result.pdf_url,
      object_key: result.object_key,
      thread_urls: result.thread_urls,
      recommendations_count: result.recommendations_count,
      cost_breakdown: result.cost_breakdown,
    };
  } catch (err) {
    await short.failJob(input.job_id, workflowFailureMessage(err)).catch(() => undefined);
    throw err;
  }
}
