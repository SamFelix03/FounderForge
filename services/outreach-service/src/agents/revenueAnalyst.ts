// Revenue analyst — reads ALL sheets and summarizes company financial performance.

import { sheetModel, type GroqChatClient } from "../clients/groqClient.js";
import { loadWorkbook } from "../clients/sheetLoader.js";

export type RevenueAnalysis = {
  performanceSummary: string;
  model: string;
  sheetMeta: {
    fileName: string;
    sheetCount: number;
    sheets: Array<{ sheetName: string; rowCount: number; headers: string[] }>;
  };
};

export async function analyzeRevenueSheet({
  groq,
  sheetPath,
}: {
  groq: GroqChatClient;
  sheetPath: string;
}): Promise<RevenueAnalysis> {
  if (!sheetPath?.trim()) throw new Error("Sheet path is required");

  const model = sheetModel();
  const workbook = loadWorkbook(sheetPath);

  console.log(`  analyzing workbook with ${model}...`);
  console.log(
    `  file=${workbook.fileName} sheets=${workbook.sheets.length} [${workbook.sheets
      .map((s) => `${s.sheetName}(${s.rowCount})`)
      .join(", ")}]`,
  );

  const sheetList = workbook.sheets
    .map(
      (s, i) =>
        `${i + 1}. "${s.sheetName}" — ${s.rowCount} rows — columns: ${s.headers.join(", ") || "(none)"}`,
    )
    .join("\n");

  const completion = await groq.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You are a finance-minded company performance analyst. You will receive MULTIPLE sheets from the same workbook. Read every sheet, cross-check related metrics (ARR, MRR, bookings, growth, churn, customers, etc.), and produce one clear performance summary that synthesizes the whole file. Be factual. Do not invent numbers. If sheets conflict, call that out.",
      },
      {
        role: "user",
        content: `Analyze this company revenue workbook. It contains multiple sheets — you must use ALL of them.

File: ${workbook.fileName}
Sheets (${workbook.sheets.length}):
${sheetList}

Full workbook content:
\`\`\`
${workbook.text}
\`\`\`

Return only:
1) Revenue overview (ARR/MRR/other metrics across sheets)
2) Trajectory (growth, decline, flat — with evidence)
3) Cross-sheet insights (how sheets relate; e.g. customers vs MRR vs churn)
4) Notable patterns (seasonality, concentration, segment mix if present)
5) Risks / gaps / inconsistencies across sheets
Keep it short and specific.`,
      },
    ],
  });

  const performanceSummary = (completion.choices?.[0]?.message?.content || "").trim();
  if (!performanceSummary) {
    throw new Error("Sheet model returned an empty performance summary");
  }

  return {
    performanceSummary,
    model,
    sheetMeta: {
      fileName: workbook.fileName,
      sheetCount: workbook.sheets.length,
      sheets: workbook.sheets.map((s) => ({
        sheetName: s.sheetName,
        rowCount: s.rowCount,
        headers: s.headers,
      })),
    },
  };
}
