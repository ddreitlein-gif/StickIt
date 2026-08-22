const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const { initSchema, queryOne, execute, queryAll } = require('./db/schema');
const { recordWrite, listBackups, getWriteCount, startAutoBackup } = require('./db/autosave');
const { startScheduledSync } = require('./usss/sync');
const { VERSION } = require('./version');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.wss = wss;
app.startedAt = Date.now();
app.errorLog = [];

app.use(cors());
app.use(express.json());

// Track write operations for autosave
app.use((req, res, next) => {
  const writeMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (writeMethods.includes(req.method)) {
    res.on('finish', () => {
      if (res.statusCode < 400) recordWrite();
    });
  }
  next();
});

app.broadcast = (eventId, type, data) => {
  // v2.0.00 (Step 3, FR-15/R4) -- in venue mode, feed the auto-follow tracker
  // so seats / HJ / timekeeper / scoreboard / permanent overlay follow the
  // event with the action across an interleaved day.
  if (require('./venue/mode').isVenueMode()) {
    try { require('./venue/active').noteActivity(eventId, type); } catch (_) {}
  }
  const msg = JSON.stringify({ type, data, eventId });
  wss.clients.forEach(c => {
    if (c.readyState !== 1) return;
    // If the client has subscribed to specific events, only send matching messages.
    // Unsubscribed clients (e.g. dashboard) still receive all messages.
    if (c._subscribedEvents && c._subscribedEvents.size > 0) {
      if (!c._subscribedEvents.has(eventId)) return;
    }
    c.send(msg);
  });
};

wss.on('connection', (ws, req) => {
  // v1.20.00 -- voice bridge route: ws://server/ws/voice/<eventId>
  // Connections to this path are handed off to the Deepgram bridge and do
  // NOT participate in the broadcast subscribe/unsubscribe protocol.
  const url = (req && req.url) || '';
  if (url.startsWith('/ws/voice/')) {
    const eventId = url.replace(/^\/ws\/voice\//, '').replace(/\?.*$/, '').replace(/\/+$/, '');
    require('./voice/deepgram').attachVoiceBridge(ws, eventId);
    return;
  }

  ws._subscribedEvents = new Set();
  ws.send(JSON.stringify({ type: 'connected' }));

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'subscribe' && msg.eventId) {
        ws._subscribedEvents.add(msg.eventId);
        ws.send(JSON.stringify({ type: 'subscribed', eventId: msg.eventId }));
      } else if (msg.type === 'unsubscribe' && msg.eventId) {
        ws._subscribedEvents.delete(msg.eventId);
      }
    } catch (_) { /* ignore malformed messages */ }
  });
});

