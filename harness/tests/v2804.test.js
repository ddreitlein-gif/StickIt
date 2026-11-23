/**
 * v2.8.04 — FIS "Mogul Basic Degree of Difficulty and Common Combinations,
 * As of 07.11.26" (Release B of the 11-23-26 plan).
 *
 *   A. REAL OLD DATABASE. A database built and scored by the real v2.7.00
 *      server (git tag v2.7.00, the worktree at harness/.v270baseline — its DD
 *      table is the pre-update one), with a finalized run on bF + bdF, is then
 *      served by THIS tree. The boot migration must change exactly bF, fF,
 *      bdF, btF (mogul + dual, men + women) and add fdF, ftF — nothing else,
 *      no aerials row — and must not run again on the next boot. The scored
 *      run keeps the DD it was scored with.
 *   B. THE WHOLE CHART. All 75 codes after migration against a table
 *      transcribed independently from the FIS chart (uprights by the chart
 *      formula), mogul and dual (x 1.25), men and women.
 *   C. THE TWO GATES separately (updates on bF = 0.88, inserts on a missing
 *      fdF), a fresh database, and a venue-mode boot.
 *   D. Voice phrases and code canonicalization for the new codes.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const { Checks } = require('../lib/checks');
const { Instance, scratchDir, REPO_ROOT, SERVER_DIR } = require('../lib/instance');
const { Api } = require('../lib/client');
const { openDb } = require('../lib/db');
const { seedMogulJudges } = require('../lib/driver');
const engine = require(path.join(SERVER_DIR, 'scoring', 'engine.js'));

const BASELINE_TAG = 'v2.7.00';
const BASE_DIR = path.join(REPO_ROOT, 'harness', '.v270baseline');

function ensureBaseline() {
  if (!fs.existsSync(path.join(BASE_DIR, 'server', 'index.js'))) {
    execFileSync('git', ['worktree', 'add', '--force', BASE_DIR, BASELINE_TAG], { cwd: REPO_ROOT });
  }
  const nm = path.join(BASE_DIR, 'server', 'node_modules');
  if (!fs.existsSync(nm)) fs.symlinkSync(path.join(SERVER_DIR, 'node_modules'), nm, 'dir');
  const v = fs.readFileSync(path.join(BASE_DIR, 'server', 'version.js'), 'utf8');
  if (!v.includes('2.7.00')) throw new Error('baseline worktree is not v2.7.00');
}

// ── The FIS chart, As of 07.11.26, transcribed from the PDF (men; women are
//    +0.10 on every jump, the same on the multipliers) ──────────────────────
const BASE = { 1: 0.40, 2: 0.53, 3: 0.65, 4: 0.76, 5: 0.86 };
const MOD = { T: -0.02, S: -0.02, D: 0.01, X: 0.01, Y: 0.01, M: 0.01, K: 0.01, Z: 0 };
const UPRIGHTS = ['S', 'T', 'D', 'X', 'Y', 'M', 'K', 'Z', 'SS', 'TS', 'TT', 'TD', 'ST', 'DD', 'DTS', 'TST', 'TTS', 'STS', 'TTT', 'TTSS', 'TTSSD'];
const CHART_MEN = {
  '3': 0.68, '3p': 0.71, '3g': 0.73, '3G': 0.80, '7': 0.85, '7p': 0.88, '7g': 0.92, '7G': 0.99,
  '10': 1.02, '10p': 1.05, '10g': 1.11, '10G': 1.18,
  bT: 0.68, bP: 0.68, bL: 0.71, bp: 0.71, bg: 0.73, bG: 0.80, bF: 0.90, bdF: 1.09, btF: 1.28,
  fT: 0.68, fP: 0.68, fp: 0.71, fg: 0.73, fG: 0.80, fF: 0.90, fdF: 1.09, ftF: 1.28,
  '3op': 0.71, '3og': 0.73, '3oG': 0.80, '7op': 0.88, '7og': 0.92, '7oG': 0.99,
  '10op': 1.05, '10og': 1.11, '10oG': 1.18, '14op': 1.22, '14og': 1.30, '14oG': 1.37,
  l: 0.68, lp: 0.71, lg: 0.73, lG: 0.80, lF: 0.85, lpF: 0.88, lgF: 0.92, lGF: 0.99,
};
// Not on the FIS chart as jumps (unchanged StickIt codes): [men, women]
const NOT_ON_CHART = { p: [0.03, 0.03], N: [0.36, 0.46], NJ: [0, 0], G: [0.52, 0.62], g: [0.45, 0.55] };
const r2 = (x) => Math.round(x * 100) / 100;
function expectedChart() {
  const out = {};
  for (const u of UPRIGHTS) {
    const m = r2(BASE[u.length] + [...u].reduce((a, ch) => a + MOD[ch], 0));
    out[u] = [m, r2(m + 0.10)];
  }
  for (const [code, m] of Object.entries(CHART_MEN)) out[code] = [m, r2(m + 0.10)];
  for (const [code, mw] of Object.entries(NOT_ON_CHART)) out[code] = mw;
  return out;
}
const dual = (x) => Math.round(x * 1.25 * 10000) / 10000;
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-9;

const SIX = ['bF', 'fF', 'bdF', 'btF', 'fdF', 'ftF'];
const tableOf = async (dbPath) => {
  const db = openDb(dbPath);
  const rows = await db.queryAll('SELECT id, jump_code, dd_value, ruleset, discipline, gender, notes FROM jump_dd_table ORDER BY id');
  db.close();
  return rows;
};
const keyOf = (r) => `${r.discipline}|${r.gender ?? ''}|${r.jump_code}`;
const MIGRATION_LINE = 'DD migration: FIS 07.11.26 chart';

async function scoreRun(api, evId, judges, regId, codes) {
  const run = await api.must('POST', `/api/events/${evId}/runs`, { registration_id: regId, run_number: 1 });
  const S = `/api/events/${evId}/runs/${run.id}`;
  await api.must('PUT', S, { jump1_code: codes[0], jump2_code: codes[1] });
  for (const [i, role] of ['TL1', 'TL2', 'TL3'].entries()) {
    await api.must('POST', `${S}/scores`, { judge_id: judges[role].id, score_type: 'turns', raw_score: 14.0 + i * 0.2, carving: 7.5, abext: 3.5, upper_body: 3.2, deduction: 0.2 - i * 0.2 > 0 ? 0.2 - i * 0.2 : 0 });
  }
  for (const [i, role] of ['Air1', 'Air2'].entries()) {
    await api.must('POST', `${S}/scores`, { judge_id: judges[role].id, score_type: 'air_jump1', raw_score: 7.0 + i * 0.4 });
    await api.must('POST', `${S}/scores`, { judge_id: judges[role].id, score_type: 'air_jump2', raw_score: 6.5 + i * 0.4 });
  }
  await api.must('PUT', S, { run_time: 24.31 });
  await api.must('POST', `${S}/approve`, {});
  return run.id;
}
const runRow = async (dbPath, runId) => {
  const db = openDb(dbPath);
  const r = await db.queryOne('SELECT jump1_code, jump1_dd, jump2_code, jump2_dd, air_score, total_score, status FROM runs WHERE id=?', [runId]);
  db.close();
  return r;
};

async function main() {
  const c = new Checks('v2804');
  const dir = scratchDir('v2804');
  const dbPath = path.join(dir, 'old.db');
  ensureBaseline();
  const before = new Instance({ name: 'v2804-v270', port: 3421, dbPath, serverDir: path.join(BASE_DIR, 'server') });
  const after = new Instance({ name: 'v2804-now', port: 3422, dbPath });
  const fresh = new Instance({ name: 'v2804-fresh', port: 3423 });
  const venue = new Instance({ name: 'v2804-venue', port: 3424, mode: 'venue' });
  try {
    // =====================================================================
    // A. A real v2.7.00 database, a run finalized on the old DDs
    // =====================================================================
    await before.start();
    let api = new Api(before.base);
    const meet = await api.must('POST', '/api/meets', { name: 'DD Old', location: 'X', date: '2026-11-20', meet_ranking: 'C' });
    const ev = await api.must('POST', `/api/meets/${meet.id}/events`, { discipline: 'mogul', division: 'comp_series', gender: 'M', name: 'DD M' });
    const judges = await seedMogulJudges(api, ev.id);
    const regs = [];
    for (const [i, n] of ['Abel', 'Boone'].entries()) {
      const a = await api.must('POST', '/api/athletes', { first_name: n, last_name: 'Fullson', gender: 'M', birth_year: 2007, ussa_num: String(8894100 + i) });
      regs.push(await api.must('POST', `/api/events/${ev.id}/registrations`, { athlete_id: a.id, bib_number: 11 + i }));
    }
    const oldRunId = await scoreRun(api, ev.id, judges, regs[0].id, ['bF', 'bdF']);
    const resultsBefore = JSON.stringify(await api.must('GET', `/api/events/${ev.id}/results`));
    await before.stop();
    const t0 = await tableOf(dbPath);
    const run0 = await runRow(dbPath, oldRunId);
    c.ok(near(run0.jump1_dd, 0.88) && near(run0.jump2_dd, 1.05) && run0.status === 'complete',
      `A: the v2.7.00 server finalized a run on bF 0.88 + bdF 1.05 (stored ${run0.jump1_dd} / ${run0.jump2_dd}, air ${run0.air_score})`);
    c.eq(t0.filter(r => ['fdF', 'ftF'].includes(r.jump_code) && r.discipline !== 'aerials').length, 0, 'A: the old table has no fdF / ftF');

    await after.start();
    c.ok(after.log.some(l => l.includes(`${MIGRATION_LINE} — bF / fF / bdF / btF re-valued; fdF / ftF added`)), 'A: this tree logs the migration on first boot');
    const t1 = await tableOf(dbPath);
    const byId0 = new Map(t0.map(r => [r.id, r]));
    const changed = t1.filter(r => byId0.has(r.id) && JSON.stringify(byId0.get(r.id)) !== JSON.stringify(r));
    const added = t1.filter(r => !byId0.has(r.id));
    const removed = t0.filter(r => !t1.some(x => x.id === r.id));
    c.eq(removed.length, 0, 'A: no row removed');
    c.deepEq([...new Set(changed.map(r => r.jump_code))].sort(), ['bF', 'bdF', 'btF', 'fF'], 'A: only bF, fF, bdF, btF were re-valued');
    c.eq(changed.length, 16, 'A: 16 rows re-valued (4 codes x mogul / dual x men / women)');
    c.ok(changed.every(r => ['mogul', 'dual_mogul'].includes(r.discipline) && ['M', 'F'].includes(r.gender)), 'A: every re-valued row is a mogul or dual mogul row with a gender');
    c.ok(changed.every(r => { const o = byId0.get(r.id); return o.jump_code === r.jump_code && o.discipline === r.discipline && o.gender === r.gender && o.notes === r.notes && o.ruleset === r.ruleset; }), 'A: only dd_value changed on those rows');
    c.deepEq([...new Set(added.map(r => r.jump_code))].sort(), ['fdF', 'ftF'], 'A: only fdF and ftF were added');
    c.eq(added.length, 8, 'A: 8 rows added (2 codes x mogul / dual x men / women)');
    c.deepEq(added.map(keyOf).sort(), ['fdF', 'ftF'].flatMap(code => ['mogul', 'dual_mogul'].flatMap(d => ['M', 'F'].map(g => `${d}|${g}|${code}`))).sort(), 'A: one new row per code, discipline and gender');
    const aer0 = JSON.stringify(t0.filter(r => r.discipline === 'aerials'));
    const aer1 = JSON.stringify(t1.filter(r => r.discipline === 'aerials'));
    c.ok(aer0 === aer1 && t0.filter(r => r.discipline === 'aerials').length > 50, `A: all ${t0.filter(r => r.discipline === 'aerials').length} aerials rows are byte-identical`);
    const aerBF = t1.find(r => r.discipline === 'aerials' && r.jump_code === 'bF');
    const aerBdF = t1.find(r => r.discipline === 'aerials' && r.jump_code === 'bdF');
    c.ok(aerBF && near(aerBF.dd_value, 2.30), `A: aerials bF still reads 2.30 (${aerBF && aerBF.dd_value})`);
    c.ok(aerBdF && near(aerBdF.dd_value, 2.40), `A: aerials bdF still reads 2.40 (${aerBdF && aerBdF.dd_value})`);

    // the six codes, four tables
    api = new Api(after.base);
    const WANT = { bF: [0.90, 1.00], fF: [0.90, 1.00], bdF: [1.09, 1.19], fdF: [1.09, 1.19], btF: [1.28, 1.38], ftF: [1.28, 1.38] };
    const DUAL_WANT = { bF: [1.125, 1.25], fF: [1.125, 1.25], bdF: [1.3625, 1.4875], fdF: [1.3625, 1.4875], btF: [1.6, 1.725], ftF: [1.6, 1.725] };
    const apiTable = {};
    for (const d of ['mogul', 'dual_mogul']) for (const [gi, g] of ['M', 'F'].entries()) {
      const rows = await api.must('GET', `/api/jump-dds?discipline=${d}&gender=${g}`);
      apiTable[`${d}|${g}`] = rows;
      const want = d === 'mogul' ? WANT : DUAL_WANT;
      const got = SIX.map(code => { const hit = rows.filter(r => r.jump_code === code); return hit.length === 1 ? hit[0].dd_value : `x${hit.length}`; });
      c.ok(SIX.every((code, i) => near(got[i], want[code][gi])), `A: ${d} ${g === 'M' ? 'men' : 'women'} — bF ${got[0]}, fF ${got[1]}, bdF ${got[2]}, btF ${got[3]}, fdF ${got[4]}, ftF ${got[5]}`);
    }

    // the scored run is untouched; a new run takes the new values
    const run1 = await runRow(dbPath, oldRunId);
    c.deepEq(run1, run0, 'A: the run scored before the update keeps its stored DDs, air score and total');
    c.eq(JSON.stringify(await api.must('GET', `/api/events/${ev.id}/results`)), resultsBefore, 'A: the event results response is byte-identical after the migration');
    const newRunId = await scoreRun(api, ev.id, judges, regs[1].id, ['bF', 'fdF']);
    const run2 = await runRow(dbPath, newRunId);
    c.ok(near(run2.jump1_dd, 0.90) && near(run2.jump2_dd, 1.09) && run2.status === 'complete', `A: a run scored after the update takes bF 0.90 and the new code fdF 1.09 (stored ${run2.jump1_dd} / ${run2.jump2_dd})`);

    // =====================================================================
    // B. All 75 codes against the chart
    // =====================================================================
    const chart = expectedChart();
    c.eq(Object.keys(chart).length, 75, 'B: the expected table (FIS chart + 5 StickIt-only codes) holds 75 codes');
    for (const d of ['mogul', 'dual_mogul']) for (const [gi, g] of ['M', 'F'].entries()) {
      const rows = apiTable[`${d}|${g}`];
      const codes = rows.map(r => r.jump_code);
      const bad = [];
      for (const [code, mw] of Object.entries(chart)) {
        const hit = rows.filter(r => r.jump_code === code);
        const want = d === 'mogul' ? mw[gi] : dual(mw[gi]);
        if (hit.length !== 1 || !near(hit[0].dd_value, want)) bad.push(`${code}: want ${want}, got ${hit.map(h => h.dd_value).join(',') || 'none'}`);
      }
      const extra = codes.filter(code => !(code in chart));
      c.ok(bad.length === 0 && extra.length === 0 && rows.length === 75,
        `B: ${d} ${g === 'M' ? 'men' : 'women'} — all 75 codes match the FIS 07.11.26 chart${d === 'dual_mogul' ? ' x 1.25' : ''}, one row each${bad.length ? ' — ' + bad.join('; ') : ''}${extra.length ? ' — not expected: ' + extra.join(',') : ''}`);
    }

    // second boot: nothing
    await after.stop();
    const logLen = after.log.length;
    await after.start();
    c.ok(!after.log.slice(logLen).some(l => l.includes(MIGRATION_LINE)), 'A: the migration does not run on the next boot');
    c.eq(JSON.stringify(await tableOf(dbPath)), JSON.stringify(t1), 'A: the table is byte-identical after a second boot (no duplicate rows)');
    await after.stop();

    // =====================================================================
    // C. The two gates, a fresh database, a venue boot
    // =====================================================================
    await fresh.start();
    const tf = await tableOf(fresh.dbPath);
    const mogulM = (rows, code) => rows.filter(r => r.discipline === 'mogul' && r.gender === 'M' && r.jump_code === code);
    c.ok(SIX.every(code => mogulM(tf, code).length === 1 && near(mogulM(tf, code)[0].dd_value, WANT[code][0])), 'C: a new database is seeded with the 07.11.26 values, one row per code');
    c.ok(!fresh.log.some(l => l.includes(MIGRATION_LINE)), 'C: a new database runs no migration');
    c.eq(tf.filter(r => r.discipline !== 'aerials').length, 300, 'C: 300 mogul + dual rows on a new database (75 codes x 4)');
    await fresh.stop();

    // gate 1 alone: bF already current (bdF hand-set to a marker), fdF / ftF missing
    let db = openDb(fresh.dbPath);
    await db.client.execute("DELETE FROM jump_dd_table WHERE jump_code IN ('fdF','ftF') AND discipline IN ('mogul','dual_mogul')");
    await db.client.execute("UPDATE jump_dd_table SET dd_value=1.07 WHERE jump_code='bdF' AND discipline='mogul' AND gender='M'");
    db.close();
    let n = fresh.log.length;
    await fresh.start();
    let t = await tableOf(fresh.dbPath);
    c.ok(fresh.log.slice(n).some(l => l.includes(`${MIGRATION_LINE} — fdF / ftF added`)), 'C: missing fdF with bF current -> inserts only');
    c.ok(mogulM(t, 'fdF').length === 1 && mogulM(t, 'ftF').length === 1 && near(mogulM(t, 'bdF')[0].dd_value, 1.07), 'C: fdF / ftF added once; the value marker on bdF was not overwritten');
    await fresh.stop();

    // gate 2 alone: bF back at 0.88, fdF / ftF present
    db = openDb(fresh.dbPath);
    await db.client.execute("UPDATE jump_dd_table SET dd_value=0.88 WHERE jump_code='bF' AND discipline='mogul' AND gender='M'");
    db.close();
    n = fresh.log.length;
    await fresh.start();
    t = await tableOf(fresh.dbPath);
    c.ok(fresh.log.slice(n).some(l => l.includes(`${MIGRATION_LINE} — bF / fF / bdF / btF re-valued`) && !l.includes('added')), 'C: bF at 0.88 with fdF present -> updates only');
    c.ok(near(mogulM(t, 'bF')[0].dd_value, 0.90) && near(mogulM(t, 'bdF')[0].dd_value, 1.09) && mogulM(t, 'fdF').length === 1 && mogulM(t, 'ftF').length === 1, 'C: values restored, still one fdF / ftF row');
    c.eq(t.filter(r => r.discipline !== 'aerials').length, 300, 'C: still 300 mogul + dual rows (no duplicates)');
    await fresh.stop();

    // venue mode: same migration, nothing captured for upsync
    await venue.start();
    await venue.stop();
    db = openDb(venue.dbPath);
    await db.client.execute("UPDATE jump_dd_table SET dd_value=0.88 WHERE jump_code='bF' AND discipline='mogul' AND gender='M'");
    await db.client.execute("DELETE FROM jump_dd_table WHERE jump_code IN ('fdF','ftF') AND discipline IN ('mogul','dual_mogul')");
    db.close();
    n = venue.log.length;
    await venue.start();
    t = await tableOf(venue.dbPath);
    c.ok(venue.log.slice(n).some(l => l.includes(MIGRATION_LINE)) && near(mogulM(t, 'bF')[0].dd_value, 0.90) && mogulM(t, 'fdF').length === 1, 'C: a venue-mode boot runs the same migration');
    db = openDb(venue.dbPath);
    const outbox = await db.queryAll("SELECT COUNT(*) AS cnt FROM sync_outbox WHERE tbl='jump_dd_table'").catch(() => [{ cnt: 0 }]);
    db.close();
    c.eq(Number(outbox[0].cnt), 0, 'C: no jump_dd_table row is queued for upsync on the venue');
    await venue.stop();

    // =====================================================================
    // D. Voice phrases + canonicalization
    // =====================================================================
    const mjs = path.join(dir, 'parser.mjs');
    fs.copyFileSync(path.join(REPO_ROOT, 'client', 'src', 'voice', 'parser.js'), mjs);
    const { _internal } = await import(pathToFileURL(mjs).href);
    const say = (s) => _internal.canonicalizeJumpCode(s, new Set(Object.keys(chart)));
    c.deepEq(['front full', 'front double full', 'front triple full', 'back triple full'].map(say), ['fF', 'fdF', 'ftF', 'btF'], 'D: voice — front full, front double full, front triple full, back triple full');
    c.deepEq(['back full', 'back double full', 'back full full', 'front grab', 'back tuck'].map(say), ['bF', 'bdF', 'bFF', 'fg', 'bT'], 'D: voice — existing phrases unchanged');
    c.deepEq(['fdf', 'FDF', 'ftf', 'btf', 'ff'].map(engine.canonicalizeJumpCode), ['fdF', 'fdF', 'ftF', 'btF', 'fF'], 'D: typed codes canonicalize to fdF / ftF / btF / fF');
    c.ok(!engine.areJumpsRepeats('fF', 'fdF') && !engine.areJumpsRepeats('fdF', 'ftF') && engine.areJumpsRepeats('fdF', 'fdF'), 'D: fdF is not a repeat of fF (as bdF is not of bF); fdF repeats fdF');
  } catch (e) {
    c.ok(false, 'threw: ' + ((e && e.stack) || e));
  } finally {
    for (const i of [before, after, fresh, venue]) await i.stop().catch(() => {});
  }
  return c;
}

module.exports = { main };
