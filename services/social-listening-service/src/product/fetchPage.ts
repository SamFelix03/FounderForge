import { fetchPageJina } from "@founderforge/connectors";
import {
  ProductUrlError,
  productUrlErrorFromFetchFailure,
} from "@founderforge/schemas";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MIN_PAGE_CHARS = 200;

/** Strip HTML/scripts to plain text for chunking. */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<\/div>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"');
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ");
  return s.trim();
}

export async function fetchPageText(
  url: string,
  timeoutMs = 25_000,
): Promise<{ url: string; text: string; bytes: number }> {
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent":
          "SociallisteningForge/0.1 (+https://github.com/local; product research)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
  } catch (err) {
    throw productUrlErrorFromFetchFailure(url, err);
  }
  if (!res.ok) {
    throw new ProductUrlError(
      "product_url_http_error",
      `Failed to fetch ${url}: HTTP ${res.status}`,
    );
  }
  const html = await res.text();
  const text = htmlToText(html);
  return { url: res.url || url, text, bytes: html.length };
}

/** Overlapping character chunks — keeps each LLM call under size limits. */
export function chunkText(
  text: string,
  chunkSize = 2800,
  overlap = 200,
): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= chunkSize) return [clean];

  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    const end = Math.min(i + chunkSize, clean.length);
    chunks.push(clean.slice(i, end));
    if (end >= clean.length) break;
    i = end - overlap;
  }
  return chunks;
}

/**
 * Fetch homepage (+ light related paths). Additive: if raw HTML yields no
 * readable pages, try Jina Reader once on the homepage before failing.
 */
export async function fetchSiteCorpus(homeUrl: string): Promise<{
  pages: Array<{ url: string; text: string }>;
  combined: string;
}> {
  const home = new URL(homeUrl);
  const candidates = [
    home.toString(),
    new URL("/about", home).toString(),
    new URL("/product", home).toString(),
    new URL("/pricing", home).toString(),
  ];

  const pages: Array<{ url: string; text: string }> = [];
  const seen = new Set<string>();
  let lastFetchError: unknown;

  for (const u of candidates) {
    const key = u.replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const page = await fetchPageText(u);
      if (page.text.length < MIN_PAGE_CHARS) continue;
      pages.push({ url: page.url, text: page.text.slice(0, 40_000) });
      await sleep(300);
    } catch (err) {
      lastFetchError = err;
      // skip missing paths
    }
    if (pages.length >= 3) break;
  }

  if (!pages.length) {
    try {
      const jina = await fetchPageJina({ url: home.toString() });
      const text = jina.data.text.replace(/\s+/g, " ").trim();
      if (text.length >= MIN_PAGE_CHARS) {
        pages.push({
          url: jina.data.url || home.toString(),
          text: text.slice(0, 40_000),
        });
      }
    } catch (err) {
      lastFetchError = err;
    }
  }

  if (!pages.length) {
    if (lastFetchError instanceof ProductUrlError) throw lastFetchError;
    if (lastFetchError) throw productUrlErrorFromFetchFailure(homeUrl, lastFetchError);
    throw new ProductUrlError(
      "product_url_no_content",
      `Could not extract readable product content from ${homeUrl}. The site returned empty/short HTML (common for SPAs or dead pages). Provide a scrapeable marketing URL or include product_name as a fallback.`,
    );
  }

  const combined = pages
    .map((p) => `--- PAGE ${p.url} ---\n${p.text}`)
    .join("\n\n");

  return { pages, combined };
}
