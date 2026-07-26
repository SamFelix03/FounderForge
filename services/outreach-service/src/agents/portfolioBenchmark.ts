// Portfolio benchmark — Groq crafts an Exa query, Exa finds pre-investment
// revenue/ARR/MRR for portfolio companies of the identified investors.

import { sheetModel, type GroqChatClient } from "../clients/groqClient.js";
import {
  formatExaResultsForPrompt,
  runExaSearch,
  type ExaClient,
  type ExaSearchHit,
} from "../clients/exaClient.js";

export type PortfolioBenchmarkResult = {
  model: string;
  query: string;
  additionalQueries: string[];
  exaResultCount: number;
  exaResults: ExaSearchHit[];
  structuredOutput: unknown;
  portfolioRevenueSummary: string;
};

export async function findPortfolioPreInvestmentRevenue({
  groq,
  exa,
  productSummary,
  performanceSummary,
  investorSummary,
  investorResults = [],
}: {
  groq: GroqChatClient;
  exa: ExaClient;
  productSummary: string;
  performanceSummary: string;
  investorSummary: string;
  investorResults?: Array<{ title?: string; url?: string }>;
}): Promise<PortfolioBenchmarkResult> {
  const model = sheetModel();
  console.log(`  crafting portfolio-revenue Exa query with ${model}...`);

  const queryPlan = await craftPortfolioQuery({
    groq,
    model,
    productSummary,
    performanceSummary,
    investorSummary,
    investorResults,
  });

  console.log(`  Exa query: ${queryPlan.query}`);
  if (queryPlan.additionalQueries?.length) {
    console.log(`  additional queries: ${queryPlan.additionalQueries.join(" | ")}`);
  }

  const search = await runExaSearch(exa, queryPlan.query, {
    additionalQueries: queryPlan.additionalQueries,
    outputSchema: {
      type: "object",
      properties: {
        benchmarks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              company: { type: "string" },
              investor: { type: "string" },
              round: { type: "string" },
              preInvestmentRevenue: { type: "string" },
              metricType: { type: "string" },
              sourceNote: { type: "string" },
            },
            required: ["company", "preInvestmentRevenue"],
          },
        },
        notes: { type: "string" },
      },
      required: ["benchmarks"],
    },
  });

  console.log(`  synthesizing portfolio revenue benchmarks with ${model}...`);
  const summary = await synthesizePortfolioBenchmarks({
    groq,
    model,
    productSummary,
    performanceSummary,
    investorSummary,
    queryPlan,
    search,
  });

  return {
    model,
    query: queryPlan.query,
    additionalQueries: queryPlan.additionalQueries,
    exaResultCount: search.resultCount,
    exaResults: search.results,
    structuredOutput: search.output || null,
    portfolioRevenueSummary: summary,
  };
}

async function craftPortfolioQuery({
  groq,
  model,
  productSummary,
  performanceSummary,
  investorSummary,
  investorResults,
}: {
  groq: GroqChatClient;
  model: string;
  productSummary: string;
  performanceSummary: string;
  investorSummary: string;
  investorResults: Array<{ title?: string; url?: string }>;
}): Promise<{ query: string; additionalQueries: string[] }> {
  const firmHints = investorResults
    .slice(0, 8)
    .map((r) => `- ${r.title || ""} ${r.url || ""}`.trim())
    .filter(Boolean)
    .join("\n");

  const completion = await groq.chat.completions.create({
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You write Exa search queries to find ARR/MRR/revenue of startups BEFORE a named investor funded them. Return JSON only.",
      },
      {
        role: "user",
        content: `Create an Exa search plan for pre-investment revenue benchmarks.

Product:
"""${productSummary}"""

Our company performance:
"""${performanceSummary}"""

Investor shortlist / thesis:
"""${investorSummary}"""

Investor search result hints:
"""${firmHints || "(none)"}"""

Return JSON:
{
  "query": "one rich natural-language Exa query asking for ARR/MRR/revenue of portfolio companies before the investor invested",
  "additionalQueries": ["up to 3 alternate deep-search queries"]
}

Rules:
- Explicitly ask for pre-seed / seed / Series A traction metrics BEFORE the round closed.
- Include investor firm names from the shortlist when available.
- Prefer comparable product categories to the input product.
- Ask for ARR, MRR, revenue run-rate, or customers at time of investment when available.
- Do not ask only for post-money valuations; prioritize operating metrics.`,
      },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content || "{}";
  let parsed: { query?: string; additionalQueries?: unknown };
  try {
    parsed = JSON.parse(raw) as { query?: string; additionalQueries?: unknown };
  } catch {
    throw new Error(`Portfolio query planner returned non-JSON: ${raw.slice(0, 400)}`);
  }

  const query = String(parsed.query || "").trim();
  if (!query) throw new Error("Portfolio query planner returned an empty query");

  const additionalQueries = Array.isArray(parsed.additionalQueries)
    ? parsed.additionalQueries.map((q) => String(q).trim()).filter(Boolean).slice(0, 3)
    : [];

  return { query, additionalQueries };
}

async function synthesizePortfolioBenchmarks({
  groq,
  model,
  productSummary,
  performanceSummary,
  investorSummary,
  queryPlan,
  search,
}: {
  groq: GroqChatClient;
  model: string;
  productSummary: string;
  performanceSummary: string;
  investorSummary: string;
  queryPlan: { query: string };
  search: Awaited<ReturnType<typeof runExaSearch>>;
}): Promise<string> {
  const completion = await groq.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You extract pre-investment revenue benchmarks from search evidence. Prefer explicit ARR/MRR/revenue numbers with company + investor + timing. Mark uncertain figures clearly. Do not invent numbers.",
      },
      {
        role: "user",
        content: `From the Exa results, summarize what portfolio companies were earning BEFORE these investors invested.

Our product:
"""${productSummary}"""

Our performance:
"""${performanceSummary}"""

Investor context:
"""${investorSummary}"""

Exa query used:
"""${queryPlan.query}"""

Exa results:
"""${formatExaResultsForPrompt(search, { maxResults: 6 })}"""

Exa structured output (if any):
"""${JSON.stringify(search.output || {}, null, 2).slice(0, 2500)}"""

Return:
1) Benchmark table-like bullets: company | investor | round timing | pre-investment ARR/MRR/revenue | source confidence
2) How our company compares (only if numbers are present)
3) Missing data / low-confidence items
Keep it concise and evidence-based.`,
      },
    ],
  });

  const summary = (completion.choices?.[0]?.message?.content || "").trim();
  if (!summary) throw new Error("Portfolio benchmark synthesis returned empty content");
  return summary;
}
