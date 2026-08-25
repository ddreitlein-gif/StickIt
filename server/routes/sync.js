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

// L-8: release codes are 8-char one-time secrets — cheap per-IP failure
// limiter on /peek and /adopt to match the auth posture (v1.25.00 A-7).
const CODE_FAIL_LIMIT = 10;
const CODE_FAIL_WINDOW_MS = 15 * 60 * 1000;
const codeFailures = new Map(); // ip → { count, resetAt }

function codeThrottle(req, res) {
  const ip = req.ip || 'unknown';
  const rec = codeFailures.get(ip);
  if (rec && rec.resetAt < Date.now()) codeFailures.delete(ip);
  const cur = codeFailures.get(ip);
  if (cur && cur.count >= CODE_FAIL_LIMIT) {
    res.status(429).json({ error: 'too_many_attempts', message: 'Too many invalid release codes from this address — wait 15 minutes.' });
    return false;
  }
  return true;
}

function codeThrottleFail(req) {
  const ip = req.ip || 'unknown';
  const rec = codeFailures.get(ip);
  if (!rec || rec.resetAt < Date.now()) {
    codeFailures.set(ip, { count: 1, resetAt: Date.now() + CODE_FAIL_WINDOW_MS });
  } else {
    rec.count++;
  }
}

// L-8: constant-time hash comparison for token auth.
function hashesEqual(aHex, bHex) {
  try {
    const a = Buffer.from(String(aHex), 'hex');
    const b = Buffer.from(String(bHex), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) { return false; }
}

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
    if (!codeThrottle(req, res)) return;
    const codeHash = hashToken(code.trim().toUpperCase());
    const meet = await queryOne('SELECT id, name, date, adoption_status, release_code_expires_at FROM meets WHERE release_code_hash=?', [codeHash]);
    if (!meet) { codeThrottleFail(req); return res.status(404).json({ error: 'code_invalid', message: 'That release code is not valid.' }); }
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
    if (!codeThrottle(req, res)) return;
    const codeHash = hashToken(code.trim().toUpperCase());
    const meet = await queryOne('SELECT * FROM meets WHERE release_code_hash=?', [codeHash]);
    if (!meet) {
      codeThrottleFail(req);
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
    // H-2: a 'checked_in' meet is re-adoptable (day-2 recovery after a
    // mistaken Check In instead of Hand Back).
    const syncToken = crypto.randomBytes(32).toString('hex');
    const result = await execute(
      `UPDATE meets
         SET adoption_status='adopted', adopted_at=datetime('now'),
             sync_token_hash=?, release_code_hash=NULL, release_code_expires_at=NULL,
             last_applied_seq=0, updated_at=datetime('now')
       WHERE id=? AND release_code_hash=? AND (adoption_status IS NULL OR adoption_status='checked_in')`,
      [hashToken(syncToken), meet.id, codeHash]
    );
    if (!result.rowsAffected) {
      // H-2: report the truth — distinguish a genuine race from any other
      // zero-row outcome by re-reading the row.
      const now = await queryOne('SELECT adoption_status, release_code_hash FROM meets WHERE id=?', [meet.id]);
      if (now && now.adoption_status === 'adopted') {
        return res.status(409).json({ error: 'already_adopted', message: 'Another venue server redeemed this code first.' });
      }
      return res.status(409).json({
        error: 'adopt_conflict',
        message: `The meet changed state while redeeming the code (status: ${now ? now.adoption_status || 'none' : 'missing'}). Ask the official to release it again.`,
      });
    }

    // Drain: the lock refuses new mutations from this instant; wait for
    // requests already inside a handler to finish their writes before the
    // snapshot reads (M-2: adaptive — tracks actual in-flight mutations
    // instead of a fixed 300 ms, with a longer allowance for remote Turso).
    await require('../utils/inflight').waitForMutationIdle();

    // M-1: the code is burned and the meet locked at this point — if the
    // snapshot build fails (transient Turso error), revert the lock and
    // restore the release code so the volunteer can simply retry, instead of
    // stranding a locked meet with a token nobody holds.
    let pkg;
    try {
      pkg = await buildAdoptionPackage(meet.id);
    } catch (e) {
      try {
        await execute(
          `UPDATE meets SET adoption_status=NULL, adopted_at=NULL, sync_token_hash=NULL,
                  release_code_hash=?, release_code_expires_at=?, updated_at=datetime('now')
           WHERE id=? AND adoption_status='adopted' AND sync_token_hash=?`,
          [meet.release_code_hash, meet.release_code_expires_at, meet.id, hashToken(syncToken)]
        );
      } catch (revertErr) {
        console.error(`[sync] adopt revert after package failure ALSO failed for meet ${meet.id}: ${revertErr.message}`);
      }
      return res.status(500).json({
        error: 'package_build_failed',
        message: `Could not build the adoption package (${e.message}). The meet was NOT locked — try the code again.`,
      });
    }

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

// ---------------------------------------------------------------------------
// POST /api/sync/meets/:meetId/changes — ordered outbox batch apply (Step 4).
// Auth: per-adoption sync token. Ordering by seq; seqs <= last_applied_seq are
// skipped (idempotent replay → exactly-once effect). Upserts use
// INSERT ... ON CONFLICT(pk) DO UPDATE over MANIFEST columns only, so cloud-
// only columns (adoption lock state on meets, orphan historical columns)
// are never touched. After a successful batch, one generic per-event
// `sync_applied` WS nudge is emitted (FR-19) — public cloud surfaces poll;
// the nudge just makes WS-connected spectators refresh promptly.
// ---------------------------------------------------------------------------

async function authSyncRequest(req, res) {
  const meet = await queryOne('SELECT * FROM meets WHERE id=?', [req.params.meetId]);
  if (!meet) { res.status(404).json({ error: 'meet_not_found' }); return null; }
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!meet.sync_token_hash) {
    res.status(410).json({ error: 'adoption_revoked', message: 'This adoption was revoked or already closed on the cloud. Upsync from this venue server is no longer accepted; its local data is intact for USB recovery.' });
    return null;
  }
  if (!token || !hashesEqual(hashToken(token), meet.sync_token_hash)) {
    res.status(401).json({ error: 'invalid_sync_token' });
    return null;
  }
  if (meet.adoption_status !== 'adopted') {
    res.status(409).json({ error: 'not_adopted', message: `Meet adoption status is ${meet.adoption_status || 'none'}.` });
    return null;
  }
  return meet;
}

// M-8: non-PK UNIQUE keys. An upsert whose new id collides with a
// DIFFERENT-id row under the unique key (e.g. a judge_scores re-submit after
// an HJ reject, under the FR-11 index) would fail SQLITE_CONSTRAINT — the
// worker would then retry the same batch forever. Mirror the venue's REPLACE
// displacement semantics: remove the different-id row first (the venue's
// ordered history is authoritative for its adopted meet).
const UNIQUE_KEYS = {
  judge_scores: ['run_id', 'judge_id', 'score_type'],
  dual_judge_points: ['match_id', 'judge_number'],
  phase_run_order: ['phase_id', 'registration_id'],
};

async function clearUniqueKeyConflicts(tbl, row) {
  const uk = UNIQUE_KEYS[tbl];
  if (!uk || uk.some(c => row[c] === null || row[c] === undefined)) return;
  const pk = protocol.TABLES[tbl].pk;
  await execute(
    `DELETE FROM ${tbl} WHERE ${uk.map(c => `${c}=?`).join(' AND ')} AND ${pk.map(c => `${c} != ?`).join(' AND ')}`,
    [...uk.map(c => row[c]), ...pk.map(c => row[c])]
  );
}

function upsertSql(table) {
  const spec = protocol.TABLES[table];
  const cols = spec.columns;
  const nonPk = cols.filter(c => !spec.pk.includes(c));
  const conflictUpdate = nonPk.length
    ? `DO UPDATE SET ${nonPk.map(c => `${c}=excluded.${c}`).join(', ')}`
    : 'DO NOTHING';
  return `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
          ON CONFLICT(${spec.pk.join(',')}) ${conflictUpdate}`;
}

/**
 * H-4c: validate that a change targets rows inside the token's meet. The
 * venue's worker is meet-scoped and the outbox is cleared at adoption, so a
 * violation here means stranded/foreign data — reject it rather than blindly
 * upserting into (or deleting from) another meet.
 *
 * Rules per scope:
 *   self                  pk/row id must equal the meet id
 *   meet                  row.meet_id (upsert) / existing row's meet (delete)
 *   event/run/match/phase/training_day
 *                         parent chain must resolve to the meet; ordered apply
 *                         guarantees parents land before children
 *   registered_athletes / global (master tables)
 *                         upserts allowed (the registration that puts the
 *                         athlete in scope may land later in the same push);
 *                         DELETES are refused outright — no venue path hard-
 *                         deletes master rows, and a stray delete would orphan
 *                         registrations in every other meet (H-3 contract)
 *   venue_all (audit_log) unscopable — allowed
 * Deletes whose target row no longer exists are allowed (no-op).
 */
async function changeInMeetScope(meetId, tbl, op, pk, row) {
  const spec = protocol.TABLES[tbl];
  const scope = spec.scope;
  if (scope === 'venue_all') return true;
  if (scope === 'registered_athletes' || scope === 'global') {
    return op !== 'delete';
  }
  if (scope === 'self') {
    const id = op === 'upsert' ? row.id : pk.id;
    return id === meetId;
  }
  // Resolve the meet of the referenced parent (upsert) or target row (delete).
  const meetOf = {
    meet: async (ref) => ref,
    event: async (ref) => {
      const r = await queryOne('SELECT meet_id FROM events WHERE id=?', [ref]);
      return r ? r.meet_id : null;
    },
    run: async (ref) => {
      const r = await queryOne('SELECT e.meet_id FROM runs t JOIN events e ON e.id=t.event_id WHERE t.id=?', [ref]);
      return r ? r.meet_id : null;
    },
    match: async (ref) => {
      const r = await queryOne('SELECT e.meet_id FROM dual_bracket t JOIN events e ON e.id=t.event_id WHERE t.id=?', [ref]);
      return r ? r.meet_id : null;
    },
    phase: async (ref) => {
      const r = await queryOne('SELECT e.meet_id FROM event_phases t JOIN events e ON e.id=t.event_id WHERE t.id=?', [ref]);
      return r ? r.meet_id : null;
    },
    training_day: async (ref) => {
      const r = await queryOne('SELECT meet_id FROM training_days WHERE id=?', [ref]);
      return r ? r.meet_id : null;
    },
  };
  const refColumn = {
    meet: 'meet_id', event: 'event_id', run: 'run_id',
    match: 'match_id', phase: 'phase_id', training_day: 'training_day_id',
  }[scope];
  if (!refColumn || !meetOf[scope]) return false;

  if (op === 'upsert') {
    const m = await meetOf[scope](row[refColumn]);
    return m === meetId; // unknown parent → reject (would create an orphan)
  }
  // delete: resolve the existing target row's meet; absent → no-op, allow.
  const where = spec.pk.map(c => `${c}=?`).join(' AND ');
  const target = await queryOne(`SELECT ${refColumn} FROM ${tbl} WHERE ${where}`, spec.pk.map(c => pk[c]));
  if (!target) return true;
  const m = await meetOf[scope](target[refColumn]);
  return m === null || m === meetId;
}

/** Resolve the event id a change belongs to, for the FR-19 nudge. */
async function eventIdForChange(tbl, pk, row) {
  try {
    if (row && row.event_id) return row.event_id;
    if (tbl === 'events') return pk.id;
    if (tbl === 'judge_scores') {
      const r = await queryOne('SELECT event_id FROM runs WHERE id=?', [row ? row.run_id : null]);
      return r ? r.event_id : null;
    }
    if (tbl === 'dual_judge_points') {
      const r = await queryOne('SELECT event_id FROM dual_bracket WHERE id=?', [row ? row.match_id : null]);
      return r ? r.event_id : null;
    }
    if (tbl === 'phase_run_order') {
      const r = await queryOne('SELECT event_id FROM event_phases WHERE id=?', [row ? row.phase_id : null]);
      return r ? r.event_id : null;
    }
    if (tbl === 'run_round_status') return pk.event_id || null;
  } catch (_) {}
  return null;
}

router.post('/meets/:meetId/changes', async (req, res) => {
  try {
    const meet = await authSyncRequest(req, res);
    if (!meet) return;
    const { protocol_version, changes } = req.body || {};
    if (protocol_version !== protocol.SYNC_PROTOCOL_VERSION) {
      return protocolMismatch(res, protocol_version);
    }
    if (!Array.isArray(changes)) return res.status(400).json({ error: 'changes_required' });

    const sorted = [...changes].sort((a, b) => a.seq - b.seq);
    let lastApplied = Number(meet.last_applied_seq) || 0;
    let skipped = 0;
    const touchedEvents = new Set();
    let failure = null;

    for (const ch of sorted) {
      if (!ch || typeof ch.seq !== 'number') { failure = { seq: null, error: 'bad_change' }; break; }
      if (ch.seq <= lastApplied) { skipped++; continue; }
      const spec = protocol.TABLES[ch.tbl];
      if (!spec || !protocol.SYNC_TABLES.includes(ch.tbl)) {
        failure = { seq: ch.seq, error: `unknown_table:${ch.tbl}` };
        break;
      }
      try {
        if (ch.op === 'upsert') {
          const row = protocol.manifestRow(ch.tbl, ch.row || {});
          // H-4c: a null pk value would INSERT an all-NULL-keyed row (TEXT
          // pks accept NULL in SQLite); refuse it, and refuse rows that
          // resolve outside the token's meet.
          if (spec.pk.some(c => row[c] === null || row[c] === undefined)) {
            failure = { seq: ch.seq, error: `null_pk:${ch.tbl}` };
            break;
          }
          if (!(await changeInMeetScope(meet.id, ch.tbl, 'upsert', ch.pk || {}, row))) {
            failure = { seq: ch.seq, error: `out_of_scope:${ch.tbl}` };
            break;
          }
          await clearUniqueKeyConflicts(ch.tbl, row);
          await execute(upsertSql(ch.tbl), spec.columns.map(c => row[c]));
        } else if (ch.op === 'delete') {
          // M-3: a meets delete arriving over upsync would erase the whole
          // meet from the cloud archive. Never apply it.
          if (ch.tbl === 'meets') {
            failure = { seq: ch.seq, error: 'meet_delete_refused' };
            break;
          }
          const pkVals = spec.pk.map(c => (ch.pk || {})[c]);
          if (pkVals.some(v => v === null || v === undefined)) {
            failure = { seq: ch.seq, error: `null_pk:${ch.tbl}` };
            break;
          }
          if (!(await changeInMeetScope(meet.id, ch.tbl, 'delete', ch.pk || {}, null))) {
            failure = { seq: ch.seq, error: `out_of_scope:${ch.tbl}` };
            break;
          }
          await execute(
            `DELETE FROM ${ch.tbl} WHERE ${spec.pk.map(c => `${c}=?`).join(' AND ')}`,
            pkVals
          );
        } else {
          failure = { seq: ch.seq, error: `unknown_op:${ch.op}` };
          break;
        }
        const evId = await eventIdForChange(ch.tbl, ch.pk || {}, ch.row);
        if (evId) touchedEvents.add(evId);
        lastApplied = ch.seq;
      } catch (e) {
        failure = { seq: ch.seq, error: e.message };
        break;
      }
    }

    await execute(
      `UPDATE meets SET last_applied_seq=?, last_sync_at=datetime('now'), updated_at=updated_at WHERE id=?`,
      [lastApplied, meet.id]
    );

    // FR-19: one generic per-event nudge; no semantic WS reconstruction.
    if (req.app.broadcast) {
      for (const evId of touchedEvents) req.app.broadcast(evId, 'sync_applied', {});
    }

    if (failure) {
      return res.status(422).json({ error: 'apply_failed', applied_through_seq: lastApplied, skipped, failure });
    }
    res.json({ applied_through_seq: lastApplied, skipped });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Step 5 — checksums / check-in / handback / repush (Section 5.4, R7, D8).
// ---------------------------------------------------------------------------

const { queryAll } = require('../db/schema');

async function cloudChecksums(meetId) {
  const out = {};
  for (const t of protocol.CHECKSUM_TABLES) {
    const rows = await queryAll(protocol.selectForMeet(t), [meetId]);
    out[t] = protocol.tableChecksum(t, rows.map(r => protocol.manifestRow(t, r)));
  }
  return out;
}

function compareChecksums(venueSums, cloudSums) {
  const mismatched = [];
  for (const t of protocol.CHECKSUM_TABLES) {
    const v = venueSums[t];
    const c = cloudSums[t];
    if (!v || !c || v.hash !== c.hash || v.count !== c.count) mismatched.push(t);
  }
  return { match: mismatched.length === 0, mismatched };
}

// Diagnostic comparison (no state change).
router.post('/meets/:meetId/checksums', async (req, res) => {
  try {
    const meet = await authSyncRequest(req, res);
    if (!meet) return;
    const { protocol_version, checksums } = req.body || {};
    if (protocol_version !== protocol.SYNC_PROTOCOL_VERSION) return protocolMismatch(res, protocol_version);
    const cloud = await cloudChecksums(meet.id);
    const cmp = compareChecksums(checksums || {}, cloud);
    res.json({ ...cmp, cloud });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Full re-push of named tables after a checksum mismatch: the venue sends its
// complete meet-scoped row set for each table; the cloud replaces its own
// meet-scoped rows for that table (delete rows absent from the push, upsert
// all pushed rows). Applied via the same manifest-only upsert as /changes.
router.post('/meets/:meetId/repush', async (req, res) => {
  try {
    const meet = await authSyncRequest(req, res);
    if (!meet) return;
    const { protocol_version, tables } = req.body || {};
    if (protocol_version !== protocol.SYNC_PROTOCOL_VERSION) return protocolMismatch(res, protocol_version);
    if (!tables || typeof tables !== 'object') return res.status(400).json({ error: 'tables_required' });
    const replaced = {};
    for (const [t, rows] of Object.entries(tables)) {
      const spec = protocol.TABLES[t];
      if (!spec || !protocol.CHECKSUM_TABLES.includes(t)) {
        return res.status(400).json({ error: `bad_table:${t}` });
      }
      const pushed = (rows || []).map(r => protocol.manifestRow(t, r));
      const pushedKeys = new Set(pushed.map(r => protocol.pkString(t, r)));
      // Delete cloud meet-scoped rows not present in the pushed set — EXCEPT
      // for master tables (H-3): `athletes` is the shared roster scoped only
      // indirectly via registrations, and a scope difference between the two
      // sides must never hard-delete a master row cloud-wide (it would orphan
      // that athlete's registrations in every other meet). Master tables are
      // upsert-only here, mirroring UPSERT_TABLES in adoptionImport.js.
      const masterScoped = spec.scope === 'registered_athletes' || spec.scope === 'global';
      if (!masterScoped) {
        const existing = await queryAll(protocol.selectForMeet(t), [meet.id]);
        for (const row of existing) {
          if (!pushedKeys.has(protocol.pkString(t, row))) {
            await execute(
              `DELETE FROM ${t} WHERE ${spec.pk.map(cn => `${cn}=?`).join(' AND ')}`,
              spec.pk.map(cn => row[cn])
            );
          }
        }
      }
      for (const row of pushed) {
        await execute(upsertSql(t), spec.columns.map(cn => row[cn]));
      }
      replaced[t] = pushed.length;
    }
    await execute(`UPDATE meets SET last_sync_at=datetime('now'), updated_at=updated_at WHERE id=?`, [meet.id]);
    res.json({ ok: true, replaced });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Check-in / handback: verify checksums, then unlock. NEVER unlocks on a
// failed checksum — the response names exactly which tables differ (R7).
// mode 'checkin' → adoption_status='checked_in' (permanent record);
// mode 'handback' (D8) → adoption_status=NULL (cloud fully editable again for
// overnight bracket building). Both clear the sync token.
router.post('/meets/:meetId/checkin', async (req, res) => {
  try {
    const meet = await authSyncRequest(req, res);
    if (!meet) return;
    const { protocol_version, checksums, mode } = req.body || {};
    if (protocol_version !== protocol.SYNC_PROTOCOL_VERSION) return protocolMismatch(res, protocol_version);
    if (mode !== 'checkin' && mode !== 'handback') return res.status(400).json({ error: 'mode must be checkin or handback' });
    const cloud = await cloudChecksums(meet.id);
    const cmp = compareChecksums(checksums || {}, cloud);
    if (!cmp.match) {
      return res.status(409).json({ error: 'checksum_mismatch', ...cmp, cloud });
    }
    await execute(
      `UPDATE meets SET adoption_status=?, sync_token_hash=NULL, last_sync_at=datetime('now'), updated_at=updated_at WHERE id=?`,
      [mode === 'checkin' ? 'checked_in' : null, meet.id]
    );
    try {
      const { logAudit } = require('./audit');
      await logAudit(mode === 'checkin' ? 'meet_checked_in' : 'meet_handed_back', 'meet', meet.id, null, { verified_tables: protocol.CHECKSUM_TABLES.length });
    } catch (_) {}
    res.json({ ok: true, mode, verified_tables: protocol.CHECKSUM_TABLES.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
