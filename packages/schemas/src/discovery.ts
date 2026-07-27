import { zodToJsonSchema } from "zod-to-json-schema";
import type { JsonSchema7Type } from "zod-to-json-schema";
import {
  AutomatedProductDemoInputSchema,
  BrandKitInputSchema,
  CompetitorResearchInputSchema,
  CreateJobRequestSchema,
  CreateJobResponseSchema,
  JobArtifactSchema,
  JobRecordSchema,
  JobStatusSchema,
  OutreachInputSchema,
  PromoVideoInputSchema,
  SERVICE_MANIFESTS,
  SocialListeningInputSchema,
  type ServiceName,
} from "./models.js";

function jsonSchema(schema: Parameters<typeof zodToJsonSchema>[0], name: string): JsonSchema7Type {
  return zodToJsonSchema(schema, {
    name,
    $refStrategy: "none",
    target: "jsonSchema7",
  });
}

export type DiscoveryArtifactHint = {
  type: string;
  mime_type?: string;
  description: string;
};

export type DiscoveryServiceEntry = {
  name: ServiceName;
  title: string;
  paid: true;
  method: "POST";
  a2mcp_price_usd: number;
  currency: "USD₮0";
  endpoint_path: string;
  endpoint_url?: string;
  sla_minutes: number;
  eta_seconds: number;
  summary: string;
  /** What the caller must supply (human-readable). */
  provide: string;
  /** What the caller receives when the job completes. */
  deliverable: string;
  input_schema: JsonSchema7Type;
  example_request: {
    input: Record<string, unknown>;
    callback_url?: string;
    priority?: "low" | "normal" | "high";
  };
  example_artifacts: DiscoveryArtifactHint[];
  status_url_template: "/v1/jobs/{job_id}";
};

export type FounderForgeDiscoveryDocument = {
  schema_version: "1.0.0";
  generated_at: string;
  asp: {
    name: "FounderForge";
    agent_id?: string;
    description: string;
  };
  base_url: string;
  protocol: {
    pattern: "A";
    name: "paid_create_free_poll";
    summary: string;
    steps: Array<{
      step: number;
      action: string;
      detail: string;
    }>;
    payment: {
      unpaid_create_response: 402;
      header_challenge: "PAYMENT-REQUIRED";
      header_proof: "PAYMENT-SIGNATURE";
      asset: "USD₮0";
      networks: ["eip155:196", "eip155:1952"];
      settles_on: "job_create";
    };
    polling: {
      method: "GET";
      path_template: "/v1/jobs/{job_id}";
      free: true;
      recommended_interval_seconds: number;
      terminal_statuses: Array<"completed" | "failed" | "cancelled">;
      success_status: "completed";
      result_field: "artifacts";
      result_url_field: "artifacts[].url";
    };
    headers: {
      content_type: "application/json";
      idempotency: "X-Idempotency-Key";
    };
  };
  envelopes: {
    create_job_request: JsonSchema7Type;
    create_job_response: JsonSchema7Type;
    job_poll_response: JsonSchema7Type;
    artifact: JsonSchema7Type;
    job_statuses: JsonSchema7Type;
  };
  free_endpoints: Array<{
    method: "GET";
    path: string;
    path_url?: string;
    paid: false;
    description: string;
  }>;
  services: DiscoveryServiceEntry[];
};

const SERVICE_META: Record<
  ServiceName,
  {
    title: string;
    summary: string;
    provide: string;
    deliverable: string;
    inputSchema: Parameters<typeof zodToJsonSchema>[0];
    example_request: DiscoveryServiceEntry["example_request"];
    example_artifacts: DiscoveryArtifactHint[];
  }
