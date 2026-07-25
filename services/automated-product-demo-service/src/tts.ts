/**
 * Deepgram Aura TTS via REST POST /v1/speak
 * Docs: https://developers.deepgram.com/docs/text-to-speech
 */
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@founderforge/observability";
import { runFfprobeDuration } from "./media.js";
import { truncate } from "./util.js";

const log = createLogger("apd.tts");

export interface TtsConfig {
  deepgramApiKey: string;
  deepgramTtsModel?: string;
}

/**
 * Synthesize narration to a WAV file using Deepgram Speak.
 * @returns duration seconds
 */
export async function synthesizeDeepgramTts(
  cfg: TtsConfig,
  text: string,
  outPath: string,
): Promise<number> {
  const model = cfg.deepgramTtsModel || "aura-2-thalia-en";
  if (!cfg.deepgramApiKey) {
    throw new Error("DEEPGRAM_API_KEY is required for TTS");
  }

  const url = new URL("https://api.deepgram.com/v1/speak");
  url.searchParams.set("model", model);
  url.searchParams.set("encoding", "linear16");
  url.searchParams.set("container", "wav");

  log.info("Deepgram TTS", { model, text: truncate(text, 100) });

  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${cfg.deepgramApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok) {
    throw new Error(
      `Deepgram TTS failed (${res.status}): ${buf.toString("utf8").slice(0, 400)}`,
    );
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);

  const duration = runFfprobeDuration(outPath);
  log.info("audio written", {
    file: path.basename(outPath),
    duration_s: Number(duration.toFixed(2)),
    synth_s: Number(((Date.now() - t0) / 1000).toFixed(2)),
    bytes: buf.length,
    requestId: res.headers.get("dg-request-id") || undefined,
  });
  return duration;
}
