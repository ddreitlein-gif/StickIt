const { createClient } = require('@libsql/client');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_URL = process.env.LIBSQL_URL || `file:${path.join(DATA_DIR, 'scoring.db')}`;
const DB_AUTH = process.env.LIBSQL_AUTH_TOKEN || undefined;

let client;

function getClient() {
  if (!client) {
    client = createClient({ url: DB_URL, authToken: DB_AUTH });
  }
  return client;
}

function rowToObj(row) {
  const obj = {};
  for (const key of Object.keys(row)) {
    if (isNaN(parseInt(key))) obj[key] = row[key];
  }
  return obj;
}

async function queryAll(sql, args = []) {
  const c = getClient();
  const result = await c.execute({ sql, args });
  return result.rows.map(rowToObj);
}

async function queryOne(sql, args = []) {
  const rows = await queryAll(sql, args);
  return rows[0] || null;
}

// v2.0.00 (Step 4) -- installable write hook for the venue-mode outbox capture
// layer (FR-5). Cloud mode NEVER installs a hook, so the only cloud-path change
// is one null check. The hook receives the raw executors so its own reads and
// outbox appends bypass capture.
let writeHook = null;
function setWriteHook(hook) { writeHook = hook; }

async function rawExecute(sql, args = []) {
  const c = getClient();
  return c.execute({ sql, args });
}

async function rawBatch(statements) {
  const c = getClient();
  return c.batch(statements, 'write');
}

async function execute(sql, args = []) {
  if (writeHook) return writeHook.execute(sql, args);
  return rawExecute(sql, args);
}

async function batch(statements) {
  if (writeHook) return writeHook.batch(statements);
  return rawBatch(statements);
}

