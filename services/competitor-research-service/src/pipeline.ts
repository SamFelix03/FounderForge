import { findCompetitors } from "./agents/findCompetitors.js";
import { diffFeatures } from "./agents/diffFeatures.js";
import { scrapePricing } from "./agents/scrapePricing.js";
import { buildPositioning } from "./agents/buildPositioning.js";
import { compileReport } from "./agents/compileReport.js";
import {
  fetchVendorEvidence,
  type VendorEvidence,
} from "./agents/fetchEvidence.js";
import { InputSchema, type Input, type Output } from "./schema.js";

export async function runPipeline(
  rawInput: Input,
  opts?: { stub?: boolean },
): Promise<Output> {
  const input = InputSchema.parse(rawInput);
  const costs: Output["cost_breakdown"] = [];
  const stubOpts = opts?.stub ? { stub: true as const } : undefined;

  const found = await findCompetitors(input, stubOpts);
  costs.push({
    vendor: "discovery",
    operation: "findCompetitors",
    amount_usd: found.cost_usd,
  });

  // Fetch each vendor's public evidence exactly once, then reuse it for both
  // the feature matrix and pricing extraction (resource-efficient, one fetch/vendor).
  const productUrl =
    input.product_url ??
    `https://www.google.com/search?q=${encodeURIComponent(input.product_name)}`;
  const evidenceTargets = [
    { key: input.product_name, url: productUrl },
    ...found.competitors.slice(0, 5).map((c) => ({ key: c.name, url: c.url })),
  ];
  const evidence: Record<string, VendorEvidence> = {};
  let evidenceCost = 0;
  for (const t of evidenceTargets) {
    const page = await fetchVendorEvidence(t.url, {
      stub: opts?.stub,
      maxChars: 4200,
    });
    evidenceCost += page.cost_usd;
    evidence[t.key] = page;
  }
  costs.push({ vendor: "fetch", operation: "gatherEvidence", amount_usd: evidenceCost });

  // Sequential (not parallel) so the two LLM extraction bursts don't stack
  // inside the same rate-limit window.
  const features = await diffFeatures(
    { input, competitors: found.competitors, evidence },
    stubOpts,
  );
  const pricing = await scrapePricing(
    { input, competitors: found.competitors, evidence },
    stubOpts,
  );
  costs.push(
    { vendor: "scrape", operation: "diffFeatures", amount_usd: features.cost_usd },
    { vendor: "scrape", operation: "scrapePricing", amount_usd: pricing.cost_usd },
  );

  const positioning = await buildPositioning(
    {
      productName: input.product_name,
      feature_diff: features.feature_diff,
      pricing: pricing.pricing,
    },
    stubOpts,
  );
  costs.push({
    vendor: "llm-core",
    operation: "buildPositioning",
    amount_usd: positioning.cost_usd,
  });

  const report = await compileReport({
    input,
    competitors: found.competitors,
    feature_diff: features.feature_diff,
    pricing: pricing.pricing,
    positioning: positioning.positioning,
  });
  costs.push({
    vendor: "render",
    operation: "compileReport",
    amount_usd: report.cost_usd,
  });

  return {
    competitors: found.competitors,
    feature_diff: features.feature_diff,
    pricing: pricing.pricing,
    positioning: positioning.positioning,
    report: report.report,
    cost_breakdown: costs,
  };
}
