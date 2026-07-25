import { envInt, groqModel } from "../config.js";
import { createLogger } from "../log.js";

const log = createLogger("llm.groq");

export interface LlmRequest {
  system?: string;
  prompt: string;
  json?: boolean;
  temperature?: number;
  stub?: boolean;
  /** Override default GROQ_MODEL (e.g. groq/compound). */
  model?: string;
  /** Per-request fetch timeout (ms). Defaults: compound 120s, others 60s. */
  timeoutMs?: number;
  /** Cap retries (default 12; use lower for long compound calls). */
  maxAttempts?: number;
  maxTokens?: number;
  /** Compound only: restrict server-side tools (e.g. ["visit_website"]). */
  compoundTools?: string[];
}

export interface LlmResponse {
  text: string;
  model: string;
  estimated_cost_usd: number;
}

interface KeySlot {
  id: string;
  key: string;
  /** Earliest time this key may be used again */
  nextAllowedAt: number;
  inFlight: boolean;
  recent429s: number;
}

function parseRetryDelayMs(errText: string, headerRetryAfter: string | null): number {
  const secMatch = errText.match(/try again in ([\d.]+)\s*s/i);
  if (secMatch?.[1]) return Math.ceil(Number(secMatch[1]) * 1000) + 1000;
  const msMatch = errText.match(/try again in ([\d.]+)\s*ms/i);
  if (msMatch?.[1]) return Math.ceil(Number(msMatch[1])) + 1000;
  if (headerRetryAfter) {
    const n = Number(headerRetryAfter);
    if (Number.isFinite(n)) return Math.ceil(n * 1000) + 1000;
  }
  return 8000;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function minIntervalMs(): number {
  // Default slower — gpt-oss-120b free tier dies at ~3 parallel.
  return envInt("GROQ_MIN_INTERVAL_MS", 2500);
}

function maxConcurrency(): number {
  return Math.max(1, envInt("GROQ_MAX_CONCURRENCY", 1));
}

let slots: KeySlot[] | null = null;
let rr = 0;
let globalInFlight = 0;
let globalNextAllowedAt = 0;

/** Effective parallel workers for plan LLM stage (capped by env). */
export function groqPoolSize(): number {
  return Math.min(loadGroqKeys().length, maxConcurrency());
}

export function loadGroqKeys(): KeySlot[] {
  if (slots) return slots;

  const found: KeySlot[] = [];
  for (let i = 1; i <= 12; i++) {
    const v = process.env[`GROQ_API_KEY_${i}`]?.trim();
    if (v) {
      found.push({
        id: `key_${i}`,
        key: v,
        nextAllowedAt: 0,
        inFlight: false,
        recent429s: 0,
      });
    }
  }

  const legacy = process.env.GROQ_API_KEY?.trim();
  if (legacy && !found.some((s) => s.id === "key_1")) {
    found.unshift({
      id: "key_1",
      key: legacy,
      nextAllowedAt: 0,
      inFlight: false,
      recent429s: 0,
    });
  }

  const seen = new Set<string>();
  slots = found.filter((s) => {
    if (seen.has(s.key)) return false;
    seen.add(s.key);
    return true;
  });

  if (!slots.length) {
    throw new Error(
      "Set GROQ_API_KEY_1 (and optionally GROQ_API_KEY_2, GROQ_API_KEY_3) for LLM calls",
    );
  }

  log.info("groq key pool ready", {
    keys: slots.map((s) => s.id),
    concurrency: maxConcurrency(),
    minIntervalMs: minIntervalMs(),
  });
  return slots;
}

async function acquireKey(): Promise<KeySlot> {
  const pool = loadGroqKeys();
  for (;;) {
    const now = Date.now();
    if (globalInFlight >= maxConcurrency() || now < globalNextAllowedAt) {
      await sleep(
        Math.max(50, Math.min(globalNextAllowedAt - now, 2000)) || 100,
      );
      continue;
    }

    // Prefer keys with fewer recent 429s
    const ranked = [...pool.keys()].sort((a, b) => {
      const sa = pool[a]!;
      const sb = pool[b]!;
      if (sa.recent429s !== sb.recent429s) return sa.recent429s - sb.recent429s;
      return ((a + rr) % pool.length) - ((b + rr) % pool.length);
    });

    for (const idx of ranked) {
      const s = pool[idx]!;
      if (!s.inFlight && s.nextAllowedAt <= now) {
        rr = (idx + 1) % pool.length;
        s.inFlight = true;
        globalInFlight += 1;
        return s;
      }
    }

    const waitMs =
      Math.min(
        ...pool.map((s) => Math.max(0, s.nextAllowedAt - now)),
        Math.max(0, globalNextAllowedAt - now),
      ) + 20;
    await sleep(Math.max(50, Math.min(waitMs || 200, 3000)));
  }
}

function releaseKey(slot: KeySlot, coolMs: number): void {
  if (slot.inFlight) {
    slot.inFlight = false;
    globalInFlight = Math.max(0, globalInFlight - 1);
  }
  slot.nextAllowedAt = Math.max(slot.nextAllowedAt, Date.now() + coolMs);
}

export function parseJsonFromLlm<T>(text: string): T {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    }
    throw new Error(`LLM returned non-JSON: ${trimmed.slice(0, 300)}`);
  }
}

