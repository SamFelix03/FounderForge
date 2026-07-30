import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractUrls,
  inferServiceFromText,
  isAcceptedX402Task,
  parseActiveTasks,
} from "./tasks.js";
import { buildDeliverableText } from "./bridge.js";

describe("marketplace-bridge tasks", () => {
  it("parses nested providerTasks and filters accepted x402", () => {
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
            jobId: "okx-2",
            status: "submitted",
            paymentMode: 3,
            myRole: "asp",
            agentId: "9733",
          },
        ],
      },
    };
    const tasks = parseActiveTasks(payload, "9733").filter(isAcceptedX402Task);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.jobId, "okx-1");
    assert.deepEqual(extractUrls(tasks[0]!.description!), ["https://linear.app"]);
    assert.equal(inferServiceFromText(tasks[0]!.description!), "social-listening");
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
