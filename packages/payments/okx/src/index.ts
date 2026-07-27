import type { RequestHandler } from "express";
import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import type { RoutesConfig } from "@okxweb3/x402-core/http";
import {
  paymentMiddlewareFromHTTPServer,
  x402HTTPResourceServer,
  x402ResourceServer,
  type Network,
} from "@okxweb3/x402-express";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { SERVICE_MANIFESTS, type ServiceName } from "@founderforge/schemas";
import { createLogger } from "@founderforge/observability";

const log = createLogger("payments-okx");

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const SUPPORTED_NETWORKS = new Set<Network>(["eip155:196", "eip155:1952"]);

export type XLayerNetwork = "eip155:196" | "eip155:1952";

export interface PaymentEnv {
  /** Local/test only: skip mounting OKX payment middleware. */
  bypass: boolean;
  network: XLayerNetwork;
  payTo: string;
  apiKey: string;
  secretKey: string;
  passphrase: string;
  /** Wait for on-chain confirmation before delivering the paid response. */
  syncSettle: boolean;
}

export interface OkxPaymentProtection {
  middleware: RequestHandler;
  /** Must run after `app.listen`, before serving paid traffic. */
  initialize: () => Promise<void>;
  network: string;
  payTo: string;
  routeCount: number;
}

function parseNetwork(raw: string | undefined): XLayerNetwork {
  const network = (raw?.trim() || "eip155:1952") as Network;
  if (!SUPPORTED_NETWORKS.has(network)) {
    throw new Error(
      `NETWORK must be eip155:196 (X Layer mainnet) or eip155:1952 (testnet). Got "${network}".`,
    );
  }
  return network as XLayerNetwork;
}

export function loadPaymentEnv(env: NodeJS.ProcessEnv = process.env): PaymentEnv {
  return {
    bypass: env.PAYMENTS_BYPASS === "true" || env.PAYMENTS_BYPASS === "1",
    network: parseNetwork(env.NETWORK),
    payTo: env.PAY_TO?.trim() || "",
    apiKey: env.OKX_API_KEY?.trim() || "",
    secretKey: env.OKX_SECRET_KEY?.trim() || "",
    passphrase: env.OKX_PASSPHRASE?.trim() || "",
    syncSettle: env.OKX_SYNC_SETTLE !== "false" && env.OKX_SYNC_SETTLE !== "0",
  };
}

export function priceUsdString(service: ServiceName): string {
  return `$${SERVICE_MANIFESTS[service].a2mcp_price_usd.toFixed(2)}`;
}

export function buildPaidRoutesConfig(payTo: string, network: XLayerNetwork): RoutesConfig {
  const routes: RoutesConfig = {};

  for (const manifest of Object.values(SERVICE_MANIFESTS)) {
    const key = `POST ${manifest.endpoint_path}`;
    routes[key] = {
      accepts: {
        scheme: "exact",
        network,
        payTo,
        price: `$${manifest.a2mcp_price_usd.toFixed(2)}`,
        maxTimeoutSeconds: 600,
      },
      description: `A2MCP job create for ${manifest.name}`,
      mimeType: "application/json",
    };
  }
  return routes;
}

function assertPaymentEnv(env: PaymentEnv): void {
  const missing: string[] = [];
  if (!env.apiKey) missing.push("OKX_API_KEY");
  if (!env.secretKey) missing.push("OKX_SECRET_KEY");
  if (!env.passphrase) missing.push("OKX_PASSPHRASE");
  if (!env.payTo) missing.push("PAY_TO");
  if (missing.length > 0) {
    throw new Error(
      `OKX Payment SDK requires ${missing.join(", ")}. Set them in .env before starting the gateway.`,
    );
  }
  if (!EVM_ADDRESS.test(env.payTo)) {
    throw new Error(
      `PAY_TO must be an EVM address (0x + 40 hex). Got "${env.payTo.slice(0, 12)}…" — Agentic Wallet IDs (e.g. XKO…) are not valid payTo.`,
    );
  }
  if (!SUPPORTED_NETWORKS.has(env.network)) {
    throw new Error(
      `NETWORK must be eip155:196 (X Layer mainnet) or eip155:1952 (testnet). Got "${env.network}".`,
    );
  }
}

/**
 * Official OKX fixed-price seller wiring (ExactEvmScheme + Express adapter).
 * See: https://raw.githubusercontent.com/okx/payments/main/typescript/SELLER.md
 */
export function createOkxPaymentProtection(env: PaymentEnv = loadPaymentEnv()): OkxPaymentProtection {
  assertPaymentEnv(env);

  const facilitatorClient = new OKXFacilitatorClient({
    apiKey: env.apiKey,
    secretKey: env.secretKey,
    passphrase: env.passphrase,
    syncSettle: env.syncSettle,
  });

  const resourceServer = new x402ResourceServer(facilitatorClient).register(
    env.network,
    new ExactEvmScheme(),
  );

  const routes = buildPaidRoutesConfig(env.payTo, env.network);
  const httpServer = new x402HTTPResourceServer(resourceServer, routes);

  const middleware = paymentMiddlewareFromHTTPServer(httpServer, {
    appName: "FounderForge",
    testnet: env.network === "eip155:1952",
  }) as RequestHandler;

  log.info("OKX payment protection created", {
    network: env.network,
    payTo: env.payTo,
    routes: Object.keys(routes).length,
    syncSettle: env.syncSettle,
  });

  return {
    middleware,
    initialize: async () => {
      await resourceServer.initialize();
      log.info("OKX resource server initialized", { network: env.network });
    },
    network: env.network,
    payTo: env.payTo,
    routeCount: Object.keys(routes).length,
  };
}
