import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { createLogger } from "@founderforge/observability";
import { truncate } from "./util.js";

const log = createLogger("apd.planner");

export const StepSchema = z.object({
  id: z.number().int(),
  instruction: z.string(),
  narration_draft: z.string(),
});

export const PlanSchema = z.object({
  steps: z.array(StepSchema).min(1),
});

export type DemoPlan = z.infer<typeof PlanSchema>;

const PLAN_JSON_SCHEMA = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          instruction: { type: "string" },
          narration_draft: { type: "string" },
        },
        required: ["id", "instruction", "narration_draft"],
      },
    },
  },
  required: ["steps"],
} as const;

export interface PlannerConfig {
  geminiApiKey: string;
  textModel: string;
  websiteUrl: string;
  script: string;
}

function geminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey });
}

export async function planDemo(cfg: PlannerConfig): Promise<DemoPlan> {
  const ai = geminiClient(cfg.geminiApiKey);
  const prompt = `You are planning a product demo video.

Target website: ${cfg.websiteUrl}
Demo script / instructions from the user:
"""${cfg.script}"""

Break this into an ordered list of ATOMIC browser steps for Firecrawl's /interact API.

Rules:
- Each step's instruction must be a single clear action (click one thing, fill one field, navigate once, scroll once, etc.).
- Do NOT combine multiple actions in one instruction.
- Instructions should be natural-language prompts a browser agent can follow on the live page.
- narration_draft should be one short conversational sentence (under 12 words) for voiceover of that step.
- Start from the page already being open at the target URL (do not include a separate "open the URL" step unless navigation elsewhere is needed).
- Keep the demo focused; typically 4–12 steps unless the script clearly needs more.
- Number ids starting at 1.

Return JSON matching: { "steps": [ { "id": number, "instruction": string, "narration_draft": string } ] }`;

  log.info("planning with Gemini", {
    model: cfg.textModel,
    promptPreview: truncate(prompt, 400),
  });

  const t0 = Date.now();
  let response;
  try {
    response = await ai.models.generateContent({
      model: cfg.textModel,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: PLAN_JSON_SCHEMA,
      },
    });
  } catch (schemaErr) {
    log.warn("responseSchema failed; retrying with responseJsonSchema", {
      error: schemaErr instanceof Error ? schemaErr.message : String(schemaErr),
    });
    response = await ai.models.generateContent({
      model: cfg.textModel,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: PLAN_JSON_SCHEMA,
      },
    });
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

  const rawText = (response.text || "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`Planner returned non-JSON:\n${truncate(rawText, 500)}`);
  }

  const plan = PlanSchema.parse(parsed);
  const normalized: DemoPlan = {
    steps: plan.steps.map((step, i) => ({
      id: i + 1,
      instruction: step.instruction.trim(),
      narration_draft: step.narration_draft.trim(),
    })),
  };

  log.info("plan ready", { elapsed_s: elapsed, steps: normalized.steps.length });
  for (const step of normalized.steps) {
    log.info(`plan step ${step.id}`, {
      instruction: step.instruction,
      draft: step.narration_draft,
    });
  }
  return normalized;
}
