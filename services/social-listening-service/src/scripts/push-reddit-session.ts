/**
 * Pack local Reddit Chrome profile + cookies and upload to Supabase Storage.
 *
 *   pnpm --filter @founderforge/social-listening-service reddit:push-session
 *
 * Uses REDDIT_PROFILE_DIR / REDDIT_SESSION_COOKIES_PATH from FounderForge/.env
 * (your laptop paths are fine here). Cloud Run then pulls via ensureRedditSessionLocal.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "@founderforge/observability";

loadRootEnv(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."),
);

async function main() {
  const { redditProfileDir, redditCookiesPath } = await import(
    "../browser/redditChrome.js"
  );
  const { pushRedditSessionToStorage, redditSessionStorageConfigured } =
    await import("../redditSessionStorage.js");

  if (!redditSessionStorageConfigured()) {
    throw new Error(
      "Set REDDIT_SUPABASE_* or DEMO_SUPABASE_URL + DEMO_SUPABASE_SERVICE_ROLE_KEY in .env",
    );
  }

  console.log("── Push Reddit session → Supabase ──");
  console.log("profile:", redditProfileDir());
  console.log("cookies:", redditCookiesPath());

  const result = await pushRedditSessionToStorage();
  console.log("OK uploaded", {
    profile_tar_bytes: result.profileBytes,
    cookies_bytes: result.cookiesBytes,
    bucket: process.env.REDDIT_SUPABASE_STORAGE_BUCKET || "demoforge",
    prefix: process.env.REDDIT_SUPABASE_OBJECT_PREFIX || "redditcreds",
    objects: "profile.tar.gz + cookies.json",
  });
  console.log(
    "\nAny deploy: keep REDDIT_SESSION_REMOTE=true — pipeline pulls these on start.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
