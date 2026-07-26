# Outreach — investor intelligence PDF

## Endpoint

`POST /v1/services/outreach/jobs`

```json
{
  "input": {
    "website_url": "https://example.com",
    "sheet_url": "https://cdn.example/revenue.xlsx"
  }
}
```

## Pipeline

1. Download spreadsheet from `sheet_url`
2. Groq Compound website summary
3. Multi-sheet revenue performance summary
4. Exa investor shortlist + portfolio ARR/MRR comps
5. Partner contacts + per-person enrichment
6. Playwright PDF → Supabase only (`OUTREACH_SUPABASE_*` or `DEMO_SUPABASE_*`). No local `output/` write.

## Result

Poll `GET /v1/jobs/:id`. On success, `artifacts[]` includes a `pdf_report` with `url`.

## Local live-run

```bash
pnpm --filter @founderforge/outreach-service live -- \
  --website-url 'https://example.com' \
  --sheet-path './path/to/revenue.xlsx'
```

Requires `GROQ_API_KEY` (or `GROQ_API_KEY_1..N`) and `EXA_SEARCH_API_KEY`.
