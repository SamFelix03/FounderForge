import { envInt, envOr } from "../config.js";
import { createLogger } from "../log.js";
import {
  ensureRedditBearer,
  hasLoggedInRedditSession,
  loadRedditSessionCookies,
  resolveRedditBearer,
} from "../redditSession.js";

const log = createLogger("reddapi");
const HOST = "reddapi.p.rapidapi.com";
const BASE = `https://${HOST}`;

export function canUseReddApi(): boolean {
  return Boolean(envOr("RAPIDAPI_KEY") || envOr("REDDAPI_KEY"));
}

function rapidKey(): string {
  const key = envOr("RAPIDAPI_KEY") || envOr("REDDAPI_KEY");
  if (!key) throw new Error("RAPIDAPI_KEY (or REDDAPI_KEY) is required for Reddit");
  return key;
}

/** Write endpoints require proxy (ReddAPI returns 422 without it). */
export function reddApiProxy(): string {
  const p = envOr("REDDAPI_PROXY");
  if (!p) {
    throw new Error(
      "REDDAPI_PROXY is required for ReddAPI writes (ip:port or user:pass@ip:port)",
    );
  }
  return p;
}

function proxyOpt(): string | undefined {
  return envOr("REDDAPI_PROXY") || undefined;
}

let lastCallAt = 0;

