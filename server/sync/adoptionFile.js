/**
 * server/sync/adoptionFile.js — cloud-side backup adoption file (v2.5.00).
 *
 * The "USB plan B" outbound path, promoted from a server-only endpoint to a
 * first-class option on Release for Adoption. Rules (David, 09-06-26):
 *
 *   1. Creating the file LOCKS the cloud copy immediately (same lock-drain-
 *      snapshot order as code redemption; there is no lock-later variant — the
 *      Pi may import the file at any moment without the cloud knowing).
 *   2. The release CODE keeps working after the file is created, so the venue
 *      may adopt by code OR by file. First to talk to the cloud wins:
 *        - code redeemed first → the file's token is replaced (file stale);
 *        - file imported + venue synced first (last_sync_at set) → the code,
 *          Undo Release, and a second file are all refused.
 *   3. meets.adopted_via ('code' | 'file') records how the lock happened; it
 *      is cloud lock state (NON_SYNC_COLUMNS), never part of the manifest.
 *      last_sync_at is reset to NULL whenever a NEW adoption starts (file or
 *      code), so "the venue has never synced" is always about THIS adoption
 *      (a re-exported checked_in meet must not inherit the previous one's).
 *
 * Shared by POST /api/meets/:id/export-for-adoption (legacy path, kept for the
 * harness and scripts) and POST /api/adoption/:meetId/export-file (the client).
 */

const crypto = require('crypto');
const { queryOne, execute } = require('../db/schema');
const { hashToken } = require('./adoption');
const { buildAdoptionPackage } = require('./package');

class AdoptionFileError extends Error {
  constructor(httpCode, code, message, extra = {}) {
    super(message);
    this.httpCode = httpCode;
    this.code = code;
    this.extra = extra;
  }
}

function fileNameFor(meet) {
  return `StickIt_Adoption_${String(meet.name || meet.id).replace(/[^A-Za-z0-9]+/g, '_')}.json`;
}

/**
 * Lock the meet (or re-mint the token of a never-synced file lock) and build
 * the adoption file. Returns { pkg, syncToken, fileName, reminted }.
 */
async function exportAdoptionFile(meetId, { remint = false, actor = null } = {}) {
  const meet = await queryOne('SELECT * FROM meets WHERE id=?', [meetId]);
  if (!meet) throw new AdoptionFileError(404, 'meet_not_found', 'Meet not found');
  if (meet.remote_judging) {
    throw new AdoptionFileError(409, 'remote_judging_meet',
      'This meet is configured for remote judging and is cloud-only. It cannot be adopted by a venue server.');
  }

  const syncToken = crypto.randomBytes(32).toString('hex');
  const newHash = hashToken(syncToken);
  let reminted = false;
  let result;

  if (meet.adoption_status === 'adopted') {
    // Only a file lock the venue has never talked to the cloud under can be
    // re-issued — once the venue synced, the earlier file is the live one.
    if (!remint) {
      throw new AdoptionFileError(409, 'already_adopted',
        meet.adopted_via === 'file' && !meet.last_sync_at
          ? 'A backup adoption file already exists for this meet. Use "Download adoption file again" to issue a fresh one (the earlier file stops working).'
          : 'This meet is already adopted by a venue server.',
        { adopted_via: meet.adopted_via || null, last_sync_at: meet.last_sync_at || null });
    }
    result = await execute(
      `UPDATE meets SET sync_token_hash=?, adopted_at=datetime('now'), last_applied_seq=0, last_sync_at=NULL, updated_at=datetime('now')
       WHERE id=? AND adoption_status='adopted' AND adopted_via='file' AND last_sync_at IS NULL`,
      [newHash, meetId]
    );
    if (!result.rowsAffected) {
      throw new AdoptionFileError(409, 'already_synced',
        'The venue has already imported the earlier adoption file and synced with the cloud — a new file cannot be issued. Return the meet from the venue (Check In / Hand Back) instead.',
        { adopted_via: meet.adopted_via || null, last_sync_at: meet.last_sync_at || null });
    }
    reminted = true;
  } else {
    // First export. H-2: 'checked_in' is re-exportable (day-2 recovery after
    // a mistaken Check In instead of Hand Back). The release code is KEPT
    // (ruling 2) — code redemption on a never-synced file lock is allowed by
    // POST /api/sync/adopt.
    result = await execute(
      `UPDATE meets SET adoption_status='adopted', adopted_at=datetime('now'), adopted_via='file',
              sync_token_hash=?, last_applied_seq=0, last_sync_at=NULL, updated_at=datetime('now')
       WHERE id=? AND (adoption_status IS NULL OR adoption_status='checked_in')`,
      [newHash, meetId]
    );
    if (!result.rowsAffected) {
      throw new AdoptionFileError(409, 'already_adopted', 'This meet is already adopted by a venue server.');
    }
  }

  // M-2: adaptive drain of in-flight mutations before the snapshot reads.
  await require('../utils/inflight').waitForMutationIdle();

  // M-1: on package-build failure, revert exactly what this call changed so
  // the export can simply be retried: a first export unlocks; a remint
  // restores the previous token hash (the earlier file stays valid).
  let pkg;
  try {
    pkg = await buildAdoptionPackage(meetId);
  } catch (e) {
    try {
      if (reminted) {
        await execute(
          `UPDATE meets SET sync_token_hash=?, adopted_at=?, updated_at=datetime('now')
           WHERE id=? AND adoption_status='adopted' AND sync_token_hash=?`,
          [meet.sync_token_hash, meet.adopted_at, meetId, newHash]
        );
      } else {
        await execute(
          `UPDATE meets SET adoption_status=?, adopted_at=NULL, adopted_via=NULL, sync_token_hash=NULL,
                  last_sync_at=?, updated_at=datetime('now')
           WHERE id=? AND adoption_status='adopted' AND sync_token_hash=?`,
          [meet.adoption_status || null, meet.last_sync_at || null, meetId, newHash]
        );
      }
    } catch (revertErr) {
      console.error(`[adoption] export-file revert ALSO failed for meet ${meetId}: ${revertErr.message}`);
    }
    throw new AdoptionFileError(500, 'package_build_failed',
      `Could not build the adoption file (${e.message}). ${reminted ? 'The earlier file is still the valid one' : 'The meet was NOT locked'} — try again.`);
  }

  try {
    const { logAudit } = require('../routes/audit');
    await logAudit('meet_adopted', 'meet', meetId, null, {
      via: 'usb_export', reminted, kept_release_code: !!meet.release_code_hash, by: actor,
    });
  } catch (_) {}

  return { pkg: { ...pkg, sync_token: syncToken }, syncToken, fileName: fileNameFor(meet), reminted };
}

