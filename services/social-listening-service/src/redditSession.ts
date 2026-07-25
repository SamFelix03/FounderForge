import fs from "node:fs";
import path from "node:path";
import { envInt, envOr, projectRoot } from "./config.js";
import { createLogger } from "./log.js";
import { refreshTokenViaPlaywright } from "./redditSessionRefresh.js";

const log = createLogger("reddit.session");

const root = projectRoot();
function cookiesPath(): string {
  const override = envOr("REDDIT_SESSION_COOKIES_PATH");
  if (override) {
    return path.isAbsolute(override) ? override : path.join(root, override);
  }
  return path.join(root, "scripts", "reddit-session.cookies.json");
}
export interface RedditSessionCookies {
  token_v2?: string;
  reddit_session?: string;
  csrf_token?: string;
  loid?: string;
  raw: Array<{ name: string; value: string }>;
}

/** Load cookies saved by Playwright session / auto-refresh. */
export function loadRedditSessionCookies(): RedditSessionCookies | null {
  const COOKIES_FILE = cookiesPath();
  if (!fs.existsSync(COOKIES_FILE)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(COOKIES_FILE, "utf8")) as Array<{
      name: string;
      value: string;
    }>;
    if (!Array.isArray(raw)) return null;
    const pick = (name: string) =>
      raw.find((c) => c.name.toLowerCase() === name.toLowerCase())?.value;
    return {
      token_v2: pick("token_v2"),
      reddit_session: pick("reddit_session"),
      csrf_token: pick("csrf_token"),
      loid: pick("loid"),
      raw,
    };
  } catch {
    return null;
  }
}

/** Seconds until JWT exp, or null if unreadable. */
export function jwtSecondsLeft(token: string | undefined): number | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(
      parts[1]!.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    const payload = JSON.parse(json) as { exp?: number };
    if (typeof payload.exp !== "number") return null;
    return payload.exp - Date.now() / 1000;
  } catch {
    return null;
  }
}

/** Refresh when missing, expired, or within skew seconds of expiry. */
export function tokenNeedsRefresh(token: string | undefined): boolean {
  const skew = envInt("REDDIT_TOKEN_REFRESH_SKEW_SEC", 3600); // 1h default
  const left = jwtSecondsLeft(token);
  if (left === null) return true;
  return left <= skew;
}

/** Sync bearer: env override, else token_v2 from cookie jar (may be stale). */
export function resolveRedditBearer(): string | undefined {
  const fromEnv = envOr("REDDIT_BEARER");
  if (fromEnv) return fromEnv;
  return loadRedditSessionCookies()?.token_v2 || undefined;
}

export function hasLoggedInRedditSession(): boolean {
  return Boolean(loadRedditSessionCookies()?.reddit_session);
}

let refreshInFlight: Promise<string> | null = null;

/**
 * Return a usable bearer, auto-refreshing token_v2 via Playwright when near expiry.
 * Manual login still required once (`npm run reddit:session`).
 */
export async function ensureRedditBearer(
  opts: { force?: boolean } = {},
): Promise<string> {
  const fromEnv = envOr("REDDIT_BEARER");
  if (fromEnv && !opts.force) return fromEnv;

  const session = loadRedditSessionCookies();
  const current = session?.token_v2;
  if (!opts.force && current && !tokenNeedsRefresh(current)) {
    return current;
  }

  if (!session?.reddit_session && !opts.force) {
    if (current) return current; // best effort
    throw new Error(
      "No Reddit session — run `npm run reddit:session` and log in once",
    );
  }

  if (refreshInFlight) {
    log.info("waiting for in-flight token_v2 refresh");
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    try {
      return await refreshTokenViaPlaywright({ force: opts.force });
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}
