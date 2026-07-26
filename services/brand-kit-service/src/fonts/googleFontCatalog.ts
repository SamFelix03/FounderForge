/**
 * Curated Google Fonts allowlist for brand kits.
 *
 * Why this approach (low context, correct, low resource):
 * - Never dump the full Google Fonts catalog into the LLM prompt.
 * - A small fixed allowlist (~40 families) is encoded as JSON-schema enums,
 *   so Gemini can only return a real Google Font name.
 * - Exact family names match fonts.google.com / the CSS API, so downloads succeed.
 *
 * @see https://developers.google.com/fonts/docs/getting_started
 */

/** Display / headline-friendly Google Fonts */
export const HEADING_FONTS = Object.freeze([
  "Fraunces",
  "Playfair Display",
  "Libre Baskerville",
  "Lora",
  "Merriweather",
  "Source Serif 4",
  "Cormorant Garamond",
  "DM Serif Display",
  "Space Grotesk",
  "Outfit",
  "Sora",
  "Manrope",
  "Poppins",
  "Montserrat",
  "Raleway",
  "Syne",
  "Archivo",
  "Bebas Neue",
  "Oswald",
  "Anton",
  "JetBrains Mono",
  "IBM Plex Mono",
]) as readonly string[];

/** Readable body / UI Google Fonts */
export const BODY_FONTS = Object.freeze([
  "Inter",
  "Source Sans 3",
  "Nunito Sans",
  "DM Sans",
  "IBM Plex Sans",
  "Work Sans",
  "Karla",
  "Lato",
  "Open Sans",
  "Roboto",
  "Noto Sans",
  "Mulish",
  "Figtree",
  "Plus Jakarta Sans",
  "Lexend",
  "Literata",
  "Source Serif 4",
  "Lora",
  "IBM Plex Mono",
  "JetBrains Mono",
]) as readonly string[];

const HEADING_SET = new Set(HEADING_FONTS.map((f) => f.toLowerCase()));
const BODY_SET = new Set(BODY_FONTS.map((f) => f.toLowerCase()));

function findCanonical(
  name: string | undefined | null,
  list: readonly string[],
  set: Set<string>,
): string | null {
  const raw = String(name || "").trim();
  if (!raw) return null;
  if (set.has(raw.toLowerCase())) {
    return list.find((f) => f.toLowerCase() === raw.toLowerCase()) || null;
  }
  // Tiny fuzzy: strip spaces / hyphens (e.g. "SpaceGrotesk" → Space Grotesk)
  const compact = raw.toLowerCase().replace(/[\s-_]+/g, "");
  return list.find((f) => f.toLowerCase().replace(/[\s-_]+/g, "") === compact) || null;
}

/** Case-insensitive lookup → canonical Google Fonts family name. */
export function canonicalizeHeadingFont(name: string | undefined | null): string {
  return findCanonical(name, HEADING_FONTS, HEADING_SET) || HEADING_FONTS[8]!; // Space Grotesk
}

export function canonicalizeBodyFont(name: string | undefined | null): string {
  return findCanonical(name, BODY_FONTS, BODY_SET) || BODY_FONTS[0]!; // Inter
}

export function isAllowedHeadingFont(name: string | undefined | null): boolean {
  return Boolean(findCanonical(name, HEADING_FONTS, HEADING_SET));
}

export function isAllowedBodyFont(name: string | undefined | null): boolean {
  return Boolean(findCanonical(name, BODY_FONTS, BODY_SET));
}
