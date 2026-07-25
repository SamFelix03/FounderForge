import { Firecrawl } from "firecrawl";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { createLogger } from "@founderforge/observability";
import { isTransientNetworkError, withRetries } from "./retry.js";
import type { RuntimeConfig, SelectedPage } from "./types.js";
import { truncate } from "./util.js";

const log = createLogger("promo.discover");

const IMPORTANT_PATTERNS = [
  /^https?:\/\/[^/]+\/?$/i,
  /\/pricing\/?$/i,
  /\/product(s)?\/?$/i,
  /\/features?\/?$/i,
  /\/about\/?$/i,
  /\/docs?\/?$/i,
  /\/login\/?$/i,
  /\/signup|sign-up|register\/?$/i,
  /\/contact\/?$/i,
  /\/demo\/?$/i,
  /\/solutions?\/?$/i,
  /\/how-it-works\/?$/i,
  /\/use-cases?\/?$/i,
  /\/google-forms-alternative\/?$/i,
];

const SKIP_PATTERNS = [
  /\/(blog|news|careers|jobs|legal|privacy|terms|cookie|cookies|cdn-cgi)\b/i,
  /\/(tag|tags|category|categories|author|page)\/\d+/i,
  /\.(pdf|zip|xml|json|css|js)(\?|$)/i,
  /#/,
];

const SelectedPagesSchema = z.object({
  pages: z
    .array(
      z.object({
        url: z.string().url(),
        reason: z.string().min(1),
      }),
    )
    .min(1),
});

const SELECTED_JSON_SCHEMA = {
  type: "object",
  properties: {
    pages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          url: { type: "string" },
          reason: { type: "string" },
        },
        required: ["url", "reason"],
      },
    },
  },
  required: ["pages"],
};

function extractLinks(mapResult: unknown): string[] {
  if (!mapResult || typeof mapResult !== "object") return [];
  const r = mapResult as { links?: unknown };
  if (Array.isArray(r.links)) {
    return r.links
      .map((l) =>
        typeof l === "string"
          ? l
          : (l as { url?: string; href?: string })?.url ||
            (l as { href?: string })?.href,
      )
      .filter((x): x is string => Boolean(x));
  }
  if (Array.isArray(mapResult)) {
    return mapResult
      .map((l) =>
        typeof l === "string"
          ? l
          : (l as { url?: string; href?: string })?.url ||
            (l as { href?: string })?.href,
      )
      .filter((x): x is string => Boolean(x));
  }
  return [];
}

function heuristicFilter(urls: string[]): string[] {
  const kept = urls.filter((u) => {
    if (SKIP_PATTERNS.some((p) => p.test(u))) return false;
    return IMPORTANT_PATTERNS.some((p) => p.test(u));
  });
  return kept.length > 0 ? kept : urls;
}

function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    let u = String(raw).trim();
    if (!u) continue;
    try {
      const parsed = new URL(u);
      parsed.hash = "";
      u = parsed.toString().replace(/\/$/, "") || parsed.origin;
    } catch {
      continue;
    }
    const key = u.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

async function rankWithGemini(
  cfg: RuntimeConfig,
  urls: string[],
): Promise<SelectedPage[]> {
  const ai = new GoogleGenAI({ apiKey: cfg.geminiApiKey });
  const capped = urls.slice(0, 300);
  const prompt = `Here is a list of URLs from ${cfg.url}:
${JSON.stringify(capped)}

Select the ${cfg.maxPages} most important pages for someone to understand
this product (homepage, pricing, core product/feature pages,
signup/demo, docs entry point). Skip blog posts, legal pages,
paginated content, and duplicate/near-duplicate URLs.

Return JSON: { "pages": [ { "url": "...", "reason": "..." } ] }
Use only URLs from the list. Prefer the homepage first. Max ${cfg.maxPages} pages.`;

  log.info("ranking pages with Gemini", { model: cfg.textModel });

  let response;
  try {
    response = await ai.models.generateContent({
      model: cfg.textModel,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: SELECTED_JSON_SCHEMA,
      },
    });
  } catch {
    response = await ai.models.generateContent({
      model: cfg.textModel,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: SELECTED_JSON_SCHEMA,
      },
    });
  }

  const rawText = (response.text || "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`Page ranker returned non-JSON:\n${truncate(rawText, 500)}`);
  }

  const validated = SelectedPagesSchema.parse(parsed);
  const allowed = new Set(capped.map((u) => u.toLowerCase()));
  const pages = validated.pages
    .filter(
      (p) =>
        allowed.has(p.url.toLowerCase()) ||
        allowed.has(p.url.replace(/\/$/, "").toLowerCase()),
    )
    .slice(0, cfg.maxPages)
    .map((p) => ({ url: p.url, reason: p.reason.trim() }));

  if (pages.length === 0) {
    log.warn("Gemini returned no valid URLs — using fallback list");
    return capped.slice(0, cfg.maxPages).map((url, i) => ({
      url,
      reason:
        i === 0
          ? "Fallback: root/homepage candidate"
          : "Fallback: important URL candidate",
    }));
  }
  return pages;
}

function firecrawlClient(cfg: RuntimeConfig): Firecrawl {
  const opts: { apiKey: string; apiUrl?: string } = {
    apiKey: cfg.firecrawlApiKey,
  };
  if (cfg.firecrawlApiUrl) opts.apiUrl = cfg.firecrawlApiUrl;
  return new Firecrawl(opts);
}

export async function discoverImportantPages(
  cfg: RuntimeConfig,
): Promise<SelectedPage[]> {
  const app = firecrawlClient(cfg);

  log.info("Firecrawl map", { url: cfg.url });
  let mapResult: unknown;
  try {
    mapResult = await withRetries(() => app.map(cfg.url), {
      label: "Firecrawl map",
      attempts: 5,
      baseDelayMs: 1000,
    });
  } catch (err) {
    if (isTransientNetworkError(err)) {
      throw new Error(
        `Cannot reach Firecrawl API (DNS/network): ${err instanceof Error ? err.message : err}`,
      );
    }
    throw err;
  }

  let allUrls = dedupeUrls(extractLinks(mapResult));
  log.info("discovered URLs", { count: allUrls.length });

  if (allUrls.length === 0) allUrls = [cfg.url];

  const rootKey = cfg.url.replace(/\/$/, "").toLowerCase();
  if (!allUrls.some((u) => u.toLowerCase() === rootKey)) {
    allUrls.unshift(cfg.url);
  }

  let candidates = allUrls;
  if (allUrls.length > 300) {
    candidates = heuristicFilter(allUrls);
    if (candidates.length > 300) candidates = candidates.slice(0, 300);
    log.info("heuristic pre-filter applied", { candidates: candidates.length });
  }

  const pages = await rankWithGemini(cfg, candidates);
  log.info("selected pages", {
    count: pages.length,
    urls: pages.map((p) => p.url),
  });
  return pages;
}
