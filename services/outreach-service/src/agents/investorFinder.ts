// Investor finder — Groq crafts an Exa query, Exa finds relevant investors / firms.

import { sheetModel, type GroqChatClient } from "../clients/groqClient.js";
import {
  formatExaResultsForPrompt,
  runExaSearch,
  type ExaClient,
  type ExaSearchHit,
} from "../clients/exaClient.js";

export type InvestorFinderResult = {
  model: string;
  query: string;
  additionalQueries: string[];
  exaResultCount: number;
  exaResults: ExaSearchHit[];
  structuredOutput: unknown;
  investorSummary: string;
};

export async function findRelevantInvestors({
  groq,
  exa,
  productSummary,
  performanceSummary,
}: {
  groq: GroqChatClient;
  exa: ExaClient;
  productSummary: string;
  performanceSummary: string;
}): Promise<InvestorFinderResult> {
  const model = sheetModel();
  console.log(`  crafting investor Exa query with ${model}...`);

  const queryPlan = await craftInvestorQuery({
    groq,
    model,
    productSummary,
    performanceSummary,
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
        investors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: { type: "string" },
              thesis: { type: "string" },
              whyRelevant: { type: "string" },
              examplePortfolioCompanies: { type: "string" },
            },
            required: ["name", "whyRelevant"],
          },
        },
        notes: { type: "string" },
      },
      required: ["investors"],
    },
  });

  console.log(`  synthesizing investor shortlist with ${model}...`);
  const summary = await synthesizeInvestors({
    groq,
    model,
    productSummary,
    performanceSummary,
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
    investorSummary: summary,
  };
}

async function craftInvestorQuery({
  groq,
  model,
  productSummary,
  performanceSummary,
}: {
  groq: GroqChatClient;
  model: string;
  productSummary: string;
  performanceSummary: string;
}): Promise<{ query: string; additionalQueries: string[] }> {
  const completion = await groq.chat.completions.create({
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You write high-precision Exa search queries to find VCs, angels, and investment firms that fund products in a specific category and stage. Return JSON only.",
      },
      {
        role: "user",
        content: `Create an Exa search plan to find investors and investing firms that would care about this product and stage.

Product summary:
"""${productSummary}"""

Company performance summary:
"""${performanceSummary}"""

Return JSON:
{
  "query": "one rich natural-language Exa query asking for investors/firms that invest in this product category and similar ARR/MRR stages",
  "additionalQueries": ["up to 3 alternate deep-search queries"]
}

Rules:
- Focus on investor thesis fit (category, B2B/B2C, stage, geography if implied).
- Mention the product category explicitly (not the company brand alone).
- Prefer queries that surface firm names, check sizes, and portfolio examples.
- Do not invent specific firm names in the query unless clearly justified by the product category.`,
      },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content || "{}";
  let parsed: { query?: string; additionalQueries?: unknown };
  try {
    parsed = JSON.parse(raw) as { query?: string; additionalQueries?: unknown };
  } catch {
    throw new Error(`Investor query planner returned non-JSON: ${raw.slice(0, 400)}`);
  }

  const query = String(parsed.query || "").trim();
  if (!query) throw new Error("Investor query planner returned an empty query");

  const additionalQueries = Array.isArray(parsed.additionalQueries)
    ? parsed.additionalQueries.map((q) => String(q).trim()).filter(Boolean).slice(0, 3)
    : [];

  return { query, additionalQueries };
}

async function synthesizeInvestors({
  groq,
  model,
  productSummary,
  performanceSummary,
  queryPlan,
  search,
}: {
  groq: GroqChatClient;
  model: string;
  productSummary: string;
  performanceSummary: string;
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
          "You shortlist investors and investing firms from search evidence. Be concrete. Prefer named firms. Do not invent portfolio facts that are not supported by the Exa results.",
      },
      {
        role: "user",
        content: `Using the Exa results, identify investors / investing firms relevant to this product.

Product:
"""${productSummary}"""

Performance:
"""${performanceSummary}"""

Exa query used:
"""${queryPlan.query}"""

Exa results:
"""${formatExaResultsForPrompt(search, { maxResults: 6 })}"""

Exa structured output (if any):
"""${JSON.stringify(search.output || {}, null, 2).slice(0, 2500)}"""

Return:
1) Top relevant investors/firms (name + why they fit)
2) Their apparent focus / thesis
3) Example portfolio companies mentioned in the results (if any)
4) Gaps / low-confidence items
Keep it concise.`,
      },
    ],
  });

  const summary = (completion.choices?.[0]?.message?.content || "").trim();
  if (!summary) throw new Error("Investor synthesis returned empty content");
  return summary;
}