> = {
  "promo-video": {
    title: "Product Promo Video",
    summary:
      "Creates a short promotional video for your product, ready for launch pages, social, and ads.",
    provide: "product_url (required). Optional: duration (4–15s), resolution, max_pages.",
    deliverable: "Downloadable MP4 promo video URL in artifacts[].url where type=video.",
    inputSchema: PromoVideoInputSchema,
    example_request: {
      input: {
        product_url: "https://example.com",
        duration: 15,
        resolution: "720p",
        max_pages: 6,
      },
      priority: "normal",
    },
    example_artifacts: [
      {
        type: "video",
        mime_type: "video/mp4",
        description: "Promotional MP4 — use artifacts[].url as the final download.",
      },
    ],
  },
  "automated-product-demo": {
    title: "Narrated Product Demo",
    summary:
      "Records a narrated walkthrough of your live product following the demo path you describe.",
    provide: "website_url and a natural-language script of what to show.",
    deliverable: "Narrated MP4 of the live product in artifacts[].url where type=video.",
    inputSchema: AutomatedProductDemoInputSchema,
    example_request: {
      input: {
        website_url: "https://example.com",
        script: "Open the homepage, create a new project, then show the share link.",
      },
    },
    example_artifacts: [
      {
        type: "video",
        mime_type: "video/mp4",
        description: "Narrated demo MP4 — use artifacts[].url as the final download.",
      },
    ],
  },
  "social-listening": {
    title: "Reddit Engagement Pack",
    summary:
      "Finds live Reddit threads where people want solutions like yours and drafts ready-to-post replies.",
    provide: "product_url (required). Optional: max_posts (1–20).",
    deliverable:
      "PDF playbook (type=pdf_report) plus thread URLs (type=reddit_thread). Primary file is artifacts[].url on pdf_report.",
    inputSchema: SocialListeningInputSchema,
    example_request: {
      input: {
        product_url: "https://example.com",
        max_posts: 5,
      },
    },
    example_artifacts: [
      {
        type: "pdf_report",
        mime_type: "application/pdf",
        description: "Engagement playbook PDF — primary deliverable URL.",
      },
      {
        type: "reddit_thread",
        mime_type: "text/uri-list",
        description: "Individual Reddit thread URL referenced in the playbook.",
      },
    ],
  },
  outreach: {
    title: "Investor Outreach Report",
    summary:
      "Builds an investor intelligence pack from your company site and revenue data.",
    provide: "website_url and a public spreadsheet URL (sheet_url) of revenue/metrics.",
    deliverable: "Investor PDF in artifacts[].url where type=pdf_report.",
    inputSchema: OutreachInputSchema,
    example_request: {
      input: {
        website_url: "https://example.com",
        sheet_url: "https://example.com/metrics.xlsx",
      },
    },
    example_artifacts: [
      {
        type: "pdf_report",
        mime_type: "application/pdf",
        description: "Investor intelligence PDF — use artifacts[].url as the final download.",
      },
    ],
  },
  "competitor-research": {
    title: "Competitor Research Report",
    summary:
      "Delivers competitive analysis covering peers, features, pricing, SWOT, and positioning.",
    provide: "product_name (required). Optional: product_url.",
    deliverable: "Competitor report PDF in artifacts[].url where type=report_pdf.",
    inputSchema: CompetitorResearchInputSchema,
    example_request: {
      input: {
        product_name: "Notion",
        product_url: "https://www.notion.so",
      },
    },
    example_artifacts: [
      {
        type: "report_pdf",
        mime_type: "application/pdf",
        description: "Competitor research PDF — use artifacts[].url as the final download.",
      },
    ],
  },
  "brand-kit": {
    title: "Brand Identity Kit",
    summary: "Produces a complete visual brand identity from a name and brief.",
    provide:
      "brand_name, creative description (10–2000 chars), optional pick (0–5) for preferred logo concept.",
    deliverable:
      "ZIP with logos, palette, fonts, favicons, banners, and brand guide in artifacts[].url where type=brand_kit_zip.",
    inputSchema: BrandKitInputSchema,
    example_request: {
      input: {
        brand_name: "Solace",
        description: "Calm meditation app — minimalist, organic, wellness.",
        pick: 0,
      },
    },
    example_artifacts: [
      {
        type: "brand_kit_zip",
        mime_type: "application/zip",
        description: "Brand kit ZIP — use artifacts[].url as the final download.",
      },
    ],
  },
};

export function defaultPublicBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw =
    env.PUBLIC_API_BASE_URL?.trim() ||
    env.API_PUBLIC_URL?.trim() ||
    "https://founderforge-api-production.up.railway.app";
  return raw.replace(/\/+$/, "");
}

