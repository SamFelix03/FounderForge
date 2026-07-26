import { createGroqClient } from "./clients/groqClient.js";
import { createExaClient } from "./clients/exaClient.js";
import { analyzeWebsite } from "./agents/websiteAnalyst.js";
import { analyzeRevenueSheet } from "./agents/revenueAnalyst.js";
import { findRelevantInvestors } from "./agents/investorFinder.js";
import { findPortfolioPreInvestmentRevenue } from "./agents/portfolioBenchmark.js";
import { findPartnerContacts } from "./agents/partnerContacts.js";
import {
  enrichPartnerContacts,
  formatEnrichedContacts,
} from "./agents/contactEnricher.js";
import { compileOutreachReport } from "./report/compileReport.js";
import { downloadSheetToTemp } from "./utils/downloadSheet.js";
import { InputSchema, type Output } from "./schema.js";

export type PipelineStep = { step: string; detail?: string };

/**
 * Full outreach intelligence pipeline: website → revenue → investors →
 * portfolio → partners → enrich → report.
 */
export async function runPipeline(
  input: unknown,
  opts?: { onStep?: (s: PipelineStep) => void | Promise<void> },
): Promise<Output> {
  const parsed = InputSchema.parse(input);
  const onStep = opts?.onStep;

  let sheetPath = parsed.sheet_path;
  if (parsed.sheet_url && !sheetPath) {
    await onStep?.({ step: "download_sheet", detail: parsed.sheet_url });
    sheetPath = await downloadSheetToTemp(parsed.sheet_url);
  }
  if (!sheetPath) {
    throw new Error("Provide sheet_url or sheet_path");
  }

  const groq = createGroqClient();
  const exa = createExaClient();

  await onStep?.({ step: "website", detail: parsed.website_url });
  console.log("\n[Website] Analyzing product with Groq Compound...");
  const website = await analyzeWebsite({ groq, url: parsed.website_url });
  if (website.toolsUsed.length) {
    console.log(`  -> tools used: ${website.toolsUsed.join(", ")}`);
  }
  console.log("\n--- Product summary ---");
  console.log(website.productSummary);

  await onStep?.({ step: "revenue", detail: sheetPath });
  console.log("\n[Revenue] Analyzing spreadsheet performance...");
  const revenue = await analyzeRevenueSheet({ groq, sheetPath });
  console.log("\n--- Performance summary ---");
  console.log(revenue.performanceSummary);

  await onStep?.({ step: "investors" });
  console.log("\n[Investors] Finding relevant investors via Exa...");
  const investors = await findRelevantInvestors({
    groq,
    exa,
    productSummary: website.productSummary,
    performanceSummary: revenue.performanceSummary,
  });
  console.log("\n--- Investor shortlist ---");
  console.log(investors.investorSummary);

  await onStep?.({ step: "portfolio" });
  console.log("\n[Portfolio] Finding pre-investment revenue benchmarks via Exa...");
  const portfolio = await findPortfolioPreInvestmentRevenue({
    groq,
    exa,
    productSummary: website.productSummary,
    performanceSummary: revenue.performanceSummary,
    investorSummary: investors.investorSummary,
    investorResults: investors.exaResults,
  });
  console.log("\n--- Portfolio pre-investment revenue ---");
  console.log(portfolio.portfolioRevenueSummary);

  await onStep?.({ step: "partners" });
  console.log("\n[Contacts] Finding firm partners and public socials via Exa...");
  const contacts = await findPartnerContacts({
    groq,
    exa,
    investorSummary: investors.investorSummary,
    investorResults: investors.exaResults,
    productSummary: website.productSummary,
  });
  console.log("\n--- Partner contacts ---");
  console.log(contacts.contactSummary);
  if (contacts.contacts.length) {
    console.log("\n--- Contact list (JSON) ---");
    console.log(JSON.stringify(contacts.contacts, null, 2));
  }

  await onStep?.({ step: "enrich" });
  console.log("\n[Contact enrichment] Searching each person by name + firm...");
  const enrichedContacts = await enrichPartnerContacts({
    exa,
    contacts: contacts.contacts,
  });
  console.log("\n--- Enriched partner contacts ---");
  console.log(formatEnrichedContacts(enrichedContacts.contacts));

  const result: Output = {
    status: "ok",
    website: {
      url: website.url,
      model: website.model,
      toolsUsed: website.toolsUsed,
      productSummary: website.productSummary,
    },
    revenue: {
      model: revenue.model,
      sheet: revenue.sheetMeta as Record<string, unknown>,
      performanceSummary: revenue.performanceSummary,
    },
    investors: {
      model: investors.model,
      query: investors.query,
      additionalQueries: investors.additionalQueries,
      exaResultCount: investors.exaResultCount,
      investorSummary: investors.investorSummary,
      structuredOutput: investors.structuredOutput,
      sources: investors.exaResults.map((r) => ({ title: r.title, url: r.url })),
    },
    portfolioBenchmarks: {
      model: portfolio.model,
      query: portfolio.query,
      additionalQueries: portfolio.additionalQueries,
      exaResultCount: portfolio.exaResultCount,
      portfolioRevenueSummary: portfolio.portfolioRevenueSummary,
      structuredOutput: portfolio.structuredOutput,
      sources: portfolio.exaResults.map((r) => ({ title: r.title, url: r.url })),
    },
    partnerContacts: {
      model: contacts.model,
      firms: contacts.firms,
      query: contacts.query,
      contactSummary: contacts.contactSummary,
      contacts: enrichedContacts.contacts,
      sources: contacts.exaResults.map((r) => ({ title: r.title, url: r.url })),
    },
    report: {},
    cost_breakdown: [
      { vendor: "llm", operation: "website_compound", amount_usd: 0.05 },
      { vendor: "llm", operation: "revenue_sheet", amount_usd: 0.03 },
      { vendor: "exa", operation: "investor_search", amount_usd: 0.4 },
      { vendor: "exa", operation: "portfolio_search", amount_usd: 0.3 },
      { vendor: "exa", operation: "partner_contacts", amount_usd: 0.4 },
      {
        vendor: "exa",
        operation: "contact_enrichment",
        amount_usd: 0.05 * Math.max(1, enrichedContacts.contacts.length),
        units: enrichedContacts.contacts.length,
      },
      { vendor: "compute", operation: "pdf_report", amount_usd: 0.02 },
    ],
  };

  await onStep?.({ step: "report" });
  console.log("\n[Report] Compiling full findings PDF (upload only, no local output)...");
  const compiled = await compileOutreachReport(result, { includeHtml: true });
  result.report = {
    pdf_url: compiled.report.pdf_url,
    object_key: compiled.report.object_key,
    bytes: compiled.report.bytes,
  };
  console.log(`  -> size: ${(compiled.report.bytes / 1024).toFixed(1)} KB`);
  console.log(`\n[Report URL]\n${compiled.report.pdf_url}\n`);

  return result;
}
