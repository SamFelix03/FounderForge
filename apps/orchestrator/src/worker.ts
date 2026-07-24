import { NativeConnection, Worker } from "@temporalio/worker";
import { createLogger, loadRootEnv } from "@founderforge/observability";
import { createPool, migrate, getJobStore, PostgresJobStore, setJobStoreForTests } from "@founderforge/db";
import * as activities from "./activities/index.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

loadRootEnv();

const log = createLogger("orchestrator");

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const address = requireEnv("TEMPORAL_ADDRESS", "localhost:7233");
  const namespace = requireEnv("TEMPORAL_NAMESPACE", "default");
  const taskQueue = requireEnv("TEMPORAL_TASK_QUEUE", "founderforge");

  // Durable job updates from activities
  const pool = createPool();
  await migrate(pool);
  setJobStoreForTests(new PostgresJobStore(pool));
  getJobStore();

  const connection = await NativeConnection.connect({ address });
  const workflowsPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "workflows",
  );

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath,
    activities,
  });

  log.info("orchestrator worker started", { address, namespace, taskQueue });
  await worker.run();
}

main().catch((err) => {
  log.error("orchestrator failed", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
