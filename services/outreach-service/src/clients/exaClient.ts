import { Exa } from "exa-js";

export type ExaClient = Exa;

export type ExaSearchHit = {
  title: string;
  url: string;
  publishedDate: string | null;
  author: string | null;
  highlights: string[];
  text: string;
};

export type ExaSearchResult = {
  query: string;
  additionalQueries: string[];
  resultCount: number;
  results: ExaSearchHit[];
  output: unknown;
  raw: unknown;
};

export function createExaClient(): ExaClient {
  const apiKey = (process.env.EXA_SEARCH_API_KEY || process.env.EXA_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("Missing EXA_SEARCH_API_KEY in .env");
  }
  return new Exa(apiKey);
}

/**
 * Run an Exa deep search and normalize results for the pipeline.
 */
export async function runExaSearch(
  exa: ExaClient,
  query: string,
  opts: {
    numResults?: number;
    type?: string;
    additionalQueries?: string[];
    outputSchema?: unknown;
  } = {},
): Promise<ExaSearchResult> {
  const numResults = opts.numResults || Number.parseInt(process.env.EXA_NUM_RESULTS || "8", 10);

  const response = (await exa.search(query, {
    numResults,
    type: opts.type || process.env.EXA_SEARCH_TYPE || "deep",
    contents: {
      highlights: true,
    },
    ...(opts.additionalQueries?.length ? { additionalQueries: opts.additionalQueries } : {}),
    ...(opts.outputSchema ? { outputSchema: opts.outputSchema } : {}),
  } as never)) as {
    results?: Array<{
      title?: string;
      url?: string;
      publishedDate?: string;
      author?: string;
      highlights?: string[];
    }>;
    output?: unknown;
  };

  const results: ExaSearchHit[] = (response.results || []).map((r) => ({
    title: r.title || "",
    url: r.url || "",
    publishedDate: r.publishedDate || null,
    author: r.author || null,
    highlights: (r.highlights || []).slice(0, 3),
    text: "",
  }));

  return {
    query,
    additionalQueries: opts.additionalQueries || [],
    resultCount: results.length,
    results,
    output: response.output || null,
    raw: response,
  };
}

export function formatExaResultsForPrompt(
  search: ExaSearchResult | null | undefined,
  {
    maxResults = 6,
    maxHighlightChars = 280,
    includeText = false,
  }: { maxResults?: number; maxHighlightChars?: number; includeText?: boolean } = {},
): string {
  if (!search?.results?.length) return "(no Exa results)";

  return search.results
    .slice(0, maxResults)
    .map((r, i) => {
      const highlights = (r.highlights || [])
        .map((h) => String(h).slice(0, maxHighlightChars))
        .filter(Boolean)
        .slice(0, 2);
      const bits = [
        `${i + 1}. ${r.title || "(untitled)"}`,
        r.url ? `URL: ${r.url}` : null,
        r.publishedDate ? `Date: ${r.publishedDate}` : null,
        highlights.length ? `Highlights: ${highlights.join(" | ")}` : null,
        includeText && r.text ? `Excerpt: ${String(r.text).slice(0, 400)}` : null,
      ].filter(Boolean);
      return bits.join("\n");
    })
    .join("\n\n");
}
