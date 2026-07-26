import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

const SUPPORTED = new Set([".xlsx", ".xls", ".csv", ".ods", ".xlsm", ".xlsb"]);
const MAX_CHARS_PER_SHEET = 25_000;
const MAX_CHARS_TOTAL = 80_000;

export type WorkbookSheet = {
  sheetName: string;
  text: string;
  rowCount: number;
  headers: string[];
  revenueScore: number;
};

export type WorkbookData = {
  fileName: string;
  sheets: WorkbookSheet[];
  text: string;
};

/**
 * Load every non-empty sheet from a workbook for LLM analysis.
 */
export function loadWorkbook(filePath: string): WorkbookData {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Sheet file not found: ${resolved}`);
  }

  const ext = path.extname(resolved).toLowerCase();
  if (!SUPPORTED.has(ext)) {
    throw new Error(
      `Unsupported sheet type "${ext}". Use one of: ${[...SUPPORTED].join(", ")}`,
    );
  }

  const workbook = XLSX.readFile(resolved, { cellDates: true });
  if (!workbook.SheetNames.length) {
    throw new Error("Workbook has no sheets");
  }

  const sheets: WorkbookSheet[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: false,
      blankrows: false,
    });
    if (!rows.length) continue;

    const headers = Object.keys(rows[0] || {});
    const csv = XLSX.utils.sheet_to_csv(sheet, { FS: ",", RS: "\n" });
    const sample = csv.slice(0, 4000).toLowerCase();
    const revenueScore =
      scoreRevenueText(sheetName.toLowerCase()) * 3 + scoreRevenueText(sample);

    sheets.push({
      sheetName,
      text: truncate(csv, MAX_CHARS_PER_SHEET),
      rowCount: rows.length,
      headers,
      revenueScore,
    });
  }

  if (!sheets.length) {
    throw new Error("Workbook has no non-empty sheets");
  }

  // Revenue-looking sheets first, but still include every sheet.
  sheets.sort((a, b) => b.revenueScore - a.revenueScore);

  return {
    fileName: path.basename(resolved),
    sheets,
    text: buildCombinedText(sheets),
  };
}

function buildCombinedText(sheets: WorkbookSheet[]): string {
  const parts: string[] = [];
  let used = 0;

  for (const sheet of sheets) {
    const block = [
      `===== SHEET: ${sheet.sheetName} =====`,
      `Rows: ${sheet.rowCount}`,
      `Columns: ${sheet.headers.join(", ") || "(none)"}`,
      "CSV:",
      sheet.text,
    ].join("\n");

    if (used + block.length > MAX_CHARS_TOTAL) {
      const remaining = Math.max(0, MAX_CHARS_TOTAL - used - 80);
      if (remaining > 500) {
        parts.push(
          `${block.slice(0, remaining)}\n\n[truncated — remaining sheets/content omitted for length]`,
        );
      } else {
        parts.push(
          `\n[truncated — skipped remaining sheets after "${sheet.sheetName}" due to size limits]`,
        );
      }
      break;
    }

    parts.push(block);
    used += block.length + 2;
  }

  return parts.join("\n\n");
}

function scoreRevenueText(text: string): number {
  const keys = [
    "arr",
    "mrr",
    "revenue",
    "recurring",
    "saas",
    "bookings",
    "gmv",
    "net revenue",
    "gross revenue",
    "monthly",
    "annual",
    "churn",
    "customers",
    "pipeline",
  ];
  return keys.reduce((sum, key) => sum + (text.includes(key) ? 1 : 0), 0);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[truncated — sheet continues beyond ${max} characters]`;
}
