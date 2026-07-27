import type { ProductConfig } from "../types.js";

export interface RedditRecommendationRow {
  community: string | null;
  title: string;
  permalink: string;
  threadContext: string;
  draftText: string;
  draftRationale: string;
}

export interface RedditReportData {
  generatedAt: string;
  websiteUrl: string;
  product: ProductConfig;
  subreddits: string[];
  recommendations: RedditRecommendationRow[];
}
