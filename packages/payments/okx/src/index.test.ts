import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPaidRoutesConfig,
  createOkxPaymentProtection,
  loadPaymentEnv,
  priceUsdString,
} from "./index.js";

describe("payments-okx", () => {
  it("loads bypass from env", () => {
    const env = loadPaymentEnv({ PAYMENTS_BYPASS: "true" });
    assert.equal(env.bypass, true);
  });

  it("builds six paid POST routes with exact scheme", () => {
    const routes = buildPaidRoutesConfig(
      "0x0000000000000000000000000000000000000001",
      "eip155:1952",
    );
    assert.equal(typeof routes, "object");
    const route = (routes as Record<string, { accepts: { scheme: string; price: string; network: string } }>)[
      "POST /v1/services/competitor-research/jobs"
    ];
    assert.ok(route);
    assert.equal(route.accepts.scheme, "exact");
    assert.equal(route.accepts.price, "$1.00");
    assert.equal(route.accepts.network, "eip155:1952");
    assert.equal(Object.keys(routes as object).length, 6);
    assert.equal(
      (routes as Record<string, unknown>)["POST /v1/services/social-post/jobs"],
      undefined,
    );
  });

  it("formats competitor research price", () => {
    assert.equal(priceUsdString("competitor-research"), "$1.00");
  });

  it("rejects missing credentials instead of falling back", () => {
    assert.throws(
      () =>
        createOkxPaymentProtection({
          bypass: false,
          network: "eip155:1952",
          payTo: "0x0000000000000000000000000000000000000001",
          apiKey: "",
          secretKey: "s",
          passphrase: "p",
          syncSettle: true,
        }),
      /OKX_API_KEY/,
    );
  });

  it("rejects non-EVM PAY_TO (e.g. XKO agent ids)", () => {
    assert.throws(
      () =>
        createOkxPaymentProtection({
          bypass: false,
          network: "eip155:1952",
          payTo: "XKO800657b40b5ac9fd327bec09eb2b974d5f136350",
          apiKey: "k",
          secretKey: "s",
          passphrase: "p",
          syncSettle: true,
        }),
      /EVM address/,
    );
  });
});
