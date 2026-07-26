/**
 * Compile outreach findings → HTML → PDF (Playwright) → Supabase upload only.
 * PDFs are never written under services/outreach-service/output.
 */

import { buildReportHtml } from "./template.js";
import { supabaseConfigured, uploadPdfBuffer } from "./storage.js";
import { ensureChromiumInstalled } from "./ensureBrowsers.js";

function safeSlug(value: string): string {
  return (
    String(value || "company")
      .replace(/[^a-z0-9-_]+/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
      .slice(0, 48) || "company"
  );
}

function productLabelFromResult(result: {
  website?: { productSummary?: string; url?: string };
}): string {
  const summary = result?.website?.productSummary || "";
  const lines = String(summary)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines.slice(0, 6)) {
    const m =
      line.match(/\*\*Product name\*\*[:\s]*\*?\*?(.+?)(?:\*\*)?$/i) ||
      line.match(/^Product name[:\s]+(.+)$/i);
    if (m?.[1]) return m[1].replace(/\*+/g, "").trim();
  }
  try {
    return new URL(result?.website?.url || "").hostname.replace(/^www\./, "");
  } catch {
    return "company";
  }
}

export async function compileOutreachReport(
  result: Record<string, unknown>,
  opts: { includeHtml?: boolean } = {},
): Promise<{
  report: {
    pdf_url: string;
    object_key: string;
    bytes: number;
    html_preview?: string;
  };
}> {
  const generatedAt = new Date().toISOString();
  const html = buildReportHtml({ ...result, generatedAt });
  const label = productLabelFromResult(
    result as { website?: { productSummary?: string; url?: string } },
  );
  const filename = `${safeSlug(label)}-outreach-${Date.now()}.pdf`;

  await ensureChromiumInstalled();

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
  } finally {
    await browser.close();
  }

  if (!supabaseConfigured()) {
    throw new Error(
      "Outreach PDF upload requires OUTREACH_SUPABASE_URL + OUTREACH_SUPABASE_SERVICE_ROLE_KEY (or DEMO_SUPABASE_*). Local output is disabled.",
    );
  }

  const uploaded = await uploadPdfBuffer(pdfBytes, { filename });
  console.log(`  -> PDF uploaded (${(pdfBytes.length / 1024).toFixed(1)} KB)`);
  console.log(`  -> object: ${uploaded.object_key}`);

  return {
    report: {
      pdf_url: uploaded.url,
      object_key: uploaded.object_key,
      bytes: pdfBytes.length,
      html_preview: opts.includeHtml ? html : undefined,
    },
  };
}
