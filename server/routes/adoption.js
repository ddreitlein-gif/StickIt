/**
 * server/routes/adoption.js — officials' venue-adoption actions that must run
 * on an ADOPTED meet (v2.5.00). Mounted at /api/adoption in CLOUD mode only.
 *
 * Why a separate prefix: server/index.js mounts the adoption-lock middleware
 * (requireNotAdopted → 423) on all of /api/meets/:meetId, so a return-file
 * import, the undo of a backup-file lock, or a re-issued adoption file could
 * never reach a handler there. Like /api/admin/adoption (force-unlock), this
 * router lives outside that prefix; every route is login-gated
 * (requireAuth — an official, not the system_admin role).
 *
 *   POST /:meetId/export-file    { again? }         → adoption file download
 *   POST /:meetId/unrelease                          → undo release / file lock
 *   POST /:meetId/import-return  { package, mode? }  → apply a venue return file
 */

const express = require('express');
const router = express.Router();
const { queryOne } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { exportAdoptionFile, undoFileLock, AdoptionFileError } = require('../sync/adoptionFile');
const { handleReturnImport } = require('../sync/returnImport');

const actorOf = (req) => (req.user && (req.user.username || req.user.display_name)) || null;

function sendError(res, e) {
  if (e instanceof AdoptionFileError) {
    return res.status(e.httpCode).json({ error: e.code, message: e.message, ...e.extra });
  }
  res.status(500).json({ error: e.message });
}

// Backup adoption file. First call locks the meet (keeps the release code);
// { again: true } re-mints the token of a never-synced file lock.
router.post('/:meetId/export-file', requireAuth, async (req, res) => {
  try {
    const { pkg, fileName, reminted } = await exportAdoptionFile(req.params.meetId, {
      remint: !!(req.body && req.body.again), actor: actorOf(req),
    });
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-StickIt-Reminted', reminted ? '1' : '0');
    res.send(JSON.stringify(pkg));
  } catch (e) { sendError(res, e); }
});

router.post('/:meetId/unrelease', requireAuth, async (req, res) => {
  try {
    res.json(await undoFileLock(req.params.meetId, { actor: actorOf(req) }));
  } catch (e) { sendError(res, e); }
});

// Officials' upload of the venue's return file (offline check-in / handback).
router.post('/:meetId/import-return', requireAuth, async (req, res) => {
  try {
    const meet = await queryOne('SELECT * FROM meets WHERE id=?', [req.params.meetId]);
    if (!meet) return res.status(404).json({ error: 'meet_not_found', message: 'Meet not found' });
    const { package: pkg, mode } = req.body || {};
    if (!pkg) return res.status(400).json({ error: 'package_required', message: 'No return file was sent.' });
    if (mode && mode !== 'checkin' && mode !== 'handback') {
      return res.status(400).json({ error: 'bad_mode', message: 'mode must be checkin or handback' });
    }
    await handleReturnImport(req, res, { meet, pkg, mode: mode || null, via: 'official_upload' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
