import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import type { Express } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "@founderforge/observability";
import {
  createPool,
  migrate,
  PostgresJobStore,
  resetPoolForTests,
  closePool,
  setJobStoreForTests,
} from "@founderforge/db";
import { setStartCompetitorResearchWorkflowForTests } from "./temporal/client.js";

loadRootEnv(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."));

const hasDb = Boolean(process.env.DATABASE_URL?.trim());

describe("api-gateway", { skip: !hasDb }, () => {
  let app: Express;
  let store: PostgresJobStore;

  before(async () => {
    process.env.PAYMENTS_BYPASS = "true";
    await resetPoolForTests();
    const pool = createPool();
    await migrate(pool);
    store = new PostgresJobStore(pool);
    setJobStoreForTests(store);

    setStartCompetitorResearchWorkflowForTests(async ({ job_id }) => {
      await store.update(job_id, {
        status: "completed",
        artifacts: [
          {
            type: "report_pdf",
            url: "https://example.com/test-report.pdf",
            object_key: "competitor-research/test.pdf",
            mime_type: "application/pdf",
          },
        ],
        cost_breakdown: [
          { vendor: "test", operation: "mock", amount_usd: 0 },
        ],
        step: "done",
      });
      return `competitor-research:${job_id}`;
    });

    const mod = await import("./app.js");
    app = await mod.createApp({
      jobStore: store,
      skipMigrate: true,
      skipPayments: true,
    });
  });

  after(async () => {
    setStartCompetitorResearchWorkflowForTests(undefined);
    setJobStoreForTests(undefined);
    await closePool();
  });

  it("health lists six services", async () => {
    const res = await request(app).get("/health");
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.services.length, 6);
    assert.ok(!res.body.services.includes("social-post"));
  });

  it("lists service catalog with A2MCP prices", async () => {
    const res = await request(app).get("/v1/services");
    assert.equal(res.status, 200);
    assert.equal(res.body.protocol?.pattern, "A");
    const cr = res.body.services.find(
      (s: { name: string }) => s.name === "competitor-research",
    );
    assert.equal(cr.a2mcp_price_usd, 1.0);
    assert.ok(cr.input_schema);
    assert.ok(cr.example_request?.input?.product_name);
    assert.ok(res.body.protocol?.failures?.product_url_error_codes?.length);
  });

  it("serves free discovery document with protocol and schemas", async () => {
    const res = await request(app).get("/v1/discovery");
    assert.equal(res.status, 200);
    assert.equal(res.body.schema_version, "1.0.0");
    assert.equal(res.body.protocol.name, "paid_create_free_poll");
    assert.equal(res.body.protocol.polling.result_url_field, "artifacts[].url");
    assert.equal(res.body.services.length, 6);
    assert.ok(
      res.body.free_endpoints.some(
        (e: { path: string }) => e.path === "/v1/discovery",
      ),
    );
    assert.ok(
      res.body.protocol.failures.product_url_error_codes.some(
        (c: { code: string }) => c.code === "product_url_no_content",
      ),
    );
    const social = res.body.services.find(
      (s: { name: string }) => s.name === "social-listening",
    );
    assert.match(String(social.provide), /product_name/);
    const brand = res.body.services.find(
      (s: { name: string }) => s.name === "brand-kit",
    );
    assert.equal(brand.example_artifacts[0].type, "brand_kit_zip");
  });

  it("serves discovery catalog on POST (marketplace free-endpoint probes)", async () => {
    const discovery = await request(app).post("/v1/discovery").send({});
    assert.equal(discovery.status, 200);
    assert.equal(discovery.body.schema_version, "1.0.0");
    assert.equal(discovery.body.services.length, 6);

    const services = await request(app).post("/v1/services").send({});
    assert.equal(services.status, 200);
    assert.equal(services.body.schema_version, "1.0.0");
  });

  it("GET on paid job URL returns free usage guide (no job create)", async () => {
    const res = await request(app).get("/v1/services/brand-kit/jobs");
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.paid, false);
    assert.equal(res.body.service, "brand-kit");
    assert.equal(res.body.how_to_call.method, "POST");
    assert.ok(String(res.body.discovery_url).endsWith("/v1/discovery"));
    assert.ok(res.body.example_request?.input);

    const unknown = await request(app).get("/v1/services/not-a-service/jobs");
    assert.equal(unknown.status, 404);
  });

  it("rejects unknown service", async () => {
    const res = await request(app)
      .post("/v1/services/not-a-service/jobs")
      .send({ input: {} });
    assert.equal(res.status, 404);
  });

  it("rejects competitor-research jobs with invalid input", async () => {
    const res = await request(app)
      .post("/v1/services/competitor-research/jobs")
      .send({ input: {} });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "invalid_input");
  });

  it("creates job, enqueues Temporal, and returns durable completed status", async () => {
    const create = await request(app)
      .post("/v1/services/competitor-research/jobs")
      .set("X-Idempotency-Key", `test-${Date.now()}`)
      .send({
        input: {
          product_name: "Linear",
          product_url: "https://linear.app",
        },
      });

    assert.equal(create.status, 202);
    assert.ok(create.body.job_id);
    assert.equal(create.body.list_price_usd, 1.0);

    let status = "queued";
    let body: {
      status: string;
      artifacts: Array<{ type: string; url?: string }>;
      error?: string;
    } = { status: "queued", artifacts: [] };

    for (let i = 0; i < 50; i++) {
      const poll = await request(app).get(`/v1/jobs/${create.body.job_id}`);
      assert.equal(poll.status, 200);
      body = poll.body;
      status = body.status;
      if (status === "completed" || status === "failed") break;
      await new Promise((r) => setTimeout(r, 50));
    }

    assert.equal(status, "completed", body.error ?? "job did not complete");
    const pdf = body.artifacts.find((a) => a.type === "report_pdf");
    assert.ok(pdf?.url?.startsWith("http"), "expected report_pdf url");

    // Durability: fresh store instance still sees the row
    const again = await new PostgresJobStore(createPool()).get(create.body.job_id);
    assert.ok(again);
    assert.equal(again.status, "completed");
  });

  it("poll returns decoded error_code for scrape failures", async () => {
    const created = await store.create(
      "social-listening",
      { input: { product_url: "https://trackly.app" }, priority: "normal" },
      `scrape-err-${Date.now()}`,
    );
    await store.setStatus(
      created.id,
      "failed",
      "[product_url_no_content] Could not extract readable product content from https://trackly.app",
    );

    const poll = await request(app).get(`/v1/jobs/${created.id}`);
    assert.equal(poll.status, 200);
    assert.equal(poll.body.status, "failed");
    assert.equal(poll.body.error_code, "product_url_no_content");
    assert.match(String(poll.body.error), /trackly\.app/);
    assert.equal(poll.body.input, undefined);
  });

  it("refuses to start paid mode without OKX credentials", async () => {
    process.env.PAYMENTS_BYPASS = "false";
    delete process.env.OKX_API_KEY;
    delete process.env.OKX_SECRET_KEY;
    delete process.env.OKX_PASSPHRASE;
    const { createApp } = await import("./app.js");
    await assert.rejects(
      () => createApp({ jobStore: store, skipMigrate: true }),
      /OKX_API_KEY|OKX Payment SDK/,
    );
    process.env.PAYMENTS_BYPASS = "true";
  });
});
