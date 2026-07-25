/**
 * Segmind Seedance 2.0 async client.
 * Final video stays on Segmind — never upload MP4 to Supabase.
 */
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@founderforge/observability";
import type { RuntimeConfig } from "./types.js";

const log = createLogger("promo.video");

const SUBMIT_URL = "https://api.segmind.com/v2/seedance-2.0";
const statusUrl = (id: string) =>
  `https://api.segmind.com/v2/requests/${id}/status`;
const resultUrl = (id: string) => `https://api.segmind.com/v2/requests/${id}`;

const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;

async function readJsonSafe(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return { raw: text };
  }
}

async function submitJob(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<{ requestId: string; data: Record<string, unknown> }> {
  const res = await fetch(SUBMIT_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await readJsonSafe(res);
  if (!res.ok) {
    throw new Error(
      `Seedance submit failed (${res.status}): ${JSON.stringify(data, null, 2)}`,
    );
  }
  const requestId =
    (data.request_id as string | undefined) ??
    (data.requestId as string | undefined) ??
    (data.id as string | undefined);
  if (!requestId) {
    throw new Error(`No request_id in submit response: ${JSON.stringify(data)}`);
  }
  return { requestId, data };
}

async function pollUntilDone(apiKey: string, requestId: string): Promise<void> {
  const started = Date.now();
  let status = "QUEUED";
  let transientHits = 0;

  log.info("polling Segmind job", { request_id: requestId });
  while (status === "QUEUED" || status === "PROCESSING") {
    if (Date.now() - started > POLL_TIMEOUT_MS) {
      throw new Error(
        `Timed out after ${POLL_TIMEOUT_MS}ms (last status=${status}). Resume with --resume ${requestId}`,
      );
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    let res: Response;
    try {
      res = await fetch(statusUrl(requestId), {
        headers: { "x-api-key": apiKey },
      });
    } catch (err) {
      transientHits += 1;
      log.warn("status poll network blip", {
        hit: transientHits,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const data = await readJsonSafe(res);

    if (res.status === 422 || data.status === "FAILED") {
      throw new Error(`Generation FAILED: ${JSON.stringify(data, null, 2)}`);
    }

    if (RETRY_STATUS.has(res.status) || res.status === 404) {
      transientHits += 1;
      log.warn("status poll transient HTTP", {
        status: res.status,
        hit: transientHits,
      });
      continue;
    }

    if (!res.ok) {
      throw new Error(
        `Status poll error (${res.status}): ${JSON.stringify(data)}`,
      );
    }

    status = String(data.status ?? status);
    transientHits = 0;
    log.info("seedance status", { status });
  }

  if (status !== "COMPLETED") {
    throw new Error(`Unexpected final status: ${status}`);
  }
}

function extractVideoUrl(result: Record<string, unknown>): string | null {
  const data = result.data as Record<string, unknown> | undefined;
  const nestedResult = result.result as Record<string, unknown> | undefined;
  const candidates: unknown[] = [
    result.video,
    result.output,
    result.url,
    result.video_url,
    result.videoUrl,
    data?.video,
    data?.output,
    data?.url,
    nestedResult?.video,
    nestedResult?.output,
    Array.isArray(result.output) ? result.output[0] : null,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && /^https?:\/\//i.test(c)) return c;
    if (c && typeof c === "object") {
      const o = c as { url?: string; uri?: string };
      if (typeof o.url === "string") return o.url;
      if (typeof o.uri === "string") return o.uri;
    }
  }
  return null;
}

function extractBase64Video(result: Record<string, unknown>): string | null {
  const candidates = [
    result.video,
    result.output,
    result.data,
    result.video_base64,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 200 && !/^https?:\/\//i.test(c)) {
      return c.replace(/^data:video\/\w+;base64,/, "");
    }
  }
  return null;
}

async function fetchResult(
  apiKey: string,
  requestId: string,
): Promise<
  | { kind: "binary"; buffer: Buffer }
  | { kind: "json"; data: Record<string, unknown> }
> {
  const res = await fetch(resultUrl(requestId), {
    headers: { "x-api-key": apiKey },
  });
  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("video/") || contentType.includes("octet-stream")) {
    return { kind: "binary", buffer: Buffer.from(await res.arrayBuffer()) };
  }

  const data = await readJsonSafe(res);
  if (!res.ok) {
    throw new Error(
      `Result fetch failed (${res.status}): ${JSON.stringify(data, null, 2)}`,
    );
  }
  return { kind: "json", data };
}

export interface SeedanceVideoResult {
  requestId: string;
  videoUrl: string | null;
  localPath: string | null;
}

/**
 * Generate promo via Seedance. Returns Segmind URL when available.
 * Does NOT upload video to Supabase.
 */
export async function generateSeedanceVideo(
  cfg: RuntimeConfig,
  {
    prompt,
    referenceImages,
  }: { prompt: string; referenceImages: string[] },
): Promise<SeedanceVideoResult> {
  const apiKey = cfg.segmindApiKey;
  const outputPath = path.join(cfg.workDir, "promo.mp4");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const body: Record<string, unknown> = {
    prompt,
    duration: cfg.duration,
    resolution: cfg.resolution,
    aspect_ratio: cfg.aspectRatio,
    bitrate_mode: cfg.bitrateMode,
    generate_audio: cfg.generateAudio,
    seed: cfg.seed,
  };

  const refs = (referenceImages || []).filter(Boolean).slice(0, 9);
  if (refs.length > 0) {
    body.reference_images = refs;
  }

  let requestId = cfg.resumeRequestId;

  if (requestId) {
    log.info("resuming Segmind job (no new submit)", { request_id: requestId });
  } else {
    log.info("submitting Seedance 2.0 job", {
      duration: cfg.duration,
      resolution: cfg.resolution,
      bitrate: cfg.bitrateMode,
      aspect: cfg.aspectRatio,
      audio: cfg.generateAudio,
      reference_images: refs.length,
    });

    ({ requestId } = await submitJob(apiKey, body));
    log.info("seedance submitted", { request_id: requestId });
  }

  await pollUntilDone(apiKey, requestId);

  log.info("fetching Segmind result", { request_id: requestId });
  const result = await fetchResult(apiKey, requestId);

  let videoUrl: string | null = null;
  let localPath: string | null = null;

  if (result.kind === "binary") {
    fs.writeFileSync(outputPath, result.buffer);
    localPath = outputPath;
  } else {
    videoUrl = extractVideoUrl(result.data);
    if (videoUrl) {
      log.info("downloading video from Segmind URL");
      const res = await fetch(videoUrl);
      if (!res.ok) {
        throw new Error(`Video download failed (${res.status}): ${videoUrl}`);
      }
      fs.writeFileSync(outputPath, Buffer.from(await res.arrayBuffer()));
      localPath = outputPath;
    } else {
      const b64 = extractBase64Video(result.data);
      if (b64) {
        fs.writeFileSync(outputPath, Buffer.from(b64, "base64"));
        localPath = outputPath;
      } else {
        throw new Error(
          "Could not find video in Segmind result. Full body:\n" +
            JSON.stringify(result.data, null, 2),
        );
      }
    }
  }

  fs.writeFileSync(
    path.join(cfg.workDir, "seedance_result.json"),
    JSON.stringify(
      {
        request_id: requestId,
        video_url: videoUrl,
        local_path: localPath,
        raw: result.kind === "json" ? result.data : { binary: true },
      },
      null,
      2,
    ),
  );

  return { requestId, videoUrl, localPath };
}
