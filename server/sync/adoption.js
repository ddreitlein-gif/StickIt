/**
 * server/sync/adoption.js — cloud-side adoption state helpers (v2 Step 1).
 *
 * A meet with `adoption_status='adopted'` is venue-authoritative: the cloud is
 * a read-only mirror and every cloud-side mutation touching the meet must be
 * refused (Section 5.2, FR-20). These helpers resolve "which meet does this
 * request touch" for the requireNotAdopted middleware, plus release-code and
 * token utilities shared by the release/redeem endpoints.
 *
 * All lookups are per-request fresh reads (no caching) so a lock takes effect
 * immediately across every worker path.
 */

const crypto = require('crypto');
const { queryOne, queryAll } = require('../db/schema');

// Ambiguity-free alphabet (no 0/O/1/I) for release codes read over the phone.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

function generateReleaseCode() {
  let code = '';
  const bytes = crypto.randomBytes(CODE_LENGTH);
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

/** SHA-256 hex — used for both release codes and sync tokens (never stored raw). */
function hashToken(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

/** Full adoption-state row for a meet (null when the meet doesn't exist). */
async function getAdoptionState(meetId) {
  if (!meetId) return null;
  return queryOne(
    `SELECT id, name, adoption_status, adopted_at, last_sync_at, last_applied_seq,
            remote_judging, release_code_hash, release_code_expires_at, released_at, released_by
     FROM meets WHERE id=?`,
    [meetId]
  );
}

async function isMeetAdopted(meetId) {
  if (!meetId) return false;
  const row = await queryOne(`SELECT adoption_status FROM meets WHERE id=?`, [meetId]);
  return !!row && row.adoption_status === 'adopted';
}

/** meet id for an event id (null when unknown). */
async function meetIdForEvent(eventId) {
  if (!eventId) return null;
  const row = await queryOne(`SELECT meet_id FROM events WHERE id=?`, [eventId]);
  return row ? row.meet_id : null;
}

/** meet id for a training day id (null when unknown). */
async function meetIdForTrainingDay(trainingDayId) {
  if (!trainingDayId) return null;
  const row = await queryOne(`SELECT meet_id FROM training_days WHERE id=?`, [trainingDayId]);
  return row ? row.meet_id : null;
}

/**
 * FR-8 — an athlete row is adoption-locked when it is referenced by a
 * registration in any adopted meet. Returns the adopted meet id (for the
 * middleware) or null.
 */
async function adoptedMeetForAthlete(athleteId) {
  if (!athleteId) return null;
  const row = await queryOne(
    `SELECT m.id FROM meets m
     JOIN events e ON e.meet_id = m.id
     JOIN registrations r ON r.event_id = e.id
     WHERE m.adoption_status = 'adopted' AND r.athlete_id = ?
     LIMIT 1`,
    [athleteId]
  );
  return row ? row.id : null;
}

async function isAthleteAdoptionLocked(athleteId) {
  return !!(await adoptedMeetForAthlete(athleteId));
}

/** All athlete ids locked by any current adoption (FR-8 bulk operations). */
async function athleteIdsLockedByAdoption() {
  const rows = await queryAll(
    `SELECT DISTINCT r.athlete_id FROM meets m
     JOIN events e ON e.meet_id = m.id
     JOIN registrations r ON r.event_id = e.id
     WHERE m.adoption_status = 'adopted'`
  );
  return new Set(rows.map(r => r.athlete_id));
}

module.exports = {
  CODE_ALPHABET,
  CODE_LENGTH,
  generateReleaseCode,
  hashToken,
  getAdoptionState,
  isMeetAdopted,
  meetIdForEvent,
  meetIdForTrainingDay,
  adoptedMeetForAthlete,
  isAthleteAdoptionLocked,
  athleteIdsLockedByAdoption,
};
