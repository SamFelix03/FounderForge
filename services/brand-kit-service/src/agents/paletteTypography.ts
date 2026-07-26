// Palette / Typography
// Extracts an actual color palette from the chosen logo image.
// Typography comes from the brand analyst (Gemini).

import { Vibrant } from "node-vibrant/node";
import type { BrandTypographyChoice } from "./brandAnalyst.js";

export type BrandPalette = {
  primary: string;
  secondary: string;
  accent: string;
  light: string;
  dark: string;
};

export async function extractPaletteAndTypography({
  logoBuffer,
  typography,
}: {
  logoBuffer: Buffer;
  typography: BrandTypographyChoice;
}): Promise<{ palette: BrandPalette; typography: BrandTypographyChoice }> {
  const rawPalette = await Vibrant.from(logoBuffer).getPalette();
  const toHex = (swatch: { hex: string } | null | undefined): string | null =>
    swatch ? swatch.hex : null;

  const palette: BrandPalette = {
    primary: toHex(rawPalette.Vibrant) || toHex(rawPalette.DarkVibrant) || "#111111",
    secondary: toHex(rawPalette.Muted) || toHex(rawPalette.LightVibrant) || "#666666",
    accent: toHex(rawPalette.DarkVibrant) || toHex(rawPalette.Vibrant) || "#222222",
    light: toHex(rawPalette.LightMuted) || "#F5F5F5",
    dark: toHex(rawPalette.DarkMuted) || "#0A0A0A",
  };

  return { palette, typography };
}
