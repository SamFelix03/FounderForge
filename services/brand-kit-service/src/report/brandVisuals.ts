// Brand visuals — renders shareable PNGs for the kit:
//   1) brand-colors.png       full-bleed color blocks, each labeled with its hex code
//   2) typography-specimen.png heading + body samples with the actual font names
//
// Both are built as SVG and rasterized with sharp.

import sharp from "sharp";
import type { BrandTypography } from "../fonts/googleFonts.js";

const ROLE_ORDER = ["primary", "secondary", "accent", "dark", "light"] as const;

function normalizeHex(hex: string | undefined | null): string | null {
  let h = String(hex || "").trim();
  if (!h) return null;
  if (!h.startsWith("#")) h = `#${h}`;
  if (/^#([0-9a-f]{3})$/i.test(h)) {
    h = "#" + h.slice(1).split("").map((c) => c + c).join("");
  }
  return /^#([0-9a-f]{6})$/i.test(h) ? h.toUpperCase() : null;
}

/** Relative luminance → pick black/white text for contrast. */
function readableTextColor(hex: string): string {
  const h = normalizeHex(hex);
  if (!h) return "#111111";
  const r = parseInt(h.slice(1, 3), 16) / 255;
  const g = parseInt(h.slice(3, 5), 16) / 255;
  const b = parseInt(h.slice(5, 7), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.5 ? "#111111" : "#FFFFFF";
}

function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * Full-bleed color palette image: equal-width blocks, each with role + hex.
 */
export async function renderColorPaletteImage(
  palette: Record<string, string> = {},
  opts: { width?: number; height?: number; brandName?: string } = {},
): Promise<Buffer> {
  const width = opts.width || 1600;
  const height = opts.height || 520;
  const brandName = opts.brandName || "";

  type PaletteEntry = { role: string; hex: string };
  const entries: PaletteEntry[] = [];
  for (const role of ROLE_ORDER) {
    const hex = normalizeHex(palette[role]);
    if (hex) entries.push({ role, hex });
  }
  for (const role of Object.keys(palette)) {
    if ((ROLE_ORDER as readonly string[]).includes(role)) continue;
    const hex = normalizeHex(palette[role]);
    if (hex) entries.push({ role, hex });
  }

  if (!entries.length) {
    entries.push({ role: "primary", hex: "#111111" });
  }

  const blockW = width / entries.length;
  const blocks = entries
    .map((e, i) => {
      const x = i * blockW;
      const textColor = readableTextColor(e.hex);
      const swatchDot = textColor === "#FFFFFF" ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.7)";
      return `
      <g>
        <rect x="${x.toFixed(2)}" y="0" width="${(blockW + 1).toFixed(2)}" height="${height}" fill="${e.hex}" />
        <circle cx="${(x + 34).toFixed(2)}" cy="${height - 96}" r="7" fill="${swatchDot}" />
        <text x="${(x + 50).toFixed(2)}" y="${height - 90}"
          font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700"
          letter-spacing="2" fill="${textColor}" opacity="0.85">${escapeXml(e.role.toUpperCase())}</text>
        <text x="${(x + 34).toFixed(2)}" y="${height - 46}"
          font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700"
          fill="${textColor}">${escapeXml(e.hex)}</text>
      </g>`;
    })
    .join("");

  const header = brandName
    ? `<text x="34" y="52" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700" fill="#111111">${escapeXml(
        brandName,
      )} — Color palette</text>`
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff" />
  ${blocks}
  ${header ? `<rect x="0" y="0" width="${width}" height="72" fill="rgba(255,255,255,0.0)" />${header}` : ""}
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Typography specimen. Embeds the actual downloaded TTFs (when available) via
 * @font-face data URIs, and always prints the exact font family names.
 */
export async function renderTypographySpecimenImage({
  typography = {},
  headingFontBuffer = null,
  bodyFontBuffer = null,
  brandName = "",
}: {
  typography?: BrandTypography;
  headingFontBuffer?: Buffer | null;
  bodyFontBuffer?: Buffer | null;
  brandName?: string;
} = {}): Promise<Buffer> {
  const width = 1600;
  const height = 900;
  const heading = typography.heading || "System Sans";
  const body = typography.body || "System Sans";

  const faces: string[] = [];
  if (headingFontBuffer) {
    faces.push(
      `@font-face { font-family: 'BrandHeading'; font-weight: 700; src: url(data:font/ttf;base64,${headingFontBuffer.toString(
        "base64",
      )}) format('truetype'); }`,
    );
  }
  if (bodyFontBuffer) {
    faces.push(
      `@font-face { font-family: 'BrandBody'; font-weight: 400; src: url(data:font/ttf;base64,${bodyFontBuffer.toString(
        "base64",
      )}) format('truetype'); }`,
    );
  }

  const headingFamily = headingFontBuffer
    ? "'BrandHeading', Arial, sans-serif"
    : "Arial, Helvetica, sans-serif";
  const bodyFamily = bodyFontBuffer
    ? "'BrandBody', Arial, sans-serif"
    : "Arial, Helvetica, sans-serif";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs><style>${faces.join("\n")}</style></defs>
  <rect width="${width}" height="${height}" fill="#ffffff" />
  <rect x="0" y="0" width="${width}" height="10" fill="#111111" />

  <text x="64" y="96" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700" letter-spacing="3" fill="#999999">TYPOGRAPHY${
    typography.mood ? ` · ${escapeXml(typography.mood.toUpperCase())}` : ""
  }</text>

  <!-- Heading -->
  <text x="64" y="150" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" letter-spacing="2" fill="#111111">HEADING — ${escapeXml(
    heading,
  )}</text>
  <text x="64" y="250" font-family="${headingFamily}" font-size="88" font-weight="700" fill="#111111">${escapeXml(
    brandName || heading,
  )}</text>
  <text x="64" y="330" font-family="${headingFamily}" font-size="46" font-weight="700" fill="#333333">Bold headlines set the tone</text>
  <text x="64" y="392" font-family="${headingFamily}" font-size="34" fill="#555555">AaBbCcDdEe Gg Kk Rr · 0123456789 · &amp;?!</text>

  <line x1="64" y1="440" x2="${width - 64}" y2="440" stroke="#e5e5e5" stroke-width="2" />

  <!-- Body -->
  <text x="64" y="500" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" letter-spacing="2" fill="#111111">BODY — ${escapeXml(
    body,
  )}</text>
  <text x="64" y="560" font-family="${bodyFamily}" font-size="32" fill="#222222">The quick brown fox jumps over the lazy dog.</text>
  <text x="64" y="606" font-family="${bodyFamily}" font-size="32" fill="#222222">Pack my box with five dozen liquor jugs.</text>
  <text x="64" y="664" font-family="${bodyFamily}" font-size="26" fill="#555555">AaBbCcDdEe Ff Gg Hh Ii Jj Kk · 0123456789 · &amp;?!</text>
  <text x="64" y="712" font-family="${bodyFamily}" font-size="22" fill="#777777">Body copy renders like this across your site, product UI, and documents.</text>

  <text x="64" y="${height - 40}" font-family="Arial, Helvetica, sans-serif" font-size="20" fill="#999999">Heading: ${escapeXml(
    heading,
  )}    ·    Body: ${escapeXml(body)}${brandName ? `    ·    ${escapeXml(brandName)}` : ""}</text>
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}
