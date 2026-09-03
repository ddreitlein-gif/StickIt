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
  stuck: null, // M-8: { seq, table, error } when the cloud 422s a change
};

let timer = null;
let backoffMs = 0;
let running = false;
let pendingWake = false; // L-3: an append landing during the loop's final empty SELECT must not be lost
// v2.4.00 (physical test L-3): journal one line per STATE CHANGE — went
// offline, back online (with how much was queued), drained — so a post-meet
// diagnosis is possible from `journalctl -u stickit-venue` alone. Steady-state
// pushes stay silent (one per score would swamp the journal).
let recoveringRows = 0; // rows pushed since the uplink came back, until drained

function wake(delayMs = BATCH_WINDOW_MS) {
  if (status.revoked) return;
  if (running) { pendingWake = true; return; }
  if (timer) return;
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

      // H-4: only ever push rows belonging to the CURRENTLY adopted meet —
      // rows stranded by a revoked/aborted prior adoption must never replay
      // under the next adoption's token.
      const r = await rawExecute(`SELECT * FROM sync_outbox WHERE meet_id=? ORDER BY seq LIMIT ${BATCH_LIMIT}`, [st.meetId]);
      const rows = r.rows.map(rowToObj);
      if (!rows.length) {
        if (recoveringRows > 0) {
          console.log(`[sync worker] queue drained — ${recoveringRows} queued change(s) delivered to the cloud, up to date`);
          recoveringRows = 0;
        }
        return;
      }

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
        // L-3: bounded — a black-holed connection must not stall the worker
        // for minutes (it can time out a concurrent check-in flush).
        resp = await fetch(`${st.cloudUrl}/api/sync/meets/${st.meetId}/changes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${st.token}` },
          body: JSON.stringify({ protocol_version: protocol.SYNC_PROTOCOL_VERSION, changes }),
          signal: AbortSignal.timeout(15000),
        });
        data = await resp.json().catch(() => ({}));
      } catch (e) {
        // Uplink down — backoff, retry later.
        if (!status.offline_since) {
          status.offline_since = new Date().toISOString();
          console.error(`[sync worker] cloud unreachable (${e.message}) — changes queue locally, retrying with backoff`);
        }
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
      if (resp.status === 401 && data.error === 'invalid_sync_token') {
        // L-3: the meet was re-adopted under a different token — retrying
        // forever labeled "Offline" is a lie. Terminal, like a revoke.
        status.revoked = true;
        status.last_error = 'This venue\'s sync credentials are no longer valid (the meet may have been adopted by another server). Local data intact — call the office.';
        console.error('[sync worker] invalid sync token — upsync stopped. Local data intact.');
        return;
      }
      if (!resp.ok) {
        // M-8: a 422 apply_failed still acknowledges a prefix — delete it so
        // the same acknowledged rows are never re-sent, and surface exactly
        // where the push is stuck instead of a generic failure.
        if (resp.status === 422 && data && data.error === 'apply_failed') {
          const ackd = Number(data.applied_through_seq) || 0;
          if (ackd > 0) {
            await rawExecute(`DELETE FROM sync_outbox WHERE seq <= ? AND meet_id=?`, [ackd, st.meetId]);
          }
          status.stuck = data.failure
            ? { seq: data.failure.seq, table: (String(data.failure.error).match(/:(\w+)$/) || [])[1] || null, error: data.failure.error }
            : { seq: null, table: null, error: 'apply_failed' };
          status.last_error = `sync stuck at seq ${status.stuck.seq}: ${status.stuck.error}`;
        } else {
          status.last_error = data.message || data.error || `HTTP ${resp.status}`;
          if (!status.offline_since) status.offline_since = new Date().toISOString();
        }
        backoffMs = backoffMs ? Math.min(backoffMs * 2, BACKOFF_MAX_MS) : BACKOFF_START_MS;
        console.error(`[sync worker] cloud refused batch: ${resp.status} ${status.last_error}`);
        running = false; status.pushing = false;
        wake(backoffMs);
        return;
      }

      const applied = Number(data.applied_through_seq) || 0;
      if (applied > 0) {
        await rawExecute(`DELETE FROM sync_outbox WHERE seq <= ? AND meet_id=?`, [applied, st.meetId]);
      }
      if (status.offline_since || status.stuck) {
        const cnt = await rawExecute(`SELECT COUNT(*) AS c FROM sync_outbox WHERE meet_id=?`, [st.meetId]);
        const remaining = parseInt(rowToObj(cnt.rows[0]).c) || 0;
        console.log(`[sync worker] cloud reachable again — pushed ${changes.length} change(s), ${remaining} still queued (offline since ${status.offline_since || 'n/a'})`);
        recoveringRows += changes.length;
        if (remaining === 0) { console.log('[sync worker] queue drained — up to date'); recoveringRows = 0; }
      }
      status.last_push_at = new Date().toISOString();
      status.offline_since = null;
      status.last_error = null;
      status.stuck = null;
      backoffMs = 0;
      // Loop continues immediately — drain until the outbox is empty.
    }
  } finally {
    running = false;
    status.pushing = false;
    if (pendingWake) {
      pendingWake = false;
      wake(0);
    }
  }
}

async function getSyncStatus() {
  let queued = 0;
  try {
    // H-4: count only the adopted meet's rows — stale rows from a prior
    // adoption must not block flushNow or mislead the home-screen status.
    const st = await getState();
    const r = st
      ? await rawExecute('SELECT COUNT(*) AS c FROM sync_outbox WHERE meet_id=?', [st.meetId])
      : await rawExecute('SELECT COUNT(*) AS c FROM sync_outbox');
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
  // M-7c: capture failures are silent data-divergence risks — surface them so
  // the home screen can warn instead of burying them in the console.
  let capture_failures = 0;
  try { capture_failures = require('./outbox').getCaptureStats().capture_failures; } catch (_) {}
  return { state, label, queued, last_push_at: status.last_push_at, offline_since: status.offline_since, revoked: status.revoked, last_error: status.last_error, capture_failures, stuck: status.stuck || null };
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

/**
 * H-5: reset transient worker state for a NEW adoption. The revoked flag is
 * permanent for one adoption only — without this reset, the design's own
 * recovery path (force-unlock → re-release → re-adopt on the same process)
 * would silently sync nothing until a restart.
 */
function reset() {
  status.revoked = false;
  status.offline_since = null;
  status.last_error = null;
  status.stuck = null;
  backoffMs = 0;
}

module.exports = { wake, reset, getSyncStatus, flushNow, _status: status };
