/**
 * Ingest: product → need statement → Tavily Reddit threads (+ suggested comments) → events.
 */
import fs from "node:fs";
import path from "node:path";
import { envInt, envOr, projectRoot } from "../config.js";
import { createLogger } from "../log.js";
import { generateNeedStatement } from "../product/needStatement.js";
import type { NormalizedEvent, ProductConfig } from "../types.js";
import { makeEvent } from "./normalize.js";
import {
  discoverRedditThreadsViaTavily,
  type TavilyDiscoverHit,
  type TavilyResearchMeta,
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
      suggested_reply: h.suggested_comment,
    });
  });
}

async function discoverHits(
  need: string,
  maxThreads: number,
  product: ProductConfig,
): Promise<{ hits: TavilyDiscoverHit[]; meta: TavilyResearchMeta }> {
  const mode = envOr("TAVILY_REDDIT_MODE", "research").toLowerCase();
  if (mode !== "research") {
    throw new Error(
      `TAVILY_REDDIT_MODE=${mode} is not supported. Set TAVILY_REDDIT_MODE=research.`,
    );
  }

  return discoverRedditThreadsViaTavily({
    needStatement: need,
    maxThreads,
    product: {
      name: product.product_name,
      oneLiner: product.one_liner,
    },
  });
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

  const { hits, meta } = await discoverHits(need, maxThreads, product);
  if (!hits.length) {
    log.warn("tavily discovery returned 0 threads");
    return [];
  }

  const scriptsDir = path.join(projectRoot(), "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(
    path.join(scriptsDir, "tavily-discovered-threads.json"),
    JSON.stringify(
      hits.map((h) => ({
        url: h.url,
        title: h.title,
        selftext: h.selftext,
        suggested_comment: h.suggested_comment,
        ...(h.subreddit ? { subreddit: h.subreddit } : {}),
        ...(h.why ? { why: h.why } : {}),
      })),
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(scriptsDir, "tavily-discovered-threads.raw.json"),
    JSON.stringify(meta, null, 2),
  );
  log.info("saved tavily threads", { n: hits.length, model: meta.model });

  const events = hitsToEvents(hits).slice(0, maxThreads);
  log.info("tavily ingest done", {
    discovered: hits.length,
    events: events.length,
    withComments: events.filter((e) => e.suggested_reply).length,
  });
  return events;
}

/** Tavily-only Reddit ingest. */
export const canIngestReddit = canIngestViaTavily;
export const ingestReddit = ingestRedditViaTavily;
