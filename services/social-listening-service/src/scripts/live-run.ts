/**
 * Live social-listening runner — product URL → Reddit drafts / posts.
 *
 * Usage:
 *   pnpm --filter @founderforge/social-listening-service live -- \
 *     --url 'https://example.com' [--live] [--max-posts 3]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv, createLogger } from "@founderforge/observability";
import { runPipeline } from "../pipeline.js";

loadRootEnv(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."),
);

const log = createLogger("live-social-listening");

function parseArgs(argv: string[]): {
  url?: string;
  live: boolean;
  maxPosts?: number;
  help: boolean;
} {
  const args = argv.filter((a) => a !== "--");
  let url: string | undefined;
  let live = false;
  let maxPosts: number | undefined;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-h" || a === "--help") help = true;
    else if (a === "--url") url = args[++i];
    else if (a === "--live") live = true;
    else if (a === "--max-posts") {
      maxPosts = Number.parseInt(args[++i] || "", 10);
    } else if (!url && a && !a.startsWith("-")) url = a;
  }

  return { url, live, maxPosts, help };
}

async function main() {
  const { url, live, maxPosts, help } = parseArgs(process.argv.slice(2));

  if (help || !url) {
    console.log(`Usage: live -- --url '<product_url>' [options]

Options:
  --live              Actually post (default dry-run)
  --max-posts 1..20   Cap posts this run

Examples:
  live -- --url 'https://example.com'
  live -- --url 'https://example.com' --live --max-posts 2`);
    process.exit(help ? 0 : 1);
  }

  log.info("starting social listening", {
    product_url: url,
    live,
    max_posts: maxPosts ?? null,
    groq: Boolean(process.env.GROQ_API_KEY || process.env.GROQ_API_KEY_1),
    rapidapi: Boolean(process.env.RAPIDAPI_KEY || process.env.REDDAPI_KEY),
  });

  if (!(process.env.GROQ_API_KEY || process.env.GROQ_API_KEY_1)) {
    throw new Error("GROQ_API_KEY (or GROQ_API_KEY_1) missing");
  }

  const started = Date.now();
  const result = await runPipeline({
    product_url: url,
    live,
    max_posts: maxPosts,
  });
  const elapsed_ms = Date.now() - started;

  const summary = {
    elapsed_ms,
    product_name: result.product_name,
    live: result.live,
    posts_attempted: result.posts_attempted,
    posted_urls: result.posted_urls,
    posts: result.posts,
    cost_breakdown: result.cost_breakdown,
  };

  console.log("\n=== SOCIAL LISTENING COMPLETE ===");
  console.log(JSON.stringify(summary, null, 2));
  if (result.posted_urls.length) {
    console.log("\nPosted / dry-run URLs:");
    for (const u of result.posted_urls) console.log(`  ${u}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
