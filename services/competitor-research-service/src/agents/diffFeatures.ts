import { completeJson } from "@founderforge/llm-core";
import { createLogger } from "@founderforge/observability";
import type { Competitor, FeatureDiff, Input } from "../schema.js";
import {
  fetchVendorEvidence,
  truncateForLlm,
  type VendorEvidence,
} from "./fetchEvidence.js";

const log = createLogger("diffFeatures");

/** Generic fallback dimensions when category detection fails. */
const GENERIC_FEATURES = [
  "Free plan / trial",
  "Mobile apps (iOS/Android)",
  "API / developer platform",
  "Third-party integrations",
  "SSO / SAML",
  "AI features",
];

/** Alias hints for common dimensions; dynamic features fall back to label tokens. */
const FEATURE_ALIASES: Record<string, string[]> = {
  "free plan": ["free plan", "free forever", "free tier", "free trial", "start for free"],
  "mobile app": ["mobile app", "ios app", "android app", "iphone", "app store", "google play"],
  api: ["api", "rest api", "graphql", "developer platform", "webhooks", "sdk"],
  integration: ["integration", "integrations", "zapier", "marketplace", "connect"],
  sso: ["sso", "single sign", "saml", "okta", "oidc", "scim"],
  permission: ["role-based", "rbac", "permission", "roles", "access control"],
  audit: ["audit log", "audit trail", "activity log"],
  ai: ["ai ", "artificial intelligence", "copilot", "assistant", "gpt"],
};

type Status = "yes" | "partial" | "no" | "unknown";

const STOPWORDS = new Set([
  "and", "or", "the", "a", "an", "of", "for", "with", "to", "in", "on",
  "features", "feature", "support", "advanced", "based",
]);

