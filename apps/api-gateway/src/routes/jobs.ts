import {
  Router,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from "express";
import {
  AutomatedProductDemoInputSchema,
  BrandKitInputSchema,
  buildDiscoveryDocument,
  CompetitorResearchInputSchema,
  CreateJobRequestSchema,
  defaultPublicBaseUrl,
  OutreachInputSchema,
  PromoVideoInputSchema,
  SERVICE_MANIFESTS,
  ServiceNameSchema,
  SocialListeningInputSchema,
  type ServiceName,
} from "@founderforge/schemas";
import { createLogger } from "@founderforge/observability";
import { jobStore } from "../jobs/store.js";
import { dispatchJob } from "../jobs/dispatch.js";
import {
  extractMarketplaceIds,
  normalizeCreateJobBody,
  POLL_CONTRACT,
} from "../jobs/normalizeBody.js";
import { probeTemporal } from "../temporal/health.js";

const log = createLogger("routes.jobs");

function discoveryPayload() {
  return buildDiscoveryDocument({
    baseUrl: defaultPublicBaseUrl(),
  });
}

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
    case "brand-kit":
      return BrandKitInputSchema.safeParse(input);
    default:
      return { success: true as const, data: input };
  }
}

function pollHints(jobId: string) {
  return {
    poll: {
      method: POLL_CONTRACT.method,
      path: `/v1/jobs/${jobId}`,
      recommended_interval_seconds: POLL_CONTRACT.recommended_interval_seconds,
      terminal_statuses: [...POLL_CONTRACT.terminal_statuses],
      success_status: POLL_CONTRACT.success_status,
      failure_fields: [...POLL_CONTRACT.failure_fields],
      result_url_field: POLL_CONTRACT.result_url_field,
    },
    terminal_statuses: [...POLL_CONTRACT.terminal_statuses],
    success_status: POLL_CONTRACT.success_status,
    failure_fields: [...POLL_CONTRACT.failure_fields],
  };
}

export const jobsRouter: ExpressRouter = Router();

jobsRouter.get("/health", async (_req, res) => {
  const [temporal, oldestQueuedAgeSeconds] = await Promise.all([
    probeTemporal(),
    jobStore.oldestQueuedAgeSeconds().catch(() => null),
  ]);
  res.json({
    ok: true,
    service: "api-gateway",
    services: Object.keys(SERVICE_MANIFESTS),
    temporal,
    oldest_queued_age_seconds: oldestQueuedAgeSeconds,
  });
});

/**
 * Free usage probe on paid job URLs. Marketplace validators often GET the listed
 * endpoint; never create a job here — guide callers to POST + discovery.
 * Not registered in OKX payment routes (unpaid 200).
 */
jobsRouter.get("/v1/services/:service/jobs", (req, res) => {
  const parsedService = ServiceNameSchema.safeParse(req.params.service);
  if (!parsedService.success) {
    return res.status(404).json({ error: "unknown_service", service: req.params.service });
  }
  const service = parsedService.data;
  const manifest = SERVICE_MANIFESTS[service];
  const baseUrl = defaultPublicBaseUrl();
  const discovery = discoveryPayload();
  const entry = discovery.services.find((s) => s.name === service);

  const scrapeFirst =
    service === "social-listening" ||
    service === "promo-video" ||
    service === "outreach" ||
    service === "competitor-research";

  return res.status(200).json({
    ok: true,
    paid: false,
    probe: "usage",
    service,
    endpoint_path: manifest.endpoint_path,
    endpoint_url: `${baseUrl}${manifest.endpoint_path}`,
    message:
      "This URL creates jobs via POST only. GET is a free usage guide for validators and agents.",
    how_to_call: {
      method: "POST",
      path: manifest.endpoint_path,
      url: `${baseUrl}${manifest.endpoint_path}`,
      content_type: "application/json",
      body_shape: {
        preferred: { input: "object — see discovery input_schema / example_request" },
        also_accepted: "Flattened top-level fields (same keys as input) without nesting under input",
        marketplace:
          "Optional marketplace.job_id / marketplace.agent_id, or X-Okx-Job-Id / X-Marketplace-Job-Id headers",
      },
      unpaid_response:
        "HTTP 402 with PAYMENT-REQUIRED (x402 v2). Settle USD₮0 on eip155:196, then replay the same POST with PAYMENT-SIGNATURE.",
      paid_response:
        "HTTP 202 with job_id, status_url, and poll contract. Poll GET /v1/jobs/{job_id} (free) until status is completed, failed, or cancelled. On completed download artifacts[].url; on failed read error + error_code.",
      ...(scrapeFirst
        ? {
            scrape_failures:
              "If status=failed after create, read error + error_code. Poll until status is completed OR failed (do not only wait for completed). Prefer a scrapeable URL or include product_name. Social-listening continues via product_name or hostname fallback when the URL is unreachable; reddit_no_threads / reddit_no_drafts when no usable comments.",
          }
        : {}),
    },
    a2mcp_price_usd: manifest.a2mcp_price_usd,
    eta_seconds: manifest.sla_minutes * 60,
    discovery_url: `${baseUrl}/v1/discovery`,
    example_request: entry?.example_request ?? { input: {} },
    ...pollHints("{job_id}"),
  });
});