/**
 * Undo a release. Classic case: the code was never redeemed — clear it.
 * v2.5.00: a file lock the venue has never synced under is undone too (full
 * unlock: status, token, code). Once the venue synced, refused (423).
 */
async function undoFileLock(meetId, { actor = null } = {}) {
  const meet = await queryOne('SELECT * FROM meets WHERE id=?', [meetId]);
  if (!meet) throw new AdoptionFileError(404, 'meet_not_found', 'Meet not found');

  if (meet.adoption_status === 'adopted') {
    if (meet.adopted_via !== 'file' || meet.last_sync_at) {
      throw new AdoptionFileError(423, 'meet_adopted',
        meet.adopted_via === 'file'
          ? 'The venue already imported the adoption file and synced with the cloud. Return the meet from the venue (Check In / Hand Back, or the return file), or use admin force-unlock.'
          : 'The code was already redeemed; the meet is adopted. Use check-in, handback, or admin force-unlock.');
    }
    const r = await execute(
      `UPDATE meets SET adoption_status=NULL, adopted_at=NULL, adopted_via=NULL, sync_token_hash=NULL,
              release_code_hash=NULL, release_code_expires_at=NULL, released_at=NULL, released_by=NULL,
              updated_at=datetime('now')
       WHERE id=? AND adoption_status='adopted' AND adopted_via='file' AND last_sync_at IS NULL`,
      [meetId]
    );
    if (!r.rowsAffected) {
      throw new AdoptionFileError(423, 'meet_adopted',
        'The venue synced with the cloud while you were undoing the release. Return the meet from the venue instead.');
    }
    try {
      const { logAudit } = require('../routes/audit');
      await logAudit('meet_release_undone', 'meet', meetId, null, { file_lock_cleared: true, by: actor });
    } catch (_) {}
    return { ok: true, file_lock_cleared: true };
  }

  if (!meet.release_code_hash) {
    throw new AdoptionFileError(400, 'not_released', 'Meet is not released for adoption');
  }
  await execute(
    `UPDATE meets SET release_code_hash=NULL, release_code_expires_at=NULL, released_at=NULL, released_by=NULL, updated_at=datetime('now') WHERE id=?`,
    [meetId]
  );
  try {
    const { logAudit } = require('../routes/audit');
    await logAudit('meet_release_undone', 'meet', meetId, null, { file_lock_cleared: false, by: actor });
  } catch (_) {}
  return { ok: true, file_lock_cleared: false };
}

module.exports = { exportAdoptionFile, undoFileLock, AdoptionFileError };
