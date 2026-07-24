import { z } from "zod";

export const ServiceNameSchema = z.enum([
  "promo-video",
  "screen-recording",
  "social-listening",
  "outreach",
  "competitor-research",
  "brand-kit",
  "social-post",
]);
export type ServiceName = z.infer<typeof ServiceNameSchema>;

export const JobStatusSchema = z.enum([
  "queued",
  "running",
  "awaiting_approval",
  "failed",
  "completed",
  "cancelled",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const CreateJobRequestSchema = z.object({
  input: z.record(z.unknown()),
  callback_url: z.string().url().optional(),
  priority: z.enum(["low", "normal", "high"]).optional().default("normal"),
});
export type CreateJobRequest = z.infer<typeof CreateJobRequestSchema>;

export const JobArtifactSchema = z.object({
  type: z.string(),
  url: z.string().url().optional(),
  path: z.string().optional(),
  object_key: z.string().optional(),
  mime_type: z.string().optional(),
});
export type JobArtifact = z.infer<typeof JobArtifactSchema>;

export const CostLineSchema = z.object({
  vendor: z.string(),
  operation: z.string(),
  amount_usd: z.number().nonnegative(),
  units: z.number().optional(),
  meta: z.record(z.unknown()).optional(),
});
export type CostLine = z.infer<typeof CostLineSchema>;

export const JobRecordSchema = z.object({
  id: z.string().uuid(),
  service: ServiceNameSchema,
  status: JobStatusSchema,
  input: z.record(z.unknown()),
  artifacts: z.array(JobArtifactSchema).default([]),
  cost_breakdown: z.array(CostLineSchema).default([]),
  list_price_usd: z.number().nonnegative(),
  error: z.string().optional(),
  callback_url: z.string().url().optional(),
  idempotency_key: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  eta_seconds: z.number().int().nonnegative().optional(),
});
export type JobRecord = z.infer<typeof JobRecordSchema>;

export const CreateJobResponseSchema = z.object({
  job_id: z.string().uuid(),
  list_price_usd: z.number().nonnegative(),
  eta_seconds: z.number().int().nonnegative(),
  status_url: z.string(),
  status: JobStatusSchema,
});
export type CreateJobResponse = z.infer<typeof CreateJobResponseSchema>;

export const CompetitorResearchInputSchema = z.object({
  product_name: z.string().min(1),
  product_url: z.string().url().optional(),
});
export type CompetitorResearchInput = z.infer<typeof CompetitorResearchInputSchema>;

export const SERVICE_MANIFESTS = {
  "promo-video": {
    name: "promo-video",
    a2mcp_price_usd: 2.99,
    endpoint_path: "/v1/services/promo-video/jobs",
    sla_minutes: 15,
  },
  "screen-recording": {
    name: "screen-recording",
    a2mcp_price_usd: 4.99,
    endpoint_path: "/v1/services/screen-recording/jobs",
    sla_minutes: 30,
  },
  "social-listening": {
    name: "social-listening",
    a2mcp_price_usd: 1.99,
    endpoint_path: "/v1/services/social-listening/jobs",
    sla_minutes: 10,
  },
  outreach: {
    name: "outreach",
    a2mcp_price_usd: 2.49,
    endpoint_path: "/v1/services/outreach/jobs",
    sla_minutes: 15,
  },
  "competitor-research": {
    name: "competitor-research",
    a2mcp_price_usd: 4.99,
    endpoint_path: "/v1/services/competitor-research/jobs",
    sla_minutes: 20,
  },
  "brand-kit": {
    name: "brand-kit",
    a2mcp_price_usd: 3.99,
    endpoint_path: "/v1/services/brand-kit/jobs",
    sla_minutes: 15,
  },
  "social-post": {
    name: "social-post",
    a2mcp_price_usd: 0.99,
    endpoint_path: "/v1/services/social-post/jobs",
    sla_minutes: 5,
  },
} as const satisfies Record<
  ServiceName,
  {
    name: ServiceName;
    a2mcp_price_usd: number;
    endpoint_path: string;
    sla_minutes: number;
  }
>;
