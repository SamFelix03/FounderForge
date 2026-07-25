import { envInt, envOr } from "../config.js";
import { createLogger } from "../log.js";
import type { NormalizedEvent, ProductConfig } from "../types.js";
import { makeEvent } from "./normalize.js";
import {
  canIngestViaCompound,
  ingestRedditViaCompound,
} from "./compoundIngest.js";
import {
  canUseReddApi,
  risingPosts,
  scrapePostComments,
  scrapeSubreddit,
} from "./reddapi.js";

const log = createLogger("ingest.reddit");

const ASKISH =
  /looking for|recommend|how do (you|i)|any (tool|app|software|alternative)|what do you use|is there a|alternative to|does anyone|has anyone|best way to|struggle|pain point|need a way/i;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** ReddAPI returns several listing shapes — flatten to post/comment objects. */
function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  const o = asRecord(v);
  if (!o) return [];

  // { success, posts: [...] }  or  { post_count, data: [...] }
  for (const key of ["posts", "data", "children", "results", "items", "comments"]) {
    if (Array.isArray(o[key])) return o[key] as unknown[];
  }

  if (o.data && typeof o.data === "object") {
    const d = o.data as Record<string, unknown>;
    if (Array.isArray(d.children)) {
      return d.children.map((c) => {
        const cr = asRecord(c);
        return cr?.data ?? c;
      });
    }
    if (Array.isArray(d.posts)) return d.posts;
    if (Array.isArray(d.data)) return d.data;
  }
  return [];
}

function str(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function field(data: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (data[k] !== undefined && data[k] !== null && data[k] !== "") {
      return data[k];
    }
  }
  return undefined;
}

function num(...vals: unknown[]): number {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) {
      return Number(v);
    }
  }
  return 0;
}

function ensureRedditUrl(p: string): string {
  if (!p) return "";
  const clean = p.split("?")[0]!;
  if (clean.startsWith("http")) {
    return clean.replace("://reddit.com", "://www.reddit.com");
  }
  if (clean.startsWith("/")) return `https://www.reddit.com${clean}`;
  return `https://www.reddit.com/${clean.replace(/^\//, "")}`;
}

function permalinkFrom(raw: Record<string, unknown>, subreddit: string): string {
  const p = str(
    field(raw, "permalink", "url", "link", "post_url", "postUrl", "PostUrl"),
  );
  if (p) return ensureRedditUrl(p);

  const id = str(field(raw, "id", "post_id", "postId", "PostId", "name")).replace(
    /^t3_/,
    "",
  );
  // Bare Reddit fullnames / short ids only — not titles
  if (id && /^[a-z0-9]{5,10}$/i.test(id)) {
    return `https://www.reddit.com/r/${subreddit}/comments/${id}/`;
  }
  return "";
}

function postIdFromPermalink(permalink: string): string {
  const m = permalink.match(/\/comments\/([a-z0-9]+)/i);
  return m?.[1] || "";
}

function createdFrom(raw: Record<string, unknown>): number {
  const c = num(
    field(raw, "created_utc", "created", "createdAt", "timestamp"),
  );
  if (c) return c > 1e12 ? Math.floor(c / 1000) : Math.floor(c);

  const dateStr = str(field(raw, "date", "created_at"));
  if (dateStr) {
    const t = Date.parse(dateStr);
    if (!Number.isNaN(t)) return Math.floor(t / 1000);
  }
  return Math.floor(Date.now() / 1000);
}

function matchesKeywords(text: string, keywords: string[]): boolean {
  if (!keywords.length) return true;
  const hay = text.toLowerCase();
  return keywords.some((k) => k && hay.includes(k.toLowerCase()));
}

/**
 * Normalize ReddAPI post shapes:
 * - rising: { title, "post text" }  (often no URL — skipped)
 * - scrape/hot: { kind, data: { title, selftext, permalink, ... } }
 * - scrape: { postId, title, text, postUrl, author }
 */
function normalizePost(
  raw: unknown,
  subreddit: string,
): NormalizedEvent | null {
  const o = asRecord(raw);
  if (!o) return null;
  const data = asRecord(o.data) || o;

  const title = str(field(data, "title", "post_title"));
  // Avoid using Reddit fullname `name` (t3_xxx) as title
  const body = str(
    field(
      data,
      "selftext",
      "body",
      "text",
      "post text", // rising_posts
      "content",
      "post_content",
      "description",
    ),
  );
  if (!title && !body) return null;

  const permalink = permalinkFrom(data, subreddit);
  if (!permalink) return null; // can't post/enrich without a URL

  const id =
    str(field(data, "id", "post_id", "postId")).replace(/^t3_/, "") ||
    postIdFromPermalink(permalink);
  if (!id) return null;

  const author =
    str(field(data, "author", "username", "user")) || "[deleted]";

  return makeEvent({
    platform: "reddit",
    external_id: `post_${id}`,
    community: subreddit,
    title: title || "(untitled)",
    body,
    author,
    created_utc: createdFrom(data),
    permalink,
    thread_context: `r/${subreddit}`,
  });
}

function normalizeComment(
  raw: unknown,
  parent: NormalizedEvent,
): NormalizedEvent | null {
  const o = asRecord(raw);
  if (!o) return null;
  const data = asRecord(o.data) || o;
  const body = str(field(data, "body", "text", "content", "comment", "post text"));
  if (!body || body.length < 20) return null;
  if (/^\[deleted\]$|^\[removed\]$/i.test(body)) return null;

  const author =
    str(field(data, "author", "username", "user")) || "[deleted]";
  const id =
    str(field(data, "id", "comment_id", "commentId")).replace(/^t1_/, "") ||
    `h_${Buffer.from(body.slice(0, 40)).toString("base64url").slice(0, 12)}`;

  let permalink = str(field(data, "permalink", "url", "comment_url", "commentUrl"));
  permalink = permalink ? ensureRedditUrl(permalink) : "";
  if (!permalink) {
    permalink = `${parent.permalink.replace(/\/$/, "")}/${id}/`;
  }

  return makeEvent({
    platform: "reddit",
    external_id: `comment_${id}`,
    community: parent.community,
    title: `Re: ${parent.title}`,
    body,
    author,
    created_utc: createdFrom(data) || parent.created_utc,
    permalink,
    thread_context: `r/${parent.community} · ${parent.title}`,
    parent_id: parent.external_id.replace(/^post_/, ""),
  });
}

