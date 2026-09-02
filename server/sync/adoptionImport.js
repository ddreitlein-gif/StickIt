/**
 * server/sync/adoptionImport.js — ID-preserving adoption import (v2 Step 2,
 * venue side).
 *
 * A generic all-columns row copier driven by the SAME per-table column
 * manifest as the checksum (FR-6) — NOT a clone of executeImport, which
 * regenerates IDs/short codes and rewrites created_at. Preserves original
 * UUIDs, short codes, timestamps, and every other manifest column
 * byte-for-byte.
 *
 * Refusal rules (FR-3 / Section 5.2): the already-exists refusal applies to
 * MEET-KEYED tables only — `athletes` and `usss_people` rows are upserted
 * (athlete master rows legitimately survive a prior archived meet, so the
 * second adoption of a season sees familiar athlete IDs). Passing
 * { replace: true } clears the existing local copy of THIS meet first
 * (one-tap "Replace local copy" re-adoption, D8).
 *
 * NOTE for Step 4: the outbox capture layer must NOT record these inserts —
 * they are cloud→venue transport, not local changes. The capture layer is
 * activated only after the venue state row is written, which happens after
 * this import completes.
 */

const fs = require('fs');
const path = require('path');
const { execute, queryOne } = require('../db/schema');
const protocol = require('./protocol');

const MEET_LOGOS_DIR = path.join(__dirname, '..', 'data', 'logos');

// Insert order: parents before children (no FK enforcement in SQLite here,
// but keeps any future constraint happy and reads logically).
const IMPORT_ORDER = [
  'meets', 'events', 'athletes', 'registrations', 'judges', 'officials',
  'course_specs', 'runs', 'judge_scores', 'dual_bracket', 'dual_judge_points',
  'heats', 'event_phases', 'phase_run_order', 'run_round_status',
  'training_days', 'training_day_exclusions', 'usss_people', 'jump_dd_table',
];

// Master tables upsert; everything else is meet-keyed and must not pre-exist.
const UPSERT_TABLES = new Set(['athletes', 'usss_people']);

// M-4: the DD chart imports REPLACE-ALL — the venue must score with the
// cloud's current chart. Applied only when the package actually carries rows
// (an old package without the key must never wipe the local seed). Skipped by
// clearMeetLocal (device-level data, not meet-keyed).
const REPLACE_ALL_TABLES = new Set(['jump_dd_table']);

// L-4: IMPORT_ORDER is a hand-maintained ordering of SNAPSHOT_TABLES — assert
// set equality at module load so a future snapshot-table addition can never
// silently be dropped from the import.
{
  const a = new Set(IMPORT_ORDER);
  const b = new Set(protocol.SNAPSHOT_TABLES);
  if (a.size !== IMPORT_ORDER.length || a.size !== b.size || [...a].some(t => !b.has(t))) {
    throw new Error(`adoptionImport: IMPORT_ORDER drifted from protocol.SNAPSHOT_TABLES (order: ${IMPORT_ORDER.join(',')} vs snapshot: ${protocol.SNAPSHOT_TABLES.join(',')})`);
  }
}

/**
 * DELETE statements clearing every meet-keyed row of a meet (used by replace).
 * Children first. Uses the manifest scoping joins, expressed as DELETE ...
 * WHERE pk IN (SELECT pk FROM <scoped select>). Returned as statements so the
 * replace-import can run clear + insert in ONE atomic batch (M-5).
 */
function clearMeetLocalStatements(meetId) {
  const stmts = [];
  const order = [...IMPORT_ORDER].reverse();
  for (const table of order) {
    if (UPSERT_TABLES.has(table)) continue; // master rows survive
    if (REPLACE_ALL_TABLES.has(table)) continue; // device-level, not meet-keyed
    const spec = protocol.TABLES[table];
    if (spec.pk.length === 1) {
      const pk = spec.pk[0];
      stmts.push({
        sql: `DELETE FROM ${table} WHERE ${pk} IN (SELECT ${pk} FROM (${protocol.selectForMeet(table)}))`,
        args: [meetId],
      });
    } else {
      // Composite PK: run_round_status + training_day_exclusions
      if (table === 'run_round_status') {
        stmts.push({
          sql: `DELETE FROM run_round_status WHERE event_id IN (SELECT id FROM events WHERE meet_id=?)`,
          args: [meetId],
        });
      } else if (table === 'training_day_exclusions') {
        stmts.push({
          sql: `DELETE FROM training_day_exclusions WHERE training_day_id IN (SELECT id FROM training_days WHERE meet_id=?)`,
          args: [meetId],
        });
      } else {
        throw new Error(`clearMeetLocal: no delete strategy for composite-PK table ${table}`);
      }
    }
  }
  return stmts;
}

/** Delete every meet-keyed row of a meet (standalone form). */
async function clearMeetLocal(meetId) {
  for (const s of clearMeetLocalStatements(meetId)) {
    await execute(s.sql, s.args);
  }
}

