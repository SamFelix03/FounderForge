/**
 * Fetch Reddit thread post + comments via Playwright session (.json endpoint).
 * Public Reddit JSON is 403; logged-in profile works.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { envInt, envOr, projectRoot } from "../config.js";
import { createLogger } from "../log.js";
import { parseProxy, type ParsedProxy } from "../redditSessionRefresh.js";
import type { NormalizedEvent } from "../types.js";
import { makeEvent } from "./normalize.js";

const log = createLogger("ingest.playwright.content");
const root = projectRoot();
const PROFILE_DIR = path.join(root, ".reddit-profile");
const ACTIVE_PROXY_FILE = path.join(root, "scripts", "active-proxy.txt");
const PROXY_FILE = path.join(root, "scripts", "webshare-proxies.txt");

export function canFetchRedditViaPlaywright(): boolean {
  return fs.existsSync(PROFILE_DIR);
}

function loadProxy(): ParsedProxy | null {
  const candidates = [
    envOr("REDDAPI_PROXY") || envOr("REDDIT_PROXY"),
    fs.existsSync(ACTIVE_PROXY_FILE)
      ? fs.readFileSync(ACTIVE_PROXY_FILE, "utf8")
      : "",
  ];
  if (fs.existsSync(PROXY_FILE)) {
    for (const line of fs.readFileSync(PROXY_FILE, "utf8").split(/\r?\n/)) {
      candidates.push(line);
    }
  }
  for (const c of candidates) {
    const p = parseProxy(c);
    if (p) return p;
  }
  return null;
}

function threadJsonUrl(permalink: string): string {
  const clean = permalink.split("?")[0]!.replace(/\/$/, "");
  return `${clean}.json`;
}

function ensurePermalink(raw: string, fallbackId: string, sub: string): string {
  if (raw?.startsWith("http")) {
    return raw.split("?")[0]!.replace(/\/?$/, "/");
  }
  if (raw?.startsWith("/")) {
    return `https://www.reddit.com${raw.replace(/\/?$/, "/")}`;
  }
  return `https://www.reddit.com/r/${sub}/comments/${fallbackId}/`;
}

async function openContext(): Promise<BrowserContext> {
  const proxy = loadProxy();
  const headed =
    envOr("REDDIT_CONTENT_HEADED", "true").toLowerCase() !== "false" &&
    envOr("REDDIT_CONTENT_HEADED") !== "0";

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",
    headless: !headed,
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
    ...(proxy
      ? {
          proxy: {
            server: proxy.server,
            ...(proxy.username
              ? { username: proxy.username, password: proxy.password }
              : {}),
          },
        }
      : {}),
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  return context;
}

async function readJsonFromPage(page: Page, url: string): Promise<unknown> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1200);
  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (/blocked by network security|you've been blocked/i.test(bodyText)) {
    throw new Error(`Reddit blocked while fetching ${url.slice(0, 80)}`);
  }
  const pre = await page.locator("pre").first().textContent().catch(() => null);
  const raw = (pre && pre.trim().startsWith("[") ? pre : bodyText).trim();
  return JSON.parse(raw);
}

function mapListingToEvents(
  data: unknown,
  maxComments: number,
): NormalizedEvent[] {
  if (!Array.isArray(data) || !data[0]?.data?.children?.[0]?.data) {
    return [];
  }
  const postData = data[0].data.children[0].data as Record<string, unknown>;
  const id = String(postData.id || "").replace(/^t3_/, "");
  const sub = String(postData.subreddit || "").replace(/^r\//i, "");
  if (!id || !sub) return [];

  const permalink = ensurePermalink(
    String(postData.permalink || ""),
    id,
    sub,
  );
  const title = String(postData.title || "(untitled)");
  const body = String(postData.selftext || "");
  const post = makeEvent({
    platform: "reddit",
    external_id: `post_${id}`,
    community: sub,
    title,
    body,
    author: String(postData.author || "[deleted]"),
    created_utc: Number(postData.created_utc) || Math.floor(Date.now() / 1000),
    permalink,
    thread_context: `r/${sub}`,
  });

  const out: NormalizedEvent[] = [post];
  const commentChildren = (data[1]?.data?.children || []) as Array<{
    kind?: string;
    data?: Record<string, unknown>;
  }>;

  const pushComment = (node: {
    kind?: string;
    data?: Record<string, unknown>;
  }) => {
    if (out.length > maxComments) return; // post + comments
    if (node.kind !== "t1" || !node.data) return;
    const d = node.data;
    const cbody = String(d.body || "");
    if (!cbody || cbody.length < 20) return;
    if (/^\[deleted\]$|^\[removed\]$/i.test(cbody)) return;
    const cid = String(d.id || "").replace(/^t1_/, "");
    if (!cid) return;
    const cperm = ensurePermalink(String(d.permalink || ""), id, sub);
    out.push(
      makeEvent({
        platform: "reddit",
        external_id: `comment_${cid}`,
        community: sub,
        title: `Re: ${title}`,
        body: cbody,
        author: String(d.author || "[deleted]"),
        created_utc:
          Number(d.created_utc) || post.created_utc,
        permalink: cperm.includes(cid)
          ? cperm
          : `${permalink.replace(/\/$/, "")}/${cid}/`,
        thread_context: `r/${sub} · ${title}`,
        parent_id: id,
      }),
    );

    const replies = d.replies;
    if (replies && typeof replies === "object" && !Array.isArray(replies)) {
      const kids = (replies as { data?: { children?: unknown[] } }).data
        ?.children;
      if (Array.isArray(kids)) {
        for (const k of kids) {
          if (out.length > maxComments) break;
          pushComment(k as { kind?: string; data?: Record<string, unknown> });
        }
      }
    }
  };

  for (const c of commentChildren) {
    if (out.length > maxComments) break;
    pushComment(c);
  }

  return out;
}

/**
 * Open one browser session and fetch many thread URLs as NormalizedEvents.
 */
export async function fetchRedditThreadsViaPlaywright(
  urls: string[],
  opts?: { maxCommentsPerThread?: number },
): Promise<NormalizedEvent[]> {
  if (!canFetchRedditViaPlaywright()) {
    throw new Error(
      "No .reddit-profile — run `npm run reddit:session` before content fetch",
    );
  }
  const maxComments =
    opts?.maxCommentsPerThread ?? envInt("REDDIT_COMMENTS_PER_POST", 12);
  // budget includes the post itself
  const commentBudget = maxComments;

  const context = await openContext();
  const out: NormalizedEvent[] = [];
  const seen = new Set<string>();

  try {
    const page = context.pages()[0] || (await context.newPage());
    for (const url of urls) {
      const jurl = threadJsonUrl(url);
      try {
        log.info("fetch thread json", { url: url.slice(0, 80) });
        const data = await readJsonFromPage(page, jurl);
        const events = mapListingToEvents(data, commentBudget);
        if (!events.length) {
          log.warn("no events mapped", { url: url.slice(0, 80) });
          continue;
        }
        for (const e of events) {
          if (seen.has(e.external_id)) continue;
          seen.add(e.external_id);
          out.push(e);
        }
        log.info("thread fetched", {
          url: url.slice(0, 80),
          events: events.length,
        });
      } catch (err) {
        log.warn("thread fetch failed", {
          url: url.slice(0, 80),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await context.close().catch(() => {});
  }

  return out;
}
