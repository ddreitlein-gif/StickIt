/**
 * server/sync/protocol.js — StickIt v2 sync protocol shared module.
 *
 * Single source of truth for:
 *   - SYNC_PROTOCOL_VERSION (R12): adoption and upsync refuse mismatched versions.
 *   - The version-pinned per-table column manifest (FR-6). Checksums, the
 *     adoption import (executeAdoptionImport), and the outbox capture layer all
 *     read THIS manifest — never SELECT * — so import, sync, and checksum can
 *     never disagree about what a row is. Production Turso carries orphan
 *     historical columns (e.g. dual_bracket.nj_blue/nj_red from the v1.26.01
 *     rollback) that a fresh Pi database lacks; physical column sets differ by
 *     design and only manifest columns participate in sync.
 *   - Canonical value serialization + row/table hashing (FR-6), computed in JS
 *     identically on both sides (cloud and venue).
 *
 * The full written spec lives in docs/SYNC_PROTOCOL.md.
 *
 * Column lists are PINNED literals verified against a freshly-migrated
 * v2 database by the harness drift test (harness/tests/step0.test.js).
 * When a future migration adds a column to a synced table, it MUST be added
 * here too (the drift test fails otherwise) and SYNC_PROTOCOL_VERSION must be
 * evaluated for a bump per docs/SYNC_PROTOCOL.md.
 */

const crypto = require('crypto');

const SYNC_PROTOCOL_VERSION = 1;

/**
 * Per-table manifest.
 *
 *   pk        — primary-key column list (composite keys in declared order).
 *   columns   — full canonical column list (includes the pk columns), in
 *               canonical order. Only these columns are exported, imported,
 *               synced, and checksummed.
 *   sync      — row changes are captured in the venue outbox and upsynced.
 *   checksum  — table participates in the check-in/handback checksum.
 *               audit_log syncs (FR-12) but is excluded from the checksum:
 *               the cloud legitimately holds pre-adoption audit rows for the
 *               same meet, so the two sides are never row-identical.
 *   snapshot  — included in the adoption package download.
 *   scope     — how rows map to a meet (drives selectForMeet):
 *                 'self'          id = meet id
 *                 'meet'          meet_id column
 *                 'event'         event_id -> events.meet_id
 *                 'run'           run_id -> runs -> events.meet_id
 *                 'match'         match_id -> dual_bracket -> events.meet_id
 *                 'phase'         phase_id -> event_phases -> events.meet_id
 *                 'training_day'  training_day_id -> training_days.meet_id
 *                 'registered_athletes'  athletes referenced by the meet's
 *                                        registrations (FR-8)
 *                 'global'        no meet scoping (usss_people snapshot)
 *                 'venue_all'     no meet column; at the venue every row
 *                                 written while adopted belongs to the meet
 *                                 (audit_log)
 */
