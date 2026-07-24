import { loadRootEnv } from "@founderforge/observability";
import path from "node:path";
import { fileURLToPath } from "node:url";

loadRootEnv(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."));

import { createPool, closePool } from "./pool.js";
import { migrate } from "./migrate.js";

const pool = createPool();
await migrate(pool);
await closePool();
console.log("migrations complete");
