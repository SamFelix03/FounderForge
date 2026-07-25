import fs from "node:fs";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { createLogger } from "@founderforge/observability";
import type { PromoScript, RuntimeConfig, ScreenshotCapture, SelectedPage } from "./types.js";
import { truncate } from "./util.js";

const log = createLogger("promo.script");

const ShotSchema = z.object({
  start_s: z.number(),
  end_s: z.number(),
  visual: z.string(),
  image_refs: z.array(z.string()).default([]),
  voiceover_slice: z.string().optional().default(""),
});

const PromoScriptSchema = z.object({
  concept: z.string(),
  tone: z.string(),
  voiceover: z.string().min(20),
  shot_list: z.array(ShotSchema).min(1),
  seedance_prompt: z.string().min(40),
});

const SCRIPT_JSON_SCHEMA = {
  type: "object",
  properties: {
    concept: { type: "string" },
    tone: { type: "string" },
    voiceover: { type: "string" },
    shot_list: {
      type: "array",
      items: {
        type: "object",
        properties: {
          start_s: { type: "number" },
          end_s: { type: "number" },
          visual: { type: "string" },
          image_refs: { type: "array", items: { type: "string" } },
          voiceover_slice: { type: "string" },
        },
        required: ["start_s", "end_s", "visual", "image_refs"],
      },
    },
    seedance_prompt: { type: "string" },
  },
  required: ["concept", "tone", "voiceover", "shot_list", "seedance_prompt"],
};

function mimeForPath(p: string): string {
  const lower = p.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

/**
 * Multimodal Gemini: product URL + page reasons + screenshots → killer script.
 */
export async function writeKillerScript(
  cfg: RuntimeConfig,
  {
    selectedPages,
    screenshots,
  }: { selectedPages: SelectedPage[]; screenshots: ScreenshotCapture[] },
): Promise<PromoScript> {
  const ai = new GoogleGenAI({ apiKey: cfg.geminiApiKey });

  const imageParts = screenshots.map((s) => {
    const data = fs.readFileSync(s.localPath).toString("base64");
    return {
      inlineData: {
        mimeType: mimeForPath(s.localPath),
        data,
      },
    };
  });

  const catalog = screenshots
    .map(
      (s, i) =>
        `- image ${i + 1}: screenshot of ${s.url} (${s.reason || selectedPages[i]?.reason || "product page"})`,
    )
    .join("\n");

  const textPrompt = `You are an elite promo creative director. Create a KILLER ${cfg.duration}-second product promo for this website:

Product URL: ${cfg.url}

Available reference screenshots (cite them in Seedance style as "image 1", "image 2", …).
Each image is an ABOVE-THE-FOLD / viewport hero capture (not a tiny full-page scroll) — show them large and readable on screen:
${catalog}

HARD CONSTRAINTS:
- Duration: exactly ${cfg.duration} seconds.
- Voiceover must be spoken in FULL within ${cfg.duration}s — trailer-fast, punchy, no dead air. Do not skip lines you write.
- Use the real product UI from the screenshots. Cite images as "image 1", "image 2", etc.
- seedance_prompt must be a COMPLETE ready-to-send prompt for ByteDance Seedance 2.0:
  - Include aspect ratio ${cfg.aspectRatio}
  - Include a Shot N | start–end script
  - Include full VO text
  - Include music/SFX direction (plucky/mischievous, not corporate)
  - Instruct generate_audio-style synced dialogue + music
  - Reference images by "image N"
- Make it distinctive and memorable for THIS product — not a generic SaaS ad.
- End with a clear brand/product name endcard moment.

Return JSON matching:
{
  "concept": "short concept title + one-line premise",
  "tone": "tone keywords",
  "voiceover": "full spoken script as one string",
  "shot_list": [
    { "start_s": 0, "end_s": 2, "visual": "...", "image_refs": ["image 1"], "voiceover_slice": "..." }
  ],
  "seedance_prompt": "full prompt string to send to Seedance"
}`;

  const contents = [
    {
      role: "user",
      parts: [{ text: textPrompt }, ...imageParts],
    },
  ];

  log.info("writing killer script", {
    model: cfg.textModel,
    images: screenshots.length,
  });

  let response;
  try {
    response = await ai.models.generateContent({
      model: cfg.textModel,
      contents,
      config: {
        responseMimeType: "application/json",
        responseSchema: SCRIPT_JSON_SCHEMA,
      },
    });
  } catch (schemaErr) {
    log.warn("responseSchema failed — retrying with responseJsonSchema", {
      error: schemaErr instanceof Error ? schemaErr.message : String(schemaErr),
    });
    response = await ai.models.generateContent({
      model: cfg.textModel,
      contents,
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: SCRIPT_JSON_SCHEMA,
      },
    });
  }

  const rawText = (response.text || "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(
      `Script writer returned non-JSON:\n${truncate(rawText, 600)}`,
    );
  }

  const script = PromoScriptSchema.parse(parsed);
  log.info("script ready", {
    concept: truncate(script.concept, 120),
    vo: truncate(script.voiceover, 160),
  });
  return script;
}
