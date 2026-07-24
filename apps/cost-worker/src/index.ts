import { createLogger } from "@founderforge/observability";

const log = createLogger("cost-worker");

/** Aggregates internal COGS events for margin alerts (not on-chain). */
export function summarizeCosts(
  lines: Array<{ amount_usd: number }>,
): { total_usd: number; count: number } {
  return {
    total_usd: Number(lines.reduce((s, l) => s + l.amount_usd, 0).toFixed(6)),
    count: lines.length,
  };
}

async function main() {
  const sample = summarizeCosts([{ amount_usd: 0.1 }, { amount_usd: 0.25 }]);
  log.info("cost-worker ready", sample);
  if (process.env.COST_WORKER_IDLE !== "0") {
    setInterval(() => log.debug("cost-worker heartbeat"), 60_000);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
