import type {
  Competitor,
  FeatureDiff,
  Input,
  Positioning,
  PricingResult,
} from "../schema.js";
import { buildReportHtml } from "../report/template.js";
import { createLogger } from "@founderforge/observability";
import { supabaseConfigured, uploadPdfBuffer } from "../storage.js";

const log = createLogger("compileReport");

export interface CompileReportResult {
  report: {
    pdf_url: string;
    object_key?: string;
    html_preview?: string;
  };
  cost_usd: number;
}

/**
 * Render HTML → PDF buffer → upload to object storage → return signed URL.
 */
export async function compileReport(input: {
  input: Input;
  competitors: Competitor[];
  feature_diff: FeatureDiff;
  pricing: PricingResult;
  positioning: Positioning;
}): Promise<CompileReportResult> {
  if (!supabaseConfigured()) {
    throw new Error(
      "Supabase Storage is required (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)",
    );
  }

  const generatedAt = new Date().toISOString();
  const html = buildReportHtml({ ...input, generatedAt });
  const safeName = input.input.product_name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "report";
  const filename = `${safeName}-${Date.now()}.pdf`;

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  let pdfBytes: Buffer;
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const raw = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", right: "10mm", bottom: "12mm", left: "10mm" },
    });
    pdfBytes = Buffer.from(raw);
    log.info("pdf rendered in memory", { bytes: pdfBytes.length });
  } finally {
    await browser.close();
  }

  const uploaded = await uploadPdfBuffer(pdfBytes, { filename });
  return {
    report: {
      pdf_url: uploaded.url,
      object_key: uploaded.object_key,
      html_preview: html,
    },
    cost_usd: 0.01,
  };
}
