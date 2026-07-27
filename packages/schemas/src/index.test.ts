import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CompetitorResearchInputSchema,
  CreateJobRequestSchema,
  OutreachInputSchema,
  BrandKitInputSchema,
  SERVICE_MANIFESTS,
  ServiceNameSchema,
} from "./index.js";

describe("schemas", () => {
  it("parses competitor research input", () => {
    const parsed = CompetitorResearchInputSchema.parse({
      product_name: "Acme",
      product_url: "https://acme.example",
    });
    assert.equal(parsed.product_name, "Acme");
  });

  it("parses outreach input", () => {
    const parsed = OutreachInputSchema.parse({
      website_url: "https://acme.example",
      sheet_url: "https://cdn.example/revenue.xlsx",
    });
    assert.equal(parsed.website_url, "https://acme.example");
  });

  it("parses brand kit input", () => {
    const parsed = BrandKitInputSchema.parse({
      brand_name: "Acme",
      description: "calm productivity tools for makers",
    });
    assert.equal(parsed.brand_name, "Acme");
    assert.equal(parsed.pick, 0);
  });

  it("lists all six live services", () => {
    const names = ServiceNameSchema.options;
    assert.equal(names.length, 6);
    assert.equal(Object.keys(SERVICE_MANIFESTS).length, 6);
    assert.ok(!names.includes("social-post" as never));
  });

  it("defaults create-job priority", () => {
    const parsed = CreateJobRequestSchema.parse({ input: { foo: 1 } });
    assert.equal(parsed.priority, "normal");
  });
});
