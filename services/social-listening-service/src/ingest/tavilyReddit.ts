/**
 * Discover Reddit threads via Tavily Research (structured JSON).
 * Standalone first — wire into pipeline after validating output shape.
 */
import { tavily } from "@tavily/core";
import { envInt, envOr } from "../config.js";
import { createLogger } from "../log.js";

const log = createLogger("ingest.tavily.reddit");

/** Same shape Compound / Playwright discovery emit today. */
export type TavilyDiscoverHit = {
  url: string;
  title: string;
  selftext: string;
  subreddit?: string;
  why?: string;
};

export const REDDIT_THREADS_OUTPUT_SCHEMA = {
  properties: {
    threads: {
      type: "array",
      description: "Reddit seeker threads only",
      items: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description:
              "Full Reddit thread URL, e.g. https://www.reddit.com/r/sub/comments/id/slug/",
          },
          title: { type: "string", description: "Post title" },
          selftext: {
            type: "string",
            description: "Short excerpt or paraphrase of the OP ask",
          },
          subreddit: {
            type: "string",
            description: "Subreddit name without r/",
          },
          why: {
            type: "string",
            description: "Why this post matches the need (one sentence)",
          },
        },
        required: ["url", "title", "selftext", "subreddit"],
      },
    },
  },
  required: ["threads"],
} as const;

/**
 * Outer template is fixed; `needStatement` is the Compound-generated pain
 * (the bracket content in the user's prompt).
 */
export function buildRedditOnlyResearchPrompt(
  needStatement: string,
  maxThreads: number,
): string {
  const need = needStatement.trim().replace(/^\{|\}$/g, "").trim();
  return `Fetch Reddit posts where {${need}} I want ONLY reddit posts and NOTHING else.

Rules:
- Search and return ONLY real threads on reddit.com (www.reddit.com or old.reddit.com).
- ONLY seeker posts: people looking for a tool, workaround, recommendation, or help.
- EXCLUDE founder launches / showcases: "I built", "I'm building", "just launched", "feedback on my", product demos, Show HN.
- Each item must include a real /r/.../comments/.../ URL (not a subreddit homepage, user profile, or wiki).
- Return at most ${maxThreads} threads.
- Do not invent URLs. If unsure a URL is real, omit it.
- Output must match the provided JSON schema (threads array).`;
}

function ensureRedditThreadUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (!/(\.|^)reddit\.com$/i.test(u.hostname)) return null;
    const m = u.pathname.match(
      /^\/r\/([^/]+)\/comments\/([a-z0-9]+)(?:\/([^/]*))?/i,
    );
    if (!m || m[3] === "comment") return null;
    const slug = m[3] && m[3] !== "comment" ? m[3] : "";
    const pathPart = slug
      ? `/r/${m[1]}/comments/${m[2]}/${slug}/`
      : `/r/${m[1]}/comments/${m[2]}/`;
    return `https://www.reddit.com${pathPart}`;
  } catch {
    return null;
  }
}

function normalizeHits(raw: unknown): TavilyDiscoverHit[] {
  const threads =
    raw &&
    typeof raw === "object" &&
    Array.isArray((raw as { threads?: unknown }).threads)
      ? (raw as { threads: unknown[] }).threads
      : Array.isArray(raw)
        ? raw
        : [];

  const out: TavilyDiscoverHit[] = [];
  const seen = new Set<string>();
  for (const row of threads) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const url = ensureRedditThreadUrl(String(o.url || o.permalink || o.link || ""));
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const subFromUrl = url.match(/reddit\.com\/r\/([^/]+)/i)?.[1];
    out.push({
      url,
      title: String(o.title || "").trim() || "(untitled)",
      selftext: String(o.selftext || o.excerpt || o.snippet || o.why || "").trim(),
      subreddit: String(o.subreddit || subFromUrl || "")
        .replace(/^r\//i, "")
        .trim() || undefined,
      why: o.why ? String(o.why) : undefined,
    });
  }
  return out;
}

/** Also harvest reddit.com /comments/ links from free-text report + sources. */
function harvestFromSources(
  content: unknown,
  sources: unknown,
): TavilyDiscoverHit[] {
  const blob = [
    typeof content === "string" ? content : JSON.stringify(content ?? ""),
    JSON.stringify(sources ?? []),
  ].join("\n");
  const urls = blob.match(
    /https?:\/\/(?:www\.|old\.|np\.)?reddit\.com\/r\/[^/\s)"']+\/comments\/[a-z0-9]+(?:\/[^/\s)"']*)?/gi,
  );
  if (!urls?.length) return [];
  const out: TavilyDiscoverHit[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const url = ensureRedditThreadUrl(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      url,
      title: "(from Tavily sources)",
      selftext: "",
      subreddit: url.match(/reddit\.com\/r\/([^/]+)/i)?.[1],
    });
  }
  return out;
}

function tavilyClient() {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY is required (set in FounderForge/.env)");
  }
  return tavily({ apiKey });
}

