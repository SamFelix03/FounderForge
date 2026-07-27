import { randomUUID } from "node:crypto";
import type {
  NormalizedEvent,
  Platform,
  PostStatus,
  ScheduledPostRow,
  DraftCandidate,
} from "../types.js";

interface EventRow {
  id: string;
  event: NormalizedEvent;
  drop_stage: string | null;
  drop_reason: string | null;
}

interface CandidateRow {
  id: string;
  event_id: string;
  candidate: DraftCandidate;
}

interface LedgerRow {
  platform: Platform;
  community: string | null;
  scheduledPostId: string;
  posted_at: Date;
}

interface FewShotRow {
  platform: Platform;
  community: string | null;
  draftText: string;
  embedding: number[];
  created_at: Date;
}

const events = new Map<string, EventRow>();
const candidates = new Map<string, CandidateRow>();
const scheduled = new Map<string, ScheduledPostRow>();
const ledger: LedgerRow[] = [];
const fewShots: FewShotRow[] = [];

function eventKey(platform: Platform, externalId: string): string {
  return `${platform}:${externalId}`;
}

function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d ? dot / d : 0;
}

/** Clear in-memory state between jobs (optional). */
export function resetMemoryStore(): void {
  events.clear();
  candidates.clear();
  scheduled.clear();
  ledger.length = 0;
  fewShots.length = 0;
}

export async function upsertEvent(
  event: NormalizedEvent,
  drop?: { stage: string; reason: string },
): Promise<string> {
  const key = eventKey(event.platform, event.external_id);
  const existing = events.get(key);
  if (existing) {
    existing.event = event;
    existing.drop_stage = drop?.stage ?? null;
    existing.drop_reason = drop?.reason ?? null;
    return existing.id;
  }
  const id = randomUUID();
  events.set(key, {
    id,
    event,
    drop_stage: drop?.stage ?? null,
    drop_reason: drop?.reason ?? null,
  });
  return id;
}

export async function insertCandidate(
  eventId: string,
  c: DraftCandidate,
): Promise<string> {
  const id = randomUUID();
  candidates.set(id, { id, event_id: eventId, candidate: c });
  return id;
}

export async function insertScheduledPost(row: {
  candidateId: string;
  platform: Platform;
  targetRef: string;
  community: string | null;
  draftText: string;
  permalinkTarget: string;
  scheduledAt: Date;
}): Promise<string> {
  const id = randomUUID();
  scheduled.set(id, {
    id,
    candidate_id: row.candidateId,
    platform: row.platform,
    target_ref: row.targetRef,
    community: row.community,
    draft_text: row.draftText,
    permalink_target: row.permalinkTarget,
    scheduled_at: row.scheduledAt,
    status: "pending",
    posted_at: null,
    result_permalink: null,
    error: null,
  });
  return id;
}

export async function updateScheduledPost(
  id: string,
  patch: {
    status: PostStatus;
    resultPermalink?: string | null;
    error?: string | null;
  },
): Promise<void> {
  const row = scheduled.get(id);
  if (!row) return;
  row.status = patch.status;
  if (patch.status === "posted" || patch.status === "dry_run") {
    row.posted_at = new Date();
  }
  if (patch.resultPermalink !== undefined) {
    row.result_permalink = patch.resultPermalink;
  }
  if (patch.error !== undefined) {
    row.error = patch.error;
  }
}

export async function wasEventSeen(
  platform: Platform,
  externalId: string,
): Promise<boolean> {
  const key = eventKey(platform, externalId);
  const ev = events.get(key);
  if (!ev || ev.drop_stage) return false;
  for (const c of candidates.values()) {
    if (c.event_id === ev.id) return true;
  }
  return false;
}

export async function communityPostedRecently(
  platform: Platform,
  community: string | null,
  cooldownMinutes: number,
): Promise<boolean> {
  if (!community) return false;
  const cutoff = Date.now() - cooldownMinutes * 60_000;
  return ledger.some(
    (r) =>
      r.platform === platform &&
      r.community === community &&
      r.posted_at.getTime() > cutoff,
  );
}

export async function wasTargetPostedRecently(
  platform: Platform,
  targetRef: string,
  cooldownMinutes: number,
): Promise<boolean> {
  const cutoff = Date.now() - cooldownMinutes * 60_000;
  for (const row of scheduled.values()) {
    if (row.platform !== platform || row.target_ref !== targetRef) continue;
    if (!["pending", "posted", "dry_run"].includes(row.status)) continue;
    const t = (row.posted_at ?? row.scheduled_at).getTime();
    if (t > cutoff) return true;
  }
  return false;
}

export async function recordLedger(row: {
  platform: Platform;
  community: string | null;
  scheduledPostId: string;
}): Promise<void> {
  ledger.push({ ...row, posted_at: new Date() });
}

export async function insertFewShot(row: {
  platform: Platform;
  community: string | null;
  draftText: string;
  embedding: number[];
}): Promise<void> {
  fewShots.push({ ...row, created_at: new Date() });
}

export async function topFewShots(
  embedding: number[],
  limit = 5,
): Promise<string[]> {
  return [...fewShots]
    .map((f) => ({ text: f.draftText, score: cosine(embedding, f.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.text);
}

export async function topFewShotEmbeddings(limit = 20): Promise<number[][]> {
  return fewShots
    .slice(-limit)
    .reverse()
    .map((f) => f.embedding);
}
