/**
 * Post Reddit comments via the persisted Playwright profile (.reddit-profile).
 * No ReddAPI — uses old.reddit form first, then www shreddit composer.
 */
import type { BrowserContext, Page } from "playwright";
import {
  hasRedditProfile,
  isRedditNetworkBlocked,
  launchRedditChrome,
  loadRedditProxies,
  preferHeaded,
  type ParsedProxy,
} from "../browser/redditChrome.js";
import { createLogger } from "../log.js";

const log = createLogger("post.playwright");

let postLock: Promise<unknown> = Promise.resolve();

function withPostLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = postLock.then(fn, fn);
  postLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function canPostViaPlaywright(): boolean {
  // Logged-in Chrome profile is enough; cookie JSON is optional cache.
  return hasRedditProfile();
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

function toOldReddit(url: string): string {
  return url
    .replace("www.reddit.com", "old.reddit.com")
    .replace("new.reddit.com", "old.reddit.com");
}

async function postViaLegacyApi(
  page: Page,
  thingId: string,
  text: string,
): Promise<{ ok: boolean; permalink?: string; error?: string }> {
  const result = await page.evaluate(
    async ({ thingId: tid, text: bodyText }: { thingId: string; text: string }) => {
      const g = globalThis as unknown as {
        document?: { cookie?: string };
        fetch: typeof fetch;
      };
      const cookie = g.document?.cookie || "";
      const csrf =
        cookie
          .split("; ")
          .find((c: string) => c.startsWith("csrf_token="))
          ?.split("=")[1] || "";
      const params = new URLSearchParams({
        thing_id: tid,
        text: bodyText,
        api_type: "json",
      });
      if (csrf) params.set("uh", decodeURIComponent(csrf));

      const res = await g.fetch("https://www.reddit.com/api/comment", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
          "x-requested-with": "XMLHttpRequest",
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
    success?: boolean;
    json?: {
      errors?: unknown[];
      data?: { things?: Array<{ data?: { permalink?: string } }> };
    };
  } | null;

  const errors = json?.json?.errors;
  if (
    result.status >= 400 ||
    (Array.isArray(errors) && errors.length) ||
    typeof result.json === "string"
  ) {
    return {
      ok: false,
      error: `api/comment ${result.status}: ${JSON.stringify(errors || result.raw).slice(0, 200)}`,
    };
  }

  const permalink = json?.json?.data?.things?.[0]?.data?.permalink;
  return {
    ok: true,
    permalink: permalink
      ? permalink.startsWith("http")
        ? permalink
        : `https://www.reddit.com${permalink}`
      : undefined,
  };
}

async function postViaOldReddit(
  page: Page,
  url: string,
  text: string,
): Promise<{ ok: boolean; permalink?: string; error?: string }> {
  const oldUrl = toOldReddit(url);
  await page.goto(oldUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2000);

  if (await isRedditNetworkBlocked(page)) {
    return { ok: false, error: "blocked on old.reddit" };
  }

  const ta = page.locator('textarea[name="text"]').first();
  if ((await ta.count()) === 0) {
    return { ok: false, error: "old.reddit textarea not found" };
  }
  await ta.click();
  await ta.fill(text);
  const submit = page
    .locator('button[type="submit"], button.save, .usertext-buttons .save')
    .first();
  if ((await submit.count()) > 0) {
    await submit.click();
  } else {
    await page.keyboard.press("Control+Enter");
  }
  await page.waitForTimeout(3500);

  const after = page.url();
  const visible = await page.locator("body").innerText().catch(() => "");
  const snippet = text.slice(0, Math.min(40, text.length));
  if (visible.includes(snippet) || /\/comments\/.+\/\w+/.test(after)) {
    return {
      ok: true,
      permalink: after.includes("reddit.com") ? after : url,
    };
  }
  return { ok: false, error: "old.reddit comment not confirmed" };
}

async function postViaComposerUi(
  page: Page,
  url: string,
  text: string,
): Promise<{ ok: boolean; permalink?: string; error?: string }> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(3000);

  if (await isRedditNetworkBlocked(page)) {
    return { ok: false, error: "blocked on www" };
  }

  for (const label of ["Accept all", "Accept", "Continue"]) {
    const btn = page.getByRole("button", { name: label }).first();
    if ((await btn.count()) > 0) {
      await btn.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(400);
    }
  }

  for (const name of ["Add a comment", "Add your reply", "Comment", "Reply"]) {
    const el = page.getByText(name, { exact: false }).first();
    if ((await el.count()) > 0) {
      await el.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(600);
    }
  }

  const selectors = [
    'div[contenteditable="true"][data-lexical-editor="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'div[role="textbox"]',
    "faceplate-textarea-input textarea",
    "shreddit-composer textarea",
    'textarea[name="text"]',
    "#CommentTree textarea",
    '[slot="commentBox"] div[contenteditable="true"]',
  ];

  let filled = false;
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) continue;
    try {
      await loc.scrollIntoViewIfNeeded();
      await loc.click({ timeout: 3000 });
      await page.waitForTimeout(200);
      await loc.fill(text).catch(async () => {
        await page.keyboard.type(text, { delay: 5 });
      });
      filled = true;
      break;
    } catch {
      /* try next */
    }
  }

  if (!filled) {
    filled = await page.evaluate((t: string) => {
      type El = {
        shadowRoot?: unknown;
        focus: () => void;
        value?: string;
        innerText?: string;
        dispatchEvent: (e: unknown) => void;
        tagName?: string;
      };
      type Root = {
        querySelectorAll: (sel: string) => { forEach: (fn: (el: El) => void) => void };
      };
      const g = globalThis as unknown as {
        document: Root & { body?: unknown };
        Event: new (type: string, init?: { bubbles?: boolean }) => unknown;
        InputEvent: new (type: string, init?: { bubbles?: boolean }) => unknown;
      };
      const deep: El[] = [];
      const walk = (root: Root) => {
        root.querySelectorAll("*").forEach((el) => {
          if (el.shadowRoot) walk(el.shadowRoot as Root);
        });
        root
          .querySelectorAll('[contenteditable="true"], textarea')
          .forEach((el) => deep.push(el));
      };
      walk(g.document);
      const target = deep[0];
      if (!target) return false;
      target.focus();
      if ((target.tagName || "").toLowerCase() === "textarea") {
        target.value = t;
        target.dispatchEvent(new g.Event("input", { bubbles: true }));
      } else {
        target.innerText = t;
        target.dispatchEvent(new g.InputEvent("input", { bubbles: true }));
      }
      return true;
    }, text);
  }

  if (!filled) {
    return { ok: false, error: "comment composer not found" };
  }

  const submit = page
    .locator(
      'button:has-text("Comment"), button:has-text("Reply"), button[type="submit"]',
    )
    .last();
  if ((await submit.count()) > 0) {
    await submit.click({ timeout: 5000 }).catch(async () => {
      await page.keyboard.press("Control+Enter");
    });
  } else {
    await page.keyboard.press("Control+Enter");
  }
  await page.waitForTimeout(4000);

  const visible = await page.locator("body").innerText().catch(() => "");
  const snippet = text.slice(0, Math.min(40, text.length));
  if (visible.includes(snippet)) {
    return { ok: true, permalink: page.url() };
  }
  return { ok: false, error: "www comment not confirmed on page" };
}

