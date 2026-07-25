import { GoogleGenAI } from "@google/genai";
import { createLogger } from "@founderforge/observability";
import type { DemoPlan } from "./planner.js";
import type { StepResult } from "./browser.js";

const log = createLogger("apd.narrator");

export interface NarratorConfig {
  geminiApiKey: string;
  textModel: string;
  script: string;
}

async function groundNarration(
  ai: GoogleGenAI,
  cfg: NarratorConfig,
  userGoal: string,
  step: StepResult,
  draft: string,
): Promise<string> {
  const prompt = `User's overall demo goal:
"""${userGoal}"""

Current browser step instruction:
"""${step.instruction}"""

What actually happened (Firecrawl agent output):
"""${step.output || "(no output)"}"""

Draft narration (optional reference):
"""${draft}"""

Write ONE short, natural sentence (under 20 words) narrating this step for a product demo voiceover.
Present tense, conversational, confident. Reflect what actually happened when useful
(e.g. a real price or label). Return ONLY the sentence, no quotes or preamble.`;

  log.info("writing narration text", { model: cfg.textModel, stepId: step.id });
  try {
    const response = await ai.models.generateContent({
      model: cfg.textModel,
      contents: prompt,
      config: { temperature: 0.7 },
    });
    const text = (response.text || "").trim().replace(/^["']|["']$/g, "");
    if (text) return text;
  } catch (err) {
    log.warn("grounding failed, using draft", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return draft || `Next, we ${step.instruction.toLowerCase().replace(/\.$/, "")}.`;
}

/** Produce grounded narration lines (text only — TTS is separate). */
export async function writeNarrationLines(
  cfg: NarratorConfig,
  plan: DemoPlan,
  stepResults: StepResult[],
): Promise<Array<{ stepId: number; text: string }>> {
  const ai = new GoogleGenAI({ apiKey: cfg.geminiApiKey });
  const drafts = Object.fromEntries(
    plan.steps.map((s) => [s.id, s.narration_draft]),
  );
  const lines: Array<{ stepId: number; text: string }> = [];

  for (const step of stepResults) {
    const draft = drafts[step.id] || "";
    const text = await groundNarration(ai, cfg, cfg.script, step, draft);
    log.info(`narration step ${step.id}`, { text });
    lines.push({ stepId: step.id, text });
  }
  return lines;
}
