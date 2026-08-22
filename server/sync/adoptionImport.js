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
  'training_days', 'training_day_exclusions', 'usss_people',
];

// Master tables upsert; everything else is meet-keyed and must not pre-exist.
const UPSERT_TABLES = new Set(['athletes', 'usss_people']);

/** Delete every meet-keyed row of a meet (used by replace + revert-on-error). */
async function clearMeetLocal(meetId) {
  // Children first. Uses the manifest scoping joins, expressed as DELETE ...
  // WHERE pk IN (SELECT pk FROM <scoped select>).
  const order = [...IMPORT_ORDER].reverse();
  for (const table of order) {
    if (UPSERT_TABLES.has(table)) continue; // master rows survive
    const spec = protocol.TABLES[table];
    if (spec.pk.length === 1) {
      const pk = spec.pk[0];
      await execute(
        `DELETE FROM ${table} WHERE ${pk} IN (SELECT ${pk} FROM (${protocol.selectForMeet(table)}))`,
        [meetId]
      );
    } else {
      // Composite PK: run_round_status + training_day_exclusions
      if (table === 'run_round_status') {
        await execute(
          `DELETE FROM run_round_status WHERE event_id IN (SELECT id FROM events WHERE meet_id=?)`,
          [meetId]
        );
      } else if (table === 'training_day_exclusions') {
        await execute(
          `DELETE FROM training_day_exclusions WHERE training_day_id IN (SELECT id FROM training_days WHERE meet_id=?)`,
          [meetId]
        );
      } else {
        throw new Error(`clearMeetLocal: no delete strategy for composite-PK table ${table}`);
      }
    }
  }
}

/**
 * Import an adoption package. opts: { replace: false }.
 * Returns { meet_id, counts: { table: n }, logo: bool }.
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
  if (existing && opts.replace) {
    await clearMeetLocal(meetId);
  }

  const counts = {};
  try {
    for (const table of IMPORT_ORDER) {
      const rows = pkg.tables[table] || [];
      const spec = protocol.TABLES[table];
      const cols = spec.columns;
      const verb = UPSERT_TABLES.has(table) ? 'INSERT OR REPLACE INTO' : 'INSERT INTO';
      const sql = `${verb} ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
      for (const row of rows) {
        await execute(sql, cols.map(c => row[c] === undefined ? null : row[c]));
      }
      counts[table] = rows.length;
    }
  } catch (e) {
    // Leave no half-imported meet behind: clear the meet-keyed rows again.
    try { await clearMeetLocal(meetId); } catch (_) {}
    throw e;
  }

  let logoWritten = false;
  if (pkg.logo && pkg.logo.filename && pkg.logo.base64) {
    try {
      fs.mkdirSync(MEET_LOGOS_DIR, { recursive: true });
      // Basic traversal guard: filename must be a bare meet logo name.
      const safe = path.basename(pkg.logo.filename);
      fs.writeFileSync(path.join(MEET_LOGOS_DIR, safe), Buffer.from(pkg.logo.base64, 'base64'));
      logoWritten = true;
    } catch (e) {
      console.error('[adoption import] logo write failed:', e.message);
    }
  }

  return { meet_id: meetId, counts, logo: logoWritten };
}

module.exports = { executeAdoptionImport, clearMeetLocal };
