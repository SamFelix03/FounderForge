// Contact enrichment — runs one targeted Exa search per discovered person.

import {
  runExaSearch,
  type ExaClient,
  type ExaSearchResult,
} from "../clients/exaClient.js";
import type { Contact } from "../schema.js";

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

export type EnrichedContact = Contact & {
  enrichmentSources?: string[];
};

export type EnrichmentSearch = {
  name: string;
  firm: string;
  query: string;
  resultCount: number;
  error?: string;
  sources: Array<{ title: string; url: string }>;
};

export async function enrichPartnerContacts({
  exa,
  contacts,
}: {
  exa: ExaClient;
  contacts: Contact[];
}): Promise<{ contacts: EnrichedContact[]; searches: EnrichmentSearch[] }> {
  if (!Array.isArray(contacts) || !contacts.length) {
    return { contacts: [], searches: [] };
  }

  const configuredLimit = Number.parseInt(
    process.env.EXA_PERSON_ENRICHMENT_LIMIT || "0",
    10,
  );
  const selected =
    Number.isFinite(configuredLimit) && configuredLimit > 0
      ? contacts.slice(0, configuredLimit)
      : contacts;
  const delayMs = Number.parseInt(process.env.EXA_PERSON_SEARCH_DELAY_MS || "250", 10);
  const enriched: EnrichedContact[] = [];
  const searches: EnrichmentSearch[] = [];

  console.log(`  running ${selected.length} individual person searches...`);

  for (let i = 0; i < selected.length; i++) {
    const contact = selected[i]!;
    console.log(`  [${i + 1}/${selected.length}] ${contact.name} — ${contact.firm}`);

    const query = `"${contact.name}" "${contact.firm}" partner LinkedIn email Twitter X personal website social profile`;
    const additionalQueries = [
      `"${contact.name}" "${contact.firm}" site:linkedin.com/in`,
      `"${contact.name}" "${contact.firm}" (site:x.com OR site:twitter.com OR site:instagram.com)`,
      `"${contact.name}" "${contact.firm}" email contact`,
    ];

    try {
      const search = await runExaSearch(exa, query, {
        type: process.env.EXA_PERSON_SEARCH_TYPE || "deep-lite",
        numResults: Number.parseInt(process.env.EXA_PERSON_NUM_RESULTS || "5", 10),
        additionalQueries,
        outputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            firm: { type: "string" },
            role: { type: "string" },
            linkedin: { type: "string" },
            email: { type: "string" },
            twitter: { type: "string" },
            instagram: { type: "string" },
            personalWebsite: { type: "string" },
            otherSocials: { type: "string" },
          },
          required: ["name", "firm"],
        },
      });

      const updated = mergeEnrichment(contact, search);
      enriched.push(updated);
      searches.push({
        name: contact.name,
        firm: contact.firm,
        query,
        resultCount: search.resultCount,
        sources: search.results.map((r) => ({ title: r.title, url: r.url })),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`    enrichment failed: ${message}`);
      enriched.push(contact);
      searches.push({
        name: contact.name,
        firm: contact.firm,
        query,
        resultCount: 0,
        error: message,
        sources: [],
      });
    }

    if (i < selected.length - 1 && Number.isFinite(delayMs) && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // Keep contacts beyond an optional enrichment limit unchanged.
  enriched.push(...contacts.slice(selected.length));
  return { contacts: enriched, searches };
}

export function formatEnrichedContacts(contacts: EnrichedContact[]): string {
  if (!contacts?.length) return "(no contacts found)";

  return contacts
    .map((contact) => {
      const links = [
        contact.linkedin && `LinkedIn: ${contact.linkedin}`,
        contact.email && `Email: ${contact.email}`,
        contact.twitter && `X: ${contact.twitter}`,
        ...(contact.otherSocials || []).map((url) => `Other: ${url}`),
      ]
        .filter(Boolean)
        .join(" | ");

      return `- ${contact.name} — ${contact.firm}${
        contact.role ? ` (${contact.role})` : ""
      }${links ? ` — ${links}` : ""}`;
    })
    .join("\n");
}

function mergeEnrichment(contact: Contact, search: ExaSearchResult): EnrichedContact {
  const structured = readStructuredOutput(search.output) as Record<string, unknown>;
  const evidence = [
    JSON.stringify(structured),
    ...search.results.flatMap((r) => [r.url || "", r.title || "", ...(r.highlights || [])]),
  ].join("\n");

  const urls = unique([
    ...extractUrls(evidence),
    ...search.results.map((r) => r.url).filter(Boolean),
  ]);
  const emails = unique(evidence.match(EMAIL_RE) || []).filter(isPlausibleEmail);

  const linkedin =
    cleanValue(structured.linkedin) ||
    urls.find((url) => /linkedin\.com\/in\//i.test(url)) ||
    contact.linkedin ||
    "";
  const twitter =
    cleanValue(structured.twitter) ||
    urls.find((url) => /(?:x|twitter)\.com\/(?!home|search|share)[^/?#]+/i.test(url)) ||
    contact.twitter ||
    "";
  const instagram =
    cleanValue(structured.instagram) ||
    urls.find((url) => /instagram\.com\/[^/?#]+/i.test(url)) ||
    "";
  const personalWebsite =
    cleanValue(structured.personalWebsite) ||
    urls.find((url) => isPossiblePersonalSite(url, contact.firm)) ||
    "";
  const structuredEmail = cleanValue(structured.email);
  const existingEmail = cleanValue(contact.email);
  const email =
    (isPlausibleEmail(structuredEmail) && structuredEmail) ||
    emails[0] ||
    (isPlausibleEmail(existingEmail) && existingEmail) ||
    "";

  const structuredOther = splitSocials(structured.otherSocials);
  const discoveredSocials = urls.filter((url) =>
    /(?:github\.com|threads\.net|bsky\.app|medium\.com|substack\.com|youtube\.com)/i.test(url),
  );

  return {
    ...contact,
    role: contact.role || cleanValue(structured.role),
    linkedin,
    email,
    twitter,
    otherSocials: unique([
      ...(contact.otherSocials || []),
      ...structuredOther,
      ...(instagram ? [instagram] : []),
      ...(personalWebsite ? [personalWebsite] : []),
      ...discoveredSocials,
    ]),
    sourceUrl: contact.sourceUrl || search.results.find((r) => r.url)?.url || "",
    enrichmentSources: search.results.map((r) => r.url).filter(Boolean),
  };
}

function readStructuredOutput(output: unknown): Record<string, unknown> {
  let value: unknown = (output as { content?: unknown } | null)?.content ?? output ?? {};
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function extractUrls(text: string): string[] {
  return (String(text).match(URL_RE) || []).map((url) => url.replace(/[.,;:]+$/, ""));
}

function cleanValue(value: unknown): string {
  const text = String(value || "").trim();
  if (!text || /^(?:n\/a|none|null|unknown|not found)$/i.test(text)) return "";
  return text;
}

function splitSocials(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(cleanValue).filter(Boolean);
  return String(value || "")
    .split(/[,;|]/)
    .map(cleanValue)
    .filter(Boolean);
}

function unique(values: Array<string | undefined | null | false>): string[] {
  return [...new Set(values.filter(Boolean) as string[])];
}

function isPlausibleEmail(email: string): boolean {
  if (!email || /[*…]/.test(email)) return false;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
  return !/\.(?:png|jpg|jpeg|gif|svg|webp)$/i.test(email);
}

function isPossiblePersonalSite(url: string, firm: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const blocked = [
      "linkedin.com",
      "twitter.com",
      "x.com",
      "instagram.com",
      "facebook.com",
      "github.com",
      "exa.ai",
      "openvc.app",
      "crunchbase.com",
    ];
    if (blocked.some((domain) => host.includes(domain))) return false;
    const firmToken = String(firm || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    return !firmToken || !host.replace(/[^a-z0-9]/g, "").includes(firmToken);
  } catch {
    return false;
  }
}
