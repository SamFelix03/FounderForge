import { createVertexClient } from "./clients/vertexClient.js";
import { waitBetweenSteps } from "./clients/pace.js";
import { analyzeBrandBrief } from "./agents/brandAnalyst.js";
import { generateLogoConcepts } from "./agents/logoGenerator.js";
import { extractPaletteAndTypography } from "./agents/paletteTypography.js";
import { renderAssets } from "./report/assetSizer.js";
import { createZipBuffer } from "./report/zipper.js";
import { uploadBrandKitZip } from "./report/storage.js";
import {
  resolveBrandFonts,
  buildTypographyCss,
  buildTypographyPreviewHtml,
} from "./fonts/googleFonts.js";
import {
  renderColorPaletteImage,
  renderTypographySpecimenImage,
} from "./report/brandVisuals.js";
import { InputSchema, type Output } from "./schema.js";

export type PipelineStep = { step: string; detail?: string };
export type PipelineOpts = {
  onStep?: (s: PipelineStep) => void | Promise<void>;
};

function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

async function emit(
  onStep: PipelineOpts["onStep"],
  step: string,
  detail?: string,
): Promise<void> {
  if (onStep) await onStep({ step, detail });
}

/**
 * Full brand-kit pipeline:
 * analyze → logos → palette → fonts → visuals → assets → zip → upload
 */
export async function runPipeline(
  input: unknown,
  opts: PipelineOpts = {},
): Promise<Output> {
  const parsed = InputSchema.parse(input);
  const { brand_name: brandName, description, pick } = parsed;
  const { onStep } = opts;

  const { ai, project, location } = createVertexClient();
  console.log(`\n[Vertex AI] ${project}/${location}`);
  const slug = slugify(brandName);

  await emit(onStep, "analyze", "Analyzing brand brief");
  console.log("\n[Brand analyst] Analyzing brand brief (Vertex AI Gemini)...");
  const analysis = await analyzeBrandBrief({ brandName, description, count: 3, ai });
  console.log("  -> concepts:", analysis.concepts.map((c) => c.id).join(", "));
  console.log("  -> typography:", analysis.typography);

  await waitBetweenSteps("logo generator");
  await emit(onStep, "logos", "Generating logo concepts");
  console.log("\n[Logo generator] Generating logo concepts...");
  const concepts = await generateLogoConcepts({
    description,
    brandName,
    ai,
    angles: analysis.concepts,
  });
  console.log(`  -> ${concepts.length} concepts generated`);

  const chosen = concepts[pick] || concepts[0]!;
  console.log(
    `  -> using concept "${chosen.id}" as the primary mark (pass pick to choose a different one)`,
  );

  await waitBetweenSteps("palette / typography");
  await emit(onStep, "palette", "Extracting palette");
  console.log("\n[Palette / typography] Extracting palette + applying analyst typography...");
  const { palette, typography } = await extractPaletteAndTypography({
    logoBuffer: chosen.buffer,
    typography: analysis.typography,
  });
  console.log("  -> palette:", palette);
  console.log("  -> typography:", typography);

  await emit(onStep, "fonts", "Resolving Google Fonts");
  console.log("\n[Fonts] Resolving typography on Google Fonts + downloading font files...");
  const fonts = await resolveBrandFonts(typography);
  const headingFontBuffer = fonts.heading?.regular || null;
  const bodyFontBuffer = fonts.body?.regular || null;
  console.log(
    `  -> heading "${typography.heading}": ${
      fonts.heading?.available
        ? `downloaded ${fonts.heading.files.length} file(s)`
        : "not on Google Fonts"
    }`,
  );
  console.log(
    `  -> body "${typography.body}": ${
      fonts.body?.available
        ? `downloaded ${fonts.body.files.length} file(s)`
        : "not on Google Fonts"
    }`,
  );
  if (fonts.cssUrl) console.log(`  -> stylesheet: ${fonts.cssUrl}`);

  await emit(onStep, "visuals", "Rendering palette + typography images");
  console.log("\n[Visuals] Rendering color palette + typography specimen images...");
  const colorImage = await renderColorPaletteImage(palette, { brandName });
  const typographyImage = await renderTypographySpecimenImage({
    typography,
    headingFontBuffer,
    bodyFontBuffer,
    brandName,
  });
  console.log("  -> brand-colors.png + typography-specimen.png ready");

  await waitBetweenSteps("asset sizer");
  await emit(onStep, "assets", "Rendering icons + banners");
  console.log("\n[Asset sizer] Rendering icons + generating full-bleed banners...");
  const assets = await renderAssets({
    logoBuffer: chosen.buffer,
    logoMimeType: chosen.mimeType,
    palette,
    typography,
    brandName,
    description,
    ai,
  });
  console.log(`  -> ${assets.length} assets rendered`);

  const fontFiles = [
    ...(fonts.heading?.files || []).map((f) => ({
      zipPath: `fonts/heading-${f.filename}`,
      buffer: f.buffer,
    })),
    ...(fonts.body?.files || []).map((f) => ({
      zipPath: `fonts/body-${f.filename}`,
      buffer: f.buffer,
    })),
  ];

  const brandGuide = {
    brandName,
    description,
    chosenConcept: chosen.id,
    concepts: analysis.concepts,
    palette,
    typography: {
      ...typography,
      googleFontsStylesheet: fonts.cssUrl,
      heading: {
        family: typography.heading,
        onGoogleFonts: Boolean(fonts.heading?.available),
        files: (fonts.heading?.files || []).map((f) => `fonts/heading-${f.filename}`),
      },
      body: {
        family: typography.body,
        onGoogleFonts: Boolean(fonts.body?.available),
        files: (fonts.body?.files || []).map((f) => `fonts/body-${f.filename}`),
      },
    },
  };

  await emit(onStep, "zip", "Zipping brand kit");
  console.log("\n[Delivery] Zipping brand kit...");
  const zipBuffer = await createZipBuffer([
    ...assets.map((a) => ({ zipPath: `assets/${a.name}`, buffer: a.buffer })),
    ...concepts.map((c) => ({ zipPath: `concepts/${c.id}.png`, buffer: c.buffer })),
    { zipPath: "brand-colors.png", buffer: colorImage },
    { zipPath: "typography-specimen.png", buffer: typographyImage },
    { zipPath: "typography.css", buffer: Buffer.from(buildTypographyCss(typography, fonts)) },
    {
      zipPath: "typography.html",
      buffer: Buffer.from(buildTypographyPreviewHtml(brandName, typography, fonts)),
    },
    ...fontFiles,
    {
      zipPath: "brand-guide.json",
      buffer: Buffer.from(JSON.stringify(brandGuide, null, 2)),
    },
    {
      zipPath: "analysis.json",
      buffer: Buffer.from(JSON.stringify(analysis, null, 2)),
    },
  ]);

  await emit(onStep, "upload", "Uploading zip to Supabase");
  console.log("\n[Delivery] Uploading zip to Supabase...");
  const uploaded = await uploadBrandKitZip(zipBuffer, `${slug}-brand-kit.zip`);

  console.log("\nDone. Brand kit ready.");
  console.log(`  url: ${uploaded.url}\n`);

  return {
    status: "ok",
    brand_name: brandName,
    chosen_concept: chosen.id,
    palette,
    typography: brandGuide.typography,
    zip_url: uploaded.url,
    object_key: uploaded.objectPath,
    cost_breakdown: [],
  };
}
