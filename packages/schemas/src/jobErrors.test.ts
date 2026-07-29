import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ProductUrlError,
  decodeJobError,
  encodeJobError,
  productUrlErrorFromFetchFailure,
} from "./jobErrors.js";

describe("jobErrors", () => {
  it("encodes and decodes product URL error codes", () => {
    const err = new ProductUrlError(
      "product_url_no_content",
      "Could not extract readable product content from https://trackly.app",
    );
    assert.match(err.message, /^\[product_url_no_content\]/);
    const decoded = decodeJobError(err.message);
    assert.equal(decoded.error_code, "product_url_no_content");
    assert.match(decoded.error ?? "", /trackly\.app/);
  });

  it("leaves plain errors undecoded", () => {
    assert.deepEqual(decodeJobError("Activity task failed"), {
      error: "Activity task failed",
    });
  });

  it("classifies timeout and DNS failures", () => {
    const timeout = productUrlErrorFromFetchFailure(
      "https://example.com",
      new Error("The operation was aborted due to timeout"),
    );
    assert.equal(timeout.code, "product_url_timeout");

    const dns = productUrlErrorFromFetchFailure(
      "https://no-such-host.invalid",
      new Error("getaddrinfo ENOTFOUND no-such-host.invalid"),
    );
    assert.equal(dns.code, "product_url_unreachable");

    const http = productUrlErrorFromFetchFailure(
      "https://example.com",
      new Error("fetch https://example.com failed: 404"),
    );
    assert.equal(http.code, "product_url_http_error");
  });

  it("encodeJobError is stable", () => {
    assert.equal(
      encodeJobError("product_url_invalid", "bad"),
      "[product_url_invalid] bad",
    );
  });
});
