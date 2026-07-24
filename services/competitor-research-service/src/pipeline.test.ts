import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadRootEnv } from "@founderforge/observability";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPipeline } from "./pipeline.js";

loadRootEnv(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."));

describe("competitor-research pipeline", () => {
  it("runs with test fixtures for discovery and uploads a real PDF URL", async () => {
    assert.ok(
      process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
      "SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required for pipeline PDF upload test",
    );

    const result = await runPipeline(
      {
        product_name: "Notion",
        product_url: "https://www.notion.so",
      },
      { stub: true },
    );

    assert.ok(result.competitors.length >= 1);
    assert.ok(result.feature_diff.features.length >= 1);
    assert.ok(result.pricing.product_pricing.tiers.length >= 1);
    assert.ok(result.positioning.recommended_positioning.length >= 1);
    assert.ok(result.report.pdf_url.startsWith("http"));
    assert.ok(result.cost_breakdown.length >= 4);
  });
});
