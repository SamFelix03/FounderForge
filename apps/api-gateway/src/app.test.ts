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

  it("health lists seven services", async () => {
    const res = await request(app).get("/health");
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.services.length, 7);
  });

  it("lists service catalog with A2MCP prices", async () => {
    const res = await request(app).get("/v1/services");
    assert.equal(res.status, 200);
    const cr = res.body.services.find(
      (s: { name: string }) => s.name === "competitor-research",
    );
    assert.equal(cr.a2mcp_price_usd, 4.99);
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
    assert.equal(create.body.list_price_usd, 4.99);

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
