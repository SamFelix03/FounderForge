import type { NormalizedEvent, Platform } from "../types.js";

export function makeEvent(partial: {
  platform: Platform;
  external_id: string;
  community?: string | null;
  title?: string;
  body?: string;
  author?: string;
  created_utc?: number;
  permalink: string;
  thread_context?: string;
  parent_id?: string;
  suggested_reply?: string;
}): NormalizedEvent {
  return {
    platform: partial.platform,
    external_id: String(partial.external_id),
    community: partial.community ?? null,
    title: (partial.title || "").trim(),
    body: (partial.body || "").trim(),
    author: (partial.author || "").trim() || "[deleted]",
    created_utc: partial.created_utc ?? Math.floor(Date.now() / 1000),
    permalink: partial.permalink,
    thread_context: (partial.thread_context || "").trim(),
    parent_id: partial.parent_id,
    suggested_reply: partial.suggested_reply?.trim() || undefined,
  };
}

export function eventText(e: NormalizedEvent): string {
  return [e.title, e.body, e.thread_context].filter(Boolean).join("\n").slice(0, 6000);
}
