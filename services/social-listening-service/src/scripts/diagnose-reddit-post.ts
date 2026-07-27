/**
 * Isolate Reddit comment posting from discovery/draft.
 *
 * Hardcoded neutral comment → known sandbox thread (r/test) or --url.
 * Verifies the comment still exists a few seconds later (catches instant removals).
 *
 *   pnpm --filter @founderforge/social-listening-service reddit:diagnose-post
 *   pnpm --filter @founderforge/social-listening-service reddit:diagnose-post -- --no-proxy
 *   pnpm --filter @founderforge/social-listening-service reddit:diagnose-post -- --url "https://www.reddit.com/r/test/comments/.../"
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "@founderforge/observability";

loadRootEnv(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."),
);

/** Neutral, non-promotional — no product name, no links, no disclosure. */
const HARDCODED_COMMENT =
  "Just testing that my account can leave a short comment here. Ignore — sandbox check, nothing to sell.";

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function arg(flag: string, fallback = ""): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

function postIdFromUrl(url: string): string {
  const m = url.match(/\/comments\/([a-z0-9]+)/i);
  if (!m) throw new Error(`Not a Reddit comments URL: ${url}`);
  return m[1]!;
}

async function findLatestRTestPost(): Promise<string> {
  const {
    launchRedditChrome,
    loadPreferredProxy,
    preferHeaded,
  } = await import("../browser/redditChrome.js");

  const directOnly = hasFlag("--no-proxy");
  const context = await launchRedditChrome({
    proxy: directOnly ? null : loadPreferredProxy(),
    headed: preferHeaded("REDDIT_POST_HEADED", "true"),
  });
  try {
    const page = context.pages()[0] || (await context.newPage());
    // Prefer old.reddit JSON — more reliable under proxy
    await page.goto("https://old.reddit.com/r/test/new.json?limit=5", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(1500);
    const pre = await page.locator("pre").first().textContent().catch(() => null);
    const raw =
      pre?.trim() ||
      (await page.locator("body").innerText().catch(() => ""));
    const data = JSON.parse(raw) as {
      data?: { children?: Array<{ data?: { permalink?: string; title?: string } }> };
    };
    const child = data?.data?.children?.[0]?.data;
    if (!child?.permalink) {
      throw new Error("Could not find a post in r/test/new.json");
    }
    const url = `https://www.reddit.com${child.permalink}`.replace(/\/?$/, "/");
    console.log("sandbox target (latest r/test):", child.title || "(no title)");
    return url;
  } finally {
    await context.close().catch(() => {});
  }
}

async function verifyComment(opts: {
  permalink: string;
  needle: string;
  directOnly: boolean;
}): Promise<{
  visible: boolean;
  removed: boolean;
  loggedOut: boolean;
  bodyPreview: string;
}> {
  const {
    launchRedditChrome,
    loadPreferredProxy,
    preferHeaded,
  } = await import("../browser/redditChrome.js");

  const context = await launchRedditChrome({
    proxy: opts.directOnly ? null : loadPreferredProxy(),
    headed: preferHeaded("REDDIT_POST_HEADED", "true"),
  });
  try {
    const page = context.pages()[0] || (await context.newPage());
    const checkUrl = opts.permalink
      .replace("www.reddit.com", "old.reddit.com")
      .replace("new.reddit.com", "old.reddit.com");
    await page.goto(checkUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(2500);
    const body = await page.locator("body").innerText().catch(() => "");
    const needle = opts.needle.slice(0, 48);
    const visible = needle.length >= 12 && body.includes(needle);
    const removed =
      /\[removed\]|comment deleted|this comment is no longer|removed by/i.test(
        body,
      ) && !visible;
    const loggedOut = /you must be logged|log in|sign in/i.test(body);
    return {
      visible,
      removed,
      loggedOut,
      bodyPreview: body.slice(0, 400).replace(/\s+/g, " "),
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function main() {
  if (hasFlag("-h") || hasFlag("--help")) {
    console.log(`Usage: reddit:diagnose-post -- [options]

Posts a HARDCODED non-promo comment to isolate Playwright posting.

Options:
  --url <permalink>   Known thread (default: latest post in r/test)
  --no-proxy          Post from home IP (skip Webshare) — key spam signal test
  --wait <seconds>    Delay before verify (default 12)
  --text "..."        Override hardcoded comment

Examples:
  pnpm --filter @founderforge/social-listening-service reddit:diagnose-post
  pnpm --filter @founderforge/social-listening-service reddit:diagnose-post -- --no-proxy
`);
    process.exit(0);
  }

  const {
    ensureRedditSessionLocal,
    redditSessionRemoteEnabled,
  } = await import("../redditSessionStorage.js");
  const { redditProfileDir } = await import("../browser/redditChrome.js");
  const { canPostViaPlaywright, postCommentViaPlaywright } = await import(
    "../post/playwrightReddit.js"
  );

  const directOnly = hasFlag("--no-proxy");
  const waitSec = Number.parseInt(arg("--wait", "12"), 10) || 12;
  const text = (arg("--text") || HARDCODED_COMMENT).trim();

  console.log("══ Reddit post diagnose ══");
  console.log("goal: isolate whether Playwright can leave a lasting comment");
  console.log("comment:", text);
  console.log("directOnly (--no-proxy):", directOnly);
  console.log("profile:", redditProfileDir());

  if (redditSessionRemoteEnabled()) {
    console.log("pulling Reddit session from Supabase…");
    const session = await ensureRedditSessionLocal({ force: true });
    console.log("session ready:", session.profileDir);
  }

  if (!canPostViaPlaywright()) {
    console.error("FAIL: no Reddit profile — push/pull session first");
    process.exit(1);
  }

  const url = (arg("--url") || (await findLatestRTestPost())).replace(
    /\/?$/,
    "/",
  );
  const targetRef = `post_${postIdFromUrl(url)}`;
  console.log("target:", url);
  console.log("targetRef:", targetRef);
  console.log("\n── posting ──");

  const started = Date.now();
  let resultPermalink: string;
  try {
    const result = await postCommentViaPlaywright({
      permalinkTarget: url,
      targetRef,
      draftText: text,
      directOnly,
    });
    resultPermalink = result.permalink;
  } catch (err) {
    console.error("\n══ RESULT: POST FAILED ══");
    console.error(err instanceof Error ? err.message : err);
    console.error(
      "\nRoot-cause hint: browser/session/proxy failed before Reddit accepted a comment.",
    );
    process.exit(1);
  }

  console.log("claimed permalink:", resultPermalink);
  console.log(`wait ${waitSec}s then re-open comment…`);
  await new Promise((r) => setTimeout(r, waitSec * 1000));

  console.log("\n── verify ──");
  const check = await verifyComment({
    permalink: resultPermalink,
    needle: text,
    directOnly,
  });

  const report = {
    elapsed_ms: Date.now() - started,
    target: url,
    result_permalink: resultPermalink,
    direct_only: directOnly,
    post_claimed_ok: true,
    still_visible: check.visible,
    looks_removed: check.removed,
    looks_logged_out: check.loggedOut,
    body_preview: check.bodyPreview,
  };
  console.log(JSON.stringify(report, null, 2));

  if (check.visible) {
    console.log(
      "\n══ RESULT: COMMENT STILL VISIBLE ══\nPosting path works. Removals on live runs are likely targeting/promo/spam filters on those threads.",
    );
    process.exit(0);
  }

  if (check.removed || !check.visible) {
    console.log(
      "\n══ RESULT: COMMENT GONE / NOT FOUND ══\nReddit accepted or appeared to accept, then filtered it.",
    );
    console.log("Likely causes (in order):");
    console.log(
      "  1. Account + datacenter proxy spam score (re-run with --no-proxy)",
    );
    console.log("  2. New / low-karma account filters");
    console.log("  3. Subreddit automod (r/test should be lenient)");
    console.log(
      "  4. False-positive confirm earlier (permalink without real comment id)",
    );
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
