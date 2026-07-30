import { loadRootEnv } from "@founderforge/observability";
loadRootEnv();

import { createPool, migrate, setJobStoreForTests, PostgresJobStore } from "@founderforge/db";
import { createLogger } from "@founderforge/observability";
import { loadBridgeConfig } from "./config.js";
import { MarketplaceBridge } from "./bridge.js";

const log = createLogger("marketplace-bridge");

async function main() {
  const cfg = loadBridgeConfig();
  const pool = createPool();
  await migrate(pool);
  setJobStoreForTests(new PostgresJobStore(pool));

  const bridge = new MarketplaceBridge(cfg);
  log.info("marketplace bridge starting", {
    api_base: cfg.apiBase,
    asp_agent_id: cfg.aspAgentId,
    poll_interval_ms: cfg.pollIntervalMs,
    dry_run: cfg.dryRun,
  });

  const run = async () => {
    try {
      await bridge.tick();
    } catch (err) {
      log.error("bridge tick crashed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  await run();
  setInterval(() => {
    void run();
  }, Math.max(5_000, cfg.pollIntervalMs));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
