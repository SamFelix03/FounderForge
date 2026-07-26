// Asset Sizer / Banner Generator
// Square icons stay sharp-resized from the chosen logo.
// OG / Twitter / LinkedIn banners are full-bleed Vertex AI images
// that use the logo as a brand reference, then get cropped to exact pixel sizes.

import sharp from "sharp";
import pngToIco from "png-to-ico";
import type { GoogleGenAI } from "@google/genai";
import { generateContentWithRetry, waitBetweenSteps } from "../clients/pace.js";
import { assertSupportedAspectRatio, extractInlineImage } from "../clients/imageUtils.js";
import type { BrandPalette } from "../agents/paletteTypography.js";
import type { BrandTypography } from "../fonts/googleFonts.js";

const ICON_SIZES = [
  { size: 16, name: "favicon-16x16.png" },
  { size: 32, name: "favicon-32x32.png" },
  { size: 48, name: "favicon-48x48.png" },
  { size: 180, name: "apple-touch-icon.png" },
  { size: 192, name: "android-chrome-192x192.png" },
  { size: 512, name: "app-icon-512x512.png" },
  { size: 1024, name: "app-icon-1024x1024.png" },
] as const;

type BannerSpec = {
  name: string;
  width: number;
  height: number;
  aspectRatio: string;
  purpose: string;
  guidance: string;
};

// Only use aspect ratios supported by gemini-2.5-flash-image, then crop to exact pixels.
const BANNERS: BannerSpec[] = [
  {
    name: "og-image-1200x630.png",
    width: 1200,
    height: 630,
    aspectRatio: "16:9",
    purpose: "Open Graph / social share card",
    guidance:
      "Design a complete share-card scene. Include the brand name once as clean typography. Leave some calm area so the composition still reads when cropped slightly.",
  },
  {
    name: "twitter-banner-1500x500.png",
    width: 1500,
    height: 500,
    aspectRatio: "21:9",
    purpose: "Twitter / X profile banner",
    guidance:
      "Design a wide cinematic profile banner with atmospheric brand visuals across the full width. Keep important marks away from the extreme edges.",
  },
  {
    name: "linkedin-banner-1584x396.png",
    width: 1584,
    height: 396,
    aspectRatio: "21:9",
    purpose: "LinkedIn company / profile banner",
    guidance:
      "Design a professional ultra-wide LinkedIn banner with rich visual content spanning the entire frame. Keep the composition balanced and corporate-clean.",
  },
];

for (const banner of BANNERS) {
  assertSupportedAspectRatio(banner.aspectRatio);
}

export type RenderedAsset = { name: string; buffer: Buffer };

export async function renderAssets({
  logoBuffer,
  logoMimeType = "image/png",
  palette,
  typography,
  brandName,
  description,
  ai,
}: {
  logoBuffer: Buffer;
  logoMimeType?: string;
  palette: BrandPalette;
  typography?: BrandTypography;
  brandName: string;
  description: string;
  ai: GoogleGenAI;
}): Promise<RenderedAsset[]> {
  if (!ai) throw new Error("renderAssets requires a Vertex AI client for banner generation");

  const assets: RenderedAsset[] = [];
  const iconBuffers: Record<number, Buffer> = {};

  for (const { size, name } of ICON_SIZES) {
    const buffer = await sharp(logoBuffer)
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    if ([16, 32, 48].includes(size)) iconBuffers[size] = buffer;
    assets.push({ name, buffer });
  }

  const icoBuffer = await pngToIco([iconBuffers[16]!, iconBuffers[32]!, iconBuffers[48]!]);
  assets.push({ name: "favicon.ico", buffer: icoBuffer });

  for (let i = 0; i < BANNERS.length; i++) {
    if (i > 0) await waitBetweenSteps(`banner ${i + 1}`);

    const banner = BANNERS[i]!;
    console.log(`  generating banner "${banner.name}" via Vertex AI...`);
    const generated = await generateBannerImage({
      ai,
      logoBuffer,
      logoMimeType,
      palette,
      typography,
      brandName,
      description,
      banner,
    });

    const buffer = await sharp(generated)
      .resize(banner.width, banner.height, { fit: "cover", position: "centre" })
      .png()
      .toBuffer();

    assets.push({ name: banner.name, buffer });
  }

  return assets;
}

async function generateBannerImage({
  ai,
  logoBuffer,
  logoMimeType,
  palette,
  typography,
  brandName,
  description,
  banner,
}: {
  ai: GoogleGenAI;
  logoBuffer: Buffer;
  logoMimeType: string;
  palette: BrandPalette;
  typography?: BrandTypography;
  brandName: string;
  description: string;
  banner: BannerSpec;
}): Promise<Buffer> {
  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
  const aspectRatio = assertSupportedAspectRatio(banner.aspectRatio);
  const colors = [
    palette?.primary && `primary ${palette.primary}`,
    palette?.secondary && `secondary ${palette.secondary}`,
    palette?.accent && `accent ${palette.accent}`,
    palette?.dark && `dark ${palette.dark}`,
    palette?.light && `light ${palette.light}`,
  ]
    .filter(Boolean)
    .join(", ");

  const prompt = `Create a finished ${banner.purpose} for the brand "${brandName}".

Brand context: ${description}
Mood: ${typography?.mood || "modern professional"}
Typography vibe: heading ${typography?.heading || "clean sans"}, body ${typography?.body || "readable sans"}
Color direction: ${colors || "derive from the attached logo"}

${banner.guidance}

Hard requirements:
- Fill the ENTIRE frame edge-to-edge with intentional visual content (gradients, abstract geometry, motifs, atmosphere, or brand world-building).
- Do NOT leave large empty grey/white/beige negative space.
- Do NOT place a tiny logo tile in the center of a blank field.
- Use the attached logo as brand identity reference and incorporate its mark tastefully into the composition (as a secondary or mid-ground element, not a lonely centered stamp).
- Make it look like a real marketed social banner, not a logo mockup.
- No watermarks, no UI chrome, no stock photo collage look.`;

  const response = await generateContentWithRetry(
    ai,
    {
      model,
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: logoMimeType || "image/png",
                data: logoBuffer.toString("base64"),
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio },
      },
    },
    { label: `banner "${banner.name}"` },
  );

  const { image, text } = extractInlineImage(response);
  if (!image) {
    throw new Error(
      `Vertex returned no banner image for "${banner.name}".${text ? ` Response: ${text}` : ""}`,
    );
  }

  return image.buffer;
}
