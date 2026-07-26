import { Router, type Router as ExpressRouter } from "express";
import {
  AutomatedProductDemoInputSchema,
  CompetitorResearchInputSchema,
  CreateJobRequestSchema,
  PromoVideoInputSchema,
  SocialListeningInputSchema,
  OutreachInputSchema,
  SERVICE_MANIFESTS,
  ServiceNameSchema,
  type ServiceName,
} from "@founderforge/schemas";
import { createLogger } from "@founderforge/observability";
import { jobStore } from "../jobs/store.js";
import { dispatchJob } from "../jobs/dispatch.js";

const log = createLogger("routes.jobs");

function validateServiceInput(service: ServiceName, input: Record<string, unknown>) {
  switch (service) {
    case "competitor-research":
      return CompetitorResearchInputSchema.safeParse(input);
    case "automated-product-demo":
      return AutomatedProductDemoInputSchema.safeParse(input);
    case "promo-video":
      return PromoVideoInputSchema.safeParse(input);
    case "social-listening":
      return SocialListeningInputSchema.safeParse(input);
    case "outreach":
      return OutreachInputSchema.safeParse(input);
    default:
      return { success: true as const, data: input };
  }
}

export const jobsRouter: ExpressRouter = Router();

jobsRouter.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "api-gateway",
    services: Object.keys(SERVICE_MANIFESTS),
  });
});

jobsRouter.post("/v1/services/:service/jobs", async (req, res) => {
  const parsedService = ServiceNameSchema.safeParse(req.params.service);
  if (!parsedService.success) {
    return res.status(404).json({ error: "unknown_service", service: req.params.service });
  }
  const service: ServiceName = parsedService.data;

  const body = CreateJobRequestSchema.safeParse(req.body ?? {});
  if (!body.success) {
    return res.status(400).json({ error: "invalid_body", details: body.error.flatten() });
  }

  const inputCheck = validateServiceInput(service, body.data.input);
  if (!inputCheck.success) {
    return res.status(400).json({
      error: "invalid_input",
      details: inputCheck.error.flatten(),
    });
  }

  const idempotencyKey = req.header("x-idempotency-key") ?? undefined;
  const job = await jobStore.create(
    service,
    {
      ...body.data,
      input: inputCheck.data as Record<string, unknown>,
    },
    idempotencyKey,
  );

  void dispatchJob(job.id).catch((err) => {
    log.error("dispatch crashed", {
      job_id: job.id,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return res.status(202).json({
    job_id: job.id,
    list_price_usd: job.list_price_usd,
    eta_seconds: job.eta_seconds ?? SERVICE_MANIFESTS[service].sla_minutes * 60,
    status_url: `/v1/jobs/${job.id}`,
    status: job.status,
  });
});

jobsRouter.get("/v1/jobs/:jobId", async (req, res) => {
  const job = await jobStore.get(req.params.jobId ?? "");
  if (!job) {
    return res.status(404).json({ error: "not_found" });
  }
  return res.json({
    id: job.id,
    service: job.service,
    status: job.status,
    artifacts: job.artifacts,
    cost_breakdown: job.cost_breakdown,
    list_price_usd: job.list_price_usd,
    error: job.error,
    created_at: job.created_at,
    updated_at: job.updated_at,
    eta_seconds: job.eta_seconds,
    step: (job as { step?: string }).step,
  });
});

jobsRouter.get("/v1/services", (_req, res) => {
  res.json({
    services: Object.values(SERVICE_MANIFESTS).map((m) => ({
      name: m.name,
      a2mcp_price_usd: m.a2mcp_price_usd,
      endpoint_path: m.endpoint_path,
      sla_minutes: m.sla_minutes,
    })),
  });
});
