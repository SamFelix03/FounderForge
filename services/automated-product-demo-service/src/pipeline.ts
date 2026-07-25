import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "@founderforge/observability";
import { assembleDemo, type NarrationClip } from "./assemble.js";
import { BrowserExecutor } from "./browser.js";
import { writeNarrationLines } from "./narrator.js";
import { planDemo } from "./planner.js";
import { InputSchema, type Input, type Output } from "./schema.js";
import {
  loadDemoStorageConfigFromEnv,
  localTempDemoPath,
  uploadDemoClip,
} from "./storage.js";
import { synthesizeDeepgramTts } from "./tts.js";
import { requireMediaBins } from "./media.js";

const log = createLogger("apd.pipeline");

export interface PipelineOptions {
  /** Called around major phases for job step visibility (Temporal activity). */
  onStep?: (step: string) => void | Promise<void>;
  /** Register a cleanup hook (e.g. SIGINT) that closes the browser session. */
  registerCleanup?: (fn: () => Promise<void>) => void;
  workDir?: string;
}

function envOrThrow(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is required`);
  return v;
}

function loadRuntimeConfig(input: Input) {
  return {
    websiteUrl: input.website_url,
    script: input.script,
    firecrawlApiKey: envOrThrow("FIRECRAWL_API_KEY"),
    geminiApiKey: envOrThrow("GEMINI_API_KEY"),
    textModel: process.env.GEMINI_TEXT_MODEL?.trim() || "gemini-3.1-flash-lite",
    deepgramApiKey: envOrThrow("DEEPGRAM_API_KEY"),
    deepgramTtsModel:
      process.env.DEEPGRAM_TTS_MODEL?.trim() || "aura-2-thalia-en",
    storage: loadDemoStorageConfigFromEnv(),
  };
}

export async function runPipeline(
  rawInput: Input,
  opts: PipelineOptions = {},
): Promise<Output> {
  const input = InputSchema.parse(rawInput);
  const cfg = loadRuntimeConfig(input);
  requireMediaBins((msg) => log.info(msg));

  const workDir =
    opts.workDir ||
    path.join(os.tmpdir(), `apd-${randomUUID().slice(0, 8)}`);
  fs.mkdirSync(path.join(workDir, "audio"), { recursive: true });
  fs.mkdirSync(path.join(workDir, "frames"), { recursive: true });
  fs.mkdirSync(path.join(workDir, "segments"), { recursive: true });

  const phase = async (name: string) => {
    log.info(name);
    if (opts.onStep) await opts.onStep(name);
  };

  const costs: Output["cost_breakdown"] = [];
  const executor = new BrowserExecutor(cfg.firecrawlApiKey);

  const cleanupBrowser = async (reason: string) => {
    try {
      await executor.closeSession(reason);
    } catch (err) {
      log.warn("browser cleanup warning", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
  if (typeof opts.registerCleanup === "function") {
    opts.registerCleanup(() => cleanupBrowser("process signal / exit"));
  }

  try {
    await phase("plan");
    const plan = await planDemo({
      geminiApiKey: cfg.geminiApiKey,
      textModel: cfg.textModel,
      websiteUrl: cfg.websiteUrl,
      script: cfg.script,
    });
    fs.writeFileSync(path.join(workDir, "plan.json"), JSON.stringify(plan, null, 2));
    costs.push({ vendor: "llm", operation: "plan", amount_usd: 0.01 });

    await phase("record");
    await executor.scrape(cfg.websiteUrl);
    const cdpUrl = await executor.warmup();
    await executor.startRecording(cdpUrl);
    const stepResults = await executor.runSteps(plan.steps);
    if (!stepResults.length) throw new Error("No steps were executed");

    const frames = await executor.stopRecording();
    executor.saveFrames(path.join(workDir, "frames"));
    executor.saveStepLog(path.join(workDir, "step_log.json"));

    // Close remote browser ASAP — do not keep billing during TTS/ffmpeg
    await cleanupBrowser("recording finished");
    costs.push({ vendor: "browser", operation: "record", amount_usd: 0.5 });

    if (!frames.length) {
      throw new Error("No screencast frames captured; cannot assemble video");
    }

    await phase("narrate");
    const lines = await writeNarrationLines(
      {
        geminiApiKey: cfg.geminiApiKey,
        textModel: cfg.textModel,
        script: cfg.script,
      },
      plan,
      stepResults,
    );
    const audioDir = path.join(workDir, "audio");
    const clips: NarrationClip[] = [];
    for (const line of lines) {
      const filePath = path.join(audioDir, `narration_${line.stepId}.wav`);
      const duration = await synthesizeDeepgramTts(
        {
          deepgramApiKey: cfg.deepgramApiKey,
          deepgramTtsModel: cfg.deepgramTtsModel,
        },
        line.text,
        filePath,
      );
      clips.push({
        stepId: line.stepId,
        text: line.text,
        path: filePath,
        duration,
      });
    }
    costs.push({ vendor: "tts", operation: "narrate", amount_usd: 0.05 });

    await phase("assemble");
    const assembled = await assembleDemo(
      frames,
      stepResults,
      clips,
      workDir,
      localTempDemoPath(workDir),
    );
    costs.push({ vendor: "media", operation: "assemble", amount_usd: 0.01 });

    await phase("upload");
    const uploaded = await uploadDemoClip(cfg.storage, assembled.localPath);
    costs.push({ vendor: "storage", operation: "upload", amount_usd: 0.01 });

    await cleanupBrowser("video uploaded");

    return {
      video_url: uploaded.url,
      duration_seconds: assembled.duration_seconds,
      object_key: uploaded.object_key,
      cost_breakdown: costs,
      steps: stepResults.map((s) => ({
        id: s.id,
        instruction: s.instruction,
        success: s.success,
        duration: s.duration,
      })),
    };
  } catch (err) {
    await cleanupBrowser(`pipeline error: ${err instanceof Error ? err.message : err}`);
    throw err;
  } finally {
    await cleanupBrowser("pipeline finally");
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
      log.info("removed temp work dir", { workDir });
    } catch (err) {
      log.warn("temp cleanup warning", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
