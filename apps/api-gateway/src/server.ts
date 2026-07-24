import { loadRootEnv } from "@founderforge/observability";
loadRootEnv();

import { createApp } from "./app.js";
import { createLogger } from "@founderforge/observability";

const log = createLogger("api-gateway");
const port = Number(process.env.PORT ?? 4021);

const app = await createApp();
app.listen(port, () => {
  log.info("listening", {
    port,
    payments_bypass: process.env.PAYMENTS_BYPASS ?? "unset",
    temporal: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
    database: Boolean(process.env.DATABASE_URL),
  });
});
