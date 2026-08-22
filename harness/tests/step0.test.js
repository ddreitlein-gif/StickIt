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
 *   F. Playwright smoke (FR-21 foundation): the SPA loads from the instance.
 */

const path = require('path');
const { Checks } = require('../lib/checks');
const { Instance, scratchDir, SERVER_DIR } = require('../lib/instance');
const { Api } = require('../lib/client');
const { openDb } = require('../lib/db');
const { withPage } = require('../lib/browser');

const protocol = require(path.join(SERVER_DIR, 'sync', 'protocol.js'));

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
      const manifest = [...spec.columns].sort();
      c.deepEq(manifest, physical, `manifest matches fresh schema: ${table}`);
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
      ldb.close();
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
