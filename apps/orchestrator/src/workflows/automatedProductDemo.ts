/**
 * Temporal workflow — must not import Node built-ins or activity implementations.
 * Activities are invoked via proxyActivities only.
 *
 * v1: one durable activity wraps runPipeline (browser + ffmpeg hard to split safely).
 * Job step visibility is updated inside the activity via setJobStep.
 */
import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/index.js";
import type {
  AutomatedProductDemoWorkflowInput,
  AutomatedProductDemoWorkflowResult,
} from "./types.js";

const short = proxyActivities<typeof activities>({
  startToCloseTimeout: "5 minutes",
  retry: { maximumAttempts: 3, initialInterval: "2s", backoffCoefficient: 2 },
});

const long = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 minutes",
  heartbeatTimeout: "2 minutes",
  retry: { maximumAttempts: 2, initialInterval: "10s", backoffCoefficient: 2 },
});

export async function automatedProductDemoWorkflow(
  input: AutomatedProductDemoWorkflowInput,
): Promise<AutomatedProductDemoWorkflowResult> {
  try {
    await short.markJobRunning(input.job_id);

    const result = await long.runAutomatedProductDemoActivity({
      job_id: input.job_id,
      website_url: input.website_url,
      script: input.script,
    });

    if (!result.video_url) {
      throw new Error("runAutomatedProductDemoActivity did not return video_url");
    }

    const artifacts = [
      {
        type: "video",
        url: result.video_url,
        ...(result.object_key ? { object_key: result.object_key } : {}),
        mime_type: "video/mp4",
      },
    ];

    await short.completeJob(input.job_id, {
      artifacts,
      cost_breakdown: result.cost_breakdown,
    });

    return {
      video_url: result.video_url,
      object_key: result.object_key,
      duration_seconds: result.duration_seconds,
      cost_breakdown: result.cost_breakdown,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await short.failJob(input.job_id, message).catch(() => undefined);
    throw err;
  }
}
