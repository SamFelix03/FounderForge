/**
 * Discover popular Reddit threads via Groq Compound (web_search).
 * Output shape matches Apify ingest discovery: { url, title, selftext }.
 *
 * Note: Compound + visit_website / large search dumps often 413 — we use
 * groq/compound-mini + one small web_search per subreddit.
 */
import { envInt, envOr } from "../config.js";
import { createLogger } from "../log.js";
import { loadGroqKeys } from "../llm/groq.js";
import type { ProductConfig } from "../types.js";

const log = createLogger("ingest.compound");

export type CompoundDiscoverHit = {
  url: string;
  title: string;
  selftext: string;
  subreddit?: string;
  why?: string;
};

function ensureRedditThreadUrl(raw: string): string | null {
  if (!raw) return null;
  try {
    const cleaned = raw
      .replace(/\\u002F/g, "/")
      .replace("://reddit.com", "://www.reddit.com")
      .replace("://old.reddit.com", "://www.reddit.com")
      .replace("://new.reddit.com", "://www.reddit.com");
    const u = new URL(cleaned);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    if (host !== "reddit.com" && !host.endsWith(".reddit.com")) return null;
    const m = u.pathname.match(
      /^\/r\/([^/]+)\/comments\/([a-z0-9]+)(?:\/([^/]*))?/i,
    );
    if (!m) return null;
    if (m[3] === "comment") return null;
    const slug = m[3] && m[3] !== "comment" ? m[3] : "";
    const pathPart = slug
      ? `/r/${m[1]}/comments/${m[2]}/${slug}/`
      : `/r/${m[1]}/comments/${m[2]}/`;
    return `https://www.reddit.com${pathPart}`;
  } catch {
    return null;
  }
}

function extractUrlsFromText(text: string): string[] {
  const out: string[] = [];
  const re =
    /https?:\/\/(?:www\.|old\.|new\.)?reddit\.com\/r\/[^/\s)"']+\/comments\/[a-z0-9]+[^\s)"']*/gi;
  for (const m of text.match(re) || []) {
    const u = ensureRedditThreadUrl(m.replace(/[.,;:]+$/, ""));
    if (u) out.push(u);
  }
  return out;
}

function parseJsonArray(text: string): unknown[] {
  const trimmed = text.trim();
  try {
    const v = JSON.parse(trimmed);
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (Array.isArray(o.threads)) return o.threads;
      if (Array.isArray(o.results)) return o.results;
    }
  } catch {
    /* fall through */
  }
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try {
      const v = JSON.parse(trimmed.slice(start, end + 1));
      if (Array.isArray(v)) return v;
    } catch {
      /* ignore */
    }
  }
  return [];
}

function groqKey(): string {
  loadGroqKeys();
  const key =
    process.env.GROQ_API_KEY_1?.trim() ||
    process.env.GROQ_API_KEY?.trim() ||
    "";
  if (!key) throw new Error("GROQ_API_KEY_1 (or GROQ_API_KEY) required");
  return key;
}

interface GroqCompoundRaw {
  choices?: Array<{ message?: { content?: string } }>;
  executed_tools?: Array<{
    arguments?: string;
    output?: string | unknown;
    search_results?: Array<{ url?: string; title?: string; content?: string }>;
    results?: Array<{ url?: string; title?: string; snippet?: string }>;
  }>;
}

async function compoundSearchOnce(opts: {
  prompt: string;
  model: string;
}): Promise<{
  text: string;
  toolUrls: Array<{ url: string; title: string; selftext: string }>;
}> {
  const timeoutMs = envInt("GROQ_COMPOUND_TIMEOUT_MS", 90_000);
  const body = {
    model: opts.model,
    temperature: 0.1,
    messages: [
      {
        role: "system" as const,
        content:
          "Find real Reddit thread URLs via web_search. Reply with compact JSON only. Never invent links.",
      },
      { role: "user" as const, content: opts.prompt },
    ],
    compound_custom: {
      tools: {
        enabled_tools: ["web_search"],
      },
    },
  };

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${groqKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`Groq compound ${res.status}: ${rawText.slice(0, 400)}`);
  }

  const json = JSON.parse(rawText) as GroqCompoundRaw;
  const text = json.choices?.[0]?.message?.content || "";
  const toolUrls: Array<{ url: string; title: string; selftext: string }> = [];
  const seen = new Set<string>();
  const push = (urlRaw: string, title = "", selftext = "") => {
    const url = ensureRedditThreadUrl(urlRaw);
    if (!url || seen.has(url)) return;
    seen.add(url);
    toolUrls.push({ url, title, selftext });
  };

  for (const tool of json.executed_tools || []) {
    const blob =
      typeof tool.output === "string"
        ? tool.output
        : tool.output
          ? JSON.stringify(tool.output)
          : "";
    for (const u of extractUrlsFromText(`${tool.arguments || ""}\n${blob}`)) {
      push(u);
    }
    for (const r of [
      ...(tool.search_results || []),
      ...(tool.results || []),
    ]) {
      if (!r.url) continue;
      const extra = r as {
        content?: string;
        snippet?: string;
        title?: string;
      };
      push(r.url, extra.title || r.title || "", extra.content || extra.snippet || "");
    }
  }
  for (const u of extractUrlsFromText(text)) push(u);

  return { text, toolUrls };
}

