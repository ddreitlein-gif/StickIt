/**
 * server/sync/worker.js — event-driven upsync worker (v2 Step 4, R14).
 *
 * Every outbox append wakes the worker (no fixed polling interval); writes
 * within a ≤500 ms window batch into one push. Exponential backoff applies
 * ONLY while the uplink is down and resets on first success, so catch-up
 * after an outage is immediate. Ordering is by outbox seq, never wall-clock
 * (FR-17). Rows are deleted only after the cloud acknowledges
 * applied_through_seq. A 410 (adoption revoked, R8) stops the worker for
 * good — local data stays intact for USB recovery.
 */

const { rawExecute, rowToObj } = require('../db/schema');
const protocol = require('./protocol');

const BATCH_WINDOW_MS = 400;   // ≤500ms per R14
const BATCH_LIMIT = 500;
const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 30000;

const status = {
  offline_since: null,
  last_push_at: null,
  last_error: null,
  revoked: false,
  pushing: false,
};

let timer = null;
let backoffMs = 0;
let running = false;

function wake(delayMs = BATCH_WINDOW_MS) {
  if (status.revoked) return;
  if (timer || running) return;
  timer = setTimeout(() => { timer = null; runLoop().catch(e => console.error('[sync worker] loop error:', e.message)); }, delayMs);
  if (timer.unref) timer.unref();
}

async function getState() {
  const get = async (k) => {
    const r = await rawExecute(`SELECT value FROM app_settings WHERE key=?`, [k]);
    return r.rows.length ? rowToObj(r.rows[0]).value : null;
  };
  const meetId = await get('venue_meet_id');
  if (!meetId) return null;
  return {
    meetId,
    token: await get('venue_sync_token'),
    cloudUrl: await get('venue_cloud_url'),
    meetState: await get('venue_meet_state'),
  };
}

async function runLoop() {
  if (running || status.revoked) return;
  running = true;
  status.pushing = true;
  try {
    for (;;) {
      const st = await getState();
      if (!st || !st.token || !st.cloudUrl) return;
      if (st.meetState !== 'adopted' && st.meetState !== 'checking_in') return;

      const r = await rawExecute(`SELECT * FROM sync_outbox ORDER BY seq LIMIT ${BATCH_LIMIT}`);
      const rows = r.rows.map(rowToObj);
      if (!rows.length) return;

      // Size-aware batching: cap each push at ~2MB of row JSON so a batch can
      // never outgrow the cloud's request-body limit.
      const changes = [];
      let bytes = 0;
      for (const row of rows) {
        const size = (row.row_json ? row.row_json.length : 0) + row.pk.length + 100;
        if (changes.length && bytes + size > 2 * 1024 * 1024) break;
        bytes += size;
        changes.push({
          seq: Number(row.seq),
          tbl: row.tbl,
          op: row.op,
          pk: JSON.parse(row.pk),
          row: row.row_json ? JSON.parse(row.row_json) : null,
          idempotency_key: row.idempotency_key,
        });
      }

      let resp, data;
      try {
        resp = await fetch(`${st.cloudUrl}/api/sync/meets/${st.meetId}/changes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${st.token}` },
          body: JSON.stringify({ protocol_version: protocol.SYNC_PROTOCOL_VERSION, changes }),
        });
        data = await resp.json().catch(() => ({}));
      } catch (e) {
        // Uplink down — backoff, retry later.
        if (!status.offline_since) status.offline_since = new Date().toISOString();
        status.last_error = e.message;
        backoffMs = backoffMs ? Math.min(backoffMs * 2, BACKOFF_MAX_MS) : BACKOFF_START_MS;
        running = false; status.pushing = false;
        wake(backoffMs);
        return;
      }

      if (resp.status === 410) {
        // Adoption revoked (force-unlock, R8): stop for good, keep local data.
        status.revoked = true;
        status.last_error = data.message || 'This adoption was revoked on the cloud (force-unlock).';
        console.error('[sync worker] adoption revoked — upsync stopped. Local data intact.');
        return;
      }
      if (!resp.ok) {
        status.last_error = data.message || data.error || `HTTP ${resp.status}`;
        if (!status.offline_since) status.offline_since = new Date().toISOString();
        backoffMs = backoffMs ? Math.min(backoffMs * 2, BACKOFF_MAX_MS) : BACKOFF_START_MS;
        console.error(`[sync worker] cloud refused batch: ${resp.status} ${status.last_error}`);
        running = false; status.pushing = false;
        wake(backoffMs);
        return;
      }

      const applied = Number(data.applied_through_seq) || 0;
      if (applied > 0) {
        await rawExecute(`DELETE FROM sync_outbox WHERE seq <= ?`, [applied]);
      }
      status.last_push_at = new Date().toISOString();
      status.offline_since = null;
      status.last_error = null;
      backoffMs = 0;
      // Loop continues immediately — drain until the outbox is empty.
    }
  } finally {
    running = false;
    status.pushing = false;
  }
}

async function getSyncStatus() {
  let queued = 0;
  try {
    const r = await rawExecute('SELECT COUNT(*) AS c FROM sync_outbox');
    queued = parseInt(rowToObj(r.rows[0]).c) || 0;
  } catch (_) {}
  let state = 'up_to_date';
  let label = 'Up to date';
  if (status.revoked) { state = 'revoked'; label = 'Adoption revoked — call the office'; }
  else if (status.offline_since) {
    state = 'offline';
    const hhmm = status.offline_since.slice(11, 16);
    label = `Offline since ${hhmm} — ${queued} change${queued === 1 ? '' : 's'} queued`;
  } else if (queued > 0) { state = 'queued'; label = `${queued} change${queued === 1 ? '' : 's'} queued`; }
  return { state, label, queued, last_push_at: status.last_push_at, offline_since: status.offline_since, revoked: status.revoked, last_error: status.last_error };
}

/** Push everything now and wait for the outbox to drain (check-in final flush). */
async function flushNow(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  wake(0);
  for (;;) {
    const s = await getSyncStatus();
    if (s.revoked) return { ok: false, reason: 'revoked' };
    if (s.queued === 0 && !status.pushing) return { ok: true };
    if (Date.now() > deadline) return { ok: false, reason: s.offline_since ? 'offline' : 'timeout', status: s };
    wake(0);
    await new Promise(r => setTimeout(r, 200));
  }
}

module.exports = { wake, getSyncStatus, flushNow, _status: status };
