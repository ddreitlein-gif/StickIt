#!/usr/bin/env node
/**
 * Validate StickIt scoring engine against Winfree output
 * for the "RMF Divisional Champs at Telluride" competition.
 *
 * Usage: node server/scripts/validate_telluride.js
 */

const fs = require('fs');
const path = require('path');
const {
  calcMogulScore,
} = require('../scoring/engine.js');

const TXT_PATH = path.join(
  '/Users/daviddreitlein/Desktop/Scoring Server/Claude Uploads',
  'Tellirode Comp Series ',
  'Telluride Divisional Champs 2026.TXT'
);

/**
 * Parse a run's scoring tokens.
 * Tokens: J1 J2 J3 T&L J4 J5 Code DD Airs Judge Time|"(none)" [SpeedPts] Run [Event]
 */
function parseRunTokens(tokens) {
  if (!tokens || tokens.length < 11) return null;
  if (tokens[0] === 'dns' || tokens[0] === 'dnf' || tokens[3] === 'dns' || tokens[3] === 'dnf') {
    return { status: 'dns_dnf' };
  }

  const j1 = parseFloat(tokens[0]);
  const j2 = parseFloat(tokens[1]);
  const j3 = parseFloat(tokens[2]);
  const tl = parseFloat(tokens[3]);
  const j4a = parseFloat(tokens[4]);
  const j5a = parseFloat(tokens[5]);
  const code1 = tokens[6];
  const dd1 = parseFloat(tokens[7]);
  const airs = parseFloat(tokens[8]);
  const judge = parseFloat(tokens[9]);

  let time = null, speedPts = 0, runTotal, eventScore = null;
  let nextIdx;

  if (tokens[10] === '(none)') {
    time = null;
    speedPts = 0;
    runTotal = parseFloat(tokens[11]);
    nextIdx = 12;
  } else {
    time = parseFloat(tokens[10]);
    // Winfree omits speed token when speed is 0 (time too slow).
    // Disambiguate: if tl + airs + tokens[11] ≈ tokens[12], speed is present.
    // If tl + airs ≈ tokens[11], speed was omitted and tokens[11] is the run total.
    const candidateSpeed = parseFloat(tokens[11]);
    const candidateRun = parseFloat(tokens[12]);
    if (tokens.length >= 13 && Math.abs(tl + airs + candidateSpeed - candidateRun) < 0.02) {
      speedPts = candidateSpeed;
      runTotal = candidateRun;
      nextIdx = 13;
    } else {
      // Speed omitted (0), tokens[11] is run total
      speedPts = 0;
      runTotal = candidateSpeed;
      nextIdx = 12;
    }
  }

  // Event score is the next token if present and numeric
  if (nextIdx < tokens.length && /^\d/.test(tokens[nextIdx])) {
    eventScore = parseFloat(tokens[nextIdx]);
  }

  if (isNaN(j1) || isNaN(tl) || isNaN(runTotal)) return null;

  return {
    j1, j2, j3, tl,
    j4a, j5a, code1, dd1,
    j4b: null, j5b: null, code2: null, dd2: null,
    airs, judge, time, speedPts, runTotal, eventScore,
  };
}

/**
 * Parse the Winfree TXT file.
 */
function parseWinfreeTxt(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8');
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''));

  const athletes = [];
  let i = 0;

  // Skip to data separator
  while (i < lines.length && !lines[i].startsWith('=== ===')) i++;
  i++;
  if (i < lines.length && lines[i].trim() === '') i++;

  // Athlete header regex
  const athRe = /^\s*(\d+)\s+(\d+)\s+(.+?)\s+(F\d+|M\d+|[FM]Sr)\s+(\S+)\s+(.*)$/;

  while (i < lines.length) {
    const line = lines[i];
    if (line.match(/^Male\s+=/) || line.match(/^Winfree/)) break;

    const m = athRe.exec(line);
    if (!m) { i++; continue; }

    const rank = parseInt(m[1]);
    const bib = parseInt(m[2]);
    const name = m[3].trim();
    const group = m[4];
    const club = m[5];
    const gender = group.startsWith('F') ? 'F' : 'M';

    // Parse run 1 from rest of athlete line
    const r1Tokens = m[6].trim().split(/\s+/).filter(Boolean);
    const run1 = parseRunTokens(r1Tokens);
    i++;

    // Jump 2 line for run 1
    if (i < lines.length && run1 && !run1.status) {
      const j2Tokens = lines[i].trim().split(/\s+/).filter(Boolean);
      if (j2Tokens.length >= 4 && /^[\d.]/.test(j2Tokens[0])) {
        run1.j4b = parseFloat(j2Tokens[0]);
        run1.j5b = parseFloat(j2Tokens[1]);
        run1.code2 = j2Tokens[2];
        run1.dd2 = parseFloat(j2Tokens[3]);
      }
      i++;
    }

    // Skip J.1= component line
    while (i < lines.length && lines[i].trim().startsWith('J.1=')) i++;

    // Run 2 line (indented, starts with scores)
    let run2 = null;
    if (i < lines.length) {
      const r2line = lines[i].trim();
      const r2Tokens = r2line.split(/\s+/).filter(Boolean);
      run2 = parseRunTokens(r2Tokens);
      i++;
    }

    // Jump 2 for run 2
    if (i < lines.length && run2 && !run2.status) {
      const j2Tokens = lines[i].trim().split(/\s+/).filter(Boolean);
      if (j2Tokens.length >= 4 && /^[\d.]/.test(j2Tokens[0])) {
        run2.j4b = parseFloat(j2Tokens[0]);
        run2.j5b = parseFloat(j2Tokens[1]);
        run2.code2 = j2Tokens[2];
        run2.dd2 = parseFloat(j2Tokens[3]);
      }
      i++;
    }

    // Skip J.1= component line for run 2
    while (i < lines.length && lines[i].trim().startsWith('J.1=')) i++;

    // Extract event score from run 2 line
    const eventScore = (run2 && run2.eventScore) || null;

    athletes.push({ rank, bib, name, group, club, gender, run1, run2, eventScore });
  }

  return athletes;
}