const TABLES = {
  meets: {
    pk: ['id'],
    columns: ['id', 'name', 'location', 'date', 'status', 'created_at', 'updated_at', 'meet_ranking', 'short_code'],
    sync: true, checksum: true, snapshot: true, scope: 'self',
  },
  events: {
    pk: ['id'],
    columns: ['id', 'meet_id', 'discipline', 'division', 'gender', 'name', 'status', 'num_tl_judges', 'num_air_judges', 'has_speed', 'turns_weight', 'air_weight', 'speed_weight', 'pace_time', 'bracket_size', 'has_small_final', 'created_at', 'updated_at', 'order_seed', 'usss_code_men', 'usss_code_women', 'qualifier_event_id', 'finals_event_id', 'runoff_option', 'course_length', 'pace_time_override', 'dual_seed_method', 'active_dual_match_id', 'score_spread_threshold', 'event_date', 'dual_random_seed', 'component_scoring', 'score_entry_mode', 'usss_code', 'num_jumps', 'is_divisional', 'locked', 'short_code', 'order_locked', 'dual_bracket_review_status', 'dual_manual_entry', 'event_type', 'aerials_panel_size', 'aerials_hj_scores', 'aerials_reduction_method', 'hide_livescores'],
    sync: true, checksum: true, snapshot: true, scope: 'meet',
  },
  athletes: {
    pk: ['id'],
    columns: ['id', 'ussa_num', 'fis_id', 'first_name', 'last_name', 'birth_year', 'gender', 'club', 'created_at', 'updated_at', 'nation', 'bib', 'division', 'deleted_at'],
    sync: true, checksum: true, snapshot: true, scope: 'registered_athletes',
  },
  registrations: {
    pk: ['id'],
    columns: ['id', 'event_id', 'athlete_id', 'bib_number', 'seed', 'status', 'created_at', 'run_order', 'round_scratched', 'heat_id', 'dual_seed', 'dual_seed_source', 'dual_seed_source_value'],
    sync: true, checksum: true, snapshot: true, scope: 'event',
  },
  judges: {
    pk: ['id'],
    columns: ['id', 'event_id', 'name', 'role', 'pin', 'created_at', 'ussa_id', 'short_code', 'judge_number'],
    sync: true, checksum: true, snapshot: true, scope: 'event',
  },
  officials: {
    pk: ['id'],
    columns: ['id', 'meet_id', 'role', 'name', 'ussa_id', 'event_id'],
    sync: true, checksum: true, snapshot: true, scope: 'meet',
  },
  course_specs: {
    pk: ['id'],
    columns: ['id', 'meet_id', 'course_name', 'width_m', 'length_m', 'pitch_deg', 'pace_time_override_m', 'pace_time_override_f', 'pace_standard'],
    sync: true, checksum: true, snapshot: true, scope: 'meet',
  },
  runs: {
    pk: ['id'],
    columns: ['id', 'event_id', 'registration_id', 'run_number', 'round', 'bracket_round', 'bracket_position', 'course', 'jump1_code', 'jump1_dd', 'jump2_code', 'jump2_dd', 'turns_score', 'air_score', 'speed_score', 'total_score', 'run_time', 'status', 'created_at', 'updated_at', 'run_status', 'hj_pending', 'tl_carving', 'tl_abext', 'tl_upper_body', 'tl_deduction', 'manually_entered', 'air_score_no_dd', 'aerials_model', 'voice_transcript'],
    sync: true, checksum: true, snapshot: true, scope: 'event',
  },
  judge_scores: {
    pk: ['id'],
    columns: ['id', 'run_id', 'judge_id', 'score_type', 'raw_score', 'submitted_at', 'tl_carving', 'tl_abext', 'tl_upper_body', 'tl_deduction'],
    sync: true, checksum: true, snapshot: true, scope: 'run',
  },
  dual_bracket: {
    pk: ['id'],
    // NOTE: nj_blue/nj_red (v1.26.00 orphans, rolled back in v1.26.01) are
    // deliberately absent — they exist on production Turso but not on a fresh
    // database, and carry no live data.
    columns: ['id', 'event_id', 'bracket_round', 'bracket_position', 'registration_id_blue', 'registration_id_red', 'winner_registration_id', 'status', 'is_small_final', 'created_at', 'updated_at', 'seed_blue', 'seed_red', 'is_bye', 'loser_status', 'nj_call'],
    sync: true, checksum: true, snapshot: true, scope: 'event',
  },
  dual_judge_points: {
    pk: ['id'],
    columns: ['id', 'match_id', 'judge_number', 'blue_points', 'red_points', 'created_at', 'updated_at', 'time_tied', 'air_tied'],
    sync: true, checksum: true, snapshot: true, scope: 'match',
  },
  heats: {
    pk: ['id'],
    columns: ['id', 'event_id', 'heat_number', 'heat_name', 'round', 'created_at', 'updated_at'],
    sync: true, checksum: true, snapshot: true, scope: 'event',
  },
  event_phases: {
    pk: ['id'],
    columns: ['id', 'event_id', 'phase_type', 'run_number', 'label', 'run_order_method', 'pass_through_count', 'final_size', 'q2_field_limit', 'status', 'review_message', 'sequence_order', 'created_at', 'updated_at'],
    sync: true, checksum: true, snapshot: true, scope: 'event',
  },
  phase_run_order: {
    pk: ['id'],
    columns: ['id', 'phase_id', 'registration_id', 'run_order'],
    sync: true, checksum: true, snapshot: true, scope: 'phase',
  },
  run_round_status: {
    pk: ['event_id', 'run_number'],
    columns: ['event_id', 'run_number', 'status', 'review_message', 'updated_at'],
    sync: true, checksum: true, snapshot: true, scope: 'event',
  },
  training_days: {
    pk: ['id'],
    columns: ['id', 'meet_id', 'name', 'date', 'created_at', 'updated_at'],
    sync: true, checksum: true, snapshot: true, scope: 'meet',
  },
  training_day_exclusions: {
    pk: ['training_day_id', 'athlete_id'],
    columns: ['training_day_id', 'athlete_id', 'created_at'],
    sync: true, checksum: true, snapshot: true, scope: 'training_day',
  },
  // FR-12 — venue audit rows sync so the cloud archive is complete, but the
  // table is excluded from the check-in checksum (cloud holds pre-adoption
  // rows for the same meet) and from the adoption snapshot (the venue starts
  // its own audit trail).
  audit_log: {
    pk: ['id'],
    columns: ['id', 'timestamp', 'action', 'entity', 'entity_id', 'old_value', 'new_value', 'user_note'],
    sync: true, checksum: false, snapshot: false, scope: 'venue_all',
  },
  // R5 — adoption package carries a USSS people snapshot for offline late
  // registrations. Never upsynced (the cloud master is authoritative).
  usss_people: {
    pk: ['ussa_id'],
    columns: ['ussa_id', 'type', 'last_name', 'first_name', 'division', 'gender', 'yob', 'club_name', 'ae_points', 'dm_points', 'mo_points', 'fis_id', 'updated_at'],
    sync: false, checksum: false, snapshot: true, scope: 'global',
  },
};

