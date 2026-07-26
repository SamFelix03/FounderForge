/**
 * Temporal workflow — one durable activity wraps brand-kit runPipeline.
 */
import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/index.js";
import type {
  BrandKitWorkflowInput,
  BrandKitWorkflowResult,
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

export async function brandKitWorkflow(
  input: BrandKitWorkflowInput,
): Promise<BrandKitWorkflowResult> {
  try {
    await short.markJobRunning(input.job_id);

    const result = await long.runBrandKitActivity({
      job_id: input.job_id,
      brand_name: input.brand_name,
      description: input.description,
      pick: input.pick,
    });

    if (!result.zip_url) {
      throw new Error("runBrandKitActivity did not return zip_url");
    }

    const artifacts = [
      {
        type: "brand_kit_zip",
        url: result.zip_url,
        object_key: result.object_key,
        mime_type: "application/zip",
      },
    ];

    await short.completeJob(input.job_id, {
      artifacts,
      cost_breakdown: result.cost_breakdown ?? [],
    });

    return {
      zip_url: result.zip_url,
      object_key: result.object_key,
      brand_name: result.brand_name,
      chosen_concept: result.chosen_concept,
      cost_breakdown: result.cost_breakdown ?? [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await short.failJob(input.job_id, message).catch(() => undefined);
    throw err;
  }
}
