/**
 * Load repo-root .env into process.env (does not override already-set vars).
 * Tiny helper so we don't require dotenv for production containers that inject env.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function loadRootEnv(fromDir = process.cwd()): void {
  const candidates = [
    path.join(fromDir, ".env"),
    path.resolve(fromDir, "../../.env"),
    path.resolve(fromDir, "../../../.env"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../.env"),
  ];

  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
    return;
  }
}
