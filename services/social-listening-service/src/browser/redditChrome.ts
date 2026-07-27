/**
 * Shared Chrome launcher for Reddit (headed-by-default).
 *
 * Reddit blocks headless Chromium on many datacenter proxies (Webshare).
 * Prefer headed Chrome; on a VM wrap with xvfb-run so Playwright is headed
 * from Reddit's perspective with no physical display.
 *
 * Profile: FounderForge/.reddit-profile (or REDDIT_PROFILE_DIR).
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type LaunchOptions } from "playwright";
import {
  envOr,
  projectRoot,
  redditProfileDir as configRedditProfileDir,
} from "../config.js";
import { createLogger } from "../log.js";

const log = createLogger("browser.reddit");

export type ParsedProxy = {
  raw: string;
  server: string;
  username?: string;
  password?: string;
  label: string;
};

const root = () => projectRoot();

export function redditProfileDir(): string {
  return configRedditProfileDir();
}

export function redditCookiesPath(): string {
  const override = envOr("REDDIT_SESSION_COOKIES_PATH");
  if (override) {
    return path.isAbsolute(override) ? override : path.join(root(), override);
  }
  return path.join(root(), "scripts", "reddit-session.cookies.json");
}

export function activeProxyPath(): string {
  return path.join(root(), "scripts", "active-proxy.txt");
}

function proxyListPath(): string {
  return path.join(root(), "scripts", "webshare-proxies.txt");
}

export function hasRedditProfile(): boolean {
  return fs.existsSync(redditProfileDir());
}

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

export function loadRedditProxies(): ParsedProxy[] {
  const out: ParsedProxy[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const p = parseProxy(raw);
    if (!p || seen.has(p.label)) return;
    seen.add(p.label);
    out.push(p);
  };

  push(envOr("REDDAPI_PROXY") || envOr("REDDIT_PROXY"));
  if (fs.existsSync(activeProxyPath())) {
    push(fs.readFileSync(activeProxyPath(), "utf8"));
  }
  if (fs.existsSync(proxyListPath())) {
    for (const line of fs.readFileSync(proxyListPath(), "utf8").split(/\r?\n/)) {
      push(line);
    }
  }
  for (const part of envOr("REDDAPI_PROXY_LIST").split(/[,\n]/)) {
    push(part);
  }
  return out;
}

export function loadPreferredProxy(): ParsedProxy | null {
  return loadRedditProxies()[0] ?? null;
}

export function rememberActiveProxy(raw: string): void {
  fs.mkdirSync(path.dirname(activeProxyPath()), { recursive: true });
  fs.writeFileSync(activeProxyPath(), `${raw}\n`);
  const envPath = path.join(root(), ".env");
  if (!fs.existsSync(envPath)) return;
  let env = fs.readFileSync(envPath, "utf8");
  if (/^REDDAPI_PROXY=/m.test(env)) {
    env = env.replace(/^REDDAPI_PROXY=.*$/m, `REDDAPI_PROXY=${raw}`);
  } else {
    env += `\nREDDAPI_PROXY=${raw}\n`;
  }
  fs.writeFileSync(envPath, env);
}

/**
 * Headed = Playwright `headless: false`.
 * Master: REDDIT_BROWSER_HEADED (default true). Per-path overrides optional.
 */
export function preferHeaded(
  pathEnvKey?: string,
  pathDefault = "true",
): boolean {
  const master = envOr("REDDIT_BROWSER_HEADED", "true").toLowerCase();
  if (master === "false" || master === "0") return false;
  if (!pathEnvKey) return true;
  const v = envOr(pathEnvKey, pathDefault).toLowerCase();
  return v !== "false" && v !== "0";
}

export function describeDisplay(): {
  display: string | undefined;
  platform: string;
  likelyXvfb: boolean;
} {
  const display = process.env.DISPLAY;
  const platform = process.platform;
  const likelyXvfb =
    platform === "linux" &&
    Boolean(display) &&
    (/^:\d+/.test(display!) || display!.includes("xvfb"));
  return { display, platform, likelyXvfb };
}

const CHROME_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--disable-dev-shm-usage",
  "--no-sandbox",
  "--disable-gpu",
  "--window-size=1280,900",
];

export type LaunchRedditChromeOpts = {
  proxy?: ParsedProxy | null;
  headed?: boolean;
  profileDir?: string;
  args?: string[];
};

async function launchOnce(
  profileDir: string,
  headed: boolean,
  proxy: ParsedProxy | null | undefined,
  extraArgs: string[],
  useSystemChrome: boolean,
): Promise<BrowserContext> {
  const launchOpts: Parameters<typeof chromium.launchPersistentContext>[1] = {
    headless: !headed,
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
    args: [...CHROME_ARGS, ...extraArgs],
    ignoreDefaultArgs: ["--enable-automation"],
  };

  if (useSystemChrome) {
    (launchOpts as { channel?: string }).channel = "chrome";
  }

  if (proxy) {
    launchOpts.proxy = {
      server: proxy.server,
      ...(proxy.username
        ? { username: proxy.username, password: proxy.password }
        : {}),
    };
  }

  const context = await chromium.launchPersistentContext(profileDir, launchOpts);
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  return context;
}

export async function launchRedditChrome(
  opts: LaunchRedditChromeOpts = {},
): Promise<BrowserContext> {
  const profileDir = opts.profileDir ?? redditProfileDir();
  fs.mkdirSync(profileDir, { recursive: true });

  const headed = opts.headed ?? preferHeaded();
  const proxy = opts.proxy === undefined ? loadPreferredProxy() : opts.proxy;
  const display = describeDisplay();

  if (headed && process.platform === "linux" && !display.display) {
    log.warn(
      "headed Chrome on Linux but DISPLAY unset — wrap with xvfb-run (see scripts/run-xvfb.sh)",
    );
  }

  log.info("launching Reddit Chrome", {
    headed,
    headless: !headed,
    proxy: proxy?.label || "none",
    profile: profileDir,
    display: display.display || "(none)",
    xvfb: display.likelyXvfb,
  });

  const extra = opts.args ?? [];
  try {
    return await launchOnce(profileDir, headed, proxy, extra, true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("system Chrome unavailable — falling back to Playwright Chromium", {
      msg: msg.slice(0, 200),
    });
    return launchOnce(profileDir, headed, proxy, extra, false);
  }
}

export async function isRedditNetworkBlocked(page: {
  locator: (sel: string) => { innerText: () => Promise<string> };
}): Promise<boolean> {
  const body = await page.locator("body").innerText().catch(() => "");
  return /blocked by network security|you've been blocked/i.test(body);
}

export type ChromeChannel = NonNullable<LaunchOptions["channel"]>;