function hitsFromResponse(
  text: string,
  toolUrls: Array<{ url: string; title: string; selftext: string }>,
  subHint?: string,
): CompoundDiscoverHit[] {
  const out: CompoundDiscoverHit[] = [];
  const seen = new Set<string>();
  const add = (hit: CompoundDiscoverHit) => {
    const url = ensureRedditThreadUrl(hit.url);
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({
      url,
      title: (hit.title || "").trim() || "(untitled)",
      selftext: (hit.selftext || hit.why || "").trim(),
      subreddit: (hit.subreddit || subHint || "").replace(/^r\//i, "") || undefined,
      why: hit.why,
    });
  };

  for (const row of parseJsonArray(text)) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    add({
      url: String(o.url || o.permalink || o.link || ""),
      title: String(o.title || ""),
      selftext: String(o.selftext || o.excerpt || o.snippet || o.why || ""),
      subreddit: o.subreddit ? String(o.subreddit) : subHint,
      why: o.why ? String(o.why) : undefined,
    });
  }
  for (const t of toolUrls) add(t);
  return out;
}

/**
 * Find popular Reddit threads for a product via Groq Compound web search.
 * Searches every target subreddit, then round-robins so results aren't all from one sub.
 */
export async function discoverRedditThreadsViaCompound(
  product: ProductConfig,
): Promise<CompoundDiscoverHit[]> {
  const totalLimit = envInt("COMPOUND_REDDIT_LIMIT", 10);
  const model = envOr("GROQ_COMPOUND_MODEL", "groq/compound-mini");
  const kws =
    (product.keywords || []).slice(0, 5).join(" OR ") ||
    product.one_liner ||
    product.product_name;
  const subs = (product.subreddits || [])
    .map((s) => s.replace(/^r\//i, ""))
    .filter(Boolean)
    .slice(0, envInt("REDDIT_MAX_SUBS", 5));

  const targets = subs.length ? subs : ["nocode"];
  // At least 1 per sub; don't ask Compound for more than needed overall
  const perSub = Math.max(
    1,
    Math.min(
      envInt("COMPOUND_REDDIT_PER_SUB", 3),
      Math.ceil(totalLimit / targets.length),
    ),
  );
  const gapMs = envInt("COMPOUND_SUB_GAP_MS", 2500);

  log.info("compound reddit discovery start", {
    product: product.product_name,
    model,
    targets,
    perSub,
    totalLimit,
  });

  const bySub = new Map<string, CompoundDiscoverHit[]>();
  for (const sub of targets) bySub.set(sub, []);

  for (let i = 0; i < targets.length; i++) {
    const sub = targets[i]!;
    const prompt = `Search the web for ${perSub} popular Reddit posts in r/${sub} about: ${kws}.

Use web_search with query:
site:reddit.com/r/${sub} (looking for OR recommend OR alternative OR "how do I" OR "does anyone") ${product.product_name}

Return ONLY JSON:
{"threads":[{"url":"https://www.reddit.com/r/${sub}/comments/.../...","title":"...","selftext":"short why","subreddit":"${sub}"}]}

Only include real /comments/ URLs from r/${sub}. Max ${perSub} items.`;

    try {
      const { text, toolUrls } = await compoundSearchOnce({ prompt, model });
      const hits = hitsFromResponse(text, toolUrls, sub).filter((h) => {
        // Keep only URLs that actually belong to this sub when possible
        const m = h.url.match(/reddit\.com\/r\/([^/]+)/i);
        if (!m) return false;
        return m[1]!.toLowerCase() === sub.toLowerCase();
      });
      bySub.set(sub, hits.slice(0, perSub));
      log.info("compound sub search", {
        sub,
        hits: hits.length,
        kept: bySub.get(sub)!.length,
      });
    } catch (err) {
      log.warn("compound sub search failed", {
        sub,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (i < targets.length - 1 && gapMs > 0) {
      await new Promise((r) => setTimeout(r, gapMs));
    }
  }

  // Round-robin across subs so one community can't monopolize the budget
  const out: CompoundDiscoverHit[] = [];
  const seen = new Set<string>();
  const queues = targets.map((sub) => [...(bySub.get(sub) || [])]);
  let added = true;
  while (out.length < totalLimit && added) {
    added = false;
    for (const q of queues) {
      if (out.length >= totalLimit) break;
      while (q.length) {
        const h = q.shift()!;
        if (seen.has(h.url)) continue;
        seen.add(h.url);
        out.push(h);
        added = true;
        break;
      }
    }
  }

  // Global fallback if every sub failed
  if (!out.length) {
    const prompt = `Find ${Math.min(5, totalLimit)} real Reddit threads (site:reddit.com) about: ${kws}.
Prefer "looking for" / recommend / alternative posts across different subreddits.
Return ONLY JSON {"threads":[{"url":"https://www.reddit.com/r/.../comments/.../","title":"...","selftext":"...","subreddit":"..."}]}`;
    try {
      const { text, toolUrls } = await compoundSearchOnce({ prompt, model });
      for (const h of hitsFromResponse(text, toolUrls)) {
        if (seen.has(h.url)) continue;
        seen.add(h.url);
        out.push(h);
        if (out.length >= totalLimit) break;
      }
    } catch (err) {
      log.warn("compound global search failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const subCounts: Record<string, number> = {};
  for (const h of out) {
    const sub =
      h.subreddit ||
      h.url.match(/reddit\.com\/r\/([^/]+)/i)?.[1] ||
      "?";
    subCounts[sub] = (subCounts[sub] || 0) + 1;
  }
  log.info("compound reddit discovery done", {
    threads: out.length,
    bySub: subCounts,
  });
  return out.slice(0, totalLimit);
}
