import { createLogger } from "../log.js";
import type { ScheduledPostRow } from "../types.js";
import { canPostReddit, postRedditReply } from "./reddit.js";

const log = createLogger("post.executor");

export async function executePost(
  row: ScheduledPostRow,
  live: boolean,
): Promise<{
  status: "posted" | "dry_run" | "skipped" | "failed";
  permalink?: string;
  error?: string;
}> {
  if (!live) {
    log.info("dry-run would post", {
      id: row.id,
      platform: row.platform,
      target: row.permalink_target,
    });
    return {
      status: "dry_run",
      permalink: `dry-run://${row.platform}/${row.target_ref}`,
    };
  }

  try {
    if (row.platform !== "reddit") {
      return {
        status: "skipped",
        error: `unsupported platform ${row.platform} (Reddit only)`,
      };
    }

    if (!canPostReddit()) {
      return {
        status: "skipped",
        error:
          "Need Playwright Reddit session — run reddit:session / set REDDIT_PROFILE_DIR",
      };
    }

    const result = await postRedditReply({
      targetRef: row.target_ref,
      permalinkTarget: row.permalink_target,
      draftText: row.draft_text,
    });
    return { status: "posted", permalink: result.permalink };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("post failed", { id: row.id, error: message });
    return { status: "failed", error: message };
  }
}
