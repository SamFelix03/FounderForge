/**
 * Build Reddit engagement PDF with pdfkit — no browser required.
 */
import PDFDocument from "pdfkit";
import type { RedditReportData } from "./types.js";
import { supabaseConfigured, uploadPdfBuffer } from "./storage.js";

function safeSlug(value: string): string {
  return (
    String(value || "product")
      .replace(/[^a-z0-9-_]+/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
      .slice(0, 48) || "product"
  );
}

function subLabel(community: string | null): string {
  if (!community) return "Reddit";
  return community.startsWith("r/") ? community : `r/${community}`;
}

function pdfToBuffer(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

function renderPdf(data: RedditReportData): InstanceType<typeof PDFDocument> {
  const doc = new PDFDocument({
    size: "A4",
    margin: 48,
    info: {
      Title: `Reddit Engagement Plan — ${data.product.product_name}`,
    },
  });

  const product = data.product;
  const recs = data.recommendations;
  const subs = data.subreddits?.length
    ? data.subreddits
    : ([...new Set(recs.map((r) => r.community).filter(Boolean))] as string[]);

  doc
    .fillColor("#1a1f24")
    .fontSize(22)
    .font("Helvetica-Bold")
    .text("Reddit Engagement Plan", { align: "left" });
  doc.moveDown(0.3);
  doc.fontSize(16).text(product.product_name);
  doc.moveDown(0.2);
  doc
    .fontSize(10)
    .font("Helvetica")
    .fillColor("#5c6b73")
    .text(product.one_liner || product.description.slice(0, 200));
  doc.moveDown(0.2);
  doc.fillColor("#ff4500").text(data.websiteUrl, { link: data.websiteUrl });
  doc.moveDown(0.4);
  doc
    .fillColor("#888")
    .fontSize(8)
    .text(`Generated ${new Date(data.generatedAt).toLocaleString()}`, {
      align: "left",
    });

  doc.moveDown(1);
  doc.fillColor("#1a1f24").fontSize(13).font("Helvetica-Bold").text("Target subreddits");
  doc.moveDown(0.3);
  doc.fontSize(10).font("Helvetica").fillColor("#333");
  doc.text(subs.map((s) => subLabel(s)).join("  ·  ") || "—");
  doc.moveDown(1);

  doc.fontSize(13).font("Helvetica-Bold").fillColor("#1a1f24").text(
    `Suggested comments (${recs.length})`,
  );
  doc.moveDown(0.4);
  doc
    .fontSize(9)
    .font("Helvetica")
    .fillColor("#5c6b73")
    .text("Copy-paste ready — review before posting manually.");

  recs.forEach((r, i) => {
    doc.moveDown(0.8);
    if (doc.y > 700) doc.addPage();

    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .fillColor("#ff4500")
      .text(`${i + 1}. ${subLabel(r.community)}`);
    doc
      .fontSize(10)
      .font("Helvetica-Bold")
      .fillColor("#1a1f24")
      .text(r.title || "Thread");
    doc
      .fontSize(8)
      .fillColor("#0066cc")
      .text(r.permalink, { link: r.permalink, underline: true });

    if (r.threadContext) {
      doc.moveDown(0.2);
      doc.fontSize(8).fillColor("#666").font("Helvetica");
      doc.text(`Why: ${r.threadContext.slice(0, 400)}`);
    }

    doc.moveDown(0.3);
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#1a1f24").text("Comment to post:");
    doc.moveDown(0.15);
    doc.fontSize(10).font("Helvetica").fillColor("#111").text(r.draftText, {
      align: "left",
      lineGap: 2,
    });

    if (r.draftRationale) {
      doc.moveDown(0.2);
      doc.fontSize(8).fillColor("#888").text(`Notes: ${r.draftRationale}`);
    }
  });

  return doc;
}

export async function compileRedditReport(
  data: RedditReportData,
): Promise<{
  report: {
    pdf_url: string;
    object_key: string;
    bytes: number;
  };
}> {
  const generatedAt = data.generatedAt || new Date().toISOString();
  const doc = renderPdf({ ...data, generatedAt });
  const pdfBytes = await pdfToBuffer(doc);

  if (!supabaseConfigured()) {
    throw new Error(
      "Reddit report upload requires REDDIT_DOC_SUPABASE_URL + REDDIT_DOC_SUPABASE_SERVICE_ROLE_KEY (or DEMO_SUPABASE_*).",
    );
  }

  const filename = `${safeSlug(data.product.product_name)}-reddit-${Date.now()}.pdf`;
  const uploaded = await uploadPdfBuffer(pdfBytes, { filename });
  return {
    report: {
      pdf_url: uploaded.url,
      object_key: uploaded.object_key,
      bytes: pdfBytes.length,
    },
  };
}
