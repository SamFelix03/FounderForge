declare module "@okxweb3/x402-express" {
  export class x402ResourceServer {
    constructor(facilitator: unknown);
    register(network: string, scheme: unknown): this;
    initialize(): Promise<void>;
  }
  export function paymentMiddleware(routes: unknown, server: unknown): unknown;
}

declare module "@okxweb3/x402-core" {
  export class OKXFacilitatorClient {
    constructor(config: {
      apiKey: string;
      secretKey: string;
      passphrase: string;
    });
  }
}

declare module "@okxweb3/x402-evm/exact/server" {
  export class ExactEvmScheme {
    constructor();
  }
}
