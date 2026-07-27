/**
 * VM / headed Chrome smoke for FounderForge social-listening.
 *
 *   pnpm --filter @founderforge/social-listening-service reddit:vm-smoke
 *   bash scripts/run-xvfb.sh pnpm --filter @founderforge/social-listening-service reddit:vm-smoke
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "@founderforge/observability";

loadRootEnv(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."),
);

async function main() {
  const fs = await import("node:fs");
  const {
    describeDisplay,
    hasRedditProfile,
    isRedditNetworkBlocked,
    launchRedditChrome,
    loadPreferredProxy,
    preferHeaded,
    redditCookiesPath,
    redditProfileDir,
    rememberActiveProxy,
  } = await import("../browser/redditChrome.js");

  function fail(msg: string): never {
    console.error("FAIL:", msg);
    process.exit(1);
  }

  const display = describeDisplay();
  const headed = preferHeaded("REDDIT_REFRESH_HEADED", "true");
  const proxy = loadPreferredProxy();
  const profile = redditProfileDir();

  console.log("── FounderForge Reddit VM browser smoke ──");
  console.log("platform:", process.platform);
  console.log("DISPLAY:", display.display || "(unset)");
  console.log("xvfb-like:", display.likelyXvfb);
  console.log("headed:", headed, "(headless:", !headed, ")");
  console.log("profile:", profile, "exists:", hasRedditProfile());
  console.log("proxy:", proxy?.label || "(none)");

  if (!hasRedditProfile()) {
    fail("No Reddit profile — set REDDIT_PROFILE_DIR or create .reddit-profile");
  }
  if (!proxy) {
    fail("No REDDAPI_PROXY / active-proxy / webshare-proxies.txt");
  }
  if (!headed) {
    fail("Headed mode off — set REDDIT_BROWSER_HEADED=true");
  }

  const context = await launchRedditChrome({ proxy, headed: true });
  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto("https://www.reddit.com/", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(2500);

    if (await isRedditNetworkBlocked(page)) {
      fail(`Reddit network-blocked on proxy ${proxy.label}`);
    }

    await page.goto("https://www.reddit.com/?feed=home", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.waitForTimeout(1500);

    const cookies = await context.cookies("https://www.reddit.com");
    const session = cookies.find((c) => /^reddit_session$/i.test(c.name));
    const token = cookies.find((c) => /^token_v2$/i.test(c.name));

    console.log("reddit_session:", session ? "yes" : "NO");
    console.log("token_v2:", token ? `${token.value.slice(0, 12)}…` : "NO");

    if (!session) fail("Logged-out profile — log in via reddit:session");
    if (!token) fail("token_v2 missing after navigation");

    fs.mkdirSync(path.dirname(redditCookiesPath()), { recursive: true });
    fs.writeFileSync(redditCookiesPath(), JSON.stringify(cookies, null, 2));
    rememberActiveProxy(proxy.raw);
    console.log("OK — headed Chrome + profile + proxy work for Reddit");
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
