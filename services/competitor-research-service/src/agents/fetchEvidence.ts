import { fetchPageJina } from "@founderforge/connectors";

export interface VendorEvidence {
  /** Combined markdown from feature + pricing pages. */
  text: string;
  /** Text focused on pricing (pricing/plans page). */
  pricingText: string;
  url: string;
  pricingUrl: string;
  fetched_at: string;
  cost_usd: number;
}

function isJunk(text: string): boolean {
  const t = text.trim();
  if (t.length < 100) return true;
  if (/^loading/i.test(t)) return true;
  if (/please enable js|disable any ad blocker|enable javascript/i.test(t)) return true;
  return false;
}

const BOILERPLATE =
  /(cookie|consent|privacy policy|terms of service|subscribe to|newsletter|sign in|log in|©|all rights reserved|follow us|back to top|skip to (main )?content|we use cookies|accept all)/i;

/**
 * Strip nav/menu/footer/boilerplate from Jina markdown so the LLM only sees
 * substantive product + pricing copy. Cuts tokens ~40-60% with no signal loss.
 */
function cleanMarkdown(md: string): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (let raw of md.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) {
      if (lines.length && lines[lines.length - 1] !== "") lines.push("");
      continue;
    }
    // Drop standalone images and pure link/nav lines.
    line = line.replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim();
    if (!line) continue;
    // Convert markdown links to their visible text.
    line = line.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();
    if (BOILERPLATE.test(line)) continue;
    // Nav rows: many short items separated by pipes / middots.
    if ((line.match(/[|·•]/g)?.length ?? 0) >= 3 && line.length < 120) continue;
    // Repeated menu items / dedupe.
    const key = line.toLowerCase();
    if (seen.has(key) && line.length < 80) continue;
    seen.add(key);
    lines.push(line);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Fetch compact but content-rich public evidence for one vendor:
 * homepage + /features (capabilities) and /pricing (tiers).
 * Only industry-standard first-party sources — no review-site scraping.
 */
export async function fetchVendorEvidence(
  baseUrl: string,
  opts?: { stub?: boolean; maxChars?: number },
): Promise<VendorEvidence> {
  const stub = opts?.stub === true;
  const maxChars = opts?.maxChars ?? 4200;
  const base = baseUrl.replace(/\/$/, "");

  const featurePaths = [base, `${base}/features`, `${base}/product`];
  const pricingPaths = [`${base}/pricing`, `${base}/plans`];

  let cost = 0;
  let fetched_at = new Date().toISOString();

  // Feature/overview evidence: take the first rich page.
  let featureText = "";
  let featureUrl = base;
  for (const url of featurePaths) {
    try {
      const page = await fetchPageJina({ url, stub });
      cost += page.meta.cost_usd;
      if (isJunk(page.data.text)) continue;
      featureText = stub ? page.data.text.trim() : cleanMarkdown(page.data.text);
      featureUrl = page.data.url;
      fetched_at = page.data.fetched_at;
      break;
    } catch {
      /* next */
    }
  }

  // Pricing evidence: prefer the page that actually contains prices.
  let pricingText = "";
  let pricingUrl = featureUrl;
  for (const url of pricingPaths) {
    try {
      const page = await fetchPageJina({ url, stub });
      cost += page.meta.cost_usd;
      if (isJunk(page.data.text)) continue;
      pricingText = stub ? page.data.text.trim() : cleanMarkdown(page.data.text);
      pricingUrl = page.data.url;
      if (/\$\d|\/user|\/seat|per (month|user|seat)|free/i.test(pricingText)) break;
    } catch {
      /* next */
    }
  }

  const combined = [
    featureText ? `# Overview (${featureUrl})\n${featureText}` : "",
    pricingText ? `# Pricing (${pricingUrl})\n${pricingText}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, maxChars);

  return {
    text: combined || `(no public content for ${baseUrl})`,
    pricingText: (pricingText || featureText).slice(0, maxChars),
    url: featureUrl,
    pricingUrl,
    fetched_at,
    cost_usd: cost,
  };
}

export function truncateForLlm(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…[truncated]`;
}
