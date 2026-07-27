# ASP onboarding checklist

1. Install Onchain OS: `npx skills add okx/onchainos-skills --yes -g`
2. Log in to Agentic Wallet with your email
3. Deploy `api-gateway` on public HTTPS (Singapore/Tokyo/US if calling LLM vendors)
4. Verify paid endpoint:
   ```bash
   curl -i -X POST https://YOUR_DOMAIN/v1/services/competitor-research/jobs
   # expect 402 + PAYMENT-REQUIRED when PAYMENTS_BYPASS=false
   ```
5. Register A2MCP ASP (prompt):
   ```text
   Help me register an A2MCP ASP on OKX.AI using OKX Agent Identity from Onchain OS
   ```
6. List ASP:
   ```text
   Help me list my ASP on OKX.AI using Onchain OS
   ```

Local dev uses `PAYMENTS_BYPASS=true` so create-job returns 202 without chain payment.

**Full paid request → artifact walkthrough (buyer + poll):** [Paid ASP request runbook](../runbooks/paid-asp-request.md).
