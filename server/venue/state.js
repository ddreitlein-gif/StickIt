/**
 * server/venue/state.js — venue-local adoption state (v2 Step 2).
 *
 * The venue server's own record of "which meet do I hold, and how do I talk
 * to the cloud" lives in local app_settings rows (never synced). The cloud's
 * lock state lives on ITS meets row; the venue's local meets row carries no
 * adoption columns' values (they're excluded from the manifest), so the
 * adoption-lock middleware is naturally inert locally.
 *
 * Keys:
 *   venue_meet_id       adopted meet id (empty/absent = none)
 *   venue_sync_token    per-adoption sync token (raw; local disk is trusted)
 *   venue_cloud_url     cloud base URL used for this adoption
 *   venue_meet_state    'adopted' | 'checking_in' | 'checked_in' | 'handed_back'
 */

const { queryOne, execute } = require('../db/schema');

async function getSetting(key) {
  const row = await queryOne('SELECT value FROM app_settings WHERE key=?', [key]);
  return row ? row.value : null;
}

async function setSetting(key, value) {
  await execute(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?,?,datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
    [key, value]
  );
}

async function getVenueState() {
  const meetId = await getSetting('venue_meet_id');
  if (!meetId) return null;
  return {
    meet_id: meetId,
    sync_token: await getSetting('venue_sync_token'),
    cloud_url: await getSetting('venue_cloud_url'),
    meet_state: (await getSetting('venue_meet_state')) || 'adopted',
  };
}

// v2.0.00 (Step 4) -- every state change refreshes the outbox capture layer
// (capture is active only while meet_state is 'adopted'/'checking_in') and,
// when newly adopted, wakes the sync worker.
async function notifySync() {
  try {
    await require('../sync/outbox').refreshCaptureState();
    require('../sync/worker').wake();
  } catch (_) { /* modules absent in cloud mode paths */ }
}

async function setVenueState({ meet_id, sync_token, cloud_url, meet_state }) {
  await setSetting('venue_meet_id', meet_id || '');
  if (sync_token !== undefined) await setSetting('venue_sync_token', sync_token || '');
  if (cloud_url !== undefined) await setSetting('venue_cloud_url', cloud_url || '');
  await setSetting('venue_meet_state', meet_state || 'adopted');
  await notifySync();
}

async function setMeetState(meet_state) {
  await setSetting('venue_meet_state', meet_state);
  await notifySync();
}

async function clearVenueState() {
  await setSetting('venue_meet_id', '');
  await setSetting('venue_sync_token', '');
  await setSetting('venue_meet_state', '');
  await notifySync();
}

module.exports = { getVenueState, setVenueState, setMeetState, clearVenueState, getSetting, setSetting };
