import express, { type Express, type RequestHandler } from "express";
import { createLogger } from "@founderforge/observability";
import {
  createOkxPaymentProtection,
  loadPaymentEnv,
  type OkxPaymentProtection,
} from "@founderforge/payments-okx";
import { createPool, migrate, getJobStore, setJobStoreForTests, PostgresJobStore } from "@founderforge/db";
import { jobsRouter } from "./routes/jobs.js";
import { idempotencyMiddleware } from "./middleware/idempotency.js";

const log = createLogger("api-gateway");

export interface CreateAppOptions {
  /** Skip DB migrate (tests that inject a store). */
  skipMigrate?: boolean;
  jobStore?: PostgresJobStore;
  /**
   * Force-skip OKX middleware (unit tests). Prefer PAYMENTS_BYPASS=true for local runs.
   * When payments are enabled, missing/invalid OKX config throws at startup.
   */
  skipPayments?: boolean;
}

export interface AppWithPayments {
  app: Express;
  /** Call after listen when OKX middleware is attached. */
  initializePayments?: () => Promise<void>;
  payments?: OkxPaymentProtection;
}

export async function createApp(opts: CreateAppOptions = {}): Promise<Express> {
  const { app } = await createAppWithPayments(opts);
  return app;
}

export async function createAppWithPayments(
  opts: CreateAppOptions = {},
): Promise<AppWithPayments> {
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
  // Railway (and most PaaS) terminate TLS at the proxy. Without this, Express
  // sees plain HTTP and the OKX x402 middleware embeds http:// in PAYMENT-REQUIRED.
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "1mb" }));
  app.use(idempotencyMiddleware);

  const paymentEnv = loadPaymentEnv();
  const skipPayments = opts.skipPayments === true || paymentEnv.bypass;

  let payments: OkxPaymentProtection | undefined;
  if (skipPayments) {
    log.warn("OKX payment middleware skipped (PAYMENTS_BYPASS or skipPayments)");
  } else {
    payments = createOkxPaymentProtection(paymentEnv);
    app.use(payments.middleware as RequestHandler);
    log.info("OKX payment middleware attached", {
      network: payments.network,
      payTo: payments.payTo,
      routes: payments.routeCount,
    });
  }

  app.use(jobsRouter);

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    log.error("unhandled error", {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: "internal_error" });
  });

  return {
    app,
    payments,
    initializePayments: payments ? () => payments!.initialize() : undefined,
  };
}
