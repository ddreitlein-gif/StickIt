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

/** Called from the venue-mode broadcast hook in index.js. */
function noteActivity(eventId, type) {
  if (!eventId) return;
  // Starting a run/match takes the spotlight immediately; score updates keep
  // an already-active event current but never steal it from a newer start.
  if (type === 'run_started' || type === 'dual_match_started') {
    lastActive = { eventId, at: Date.now() };
  } else if (lastActive.eventId === eventId) {
    lastActive.at = Date.now();
  } else if (!lastActive.eventId) {
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