/** Build lower-case keyword hints for any (possibly dynamic) feature label. */
function keywordsFor(feature: string): string[] {
  const label = feature.toLowerCase();
  for (const [key, aliases] of Object.entries(FEATURE_ALIASES)) {
    if (label.includes(key)) return aliases;
  }
  const tokens = label
    .replace(/[^a-z0-9 /]/g, " ")
    .split(/[\s/]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return tokens.length ? tokens : [label];
}

/** Cheap keyword pass used only to backfill when the LLM says "unknown". */
function inferStatus(text: string, feature: string): Status {
  const t = text.toLowerCase();
  for (const kw of keywordsFor(feature)) {
    if (!t.includes(kw)) continue;
    if (t.includes(`no ${kw}`) || t.includes(`without ${kw}`)) return "no";
    if (/enterprise[- ]only|add-?on|paid add|higher tiers/.test(t)) return "partial";
    return "yes";
  }
  return "unknown";
}

/**
 * Pick the comparison dimensions that actually matter for THIS product's
 * category (e.g. Gantt charts for PM tools, latency for APIs). One cheap call.
 */
async function selectComparisonFeatures(
  productName: string,
  productText: string,
): Promise<{ features: string[]; cost_usd: number }> {
  try {
    const { data, meta } = await completeJson<{ category: string; features: string[] }>({
      tier: "fast",
      temperature: 0,
      system:
        "You define the buying criteria for a software category. Return 6-8 concrete, comparable " +
        "capabilities that buyers in THIS product's category weigh when choosing between tools. " +
        "Use short noun phrases (2-4 words), category-specific where possible, not generic fluff. Return JSON only.",
      prompt: `Product: ${productName}

Product page excerpt:
${truncateForLlm(productText, 1400)}

Return { "category": string, "features": string[] } with 6-8 features that best differentiate tools in this category.`,
    });
    const features = (data.features ?? [])
      .map((f) => String(f).trim())
      .filter((f) => f.length >= 3 && f.length <= 40)
      .slice(0, 8);
    if (features.length >= 4) return { features, cost_usd: meta.estimated_cost_usd };
  } catch (err) {
    log.warn("feature selection failed; using generic dimensions", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return { features: [...GENERIC_FEATURES], cost_usd: 0 };
}

/** Keep only features that are actually evidenced across the set. */
function pruneSparseFeatures(diff: FeatureDiff): FeatureDiff {
  const entities = Object.keys(diff.matrix);
  if (!entities.length || !diff.features.length) return diff;

  const scored = diff.features.map((feature) => {
    let known = 0;
    for (const e of entities) {
      if ((diff.matrix[e]?.[feature]?.status ?? "unknown") !== "unknown") known += 1;
    }
    return { feature, known, ratio: known / entities.length };
  });

  // Need at least half the vendors evidenced to keep a row.
  let keep = scored.filter((s) => s.ratio >= 0.5).map((s) => s.feature);
  if (keep.length < 4) {
    keep = scored
      .sort((a, b) => b.known - a.known)
      .slice(0, Math.min(6, scored.length))
      .filter((s) => s.known > 0)
      .map((s) => s.feature);
  }
  if (keep.length === 0) keep = diff.features.slice(0, 4);

  const matrix: FeatureDiff["matrix"] = {};
  for (const [entity, cells] of Object.entries(diff.matrix)) {
    matrix[entity] = {};
    for (const f of keep) {
      matrix[entity]![f] = cells?.[f] ?? {
        status: "unknown",
        evidence_url: undefined,
        scraped_at: new Date().toISOString(),
      };
    }
  }
  return { features: keep, matrix, conflicts: diff.conflicts ?? [] };
}

/** Extract feature support for ONE vendor from its own page text. */
async function scoreVendor(
  name: string,
  evidence: VendorEvidence,
  features: string[],
): Promise<{ cells: Record<string, Status>; cost_usd: number }> {
  const fallback = (): Record<string, Status> =>
    Object.fromEntries(features.map((f) => [f, inferStatus(evidence.text, f)]));

  try {
    const { data, meta } = await completeJson<{ features: Record<string, Status> }>({
      tier: "fast",
      temperature: 0,
      system:
        "You are a meticulous product analyst. Decide feature support for ONE vendor using ONLY the provided page text. " +
        "Rules: 'yes' = text clearly shows the vendor offers it; 'partial' = only on higher/enterprise tiers or as an add-on; " +
        "'no' = ONLY if the text explicitly says it is not available; 'unknown' = the text does not mention it. " +
        "Never guess. When in doubt use 'unknown'. Return JSON only.",
      prompt: `Vendor: ${name}

Features to assess:
${JSON.stringify(features)}

Page text:
${truncateForLlm(evidence.text, 3600)}

Return { "features": { "<feature>": "yes|partial|no|unknown", ... } } for every feature listed.`,
    });

    const cells: Record<string, Status> = {};
    for (const f of features) {
      const raw = data.features?.[f];
      const st: Status =
        raw === "yes" || raw === "partial" || raw === "no" ? raw : "unknown";
      if (st === "unknown") {
        const heur = inferStatus(evidence.text, f);
        cells[f] = heur === "yes" || heur === "partial" ? heur : "unknown";
      } else {
        cells[f] = st;
      }
    }
    return { cells, cost_usd: meta.estimated_cost_usd };
  } catch (err) {
    log.warn("vendor feature scoring failed; heuristic fallback", {
      vendor: name,
      error: err instanceof Error ? err.message : String(err),
    });
    return { cells: fallback(), cost_usd: 0 };
  }
}

export async function diffFeatures(
  input: {
    input: Input;
    competitors: Competitor[];
    evidence?: Record<string, VendorEvidence>;
  },
  opts?: { stub?: boolean },
): Promise<{ feature_diff: FeatureDiff; cost_usd: number }> {
  const stub = opts?.stub === true;
  let cost = 0;

  const productUrl =
    input.input.product_url ??
    `https://www.google.com/search?q=${encodeURIComponent(input.input.product_name)}`;

  const targets = [
    { key: input.input.product_name, url: productUrl },
    ...input.competitors.slice(0, 5).map((c) => ({ key: c.name, url: c.url })),
  ];

  // Reuse pre-fetched evidence when the pipeline provides it.
  const evidence: Record<string, VendorEvidence> = { ...(input.evidence ?? {}) };
  for (const t of targets) {
    if (!evidence[t.key]) {
      const page = await fetchVendorEvidence(t.url, { stub, maxChars: 4200 });
      cost += page.cost_usd;
      evidence[t.key] = page;
    }
  }

  // Choose category-appropriate comparison dimensions from the product itself.
  const productEvidence = evidence[input.input.product_name]!;
  let features: string[];
  if (stub) {
    features = [...GENERIC_FEATURES];
  } else {
    const selected = await selectComparisonFeatures(
      input.input.product_name,
      productEvidence.text,
    );
    cost += selected.cost_usd;
    features = selected.features;
  }

  const matrix: FeatureDiff["matrix"] = {};
  for (const t of targets) {
    const ev = evidence[t.key]!;
    const scored = stub
      ? {
          cells: Object.fromEntries(
            features.map((f) => [f, inferStatus(ev.text, f)]),
          ) as Record<string, Status>,
          cost_usd: 0,
        }
      : await scoreVendor(t.key, ev, features);
    cost += scored.cost_usd;
    matrix[t.key] = Object.fromEntries(
      features.map((f) => [
        f,
        {
          status: scored.cells[f] ?? "unknown",
          evidence_url: ev.url,
          scraped_at: ev.fetched_at,
        },
      ]),
    );
  }

  return {
    feature_diff: pruneSparseFeatures({ features, matrix, conflicts: [] }),
    cost_usd: cost,
  };
}
