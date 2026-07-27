/**
 * Social listening runner — product URL → Reddit engagement PDF on Supabase.
 *
 * Usage:
 *   pnpm --filter @founderforge/social-listening-service live -- \
 *     --url 'https://example.com' [--max-posts 3]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv, createLogger } from "@founderforge/observability";

loadRootEnv(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."),
);

const log = createLogger("live-social-listening");

function parseArgs(argv: string[]): {
  url?: string;
  maxPosts?: number;
  help: boolean;
} {
  const args = argv.filter((a) => a !== "--");
  let url: string | undefined;
  let maxPosts: number | undefined;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-h" || a === "--help") help = true;
    else if (a === "--url") url = args[++i];
    else if (a === "--max-posts") {
      maxPosts = Number.parseInt(args[++i] || "", 10);
    } else if (!url && a && !a.startsWith("-")) url = a;
  }

  return { url, maxPosts, help };
}

async function main() {
  const { url, maxPosts, help } = parseArgs(process.argv.slice(2));

  if (help || !url) {
    console.log(`Usage: live -- --url '<product_url>' [options]

Options:
  --max-posts 1..20   Cap recommendations this run

Examples:
  live -- --url 'https://example.com'
  live -- --url 'https://example.com' --max-posts 3`);
    process.exit(help ? 0 : 1);
  }

  const { runPipeline } = await import("../pipeline.js");

  log.info("starting social listening", {
    product_url: url,
    max_posts: maxPosts ?? null,
    groq: Boolean(process.env.GROQ_API_KEY || process.env.GROQ_API_KEY_1),
    tavily: Boolean(process.env.TAVILY_API_KEY),
  });

  if (!(process.env.GROQ_API_KEY || process.env.GROQ_API_KEY_1)) {
    throw new Error("GROQ_API_KEY (or GROQ_API_KEY_1) missing");
  }
  if (!process.env.TAVILY_API_KEY?.trim()) {
    throw new Error("TAVILY_API_KEY missing");
  }

  const started = Date.now();
  const result = await runPipeline({
    product_url: url,
    live: false,
    max_posts: maxPosts,
  });
  const elapsed_ms = Date.now() - started;

  const summary = {
    elapsed_ms,
    product_name: result.product_name,
    pdf_url: result.pdf_url,
    object_key: result.object_key,
    recommendations_count: result.recommendations_count,
    thread_urls: result.thread_urls,
    recommendations: result.recommendations,
    cost_breakdown: result.cost_breakdown,
  };

  console.log("\n=== SOCIAL LISTENING COMPLETE ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nOpen report: ${result.pdf_url}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
