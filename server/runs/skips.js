/**
 * server/runs/skips.js — v2.8.00 "Skip athlete": move an athlete (or a dual
 * match) DOWN the run order for the run in progress without touching the
 * stored order.
 *
 * Why a side table and not an UPDATE of registrations.run_order /
 * phase_run_order.run_order / the pairing numbers:
 *   * next-up is computed on the fly everywhere ("lowest run_order among
 *     registered athletes with no runs row for this run number"), nothing
 *     stores "who is next";
 *   * flat (no-phase) events reuse registrations.run_order for Run 2, the
 *     start-list / run-order PDFs print it, and later phases build their
 *     order from it ("same" method) — a skip must affect the CURRENT run
 *     only (David's ruling 10-28-26), so the base order is never edited.
 *
 * run_order_skips holds one row per (event, run_number, athlete) or
 * (event, match):
 *   base_order  the run_order / pairing number the athlete had when skipped
 *   sort_order  the effective key for this run
 * The effective key is
 *   CASE WHEN s.base_order = <base> THEN s.sort_order ELSE <base> END
 * so a row is live only while the base number is unchanged: a reorder,
 * random order, rebuild-order or locked-order scratch makes it inert on its
 * own (no cleanup at the ~9 base-order write sites), and `skipped` =
 * (s.base_order = <base>) tells the UI whether the row is live.
 *
 * Skip by k spots: R = the remaining list in effective order (same filter as
 * /runs/upcoming), i = the athlete's index, t = min(i + k, R.length - 1).
 * t == i → nothing to do. Otherwise the new key goes strictly between R[t]'s
 * key and the next-higher key anywhere in the list (placeAfter), or
 * R[t].key + 1 when R[t] is the highest — halving the gap keeps every key
 * distinct through any realistic number of repeat skips (a double has ~52
 * halvings before two keys collide). Restore = DELETE the row.
 *
 * Venue-local by design: the table is outside the sync manifest
 * (server/sync/protocol.js), so the outbox never captures it, the adoption
 * package never carries it and SYNC_PROTOCOL_VERSION stays 3. The audit rows
 * written by the routes DO sync (audit_log), so the cloud keeps the record.
 */

const { queryAll, queryOne, execute, uuidv4 } = require('../db/schema');
const runOrderLib = require('../dual/runOrder');
const { normalizeGender } = require('../utils/gender');

// ---------------------------------------------------------------------------
// SQL fragments — the ONE home of the effective-order expression.
// ---------------------------------------------------------------------------

/** LEFT JOIN fragment. Binds ONE parameter (the run number) BEFORE the WHERE params. */
const SKIP_JOIN = `LEFT JOIN run_order_skips s ON s.event_id = reg.event_id AND s.run_number = ? AND s.registration_id = reg.id`;

/** Effective sort key for a base-order column reference ('reg.run_order' / 'pro.run_order'). */
const orderKey = (base) => `CASE WHEN s.base_order = ${base} THEN s.sort_order ELSE ${base} END`;

/** 1 when a live skip row exists for the athlete, NULL otherwise (→ false in JS). */
const skippedCol = (base) => `(s.base_order = ${base}) AS skipped`;

/** Normalise the raw `skipped` column (1 / 0 / NULL) to a boolean on every row. */
const withSkipFlag = (rows) => (rows || []).map(r => ({ ...r, skipped: r.skipped === 1 }));

const DEFAULT_COLS = 'reg.id, reg.bib_number, {base}, a.first_name, a.last_name';

/**
 * Remaining athletes for a run on a NO-PHASE event (registrations.run_order).
 * Params: [runNumber, eventId, eventId, runNumber].
 * Byte-identical row order to the pre-v2.8.00 query when no skip row exists
 * (the CASE falls back to the base column).
 */
