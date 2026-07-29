import {
  findCompetitors,
  diffFeatures,
  scrapePricing,
  buildPositioning,
  compileReport,
  InputSchema,
  type Competitor,
  type FeatureDiff,
  type Input,
  type Positioning,
  type PricingResult,
} from "@founderforge/competitor-research-service";
import { ApplicationFailure } from "@temporalio/activity";
import { isProductUrlError } from "@founderforge/schemas";

function parseInput(raw: { product_name: string; product_url?: string }): Input {
  return InputSchema.parse(raw);
}

export async function findCompetitorsActivity(raw: {
  product_name: string;
  product_url?: string;
}): Promise<{
  competitors: Competitor[];
  cost_usd: number;
}> {
  try {
    return await findCompetitors(parseInput(raw));
  } catch (err) {
    if (isProductUrlError(err)) {
      throw ApplicationFailure.nonRetryable(err.message, err.code);
    }
    throw err;
  }
}

export async function diffFeaturesActivity(args: {
  input: { product_name: string; product_url?: string };
  competitors: Competitor[];
}): Promise<{ feature_diff: FeatureDiff; cost_usd: number }> {
  return diffFeatures({
    input: parseInput(args.input),
    competitors: args.competitors,
  });
}

export async function scrapePricingActivity(args: {
  input: { product_name: string; product_url?: string };
  competitors: Competitor[];
}): Promise<{ pricing: PricingResult; cost_usd: number }> {
  return scrapePricing({
    input: parseInput(args.input),
    competitors: args.competitors,
  });
}

export async function buildPositioningActivity(args: {
  productName: string;
  feature_diff: FeatureDiff;
  pricing: PricingResult;
}): Promise<{ positioning: Positioning; cost_usd: number }> {
  return buildPositioning(args);
}

export async function compileReportActivity(args: {
  input: { product_name: string; product_url?: string };
  competitors: Competitor[];
  feature_diff: FeatureDiff;
  pricing: PricingResult;
  positioning: Positioning;
}): Promise<{
  report: { pdf_url: string; object_key?: string; html_preview?: string };
  cost_usd: number;
}> {
  return compileReport({
    input: parseInput(args.input),
    competitors: args.competitors,
    feature_diff: args.feature_diff,
    pricing: args.pricing,
    positioning: args.positioning,
  });
}
