/**
 * Standalone: Tavily Research → structured Reddit thread URLs.
 *
 * Usage:
 *   pnpm --filter @founderforge/social-listening-service tavily:reddit -- \
 *     [--need "..."] [--max 10] [--model mini|pro|auto] [--out path.json]
 *
 * Research-only (no Search fallback).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv, createLogger } from "@founderforge/observability";

loadRootEnv(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."),
);

const log = createLogger("tavily-reddit-discover");

const DEFAULT_NEED =
  "someone building an AI agent complains about needing separate API keys and subscriptions for every tool (like Twitter/X scraping, TikTok, Reddit, Amazon, or market data), and wishes there was one unified account or wallet to pay per API call instead of managing dozens of integrations.";

function parseArgs(argv: string[]): {
  need: string;
  max: number;
  model: "mini" | "pro" | "auto";
  out?: string;
  help: boolean;
  dumpRaw: boolean;
} {
  const args = argv.filter((a) => a !== "--");
  let need = DEFAULT_NEED;
  let max = Number.parseInt(process.env.TAVILY_REDDIT_LIMIT || "10", 10) || 10;
  let model = (process.env.TAVILY_RESEARCH_MODEL || "mini") as
    | "mini"
    | "pro"
    | "auto";
  let out: string | undefined;
  let help = false;
  let dumpRaw = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-h" || a === "--help") help = true;
    else if (a === "--need") need = args[++i] || need;
    else if (a === "--max") max = Number.parseInt(args[++i] || "", 10) || max;
    else if (a === "--model") {
      const m = (args[++i] || "").toLowerCase();
      if (m === "mini" || m === "pro" || m === "auto") model = m;
    } else if (a === "--out") out = args[++i];
    else if (a === "--dump-raw") dumpRaw = true;
    else if (a === "--mode") {
      // Ignored — research only; keep flag for backwards CLI compat
      i++;
    }
  }

  return { need, max, model, out, help, dumpRaw };
}

async function main() {
  const { need, max, model, out, help, dumpRaw } = parseArgs(
    process.argv.slice(2),
  );

  if (help) {
    console.log(`Usage: tavily:reddit -- [options]

Options:
  --need "..."     Pain / seeker statement (Compound fills this later)
  --max N          Max threads (default 10)
  --model mini|pro|auto   Tavily research model (default mini)
  --out path.json  Write threads JSON (default scripts/tavily-discovered-threads.json)
  --dump-raw       Also write full Tavily response next to --out

Research-only. No Search fallback.
`);
    process.exit(0);
  }

  if (!process.env.TAVILY_API_KEY?.trim()) {
    console.error("Missing TAVILY_API_KEY in FounderForge/.env");
    process.exit(1);
  }

  const { discoverRedditThreadsViaTavily, buildRedditOnlyResearchPrompt } =
    await import("../ingest/tavilyReddit.js");

  const prompt = buildRedditOnlyResearchPrompt(need, max);
  console.log("\n=== PROMPT SENT TO TAVILY RESEARCH ===\n");
  console.log(prompt);
  console.log("\n=== RESEARCHING (this can take 30–120s) ===\n");

  const { hits, meta } = await discoverRedditThreadsViaTavily({
    needStatement: need,
    maxThreads: max,
    model,
  });

  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../..",
  );
  const outPath =
    out || path.join(root, "scripts", "tavily-discovered-threads.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const payload = hits.map((h) => ({
    url: h.url,
    title: h.title,
    selftext: h.selftext,
    ...(h.subreddit ? { subreddit: h.subreddit } : {}),
    ...(h.why ? { why: h.why } : {}),
  }));
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

  if (dumpRaw) {
    const rawPath = outPath.replace(/\.json$/i, "") + ".raw.json";
    fs.writeFileSync(
      rawPath,
      JSON.stringify(
        {
          requestId: meta.requestId,
          status: meta.status,
          model: meta.model,
          elapsedMs: meta.elapsedMs,
          prompt: meta.prompt,
          content: meta.content,
          sources: meta.sources,
        },
        null,
        2,
      ),
    );
    log.info("wrote raw tavily response", { path: rawPath });
  }

  console.log("\n=== STRUCTURED THREADS ===\n");
  console.log(JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${payload.length} thread(s) → ${outPath}`);
  console.log(
    JSON.stringify(
      {
        request_id: meta.requestId,
        status: meta.status,
        model: meta.model,
        elapsed_ms: meta.elapsedMs,
        threads: payload.length,
        structured_ok: payload.every(
          (t) =>
            typeof t.url === "string" &&
            t.url.includes("/comments/") &&
            typeof t.title === "string",
        ),
      },
      null,
      2,
    ),
  );

  if (!payload.length) {
    console.error(
      "\nNo Reddit threads returned. Inspect with --dump-raw or try --model pro.",
    );
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
