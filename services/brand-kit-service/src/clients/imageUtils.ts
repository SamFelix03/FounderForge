/** Aspect ratios supported by gemini-2.5-flash-image on Vertex. */
export const SUPPORTED_IMAGE_ASPECT_RATIOS = new Set([
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
]);

export function assertSupportedAspectRatio(aspectRatio: string): string {
  if (!SUPPORTED_IMAGE_ASPECT_RATIOS.has(aspectRatio)) {
    throw new Error(
      `Unsupported image aspectRatio "${aspectRatio}". Use one of: ${[
        ...SUPPORTED_IMAGE_ASPECT_RATIOS,
      ].join(", ")}`,
    );
  }
  return aspectRatio;
}

export type InlineImage = {
  buffer: Buffer;
  mimeType: string;
};

export type ExtractInlineImageResult = {
  image: InlineImage | null;
  text: string;
};

type GeminiPart = {
  text?: string;
  inlineData?: { data?: string; mimeType?: string };
};

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
  }>;
};

/**
 * Normalize image parts from a Gemini response.
 */
export function extractInlineImage(response: unknown): ExtractInlineImageResult {
  const parts = (response as GeminiResponse)?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((part) => part.inlineData?.data);
  if (!imagePart?.inlineData?.data) {
    const text = parts
      .map((part) => part.text)
      .filter(Boolean)
      .join(" ");
    return { image: null, text };
  }

  return {
    image: {
      buffer: Buffer.from(imagePart.inlineData.data, "base64"),
      mimeType: imagePart.inlineData.mimeType || "image/png",
    },
    text: "",
  };
}
