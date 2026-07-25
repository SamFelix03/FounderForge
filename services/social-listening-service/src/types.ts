export type Platform = "reddit";

export interface ProductConfig {
  product_name: string;
  one_liner: string;
  description: string;
  disclosure_line: string;
  keywords: string[];
  /** Subreddit names without r/ */
  subreddits: string[];
  scoring_weights: {
    relevance: number;
    need: number;
    community_risk: number;
    competitor: number;
  };
  risk_veto_threshold: number;
  need_veto_threshold: number;
  max_posts_per_cycle: number;
  window_hours: number;
}

export interface NormalizedEvent {
  platform: Platform;
  external_id: string;
  community: string | null;
  title: string;
  body: string;
  author: string;
  created_utc: number;
  permalink: string;
  thread_context: string;
  parent_id?: string;
}

export interface SignalScores {
  relevance: number;
  need: number;
  community_risk: number;
  competitor: number;
  rationales: {
    relevance: string;
    need: string;
    community_risk: string;
    competitor: string;
  };
}

export interface ScoredCandidate {
  event: NormalizedEvent;
  scores: SignalScores;
  aggregate: number;
  draft_text: string;
  draft_rationale: string;
  compliance_ok: boolean;
  compliance_notes: string;
}

export type PostStatus = "pending" | "posted" | "skipped" | "failed" | "dry_run";

export interface ScheduledPostRow {
  id: string;
  candidate_id: string;
  platform: Platform;
  target_ref: string;
  community: string | null;
  draft_text: string;
  permalink_target: string;
  scheduled_at: Date;
  status: PostStatus;
  posted_at: Date | null;
  result_permalink: string | null;
  error: string | null;
}
