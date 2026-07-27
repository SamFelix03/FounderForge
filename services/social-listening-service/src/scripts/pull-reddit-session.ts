/**
 * Pull Reddit session from Supabase into local/runtime paths (Cloud Run smoke).
 *
 *   pnpm --filter @founderforge/social-listening-service reddit:pull-session
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "@founderforge/observability";

loadRootEnv(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."),
);

async function main() {
  process.env.REDDIT_SESSION_REMOTE = process.env.REDDIT_SESSION_REMOTE || "true";

  const { ensureRedditSessionLocal, redditSessionStorageConfigured } =
    await import("../redditSessionStorage.js");

  if (!redditSessionStorageConfigured()) {
    throw new Error(
      "Set REDDIT_SUPABASE_* or DEMO_SUPABASE_URL + DEMO_SUPABASE_SERVICE_ROLE_KEY in .env",
    );
  }

  console.log("── Pull Reddit session ← Supabase ──");
  const result = await ensureRedditSessionLocal({ force: true });
  console.log("OK", result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
