/**
 * Release gates (Section 11 items 4 + 8, FR-22) — run last.
 *
 *   A. REGRESSION GATE (item 4): a full cloud-only meet script — the v2 feature
 *      entirely unused — played identically against the v2 build and a real
 *      v1.30.03 checkout; API responses compared after FR-23 normalization.
 *   B. ROLLBACK GATE (item 8): the v1.30.03 build boots and operates against a
 *      v2-migrated database (adoption columns populated), then v2 boots again
 *      on the same DB.
 *   C. SCRATCH-TURSO GATE (FR-22): the full adopt → outage → replay → check-in
 *      cycle against a local sqld (libsql-server) standing in for Turso, so
 *      the first real Turso apply/checksum is not a live event.
 *
 * The v1.30.03 checkout is a git worktree at harness/.v1baseline (created on
 * first run; node_modules symlinked from the live server). sqld is downloaded
 * once to harness/.tools/ (both gitignored).
 */

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { Checks } = require('../lib/checks');
const { Instance, scratchDir, SERVER_DIR, REPO_ROOT } = require('../lib/instance');
const { Api } = require('../lib/client');
const { openDb } = require('../lib/db');
const { buildMeet } = require('../lib/fixtures');
const { seedMogulJudges, playMogulRun } = require('../lib/driver');
const { normalizeCorpus } = require('../lib/normalize');

const protocol = require(path.join(SERVER_DIR, 'sync', 'protocol.js'));

const V1_DIR = path.join(REPO_ROOT, 'harness', '.v1baseline');
const SQLD = path.join(REPO_ROOT, 'harness', '.tools', 'libsql-server-aarch64-apple-darwin', 'sqld');

// v2-only additive response fields, dropped before regression comparison
// (documented: additive columns on meets, FR-6 NON_SYNC_COLUMNS).
const V2_ONLY_KEYS = [
  'adoption_status', 'adopted_at', 'sync_token_hash', 'last_sync_at',
  'last_applied_seq', 'remote_judging', 'release_code_hash',
  'release_code_expires_at', 'released_at', 'released_by',
  // v2.1.00 — Advanced meet settings (meets columns, in the sync manifest)
  'nj_rule_enabled', 'air_tie_allowed', 'start_run_timekeeper', 'start_run_head_judge', 'start_run_chief',
  // v2.2.00 — viewer /results rule-correct ranking additions (effective_status,
  // run_number echo). NOTE: rank VALUES also changed for ties/statused rows —
  // a deliberate correction; the regression script has neither.
  'effective_status', 'run_number',
  // v2.3.00 — Air judge jump-code reconciliation (runs.air_codes_reconciled,
  // judge_scores.jump_code, /runs/active mismatch state)
  'air_codes_reconciled', 'jump_code', 'air_code_mismatch', 'air_codes_by_judge',
];
// Keep this list current with every release's additive response fields —
// the gate compares against a frozen v1.30.03 worktree, so any new key
// fails it until documented here.

function ensureV1Baseline() {
  if (!fs.existsSync(path.join(V1_DIR, 'server', 'index.js'))) {
    execFileSync('git', ['worktree', 'add', '--force', V1_DIR, 'v1.30.03'], { cwd: REPO_ROOT });
  }
  const nm = path.join(V1_DIR, 'server', 'node_modules');
  if (!fs.existsSync(nm)) {
    fs.symlinkSync(path.join(SERVER_DIR, 'node_modules'), nm, 'dir');
  }
}

