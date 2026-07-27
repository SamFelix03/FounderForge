import { loadRootEnv } from "@founderforge/observability";
loadRootEnv();

import { createAppWithPayments } from "./app.js";
import { createLogger } from "@founderforge/observability";

const log = createLogger("api-gateway");
const port = Number(process.env.PORT ?? 4021);

const { app, initializePayments, payments } = await createAppWithPayments();

app.listen(port, async () => {
  if (initializePayments) {
    await initializePayments();
  }
  log.info("listening", {
    port,
    payments: payments
      ? { network: payments.network, routes: payments.routeCount }
      : "bypassed",
    temporal: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
    database: Boolean(process.env.DATABASE_URL),
  });
});