async function pace(): Promise<void> {
  const minGap = envInt("REDDAPI_MIN_INTERVAL_MS", 800);
  const wait = lastCallAt + minGap - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

export async function reddApiGet(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<unknown> {
  await pace();
  const url = new URL(path.startsWith("http") ? path : `${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  const proxy = proxyOpt();
  if (proxy && !url.searchParams.has("proxy")) {
    url.searchParams.set("proxy", proxy);
  }

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "x-rapidapi-host": HOST,
      "x-rapidapi-key": rapidKey(),
    },
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  if (!res.ok) {
    const msg =
      typeof data === "object" && data && "message" in data
        ? String((data as { message: unknown }).message)
        : text.slice(0, 300);
    throw new Error(`ReddAPI GET ${path} ${res.status}: ${msg}`);
  }
  return data;
}

export async function reddApiPost(
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  await pace();
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-rapidapi-host": HOST,
      "x-rapidapi-key": rapidKey(),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  if (!res.ok) {
    const msg =
      typeof data === "object" && data && "message" in data
        ? String((data as { message: unknown }).message)
        : typeof data === "object" && data && "detail" in data
          ? JSON.stringify((data as { detail: unknown }).detail).slice(0, 300)
          : text.slice(0, 300);
    throw new Error(`ReddAPI POST ${path} ${res.status}: ${msg}`);
  }
  // Some write calls return HTTP 200 with success:false
  if (
    data &&
    typeof data === "object" &&
    "success" in data &&
    (data as { success: unknown }).success === false
  ) {
    const msg =
      "message" in data
        ? String((data as { message: unknown }).message)
        : JSON.stringify(data).slice(0, 300);
    throw new Error(`ReddAPI POST ${path} failed: ${msg}`);
  }
  return data;
}

export async function risingPosts(
  subreddit: string,
  postNum = 10,
): Promise<unknown> {
  return reddApiGet("/api/rising_posts", {
    subreddit,
    post_num: postNum,
  });
}

export async function scrapeSubreddit(
  subreddit: string,
  sort: "hot" | "top" | "new" = "hot",
): Promise<unknown> {
  try {
    return await reddApiGet(`/api/scrape/${sort}`, {
      subreddit,
      limit: envInt("REDDIT_POSTS_PER_SUB", 15),
    });
  } catch (err) {
    log.warn("scrape/{sort} failed — falling back to /api/scrape", {
      sort,
      error: err instanceof Error ? err.message : String(err),
    });
    return reddApiGet("/api/scrape", { subreddit, sort });
  }
}

export async function scrapePostComments(
  postUrl: string,
  commentsNum = 15,
): Promise<unknown> {
  return reddApiGet("/api/scrape_post_comments", {
    post_url: postUrl,
    comments_num: commentsNum,
  });
}

export async function scrapePostAndComments(
  postUrl: string,
  commentsNum = 15,
): Promise<unknown> {
  return reddApiGet("/api/scrape_new_comments_and_its_post_content", {
    post_url: postUrl,
    comments_num: commentsNum,
  });
}

export function canWriteViaReddApi(): boolean {
  return Boolean(
    canUseReddApi() &&
      envOr("REDDAPI_PROXY") &&
      resolveRedditBearer() &&
      (hasLoggedInRedditSession() ||
        (envOr("REDDIT_USERNAME") && envOr("REDDIT_PASSWORD"))),
  );
}

function isAuthFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /403|401|blocked|unauthorized|invalid.?token|expired/i.test(msg);
}

async function buildWriteAuth(): Promise<{
  bearer: string;
  proxy: string;
  session: ReturnType<typeof loadRedditSessionCookies>;
}> {
  const proxy = reddApiProxy();
  const bearer = await ensureRedditBearer();
  return { bearer, proxy, session: loadRedditSessionCookies() };
}

/**
 * Post a comment via ReddAPI using Playwright session bearer (token_v2)
 * + Webshare proxy. Auto-refreshes token_v2 when near expiry.
 */
export async function reddApiComment(
  postUrl: string,
  text: string,
): Promise<unknown> {
  const attempt = async (forceRefresh: boolean) => {
    if (forceRefresh) await ensureRedditBearer({ force: true });
    const { bearer, proxy } = await buildWriteAuth();
    const body: Record<string, unknown> = {
      text,
      post_url: postUrl,
      bearer,
      proxy,
    };
    const username = envOr("REDDIT_USERNAME");
    const password = envOr("REDDIT_PASSWORD");
    if (username) body.username = username;
    if (password) body.password = password;

    log.info("reddapi comment", {
      postUrl: postUrl.slice(0, 80),
      bearer: `${bearer.slice(0, 12)}…`,
      loggedIn: hasLoggedInRedditSession(),
      forceRefresh,
    });
    return reddApiPost("/api/comment", body);
  };

  try {
    return await attempt(false);
  } catch (err) {
    if (!isAuthFailure(err)) throw err;
    log.warn("comment auth failed — forcing token_v2 refresh and retry", {
      error: err instanceof Error ? err.message : String(err),
    });
    return attempt(true);
  }
}

export async function reddApiReplyOnComment(
  commentUrl: string,
  reply: string,
): Promise<unknown> {
  const attempt = async (forceRefresh: boolean) => {
    if (forceRefresh) await ensureRedditBearer({ force: true });
    const { bearer, proxy, session } = await buildWriteAuth();
    if (!bearer && !session?.reddit_session) {
      throw new Error(
        "No Reddit session — run `npm run reddit:session` and log in",
      );
    }

    const body: Record<string, unknown> = {
      comment_url: commentUrl,
      reply,
      proxy,
    };
    if (bearer) body.bearer = bearer;
    const fresh = loadRedditSessionCookies();
    if (fresh) {
      body.cookies = {
        token_v2: fresh.token_v2,
        reddit_session: fresh.reddit_session,
        csrf_token: fresh.csrf_token,
        loid: fresh.loid,
      };
    }
    const username = envOr("REDDIT_USERNAME");
    const password = envOr("REDDIT_PASSWORD");
    if (username) body.username = username;
    if (password) body.password = password;

    log.info("reddapi reply_on_comment", {
      commentUrl: commentUrl.slice(0, 80),
      forceRefresh,
    });
    return reddApiPost("/api/v2/reply_on_comment", body);
  };

  try {
    return await attempt(false);
  } catch (err) {
    if (!isAuthFailure(err)) throw err;
    log.warn("reply auth failed — forcing token_v2 refresh and retry", {
      error: err instanceof Error ? err.message : String(err),
    });
    return attempt(true);
  }
}
