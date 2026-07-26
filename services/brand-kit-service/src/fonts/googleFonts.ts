// Google Fonts helper — resolves a font family to a real, usable font.
// Uses the Google Fonts CSS API to (1) confirm the family exists, (2) build a
// <link> stylesheet URL, and (3) download the actual .ttf files.

const CSS_BASE = "https://fonts.googleapis.com/css";

/** "Space Grotesk" -> "Space+Grotesk" */
function familyToParam(family: string): string {
  return String(family || "")
    .trim()
    .replace(/\s+/g, "+");
}

function isGenericFamily(family: string): boolean {
  return /^(sans-serif|serif|monospace|cursive|system-ui|ui-.*)$/i.test(
    String(family || "").trim(),
  );
}

/**
 * Build one Google Fonts stylesheet <link> URL for one or more families.
 */
export function googleFontsCssUrl(
  families: Array<string | undefined | null>,
  { weights = [400, 600, 700], display = "swap" }: { weights?: number[]; display?: string } = {},
): string | null {
  const list = [
    ...new Set(
      families.filter((f): f is string => typeof f === "string" && Boolean(f) && !isGenericFamily(f)),
    ),
  ];
  if (!list.length) return null;
  const parts = list.map((f) => `${familyToParam(f)}:${weights.join(",")}`);
  return `${CSS_BASE}?family=${parts.join("|")}&display=${display}`;
}

type FontFace = { weight: number; style: string; url: string };

/** Parse @font-face blocks from classic Google Fonts CSS (returns .ttf sources). */
function parseFontFaces(css: string): FontFace[] {
  const faces: FontFace[] = [];
  const blockRe = /@font-face\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(css))) {
    const block = match[1] ?? "";
    const weight = Number.parseInt((block.match(/font-weight:\s*(\d+)/) || [])[1] || "400", 10);
    const style = (block.match(/font-style:\s*([a-z]+)/) || [])[1] || "normal";
    const url = (block.match(/src:\s*url\(([^)]+)\)/) || [])[1];
    if (!url) continue;
    const clean = url.replace(/['"]/g, "").trim();
    if (!/\.ttf(\?|$)/i.test(clean)) continue;
    faces.push({ weight, style, url: clean });
  }
  return faces;
}

async function fetchCss(url: string): Promise<{ ok: boolean; status: number; css: string }> {
  const res = await fetch(url);
  if (!res.ok) return { ok: false, status: res.status, css: "" };
  return { ok: true, status: res.status, css: await res.text() };
}

export type ResolvedFontFile = {
  weight: number;
  style: string;
  ext: string;
  filename: string;
  buffer: Buffer;
};

export type ResolvedFont = {
  family: string;
  available: boolean;
  cssUrl: string | null;
  files: ResolvedFontFile[];
  regular: Buffer | null;
  error?: string;
};

/**
 * Resolve a single font family on Google Fonts and download its .ttf files.
 * Never throws — returns { available:false } when the family is missing/offline.
 */
export async function resolveGoogleFont(
  family: string | undefined | null,
  { weights = [400, 700] }: { weights?: number[] } = {},
): Promise<ResolvedFont> {
  const clean = String(family || "").trim();
  const base: ResolvedFont = {
    family: clean,
    available: false,
    cssUrl: googleFontsCssUrl([clean], { weights }),
    files: [],
    regular: null,
  };

  if (!clean || isGenericFamily(clean)) return base;

  try {
    let { ok, css } = await fetchCss(
      `${CSS_BASE}?family=${familyToParam(clean)}:${weights.join(",")}`,
    );
    if (!ok) ({ ok, css } = await fetchCss(`${CSS_BASE}?family=${familyToParam(clean)}`));
    if (!ok) return { ...base, error: "not_found_on_google_fonts" };

    const faces = parseFontFaces(css).filter((f) => f.style === "normal");
    if (!faces.length) return { ...base, error: "no_ttf_sources" };

    const wanted = new Set([...weights, 400]);
    const byWeight = new Map<number, FontFace>();
    for (const face of faces) {
      if (!byWeight.has(face.weight)) byWeight.set(face.weight, face);
    }
    const chosen = [...byWeight.values()].filter(
      (f) => wanted.has(f.weight) || byWeight.size <= 2,
    );
    const use = chosen.length ? chosen : [...byWeight.values()];

    const slug = clean.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
    const files: ResolvedFontFile[] = [];
    for (const face of use) {
      try {
        const res = await fetch(face.url);
        if (!res.ok) continue;
        const buffer = Buffer.from(await res.arrayBuffer());
        files.push({
          weight: face.weight,
          style: face.style,
          ext: "ttf",
          filename: `${slug}-${face.weight}.ttf`,
          buffer,
        });
      } catch {
        /* skip this weight */
      }
    }

    if (!files.length) return { ...base, error: "download_failed" };

    const regular = (files.find((f) => f.weight === 400) || files[0])!.buffer || null;

    return {
      family: clean,
      available: true,
      cssUrl: base.cssUrl,
      files,
      regular,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ...base, error: message };
  }
}

export type BrandTypography = {
  heading?: string;
  body?: string;
  mood?: string;
};

