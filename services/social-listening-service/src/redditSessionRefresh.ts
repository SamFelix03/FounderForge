/**
 * Silent-ish Playwright refresh of token_v2 using the persisted .reddit-profile.
 * Requires a prior manual login via `npm run reddit:session`.
 *
 * Headless is often blocked by Reddit on datacenter proxies — we try headless
 * first, then fall back to a short headed Chrome window.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext } from "playwright";
import { envOr, projectRoot } from "./config.js";
import { createLogger } from "./log.js";

const log = createLogger("reddit.session.refresh");

const root = projectRoot();
const PROFILE_DIR = path.join(root, ".reddit-profile");
const COOKIES_FILE = path.join(root, "scripts", "reddit-session.cookies.json");
const ACTIVE_PROXY_FILE = path.join(root, "scripts", "active-proxy.txt");
const PROXY_FILE = path.join(root, "scripts", "webshare-proxies.txt");

export type ParsedProxy = {
  raw: string;
  server: string;
  username?: string;
  password?: string;
  label: string;
};

export function parseProxy(raw: string): ParsedProxy | null {
  const s = (raw || "").trim();
  if (!s || s.startsWith("#")) return null;
  const m = s.match(/^(?:([^:@]+):([^@]+)@)?([^:]+):(\d+)$/);
  if (!m) return null;
  const [, username, password, host, port] = m;
  const server = `http://${host}:${port}`;
  return username
    ? { raw: s, server, username, password, label: `${host}:${port}` }
    : { raw: s, server, label: `${host}:${port}` };
}

function loadProxyList(): ParsedProxy[] {
  const out: ParsedProxy[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const p = parseProxy(raw);
    if (!p || seen.has(p.label)) return;
    seen.add(p.label);
    out.push(p);
  };

  push(envOr("REDDAPI_PROXY"));
  if (fs.existsSync(ACTIVE_PROXY_FILE)) {
    push(fs.readFileSync(ACTIVE_PROXY_FILE, "utf8"));
  }
  if (fs.existsSync(PROXY_FILE)) {
    for (const line of fs.readFileSync(PROXY_FILE, "utf8").split(/\r?\n/)) {
      push(line);
    }
  }
  for (const part of envOr("REDDAPI_PROXY_LIST").split(/[,\n]/)) {
    push(part);
  }
  return out;
}

function rememberActiveProxy(raw: string): void {
  fs.writeFileSync(ACTIVE_PROXY_FILE, `${raw}\n`);
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  let env = fs.readFileSync(envPath, "utf8");
  if (/^REDDAPI_PROXY=/m.test(env)) {
    env = env.replace(/^REDDAPI_PROXY=.*$/m, `REDDAPI_PROXY=${raw}`);
  } else {
    env += `\nREDDAPI_PROXY=${raw}\n`;
  }
  fs.writeFileSync(envPath, env);
}

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

async function isBlocked(page: {
  locator: (sel: string) => { innerText: () => Promise<string> };
}): Promise<boolean> {
  const body = await page.locator("body").innerText().catch(() => "");
  return /blocked by network security|you've been blocked/i.test(body);
}

async function saveCookies(context: BrowserContext): Promise<void> {
  const cookies = await context.cookies();
  fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
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
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      channel: "chrome",
      headless: !headed,
      viewport: { width: 1280, height: 900 },
      locale: "en-US",
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
      ],
      ignoreDefaultArgs: ["--enable-automation"],
      proxy: {
        server: proxy.server,
        ...(proxy.username
          ? { username: proxy.username, password: proxy.password }
          : {}),
      },
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    const page = context.pages()[0] || (await context.newPage());
    await page.goto("https://www.reddit.com/", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(2500);

    if (await isBlocked(page)) {
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
    return token;
  } finally {
    await context?.close().catch(() => {});
  }
}

/**
 * Open persisted Chrome profile, hit Reddit, rewrite cookie jar with a fresh token_v2.
 */
export async function refreshTokenViaPlaywright(
  _opts: { force?: boolean } = {},
): Promise<string> {
  if (!fs.existsSync(PROFILE_DIR)) {
    throw new Error(
      "No .reddit-profile — run `npm run reddit:session` once to log in",
    );
  }

  const proxies = loadProxyList();
  if (!proxies.length) {
    throw new Error("No REDDAPI_PROXY available for session refresh");
  }

  // Prefer headed by default — headless is frequently network-blocked on Webshare DC IPs.
  // Set REDDIT_REFRESH_HEADED=false to try headless first.
  const preferHeaded =
    envOr("REDDIT_REFRESH_HEADED", "true").toLowerCase() !== "false" &&
    envOr("REDDIT_REFRESH_HEADED") !== "0";

  const modes: boolean[] = preferHeaded ? [true] : [false, true];
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
          // Non-proxy failures (missing session) — don't burn the whole list
          if (/reddit_session missing|No \.reddit-profile|token_v2 missing/i.test(msg)) {
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