async function completeOnce(req: LlmRequest): Promise<LlmResponse> {
  const model = req.model || groqModel();
  const isCompound = model.includes("compound");

  if (req.stub) {
    return {
      text: JSON.stringify({ stub: true, preview: req.prompt.slice(0, 80) }),
      model: `stub:${model}`,
      estimated_cost_usd: 0,
    };
  }

  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (req.system) messages.push({ role: "system", content: req.system });
  messages.push({ role: "user", content: req.prompt });

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: req.temperature ?? (req.json ? 0.2 : 0.4),
  };
  if (req.maxTokens != null) body.max_tokens = req.maxTokens;
  if (req.json && !isCompound) {
    body.response_format = { type: "json_object" };
  }
  // Keep Compound from vacuuming the whole web into one turn (413 request_too_large).
  if (isCompound && req.compoundTools?.length) {
    body.compound_custom = {
      tools: { enabled_tools: req.compoundTools },
    };
  }

  const timeoutMs =
    req.timeoutMs ??
    (isCompound
      ? envInt("GROQ_COMPOUND_TIMEOUT_MS", 120_000)
      : envInt("GROQ_TIMEOUT_MS", 60_000));
  const maxAttempts = req.maxAttempts ?? (isCompound ? 3 : 12);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const slot = await acquireKey();
    const started = Date.now();
    log.info("groq request start", {
      model,
      key: slot.id,
      attempt,
      timeoutMs,
    });
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${slot.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const errText = res.ok ? "" : await res.text();
      if (res.status === 429 || res.status === 502 || res.status === 503) {
        const delay = Math.max(
          parseRetryDelayMs(errText, res.headers.get("retry-after")),
          10_000,
        );
        slot.recent429s += 1;
        releaseKey(slot, delay);
        globalNextAllowedAt = Math.max(globalNextAllowedAt, Date.now() + 2000);
        log.warn("groq rate limited — backing off", {
          status: res.status,
          attempt,
          delay,
          key: slot.id,
        });
        await sleep(Math.min(delay, 4000));
        continue;
      }
      if (res.status === 413) {
        releaseKey(slot, minIntervalMs());
        log.warn("groq request too large (413)", {
          model,
          key: slot.id,
          attempt,
          body: errText.slice(0, 400),
        });
        throw new Error(`Groq 413: ${errText.slice(0, 500)}`);
      }
      if (!res.ok) {
        releaseKey(slot, minIntervalMs());
        throw new Error(`Groq ${res.status}: ${errText.slice(0, 500)}`);
      }

      slot.recent429s = Math.max(0, slot.recent429s - 1);
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = json.choices?.[0]?.message?.content || "";
      releaseKey(slot, minIntervalMs());
      log.info("groq request ok", {
        model,
        key: slot.id,
        ms: Date.now() - started,
        chars: text.length,
      });
      const estimated_cost_usd = Number(
        (((req.prompt.length + text.length) / 4 / 1_000_000) * 0.3).toFixed(6),
      );
      return { text, model, estimated_cost_usd };
    } catch (err) {
      releaseKey(slot, minIntervalMs() * attempt);
      lastErr = err;
      const name = err instanceof Error ? err.name : "";
      const message = err instanceof Error ? err.message : String(err);
      const timedOut =
        name === "TimeoutError" ||
        name === "AbortError" ||
        /aborted|timeout/i.test(message);
      const tooLarge = /413|request_too_large|entity too large/i.test(message);
      log.warn("groq request failed", {
        model,
        key: slot.id,
        attempt,
        timedOut,
        tooLarge,
        ms: Date.now() - started,
        error: message.slice(0, 300),
      });
      // 413 won't succeed by retrying the same Compound crawl.
      if (tooLarge) break;
      if (attempt >= maxAttempts) break;
      await sleep(timedOut ? 1500 : 800 * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function complete(req: LlmRequest): Promise<LlmResponse> {
  return completeOnce(req);
}

export async function completeJson<T>(
  req: Omit<LlmRequest, "json">,
): Promise<{ data: T; meta: LlmResponse }> {
  const meta = await complete({ ...req, json: true });
  return { data: parseJsonFromLlm<T>(meta.text), meta };
}