export type BrandFonts = {
  heading: ResolvedFont;
  body: ResolvedFont;
  cssUrl: string | null;
};

/**
 * Resolve the heading + body pairing chosen by the analyst.
 */
export async function resolveBrandFonts(typography: BrandTypography = {}): Promise<BrandFonts> {
  const heading = await resolveGoogleFont(typography.heading, { weights: [600, 700] });
  const body = await resolveGoogleFont(typography.body, { weights: [400, 700] });
  const cssUrl = googleFontsCssUrl([typography.heading, typography.body]);
  return { heading, body, cssUrl };
}

/** A drop-in CSS file the user can copy into their site. */
export function buildTypographyCss(
  typography: BrandTypography = {},
  fonts: Partial<BrandFonts> = {},
): string {
  const cssUrl = fonts.cssUrl || googleFontsCssUrl([typography.heading, typography.body]);
  const headingAvail = fonts.heading?.available
    ? ""
    : "  /* not on Google Fonts — bundled font file provided in /fonts */\n";
  const bodyAvail = fonts.body?.available
    ? ""
    : "  /* not on Google Fonts — bundled font file provided in /fonts */\n";
  return `/* Brand typography${typography.mood ? ` — ${typography.mood}` : ""} */
/* 1) Load the fonts (hosted). Add this to your <head>: */
${cssUrl ? `/* <link rel="stylesheet" href="${cssUrl}"> */` : "/* (fonts bundled locally in /fonts — see @font-face below) */"}

:root {
${headingAvail}  --font-heading: ${cssQuote(typography.heading)}, system-ui, sans-serif;
${bodyAvail}  --font-body: ${cssQuote(typography.body)}, system-ui, sans-serif;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-heading);
  font-weight: 700;
}

body, p, li, a, button, input {
  font-family: var(--font-body);
  font-weight: 400;
}
`;
}

/** A standalone HTML file the user can open to SEE the live fonts. */
export function buildTypographyPreviewHtml(
  brandName: string,
  typography: BrandTypography = {},
  fonts: Partial<BrandFonts> = {},
): string {
  const cssUrl = fonts.cssUrl || googleFontsCssUrl([typography.heading, typography.body]);
  const heading = typography.heading || "system-ui";
  const body = typography.body || "system-ui";
  const badge = (font: ResolvedFont | undefined) =>
    font?.available
      ? '<span class="ok">Google Fonts ✓</span>'
      : '<span class="warn">bundled in /fonts</span>';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(brandName)} — Typography</title>
${cssUrl ? `<link rel="stylesheet" href="${escapeHtml(cssUrl)}" />` : ""}
<style>
  body { margin: 0; padding: 48px; background: #fafafa; color: #111; }
  .wrap { max-width: 880px; margin: 0 auto; }
  .role { font: 600 12px/1.2 system-ui, sans-serif; letter-spacing: .14em; text-transform: uppercase; color: #888; margin: 32px 0 6px; }
  .name { font: 600 14px/1.2 system-ui, sans-serif; color: #444; margin-bottom: 14px; }
  .ok { color: #0a7d2c; font-weight: 700; }
  .warn { color: #b26a00; font-weight: 700; }
  h1.sample { font-family: ${cssQuote(heading)}, system-ui, sans-serif; font-weight: 700; font-size: 54px; margin: 0 0 6px; }
  h2.sample { font-family: ${cssQuote(heading)}, system-ui, sans-serif; font-weight: 600; font-size: 30px; margin: 0; }
  p.sample { font-family: ${cssQuote(body)}, system-ui, sans-serif; font-size: 18px; line-height: 1.6; max-width: 60ch; }
  .row { border-top: 1px solid #e5e5e5; padding-top: 18px; }
  .glyphs { font-size: 22px; color: #333; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="role">Brand</div>
    <div class="name" style="font-size:20px;color:#111;">${escapeHtml(brandName)}${typography.mood ? ` · ${escapeHtml(typography.mood)}` : ""}</div>

    <div class="row">
      <div class="role">Heading font</div>
      <div class="name">${escapeHtml(heading)} — ${badge(fonts.heading)}</div>
      <h1 class="sample">${escapeHtml(brandName)}</h1>
      <h2 class="sample">Bold headlines that set the tone</h2>
      <p class="glyphs" style="font-family:${cssQuote(heading)},system-ui,sans-serif;">AaBbCcDdEe · 0123456789 · &amp;?!</p>
    </div>

    <div class="row">
      <div class="role">Body font</div>
      <div class="name">${escapeHtml(body)} — ${badge(fonts.body)}</div>
      <p class="sample">The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. This is how paragraph copy will read across the product, marketing site, and documents.</p>
      <p class="glyphs" style="font-family:${cssQuote(body)},system-ui,sans-serif;">AaBbCcDdEe · 0123456789 · &amp;?!</p>
    </div>
  </div>
</body>
</html>`;
}

function cssQuote(family: string | undefined | null): string {
  const clean = String(family || "").trim();
  if (!clean) return "'system-ui'";
  return `'${clean.replace(/'/g, "")}'`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
