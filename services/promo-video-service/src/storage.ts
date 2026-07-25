/**
 * Upload screenshot images to Supabase (demoforge/images).
 * Final videos are NEVER uploaded — Segmind hosts the video URL.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "@founderforge/observability";
import type { RuntimeConfig } from "./types.js";
import { envOr } from "./util.js";

const log = createLogger("promo.storage");

function storageBase(cfg: RuntimeConfig): string {
  return `${cfg.supabaseUrl.replace(/\/$/, "")}/storage/v1`;
}

function authHeaders(
  cfg: RuntimeConfig,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    Authorization: `Bearer ${cfg.supabaseServiceRoleKey}`,
    apikey: cfg.supabaseServiceRoleKey,
    ...extra,
  };
}

function buildImageObjectPath(cfg: RuntimeConfig, ext = "png"): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = (cfg.supabaseObjectPrefix || "images").replace(/\/$/, "");
  return `${prefix}/${stamp}-${randomUUID().slice(0, 8)}.${ext}`;
}

async function createSignedUrl(
  cfg: RuntimeConfig,
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

export function loadPromoStorageFromEnv(): {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  supabaseBucket: string;
  supabaseObjectPrefix: string;
  supabaseSignedUrlExpiresIn: number;
} {
  const supabaseUrl =
    envOr("DEMO_SUPABASE_URL") ||
    envOr("SUPABASE_URL") ||
    "";
  const supabaseServiceRoleKey =
    envOr("DEMO_SUPABASE_SERVICE_ROLE_KEY") ||
    envOr("SUPABASE_SERVICE_ROLE_KEY") ||
    "";
  const supabaseBucket =
    envOr("DEMO_SUPABASE_STORAGE_BUCKET") ||
    envOr("SUPABASE_STORAGE_BUCKET") ||
    "demoforge";
  const supabaseObjectPrefix =
    envOr("PROMO_SUPABASE_OBJECT_PREFIX") || "images";
  const signedExpires = Number.parseInt(
    envOr("DEMO_SUPABASE_SIGNED_URL_EXPIRES_IN") ||
      envOr("SUPABASE_SIGNED_URL_EXPIRES_IN") ||
      "0",
    10,
  );

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      "Promo image storage requires DEMO_SUPABASE_URL + DEMO_SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_*)",
    );
  }

  return {
    supabaseUrl,
    supabaseServiceRoleKey,
    supabaseBucket,
    supabaseObjectPrefix,
    supabaseSignedUrlExpiresIn: Number.isFinite(signedExpires)
      ? signedExpires
      : 0,
  };
}

export function supabaseConfigured(): boolean {
  try {
    loadPromoStorageFromEnv();
    return true;
  } catch {
    return false;
  }
}

export async function uploadImage(
  cfg: RuntimeConfig,
  localPath: string,
): Promise<string> {
  if (!fs.existsSync(localPath)) {
    throw new Error(`Cannot upload — file missing: ${localPath}`);
  }

  const ext = path.extname(localPath).replace(".", "") || "png";
  const objectPath = buildImageObjectPath(cfg, ext);
  const body = fs.readFileSync(localPath);
  const contentType =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "webp"
        ? "image/webp"
        : "image/png";

  log.info("uploading image to Supabase", {
    bucket: cfg.supabaseBucket,
    path: objectPath,
    bytes: body.length,
  });

  const uploadUrl = `${storageBase(cfg)}/object/${cfg.supabaseBucket}/${objectPath}`;
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: authHeaders(cfg, {
      "Content-Type": contentType,
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
    throw new Error(`Supabase image upload failed (${res.status}): ${detail}`);
  }

  if (cfg.supabaseSignedUrlExpiresIn > 0) {
    return createSignedUrl(
      cfg,
      objectPath,
      cfg.supabaseSignedUrlExpiresIn,
    );
  }

  return `${storageBase(cfg)}/object/public/${cfg.supabaseBucket}/${objectPath}`;
}

export async function uploadScreenshots(
  cfg: RuntimeConfig,
  localPaths: string[],
): Promise<string[]> {
  const urls: string[] = [];
  for (const p of localPaths) {
    urls.push(await uploadImage(cfg, p));
  }
  return urls;
}
