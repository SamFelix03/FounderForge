# Brand kit — name + brief → zipped logo / assets / fonts kit

## Endpoint

`POST /v1/services/brand-kit/jobs`

```json
{
  "input": {
    "brand_name": "Solace",
    "description": "calm meditation app, minimalist, organic, wellness",
    "pick": 0
  }
}
```

## Pipeline

1. Gemini brand analyst (concepts + Google Fonts typography allowlist)
2. Vertex logo concept images
3. Palette extraction from chosen mark
4. Google Fonts download + CSS/HTML
5. Color palette + typography specimen PNGs
6. Icons + social banners
7. Zip → Supabase (`BRANDKIT_SUPABASE_*` or `DEMO_SUPABASE_*`)

## Result

Poll `GET /v1/jobs/:id`. On success, `artifacts[]` includes a `brand_kit_zip` with `url`.

## Local live-run

```bash
pnpm --filter @founderforge/brand-kit-service live -- \
  --brand-name 'Solace' \
  --description 'calm meditation app, minimalist wellness'
```

Requires `GOOGLE_SERVICE_ACCOUNT_JSON` and `BRANDKIT_SUPABASE_*` (or DEMO_*).
