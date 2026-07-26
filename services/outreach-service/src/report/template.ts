/**
 * Outreach intelligence report — full findings PDF.
 * Keeps the original 7-section depth (esp. full Investor shortlist synthesis)
 * with cleaner tables and no empty-page / query / sheet-dump noise.
 */
// @ts-nocheck — large HTML template port; runtime-safe, strict typing deferred

export function buildReportHtml(data) {
  const generatedAt = data.generatedAt || new Date().toISOString();
  const dateLabel = new Date(generatedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const website = data.website || {};
  const revenue = data.revenue || {};
  const investors = data.investors || {};
  const portfolio = data.portfolioBenchmarks || {};
  const contacts = data.partnerContacts || {};

  const productLabel =
    extractProductName(website.productSummary) || hostFromUrl(website.url) || 'Company';
  const productBits = parseLabeledSummary(website.productSummary);
  const performanceBits = parsePerformance(revenue.performanceSummary);
  const investorRows = normalizeInvestors(investors);
  const benchmarkRows = normalizeBenchmarks(portfolio);
  const allContacts = normalizeContacts(contacts.contacts, { requireReach: false });
  // Table only lists people with at least one public reach channel.
  const contactRows = normalizeContacts(contacts.contacts, { requireReach: true });
  const withReach = contactRows.length;
  const firmList = unique(
    (contacts.firms || [])
      .concat(allContacts.map((c) => c.firm))
      .filter(Boolean)
  );
  const evidence = collectEvidence(data);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Investor Outreach Report — ${esc(productLabel)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --ink: #122028;
      --muted: #5a6d76;
      --line: #d5e2e7;
      --line-strong: #b7c9d1;
      --teal: #0c7268;
      --teal-deep: #065048;
      --teal-soft: #e7f4f1;
      --teal-tint: #f3faf8;
      --wash: #fff;
      --shadow: 0 1px 2px rgba(18,32,40,0.04);
    }
    * { box-sizing: border-box; }
    @page {
      size: A4;
      margin: 12mm 11mm 15mm;
      @bottom-left {
        content: "Outreach Forge · Investor Intelligence";
        font-family: "Source Sans 3", system-ui, sans-serif; font-size: 7.5pt; color: #8aa0aa;
      }
      @bottom-right {
        content: "${esc(productLabel)} · " counter(page);
        font-family: "Source Sans 3", system-ui, sans-serif; font-size: 7.5pt; color: #8aa0aa;
      }
    }
    html, body { margin: 0; padding: 0; }
    body {
      color: var(--ink);
      background: var(--wash);
      font-family: "Source Sans 3", system-ui, sans-serif;
      font-size: 9.4pt;
      line-height: 1.45;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    h1, h2, h3 {
      font-family: "Fraunces", Georgia, serif;
      font-weight: 700;
      letter-spacing: -0.015em;
      margin: 0;
    }
    p { margin: 0 0 7px; }
    .muted { color: var(--muted); }
    .avoid { break-inside: avoid; page-break-inside: avoid; }
    /* Prefer flowing content over avoid — avoid on large blocks creates half-empty pages. */

    .prose p { margin: 0 0 5px; }
    .prose p:last-child { margin-bottom: 0; }
    .prose ul, .prose ol { margin: 2px 0 6px; padding-left: 1.1em; }
    .prose li { margin: 2px 0; }
    .prose strong { font-weight: 700; }
    .prose h3 {
      font-size: 10pt; margin: 8px 0 4px; color: var(--teal-deep);
      break-after: avoid;
    }

    .cover {
      border-radius: 14px;
      color: #fff;
      padding: 20px 22px 16px;
      margin-bottom: 8px;
      background:
        radial-gradient(80% 70% at 100% 0%, rgba(180,240,230,0.25), transparent 55%),
        linear-gradient(145deg, #043833 0%, #0c7268 55%, #149687 120%);
      box-shadow: var(--shadow);
    }
    .cover-top {
      display: flex; justify-content: space-between; align-items: center;
      font-size: 8pt; letter-spacing: 0.12em; text-transform: uppercase;
      color: rgba(255,255,255,0.8); font-weight: 600;
    }
    .eyebrow {
      font-size: 8.5pt; letter-spacing: 0.18em; text-transform: uppercase;
      color: rgba(255,255,255,0.7); font-weight: 600; margin-top: 12px;
    }
    .cover h1 { font-size: 28pt; line-height: 1.05; margin: 6px 0 0; color: #fff; }
    .cover .lede { margin-top: 8px; max-width: 36rem; font-size: 10pt; color: rgba(255,255,255,0.92); line-height: 1.4; }
    .cover .url {
      display: inline-block; margin-top: 8px; font-size: 8.5pt; font-weight: 600;
      padding: 3px 10px; border-radius: 999px; background: rgba(255,255,255,0.12);
      border: 1px solid rgba(255,255,255,0.25);
    }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 12px; }
    .kpi {
      background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.18);
      border-radius: 10px; padding: 8px 10px;
    }
    .kpi .k-label { font-size: 7pt; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.7); }
    .kpi .k-value { font-family: "Fraunces", serif; font-size: 15pt; margin-top: 2px; }
    .kpi .k-sub { font-size: 7pt; color: rgba(255,255,255,0.65); margin-top: 1px; }
    .cover-bottom {
      display: flex; justify-content: space-between; align-items: flex-end; gap: 16px;
      border-top: 1px solid rgba(255,255,255,0.2); padding-top: 10px; margin-top: 12px;
    }
    .contents {
      display: flex; flex-wrap: wrap; gap: 4px 16px;
      font-size: 8pt; color: rgba(255,255,255,0.9); max-width: 70%;
    }
    .contents div { display: flex; gap: 6px; white-space: nowrap; }
    .contents span.n { color: rgba(255,255,255,0.55); font-weight: 600; }
    .cover-date { text-align: right; font-size: 8pt; color: rgba(255,255,255,0.78); }
    .cover-date strong { display:block; font-family:"Fraunces"; font-size: 11pt; color:#fff; margin-top:2px; }

    .section-head {
      display: flex; align-items: baseline; gap: 8px;
      margin: 10px 0 4px;
      break-after: avoid; page-break-after: avoid;
    }
    .section-head .num {
      font-family: "Fraunces", serif; font-size: 11pt; color: var(--teal);
      background: var(--teal-soft); border: 1px solid #c4e4de; border-radius: 7px;
      padding: 2px 8px;
    }
    .section-head h2 { font-size: 15pt; }
    .section-head .tag {
      margin-left: auto; font-size: 7.5pt; letter-spacing: 0.1em;
      text-transform: uppercase; color: var(--muted); font-weight: 600;
    }
    .lead { color: var(--muted); font-size: 8.4pt; margin: 0 0 5px; max-width: 46rem; }

    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .card {
      border: 1px solid var(--line); border-radius: 8px; padding: 9px 11px;
      background: #fff; box-shadow: var(--shadow);
    }
    .kicker {
      font-size: 7.2pt; letter-spacing: 0.1em; text-transform: uppercase;
      color: var(--teal); font-weight: 700; margin-bottom: 6px;
    }
    .fact {
      display: grid; grid-template-columns: 88px 1fr; gap: 2px 8px;
      padding: 2px 0; align-items: start;
    }
    .fact .k { color: var(--muted); font-size: 7.2pt; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 700; }
    .fact .v { font-weight: 600; font-size: 9pt; }
    ul.clean { margin: 6px 0 0; padding-left: 1.1em; }
    ul.clean li { margin: 2px 0; }

    table.data {
      width: 100%; border-collapse: collapse; font-size: 8.3pt;
      margin: 8px 0 6px; border: 1px solid var(--line); border-radius: 8px; overflow: hidden;
    }
    table.data th, table.data td {
      border-bottom: 1px solid var(--line); padding: 7px 8px;
      text-align: left; vertical-align: top;
    }
    table.data th {
      background: var(--teal-tint); color: var(--teal-deep);
      font-size: 7.3pt; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 700;
      border-bottom: 1px solid var(--line-strong);
    }
    table.data tr:last-child td { border-bottom: 0; }
    table.data tr:nth-child(even) td { background: #f8fbfa; }
    table.data td.num { white-space: nowrap; font-weight: 700; color: var(--teal-deep); }
    table.data a { color: var(--teal-deep); text-decoration: none; font-weight: 600; }
    .tiny { font-size: 7.4pt; color: #4d616a; font-weight: 500; }
    .pill-row { display: flex; flex-wrap: wrap; gap: 5px; margin: 0 0 8px; }
    .pill {
      font-size: 7.5pt; font-weight: 600; color: var(--teal-deep);
      background: var(--teal-soft); border: 1px solid #c4e4de;
      border-radius: 999px; padding: 2px 8px;
    }
    .note { font-size: 7.6pt; color: var(--muted); margin-top: 4px; }
    .analysis {
      border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px;
      background: #fff; margin: 0 0 6px; box-shadow: var(--shadow);
    }
    table.data tr { break-inside: avoid; page-break-inside: avoid; }
    .sources { font-size: 7.9pt; columns: 2; column-gap: 18px; margin: 0; padding-left: 1.1em; }
    .sources li { margin-bottom: 4px; break-inside: avoid; word-break: break-word; }
    ul.method { list-style: none; margin: 0; padding: 0; }
    ul.method li {
      display: flex; justify-content: space-between; gap: 10px;
      padding: 5px 0; border-bottom: 1px dashed var(--line); font-size: 8.6pt;
    }
    ul.method li:last-child { border-bottom: 0; }
    ul.method span { color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; font-size: 7.4pt; font-weight: 700; }
    ul.method b { text-align: right; font-weight: 600; }
  </style>
</head>
<body>
  <section class="cover">
      <div class="cover-top">
        <div>Outreach Forge</div>
        <div>Investor Outreach Intelligence</div>
      </div>
      <div class="eyebrow">Full Findings Report</div>
      <h1>${esc(productLabel)}</h1>
      <p class="lede">${esc(coverLede(productBits))}</p>
      ${website.url ? `<span class="url">${esc(website.url)}</span>` : ''}
      <div class="kpis">
        <div class="kpi"><div class="k-label">Investors</div><div class="k-value">${investorRows.length || investors.exaResultCount || 0}</div><div class="k-sub">shortlisted</div></div>
        <div class="kpi"><div class="k-label">Benchmarks</div><div class="k-value">${benchmarkRows.length || portfolio.exaResultCount || 0}</div><div class="k-sub">portfolio comps</div></div>
        <div class="kpi"><div class="k-label">Contacts</div><div class="k-value">${allContacts.length}</div><div class="k-sub">partners / GPs found</div></div>
        <div class="kpi"><div class="k-label">With reach</div><div class="k-value">${withReach}</div><div class="k-sub">shown in §06</div></div>
      </div>
    <div class="cover-bottom">
      <div class="contents">
        <div><span class="n">01</span> Executive overview</div>
        <div><span class="n">02</span> Product analysis</div>
        <div><span class="n">03</span> Company performance</div>
        <div><span class="n">04</span> Investor shortlist</div>
        <div><span class="n">05</span> Portfolio benchmarks</div>
        <div><span class="n">06</span> Partner contacts</div>
        <div><span class="n">07</span> Sources &amp; method</div>
      </div>
      <div class="cover-date">Generated<strong>${esc(dateLabel)}</strong></div>
    </div>
  </section>

  <!-- 01 -->
  <div class="section-head"><span class="num">01</span><h2>Executive overview</h2><span class="tag">Synthesis</span></div>
  <p class="lead">Compact readout of product, traction, and the outreach posture before the full findings.</p>
  <div class="grid-2">
    <div class="card">
      <div class="kicker">Product snapshot</div>
      ${renderProductCard(productBits, website.url)}
    </div>
    <div class="card">
      <div class="kicker">Performance snapshot</div>
      ${renderPerformanceCard(performanceBits)}
    </div>
  </div>
  <div class="card" style="margin-top:8px">
    <div class="kicker">Outreach posture</div>
    <div class="pill-row">
      <span class="pill">Firms: ${firmList.length || '—'}</span>
      <span class="pill">Reachable contacts: ${contactRows.length}</span>
      <span class="pill">Investors listed: ${investorRows.length}</span>
      <span class="pill">Benchmarks: ${benchmarkRows.length}</span>
    </div>
    <p class="muted" style="margin:0">Section 04 carries the full investor thesis shortlist. Sections 05–06 add revenue comps and partner reach.</p>
  </div>

  <!-- 02 -->
  <div class="section-head"><span class="num">02</span><h2>Product analysis</h2><span class="tag">Website</span></div>
  <p class="lead">Full product readout from the website analysis${website.toolsUsed?.length ? ` (tools: ${esc(website.toolsUsed.join(', '))})` : ''}.</p>
  <div class="analysis prose">${md(website.productSummary || 'No product summary.')}</div>

  <!-- 03 -->
  <div class="section-head"><span class="num">03</span><h2>Company performance</h2><span class="tag">Spreadsheet</span></div>
  <p class="lead">Financial synthesis across the uploaded workbook${revenue.sheet?.sheetCount ? ` (${revenue.sheet.sheetCount} sheets)` : ''}.</p>
  <div class="analysis prose">${md(revenue.performanceSummary || 'No performance summary.')}</div>

  <!-- 04 — FULL investor shortlist (the section that mattered) -->
  <div class="section-head"><span class="num">04</span><h2>Investor shortlist</h2><span class="tag">Exa + Groq</span></div>
  <p class="lead">Full AI shortlist of investors and firms matched to product category and stage — thesis fit, focus, portfolio examples, and confidence gaps.</p>
  <div class="analysis prose">${md(investors.investorSummary || 'No investor shortlist.')}</div>
  ${investorRows.length ? `
    <div class="kicker" style="margin-top:6px">Structured shortlist</div>
    ${renderInvestorTable(investorRows)}
  ` : ''}

  <!-- 05 -->
  <div class="section-head"><span class="num">05</span><h2>Portfolio revenue benchmarks</h2><span class="tag">Pre-investment</span></div>
  <p class="lead">ARR / MRR / revenue reported for portfolio companies before or around investor entry.</p>
  <div class="analysis prose">${md(portfolio.portfolioRevenueSummary || 'No portfolio benchmark synthesis.')}</div>
  ${benchmarkRows.length ? `
    <div class="kicker" style="margin-top:6px">Structured benchmarks</div>
    ${renderBenchmarkTable(benchmarkRows)}
  ` : ''}

  <!-- 06 -->
  <div class="section-head"><span class="num">06</span><h2>Partner contacts</h2><span class="tag">Outreach list</span></div>
  <p class="lead">Partners / GPs at target firms who have at least one public LinkedIn, email, X, or other social URL.</p>
  ${firmList.length ? `<div class="pill-row">${firmList.map((f) => `<span class="pill">${esc(f)}</span>`).join('')}</div>` : ''}
  ${contacts.contactSummary ? `<div class="analysis prose">${md(contacts.contactSummary)}</div>` : ''}
  ${renderContactTable(contactRows)}
  <p class="note">People without any public contact channel are omitted from this table — nothing is invented.</p>

  <!-- 07 -->
  <div class="section-head"><span class="num">07</span><h2>Sources &amp; method</h2><span class="tag">Evidence</span></div>
  <div class="grid-2">
    <div class="card">
      <div class="kicker">Pipeline method</div>
      <ul class="method">
        <li><span>Website</span><b>${esc(website.model || 'Groq Compound')}</b></li>
        <li><span>Revenue</span><b>${esc(revenue.model || 'Groq sheet model')}</b></li>
        <li><span>Investors</span><b>Exa deep search + Groq synthesis</b></li>
        <li><span>Portfolio</span><b>Exa deep search + Groq synthesis</b></li>
        <li><span>Contacts</span><b>Firm search → per-person enrichment</b></li>
      </ul>
    </div>
    <div class="card">
      <div class="kicker">Coverage</div>
      <ul class="method">
        <li><span>Product URL</span><b>${esc(hostFromUrl(website.url) || website.url || '—')}</b></li>
        <li><span>Workbook sheets</span><b>${revenue.sheet?.sheetCount || 0}</b></li>
        <li><span>Investor Exa hits</span><b>${investors.exaResultCount || 0}</b></li>
        <li><span>Portfolio Exa hits</span><b>${portfolio.exaResultCount || 0}</b></li>
        <li><span>Contacts listed</span><b>${contactRows.length}</b></li>
      </ul>
    </div>
  </div>
  <div class="card" style="margin-top:10px">
    <div class="kicker">Evidence titles &amp; URLs</div>
    <ol class="sources">
      ${evidence.map((s) => `<li><strong>${esc(s.title || hostFromUrl(s.url) || 'Source')}</strong><br/><span class="tiny">${esc(s.url)}</span></li>`).join('') || '<li class="muted">No source URLs captured.</li>'}
    </ol>
  </div>
</body>
</html>`;
}

/* -------------------- renderers -------------------- */

function renderProductCard(bits: any, url: any) {
  const rows = [];
  if (bits.name) rows.push(['Name', bits.name]);
  if (bits.forWhom) rows.push(['Audience', bits.forWhom]);
  if (bits.what) rows.push(['What it does', bits.what]);
  if (!rows.length && bits.blurb) return `<p>${esc(bits.blurb)}</p>`;
  return `
    <div>
      ${rows.map(([k, v]) => `<div class="fact"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('')}
      ${url ? `<div class="fact"><div class="k">Website</div><div class="v">${esc(hostFromUrl(url) || url)}</div></div>` : ''}
    </div>
    ${bits.bullets?.length ? `<ul class="clean">${bits.bullets.slice(0, 4).map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
  `;
}

function renderPerformanceCard(bits: any) {
  const metrics = bits.metrics || [];
  if (!metrics.length) {
    return `<p>${esc(cleanProse(bits.raw || 'No metrics extracted.'))}</p>`;
  }
  return `
    <div>
      ${metrics.slice(0, 8).map((m) => `<div class="fact"><div class="k">${esc(m.label)}</div><div class="v">${esc(m.value)}</div></div>`).join('')}
    </div>
    ${bits.notes?.length ? `<ul class="clean">${bits.notes.slice(0, 4).map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
  `;
}

function renderInvestorTable(rows: any) {
  const body = rows
    .map(
      (r) => `<tr>
      <td><strong>${esc(r.name)}</strong>${r.type ? `<div class="tiny">${esc(r.type)}</div>` : ''}</td>
      <td>${esc(r.whyRelevant || r.thesis || '—')}</td>
      <td>${esc(r.examplePortfolioCompanies || '—')}</td>
    </tr>`
    )
    .join('');
  return `<table class="data"><thead><tr><th style="width:22%">Investor</th><th>Why relevant</th><th style="width:26%">Example portfolio</th></tr></thead><tbody>${body}</tbody></table>`;
}

function renderBenchmarkTable(rows: any) {
  const showMetric = rows.some(
    (r) =>
      r.metricType &&
      !String(r.preInvestmentRevenue).toLowerCase().includes(String(r.metricType).toLowerCase())
  );
  const body = rows
    .map((r) => {
      const metricCell = showMetric ? `<td>${esc(r.metricType || '—')}</td>` : '';
      return `<tr>
      <td><strong>${esc(r.company)}</strong>${r.round ? `<div class="tiny">${esc(r.round)}</div>` : ''}</td>
      <td>${esc(r.investor || '—')}</td>
      <td class="num">${esc(r.preInvestmentRevenue)}</td>
      ${metricCell}
    </tr>`;
    })
    .join('');
  const metricHead = showMetric ? '<th>Metric</th>' : '';
  return `<table class="data"><thead><tr><th>Company</th><th>Investor</th><th>Pre-investment revenue</th>${metricHead}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderContactTable(rows: any) {
  if (!rows.length) {
    return `<div class="card"><p class="muted">No partner contacts with public LinkedIn, email, or social URLs were found.</p></div>`;
  }
  const body = rows
    .map((c) => {
      const links = [];
      if (c.linkedin) links.push(`<a href="${esc(c.linkedin)}">LinkedIn</a>`);
      if (c.email) links.push(`<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`);
      if (c.twitter) links.push(esc(c.twitter));
      for (const s of c.otherSocials || []) {
        if (s) links.push(`<a href="${esc(s)}">${esc(shortUrl(s))}</a>`);
      }
      return `<tr>
        <td><strong>${esc(c.name)}</strong>${c.role ? `<div class="tiny">${esc(c.role)}</div>` : ''}</td>
        <td>${esc(c.firm)}</td>
        <td>${links.join(' · ')}</td>
      </tr>`;
    })
    .join('');
  return `<table class="data"><thead><tr><th style="width:28%">Name</th><th style="width:28%">Firm</th><th>Public contacts</th></tr></thead><tbody>${body}</tbody></table>`;
}

function renderSourceCards(sources: any, title: any) {
  const list = (Array.isArray(sources) ? sources : [])
    .filter((s) => s?.url || s?.title)
    .slice(0, 10);
  if (!list.length) return '';
  const rows = list
    .map(
      (s) =>
        `<tr><td>${esc(s.title || hostFromUrl(s.url) || 'Source')}</td><td class="tiny">${esc(s.url || '')}</td></tr>`
    )
    .join('');
  return `<div class="card" style="margin-top:8px"><div class="kicker">${esc(title)}</div><table class="data" style="margin:0;box-shadow:none;border:0"><thead><tr><th>Title</th><th>URL</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* -------------------- normalizers -------------------- */

function normalizeInvestors(investors: any) {
  const structured = asObject(investors?.structuredOutput);
  let rows = Array.isArray(structured?.investors) ? structured.investors : [];
  if (!rows.length) rows = parseInvestorsFromMarkdown(investors?.investorSummary);
  return rows
    .map((r) => ({
      name: cleanCell(r.name || r.firm || r.investor),
      type: cleanCell(r.type || r.stage || ''),
      thesis: cleanCell(r.thesis || ''),
      whyRelevant: cleanCell(r.whyRelevant || r.reason || r.fit || r.thesis || ''),
      examplePortfolioCompanies: cleanCell(
        r.examplePortfolioCompanies || r.portfolio || r.examples || ''
      )
    }))
    .filter((r) => r.name)
    .slice(0, 25);
}

function normalizeBenchmarks(portfolio: any) {
  const structured = asObject(portfolio?.structuredOutput);
  let rows = Array.isArray(structured?.benchmarks) ? structured.benchmarks : [];
  if (!rows.length) rows = parseBenchmarksFromMarkdown(portfolio?.portfolioRevenueSummary);
  return rows
    .map((r) => ({
      company: cleanCell(r.company || r.name),
      investor: cleanCell(r.investor || r.firm || ''),
      round: cleanCell(r.round || r.stage || ''),
      preInvestmentRevenue: cleanCell(r.preInvestmentRevenue || r.revenue || r.arr || r.mrr || ''),
      metricType: cleanCell(r.metricType || r.metric || '')
    }))
    .filter((r) => r.company && r.preInvestmentRevenue)
    .slice(0, 25);
}

function normalizeContacts(list: any, opts: any = {}) {
  const rows = Array.isArray(list) ? list : [];
  const seen = new Set();
  const out = [];
  for (const c of rows) {
    const name = cleanCell(c.name);
    const firm = cleanCell(c.firm);
    if (!name || !firm) continue;
    const linkedin = cleanUrl(c.linkedin);
    const email = cleanEmail(c.email);
    const twitter = cleanCell(c.twitter || '');
    const otherSocials = (Array.isArray(c.otherSocials) ? c.otherSocials : [])
      .map(cleanUrl)
      .filter(Boolean);
    if (opts.requireReach && !linkedin && !email && !twitter && !otherSocials.length) continue;
    const key = `${name.toLowerCase()}|${firm.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, firm, role: cleanCell(c.role || ''), linkedin, email, twitter, otherSocials });
  }
  return out.slice(0, 50);
}

function collectEvidence(data: any) {
  const out = [];
  const seen = new Set();
  for (const bucket of [
    data.investors?.sources,
    data.portfolioBenchmarks?.sources,
    data.partnerContacts?.sources
  ]) {
    for (const s of bucket || []) {
      const url = s?.url;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({ title: s.title || '', url });
    }
  }
  return out.slice(0, 40);
}

function parseLabeledSummary(text: any) {
  const raw = String(text || '').trim();
  const name =
    matchLine(raw, /(?:\*\*)?product name(?:\*\*)?[:\s]+(.+)/i) ||
    matchLine(raw, /^\d+\)\s*product name[:\s]+(.+)/i) ||
    matchLine(raw, /^product:\s*(.+)/i);
  const what =
    matchLine(raw, /(?:\d+\)\s*)?what it does[:\s]+(.+)/i) ||
    matchLine(raw, /(?:description)[:\s]+(.+)/i) ||
    '';
  const forWhom =
    matchLine(raw, /(?:\d+\)\s*)?(?:who it is for|audience)[:\s]+(.+)/i) || '';
  const bullets = [...raw.matchAll(/^[-*•]\s+(.+)$/gm)].map((m) => stripMd(m[1])).filter(Boolean);
  const proseLine = raw
    .split('\n')
    .map((l) => l.trim())
    .find(
      (l) =>
        l &&
        !/^\d+\)/.test(l) &&
        !/product name|who it is for|notable|capabilities|^[-*•]|^#{1,3}/i.test(l) &&
        l.length > 40
    );

  return {
    name: cleanLabel(name).replace(/^\d+\)\s*/, ''),
    what: cleanLabel(what),
    forWhom: cleanLabel(forWhom),
    bullets: bullets.slice(0, 4).map(cleanLabel).filter(Boolean),
    blurb: cleanLabel(proseLine || '').slice(0, 220)
  };
}

function cleanLabel(value: any) {
  return stripMd(String(value || ''))
    .replace(/^[:\-\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePerformance(text: any) {
  const raw = String(text || '').trim();
  const metrics = [];
  const patterns = [
    [/\bARR\b[^$0-9]{0,20}(\$?[\d.,]+\s*[kmb]?)/i, 'ARR'],
    [/\bMRR\b[^$0-9]{0,20}(\$?[\d.,]+\s*[kmb]?)/i, 'MRR'],
    [/revenue[^$0-9]{0,20}(\$?[\d.,]+\s*[kmb]?)/i, 'Revenue'],
    [/gross margin[^0-9%]{0,12}([\d.]+\s*%)/i, 'Gross margin'],
    [/net.?margin[^0-9%]{0,12}([\d.]+\s*%)/i, 'Net margin'],
    [/churn[^0-9%]{0,12}([\d.]+\s*%?)/i, 'Churn'],
    [/customers?[^0-9]{0,12}([\d,]+)/i, 'Customers'],
    [/growth[^0-9%]{0,16}([\d.]+\s*%[^.\n]*)/i, 'Growth']
  ];
  for (const [re, label] of patterns) {
    const m = raw.match(re);
    if (m?.[1]) metrics.push({ label, value: m[1].trim() });
  }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*[-*]?\s*\*?\*?([A-Za-z][A-Za-z /%]{1,24})\*?\*?\s*[:=]\s*(.+)$/);
    if (!m) continue;
    const label = stripMd(m[1]).trim();
    const value = stripMd(m[2]).trim();
    if (!label || !value || value.length > 60) continue;
    if (!metrics.some((x) => x.label.toLowerCase() === label.toLowerCase())) {
      metrics.push({ label, value });
    }
  }
  const notes = [...raw.matchAll(/^[-*•]\s+(.+)$/gm)]
    .map((m) => stripMd(m[1]))
    .filter((n) => n && !/^(arr|mrr|revenue)\b/i.test(n))
    .slice(0, 5);
  return { metrics: metrics.slice(0, 8), notes, raw };
}

function parseInvestorsFromMarkdown(summary: any) {
  const text = String(summary || '');
  const tableRows = [];
  for (const line of text.split('\n')) {
    if (!/\|/.test(line) || /^\s*\|?\s*-+/.test(line)) continue;
    const cells = line
      .split('|')
      .map((c) => stripMd(c).trim())
      .filter(Boolean);
    if (cells.length < 2) continue;
    if (/^investor|^name|^firm/i.test(cells[0])) continue;
    tableRows.push({
      name: cells[0],
      type: cells[1] || '',
      whyRelevant: cells[2] || cells[1] || '',
      examplePortfolioCompanies: cells[3] || ''
    });
  }
  if (tableRows.length) return tableRows;

  const bullets = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:\d+[.)]\s+|[-*•]\s+)\*?\*?(.+?)\*?\*?(?:\s*(?:—+|-+|:)\s*(.+))?$/);
    if (!m) continue;
    const name = stripMd(m[1]).split(/[—(]/)[0].trim();
    if (!name || name.length > 80 || /^(top|gaps|focus|example)/i.test(name)) continue;
    bullets.push({
      name,
      whyRelevant: stripMd(m[2] || line.replace(/^\s*(?:\d+[.)]\s+|[-*•]\s+)/, '')).slice(0, 280),
      examplePortfolioCompanies: ''
    });
  }
  return bullets;
}

function parseBenchmarksFromMarkdown(summary: any) {
  const text = String(summary || '');
  const tableRows = [];
  for (const line of text.split('\n')) {
    if (!/\|/.test(line) || /^\s*\|?\s*-+/.test(line)) continue;
    const cells = line
      .split('|')
      .map((c) => stripMd(c).trim())
      .filter(Boolean);
    if (cells.length < 2) continue;
    if (/^company|^name/i.test(cells[0])) continue;
    tableRows.push({
      company: cells[0],
      investor: cells[1] || '',
      preInvestmentRevenue: cells[2] || cells[1] || '',
      metricType: cells[3] || '',
      round: ''
    });
  }
  return tableRows;
}

/* -------------------- helpers -------------------- */

function asObject(value: any) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      const start = value.indexOf('{');
      const end = value.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(value.slice(start, end + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function coverLede(bits: any) {
  if (bits.what) return bits.what.slice(0, 240);
  if (bits.blurb && !/product name/i.test(bits.blurb)) return bits.blurb.slice(0, 240);
  return 'Full investor outreach findings — product, traction, shortlist, benchmarks, and partner contacts.';
}

function cleanProse(text: any) {
  return stripMd(String(text || ''))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 800);
}

function cleanCell(value: any) {
  return stripMd(String(value ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320);
}

function cleanUrl(value: any) {
  const v = String(value || '').trim();
  if (!v || !/^https?:\/\//i.test(v)) return '';
  return v;
}

function cleanEmail(value: any) {
  const v = String(value || '').trim();
  if (!v || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return '';
  if (/\*/.test(v)) return '';
  return v;
}

function shortUrl(url: any) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname.slice(0, 28));
  } catch {
    return String(url).slice(0, 40);
  }
}

function stripMd(value: any) {
  return String(value || '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([\s\S]+?)\*\*/g, '$1')
    .replace(/__([\s\S]+?)__/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    // Orphan markdown markers (unclosed ** / leftover #)
    .replace(/\*{1,2}/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\s*#+\s*$/gm, '')
    .trim();
}

function matchLine(text: any, re: any) {
  const m = String(text || '').match(re);
  return m?.[1]?.trim() || '';
}

function extractProductName(summary: any) {
  return parseLabeledSummary(summary).name || '';
}

function hostFromUrl(url: any) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function unique(arr: any) {
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    const k = String(v).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

function esc(value: any) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Markdown → HTML for full AI synthesis sections. */
function md(text: any) {
  const raw = String(text || '').trim();
  if (!raw) return '<p class="muted">—</p>';

  const blocks = raw
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  return blocks
    .map((block) => {
      const lines = block.split('\n').map((l) => l.trimEnd());
      const nonEmpty = lines.filter((l) => l.trim());
      if (!nonEmpty.length) return '';

      // markdown table
      if (nonEmpty.length >= 2 && nonEmpty.every((l) => l.includes('|'))) {
        const rows = nonEmpty.filter((l) => !/^\s*\|?\s*[-:| ]+\s*\|?\s*$/.test(l));
        if (rows.length >= 2) {
          const parseRow = (line) =>
            line
              .split('|')
              .map((c) => c.trim())
              .filter((_, i, arr) => !(i === 0 && arr[0] === '') && !(i === arr.length - 1 && arr[arr.length - 1] === ''))
              .map((c) => c.trim());
          const header = parseRow(rows[0]).filter(Boolean);
          const body = rows.slice(1);
          if (header.length) {
            return `<table class="data avoid"><thead><tr>${header.map((h) => `<th>${inlineMd(esc(stripMd(h)))}</th>`).join('')}</tr></thead><tbody>${body
              .map((r) => {
                const cells = parseRow(r);
                while (cells.length < header.length) cells.push('');
                return `<tr>${cells
                  .slice(0, header.length)
                  .map((c) => `<td>${inlineMd(esc(stripMd(c)))}</td>`)
                  .join('')}</tr>`;
              })
              .join('')}</tbody></table>`;
          }
        }
      }

      // Pull a leading markdown / label heading out of multi-line blocks
      // (fixes "### Quick take-aways" dumping into body text).
      const headingMatch = nonEmpty[0].match(
        /^(?:#{1,6}\s+|(?:\d+[.)]\s+))?(.+?)\s*$/
      );
      const looksLikeHeading =
        /^#{1,6}\s+/.test(nonEmpty[0]) ||
        /^(Quick take-?aways?|Top relevant|Their apparent|Example portfolio|Gaps|Focus|Notes|Summary|Strongest matches|Secondary matches)\b/i.test(
          nonEmpty[0].replace(/^#{1,6}\s+/, '')
        );

      if (looksLikeHeading && headingMatch) {
        const title = stripMd(nonEmpty[0].replace(/^#{1,6}\s+/, ''));
        const rest = nonEmpty.slice(1);
        if (!rest.length) {
          return `<h3>${esc(title)}</h3>`;
        }
        const listish = rest.every((l) => /^([-•*]|\d+[.)])\s+/.test(l.trim()));
        if (listish) {
          const ordered = rest.every((l) => /^\d+[.)]\s+/.test(l.trim()));
          const tag = ordered ? 'ol' : 'ul';
          const items = rest
            .map((l) => `<li>${inlineMd(esc(stripMd(l.trim().replace(/^([-•*]|\d+[.)])\s+/, ''))))}</li>`)
            .join('');
          return `<h3>${esc(title)}</h3><${tag}>${items}</${tag}>`;
        }
        return `<h3>${esc(title)}</h3><p>${inlineMd(esc(stripMd(rest.join('\n'))).replaceAll('\n', '<br/>'))}</p>`;
      }

      // bullet / numbered list
      if (nonEmpty.every((l) => /^([-•*]|\d+[.)])\s+/.test(l.trim()))) {
        const ordered = nonEmpty.every((l) => /^\d+[.)]\s+/.test(l.trim()));
        const tag = ordered ? 'ol' : 'ul';
        const items = nonEmpty
          .map((l) => `<li>${inlineMd(esc(stripMd(l.trim().replace(/^([-•*]|\d+[.)])\s+/, ''))))}</li>`)
          .join('');
        return `<${tag}>${items}</${tag}>`;
      }

      // Mixed prose + bullets: render line-by-line so orphan "*" bullets don't leak
      if (nonEmpty.some((l) => /^([-•*]|\d+[.)])\s+/.test(l.trim()))) {
        const parts = [];
        let buf = [];
        let listBuf = [];
        const flushBuf = () => {
          if (buf.length) {
            parts.push(`<p>${inlineMd(esc(stripMd(buf.join('\n'))).replaceAll('\n', '<br/>'))}</p>`);
            buf = [];
          }
        };
        const flushList = () => {
          if (listBuf.length) {
            const items = listBuf
              .map((l) => `<li>${inlineMd(esc(stripMd(l.replace(/^([-•*]|\d+[.)])\s+/, ''))))}</li>`)
              .join('');
            parts.push(`<ul>${items}</ul>`);
            listBuf = [];
          }
        };
        for (const line of nonEmpty) {
          if (/^([-•*]|\d+[.)])\s+/.test(line.trim())) {
            flushBuf();
            listBuf.push(line.trim());
          } else {
            flushList();
            buf.push(line);
          }
        }
        flushBuf();
        flushList();
        return parts.join('');
      }

      return `<p>${inlineMd(esc(stripMd(block)).replaceAll('\n', '<br/>'))}</p>`;
    })
    .join('');
}

function inlineMd(escaped: any) {
  // Prefer already-stripped text; convert any remaining paired markers defensively.
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/#{1,6}\s+/g, '');
}
