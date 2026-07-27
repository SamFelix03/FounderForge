/**
 * Discover Reddit thread URLs via the logged-in Playwright profile.
 * Fallback when Groq Compound web_search is rate-limited / empty.
 */
import type { BrowserContext } from "playwright";
import {
  hasRedditProfile,
  launchRedditChrome,
  loadPreferredProxy,
  preferHeaded,
} from "../browser/redditChrome.js";
import { envInt } from "../config.js";
import { createLogger } from "../log.js";
import type { ProductConfig } from "../types.js";
import type { CompoundDiscoverHit } from "./compoundReddit.js";
import { looksLikeLaunchOrShowcase, looksLikeSeekerAsk } from "../agents/prefilter.js";

const log = createLogger("ingest.playwright.discover");

export function canDiscoverViaPlaywright(): boolean {
  return hasRedditProfile();
}

function threadUrlFromHref(href: string): string | null {
  try {
    const u = new URL(href, "https://www.reddit.com");
    const m = u.pathname.match(
      /^\/r\/([^/]+)\/comments\/([a-z0-9]+)(?:\/([^/]*))?/i,
    );
    if (!m) return null;
    if (m[3] === "comment") return null;
    const slug = m[3] && m[3] !== "comment" ? m[3] : "";
    const pathPart = slug
      ? `/r/${m[1]}/comments/${m[2]}/${slug}/`
      : `/r/${m[1]}/comments/${m[2]}/`;
    return `https://www.reddit.com${pathPart}`;
  } catch {
    return null;
  }
}

async function openContext(): Promise<BrowserContext> {
  return launchRedditChrome({
    headed: preferHeaded("REDDIT_DISCOVER_HEADED", "true"),
  });
}

async function collectFromPage(
  context: BrowserContext,
  pageUrl: string,
  limit: number,
): Promise<CompoundDiscoverHit[]> {
  const page = await context.newPage();
  try {
    await page.goto(pageUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(2000);
    const rows = await page.$$eval("a[href*='/comments/']", (els) =>
      els.map((a) => ({
        href: (a as { href: string }).href,
        title:
          ((a as { innerText?: string }).innerText || "").trim() ||
          a.getAttribute("aria-label") ||
          (a as { title?: string }).title ||
          "",
      })),
    );
    const out: CompoundDiscoverHit[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const url = threadUrlFromHref(row.href);
      if (!url || seen.has(url)) continue;
      const title = row.title || "";
      // Prefer seeker titles; still keep some if search was ask-oriented
      if (looksLikeLaunchOrShowcase(title) && !looksLikeSeekerAsk(title)) {
        continue;
      }
      seen.add(url);
      out.push({ url, title, selftext: "" });
      if (out.length >= limit) break;
    }
    return out;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Visit subreddit search pages for seeker queries; collect thread URLs.
 */
export async function discoverRedditThreadsViaPlaywright(
  product: ProductConfig,
): Promise<CompoundDiscoverHit[]> {
  if (!canDiscoverViaPlaywright()) {
    log.warn("no Reddit profile — skip Playwright discovery");
    return [];
  }

  const subs = (product.subreddits || [])
    .map((s) => s.replace(/^r\//i, ""))
    .filter(Boolean)
    .slice(0, envInt("REDDIT_MAX_SUBS", 5));
  if (!subs.length) return [];

  const perSub = envInt("REDDIT_POSTS_PER_SUB", 8);
  const proxy = loadPreferredProxy();
  const askQ =
    '(looking for OR recommend OR alternative OR "how do I" OR "does anyone" OR "what do you use")';

  let context: BrowserContext | undefined;
  const out: CompoundDiscoverHit[] = [];
  const seen = new Set<string>();

  try {
    context = await openContext();
    for (const sub of subs) {
      const kws = (product.keywords || []).slice(0, 2).join(" OR ");
      const pages = [
        `https://www.reddit.com/r/${sub}/search/?q=${encodeURIComponent(`${askQ} ${kws}`)}&restrict_sr=1&sort=new`,
        `https://www.reddit.com/r/${sub}/search/?q=${encodeURIComponent(askQ)}&restrict_sr=1&sort=new`,
      ];

      for (const pageUrl of pages) {
        try {
          const hits = await collectFromPage(context, pageUrl, perSub);
          log.info("playwright discover page", {
            pageUrl: pageUrl.slice(0, 90),
            hits: hits.length,
          });
          for (const h of hits) {
            if (seen.has(h.url)) continue;
            seen.add(h.url);
            out.push({ ...h, subreddit: sub });
          }
        } catch (err) {
          log.warn("playwright discover page failed", {
            pageUrl: pageUrl.slice(0, 90),
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  } finally {
    await context?.close().catch(() => {});
  }

  log.info("playwright discovery done", {
    threads: out.length,
    subs: subs.length,
    proxy: proxy?.label || "none",
  });
  return out;
}
