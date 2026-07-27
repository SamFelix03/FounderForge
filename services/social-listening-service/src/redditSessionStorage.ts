/**
 * Sync Reddit Chrome profile + cookies with Supabase Storage.
 *
 * Used on every deploy (Cloud Run, VM, etc.): pipeline start pulls session
 * into a writable runtime dir so laptop paths are never required.
 *
 * Objects under prefix (default `redditcreds` in bucket `demoforge`):
 *   profile.tar.gz  — Chrome user-data dir (caches excluded)
 *   cookies.json    — session cookie dump
 *
 * Push once from a logged-in machine:
 *   pnpm --filter @founderforge/social-listening-service reddit:push-session
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { envOr, projectRoot, redditProfileDir } from "./config.js";
import { createLogger } from "./log.js";
import { redditCookiesPath } from "./browser/redditChrome.js";

const execFileAsync = promisify(execFile);
const log = createLogger("reddit.session.storage");

type SupabaseConfig = {
  url: string;
  key: string;
  bucket: string;
  prefix: string;
};

const PROFILE_OBJECT = "profile.tar.gz";
const COOKIES_OBJECT = "cookies.json";
const DEFAULT_BUCKET = "demoforge";
const DEFAULT_PREFIX = "redditcreds";

let pullOnce: Promise<void> | null = null;
let lastPullOk = false;

function env(...names: string[]): string {
  for (const name of names) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  return "";
}

/**
 * Pull/push session from Supabase on every deploy by default when creds exist.
 * Set REDDIT_SESSION_REMOTE=false to force local-only (laptop debugging).
 */
export function redditSessionRemoteEnabled(): boolean {
  const flag = envOr("REDDIT_SESSION_REMOTE", "true").toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return redditSessionStorageConfigured();
}

export function redditSessionStorageConfigured(): boolean {
  return Boolean(
    env("REDDIT_SUPABASE_URL", "DEMO_SUPABASE_URL", "SUPABASE_URL") &&
      env(
        "REDDIT_SUPABASE_SERVICE_ROLE_KEY",
        "DEMO_SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
      ),
  );
}

function getConfig(): SupabaseConfig {
  const url = env("REDDIT_SUPABASE_URL", "DEMO_SUPABASE_URL", "SUPABASE_URL");
  const key = env(
    "REDDIT_SUPABASE_SERVICE_ROLE_KEY",
    "DEMO_SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  );
  if (!url || !key) {
    throw new Error(
      "Reddit session storage needs REDDIT_SUPABASE_URL + REDDIT_SUPABASE_SERVICE_ROLE_KEY (or DEMO_SUPABASE_* / SUPABASE_*)",
    );
  }
  return {
    url,
    key,
    bucket:
      env("REDDIT_SUPABASE_STORAGE_BUCKET", "DEMO_SUPABASE_STORAGE_BUCKET") ||
      DEFAULT_BUCKET,
    prefix: (env("REDDIT_SUPABASE_OBJECT_PREFIX") || DEFAULT_PREFIX).replace(
      /\/$/,
      "",
    ),
  };
}

function storageBase(cfg: SupabaseConfig): string {
  return `${cfg.url.replace(/\/$/, "")}/storage/v1`;
}

function objectPath(cfg: SupabaseConfig, name: string): string {
  return `${cfg.prefix}/${name}`;
}

function authHeaders(
  cfg: SupabaseConfig,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    Authorization: `Bearer ${cfg.key}`,
    apikey: cfg.key,
    ...extra,
  };
}

/**
 * Where a remote pull materializes. Always /tmp when remote is on so deploy
 * never depends on laptop absolute paths (REDDIT_PROFILE_DIR is push-source only).
 */
export function resolveRuntimeSessionPaths(): {
  profileDir: string;
  cookiesPath: string;
} {
  if (redditSessionRemoteEnabled()) {
    const base = path.join(os.tmpdir(), "founderforge-reddit");
    return {
      profileDir: path.join(base, "profile"),
      cookiesPath: path.join(base, "cookies.json"),
    };
  }

  return {
    profileDir: redditProfileDir(),
    cookiesPath: redditCookiesPath(),
  };
}

/** Point process env so the rest of the service uses the runtime paths. */
function applyRuntimePaths(paths: {
  profileDir: string;
  cookiesPath: string;
}): void {
  process.env.REDDIT_PROFILE_DIR = paths.profileDir;
  process.env.REDDIT_SESSION_COOKIES_PATH = paths.cookiesPath;
}

async function uploadBytes(
  cfg: SupabaseConfig,
  name: string,
  bytes: Buffer,
  contentType: string,
): Promise<void> {
  const key = objectPath(cfg, name);
  const uploadUrl = `${storageBase(cfg)}/object/${cfg.bucket}/${key}`;
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: authHeaders(cfg, {
      "Content-Type": contentType,
      "x-upsert": "true",
      "cache-control": "no-cache",
    }),
    body: bytes,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `Supabase upload ${key} failed (${res.status}): ${errText.slice(0, 300)}`,
    );
  }
  log.info("uploaded session object", {
    bucket: cfg.bucket,
    key,
    bytes: bytes.length,
  });
}

