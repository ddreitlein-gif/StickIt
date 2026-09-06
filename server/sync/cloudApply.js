/**
 * server/sync/cloudApply.js — cloud-side apply primitives (v2.5.00).
 *
 * Extracted verbatim from routes/sync.js so the live upsync endpoints
 * (/changes, /repush, /checkin) and the file-based return import
 * (sync/returnImport.js — the offline "carry it on a USB stick" path) apply
 * rows and verify checksums through ONE implementation. Behavior of the live
 * endpoints is unchanged.
 */

const crypto = require('crypto');
const { queryAll, execute } = require('../db/schema');
const protocol = require('./protocol');

// L-8: constant-time hash comparison for token auth.
function hashesEqual(aHex, bHex) {
  try {
    const a = Buffer.from(String(aHex), 'hex');
    const b = Buffer.from(String(bHex), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) { return false; }
}

// M-8: non-PK UNIQUE keys. An upsert whose new id collides with a
// DIFFERENT-id row under the unique key (e.g. a judge_scores re-submit after
// an HJ reject, under the FR-11 index) would fail SQLITE_CONSTRAINT — the
// worker would then retry the same batch forever. Mirror the venue's REPLACE
// displacement semantics: remove the different-id row first (the venue's
// ordered history is authoritative for its adopted meet).
const UNIQUE_KEYS = {
  judge_scores: ['run_id', 'judge_id', 'score_type'],
  dual_judge_points: ['match_id', 'judge_number'],
  phase_run_order: ['phase_id', 'registration_id'],
};

function uniqueKeyConflictStatement(tbl, row) {
  const uk = UNIQUE_KEYS[tbl];
  if (!uk || uk.some(c => row[c] === null || row[c] === undefined)) return null;
  const pk = protocol.TABLES[tbl].pk;
  return {
    sql: `DELETE FROM ${tbl} WHERE ${uk.map(c => `${c}=?`).join(' AND ')} AND ${pk.map(c => `${c} != ?`).join(' AND ')}`,
    args: [...uk.map(c => row[c]), ...pk.map(c => row[c])],
  };
}

async function clearUniqueKeyConflicts(tbl, row) {
  const s = uniqueKeyConflictStatement(tbl, row);
  if (s) await execute(s.sql, s.args);
}

function upsertSql(table) {
  const spec = protocol.TABLES[table];
  const cols = spec.columns;
  const nonPk = cols.filter(c => !spec.pk.includes(c));
  const conflictUpdate = nonPk.length
    ? `DO UPDATE SET ${nonPk.map(c => `${c}=excluded.${c}`).join(', ')}`
    : 'DO NOTHING';
  return `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
          ON CONFLICT(${spec.pk.join(',')}) ${conflictUpdate}`;
}

async function cloudChecksums(meetId) {
  const out = {};
  for (const t of protocol.CHECKSUM_TABLES) {
    const rows = await queryAll(protocol.selectForMeet(t), [meetId]);
    out[t] = protocol.tableChecksum(t, rows.map(r => protocol.manifestRow(t, r)));
  }
  return out;
}

function compareChecksums(venueSums, cloudSums) {
  const mismatched = [];
  for (const t of protocol.CHECKSUM_TABLES) {
    const v = venueSums[t];
    const c = cloudSums[t];
    if (!v || !c || v.hash !== c.hash || v.count !== c.count) mismatched.push(t);
  }
  return { match: mismatched.length === 0, mismatched };
}

/**
 * v2.5.00 — statements that replace the cloud's meet-scoped rows of ONE table
 * with a complete pushed row set: exactly what POST /repush executes
 * sequentially (delete rows absent from the push — except master tables,
 * H-3 — then upsert every pushed row through the manifest-only upsert),
 * returned as statements so the return import can run every table in ONE
 * atomic batch (M-5). The absent-row reads happen here, before the batch,
 * against the pre-import state.
 */
async function replaceTableStatements(meetId, t, rows) {
  const spec = protocol.TABLES[t];
  const stmts = [];
  const pushed = (rows || []).map(r => protocol.manifestRow(t, r));
  const pushedKeys = new Set(pushed.map(r => protocol.pkString(t, r)));
  const masterScoped = spec.scope === 'registered_athletes' || spec.scope === 'global';
  if (!masterScoped) {
    const existing = await queryAll(protocol.selectForMeet(t), [meetId]);
    for (const row of existing) {
      if (!pushedKeys.has(protocol.pkString(t, row))) {
        stmts.push({
          sql: `DELETE FROM ${t} WHERE ${spec.pk.map(cn => `${cn}=?`).join(' AND ')}`,
          args: spec.pk.map(cn => row[cn]),
        });
      }
    }
  }
  for (const row of pushed) {
    const uk = uniqueKeyConflictStatement(t, row);
    if (uk) stmts.push(uk);
    stmts.push({ sql: upsertSql(t), args: spec.columns.map(cn => row[cn]) });
  }
  return { stmts, count: pushed.length };
}

module.exports = {
  hashesEqual,
  UNIQUE_KEYS,
  uniqueKeyConflictStatement,
  clearUniqueKeyConflicts,
  upsertSql,
  cloudChecksums,
  compareChecksums,
  replaceTableStatements,
};
