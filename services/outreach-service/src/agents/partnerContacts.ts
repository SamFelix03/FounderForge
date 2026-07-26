// Partner contacts — Groq crafts Exa queries to find partners/GPs at target firms
// and extract LinkedIn, email, and other public socials.

import { sheetModel, type GroqChatClient } from "../clients/groqClient.js";
import {
  formatExaResultsForPrompt,
  runExaSearch,
  type ExaClient,
  type ExaSearchHit,
} from "../clients/exaClient.js";
import type { Contact } from "../schema.js";

export type PartnerContactsResult = {
  model: string;
  firms: string[];
  query: string;
  additionalQueries: string[];
  exaResultCount: number;
  exaResults: ExaSearchHit[];
  structuredOutput: unknown;
  contacts: Contact[];
  contactSummary: string;
};

export async function findPartnerContacts({
  groq,
  exa,
  investorSummary,
  investorResults = [],
  productSummary = "",
}: {
  groq: GroqChatClient;
  exa: ExaClient;
  investorSummary: string;
  investorResults?: Array<{ title?: string; url?: string }>;
  productSummary?: string;
}): Promise<PartnerContactsResult> {
  const model = sheetModel();
  console.log(`  crafting partner-contact Exa query with ${model}...`);

  const queryPlan = await craftContactQuery({
    groq,
    model,
    investorSummary,
    investorResults,
    productSummary,
  });

  console.log(`  Exa query: ${queryPlan.query}`);
  if (queryPlan.additionalQueries?.length) {
    console.log(`  additional queries: ${queryPlan.additionalQueries.join(" | ")}`);
  }
  if (queryPlan.firms?.length) {
    console.log(`  target firms: ${queryPlan.firms.join(", ")}`);
  }

  const search = await runExaSearch(exa, queryPlan.query, {
    additionalQueries: queryPlan.additionalQueries,
    numResults: Number.parseInt(process.env.EXA_CONTACT_NUM_RESULTS || "10", 10),
    outputSchema: {
      type: "object",
      properties: {
        contacts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              firm: { type: "string" },
              role: { type: "string" },
              linkedin: { type: "string" },
              email: { type: "string" },
              twitter: { type: "string" },
              otherSocials: { type: "string" },
              sourceUrl: { type: "string" },
            },
            required: ["name", "firm"],
          },
        },
        notes: { type: "string" },
      },
      required: ["contacts"],
    },
  });

  console.log(`  synthesizing partner contact list with ${model}...`);
  const synthesized = await synthesizeContacts({
    groq,
    model,
    investorSummary,
    queryPlan,
    search,
  });

  return {
    model,
    firms: queryPlan.firms || [],
    query: queryPlan.query,
    additionalQueries: queryPlan.additionalQueries,
    exaResultCount: search.resultCount,
    exaResults: search.results,
    structuredOutput: search.output || null,
    contacts: synthesized.contacts,
    contactSummary: synthesized.summary,
  };
}

async function craftContactQuery({
  groq,
  model,
  investorSummary,
  investorResults,
  productSummary,
}: {
  groq: GroqChatClient;
  model: string;
  investorSummary: string;
  investorResults: Array<{ title?: string; url?: string }>;
  productSummary: string;
}): Promise<{ query: string; additionalQueries: string[]; firms: string[] }> {
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
          "You write Exa search queries to find named partners, GPs, and investing partners at specific VC/angel firms, plus their public contact links (LinkedIn, email, X/Twitter, personal sites). Return JSON only.",
      },
      {
        role: "user",
        content: `Create an Exa search plan to find partners and their public contacts at these investor firms.

Investor shortlist:
"""${investorSummary}"""

Product context (optional):
"""${productSummary || "(none)"}"""

Investor search hints:
"""${firmHints || "(none)"}"""

Return JSON:
{
  "firms": ["up to 6 firm names extracted from the shortlist"],
  "query": "one rich natural-language Exa query asking for partners/GPs at these firms with LinkedIn, email, Twitter/X, and other socials",
  "additionalQueries": ["up to 3 alternate deep-search queries focused on team pages, LinkedIn directories, and partner bios"]
}

Rules:
- Extract real firm names from the shortlist.
- Explicitly ask for partner / general partner / investing partner names.
- Explicitly ask for LinkedIn URLs, public emails, Twitter/X, and other social profiles.
- Prefer official team pages, firm sites, and LinkedIn profiles.
- Do not invent contact details in the query itself.`,
      },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content || "{}";
  let parsed: { query?: string; additionalQueries?: unknown; firms?: unknown };
  try {
    parsed = JSON.parse(raw) as {
      query?: string;
      additionalQueries?: unknown;
      firms?: unknown;
    };
  } catch {
    throw new Error(`Contact query planner returned non-JSON: ${raw.slice(0, 400)}`);
  }

  const query = String(parsed.query || "").trim();
  if (!query) throw new Error("Contact query planner returned an empty query");

  const additionalQueries = Array.isArray(parsed.additionalQueries)
    ? parsed.additionalQueries.map((q) => String(q).trim()).filter(Boolean).slice(0, 3)
    : [];

  const firms = Array.isArray(parsed.firms)
    ? parsed.firms.map((f) => String(f).trim()).filter(Boolean).slice(0, 6)
    : [];

  return { query, additionalQueries, firms };
}