async function downloadBytes(
  cfg: SupabaseConfig,
  name: string,
): Promise<Buffer> {
  const key = objectPath(cfg, name);
  const url = `${storageBase(cfg)}/object/authenticated/${cfg.bucket}/${key}`;
  const res = await fetch(url, {
    method: "GET",
    headers: authHeaders(cfg),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `Supabase download ${key} failed (${res.status}): ${errText.slice(0, 300)}`,
    );
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

const TAR_EXCLUDES = [
  "Cache",
  "Code Cache",
  "GPUCache",
  "Service Worker",
  "BlobStorage",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GrShaderCache",
  "ShaderCache",
  "BrowserMetrics",
  "Crashpad",
  "component_crx_cache",
  "optimization_guide_hint_cache_store",
];

async function createProfileTarGz(
  profileDir: string,
  outFile: string,
): Promise<void> {
  if (!fs.existsSync(profileDir)) {
    throw new Error(`Profile dir missing: ${profileDir}`);
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const excludes = TAR_EXCLUDES.flatMap((e) => ["--exclude", e]);
  // Pack contents of profileDir into archive root
  await execFileAsync(
    "tar",
    ["-czf", outFile, ...excludes, "-C", profileDir, "."],
    { windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
  );
}

async function extractProfileTarGz(
  tarFile: string,
  profileDir: string,
): Promise<void> {
  fs.rmSync(profileDir, { recursive: true, force: true });
  fs.mkdirSync(profileDir, { recursive: true });
  await execFileAsync("tar", ["-xzf", tarFile, "-C", profileDir], {
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
}

/**
 * Upload local profile + cookies to Supabase (run on your laptop after reddit:session).
 */
export async function pushRedditSessionToStorage(opts?: {
  profileDir?: string;
  cookiesPath?: string;
}): Promise<{ profileBytes: number; cookiesBytes: number }> {
  const cfg = getConfig();
  const profileDir = opts?.profileDir || redditProfileDir();
  const cookiesPath = opts?.cookiesPath || redditCookiesPath();

  if (!fs.existsSync(profileDir)) {
    throw new Error(`No profile at ${profileDir} — log in first`);
  }
  if (!fs.existsSync(cookiesPath)) {
    throw new Error(
      `No cookies at ${cookiesPath} — run a refresh/smoke once to dump cookies`,
    );
  }

  const tmpTar = path.join(
    os.tmpdir(),
    `ff-reddit-profile-${Date.now()}.tar.gz`,
  );
  try {
    log.info("packing profile for upload", { profileDir });
    await createProfileTarGz(profileDir, tmpTar);
    const profileBytes = fs.readFileSync(tmpTar);
    const cookiesBytes = fs.readFileSync(cookiesPath);

    await uploadBytes(
      cfg,
      PROFILE_OBJECT,
      profileBytes,
      "application/gzip",
    );
    await uploadBytes(
      cfg,
      COOKIES_OBJECT,
      cookiesBytes,
      "application/json",
    );

    return {
      profileBytes: profileBytes.length,
      cookiesBytes: cookiesBytes.length,
    };
  } finally {
    fs.rmSync(tmpTar, { force: true });
  }
}

/**
 * Download profile + cookies from Supabase into a writable local dir.
 * Safe to call multiple times — only pulls once per process unless force.
 */
export async function ensureRedditSessionLocal(
  opts: { force?: boolean } = {},
): Promise<{ pulled: boolean; profileDir: string; cookiesPath: string }> {
  const paths = resolveRuntimeSessionPaths();
  applyRuntimePaths(paths);

  if (!redditSessionRemoteEnabled()) {
    return { pulled: false, ...paths };
  }
  if (!redditSessionStorageConfigured()) {
    throw new Error(
      "REDDIT_SESSION_REMOTE is on but Supabase credentials are missing",
    );
  }

  if (!opts.force && lastPullOk) {
    return { pulled: false, ...paths };
  }
  if (!opts.force && pullOnce) {
    await pullOnce;
    return { pulled: lastPullOk, ...paths };
  }

  pullOnce = (async () => {
    const cfg = getConfig();
    const tmpTar = path.join(
      os.tmpdir(),
      `ff-reddit-pull-${Date.now()}.tar.gz`,
    );
    try {
      log.info("pulling Reddit session from Supabase", {
        bucket: cfg.bucket,
        prefix: cfg.prefix,
        profileDir: paths.profileDir,
      });

      const profileBuf = await downloadBytes(cfg, PROFILE_OBJECT);
      fs.writeFileSync(tmpTar, profileBuf);
      await extractProfileTarGz(tmpTar, paths.profileDir);

      const cookiesBuf = await downloadBytes(cfg, COOKIES_OBJECT);
      fs.mkdirSync(path.dirname(paths.cookiesPath), { recursive: true });
      fs.writeFileSync(paths.cookiesPath, cookiesBuf);

      lastPullOk = true;
      log.info("Reddit session ready locally", {
        profileDir: paths.profileDir,
        cookiesPath: paths.cookiesPath,
        profileTarBytes: profileBuf.length,
        cookiesBytes: cookiesBuf.length,
      });
    } finally {
      fs.rmSync(tmpTar, { force: true });
    }
  })();

  try {
    await pullOnce;
  } catch (err) {
    pullOnce = null;
    lastPullOk = false;
    throw err;
  }

  return { pulled: true, ...paths };
}

/**
 * After token refresh / successful browser use, push updates back to the bucket
 * so the next Cloud Run instance gets a fresh token_v2.
 */
export async function syncRedditSessionToStorageIfRemote(): Promise<void> {
  if (!redditSessionRemoteEnabled() || !redditSessionStorageConfigured()) {
    return;
  }
  const paths = resolveRuntimeSessionPaths();
  if (!fs.existsSync(paths.profileDir) || !fs.existsSync(paths.cookiesPath)) {
    log.warn("skip session push — local profile/cookies missing");
    return;
  }
  try {
    await pushRedditSessionToStorage({
      profileDir: paths.profileDir,
      cookiesPath: paths.cookiesPath,
    });
  } catch (err) {
    log.warn("session push failed (non-fatal)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
