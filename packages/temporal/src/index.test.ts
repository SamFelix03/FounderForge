import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadTemporalEnv, temporalConnectOptions } from "./index.js";

describe("temporal connect options", () => {
  it("defaults to local plaintext", () => {
    const cfg = loadTemporalEnv({
      TEMPORAL_ADDRESS: "localhost:7233",
    });
    assert.equal(cfg.tls, false);
    assert.equal(cfg.taskQueue, "founderforge");
    const opts = temporalConnectOptions(cfg);
    assert.equal(opts.address, "localhost:7233");
    assert.equal(opts.tls, undefined);
    assert.equal(opts.apiKey, undefined);
  });

  it("enables TLS when API key is set (Temporal Cloud)", () => {
    const cfg = loadTemporalEnv({
      TEMPORAL_ADDRESS: "us-west-2.aws.api.temporal.io:7233",
      TEMPORAL_NAMESPACE: "prod.abcde",
      TEMPORAL_API_KEY: "secret",
    });
    assert.equal(cfg.tls, true);
    const opts = temporalConnectOptions(cfg);
    assert.equal(opts.tls, true);
    assert.equal(opts.apiKey, "secret");
    assert.equal(opts.metadata?.["temporal-namespace"], "prod.abcde");
  });
});
