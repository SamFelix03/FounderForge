import {
  canUseReddApi,
  reddApiComment,
  reddApiProxy,
} from "../ingest/reddapi.js";
import { createLogger } from "../log.js";
import { resolveRedditBearer } from "../redditSession.js";
import {
  canPostViaPlaywright,
  postCommentViaPlaywright,
} from "./playwrightReddit.js";

const log = createLogger("post.reddit");

/** ReddAPI write path: RapidAPI key + proxy + session bearer (proven live). */
export function canPostViaReddApi(): boolean {
  if (!canUseReddApi()) return false;
  try {
    reddApiProxy();
  } catch {
    return false;
  }
  return Boolean(resolveRedditBearer());
}

export function canPostReddit(): boolean {
  return canPostViaReddApi() || canPostViaPlaywright();
}

function postUrlFromTarget(permalink: string, targetRef: string): string {
  if (permalink.includes("/comments/")) {
    const m = permalink.match(
      /^(https?:\/\/(?:www\.)?reddit\.com\/r\/[^/]+\/comments\/[a-z0-9]+\/[^/]*)/i,
    );
    if (m) return `${m[1]}/`;
    return permalink.split("?")[0]!;
  }
  if (targetRef.startsWith("post_")) {
    const id = targetRef.slice("post_".length);
    return `https://www.reddit.com/comments/${id}/`;
  }
  return permalink;
}

function permalinkFromReddApi(
  data: unknown,
  fallbackUrl: string,
): string {
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    for (const key of ["permalink", "comment_url", "url"]) {
      const v = o[key];
      if (typeof v === "string" && v.includes("reddit.com")) return v;
    }
  }
  return fallbackUrl;
}

/**
 * Live posts prefer ReddAPI (session bearer + proxy). Playwright is fallback
 * when RapidAPI/proxy/bearer are missing. Run `npm run reddit:session` for auth.
 */
export async function postRedditReply(opts: {
  targetRef: string;
  permalinkTarget: string;
  draftText: string;
}): Promise<{ permalink: string }> {
  const postUrl = postUrlFromTarget(opts.permalinkTarget, opts.targetRef);

  if (canPostViaReddApi()) {
    log.info("posting via ReddAPI", {
      postUrl: postUrl.slice(0, 80),
      targetRef: opts.targetRef,
    });
    const data = await reddApiComment(postUrl, opts.draftText);
    return { permalink: permalinkFromReddApi(data, postUrl) };
  }

  if (!canPostViaPlaywright()) {
    throw new Error(
      "Live Reddit post needs ReddAPI (RAPIDAPI_KEY + REDDAPI_PROXY + token_v2) or Playwright session — run `npm run reddit:session`",
    );
  }

  log.info("posting via Playwright (ReddAPI unavailable)", {
    postUrl: postUrl.slice(0, 80),
    targetRef: opts.targetRef,
  });

  return postCommentViaPlaywright({
    permalinkTarget: opts.permalinkTarget.includes("/comments/")
      ? opts.permalinkTarget
      : postUrl,
    targetRef: opts.targetRef,
    draftText: opts.draftText,
  });
}
