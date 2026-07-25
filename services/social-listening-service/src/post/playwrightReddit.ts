/**
 * Post Reddit comments via the persisted Playwright profile (.reddit-profile).
 * Replaces ReddAPI /api/comment — no RapidAPI write path needed.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { envOr, projectRoot } from "../config.js";
import { createLogger } from "../log.js";
import {
  hasLoggedInRedditSession,
  loadRedditSessionCookies,
} from "../redditSession.js";
import {
  parseProxy,
  type ParsedProxy,
} from "../redditSessionRefresh.js";

const log = createLogger("post.playwright");

const root = projectRoot();
const PROFILE_DIR = path.join(root, ".reddit-profile");
const ACTIVE_PROXY_FILE = path.join(root, "scripts", "active-proxy.txt");
const PROXY_FILE = path.join(root, "scripts", "webshare-proxies.txt");

let postLock: Promise<unknown> = Promise.resolve();

function withPostLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = postLock.then(fn, fn);
  postLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function loadProxies(): ParsedProxy[] {
  const out: ParsedProxy[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const p = parseProxy(raw);
    if (!p || seen.has(p.label)) return;
    seen.add(p.label);
    out.push(p);
  };
  push(envOr("REDDAPI_PROXY") || envOr("REDDIT_PROXY"));
  if (fs.existsSync(ACTIVE_PROXY_FILE)) {
    push(fs.readFileSync(ACTIVE_PROXY_FILE, "utf8"));
  }
  if (fs.existsSync(PROXY_FILE)) {
    for (const line of fs.readFileSync(PROXY_FILE, "utf8").split(/\r?\n/)) {
      push(line);
    }
  }
  return out;
}

export function canPostViaPlaywright(): boolean {
  return (
    fs.existsSync(PROFILE_DIR) &&
    (hasLoggedInRedditSession() || Boolean(loadRedditSessionCookies()?.token_v2))
  );
}

function thingIdFromTarget(permalink: string, targetRef: string): string | null {
  if (targetRef.startsWith("comment_") && !targetRef.startsWith("comment_h_")) {
    return `t1_${targetRef.slice("comment_".length)}`;
  }
  if (targetRef.startsWith("post_")) {
    return `t3_${targetRef.slice("post_".length)}`;
  }
  const post = permalink.match(/\/comments\/([a-z0-9]+)/i);
  if (post) return `t3_${post[1]}`;
  const c = permalink.match(/\/comment\/([a-z0-9]+)/i);
  if (c) return `t1_${c[1]}`;
  return null;
}

async function isBlocked(page: Page): Promise<boolean> {
  const body = await page.locator("body").innerText().catch(() => "");
  return /blocked by network security|you've been blocked/i.test(body);
}

async function postViaLegacyApi(
  page: Page,
  thingId: string,
  text: string,
): Promise<{ ok: boolean; permalink?: string; error?: string }> {
  const result = await page.evaluate(
    async ({ thingId: tid, text: bodyText }) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((c) => c.startsWith("csrf_token="))
          ?.split("=")[1] || "";
      const params = new URLSearchParams({
        thing_id: tid,
        text: bodyText,
        api_type: "json",
      });
      if (csrf) params.set("uh", decodeURIComponent(csrf));

      const res = await fetch("https://www.reddit.com/api/comment", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: params.toString(),
        credentials: "include",
      });
      const raw = await res.text();
      let json: unknown = raw;
      try {
        json = raw ? JSON.parse(raw) : null;
      } catch {
        /* keep */
      }
      return { status: res.status, json, raw: raw.slice(0, 400) };
    },
    { thingId, text },
  );

  const json = result.json as {
    jquery?: unknown;
    success?: boolean;
    json?: {
      errors?: unknown[];
      data?: { things?: Array<{ data?: { permalink?: string } }> };
    };
  } | null;

  const errors = json?.json?.errors;
  if (result.status >= 400 || (Array.isArray(errors) && errors.length)) {
    return {
      ok: false,
      error: `api/comment ${result.status}: ${JSON.stringify(errors || result.raw).slice(0, 200)}`,
    };
  }

  const permalink =
    json?.json?.data?.things?.[0]?.data?.permalink ||
    undefined;
  return {
    ok: true,
    permalink: permalink
      ? permalink.startsWith("http")
        ? permalink
        : `https://www.reddit.com${permalink}`
      : undefined,
  };
}

