// Website analyst — Groq Compound visits the site and returns a short product summary.

import { ProductUrlError } from "@founderforge/schemas";
import { compoundModel, type GroqChatClient } from "../clients/groqClient.js";

export type WebsiteAnalysis = {
  productSummary: string;
  model: string;
  toolsUsed: string[];
  url: string;
};

export async function analyzeWebsite({
  groq,
  url,
}: {
  groq: GroqChatClient;
  url: string;
}): Promise<WebsiteAnalysis> {
  if (!url?.trim()) {
    throw new ProductUrlError("product_url_invalid", "Website URL is required");
  }

  const model = compoundModel();
  const normalizedUrl = normalizeUrl(url);

  console.log(`  analyzing website with ${model}...`);
  console.log(`  url: ${normalizedUrl}`);

  let completion;
  try {
    completion = await groq.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a concise product analyst. Visit the given website, understand what the company sells, and return a short factual product summary. Prefer primary site content over third-party commentary. Keep the summary to 3–5 sentences. No fluff, no investor pitch tone. If the site cannot be reached or has no content, say exactly: UNREACHABLE_SITE",
        },
        {
          role: "user",
          content: `Visit this company website and summarize what the product/company does:

${normalizedUrl}

Return only:
1) Product name (if clear)
2) What it does (1–2 sentences)
3) Who it is for
4) Notable product capabilities (bullets, max 4)`,
        },
      ],
      compound_custom: {
        tools: {
          enabled_tools: ["visit_website", "web_search"],
        },
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ProductUrlError(
      "product_url_unreachable",
      `Could not analyze website ${normalizedUrl}. ${msg}`,
      { cause: err },
    );
  }

  const message = completion.choices?.[0]?.message as
    | { content?: string | null; executed_tools?: Array<{ type?: string; name?: string }> }
    | undefined;
  const productSummary = (message?.content || "").trim();
  if (!productSummary || /UNREACHABLE_SITE/i.test(productSummary)) {
    throw new ProductUrlError(
      "product_url_no_content",
      `Could not extract readable product content from ${normalizedUrl}. Provide a publicly reachable company website.`,
    );
  }

  const toolsUsed = (message?.executed_tools || [])
    .map((t) => t?.type || t?.name || "tool")
    .filter(Boolean);

  return { productSummary, model, toolsUsed, url: normalizedUrl };
}

function normalizeUrl(input: string): string {
  const raw = input.trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}