// Resolve short_codes to real IDs for tablet URLs
app.get('/api/resolve', async (req, res) => {
  const { queryOne } = require('./db/schema');
  try {
    const result = {};
    if (req.query.event) {
      const row = req.query.event.length <= 6
        ? await queryOne('SELECT id FROM events WHERE short_code=?', [req.query.event])
        : { id: req.query.event };
      result.eventId = row ? row.id : null;
    }
    if (req.query.judge) {
      const row = req.query.judge.length <= 6
        ? await queryOne('SELECT id FROM judges WHERE short_code=?', [req.query.judge])
        : { id: req.query.judge };
      result.judgeId = row ? row.id : null;
    }
    if (req.query.meet) {
      const row = req.query.meet.length <= 6
        ? await queryOne('SELECT id FROM meets WHERE short_code=?', [req.query.meet])
        : { id: req.query.meet };
      result.meetId = row ? row.id : null;
    }
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const { requireAuth, requireRole } = require('./middleware/auth');

// v2.0.00 (Step 1, FR-20) -- adoption lock. One shared middleware mounted on
// every meet-scoped path prefix BEFORE the routers, so a mutation against an
// adopted meet is refused (423) before any route handler runs — including the
// public tablet endpoints. Reads pass through untouched. Registered here (not
// per-route) so a future route added under these prefixes is guarded
// automatically; the FR-20 generated harness test enforces total coverage.
const {
  requireNotAdopted, byMeetParam, byEventParam, byTrainingDayParam, byAthleteParam,
} = require('./middleware/adoptionLock');
app.use('/api/meets/:meetId', requireNotAdopted(byMeetParam('meetId')));
app.use('/api/events/:eventId', requireNotAdopted(byEventParam('eventId')));
app.use('/api/athletes/:athleteId', requireNotAdopted(byAthleteParam('athleteId')));
app.use('/api/training-days/:trainingDayId', requireNotAdopted(byTrainingDayParam('trainingDayId')));
app.use('/api/admin/events/:eventId', requireNotAdopted(byEventParam('eventId')));
// Admin meet-scoped mutations (lock-all/hide-all etc.) are guarded too;
// force-unlock deliberately lives at /api/admin/adoption/... outside this prefix.
app.use('/api/admin/meets/:meetId', requireNotAdopted(byMeetParam('meetId')));

// v2.0.00 (FR-20) -- route enumeration for the generated lock-coverage test.
// Only exists when STICKIT_DEBUG_ROUTES=1 (the harness sets it; never set in
// production).
if (process.env.STICKIT_DEBUG_ROUTES === '1') {
  const { listRoutes } = require('./utils/routeList');
  app.get('/api/_debug/routes', (req, res) => res.json({ routes: listRoutes(app) }));
}

// Mixed-auth routers: individual endpoints inside these files apply requireAuth
app.use('/api/meets', require('./routes/meets'));
app.use('/api/meets/:meetId/events', require('./routes/events'));
app.use('/api/athletes', require('./routes/athletes'));
app.use('/api/events/:eventId/judges', require('./routes/judges'));
app.use('/api/events/:eventId/runs', require('./routes/runs'));
app.use('/api/events/:eventId/results', require('./routes/results'));
app.use('/api/events/:eventId/dual', require('./routes/dual'));
app.use('/api/pdf',   require('./routes/pdf'));
app.use('/api/print', require('./routes/print'));

// Officials-only mounts: all endpoints require auth
app.use('/api/meets/:meetId/officials', requireAuth, require('./routes/officials'));
app.use('/api/meets/:meetId/course-specs', requireAuth, require('./routes/coursespecs'));
app.use('/api/events/:eventId/heats', requireAuth, require('./routes/heats'));
app.use('/api/events/:eventId/registrations', requireAuth, require('./routes/registrations'));
// Auth is applied inside routes/phases.js (per-route) so GET /results can stay
// public for the Scoreboard + HJ tablet; every other phases endpoint requires auth.
app.use('/api/events/:eventId/phases', require('./routes/phases'));
app.use('/api/export', requireAuth, require('./routes/export'));
app.use('/api/export', requireAuth, require('./routes/transmit'));
app.use('/api/import', requireAuth, require('./routes/import'));
app.use('/api/audit', requireAuth, require('./routes/audit'));
app.use('/api/usss', requireAuth, require('./routes/usss'));
app.use('/api', require('./routes/training'));
app.use('/api/viewer', require('./routes/viewer'));

// Public
app.use('/api/jump-dds', require('./routes/jumpdds'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', requireAuth, requireRole('system_admin'), require('./routes/admin'));
app.get('/api/version', (req, res) => res.json({ version: VERSION }));

// v2.0.00 (FR-13) -- explicit venue-mode detection. A NEW endpoint (rather than
// a new field on /api/version) so the /api/version response stays byte-identical
// to v1.30.03 for the regression gate. Returned in both modes; the client roots
// on it to decide whether to show the venue home screen (Step 3).
app.get('/api/venue/status', async (req, res) => {
  const { isVenueMode } = require('./venue/mode');
  const { SYNC_PROTOCOL_VERSION } = require('./sync/protocol');
  const out = {
    mode: isVenueMode() ? 'venue' : 'cloud',
    protocol_version: SYNC_PROTOCOL_VERSION,
    version: VERSION,
  };
  if (isVenueMode()) {
    try {
      const { getVenueState } = require('./venue/state');
      const state = await getVenueState();
      if (state) {
        const meet = await queryOne('SELECT id, name, date, location FROM meets WHERE id=?', [state.meet_id]);
        out.adopted_meet = meet || null;
        out.meet_state = state.meet_state;
        out.cloud_url = state.cloud_url;
      } else {
        out.adopted_meet = null;
        out.meet_state = null;
      }
    } catch (e) {
      out.adopted_meet = null;
      out.meet_state = null;
    }
  }
  res.json(out);
});

// v2.0.00 (Step 2) -- mode-gated sync/venue routers (D4: both ship in every
// build, inert when not selected). Cloud serves /api/sync (adopt + upsync
// apply); venue serves /api/venue (adoption, home-screen support).
{
  const { isVenueMode } = require('./venue/mode');
  if (!isVenueMode()) {
    app.use('/api/sync', require('./routes/sync'));
  } else {
    const venueRouter = require('./routes/venue');
    app.use('/api/venue', venueRouter);
    // Venue-local tables (seat registry) — created at boot, never synced.
    venueRouter.ensureVenueTables().catch(e => console.error('[venue] ensureVenueTables failed:', e.message));
  }
}

// POST finalize event (mark as complete after all phases done)
// v1.26.02 -- public: called by the Head Judge tablet (no login token). Per the
// access model, HJ/judge/timekeeper tablets must never be locked out mid-meet.
app.post('/api/events/:eventId/finalize', async (req, res) => {
  try {
    const { eventId } = req.params;
    const { execute, queryAll, queryOne } = require('./db/schema');
    // v1.16.17 -- for dual mogul, require bracket-complete review pending state
    const ev = await queryOne('SELECT discipline, dual_bracket_review_status FROM events WHERE id=?', [eventId]);
    if (ev && ev.discipline === 'dual_mogul') {
      if (ev.dual_bracket_review_status !== 'pending') {
        return res.status(400).json({ error: `Cannot finalize -- dual bracket review status is ${ev.dual_bracket_review_status || 'null'}` });
      }
      await execute(`UPDATE events SET dual_bracket_review_status='approved', updated_at=datetime('now') WHERE id=?`, [eventId]);
    }
    await execute(`UPDATE events SET status='complete', updated_at=datetime('now') WHERE id=?`, [eventId]);
    await execute(`UPDATE event_phases SET status='finalized', updated_at=datetime('now') WHERE event_id=? AND status != 'finalized'`, [eventId]);
    if (app.broadcast) {
      app.broadcast(eventId, 'event_finalized', { event_completed: true });
      // v1.16.17 -- dual judge tablets listen for run_round_status with event_completed
      app.broadcast(eventId, 'run_round_status', { event_completed: true });
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST return event to scoring (reopen last phase so HJ can reject and re-score)
// v1.26.02 -- public again: the HJ tablet's final-review screen calls this with a
// plain fetch. The v1.25.00 (A-2) requireAuth broke it whenever protection was on.
app.post('/api/events/:eventId/return-to-scoring', async (req, res) => {
  try {
    const { eventId } = req.params;
    const { execute, queryAll } = require('./db/schema');
    // Reopen the last phase (highest run_number)
    const phases = await queryAll('SELECT * FROM event_phases WHERE event_id=? ORDER BY run_number DESC', [eventId]);
    if (phases.length === 0) return res.status(400).json({ error: 'No phases found' });
    const lastPhase = phases[0];
    await execute(`UPDATE event_phases SET status='complete', updated_at=datetime('now') WHERE id=?`, [lastPhase.id]);
    await execute(
      `INSERT OR REPLACE INTO run_round_status (event_id, run_number, status, review_message, updated_at) VALUES (?, ?, 'complete', NULL, datetime('now'))`,
      [eventId, lastPhase.run_number]
    );
    if (app.broadcast) app.broadcast(eventId, 'run_round_status', { run_number: lastPhase.run_number, status: 'complete' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// v1.25.00 (E-1) -- operator control to hide/show the broadcast overlay graphics.
app.post('/api/events/:eventId/overlay/hide', requireAuth, (req, res) => {
  if (app.broadcast) app.broadcast(req.params.eventId, 'OVERLAY_HIDE', {});
  res.json({ ok: true });
});
app.post('/api/events/:eventId/overlay/show', requireAuth, (req, res) => {
  if (app.broadcast) app.broadcast(req.params.eventId, 'OVERLAY_SHOW', {});
  res.json({ ok: true });
});

// Direct event lookup by ID (no meetId required -- used by Scoreboard and Overlay)
app.get('/api/events/:eventId', async (req, res) => {
  try {
    const event = await queryOne('SELECT * FROM events WHERE id=?', [req.params.eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(event);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/health', (req, res) => res.json({ ok: true, writes: getWriteCount() }));
app.get('/api/health/backups', (req, res) => {
  try { res.json({ backups: listBackups() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Error-capturing middleware — logs to in-memory ring buffer for admin dashboard
app.use((err, req, res, next) => {
  app.errorLog.push({ timestamp: new Date().toISOString(), method: req.method, url: req.originalUrl, message: err.message });
  if (app.errorLog.length > 100) app.errorLog.shift();
  res.status(err.status || 500).json({ error: err.message });
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3001;
initSchema().then(async () => {
  // v1.25.00 (A-6) -- load (or generate-and-persist) the JWT secret so sessions
  // survive server restarts. Must run before any login/verify can happen.
  try {
    await require('./middleware/auth').initJwtSecret();
  } catch (e) {
    console.error('[startup] initJwtSecret failed:', e.message);
  }

  // Clear any stale dual mogul manual-entry locks from a prior run. If the
  // server crashed (or the operator's browser closed) while a manual-entry
  // session was open, judges' tablets would otherwise stay locked indefinitely.
  // v2.0.00 (FR-9) -- never touch rows of an adopted meet at boot: a cloud
  // restart mid-meet must not mutate the venue's mirror.
  try {
    await execute(
      `UPDATE events SET dual_manual_entry=0 WHERE dual_manual_entry=1
         AND meet_id NOT IN (SELECT id FROM meets WHERE adoption_status='adopted')`
    );
  } catch (e) {
    console.error('[startup] failed to clear stale dual_manual_entry flags:', e.message);
  }

  // Seed initial admin account if no active admin exists (v1.23.00)
  try {
    const adminCount = await queryOne(
      `SELECT COUNT(*) AS cnt FROM users WHERE is_active=1 AND role IN ('event_admin','system_admin')`
    );
    if (!adminCount || parseInt(adminCount.cnt) === 0) {
      const adminUser = process.env.STICKIT_ADMIN_USER || 'admin';
      await execute(
        `INSERT INTO users (id, username, password_hash, display_name, role, is_active) VALUES (?,?,NULL,?,?,1)`,
        [uuidv4(), adminUser, 'Administrator', 'system_admin']
      );
      console.log(`[startup] Seeded initial admin account: username="${adminUser}" — set a password in Admin → Users before enabling protection.`);
    }
  } catch (e) {
    console.error('[startup] failed to seed admin account:', e.message);
  }

  server.listen(PORT, () => console.log(`StickIt ${VERSION} ready on port ${PORT}`));
  startScheduledSync();
  startAutoBackup((err, ctx) => {
    app.errorLog.push({
      timestamp: new Date().toISOString(),
      method: 'BACKUP',
      url: 'auto',
      message: `Auto-backup failed (covered ${ctx.writes} writes): ${err.message}`,
    });
    if (app.errorLog.length > 100) app.errorLog.shift();
  });
}).catch(err => { console.error('Schema init failed:', err); process.exit(1); });

module.exports = { app, wss };
