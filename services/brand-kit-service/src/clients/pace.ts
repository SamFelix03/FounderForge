import type { GoogleGenAI, GenerateContentParameters, GenerateContentResponse } from "@google/genai";

/** Standard wait between pipeline stages (and default for env override). */
const STEP_DELAY_MS = Number.parseInt(process.env.VERTEX_STEP_DELAY_MS || "10000", 10);
/** Fixed 10s between every Vertex quota retry — not shortened by env. */
const RETRY_DELAY_MS = 10_000;
/** 1 initial attempt + 10 retries */
const DEFAULT_MAX_ATTEMPTS = Number.parseInt(process.env.VERTEX_MAX_ATTEMPTS || "11", 10);

export async function waitBetweenSteps(label = "next step"): Promise<void> {
  const ms = Number.isFinite(STEP_DELAY_MS) && STEP_DELAY_MS > 0 ? STEP_DELAY_MS : 10_000;
  console.log(`  waiting ${Math.round(ms / 1000)}s before ${label}...`);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitBeforeRetry(label: string): Promise<void> {
  console.log(`  waiting ${RETRY_DELAY_MS / 1000}s before ${label}...`);
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
}

/**
 * Call Vertex generateContent with retries on 429 / RESOURCE_EXHAUSTED.
 * Default: 11 attempts = 1 try + 10 retries, with a fixed 10s pause between retries.
 */
export async function generateContentWithRetry(
  ai: GoogleGenAI,
  params: GenerateContentParameters,
  { label = "request", maxAttempts = DEFAULT_MAX_ATTEMPTS }: { label?: string; maxAttempts?: number } = {},
): Promise<GenerateContentResponse> {
  const attempts = Number.isFinite(maxAttempts) && maxAttempts > 0 ? maxAttempts : 11;
  const retries = attempts - 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err) {
      lastError = err;
      const e = err as { status?: number; code?: number | string; message?: string };
      const status = e?.status || e?.code;
      const message = String(e?.message || err);
      const isQuota =
        status === 429 ||
        message.includes("RESOURCE_EXHAUSTED") ||
        message.includes("Resource has been exhausted");

      if (!isQuota || attempt === attempts) throw err;

      console.warn(`  ${label} hit quota (429), retry ${attempt}/${retries} after delay...`);
      await waitBeforeRetry(`${label} retry`);
    }
  }
  throw lastError;
}
