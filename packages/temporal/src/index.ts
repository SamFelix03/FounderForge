/**
 * Shared Temporal connection options for gateway (client) and orchestrator (worker).
 *
 * Local / self-hosted: TEMPORAL_ADDRESS=host:7233 (no TLS).
 * Temporal Cloud: TEMPORAL_ADDRESS=<region>.aws.api.temporal.io:7233
 *                 TEMPORAL_API_KEY=...
 *                 TEMPORAL_NAMESPACE=<namespace>.<account>
 *                 TEMPORAL_TLS=true (implied when API key is set)
 */
export interface TemporalEnvConfig {
  address: string;
  namespace: string;
  taskQueue: string;
  apiKey?: string;
  tls: boolean;
}

export function loadTemporalEnv(
  env: NodeJS.ProcessEnv = process.env,
): TemporalEnvConfig {
  const apiKey = env.TEMPORAL_API_KEY?.trim() || undefined;
  const tlsExplicit = env.TEMPORAL_TLS === "true" || env.TEMPORAL_TLS === "1";
  const tlsOff = env.TEMPORAL_TLS === "false" || env.TEMPORAL_TLS === "0";

  return {
    address: env.TEMPORAL_ADDRESS?.trim() || "localhost:7233",
    namespace: env.TEMPORAL_NAMESPACE?.trim() || "default",
    taskQueue: env.TEMPORAL_TASK_QUEUE?.trim() || "founderforge",
    apiKey,
    // Cloud API keys require TLS. Self-hosted Railway Temporal stays plaintext.
    tls: tlsOff ? false : tlsExplicit || Boolean(apiKey),
  };
}

/** Options accepted by Connection.connect / NativeConnection.connect. */
export function temporalConnectOptions(cfg: TemporalEnvConfig = loadTemporalEnv()) {
  const options: {
    address: string;
    tls?: boolean;
    apiKey?: string;
    metadata?: Record<string, string>;
  } = {
    address: cfg.address,
  };

  if (cfg.tls) {
    options.tls = true;
  }
  if (cfg.apiKey) {
    options.apiKey = cfg.apiKey;
    options.metadata = { "temporal-namespace": cfg.namespace };
  }

  return options;
}
