/**
 * Live outreach runner — website + revenue sheet → investor outreach PDF.
 *
 * Usage:
 *   pnpm --filter @founderforge/outreach-service live -- \
 *     --website-url URL --sheet-path PATH [--sheet-url URL]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv, createLogger } from "@founderforge/observability";
import { supabaseConfigured } from "../report/storage.js";

loadRootEnv(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."),
);

const log = createLogger("live-outreach");

function parseArgs(argv: string[]): {
  websiteUrl?: string;
  sheetPath?: string;
  sheetUrl?: string;
  help: boolean;
} {
  const args = argv.filter((a) => a !== "--");
  let websiteUrl: string | undefined;
  let sheetPath: string | undefined;
  let sheetUrl: string | undefined;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-h" || a === "--help") help = true;
    else if (a === "--website-url" || a === "--url" || a === "--website") {
      websiteUrl = args[++i];
    } else if (a === "--sheet-path" || a === "--sheet" || a === "--file") {
      sheetPath = args[++i];
    } else if (a === "--sheet-url") {
      sheetUrl = args[++i];
    }
  }

  return { websiteUrl, sheetPath, sheetUrl, help };
}

async function main() {
  const { websiteUrl, sheetPath, sheetUrl, help } = parseArgs(process.argv.slice(2));

  if (help || !websiteUrl || (!sheetPath && !sheetUrl)) {
    console.log(`Usage: live -- --website-url URL --sheet-path PATH [--sheet-url URL]

Options:
  --website-url URL   Company website to analyze
  --sheet-path PATH   Local .xlsx/.xls/.csv workbook
  --sheet-url URL     Remote workbook URL (downloaded if no --sheet-path)

Examples:
  live -- --website-url 'https://example.com' --sheet-path './revenue.xlsx'
  live -- --website-url 'https://example.com' --sheet-url 'https://cdn.example.com/rev.xlsx'`);
    process.exit(help ? 0 : 1);
  }

  const { runPipeline } = await import("../pipeline.js");

  log.info("starting outreach pipeline", {
    website_url: websiteUrl,
    sheet_path: sheetPath ?? null,
    sheet_url: sheetUrl ?? null,
    groq: Boolean(process.env.GROQ_API_KEY || process.env.GROQ_API_KEY_1),
    exa: Boolean(process.env.EXA_SEARCH_API_KEY || process.env.EXA_API_KEY),
    supabase: supabaseConfigured(),
  });

  if (!(process.env.GROQ_API_KEY || process.env.GROQ_API_KEY_1)) {
    throw new Error("GROQ_API_KEY (or GROQ_API_KEY_1) missing");
  }
  if (!(process.env.EXA_SEARCH_API_KEY || process.env.EXA_API_KEY)) {
    throw new Error("EXA_SEARCH_API_KEY (or EXA_API_KEY) missing");
  }

  const started = Date.now();
  const result = await runPipeline(
    {
      website_url: websiteUrl,
      sheet_path: sheetPath,
      sheet_url: sheetUrl,
    },
    {
      onStep: (s) => log.info("step", { step: s.step, detail: s.detail ?? null }),
    },
  );
  const elapsed_ms = Date.now() - started;

  const summary = {
    elapsed_ms,
    status: result.status,
    website_url: result.website.url,
    investor_count: result.investors.exaResultCount,
    contact_count: result.partnerContacts.contacts.length,
    pdf_url: result.report.pdf_url ?? null,
    object_key: result.report.object_key ?? null,
    bytes: result.report.bytes ?? null,
  };

  console.log("\n=== OUTREACH COMPLETE ===");
  console.log(JSON.stringify(result, null, 2));
  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
  if (result.report.pdf_url) {
    console.log(`\nReport URL:\n${result.report.pdf_url}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
