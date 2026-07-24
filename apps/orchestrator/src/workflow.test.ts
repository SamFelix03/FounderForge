import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { competitorResearchWorkflow } from "./workflows/competitorResearch.js";
import type { CompetitorResearchWorkflowInput } from "./workflows/types.js";

describe("competitorResearchWorkflow", () => {
  let testEnv: TestWorkflowEnvironment;

  before(async () => {
    testEnv = await TestWorkflowEnvironment.createLocal();
  });

  after(async () => {
    await testEnv?.teardown();
  });

  it("runs multi-activity flow find → parallel → position → compile", async () => {
    const steps: string[] = [];
    const competitors = [
      {
        name: "Coda",
        url: "https://coda.io",
        confidence: 0.9,
        sources: ["test"],
      },
    ];
    const feature_diff = {
      features: ["SSO"],
      matrix: {
        product: {
          SSO: { status: "yes" as const, evidence_url: "https://example.com" },
        },
        Coda: {
          SSO: { status: "partial" as const, evidence_url: "https://coda.io" },
        },
      },
      conflicts: [],
    };
    const pricing = {
      product_pricing: {
        tiers: [{ name: "Pro", price: 10, currency: "USD", period: "month" as const }],
      },
      competitor_pricing: [
        {
          competitor: "Coda",
          tiers: [{ name: "Pro", price: 12, currency: "USD", period: "month" as const }],
        },
      ],
      price_history_signals: [],
    };
    const positioning = {
      swot: {
        strengths: ["a"],
        weaknesses: ["b"],
        opportunities: ["c"],
        threats: ["d"],
      },
      positioning_map: {
        axes: ["price", "feature_breadth"] as [string, string],
        points: [{ name: "X", x: 0.5, y: 0.5 }],
      },
      recommended_positioning: [{ angle: "test", supporting_facts: ["fact"] }],
      risks: [],
    };

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test",
      workflowsPath: fileURLToPath(new URL("./workflows", import.meta.url)),
      activities: {
        async markJobRunning() {
          steps.push("running");
        },
        async setJobStep(_id: string, step: string) {
          steps.push(step);
        },
        async findCompetitorsActivity() {
          steps.push("findCompetitors");
          return {
            competitors,
            cost_usd: 0.01,
          };
        },
        async diffFeaturesActivity() {
          steps.push("diffFeatures");
          return { feature_diff, cost_usd: 0.01 };
        },
        async scrapePricingActivity() {
          steps.push("scrapePricing");
          return { pricing, cost_usd: 0.01 };
        },
        async buildPositioningActivity() {
          steps.push("buildPositioning");
          return { positioning, cost_usd: 0.01 };
        },
        async compileReportActivity() {
          steps.push("compileReport");
          return {
            report: {
              pdf_url: "https://example.com/report.pdf",
              object_key: "competitor-research/report.pdf",
            },
            cost_usd: 0.01,
          };
        },
        async completeJob() {
          steps.push("complete");
        },
        async failJob() {
          steps.push("fail");
        },
      },
    });

    const input: CompetitorResearchWorkflowInput = {
      job_id: "00000000-0000-4000-8000-000000000001",
      product_name: "Notion",
      product_url: "https://www.notion.so",
    };

    const result = await worker.runUntil(
      testEnv.client.workflow.execute(competitorResearchWorkflow, {
        workflowId: `test-${Date.now()}`,
        taskQueue: "test",
        args: [input],
      }),
    );

    assert.equal(result.pdf_url, "https://example.com/report.pdf");
    assert.ok(steps.includes("findCompetitors"));
    assert.ok(steps.includes("diffFeatures"));
    assert.ok(steps.includes("scrapePricing"));
    assert.ok(steps.includes("buildPositioning"));
    assert.ok(steps.includes("compileReport"));
    assert.ok(steps.includes("complete"));
    assert.ok(!steps.includes("fail"));

    const findIdx = steps.indexOf("findCompetitors");
    const diffIdx = steps.indexOf("diffFeatures");
    const priceIdx = steps.indexOf("scrapePricing");
    const posIdx = steps.indexOf("buildPositioning");
    assert.ok(findIdx < diffIdx);
    assert.ok(findIdx < priceIdx);
    assert.ok(Math.max(diffIdx, priceIdx) < posIdx);
  });
});
