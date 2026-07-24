import { createLogger } from "@founderforge/observability";

const log = createLogger("connectors");

export interface ConnectorCallMeta {
  vendor: string;
  operation: string;
  cost_usd: number;
}

export interface ConnectorResult<T> {
  data: T;
  meta: ConnectorCallMeta;
}

export interface FetchPageInput {
  url: string;
  /** Explicit test-only override. Production never sets this. */
  stub?: boolean;
}

export interface FetchPageResult {
  url: string;
  title: string;
  text: string;
  html_excerpt?: string;
  fetched_at: string;
}

export interface SearchQueryInput {
  query: string;
  /** Explicit test-only override. Production never sets this. */
  stub?: boolean;
  num?: number;
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 120 * (i + 1)));
    }
  }
  throw lastError;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string, fallback: string): string {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return titleMatch?.[1]?.replace(/\s+/g, " ").trim() || fallback;
}

function testFixturePage(url: string): ConnectorResult<FetchPageResult> {
  const isAggregator = /g2\.com|capterra\.com/i.test(url);
  const isPricing = /pricing|plans/i.test(url);
  let text: string;
  if (isAggregator) {
    text = `# Comparison — Product vs Competitors (fixture)

| Feature | Product | Coda | ClickUp | Airtable |
| --- | --- | --- | --- | --- |
| SSO / SAML | Yes | Yes | Yes | Partial |
| API access | Yes | Yes | Yes | Yes |
| Webhooks | Yes | Yes | Yes | Yes |
| Mobile apps | Yes | Yes | Yes | Yes |
| Offline mode | Partial | No | Partial | No |
| Integrations marketplace | Yes | Yes | Yes | Yes |
| Admin / permissions | Yes | Yes | Yes | Yes |
| Audit logs | Yes | Partial | Yes | Partial |

## Pricing (public)
- Product: Free, Plus $10/user/mo, Business $18/user/mo, Enterprise contact sales
- Coda: Free, Pro $10/doc maker/mo, Team $30/doc maker/mo
- ClickUp: Free, Unlimited $7/user/mo, Business $12/user/mo, Enterprise custom
- Airtable: Free, Team $20/seat/mo, Business $45/seat/mo, Enterprise custom

Pricing model: freemium / per-seat for most vendors.
Source: ${url}`;
  } else if (isPricing) {
    text = `# Pricing

| Plan | Price | Period |
| --- | --- | --- |
| Free | $0 | — |
| Pro | $12 / user | month |
| Business | $24 / user | month |
| Enterprise | Contact sales | custom |

Pricing model: freemium per-seat. Starting at $12/user/mo.
URL: ${url}`;
  } else {
    text = `# Product overview

Features include SSO (SAML/Okta), API access, webhooks, mobile apps (iOS/Android),
offline mode, integrations marketplace, admin / permissions (RBAC), and audit logs.

## Platform
- Single sign-on and role-based access control
- REST API and webhooks for automation
- Native mobile apps with offline editing
- Integrations marketplace with 100+ apps
- Admin console, permissions, and audit logs

Pricing starts at $12/user/mo. Enterprise contact sales.
URL: ${url}`;
  }

  return {
    data: {
      url,
      title: `Test fixture for ${url}`,
      text,
      fetched_at: new Date().toISOString(),
    },
    meta: { vendor: "test-fixture", operation: "fetchPage", cost_usd: 0 },
  };
}

function testFixtureSearch(query: string): ConnectorResult<SearchHit[]> {
  const q = query.toLowerCase();
  if (/g2\.com|capterra\.com/i.test(q)) {
    return {
      data: [
        {
          title: "Product vs competitors — G2 comparison",
          url: "https://www.g2.com/compare/product-vs-competitors",
          snippet: `G2 feature and pricing comparison for ${query}`,
        },
        {
          title: "Product alternatives — Capterra",
          url: "https://www.capterra.com/p/product/alternatives",
          snippet: `Capterra alternatives and pricing for ${query}`,
        },
      ],
      meta: { vendor: "test-fixture", operation: "webSearch", cost_usd: 0 },
    };
  }
  return {
    data: [
      {
        title: "Coda — Notion alternative",
        url: "https://coda.io",
        snippet: `Alternative to query: ${query}`,
      },
      {
        title: "ClickUp vs product comparison",
        url: "https://clickup.com",
        snippet: `Comparison page for ${q}`,
      },
      {
        title: "Airtable",
        url: "https://www.airtable.com",
        snippet: "Similar workspace / docs product in the same category",
      },
      {
        title: "Confluence by Atlassian",
        url: "https://www.atlassian.com/software/confluence",
        snippet: "Enterprise wiki and knowledge base competitor",
      },
      {
        title: "Obsidian",
        url: "https://obsidian.md",
        snippet: "Local-first notes alternative often compared in search",
      },
    ],
    meta: { vendor: "test-fixture", operation: "webSearch", cost_usd: 0 },
  };
}

