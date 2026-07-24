import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "@founderforge/observability";
import { createPool, closePool, resetPoolForTests } from "./pool.js";
import { migrate } from "./migrate.js";
import { PostgresJobStore } from "./jobs.js";

loadRootEnv(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."));

const hasDb = Boolean(process.env.DATABASE_URL?.trim());

describe("PostgresJobStore", { skip: !hasDb }, () => {
  let store: PostgresJobStore;

  before(async () => {
    await resetPoolForTests();
    const pool = createPool();
    await migrate(pool);
    store = new PostgresJobStore(pool);
  });

  after(async () => {
    await closePool();
  });

  it("creates, reads, and updates a job durably", async () => {
    const key = `test-${Date.now()}`;
    const created = await store.create(
      "competitor-research",
      { input: { product_name: "Linear" }, priority: "normal" },
      key,
    );
    assert.equal(created.status, "queued");
    assert.equal(created.list_price_usd, 4.99);

    const again = await store.create(
      "competitor-research",
      { input: { product_name: "Other" }, priority: "normal" },
      key,
    );
    assert.equal(again.id, created.id);

    const updated = await store.update(created.id, {
      status: "completed",
      artifacts: [
        {
          type: "report_pdf",
          url: "https://example.com/report.pdf",
          mime_type: "application/pdf",
        },
      ],
      step: "done",
    });
    assert.equal(updated.status, "completed");
    assert.equal(updated.artifacts[0]?.url, "https://example.com/report.pdf");

    const fetched = await store.get(created.id);
    assert.ok(fetched);
    assert.equal(fetched.status, "completed");
  });
});
