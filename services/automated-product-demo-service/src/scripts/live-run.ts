/**
 * Live automated product demo runner — Firecrawl + Gemini + Deepgram + Supabase.
 *
 * Usage:
 *   pnpm --filter @founderforge/automated-product-demo-service live -- \
 *     --url 'https://example.com' --script 'Show the pricing page'
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv, createLogger } from "@founderforge/observability";
import { runPipeline } from "../pipeline.js";
import { supabaseConfigured } from "../storage.js";

loadRootEnv(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."),
);

const log = createLogger("live-apd");

function parseArgs(argv: string[]): { url?: string; script?: string; help: boolean } {
  const args = argv.filter((a) => a !== "--");
  let url: string | undefined;
  let script: string | undefined;
  let help = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-h" || a === "--help") help = true;
    else if (a === "--url") url = args[++i];
    else if (a === "--script") script = args[++i];
    else if (!url) url = a;
    else if (!script) script = a;
  }
  return { url, script, help };
}

async function main() {
  const { url, script, help } = parseArgs(process.argv.slice(2));
  if (help || !url || !script) {
    console.log(`Usage: live -- --url '<website_url>' --script '<demo script>'

Examples:
  live -- --url 'https://surveys.free/google-forms-alternative/' --script 'Create a Birthday RSVP form'
  live -- 'https://example.com' 'Show the homepage hero and pricing'`);
    process.exit(help ? 0 : 1);
  }

  log.info("starting live automated product demo", {
    website_url: url,
    scriptPreview: script.slice(0, 120),
    firecrawl: Boolean(process.env.FIRECRAWL_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
    deepgram: Boolean(process.env.DEEPGRAM_API_KEY),
    supabase: supabaseConfigured(),
  });

  if (!process.env.FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY missing");
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");
  if (!process.env.DEEPGRAM_API_KEY) throw new Error("DEEPGRAM_API_KEY missing");
  if (!supabaseConfigured()) {
    throw new Error(
      "Demo Supabase Storage required (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)",
    );
  }

  const started = Date.now();
  const result = await runPipeline({ website_url: url, script });
  const elapsed_ms = Date.now() - started;

  const summary = {
    elapsed_ms,
    video_url: result.video_url,
    object_key: result.object_key,
    duration_seconds: result.duration_seconds,
    steps: result.steps.length,
    cost_breakdown: result.cost_breakdown,
    total_cost_usd: Number(
      result.cost_breakdown.reduce((s, l) => s + l.amount_usd, 0).toFixed(6),
    ),
  };

  console.log("\n=== LIVE AUTOMATED PRODUCT DEMO COMPLETE ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nWatch video:\n  ${result.video_url}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
