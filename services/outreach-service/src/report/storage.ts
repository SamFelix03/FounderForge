/**
 * Upload outreach PDFs to Supabase Storage (shared Feature 5 project).
 * Credentials: SUPABASE_* (canonical). Optional OUTREACH_SUPABASE_* / DEMO_SUPABASE_* overrides.
 * Signed TTL defaults to REPORT_URL_TTL_SECONDS (7d). Set …_EXPIRES_IN=0 for public URLs.
 */

import { randomUUID } from "node:crypto";

type SupabaseConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  supabaseBucket: string;
  supabaseObjectPrefix: string;
  supabaseSignedUrlExpiresIn: number;
};

function env(...names: string[]): string {
  for (const name of names) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  return "";
}

export function supabaseConfigured(): boolean {
  return Boolean(
    env("SUPABASE_URL", "OUTREACH_SUPABASE_URL", "DEMO_SUPABASE_URL") &&
      env(
        "SUPABASE_SERVICE_ROLE_KEY",
        "OUTREACH_SUPABASE_SERVICE_ROLE_KEY",
        "DEMO_SUPABASE_SERVICE_ROLE_KEY",
      ),
  );
}

export function getSupabaseConfig(): SupabaseConfig {
  const supabaseUrl = env("SUPABASE_URL", "OUTREACH_SUPABASE_URL", "DEMO_SUPABASE_URL");
  const supabaseServiceRoleKey = env(
    "SUPABASE_SERVICE_ROLE_KEY",
    "OUTREACH_SUPABASE_SERVICE_ROLE_KEY",
    "DEMO_SUPABASE_SERVICE_ROLE_KEY",
  );
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env",
    );
  }

  const signedRaw = env(
    "OUTREACH_SUPABASE_SIGNED_URL_EXPIRES_IN",
    "OUTREACH_REPORT_URL_TTL_SECONDS",
    "DEMO_SUPABASE_SIGNED_URL_EXPIRES_IN",
    "REPORT_URL_TTL_SECONDS",
  );
  const signedExpires = Number.parseInt(
    signedRaw || String(60 * 60 * 24 * 7),
    10,
  );

  return {
    supabaseUrl,
    supabaseServiceRoleKey,
    supabaseBucket:
      env(
        "OUTREACH_SUPABASE_STORAGE_BUCKET",
        "SUPABASE_STORAGE_BUCKET",
        "DEMO_SUPABASE_STORAGE_BUCKET",
      ) || "reports",
    supabaseObjectPrefix: (
      env("OUTREACH_SUPABASE_OBJECT_PREFIX") || "outreach"
    ).trim(),
    supabaseSignedUrlExpiresIn: Number.isFinite(signedExpires)
      ? signedExpires
      : 60 * 60 * 24 * 7,
  };
}

function storageBase(cfg: SupabaseConfig): string {
  return `${cfg.supabaseUrl.replace(/\/$/, "")}/storage/v1`;
}

function authHeaders(
  cfg: SupabaseConfig,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    Authorization: `Bearer ${cfg.supabaseServiceRoleKey}`,
    apikey: cfg.supabaseServiceRoleKey,
    ...extra,
  };
}

function buildObjectPath(cfg: SupabaseConfig, fileName: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = (cfg.supabaseObjectPrefix || "outreach").replace(/\/$/, "");
  const base = fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
  return `${prefix}/${stamp}-${randomUUID().slice(0, 8)}-${base}`;
}

async function createSignedUrl(
  cfg: SupabaseConfig,
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
  return `${cfg.supabaseUrl.replace(/\/$/, "")}/storage/v1${
    signedPath.startsWith("/") ? "" : "/"
  }${signedPath}`;
}

/**
 * Upload a PDF buffer to Supabase Storage via REST.
 */
export async function uploadPdfBuffer(
  bytes: Buffer,
  opts: { filename?: string } = {},
): Promise<{
  url: string;
  object_key: string;
  bucket: string;
  expires_in_seconds?: number;
}> {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new Error("Cannot upload — PDF buffer is empty");
  }

  const cfg = getSupabaseConfig();
  const filename = opts.filename || `outreach-${randomUUID()}.pdf`;
  const objectKey = buildObjectPath(cfg, filename);
  const bucket = cfg.supabaseBucket;

  console.log("  Uploading PDF to Supabase Storage...");
  console.log(`  bucket=${bucket}`);
  console.log(`  path=${objectKey}`);
  console.log(`  bytes=${bytes.length}`);

  const uploadUrl = `${storageBase(cfg)}/object/${bucket}/${objectKey}`;
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: authHeaders(cfg, {
      "Content-Type": "application/pdf",
      "x-upsert": "true",
      "cache-control": "3600",
    }),
    body: bytes,
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

  let url: string;
  let expiresIn: number | undefined;
  if (cfg.supabaseSignedUrlExpiresIn > 0) {
    url = await createSignedUrl(cfg, objectKey, cfg.supabaseSignedUrlExpiresIn);
    expiresIn = cfg.supabaseSignedUrlExpiresIn;
    console.log(`  Signed URL ready (expires in ${expiresIn}s)`);
  } else {
    url = `${storageBase(cfg)}/object/public/${bucket}/${objectKey}`;
    console.log("  Public URL ready");
  }

  return {
    url,
    object_key: objectKey,
    bucket,
    ...(expiresIn ? { expires_in_seconds: expiresIn } : {}),
  };
}