function legacyRemainingSql({ cols = DEFAULT_COLS, limit1 = false } = {}) {
  const base = 'reg.run_order';
  return `SELECT ${cols.split('{base}').join(base)}, ${skippedCol(base)}
       FROM registrations reg
       JOIN athletes a ON a.id = reg.athlete_id
       ${SKIP_JOIN}
       WHERE reg.event_id = ? AND reg.status = 'registered' AND reg.run_order IS NOT NULL
         AND reg.id NOT IN (SELECT r.registration_id FROM runs r WHERE r.event_id = ? AND r.run_number = ?)
       ORDER BY ${orderKey(base)} ASC${limit1 ? '\n       LIMIT 1' : ''}`;
}

/**
 * Remaining athletes for a PHASE (phase_run_order).
 * Params: [runNumber, phaseId, eventId, runNumber].
 */
function phasedRemainingSql({ cols = DEFAULT_COLS, limit1 = false } = {}) {
  const base = 'pro.run_order';
  return `SELECT ${cols.split('{base}').join(base)}, ${skippedCol(base)}
       FROM phase_run_order pro
       JOIN registrations reg ON reg.id = pro.registration_id
       JOIN athletes a ON a.id = reg.athlete_id
       ${SKIP_JOIN}
       WHERE pro.phase_id = ? AND reg.status = 'registered'
         AND reg.id NOT IN (SELECT r.registration_id FROM runs r WHERE r.event_id = ? AND r.run_number = ?)
       ORDER BY ${orderKey(base)} ASC${limit1 ? '\n       LIMIT 1' : ''}`;
}

/**
 * Viewer API (server/routes/viewer.js) variants — same filters the viewer
 * has always used (NOT EXISTS on scoring/complete runs, LIMIT ?).
 * Phased params: [runNumber, phaseId, eventId, runNumber, limit].
 * Legacy params: [runNumber, eventId, runNumber, limit].
 */
function viewerPhasedSql() {
  const base = 'pro.run_order';
  return `SELECT a.first_name, a.last_name, reg.bib_number, pro.run_order, ${skippedCol(base)}
           FROM phase_run_order pro
           JOIN registrations reg ON reg.id = pro.registration_id
           JOIN athletes a ON a.id = reg.athlete_id
           ${SKIP_JOIN}
           WHERE pro.phase_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM runs r
               WHERE r.registration_id = pro.registration_id
                 AND r.event_id = ?
                 AND r.run_number = ?
                 AND r.status IN ('scoring', 'complete')
             )
           ORDER BY ${orderKey(base)}
           LIMIT ?`;
}
function viewerLegacySql() {
  const base = 'reg.run_order';
  return `SELECT a.first_name, a.last_name, reg.bib_number, reg.run_order, ${skippedCol(base)}
           FROM registrations reg
           JOIN athletes a ON a.id = reg.athlete_id
           ${SKIP_JOIN}
           WHERE reg.event_id = ?
             AND reg.status = 'registered'
             AND reg.run_order IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM runs r
               WHERE r.registration_id = reg.id
                 AND r.run_number = ?
                 AND r.status IN ('scoring', 'complete')
             )
           ORDER BY ${orderKey(base)}
           LIMIT ?`;
}

// ---------------------------------------------------------------------------
// Request parsing shared by POST /runs/skip and POST /dual/skip
// ---------------------------------------------------------------------------

/** `spots`: absent → 1; otherwise a whole number 1..999 (strings from inputs accepted). NaN when invalid. */
function parseSpots(raw) {
  if (raw === undefined || raw === null || raw === '') return 1;
  const n = typeof raw === 'string' ? Number(raw.trim()) : Number(raw);
  return (Number.isInteger(n) && n >= 1 && n <= 999) ? n : NaN;
}

/**
 * `expected_position` (optional): the 1-based position the caller saw the
 * athlete / pairing at. When sent, the skip is refused unless the target is
 * still there — so two tablets pressing Skip for the same no-show cannot move
 * them twice (ultra review 10-28-26). Absent → undefined; invalid → NaN.
 */
