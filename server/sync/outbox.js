/**
 * server/sync/outbox.js — venue-mode write capture + outbox (v2 Step 4, FR-5).
 *
 * Installed as the schema.js write hook ONLY in venue mode, and active ONLY
 * while a meet is adopted (meet_state === 'adopted' or 'checking_in' for the
 * final flush). Every INSERT/UPDATE/DELETE that lands on one of the 18 sync
 * tables is recorded as ordered full-row outbox entries:
 *
 *   - UPDATE / DELETE (incl. non-PK predicates like
 *     `DELETE FROM judge_scores WHERE run_id=?`): a PRE-IMAGE SELECT with the
 *     statement's own WHERE clause captures the affected PKs; deletes emit one
 *     delete record per PK; updates re-read each row (POST-IMAGE) and emit
 *     upserts.
 *   - INSERT / INSERT OR REPLACE / INSERT OR IGNORE / ON CONFLICT upserts:
 *     the inserted PK (or unique key) is parsed from the explicit column list;
 *     REPLACE under a non-PK UNIQUE constraint (e.g. phase_run_order
 *     UNIQUE(phase_id, registration_id)) first pre-images the displaced row
 *     and emits its delete; then the POST-IMAGE row is read back and emitted
 *     as an upsert — so the recorded value is what actually landed.
 *   - batch(): pre-images for every statement are captured first, the real
 *     atomic batch runs, then post-images are read in statement order.
 *
 * Adoption imports are never captured: the hook activates only after
 * setVenueState marks the meet adopted, which happens after the import.
 *
 * If a statement cannot be parsed (unexpected SQL shape), the capture falls
 * back to a FULL-TABLE diff (pre PK set vs post PK set + upsert every post
 * row) and logs loudly — heavyweight but correct; the FR-7 audit gate would
 * catch any capture gap in testing.
 */

const { rawExecute, rowToObj, uuidv4 } = require('../db/schema');
const protocol = require('./protocol');

const SYNC_SET = new Set(protocol.SYNC_TABLES);

// Non-PK UNIQUE keys that INSERT OR REPLACE / ON CONFLICT can conflict on.
const UNIQUE_KEYS = {
  phase_run_order: ['phase_id', 'registration_id'],
  dual_judge_points: ['match_id', 'judge_number'],
  judge_scores: ['run_id', 'judge_id', 'score_type'],
};

let state = { active: false, meetId: null };
let onAppend = null; // worker wake callback

function setOnAppend(fn) { onAppend = fn; }

