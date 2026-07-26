/**
 * Compile outreach findings → HTML → PDF (Playwright), optional Supabase upload.
 * Mirrors FounderForge competitor-research compileReport pattern.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
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
  opts: { outDir?: string; includeHtml?: boolean } = {},
): Promise<{
  report: {
    local_path: string;
    pdf_url: string | null;
    object_key: string | null;
    bytes: number;
    html_preview?: string;
  };
}> {
  const generatedAt = new Date().toISOString();
  const html = buildReportHtml({ ...result, generatedAt });
  const label = productLabelFromResult(result as { website?: { productSummary?: string; url?: string } });
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

  const outDir = opts.outDir || path.resolve(process.cwd(), "output");
  await mkdir(outDir, { recursive: true });
  const localPath = path.join(outDir, filename);
  await writeFile(localPath, pdfBytes);

  let pdfUrl: string | null = null;
  let objectKey: string | null = null;
  if (supabaseConfigured()) {
    const uploaded = await uploadPdfBuffer(pdfBytes, { filename });
    pdfUrl = uploaded.url;
    objectKey = uploaded.object_key;
  } else {
    console.warn(
      "  -> Supabase not configured (set OUTREACH_SUPABASE_URL + OUTREACH_SUPABASE_SERVICE_ROLE_KEY, or DEMO_SUPABASE_*)",
    );
  }

  return {
    report: {
      local_path: localPath,
      pdf_url: pdfUrl,
      object_key: objectKey,
      bytes: pdfBytes.length,
      html_preview: opts.includeHtml ? html : undefined,
    },
  };
}
