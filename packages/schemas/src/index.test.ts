import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CompetitorResearchInputSchema,
  CreateJobRequestSchema,
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

  it("lists all seven services", () => {
    const names = ServiceNameSchema.options;
    assert.equal(names.length, 7);
    assert.equal(Object.keys(SERVICE_MANIFESTS).length, 7);
  });

  it("defaults create-job priority", () => {
    const parsed = CreateJobRequestSchema.parse({ input: { foo: 1 } });
    assert.equal(parsed.priority, "normal");
  });
});