/** Tables captured by the venue outbox (FR-5 write capture set). */
const SYNC_TABLES = Object.keys(TABLES).filter(t => TABLES[t].sync);
/** Tables participating in the check-in/handback checksum. */
const CHECKSUM_TABLES = Object.keys(TABLES).filter(t => TABLES[t].checksum);
/** Tables included in the adoption package. */
const SNAPSHOT_TABLES = Object.keys(TABLES).filter(t => TABLES[t].snapshot);

/**
 * SQL selecting one meet's rows for a table, single `?` bind = meet id.
 * Explicit column list from the manifest (never SELECT *). Shared by the
 * adoption package builder, the checksum computation, and the cloud-side
 * athlete lock resolver (FR-8).
 */
function selectForMeet(table) {
  const t = TABLES[table];
  if (!t) throw new Error(`Unknown sync table: ${table}`);
  const cols = t.columns.map(c => `t.${c}`).join(', ');
  switch (t.scope) {
    case 'self':
      return `SELECT ${cols} FROM ${table} t WHERE t.id = ?`;
    case 'meet':
      return `SELECT ${cols} FROM ${table} t WHERE t.meet_id = ?`;
    case 'event':
      return `SELECT ${cols} FROM ${table} t JOIN events e ON e.id = t.event_id WHERE e.meet_id = ?`;
    case 'run':
      return `SELECT ${cols} FROM ${table} t JOIN runs r ON r.id = t.run_id JOIN events e ON e.id = r.event_id WHERE e.meet_id = ?`;
    case 'match':
      return `SELECT ${cols} FROM ${table} t JOIN dual_bracket m ON m.id = t.match_id JOIN events e ON e.id = m.event_id WHERE e.meet_id = ?`;
    case 'phase':
      return `SELECT ${cols} FROM ${table} t JOIN event_phases p ON p.id = t.phase_id JOIN events e ON e.id = p.event_id WHERE e.meet_id = ?`;
    case 'training_day':
      return `SELECT ${cols} FROM ${table} t JOIN training_days d ON d.id = t.training_day_id WHERE d.meet_id = ?`;
    case 'registered_athletes':
      // FR-8: athletes referenced by this meet's registrations only.
      return `SELECT ${cols} FROM ${table} t WHERE t.id IN (SELECT r.athlete_id FROM registrations r JOIN events e ON e.id = r.event_id WHERE e.meet_id = ?)`;
    case 'global':
      // usss_people snapshot ignores the meet id bind (kept for a uniform call
      // shape). `WHERE ? IS NOT NULL` consumes the bind without filtering.
      return `SELECT ${cols} FROM ${table} t WHERE ? IS NOT NULL`;
    default:
      throw new Error(`Table ${table} has no meet-scoped selection (scope=${t.scope})`);
  }
}