function parseExpectedPosition(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = typeof raw === 'string' ? Number(raw.trim()) : Number(raw);
  return (Number.isInteger(n) && n >= 1) ? n : NaN;
}

// ---------------------------------------------------------------------------
// Key placement (shared by singles and dual)
// ---------------------------------------------------------------------------

/**
 * New key for an item that must sort right AFTER ordered[t].
 * `allKeys` = every key that could sit in the same sorted list (the remaining
 * athletes; for dual every non-bye match, so a key never ties with the first
 * match of the next block). Duplicate base values are jumped by the strict
 * `>`, so the moved item lands after the whole tie group.
 */
function placeAfter(ordered, t, allKeys) {
  const at = Number(ordered[t].sort_key);
  let upper = null;
  for (const k of allKeys) {
    const n = Number(k);
    if (Number.isFinite(n) && n > at && (upper == null || n < upper)) upper = n;
  }
  return upper == null ? at + 1 : (at + upper) / 2;
}

// ---------------------------------------------------------------------------
// Singles (moguls / aerials, flat or phased)
// ---------------------------------------------------------------------------

/** The phase whose run_number is `runNumber`, or null (no phases / none for that run). */
async function phaseForRun(eventId, runNumber) {
  const phases = await queryAll(`SELECT * FROM event_phases WHERE event_id=? ORDER BY sequence_order`, [eventId]);
  if (!phases.length) return null;
  return phases.find(p => p.run_number === runNumber) || null;
}

/**
 * Remaining athletes for a run in EFFECTIVE order, each with `sort_key`
 * (the effective key) and `skipped`. Mirrors GET /runs/upcoming exactly:
 * a phase for the run number → phase_run_order, else registrations.run_order.
 */
async function listRemaining(eventId, runNumber) {
  const phase = await phaseForRun(eventId, runNumber);
  const cols = `${DEFAULT_COLS}, ${orderKey('{base}')} AS sort_key`;
  const rows = phase
    ? await queryAll(phasedRemainingSql({ cols }), [runNumber, phase.id, eventId, runNumber])
    : await queryAll(legacyRemainingSql({ cols }), [runNumber, eventId, eventId, runNumber]);
  return { phase, rows: withSkipFlag(rows) };
}

/**
 * Move one athlete `spots` places down the remaining order of `runNumber`.
 * @returns {{ moved, stale, from_position, to_position, remaining, sort_order }}
 *          positions are 1-based within the remaining list; `null` when the
 *          athlete is not in the remaining list (caller turns that into 400/409);
 *          `stale: true` (nothing written) when `expectedPosition` was given
 *          and the athlete is no longer at it.
 */
async function skipAthlete({ eventId, runNumber, registrationId, spots, expectedPosition }) {
  const { rows } = await listRemaining(eventId, runNumber);
  const i = rows.findIndex(r => r.id === registrationId);
  if (i < 0) return null;
  const t = Math.min(i + spots, rows.length - 1);
  const base = {
    from_position: i + 1,
    to_position: t + 1,
    remaining: rows.length,
    base_order: Number(rows[i].run_order),
  };
  if (expectedPosition !== undefined && expectedPosition !== i + 1) return { ...base, moved: false, stale: true };
  if (t === i) return { ...base, moved: false, sort_order: Number(rows[i].sort_key) };
  const sortOrder = placeAfter(rows, t, rows.map(r => r.sort_key));
  await execute(
    `INSERT INTO run_order_skips (id, event_id, run_number, registration_id, base_order, sort_order)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(event_id, run_number, registration_id)
     DO UPDATE SET base_order=excluded.base_order, sort_order=excluded.sort_order, created_at=datetime('now')`,
    [uuidv4(), eventId, runNumber, registrationId, base.base_order, sortOrder]
  );
  return { ...base, moved: true, sort_order: sortOrder };
}

