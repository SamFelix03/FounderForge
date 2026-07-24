import { createLogger } from "@founderforge/observability";

const log = createLogger("ops-dashboard");

/** Placeholder for approval queue UI / Telegram bot later. */
export function listPendingApprovals(): [] {
  return [];
}

async function main() {
  log.info("ops-dashboard stub ready", {
    pending: listPendingApprovals().length,
  });
  if (process.env.OPS_DASHBOARD_IDLE !== "0") {
    setInterval(() => log.debug("ops-dashboard heartbeat"), 60_000);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
