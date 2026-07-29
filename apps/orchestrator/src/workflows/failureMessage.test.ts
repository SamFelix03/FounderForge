import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { workflowFailureMessage } from "./failureMessage.js";

describe("workflowFailureMessage", () => {
  it("prefers encoded product_url errors nested under Activity wrappers", () => {
    const root = new Error(
      "[product_url_no_content] Could not extract readable product content from https://trackly.app",
    );
    const mid = new Error("Application failure");
    (mid as Error & { cause?: unknown }).cause = root;
    const outer = new Error("Activity task failed");
    (outer as Error & { cause?: unknown }).cause = mid;

    assert.match(workflowFailureMessage(outer), /^\[product_url_no_content\]/);
  });

  it("rebuilds encoding from ApplicationFailure type when needed", () => {
    const app = new Error("Could not reach https://example.invalid");
    (app as Error & { type?: string }).type = "product_url_unreachable";
    const outer = new Error("Activity task failed");
    (outer as Error & { cause?: unknown }).cause = app;

    assert.equal(
      workflowFailureMessage(outer),
      "[product_url_unreachable] Could not reach https://example.invalid",
    );
  });

  it("falls back to the most useful non-wrapper message", () => {
    const inner = new Error("sheet download failed");
    const outer = new Error("Activity task failed");
    (outer as Error & { cause?: unknown }).cause = inner;
    assert.equal(workflowFailureMessage(outer), "sheet download failed");
  });
});
