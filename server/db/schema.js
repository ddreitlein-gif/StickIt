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

async function execute(sql, args = []) {
  const c = getClient();
  return c.execute({ sql, args });
}

async function batch(statements) {
  const c = getClient();
  return c.batch(statements, 'write');
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
  ];
  for (const sql of migrations) {
    try { await c.execute(sql); } catch (_) { /* column already exists -- safe to ignore */ }
  }

  // Migrate usss_code_men/usss_code_women → usss_code (one-time)
  try {
    await c.execute(`UPDATE events SET usss_code = CASE WHEN gender='M' THEN usss_code_men ELSE usss_code_women END WHERE usss_code IS NULL AND (usss_code_men IS NOT NULL OR usss_code_women IS NOT NULL)`);
  } catch (_) {}

  // Backfill short_code for existing rows that don't have one
  for (const table of ['meets', 'events', 'judges']) {
    try {
      const rows = await queryAll(`SELECT id FROM ${table} WHERE short_code IS NULL`);
      for (const row of rows) {
        await c.execute(`UPDATE ${table} SET short_code=? WHERE id=?`, [shortCode(), row.id]);
      }
    } catch (_) {}
  }

  // Normalize gender values to single-letter codes ('M'/'F') on every startup
  try {
    await c.execute(`UPDATE events   SET gender = 'M' WHERE gender IN ('male',   'Male'  )`);
    await c.execute(`UPDATE events   SET gender = 'F' WHERE gender IN ('female', 'Female')`);
    await c.execute(`UPDATE athletes SET gender = 'M' WHERE gender IN ('male',   'Male'  )`);
    await c.execute(`UPDATE athletes SET gender = 'F' WHERE gender IN ('female', 'Female')`);
  } catch (_) {}

  // v1.6 -- one-time backfill of athletes.bib from each athlete's most
  // recent non-null registration bib.  Runs exactly once, gated on
  // detecting that no athlete has a non-null bib yet.
  try {
    const anyBib = await queryOne("SELECT COUNT(*) AS cnt FROM athletes WHERE bib IS NOT NULL");
    if (anyBib && parseInt(anyBib.cnt) === 0) {
      const athletes = await queryAll("SELECT id FROM athletes");
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

  await seedJumpDDs();
  await seedAerialsDDs();
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
    // Jump Multipliers
    { code: 'p',    ddM: 0.03, ddF: 0.03, notes: 'Position' },
    { code: 'G',    ddM: 0.14, ddF: 0.14, notes: 'Grab' },
    // Rotational Jumps
    { code: '3',    ddM: 0.68, ddF: 0.78, notes: '360' },
    { code: '3p',   ddM: 0.71, ddF: 0.81, notes: '360 Position' },
    { code: '3G',   ddM: 0.82, ddF: 0.92, notes: '360 Grab' },
    { code: '7',    ddM: 0.85, ddF: 0.95, notes: '720' },
    { code: '7p',   ddM: 0.88, ddF: 0.98, notes: '720 Position' },
    { code: '7G',   ddM: 1.01, ddF: 1.11, notes: '720 Grab' },
    { code: '10',   ddM: 1.02, ddF: 1.12, notes: '1080' },
    { code: '10p',  ddM: 1.05, ddF: 1.15, notes: '1080 Position' },
    { code: '10G',  ddM: 1.20, ddF: 1.30, notes: '1080 Grab' },
    // Off Axis Jumps
    { code: '3op',  ddM: 0.71, ddF: 0.81, notes: 'Off Axis 360 Position' },
    { code: '3oG',  ddM: 0.82, ddF: 0.92, notes: 'Off Axis 360 Grab' },
    { code: '7op',  ddM: 0.88, ddF: 0.98, notes: 'Off Axis 720 Position' },
    { code: '7oG',  ddM: 1.01, ddF: 1.11, notes: 'Off Axis 720 Grab' },
    { code: '10op', ddM: 1.05, ddF: 1.15, notes: 'Off Axis 1080 Position' },
    { code: '10oG', ddM: 1.20, ddF: 1.30, notes: 'Off Axis 1080 Grab' },
    { code: '14op', ddM: 1.22, ddF: 1.32, notes: 'Off Axis 1440 Position' },
    { code: '14oG', ddM: 1.39, ddF: 1.49, notes: 'Off Axis 1440 Grab' },
    // Inverted Jumps
    { code: 'bP',   ddM: 0.68, ddF: 0.78, notes: 'Back Pike' },
    { code: 'bT',   ddM: 0.68, ddF: 0.78, notes: 'Back Tuck' },
    { code: 'bL',   ddM: 0.71, ddF: 0.81, notes: 'Back Lay' },
    { code: 'bp',   ddM: 0.71, ddF: 0.81, notes: 'Back Position' },
    { code: 'bG',   ddM: 0.82, ddF: 0.92, notes: 'Back Grab' },
    { code: 'bF',   ddM: 0.88, ddF: 0.98, notes: 'Back Full' },
    { code: 'bdF',  ddM: 1.05, ddF: 1.15, notes: 'Back Double Full' },
    { code: 'btF',  ddM: 1.22, ddF: 1.32, notes: 'Back Triple Full' },
    { code: 'fT',   ddM: 0.68, ddF: 0.78, notes: 'Front Tuck' },
    { code: 'fP',   ddM: 0.68, ddF: 0.78, notes: 'Front Pike' },
    { code: 'fp',   ddM: 0.71, ddF: 0.81, notes: 'Front Position' },
    { code: 'fG',   ddM: 0.82, ddF: 0.92, notes: 'Front Grab' },
    { code: 'fF',   ddM: 0.88, ddF: 0.98, notes: 'Front Full' },
    // Loop Jumps
    { code: 'l',    ddM: 0.68, ddF: 0.78, notes: 'Loop' },
    { code: 'lp',   ddM: 0.71, ddF: 0.81, notes: 'Loop Position' },
    { code: 'lG',   ddM: 0.82, ddF: 0.92, notes: 'Loop Grab' },
    { code: 'lF',   ddM: 0.85, ddF: 0.95, notes: 'Loop Full' },
    { code: 'lpF',  ddM: 0.88, ddF: 0.98, notes: 'Loop Position Full' },
    { code: 'lGF',  ddM: 1.01, ddF: 1.11, notes: 'Loop Grab Full' },
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

async function seedAerialsDDs() {
  const existing = await queryOne("SELECT COUNT(*) as cnt FROM jump_dd_table WHERE discipline='aerials'");
  if (existing && parseInt(existing.cnt) > 0) return;

  // FIS 2023 Aerials DD values (representative set; exact figures per FIS ICR Appendix)
  const aerialJumps = [
    // Single-jump entries
    { code: 'S',    dd: 1.700, notes: 'Straight' },
    { code: 'B',    dd: 1.800, notes: 'Back layout (single)' },
    { code: 'bF',   dd: 2.090, notes: 'Back full (single)' },
    { code: 'bFF',  dd: 2.360, notes: 'Back double full' },
    { code: 'bFFF', dd: 2.780, notes: 'Back triple full' },
    { code: 'bD',   dd: 2.360, notes: 'Back double' },
    { code: 'bT',   dd: 2.690, notes: 'Back triple' },
    { code: 'fF',   dd: 2.090, notes: 'Front full (single)' },
    { code: 'fFF',  dd: 2.360, notes: 'Front double full' },
    { code: 'fT',   dd: 2.690, notes: 'Front triple' },
    { code: 'fD',   dd: 2.360, notes: 'Front double' },
    // Common combination / quad entries
    { code: 'bLF',  dd: 2.580, notes: 'Back layout full' },
    { code: 'bLFF', dd: 2.940, notes: 'Back layout double full' },
    { code: 'bLFFF',dd: 3.350, notes: 'Back layout triple full' },
    { code: 'bL',   dd: 2.090, notes: 'Back layout' },
    { code: 'fL',   dd: 1.850, notes: 'Front layout' },
    { code: 'fLF',  dd: 2.310, notes: 'Front layout full' },
    { code: 'bX',   dd: 2.780, notes: 'Back cross' },
    { code: 'fTFF', dd: 2.940, notes: 'Front triple full-full' },
    { code: 'bDFF', dd: 2.940, notes: 'Back double full-full' },
    { code: 'bTFF', dd: 3.480, notes: 'Back triple full-full' },
    { code: 'bQD',  dd: 3.700, notes: 'Back quad double' },
    { code: 'bQF',  dd: 4.000, notes: 'Back quad full' },
  ];

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

module.exports = { getClient, queryAll, queryOne, execute, batch, initSchema, uuidv4, shortCode, rowToObj };
