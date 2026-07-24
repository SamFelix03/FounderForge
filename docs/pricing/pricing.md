# A2MCP list prices (USD per call)

| Service | Price | SLA (minutes) |
|---|---|---|
| promo-video | $2.99 | 15 |
| screen-recording | $4.99 | 30 |
| social-listening | $1.99 | 10 |
| outreach | $2.49 | 15 |
| competitor-research | $4.99 | 20 |
| brand-kit | $3.99 | 15 |
| social-post | $0.99 | 5 |

Source of truth in code: `packages/schemas/src/index.ts` (`SERVICE_MANIFESTS`) and each `services/*/service.manifest.json`.

When changing a price: update both the manifest and the schema constant, then re-submit ASP service metadata via Onchain OS.
