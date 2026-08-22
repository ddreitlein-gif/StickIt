#!/usr/bin/env node
/**
 * StickIt v2 test-harness runner (R16).
 *
 * Usage:
 *   node run.js               run every tests/*.test.js
 *   node run.js step0         run test files whose name contains "step0"
 *
 * Each test file exports `async function main()` returning a Checks instance
 * (or an array of them). Exit code is non-zero when any check fails.
 */

const fs = require('fs');
const path = require('path');
const { SCRATCH_ROOT } = require('./lib/instance');

async function main() {
  const filter = process.argv[2] || '';
  const testDir = path.join(__dirname, 'tests');
  const files = fs.readdirSync(testDir)
    .filter(f => f.endsWith('.test.js'))
    .filter(f => f.includes(filter))
    .sort();

  if (files.length === 0) {
    console.error(`No test files match "${filter}"`);
    process.exit(2);
  }

  // Fresh scratch area per run.
  fs.rmSync(SCRATCH_ROOT, { recursive: true, force: true });
  fs.mkdirSync(SCRATCH_ROOT, { recursive: true });

  let totalPass = 0;
  let totalFail = 0;
  const failedSuites = [];

  for (const f of files) {
    console.log(`\n== ${f} ==`);
    const mod = require(path.join(testDir, f));
    let results;
    try {
      results = await mod.main();
    } catch (e) {
      console.error(`  SUITE CRASHED: ${e && e.stack || e}`);
      totalFail++;
      failedSuites.push(`${f} (crashed)`);
      continue;
    }
    const list = Array.isArray(results) ? results : [results];
    for (const c of list) {
      const s = c.summary();
      totalPass += s.passed;
      totalFail += s.failed;
      if (s.failed > 0) failedSuites.push(`${f} :: ${s.label} (${s.failed} failed)`);
      console.log(`  -- ${s.label}: ${s.passed} passed, ${s.failed} failed`);
    }
  }

  // Best-effort browser shutdown if any suite used Playwright.
  try { await require('./lib/browser').shutdownBrowser(); } catch (_) {}

  console.log(`\n=== HARNESS TOTAL: ${totalPass} passed, ${totalFail} failed ===`);
  if (failedSuites.length) {
    console.log('Failed suites:');
    for (const s of failedSuites) console.log(`  - ${s}`);
  }
  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