async function waitFor(fn, timeoutMs = 60000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return null;
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

/** The cloud-only regression script — must not touch any v2 feature. */
async function playRegressionScript(api) {
  const A = await buildMeet(api, { name: 'Regression Meet', athletes: 4, judges: [], startRun: false, bibStart: 1, ussaStart: 7600001 });
  const judges = await seedMogulJudges(api, A.event.id);
  for (let i = 0; i < 3; i++) {
    await playMogulRun(api, A.event.id, judges, A.regs[i].id, 1, i);
  }
  await api.must('POST', `/api/events/${A.event.id}/runs/status-only`, {
    registration_id: A.regs[3].id, run_number: 1, round: 'qualification', run_status: 'DNS',
  });
  await api.must('POST', `/api/events/${A.event.id}/runs/round-status/1/finalize`, {});
  return A;
}

function canonScores(data) {
  if (!data || !Array.isArray(data.runs) || !Array.isArray(data.scores)) return data;
  const runKey = Object.fromEntries(data.runs.map(r => [r.run_id, `${r.run_time}|${r.jump1_code}`]));
  return {
    ...data,
    runs: [...data.runs].sort((a, b) => (runKey[a.run_id] < runKey[b.run_id] ? -1 : 1)),
    scores: [...data.scores].sort((a, b) => {
      const ka = `${runKey[a.run_id]}|${a.score_type}|${a.role}|${a.raw_score}`;
      const kb = `${runKey[b.run_id]}|${b.score_type}|${b.role}|${b.raw_score}`;
      return ka < kb ? -1 : 1;
    }),
  };
}

async function main() {
  const c = new Checks('release-gates');

  ensureV1Baseline();
  c.ok(fs.existsSync(path.join(V1_DIR, 'server', 'version.js')), 'v1.30.03 baseline worktree present');
  const v1Version = fs.readFileSync(path.join(V1_DIR, 'server', 'version.js'), 'utf8');
  c.ok(v1Version.includes('1.30.03'), 'baseline is exactly v1.30.03');

  // =====================================================================
  // A. REGRESSION GATE — identical cloud-only behavior vs v1.30.03
  // =====================================================================
  const v2i = new Instance({ name: 'gate-v2', port: 3191, mode: 'cloud' });
  const v1i = new Instance({ name: 'gate-v1', port: 3192, mode: 'cloud', serverDir: path.join(V1_DIR, 'server') });
  try {
    await v2i.start();
    await v1i.start();
    const a2 = new Api(v2i.base);
    const a1 = new Api(v1i.base);
    const M2 = await playRegressionScript(a2);
    const M1 = await playRegressionScript(a1);

    const endpoints = [
      // Shape only: the value is the release string by definition (the gate
      // passed pre-bump at v2.0.00 because both trees still said v1.30.03).
      { name: 'GET /api/version', path: () => `/api/version`, canon: d => ({ keys: Object.keys(d || {}) }) },
      { name: 'GET /api/meets/:id', path: (M) => `/api/meets/${M.meet.id}`, canon: d => d },
      { name: 'GET /api/events/:id', path: (M) => `/api/events/${M.event.id}`, canon: d => d },
      { name: 'GET /api/events/:id/results', path: (M) => `/api/events/${M.event.id}/results`, canon: d => d },
      { name: 'GET /api/events/:id/runs', path: (M) => `/api/events/${M.event.id}/runs`, canon: d => d },
      { name: 'viewer /status', path: (M) => `/api/viewer/events/${M.event.id}/status`, canon: d => d },
      { name: 'viewer /results', path: (M) => `/api/viewer/events/${M.event.id}/results`, canon: d => d },
      { name: 'viewer /results/scores', path: (M) => `/api/viewer/events/${M.event.id}/results/scores`, canon: canonScores },
      { name: 'viewer /rounds', path: (M) => `/api/viewer/events/${M.event.id}/rounds`, canon: d => d },
    ];
    for (const ep of endpoints) {
      const r2 = await a2.get(ep.path(M2));
      const r1 = await a1.get(ep.path(M1));
      c.eq(r2.status, r1.status, `regression status parity: ${ep.name}`);
      const n2 = JSON.stringify(normalizeCorpus(ep.canon(r2.data), { dropKeys: [...V2_ONLY_KEYS, 'name'] }));
      const n1 = JSON.stringify(normalizeCorpus(ep.canon(r1.data), { dropKeys: [...V2_ONLY_KEYS, 'name'] }));
      const same = n2 === n1;
      c.ok(same, `REGRESSION GATE: ${ep.name} identical to v1.30.03${same ? '' : `\n      v2: ${n2.slice(0, 350)}\n      v1: ${n1.slice(0, 350)}`}`);
    }
    // Scoring outputs are numerically identical (engine untouched):
    const res2 = (await a2.get(`/api/events/${M2.event.id}/results`)).data;
    const res1 = (await a1.get(`/api/events/${M1.event.id}/results`)).data;
    const totals2 = (res2.results || res2).map(r => r.total_score ?? r.best_score);
    const totals1 = (res1.results || res1).map(r => r.total_score ?? r.best_score);
    c.deepEq(totals2, totals1, 'ranked totals numerically identical to v1.30.03');
  } finally {
    await v2i.stop().catch(() => {});
    await v1i.stop().catch(() => {});
  }

  // =====================================================================
  // B. ROLLBACK GATE — v1.30.03 boots against the v2-migrated DB
  // =====================================================================
  const rbDb = path.join(scratchDir('gate-rollback'), 'scoring.db');
  {
    const v2b = new Instance({ name: 'gate-rb-v2', port: 3193, mode: 'cloud', dbPath: rbDb });
    await v2b.start();
    const api = new Api(v2b.base);
    const A = await buildMeet(api, { name: 'Rollback Meet', athletes: 1, judges: ['TL1'], startRun: true });
    // Populate the v2-only columns for real (released state + remote flag).
    await api.must('POST', `/api/meets/${A.meet.id}/release-for-adoption`);
    await v2b.stop();

    const v1b = new Instance({ name: 'gate-rb-v1', port: 3194, mode: 'cloud', dbPath: rbDb, serverDir: path.join(V1_DIR, 'server') });
    await v1b.start();
    const api1 = new Api(v1b.base);
    const ver = (await api1.get('/api/version')).data;
    c.eq(ver.version, 'v1.30.03', 'ROLLBACK GATE: v1.30.03 boots against the v2-migrated database');
    const meet = (await api1.get(`/api/meets/${A.meet.id}`)).data;
    c.eq(meet.name, 'Rollback Meet', 'v1 reads the v2-written meet');
    const B = await buildMeet(api1, { name: 'Rollback Meet 2', athletes: 1, judges: ['TL1'], startRun: true });
    const r = await api1.post(`/api/events/${B.event.id}/runs/${B.run.id}/scores`, {
      judge_id: B.judges[0].id, score_type: 'turns', raw_score: 12.0,
    });
    c.eq(r.status, 200, 'v1 scores normally on the migrated database (new tables/columns ignored)');
    await v1b.stop();

    // And back to v2 on the same DB (recovery from a rollback).
    const v2c = new Instance({ name: 'gate-rb-v2b', port: 3195, mode: 'cloud', dbPath: rbDb });
    await v2c.start();
    const back = (await new Api(v2c.base).get(`/api/meets/${B.meet.id}`)).data;
    c.eq(back.name, 'Rollback Meet 2', 'v2 boots again on the same DB and reads the v1-written meet');
    await v2c.stop();
  }

  // =====================================================================
  // C. SCRATCH-TURSO GATE (FR-22) — full cycle against local sqld
  // =====================================================================
  if (!fs.existsSync(SQLD)) {
    c.ok(false, `FR-22: sqld binary missing at ${SQLD} — download per harness README`);
    return c;
  }
  const sqldDir = scratchDir('gate-sqld');
  const sqldLog = [];
  const sqld = spawn(SQLD, ['--http-listen-addr', '127.0.0.1:3199', '--db-path', path.join(sqldDir, 'turso')]);
  sqld.stdout.on('data', d => sqldLog.push(String(d)));
  sqld.stderr.on('data', d => sqldLog.push(String(d)));
  try {
    const up = await waitFor(async () => {
      try { const r = await fetch('http://127.0.0.1:3199/health'); return r.ok ? true : null; } catch (_) { return null; }
    }, 30000, 300);
    c.ok(up, `local sqld (Turso stand-in) is up${up ? '' : '\n' + sqldLog.join('').slice(-500)}`);

    const tCloud = new Instance({
      name: 'gate-turso-cloud', port: 3196, mode: 'cloud',
      env: { LIBSQL_URL: 'http://127.0.0.1:3199' },
    });
    const tVenue = new Instance({ name: 'gate-turso-venue', port: 3197, mode: 'venue' });
    await tCloud.start();
    await tVenue.start();
    const cApi = new Api(tCloud.base);
    const vApi = new Api(tVenue.base);

    const A = await buildMeet(cApi, { name: 'Turso Meet', athletes: 3, judges: [], startRun: false });
    const judges = await seedMogulJudges(cApi, A.event.id);
    const rel = await cApi.must('POST', `/api/meets/${A.meet.id}/release-for-adoption`);
    const ad = await vApi.post('/api/venue/adopt', { code: rel.code, cloud_url: tCloud.base });
    c.eq(ad.status, 200, 'FR-22: adoption from the Turso-backed cloud');

    // Outage → offline scoring → replay
    await tCloud.stop();
    await playMogulRun(vApi, A.event.id, judges, A.regs[0].id, 1, 0);
    await playMogulRun(vApi, A.event.id, judges, A.regs[1].id, 1, 1);
    await vApi.must('POST', `/api/events/${A.event.id}/runs/status-only`, {
      registration_id: A.regs[2].id, run_number: 1, round: 'qualification', run_status: 'DNS',
    });
    await tCloud.start();
    const vdb = openDb(tVenue.dbPath);
    const drained = await waitFor(async () => {
      const n = await vdb.queryOne('SELECT COUNT(*) AS c FROM sync_outbox');
      return parseInt(n.c) === 0 ? true : null;
    }, 60000);
    c.ok(drained, 'FR-22: outage replay applied onto Turso');

    // Check-in with Turso-side checksum verification
    const ci = await vApi.post('/api/venue/checkin', { mode: 'checkin' });
    c.eq(ci.status, 200, `FR-22: check-in verified against Turso checksums (${JSON.stringify(ci.data)})`);
    // Confirm on the Turso side through the http client
    const { createClient } = require('@libsql/client');
    const tdb = createClient({ url: 'http://127.0.0.1:3199' });
    const row = await tdb.execute({ sql: 'SELECT adoption_status FROM meets WHERE id=?', args: [A.meet.id] });
    c.eq(row.rows[0].adoption_status, 'checked_in', 'FR-22: Turso row marked checked_in');
    const runs = await tdb.execute({ sql: 'SELECT COUNT(*) AS n FROM runs WHERE event_id=?', args: [A.event.id] });
    c.eq(Number(runs.rows[0].n), 3, 'FR-22: all runs mirrored into Turso');
    tdb.close();
    vdb.close();
    await tCloud.stop();
    await tVenue.stop();
  } finally {
    sqld.kill('SIGKILL');
  }

  return c;
}

module.exports = { main };
