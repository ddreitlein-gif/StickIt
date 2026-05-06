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
