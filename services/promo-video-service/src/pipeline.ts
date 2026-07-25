import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "@founderforge/observability";
import { discoverImportantPages } from "./discover.js";
import { captureScreenshots } from "./screenshots.js";
import { InputSchema, type Input, type Output } from "./schema.js";
import { writeKillerScript } from "./script.js";
import { loadPromoStorageFromEnv, uploadScreenshots } from "./storage.js";
import type { RuntimeConfig } from "./types.js";
import { envOr, envOrThrow } from "./util.js";
import { generateSeedanceVideo } from "./video.js";

const log = createLogger("promo.pipeline");

export interface PipelineOptions {
  onStep?: (step: string) => void | Promise<void>;
  workDir?: string;
  /** CLI-only resume of an existing Segmind request (never from sticky env). */
  resumeRequestId?: string | null;
}

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function loadRuntimeConfig(
  input: Input,
  workDir: string,
  resumeRequestId: string | null,
): RuntimeConfig {
  const storage = loadPromoStorageFromEnv();
  return {
    url: input.product_url,
    maxPages: input.max_pages,
    duration: input.duration,
    resolution: input.resolution,
    aspectRatio: "16:9",
    bitrateMode: "standard",
    generateAudio: true,
    seed: -1,
    workDir,
    resumeRequestId,
    firecrawlApiKey: envOrThrow("FIRECRAWL_API_KEY"),
    firecrawlApiUrl: envOr("FIRECRAWL_API_URL") || null,
    geminiApiKey: envOrThrow("GEMINI_API_KEY"),
    textModel: envOr("GEMINI_TEXT_MODEL") || "gemini-3.1-flash-lite",
    segmindApiKey: envOrThrow("SEGMIND_API_KEY"),
    ...storage,
  };
}

/**
 * Full promo pipeline:
 * discover → screenshot → upload images to demoforge/images → script → Seedance
 * Artifact video URL is Segmind-hosted (never uploaded to Supabase).
 */
export async function runPipeline(
  rawInput: Input,
  opts: PipelineOptions = {},
): Promise<Output> {
  const input = InputSchema.parse(rawInput);
  const workDir =
    opts.workDir ||
    path.join(os.tmpdir(), `promo-${randomUUID().slice(0, 8)}`);
  fs.mkdirSync(workDir, { recursive: true });

  const cfg = loadRuntimeConfig(
    input,
    workDir,
    opts.resumeRequestId ?? null,
  );

  const phase = async (name: string) => {
    log.info(name);
    if (opts.onStep) await opts.onStep(name);
  };

  const costs: Output["cost_breakdown"] = [];

  await phase("discover");
  const selectedPages = await discoverImportantPages(cfg);
  writeJson(path.join(workDir, "selected_pages.json"), {
    root: cfg.url,
    pages: selectedPages,
  });
  costs.push({ vendor: "firecrawl", operation: "map", amount_usd: 0.02 });
  costs.push({ vendor: "llm", operation: "rank_pages", amount_usd: 0.01 });

  await phase("screenshots");
  const screenshots = await captureScreenshots(cfg, selectedPages);
  costs.push({
    vendor: "firecrawl",
    operation: "screenshots",
    amount_usd: 0.05 * screenshots.length,
  });

  await phase("upload_images");
  const publicUrls = await uploadScreenshots(
    cfg,
    screenshots.map((s) => s.localPath),
  );
  const imageUrls = publicUrls.map((url, i) => ({
    ref: `image ${i + 1}`,
    page_url: screenshots[i]!.url,
    reason: screenshots[i]!.reason,
    local_path: screenshots[i]!.localPath,
    public_url: url,
  }));
  writeJson(path.join(workDir, "image_urls.json"), { images: imageUrls });
  log.info("uploaded images to Supabase", { count: imageUrls.length });

  await phase("script");
  const script = await writeKillerScript(cfg, { selectedPages, screenshots });
  writeJson(path.join(workDir, "script.json"), script);
  costs.push({ vendor: "llm", operation: "script", amount_usd: 0.02 });

  await phase("video");
  const video = await generateSeedanceVideo(cfg, {
    prompt: script.seedance_prompt,
    referenceImages: publicUrls,
  });
  costs.push({ vendor: "segmind", operation: "seedance", amount_usd: 0.4 });

  if (!video.videoUrl) {
    throw new Error(
      "Seedance completed but returned no public video URL (binary-only). " +
        "Promo-video service requires a Segmind-hosted URL as the job artifact.",
    );
  }

  writeJson(path.join(workDir, "run_summary.json"), {
    url: cfg.url,
    duration: cfg.duration,
    resolution: cfg.resolution,
    pages: selectedPages.length,
    images: imageUrls,
    concept: script.concept,
    request_id: video.requestId,
    video_url: video.videoUrl,
    local_path: video.localPath,
  });

  log.info("promo ready", {
    video_url: video.videoUrl,
    request_id: video.requestId,
  });

  return {
    video_url: video.videoUrl,
    request_id: video.requestId,
    duration_seconds: cfg.duration,
    concept: script.concept,
    image_urls: publicUrls,
    cost_breakdown: costs,
  };
}
