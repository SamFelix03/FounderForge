import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPaidRoutesConfig,
  loadPaymentEnv,
  priceUsdString,
} from "./index.js";

describe("payments-okx", () => {
  it("loads bypass from env", () => {
    const env = loadPaymentEnv({ PAYMENTS_BYPASS: "true" });
    assert.equal(env.bypass, true);
  });

  it("builds seven paid POST routes", () => {
    const routes = buildPaidRoutesConfig("0xabc", "eip155:1952");
    assert.equal(Object.keys(routes).length, 7);
    assert.ok(routes["POST /v1/services/competitor-research/jobs"]);
    assert.equal(
      routes["POST /v1/services/competitor-research/jobs"]?.accepts[0]?.price,
      "$4.99",
    );
  });

  it("formats competitor research price", () => {
    assert.equal(priceUsdString("competitor-research"), "$4.99");
  });
});
