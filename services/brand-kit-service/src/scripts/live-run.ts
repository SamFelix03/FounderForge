/**
 * Live brand-kit runner — brief → zip URL.
 *
 * Usage:
 *   pnpm --filter @founderforge/brand-kit-service live -- \
 *     --brand-name "Acme" --description "..." [--pick 0]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv, createLogger } from "@founderforge/observability";
import { supabaseConfigured } from "../report/storage.js";

loadRootEnv(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."),
);

const log = createLogger("live-brand-kit");

function parseArgs(argv: string[]): {
  brandName?: string;
  description?: string;
  pick: number;
  help: boolean;
} {
  const args = argv.filter((a) => a !== "--");
  let brandName: string | undefined;
  let description: string | undefined;
  let pick = 0;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-h" || a === "--help") help = true;
    else if (a === "--brand-name" || a === "--name") {
      brandName = args[++i];
    } else if (a === "--description") {
      description = args[++i];
    } else if (a === "--pick") {
      pick = Number.parseInt(args[++i] ?? "0", 10);
    }
  }

  return { brandName, description, pick, help };
}

async function main() {
  const { brandName, description, pick, help } = parseArgs(process.argv.slice(2));

  if (help || !brandName || !description) {
    console.log(`Usage: live -- --brand-name NAME --description "..." [--pick 0]

Options:
  --brand-name NAME   Brand / product name
  --description TEXT  Brand brief (style, vibe, what it does)
  --pick N            Concept index to use as primary mark (default 0)

Examples:
  live -- --brand-name 'Forge' --description 'Developer tools for indie founders, bold and modern'`);
    process.exit(help ? 0 : 1);
  }

  const { runPipeline } = await import("../pipeline.js");

  log.info("starting brand-kit pipeline", {
    brand_name: brandName,
    pick,
    vertex: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    supabase: supabaseConfigured(),
  });

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON missing");
  }

  const started = Date.now();
  const result = await runPipeline(
    {
      brand_name: brandName,
      description,
      pick: Number.isFinite(pick) ? pick : 0,
    },
    {
      onStep: (s) => log.info("step", { step: s.step, detail: s.detail ?? null }),
    },
  );
  const elapsed_ms = Date.now() - started;

  const summary = {
    elapsed_ms,
    status: result.status,
    brand_name: result.brand_name,
    chosen_concept: result.chosen_concept,
    zip_url: result.zip_url,
    object_key: result.object_key ?? null,
  };

  console.log("\n=== BRAND KIT COMPLETE ===");
  console.log(JSON.stringify(result, null, 2));
  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nZip URL:\n${result.zip_url}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