export function buildDiscoveryDocument(opts?: {
  baseUrl?: string;
  agentId?: string;
  now?: Date;
}): FounderForgeDiscoveryDocument {
  const baseUrl = (opts?.baseUrl ?? defaultPublicBaseUrl()).replace(/\/+$/, "");
  const agentId =
    opts?.agentId?.trim() ||
    process.env.FOUNDERFORGE_ASP_AGENT_ID?.trim() ||
    undefined;

  const services: DiscoveryServiceEntry[] = (
    Object.keys(SERVICE_MANIFESTS) as ServiceName[]
  ).map((name) => {
    const manifest = SERVICE_MANIFESTS[name];
    const meta = SERVICE_META[name];
    return {
      name,
      title: meta.title,
      paid: true,
      method: "POST",
      a2mcp_price_usd: manifest.a2mcp_price_usd,
      currency: "USD₮0",
      endpoint_path: manifest.endpoint_path,
      endpoint_url: `${baseUrl}${manifest.endpoint_path}`,
      sla_minutes: manifest.sla_minutes,
      eta_seconds: manifest.sla_minutes * 60,
      summary: meta.summary,
      provide: meta.provide,
      deliverable: meta.deliverable,
      input_schema: jsonSchema(meta.inputSchema, `${name}_input`),
      example_request: meta.example_request,
      example_artifacts: meta.example_artifacts,
      status_url_template: "/v1/jobs/{job_id}",
    };
  });

  return {
    schema_version: "1.0.0",
    generated_at: (opts?.now ?? new Date()).toISOString(),
    asp: {
      name: "FounderForge",
      ...(agentId ? { agent_id: agentId } : {}),
      description:
        "Full go-to-market suite for solo founders — six pay-per-call A2MCP services that return downloadable promo videos, product demos, Reddit engagement packs, investor reports, competitor analysis, and brand kits.",
    },
    base_url: baseUrl,
    protocol: {
      pattern: "A",
      name: "paid_create_free_poll",
      summary:
        "Pay once on POST job create (x402). Then GET /v1/jobs/{job_id} for free until status is completed, and download artifacts[].url.",
      steps: [
        {
          step: 1,
          action: "Read this discovery document",
          detail:
            "GET /v1/discovery (free). Pick a paid service, copy endpoint_url, and build the create body from input_schema + example_request.",
        },
        {
          step: 2,
          action: "Create job (paid)",
          detail:
            'POST {endpoint_url} with JSON body {"input":{...}} and Content-Type application/json. Unpaid requests return HTTP 402 with PAYMENT-REQUIRED. Retry the same POST with PAYMENT-SIGNATURE after settling USD₮0.',
        },
        {
          step: 3,
          action: "Capture job handle",
          detail:
            "On HTTP 202, read job_id and status_url from the response. Payment has already settled; do not pay again to poll.",
        },
        {
          step: 4,
          action: "Poll until terminal",
          detail:
            "GET {base_url}{status_url} (or GET /v1/jobs/{job_id}) every ~5–15s. Free forever. Stop when status is completed, failed, or cancelled.",
        },
        {
          step: 5,
          action: "Take the result URL",
          detail:
            "When status=completed, read artifacts[]. Prefer the primary artifact type listed for that service (video, pdf_report/report_pdf, or brand_kit_zip). The downloadable file is artifacts[].url.",
        },
      ],
      payment: {
        unpaid_create_response: 402,
        header_challenge: "PAYMENT-REQUIRED",
        header_proof: "PAYMENT-SIGNATURE",
        asset: "USD₮0",
        networks: ["eip155:196", "eip155:1952"],
        settles_on: "job_create",
      },
      polling: {
        method: "GET",
        path_template: "/v1/jobs/{job_id}",
        free: true,
        recommended_interval_seconds: 10,
        terminal_statuses: ["completed", "failed", "cancelled"],
        success_status: "completed",
        result_field: "artifacts",
        result_url_field: "artifacts[].url",
      },
      headers: {
        content_type: "application/json",
        idempotency: "X-Idempotency-Key",
      },
    },
    envelopes: {
      create_job_request: jsonSchema(CreateJobRequestSchema, "create_job_request"),
      create_job_response: jsonSchema(CreateJobResponseSchema, "create_job_response"),
      job_poll_response: jsonSchema(JobRecordSchema, "job_poll_response"),
      artifact: jsonSchema(JobArtifactSchema, "artifact"),
      job_statuses: jsonSchema(JobStatusSchema, "job_statuses"),
    },
    free_endpoints: [
      {
        method: "GET",
        path: "/health",
        path_url: `${baseUrl}/health`,
        paid: false,
        description: "Liveness check and service name list.",
      },
      {
        method: "GET",
        path: "/v1/discovery",
        path_url: `${baseUrl}/v1/discovery`,
        paid: false,
        description:
          "This document — full A2MCP protocol, JSON Schemas, examples, and artifact rules.",
      },
      {
        method: "GET",
        path: "/v1/services",
        path_url: `${baseUrl}/v1/services`,
        paid: false,
        description:
          "Same discovery document (alias). Prefer /v1/discovery for new callers.",
      },
      {
        method: "GET",
        path: "/v1/jobs/{job_id}",
        path_url: `${baseUrl}/v1/jobs/{job_id}`,
        paid: false,
        description:
          "Poll job status. When completed, artifacts[].url is the deliverable.",
      },
    ],
    services,
  };
}