async function synthesizeContacts({
  groq,
  model,
  investorSummary,
  queryPlan,
  search,
}: {
  groq: GroqChatClient;
  model: string;
  investorSummary: string;
  queryPlan: { query: string; firms: string[] };
  search: Awaited<ReturnType<typeof runExaSearch>>;
}): Promise<{ contacts: Contact[]; summary: string }> {
  const completion = await groq.chat.completions.create({
    model,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You extract a clean contact list of partners at investment firms from search evidence. Only include contacts supported by the Exa results. Never invent emails or profile URLs. Return JSON only.",
      },
      {
        role: "user",
        content: `Build a partner contact list from the Exa evidence.

Target firms:
"""${(queryPlan.firms || []).join(", ") || "(from investor shortlist)"}"""

Investor shortlist context:
"""${investorSummary}"""

Exa query used:
"""${queryPlan.query}"""

Exa results:
"""${formatExaResultsForPrompt(search, { maxResults: 8, maxHighlightChars: 320 })}"""

Exa structured output (if any):
"""${JSON.stringify(search.output || {}, null, 2).slice(0, 3000)}"""

Return JSON:
{
  "contacts": [
    {
      "name": "Full name",
      "firm": "Firm name",
      "role": "Partner / GP / etc",
      "linkedin": "url or empty string",
      "email": "public email or empty string",
      "twitter": "X/Twitter url or handle or empty string",
      "otherSocials": ["optional other public profile urls"],
      "sourceUrl": "best evidence url"
    }
  ],
  "summary": "short markdown list of name — firm — role — linkedin/email/twitter"
}

Rules:
- Deduplicate by name+firm.
- Prefer partners / GPs / investing partners over analysts or ops staff when possible.
- Leave unknown fields as empty string / empty array.
- Do not fabricate contact details.`,
      },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content || "{}";
  let parsed: { contacts?: unknown; summary?: string };
  try {
    parsed = JSON.parse(raw) as { contacts?: unknown; summary?: string };
  } catch {
    throw new Error(`Contact synthesis returned non-JSON: ${raw.slice(0, 400)}`);
  }

  const contacts = normalizeContacts(parsed.contacts);
  const summary =
    String(parsed.summary || "").trim() ||
    contacts
      .map((c) => {
        const socials = [
          c.linkedin && `LinkedIn: ${c.linkedin}`,
          c.email && `Email: ${c.email}`,
          c.twitter && `X: ${c.twitter}`,
          ...(c.otherSocials || []).map((s) => `Social: ${s}`),
        ]
          .filter(Boolean)
          .join(" | ");
        return `- ${c.name} — ${c.firm}${c.role ? ` (${c.role})` : ""}${socials ? ` — ${socials}` : ""}`;
      })
      .join("\n");

  if (!contacts.length && !summary) {
    throw new Error("Contact synthesis returned no contacts");
  }

  return { contacts, summary };
}

function normalizeContacts(rawContacts: unknown): Contact[] {
  if (!Array.isArray(rawContacts)) return [];

  const seen = new Set<string>();
  const out: Contact[] = [];

  for (const item of rawContacts) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const name = String(rec.name || "").trim();
    const firm = String(rec.firm || "").trim();
    if (!name || !firm) continue;

    const key = `${name.toLowerCase()}::${firm.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const otherSocials = Array.isArray(rec.otherSocials)
      ? rec.otherSocials.map((s) => String(s).trim()).filter(Boolean)
      : String(rec.otherSocials || "")
          .split(/[,;|]/)
          .map((s) => s.trim())
          .filter(Boolean);

    out.push({
      name,
      firm,
      role: String(rec.role || "").trim(),
      linkedin: String(rec.linkedin || "").trim(),
      email: String(rec.email || "").trim(),
      twitter: String(rec.twitter || "").trim(),
      otherSocials,
      sourceUrl: String(rec.sourceUrl || "").trim() || undefined,
    });
  }

  return out;
}
