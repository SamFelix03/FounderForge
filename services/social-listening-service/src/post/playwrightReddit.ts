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

  // Prefer top-level comment box (not a nested reply)
  const ta = page.locator('form.usertext.cloneable textarea[name="text"], .commentarea textarea[name="text"]').first();
  const taFallback = page.locator('textarea[name="text"]').first();
  const box = (await ta.count()) > 0 ? ta : taFallback;
  if ((await box.count()) === 0) {
    return { ok: false, error: "old.reddit textarea not found" };
  }

  // Post exact draft — no ff- marker (looks spammy / gets filtered)
  const bodyText = text.trim();
  const needle = bodyText.slice(0, Math.min(56, bodyText.length)).trim();

  await box.click();
  await box.fill(bodyText);

  const beforeUrl = page.url();
  const submit = page
    .locator(
      'form.usertext.cloneable button[type="submit"], .commentarea .usertext-buttons .save, button.save',
    )
    .first();
  if ((await submit.count()) > 0) {
    await submit.click();
  } else {
    await page.keyboard.press("Control+Enter");
  }

  // Wait for either redirect to comment permalink or draft text visible in a comment
  const deadline = Date.now() + 20_000;
  let confirmed = false;
  let permalink = beforeUrl;
  while (Date.now() < deadline) {
    await page.waitForTimeout(800);
    const after = page.url();
    // Deep comment links look like .../comments/<post>/<slug>/<commentId>/
    const deep = after.match(
      /\/comments\/[a-z0-9]+\/[^/]+\/([a-z0-9]+)\//i,
    );
    if (deep && after !== beforeUrl) {
      permalink = after.startsWith("http")
        ? after.replace("old.reddit.com", "www.reddit.com")
        : after;
      confirmed = true;
      break;
    }

    if (needle.length >= 16) {
      const hit = await page
        .locator(".comment .usertext-body, .entry .usertext-body")
        .filter({ hasText: needle.slice(0, 40) })
        .count()
        .catch(() => 0);
      if (hit > 0) {
        const href = await page
          .locator(".comment")
          .filter({ hasText: needle.slice(0, 40) })
          .locator('a.bylink, a[data-event-action="permalink"]')
          .first()
          .getAttribute("href")
          .catch(() => null);
        if (href) {
          permalink = href.startsWith("http")
            ? href.replace("old.reddit.com", "www.reddit.com")
            : `https://www.reddit.com${href}`;
        } else {
          permalink = after.replace("old.reddit.com", "www.reddit.com");
        }
        confirmed = true;
        break;
      }
    }

    const err = await page
      .locator(".error, .status-msg, .c-alert")
      .first()
      .innerText()
      .catch(() => "");
    if (err && /error|forbidden|ratelimit|removed|login/i.test(err)) {
      return { ok: false, error: `old.reddit error: ${err.slice(0, 160)}` };
    }
  }

  if (!confirmed) {
    // Dump a short signal for debugging
    const body = await page.locator("body").innerText().catch(() => "");
    if (/you must be logged|log in|sign in/i.test(body)) {
      return { ok: false, error: "old.reddit appears logged out" };
    }
    return {
      ok: false,
      error: "old.reddit comment not confirmed (no permalink / text)",
    };
  }

  return { ok: true, permalink };
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

  // Require a unique slice of the draft that is unlikely to already be on the page
  const needle = text.slice(0, Math.min(48, text.length)).trim();
  if (needle.length < 16) {
    return { ok: false, error: "www comment text too short to confirm" };
  }
  const visible = await page.locator("body").innerText().catch(() => "");
  if (!visible.includes(needle)) {
    return { ok: false, error: "www comment not confirmed on page" };
  }
  return { ok: true, permalink: page.url() };
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
 *
 * @param opts.directOnly — skip Webshare proxies (use home IP). Useful for spam-score diagnosis.
 */
export async function postCommentViaPlaywright(opts: {
  permalinkTarget: string;
  targetRef: string;
  draftText: string;
  directOnly?: boolean;
}): Promise<{ permalink: string }> {
  if (!canPostViaPlaywright()) {
    throw new Error(
      "Playwright post needs .reddit-profile + reddit:session login",
    );
  }

  return withPostLock(async () => {
    const attempts: Array<ParsedProxy | null> = opts.directOnly
      ? [null]
      : [
          ...loadRedditProxies().slice(0, 3),
          ...(loadRedditProxies().length ? [] : [null]),
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
