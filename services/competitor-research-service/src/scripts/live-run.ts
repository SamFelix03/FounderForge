/**
 * Live Feature 5 runner — real connectors + Supabase PDF upload.
 *
 * Usage:
 *   pnpm --filter @founderforge/competitor-research-service live -- "Notion" "https://www.notion.so"
 *   pnpm --filter @founderforge/competitor-research-service live -- "Figma" "https://www.figma.com"
 *   pnpm --filter @founderforge/competitor-research-service live -- "Slack" "https://slack.com"
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv, createLogger } from "@founderforge/observability";
import { runPipeline } from "../pipeline.js";
import { supabaseConfigured } from "../storage.js";

loadRootEnv(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."));

const log = createLogger("live-feature5");

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  if (args.includes("-h") || args.includes("--help")) {
    console.log(`Usage: live -- "<product_name>" "<product_url>"

Examples:
  live -- "Notion" "https://www.notion.so"
  live -- "Linear" "https://linear.app"
  live -- "Figma" "https://www.figma.com"`);
    process.exit(0);
  }

  const productName = args[0] ?? "Notion";
  const productUrl = args[1] ?? "https://www.notion.so";

  log.info("starting live competitor research", {
    productName,
    productUrl,
    groq: Boolean(process.env.GROQ_API_KEY),
    serper: Boolean(process.env.SERPER_API_KEY),
    jina: Boolean(process.env.JINA_API_KEY),
    supabase: supabaseConfigured(),
  });

  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY missing");
  }
  if (!process.env.JINA_API_KEY) {
    throw new Error(
      "JINA_API_KEY missing (required for Jina Reader — get a free key: https://jina.ai/?sui=apikey)",
    );
  }
  if (!supabaseConfigured()) {
    throw new Error("Supabase Storage required (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)");
  }

  const started = Date.now();
  const result = await runPipeline({
    product_name: productName,
    product_url: productUrl,
  });
  const elapsed_ms = Date.now() - started;

  const unknownCells = countUnknown(result.feature_diff);
  const summary = {
    elapsed_ms,
    competitors: result.competitors.map((c) => ({
      name: c.name,
      url: c.url,
      confidence: c.confidence,
    })),
    feature_count: result.feature_diff.features.length,
    feature_unknown_ratio: unknownCells.ratio,
    pricing_tiers: result.pricing.product_pricing.tiers.length,
    competitor_pricing_with_prices: result.pricing.competitor_pricing.filter((c) =>
      (c.tiers ?? []).some((t) => typeof (t as { price?: unknown }).price === "number"),
    ).length,
    recommendations: result.positioning.recommended_positioning.length,
    pdf_url: result.report.pdf_url,
    object_key: result.report.object_key,
    cost_breakdown: result.cost_breakdown,
    total_cost_usd: Number(
      result.cost_breakdown.reduce((s, l) => s + l.amount_usd, 0).toFixed(6),
    ),
  };

  console.log("\n=== LIVE FEATURE 5 COMPLETE ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nDownload PDF:\n  ${result.report.pdf_url}\n`);
}

function countUnknown(featureDiff: {
  features: string[];
  matrix: Record<string, Record<string, { status: string }> | undefined>;
}): { unknown: number; total: number; ratio: number } {
  let unknown = 0;
  let total = 0;
  for (const entity of Object.values(featureDiff.matrix)) {
    for (const f of featureDiff.features) {
      total += 1;
      if ((entity?.[f]?.status ?? "unknown") === "unknown") unknown += 1;
    }
  }
  return {
    unknown,
    total,
    ratio: total === 0 ? 0 : Number((unknown / total).toFixed(3)),
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