async function postViaComposerUi(
  page: Page,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  // Open composer if needed
  const composers = [
    'div[contenteditable="true"]',
    'div[role="textbox"]',
    'textarea[name="text"]',
    "faceplate-textarea-input textarea",
    "#CommentTree textarea",
  ];

  let filled = false;
  for (const sel of composers) {
    const el = page.locator(sel).first();
    if ((await el.count()) === 0) continue;
    try {
      await el.click({ timeout: 3000 });
      await el.fill(text, { timeout: 5000 }).catch(async () => {
        await el.click();
        await page.keyboard.type(text, { delay: 8 });
      });
      filled = true;
      break;
    } catch {
      /* try next */
    }
  }
  if (!filled) {
    return { ok: false, error: "comment composer not found" };
  }

  const submit = page
    .locator(
      'button:has-text("Comment"), button:has-text("Reply"), button[type="submit"]',
    )
    .first();
  if ((await submit.count()) === 0) {
    await page.keyboard.press("Control+Enter");
  } else {
    await submit.click({ timeout: 5000 });
  }
  await page.waitForTimeout(2500);
  return { ok: true };
}

async function openContext(proxy: ParsedProxy | null): Promise<BrowserContext> {
  const headed =
    envOr("REDDIT_POST_HEADED", "true").toLowerCase() !== "false" &&
    envOr("REDDIT_POST_HEADED") !== "0";

  const launchOpts: Parameters<typeof chromium.launchPersistentContext>[1] = {
    channel: "chrome",
    headless: !headed,
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  };
  if (proxy) {
    launchOpts.proxy = {
      server: proxy.server,
      ...(proxy.username
        ? { username: proxy.username, password: proxy.password }
        : {}),
    };
  }

  const context = await chromium.launchPersistentContext(
    PROFILE_DIR,
    launchOpts,
  );
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  return context;
}

/**
 * Comment on a Reddit post/comment using the logged-in Playwright profile.
 */
export async function postCommentViaPlaywright(opts: {
  permalinkTarget: string;
  targetRef: string;
  draftText: string;
}): Promise<{ permalink: string }> {
  if (!canPostViaPlaywright()) {
    throw new Error(
      "Playwright post needs .reddit-profile + reddit:session login",
    );
  }

  return withPostLock(async () => {
    const proxies = loadProxies();
    const proxy = proxies[0] || null;
    const targetUrl = opts.permalinkTarget.split("?")[0]!;
    const thingId = thingIdFromTarget(targetUrl, opts.targetRef);

    log.info("playwright comment", {
      url: targetUrl.slice(0, 80),
      thingId,
      proxy: proxy?.label || "none",
    });

    let context: BrowserContext | undefined;
    try {
      context = await openContext(proxy);
      const page = context.pages()[0] || (await context.newPage());
      await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await page.waitForTimeout(2000);

      if (await isBlocked(page)) {
        throw new Error(
          `Reddit blocked proxy ${proxy?.label || "direct"} during post`,
        );
      }

      if (thingId) {
        const api = await postViaLegacyApi(page, thingId, opts.draftText);
        if (api.ok) {
          log.info("posted via reddit /api/comment", {
            permalink: api.permalink?.slice(0, 80),
          });
          return { permalink: api.permalink || targetUrl };
        }
        log.warn("api/comment failed — trying composer UI", {
          error: api.error,
        });
      }

      const ui = await postViaComposerUi(page, opts.draftText);
      if (!ui.ok) {
        throw new Error(ui.error || "Playwright comment failed");
      }
      return { permalink: targetUrl };
    } finally {
      await context?.close().catch(() => {});
    }
  });
}
