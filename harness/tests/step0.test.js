/**
 * Step 0 acceptance tests — foundations.
 *
 *   A. Two-instance boot: cloud + venue instances on scratch file DBs.
 *   B. Mode plumbing: /api/venue/status per mode; /api/version byte-identical
 *      to v1.30.03's shape (regression guarantee).
 *   C. FR-6 manifest drift: pinned column manifest === freshly-migrated schema.
 *   D. Protocol determinism: checksums independent of row order / extra cols.
 *   E. FR-11: unique index on fresh DB; dedup of a legacy DB with duplicates;
 *      racing INSERT retry never surfaces an error and leaves exactly one row.
 *      v2.7.01: the twelve plain query indexes exist on a fresh DB (cloud and
 *      venue), build over duplicate runs rows on a legacy DB, tolerate one that
 *      already exists, survive a second boot, and the boot log says 12 of 12.
 *   F. Playwright smoke (FR-21 foundation): the SPA loads from the instance.
 */

const path = require('path');
const { Checks } = require('../lib/checks');
const { Instance, scratchDir, SERVER_DIR } = require('../lib/instance');
const { Api } = require('../lib/client');
const { openDb } = require('../lib/db');
const { withPage } = require('../lib/browser');

const protocol = require(path.join(SERVER_DIR, 'sync', 'protocol.js'));

// v2.7.01 -- the twelve query indexes, restated independently of schema.js
// (section 3.1 of the 09-26-26 prompt): name -> [table, columns].
const QUERY_INDEXES = {
  idx_runs_event_status:          ['runs', 'event_id, status'],
  idx_runs_event_run_number:      ['runs', 'event_id, run_number'],
  idx_runs_event_round_status:    ['runs', 'event_id, round, status'],
  idx_runs_registration:          ['runs', 'registration_id'],
  idx_registrations_event_status: ['registrations', 'event_id, status'],
  idx_registrations_athlete:      ['registrations', 'athlete_id'],
  idx_judges_event:               ['judges', 'event_id'],
  idx_events_meet:                ['events', 'meet_id'],
  idx_dual_bracket_event:         ['dual_bracket', 'event_id'],
  idx_event_phases_event:         ['event_phases', 'event_id, run_number'],
  idx_heats_event:                ['heats', 'event_id'],
  idx_audit_log_timestamp:        ['audit_log', 'timestamp'],
};
const INDEX_NAMES = Object.keys(QUERY_INDEXES);

/** sqlite_master rows for the twelve names: { name -> { tbl_name, sql } }. */
async function queryIndexRows(db) {
  const rows = await db.queryAll(
    `SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND name IN (${INDEX_NAMES.map(() => '?').join(',')})`,
    INDEX_NAMES
  );
  const out = {};
  for (const r of rows) out[r.name] = { tbl_name: r.tbl_name, sql: r.sql };
  return out;
}

/** True when every one of the twelve is present, on its table, non-unique, with its columns. */
function checkIndexSet(c, rows, tag) {
  const missing = INDEX_NAMES.filter(n => !rows[n]);
  c.deepEq(missing, [], `${tag}: all twelve query indexes present`);
  const wrong = INDEX_NAMES.filter(n => rows[n] && (
    rows[n].tbl_name !== QUERY_INDEXES[n][0] ||
    /UNIQUE/i.test(rows[n].sql || '') ||
    !(rows[n].sql || '').replace(/\s+/g, ' ').includes(`(${QUERY_INDEXES[n][1]})`)
  ));
  c.deepEq(wrong, [], `${tag}: every index is plain (non-unique), on its table, with its columns`);
}

const CLOUD_PORT = 3101;
const VENUE_PORT = 3102;