/** Cheaper path: Tavily Search restricted to reddit.com (same hit shape). */
export async function discoverRedditThreadsViaTavilySearch(opts: {
  needStatement: string;
  maxThreads?: number;
}): Promise<{ hits: TavilyDiscoverHit[]; meta: TavilyResearchMeta }> {
  const maxThreads = opts.maxThreads ?? envInt("TAVILY_REDDIT_LIMIT", 10);
  const need = opts.needStatement.trim().replace(/^\{|\}$/g, "").trim();
  // Mirror the Research template as closely as Search allows
  const query = `reddit.com posts where ${need}`;
  const client = tavilyClient();
  const started = Date.now();

  log.info("tavily search start", { maxThreads, needChars: need.length });

  const response = await client.search(query, {
    maxResults: Math.min(20, Math.max(maxThreads * 2, 8)),
    includeDomains: ["reddit.com"],
    searchDepth: "advanced",
    includeAnswer: false,
  });

  const results = Array.isArray(
    (response as { results?: unknown }).results,
  )
    ? (
        response as {
          results: Array<{
            url?: string;
            title?: string;
            content?: string;
          }>;
        }
      ).results
    : [];

  const hits: TavilyDiscoverHit[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    const url = ensureRedditThreadUrl(String(r.url || ""));
    if (!url || seen.has(url)) continue;
    seen.add(url);
    hits.push({
      url,
      title: String(r.title || "").trim() || "(untitled)",
      selftext: String(r.content || "").trim(),
      subreddit: url.match(/reddit\.com\/r\/([^/]+)/i)?.[1],
      why: "matched Tavily search (reddit.com)",
    });
    if (hits.length >= maxThreads) break;
  }

  const meta: TavilyResearchMeta = {
    requestId: "search",
    status: "completed",
    model: "search",
    prompt: query,
    content: { threads: hits },
    sources: results,
    elapsedMs: Date.now() - started,
  };

  log.info("tavily search done", {
    kept: hits.length,
    rawResults: results.length,
    elapsedMs: meta.elapsedMs,
  });

  return { hits, meta };
}

export type TavilyResearchMeta = {
  requestId: string;
  status: string;
  model: string;
  prompt: string;
  content: unknown;
  sources: unknown;
  elapsedMs: number;
};

/**
 * Run Tavily Research with structured threads schema; poll until done.
 */
export async function discoverRedditThreadsViaTavily(opts: {
  needStatement: string;
  maxThreads?: number;
  model?: "mini" | "pro" | "auto";
  pollMs?: number;
  timeoutMs?: number;
}): Promise<{ hits: TavilyDiscoverHit[]; meta: TavilyResearchMeta }> {
  const maxThreads = opts.maxThreads ?? envInt("TAVILY_REDDIT_LIMIT", 10);
  const model = (opts.model ||
    envOr("TAVILY_RESEARCH_MODEL", "mini")) as "mini" | "pro" | "auto";
  const pollMs = opts.pollMs ?? envInt("TAVILY_POLL_MS", 3_000);
  const timeoutMs = opts.timeoutMs ?? envInt("TAVILY_RESEARCH_TIMEOUT_MS", 180_000);

  const prompt = buildRedditOnlyResearchPrompt(opts.needStatement, maxThreads);
  const client = tavilyClient();
  const started = Date.now();

  log.info("tavily research start", { model, maxThreads, needChars: opts.needStatement.length });

  const created = await client.research(prompt, {
    model,
    outputSchema: REDDIT_THREADS_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
  });
  const requestId =
    (created as { requestId?: string; request_id?: string }).requestId ||
    (created as { request_id?: string }).request_id;
  if (!requestId) {
    throw new Error(
      `Tavily research did not return requestId: ${JSON.stringify(created).slice(0, 300)}`,
    );
  }
  log.info("tavily research task created", { requestId });

  let last: {
    status?: string;
    content?: unknown;
    sources?: unknown;
    error?: string;
    error_message?: string;
  } = { status: "pending" };

  while (Date.now() - started < timeoutMs) {
    last = (await client.getResearch(requestId)) as typeof last;
    const status = String(last.status || "").toLowerCase();
    log.info("tavily research poll", { requestId, status, elapsedMs: Date.now() - started });
    if (status === "completed") break;
    if (status === "failed") {
      throw new Error(
        `Tavily research failed: ${last.error_message || last.error || "unknown"}`,
      );
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  if (String(last.status || "").toLowerCase() !== "completed") {
    throw new Error(
      `Tavily research timed out after ${timeoutMs}ms (last status=${last.status})`,
    );
  }

  let contentParsed: unknown = last.content;
  if (typeof last.content === "string") {
    try {
      contentParsed = JSON.parse(last.content);
    } catch {
      contentParsed = last.content;
    }
  }

  const structured = normalizeHits(contentParsed);
  const harvested = harvestFromSources(last.content, last.sources);
  const hits: TavilyDiscoverHit[] = [];
  const seen = new Set<string>();
  for (const h of [...structured, ...harvested]) {
    if (seen.has(h.url)) continue;
    seen.add(h.url);
    hits.push(h);
    if (hits.length >= maxThreads) break;
  }

  const meta: TavilyResearchMeta = {
    requestId,
    status: String(last.status),
    model,
    prompt,
    content: contentParsed,
    sources: last.sources,
    elapsedMs: Date.now() - started,
  };

  log.info("tavily research done", {
    requestId,
    structured: structured.length,
    harvested: harvested.length,
    kept: hits.length,
    elapsedMs: meta.elapsedMs,
  });

  return { hits, meta };
}