/** HTTP page fetch (raw HTML strip). Prefer fetchPageJina for structured markdown. */
export async function fetchPage(input: FetchPageInput): Promise<ConnectorResult<FetchPageResult>> {
  if (input.stub === true) return testFixturePage(input.url);

  const data = await withRetry(async () => {
    const res = await fetch(input.url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; FounderForgeBot/1.0; +https://founderforge.local)",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`fetch ${input.url} failed: ${res.status}`);
    const html = await res.text();
    return {
      url: input.url,
      title: extractTitle(html, input.url),
      text: stripHtml(html).slice(0, 20_000),
      html_excerpt: html.slice(0, 50_000),
      fetched_at: new Date().toISOString(),
    };
  });

  return {
    data,
    meta: {
      vendor: "http-fetch",
      operation: "fetchPage",
      cost_usd: 0.001,
    },
  };
}

function extractJinaTitle(markdown: string, fallback: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m);
  if (heading?.[1]) return heading[1].trim();
  const titleLine = markdown.match(/^Title:\s*(.+)$/im);
  if (titleLine?.[1]) return titleLine[1].trim();
  return fallback;
}

interface JinaReaderJson {
  code?: number;
  status?: number;
  data?: {
    title?: string;
    description?: string;
    url?: string;
    content?: string;
    text?: string;
    warning?: string;
  };
  message?: string;
}

type JinaEngine = "browser" | "direct" | "cf-browser-rendering";

function jinaApiKey(): string | undefined {
  // Get your Jina AI API key for free: https://jina.ai/?sui=apikey
  const key = process.env.JINA_API_KEY?.trim();
  return key || undefined;
}

function isBogusJinaContent(markdown: string): boolean {
  const t = markdown.trim();
  if (t.length < 80) return true;
  if (/^loading[.…]*$/i.test(t)) return true;
  if (/please enable js|disable any ad blocker|enable javascript/i.test(t)) return true;
  if (/^just a moment/i.test(t)) return true;
  if (/cf-browser-rendering|access denied|captcha/i.test(t) && t.length < 200) return true;
  return false;
}

async function callJinaReader(
  url: string,
  opts: {
    engine?: JinaEngine;
    timeoutSec?: number;
    noCache?: boolean;
    withIframe?: boolean;
  },
): Promise<{ title: string; text: string; url: string; warning?: string }> {
  const apiKey = jinaApiKey();
  if (!apiKey) {
    throw new Error(
      "JINA_API_KEY missing (get a free key: https://jina.ai/?sui=apikey)",
    );
  }

  const engine = opts.engine ?? "browser";
  const timeoutSec = opts.timeoutSec ?? 45;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Return-Format": "markdown",
    "X-Engine": engine,
    "X-Timeout": String(timeoutSec),
    "X-Retain-Images": "none",
  };
  if (opts.noCache) headers["X-No-Cache"] = "true";
  if (opts.withIframe) headers["X-With-Iframe"] = "true";

  const res = await fetch("https://r.jina.ai/", {
    method: "POST",
    headers,
    body: JSON.stringify({ url }),
    redirect: "follow",
    signal: AbortSignal.timeout((timeoutSec + 20) * 1000),
  });

  const raw = await res.text();
  if (!res.ok) {
    const snippet = raw.slice(0, 240).replace(/\s+/g, " ");
    throw new Error(`jina ${res.status}${snippet ? `: ${snippet}` : ""}`);
  }

  let markdown = "";
  let title = url;
  let warning: string | undefined;
  try {
    const json = JSON.parse(raw) as JinaReaderJson;
    markdown = (json.data?.content ?? json.data?.text ?? "").trim();
    title = json.data?.title?.trim() || extractJinaTitle(markdown, url);
    warning = json.data?.warning;
    if (!markdown && typeof (json as { data?: unknown }).data === "string") {
      markdown = String((json as { data: string }).data).trim();
    }
    // Prefer description when content is a JS shell but description has useful copy
    if (isBogusJinaContent(markdown) && json.data?.description && json.data.description.length > 80) {
      markdown = `# ${title}\n\n${json.data.description}\n\n${markdown}`.trim();
    }
  } catch {
    markdown = raw.trim();
    title = extractJinaTitle(markdown, url);
  }

  if (isBogusJinaContent(markdown)) {
    throw new Error(
      `jina empty/short content${warning ? ` (${warning.slice(0, 120)})` : ""}`,
    );
  }

  return {
    url,
    title,
    text: markdown.slice(0, 40_000),
    warning,
  };
}

/**
 * Fetch a page via Jina Reader API (POST https://r.jina.ai/).
 * Returns clean markdown with tables/lists preserved.
 * Requires JINA_API_KEY. Falls back to plain fetchPage on failure.
 *
 * Get your Jina AI API key for free: https://jina.ai/?sui=apikey
 */