/** Remove the skip row (the base order comes back untouched). @returns true when a row existed. */
async function restoreAthlete(eventId, runNumber, registrationId) {
  const row = await queryOne(
    `SELECT id FROM run_order_skips WHERE event_id=? AND run_number=? AND registration_id=?`,
    [eventId, runNumber, registrationId]
  );
  if (!row) return false;
  await execute(`DELETE FROM run_order_skips WHERE id=?`, [row.id]);
  return true;
}

// ---------------------------------------------------------------------------
// Dual moguls — the unit is the MATCH, the base key its pairing number
// ---------------------------------------------------------------------------

/** Map match_id → skip row for an event (dual rows only). */
async function loadDualSkips(eventId) {
  const rows = await queryAll(
    `SELECT match_id, base_order, sort_order FROM run_order_skips WHERE event_id=? AND match_id IS NOT NULL`,
    [eventId]
  );
  return new Map(rows.map(r => [r.match_id, r]));
}

/** Effective run-sequence key for a match (null for byes / unnumbered matches). */
function dualKeyOf(pairingNum, skipRow) {
  if (pairingNum == null) return null;
  return (skipRow && Number(skipRow.base_order) === Number(pairingNum)) ? Number(skipRow.sort_order) : Number(pairingNum);
}

/** True when the skip row is live for this pairing number. */
function dualSkipped(pairingNum, skipRow) {
  return !!(skipRow && pairingNum != null && Number(skipRow.base_order) === Number(pairingNum));
}

const playable = (m) => !m.is_bye && !!m.registration_id_blue && !!m.registration_id_red;

/**
 * Bracket context for the skip / guard logic: every match with status and
 * sides, pairing numbers, the blocks of the day and the gender prefix.
 */
async function loadDualContext(eventId) {
  const event = await queryOne('SELECT runoff_option, gender, active_dual_match_id FROM events WHERE id=?', [eventId]);
  const runoffOption = (event && event.runoff_option) || 'runoff_to_4th';
  const matches = await queryAll(
    `SELECT id, bracket_round, bracket_position, is_small_final, is_bye, status,
            registration_id_blue, registration_id_red
       FROM dual_bracket WHERE event_id = ?
       ORDER BY bracket_round DESC, bracket_position`,
    [eventId]
  );
  const skips = await loadDualSkips(eventId);
  return {
    matches,
    runoffOption,
    pairingNums: runOrderLib.pairingNumbers(matches, runoffOption),
    blocks: runOrderLib.roundBlocks(matches, runoffOption),
    skips,
    genderPrefix: normalizeGender(event && event.gender) === 'F' ? 'W' : 'M',
    // PUT /active-match never changes dual_bracket.status (the live match stays
    // 'pending'), so "not started" must also exclude the active match.
    activeMatchId: (event && event.active_dual_match_id) || null,
  };
}

/** Pending, both sides known, not a bye, and not the match being scored right now. */
function waiting(ctx, m) {
  return playable(m) && m.status === 'pending' && m.id !== ctx.activeMatchId;
}

function keyOfMatch(ctx, m) {
  return dualKeyOf(ctx.pairingNums.get(m.id), ctx.skips.get(m.id));
}
function labelOf(ctx, m) {
  const n = ctx.pairingNums.get(m.id);
  return n != null ? runOrderLib.formatPairingLabel(ctx.genderPrefix, n) : null;
}
function blockIndexOf(ctx, matchId) {
  return ctx.blocks.findIndex(b => b.matches.some(m => m.id === matchId));
}

/**
 * Move one waiting match `spots` places down the waiting matches of ITS OWN
 * block (a skipped Round-of-16 pairing is still a Round-of-16 pairing).
 * @returns null when the match is not a waiting playable match (complete,
 *          active, bye, unfilled); `stale: true` when `expectedPosition` was
 *          given and the match is no longer at it.
 */
