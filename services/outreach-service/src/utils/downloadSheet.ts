import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";

function extensionFromUrl(sheetUrl: string, contentType: string | null): string {
  try {
    const pathname = new URL(sheetUrl).pathname;
    const ext = path.extname(pathname).toLowerCase();
    if (ext && [".xlsx", ".xls", ".csv", ".ods", ".xlsm", ".xlsb"].includes(ext)) {
      return ext;
    }
  } catch {
    /* ignore */
  }
  if (contentType?.includes("csv")) return ".csv";
  if (contentType?.includes("spreadsheetml") || contentType?.includes("excel")) {
    return ".xlsx";
  }
  return ".xlsx";
}

/**
 * Download a remote spreadsheet URL to a temp file and return its local path.
 */
export async function downloadSheetToTemp(sheetUrl: string): Promise<string> {
  const url = String(sheetUrl || "").trim();
  if (!url) throw new Error("sheet_url is required");

  console.log(`  downloading sheet: ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download sheet (${res.status}): ${res.statusText}`);
  }

  const ext = extensionFromUrl(url, res.headers.get("content-type"));
  const dir = path.join(os.tmpdir(), "founderforge-outreach");
  await mkdir(dir, { recursive: true });
  const dest = path.join(dir, `sheet-${Date.now()}-${randomUUID().slice(0, 8)}${ext}`);

  if (!res.body) {
    throw new Error("Sheet download returned an empty body");
  }

  const nodeStream = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
  await pipeline(nodeStream, createWriteStream(dest));
  console.log(`  -> saved to ${dest}`);
  return dest;
}
