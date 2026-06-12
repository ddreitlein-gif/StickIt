#!/usr/bin/env node
// Builds the printable PDF guides served at /docs/guides/ and listed on
// /help/printable-guides. Run locally from the repo (requires client/src/help/
// for the Complete User Guide) — typically as part of the release build:
//
//   node server/scripts/build_guide_pdfs.js
//
// Output: server/public/docs/guides/*.pdf (commit the regenerated files).
const fs = require('fs');
const path = require('path');
const { VERSION } = require('../version');
const { COLORS, newDoc, coverPage, stampFooters, writeDoc } = require('./guides/style');
const draw = require('./guides/draw');
const style = require('./guides/style');
const { buildCompleteGuide } = require('./guides/complete_guide');

const OUT_DIR = path.join(__dirname, '..', 'public', 'docs', 'guides');

const QUICK_STARTS = [
  require('./guides/qs_judges'),
  require('./guides/qs_chief_of_score'),
  require('./guides/qs_event_secretary'),
  require('./guides/qs_timekeeper'),
  require('./guides/qs_live_stream'),
];

async function buildQuickStart(def) {
  const doc = newDoc({ title: `StickIt Quick Start — ${def.title}` });
  coverPage(doc, {
    title: def.title,
    subtitle: 'Quick Start Guide',
    audience: def.audience,
    version: VERSION,
    accent: def.accent || COLORS.blue,
  });
  for (const pageFn of def.pages) {
    doc.addPage();
    pageFn(doc, draw, style);
  }
  stampFooters(doc, { version: VERSION, guideTitle: `${def.title} Quick Start` });
  const pages = doc.bufferedPageRange().count;
  const outPath = path.join(OUT_DIR, def.file);
  await writeDoc(doc, outPath);
  return { file: def.file, pages, bytes: fs.statSync(outPath).size };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const results = [];

  for (const def of QUICK_STARTS) {
    results.push(await buildQuickStart(def));
  }

  const completeOut = path.join(OUT_DIR, 'StickIt_Complete_User_Guide.pdf');
  const complete = await buildCompleteGuide(completeOut, VERSION);
  results.push({ file: 'StickIt_Complete_User_Guide.pdf', pages: complete.pages, bytes: fs.statSync(completeOut).size });

  console.log(`\nGuide PDFs built (${VERSION}):`);
  for (const r of results) {
    console.log(`  ${r.file.padEnd(44)} ${String(r.pages).padStart(3)} pages  ${(r.bytes / 1024).toFixed(0).padStart(5)} KB`);
  }
  if (complete.warnings.length) {
    console.log(`\nWARNINGS (${complete.warnings.length}):`);
    complete.warnings.forEach(w => console.log('  ' + w));
    process.exitCode = 1;
  } else {
    console.log(`\nComplete guide: ${complete.topics} topics, zero unresolved links.`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
