import type { CostLine } from "@founderforge/schemas";

export interface CompetitorResearchWorkflowInput {
  job_id: string;
  product_name: string;
  product_url?: string;
}

export interface CompetitorResearchWorkflowResult {
  pdf_url: string;
  object_key?: string;
  cost_breakdown: CostLine[];
}

export interface AutomatedProductDemoWorkflowInput {
  job_id: string;
  website_url: string;
  script: string;
}

export interface AutomatedProductDemoWorkflowResult {
  video_url: string;
  object_key?: string;
  duration_seconds?: number;
  cost_breakdown: CostLine[];
}

export interface PromoVideoWorkflowInput {
  job_id: string;
  product_url: string;
  duration?: number;
  resolution?: string;
  max_pages?: number;
}

export interface PromoVideoWorkflowResult {
  video_url: string;
  request_id?: string;
  duration_seconds: number;
  concept?: string;
  cost_breakdown: CostLine[];
}

export interface SocialListeningWorkflowInput {
  job_id: string;
  product_url: string;
  live?: boolean;
  max_posts?: number;
}

export interface SocialListeningWorkflowResult {
  product_name: string;
  pdf_url: string;
  object_key: string;
  thread_urls: string[];
  recommendations_count: number;
  cost_breakdown: CostLine[];
}

export interface OutreachWorkflowInput {
  job_id: string;
  website_url: string;
  sheet_url: string;
}

export interface OutreachWorkflowResult {
  pdf_url?: string;
  object_key?: string;
  cost_breakdown: CostLine[];
}

export interface BrandKitWorkflowInput {
  job_id: string;
  brand_name: string;
  description: string;
  pick?: number;
}

export interface BrandKitWorkflowResult {
  zip_url: string;
  object_key?: string;
  brand_name: string;
  chosen_concept: string;
  cost_breakdown: CostLine[];
}
