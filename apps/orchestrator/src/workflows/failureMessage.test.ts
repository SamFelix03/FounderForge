import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { workflowFailureMessage } from "./failureMessage.js";

describe("workflowFailureMessage", () => {
  it("prefers encoded reddit errors nested under Activity wrappers", () => {
    const root = new Error(
      "[reddit_no_threads] No matching Reddit threads found for trackly.app",
    );
    const outer = new Error("Activity task failed");
    (outer as Error & { cause?: unknown }).cause = root;
    assert.match(workflowFailureMessage(outer), /^\[reddit_no_threads\]/);
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