jobsRouter.post("/v1/services/:service/jobs", async (req, res) => {
  const parsedService = ServiceNameSchema.safeParse(req.params.service);
  if (!parsedService.success) {
    return res.status(404).json({ error: "unknown_service", service: req.params.service });
  }
  const service: ServiceName = parsedService.data;

  const body = CreateJobRequestSchema.safeParse(
    normalizeCreateJobBody(req.body ?? {}),
  );
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

  const marketplaceIds = extractMarketplaceIds(body.data, req.headers);
  const idempotencyKey = req.header("x-idempotency-key") ?? undefined;
  const job = await jobStore.create(
    service,
    {
      ...body.data,
      input: inputCheck.data as Record<string, unknown>,
    },
    idempotencyKey,
    marketplaceIds,
  );

  // Await enqueue so 202 reflects durable dispatch (or pollable failed).
  try {
    await dispatchJob(job.id);
  } catch (err) {
    log.error("dispatch crashed", {
      job_id: job.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const fresh = (await jobStore.get(job.id)) ?? job;

  return res.status(202).json({
    job_id: fresh.id,
    list_price_usd: fresh.list_price_usd,
    eta_seconds: fresh.eta_seconds ?? SERVICE_MANIFESTS[service].sla_minutes * 60,
    status_url: `/v1/jobs/${fresh.id}`,
    status: fresh.status,
    ...(fresh.marketplace_job_id
      ? { marketplace_job_id: fresh.marketplace_job_id }
      : {}),
    ...(fresh.marketplace_agent_id
      ? { marketplace_agent_id: fresh.marketplace_agent_id }
      : {}),
    ...(fresh.workflow_id ? { workflow_id: fresh.workflow_id } : {}),
    ...(fresh.error ? { error: fresh.error } : {}),
    ...(fresh.error_code ? { error_code: fresh.error_code } : {}),
    ...pollHints(fresh.id),
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
    ...(job.error_code ? { error_code: job.error_code } : {}),
    ...(job.marketplace_job_id ? { marketplace_job_id: job.marketplace_job_id } : {}),
    ...(job.marketplace_agent_id
      ? { marketplace_agent_id: job.marketplace_agent_id }
      : {}),
    ...(job.workflow_id ? { workflow_id: job.workflow_id } : {}),
    created_at: job.created_at,
    updated_at: job.updated_at,
    eta_seconds: job.eta_seconds,
    step: (job as { step?: string }).step,
    ...pollHints(job.id),
  });
});

/**
 * Free A2MCP discovery catalog — protocol, JSON Schemas, examples, artifact rules.
 * Not registered in OKX payment routes (unpaid). Accept GET and POST: marketplace
 * reviewers often POST free listed endpoints and expect 200 + the catalog body.
 */
function sendDiscovery(_req: Request, res: Response) {
  res.status(200).json(discoveryPayload());
}

jobsRouter.get("/v1/discovery", sendDiscovery);
jobsRouter.post("/v1/discovery", sendDiscovery);

/** Alias of /v1/discovery for callers that already probe the services catalog. */
jobsRouter.get("/v1/services", sendDiscovery);
jobsRouter.post("/v1/services", sendDiscovery);