// ---------------------------------------------------------------------------
// Canonical serialization + hashing (FR-6)
// ---------------------------------------------------------------------------
// Rules (documented in docs/SYNC_PROTOCOL.md §5):
//   NULL / undefined            -> the token "\u0000" (single NUL char)
//   number (incl. -0, floats)   -> JSON.stringify (shortest round-trip; -0
//                                  normalized to "0")
//   bigint                      -> decimal string
//   string                      -> JSON.stringify (escaped, quoted)
//   Uint8Array / Buffer (BLOB)  -> "b64:" + base64
//   boolean                     -> "1" / "0" (SQLite has no boolean type;
//                                  defensive only)
// Values are joined with "\u0001" (never appears in canonical output).

function canonicalValue(v) {
  if (v === null || v === undefined) return '\u0000';
  const t = typeof v;
  if (t === 'number') {
    if (Object.is(v, -0)) return '0';
    return JSON.stringify(v);
  }
  if (t === 'bigint') return v.toString(10);
  if (t === 'string') return JSON.stringify(v);
  if (t === 'boolean') return v ? '1' : '0';
  if (v instanceof Uint8Array) return 'b64:' + Buffer.from(v).toString('base64');
  throw new Error(`Cannot canonicalize value of type ${t}`);
}

/** Canonical string for a row's primary key (used for sort + delete records). */
function pkString(table, row) {
  const t = TABLES[table];
  if (!t) throw new Error(`Unknown sync table: ${table}`);
  return t.pk.map(c => canonicalValue(row[c])).join('\u0001');
}

/** Extract the pk object ({col: value}) from a full row. */
function pkOf(table, row) {
  const t = TABLES[table];
  const pk = {};
  for (const c of t.pk) pk[c] = row[c] === undefined ? null : row[c];
  return pk;
}

/** Canonical serialization of one row: manifest columns only, manifest order. */
function rowCanonical(table, row) {
  const t = TABLES[table];
  if (!t) throw new Error(`Unknown sync table: ${table}`);
  return t.columns.map(c => canonicalValue(row[c])).join('\u0001');
}

function sha256hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function rowHash(table, row) {
  return sha256hex(rowCanonical(table, row));
}

/**
 * Deterministic per-table checksum: rows sorted by canonical pk string
 * (byte-order comparison), row hashes concatenated with "\n", sha256 of the
 * whole. Empty table -> { count: 0, hash: sha256("") }.
 */
function tableChecksum(table, rows) {
  const sorted = rows
    .map(r => ({ k: pkString(table, r), h: rowHash(table, r) }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  return { count: sorted.length, hash: sha256hex(sorted.map(x => x.h).join('\n')) };
}

/** Reduce a full row object to manifest columns only (missing cols -> null). */
function manifestRow(table, row) {
  const t = TABLES[table];
  if (!t) throw new Error(`Unknown sync table: ${table}`);
  const out = {};
  for (const c of t.columns) out[c] = row[c] === undefined ? null : row[c];
  return out;
}

module.exports = {
  SYNC_PROTOCOL_VERSION,
  TABLES,
  SYNC_TABLES,
  CHECKSUM_TABLES,
  SNAPSHOT_TABLES,
  selectForMeet,
  canonicalValue,
  pkString,
  pkOf,
  rowCanonical,
  rowHash,
  tableChecksum,
  manifestRow,
};
