import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDiscoveryDocument } from "./discovery.js";

describe("buildDiscoveryDocument", () => {
  it("includes six paid services and Pattern A protocol", () => {
    const doc = buildDiscoveryDocument({
      baseUrl: "https://example.test",
      agentId: "9733",
      now: new Date("2026-07-27T00:00:00.000Z"),
    });

    assert.equal(doc.schema_version, "1.0.0");
    assert.equal(doc.generated_at, "2026-07-27T00:00:00.000Z");
    assert.equal(doc.asp.agent_id, "9733");
    assert.equal(doc.base_url, "https://example.test");
    assert.equal(doc.protocol.pattern, "A");
    assert.equal(doc.services.length, 6);
    assert.equal(
      doc.services[0]?.endpoint_url,
      "https://example.test/v1/services/promo-video/jobs",
    );
    assert.ok(doc.envelopes.create_job_request);
    assert.equal(doc.protocol.polling.result_url_field, "artifacts[].url");
  });
});
