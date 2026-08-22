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
const crypto = require('crypto');
const os = require('os');
const { queryOne, queryAll, execute } = require('../db/schema');
const protocol = require('../sync/protocol');
const { executeAdoptionImport } = require('../sync/adoptionImport');
const { getVenueState, setVenueState, getSetting, setSetting } = require('../venue/state');
const { hashToken } = require('../sync/adoption');
const { getActiveEventId } = require('../venue/active');

const DEFAULT_CLOUD_URL = process.env.STICKIT_CLOUD_URL || 'https://stickit-tga4.onrender.com';

// Venue-local tables (never synced, never part of the manifest).
async function ensureVenueTables() {
  await execute(`CREATE TABLE IF NOT EXISTS venue_seats (
    seat TEXT PRIMARY KEY,
    device_label TEXT,
    claimed_at TEXT
  )`);
}

// ---------------------------------------------------------------------------
// PINs (R3 / 6.3). Two 4-digit PINs, stored hashed in local app_settings.
// Control PIN gates Scoring Computer + Head Judge (client tiles AND, via the
// venue auth middleware, the officials-mutation endpoints). Crew PIN gates
// Judge seats + Timekeeper client-side only. Scoreboard is open.
// ---------------------------------------------------------------------------
router.get('/pins/status', async (req, res) => {
  try {
    res.json({
      control_set: !!(await getSetting('venue_control_pin_hash')),
      crew_set: !!(await getSetting('venue_crew_pin_hash')),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/pins', async (req, res) => {
  try {
    const { control_pin, crew_pin, control_token } = req.body || {};
    if (!/^\d{4}$/.test(control_pin || '') || !/^\d{4}$/.test(crew_pin || '')) {
      return res.status(400).json({ error: 'pins_invalid', message: 'Both PINs must be exactly 4 digits.' });
    }
    // Changing existing PINs requires the current Control session token.
    const existing = await getSetting('venue_control_pin_hash');
    if (existing) {
      const tok = await getSetting('venue_control_token');
      if (!control_token || control_token !== tok) {
        return res.status(403).json({ error: 'control_token_required', message: 'Enter the current Control PIN before changing PINs.' });
      }
    }
    await setSetting('venue_control_pin_hash', hashToken(control_pin));
    await setSetting('venue_crew_pin_hash', hashToken(crew_pin));
    // (Re)issue the Control session token — PIN change invalidates old sessions.
    await setSetting('venue_control_token', crypto.randomBytes(24).toString('hex'));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/verify-pin', async (req, res) => {
  try {
    const { kind, pin } = req.body || {};
    if (kind !== 'control' && kind !== 'crew') return res.status(400).json({ error: 'kind must be control or crew' });
    const hash = await getSetting(kind === 'control' ? 'venue_control_pin_hash' : 'venue_crew_pin_hash');
    if (!hash) return res.status(400).json({ error: 'pins_not_set', message: 'PINs have not been set yet — set them from the adoption flow.' });
    if (hashToken(String(pin || '')) !== hash) {
      return res.status(403).json({ error: 'pin_incorrect', message: 'Wrong PIN.' });
    }
    if (kind === 'control') {
      const token = await getSetting('venue_control_token');
      return res.json({ ok: true, token });
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// Seat registry (R1 / 6.4). Physical seats J1–J7; free claim, taken seats
// shown taken, Scoring Computer force-release. Claiming maps the seat to the
// ACTIVE event's per-event judge assignment (FR-15) — resolved live by
// /role-target, so a claimed seat auto-follows interleaved events.
// ---------------------------------------------------------------------------
const SEATS = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'J7'];

// Canonical seat → role order per discipline (index = seat number - 1).
const SEAT_ROLES = {
  mogul: ['TL1', 'TL2', 'TL3', 'Air1', 'Air2'],
  dual_mogul: ['DualTurns1', 'DualTurns2', 'DualAir', 'DualTime', 'DualOverall'],
  aerials: ['AeJudge1', 'AeJudge2', 'AeJudge3', 'AeJudge4', 'AeJudge5', 'AeJudge6', 'AeJudge7'],
  aerials_legacy: ['AirJudge1', 'AirJudge2', 'AirJudge3', 'FormJudge1', 'FormJudge2', 'FormJudge3', 'LandingJudge1'],
};

async function judgeForSeat(eventRow, seat) {
  const n = parseInt(String(seat).replace(/^J/i, ''), 10);
  if (!n || n < 1 || n > 7) return null;
  let order;
  if (eventRow.discipline === 'aerials') {
    order = eventRow.aerials_panel_size != null ? SEAT_ROLES.aerials : SEAT_ROLES.aerials_legacy;
  } else {
    order = SEAT_ROLES[eventRow.discipline] || SEAT_ROLES.mogul;
  }
  const role = order[n - 1];
  if (!role) return null;
  return queryOne('SELECT id, name, role, short_code FROM judges WHERE event_id=? AND role=?', [eventRow.id, role]);
}

router.get('/seats', async (req, res) => {
  try {
    await ensureVenueTables();
    const state = await getVenueState();
    const claimed = await queryAll('SELECT * FROM venue_seats');
    const byId = Object.fromEntries(claimed.map(s => [s.seat, s]));
    let activeEvent = null;
    if (state && state.meet_id) {
      const evId = await getActiveEventId(state.meet_id);
      if (evId) activeEvent = await queryOne('SELECT * FROM events WHERE id=?', [evId]);
    }
    const seats = [];
    for (const seat of SEATS) {
      const judge = activeEvent ? await judgeForSeat(activeEvent, seat) : null;
      seats.push({
        seat,
        claimed: !!byId[seat],
        device_label: byId[seat] ? byId[seat].device_label : null,
        claimed_at: byId[seat] ? byId[seat].claimed_at : null,
        judge: judge ? { id: judge.id, name: judge.name, role: judge.role } : null,
      });
    }
    res.json({
      seats,
      active_event: activeEvent ? { id: activeEvent.id, name: activeEvent.name, discipline: activeEvent.discipline } : null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/seats/claim', async (req, res) => {
  try {
    await ensureVenueTables();
    const { seat, device_label } = req.body || {};
    if (!SEATS.includes(seat)) return res.status(400).json({ error: 'bad_seat' });
    const existing = await queryOne('SELECT * FROM venue_seats WHERE seat=?', [seat]);
    if (existing) {
      return res.status(409).json({ error: 'seat_taken', message: `Seat ${seat} is already in use${existing.device_label ? ` by "${existing.device_label}"` : ''}. The Scoring Computer can force-release it.` });
    }
    await execute(`INSERT INTO venue_seats (seat, device_label, claimed_at) VALUES (?,?,datetime('now'))`, [seat, device_label || null]);
    res.json({ ok: true, seat });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/seats/release', async (req, res) => {
  try {
    await ensureVenueTables();
    const { seat } = req.body || {};
    await execute('DELETE FROM venue_seats WHERE seat=?', [seat]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Force-release requires the Control session token (R1).
router.post('/seats/force-release', async (req, res) => {
  try {
    await ensureVenueTables();
    const { seat, control_token } = req.body || {};
    const tok = await getSetting('venue_control_token');
    const header = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!tok || (control_token !== tok && header !== tok)) {
      return res.status(403).json({ error: 'control_token_required', message: 'Force-release needs the Control PIN.' });
    }
    await execute('DELETE FROM venue_seats WHERE seat=?', [seat]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// Auto-follow role targets (FR-15) + permanent overlay target (R4 / 6.5).
// ---------------------------------------------------------------------------
async function resolveTarget(role, seat) {
  const state = await getVenueState();
  if (!state || !state.meet_id) return { error: 'no_meet', message: 'No meet is adopted.' };
  const meet = await queryOne('SELECT id, name, short_code FROM meets WHERE id=?', [state.meet_id]);
  // Overlay honors the operator pin; role pages follow live activity.
  let eventId = null;
  if (role === 'overlay') {
    const pinned = await getSetting('venue_overlay_pin');
    if (pinned) {
      const ok = await queryOne('SELECT id FROM events WHERE id=? AND meet_id=?', [pinned, state.meet_id]);
      if (ok) eventId = pinned;
    }
  }
  if (!eventId) eventId = await getActiveEventId(state.meet_id);
  if (!eventId) return { error: 'no_event', message: 'The adopted meet has no events.' };
  const ev = await queryOne('SELECT * FROM events WHERE id=?', [eventId]);
  if (!ev) return { error: 'no_event' };

  const base = {
    meet_state: state.meet_state,
    event_id: ev.id,
    event_short_code: ev.short_code,
    event_name: ev.name,
    discipline: ev.discipline,
  };
  if (role === 'judge') {
    const judge = await judgeForSeat(ev, seat);
    if (!judge) return { ...base, error: 'no_judge', message: `The active event (${ev.name}) has no judge assignment for seat ${seat}.` };
    const url = (ev.discipline === 'aerials' && ev.aerials_panel_size != null)
      ? `/aerials-judge/${ev.short_code}/${judge.short_code}`
      : `/judge/${ev.short_code}?judge=${judge.short_code}`;
    return { ...base, judge: { id: judge.id, name: judge.name, role: judge.role }, url };
  }
  if (role === 'hj') return { ...base, url: `/headjudge/${meet.short_code}/${ev.short_code}` };
  if (role === 'timekeeper') return { ...base, url: `/timekeeper/${ev.short_code}` };
  if (role === 'scoreboard') return { ...base, url: `/scoreboard/${ev.short_code}` };
  if (role === 'overlay') {
    const pinnedSetting = await getSetting('venue_overlay_pin');
    return { ...base, url: `/overlay/${ev.short_code}`, pinned: !!pinnedSetting, pinned_event_id: pinnedSetting || null };
  }
  return { error: 'bad_role' };
}

router.get('/role-target', async (req, res) => {
  try {
    const out = await resolveTarget(String(req.query.role || ''), req.query.seat);
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/overlay-target', async (req, res) => {
  try {
    const out = await resolveTarget('overlay');
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Pin/unpin the overlay to one event (Control token; broadcast on change).
router.post('/overlay-pin', async (req, res) => {
  try {
    const tok = await getSetting('venue_control_token');
    const header = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (tok && header !== tok && (req.body || {}).control_token !== tok) {
      return res.status(403).json({ error: 'control_token_required' });
    }
    const { event_id } = req.body || {};
    await setSetting('venue_overlay_pin', event_id || '');
    if (req.app.broadcast) req.app.broadcast(event_id || 'venue', 'venue_overlay_target', { pinned: !!event_id });
    res.json({ ok: true, pinned: !!event_id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// Connection Info (D3 / 6.2): addresses + the complete numeric overlay URL
// for the YoloBox (verified from the run sheet at Starlink-router venues).
// ---------------------------------------------------------------------------
router.get('/connection-info', async (req, res) => {
  try {
    const port = process.env.PORT || 3001;
    const addrs = [];
    const ifaces = os.networkInterfaces();
    for (const list of Object.values(ifaces)) {
      for (const i of list || []) {
        if (i.family === 'IPv4' && !i.internal) addrs.push(i.address);
      }
    }
    const primary = addrs[0] || '127.0.0.1';
    res.json({
      port: Number(port),
      addresses: addrs,
      mdns_url: `http://stickit.local:${port}`,
      numeric_url: `http://${primary}:${port}`,
      overlay_url: `http://${primary}:${port}/overlay`,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

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

// ---------------------------------------------------------------------------
// Step 5 — check-in / handback (FR-10 order, Section 5.4, D8).
// Control-PIN action from the Scoring Computer, on the end-of-day run sheet.
// Order: freeze the venue (read-only; role pages show "checking in") → final
// outbox flush → checksums both sides → cloud unlock → local archive mark.
// On any failure the venue returns to 'adopted' so scoring is never stranded.
// ---------------------------------------------------------------------------

async function requireControlToken(req, res) {
  const tok = await getSetting('venue_control_token');
  if (!tok) return true; // PINs not set (pre-PIN operation) — pass
  const header = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (header === tok || (req.body || {}).control_token === tok) return true;
  res.status(403).json({ error: 'control_token_required', message: 'This action needs the Control PIN.' });
  return false;
}

async function venueChecksums(meetId) {
  const out = {};
  for (const t of protocol.CHECKSUM_TABLES) {
    const rows = await queryAll(protocol.selectForMeet(t), [meetId]);
    out[t] = protocol.tableChecksum(t, rows.map(r => protocol.manifestRow(t, r)));
  }
  return out;
}

router.post('/checkin', async (req, res) => {
  const { setMeetState } = require('../venue/state');
  try {
    if (!(await requireControlToken(req, res))) return;
    const { mode } = req.body || {};
    if (mode !== 'checkin' && mode !== 'handback') {
      return res.status(400).json({ error: 'mode must be checkin or handback' });
    }
    const state = await getVenueState();
    if (!state || state.meet_state !== 'adopted') {
      return res.status(409).json({ error: 'not_adopted', message: `Venue meet state is ${state ? state.meet_state : 'none'}.` });
    }

    // 1. Freeze (FR-10): all role pages show "checking in"; venue mutations
    //    are refused server-side by the freeze guard from this moment.
    await setMeetState('checking_in');
    const revert = async (httpCode, body) => {
      await setMeetState('adopted');
      res.status(httpCode).json(body);
    };

    // 2. Final flush.
    const worker = require('../sync/worker');
    const flush = await worker.flushNow(45000);
    if (!flush.ok) {
      return revert(502, {
        error: 'flush_failed',
        reason: flush.reason,
        message: flush.reason === 'offline'
          ? 'The cloud is unreachable — check-in needs internet. Scoring stays available; try again when the uplink is back.'
          : flush.reason === 'revoked'
            ? 'This adoption was revoked on the cloud. Call the office.'
            : 'Could not push the last changes to the cloud in time. Try again.',
      });
    }

    // 3+4. Checksums → cloud unlock (cloud verifies independently and NEVER
    //      unlocks on mismatch). On mismatch: full re-push of the differing
    //      tables, then one re-verify.
    const sums = await venueChecksums(state.meet_id);
    const call = (body) => fetch(`${state.cloud_url}/api/sync/meets/${state.meet_id}/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.sync_token}` },
      body: JSON.stringify(body),
    });
    let resp, data;
    try {
      resp = await call({ protocol_version: protocol.SYNC_PROTOCOL_VERSION, checksums: sums, mode });
      data = await resp.json().catch(() => ({}));
    } catch (e) {
      return revert(502, { error: 'cloud_unreachable', message: 'Lost the cloud connection during check-in. Scoring stays available; try again.' });
    }

    let repushed = null;
    if (resp.status === 409 && data.error === 'checksum_mismatch') {
      const tables = {};
      for (const t of data.mismatched || []) {
        const rows = await queryAll(protocol.selectForMeet(t), [state.meet_id]);
        tables[t] = rows.map(r => protocol.manifestRow(t, r));
      }
      try {
        const rp = await fetch(`${state.cloud_url}/api/sync/meets/${state.meet_id}/repush`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.sync_token}` },
          body: JSON.stringify({ protocol_version: protocol.SYNC_PROTOCOL_VERSION, tables }),
        });
        if (!rp.ok) {
          const rpData = await rp.json().catch(() => ({}));
          return revert(502, { error: 'repush_failed', detail: rpData, mismatched: data.mismatched });
        }
        repushed = data.mismatched;
      } catch (e) {
        return revert(502, { error: 'cloud_unreachable', message: 'Lost the cloud connection during re-push. Try again.' });
      }
      // Re-verify once.
      const sums2 = await venueChecksums(state.meet_id);
      resp = await call({ protocol_version: protocol.SYNC_PROTOCOL_VERSION, checksums: sums2, mode });
      data = await resp.json().catch(() => ({}));
    }

    if (!resp.ok) {
      return revert(resp.status === 409 ? 409 : 502, {
        error: data.error || 'checkin_failed',
        mismatched: data.mismatched || null,
        message: data.error === 'checksum_mismatch'
          ? `Verification failed — these tables still differ from the cloud: ${(data.mismatched || []).join(', ')}. The cloud stays locked; nothing was lost. Try again or call the office.`
          : (data.message || `Cloud refused the ${mode} (HTTP ${resp.status}).`),
      });
    }

    // 5. Local archive mark. The meet is now read-only here for good.
    await setMeetState(mode === 'checkin' ? 'checked_in' : 'handed_back');
    res.json({ ok: true, mode, repushed, verified_tables: protocol.CHECKSUM_TABLES.length });
  } catch (e) {
    try { await setMeetState('adopted'); } catch (_) {}
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Step 6 — routine software update (Section 7). Home-screen button, shown only
// in State 1 (no meet adopted) with internet reachable. "Plug the Pi in at
// home, open stickit.local, click Update."
// ---------------------------------------------------------------------------

router.get('/update-check', async (req, res) => {
  try {
    const { VERSION } = require('../version');
    const repo = process.env.STICKIT_UPDATE_REPO || 'ddreitlein-gif/StickIt';
    const apiUrl = process.env.STICKIT_UPDATE_URL || `https://api.github.com/repos/${repo}/releases/latest`;
    let latest = null;
    try {
      const r = await fetch(apiUrl, { headers: { 'User-Agent': 'stickit-venue' } });
      if (r.ok) {
        const data = await r.json();
        latest = data.tag_name || null;
      }
    } catch (_) { /* offline */ }
    const norm = (v) => String(v || '').replace(/^v/, '');
    res.json({
      current: VERSION,
      latest,
      internet: latest !== null,
      update_available: !!latest && norm(latest) !== norm(VERSION),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/update', async (req, res) => {
  try {
    const state = await getVenueState();
    if (state && (state.meet_state === 'adopted' || state.meet_state === 'checking_in')) {
      return res.status(409).json({ error: 'meet_adopted', message: 'Never update while a meet is on this server. Check it in or hand it back first.' });
    }
    const script = process.env.STICKIT_UPDATE_SCRIPT;
    if (!script || !require('fs').existsSync(script)) {
      return res.status(400).json({ error: 'no_update_script', message: 'No update script configured on this device. Use SSH: sudo /opt/stickit/update-stickit.sh' });
    }
    // Fire and respond: the script restarts the service, killing this process.
    const { spawn } = require('child_process');
    // On the Pi the stickit user runs the script via passwordless sudo
    // (sudoers drop-in from provision.sh); the harness sets
    // STICKIT_UPDATE_SUDO=0 to run it directly.
    const useSudo = process.env.STICKIT_UPDATE_SUDO !== '0';
    const child = useSudo
      ? spawn('sudo', ['-n', script], { detached: true, stdio: 'ignore' })
      : spawn('bash', [script], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    res.json({ ok: true, message: 'Updating — the server restarts itself in a minute or two. Refresh this page after.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.ensureVenueTables = ensureVenueTables;
