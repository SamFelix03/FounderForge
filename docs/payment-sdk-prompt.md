# Integrate via Prompt

Configure Onchain OS Payment's receiving capability through a prompt. Just send the prompt to your AI; it generates complete 402 integration code — no manual 402 response or transaction verification required.

---

## Prerequisites

- **Recipient wallet**: any EVM-compatible wallet (e.g. [Agentic Wallet](../wallet/agentic-wallet))
- **API key**: apply at the [OKX Developer Portal](https://web3.okx.com/zh-hans/onchainos/dev-portal). 
- **Business backend**: your own API service or backend server

---

## Configuration

Send the prompt below to your AI to generate the full integration code. The weather API used as the example is illustrative:

```text
// TypeScript
Reference https://raw.githubusercontent.com/okx/payments/main/typescript/SELLER.md
// Rust
Reference https://raw.githubusercontent.com/okx/payments/main/rust/x402/SELLER.md
// Go
Reference https://raw.githubusercontent.com/okx/payments/main/go/x402/SELLER.md
// Java
Reference https://raw.githubusercontent.com/okx/payments/main/java/SELLER.md
// Python
Reference https://raw.githubusercontent.com/okx/payments/main/python/x402/SELLER.md

I have a weather API (/weather). Deploy it to localhost:4021 and use onchain-payment-sdk to add charging.
Charge 0.1 USDT per call, network X Layer (eip155:196), recipient 0xMyWalletAddress.
```

> During the run, the AI will prompt you to configure the recipient wallet and API key.

---

## Verify

Hit your paid resource with:

```shell
curl -i http://localhost:4021/weather
```

You should see `402` + `PAYMENT-REQUIRED` headers — that confirms the integration:

```http
HTTP/1.1 402 Payment Required // 402 status code
content-type: application/json
payment-required: eyJ4NDAyVmVy.....jAifX1dfQ== // payment info (base64-encoded)
```

The base64-decoded payment-required payload looks like:

```json
{
  "x402Version": 2,
  "resource": {
    "url": "/weather",
    "description": "Get current weather data for any location",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:196",
      "asset": "0x779ded0c9e1022225f8e0630b35a9b54be713736",
      "amount": "1000",
      "payTo": "0xb483abdb92f8061e9a3a082a4aaaa6b88c381308",
      "maxTimeoutSeconds": 600000,
      "extra": {
        "name": "USD₮0",
        "version": "1"
      }
    },
    {
      "scheme": "aggr_deferred",
      "network": "eip155:196",
      "asset": "0x779ded0c9e1022225f8e0630b35a9b54be713736",
      "amount": "1000",
      "payTo": "0xb483abdb92f8061e9a3a082a4aaaa6b88c381308",
      "maxTimeoutSeconds": 600000,
      "extra": {
        "version": "1",
        "name": "USD₮0"
      }
    }
  ]
}
```