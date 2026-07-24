/**
 * Batch live runner — compare Feature 5 quality across product categories.
 *
 * Usage:
 *   pnpm --filter @founderforge/competitor-research-service batch
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv, createLogger } from "@founderforge/observability";
import { runPipeline } from "../pipeline.js";
import { supabaseConfigured } from "../storage.js";

loadRootEnv(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."));

const log = createLogger("batch-feature5");

const PRODUCTS = [
  { product_name: "Notion", product_url: "https://www.notion.so" },
  { product_name: "Linear", product_url: "https://linear.app" },
  { product_name: "Figma", product_url: "https://www.figma.com" },
  { product_name: "Slack", product_url: "https://slack.com" },
  { product_name: "Stripe", product_url: "https://stripe.com" },
];

async function main() {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY missing");
  if (!process.env.JINA_API_KEY) {
    throw new Error(
      "JINA_API_KEY missing (required for Jina Reader — get a free key: https://jina.ai/?sui=apikey)",
    );
  }
  if (!supabaseConfigured()) {
    throw new Error("Supabase Storage required (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)");
  }

  const results = [];
  for (const product of PRODUCTS) {
    log.info("batch item starting", product);
    const started = Date.now();
    try {
      const out = await runPipeline(product);
      let unknown = 0;
      let total = 0;
      for (const entity of Object.values(out.feature_diff.matrix)) {
        for (const f of out.feature_diff.features) {
          total += 1;
          if ((entity?.[f]?.status ?? "unknown") === "unknown") unknown += 1;
        }
      }
      const priced = out.pricing.competitor_pricing.filter((c) =>
        (c.tiers ?? []).some((t) => typeof (t as { price?: unknown }).price === "number"),
      ).length;
      results.push({
        product: product.product_name,
        ok: true,
        elapsed_ms: Date.now() - started,
        competitors: out.competitors.length,
        features: out.feature_diff.features.length,
        unknown_ratio: total === 0 ? 0 : Number((unknown / total).toFixed(3)),
        competitors_with_prices: priced,
        pdf_url: out.report.pdf_url,
        total_cost_usd: Number(
          out.cost_breakdown.reduce((s, l) => s + l.amount_usd, 0).toFixed(6),
        ),
      });
    } catch (err) {
      results.push({
        product: product.product_name,
        ok: false,
        elapsed_ms: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log("\n=== BATCH FEATURE 5 COMPLETE ===");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
