// Logo Generator
// Takes a text description + brand name + concept angles (from brand analyst),
// then generates each logo through Vertex AI's Gemini image model.

import type { GoogleGenAI } from "@google/genai";
import { generateContentWithRetry, waitBetweenSteps } from "../clients/pace.js";
import { assertSupportedAspectRatio, extractInlineImage } from "../clients/imageUtils.js";
import type { LogoConceptAngle } from "./brandAnalyst.js";

export type GeneratedLogoConcept = {
  id: string;
  model: string;
  prompt: string;
  buffer: Buffer;
  mimeType: string;
};

export async function generateLogoConcepts({
  description,
  brandName,
  ai,
  angles,
}: {
  description: string;
  brandName: string;
  ai: GoogleGenAI;
  angles: LogoConceptAngle[];
}): Promise<GeneratedLogoConcept[]> {
  if (!angles?.length) {
    throw new Error("generateLogoConcepts requires angles from the brand analyst");
  }
  if (!ai) throw new Error("generateLogoConcepts requires a Vertex AI client");

  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
  const aspectRatio = assertSupportedAspectRatio("1:1");
  const concepts: GeneratedLogoConcept[] = [];

  for (let i = 0; i < angles.length; i++) {
    if (i > 0) await waitBetweenSteps(`logo concept ${i + 1}`);

    const angle = angles[i]!;
    const prompt = angle.needsText
      ? `Create a professional logo based on this direction: ${angle.style}
The brand name must appear exactly as "${brandName}" with legible, correctly spelled lettering.
Brand context: ${description}.
Use a square composition, flat vector aesthetic, high contrast, and a plain white background.
Do not add mockups, photography, 3D effects, watermarks, signatures, or extra text.`
      : `Create a professional icon-only logo based on this direction: ${angle.style}
Brand context: ${description}.
Use a square composition, flat vector aesthetic, high contrast, and a plain white background.
Do not include any letters, words, mockups, photography, 3D effects, watermarks, or signatures.`;

    console.log(`  generating "${angle.id}" via Vertex AI ${model}...`);

    const response = await generateContentWithRetry(
      ai,
      {
        model,
        contents: prompt,
        config: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: { aspectRatio },
        },
      },
      { label: `logo "${angle.id}"` },
    );

    const { image, text } = extractInlineImage(response);
    if (!image) {
      throw new Error(
        `Vertex returned no image for "${angle.id}".${text ? ` Response: ${text}` : ""}`,
      );
    }

    concepts.push({
      id: angle.id,
      model,
      prompt,
      buffer: image.buffer,
      mimeType: image.mimeType,
    });
  }

  return concepts;
}
