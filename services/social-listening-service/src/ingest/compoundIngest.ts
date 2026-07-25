/**
 * Ingest path: Groq Compound discovers threads → Playwright fetches .json content.
 * No Apify / ReddAPI required for the happy path.
 */
import fs from "node:fs";
import path from "node:path";
import { envInt, projectRoot } from "../config.js";
import { createLogger } from "../log.js";
import type { NormalizedEvent, ProductConfig } from "../types.js";
import { discoverRedditThreadsViaCompound } from "./compoundReddit.js";
import {
  canFetchRedditViaPlaywright,
  fetchRedditThreadsViaPlaywright,
} from "./playwrightContent.js";

const log = createLogger("ingest.compound.pipeline");
const root = projectRoot();

const ASKISH =
  /looking for|recommend|how do (you|i)|any (tool|app|software|alternative)|what do you use|is there a|alternative to|does anyone|has anyone|best way to|struggle|pain point|need a way/i;

function matchesKeywords(text: string, keywords: string[]): boolean {
  if (!keywords.length) return true;
  const hay = text.toLowerCase();
  return keywords.some((k) => k && hay.includes(k.toLowerCase()));
}

export function canIngestViaCompound(): boolean {
  // Compound needs Groq keys; content fetch needs Playwright profile
  const hasGroq = Boolean(
    process.env.GROQ_API_KEY_1?.trim() || process.env.GROQ_API_KEY?.trim(),
  );
  return hasGroq && canFetchRedditViaPlaywright();
}

export async function ingestRedditViaCompound(
  product: ProductConfig,
): Promise<NormalizedEvent[]> {
  if (!canIngestViaCompound()) {
    log.warn(
      "compound ingest unavailable — need GROQ_API_KEY_* + npm run reddit:session",
    );
    return [];
  }

  const hits = await discoverRedditThreadsViaCompound(product);
  if (!hits.length) {
    log.warn("compound discovery returned 0 threads");
    return [];
  }

  // Persist for debugging / reuse (same shape as discover script)
  const outFile = path.join(root, "scripts", "discovered-threads.json");
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      hits.map((h) => ({
        url: h.url,
        title: h.title,
        selftext: h.selftext,
        ...(h.subreddit ? { subreddit: h.subreddit } : {}),
        ...(h.why ? { why: h.why } : {}),
      })),
      null,
      2,
    ),
  );
  log.info("saved discovered threads", { path: outFile, n: hits.length });

  const ranked = [...hits].sort((a, b) => {
    const score = (x: { title: string; selftext: string }) =>
      (ASKISH.test(`${x.title}\n${x.selftext}`) ? 2 : 0) +
      (matchesKeywords(`${x.title}\n${x.selftext}`, product.keywords) ? 1 : 0);
    return score(b) - score(a);
  });

  const maxThreads = envInt(
    "COMPOUND_REDDIT_LIMIT",
    envInt("REDDIT_POSTS_PER_SUB", 8),
  );
  const urls = ranked.slice(0, maxThreads).map((h) => h.url);

  const events = await fetchRedditThreadsViaPlaywright(urls, {
    maxCommentsPerThread: envInt("REDDIT_COMMENTS_PER_POST", 12),
  });

  // Light keyword filter on comments (keep all posts)
  const filtered = events.filter((e) => {
    if (e.external_id.startsWith("post_")) return true;
    if (ASKISH.test(e.body)) return true;
    if (!product.keywords.length) return true;
    return matchesKeywords(`${e.title}\n${e.body}`, product.keywords);
  });

  log.info("compound ingest done", {
    discovered: hits.length,
    fetchedUrls: urls.length,
    events: filtered.length,
  });
  return filtered;
}
