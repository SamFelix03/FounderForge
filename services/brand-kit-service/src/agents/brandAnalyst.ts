// Brand Analyst (Vertex AI)
// Reads the brand brief and produces logo concept angles + typography
// for the downstream generation stages using structured Gemini output.
//
// Typography is HARD-constrained to a curated Google Fonts allowlist via
// JSON-schema enums (tiny prompt, zero hallucinated font names).

import { z } from "zod";
import type { GoogleGenAI } from "@google/genai";
import { generateContentWithRetry } from "../clients/pace.js";
import {
  HEADING_FONTS,
  BODY_FONTS,
  canonicalizeHeadingFont,
  canonicalizeBodyFont,
} from "../fonts/googleFontCatalog.js";

const ConceptSchema = z.object({
  id: z.string().min(1),
  needsText: z.boolean(),
  style: z.string().min(1),
});

const TypographySchema = z.object({
  heading: z.string().min(1),
  body: z.string().min(1),
  mood: z.string().min(1),
});

const AnalysisSchema = z.object({
  concepts: z.array(ConceptSchema).min(2).max(6),
  typography: TypographySchema,
});

export type LogoConceptAngle = z.infer<typeof ConceptSchema>;
export type BrandTypographyChoice = z.infer<typeof TypographySchema>;
export type BrandAnalysis = {
  concepts: LogoConceptAngle[];
  typography: BrandTypographyChoice;
};

const ANALYSIS_JSON_SCHEMA = {
  type: "object",
  properties: {
    concepts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          needsText: { type: "boolean" },
          style: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["id", "needsText", "style"],
      },
    },
    typography: {
      type: "object",
      properties: {
        // Enums force Gemini to pick ONLY from curated Google Fonts names.
        heading: { type: "string", enum: [...HEADING_FONTS] },
        body: { type: "string", enum: [...BODY_FONTS] },
        mood: { type: "string" },
        rationale: { type: "string" },
      },
      required: ["heading", "body", "mood"],
    },
  },
  required: ["concepts", "typography"],
};

function slugifyId(id: string): string {
  return (
    id
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 40) || "concept"
  );
}

/**
 * Ask Gemini to invent brand-specific logo angles + font pairing.
 */
export async function analyzeBrandBrief({
  brandName,
  description,
  count = 3,
  ai,
}: {
  brandName: string;
  description: string;
  count?: number;
  ai: GoogleGenAI;
}): Promise<BrandAnalysis> {
  if (!ai) throw new Error("analyzeBrandBrief requires a Vertex AI client");
  const model = process.env.GEMINI_TEXT_MODEL || "gemini-3.1-flash-lite";

  const prompt = `You are a senior brand designer analyzing a brief to brief logo and typography generation models.

Brand name: "${brandName}"
Brand brief:
"""${description}"""

Produce exactly ${count} distinct logo concept angles tailored to this brand, plus one heading/body font pairing.

Rules for concepts:
- Each concept must feel specific to THIS brand — not generic stock logo recipes.
- Vary the approaches (e.g. wordmark, symbol mark, monogram, emblem, pictorial, badge) but only when they fit the brief.
- id: short kebab-case label (e.g. "wordmark", "flame-mark", "initials-badge").
- needsText: true only if the rendered logo must include readable brand name / initials as lettering in the image; false for pure icon/symbol marks.
- style: one dense visual direction sentence for an image model (flat vector, white background implied later). Mention composition, geometry, and brand-relevant motifs. Do NOT include the brand name string unless needsText is true and lettering is the point.
- Prefer flat vector / logo-ready language. Avoid photo-real / 3D / watermark language.

Rules for typography:
- heading and body MUST be chosen from the schema enums (curated Google Fonts only — no other names).
- Match the brand personality: editorial/luxury → serif headings; tech/product → geometric sans; bold/sport → condensed display; etc.
- Prefer purposeful contrast (e.g. display heading + readable body). Avoid picking the same family for both unless mono branding truly fits.
- mood: one short kebab-case mood label for the pairing.

Return JSON matching the schema.`;

  console.log(`  analyzing brief with ${model}...`);
  console.log(
    `  typography locked to Google Fonts allowlist (${HEADING_FONTS.length} heading / ${BODY_FONTS.length} body)`,
  );

  let response;
  try {
    response = await generateContentWithRetry(
      ai,
      {
        model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: ANALYSIS_JSON_SCHEMA,
        },
      },
      { label: "brand analysis" },
    );
  } catch (schemaErr) {
    const msg = schemaErr instanceof Error ? schemaErr.message : String(schemaErr);
    console.warn(`  responseSchema failed (${msg}); retrying with responseJsonSchema`);
    response = await generateContentWithRetry(
      ai,
      {
        model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: ANALYSIS_JSON_SCHEMA,
        },
      },
      { label: "brand analysis (json schema)" },
    );
  }

  const rawText = (response.text || "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`Brand analyst returned non-JSON: ${rawText.slice(0, 500)}`);
  }

  const analysis = AnalysisSchema.parse(parsed);
  const seen = new Set<string>();
  const concepts = analysis.concepts.slice(0, count).map((c, i) => {
    let id = slugifyId(c.id);
    if (seen.has(id)) id = `${id}-${i + 1}`;
    seen.add(id);
    return {
      id,
      needsText: Boolean(c.needsText),
      style: c.style.trim(),
    };
  });

  // Belt-and-suspenders: snap any near-miss to the canonical allowlist name.
  const heading = canonicalizeHeadingFont(analysis.typography.heading);
  const body = canonicalizeBodyFont(analysis.typography.body);
  if (heading !== analysis.typography.heading.trim()) {
    console.warn(`  heading snapped "${analysis.typography.heading}" → "${heading}"`);
  }
  if (body !== analysis.typography.body.trim()) {
    console.warn(`  body snapped "${analysis.typography.body}" → "${body}"`);
  }

  return {
    concepts,
    typography: {
      heading,
      body,
      mood: analysis.typography.mood.trim(),
    },
  };
}
