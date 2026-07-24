import { createLogger } from "@founderforge/observability";

const log = createLogger("llm-core");

export type ModelTier = "fast" | "balanced" | "strong";

export interface LlmRequest {
  tier: ModelTier;
  system?: string;
  prompt: string;
  /** Force JSON object response when provider supports it. */
  json?: boolean;
  temperature?: number;
  /** When true in tests/dev, return a deterministic stub instead of calling a vendor. */
  stub?: boolean;
}

export interface LlmResponse {
  text: string;
  model: string;
  estimated_cost_usd: number;
  provider: "groq" | "stub";
}

const DEFAULT_MODEL = "openai/gpt-oss-120b";

/** Resolve models at call-time so `.env` loaded after import is respected. */
function tierConfig(tier: ModelTier): {
  model: string;
  inputPerMTok: number;
  outputPerMTok: number;
} {
  const defaults = {
    fast: {
      model: process.env.GROQ_MODEL_FAST ?? DEFAULT_MODEL,
      inputPerMTok: 0.15,
      outputPerMTok: 0.6,
    },
    balanced: {
      model: process.env.GROQ_MODEL_BALANCED ?? DEFAULT_MODEL,
      inputPerMTok: 0.15,
      outputPerMTok: 0.6,
    },
    strong: {
      model: process.env.GROQ_MODEL_STRONG ?? DEFAULT_MODEL,
      inputPerMTok: 0.15,
      outputPerMTok: 0.6,
    },
  } as const;
  return defaults[tier];
}

function shouldStub(req: LlmRequest): boolean {
  // Production never stubs. Explicit stub:true is for unit tests only.
  return req.stub === true;
}

function estimateCostUsd(
  tier: ModelTier,
  promptChars: number,
  completionChars: number,
): number {
  const m = tierConfig(tier);
  const inTok = promptChars / 4;
  const outTok = completionChars / 4;
  return Number(
    ((inTok / 1_000_000) * m.inputPerMTok + (outTok / 1_000_000) * m.outputPerMTok).toFixed(6),
  );
}

/** Parse the retry hint from Groq 429 bodies ("try again in 2.2125s"). */
function parseRetryDelayMs(errText: string, headerRetryAfter: string | null): number {
  const secMatch = errText.match(/try again in ([\d.]+)s/i);
  if (secMatch?.[1]) return Math.ceil(Number(secMatch[1]) * 1000) + 250;
  if (headerRetryAfter) {
    const n = Number(headerRetryAfter);
    if (Number.isFinite(n)) return Math.ceil(n * 1000) + 250;
  }
  return 3000;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Model router — production path is Groq (OpenAI-compatible). Models come from env. */
export async function complete(req: LlmRequest): Promise<LlmResponse> {
  const tierCfg = tierConfig(req.tier);

  if (shouldStub(req)) {
    log.debug("llm stub response", { tier: req.tier, model: tierCfg.model });
    const text = JSON.stringify({
      stub: true,
      prompt_preview: req.prompt.slice(0, 120),
    });
    return {
      text,
      model: `stub:${tierCfg.model}`,
      estimated_cost_usd: 0,
      provider: "stub",
    };
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is required for live LLM calls");
  }

  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (req.system) messages.push({ role: "system", content: req.system });
  messages.push({ role: "user", content: req.prompt });

  const body: Record<string, unknown> = {
    model: tierCfg.model,
    messages,
    temperature: req.temperature ?? (req.json ? 0.2 : 0.4),
  };
  if (req.json) {
    body.response_format = { type: "json_object" };
  }

  const maxAttempts = 5;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = data.choices?.[0]?.message?.content ?? "";
      if (!text) throw new Error("Groq returned empty completion");

      const cost =
        data.usage?.prompt_tokens != null && data.usage.completion_tokens != null
          ? Number(
              (
                (data.usage.prompt_tokens / 1_000_000) * tierCfg.inputPerMTok +
                (data.usage.completion_tokens / 1_000_000) * tierCfg.outputPerMTok
              ).toFixed(6),
            )
          : estimateCostUsd(
              req.tier,
              req.prompt.length + (req.system?.length ?? 0),
              text.length,
            );

      log.info("groq completion", { model: tierCfg.model, tier: req.tier, cost, attempt });
      return {
        text,
        model: tierCfg.model,
        estimated_cost_usd: cost,
        provider: "groq",
      };
    }

    const errText = await res.text();
    lastErr = new Error(`Groq error ${res.status}: ${errText.slice(0, 500)}`);

    // Retry rate limits (429) and transient 5xx; honor server retry hint.
    const retriable = res.status === 429 || res.status === 503 || res.status === 502;
    if (retriable && attempt < maxAttempts) {
      const waitMs =
        res.status === 429
          ? parseRetryDelayMs(errText, res.headers.get("retry-after"))
          : 1000 * attempt;
      log.warn("groq call retriable failure; backing off", {
        status: res.status,
        attempt,
        waitMs,
      });
      await sleep(waitMs);
      continue;
    }
    throw lastErr;
  }
  throw lastErr ?? new Error("Groq call failed");
}

export function parseJsonFromLlm<T>(text: string): T {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("LLM response did not contain JSON object");
    }
    return JSON.parse(trimmed.slice(start, end + 1)) as T;
  }
}

export async function completeJson<T>(
  req: Omit<LlmRequest, "json">,
): Promise<{ data: T; meta: LlmResponse }> {
  const meta = await complete({ ...req, json: true });
  return { data: parseJsonFromLlm<T>(meta.text), meta };
}
