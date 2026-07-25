import {
  wasEventSeen,
  wasTargetPostedRecently,
} from "../db/repos.js";
import { envInt } from "../config.js";
import type { NormalizedEvent } from "../types.js";

/**
 * Dedup by exact event + short cooldown on the same Reddit post/thread.
 * Do NOT cool down a whole subreddit (that wrongly blocks many threads).
 */
export async function dedupAndRateLimit(
  event: NormalizedEvent,
): Promise<{ pass: boolean; reason?: string }> {
  if (await wasEventSeen(event.platform, event.external_id)) {
    return { pass: false, reason: "already_scheduled_or_posted" };
  }

  const cooldown = envInt("THREAD_COOLDOWN_MINUTES", 360);
  const threadKey = event.parent_id
    ? `post_${event.parent_id}`
    : event.external_id;

  if (await wasTargetPostedRecently(event.platform, threadKey, cooldown)) {
    return { pass: false, reason: `thread_cooldown_${cooldown}m` };
  }

  return { pass: true };
}
