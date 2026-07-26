/**
 * Ensure Playwright Chromium is installed for the current user.
 * Prevents "Executable doesn't exist" after npm install without browser download.
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

let ensurePromise: Promise<void> | null = null;

function missingBrowserMessage(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || "");
  return /Executable doesn't exist|browserType\.launch|Please run the following command/i.test(
    msg,
  );
}

/**
 * Prefer the real user browser cache — Cursor agent shells sometimes set
 * PLAYWRIGHT_BROWSERS_PATH to a sandbox temp dir that the user's terminal won't see.
 */
function preferUserBrowserCache(): void {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH?.includes("cursor-sandbox-cache")) {
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;
  }
}

/**
 * Try launching Chromium briefly; if missing, run `playwright install chromium` once.
 */
export async function ensureChromiumInstalled(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    preferUserBrowserCache();
    const { chromium } = await import("playwright");
    try {
      const browser = await chromium.launch({ headless: true });
      await browser.close();
      return;
    } catch (err) {
      if (!missingBrowserMessage(err)) throw err;
      console.warn("  -> Playwright Chromium missing — installing locally...");
      installChromiumSync();
    }

    const browser = await chromium.launch({ headless: true });
    await browser.close();
  })().catch((err) => {
    ensurePromise = null;
    throw err;
  });
  return ensurePromise;
}

function installChromiumSync(): void {
  preferUserBrowserCache();
  const playwrightCli = path.join(
    path.dirname(require.resolve("playwright/package.json")),
    "cli.js",
  );
  const env = { ...process.env };
  // Always install into the default user cache so the user's terminal can find it.
  delete env.PLAYWRIGHT_BROWSERS_PATH;
  const result = spawnSync(process.execPath, [playwrightCli, "install", "chromium"], {
    stdio: "inherit",
    env,
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(
      "Failed to install Playwright Chromium. Run: npm run install-browsers",
    );
  }
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(path.resolve(entry)).href;
  } catch {
    return /ensureBrowsers\.(js|ts)$/i.test(entry);
  }
})();

if (isDirectRun) {
  ensureChromiumInstalled()
    .then(() => {
      console.log("Playwright Chromium is ready.");
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
