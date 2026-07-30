import { Connection } from "@temporalio/client";
import {
  loadTemporalEnv,
  temporalConnectOptions,
} from "@founderforge/temporal";

export type TemporalHealth = {
  ok: boolean;
  address: string;
  namespace: string;
  error?: string;
};

/** Best-effort Temporal reachability for /health (does not cache failures). */
export async function probeTemporal(timeoutMs = 2500): Promise<TemporalHealth> {
  const cfg = loadTemporalEnv();
  const base = {
    address: cfg.address,
    namespace: cfg.namespace,
  };
  try {
    const connection = await Promise.race([
      Connection.connect(temporalConnectOptions(cfg)),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("temporal_probe_timeout")), timeoutMs),
      ),
    ]);
    await connection.close();
    return { ok: true, ...base };
  } catch (err) {
    return {
      ok: false,
      ...base,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
