import { NativeConnection, Worker } from "@temporalio/worker";
import { createLogger, loadRootEnv } from "@founderforge/observability";
import { createPool, migrate, getJobStore, PostgresJobStore, setJobStoreForTests } from "@founderforge/db";
import {
  loadTemporalEnv,
  temporalConnectOptions,
} from "@founderforge/temporal";
import * as activities from "./activities/index.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

loadRootEnv();

const log = createLogger("orchestrator");

async function main() {
  const cfg = loadTemporalEnv();

  // Durable job updates from activities
  const pool = createPool();
  await migrate(pool);
  setJobStoreForTests(new PostgresJobStore(pool));
  getJobStore();

  const connection = await NativeConnection.connect(temporalConnectOptions(cfg));
  const workflowsPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "workflows",
  );

  const worker = await Worker.create({
    connection,
    namespace: cfg.namespace,
    taskQueue: cfg.taskQueue,
    workflowsPath,
    activities,
  });

  log.info("orchestrator worker started", {
    address: cfg.address,
    namespace: cfg.namespace,
    taskQueue: cfg.taskQueue,
    tls: cfg.tls,
  });
  await worker.run();
}

main().catch((err) => {
  log.error("orchestrator failed", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
