/**
 * Temporal workflow — must not import Node built-ins or activity implementations.
 * Activities are invoked via proxyActivities only.
 */
import { proxyActivities, ApplicationFailure } from "@temporalio/workflow";
import type * as activities from "../activities/index.js";
import { workflowFailureMessage } from "./failureMessage.js";
import type {
  CompetitorResearchWorkflowInput,
  CompetitorResearchWorkflowResult,
} from "./types.js";

const short = proxyActivities<typeof activities>({
  startToCloseTimeout: "5 minutes",
  retry: { maximumAttempts: 3, initialInterval: "2s", backoffCoefficient: 2 },
});

const medium = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 minutes",
  retry: { maximumAttempts: 3, initialInterval: "5s", backoffCoefficient: 2 },
});

const compile = proxyActivities<typeof activities>({
  startToCloseTimeout: "5 minutes",
  retry: { maximumAttempts: 2, initialInterval: "3s", backoffCoefficient: 2 },
});

export async function competitorResearchWorkflow(
  input: CompetitorResearchWorkflowInput,
): Promise<CompetitorResearchWorkflowResult> {
  const productInput = {
    product_name: input.product_name,
    product_url: input.product_url,
  };

  try {
    await short.markJobRunning(input.job_id);

    await short.setJobStep(input.job_id, "findCompetitors");
    const found = await medium.findCompetitorsActivity(productInput);

    // Sequential: keeps the two LLM extraction bursts out of the same
    // Groq rate-limit window (each activity fetches its own evidence).
    await short.setJobStep(input.job_id, "diffFeatures");
    const features = await medium.diffFeaturesActivity({
      input: productInput,
      competitors: found.competitors,
    });

    await short.setJobStep(input.job_id, "scrapePricing");
    const pricing = await medium.scrapePricingActivity({
      input: productInput,
      competitors: found.competitors,
    });

    await short.setJobStep(input.job_id, "buildPositioning");
    const positioning = await short.buildPositioningActivity({
      productName: input.product_name,
      feature_diff: features.feature_diff,
      pricing: pricing.pricing,
    });

    await short.setJobStep(input.job_id, "compileReport");
    const report = await compile.compileReportActivity({
      input: productInput,
      competitors: found.competitors,
      feature_diff: features.feature_diff,
      pricing: pricing.pricing,
      positioning: positioning.positioning,
    });

    if (!report.report.pdf_url) {
      throw ApplicationFailure.nonRetryable("compileReport did not return pdf_url");
    }

    const cost_breakdown = [
      {
        vendor: "discovery",
        operation: "findCompetitors",
        amount_usd: found.cost_usd,
      },
      {
        vendor: "scrape",
        operation: "diffFeatures",
        amount_usd: features.cost_usd,
      },
      {
        vendor: "scrape",
        operation: "scrapePricing",
        amount_usd: pricing.cost_usd,
      },
      {
        vendor: "llm-core",
        operation: "buildPositioning",
        amount_usd: positioning.cost_usd,
      },
      {
        vendor: "render",
        operation: "compileReport",
        amount_usd: report.cost_usd,
      },
    ];

    const artifacts = [
      {
        type: "report_pdf",
        url: report.report.pdf_url,
        ...(report.report.object_key ? { object_key: report.report.object_key } : {}),
        mime_type: "application/pdf",
      },
    ];

    await short.completeJob(input.job_id, { artifacts, cost_breakdown });

    return {
      pdf_url: report.report.pdf_url,
      object_key: report.report.object_key,
      cost_breakdown,
    };
  } catch (err) {
    await short.failJob(input.job_id, workflowFailureMessage(err)).catch(() => undefined);
    throw err;
  }
}