async function enrichComments(
  post: NormalizedEvent,
  keywords: string[],
  commentsNum: number,
): Promise<NormalizedEvent[]> {
  try {
    const raw = await scrapePostComments(post.permalink, commentsNum);
    const comments = asArray(raw)
      .map((c) => normalizeComment(c, post))
      .filter((e): e is NormalizedEvent => Boolean(e));

    const postMatches = matchesKeywords(
      `${post.title}\n${post.body}`,
      keywords,
    );
    return comments.filter((c) => {
      if (ASKISH.test(c.body)) return true;
      if (!keywords.length) return true;
      if (matchesKeywords(`${post.title}\n${c.body}`, keywords)) return true;
      return postMatches;
    });
  } catch (err) {
    log.warn("comment enrich failed", {
      permalink: post.permalink,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

function parsePosts(raw: unknown, sub: string, limit: number): NormalizedEvent[] {
  return asArray(raw)
    .map((p) => normalizePost(p, sub))
    .filter((e): e is NormalizedEvent => Boolean(e))
    .slice(0, limit);
}

async function fetchSubPosts(
  sub: string,
  postsPerSub: number,
): Promise<NormalizedEvent[]> {
  // Prefer scrape/hot — full Reddit objects with permalinks.
  // rising_posts often returns { title, "post text" } with no URL → unusable.
  try {
    const scraped = await scrapeSubreddit(sub, "hot");
    const posts = parsePosts(scraped, sub, postsPerSub);
    if (posts.length) {
      log.info("reddit scrape/hot ingested", { sub, count: posts.length });
      return posts;
    }
    log.warn("reddit scrape/hot returned 0 parseable posts", { sub });
  } catch (err) {
    log.warn("scrape/hot failed", {
      sub,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const rising = await risingPosts(sub, postsPerSub);
    const posts = parsePosts(rising, sub, postsPerSub);
    log.info("reddit rising ingested", { sub, count: posts.length });
    if (posts.length) return posts;
  } catch (err) {
    log.warn("rising_posts failed", {
      sub,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return [];
}

export function canIngestReddit(): boolean {
  return canIngestViaCompound() || canUseReddApi();
}

/** compound | reddapi | auto (Compound+Playwright if ready, else ReddAPI) */
function ingestProvider(): "compound" | "reddapi" {
  const pref = envOr("REDDIT_INGEST", "auto").toLowerCase();
  if (pref === "compound" || pref === "playwright") return "compound";
  if (pref === "reddapi") return "reddapi";
  // legacy alias
  if (pref === "apify") {
    log.warn("REDDIT_INGEST=apify is removed — using compound");
    return "compound";
  }
  return canIngestViaCompound() ? "compound" : "reddapi";
}

async function ingestRedditViaReddApi(
  product: ProductConfig,
): Promise<NormalizedEvent[]> {
  if (!canUseReddApi()) {
    log.warn("skipping reddit ingest — RAPIDAPI_KEY / REDDAPI_KEY not set");
    return [];
  }

  const subs = (product.subreddits || []).slice(
    0,
    envInt("REDDIT_MAX_SUBS", 5),
  );
  if (!subs.length) {
    log.warn("no subreddits configured — skipping reddit ingest");
    return [];
  }

  const postsPerSub = envInt("REDDIT_POSTS_PER_SUB", 12);
  const enrichCap = envInt("REDDIT_COMMENT_ENRICH_CAP", 10);
  const commentsNum = envInt("REDDIT_COMMENTS_PER_POST", 12);
  const out: NormalizedEvent[] = [];
  const seen = new Set<string>();
  let enriched = 0;

  for (const sub of subs) {
    const posts = await fetchSubPosts(sub, postsPerSub);

    const ranked = [...posts].sort((a, b) => {
      const score = (e: NormalizedEvent) =>
        (ASKISH.test(`${e.title}\n${e.body}`) ? 2 : 0) +
        (matchesKeywords(`${e.title}\n${e.body}`, product.keywords) ? 1 : 0);
      return score(b) - score(a);
    });

    for (const post of ranked) {
      if (seen.has(post.external_id)) continue;
      seen.add(post.external_id);
      out.push(post);

      if (enriched >= enrichCap) continue;
      const comments = await enrichComments(post, product.keywords, commentsNum);
      enriched += 1;
      for (const c of comments) {
        if (seen.has(c.external_id)) continue;
        seen.add(c.external_id);
        out.push(c);
      }
    }
  }

  log.info("reddit ingest done", {
    provider: "reddapi",
    subs: subs.length,
    events: out.length,
    enriched,
  });
  return out;
}

export async function ingestReddit(
  product: ProductConfig,
): Promise<NormalizedEvent[]> {
  const provider = ingestProvider();
  log.info("reddit ingest provider", { provider });

  if (provider === "compound") {
    if (!canIngestViaCompound()) {
      log.warn(
        "compound ingest not ready (need Groq keys + reddit:session) — falling back to ReddAPI if available",
      );
      return ingestRedditViaReddApi(product);
    }
    return ingestRedditViaCompound(product);
  }

  return ingestRedditViaReddApi(product);
}
