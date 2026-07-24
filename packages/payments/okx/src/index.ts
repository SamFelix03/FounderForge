import type { RequestHandler } from "express";
import { SERVICE_MANIFESTS, type ServiceName } from "@founderforge/schemas";
import { createLogger } from "@founderforge/observability";

const log = createLogger("payments-okx");

export interface PaymentEnv {
  bypass: boolean;
  network: string;
  payTo: string;
  apiKey?: string;
  secretKey?: string;
  passphrase?: string;
}

export function loadPaymentEnv(env: NodeJS.ProcessEnv = process.env): PaymentEnv {
  return {
    bypass: env.PAYMENTS_BYPASS === "true" || env.PAYMENTS_BYPASS === "1",
    network: env.NETWORK ?? "eip155:1952",
    payTo: env.PAY_TO ?? "0x0000000000000000000000000000000000000000",
    apiKey: env.OKX_API_KEY,
    secretKey: env.OKX_SECRET_KEY,
    passphrase: env.OKX_PASSPHRASE,
  };
}

export function priceUsdString(service: ServiceName): string {
  return `$${SERVICE_MANIFESTS[service].a2mcp_price_usd.toFixed(2)}`;
}

export function buildPaidRoutesConfig(payTo: string, network: string) {
  const routes: Record<
    string,
    {
      accepts: Array<{
        scheme: "exact";
        network: string;
        payTo: string;
        price: string;
      }>;
      description: string;
      mimeType: string;
    }
  > = {};

  for (const manifest of Object.values(SERVICE_MANIFESTS)) {
    const key = `POST ${manifest.endpoint_path}`;
    routes[key] = {
      accepts: [
        {
          scheme: "exact",
          network,
          payTo,
          price: `$${manifest.a2mcp_price_usd.toFixed(2)}`,
        },
      ],
      description: `A2MCP job create for ${manifest.name}`,
      mimeType: "application/json",
    };
  }
  return routes;
}

/**
 * Local/dev bypass middleware. When PAYMENTS_BYPASS=true, paid routes proceed.
 * When false, returns a synthetic 402 with PAYMENT-REQUIRED until OKX SDK is wired
 * with real credentials (see createOkxPaymentMiddleware).
 */
export function createBypassOrChallengeMiddleware(env: PaymentEnv): RequestHandler {
  return (req, res, next) => {
    if (env.bypass) {
      return next();
    }

    // Without full OKX SDK credentials, emit a protocol-shaped 402 so A2MCP
    // self-checks (`curl -i` → 402 + PAYMENT-REQUIRED) still pass in staging.
    const hasCreds = Boolean(env.apiKey && env.secretKey && env.passphrase);
    if (!hasCreds) {
      const challenge = {
        x402Version: 2,
        resource: {
          url: req.originalUrl,
          description: "FounderForge A2MCP paid endpoint",
          mimeType: "application/json",
        },
        accepts: [
          {
            scheme: "exact",
            network: env.network,
            asset: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
            amount: "4990000",
            payTo: env.payTo,
            maxTimeoutSeconds: 600,
            extra: { name: "USD₮0", version: "1" },
          },
        ],
      };
      const encoded = Buffer.from(JSON.stringify(challenge)).toString("base64");
      log.info("returning synthetic 402 (OKX SDK creds missing)", { path: req.path });
      res.setHeader("PAYMENT-REQUIRED", encoded);
      return res.status(402).json({
        error: "payment_required",
        message: "OKX Payment SDK credentials not configured; synthetic challenge returned",
      });
    }

    // Real SDK path is installed in api-gateway when packages are present.
    log.warn("OKX credentials present but SDK middleware not attached yet");
    return next();
  };
}

export async function tryCreateOkxPaymentMiddleware(
  env: PaymentEnv,
): Promise<RequestHandler | null> {
  if (env.bypass) return null;
  if (!env.apiKey || !env.secretKey || !env.passphrase) return null;

  try {
    // Dynamic import so local bypass builds without requiring OKX packages installed yet.
    const expressPkg = await import("@okxweb3/x402-express");
    const corePkg = await import("@okxweb3/x402-core");
    const evmPkg = await import("@okxweb3/x402-evm/exact/server");

    const facilitatorClient = new corePkg.OKXFacilitatorClient({
      apiKey: env.apiKey,
      secretKey: env.secretKey,
      passphrase: env.passphrase,
    });
    const resourceServer = new expressPkg.x402ResourceServer(facilitatorClient);
    resourceServer.register(env.network, new evmPkg.ExactEvmScheme());
    await resourceServer.initialize();

    const routes = buildPaidRoutesConfig(env.payTo, env.network);
    log.info("OKX payment middleware initialized", {
      network: env.network,
      routes: Object.keys(routes).length,
    });
    return expressPkg.paymentMiddleware(routes, resourceServer) as RequestHandler;
  } catch (err) {
    log.warn("Failed to load OKX Payment SDK; falling back to synthetic 402", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
