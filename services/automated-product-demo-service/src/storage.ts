/**
 * Upload final demo clips to Supabase Storage and return a public/signed URL.
 * Uses the Storage REST API directly (no Realtime/WebSocket) so Node 20 works.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "@founderforge/observability";

const log = createLogger("apd.storage");

export interface DemoStorageConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  supabaseBucket: string;
  /** Object key prefix without trailing slash. Default: demos */
  supabaseObjectPrefix?: string;
  /** When > 0, return a signed URL instead of public. */
  supabaseSignedUrlExpiresIn?: number;
}

function storageBase(cfg: DemoStorageConfig): string {
  return `${cfg.supabaseUrl.replace(/\/$/, "")}/storage/v1`;
}

function authHeaders(
  cfg: DemoStorageConfig,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    Authorization: `Bearer ${cfg.supabaseServiceRoleKey}`,
    apikey: cfg.supabaseServiceRoleKey,
    ...extra,
  };
}

function buildObjectPath(cfg: DemoStorageConfig): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = (cfg.supabaseObjectPrefix || "demos").replace(/\/$/, "");
  return `${prefix}/${stamp}-${randomUUID().slice(0, 8)}.mp4`;
}

async function createSignedUrl(
  cfg: DemoStorageConfig,
  objectPath: string,
  expiresIn: number,
): Promise<string> {
  const res = await fetch(
    `${storageBase(cfg)}/object/sign/${cfg.supabaseBucket}/${objectPath}`,
    {
      method: "POST",
      headers: authHeaders(cfg, { "Content-Type": "application/json" }),
      body: JSON.stringify({ expiresIn }),
    },
  );
  const json = (await res.json().catch(() => ({}))) as {
    signedURL?: string;
    signedUrl?: string;
    message?: string;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(
      `Supabase signed URL failed (${res.status}): ${json?.message || json?.error || res.statusText}`,
    );
  }
  const signedPath = json?.signedURL || json?.signedUrl;
  if (!signedPath) {
    throw new Error("Supabase signed URL response missing signedURL");
  }
  if (String(signedPath).startsWith("http")) return signedPath;
  return `${cfg.supabaseUrl.replace(/\/$/, "")}/storage/v1${signedPath.startsWith("/") ? "" : "/"}${signedPath}`;
}

export function supabaseConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
}

export function loadDemoStorageConfigFromEnv(): DemoStorageConfig {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  const ttlRaw =
    process.env.DEMO_URL_TTL_SECONDS?.trim() ||
    process.env.REPORT_URL_TTL_SECONDS?.trim() ||
    "0";
  const ttl = Number.parseInt(ttlRaw, 10);
  return {
    supabaseUrl,
    supabaseServiceRoleKey,
    supabaseBucket: process.env.SUPABASE_STORAGE_BUCKET?.trim() || "demos",
    supabaseObjectPrefix: process.env.DEMO_OBJECT_PREFIX?.trim() || "demos",
    supabaseSignedUrlExpiresIn: Number.isFinite(ttl) && ttl > 0 ? ttl : 0,
  };
}

export async function uploadDemoClip(
  cfg: DemoStorageConfig,
  localPath: string,
): Promise<{ url: string; object_key: string }> {
  if (!fs.existsSync(localPath)) {
    throw new Error(`Cannot upload — file missing: ${localPath}`);
  }

  const bucket = cfg.supabaseBucket;
  const objectPath = buildObjectPath(cfg);
  const body = fs.readFileSync(localPath);

  log.info("uploading demo clip", {
    bucket,
    path: objectPath,
    bytes: body.length,
  });

  const uploadUrl = `${storageBase(cfg)}/object/${bucket}/${objectPath}`;
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: authHeaders(cfg, {
      "Content-Type": "video/mp4",
      "x-upsert": "false",
      "cache-control": "3600",
    }),
    body,
  });

  if (!res.ok) {
    const errText = await res.text();
    let detail = errText;
    try {
      const j = JSON.parse(errText) as { message?: string; error?: string };
      detail = j.message || j.error || errText;
    } catch {
      /* keep raw */
    }
    throw new Error(`Supabase upload failed (${res.status}): ${detail}`);
  }

  if (cfg.supabaseSignedUrlExpiresIn && cfg.supabaseSignedUrlExpiresIn > 0) {
    const signed = await createSignedUrl(
      cfg,
      objectPath,
      cfg.supabaseSignedUrlExpiresIn,
    );
    log.info("signed URL ready", { expiresIn: cfg.supabaseSignedUrlExpiresIn });
    return { url: signed, object_key: objectPath };
  }

  const publicUrl = `${storageBase(cfg)}/object/public/${bucket}/${objectPath}`;
  log.info("public URL ready");
  return { url: publicUrl, object_key: objectPath };
}

export function localTempDemoPath(workDir: string): string {
  return path.join(workDir, "demo.mp4");
}
