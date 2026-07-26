import { z } from "zod";

/** API / Temporal input — website + spreadsheet (URL and/or local path for CLI). */
export const InputSchema = z
  .object({
    website_url: z.string().url(),
    /** Public URL to an .xlsx/.xls/.csv workbook (downloaded at runtime). */
    sheet_url: z.string().url().optional(),
    /** Local filesystem path (live-run / offline only). */
    sheet_path: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.sheet_url || v.sheet_path), {
    message: "Provide sheet_url or sheet_path",
    path: ["sheet_url"],
  });

export type Input = z.infer<typeof InputSchema>;

export const ContactSchema = z.object({
  name: z.string(),
  firm: z.string(),
  role: z.string().optional().default(""),
  linkedin: z.string().optional().default(""),
  email: z.string().optional().default(""),
  twitter: z.string().optional().default(""),
  otherSocials: z.array(z.string()).optional().default([]),
  sourceUrl: z.string().optional(),
});

export type Contact = z.infer<typeof ContactSchema>;

export const OutputSchema = z.object({
  status: z.literal("ok"),
  website: z.object({
    url: z.string(),
    model: z.string(),
    toolsUsed: z.array(z.string()),
    productSummary: z.string(),
  }),
  revenue: z.object({
    model: z.string(),
    sheet: z.record(z.unknown()).optional(),
    performanceSummary: z.string(),
  }),
  investors: z.object({
    model: z.string(),
    query: z.string().optional(),
    additionalQueries: z.array(z.string()).optional(),
    exaResultCount: z.number(),
    investorSummary: z.string(),
    structuredOutput: z.unknown().optional(),
    sources: z.array(z.object({ title: z.string(), url: z.string() })),
  }),
  portfolioBenchmarks: z.object({
    model: z.string(),
    query: z.string().optional(),
    additionalQueries: z.array(z.string()).optional(),
    exaResultCount: z.number(),
    portfolioRevenueSummary: z.string(),
    structuredOutput: z.unknown().optional(),
    sources: z.array(z.object({ title: z.string(), url: z.string() })),
  }),
  partnerContacts: z.object({
    model: z.string(),
    firms: z.array(z.string()),
    query: z.string().optional(),
    contactSummary: z.string(),
    contacts: z.array(ContactSchema),
    sources: z.array(z.object({ title: z.string(), url: z.string() })),
  }),
  report: z.object({
    pdf_url: z.string().url().optional(),
    local_path: z.string().optional(),
    object_key: z.string().optional(),
    bytes: z.number().optional(),
  }),
  cost_breakdown: z
    .array(
      z.object({
        vendor: z.string(),
        operation: z.string(),
        amount_usd: z.number(),
        units: z.number().optional(),
      }),
    )
    .optional()
    .default([]),
});

export type Output = z.infer<typeof OutputSchema>;