export async function fetchPageJina(
  input: FetchPageInput,
): Promise<ConnectorResult<FetchPageResult>> {
  if (input.stub === true) return testFixturePage(input.url);

  if (!jinaApiKey()) {
    log.warn("JINA_API_KEY missing; using http-fetch fallback", { url: input.url });
    return fetchPage(input);
  }

  const attempts: Array<{
    engine: JinaEngine;
    timeoutSec: number;
    noCache?: boolean;
    withIframe?: boolean;
  }> = [
    { engine: "browser", timeoutSec: 40 },
    { engine: "browser", timeoutSec: 50, noCache: true },
  ];
  // JS-heavy review sites — one extra engine only (G2 often CAPTCHA-blocks all engines)
  if (/(capterra\.com|getapp\.com|softwareadvice\.com)/i.test(input.url)) {
    attempts.push({
      engine: "cf-browser-rendering",
      timeoutSec: 55,
      noCache: true,
      withIframe: true,
    });
  } else if (!/g2\.com/i.test(input.url)) {
    attempts.push({ engine: "direct", timeoutSec: 25, noCache: true });
  }

  const errors: string[] = [];
  try {
    for (const attempt of attempts) {
      try {
        const data = await callJinaReader(input.url, attempt);
        return {
          data: {
            url: data.url,
            title: data.title,
            text: data.text,
            fetched_at: new Date().toISOString(),
          },
          meta: {
            vendor: "jina-reader",
            operation: "fetchPageJina",
            cost_usd: 0,
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${attempt.engine}:${msg}`);
        // Don't burn more engines on auth / CAPTCHA walls
        if (/jina 401|jina 403|CAPTCHA|captcha/i.test(msg)) break;
      }
    }
    throw new Error(errors.join(" | ") || "jina failed");
  } catch (err) {
    log.warn("jina reader failed; falling back to http-fetch", {
      url: input.url,
      error: err instanceof Error ? err.message : String(err),
    });
    return fetchPage(input);
  }
}

async function searchSerper(query: string, num: number): Promise<SearchHit[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error("SERPER_API_KEY missing");
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, num }),
  });
  if (!res.ok) throw new Error(`Serper ${res.status}`);
  const data = (await res.json()) as {
    organic?: Array<{ title?: string; link?: string; snippet?: string }>;
  };
  return (data.organic ?? [])
    .filter((r) => r.link && r.title)
    .map((r) => ({
      title: r.title!,
      url: r.link!,
      snippet: r.snippet ?? "",
    }));
}

async function searchBrave(query: string, num: number): Promise<SearchHit[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) throw new Error("BRAVE_SEARCH_API_KEY missing");
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(num));
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": key,
    },
  });
  if (!res.ok) throw new Error(`Brave ${res.status}`);
  const data = (await res.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };
  return (data.web?.results ?? [])
    .filter((r) => r.url && r.title)
    .map((r) => ({
      title: r.title!,
      url: r.url!,
      snippet: r.description ?? "",
    }));
}

/** Failover provider — DuckDuckGo HTML results. */
async function searchDuckDuckGo(query: string, num: number): Promise<SearchHit[]> {
  const url = new URL("https://html.duckduckgo.com/html/");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "Mozilla/5.0 (compatible; FounderForgeBot/1.0)",
    },
    body: new URLSearchParams({ q: query }).toString(),
  });
  if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`);
  const html = await res.text();
  const hits: SearchHit[] = [];
  const re =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div)>)?/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && hits.length < num) {
    const href = match[1] ?? "";
    const title = stripHtml(match[2] ?? "");
    const snippet = stripHtml(match[3] ?? "");
    let finalUrl = href;
    try {
      const u = new URL(href, "https://duckduckgo.com");
      const uddg = u.searchParams.get("uddg");
      if (uddg) finalUrl = decodeURIComponent(uddg);
    } catch {
      /* keep href */
    }
    if (!finalUrl.startsWith("http")) continue;
    hits.push({ title, url: finalUrl, snippet });
  }
  return hits;
}

/**
 * Production web search with provider failover:
 * 1) Serper  2) Brave Search API  3) DuckDuckGo HTML
 */
export async function webSearch(
  input: SearchQueryInput,
): Promise<ConnectorResult<SearchHit[]>> {
  const num = input.num ?? 8;
  if (input.stub === true) return testFixtureSearch(input.query);

  const errors: string[] = [];

  if (process.env.SERPER_API_KEY) {
    try {
      const data = await withRetry(() => searchSerper(input.query, num));
      return {
        data,
        meta: { vendor: "serper", operation: "webSearch", cost_usd: 0.002 },
      };
    } catch (err) {
      errors.push(`serper:${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (process.env.BRAVE_SEARCH_API_KEY) {
    try {
      const data = await withRetry(() => searchBrave(input.query, num));
      return {
        data,
        meta: { vendor: "brave", operation: "webSearch", cost_usd: 0.003 },
      };
    } catch (err) {
      errors.push(`brave:${err instanceof Error ? err.message : String(err)}`);
    }
  }

  try {
    const data = await withRetry(() => searchDuckDuckGo(input.query, num));
    if (data.length === 0) throw new Error("no ddg results");
    return {
      data,
      meta: { vendor: "duckduckgo", operation: "webSearch", cost_usd: 0 },
    };
  } catch (err) {
    errors.push(`duckduckgo:${err instanceof Error ? err.message : String(err)}`);
  }

  log.error("all search providers failed", { errors });
  throw new Error(`webSearch failed: ${errors.join("; ") || "no providers available"}`);
}
