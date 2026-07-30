import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractUrls,
  inferServiceFromText,
  isAcceptedMarketplaceTask,
  isAcceptedX402Task,
  parseActiveTasks,
} from "./tasks.js";
import { buildDeliverableText } from "./bridge.js";

describe("marketplace-bridge tasks", () => {
  it("parses nested providerTasks and keeps accepted x402 + escrow", () => {
    const payload = {
      data: {
        providerTasks: [
          {
            jobId: "okx-1",
            status: 1,
            paymentMode: 3,
            myRole: "asp",
            agentId: "9733",
            description: "Run social-listening for https://linear.app",
          },
          {
            jobId: "okx-escrow",
            status: 1,
            paymentMode: 1,
            myRole: "asp",
            agentId: "9733",
            description: "Escrow Reddit pack for https://notion.so",
          },
          {
            jobId: "okx-2",
            status: "submitted",
            paymentMode: 3,
            myRole: "asp",
            agentId: "9733",
          },
        ],
      },
    };
    const all = parseActiveTasks(payload, "9733");
    const tracked = all.filter(isAcceptedMarketplaceTask);
    assert.equal(tracked.length, 2);
    assert.deepEqual(
      tracked.map((t) => t.jobId).sort(),
      ["okx-1", "okx-escrow"],
    );
    const x402Only = all.filter(isAcceptedX402Task);
    assert.equal(x402Only.length, 1);
    assert.equal(x402Only[0]?.jobId, "okx-1");
    assert.deepEqual(extractUrls(tracked[0]!.description!), ["https://linear.app"]);
    assert.equal(inferServiceFromText(tracked[0]!.description!), "social-listening");
  });

  it("builds failure deliverable text with error_code", () => {
    const text = buildDeliverableText({
      id: "11111111-1111-1111-1111-111111111111",
      service: "social-listening",
      status: "failed",
      error: "unreachable",
      error_code: "product_url_unreachable",
    });
    assert.match(text, /product_url_unreachable/);
    assert.match(text, /failed/);
  });
});
