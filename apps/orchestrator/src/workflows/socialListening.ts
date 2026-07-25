/**
 * Temporal workflow — one durable activity wraps social-listening runPipeline.
 */
import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/index.js";
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
      live: input.live,
      max_posts: input.max_posts,
    });

    const artifacts = result.posted_urls.map((url) => ({
      type: "reddit_comment",
      url,
      mime_type: "text/uri-list",
    }));

    await short.completeJob(input.job_id, {
      artifacts,
      cost_breakdown: result.cost_breakdown,
    });

    return {
      product_name: result.product_name,
      posted_urls: result.posted_urls,
      posts_attempted: result.posts_attempted,
      live: result.live,
      cost_breakdown: result.cost_breakdown,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await short.failJob(input.job_id, message).catch(() => undefined);
    throw err;
  }
}