async function skipMatch({ eventId, matchId, spots, expectedPosition }) {
  const ctx = await loadDualContext(eventId);
  const match = ctx.matches.find(m => m.id === matchId);
  if (!match || !waiting(ctx, match)) return null;
  const bi = blockIndexOf(ctx, matchId);
  if (bi < 0) return null;
  const pending = ctx.blocks[bi].matches
    .filter(m => waiting(ctx, m) && keyOfMatch(ctx, m) != null)
    .map(m => ({ ...m, sort_key: keyOfMatch(ctx, m) }))
    .sort((a, b) => a.sort_key - b.sort_key);
  const i = pending.findIndex(m => m.id === matchId);
  if (i < 0) return null;
  const t = Math.min(i + spots, pending.length - 1);
  const pairingNum = ctx.pairingNums.get(matchId);
  const base = {
    from_position: i + 1,
    to_position: t + 1,
    remaining_in_round: pending.length,
    pairing_number: pairingNum,
    pairing_label: labelOf(ctx, match),
    round_name: runOrderLib.roundLabel(match, ctx.matches),
  };
  if (expectedPosition !== undefined && expectedPosition !== i + 1) return { ...base, moved: false, stale: true };
  if (t === i) return { ...base, moved: false, run_sequence: pending[i].sort_key };
  const allKeys = ctx.matches.filter(m => !m.is_bye).map(m => keyOfMatch(ctx, m)).filter(k => k != null);
  const sortOrder = placeAfter(pending, t, allKeys);
  await execute(
    `INSERT INTO run_order_skips (id, event_id, run_number, match_id, base_order, sort_order)
     VALUES (?,?,1,?,?,?)
     ON CONFLICT(event_id, match_id)
     DO UPDATE SET base_order=excluded.base_order, sort_order=excluded.sort_order, created_at=datetime('now')`,
    [uuidv4(), eventId, matchId, pairingNum, sortOrder]
  );
  return { ...base, moved: true, run_sequence: sortOrder };
}

/** Remove a match's skip row. @returns true when a row existed. */
async function restoreMatch(eventId, matchId) {
  const row = await queryOne(`SELECT id FROM run_order_skips WHERE event_id=? AND match_id=?`, [eventId, matchId]);
  if (!row) return false;
  await execute(`DELETE FROM run_order_skips WHERE id=?`, [row.id]);
  return true;
}

/**
 * The guard behind PUT /dual/active-match: a still-pending skipped match in
 * an EARLIER block than the requested match must be run first.
 * @returns {{ match, pairing_label, round_name }|null}
 */
async function earlierBlockSkipPending(eventId, requestedMatchId) {
  const ctx = await loadDualContext(eventId);
  const bi = blockIndexOf(ctx, requestedMatchId);
  if (bi <= 0) return null;
  for (let b = 0; b < bi; b++) {
    const hit = ctx.blocks[b].matches
      .filter(m => m.id !== requestedMatchId && waiting(ctx, m)
                && dualSkipped(ctx.pairingNums.get(m.id), ctx.skips.get(m.id)))
      .map(m => ({ ...m, sort_key: keyOfMatch(ctx, m) }))
      .sort((a, b2) => a.sort_key - b2.sort_key)[0];
    if (hit) {
      return {
        match: hit,
        pairing_label: labelOf(ctx, hit),
        round_name: runOrderLib.roundLabel(hit, ctx.matches),
        requested_label: labelOf(ctx, ctx.matches.find(m => m.id === requestedMatchId)),
      };
    }
  }
  return null;
}

module.exports = {
  SKIP_JOIN, orderKey, skippedCol, withSkipFlag, parseSpots, parseExpectedPosition,
  legacyRemainingSql, phasedRemainingSql, viewerPhasedSql, viewerLegacySql,
  placeAfter, phaseForRun, listRemaining, skipAthlete, restoreAthlete,
  loadDualSkips, dualKeyOf, dualSkipped, loadDualContext, skipMatch, restoreMatch, earlierBlockSkipPending,
};
