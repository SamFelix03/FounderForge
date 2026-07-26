/**
 * Groq client with multi-key pool + cooldown fallback (same pattern as sociallisteningForge).
 * On 429/502/503 the failing key is cooled and the next available key is used.
 */

import Groq from "groq-sdk";

type KeySlot = {
  id: string;
  key: string;
  nextAllowedAt: number;
  inFlight: boolean;
  recent429s: number;
};

export type GroqChatClient = {
  chat: {
    completions: {
      create: (
        params: Record<string, unknown>,
        opts?: { maxAttempts?: number },
      ) => Promise<Groq.Chat.ChatCompletion>;
    };
  };
};

function envInt(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseRetryDelayMs(errText: unknown, headerRetryAfter: unknown): number {
  const text = String(errText || "");
  const combo = text.match(/try again in (?:(\d+)\s*h)?(?:(\d+)\s*m)?(?:([\d.]+)\s*s)?/i);
  if (combo && (combo[1] || combo[2] || combo[3])) {
    const h = Number(combo[1] || 0);
    const m = Number(combo[2] || 0);
    const s = Number(combo[3] || 0);
    const total = (h * 3600 + m * 60 + s) * 1000;
    if (Number.isFinite(total) && total > 0) return Math.ceil(total) + 1000;
  }
  const msMatch = text.match(/try again in ([\d.]+)\s*ms/i);
  if (msMatch?.[1]) return Math.ceil(Number(msMatch[1])) + 1000;
  if (headerRetryAfter) {
    const n = Number(headerRetryAfter);
    if (Number.isFinite(n)) return Math.ceil(n * 1000) + 1000;
  }
  return 8000;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function minIntervalMs(): number {
  return envInt("GROQ_MIN_INTERVAL_MS", 2500);
}

function maxConcurrency(): number {
  return Math.max(1, envInt("GROQ_MAX_CONCURRENCY", 1));
}

let slots: KeySlot[] | null = null;
let rr = 0;
let globalInFlight = 0;
let globalNextAllowedAt = 0;
let poolLogged = false;

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
      "Set GROQ_API_KEY_1 (and optionally GROQ_API_KEY_2, GROQ_API_KEY_3) or GROQ_API_KEY for LLM calls",
    );
  }

  if (!poolLogged) {
    poolLogged = true;
    console.log(
      `  groq key pool ready: ${slots.map((s) => s.id).join(", ")} (concurrency=${maxConcurrency()}, minInterval=${minIntervalMs()}ms)`,
    );
  }
  return slots;
}

async function acquireKey(): Promise<KeySlot> {
  const pool = loadGroqKeys();
  for (;;) {
    const now = Date.now();
    if (globalInFlight >= maxConcurrency() || now < globalNextAllowedAt) {
      await sleep(Math.max(50, Math.min(globalNextAllowedAt - now, 2000)) || 100);
      continue;
    }

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

function isRetryableStatus(status: number | null): boolean {
  return status === 429 || status === 502 || status === 503;
}

function errorStatus(err: unknown): number | null {
  const e = err as {
    status?: number;
    statusCode?: number;
    response?: { status?: number };
  } | null;
  return e?.status ?? e?.statusCode ?? e?.response?.status ?? null;
}

function errorText(err: unknown): string {
  if (!err) return "";
  if (err instanceof Error && typeof err.message === "string") return err.message;
  return String(err);
}

/**
 * Drop-in replacement for `new Groq(...).chat.completions.create`.
 * Rotates across the key pool when a key is rate-limited.
 */
export async function chatCompletionsCreate(
  params: Record<string, unknown>,
  opts: { maxAttempts?: number } = {},
): Promise<Groq.Chat.ChatCompletion> {
  const model = (params?.model as string) || sheetModel();
  const isCompound = String(model).includes("compound");
  const maxAttempts = opts.maxAttempts ?? (isCompound ? 3 : 12);
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const slot = await acquireKey();
    const client = new Groq({
      apiKey: slot.key,
      defaultHeaders: {
        "Groq-Model-Version": "latest",
      },
    });

    try {
      const completion = await client.chat.completions.create(
        // compound_custom / pool wrappers aren't fully typed in groq-sdk
        params as never,
      );
      slot.recent429s = Math.max(0, slot.recent429s - 1);
      releaseKey(slot, minIntervalMs());
      if (attempt > 1) {
        console.log(`  -> groq ok on ${slot.id} (attempt ${attempt})`);
      }
      return completion;
    } catch (err) {
      const status = errorStatus(err);
      const message = errorText(err);

      if (isRetryableStatus(status) || /rate.?limit|tokens per day|TPD/i.test(message)) {
        const delay = Math.max(parseRetryDelayMs(message, null), 10_000);
        slot.recent429s += 1;
        releaseKey(slot, delay);
        globalNextAllowedAt = Math.max(globalNextAllowedAt, Date.now() + 2000);
        console.warn(
          `  -> groq ${status || 429} on ${slot.id} — cooling ${Math.ceil(delay / 1000)}s, trying next key (attempt ${attempt}/${maxAttempts})`,
        );
        lastErr = err;
        await sleep(Math.min(delay, 4000));
        continue;
      }

      releaseKey(slot, minIntervalMs() * attempt);
      lastErr = err;
      const timedOut = /aborted|timeout/i.test(message);
      const tooLarge = /413|request_too_large|entity too large/i.test(message);
      console.warn(`  -> groq failed on ${slot.id}: ${message.slice(0, 200)}`);
      if (tooLarge) break;
      if (attempt >= maxAttempts) break;
      await sleep(timedOut ? 1500 : 800 * attempt);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Client shaped like groq-sdk so existing `groq.chat.completions.create` callers keep working.
 */
export function createGroqClient(): GroqChatClient {
  loadGroqKeys();
  return {
    chat: {
      completions: {
        create: (params, opts) => chatCompletionsCreate(params, opts),
      },
    },
  };
}

export function compoundModel(): string {
  return process.env.GROQ_COMPOUND_MODEL || "groq/compound";
}

export function sheetModel(): string {
  return process.env.GROQ_SHEET_MODEL || process.env.GROQ_MODEL || "openai/gpt-oss-120b";
}
