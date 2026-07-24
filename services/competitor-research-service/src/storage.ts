import { createLogger } from "@founderforge/observability";
import { randomUUID } from "node:crypto";

const log = createLogger("artifact-store");

export interface UploadedPdf {
  url: string;
  object_key: string;
  bucket: string;
  /** Signed URL expiry in seconds from mint time (when applicable). */
  expires_in_seconds?: number;
}

export function supabaseConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
}

/**
 * Industry-standard deliverable path for generated PDFs:
 * bytes → object storage → signed/public URL. No durable local copy.
 */
export async function uploadPdfBuffer(
  bytes: Buffer,
  opts?: { filename?: string; contentType?: string },
): Promise<UploadedPdf> {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "reports";

  if (!url || !key) {
    throw new Error(
      "Supabase Storage is not configured (need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)",
    );
  }

  const filename =
    opts?.filename ?? `report-${randomUUID()}.pdf`;
  const objectKey = `competitor-research/${filename}`;
  const contentType = opts?.contentType ?? "application/pdf";
  const expiresIn = Number(process.env.REPORT_URL_TTL_SECONDS ?? 60 * 60 * 24 * 7);

  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await client.storage.from(bucket).upload(objectKey, bytes, {
    contentType,
    upsert: true,
  });
  if (error) throw error;

  const signed = await client.storage.from(bucket).createSignedUrl(objectKey, expiresIn);
  if (signed.error || !signed.data?.signedUrl) {
    // Fall back to public URL shape if bucket is public and signing is disabled
    const publicUrl = client.storage.from(bucket).getPublicUrl(objectKey).data.publicUrl;
    if (!publicUrl) {
      throw signed.error ?? new Error("Failed to mint download URL for uploaded PDF");
    }
    log.info("uploaded pdf to supabase (public url)", { bucket, objectKey });
    return { url: publicUrl, object_key: objectKey, bucket };
  }

  log.info("uploaded pdf to supabase (signed url)", {
    bucket,
    objectKey,
    expiresIn,
  });
  return {
    url: signed.data.signedUrl,
    object_key: objectKey,
    bucket,
    expires_in_seconds: expiresIn,
  };
}
