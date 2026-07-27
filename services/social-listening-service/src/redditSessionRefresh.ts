/**
 * Silent-ish Playwright refresh of token_v2 using the persisted .reddit-profile.
 * Prefer headed Chrome (on a VM: wrap with xvfb-run).
 */
import fs from "node:fs";
import path from "node:path";
import type { BrowserContext } from "playwright";
import {
  hasRedditProfile,
  isRedditNetworkBlocked,
  launchRedditChrome,
  loadRedditProxies,
  parseProxy,
  preferHeaded,
  redditCookiesPath,
  rememberActiveProxy,
  type ParsedProxy,
} from "./browser/redditChrome.js";
import { createLogger } from "./log.js";

export { parseProxy, type ParsedProxy };

const log = createLogger("reddit.session.refresh");

function hasRedditSession(
  cookies: Array<{ name: string; value: string }>,
): boolean {
  return cookies.some((c) => /^reddit_session$/i.test(c.name));
}

function pickToken(
  cookies: Array<{ name: string; value: string }>,
): string | undefined {
  return cookies.find((c) => /^token_v2$/i.test(c.name))?.value;
}

async function saveCookies(context: BrowserContext): Promise<void> {
  const cookies = await context.cookies();
  const dest = redditCookiesPath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(cookies, null, 2));
}

async function refreshOnce(
  proxy: ParsedProxy,
  headed: boolean,
): Promise<string> {
  log.info("refreshing token_v2 via Playwright", {
    proxy: proxy.label,
    headed,
  });

  let context: BrowserContext | undefined;
  try {
    context = await launchRedditChrome({ proxy, headed });
    const page = context.pages()[0] || (await context.newPage());
    await page.goto("https://www.reddit.com/", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(2500);

    if (await isRedditNetworkBlocked(page)) {
      throw new Error(`blocked:${proxy.label}`);
    }

    await page.goto("https://www.reddit.com/?feed=home", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.waitForTimeout(2000);

    const cookies = await context.cookies("https://www.reddit.com");
    if (!hasRedditSession(cookies)) {
      throw new Error(
        "reddit_session missing after refresh — run `npm run reddit:session` and log in",
      );
    }

    const token = pickToken(cookies);
    if (!token) throw new Error("token_v2 missing after refresh");

    await saveCookies(context);
    rememberActiveProxy(proxy.raw);
    log.info("token_v2 refreshed and saved", {
      bearer: `${token.slice(0, 12)}…`,
      proxy: proxy.label,
    });
    try {
      const { syncRedditSessionToStorageIfRemote } = await import(
        "./redditSessionStorage.js"
      );
      await syncRedditSessionToStorageIfRemote();
    } catch {
      /* optional remote sync */
    }
    return token;
  } finally {
    await context?.close().catch(() => {});
  }
}

export async function refreshTokenViaPlaywright(
  _opts: { force?: boolean } = {},
): Promise<string> {
  if (!hasRedditProfile()) {
    throw new Error(
      "No .reddit-profile — run `npm run reddit:session` once to log in",
    );
  }

  const proxies = loadRedditProxies();
  if (!proxies.length) {
    throw new Error("No REDDAPI_PROXY available for session refresh");
  }

  const headedDefault = preferHeaded("REDDIT_REFRESH_HEADED", "true");
  const modes: boolean[] = headedDefault ? [true] : [false, true];
  const errors: string[] = [];

  for (const headed of modes) {
    for (const proxy of proxies) {
      try {
        return await refreshOnce(proxy, headed);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${headed ? "headed" : "headless"} ${proxy.label}: ${msg}`);
        log.warn("refresh attempt failed", { headed, proxy: proxy.label, msg });
        if (!msg.startsWith("blocked:") && !/Timeout|net::|proxy/i.test(msg)) {
          if (
            /reddit_session missing|No \.reddit-profile|token_v2 missing/i.test(
              msg,
            )
          ) {
            throw err;
          }
        }
      }
    }
  }

  throw new Error(
    `token_v2 refresh failed on all proxies.\n${errors.slice(0, 8).join("\n")}\nRun: npm run reddit:session`,
  );
}