async function openContext(proxy: ParsedProxy | null): Promise<BrowserContext> {
  return launchRedditChrome({
    proxy,
    headed: preferHeaded("REDDIT_POST_HEADED", "true"),
  });
}

async function attemptPost(
  proxy: ParsedProxy | null,
  opts: {
    permalinkTarget: string;
    targetRef: string;
    draftText: string;
  },
): Promise<{ permalink: string }> {
  const targetUrl = opts.permalinkTarget.split("?")[0]!;
  const thingId = thingIdFromTarget(targetUrl, opts.targetRef);

  log.info("playwright comment", {
    url: targetUrl.slice(0, 80),
    thingId,
    proxy: proxy?.label || "none",
  });

  const context = await openContext(proxy);
  try {
    const page = context.pages()[0] || (await context.newPage());

    // 1) old.reddit classic form — most reliable without ReddAPI
    const old = await postViaOldReddit(page, targetUrl, opts.draftText);
    if (old.ok) {
      log.info("posted via old.reddit", {
        permalink: old.permalink?.slice(0, 80),
      });
      return { permalink: old.permalink || targetUrl };
    }
    log.warn("old.reddit failed", { error: old.error });

    // 2) in-page /api/comment from www session
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(1500);
    if (await isRedditNetworkBlocked(page)) {
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
      log.warn("api/comment failed", { error: api.error });
    }

    // 3) www shreddit composer
    const ui = await postViaComposerUi(page, targetUrl, opts.draftText);
    if (!ui.ok) {
      throw new Error(ui.error || "Playwright comment failed");
    }
    log.info("posted via www composer", {
      permalink: ui.permalink?.slice(0, 80),
    });
    return { permalink: ui.permalink || targetUrl };
  } finally {
    await context.close().catch(() => {});
  }
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
    const proxies = loadRedditProxies();
    const attempts: Array<ParsedProxy | null> = [
      ...proxies.slice(0, 3),
      ...(proxies.length ? [] : [null]),
    ];
    if (!attempts.length) attempts.push(null);

    const errors: string[] = [];
    for (const proxy of attempts) {
      try {
        return await attemptPost(proxy, opts);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${proxy?.label || "direct"}: ${msg}`);
        log.warn("playwright comment attempt failed", {
          proxy: proxy?.label || "none",
          msg,
        });
      }
    }
    throw new Error(
      `Playwright comment failed on all proxies.\n${errors.slice(0, 5).join("\n")}`,
    );
  });
}
