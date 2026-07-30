export type BridgeConfig = {
  apiBase: string;
  aspAgentId: string;
  onchainosBin: string;
  pollIntervalMs: number;
  correlateWithinMs: number;
  dryRun: boolean;
};

export function loadBridgeConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const apiBase = (
    env.FOUNDERFORGE_API_BASE ??
    env.PUBLIC_BASE_URL ??
    "https://founderforge-api-production.up.railway.app"
  ).replace(/\/$/, "");

  return {
    apiBase,
    aspAgentId: (env.ASP_AGENT_ID ?? "9733").trim(),
    onchainosBin: (env.ONCHAINOS ?? "onchainos").trim(),
    pollIntervalMs: Number(env.BRIDGE_POLL_INTERVAL_MS ?? 20_000),
    correlateWithinMs: Number(env.BRIDGE_CORRELATE_WITHIN_MS ?? 2 * 60 * 60 * 1000),
    dryRun: env.BRIDGE_DRY_RUN === "1" || env.BRIDGE_DRY_RUN === "true",
  };
}
