/**
 * Live promo-video runner — Firecrawl + Gemini + Supabase images + Segmind Seedance.
 *
 * Usage:
 *   pnpm --filter @founderforge/promo-video-service live -- \
 *     --url 'https://surveys.free/google-forms-alternative/' \
 *     --duration 15 \
 *     --resolution 720p
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv, createLogger } from "@founderforge/observability";
import { runPipeline } from "../pipeline.js";
import { supabaseConfigured } from "../storage.js";
import type { PromoResolution } from "../types.js";

loadRootEnv(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."),
);

const log = createLogger("live-promo");

const DURATIONS = new Set([4, 5, 6, 8, 10, 12, 15]);
const RESOLUTIONS = new Set(["480p", "720p", "1080p", "4k"]);

function parseArgs(argv: string[]): {
  url?: string;
  duration: number;
  resolution: PromoResolution;
  maxPages: number;
  resume?: string;
  help: boolean;
} {
  const args = argv.filter((a) => a !== "--");
  let url: string | undefined;
  let duration = 15;
  let resolution: PromoResolution = "720p";
  let maxPages = 6;
  let resume: string | undefined;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-h" || a === "--help") help = true;
    else if (a === "--url") url = args[++i];
    else if (a === "--duration") duration = Number.parseInt(args[++i] || "", 10);
    else if (a === "--resolution") resolution = args[++i] as PromoResolution;
    else if (a === "--max-pages") maxPages = Number.parseInt(args[++i] || "", 10);
    else if (a === "--resume") resume = args[++i];
    else if (!url && a && !a.startsWith("-")) url = a;
  }

  return { url, duration, resolution, maxPages, resume, help };
}

async function main() {
  const { url, duration, resolution, maxPages, resume, help } = parseArgs(
    process.argv.slice(2),
  );

  if (help || !url) {
    console.log(`Usage: live -- --url '<product_url>' [options]

Options:
  --duration 4|5|6|8|10|12|15   Seedance duration (default 15)
  --resolution 480p|720p|1080p|4k  (default 720p)
  --max-pages 1..9              (default 6)
  --resume <request_id>         Resume an existing Segmind job (CLI only)

Examples:
  live -- --url 'https://surveys.free/google-forms-alternative/' --duration 15 --resolution 720p`);
    process.exit(help ? 0 : 1);
  }

  if (!DURATIONS.has(duration)) {
    throw new Error(`Invalid --duration ${duration}`);
  }
  if (!RESOLUTIONS.has(resolution)) {
    throw new Error(`Invalid --resolution ${resolution}`);
  }

  log.info("starting live promo video", {
    product_url: url,
    duration,
    resolution,
    max_pages: maxPages,
    resume: resume || null,
    firecrawl: Boolean(process.env.FIRECRAWL_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
    segmind: Boolean(process.env.SEGMIND_API_KEY),
    supabase: supabaseConfigured(),
  });

  if (!process.env.FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY missing");
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");
  if (!process.env.SEGMIND_API_KEY) throw new Error("SEGMIND_API_KEY missing");
  if (!supabaseConfigured()) {
    throw new Error(
      "Image Supabase Storage required (DEMO_SUPABASE_URL + DEMO_SUPABASE_SERVICE_ROLE_KEY)",
    );
  }

  const started = Date.now();
  const result = await runPipeline(
    {
      product_url: url,
      duration: duration as 4 | 5 | 6 | 8 | 10 | 12 | 15,
      resolution,
      max_pages: maxPages,
    },
    { resumeRequestId: resume ?? null },
  );
  const elapsed_ms = Date.now() - started;

  const summary = {
    elapsed_ms,
    video_url: result.video_url,
    request_id: result.request_id,
    duration_seconds: result.duration_seconds,
    concept: result.concept,
    image_urls: result.image_urls,
    cost_breakdown: result.cost_breakdown,
    total_cost_usd: Number(
      result.cost_breakdown.reduce((s, l) => s + l.amount_usd, 0).toFixed(6),
    ),
  };

  console.log("\n=== LIVE PROMO VIDEO COMPLETE ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nSegmind video:\n  ${result.video_url}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
