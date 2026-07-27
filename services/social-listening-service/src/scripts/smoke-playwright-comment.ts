/**
 * Live comment via Playwright only (no ReddAPI) — FounderForge social-listening-service.
 *
 *   pnpm --filter @founderforge/social-listening-service reddit:comment-smoke
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
  const fs = await import("node:fs");
  const {
    launchRedditChrome,
    loadPreferredProxy,
    preferHeaded,
    redditProfileDir,
  } = await import("../browser/redditChrome.js");
  const { projectRoot } = await import("../config.js");
  const { canPostReddit, postRedditReply } = await import("../post/reddit.js");

  async function findRTestPost(): Promise<string> {
    const proxy = loadPreferredProxy();
    const context = await launchRedditChrome({
      proxy,
      headed: preferHeaded("REDDIT_POST_HEADED", "true"),
    });
    try {
      const page = context.pages()[0] || (await context.newPage());
      await page.goto("https://www.reddit.com/r/test/new.json?limit=5", {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await page.waitForTimeout(1200);
      const pre = await page
        .locator("pre")
        .first()
        .textContent()
        .catch(() => null);
      const raw =
        pre?.trim() ||
        (await page.locator("body").innerText().catch(() => ""));
      const data = JSON.parse(raw);
      const child = data?.data?.children?.[0]?.data;
      if (child?.permalink) {
        return `https://www.reddit.com${child.permalink}`.replace(/\/?$/, "/");
      }
    } finally {
      await context.close().catch(() => {});
    }

    const disc = path.join(projectRoot(), "scripts", "discovered-threads.json");
    if (fs.existsSync(disc)) {
      const rows = JSON.parse(fs.readFileSync(disc, "utf8")) as {
        url: string;
      }[];
      if (rows[0]?.url) return rows[0].url.replace(/\/?$/, "/");
    }
    throw new Error("No target URL — pass --url");
  }

  const url = arg("--url") || (await findRTestPost());
  const text =
    arg("--text") ||
    `founderforge playwright smoke ${Date.now()} — ignore, no ReddAPI`;

  const postMatch = url.match(/\/comments\/([a-z0-9]+)/i);
  const targetRef = postMatch ? `post_${postMatch[1]}` : "post_unknown";

  console.log("── FounderForge Playwright comment smoke (no ReddAPI) ──");
  console.log("profile:", redditProfileDir());
  console.log("canPostReddit:", canPostReddit());
  console.log("url:", url);
  console.log("targetRef:", targetRef);

  if (!canPostReddit()) {
    console.error(
      "FAIL: need .reddit-profile (REDDIT_PROFILE_DIR) with Reddit login",
    );
    process.exit(1);
  }

  const result = await postRedditReply({
    targetRef,
    permalinkTarget: url,
    draftText: text,
  });

  console.log("OK posted:", result.permalink);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
