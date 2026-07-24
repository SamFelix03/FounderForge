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
