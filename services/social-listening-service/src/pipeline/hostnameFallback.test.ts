import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Mirror pipeline hostname helper behavior via a tiny inline copy for unit isolation.
function productNameFromUrl(websiteUrl: string): string | null {
  try {
    const host = new URL(websiteUrl).hostname.replace(/^www\./i, "");
    const label = host.split(".")[0]?.trim();
    if (!label || label.length < 2) return null;
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return null;
  }
}

describe("productNameFromUrl", () => {
  it("derives Tasknest from https://tasknest.app/", () => {
    assert.equal(productNameFromUrl("https://tasknest.app/"), "Tasknest");
  });

  it("strips www", () => {
    assert.equal(productNameFromUrl("https://www.linear.app"), "Linear");
  });
});
