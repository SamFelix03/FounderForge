import { embedText } from "../embeddings/local.js";
import { insertFewShot, recordLedger } from "../db/repos.js";
import { createLogger } from "../log.js";
import type { ScheduledPostRow } from "../types.js";

const log = createLogger("feedback");

export async function recordSuccessfulPost(row: ScheduledPostRow): Promise<void> {
  await recordLedger({
    platform: row.platform,
    community: row.community,
    scheduledPostId: row.id,
  });

  try {
    const embedding = await embedText(row.draft_text);
    await insertFewShot({
      platform: row.platform,
      community: row.community,
      draftText: row.draft_text,
      embedding,
    });
    log.info("few-shot stored", { id: row.id });
  } catch (err) {
    log.warn("few-shot store failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
