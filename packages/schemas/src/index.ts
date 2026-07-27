import { z } from "zod";

export const ServiceNameSchema = z.enum([
  "promo-video",
  "automated-product-demo",
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

export const AutomatedProductDemoInputSchema = z.object({
  website_url: z.string().url(),
  script: z.string().min(1),
});
export type AutomatedProductDemoInput = z.infer<
  typeof AutomatedProductDemoInputSchema
>;

/** Seedance-supported durations used by promo-video (default 15s). */
export const PromoVideoDurationSchema = z.union([
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(8),
  z.literal(10),
  z.literal(12),
  z.literal(15),
]);

export const PromoVideoInputSchema = z.object({
  product_url: z.string().url(),
  duration: PromoVideoDurationSchema.default(15),
  resolution: z.enum(["480p", "720p", "1080p", "4k"]).default("720p"),
  max_pages: z.number().int().min(1).max(9).default(6),
});
export type PromoVideoInput = z.infer<typeof PromoVideoInputSchema>;

/** Social listening — product URL in, Reddit engagement PDF report out. */
export const SocialListeningInputSchema = z.object({
  product_url: z.string().url(),
  /** @deprecated Ignored — pipeline no longer auto-posts. */
  live: z.boolean().default(false),
  max_posts: z.number().int().min(1).max(20).optional(),
});
export type SocialListeningInput = z.infer<typeof SocialListeningInputSchema>;

/** Outreach — website + revenue sheet → investor PDF report. */
export const OutreachInputSchema = z.object({
  website_url: z.string().url(),
  /** Public URL to an .xlsx/.xls/.csv workbook downloaded at runtime. */
  sheet_url: z.string().url(),
});
export type OutreachInput = z.infer<typeof OutreachInputSchema>;

/** Brand kit — name + brief → zipped logo/assets/fonts kit. */
export const BrandKitInputSchema = z.object({
  brand_name: z.string().min(1).max(80),
  description: z.string().min(10).max(2000),
  pick: z.number().int().min(0).max(5).default(0),
});
export type BrandKitInput = z.infer<typeof BrandKitInputSchema>;

export const SERVICE_MANIFESTS = {
  "promo-video": {
    name: "promo-video",
    a2mcp_price_usd: 2.99,
    endpoint_path: "/v1/services/promo-video/jobs",
    sla_minutes: 15,
  },
  "automated-product-demo": {
    name: "automated-product-demo",
    a2mcp_price_usd: 4.99,
    endpoint_path: "/v1/services/automated-product-demo/jobs",
    sla_minutes: 30,
  },
  "social-listening": {
    name: "social-listening",
    a2mcp_price_usd: 1.99,
    endpoint_path: "/v1/services/social-listening/jobs",
    sla_minutes: 15,
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
