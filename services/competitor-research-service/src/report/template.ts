import type {
  Competitor,
  FeatureDiff,
  Input,
  Positioning,
  PricingResult,
} from "../schema.js";

interface TierRow {
  name: string;
  price?: number;
  currency?: string;
  period?: string;
  notes?: string;
}

/**
 * Shared PDF foundation — a dense, editorial analyst-report layout.
 * The document FLOWS (blocks pack together, breaking only where needed)
 * instead of one section per page, so every page carries real content.
 * Playwright prints this HTML to PDF with printBackground enabled.
 */
export function buildReportHtml(input: {
  input: Input;
  competitors: Competitor[];
  feature_diff: FeatureDiff;
  pricing: PricingResult;
  positioning: Positioning;
  generatedAt?: string;
}): string {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const dateLabel = new Date(generatedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const productName = input.input.product_name;

  const positioning = {
    swot: {
      strengths: input.positioning.swot?.strengths ?? [],
      weaknesses: input.positioning.swot?.weaknesses ?? [],
      opportunities: input.positioning.swot?.opportunities ?? [],
      threats: input.positioning.swot?.threats ?? [],
    },
    positioning_map: input.positioning.positioning_map ?? {
      axes: ["price", "feature breadth"] as [string, string],
      points: [],
    },
    recommended_positioning: input.positioning.recommended_positioning ?? [],
    risks: input.positioning.risks ?? [],
  };
  const map = positioning.positioning_map;
  const coverage = coverageScores(input.feature_diff);
  const range = priceRange(input.pricing);
  const undisclosed = input.pricing.competitor_pricing.filter(
    (c) => !(c.tiers ?? []).some((t) => typeof (t as { price?: unknown }).price === "number"),
  ).length;
  const edges = featureEdges(input.feature_diff, productName);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Competitor Research — ${esc(productName)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:ital,opsz,wght@0,14..32,400;0,14..32,500;0,14..32,600;0,14..32,700;1,14..32,400&display=swap" rel="stylesheet" />
  <style>
    :root {
      --ink: #241a1c;
      --muted: #7c6b6e;
      --wash: #ffffff;
      --card: #ffffff;
      --line: #ecdcdd;
      --line-strong: #ddc7c9;
      --red: #c1202a;
      --red-deep: #8f1119;
      --red-bright: #e8443a;
      --red-soft: #fbeceb;
      --red-tint: #fdf5f4;
      --ok: #1c7a4a; --ok-soft: #e7f4ec;
      --warn: #9a5a17; --warn-soft: #fbf0e0;
      --bad: #b52a20; --bad-soft: #fbe8e6;
      --shadow: 0 1px 2px rgba(36,26,28,0.05), 0 10px 28px rgba(143,17,25,0.06);
    }
    * { box-sizing: border-box; }
    @page {
      size: A4;
      margin: 12mm 11mm 15mm;
      @bottom-left {
        content: "FounderForge · Competitive Intelligence";
        font-family: "Inter", system-ui, sans-serif; font-size: 7.5pt; color: #a9989b;
      }
      @bottom-right {
        content: "${esc(productName)} · " counter(page);
        font-family: "Inter", system-ui, sans-serif; font-size: 7.5pt; color: #a9989b;
      }
    }
    html, body { margin: 0; padding: 0; }
    body {
      color: var(--ink);
      background: var(--wash);
      font-family: "Inter", system-ui, sans-serif;
      font-size: 9.6pt;
      line-height: 1.45;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    h1, h2, h3, h4, .display {
      font-family: "Space Grotesk", "Inter", sans-serif;
      font-weight: 700; letter-spacing: -0.01em; margin: 0;
    }
    p { margin: 0 0 6px; }
    .muted { color: var(--muted); }
    .break { break-before: page; }
    .avoid { break-inside: avoid; }

    /* ---------- Cover ---------- */
    .cover {
      break-after: page;
      position: relative; overflow: hidden;
      min-height: 262mm; border-radius: 16px; color: #fff;
      padding: 30px 30px 26px;
      display: flex; flex-direction: column; justify-content: space-between;
      background:
        radial-gradient(90% 60% at 88% 4%, rgba(255,180,170,0.30), transparent 60%),
        radial-gradient(70% 50% at 0% 100%, rgba(255,120,110,0.22), transparent 55%),
        linear-gradient(155deg, #7d0f16 0%, #b81d26 46%, #e8443a 120%);
      box-shadow: var(--shadow);
    }
    .cover::before {
      content: ""; position: absolute; inset: 0;
      background-image: linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px);
      background-size: 100% 26px; opacity: 0.5;
    }
    .cover > * { position: relative; }
    .cover-top {
      display: flex; justify-content: space-between; align-items: center;
      font-size: 8.5pt; letter-spacing: 0.14em; text-transform: uppercase;
      color: rgba(255,255,255,0.82); font-weight: 600;
    }
    .cover-mark { display: flex; align-items: center; gap: 8px; }
    .cover-mark .dot { width: 9px; height: 9px; border-radius: 2px; background:#fff; box-shadow: 0 0 0 3px rgba(255,255,255,0.22); }
    .cover-mid { margin-top: 30px; }
    .eyebrow { font-size: 10pt; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(255,255,255,0.72); font-weight: 600; }
    .cover h1 {
      font-size: 58pt; line-height: 0.98; margin: 12px 0 0; color: #fff;
      text-shadow: 0 2px 20px rgba(0,0,0,0.18);
    }
    .cover .lede { margin-top: 16px; max-width: 30rem; font-size: 12pt; color: rgba(255,255,255,0.9); line-height: 1.5; }
    .cover .url {
      display: inline-block; margin-top: 16px; font-size: 9pt; font-weight: 600;
      padding: 5px 12px; border-radius: 999px; background: rgba(255,255,255,0.14);
      border: 1px solid rgba(255,255,255,0.28);
    }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 30px; }
    .kpi {
      background: rgba(255,255,255,0.10); border: 1px solid rgba(255,255,255,0.20);
      border-radius: 12px; padding: 13px 14px;
    }
    .kpi .k-label { font-size: 7.5pt; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.72); }
    .kpi .k-value { font-family: "Space Grotesk", sans-serif; font-weight: 700; font-size: 19pt; margin-top: 5px; }
    .kpi .k-sub { font-size: 7.5pt; color: rgba(255,255,255,0.66); margin-top: 2px; }
    .cover-bottom {
      display: flex; justify-content: space-between; align-items: flex-end; gap: 20px;
      border-top: 1px solid rgba(255,255,255,0.22); padding-top: 16px; margin-top: 26px;
    }
    .contents { columns: 2; column-gap: 26px; font-size: 9pt; color: rgba(255,255,255,0.9); max-width: 60%; }
    .contents div { break-inside: avoid; padding: 3px 0; display: flex; gap: 8px; }
    .contents span.n { color: rgba(255,255,255,0.55); font-variant-numeric: tabular-nums; font-weight: 600; }
    .cover-date { text-align: right; font-size: 8.5pt; color: rgba(255,255,255,0.78); }
    .cover-date strong { display:block; font-family:"Space Grotesk"; font-size: 12pt; color:#fff; margin-top:3px; }

    /* ---------- Section framing ---------- */
    .section-head {
      display: flex; align-items: baseline; gap: 12px; margin: 22px 0 12px;
      break-after: avoid;
    }
    .section-head .num {
      font-family: "Space Grotesk"; font-weight: 700; font-size: 12pt; color: var(--red);
      background: var(--red-soft); border: 1px solid #f3d3d1; border-radius: 8px;
      padding: 2px 9px; letter-spacing: 0;
    }
    .section-head h2 { font-size: 17pt; }
    .section-head .tag { margin-left: auto; font-size: 7.5pt; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
    .lead { color: var(--muted); font-size: 9.4pt; margin: -4px 0 12px; max-width: 46rem; }

    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .card {
      background: var(--card); border: 1px solid var(--line); border-radius: 12px;
      padding: 13px 15px; box-shadow: var(--shadow); break-inside: avoid;
    }
    .card h3 { font-size: 10.5pt; margin-bottom: 8px; color: var(--ink); }
    .card h3 .accent { color: var(--red); }
    .kicker { font-size: 7.5pt; letter-spacing: 0.12em; text-transform: uppercase; color: var(--red); font-weight: 700; margin-bottom: 6px; }
    ul.clean { padding-left: 1.05em; margin: 6px 0; }
    ul.clean li { margin: 4px 0; }
    ol.rec { padding-left: 1.1em; margin: 6px 0; }
    ol.rec li { margin: 0 0 9px; break-inside: avoid; }
    .rec-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 6px; }
    .rec-card { display: flex; gap: 12px; background: var(--card); border: 1px solid var(--line); border-left: 3px solid var(--red); border-radius: 12px; padding: 13px 15px; box-shadow: var(--shadow); break-inside: avoid; font-size: 9.2pt; }
    .rec-n { font-family: "Space Grotesk"; font-weight: 700; font-size: 15pt; color: var(--red); line-height: 1; }
    ul.method { list-style: none; margin: 4px 0 0; padding: 0; }
    ul.method li { display: flex; justify-content: space-between; gap: 10px; padding: 5px 0; border-bottom: 1px dashed var(--line); font-size: 8.8pt; }
    ul.method li:last-child { border-bottom: 0; }
    ul.method span { color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-size: 7.6pt; font-weight: 700; }
    ul.method b { text-align: right; font-weight: 600; }

    table { width: 100%; border-collapse: collapse; font-size: 8.6pt; margin: 6px 0; background:#fff; border-radius: 10px; overflow: hidden; box-shadow: var(--shadow); break-inside: avoid; }
    th, td { border-bottom: 1px solid var(--line); padding: 7px 9px; text-align: left; vertical-align: middle; }
    thead th { background: linear-gradient(180deg,#fff,#fdf2f1); color: var(--red-deep); font-family:"Space Grotesk"; font-weight: 600; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 2px solid var(--line-strong); }
    tbody tr:nth-child(even) td { background: #fdf8f8; }
    td.feat { font-weight: 600; }
    .coverage-row td { background: var(--red-tint) !important; font-weight: 700; color: var(--red-deep); border-top: 1px solid var(--line-strong); }

    .badge { display: inline-flex; align-items: center; gap: 4px; border-radius: 6px; padding: 2px 7px; font-size: 7.6pt; font-weight: 700; white-space: nowrap; }
    .badge-yes { background: var(--ok-soft); color: var(--ok); }
    .badge-partial { background: var(--warn-soft); color: var(--warn); }
    .badge-no { background: var(--bad-soft); color: var(--bad); }
    .badge-unknown, .badge-muted { background: #f1ebec; color: var(--muted); }
    .pill { display:inline-flex; align-items:center; gap:5px; font-size:8pt; font-weight:600; color:var(--muted); }
    .pill b { color: var(--ink); }

    /* pricing */
    .price-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; }
    .tier-list { margin: 0; padding: 0; list-style: none; }
    .tier-list li { display: flex; justify-content: space-between; gap: 8px; padding: 5px 0; border-bottom: 1px dashed var(--line); font-size: 9pt; }
    .tier-list li:last-child { border-bottom: 0; }
    .tier-list .amt { font-family:"Space Grotesk"; font-weight:600; white-space:nowrap; }
    .price-bar { margin-top: 8px; height: 7px; border-radius: 999px; background: #f1e6e7; overflow: hidden; }
    .price-bar > span { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--red), var(--red-bright)); }

    /* ---------- Chart ---------- */
    .chart { display: grid; grid-template-columns: 20px 1fr; grid-template-rows: 1fr 20px; gap: 6px; margin-top: 10px; }
    .chart-yaxis { grid-row:1; grid-column:1; writing-mode: vertical-rl; transform: rotate(180deg); text-align:center; font-size:7.6pt; color:var(--muted); text-transform:uppercase; letter-spacing:0.08em; font-weight:600; }
    .chart-xaxis { grid-row:2; grid-column:2; text-align:center; font-size:7.6pt; color:var(--muted); text-transform:uppercase; letter-spacing:0.08em; font-weight:600; }
    .map-wrap {
      grid-row:1; grid-column:2; position: relative; height: 300px;
      border: 1px solid var(--line-strong); border-radius: 14px; overflow: hidden;
      background:
        linear-gradient(#f4e9ea 1px, transparent 1px) 0 0 / 100% 25%,
        linear-gradient(90deg, #f4e9ea 1px, transparent 1px) 0 0 / 25% 100%,
        #fff;
    }
    .midline { position:absolute; background: #f0dede; }
    .midline.h { left:0; right:0; top:50%; height:1px; }
    .midline.v { top:0; bottom:0; left:50%; width:1px; }
    .quad-label { position:absolute; font-size:6.8pt; color:#c3a9ab; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; max-width:40%; }
    .quad-tl { top:6px; left:8px; } .quad-tr { top:6px; right:8px; text-align:right; }
    .quad-bl { bottom:6px; left:8px; } .quad-br { bottom:6px; right:8px; text-align:right; }
    .map-point { position:absolute; transform: translate(-50%, 50%); width:10px; height:10px; border-radius:50%; background: var(--red); border:2px solid #fff; box-shadow: 0 0 0 1px var(--red); z-index:2; }
    .map-point.product { background:#1c1c1c; box-shadow:0 0 0 1px #1c1c1c; width:12px; height:12px; border-radius:3px; z-index:3; }
    .map-label { position:absolute; font-size:7.2pt; white-space:nowrap; color:var(--ink); font-weight:600; background:rgba(255,255,255,0.94); padding:1px 5px; border:1px solid var(--line); border-radius:4px; z-index:2; }
    .map-label.product { color:#000; border-color:#cfcfcf; }
    .legend { display:flex; flex-wrap:wrap; gap:14px; margin-top:9px; font-size:8pt; color:var(--muted); }
    .legend span { display:inline-flex; align-items:center; gap:6px; }
    .legend i { display:inline-block; width:9px; height:9px; border-radius:50%; background:var(--red); }
    .legend i.product { background:#1c1c1c; border-radius:2px; }

    /* SWOT */
    .swot { display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
    .swot .card { padding: 11px 13px; }
    .swot .card h3 { display:flex; align-items:center; gap:7px; }
    .swot-s { border-color:#cfe8db; background: linear-gradient(180deg,#f2fbf6,#fff); } .swot-s h3 { color: var(--ok); }
    .swot-w { border-color:#f0dcb9; background: linear-gradient(180deg,#fdf6ea,#fff); } .swot-w h3 { color: var(--warn); }
    .swot-o { border-color:#f2cfcd; background: linear-gradient(180deg,#fdf1f0,#fff); } .swot-o h3 { color: var(--red); }
    .swot-t { border-color:#efc9c4; background: linear-gradient(180deg,#fceae7,#fff); } .swot-t h3 { color: var(--bad); }

    .note { font-size: 7.8pt; color: var(--muted); margin-top: 6px; }
    .sources { font-size: 7.9pt; columns: 2; column-gap: 22px; }
    .sources li { margin-bottom: 3px; word-break: break-all; break-inside: avoid; }
    .divider { height:1px; background: var(--line); margin: 18px 0; }
  </style>
</head>
<body>
  <!-- ================= COVER ================= -->
  <section class="cover">
    <div class="cover-top">
      <div class="cover-mark"><span class="dot"></span> FounderForge</div>
      <div>Competitive Intelligence Report</div>
    </div>
    <div class="cover-mid">
      <div class="eyebrow">Competitor Research</div>
      <h1>${esc(productName)}</h1>
      <p class="lede">A data-backed read of the competitive landscape — feature coverage, pricing posture, and where to position against the field.</p>
      ${input.input.product_url ? `<span class="url">${esc(input.input.product_url)}</span>` : ""}
      <div class="kpis">
        <div class="kpi"><div class="k-label">Competitors</div><div class="k-value">${input.competitors.length}</div><div class="k-sub">direct peers analyzed</div></div>
        <div class="kpi"><div class="k-label">Dimensions</div><div class="k-value">${input.feature_diff.features.length}</div><div class="k-sub">category-fit criteria</div></div>
        <div class="kpi"><div class="k-label">Price range</div><div class="k-value">${range.label}</div><div class="k-sub">public monthly list</div></div>
        <div class="kpi"><div class="k-label">Undisclosed</div><div class="k-value">${undisclosed}</div><div class="k-sub">peers hide pricing</div></div>
      </div>
    </div>
    <div class="cover-bottom">
      <div class="contents">
        <div><span class="n">01</span> Executive summary</div>
        <div><span class="n">02</span> Competitive landscape</div>
        <div><span class="n">03</span> Feature comparison</div>
        <div><span class="n">04</span> Pricing comparison</div>
        <div><span class="n">05</span> Positioning map</div>
        <div><span class="n">06</span> SWOT analysis</div>
        <div><span class="n">07</span> Recommended positioning</div>
        <div><span class="n">08</span> Risks &amp; sources</div>
      </div>
      <div class="cover-date">Generated<strong>${esc(dateLabel)}</strong></div>
    </div>
  </section>

  <!-- ================= 1. EXEC SUMMARY ================= -->
  <div class="section-head"><span class="num">01</span><h2>Executive summary</h2><span class="tag">Synthesis</span></div>
  <p class="lead">Findings synthesized strictly from each vendor's own marketing, product, and pricing pages — every claim traces to a source in section 08.</p>
  <div class="grid-2">
    <div class="card">
      <div class="kicker">Where ${esc(productName)} leads</div>
      <ul class="clean">
        ${
          edges.edges.length
            ? edges.edges.map((e) => `<li>${esc(e)}</li>`).join("")
            : positioning.swot.strengths.slice(0, 3).map((s) => `<li>${esc(s)}</li>`).join("") ||
              "<li class='muted'>No clear feature lead detected from public pages.</li>"
        }
      </ul>
    </div>
    <div class="card">
      <div class="kicker">Where rivals are ahead</div>
      <ul class="clean">
        ${
          edges.gaps.length
            ? edges.gaps.map((e) => `<li>${esc(e)}</li>`).join("")
            : positioning.swot.weaknesses.slice(0, 3).map((s) => `<li>${esc(s)}</li>`).join("") ||
              "<li class='muted'>No obvious gaps versus peers.</li>"
        }
      </ul>
    </div>
  </div>
  <div class="card avoid" style="margin-top:12px">
    <div class="kicker">Recommended angles</div>
    <ol class="rec">
      ${positioning.recommended_positioning
        .slice(0, 4)
        .map(
          (r) =>
            `<li><strong>${esc(r.angle)}</strong><br/><span class="muted">${esc(r.supporting_facts.join("; "))}</span></li>`,
        )
        .join("") || "<li class='muted'>Positioning synthesis unavailable.</li>"}
    </ol>
  </div>

  <!-- ================= 2. LANDSCAPE ================= -->
  <div class="section-head"><span class="num">02</span><h2>Competitive landscape</h2><span class="tag">Discovery</span></div>
  <table>
    <thead><tr><th>Competitor</th><th>Website</th><th>Confidence</th><th>Sourced via</th></tr></thead>
    <tbody>
      ${input.competitors
        .map(
          (c) => `<tr>
            <td class="feat">${esc(c.name)}</td>
            <td class="muted">${esc(c.url)}</td>
            <td>${confidenceBadge(c.confidence)}</td>
            <td class="muted">${esc(c.sources.join(", "))}</td>
          </tr>`,
        )
        .join("")}
    </tbody>
  </table>
  <p class="note">Confidence reflects search overlap and model scoring across public pages; direct category peers rank higher than adjacent tools.</p>

  <!-- ================= 3. FEATURES ================= -->
  <div class="section-head break"><span class="num">03</span><h2>Feature comparison</h2><span class="tag">Evidence</span></div>
  <p class="lead">Dimensions are chosen for ${esc(productName)}'s category, then scored only from each vendor's public pages. "—" means the page didn't mention it — not proven absence.</p>
  ${renderFeatureTable(input.feature_diff, coverage, productName)}
  <div class="grid-2" style="margin-top:12px">
    <div class="card">
      <div class="kicker">Coverage leaders</div>
      <ul class="clean">
        ${coverageLeaders(coverage)
          .map((c) => `<li><strong>${esc(c.name)}</strong> — ${Math.round(c.score * 100)}% of tracked dimensions evidenced</li>`)
          .join("")}
      </ul>
    </div>
    <div class="card">
      <div class="kicker">Reading this matrix</div>
      <p class="muted" style="margin:0">Each cell is graded <span class="badge badge-yes">✓ Yes</span> <span class="badge badge-partial">◐ Partial</span> <span class="badge badge-no">✕ No</span> <span class="badge badge-unknown">— n/a</span>. Coverage is the share of dimensions with a definitive (non-blank) reading, so it measures evidence density, not quality.</p>
    </div>
  </div>

  <!-- ================= 4. PRICING ================= -->
  <div class="section-head break"><span class="num">04</span><h2>Pricing comparison</h2><span class="tag">Public list</span></div>
  <p class="lead">Entry prices taken from public pricing pages. ${undisclosed} of ${input.competitors.length} peers keep pricing behind a sales conversation.</p>
  <div class="card avoid" style="margin-bottom:12px">
    <div class="price-head"><h3 style="margin:0"><span class="accent">${esc(productName)}</span> — your pricing</h3>${pricingModelBadge(null)}</div>
    ${renderTiers(input.pricing.product_pricing.tiers)}
    ${renderPriceBar(input.pricing.product_pricing.tiers, range.max)}
  </div>
  <div class="grid-2">
    ${input.pricing.competitor_pricing
      .map((c) => {
        const tiers = (c.tiers ?? []) as unknown as TierRow[];
        const model = c.pricing_model && c.pricing_model !== "unknown" ? c.pricing_model : null;
        const hasPrice = tiers.some((t) => t.price != null);
        return `<div class="card">
          <div class="price-head"><h3 style="margin:0">${esc(c.competitor)}</h3>${pricingModelBadge(model)}</div>
          ${c.enterprise_custom ? `<div style="margin-bottom:6px"><span class="badge badge-partial">enterprise custom</span></div>` : ""}
          ${
            hasPrice || tiers.length
              ? renderTiers(tiers)
              : `<p class="muted" style="margin:0"><span class="badge badge-muted">Not publicly disclosed</span></p>`
          }
          ${renderPriceBar(tiers, range.max)}
        </div>`;
      })
      .join("")}
  </div>

  <!-- ================= 5. POSITIONING MAP ================= -->
  <div class="section-head break"><span class="num">05</span><h2>Positioning map</h2><span class="tag">Synthesis</span></div>
  <p class="lead">Each dot is placed by <strong>${esc(map.axes[0])}</strong> (horizontal) and <strong>${esc(map.axes[1])}</strong> (vertical), derived from sections 03–04.</p>
  ${
    map.points.length
      ? `<div class="chart">
    <div class="chart-yaxis">${esc(map.axes[1])} →</div>
    <div class="map-wrap">
      <div class="midline h"></div><div class="midline v"></div>
      <div class="quad-label quad-tl">Feature-rich</div>
      <div class="quad-label quad-tr">Premium &amp; broad</div>
      <div class="quad-label quad-bl">Lean &amp; low-cost</div>
      <div class="quad-label quad-br">Premium &amp; focused</div>
      ${renderMapPoints(map.points, productName)}
    </div>
    <div class="chart-xaxis">${esc(map.axes[0])} →</div>
  </div>
  <div class="legend">
    <span><i class="product"></i> ${esc(productName)} (you)</span>
    <span><i></i> Competitors</span>
    <span class="muted">Right edge = custom / undisclosed pricing</span>
  </div>`
      : `<div class="card"><p class="muted" style="margin:0">Insufficient pricing/feature evidence to place competitors on the map.</p></div>`
  }

  <!-- ================= 6. SWOT ================= -->
  <div class="section-head"><span class="num">06</span><h2>SWOT analysis</h2><span class="tag">Strategy</span></div>
  <div class="swot">
    ${swotCard("Strengths", "swot-s", "▲", positioning.swot.strengths)}
    ${swotCard("Weaknesses", "swot-w", "▼", positioning.swot.weaknesses)}
    ${swotCard("Opportunities", "swot-o", "◆", positioning.swot.opportunities)}
    ${swotCard("Threats", "swot-t", "⚑", positioning.swot.threats)}
  </div>

  <!-- ================= 7. RECOMMENDATIONS ================= -->
  <div class="section-head"><span class="num">07</span><h2>Recommended positioning</h2><span class="tag">Action</span></div>
  <p class="lead">Prioritized go-to-market angles, each grounded in a concrete price or feature point from the sections above.</p>
  <div class="rec-grid">
    ${positioning.recommended_positioning
      .map(
        (r, i) =>
          `<div class="rec-card"><div class="rec-n">${String(i + 1).padStart(2, "0")}</div><div><strong>${esc(r.angle)}</strong><div class="muted" style="margin-top:4px">${esc(r.supporting_facts.join("; "))}</div></div></div>`,
      )
      .join("") || "<div class='rec-card muted'>No recommendations generated.</div>"}
  </div>

  <!-- ================= 8. RISKS + SOURCES ================= -->
  <div class="section-head"><span class="num">08</span><h2>Risks &amp; sources</h2><span class="tag">Appendix</span></div>
  <div class="grid-2">
    <div class="card avoid">
      <div class="kicker">Risks &amp; caveats</div>
      <ul class="clean">
        ${positioning.risks.map((r) => `<li>${esc(r)}</li>`).join("") || "<li class='muted'>None flagged.</li>"}
      </ul>
    </div>
    <div class="card avoid">
      <div class="kicker">How this report was built</div>
      <ul class="method">
        <li><span>Discovery</span><b>Web search → LLM ranking of direct peers</b></li>
        <li><span>Evidence</span><b>Each vendor's own site via Jina Reader (cleaned)</b></li>
        <li><span>Dimensions</span><b>${input.feature_diff.features.length} category-fit criteria, model-scored</b></li>
        <li><span>Pricing</span><b>Public list pages only; no scraping of gated data</b></li>
        <li><span>Competitors</span><b>${input.competitors.length} analyzed</b></li>
        <li><span>Generated</span><b>${esc(dateLabel)}</b></li>
      </ul>
    </div>
  </div>
  <div class="card avoid" style="margin-top:12px">
    <div class="kicker">Evidence sources</div>
    <ul class="sources clean">
      ${collectSources(input)
        .map((s) => `<li>${esc(s)}</li>`)
        .join("")}
    </ul>
  </div>
  <p class="note">Generated by FounderForge Feature 5 · ${esc(generatedAt)} · Public-web evidence only · Not financial advice.</p>
</body>
</html>`;
}

function swotCard(title: string, cls: string, icon: string, items: string[]): string {
  return `<div class="card ${cls}"><h3><span>${icon}</span> ${esc(title)}</h3><ul class="clean">${
    items.map((x) => `<li>${esc(x)}</li>`).join("") || "<li class='muted'>—</li>"
  }</ul></div>`;
}

function confidenceBadge(conf: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, conf)) * 100);
  const cls = pct >= 80 ? "badge-yes" : pct >= 60 ? "badge-partial" : "badge-unknown";
  return `<span class="badge ${cls}">${pct}%</span>`;
}

function pricingModelBadge(model: string | null): string {
  if (!model) return `<span class="badge badge-muted">public list</span>`;
  return `<span class="badge badge-partial">${esc(model)}</span>`;
}

function renderMapPoints(
  points: Array<{ name: string; x: number; y: number }>,
  productName: string,
): string {
  const ordered = [...points]
    .map((p, i) => ({ ...p, i }))
    .sort((a, b) => b.y - a.y || a.x - b.x);

  return ordered
    .map((p, order) => {
      const left = Math.max(7, Math.min(92, p.x * 100));
      // Cap vertical so top points don't collide with the quadrant labels.
      const bottom = Math.max(8, Math.min(84, p.y * 100));
      const isProduct = p.name === productName;
      // Horizontal label anchor: pull inward near edges.
      const tx = left < 17 ? "-8%" : left > 83 ? "-92%" : "-50%";
      const placeBelow = bottom > 66 || (order % 2 === 1 && bottom > 22 && bottom < 66);
      const ty = placeBelow ? "150%" : "-200%";
      return `<div class="map-point${isProduct ? " product" : ""}" style="left:${left}%;bottom:${bottom}%"></div>
        <div class="map-label${isProduct ? " product" : ""}" style="left:${left}%;bottom:${bottom}%;transform:translate(${tx}, ${ty})">${esc(p.name)}</div>`;
    })
    .join("");
}

function statusBadge(status: string): string {
  const map: Record<string, { cls: string; icon: string; label: string }> = {
    yes: { cls: "badge-yes", icon: "✓", label: "Yes" },
    partial: { cls: "badge-partial", icon: "◐", label: "Partial" },
    no: { cls: "badge-no", icon: "✕", label: "No" },
    unknown: { cls: "badge-unknown", icon: "—", label: "" },
  };
  const s = map[status] ?? map.unknown!;
  return `<span class="badge ${s.cls}">${s.icon}${s.label ? ` ${esc(s.label)}` : ""}</span>`;
}

function coverageScores(diff: FeatureDiff): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [entity, cells] of Object.entries(diff.matrix)) {
    let known = 0;
    for (const f of diff.features) {
      if ((cells?.[f]?.status ?? "unknown") !== "unknown") known += 1;
    }
    out[entity] = diff.features.length ? known / diff.features.length : 0;
  }
  return out;
}

function coverageLeaders(coverage: Record<string, number>): Array<{ name: string; score: number }> {
  return Object.entries(coverage)
    .map(([name, score]) => ({ name, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

/** Derive concrete "we lead / rivals lead" bullets from the matrix. */
function featureEdges(
  diff: FeatureDiff,
  productName: string,
): { edges: string[]; gaps: string[] } {
  const edges: string[] = [];
  const gaps: string[] = [];
  const competitors = Object.keys(diff.matrix).filter((k) => k !== productName);
  const st = (entity: string, f: string) => diff.matrix[entity]?.[f]?.status ?? "unknown";

  for (const f of diff.features) {
    const prod = st(productName, f);
    const compYes = competitors.filter((c) => st(c, f) === "yes").length;
    const compNo = competitors.filter((c) => st(c, f) === "no" || st(c, f) === "unknown").length;
    if (prod === "yes" && compYes <= Math.floor(competitors.length / 2) && competitors.length) {
      edges.push(`${f}: offered by ${productName}${compNo ? `, unlike ${compNo} of ${competitors.length} peers` : ""}`);
    }
    if ((prod === "no" || prod === "unknown") && compYes >= Math.ceil(competitors.length / 2) && competitors.length) {
      gaps.push(`${f}: available from ${compYes} of ${competitors.length} peers`);
    }
  }
  return { edges: edges.slice(0, 4), gaps: gaps.slice(0, 4) };
}

function renderFeatureTable(
  diff: FeatureDiff,
  coverage: Record<string, number>,
  productName: string,
): string {
  const cols = Object.keys(diff.matrix);
  const header = `<tr><th>Dimension</th>${cols
    .map((c) => `<th${c === productName ? ' style="color:#000"' : ""}>${esc(c)}</th>`)
    .join("")}</tr>`;
  const rows = diff.features
    .map((f) => {
      const cells = cols
        .map((c) => `<td>${statusBadge(diff.matrix[c]?.[f]?.status ?? "unknown")}</td>`)
        .join("");
      return `<tr><td class="feat">${esc(f)}</td>${cells}</tr>`;
    })
    .join("\n");
  const coverageRow = `<tr class="coverage-row"><td>Coverage</td>${cols
    .map((c) => `<td>${Math.round((coverage[c] ?? 0) * 100)}%</td>`)
    .join("")}</tr>`;
  return `<table><thead>${header}</thead><tbody>${rows}${coverageRow}</tbody></table>`;
}

function renderTiers(tiers: TierRow[]): string {
  if (!tiers.length) {
    return `<p class="muted" style="margin:0"><span class="badge badge-muted">Not publicly disclosed</span></p>`;
  }
  return `<ul class="tier-list">${tiers
    .map((t) => {
      const price =
        t.price != null
          ? `${t.currency ?? "USD"} ${t.price}${t.period ? ` / ${t.period}` : ""}`
          : t.notes?.toLowerCase().includes("no public")
            ? "Not disclosed"
            : "Contact / custom";
      return `<li><span><strong>${esc(t.name || "Plan")}</strong>${t.notes ? ` <span class="muted">(${esc(t.notes)})</span>` : ""}</span><span class="amt">${esc(price)}</span></li>`;
    })
    .join("")}</ul>`;
}

function priceRange(pricing: PricingResult): { min: number; max: number; label: string } {
  const prices: number[] = [];
  for (const t of pricing.product_pricing.tiers) {
    if (typeof t.price === "number" && t.price > 0) prices.push(t.price);
  }
  for (const c of pricing.competitor_pricing) {
    for (const t of c.tiers ?? []) {
      const price = (t as { price?: unknown }).price;
      if (typeof price === "number" && price > 0) prices.push(price);
    }
  }
  if (!prices.length) return { min: 0, max: 1, label: "n/a" };
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return { min, max, label: min === max ? `$${min}` : `$${min}–${max}` };
}

function renderPriceBar(tiers: TierRow[], maxPrice: number): string {
  const priced = tiers.filter((t) => typeof t.price === "number" && (t.price ?? 0) > 0) as Array<{
    price: number;
  }>;
  if (!priced.length) return "";
  const min = Math.min(...priced.map((t) => t.price));
  const pct = Math.max(6, Math.min(100, (min / Math.max(1, maxPrice)) * 100));
  return `<div class="price-bar" title="Relative entry price"><span style="width:${pct}%"></span></div>`;
}

function collectSources(input: {
  input: Input;
  competitors: Competitor[];
  feature_diff: FeatureDiff;
}): string[] {
  const set = new Set<string>();
  if (input.input.product_url) set.add(input.input.product_url);
  for (const c of input.competitors) set.add(c.url);
  for (const entity of Object.values(input.feature_diff.matrix)) {
    for (const cell of Object.values(entity ?? {})) {
      if (cell.evidence_url) set.add(`${cell.evidence_url} @ ${cell.scraped_at ?? "?"}`);
    }
  }
  return [...set];
}

function esc(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