async function initSchema() {
  const c = getClient();
  const ddl = [
    `CREATE TABLE IF NOT EXISTS meets (id TEXT PRIMARY KEY, name TEXT NOT NULL, location TEXT NOT NULL, date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'setup', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, meet_id TEXT NOT NULL, discipline TEXT NOT NULL, division TEXT NOT NULL, gender TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'setup', num_tl_judges INTEGER NOT NULL DEFAULT 3, num_air_judges INTEGER NOT NULL DEFAULT 2, has_speed INTEGER NOT NULL DEFAULT 1, turns_weight REAL NOT NULL DEFAULT 0.60, air_weight REAL NOT NULL DEFAULT 0.20, speed_weight REAL NOT NULL DEFAULT 0.20, pace_time REAL, bracket_size INTEGER DEFAULT 128, has_small_final INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS athletes (id TEXT PRIMARY KEY, ussa_num TEXT, fis_id TEXT, first_name TEXT NOT NULL, last_name TEXT NOT NULL, birth_year INTEGER, gender TEXT, club TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS registrations (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, athlete_id TEXT NOT NULL, bib_number INTEGER, seed INTEGER, status TEXT NOT NULL DEFAULT 'registered', created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS judges (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, pin TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, registration_id TEXT NOT NULL, run_number INTEGER NOT NULL DEFAULT 1, round TEXT NOT NULL DEFAULT 'qualification', bracket_round INTEGER, bracket_position INTEGER, course TEXT, jump1_code TEXT, jump1_dd REAL, jump2_code TEXT, jump2_dd REAL, turns_score REAL, air_score REAL, speed_score REAL, total_score REAL, run_time REAL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS judge_scores (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, judge_id TEXT NOT NULL, score_type TEXT NOT NULL, raw_score REAL NOT NULL, submitted_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS dual_bracket (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, bracket_round INTEGER NOT NULL, bracket_position INTEGER NOT NULL, registration_id_blue TEXT, registration_id_red TEXT, winner_registration_id TEXT, status TEXT NOT NULL DEFAULT 'pending', is_small_final INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS jump_dd_table (id TEXT PRIMARY KEY, jump_code TEXT NOT NULL, dd_value REAL NOT NULL, ruleset TEXT NOT NULL DEFAULT 'uss', discipline TEXT NOT NULL DEFAULT 'mogul', notes TEXT)`,
    `CREATE TABLE IF NOT EXISTS officials (id TEXT PRIMARY KEY, meet_id TEXT NOT NULL, role TEXT NOT NULL, name TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS course_specs (id TEXT PRIMARY KEY, meet_id TEXT NOT NULL, course_name TEXT, width_m REAL, length_m REAL, pitch_deg REAL)`,
  ];
  for (const sql of ddl) await c.execute(sql);

  // Heats table (Phase 10a)
  await c.execute(`CREATE TABLE IF NOT EXISTS heats (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    heat_number INTEGER NOT NULL,
    heat_name TEXT,
    round TEXT NOT NULL DEFAULT 'qualification',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  // Audit log table (Phase 11b)
  await c.execute(`CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT,
    old_value TEXT,
    new_value TEXT,
    user_note TEXT
  )`);

  // Users table (v1.16.00)
  await c.execute(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'official',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  // App settings table (v1.23.00)
  await c.execute(`CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await c.execute(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('auth_enabled', '0')`);

  // Phase 5 migrations -- add columns if they do not already exist
  const migrations = [
    `ALTER TABLE registrations ADD COLUMN run_order INTEGER`,
    `ALTER TABLE events ADD COLUMN order_seed INTEGER`,
    // Phase 6a migrations
    `ALTER TABLE athletes ADD COLUMN fis_id TEXT`,
    `ALTER TABLE athletes ADD COLUMN nation TEXT`,
    `ALTER TABLE runs ADD COLUMN run_status TEXT`,
    `ALTER TABLE registrations ADD COLUMN round_scratched TEXT`,
    // Phase 6b migrations
    `ALTER TABLE runs ADD COLUMN hj_pending INTEGER NOT NULL DEFAULT 0`,
    // Phase 7 migrations
    `ALTER TABLE events ADD COLUMN usss_code_men TEXT`,
    `ALTER TABLE events ADD COLUMN usss_code_women TEXT`,
    // Phase 10a migrations
    `ALTER TABLE registrations ADD COLUMN heat_id TEXT`,
    `ALTER TABLE events ADD COLUMN qualifier_event_id TEXT`,
    `ALTER TABLE events ADD COLUMN finals_event_id TEXT`,
    // Phase 10b migrations
    `ALTER TABLE runs ADD COLUMN tl_carving REAL`,
    `ALTER TABLE runs ADD COLUMN tl_abext REAL`,
    `ALTER TABLE runs ADD COLUMN tl_upper_body REAL`,
    `ALTER TABLE runs ADD COLUMN tl_deduction REAL`,
    `ALTER TABLE events ADD COLUMN runoff_option TEXT NOT NULL DEFAULT 'runoff_to_4th'`,
    `ALTER TABLE dual_bracket ADD COLUMN seed_blue INTEGER`,
    `ALTER TABLE dual_bracket ADD COLUMN seed_red INTEGER`,
    `ALTER TABLE dual_bracket ADD COLUMN is_bye INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE registrations ADD COLUMN dual_seed REAL`,
    // Meet ranking
    `ALTER TABLE meets ADD COLUMN meet_ranking TEXT`,
    // Gender-specific DD and pace time from course length
    `ALTER TABLE jump_dd_table ADD COLUMN gender TEXT NOT NULL DEFAULT 'M'`,
    `ALTER TABLE events ADD COLUMN course_length REAL`,
    `ALTER TABLE events ADD COLUMN pace_time_override REAL`,
    // Single-course pace time overrides
    `ALTER TABLE course_specs ADD COLUMN pace_time_override_m REAL`,
    `ALTER TABLE course_specs ADD COLUMN pace_time_override_f REAL`,
    // Dual moguls temporary numbered-judge 5-point split scoring model
    `CREATE TABLE IF NOT EXISTS dual_judge_points (id TEXT PRIMARY KEY, match_id TEXT NOT NULL, judge_number INTEGER NOT NULL, blue_points INTEGER NOT NULL, red_points INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(match_id, judge_number))`,
    // Dual moguls seed method
    `ALTER TABLE events ADD COLUMN dual_seed_method TEXT NOT NULL DEFAULT 'random'`,
    // Active dual match tracking (for judge tablet polling)
    `ALTER TABLE events ADD COLUMN active_dual_match_id TEXT`,
    // Score spread threshold for HJ warning (v1.2)
    `ALTER TABLE events ADD COLUMN score_spread_threshold REAL NOT NULL DEFAULT 2.0`,
    // v1.3 migrations -- USSS People Database
    `CREATE TABLE IF NOT EXISTS usss_people (
      ussa_id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      last_name TEXT NOT NULL,
      first_name TEXT NOT NULL,
      division TEXT,
      gender TEXT,
      yob INTEGER,
      club_name TEXT,
      ae_points REAL,
      dm_points REAL,
      mo_points REAL,
      fis_id TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS usss_sync_status (
      id INTEGER PRIMARY KEY DEFAULT 1,
      last_sync_at TEXT,
      list_year TEXT,
      list_identifier TEXT,
      file_name TEXT,
      record_count INTEGER,
      source TEXT
    )`,
    // v1.3 -- USSS ID for judges and officials
    `ALTER TABLE judges ADD COLUMN ussa_id TEXT`,
    `ALTER TABLE officials ADD COLUMN ussa_id TEXT`,
    // v1.3 -- event_id for officials (per-event officials)
    `ALTER TABLE officials ADD COLUMN event_id TEXT`,
    // v1.3 -- event_date on events
    `ALTER TABLE events ADD COLUMN event_date TEXT`,
    // v1.6 -- dual moguls seeding & bracketing correction
    `ALTER TABLE athletes ADD COLUMN bib INTEGER`,
    `ALTER TABLE events ADD COLUMN dual_random_seed TEXT`,
    `ALTER TABLE registrations ADD COLUMN dual_seed_source TEXT`,
    `ALTER TABLE registrations ADD COLUMN dual_seed_source_value TEXT`,
    // v1.6.01 -- loser status token for dual bracket matches
    `ALTER TABLE dual_bracket ADD COLUMN loser_status TEXT`,
    // v1.6.08 -- manual score entry flag
    `ALTER TABLE runs ADD COLUMN manually_entered INTEGER NOT NULL DEFAULT 0`,
    // v1.6.09 -- per-judge TL component scores
    `ALTER TABLE judge_scores ADD COLUMN tl_carving REAL`,
    `ALTER TABLE judge_scores ADD COLUMN tl_abext REAL`,
    `ALTER TABLE judge_scores ADD COLUMN tl_upper_body REAL`,
    `ALTER TABLE judge_scores ADD COLUMN tl_deduction REAL`,
    // v1.7.04 -- per-event component scoring toggle (default ON)
    `ALTER TABLE events ADD COLUMN component_scoring INTEGER NOT NULL DEFAULT 1`,
    // v1.7.06 -- dual mogul time-tied flag on judge points
    `ALTER TABLE dual_judge_points ADD COLUMN time_tied INTEGER NOT NULL DEFAULT 0`,
    // v1.8.00 -- per-event score entry mode (tablet or paper)
    `ALTER TABLE events ADD COLUMN score_entry_mode TEXT NOT NULL DEFAULT 'tablet'`,
    // v1.8.03 -- run round status tracking
    `CREATE TABLE IF NOT EXISTS run_round_status (
      event_id TEXT NOT NULL,
      run_number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'not_started',
      review_message TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (event_id, run_number)
    )`,
    // v1.9.00 -- multi-run phase workflow for moguls
    `CREATE TABLE IF NOT EXISTS event_phases (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      phase_type TEXT NOT NULL,
      run_number INTEGER NOT NULL,
      label TEXT NOT NULL,
      run_order_method TEXT DEFAULT 'same',
      pass_through_count INTEGER DEFAULT 0,
      final_size INTEGER DEFAULT 0,
      q2_field_limit INTEGER,
      status TEXT NOT NULL DEFAULT 'not_started',
      review_message TEXT,
      sequence_order INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS phase_run_order (
      id TEXT PRIMARY KEY,
      phase_id TEXT NOT NULL,
      registration_id TEXT NOT NULL,
      run_order INTEGER NOT NULL,
      UNIQUE(phase_id, registration_id)
    )`,
    // v1.9.04 -- consolidate usss_code_men/usss_code_women into single usss_code
    `ALTER TABLE events ADD COLUMN usss_code TEXT`,
    // v1.11.00 -- number of jumps per run (1 for Devo, 2 for Comp Series/RQS)
    `ALTER TABLE events ADD COLUMN num_jumps INTEGER NOT NULL DEFAULT 2`,
    // v1.12.01 -- divisional championship flag
    `ALTER TABLE events ADD COLUMN is_divisional INTEGER NOT NULL DEFAULT 0`,
    // v1.16.00 -- event lock
    `ALTER TABLE events ADD COLUMN locked INTEGER NOT NULL DEFAULT 0`,
    // v1.16 -- short codes for shorter tablet URLs
    `ALTER TABLE meets ADD COLUMN short_code TEXT`,
    `ALTER TABLE events ADD COLUMN short_code TEXT`,
    `ALTER TABLE judges ADD COLUMN short_code TEXT`,
    `ALTER TABLE course_specs ADD COLUMN pace_standard TEXT NOT NULL DEFAULT 'usss'`,
    `ALTER TABLE events ADD COLUMN order_locked INTEGER NOT NULL DEFAULT 0`,
    // Athletes division column (from USSS People File)
    `ALTER TABLE athletes ADD COLUMN division TEXT`,
    // v1.16.17 -- dual mogul bracket complete -> HJ approval workflow
    `ALTER TABLE events ADD COLUMN dual_bracket_review_status TEXT`,
    // v1.16.23 -- FIS ICR 4207.3 tiebreaker: pre-DD air execution score
    `ALTER TABLE runs ADD COLUMN air_score_no_dd REAL`,
    // v1.16.30 -- dual mogul manual score entry override
    `ALTER TABLE events ADD COLUMN dual_manual_entry INTEGER NOT NULL DEFAULT 0`,
    // v1.16.31 -- soft-delete for master athlete database
    `ALTER TABLE athletes ADD COLUMN deleted_at TEXT`,
    // v1.18.00 -- aerials redesign: event sanction type, panel size, HJ-scoring, reduction method
    `ALTER TABLE events ADD COLUMN event_type TEXT NOT NULL DEFAULT 'usa_regional'`,
    `ALTER TABLE events ADD COLUMN aerials_panel_size INTEGER`,
    `ALTER TABLE events ADD COLUMN aerials_hj_scores INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE events ADD COLUMN aerials_reduction_method TEXT`,
    `ALTER TABLE judges ADD COLUMN judge_number INTEGER`,
    `ALTER TABLE runs ADD COLUMN aerials_model TEXT`,
    // v1.20.00 -- voice manual score entry transcript
    `ALTER TABLE runs ADD COLUMN voice_transcript TEXT`,
    // Training days (per-meet participant rosters with opt-out exclusions)
    `CREATE TABLE IF NOT EXISTS training_days (
      id TEXT PRIMARY KEY,
      meet_id TEXT NOT NULL,
      name TEXT NOT NULL,
      date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS training_day_exclusions (
      training_day_id TEXT NOT NULL,
      athlete_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (training_day_id, athlete_id)
    )`,
    // v1.25.02 -- hide event from public Live Scores + Viewer API listings (independent of locked)
    `ALTER TABLE events ADD COLUMN hide_livescores INTEGER NOT NULL DEFAULT 0`,
    // v1.26.00 (FS-4/FS-7) -- Q2 field cap for Phased Finals (NULL = no cap)
    `ALTER TABLE event_phases ADD COLUMN q2_field_limit INTEGER`,
    // NOTE: v1.26.00 briefly added dual_bracket.nj_blue/nj_red (FS-18 chop flags);
    // rolled back in v1.26.01 pending workflow clarification. Databases that booted
    // v1.26.00 retain the orphan nullable columns — harmless, intentionally not dropped.
    // v1.29.00 supersedes them with the single nj_call column below.
    // v1.29.00 (FS-18) -- dual mogul landing zone (chop) NJ call.
    // NULL | 'blue' | 'red' | 'both'; set by the Air Judge (HJ may set/clear).
    // Scoring effect applied at calculation time via engine.effectiveJudgePoints.
    `ALTER TABLE dual_bracket ADD COLUMN nj_call TEXT`,
    // v1.29.00 (JH 6304.3.5.1) -- Air Tied declaration on the Air Judge's row
    // (judge_number 3), stored blue 0 / red 0 with air_tied=1, mirroring the
    // J4 time_tied convention.
    `ALTER TABLE dual_judge_points ADD COLUMN air_tied INTEGER NOT NULL DEFAULT 0`,
    // v2.0.00 (Step 1) -- cloud adoption lock state + remote-judging flag.
    // Transport/lock state, NOT meet data: excluded from the sync manifest
    // (see NON_SYNC_COLUMNS in server/sync/protocol.js). All additive so a
    // v1.30.03 build runs cleanly against this database (Section 10).
    `ALTER TABLE meets ADD COLUMN adoption_status TEXT`,
    `ALTER TABLE meets ADD COLUMN adopted_at TEXT`,
    `ALTER TABLE meets ADD COLUMN sync_token_hash TEXT`,
    `ALTER TABLE meets ADD COLUMN last_sync_at TEXT`,
    `ALTER TABLE meets ADD COLUMN last_applied_seq INTEGER`,
    `ALTER TABLE meets ADD COLUMN remote_judging INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE meets ADD COLUMN release_code_hash TEXT`,
    `ALTER TABLE meets ADD COLUMN release_code_expires_at TEXT`,
    `ALTER TABLE meets ADD COLUMN released_at TEXT`,
    `ALTER TABLE meets ADD COLUMN released_by TEXT`,
    // v2.0.01 -- cloud auth: forced first-login password change. Set on admin
    // user creation / password reset; cleared by POST /api/auth/change-password.
    // users is NOT in the sync manifest (protocol.js), so no protocol impact;
    // inert in venue mode (PIN auth never reads it).
    `ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0`,
    // v2.0.01 -- belt-and-suspenders: admin.js has always written usernames
    // lowercase; normalize any hand-edited stragglers so the (now normalized)
    // login lookup always matches. No-op on healthy databases.
    `UPDATE users SET username = lower(trim(username)) WHERE username <> lower(trim(username))`,
  ];
  for (const sql of migrations) {
    try { await c.execute(sql); } catch (_) { /* column already exists -- safe to ignore */ }
  }

  // v2.0.00 (FR-11) -- the judge_scores app-level upsert (POST /runs/:runId/scores)
  // has no backing UNIQUE index, so racing INSERTs can produce duplicate
  // (run_id, judge_id, score_type) rows. Dedup first (keep the most recent
  // submission), then create the UNIQUE index OUTSIDE the error-swallowing
  // migration loop with explicit failure logging. The insert site in runs.js
  // retries as an UPDATE on constraint violation so a judge tablet never sees
  // a hard error. Additive (an index), so a v1.30.03 build runs cleanly
  // against this database.
  try {
    // L-7: the dedup is a ONE-TIME legacy migration — run it only when the
    // UNIQUE index does not exist yet. Once the index is in place duplicates
    // are impossible, and re-running the dedup on every boot would contradict
    // FR-9 (its rowid tiebreak could diverge cloud vs venue on adopted rows).
    const idx = await c.execute(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_judge_scores_run_judge_type'`
    );
    if (!idx.rows.length) {
      const dedup = await c.execute(
        `DELETE FROM judge_scores WHERE rowid NOT IN (
           SELECT rowid FROM (
             SELECT rowid, ROW_NUMBER() OVER (
               PARTITION BY run_id, judge_id, score_type
               ORDER BY submitted_at DESC, rowid DESC
             ) AS rn FROM judge_scores
           ) WHERE rn = 1
         )`
      );
      if (dedup.rowsAffected > 0) {
        console.log(`[FR-11 migration] removed ${dedup.rowsAffected} duplicate judge_scores rows (kept most recent per run/judge/type)`);
      }
      await c.execute(
        `CREATE UNIQUE INDEX idx_judge_scores_run_judge_type ON judge_scores(run_id, judge_id, score_type)`
      );
    }
  } catch (e) {
    // Loud, non-fatal: the app-level upsert still works without the index;
    // this must never prevent a production boot.
    console.error('[FR-11 migration] FAILED to dedup/create UNIQUE index on judge_scores(run_id, judge_id, score_type):', e.message);
  }

  // v2.0.00 (FR-9): every boot-time mutation below is guarded so it never
  // touches a row belonging to an adopted meet — a cloud restart mid-meet
  // must not mutate the venue's mirror. Adopted-meet subqueries:
  const NOT_ADOPTED_MEET = `(adoption_status IS NULL OR adoption_status <> 'adopted')`;
  const EVENT_NOT_ADOPTED = `meet_id NOT IN (SELECT id FROM meets WHERE adoption_status='adopted')`;
  const ATHLETE_NOT_LOCKED = `id NOT IN (
    SELECT r.athlete_id FROM registrations r
    JOIN events e ON e.id = r.event_id
    JOIN meets m ON m.id = e.meet_id
    WHERE m.adoption_status = 'adopted')`;

  // Migrate usss_code_men/usss_code_women → usss_code (one-time)
  try {
    await c.execute(`UPDATE events SET usss_code = CASE WHEN gender='M' THEN usss_code_men ELSE usss_code_women END WHERE usss_code IS NULL AND (usss_code_men IS NOT NULL OR usss_code_women IS NOT NULL) AND ${EVENT_NOT_ADOPTED}`);
  } catch (_) {}

  // Backfill short_code for existing rows that don't have one (FR-9: skip
  // adopted meets' rows)
  const SHORT_CODE_SCOPE = {
    meets: `short_code IS NULL AND ${NOT_ADOPTED_MEET}`,
    events: `short_code IS NULL AND ${EVENT_NOT_ADOPTED}`,
    judges: `short_code IS NULL AND event_id IN (SELECT id FROM events WHERE ${EVENT_NOT_ADOPTED})`,
  };
  for (const table of ['meets', 'events', 'judges']) {
    try {
      const rows = await queryAll(`SELECT id FROM ${table} WHERE ${SHORT_CODE_SCOPE[table]}`);
      for (const row of rows) {
        await c.execute(`UPDATE ${table} SET short_code=? WHERE id=?`, [shortCode(), row.id]);
      }
    } catch (_) {}
  }

  // Normalize gender values to single-letter codes ('M'/'F') on every startup
  try {
    await c.execute(`UPDATE events   SET gender = 'M' WHERE gender IN ('male',   'Male'  ) AND ${EVENT_NOT_ADOPTED}`);
    await c.execute(`UPDATE events   SET gender = 'F' WHERE gender IN ('female', 'Female') AND ${EVENT_NOT_ADOPTED}`);
    await c.execute(`UPDATE athletes SET gender = 'M' WHERE gender IN ('male',   'Male'  ) AND ${ATHLETE_NOT_LOCKED}`);
    await c.execute(`UPDATE athletes SET gender = 'F' WHERE gender IN ('female', 'Female') AND ${ATHLETE_NOT_LOCKED}`);
  } catch (_) {}

  // v1.6 -- one-time backfill of athletes.bib from each athlete's most
  // recent non-null registration bib.  Runs exactly once, gated on
  // detecting that no athlete has a non-null bib yet.
  try {
    const anyBib = await queryOne("SELECT COUNT(*) AS cnt FROM athletes WHERE bib IS NOT NULL");
    if (anyBib && parseInt(anyBib.cnt) === 0) {
      // FR-9: skip athletes locked by a current venue adoption
      const athletes = await queryAll(`SELECT id FROM athletes WHERE ${ATHLETE_NOT_LOCKED}`);
      let backfilled = 0;
      for (const a of athletes) {
        const recent = await queryOne(
          `SELECT bib_number FROM registrations
           WHERE athlete_id = ? AND bib_number IS NOT NULL
           ORDER BY created_at DESC LIMIT 1`,
          [a.id]
        );
        if (recent && recent.bib_number != null) {
          await execute(`UPDATE athletes SET bib = ? WHERE id = ?`, [recent.bib_number, a.id]);
          backfilled++;
        }
      }
      if (backfilled > 0) {
        console.log(`[v1.6 migration] athletes.bib backfilled for ${backfilled} athletes`);
      }
    }
  } catch (e) {
    console.log('[v1.6 migration] athletes.bib backfill skipped:', e.message);
  }

  // v1.25.00 (A-3) -- unify the role model: event_admin is a legacy alias,
  // migrate existing rows to system_admin. Idempotent.
  try {
    await c.execute(`UPDATE users SET role='system_admin', updated_at=datetime('now') WHERE role='event_admin'`);
  } catch (e) {
    console.log('[v1.25 migration] event_admin role migration skipped:', e.message);
  }

  await seedJumpDDs();
  await seedAerialsDDs();
  await backfillAirScoreNoDd();
}

// v1.16.23 / v1.18.01 -- backfill air_score_no_dd on runs that don't have it yet.
// For each completed run with NULL air_score_no_dd, compute the pre-DD raw air
// execution score from judge_scores (avg of jump1 + avg of jump2). Tries legacy
// score types ('air_jump1' / 'air_jump2' — moguls + legacy aerials) first, then
// falls back to v2 aerials types ('ae_air_j1' / 'ae_air_j2'). Falls back further
// to runs.air_score for manually-entered rows with no per-judge data.
async function backfillAirScoreNoDd() {
  try {
    // v2.0.00 (FR-9): never backfill runs belonging to an adopted meet.
    const rows = await queryAll(
      `SELECT id, air_score FROM runs WHERE air_score_no_dd IS NULL AND status='complete'
         AND event_id IN (SELECT e.id FROM events e JOIN meets m ON m.id = e.meet_id
                          WHERE m.adoption_status IS NULL OR m.adoption_status <> 'adopted')`
    );
    if (rows.length === 0) return;
    let updated = 0;
    for (const r of rows) {
      const j1 = await queryOne(
        `SELECT AVG(raw_score) AS avg, COUNT(*) AS n FROM judge_scores WHERE run_id=? AND score_type='air_jump1'`,
        [r.id]
      );
      const j2 = await queryOne(
        `SELECT AVG(raw_score) AS avg, COUNT(*) AS n FROM judge_scores WHERE run_id=? AND score_type='air_jump2'`,
        [r.id]
      );
      let n1 = j1 ? parseInt(j1.n) : 0;
      let n2 = j2 ? parseInt(j2.n) : 0;
      let a1 = n1 > 0 ? parseFloat(j1.avg) : 0;
      let a2 = n2 > 0 ? parseFloat(j2.avg) : 0;

      // v1.18.01 — fall back to aerials v2 score types
      if (n1 === 0 && n2 === 0) {
        const v1 = await queryOne(
          `SELECT AVG(raw_score) AS avg, COUNT(*) AS n FROM judge_scores WHERE run_id=? AND score_type='ae_air_j1'`,
          [r.id]
        );
        const v2 = await queryOne(
          `SELECT AVG(raw_score) AS avg, COUNT(*) AS n FROM judge_scores WHERE run_id=? AND score_type='ae_air_j2'`,
          [r.id]
        );
        n1 = v1 ? parseInt(v1.n) : 0;
        n2 = v2 ? parseInt(v2.n) : 0;
        a1 = n1 > 0 ? parseFloat(v1.avg) : 0;
        a2 = n2 > 0 ? parseFloat(v2.avg) : 0;
      }

      let value;
      if (n1 === 0 && n2 === 0) {
        value = r.air_score; // manual entry without per-judge data
      } else {
        const sum = n2 === 0 ? a1 * 2 : a1 + a2;
        value = Math.floor(sum * 100) / 100;
      }
      await execute(`UPDATE runs SET air_score_no_dd=? WHERE id=?`, [value, r.id]);
      updated++;
    }
    if (updated > 0) console.log(`[air_score_no_dd backfill] backfilled for ${updated} runs`);
  } catch (e) {
    console.log('[air_score_no_dd backfill] skipped:', e.message);
  }
}

async function seedJumpDDs() {
  const existing = await queryOne('SELECT COUNT(*) as cnt FROM jump_dd_table');
  if (existing && parseInt(existing.cnt) > 0) {
    // Check if gender-specific data exists; if not, clear and reseed
    const gendered = await queryOne("SELECT COUNT(*) as cnt FROM jump_dd_table WHERE gender='F' AND discipline='mogul'");
    if (gendered && parseInt(gendered.cnt) > 0) {
      // v1.7.04 -- ensure N (Neutral) and NJ (No Jump) codes exist in existing databases
      const hasN = await queryOne("SELECT COUNT(*) as cnt FROM jump_dd_table WHERE jump_code='N' AND discipline='mogul'");
      if (!hasN || parseInt(hasN.cnt) === 0) {
        const extras = [
          { code: 'N',  ddM: 0.360, ddF: 0.460, notes: 'Neutral' },
          { code: 'NJ', ddM: 0.00,  ddF: 0.00,  notes: 'No Jump' },
        ];
        const stmts = [];
        for (const j of extras) {
          stmts.push({ sql: `INSERT OR IGNORE INTO jump_dd_table (id,jump_code,dd_value,ruleset,discipline,gender,notes) VALUES (?,?,?,'uss','mogul','M',?)`, args: [uuidv4(), j.code, j.ddM, j.notes] });
          stmts.push({ sql: `INSERT OR IGNORE INTO jump_dd_table (id,jump_code,dd_value,ruleset,discipline,gender,notes) VALUES (?,?,?,'uss','mogul','F',?)`, args: [uuidv4(), j.code, j.ddF, j.notes] });
          const dualM = Math.round(j.ddM * 1.25 * 10000) / 10000;
          stmts.push({ sql: `INSERT OR IGNORE INTO jump_dd_table (id,jump_code,dd_value,ruleset,discipline,gender,notes) VALUES (?,?,?,'uss','dual_mogul','M',?)`, args: [uuidv4(), j.code, dualM, j.notes + ' (dual)'] });
          const dualF = Math.round(j.ddF * 1.25 * 10000) / 10000;
          stmts.push({ sql: `INSERT OR IGNORE INTO jump_dd_table (id,jump_code,dd_value,ruleset,discipline,gender,notes) VALUES (?,?,?,'uss','dual_mogul','F',?)`, args: [uuidv4(), j.code, dualF, j.notes + ' (dual)'] });
        }
        await getClient().batch(stmts, 'write');
      }

      // v1.16.08 -- fix upright DD values: base values were missing per-letter modifiers
      const checkS = await queryOne("SELECT dd_value FROM jump_dd_table WHERE jump_code='S' AND gender='F' AND discipline='mogul'");
      if (checkS && Math.abs(parseFloat(checkS.dd_value) - 0.50) < 0.001) {
        // Wrong values detected — update all upright codes across mogul + dual_mogul
        const fixes = [
          { code: 'S',     mogM: 0.38, mogF: 0.48 },
          { code: 'T',     mogM: 0.38, mogF: 0.48 },
          { code: 'D',     mogM: 0.41, mogF: 0.51 },
          { code: 'X',     mogM: 0.41, mogF: 0.51 },
          { code: 'Y',     mogM: 0.41, mogF: 0.51 },
          { code: 'M',     mogM: 0.41, mogF: 0.51 },
          { code: 'K',     mogM: 0.41, mogF: 0.51 },
          // Z stays 0.40/0.50 (modifier is 0)
          { code: 'SS',    mogM: 0.49, mogF: 0.59 },
          { code: 'TS',    mogM: 0.49, mogF: 0.59 },
          { code: 'TT',    mogM: 0.49, mogF: 0.59 },
          { code: 'TD',    mogM: 0.52, mogF: 0.62 },
          { code: 'DTS',   mogM: 0.62, mogF: 0.72 },
          { code: 'TST',   mogM: 0.59, mogF: 0.69 },
          { code: 'TTS',   mogM: 0.59, mogF: 0.69 },
          { code: 'TTSS',  mogM: 0.68, mogF: 0.78 },
          { code: 'TTSSD', mogM: 0.79, mogF: 0.89 },
        ];
        const fixStmts = [];
        for (const f of fixes) {
          fixStmts.push({ sql: `UPDATE jump_dd_table SET dd_value=? WHERE jump_code=? AND discipline='mogul' AND gender='M'`, args: [f.mogM, f.code] });
          fixStmts.push({ sql: `UPDATE jump_dd_table SET dd_value=? WHERE jump_code=? AND discipline='mogul' AND gender='F'`, args: [f.mogF, f.code] });
          const dualM = Math.round(f.mogM * 1.25 * 10000) / 10000;
          fixStmts.push({ sql: `UPDATE jump_dd_table SET dd_value=? WHERE jump_code=? AND discipline='dual_mogul' AND gender='M'`, args: [dualM, f.code] });
          const dualF = Math.round(f.mogF * 1.25 * 10000) / 10000;
          fixStmts.push({ sql: `UPDATE jump_dd_table SET dd_value=? WHERE jump_code=? AND discipline='dual_mogul' AND gender='F'`, args: [dualF, f.code] });
        }
        await getClient().batch(fixStmts, 'write');
        console.log('DD migration: fixed upright jump code values (base + modifier)');
      }

      // v1.24.00 (F-6) -- add missing upright combos + re-value stand-alone Grab.
      // Sentinel: old databases store G as the 0.14 grab multiplier or lack STS.
      const checkG   = await queryOne("SELECT dd_value FROM jump_dd_table WHERE jump_code='G' AND gender='M' AND discipline='mogul'");
      const checkSTS = await queryOne("SELECT COUNT(*) as cnt FROM jump_dd_table WHERE jump_code='STS' AND discipline='mogul'");
      const grabStale = checkG && Math.abs(parseFloat(checkG.dd_value) - 0.14) < 0.001;
      const stsMissing = !checkSTS || parseInt(checkSTS.cnt) === 0;
      if (grabStale || stsMissing) {
        const f6 = [
          { code: 'ST',  mogM: 0.49, mogF: 0.59 },
          { code: 'STS', mogM: 0.59, mogF: 0.69 },
          { code: 'TTT', mogM: 0.59, mogF: 0.69 },
          { code: 'DD',  mogM: 0.55, mogF: 0.65 },
          { code: 'G',   mogM: 0.54, mogF: 0.64 }, // re-value stand-alone grab
        ];
        const f6Stmts = [];
        for (const f of f6) {
          const dualM = Math.round(f.mogM * 1.25 * 10000) / 10000;
          const dualF = Math.round(f.mogF * 1.25 * 10000) / 10000;
          // INSERT OR IGNORE seeds missing combos; the follow-up UPDATE corrects
          // G (which already exists at 0.14) and is a no-op for freshly inserted rows.
          f6Stmts.push({ sql: `INSERT OR IGNORE INTO jump_dd_table (id,jump_code,dd_value,ruleset,discipline,gender,notes) VALUES (?,?,?,'uss','mogul','M',?)`, args: [uuidv4(), f.code, f.mogM, f.code] });
          f6Stmts.push({ sql: `INSERT OR IGNORE INTO jump_dd_table (id,jump_code,dd_value,ruleset,discipline,gender,notes) VALUES (?,?,?,'uss','mogul','F',?)`, args: [uuidv4(), f.code, f.mogF, f.code] });
          f6Stmts.push({ sql: `INSERT OR IGNORE INTO jump_dd_table (id,jump_code,dd_value,ruleset,discipline,gender,notes) VALUES (?,?,?,'uss','dual_mogul','M',?)`, args: [uuidv4(), f.code, dualM, f.code + ' (dual)'] });
          f6Stmts.push({ sql: `INSERT OR IGNORE INTO jump_dd_table (id,jump_code,dd_value,ruleset,discipline,gender,notes) VALUES (?,?,?,'uss','dual_mogul','F',?)`, args: [uuidv4(), f.code, dualF, f.code + ' (dual)'] });
          f6Stmts.push({ sql: `UPDATE jump_dd_table SET dd_value=? WHERE jump_code=? AND discipline='mogul' AND gender='M'`, args: [f.mogM, f.code] });
          f6Stmts.push({ sql: `UPDATE jump_dd_table SET dd_value=? WHERE jump_code=? AND discipline='mogul' AND gender='F'`, args: [f.mogF, f.code] });
          f6Stmts.push({ sql: `UPDATE jump_dd_table SET dd_value=? WHERE jump_code=? AND discipline='dual_mogul' AND gender='M'`, args: [dualM, f.code] });
          f6Stmts.push({ sql: `UPDATE jump_dd_table SET dd_value=? WHERE jump_code=? AND discipline='dual_mogul' AND gender='F'`, args: [dualF, f.code] });
        }
        await getClient().batch(f6Stmts, 'write');
        console.log('DD migration: added ST/STS/TTT/DD combos + re-valued stand-alone Grab (F-6)');
      }

      // v1.26.00 (FS-13, FIS JH 6204.3.7) -- basic vs advanced grabs.
      // Advanced grab 'G' modifier drops +0.14 -> +0.12 (every G code -0.02);
      // new lowercase 'g' codes are added at +0.05 (= new G value - 0.07).
      // MAG will conduct a full DD chart review at the start of the quad; a
      // further re-seed may follow when the official 2026-27 chart publishes.
      // Sentinels: 3G at 0.82 (pre-1.26 value) gates the UPDATEs; a missing
      // 'bg' row gates the INSERTs — so hand-edited G values are not stomped
      // twice, while the g codes still seed. Idempotent.
      const check3G = await queryOne("SELECT dd_value FROM jump_dd_table WHERE jump_code='3G' AND gender='M' AND discipline='mogul' AND ruleset='uss'");
      const checkBg = await queryOne("SELECT COUNT(*) as cnt FROM jump_dd_table WHERE jump_code='bg' AND discipline='mogul'");
      const grabStale26 = check3G && Math.abs(parseFloat(check3G.dd_value) - 0.82) < 0.001;
      const gMissing = !checkBg || parseInt(checkBg.cnt) === 0;
      if (grabStale26 || gMissing) {
        // Re-valued advanced (G) codes: mogul M/F; dual = mogul x 1.25.
        const gAdvanced = [
          { code: 'G',    mogM: 0.52, mogF: 0.62 },
          { code: '3G',   mogM: 0.80, mogF: 0.90 },
          { code: '7G',   mogM: 0.99, mogF: 1.09 },
          { code: '10G',  mogM: 1.18, mogF: 1.28 },
          { code: '3oG',  mogM: 0.80, mogF: 0.90 },
          { code: '7oG',  mogM: 0.99, mogF: 1.09 },
          { code: '10oG', mogM: 1.18, mogF: 1.28 },
          { code: '14oG', mogM: 1.37, mogF: 1.47 },
          { code: 'bG',   mogM: 0.80, mogF: 0.90 },
          { code: 'fG',   mogM: 0.80, mogF: 0.90 },
          { code: 'lG',   mogM: 0.80, mogF: 0.90 },
          { code: 'lGF',  mogM: 0.99, mogF: 1.09 },
        ];
        // New basic (g) codes at +0.05.
        const gBasic = [
          { code: 'g',    mogM: 0.45, mogF: 0.55, notes: 'Basic Grab (Single + g)' },
          { code: '3g',   mogM: 0.73, mogF: 0.83, notes: '360 Basic Grab' },
          { code: '7g',   mogM: 0.92, mogF: 1.02, notes: '720 Basic Grab' },
          { code: '10g',  mogM: 1.11, mogF: 1.21, notes: '1080 Basic Grab' },
          { code: '3og',  mogM: 0.73, mogF: 0.83, notes: 'Off Axis 360 Basic Grab' },
          { code: '7og',  mogM: 0.92, mogF: 1.02, notes: 'Off Axis 720 Basic Grab' },
          { code: '10og', mogM: 1.11, mogF: 1.21, notes: 'Off Axis 1080 Basic Grab' },
          { code: '14og', mogM: 1.30, mogF: 1.40, notes: 'Off Axis 1440 Basic Grab' },
          { code: 'bg',   mogM: 0.73, mogF: 0.83, notes: 'Back Basic Grab' },
          { code: 'fg',   mogM: 0.73, mogF: 0.83, notes: 'Front Basic Grab' },
          { code: 'lg',   mogM: 0.73, mogF: 0.83, notes: 'Loop Basic Grab' },
          { code: 'lgF',  mogM: 0.92, mogF: 1.02, notes: 'Loop Basic Grab Full' },
        ];
        const fs13Stmts = [];
        if (grabStale26) {
          for (const f of gAdvanced) {
            const dualM = Math.round(f.mogM * 1.25 * 10000) / 10000;
            const dualF = Math.round(f.mogF * 1.25 * 10000) / 10000;
            fs13Stmts.push({ sql: `UPDATE jump_dd_table SET dd_value=? WHERE jump_code=? AND discipline='mogul' AND gender='M'`, args: [f.mogM, f.code] });
            fs13Stmts.push({ sql: `UPDATE jump_dd_table SET dd_value=? WHERE jump_code=? AND discipline='mogul' AND gender='F'`, args: [f.mogF, f.code] });
            fs13Stmts.push({ sql: `UPDATE jump_dd_table SET dd_value=? WHERE jump_code=? AND discipline='dual_mogul' AND gender='M'`, args: [dualM, f.code] });
            fs13Stmts.push({ sql: `UPDATE jump_dd_table SET dd_value=? WHERE jump_code=? AND discipline='dual_mogul' AND gender='F'`, args: [dualF, f.code] });
          }
        }
        if (gMissing) {
          for (const f of gBasic) {
            const dualM = Math.round(f.mogM * 1.25 * 10000) / 10000;
            const dualF = Math.round(f.mogF * 1.25 * 10000) / 10000;
            fs13Stmts.push({ sql: `INSERT OR IGNORE INTO jump_dd_table (id,jump_code,dd_value,ruleset,discipline,gender,notes) VALUES (?,?,?,'uss','mogul','M',?)`, args: [uuidv4(), f.code, f.mogM, f.notes] });
            fs13Stmts.push({ sql: `INSERT OR IGNORE INTO jump_dd_table (id,jump_code,dd_value,ruleset,discipline,gender,notes) VALUES (?,?,?,'uss','mogul','F',?)`, args: [uuidv4(), f.code, f.mogF, f.notes] });
            fs13Stmts.push({ sql: `INSERT OR IGNORE INTO jump_dd_table (id,jump_code,dd_value,ruleset,discipline,gender,notes) VALUES (?,?,?,'uss','dual_mogul','M',?)`, args: [uuidv4(), f.code, dualM, f.notes + ' (dual)'] });
            fs13Stmts.push({ sql: `INSERT OR IGNORE INTO jump_dd_table (id,jump_code,dd_value,ruleset,discipline,gender,notes) VALUES (?,?,?,'uss','dual_mogul','F',?)`, args: [uuidv4(), f.code, dualF, f.notes + ' (dual)'] });
          }
        }
        if (fs13Stmts.length) {
          await getClient().batch(fs13Stmts, 'write');
          console.log('DD migration: FS-13 basic/advanced grabs — G codes re-valued to +0.12, g codes added at +0.05');
        }
      }

      return;
    }
    // Wipe old non-gendered data and reseed
    await execute("DELETE FROM jump_dd_table WHERE discipline IN ('mogul','dual_mogul')");
  }

  // FIS Mogul DD chart (November 2023) -- gender-specific values
  const jumps = [
    // Straight Jumps (uprights)
    // DD = base (Single/Double/Triple/Quad/Quint) + sum of per-letter modifiers
    // Modifiers: T=-0.02, S=-0.02, D=+0.01, X=+0.01, Y=+0.01, M=+0.01, K=+0.01, Z=0
    { code: 'S',    ddM: 0.38, ddF: 0.48, notes: 'Single (Spread)' },
    { code: 'T',    ddM: 0.38, ddF: 0.48, notes: 'Single (Twister)' },
    { code: 'D',    ddM: 0.41, ddF: 0.51, notes: 'Single (Daffy)' },
    { code: 'X',    ddM: 0.41, ddF: 0.51, notes: 'Single (Iron Cross)' },
    { code: 'Y',    ddM: 0.41, ddF: 0.51, notes: 'Single (Back Scratcher)' },
    { code: 'M',    ddM: 0.41, ddF: 0.51, notes: 'Single (Mule Kick)' },
    { code: 'K',    ddM: 0.41, ddF: 0.51, notes: 'Single (Kosak)' },
    { code: 'Z',    ddM: 0.40, ddF: 0.50, notes: 'Single (Zudnick)' },
    { code: 'SS',   ddM: 0.49, ddF: 0.59, notes: 'Double Spread' },
    { code: 'TS',   ddM: 0.49, ddF: 0.59, notes: 'Twister-Spread' },
    { code: 'TT',   ddM: 0.49, ddF: 0.59, notes: 'Double Twister' },
    { code: 'TD',   ddM: 0.52, ddF: 0.62, notes: 'Twister-Daffy' },
    { code: 'DTS',  ddM: 0.62, ddF: 0.72, notes: 'Daffy-Twister-Spread' },
    { code: 'TST',  ddM: 0.59, ddF: 0.69, notes: 'Twister-Spread-Twister' },
    { code: 'TTS',  ddM: 0.59, ddF: 0.69, notes: 'Triple (Twister-Twister-Spread)' },
    { code: 'TTSS', ddM: 0.68, ddF: 0.78, notes: 'Quad' },
    { code: 'TTSSD',ddM: 0.79, ddF: 0.89, notes: 'Quint' },
    // Additional upright combinations used in competition (base + per-letter modifier).
    // (Review finding F-6, 06-10-26.)
    { code: 'ST',   ddM: 0.49, ddF: 0.59, notes: 'Spread-Twister (Double)' },
    { code: 'STS',  ddM: 0.59, ddF: 0.69, notes: 'Spread-Twister-Spread (Triple)' },
    { code: 'TTT',  ddM: 0.59, ddF: 0.69, notes: 'Triple Twister' },
    { code: 'DD',   ddM: 0.55, ddF: 0.65, notes: 'Double Daffy' },
    // Jump Multipliers
    { code: 'p',    ddM: 0.03, ddF: 0.03, notes: 'Position (multiplier)' },
    // v1.26.00 (FS-13, FIS JH 6204.3.7): basic grab 'g' = +0.05, advanced
    // grab 'G' = +0.12 (was +0.14). Codes are case-exact — bg and bG are
    // different jumps with different DDs.
    { code: 'G',    ddM: 0.52, ddF: 0.62, notes: 'Advanced Grab (Single + G)' },
    { code: 'g',    ddM: 0.45, ddF: 0.55, notes: 'Basic Grab (Single + g)' },
    // Rotational Jumps
    { code: '3',    ddM: 0.68, ddF: 0.78, notes: '360' },
    { code: '3p',   ddM: 0.71, ddF: 0.81, notes: '360 Position' },
    { code: '3G',   ddM: 0.80, ddF: 0.90, notes: '360 Advanced Grab' },
    { code: '3g',   ddM: 0.73, ddF: 0.83, notes: '360 Basic Grab' },
    { code: '7',    ddM: 0.85, ddF: 0.95, notes: '720' },
    { code: '7p',   ddM: 0.88, ddF: 0.98, notes: '720 Position' },
    { code: '7G',   ddM: 0.99, ddF: 1.09, notes: '720 Advanced Grab' },
    { code: '7g',   ddM: 0.92, ddF: 1.02, notes: '720 Basic Grab' },
    { code: '10',   ddM: 1.02, ddF: 1.12, notes: '1080' },
    { code: '10p',  ddM: 1.05, ddF: 1.15, notes: '1080 Position' },
    { code: '10G',  ddM: 1.18, ddF: 1.28, notes: '1080 Advanced Grab' },
    { code: '10g',  ddM: 1.11, ddF: 1.21, notes: '1080 Basic Grab' },
    // Off Axis Jumps
    { code: '3op',  ddM: 0.71, ddF: 0.81, notes: 'Off Axis 360 Position' },
    { code: '3oG',  ddM: 0.80, ddF: 0.90, notes: 'Off Axis 360 Advanced Grab' },
    { code: '3og',  ddM: 0.73, ddF: 0.83, notes: 'Off Axis 360 Basic Grab' },
    { code: '7op',  ddM: 0.88, ddF: 0.98, notes: 'Off Axis 720 Position' },
    { code: '7oG',  ddM: 0.99, ddF: 1.09, notes: 'Off Axis 720 Advanced Grab' },
    { code: '7og',  ddM: 0.92, ddF: 1.02, notes: 'Off Axis 720 Basic Grab' },
    { code: '10op', ddM: 1.05, ddF: 1.15, notes: 'Off Axis 1080 Position' },
    { code: '10oG', ddM: 1.18, ddF: 1.28, notes: 'Off Axis 1080 Advanced Grab' },
    { code: '10og', ddM: 1.11, ddF: 1.21, notes: 'Off Axis 1080 Basic Grab' },
    { code: '14op', ddM: 1.22, ddF: 1.32, notes: 'Off Axis 1440 Position' },
    { code: '14oG', ddM: 1.37, ddF: 1.47, notes: 'Off Axis 1440 Advanced Grab' },
    { code: '14og', ddM: 1.30, ddF: 1.40, notes: 'Off Axis 1440 Basic Grab' },
    // Inverted Jumps
    { code: 'bP',   ddM: 0.68, ddF: 0.78, notes: 'Back Pike' },
    { code: 'bT',   ddM: 0.68, ddF: 0.78, notes: 'Back Tuck' },
    { code: 'bL',   ddM: 0.71, ddF: 0.81, notes: 'Back Lay' },
    { code: 'bp',   ddM: 0.71, ddF: 0.81, notes: 'Back Position' },
    { code: 'bG',   ddM: 0.80, ddF: 0.90, notes: 'Back Advanced Grab' },
    { code: 'bg',   ddM: 0.73, ddF: 0.83, notes: 'Back Basic Grab' },
    { code: 'bF',   ddM: 0.88, ddF: 0.98, notes: 'Back Full' },
    { code: 'bdF',  ddM: 1.05, ddF: 1.15, notes: 'Back Double Full' },
    { code: 'btF',  ddM: 1.22, ddF: 1.32, notes: 'Back Triple Full' },
    { code: 'fT',   ddM: 0.68, ddF: 0.78, notes: 'Front Tuck' },
    { code: 'fP',   ddM: 0.68, ddF: 0.78, notes: 'Front Pike' },
    { code: 'fp',   ddM: 0.71, ddF: 0.81, notes: 'Front Position' },
    { code: 'fG',   ddM: 0.80, ddF: 0.90, notes: 'Front Advanced Grab' },
    { code: 'fg',   ddM: 0.73, ddF: 0.83, notes: 'Front Basic Grab' },
    { code: 'fF',   ddM: 0.88, ddF: 0.98, notes: 'Front Full' },
    // Loop Jumps
    { code: 'l',    ddM: 0.68, ddF: 0.78, notes: 'Loop' },
    { code: 'lp',   ddM: 0.71, ddF: 0.81, notes: 'Loop Position' },
    { code: 'lG',   ddM: 0.80, ddF: 0.90, notes: 'Loop Advanced Grab' },
    { code: 'lg',   ddM: 0.73, ddF: 0.83, notes: 'Loop Basic Grab' },
    { code: 'lF',   ddM: 0.85, ddF: 0.95, notes: 'Loop Full' },
    { code: 'lpF',  ddM: 0.88, ddF: 0.98, notes: 'Loop Position Full' },
    { code: 'lGF',  ddM: 0.99, ddF: 1.09, notes: 'Loop Advanced Grab Full' },
    { code: 'lgF',  ddM: 0.92, ddF: 1.02, notes: 'Loop Basic Grab Full' },
    // Special codes
    { code: 'N',    ddM: 0.360, ddF: 0.460, notes: 'Neutral' },
    { code: 'NJ',   ddM: 0.00,  ddF: 0.00,  notes: 'No Jump' },
  ];

  const stmts = [];
  for (const j of jumps) {
    // Mogul -- Men
    stmts.push({ sql: `INSERT OR IGNORE INTO jump_dd_table (id,jump_code,dd_value,ruleset,discipline,gender,notes) VALUES (?,?,?,'uss','mogul','M',?)`, args: [uuidv4(), j.code, j.ddM, j.notes] });
    // Mogul -- Women
    stmts.push({ sql: `INSERT OR IGNORE INTO jump_dd_table (id,jump_code,dd_value,ruleset,discipline,gender,notes) VALUES (?,?,?,'uss','mogul','F',?)`, args: [uuidv4(), j.code, j.ddF, j.notes] });
    // Dual Mogul -- Men (1.25x multiplier per FIS)
    const dualM = Math.round(j.ddM * 1.25 * 10000) / 10000;
    stmts.push({ sql: `INSERT OR IGNORE INTO jump_dd_table (id,jump_code,dd_value,ruleset,discipline,gender,notes) VALUES (?,?,?,'uss','dual_mogul','M',?)`, args: [uuidv4(), j.code, dualM, j.notes + ' (dual)'] });
    // Dual Mogul -- Women (1.25x multiplier per FIS)
    const dualF = Math.round(j.ddF * 1.25 * 10000) / 10000;
    stmts.push({ sql: `INSERT OR IGNORE INTO jump_dd_table (id,jump_code,dd_value,ruleset,discipline,gender,notes) VALUES (?,?,?,'uss','dual_mogul','F',?)`, args: [uuidv4(), j.code, dualF, j.notes + ' (dual)'] });
  }
  await getClient().batch(stmts, 'write');
}

// USSS Appendix C 2026 Aerials Degree of Difficulty chart.
// Source: 2026 U.S. Ski & Snowboard Freestyle/Freeski Competition Guide,
// Appendix C, page 99 ("U.S. Ski & Snowboard Aerials Degree of Difficulty Chart").
//
// Spin family DD formula (per chart):
//   Spin alone: 3=1.68, 7=1.85, 10=2.20
//   Spin + Upright:        Spin DD + 0.02
//   Spin + Upright + Grab: Spin DD + 0.02 + 0.10
function buildAerialsDDChart() {
  const SPIN = { '3': 1.68, '7': 1.85, '10': 2.20 };
  const UPRIGHT_LETTERS = ['S','D','T','X','G','Tk','Pk'];

  const rows = [
    // Base maneuvers from the chart
    { code: 'N',   dd: 1.40, notes: 'Neutral (Straight Air)' },
    { code: 'Tk',  dd: 1.48, notes: 'Tuck Jump' },
    { code: 'Pk',  dd: 1.48, notes: 'Pike Jump' },
    { code: 'S',   dd: 1.48, notes: 'Spread Eagle' },
    { code: 'D',   dd: 1.48, notes: 'Daffy' },
    { code: 'T',   dd: 1.48, notes: 'Twister' },
    { code: 'X',   dd: 1.48, notes: 'Iron Cross' },
    { code: 'G',   dd: 1.48, notes: 'Grab' },
    { code: 'dG',  dd: 1.55, notes: 'Double Grab' },
    // Double Upright examples (combination of two uprights)
    { code: 'TS',  dd: 1.55, notes: 'Double Upright (Twister-Spread)' },
    { code: 'DT',  dd: 1.55, notes: 'Double Upright (Daffy-Twister)' },
    // Triple Upright example
    { code: 'DTS', dd: 1.60, notes: 'Triple Upright (Daffy-Twister-Spread)' },
    // Spins
    { code: '3',   dd: 1.68, notes: '360' },
    { code: '7',   dd: 1.85, notes: '720' },
    { code: '10',  dd: 2.20, notes: '1080' },
    // Back family (single flips with various positions / twists)
    { code: 'bT',   dd: 2.00,  notes: 'Back Tuck' },
    { code: 'bP',   dd: 2.00,  notes: 'Back Pike' },
    { code: 'bX',   dd: 1.85,  notes: 'Back + Upright/Free pos.' },
    { code: 'bL',   dd: 2.05,  notes: 'Back Layout' },
    { code: 'bF',   dd: 2.30,  notes: 'Back Full' },
    { code: 'bdF',  dd: 2.40,  notes: 'Back Double Full' },
    { code: 'bTT',  dd: 2.40,  notes: 'Back Tuck Tuck' },
    { code: 'bLT',  dd: 2.60,  notes: 'Back Lay Tuck' },
    { code: 'bLL',  dd: 2.65,  notes: 'Back Lay Lay' },
    { code: 'bFT',  dd: 2.85,  notes: 'Back Full Tuck' },
    { code: 'bLF',  dd: 2.90,  notes: 'Back Lay Full' },
    { code: 'bFF',  dd: 3.15,  notes: 'Back Full Full' },
    { code: 'bdFF', dd: 3.525, notes: 'Back Double Full Full (in/out)' },
    { code: 'bFdF', dd: 3.525, notes: 'Back Full Double Full (in/out, alias of bdFF)' },
  ];

  // Spin + Upright family (DD = spin + 0.02), one row per upright letter.
  for (const [spinCode, spinDd] of Object.entries(SPIN)) {
    for (const u of UPRIGHT_LETTERS) {
      rows.push({
        code: `${spinCode}${u}`,
        dd: Math.round((spinDd + 0.02) * 1000) / 1000,
        notes: `Spin + Upright (${spinCode} + ${u})`,
      });
    }
    // Spin + Upright + Grab family (DD = spin + 0.02 + 0.10).
    for (const u of UPRIGHT_LETTERS) {
      rows.push({
        code: `${spinCode}${u}G`,
        dd: Math.round((spinDd + 0.02 + 0.10) * 1000) / 1000,
        notes: `Spin + Upright + Grab (${spinCode} + ${u} + G)`,
      });
    }
  }

  return rows;
}

async function seedAerialsDDs() {
  const aerialJumps = buildAerialsDDChart();

  // v1.18.02 -- Detect placeholder chart from earlier seeds (S=1.700 was the
  // pre-Appendix-C placeholder) OR any partial set missing the new codes
  // (e.g., Tk, Pk, bdFF). When detected, wipe and re-seed from the canonical
  // Appendix C chart. Mirrors the v1.16.08 mogul DD migration pattern.
  const checkS  = await queryOne("SELECT dd_value FROM jump_dd_table WHERE jump_code='S'   AND discipline='aerials'");
  const checkTk = await queryOne("SELECT id        FROM jump_dd_table WHERE jump_code='Tk'  AND discipline='aerials'");
  const stale = checkS && Math.abs(parseFloat(checkS.dd_value) - 1.48) > 0.001;
  const incomplete = !checkTk;

  if (checkS && !stale && !incomplete) return; // Already on Appendix C

  if (checkS) {
    // Existing aerials rows present but stale/incomplete — wipe & reseed.
    await execute("DELETE FROM jump_dd_table WHERE discipline='aerials'");
    console.log(`[v1.18.02 migration] aerials DD chart: replacing ${stale ? 'stale' : 'incomplete'} rows with USSS Appendix C 2026`);
  }

  const stmts = [];
  for (const j of aerialJumps) {
    stmts.push({
      sql: `INSERT OR IGNORE INTO jump_dd_table (id,jump_code,dd_value,ruleset,discipline,notes) VALUES (?,?,?,'uss','aerials',?)`,
      args: [uuidv4(), j.code, j.dd, j.notes],
    });
  }
  if (stmts.length) await getClient().batch(stmts, 'write');
}

function shortCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * 36)];
  return code;
}

module.exports = { getClient, queryAll, queryOne, execute, batch, rawExecute, rawBatch, setWriteHook, initSchema, uuidv4, shortCode, rowToObj };
