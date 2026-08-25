/**
 * server/venue/active.js — active-event tracking for auto-follow (v2 Step 3).
 *
 * FR-15 / R4: every per-event role surface (judge seats, HJ, timekeeper,
 * scoreboard, permanent overlay) follows "the event with the action" across
 * an interleaved competition day. The tracker is fed by the venue server's
 * own broadcasts (run_started / dual_match_started / score_update) and falls
 * back to a DB scan after a restart.
 */

const { queryOne } = require('../db/schema');

let lastActive = { eventId: null, at: 0 };

// M-14: how stale the spotlight holder must be before OTHER activity (paper/
// manual scoring emits score_update/run_updated but never run_started) can
// take it over. Without this, a morning tablet-scored event pins every
// surface for the whole afternoon of a paper-scored event.
const TAKEOVER_AFTER_MS = 3 * 60 * 1000;

/** Called from the venue-mode broadcast hook in index.js. */
function noteActivity(eventId, type) {
  if (!eventId) return;
  // M-14: when the tracked event finalizes, release the spotlight so the DB
  // fallback (or the next activity) picks the live event.
  if (type === 'event_finalized') {
    if (lastActive.eventId === eventId) resetActive();
    return;
  }
  // Starting a run/match takes the spotlight immediately; score updates keep
  // an already-active event current but never steal it from a FRESH holder.
  if (type === 'run_started' || type === 'dual_match_started') {
    lastActive = { eventId, at: Date.now() };
  } else if (lastActive.eventId === eventId) {
    lastActive.at = Date.now();
  } else if (!lastActive.eventId || Date.now() - lastActive.at > TAKEOVER_AFTER_MS) {
    lastActive = { eventId, at: Date.now() };
  }
}

/**
 * Resolve the event to follow for the adopted meet.
 * Order: in-memory tracker → run currently on course → active dual match →
 * most recently updated non-setup event → first event of the meet.
 */
async function getActiveEventId(meetId) {
  if (lastActive.eventId) {
    // Confirm it still belongs to the adopted meet (paranoia after re-adopt).
    const ok = await queryOne('SELECT id FROM events WHERE id=? AND meet_id=?', [lastActive.eventId, meetId]);
    if (ok) return lastActive.eventId;
    lastActive = { eventId: null, at: 0 };
  }
  let row = await queryOne(
    `SELECT r.event_id FROM runs r JOIN events e ON e.id = r.event_id
     WHERE e.meet_id=? AND r.status='scoring' ORDER BY r.updated_at DESC LIMIT 1`,
    [meetId]
  );
  if (row) return row.event_id;
  row = await queryOne(
    `SELECT id FROM events WHERE meet_id=? AND active_dual_match_id IS NOT NULL ORDER BY updated_at DESC LIMIT 1`,
    [meetId]
  );
  if (row) return row.id;
  row = await queryOne(
    `SELECT id FROM events WHERE meet_id=? AND status != 'setup' ORDER BY updated_at DESC LIMIT 1`,
    [meetId]
  );
  if (row) return row.id;
  row = await queryOne(
    `SELECT id FROM events WHERE meet_id=? ORDER BY created_at LIMIT 1`,
    [meetId]
  );
  return row ? row.id : null;
}

function resetActive() {
  lastActive = { eventId: null, at: 0 };
}

module.exports = { noteActivity, getActiveEventId, resetActive };
