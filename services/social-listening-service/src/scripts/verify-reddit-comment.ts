/**
 * Check whether a draft snippet appears on a Reddit thread (old.reddit).
 *   pnpm exec tsx src/scripts/verify-reddit-comment.ts --url '...' --snippet '...'
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "@founderforge/observability";

loadRootEnv(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."),
);

function arg(flag: string, fallback = ""): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

async function main() {
  const url =
    arg("--url") ||
    "https://old.reddit.com/r/SideProject/comments/1s9mpf3/im_building_the_data_layer_for_ai_agents_heres/";
  const snippet =
    arg("--snippet") ||
    "Sounds like you’ve learned a lot already";

  const { ensureRedditSessionLocal } = await import(
    "../redditSessionStorage.js"
  );
  const {
    launchRedditChrome,
    loadPreferredProxy,
    preferHeaded,
  } = await import("../browser/redditChrome.js");

  await ensureRedditSessionLocal({ force: true });
  const context = await launchRedditChrome({
    proxy: loadPreferredProxy(),
    headed: preferHeaded("REDDIT_POST_HEADED", "true"),
  });
  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2500);
    const body = await page.locator("body").innerText();
    const hit = body.includes(snippet);
    const monid = /monid\.ai/i.test(body);
    const comments = await page
      .locator(".comment .usertext-body, shreddit-comment")
      .count()
      .catch(() => 0);
    console.log(
      JSON.stringify(
        {
          url,
          snippet_found: hit,
          monid_mention: monid,
          comment_nodes: comments,
          body_preview: body.slice(0, 500).replace(/\s+/g, " "),
        },
        null,
        2,
      ),
    );
    process.exit(hit ? 0 : 2);
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