function validateRun(run, paceTime, label) {
  if (!run || run.status) return null;

  const hasSpeed = run.time !== null && run.time > 0;
  const result = calcMogulScore({
    tlScores: [run.j1, run.j2, run.j3],
    airScoresJump1: [run.j4a, run.j5a],
    dd1: run.dd1,
    airScoresJump2: run.j4b !== null ? [run.j4b, run.j5b] : [],
    dd2: run.dd2 || 0,
    runTime: run.time,
    paceTime: hasSpeed ? paceTime : null,
    hasSpeed,
  });

  const diffs = {};
  let hasDiff = false;

  const check = (name, stickit, winfree) => {
    if (Math.abs(stickit - winfree) > 0.005) {
      diffs[name] = { stickit, winfree, diff: +(stickit - winfree).toFixed(2) };
      hasDiff = true;
    }
  };

  check('tl', result.turnsContrib, run.tl);
  check('air', result.airRaw, run.airs);
  check('speed', result.speedContrib, run.speedPts);
  check('total', result.total, run.runTotal);

  return { label, result, run, diffs, hasDiff };
}

function main() {
  console.log('=== StickIt vs Winfree Scoring Validation ===');
  console.log('Event: RMF Divisional Champs at Telluride\n');

  const athletes = parseWinfreeTxt(TXT_PATH);
  console.log(`Parsed ${athletes.length} athletes from Winfree TXT\n`);

  const PACE = { F: 23.90, M: 20.20 };

  let totalRuns = 0, matchRuns = 0, diffRuns = 0;
  let totalEvents = 0, matchEvents = 0, diffEvents = 0;
  const allDiffs = [];

  for (const a of athletes) {
    const pace = PACE[a.gender];
    const r1v = validateRun(a.run1, pace, `${a.name} (${a.bib}) R1`);
    const r2v = validateRun(a.run2, pace, `${a.name} (${a.bib}) R2`);

    for (const rv of [r1v, r2v]) {
      if (!rv) continue;
      totalRuns++;
      if (rv.hasDiff) { diffRuns++; allDiffs.push(rv); }
      else matchRuns++;
    }

    if (a.eventScore) {
      totalEvents++;
      const best = Math.max(r1v?.result?.total || 0, r2v?.result?.total || 0);
      if (Math.abs(best - a.eventScore) > 0.005) diffEvents++;
      else matchEvents++;
    }
  }

  console.log('--- Run Score Comparison ---');
  console.log(`Total scored runs: ${totalRuns}`);
  console.log(`Matching:  ${matchRuns} (${(matchRuns / totalRuns * 100).toFixed(1)}%)`);
  console.log(`Different: ${diffRuns} (${(diffRuns / totalRuns * 100).toFixed(1)}%)\n`);

  console.log('--- Event Score Comparison ---');
  console.log(`Total events: ${totalEvents}`);
  console.log(`Matching:  ${matchEvents} (${(matchEvents / totalEvents * 100).toFixed(1)}%)`);
  console.log(`Different: ${diffEvents} (${(diffEvents / totalEvents * 100).toFixed(1)}%)\n`);

  if (allDiffs.length > 0) {
    let airN = 0, spdN = 0, tlN = 0;
    for (const d of allDiffs) {
      if (d.diffs.air) airN++;
      if (d.diffs.speed) spdN++;
      if (d.diffs.tl) tlN++;
    }
    console.log(`--- Discrepancy Breakdown ---`);
    console.log(`Air diffs: ${airN}, Speed diffs: ${spdN}, T&L diffs: ${tlN}\n`);

    console.log(`All ${allDiffs.length} discrepancies:`);
    for (const d of allDiffs) {
      const parts = [];
      if (d.diffs.air) parts.push(`Air: ${d.result.airRaw} vs ${d.run.airs} (${d.diffs.air.diff > 0 ? '+' : ''}${d.diffs.air.diff})`);
      if (d.diffs.speed) parts.push(`Spd: ${d.result.speedContrib} vs ${d.run.speedPts} (${d.diffs.speed.diff > 0 ? '+' : ''}${d.diffs.speed.diff})`);
      if (d.diffs.tl) parts.push(`T&L: ${d.diffs.tl.stickit} vs ${d.diffs.tl.winfree}`);
      if (d.diffs.total) parts.push(`Tot: ${d.result.total} vs ${d.run.runTotal} (${d.diffs.total.diff > 0 ? '+' : ''}${d.diffs.total.diff})`);
      console.log(`  ${d.label}: ${parts.join(' | ')}`);
    }
  }

  console.log('\n=== Validation Complete ===');
}

main();
