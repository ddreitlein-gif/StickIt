/**
 * server/routes/sync.js — cloud-side sync endpoints (v2 Step 2+).
 * Mounted at /api/sync in CLOUD mode only (venue servers do not serve these).
 *
 * Step 2: POST /adopt (release-code redemption → lock-drain-snapshot →
 * package + sync token). Later steps add /meets/:meetId/changes, /checksums,
 * /checkin, /repush.
 *
 * These endpoints are deliberately OUTSIDE the adoption-lock guards — they
 * carry the venue's authority. Auth is the release code (adopt) or the
 * per-adoption sync token (everything else); never cloud user credentials
 * (constraint 8).
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { queryOne, execute } = require('../db/schema');
const protocol = require('../sync/protocol');
const { hashToken } = require('../sync/adoption');
const { buildAdoptionPackage } = require('../sync/package');

function protocolMismatch(res, received) {
  return res.status(409).json({
    error: 'protocol_mismatch',
    expected: protocol.SYNC_PROTOCOL_VERSION,
    received: received ?? null,
    message: `Sync protocol mismatch: cloud speaks version ${protocol.SYNC_PROTOCOL_VERSION}, request is version ${received ?? 'unknown'}. Update StickIt on the older side.`,
  });
}

// ---------------------------------------------------------------------------
// POST /api/sync/peek — validate a release code WITHOUT redeeming it.
// Lets the venue detect "I already hold an archived copy of this meet" and
// offer the one-tap replace BEFORE the one-time code is burned (D8).
// ---------------------------------------------------------------------------
router.post('/peek', async (req, res) => {
  try {
    const { code, protocol_version } = req.body || {};
    if (protocol_version !== protocol.SYNC_PROTOCOL_VERSION) {
      return protocolMismatch(res, protocol_version);
    }
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'code_required' });
    }
    const codeHash = hashToken(code.trim().toUpperCase());
    const meet = await queryOne('SELECT id, name, date, adoption_status, release_code_expires_at FROM meets WHERE release_code_hash=?', [codeHash]);
    if (!meet) return res.status(404).json({ error: 'code_invalid', message: 'That release code is not valid.' });
    if (meet.release_code_expires_at && new Date(meet.release_code_expires_at).getTime() < Date.now()) {
      return res.status(404).json({ error: 'code_expired', message: 'That release code has expired.' });
    }
    res.json({ meet_id: meet.id, meet_name: meet.name, meet_date: meet.date });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/sync/adopt — redeem a release code (R13).
// Order is LOCK-FIRST (tested invariant, Section 5.2): validate → atomic
// redemption (conditional UPDATE, single winner) → drain in-flight requests →
// snapshot → token. A write landing between snapshot and lock would be
// silently overwritten by upsync; lock-then-snapshot makes that impossible —
// post-lock writes are refused (423) and pre-lock writes are in the snapshot.
// ---------------------------------------------------------------------------
router.post('/adopt', async (req, res) => {
  try {
    const { code, protocol_version } = req.body || {};
    if (protocol_version !== protocol.SYNC_PROTOCOL_VERSION) {
      return protocolMismatch(res, protocol_version);
    }
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'code_required', message: 'Release code required' });
    }
    const codeHash = hashToken(code.trim().toUpperCase());
    const meet = await queryOne('SELECT * FROM meets WHERE release_code_hash=?', [codeHash]);
    if (!meet) {
      return res.status(404).json({ error: 'code_invalid', message: 'That release code is not valid. Codes work once — ask the official to release the meet again for a new code.' });
    }
    if (meet.remote_judging) {
      // Belt-and-suspenders; release already refuses remote-judging meets.
      return res.status(409).json({ error: 'remote_judging_meet', message: 'This meet is cloud-only (remote judging) and cannot be adopted.' });
    }
    if (meet.release_code_expires_at && new Date(meet.release_code_expires_at).getTime() < Date.now()) {
      return res.status(404).json({ error: 'code_expired', message: 'That release code has expired. Ask the official to release the meet again for a new code.' });
    }

    // Atomic redemption + lock: conditional UPDATE — two venue servers can
    // never both succeed (FR-4). Clearing release_code_hash burns the code.
    const syncToken = crypto.randomBytes(32).toString('hex');
    const result = await execute(
      `UPDATE meets
         SET adoption_status='adopted', adopted_at=datetime('now'),
             sync_token_hash=?, release_code_hash=NULL, release_code_expires_at=NULL,
             last_applied_seq=0, updated_at=datetime('now')
       WHERE id=? AND release_code_hash=? AND adoption_status IS NULL`,
      [hashToken(syncToken), meet.id, codeHash]
    );
    if (!result.rowsAffected) {
      return res.status(409).json({ error: 'already_adopted', message: 'Another venue server redeemed this code first.' });
    }

    // Drain: the lock refuses new mutations from this instant; give requests
    // already inside a handler a moment to finish their writes before the
    // snapshot reads (single-process Express; writes are short).
    await new Promise(r => setTimeout(r, 300));

    const pkg = await buildAdoptionPackage(meet.id);

    try {
      const { logAudit } = require('./audit');
      await logAudit('meet_adopted', 'meet', meet.id, null, { via: 'release_code' });
    } catch (_) {}

    res.json({
      protocol_version: protocol.SYNC_PROTOCOL_VERSION,
      meet_id: meet.id,
      meet_name: meet.name,
      sync_token: syncToken,
      package: pkg,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