async function main() {
  const c = new Checks('step0');

  const cloud = new Instance({ name: 'step0-cloud', port: CLOUD_PORT, mode: 'cloud' });
  const venue = new Instance({ name: 'step0-venue', port: VENUE_PORT, mode: 'venue' });

  try {
    // ---- A. Two-instance boot -------------------------------------------
    await cloud.start();
    await venue.start();
    const cApi = new Api(cloud.base);
    const vApi = new Api(venue.base);
    c.ok((await cApi.get('/api/health')).data.ok === true, 'cloud instance boots and reports healthy');
    c.ok((await vApi.get('/api/health')).data.ok === true, 'venue instance boots and reports healthy');

    // ---- B. Mode plumbing ----------------------------------------------
    const cStatus = (await cApi.get('/api/venue/status')).data;
    const vStatus = (await vApi.get('/api/venue/status')).data;
    c.eq(cStatus.mode, 'cloud', 'cloud /api/venue/status reports mode=cloud');
    c.eq(vStatus.mode, 'venue', 'venue /api/venue/status reports mode=venue');
    c.eq(cStatus.protocol_version, protocol.SYNC_PROTOCOL_VERSION, 'status carries SYNC_PROTOCOL_VERSION');
    // /api/version must remain exactly the v1.30.03 shape: {"version": "..."}
    const ver = (await cApi.get('/api/version')).data;
    c.deepEq(Object.keys(ver), ['version'], '/api/version response shape unchanged (single "version" key)');

    // ---- C. FR-6 manifest drift ----------------------------------------
    const vdb = openDb(venue.dbPath);
    for (const [table, spec] of Object.entries(protocol.TABLES)) {
      const info = await vdb.queryAll(`PRAGMA table_info(${table})`);
      const physical = info.map(r => r.name).sort();
      const manifest = [...spec.columns, ...(protocol.NON_SYNC_COLUMNS[table] || [])].sort();
      c.deepEq(manifest, physical, `manifest (+ documented exclusions) matches fresh schema: ${table}`);
      const missingPk = spec.pk.filter(k => !spec.columns.includes(k));
      c.deepEq(missingPk, [], `pk columns are in manifest: ${table}`);
    }
    c.ok(protocol.SYNC_TABLES.length === 18, `18 tables in the outbox sync set (17 meet-scoped + audit_log), got ${protocol.SYNC_TABLES.length}`);
    c.ok(!protocol.SYNC_TABLES.includes('usss_people'), 'usss_people is snapshot-only, never upsynced');
    c.ok(!protocol.CHECKSUM_TABLES.includes('audit_log'), 'audit_log excluded from checksum set');
    c.ok(protocol.SYNC_TABLES.includes('audit_log'), 'audit_log included in sync set (FR-12)');

    // selectForMeet compiles and runs for every scoped table
    for (const table of protocol.SNAPSHOT_TABLES) {
      const rows = await vdb.queryAll(protocol.selectForMeet(table), ['no-such-meet']);
      c.ok(Array.isArray(rows), `selectForMeet(${table}) executes`);
    }

    // ---- D. Protocol determinism ---------------------------------------
    const rowA = { id: 'a', name: 'Meet A', location: 'X', date: '2026-01-01', status: 'setup', created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00', meet_ranking: null, short_code: 'abc123' };
    const rowB = { id: 'b', name: 'Meet B', location: 'Y', date: '2026-01-02', status: 'setup', created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00', meet_ranking: 'A', short_code: 'def456' };
    const cs1 = protocol.tableChecksum('meets', [rowA, rowB]);
    const cs2 = protocol.tableChecksum('meets', [rowB, rowA]);
    c.deepEq(cs1, cs2, 'tableChecksum is row-order independent');
    // Extra (orphan) columns are ignored; key insertion order irrelevant
    const rowAExtra = { nj_blue: 1, ...rowA, orphan_col: 'x' };
    c.eq(protocol.rowHash('meets', rowAExtra), protocol.rowHash('meets', rowA), 'rowHash ignores non-manifest columns');
    c.ok(protocol.rowHash('meets', { ...rowA, name: 'Changed' }) !== protocol.rowHash('meets', rowA), 'rowHash detects a changed value');
    c.ok(protocol.rowHash('meets', { ...rowA, meet_ranking: '' }) !== protocol.rowHash('meets', rowA), 'empty string and NULL hash differently');
    c.eq(protocol.canonicalValue(-0), '0', '-0 canonicalizes to "0"');
    c.eq(protocol.canonicalValue(2), '2', 'integer-valued number canonical form');
    c.eq(protocol.canonicalValue(0.1 + 0.2), '0.30000000000000004', 'float canonical form is exact round-trip');
    c.deepEq(protocol.pkOf('run_round_status', { event_id: 'e1', run_number: 2, status: 'x' }), { event_id: 'e1', run_number: 2 }, 'composite pkOf');

    // ---- E1. FR-11 unique index exists on a fresh database --------------
    const idx = await vdb.queryOne(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_judge_scores_run_judge_type'`);
    c.ok(!!idx, 'FR-11 UNIQUE index exists on fresh database');

    // ---- E4. v2.7.01 query indexes on a fresh database (cloud + venue) ----
    checkIndexSet(c, await queryIndexRows(vdb), 'E4 fresh venue DB');
    {
      const cdb0 = openDb(cloud.dbPath);
      checkIndexSet(c, await queryIndexRows(cdb0), 'E4 fresh cloud DB');
      cdb0.close();
    }
    for (const inst of [cloud, venue]) {
      c.ok(inst.log.some(l => l.includes('[v2.7.01 index migration] 12 of 12 query indexes present')),
        `E4: ${inst.name} boot log reports 12 of 12 query indexes`);
      c.ok(!inst.log.some(l => l.includes('[v2.7.01 index migration] FAILED')),
        `E4: ${inst.name} boot log has no index-migration failure`);
    }
    vdb.close();

    // ---- E2. FR-11 dedup of a legacy database with duplicates -----------
    const legacyDir = scratchDir('step0-legacy');
    const legacyDbPath = path.join(legacyDir, 'scoring.db');
    {
      const ldb = openDb(legacyDbPath);
      // v1.30.03-shaped judge_scores table, no unique index, with duplicates.
      await ldb.execute(`CREATE TABLE judge_scores (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, judge_id TEXT NOT NULL, score_type TEXT NOT NULL, raw_score REAL NOT NULL, submitted_at TEXT NOT NULL DEFAULT (datetime('now')))`);
      await ldb.execute(`INSERT INTO judge_scores (id, run_id, judge_id, score_type, raw_score, submitted_at) VALUES
        ('dup-old', 'r1', 'j1', 'turns', 11.0, '2026-01-01 10:00:00'),
        ('dup-new', 'r1', 'j1', 'turns', 14.5, '2026-01-01 10:00:05'),
        ('keep-1',  'r1', 'j2', 'turns', 12.0, '2026-01-01 10:00:01')`);
      // v2.7.01 (E5/E6): a v1.30.03-shaped runs table holding DUPLICATE
      // (registration_id, run_number) rows -- the plain indexes must build
      // over them -- and one of the twelve already created under its name.
      await ldb.execute(`CREATE TABLE runs (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, registration_id TEXT NOT NULL, run_number INTEGER NOT NULL DEFAULT 1, round TEXT NOT NULL DEFAULT 'qualification', bracket_round INTEGER, bracket_position INTEGER, course TEXT, jump1_code TEXT, jump1_dd REAL, jump2_code TEXT, jump2_dd REAL, turns_score REAL, air_score REAL, speed_score REAL, total_score REAL, run_time REAL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
      await ldb.execute(`INSERT INTO runs (id, event_id, registration_id, run_number, status, total_score) VALUES
        ('run-dup-a', 'e1', 'reg1', 1, 'complete', 70.1),
        ('run-dup-b', 'e1', 'reg1', 1, 'complete', 71.2),
        ('run-other', 'e1', 'reg2', 1, 'complete', 65.0)`);
      await ldb.execute(`CREATE INDEX idx_runs_event_status ON runs(event_id, status)`);
      // E6b: one of the names taken by an index with OTHER columns — kept by
      // IF NOT EXISTS, but the boot line must not count it and must warn.
      await ldb.execute(`CREATE TABLE heats (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, heat_number INTEGER NOT NULL, heat_name TEXT, round TEXT NOT NULL DEFAULT 'qualification', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
      await ldb.execute(`CREATE INDEX idx_heats_event ON heats(event_id, round)`);
      ldb.close();
    }
    const legacy = new Instance({ name: 'step0-legacy', port: 3103, mode: 'cloud', dbPath: legacyDbPath });
    await legacy.start();
    await legacy.stop();
    {
      const ldb = openDb(legacyDbPath);
      const rows = await ldb.queryAll(`SELECT id, raw_score FROM judge_scores ORDER BY id`);
      c.eq(rows.length, 2, 'FR-11 dedup removed the duplicate row');
      c.ok(rows.some(r => r.id === 'dup-new' && r.raw_score === 14.5), 'FR-11 dedup kept the most recent submission');
      c.ok(!rows.some(r => r.id === 'dup-old'), 'FR-11 dedup removed the older submission');
      const lidx = await ldb.queryOne(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_judge_scores_run_judge_type'`);
      c.ok(!!lidx, 'FR-11 index created on migrated legacy database');
      // ---- E5/E6. v2.7.01 indexes over duplicate runs rows + a pre-existing one --
      const legacyRows = await queryIndexRows(ldb);
      c.ok(/\(event_id, round\)/.test(legacyRows.idx_heats_event?.sql || ''), 'E6b: the foreign idx_heats_event(event_id, round) is kept (IF NOT EXISTS never drops)');
      c.ok(legacy.log.some(l => l.includes('WARNING idx_heats_event exists with a different definition')), 'E6b: boot log warns about the foreign definition');
      c.ok(legacy.log.some(l => l.includes('[v2.7.01 index migration] 11 of 12 query indexes present')), 'E6b: boot line counts 11 of 12 (definition-checked, not name-checked)');
      // put the real one in place by hand (what an operator would do after the warning);
      // the second boot below must then keep it and report 12 of 12
      await ldb.execute('DROP INDEX idx_heats_event');
      await ldb.execute('CREATE INDEX idx_heats_event ON heats(event_id)');
      checkIndexSet(c, await queryIndexRows(ldb), 'E5 legacy DB with duplicate runs rows');
      const dupRuns = await ldb.queryAll(`SELECT id FROM runs WHERE registration_id='reg1' AND run_number=1 ORDER BY id`);
      c.eq(dupRuns.length, 2, 'E5: the duplicate runs rows are still both there (plain index, no dedup)');
      const named = await ldb.queryAll(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_runs_event_status'`);
      c.eq(named.length, 1, 'E6: the pre-existing idx_runs_event_status is left alone (exactly one, no duplicate)');
      c.ok(!legacy.log.some(l => l.includes('[v2.7.01 index migration] FAILED')), 'E6: legacy boot log has no index-migration failure');
      ldb.close();
    }
    // ---- E7. second boot is idempotent -----------------------------------
    {
      const before = JSON.stringify(await (async () => { const d = openDb(legacyDbPath); const r = await queryIndexRows(d); d.close(); return r; })());
      legacy.log.length = 0;
      await legacy.start();
      await legacy.stop();
      const d = openDb(legacyDbPath);
      const after = await queryIndexRows(d);
      d.close();
      c.eq(JSON.stringify(after), before, 'E7: second boot leaves the twelve indexes byte-identical in sqlite_master');
      c.ok(legacy.log.some(l => l.includes('[v2.7.01 index migration] 12 of 12 query indexes present')), 'E7: second boot log reports 12 of 12');
      // (the USSS People File startup sync logs its own "failed" line when this Mac is offline — not a boot error)
      const errLines = legacy.log.filter(l => /\bError\b|FAILED|WARNING/.test(l) && !/USSS/.test(l));
      c.deepEq(errLines, [], 'E7: second boot log has no error / FAILED / WARNING lines');
    }

    // ---- E3. FR-11 racing INSERT retry ----------------------------------
    // Build a minimal meet/event/judge/registration/run on the cloud instance
    // through the real APIs (auth is disabled on a fresh DB).
    const meet = await cApi.must('POST', '/api/meets', { name: 'Race Meet', location: 'Test', date: '2026-08-22', meet_ranking: 'C' });
    const event = await cApi.must('POST', `/api/meets/${meet.id}/events`, { discipline: 'mogul', division: 'comp_series', gender: 'M', name: 'Race Mogul M' });
    const judge = await cApi.must('POST', `/api/events/${event.id}/judges`, { name: 'Judge One', role: 'TL1' });
    const athlete = await cApi.must('POST', '/api/athletes', { first_name: 'Racer', last_name: 'One', gender: 'M', birth_year: 2008 });
    const reg = await cApi.must('POST', `/api/events/${event.id}/registrations`, { athlete_id: athlete.id, bib_number: 1 });
    const run = await cApi.must('POST', `/api/events/${event.id}/runs`, { registration_id: reg.id, run_number: 1 });
    const runId = run.id || (run.run && run.run.id);
    c.ok(!!runId, 'run created for race test');

    const N = 8;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        cApi.post(`/api/events/${event.id}/runs/${runId}/scores`, {
          judge_id: judge.id, score_type: 'turns', raw_score: 10 + i * 0.1,
        })
      )
    );
    c.ok(results.every(r => r.status === 200 || r.status === 201), `all ${N} concurrent same-key submits succeed (statuses: ${results.map(r => r.status).join(',')})`);
    const cdb = openDb(cloud.dbPath);
    const scoreRows = await cdb.queryAll(`SELECT id FROM judge_scores WHERE run_id=? AND judge_id=? AND score_type='turns'`, [runId, judge.id]);
    c.eq(scoreRows.length, 1, 'exactly one judge_scores row after the race');
    cdb.close();

    // ---- F. Playwright smoke (FR-21 foundation) --------------------------
    await withPage(async (page) => {
      await page.goto(cloud.base + '/', { waitUntil: 'domcontentloaded' });
      const title = await page.title();
      c.ok(/stickit/i.test(title), `SPA loads in Chromium (title: "${title}")`);
      await page.waitForSelector('#root', { timeout: 10000 });
      c.ok(true, '#root mounted');
    });
  } finally {
    await cloud.stop().catch(() => {});
    await venue.stop().catch(() => {});
  }

  return c;
}

module.exports = { main };
