import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractMarketplaceIds,
  normalizeCreateJobBody,
} from "./normalizeBody.js";

describe("normalizeCreateJobBody", () => {
  it("leaves nested input untouched", () => {
    const body = { input: { product_url: "https://linear.app" }, priority: "high" };
    assert.deepEqual(normalizeCreateJobBody(body), body);
  });

  it("wraps flattened product_url bodies", () => {
    assert.deepEqual(
      normalizeCreateJobBody({
        product_url: "https://tasknest.app",
        max_posts: 5,
        priority: "normal",
      }),
      {
        priority: "normal",
        input: { product_url: "https://tasknest.app", max_posts: 5 },
      },
    );
  });

  it("preserves marketplace meta when flattening", () => {
    assert.deepEqual(
      normalizeCreateJobBody({
        product_url: "https://linear.app",
        marketplace: { job_id: "okx-9", agent_id: "9733" },
      }),
      {
        marketplace: { job_id: "okx-9", agent_id: "9733" },
        input: { product_url: "https://linear.app" },
      },
    );
  });

  it("parses stringified input JSON", () => {
    assert.deepEqual(
      normalizeCreateJobBody({
        input: JSON.stringify({ product_url: "https://linear.app" }),
      }),
      { input: { product_url: "https://linear.app" } },
    );
  });
});

describe("extractMarketplaceIds", () => {
  it("reads body marketplace and header fallbacks", () => {
    assert.deepEqual(
      extractMarketplaceIds(
        { marketplace: { job_id: "from-body", agent_id: "9733" } },
        { get: () => null },
      ),
      { marketplace_job_id: "from-body", marketplace_agent_id: "9733" },
    );
    assert.deepEqual(
      extractMarketplaceIds(
        {},
        {
          get: (name: string) =>
            name.toLowerCase() === "x-okx-job-id" ? "from-header" : null,
        },
      ),
      { marketplace_job_id: "from-header" },
    );
  });
});