async function ensureOutboxTable() {
  await rawExecute(`CREATE TABLE IF NOT EXISTS sync_outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    meet_id TEXT NOT NULL,
    tbl TEXT NOT NULL,
    pk TEXT NOT NULL,
    op TEXT NOT NULL,
    row_json TEXT,
    idempotency_key TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

/** Re-read venue state and (de)activate capture. Called at boot and by setVenueState. */
async function refreshCaptureState() {
  try {
    const r1 = await rawExecute(`SELECT value FROM app_settings WHERE key='venue_meet_id'`);
    const r2 = await rawExecute(`SELECT value FROM app_settings WHERE key='venue_meet_state'`);
    const meetId = r1.rows.length ? rowToObj(r1.rows[0]).value : null;
    const meetState = r2.rows.length ? rowToObj(r2.rows[0]).value : null;
    state = {
      active: !!meetId && (meetState === 'adopted' || meetState === 'checking_in'),
      meetId: meetId || null,
    };
  } catch (_) {
    state = { active: false, meetId: null };
  }
}

// --- SQL statement analysis -------------------------------------------------

function classify(sql) {
  let m;
  if ((m = /^\s*INSERT\s+OR\s+REPLACE\s+INTO\s+(\w+)/i.exec(sql))) return { op: 'replace', table: m[1] };
  if ((m = /^\s*INSERT\s+OR\s+IGNORE\s+INTO\s+(\w+)/i.exec(sql))) return { op: 'insert_ignore', table: m[1] };
  if ((m = /^\s*INSERT\s+INTO\s+(\w+)/i.exec(sql))) return { op: /ON\s+CONFLICT/i.test(sql) ? 'replace' : 'insert', table: m[1] };
  if ((m = /^\s*UPDATE\s+(\w+)\s+/i.exec(sql))) return { op: 'update', table: m[1] };
  if ((m = /^\s*DELETE\s+FROM\s+(\w+)/i.exec(sql))) return { op: 'delete', table: m[1] };
  return null;
}

/** Index of the first top-level WHERE keyword (not inside parentheses), or -1. */
function topLevelWhereIndex(sql) {
  let depth = 0;
  const upper = sql.toUpperCase();
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0 && upper.startsWith('WHERE', i)) {
      const before = i === 0 ? ' ' : sql[i - 1];
      const after = i + 5 >= sql.length ? ' ' : sql[i + 5];
      if (/[\s)]/.test(before) && /[\s(]/.test(after)) return i;
    }
  }
  return -1;
}

function countPlaceholders(s) {
  return (s.match(/\?/g) || []).length;
}

/**
 * H-6: sentinel for a tuple value the parser cannot evaluate statically
 * (e.g. `datetime('now')`). Harmless in non-key positions — the post-image
 * read supplies the real landed value; a pk/unique-key position forces the
 * full-table fallback.
 */
const UNKNOWN = Symbol('unknown_sql_value');

function literalValue(tok) {
  if (/^NULL$/i.test(tok)) return null;
  if (/^-?\d+$/.test(tok)) return parseInt(tok, 10);
  if (/^-?\d*\.\d+$/.test(tok)) return parseFloat(tok);
  if (/^'(?:[^']|'')*'$/.test(tok)) return tok.slice(1, -1).replace(/''/g, "'");
  return UNKNOWN;
}

/**
 * Parse `INSERT ... INTO t (a,b,c) VALUES (tuple),(tuple)...` → { cols, tuples }.
 * H-6: tuples may mix `?` placeholders with SQL literals ('complete', 0, NULL)
 * and function calls (datetime('now') → UNKNOWN). The hottest live-scoring
 * INSERTs (Start Run, DNS helper, run_round_status finalize) all mix literals;
 * the old placeholder-only parser silently fell back to a full-table diff on
 * every one of them.
 */
function parseInsert(sql, args) {
  const m = /INSERT(?:\s+OR\s+\w+)?\s+INTO\s+\w+\s*\(([^)]*)\)\s*VALUES\s*/i.exec(sql);
  if (!m) return null;
  const cols = m[1].split(',').map(c => c.trim());
  if (!cols.length) return null;

  let i = m.index + m[0].length;
  let argIdx = countPlaceholders(sql.slice(0, i)); // placeholders before VALUES (normally 0)
  const n = sql.length;
  const tuples = [];
  while (i < n) {
    while (i < n && /[\s,]/.test(sql[i])) i++;
    if (i >= n || sql[i] !== '(') break; // end of tuple list (e.g. ON CONFLICT ...)
    i++;
    const tokens = [];
    let cur = '', depth = 0, inStr = false, closed = false;
    for (; i < n; i++) {
      const ch = sql[i];
      if (inStr) {
        cur += ch;
        if (ch === "'") {
          if (sql[i + 1] === "'") { cur += "'"; i++; } else inStr = false;
        }
        continue;
      }
      if (ch === "'") { inStr = true; cur += ch; continue; }
      if (ch === '(') { depth++; cur += ch; continue; }
      if (ch === ')') {
        if (depth === 0) { tokens.push(cur.trim()); i++; closed = true; break; }
        depth--; cur += ch; continue;
      }
      if (ch === ',' && depth === 0) { tokens.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (!closed || tokens.length !== cols.length) return null;
    const row = {};
    for (let j = 0; j < cols.length; j++) {
      const tok = tokens[j];
      if (tok === '?') {
        if (argIdx >= args.length) return null;
        row[cols[j]] = args[argIdx++];
      } else {
        row[cols[j]] = literalValue(tok);
        // A function token may itself bind args (e.g. datetime(?)) — keep the
        // arg cursor aligned even though the value stays UNKNOWN.
        argIdx += countPlaceholders(tok);
      }
    }
    tuples.push(row);
  }
  if (!tuples.length) return null;
  return { cols, tuples };
}

function pkWhere(table) {
  return protocol.TABLES[table].pk.map(c => `${c}=?`).join(' AND ');
}

async function selectByPk(table, pkObj) {
  const spec = protocol.TABLES[table];
  const r = await rawExecute(
    `SELECT ${spec.columns.join(',')} FROM ${table} WHERE ${pkWhere(table)}`,
    spec.pk.map(c => pkObj[c])
  );
  return r.rows.length ? rowToObj(r.rows[0]) : null;
}

async function selectPks(table, whereSql, whereArgs) {
  const spec = protocol.TABLES[table];
  const r = await rawExecute(
    `SELECT ${spec.pk.join(',')} FROM ${table}${whereSql ? ' ' + whereSql : ''}`,
    whereArgs
  );
  return r.rows.map(rowToObj);
}

// --- Capture pipeline -------------------------------------------------------

/**
 * Phase 1 (before the write): classify + pre-image. Returns a "pending"
 * descriptor consumed by capturePost, or null when the statement is not
 * captured.
 */
async function capturePre(sql, args) {
  if (!state.active) return null;
  const cls = classify(sql);
  if (!cls || !SYNC_SET.has(cls.table)) return null;
  stats.captured_statements++;
  const { op, table } = cls;
  const spec = protocol.TABLES[table];

  try {
    if (op === 'delete' || op === 'update') {
      const wIdx = topLevelWhereIndex(sql);
      const whereSql = wIdx >= 0 ? sql.slice(wIdx) : '';
      const whereArgs = wIdx >= 0 ? args.slice(args.length - countPlaceholders(whereSql)) : [];
      const pks = await selectPks(table, whereSql, whereArgs);
      return { op, table, pks };
    }
    // insert / replace / insert_ignore
    const parsed = parseInsert(sql, args);
    if (!parsed) return await fullTablePre(table, op, sql);
    const uk = UNIQUE_KEYS[table];
    // A pk (or, for conflict-capable ops, unique-key) value the parser could
    // not evaluate forces the fallback — the pre/post reads need real values.
    for (const tuple of parsed.tuples) {
      if (spec.pk.some(c => tuple[c] === UNKNOWN)) return await fullTablePre(table, op, sql);
      if (op !== 'insert' && uk && uk.some(c => tuple[c] === UNKNOWN)) return await fullTablePre(table, op, sql);
    }
    const pending = { op, table, rows: [] };
    for (const tuple of parsed.tuples) {
      const entry = { insertedPk: null, displaced: [], ukVals: null };
      if (spec.pk.every(c => tuple[c] !== undefined)) {
        entry.insertedPk = protocol.pkOf(table, tuple);
      }
      if (uk && uk.every(c => tuple[c] !== undefined && tuple[c] !== UNKNOWN)) {
        entry.ukVals = uk.map(c => tuple[c]);
        // Rows displaced by REPLACE under the unique key (different PK).
        const r = await rawExecute(
          `SELECT ${spec.pk.join(',')} FROM ${table} WHERE ${uk.map(c => `${c}=?`).join(' AND ')}`,
          entry.ukVals
        );
        for (const row of r.rows.map(rowToObj)) {
          const same = entry.insertedPk && spec.pk.every(c => row[c] === entry.insertedPk[c]);
          if (!same) entry.displaced.push(row);
        }
      }
      pending.rows.push(entry);
    }
    return pending;
  } catch (e) {
    console.error(`[outbox] capturePre failed for "${sql.slice(0, 80)}": ${e.message} — falling back to full-table diff`);
    return fullTablePre(table, op, sql);
  }
}

// H-6: the fallback is correct but severely write-amplifying (2 full-pk scans
// + one read per table row + one outbox append per row, on the request the
// operator is waiting on). It must never fire on a shipped code path — log
// loudly and count, so the harness gate and /api/venue/capture-stats see it.
const stats = { captured_statements: 0, full_table_fallbacks: 0, capture_failures: 0 };

async function fullTablePre(table, op, sql = '') {
  stats.full_table_fallbacks++;
  console.error(`[outbox] FULL-TABLE-DIFF FALLBACK on ${table} (${op}) — unparsed statement: "${String(sql).slice(0, 120)}". This is a capture-parser gap; fix the statement or the parser.`);
  const pks = await selectPks(table, '', []);
  return { op: 'fulltable', table, prePks: pks };
}

function getCaptureStats() {
  return { ...stats };
}

/** Phase 2 (after the write): post-image reads + outbox appends, in order. */
async function capturePost(pending) {
  if (!pending) return;
  const { table } = pending;
  const spec = protocol.TABLES[table];
  const records = [];

  if (pending.op === 'delete') {
    for (const pk of pending.pks) {
      records.push({ tbl: table, op: 'delete', pk: protocol.pkOf(table, pk), row: null });
    }
  } else if (pending.op === 'update') {
    for (const pk of pending.pks) {
      const row = await selectByPk(table, pk);
      if (row) records.push({ tbl: table, op: 'upsert', pk: protocol.pkOf(table, row), row: protocol.manifestRow(table, row) });
    }
  } else if (pending.op === 'fulltable') {
    const postPks = await selectPks(table, '', []);
    const key = (r) => protocol.pkString(table, r);
    const postSet = new Set(postPks.map(key));
    for (const pk of pending.prePks) {
      if (!postSet.has(key(pk))) records.push({ tbl: table, op: 'delete', pk: protocol.pkOf(table, pk), row: null });
    }
    for (const pk of postPks) {
      const row = await selectByPk(table, pk);
      if (row) records.push({ tbl: table, op: 'upsert', pk: protocol.pkOf(table, row), row: protocol.manifestRow(table, row) });
    }
  } else {
    // insert / replace / insert_ignore
    for (const entry of pending.rows) {
      for (const d of entry.displaced) {
        // Displaced row is gone only if the REPLACE actually landed; confirm.
        const still = await selectByPk(table, d);
        if (!still) records.push({ tbl: table, op: 'delete', pk: protocol.pkOf(table, d), row: null });
      }
      let row = null;
      if (entry.insertedPk) row = await selectByPk(table, entry.insertedPk);
      if (!row && entry.ukVals) {
        const uk = UNIQUE_KEYS[table];
        const r = await rawExecute(
          `SELECT ${spec.columns.join(',')} FROM ${table} WHERE ${uk.map(c => `${c}=?`).join(' AND ')}`,
          entry.ukVals
        );
        if (r.rows.length) row = rowToObj(r.rows[0]);
      }
      if (row) records.push({ tbl: table, op: 'upsert', pk: protocol.pkOf(table, row), row: protocol.manifestRow(table, row) });
    }
  }

  for (const rec of records) {
    await rawExecute(
      `INSERT INTO sync_outbox (meet_id, tbl, pk, op, row_json, idempotency_key) VALUES (?,?,?,?,?,?)`,
      [state.meetId, rec.tbl, JSON.stringify(rec.pk), rec.op, rec.row ? JSON.stringify(rec.row) : null, uuidv4()]
    );
  }
  if (records.length && onAppend) {
    try { onAppend(); } catch (_) {}
  }
}

// --- The schema.js write hook ----------------------------------------------

function noteCaptureFailure(where, e) {
  stats.capture_failures++;
  console.error(`[outbox] ${where} failed:`, e.message);
}

const hook = {
  async execute(sql, args = []) {
    // M-7a: for delete/update, the pre-image SELECT and the write run in ONE
    // atomic batch — a racing insert can no longer slip between them (the
    // "ghost row" a non-PK DELETE removes but the capture never pre-imaged).
    if (state.active) {
      const cls = classify(sql);
      if (cls && SYNC_SET.has(cls.table) && (cls.op === 'delete' || cls.op === 'update')) {
        stats.captured_statements++;
        const wIdx = topLevelWhereIndex(sql);
        const whereSql = wIdx >= 0 ? sql.slice(wIdx) : '';
        const whereArgs = wIdx >= 0 ? args.slice(args.length - countPlaceholders(whereSql)) : [];
        const spec = protocol.TABLES[cls.table];
        const preSql = `SELECT ${spec.pk.join(',')} FROM ${cls.table}${whereSql ? ' ' + whereSql : ''}`;
        try {
          const { rawBatch } = require('../db/schema');
          const rs = await rawBatch([{ sql: preSql, args: whereArgs }, { sql, args }]);
          const pks = rs[0].rows.map(rowToObj);
          try { await capturePost({ op: cls.op, table: cls.table, pks }); }
          catch (e) { noteCaptureFailure('capturePost', e); }
          return rs[1];
        } catch (e) {
          // The batch may have failed on the pre-image (unparsed WHERE shape)
          // — a capture bug must never block the write itself. Retry with the
          // full-table fallback; if the WRITE is what failed, it fails again
          // identically and propagates as before.
          const pending = await fullTablePre(cls.table, cls.op, sql).catch(() => null);
          const result = await rawExecute(sql, args);
          if (pending) {
            try { await capturePost(pending); } catch (e2) { noteCaptureFailure('capturePost (fallback)', e2); }
          }
          return result;
        }
      }
    }
    const pending = await capturePre(sql, args);
    const result = await rawExecute(sql, args);
    if (pending) {
      try { await capturePost(pending); } catch (e) {
        noteCaptureFailure('capturePost', e);
      }
    }
    return result;
  },
  async batch(statements) {
    // NOTE (M-7): pre-images here are captured before the whole batch runs —
    // acceptable because batch() call sites (bracket seeding, imports) are
    // not racing hot paths; the batch itself is atomic.
    const pendings = [];
    for (const st of statements) {
      pendings.push(await capturePre(st.sql, st.args || []));
    }
    const { rawBatch } = require('../db/schema');
    const result = await rawBatch(statements);
    for (const p of pendings) {
      if (p) {
        try { await capturePost(p); } catch (e) {
          noteCaptureFailure('capturePost (batch)', e);
        }
      }
    }
    return result;
  },
};

async function installCaptureHook() {
  await ensureOutboxTable();
  await refreshCaptureState();
  require('../db/schema').setWriteHook(hook);
}

async function outboxDepth() {
  const r = await rawExecute('SELECT COUNT(*) AS c FROM sync_outbox');
  return parseInt(rowToObj(r.rows[0]).c) || 0;
}

module.exports = {
  installCaptureHook,
  refreshCaptureState,
  ensureOutboxTable,
  setOnAppend,
  outboxDepth,
  getCaptureStats,
  _test: { classify, topLevelWhereIndex, parseInsert, UNKNOWN },
};
