import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "@founderforge/observability";
import { fetchPageJina } from "./index.js";

loadRootEnv(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."));

describe("fetchPageJina", () => {
  it("returns fixture markdown when stub:true", async () => {
    const result = await fetchPageJina({
      url: "https://example.com/pricing",
      stub: true,
    });
    assert.equal(result.meta.vendor, "test-fixture");
    assert.ok(result.data.text.includes("Pricing") || result.data.text.includes("$"));
  });

  it("fetches live markdown via authenticated Jina Reader POST", async () => {
    assert.ok(process.env.JINA_API_KEY, "JINA_API_KEY required for live Jina test");

    const result = await fetchPageJina({ url: "https://linear.app/pricing" });
    assert.equal(result.meta.vendor, "jina-reader");
    assert.ok(result.data.text.length > 200, "expected substantial markdown content");
    assert.match(result.data.text, /price|plan|free|\$|tier/i);
    assert.ok(!result.data.text.includes("<html"), "should be markdown, not raw HTML");
  });
});
