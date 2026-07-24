import express, { type Express } from "express";
import { createLogger } from "@founderforge/observability";
import {
  createBypassOrChallengeMiddleware,
  loadPaymentEnv,
  tryCreateOkxPaymentMiddleware,
} from "@founderforge/payments-okx";
import { createPool, migrate, getJobStore, setJobStoreForTests, PostgresJobStore } from "@founderforge/db";
import { jobsRouter } from "./routes/jobs.js";
import { idempotencyMiddleware } from "./middleware/idempotency.js";

const log = createLogger("api-gateway");

export interface CreateAppOptions {
  /** Skip DB migrate (tests that inject a store). */
  skipMigrate?: boolean;
  jobStore?: PostgresJobStore;
}

export async function createApp(opts: CreateAppOptions = {}): Promise<Express> {
  if (opts.jobStore) {
    setJobStoreForTests(opts.jobStore);
  } else if (!opts.skipMigrate) {
    const pool = createPool();
    await migrate(pool);
    setJobStoreForTests(new PostgresJobStore(pool));
    getJobStore();
    log.info("postgres job store ready");
  }

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(idempotencyMiddleware);

  const paymentEnv = loadPaymentEnv();
  const okxMiddleware = await tryCreateOkxPaymentMiddleware(paymentEnv);
  if (okxMiddleware) {
    app.use(okxMiddleware);
    log.info("OKX payment middleware attached");
  } else {
    app.use(createBypassOrChallengeMiddleware(paymentEnv));
    log.info("payment bypass/challenge middleware attached", {
      bypass: paymentEnv.bypass,
    });
  }

  app.use(jobsRouter);

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    log.error("unhandled error", {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
