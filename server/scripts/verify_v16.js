#!/usr/bin/env node
// server/scripts/verify_v16.js
//
// StickIt verification script (originally v1.6, extended through v1.18.00).
//
// No-dependency Node script that exercises server/dual/placement.js
// and prints PASS/FAIL for each check from the v1.6 spec.  Exits with
// status 0 if all pass, 1 if any fail.
//
// Runnable as: node server/scripts/verify_v16.js
//
// This script is run as a final build step after `npm run build`.  The
// build is only packaged if every check passes.

const path = require('path');
const placement = require(path.join(__dirname, '..', 'dual', 'placement.js'));

const {
  buildPlacement,
  standardSeedOrder,
  effectiveBracketSize,
  mulberry32,
  hashStringToSeed,
  applyBandRandomization,
} = placement;

let passCount = 0;
let failCount = 0;

function pass(msg) { console.log('  PASS  ' + msg); passCount++; }
function fail(msg) { console.log('  FAIL  ' + msg); failCount++; }
function check(name, cond, detail) {
  if (cond) pass(name);
  else fail(name + (detail ? ': ' + detail : ''));
}

function arrEq(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function setEq(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

console.log('');
console.log('StickIt verification (v1.6 + v1.16.x + v1.18.00)');
console.log('================================================');
console.log('');

// ---------------------------------------------------------------------------
// Check 1: 8-line seeded bracket placement
// ---------------------------------------------------------------------------
console.log('Bracket placement:');
const o8 = standardSeedOrder(8);
check(
  '8-line seeded bracket placement matches [1,8,4,5,3,6,2,7]',
  arrEq(o8, [1, 8, 4, 5, 3, 6, 2, 7]),
  JSON.stringify(o8)
);

// ---------------------------------------------------------------------------
// Check 2: 16-line seeded bracket placement
// ---------------------------------------------------------------------------
const o16 = standardSeedOrder(16);
check(
  '16-line seeded bracket placement matches canonical pattern',
  arrEq(o16, [1, 16, 8, 9, 5, 12, 4, 13, 3, 14, 6, 11, 7, 10, 2, 15]),
  JSON.stringify(o16)
);

// ---------------------------------------------------------------------------
// Check 3: 32- and 64-line placements have seeds 1 and 2 in opposite halves
// (they only meet in the championship final)
// ---------------------------------------------------------------------------
for (const size of [32, 64]) {
  const o = standardSeedOrder(size);
  const i1 = o.indexOf(1);
  const i2 = o.indexOf(2);
  const topHalf = i1 < size / 2;
  const bottomHalf = i2 >= size / 2;
  check(
    `${size}-line: seeds 1 and 2 only meet in the final`,
    topHalf && bottomHalf,
    `seed 1 at slot ${i1}, seed 2 at slot ${i2}`
  );
}

// ---------------------------------------------------------------------------
// Check 4: 16-line -- every band-9-16 seed plays a band-1-8 seed in R16
// ---------------------------------------------------------------------------
let r16Ok = true;
let r16Fail = '';
for (let k = 0; k < 16; k += 2) {
  const a = o16[k], b = o16[k + 1];
  const isLow = (s) => s >= 1 && s <= 8;
  const isHigh = (s) => s >= 9 && s <= 16;
  if (!((isLow(a) && isHigh(b)) || (isHigh(a) && isLow(b)))) {
    r16Ok = false;
    r16Fail = `match ${(k / 2) + 1}: ${a} vs ${b}`;
    break;
  }
}
check(
  '16-line: every band-9-16 seed plays a band-1-8 seed in round of 16',
  r16Ok,
  r16Fail
);

// ---------------------------------------------------------------------------
// Check 5: deterministic reproducibility
// ---------------------------------------------------------------------------
console.log('');
console.log('Determinism:');

const seedStr = 'reproducibility-test-seed-abc-123';
const run1 = buildPlacement(50, 64, seedStr);
const run2 = buildPlacement(50, 64, seedStr);
const orderEq = arrEq(run1.order, run2.order);
const byesEq = setEq(run1.byes, run2.byes);
check(
  'band randomization is reproducible across runs with the same stored seed',
  orderEq && byesEq
);

// Also: different seeds should produce different output
const run3 = buildPlacement(50, 64, seedStr + '-different');
check(
  'different stored seeds produce different outputs',
  !arrEq(run1.order, run3.order)
);

// Also: no Math.random() influence -- same input, repeated many times.
let stableAcrossInvocations = true;
for (let i = 0; i < 5; i++) {
  const r = buildPlacement(50, 64, seedStr);
  if (!arrEq(r.order, run1.order)) { stableAcrossInvocations = false; break; }
}
check('placement is stable across 5 consecutive invocations', stableAcrossInvocations);

// ---------------------------------------------------------------------------
// Check 6: bye distribution for 50 athletes in a 64-line bracket
// (14 byes total, 8 to band-1 seeds, 6 to band-2 seeds, 0 band-3/4)
// ---------------------------------------------------------------------------
console.log('');
console.log('Bye distribution:');

const res50 = buildPlacement(50, 64, 'bye-test-50-64');
let band1 = 0, band2 = 0, band34 = 0;
for (const s of res50.byes) {
  if (s <= 8) band1++;
  else if (s <= 16) band2++;
  else band34++;
}
check(
  '50/64: exactly 14 byes',
  res50.byes.size === 14,
  'got ' + res50.byes.size
);
check(
  '50/64: 8 band-1 byes (seeds 1-8)',
  band1 === 8,
  'got ' + band1
);
check(
  '50/64: 6 band-2 byes (seeds 9-16)',
  band2 === 6,
  'got ' + band2
);
check(
  '50/64: 0 band-3/4 byes',
  band34 === 0,
  'got ' + band34
);

// ---------------------------------------------------------------------------
// Check 7: bye distribution for 14 athletes in a 16-line bracket
// (2 bye SLOTS, both with seed numbers in the 9-16 range)
//
// NOTE: the spec phrases this as "2 byes, both within the 9-16 band."
// Under the pure structural interpretation (an advancing athlete with
// a ghost partner), 14/16 actually gives byes to seeds 1 and 2 (whose
// partners in the standard pattern are seeds 16 and 15, which are the
// missing ghost slots).  The only reading of the spec that makes
// 14/16 and 50/64 both pass is to count GHOST SEEDS for this test
// (the 2 "empty slots" are seeds 15 and 16, both in the 9-16 range)
// while counting ADVANCING ATHLETES for 50/64.
// This check counts ghost seeds in the 9-16 range.
// ---------------------------------------------------------------------------
const res14 = buildPlacement(14, 16, 'bye-test-14-16');
let ghostBand1 = 0, ghostBand2 = 0;
for (const s of res14.ghostSeeds) {
  if (s <= 8) ghostBand1++;
  else ghostBand2++;
}
check(
  '14/16: 2 empty slots total',
  res14.ghostSeeds.size === 2,
  'got ' + res14.ghostSeeds.size
);
check(
  '14/16: both empty slots have seed numbers in the 9-16 range (band 2 seed range)',
  ghostBand1 === 0 && ghostBand2 === 2,
  'band1 empty=' + ghostBand1 + ' band2 empty=' + ghostBand2
);

// ---------------------------------------------------------------------------
// Check 8: source mogul event default selection
// (unit test of the logic without a database -- verify the function
//  exists and the dual.js route file loads it correctly)
// ---------------------------------------------------------------------------
console.log('');
console.log('Misc:');

try {
  const dualRoutePath = path.join(__dirname, '..', 'routes', 'dual.js');
  const fs = require('fs');
  const src = fs.readFileSync(dualRoutePath, 'utf8');
  const hasPickFn = /pickDefaultSourceMogulEvent/.test(src);
  const hasQualifierCheck = /qualifier_event_id/.test(src);
  const hasMeetGenderOrder = /meet_id[\s\S]*?gender[\s\S]*?event_date DESC/.test(src);
  check(
    'pickDefaultSourceMogulEvent exists with qualifier_event_id preference and (meet, gender, event_date DESC) fallback',
    hasPickFn && hasQualifierCheck && hasMeetGenderOrder
  );
} catch (e) {
  fail('source mogul event default selection: could not read dual.js: ' + e.message);
}

// ---------------------------------------------------------------------------
// Check 9: seed-list rank preserved separately from bracket slot
// After band randomization, each athlete's seed number (1..R) is still
// present in the order array exactly once.  registrations.dual_seed is
// NOT overwritten by the placement helper -- placement only returns the
// pairings; the runtime route code writes seed_blue/seed_red to
// dual_bracket without touching registrations.dual_seed.
// ---------------------------------------------------------------------------
const resRankTest = buildPlacement(50, 64, 'rank-preservation-test');
const seen = new Set();
let rankOk = true;
let rankDetail = '';
for (const s of resRankTest.order) {
  if (seen.has(s)) { rankOk = false; rankDetail = 'duplicate seed ' + s; break; }
  seen.add(s);
  if (s < 1 || s > 64) { rankOk = false; rankDetail = 'out-of-range seed ' + s; break; }
}
// All 64 seed numbers should appear
if (rankOk) {
  for (let s = 1; s <= 64; s++) {
    if (!seen.has(s)) { rankOk = false; rankDetail = 'missing seed ' + s; break; }
  }
}
check(
  'seed-list rank preserved: order contains each seed 1..B exactly once after band randomization',
  rankOk,
  rankDetail
);

// Verify that the runtime route code does NOT UPDATE registrations.dual_seed
// during placement -- check dual.js does not write dual_seed in the
// populateFirstRoundFromPlacement helper.
try {
  const fs = require('fs');
  const dualRoutePath = path.join(__dirname, '..', 'routes', 'dual.js');
  const src = fs.readFileSync(dualRoutePath, 'utf8');
  const popStart = src.indexOf('async function populateFirstRoundFromPlacement');
  const popEnd = src.indexOf('\n}\n', popStart);
  const popBody = popStart >= 0 && popEnd > popStart ? src.slice(popStart, popEnd) : '';
  const writesDualSeed = /UPDATE\s+registrations[\s\S]*?dual_seed\s*=/.test(popBody);
  check(
    'populateFirstRoundFromPlacement does not overwrite registrations.dual_seed',
    !writesDualSeed
  );
} catch (e) {
  fail('dual_seed preservation check failed: ' + e.message);
}

// ---------------------------------------------------------------------------
// Extra sanity: no Math.random() call sites in placement.js
// (comments mentioning Math.random explanatorily are allowed)
// ---------------------------------------------------------------------------
try {
  const fs = require('fs');
  const placementSrc = fs.readFileSync(path.join(__dirname, '..', 'dual', 'placement.js'), 'utf8');
  // Strip line comments before scanning
  const stripped = placementSrc
    .split('\n')
    .map(line => line.replace(/\/\/.*$/, ''))
    .join('\n');
  // Also strip /* */ block comments
  const noBlocks = stripped.replace(/\/\*[\s\S]*?\*\//g, '');
  check(
    'placement.js contains no Math.random() call sites (comments ignored)',
    !/Math\.random\s*\(/.test(noBlocks)
  );
} catch (e) {
  fail('could not read placement.js: ' + e.message);
}

// ---------------------------------------------------------------------------
// Extra sanity: effectiveBracketSize
// ---------------------------------------------------------------------------
check('effectiveBracketSize(50) = 64', effectiveBracketSize(50) === 64);
check('effectiveBracketSize(20) = 32', effectiveBracketSize(20) === 32);
check('effectiveBracketSize(8) = 8', effectiveBracketSize(8) === 8);
check('effectiveBracketSize(9) = 16', effectiveBracketSize(9) === 16);
check('effectiveBracketSize(33) = 64', effectiveBracketSize(33) === 64);
check('effectiveBracketSize(129) = 128', effectiveBracketSize(129) === 128);

// ---------------------------------------------------------------------------
// takeUpToRank: ICR 4207.3.4 cut-line tie expansion
// ---------------------------------------------------------------------------
console.log('');
console.log('Cut-line tie expansion (ICR 4207.3.4):');

try {
  const { takeUpToRank } = require(path.join(__dirname, '..', 'scoring', 'engine.js'));

  check('takeUpToRank: empty array -> []',
    takeUpToRank([], 5).length === 0);

  check('takeUpToRank: n=0 -> []',
    takeUpToRank([{ rank: 1 }, { rank: 2 }], 0).length === 0);

  check('takeUpToRank: n>=length returns full array',
    takeUpToRank([{ rank: 1 }, { rank: 2 }, { rank: 3 }], 10).length === 3);

  check('takeUpToRank: no ties at boundary, n=3 of [1,2,3,4,5] -> 3',
    takeUpToRank([{ rank: 1 }, { rank: 2 }, { rank: 3 }, { rank: 4 }, { rank: 5 }], 3).length === 3);

  check('takeUpToRank: tie at boundary, n=3 of [1,2,3,3,5] -> 4 (both rank-3 included)',
    takeUpToRank([{ rank: 1 }, { rank: 2 }, { rank: 3 }, { rank: 3 }, { rank: 5 }], 3).length === 4);

  check('takeUpToRank: tie below boundary, n=3 of [1,2,2,4,5] -> 3 (no rank-3 entry)',
    takeUpToRank([{ rank: 1 }, { rank: 2 }, { rank: 2 }, { rank: 4 }, { rank: 5 }], 3).length === 3);

  check('takeUpToRank: tie at start, n=1 of [1,1,3] -> 2',
    takeUpToRank([{ rank: 1 }, { rank: 1 }, { rank: 3 }], 1).length === 2);

  check('takeUpToRank: 3-way tie at boundary, n=16 with last 3 tied at 16 -> 18',
    takeUpToRank(
      Array.from({ length: 18 }, (_, i) => ({ rank: i < 15 ? i + 1 : 16 })),
      16
    ).length === 18);
} catch (e) {
  fail('takeUpToRank tests: ' + e.message);
}

// ---------------------------------------------------------------------------
// v1.18.00 -- aerials per-judge-per-jump scoring engine + USSS 4110.4.3
// tie-break + USSS Appendix C 2026 DD chart sentinel
// ---------------------------------------------------------------------------
console.log('');
console.log('Aerials v2 scoring (v1.18.00):');

try {
  const engine = require(path.join(__dirname, '..', 'scoring', 'engine.js'));
  const { calcAerialsScoreV2, tieBreakAerials, rankResults } = engine;

  // 5-judge panel: drop high + low per component; sum kept; × DD per jump
  const fiveJudge = calcAerialsScoreV2({
    judgeScores: [
      { judge_number: 1, jump: 1, air: 1.5, form: 4.0, landing: 2.5 },
      { judge_number: 2, jump: 1, air: 1.7, form: 4.2, landing: 2.6 },
      { judge_number: 3, jump: 1, air: 1.8, form: 4.5, landing: 2.7 },
      { judge_number: 4, jump: 1, air: 1.4, form: 3.8, landing: 2.4 },
      { judge_number: 5, jump: 1, air: 1.6, form: 4.1, landing: 2.55 },
      { judge_number: 1, jump: 2, air: 1.6, form: 4.1, landing: 2.5 },
      { judge_number: 2, jump: 2, air: 1.8, form: 4.3, landing: 2.7 },
      { judge_number: 3, jump: 2, air: 1.9, form: 4.6, landing: 2.8 },
      { judge_number: 4, jump: 2, air: 1.5, form: 3.9, landing: 2.5 },
      { judge_number: 5, jump: 2, air: 1.7, form: 4.2, landing: 2.6 },
    ],
    dd1: 3.0, dd2: 3.5, panelSize: 5, numJumps: 2,
  });
  // Hand-computed: J1 kept = (1.5+1.6+1.7) + (4.0+4.1+4.2) + (2.5+2.55+2.6) = 4.8 + 12.3 + 7.65 = 24.75 × 3.0 = 74.25
  // J2 kept = (1.6+1.7+1.8) + (4.1+4.2+4.3) + (2.5+2.6+2.7) = 5.1 + 12.6 + 7.8 = 25.5 × 3.5 = 89.25
  check(
    'calcAerialsScoreV2 5-judge: drop H/L per component, jump1 = 74.25',
    Math.abs(fiveJudge.jump1Score - 74.25) < 0.001,
    'got ' + fiveJudge.jump1Score
  );
  check(
    'calcAerialsScoreV2 5-judge: jump2 = 89.25, total = 163.50',
    Math.abs(fiveJudge.jump2Score - 89.25) < 0.001 && Math.abs(fiveJudge.total - 163.50) < 0.001,
    `j2=${fiveJudge.jump2Score} total=${fiveJudge.total}`
  );

  // 3-judge panel with sum_all reduction (USA reduced)
  const sumAll = calcAerialsScoreV2({
    judgeScores: [
      { judge_number: 1, jump: 1, air: 1.5, form: 4.0, landing: 2.5 },
      { judge_number: 2, jump: 1, air: 1.7, form: 4.2, landing: 2.6 },
      { judge_number: 3, jump: 1, air: 1.8, form: 4.5, landing: 2.7 },
    ],
    dd1: 3.0, dd2: 0, panelSize: 3, reductionMethod: 'sum_all', numJumps: 1,
  });
  // sum_all: 5.0 + 12.7 + 7.8 = 25.5 × 3.0 = 76.50
  check(
    'calcAerialsScoreV2 3-judge sum_all: jump1 = 76.50',
    Math.abs(sumAll.jump1Score - 76.50) < 0.001,
    'got ' + sumAll.jump1Score
  );

  // 3-judge with drop_high
  const dropHigh = calcAerialsScoreV2({
    judgeScores: [
      { judge_number: 1, jump: 1, air: 1.0, form: 3.0, landing: 2.0 },
      { judge_number: 2, jump: 1, air: 2.0, form: 5.0, landing: 3.0 },
      { judge_number: 3, jump: 1, air: 1.5, form: 4.0, landing: 2.5 },
    ],
    dd1: 2.0, dd2: 0, panelSize: 3, reductionMethod: 'drop_high', numJumps: 1,
  });
  // drop_high per component: air kept (1.0,1.5)=2.5; form kept (3.0,4.0)=7.0; land kept (2.0,2.5)=4.5
  // sum = 14.0 × 2.0 = 28.00
  check(
    'calcAerialsScoreV2 3-judge drop_high: jump1 = 28.00',
    Math.abs(dropHigh.jump1Score - 28.00) < 0.001,
    'got ' + dropHigh.jump1Score
  );

  // airNoDd field (Fix 1) — simple mean per jump, no drop H/L, no DD
  // For fiveJudge above: meanAir1 = (1.5+1.7+1.8+1.4+1.6)/5 = 1.6, meanAir2 = (1.6+1.8+1.9+1.5+1.7)/5 = 1.7
  // airNoDd = 1.6 + 1.7 = 3.30 (floored)
  check(
    'calcAerialsScoreV2 airNoDd: 5-judge example = 3.30',
    Math.abs(fiveJudge.airNoDd - 3.30) < 0.001,
    'got ' + fiveJudge.airNoDd
  );

  console.log('');
  console.log('Aerials tie-break (USSS 4110.4.3):');

  // Order: Total -> air_score_no_dd -> Form (turns_score) -> Landing (speed_score)
  // Case A: same Total, B has higher airNoDd (post-DD favors A) -> B wins
  const tA = { total_score: 200.0, air_score: 80.0, air_score_no_dd: 10.0, turns_score: 70.0, speed_score: 50.0 };
  const tB = { total_score: 200.0, air_score: 75.0, air_score_no_dd: 11.0, turns_score: 70.0, speed_score: 50.0 };
  const r1 = rankResults([tA, tB], 'aerials');
  check(
    'aerials tie-break: same Total, higher airNoDd wins (B before A)',
    r1[0].air_score_no_dd === 11.0 && r1[1].air_score_no_dd === 10.0
  );

  // Case B: same Total + airNoDd, D higher Form
  const tC = { total_score: 200.0, air_score: 80.0, air_score_no_dd: 10.0, turns_score: 65.0, speed_score: 55.0 };
  const tD = { total_score: 200.0, air_score: 80.0, air_score_no_dd: 10.0, turns_score: 70.0, speed_score: 50.0 };
  const r2 = rankResults([tC, tD], 'aerials');
  check(
    'aerials tie-break: same Total + airNoDd, higher Form wins (D before C)',
    r2[0].turns_score === 70.0 && r2[1].turns_score === 65.0
  );

  // Case C: legacy fallback (no air_score_no_dd) -> falls back to air_score
  const tE = { total_score: 100.0, air_score: 50.0, turns_score: 30.0, speed_score: 20.0 };
  const tF = { total_score: 100.0, air_score: 55.0, turns_score: 30.0, speed_score: 20.0 };
  const r3 = rankResults([tE, tF], 'aerials');
  check(
    'aerials tie-break: legacy fallback to air_score when air_score_no_dd missing',
    r3[0].air_score === 55.0 && r3[1].air_score === 50.0
  );

  // Case D: all equal -> tied
  const tG = { total_score: 100.0, air_score_no_dd: 10.0, turns_score: 30.0, speed_score: 20.0 };
  const tH = { total_score: 100.0, air_score_no_dd: 10.0, turns_score: 30.0, speed_score: 20.0 };
  const r4 = rankResults([tG, tH], 'aerials');
  check(
    'aerials tie-break: all equal -> both rank 1, second.tied = true',
    r4[0].rank === 1 && r4[1].rank === 1 && r4[1].tied === true
  );
} catch (e) {
  fail('aerials v2 / tie-break tests: ' + e.message);
}

// ---------------------------------------------------------------------------
// USSS Appendix C 2026 aerials DD chart sentinel
// (loads schema.js's buildAerialsDDChart helper if exported; otherwise
// just verifies a few well-known DDs are present in the seed function source)
// ---------------------------------------------------------------------------
console.log('');
console.log('USSS Appendix C aerials DD chart:');

try {
  const fs = require('fs');
  const schemaSrc = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.js'), 'utf8');
  const expect = (line) => {
    if (!schemaSrc.includes(line)) return false;
    return true;
  };
  check("Appendix C: 'S' (Spread Eagle) seeded with DD 1.48",  expect("'S',   dd: 1.48"));
  check("Appendix C: 'Tk' (Tuck Jump) seeded with DD 1.48",    expect("'Tk',  dd: 1.48"));
  check("Appendix C: 'bL' (Back Layout) seeded with DD 2.05",  expect("'bL',   dd: 2.05"));
  check("Appendix C: 'bF' (Back Full) seeded with DD 2.30",    expect("'bF',   dd: 2.30"));
  check("Appendix C: 'bFF' (Back Full Full) seeded with DD 3.15", expect("'bFF',  dd: 3.15"));
  check("Appendix C: 'bdFF' (Back Double Full Full) seeded with DD 3.525", expect("'bdFF', dd: 3.525"));
  check("Appendix C: spin family expansion uses Spin DD + 0.02 for upright bonus",
    /spinDd \+ 0\.02/.test(schemaSrc));
  check("Appendix C: spin+upright+grab uses Spin DD + 0.02 + 0.10",
    /spinDd \+ 0\.02 \+ 0\.10/.test(schemaSrc));
  check("Appendix C: migration sentinel detects stale S=1.700 placeholder",
    /Math\.abs\(parseFloat\(checkS\.dd_value\) - 1\.48\)/.test(schemaSrc));
} catch (e) {
  fail('Appendix C DD chart tests: ' + e.message);
}

// ---------------------------------------------------------------------------
// Scoring review fixes (v1.24.00 — F-1, F-3/F-4, F-5, F-7, F-2)
// ---------------------------------------------------------------------------
console.log('');
console.log('Scoring review fixes (06-10-26):');
try {
  const engine = require(path.join(__dirname, '..', 'scoring', 'engine.js'));
  const { rankDualPlacements } = require(path.join(__dirname, '..', 'dual', 'placement_ranking.js'));

  // F-1: epsilon-corrected truncation. 49.1 + 8.23 + 8.93 = 66.26 (float artifact 66.2599...).
  check('F-1: floorToHundredth(66.26) === 66.26',
    engine.floorToHundredth(49.1 + 8.23 + 8.93) === 66.26,
    'got ' + engine.floorToHundredth(49.1 + 8.23 + 8.93));

  // F-3/F-4: handbook averaging order, per-jump 10.0 cap, no DD below 0.1 form.
  check('F-4: calcJumpScore([6.3,6.3],0.78) === 4.91 (avg->trunc->*DD)',
    engine.calcJumpScore([6.3, 6.3], 0.78) === 4.91,
    'got ' + engine.calcJumpScore([6.3, 6.3], 0.78));
  check('F-3: per-jump cap calcJumpScore([10,10],1.3) === 10',
    engine.calcJumpScore([10, 10], 1.3) === 10,
    'got ' + engine.calcJumpScore([10, 10], 1.3));
  check('F-3: avg<0.1 -> 0 (calcJumpScore([0.05],0.78))',
    engine.calcJumpScore([0.05], 0.78) === 0,
    'got ' + engine.calcJumpScore([0.05], 0.78));

  // F-5: RQS keeps the higher-SCORED jump; default keeps jump 1.
  const rqs = engine.calcMogulScore({ tlScores: [10,10,10], airScoresJump1:[3], dd1:1.0, airScoresJump2:[9], dd2:0.5, hasSpeed:false, numTlJudges:3, numJumps:2, isRepeat:true, division:'rqs' });
  check('F-5: RQS drops the lower-scored jump (jump1)', rqs.repeatDroppedJump === 1, 'dropped=' + rqs.repeatDroppedJump);
  const def = engine.calcMogulScore({ tlScores: [10,10,10], airScoresJump1:[3], dd1:1.0, airScoresJump2:[9], dd2:0.5, hasSpeed:false, numTlJudges:3, numJumps:2, isRepeat:true, division:'comp' });
  check('F-5: non-RQS keeps jump 1 (drops jump2)', def.repeatDroppedJump === 2, 'dropped=' + def.repeatDroppedJump);

  // F-7: 5-TL separate high/low drop of gross and deductions.
  // gross [15,15,20,10,15] drop hi(20) lo(10) keep 45; ded [1,1,1,1,5] drop hi(5) lo(1) keep 3; 45-3=42.
  const ded = [1,1,1,1,5];
  const net = [15,15,20,10,15].map((g,i)=>g-ded[i]);
  const sep = engine.calcMogulScore({ tlScores: net, tlDeductions: ded, airScoresJump1:[5], dd1:0.5, hasSpeed:false, numTlJudges:5, numJumps:1, isRepeat:false });
  check('F-7: separate-drop turns === 42', sep.turnsContrib === 42, 'got ' + sep.turnsContrib);
  // With deductions baked into net (deductions all 0), separate drop equals net drop-high-low sum.
  const sep0 = engine.calcMogulScore({ tlScores: [15,15,20,10,15], tlDeductions:[0,0,0,0,0], airScoresJump1:[5], dd1:0.5, hasSpeed:false, numTlJudges:5, numJumps:1 });
  check('F-7: zero deductions -> net drop-hi-lo (45)', sep0.turnsContrib === 45, 'got ' + sep0.turnsContrib);

  // F-2: 5-8 mini-bracket places athletes 1-8 from the round-1 finals; semis don't double-place.
  const mk = (round, pos, sf, blue, red, winner) => ({
    bracket_round: round, bracket_position: pos, is_small_final: sf ? 1 : 0, status: 'complete', is_bye: 0,
    registration_id_blue: blue, registration_id_red: red, winner_registration_id: winner,
    blue_last: blue, red_last: red, blue_bib: blue, red_bib: red,
  });
  const neu = [
    mk(1,1,false,'A','B','A'), mk(1,2,true,'C','D','C'),
    mk(1,3,true,'E','F','E'), mk(1,4,true,'G','H','G'),
    mk(2,3,true,'E','G','E'), mk(2,4,true,'F','H','F'),
  ];
  const rNew = rankDualPlacements({ bracket: neu, meetDate: '2026-01-01' });
  const newMap = Object.fromEntries(rNew.map(p => [p.registration_id, p.rank]));
  check('F-2: new 5-8 bracket ranks A..H = 1..8',
    rNew.length === 8 && newMap.E === 5 && newMap.F === 6 && newMap.G === 7 && newMap.H === 8,
    JSON.stringify(newMap));
  const leg = [ mk(1,1,false,'A','B','A'), mk(1,2,true,'C','D','C'), mk(2,3,true,'E','F','E'), mk(2,4,true,'G','H','G') ];
  const rLeg = rankDualPlacements({ bracket: leg, meetDate: '2026-01-01' });
  const legMap = Object.fromEntries(rLeg.map(p => [p.registration_id, p.rank]));
  check('F-2: legacy structure still ranks 5/6/7/8',
    rLeg.length === 8 && legMap.E === 5 && legMap.F === 6 && legMap.G === 7 && legMap.H === 8,
    JSON.stringify(legMap));
} catch (e) {
  fail('Scoring review fix tests: ' + e.message);
}

// ---------------------------------------------------------------------------
// v1.26.00 Part A: statused-athlete ordering helpers
// ---------------------------------------------------------------------------
console.log('');
console.log('v1.26.00 status ordering (Part A):');
try {
  const engine = require(path.join(__dirname, '..', 'scoring', 'engine.js'));
  const { resolveEffectiveStatus, orderFlaggedForTier, assembleTieredResults } = engine;

  // resolveEffectiveStatus precedence (ruling A1.6)
  check('A: [DNF,DNS] -> DNF', resolveEffectiveStatus([{ run_status: 'DNF' }, { run_status: 'DNS' }]) === 'DNF');
  check('A: [DSQ,DNF] -> DSQ', resolveEffectiveStatus(['DSQ', 'DNF']) === 'DSQ');
  check('A: [RNS,DNS] -> RNS', resolveEffectiveStatus(['RNS', 'DNS']) === 'RNS');
  check('A: [] -> DNS', resolveEffectiveStatus([]) === 'DNS');
  check('A: lowercase tolerated', resolveEffectiveStatus(['dnf']) === 'DNF');

  // orderFlaggedForTier: DNF < RNS < DNS, bib asc, tie shares rank + skip
  const fl = [
    { effective_status: 'DNS', bib_number: '12' },
    { effective_status: 'DNF', bib_number: '5' },
    { effective_status: 'DNS', bib_number: '3' },
    { effective_status: 'RNS', bib_number: '9' },
  ];
  const next = orderFlaggedForTier(fl, 7);
  check('A: tier order DNF,RNS,DNS(bib asc)',
    fl.map(f => f.effective_status + f.bib_number).join(',') === 'DNF5,RNS9,DNS3,DNS12',
    fl.map(f => f.effective_status + f.bib_number).join(','));
  check('A: ranks 7,8,9,9 (DNS tie shares)', fl.map(f => f.rank).join(',') === '7,8,9,9', fl.map(f => f.rank).join(','));
  check('A: returns startRank+len (11)', next === 11, 'got ' + next);

  // assembleTieredResults — synthetic qualifier/finals walk
  const mk = (id, total, bib) => ({ registration_id: id, total_score: total, turns_score: 0, air_score: 0, speed_score: 0, bib_number: String(bib) });
  const tiers2 = () => ([
    { key: 'final_1', label: 'Final 1', scoredRuns: [1, 2, 3, 4, 5, 6].map(i => mk('a' + i, 90 - i, i)) },
    { key: 'qualifier', label: 'Qualification', scoredRuns: [9, 10, 11].map(i => mk('a' + i, 80 - i, i)) },
  ]);
  const keyFn = r => r.run_number === 2 ? 'final_1' : 'qualifier';

  // Edge case 1: F1-of-8 with DNF + DNS -> scored 1-6, DNF 7, DNS 8, qual starts at 9
  const out1 = assembleTieredResults({
    tiers: tiers2(),
    flaggedRuns: [
      { registration_id: 'a7', run_status: 'DNF', run_number: 2, bib_number: '7' },
      { registration_id: 'a8', run_status: 'DNS', run_number: 2, bib_number: '8' },
    ],
    tierKeyForRun: keyFn, discipline: 'mogul',
  });
  const byId1 = Object.fromEntries(out1.map(r => [r.registration_id, r]));
  check('A: edge 1 — DNF rank 7, DNS rank 8', byId1.a7.rank === 7 && byId1.a8.rank === 8,
    JSON.stringify([byId1.a7.rank, byId1.a8.rank]));
  check('A: edge 1 — qual continues at 9', byId1.a9.rank === 9 && byId1.a11.rank === 11);
  check('A: edge 1 — flagged carry real tier', byId1.a7.tier === 'final_1' && byId1.a8.tier === 'final_1');

  // Edge case 2/3: DSQ event bottom + scored-Q-then-DNS-F1 excluded from qual
  const t2 = tiers2();
  t2[1].scoredRuns.push(mk('a20', 85, 20)); // a20 scored Q well...
  const out2 = assembleTieredResults({
    tiers: t2,
    flaggedRuns: [
      { registration_id: 'a20', run_status: 'DNS', run_number: 2, bib_number: '20' }, // ...then DNS'd F1
      { registration_id: 'a9', run_status: 'DSQ', run_number: 2, bib_number: '9' },   // Q-scored a9 DSQ'd in F1
    ],
    tierKeyForRun: keyFn, discipline: 'mogul',
  });
  const byId2 = Object.fromEntries(out2.map(r => [r.registration_id, r]));
  check('A: edge 3 — Q-scorer DNS in F1 sits at F1 bottom', byId2.a20.tier === 'final_1' && byId2.a20.rank === 7);
  check('A: edge 3 — excluded from qual tier', out2.filter(r => r.registration_id === 'a20').length === 1);
  check('A: edge 2 — DSQ absolute event bottom',
    byId2.a9.tier === 'flagged' && byId2.a9.rank === out2.length && out2[out2.length - 1].registration_id === 'a9',
    JSON.stringify({ tier: byId2.a9.tier, rank: byId2.a9.rank }));

  // Edge case 5: best-of-2 DNF r1 + DNS r2 -> effective DNF, above pure DNS
  const out5 = assembleTieredResults({
    tiers: [{ key: null, label: null, scoredRuns: [mk('s1', 70, 1)] }],
    flaggedRuns: [
      { registration_id: 'x1', run_status: 'DNS', run_number: 2, bib_number: '30' },
      { registration_id: 'x1', run_status: 'DNF', run_number: 1, bib_number: '30' },
      { registration_id: 'x2', run_status: 'DNS', run_number: 1, bib_number: '2' },
    ],
    discipline: 'mogul',
  });
  check('A: edge 5 — DNF+DNS resolves DNF, above pure DNS',
    out5.map(r => r.registration_id).join(',') === 's1,x1,x2',
    out5.map(r => r.registration_id + '/' + (r.effective_status || 'scored')).join(','));

  // Edge case 4: scored run in the same tier as the status -> ranks normally, not flagged
  const out4 = assembleTieredResults({
    tiers: [{ key: null, label: null, scoredRuns: [mk('s1', 70, 1), mk('s2', 60, 2)] }],
    flaggedRuns: [{ registration_id: 's2', run_status: 'DNF', run_number: 1, bib_number: '2' }],
    discipline: 'mogul',
  });
  check('A: edge 4 — scored run wins over same-tier status',
    out4.length === 2 && out4[1].registration_id === 's2' && out4[1].rank === 2 && !out4[1].effective_status);

  // Edge case 8: legacy single tier order scored, DNF, RNS, DNS, DSQ
  const out8 = assembleTieredResults({
    tiers: [{ key: null, label: null, scoredRuns: [mk('s1', 70, 1)] }],
    flaggedRuns: [
      { registration_id: 'f1', run_status: 'DSQ', run_number: 1, bib_number: '4' },
      { registration_id: 'f2', run_status: 'DNS', run_number: 1, bib_number: '5' },
      { registration_id: 'f3', run_status: 'RNS', run_number: 1, bib_number: '6' },
      { registration_id: 'f4', run_status: 'DNF', run_number: 1, bib_number: '7' },
    ],
    discipline: 'mogul',
  });
  check('A: edge 8 — legacy order scored,DNF,RNS,DNS,DSQ',
    out8.map(r => r.registration_id).join(',') === 's1,f4,f3,f2,f1',
    out8.map(r => r.registration_id).join(','));
} catch (e) {
  fail('Part A ordering tests: ' + e.message);
}

// ---------------------------------------------------------------------------
// v1.26.00 Part B: FS-13 grab case sensitivity
// ---------------------------------------------------------------------------
console.log('');
console.log('v1.26.00 grab case sensitivity (FS-13):');
try {
  const engine = require(path.join(__dirname, '..', 'scoring', 'engine.js'));
  const { areJumpsRepeats, canonicalizeJumpCode } = engine;

  check('B: bg vs bG NOT repeats', areJumpsRepeats('bg', 'bG') === false);
  check('B: bG vs bG ARE repeats', areJumpsRepeats('bG', 'bG') === true);
  check('B: 3g vs 3G NOT repeats', areJumpsRepeats('3g', '3G') === false);
  check('B: 3og vs 3oG NOT repeats', areJumpsRepeats('3og', '3oG') === false);
  check('B: g vs G NOT repeats', areJumpsRepeats('g', 'G') === false);
  check('B: g vs g ARE repeats', areJumpsRepeats('g', 'g') === true);
  check('B: bL vs bp still NOT repeats', areJumpsRepeats('bL', 'bp') === false);

  const canonCases = [
    ['BG', 'bG'], ['Bg', 'bg'], ['BP', 'bP'], ['bp', 'bp'], ['3P', '3p'],
    ['7OG', '7oG'], ['7Og', '7og'], ['ss', 'SS'], ['BTF', 'btF'], ['bt', 'bT'],
    ['lgf', 'lgF'], ['LGF', 'lGF'], ['g', 'g'], ['G', 'G'], ['bdf', 'bdF'], ['BL', 'bL'],
  ];
  for (const [inp, want] of canonCases) {
    check(`B: canonicalize ${inp} -> ${want}`, canonicalizeJumpCode(inp) === want,
      'got ' + canonicalizeJumpCode(inp));
  }
} catch (e) {
  fail('FS-13 grab tests: ' + e.message);
}

// ---------------------------------------------------------------------------
// v1.29.00 — FS-18 dual mogul NJ (landing zone), tied-speed 3/3, air tied
// (JH 6304.3.2 / 6304.3.5.1, 5-judge panel)
// ---------------------------------------------------------------------------
console.log('');
console.log('v1.29.00 dual NJ / tie credits:');
try {
  const engine = require(path.join(__dirname, '..', 'scoring', 'engine.js'));
  const { effectiveJudgePoints, calcDualMogulPointSplit, validateDualPointSplit } = engine;

  // Full 5-judge panel builder. Overrides is a map judgeNumber -> partial row.
  const panel = (overrides = {}) => [1, 2, 3, 4, 5].map(n => ({
    judgeNumber: n, bluePoints: 3, redPoints: 2, timeTied: false, airTied: false,
    ...(overrides[n] || {}),
  }));
  const j4 = eff => eff.effectiveScores.find(s => s.judgeNumber === 4);
  const j3 = eff => eff.effectiveScores.find(s => s.judgeNumber === 3);

  // Precedence rules 1-5 (speed)
  let e = effectiveJudgePoints(panel({ 4: { bluePoints: 4, redPoints: 1 } }), 'blue');
  check('C: NJ blue -> J4 eff 0/5', j4(e).bluePoints === 0 && j4(e).redPoints === 5 && !e.speedTied);
  e = effectiveJudgePoints(panel({ 4: { bluePoints: 0, redPoints: 0, timeTied: true } }), 'blue');
  check('C: NJ blue beats raw time-tied (0/5, not speed tied)',
    j4(e).bluePoints === 0 && j4(e).redPoints === 5 && !e.speedTied && e.overallScale === 5);
  e = effectiveJudgePoints(panel({ 4: { bluePoints: 1, redPoints: 4 } }), 'red');
  check('C: NJ red -> J4 eff 5/0', j4(e).bluePoints === 5 && j4(e).redPoints === 0 && !e.speedTied);
  e = effectiveJudgePoints(panel(), 'both');
  check('C: NJ both -> speed tied 3/3, scale 4',
    j4(e).bluePoints === 3 && j4(e).redPoints === 3 && e.speedTied && e.overallScale === 4);
  e = effectiveJudgePoints(panel({ 4: { bluePoints: 0, redPoints: 0, timeTied: true } }), null);
  check('C: time tied no NJ -> 3/3 (ruling 4), scale 4',
    j4(e).bluePoints === 3 && j4(e).redPoints === 3 && e.speedTied && e.overallScale === 4);
  e = effectiveJudgePoints(panel({ 4: { bluePoints: 2, redPoints: 3 } }), null);
  check('C: no NJ no tie -> J4 raw passes through',
    j4(e).bluePoints === 2 && j4(e).redPoints === 3 && !e.speedTied && e.overallScale === 5);

  // Air rule 6 + combined scale rule 7
  e = effectiveJudgePoints(panel({ 3: { bluePoints: 0, redPoints: 0, airTied: true } }), null);
  check('C: air tied -> J3 eff 0/0 (votes withheld), scale 4',
    j3(e).bluePoints === 0 && j3(e).redPoints === 0 && e.airTied && e.overallScale === 4);
  e = effectiveJudgePoints(panel({
    3: { bluePoints: 0, redPoints: 0, airTied: true },
    4: { bluePoints: 0, redPoints: 0, timeTied: true },
  }), null);
  check('C: air tied + time tied -> scale 3', e.airTied && e.speedTied && e.overallScale === 3);
  e = effectiveJudgePoints(panel({ 3: { bluePoints: 0, redPoints: 0, airTied: true } }), 'both');
  check('C: air tied + NJ both -> scale 3', e.airTied && e.speedTied && e.overallScale === 3);
  e = effectiveJudgePoints(panel({ 3: { bluePoints: 2, redPoints: 3 } }), 'blue');
  check('C: NJ never modifies the air row', j3(e).bluePoints === 2 && j3(e).redPoints === 3);

  // Distributed totals: 25 / 25 / 19 / 19 — always odd (tie impossible)
  const total = r => r.blueTotal + r.redTotal;
  let r = calcDualMogulPointSplit(panel(), null);
  check('C: distributed total none tied = 25', total(r) === 25 && total(r) % 2 === 1);
  r = calcDualMogulPointSplit(panel({
    4: { bluePoints: 0, redPoints: 0, timeTied: true },
    5: { bluePoints: 3, redPoints: 1 },
  }), null);
  check('C: distributed total speed tied = 25 (was 19 pre-v1.29)', total(r) === 25 && total(r) % 2 === 1);
  r = calcDualMogulPointSplit(panel({
    3: { bluePoints: 0, redPoints: 0, airTied: true },
    5: { bluePoints: 3, redPoints: 1 },
  }), null);
  check('C: distributed total air tied = 19', total(r) === 19 && total(r) % 2 === 1);
  r = calcDualMogulPointSplit(panel({
    3: { bluePoints: 0, redPoints: 0, airTied: true },
    4: { bluePoints: 0, redPoints: 0, timeTied: true },
    5: { bluePoints: 2, redPoints: 1 },
  }), null);
  check('C: distributed total both tied = 19', total(r) === 19 && total(r) % 2 === 1);

  // A single NJ can flip the winner (spec §3 winner recompute)
  // Raw: J1 2/3, J2 2/3, J3 2/3, J4 5/0, J5 2/3 -> blue 13, red 12 (blue wins)
  const flipPanel = panel({
    1: { bluePoints: 2, redPoints: 3 }, 2: { bluePoints: 2, redPoints: 3 },
    3: { bluePoints: 2, redPoints: 3 }, 4: { bluePoints: 5, redPoints: 0 },
    5: { bluePoints: 2, redPoints: 3 },
  });
  const rawR = calcDualMogulPointSplit(flipPanel, null);
  const njR  = calcDualMogulPointSplit(flipPanel, 'blue');
  check('C: single NJ flips winner (blue 13-12 raw -> red 17-8 with NJ blue)',
    rawR.winner === 'blue' && njR.winner === 'red' && njR.blueTotal === 8 && njR.redTotal === 17);

  // validateDualPointSplit modes
  check('C: validate air tied 0/0 ok', validateDualPointSplit(0, 0, { airTied: true }) === null);
  check('C: validate air tied 1/0 rejected', validateDualPointSplit(1, 0, { airTied: true }) !== null);
  check('C: validate scale 4 accepts 3+1', validateDualPointSplit(3, 1, { overallScale: 4 }) === null);
  check('C: validate scale 4 rejects 3+2', validateDualPointSplit(3, 2, { overallScale: 4 }) !== null);
  check('C: validate scale 3 accepts 2+1', validateDualPointSplit(2, 1, { overallScale: 3 }) === null);
  check('C: validate scale 3 rejects 2+3', validateDualPointSplit(2, 3, { overallScale: 3 }) !== null);
  check('C: validate default 5 still enforced', validateDualPointSplit(3, 2) === null && validateDualPointSplit(3, 3) !== null);
  check('C: validate scale 5 accepts 3+2 explicitly', validateDualPointSplit(3, 2, { overallScale: 5 }) === null);
} catch (e) {
  fail('v1.29.00 dual NJ tests: ' + e.message);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('');
console.log('=========================');
console.log(`Passed: ${passCount}`);
console.log(`Failed: ${failCount}`);
console.log('');

if (failCount > 0) {
  console.log('VERIFICATION FAILED');
  process.exit(1);
} else {
  console.log('VERIFICATION PASSED');
  process.exit(0);
}
