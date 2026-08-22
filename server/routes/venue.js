/**
 * server/routes/venue.js — venue-mode-only endpoints (v2 Step 2+).
 * Mounted at /api/venue ONLY when STICKIT_MODE=venue (see index.js).
 *
 * Step 2: adoption (redeem a release code against the cloud; USB package
 * import; replace-local-copy re-adoption). Later steps add PINs, seats,
 * overlay target, sync status, check-in.
 *
 * No cloud credentials ever pass through here (constraint 8): the release
 * code is the only thing a volunteer types.
 */

const express = require('express');
const router = express.Router();
const { queryOne } = require('../db/schema');
const protocol = require('../sync/protocol');
const { executeAdoptionImport } = require('../sync/adoptionImport');
const { getVenueState, setVenueState } = require('../venue/state');

const DEFAULT_CLOUD_URL = process.env.STICKIT_CLOUD_URL || 'https://stickit-tga4.onrender.com';

// ---------------------------------------------------------------------------
// POST /api/venue/adopt — { code, cloud_url?, replace? }
// Redeems the release code against the cloud, imports the returned package
// ID-preservingly, and stores the sync token + cloud URL locally.
// ---------------------------------------------------------------------------
router.post('/adopt', async (req, res) => {
  try {
    const { code, cloud_url, replace } = req.body || {};
    if (!code || !String(code).trim()) {
      return res.status(400).json({ error: 'code_required', message: 'Enter the release code shown on the cloud meet page.' });
    }
    const existingState = await getVenueState();
    if (existingState && existingState.meet_state === 'adopted') {
      return res.status(409).json({
        error: 'already_hosting',
        message: 'This venue server is already hosting a meet. Check it in or hand it back before adopting another.',
      });
    }

    const cloudBase = (cloud_url || DEFAULT_CLOUD_URL).replace(/\/+$/, '');

    // Peek first (does NOT burn the one-time code): if we already hold a local
    // copy of this meet and the volunteer hasn't confirmed the replace, refuse
    // now so the code stays valid for the retry (D8 one-tap re-adoption).
    if (!replace) {
      try {
        const peekR = await fetch(`${cloudBase}/api/sync/peek`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: String(code).trim(), protocol_version: protocol.SYNC_PROTOCOL_VERSION }),
        });
        const peek = await peekR.json().catch(() => ({}));
        if (!peekR.ok) {
          return res.status(peekR.status).json({ error: peek.error || 'cloud_error', message: peek.message || `Cloud refused the code (HTTP ${peekR.status}).` });
        }
        const localCopy = await queryOne('SELECT id, name FROM meets WHERE id=?', [peek.meet_id]);
        if (localCopy) {
          return res.status(409).json({
            error: 'meet_exists',
            offer_replace: true,
            message: `A local copy of "${localCopy.name}" already exists (from a previous day). Replace it with the current cloud version?`,
          });
        }
      } catch (e) {
        return res.status(502).json({
          error: 'cloud_unreachable',
          message: 'Could not reach the cloud server. Adoption needs internet at that moment — check the uplink, or use the USB import (plan B).',
        });
      }
    }

    let cloudResp;
    try {
      const r = await fetch(`${cloudBase}/api/sync/adopt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: String(code).trim(), protocol_version: protocol.SYNC_PROTOCOL_VERSION }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(r.status).json({
          error: data.error || 'cloud_error',
          message: data.message || `Cloud refused the adoption (HTTP ${r.status}).`,
        });
      }
      cloudResp = data;
    } catch (e) {
      return res.status(502).json({
        error: 'cloud_unreachable',
        message: 'Could not reach the cloud server. Adoption needs internet at that moment — check the uplink, or use the USB import (plan B).',
      });
    }

    if (cloudResp.protocol_version !== protocol.SYNC_PROTOCOL_VERSION) {
      return res.status(409).json({
        error: 'protocol_mismatch',
        message: `Sync protocol mismatch: this venue server speaks version ${protocol.SYNC_PROTOCOL_VERSION}, the cloud sent ${cloudResp.protocol_version}. Update StickIt on the older side.`,
      });
    }

    let result;
    try {
      result = await executeAdoptionImport(cloudResp.package, { replace: !!replace });
    } catch (e) {
      // The cloud is now locked but the local import failed. Surface a clear
      // error; the meet can be re-adopted after admin force-unlock + re-release
      // (or via USB). meet_exists offers the one-tap replace path instead.
      if (e.code === 'meet_exists') {
        return res.status(409).json({ error: 'meet_exists', message: e.message, offer_replace: true });
      }
      return res.status(e.httpCode || 500).json({ error: e.code || 'import_failed', message: e.message });
    }

    await setVenueState({
      meet_id: result.meet_id,
      sync_token: cloudResp.sync_token,
      cloud_url: cloudBase,
      meet_state: 'adopted',
    });

    const meet = await queryOne('SELECT id, name, date, location FROM meets WHERE id=?', [result.meet_id]);
    res.json({ ok: true, meet, counts: result.counts, logo: result.logo });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/venue/import-package — USB plan B. Body: { package, replace? }
// where `package` is the parsed Export-for-Adoption file (carries sync_token).
// ---------------------------------------------------------------------------
router.post('/import-package', async (req, res) => {
  try {
    const { package: pkg, replace } = req.body || {};
    if (!pkg) return res.status(400).json({ error: 'package_required' });
    const existingState = await getVenueState();
    if (existingState && existingState.meet_state === 'adopted') {
      return res.status(409).json({
        error: 'already_hosting',
        message: 'This venue server is already hosting a meet. Check it in or hand it back before adopting another.',
      });
    }
    if (!pkg.sync_token) {
      return res.status(400).json({ error: 'bad_package', message: 'This file has no sync token — use an Export for Adoption file, not a regular meet export.' });
    }

    let result;
    try {
      result = await executeAdoptionImport(pkg, { replace: !!replace });
    } catch (e) {
      if (e.code === 'meet_exists') {
        return res.status(409).json({ error: 'meet_exists', message: e.message, offer_replace: true });
      }
      return res.status(e.httpCode || 500).json({ error: e.code || 'import_failed', message: e.message });
    }

    await setVenueState({
      meet_id: result.meet_id,
      sync_token: pkg.sync_token,
      cloud_url: (req.body.cloud_url || DEFAULT_CLOUD_URL).replace(/\/+$/, ''),
      meet_state: 'adopted',
    });

    const meet = await queryOne('SELECT id, name, date, location FROM meets WHERE id=?', [result.meet_id]);
    res.json({ ok: true, meet, counts: result.counts, logo: result.logo });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
