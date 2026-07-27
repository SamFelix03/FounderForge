import { createLogger } from "../log.js";
import {
  canPostViaPlaywright,
  postCommentViaPlaywright,
} from "./playwrightReddit.js";

const log = createLogger("post.reddit");

export function canPostReddit(): boolean {
  return canPostViaPlaywright();
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

/**
 * Live Reddit comments go through the logged-in Playwright profile only.
 * ReddAPI is not used for writes — run `npm run reddit:session` once.
 */
export async function postRedditReply(opts: {
  targetRef: string;
  permalinkTarget: string;
  draftText: string;
}): Promise<{ permalink: string }> {
  if (!canPostViaPlaywright()) {
    throw new Error(
      "Live Reddit post needs Playwright session — run `npm run reddit:session`",
    );
  }

  const postUrl = postUrlFromTarget(opts.permalinkTarget, opts.targetRef);
  const permalinkTarget = opts.permalinkTarget.includes("/comments/")
    ? opts.permalinkTarget
    : postUrl;

  log.info("posting via Playwright", {
    postUrl: permalinkTarget.slice(0, 80),
    targetRef: opts.targetRef,
  });

  return postCommentViaPlaywright({
    permalinkTarget,
    targetRef: opts.targetRef,
    draftText: opts.draftText,
  });
}