/**
 * Import an adoption package. opts: { replace: false }.
 * Returns { meet_id, counts: { table: n }, logo: bool, bottom_logo: bool }.
 * Throws { code: 'protocol_mismatch' | 'meet_exists' | ... } style Errors
 * with an `.httpCode` for route handlers.
 */
async function executeAdoptionImport(pkg, opts = {}) {
  const fail = (httpCode, code, message) => {
    const e = new Error(message);
    e.code = code;
    e.httpCode = httpCode;
    throw e;
  };

  if (!pkg || pkg.format !== 'stickit-adoption-package' || !pkg.tables) {
    fail(400, 'bad_package', 'Not a StickIt adoption package');
  }
  if (pkg.protocol_version !== protocol.SYNC_PROTOCOL_VERSION) {
    fail(409, 'protocol_mismatch',
      `Sync protocol mismatch: this server speaks version ${protocol.SYNC_PROTOCOL_VERSION}, the package is version ${pkg.protocol_version}. Update StickIt on the older side.`);
  }
  const meetRows = pkg.tables.meets || [];
  if (meetRows.length !== 1) fail(400, 'bad_package', 'Package must contain exactly one meet');
  const meetId = meetRows[0].id;
  if (pkg.meet_id && pkg.meet_id !== meetId) fail(400, 'bad_package', 'Package meet_id mismatch');

  const existing = await queryOne('SELECT id, name FROM meets WHERE id=?', [meetId]);
  if (existing && !opts.replace) {
    fail(409, 'meet_exists',
      `A local copy of "${existing.name}" already exists. Re-adopting replaces it with the current cloud version.`);
  }

  // M-5: the whole import — including the replace-path clear of the previous
  // local copy — runs as ONE atomic batch. A mid-import failure rolls
  // everything back (the old copy survives a failed replace), and a double-tap
  // cannot interleave two imports (the loser's PK conflicts roll its batch
  // back whole, or a replace re-import converges to identical rows).
  const stmts = [];
  if (existing && opts.replace) {
    stmts.push(...clearMeetLocalStatements(meetId));
  }
  const counts = {};
  for (const table of IMPORT_ORDER) {
    const rows = pkg.tables[table] || [];
    const spec = protocol.TABLES[table];
    const cols = spec.columns;
    if (REPLACE_ALL_TABLES.has(table)) {
      // M-4: replace-all — but ONLY when the package actually carries rows;
      // an older package without the table must never wipe the local seed.
      if (!Array.isArray(pkg.tables[table]) || rows.length === 0) {
        counts[table] = 0;
        continue;
      }
      stmts.push({ sql: `DELETE FROM ${table}`, args: [] });
    }
    const verb = UPSERT_TABLES.has(table) ? 'INSERT OR REPLACE INTO' : 'INSERT INTO';
    const sql = `${verb} ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
    for (const row of rows) {
      stmts.push({ sql, args: cols.map(c => row[c] === undefined ? null : row[c]) });
    }
    counts[table] = rows.length;
  }
  const { batch } = require('../db/schema');
  await batch(stmts);

  // L-4: the filename must be exactly this meet's logo name (traversal
  // guard AND cross-meet-clobber guard), and a replace removes any stale
  // logo with a different extension first. Shared by the event logo
  // (meet_<id>.<ext>) and the v2.3.01 bottom logo (meet_<id>_bottom.<ext>).
  function writeLogo(entry, prefix, label) {
    if (!entry || !entry.filename || !entry.base64) return false;
    try {
      fs.mkdirSync(MEET_LOGOS_DIR, { recursive: true });
      const safe = path.basename(entry.filename);
      if (!safe.startsWith(prefix) || !/^[A-Za-z0-9]+$/.test(safe.slice(prefix.length))) {
        console.error(`[adoption import] refusing ${label} filename "${safe}" (expected ${prefix}<ext>)`);
        return false;
      }
      for (const f of fs.readdirSync(MEET_LOGOS_DIR)) {
        if (f.startsWith(prefix) && f !== safe) {
          try { fs.unlinkSync(path.join(MEET_LOGOS_DIR, f)); } catch (_) {}
        }
      }
      fs.writeFileSync(path.join(MEET_LOGOS_DIR, safe), Buffer.from(entry.base64, 'base64'));
      return true;
    } catch (e) {
      console.error(`[adoption import] ${label} write failed:`, e.message);
      return false;
    }
  }
  const logoWritten = writeLogo(pkg.logo, `meet_${meetId}.`, 'logo');
  const bottomLogoWritten = writeLogo(pkg.bottom_logo, `meet_${meetId}_bottom.`, 'bottom logo');

  return { meet_id: meetId, counts, logo: logoWritten, bottom_logo: bottomLogoWritten };
}

module.exports = { executeAdoptionImport, clearMeetLocal };
