/**
 * Ingest: product → need statement → Tavily Reddit threads → NormalizedEvent[].
 * No scoring — Tavily results are treated as the shortlist.
 */
import fs from "node:fs";
import path from "node:path";
import { envInt, envOr, projectRoot } from "../config.js";
import { createLogger } from "../log.js";
import { generateNeedStatement } from "../product/needStatement.js";
import type { NormalizedEvent, ProductConfig } from "../types.js";
import { makeEvent } from "./normalize.js";
import {
  canFetchRedditViaPlaywright,
  fetchRedditThreadsViaPlaywright,
} from "./playwrightContent.js";
import {
  discoverRedditThreadsViaTavily,
  type TavilyDiscoverHit,
} from "./tavilyReddit.js";

const log = createLogger("ingest.tavily.pipeline");

export function canIngestViaTavily(): boolean {
  return Boolean(process.env.TAVILY_API_KEY?.trim());
}

function postIdFromUrl(url: string): string {
  const m = url.match(/\/comments\/([a-z0-9]+)/i);
  return m?.[1] || Buffer.from(url).toString("base64url").slice(0, 12);
}

function hitsToEvents(hits: TavilyDiscoverHit[]): NormalizedEvent[] {
  return hits.map((h) => {
    const id = postIdFromUrl(h.url);
    const sub = (h.subreddit || h.url.match(/\/r\/([^/]+)/i)?.[1] || "").replace(
      /^r\//i,
      "",
    );
    return makeEvent({
      platform: "reddit",
      external_id: `post_${id}`,
      community: sub || null,
      title: h.title,
      body: h.selftext,
      author: "[tavily]",
      permalink: h.url,
      thread_context: [sub ? `r/${sub}` : "", h.why || ""].filter(Boolean).join("\n"),
    });
  });
}

async function discoverHits(
  need: string,
  maxThreads: number,
): Promise<TavilyDiscoverHit[]> {
  // Research-only — no Search fallback (Search returns noisy launch threads).
  const mode = envOr("TAVILY_REDDIT_MODE", "research").toLowerCase();
  if (mode !== "research") {
    throw new Error(
      `TAVILY_REDDIT_MODE=${mode} is not supported. Set TAVILY_REDDIT_MODE=research.`,
    );
  }

  const { hits } = await discoverRedditThreadsViaTavily({
    needStatement: need,
    maxThreads,
  });
  return hits;
}

export async function ingestRedditViaTavily(
  product: ProductConfig,
): Promise<NormalizedEvent[]> {
  if (!canIngestViaTavily()) {
    log.warn("tavily ingest unavailable — TAVILY_API_KEY missing");
    return [];
  }

  const maxThreads = Math.min(
    envInt("TAVILY_REDDIT_LIMIT", 10),
    Math.max(1, product.max_posts_per_cycle),
  );

  const need = await generateNeedStatement(product);
  log.info("tavily need statement", { need: need.slice(0, 240) });

  const hits = await discoverHits(need, maxThreads);
  if (!hits.length) {
    log.warn("tavily discovery returned 0 threads");
    return [];
  }

  const outFile = path.join(projectRoot(), "scripts", "tavily-discovered-threads.json");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
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
  log.info("saved tavily threads", { path: outFile, n: hits.length });

  // Prefer live thread bodies when a Reddit session exists; else use Tavily snippets
  if (canFetchRedditViaPlaywright()) {
    try {
      const urls = hits.map((h) => h.url);
      const fetched = await fetchRedditThreadsViaPlaywright(urls, {
        maxCommentsPerThread: 0,
      });
      const posts = fetched.filter((e) => e.external_id.startsWith("post_"));
      if (posts.length) {
        log.info("tavily ingest done (playwright content)", {
          discovered: hits.length,
          events: posts.length,
        });
        return posts.slice(0, maxThreads);
      }
    } catch (err) {
      log.warn("playwright content fetch failed — using tavily snippets", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const events = hitsToEvents(hits).slice(0, maxThreads);
  log.info("tavily ingest done (snippets)", {
    discovered: hits.length,
    events: events.length,
  });
  return events;
}
