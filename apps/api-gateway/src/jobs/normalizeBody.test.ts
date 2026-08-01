import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractMarketplaceIds,
  mergeJobCreateSources,
  normalizeCreateJobBody,
} from "./normalizeBody.js";

describe("normalizeCreateJobBody", () => {
  it("leaves nested input untouched when no flat siblings", () => {
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

  it("merges flat siblings into empty input object", () => {
    assert.deepEqual(
      normalizeCreateJobBody({
        input: {},
        product_url: "https://example.com",
        product_name: "Example",
        max_posts: 5,
      }),
      {
        input: {
          product_url: "https://example.com",
          product_name: "Example",
          max_posts: 5,
        },
      },
    );
  });

  it("unwraps params wrapper used by some clients", () => {
    assert.deepEqual(
      normalizeCreateJobBody({
        params: { product_url: "https://example.com", max_posts: 3 },
      }),
      { input: { product_url: "https://example.com", max_posts: 3 } },
    );
  });

  it("parses serviceParams key=value string", () => {
    assert.deepEqual(
      normalizeCreateJobBody({
        serviceParams: "product_url=https://example.com max_posts=3",
      }),
      { input: { product_url: "https://example.com", max_posts: 3 } },
    );
  });
});

describe("mergeJobCreateSources", () => {
  it("prefers body over query and recovers query-only params", () => {
    assert.deepEqual(
      mergeJobCreateSources(
        {},
        { product_url: "https://from-query.example", max_posts: "5" },
      ),
      { product_url: "https://from-query.example", max_posts: "5" },
    );
    assert.deepEqual(
      mergeJobCreateSources(
        { product_url: "https://from-body.example" },
        { product_url: "https://from-query.example", max_posts: "2" },
      ),
      { product_url: "https://from-body.example", max_posts: "2" },
    );
  });

  it("end-to-end: empty body + query flattens to input", () => {
    const merged = mergeJobCreateSources(
      {},
      {
        product_url: "https://example.com",
        product_name: "Example",
        max_posts: "5",
      },
    );
    assert.deepEqual(normalizeCreateJobBody(merged), {
      input: {
        product_url: "https://example.com",
        product_name: "Example",
        max_posts: 5,
      },
    });
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
