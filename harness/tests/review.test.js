/**
 * Review-fix regression tests (StickIt_v2_Review_Findings_08-23-26.md).
 *
 *   C-1: crash/power loss during check-in must not brick the venue — boot
 *        resets a persisted 'checking_in' to 'adopted'; a check-in retry from
 *        'checking_in' is accepted.
 *   H-1: lost check-in response → retry reconciles against the cloud's public
 *        adoption state instead of split-braining or claiming "revoked".
 *   H-2: a checked_in meet is re-adoptable (release → adopt), force-unlockable,
 *        and redemption races report accurately.
 *   H-5: worker revoked flag resets on re-adoption; abandon-adoption action.
 *   H-6: a full meet simulation produces zero full-table-diff fallback captures.
 */

const path = require('path');
const { Checks } = require('../lib/checks');
const { Instance } = require('../lib/instance');
const { Api } = require('../lib/client');
const { openDb } = require('../lib/db');
const { seedMogulJudges, playMogulRun } = require('../lib/driver');

const { SERVER_DIR } = require('../lib/instance');
const protocol = require(path.join(SERVER_DIR, 'sync', 'protocol.js'));

async function waitFor(fn, timeoutMs = 30000, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return null;
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

async function buildCloudMeet(cApi, name) {
  const meet = await cApi.must('POST', '/api/meets', { name, location: 'Review Bowl', date: '2026-08-23', meet_ranking: 'C' });
  const ev = await cApi.must('POST', `/api/meets/${meet.id}/events`, { discipline: 'mogul', division: 'comp_series', gender: 'M', name: `${name} M` });
  const judges = await seedMogulJudges(cApi, ev.id);
  const aths = [], regs = [];
  for (let i = 0; i < 2; i++) {
    aths.push(await cApi.must('POST', '/api/athletes', { first_name: `Rv${i}`, last_name: name.replace(/[^A-Za-z0-9]/g, ''), gender: 'M', birth_year: 2008, ussa_num: `88${Math.floor(Math.random() * 90000) + 10000}${i}` }));
    regs.push(await cApi.must('POST', `/api/events/${ev.id}/registrations`, { athlete_id: aths[i].id, bib_number: i + 1 }));
  }
  return { meet, ev, judges, aths, regs };
}

async function main() {
  const c = new Checks('review');
  const cloud = new Instance({ name: 'review-cloud', port: 3191, mode: 'cloud' });
  const venue = new Instance({ name: 'review-venue', port: 3192, mode: 'venue' });

  try {
    await cloud.start();
    await venue.start();
    const cApi = new Api(cloud.base);
    let vApi = new Api(venue.base);

    // =====================================================================
    // C-1 — interrupted check-in recovery
    // =====================================================================
    const f1 = await buildCloudMeet(cApi, 'C1 Crash Meet');
    let rel = await cApi.must('POST', `/api/meets/${f1.meet.id}/release-for-adoption`);
    await vApi.must('POST', '/api/venue/adopt', { code: rel.code, cloud_url: cloud.base });
    await playMogulRun(vApi, f1.ev.id, f1.judges, f1.regs[0].id, 1, 0);

    // Simulate process death mid-check-in: the durable trace it leaves is
    // venue_meet_state='checking_in' with no in-process revert closure alive.
    await venue.stop();
    {
      const vdb = openDb(venue.dbPath);
      await vdb.execute(`UPDATE app_settings SET value='checking_in' WHERE key='venue_meet_state'`);
      vdb.close();
    }
    await venue.start();
    vApi = new Api(venue.base);
    const st = await vApi.must('GET', '/api/venue/status');
    c.eq(st.meet_state, 'adopted', 'C-1: boot resets interrupted checking_in to adopted');

    // Scoring must work again (the freeze guard would 423 otherwise).
    let r = await vApi.post(`/api/events/${f1.ev.id}/runs`, { registration_id: f1.regs[1].id, run_number: 1 });
    c.eq(r.status, 201, 'C-1: scoring resumes after the interrupted check-in');

    // Retry while the state is literally 'checking_in' (no boot in between):
    // the endpoint must accept it rather than 409 not_adopted.
    {
      const vdb = openDb(venue.dbPath);
      await vdb.execute(`UPDATE app_settings SET value='checking_in' WHERE key='venue_meet_state'`);
      vdb.close();
    }
    r = await vApi.post('/api/venue/checkin', { mode: 'checkin' });
    c.eq(r.status, 200, `C-1: check-in retry from 'checking_in' succeeds (${JSON.stringify(r.data).slice(0, 120)})`);
    {
      const cdb = openDb(cloud.dbPath);
      const m = await cdb.queryOne('SELECT adoption_status FROM meets WHERE id=?', [f1.meet.id]);
      c.eq(m.adoption_status, 'checked_in', 'C-1: cloud committed the retried check-in');
      cdb.close();
    }

    // =====================================================================
    // H-2 — checked_in is not a dead end
    // =====================================================================
    // f1.meet is now checked_in on the cloud. Release + re-adopt must work.
    rel = await cApi.must('POST', `/api/meets/${f1.meet.id}/release-for-adoption`);
    r = await vApi.post('/api/venue/adopt', { code: rel.code, cloud_url: cloud.base, replace: true });
    c.eq(r.status, 200, 'H-2: a checked_in meet can be re-released and re-adopted');
    {
      const cdb = openDb(cloud.dbPath);
      const m = await cdb.queryOne('SELECT adoption_status FROM meets WHERE id=?', [f1.meet.id]);
      c.eq(m.adoption_status, 'adopted', 'H-2: re-adoption locked the meet again');
      cdb.close();
    }
    // Hand it back so later sections start clean.
    r = await vApi.post('/api/venue/checkin', { mode: 'handback' });
    c.eq(r.status, 200, 'H-2: handback after re-adoption succeeds');

    // Force-unlock accepts checked_in: check it in again via export path.
    // (Set up a fresh checked_in meet via release/adopt/checkin.)
    rel = await cApi.must('POST', `/api/meets/${f1.meet.id}/release-for-adoption`);
    await vApi.must('POST', '/api/venue/adopt', { code: rel.code, cloud_url: cloud.base, replace: true });
    await vApi.must('POST', '/api/venue/checkin', { mode: 'checkin' });
    r = await cApi.post(`/api/admin/adoption/${f1.meet.id}/force-unlock`, { confirm_name: f1.meet.name });
    c.eq(r.status, 200, 'H-2: force-unlock accepts a checked_in meet');
    {
      const cdb = openDb(cloud.dbPath);
      const m = await cdb.queryOne('SELECT adoption_status FROM meets WHERE id=?', [f1.meet.id]);
      c.eq(m.adoption_status, null, 'H-2: force-unlock cleared checked_in');
      cdb.close();
    }

    // Accurate race error: burn a code by adopting from a second "venue",
    // then redeem the same code again → the error must describe the truth.
    const f2 = await buildCloudMeet(cApi, 'H2 Race Meet');
    rel = await cApi.must('POST', `/api/meets/${f2.meet.id}/release-for-adoption`);
    r = await cApi.post('/api/sync/adopt', { code: rel.code, protocol_version: protocol.SYNC_PROTOCOL_VERSION });
    c.eq(r.status, 200, 'H-2: direct cloud adopt succeeds');
    r = await cApi.post('/api/sync/adopt', { code: rel.code, protocol_version: protocol.SYNC_PROTOCOL_VERSION });
    c.eq(r.status, 404, 'H-2: burned code reads as invalid (hash cleared), not a false race message');

    // =====================================================================
    // H-1 — lost check-in response: retry reconciles instead of split-brain
    // =====================================================================
    // Simulate "cloud committed but the venue never saw the response":
    // adopt on the venue, then commit the check-in directly on the cloud DB
    // (adoption_status → checked_in, token cleared) while the venue still
    // believes it is adopted with a queued outbox of zero.
    const f3 = await buildCloudMeet(cApi, 'H1 Lost Response Meet');
    rel = await cApi.must('POST', `/api/meets/${f3.meet.id}/release-for-adoption`);
    await vApi.must('POST', '/api/venue/adopt', { code: rel.code, cloud_url: cloud.base });
    await playMogulRun(vApi, f3.ev.id, f3.judges, f3.regs[0].id, 1, 0);
    // Wait for upsync to drain so the outbox is empty (as after a real flush).
    {
      const vdb = openDb(venue.dbPath);
      const drained = await waitFor(async () => {
        const n = await vdb.queryOne('SELECT COUNT(*) AS c FROM sync_outbox');
        return parseInt(n.c) === 0 ? true : null;
      });
      vdb.close();
      c.ok(drained, 'H-1: outbox drained before the simulated lost response');
    }
    {
      const cdb = openDb(cloud.dbPath);
      await cdb.execute(`UPDATE meets SET adoption_status='checked_in', sync_token_hash=NULL WHERE id=?`, [f3.meet.id]);
      cdb.close();
    }
    // The venue retries check-in. The old behavior: flush gets 410 → 'revoked'
    // → false "call the office" with no path forward. Fixed behavior: verify
    // the cloud's public adoption state matches, finish locally.
    r = await vApi.post('/api/venue/checkin', { mode: 'checkin' });
    c.eq(r.status, 200, `H-1: check-in retry reconciles with the already-committed cloud (${JSON.stringify(r.data).slice(0, 140)})`);
    c.eq((await vApi.must('GET', '/api/venue/status')).meet_state, 'checked_in', 'H-1: venue reaches checked_in, not a revoked dead end');

    // =====================================================================
    // H-5 — revoked flag resets on re-adoption (same process, no restart)
    // =====================================================================
    const f4 = await buildCloudMeet(cApi, 'H5 Revoke Meet');
    rel = await cApi.must('POST', `/api/meets/${f4.meet.id}/release-for-adoption`);
    await vApi.must('POST', '/api/venue/adopt', { code: rel.code, cloud_url: cloud.base });
    // Force-unlock on the cloud → next venue push gets 410 → worker.revoked.
    await cApi.must('POST', `/api/admin/adoption/${f4.meet.id}/force-unlock`, { confirm_name: f4.meet.name });
    await playMogulRun(vApi, f4.ev.id, f4.judges, f4.regs[0].id, 1, 0);
    const revoked = await waitFor(async () => {
      const s = await vApi.must('GET', '/api/venue/status');
      return s.sync && s.sync.revoked ? true : null;
    }, 20000);
    c.ok(revoked, 'H-5: worker enters revoked after cloud force-unlock');

    // Abandon the dead adoption from the venue (H-5 recovery action).
    r = await vApi.post('/api/venue/abandon', {});
    c.eq(r.status, 200, 'H-5: abandon-adoption action succeeds');
    {
      const vdb = openDb(venue.dbPath);
      const n = await vdb.queryOne('SELECT COUNT(*) AS c FROM sync_outbox');
      c.eq(parseInt(n.c), 0, 'H-5: abandon clears the stranded outbox');
      vdb.close();
    }
    // Prescribed recovery: re-release + re-adopt in the SAME process, then
    // score a run — it must reach the cloud (worker no longer no-ops).
    rel = await cApi.must('POST', `/api/meets/${f4.meet.id}/release-for-adoption`);
    r = await vApi.post('/api/venue/adopt', { code: rel.code, cloud_url: cloud.base, replace: true });
    c.eq(r.status, 200, 'H-5: re-adoption after abandon succeeds without restart');
    const runId = await playMogulRun(vApi, f4.ev.id, f4.judges, f4.regs[1].id, 1, 1);
    {
      const cdb = openDb(cloud.dbPath);
      const synced = await waitFor(async () => {
        const row = await cdb.queryOne('SELECT id, total_score FROM runs WHERE id=?', [runId]);
        return row && row.total_score != null ? true : null;
      }, 20000);
      c.ok(synced, 'H-5: post-re-adoption run reaches the cloud (revoked flag was reset)');
      cdb.close();
    }
    const s4 = await vApi.must('GET', '/api/venue/status');
    c.eq(s4.sync && s4.sync.revoked, false, 'H-5: sync status no longer revoked');

    // =====================================================================
    // H-6 — zero full-table-diff fallbacks across a full simulated meet
    // =====================================================================
    // Everything scored in this suite so far ran through the live tablet
    // paths (start run w/ literal status, DNS helper, finalize flow). The
    // outbox exports a fallback counter; it must still be zero.
    const dbg = await vApi.must('GET', '/api/venue/status');
    c.ok(dbg.sync, 'H-6: sync status present');
    // Exercise the remaining hot paths the review cited: status-only DNS +
    // round finalize (INSERT OR REPLACE INTO run_round_status w/ literals).
    await vApi.must('POST', `/api/events/${f4.ev.id}/runs/status-only`, {
      registration_id: f4.regs[0].id, run_number: 1, round: 'qualification', run_status: 'DNS',
    });
    await vApi.must('POST', `/api/events/${f4.ev.id}/runs/round-status/1/finalize`, {});
    const fallbacks = await vApi.must('GET', '/api/venue/capture-stats');
    c.eq(fallbacks.full_table_fallbacks, 0, `H-6: zero full-table-diff fallback captures (statements=${fallbacks.captured_statements})`);
    c.ok(fallbacks.captured_statements > 0, 'H-6: capture layer actually captured statements');

    // Clean up: hand back so the venue ends unadopted.
    await vApi.must('POST', '/api/venue/checkin', { mode: 'handback' });

    // =====================================================================
    // H-7 — venue freeze covers /api/admin after handback
    // =====================================================================
    r = await vApi.post('/api/admin/athletes/restore', { ids: ['x'] });
    c.eq(r.status, 423, 'H-7: /api/admin mutation frozen after handback');
    c.eq(r.data.error, 'venue_frozen', 'H-7: freeze error named');

    // =====================================================================
    // M-4 — cloud DD chart edits ride the adoption package
    // =====================================================================
    const f6 = await buildCloudMeet(cApi, 'M4 DD Meet');
    {
      const cdb = openDb(cloud.dbPath);
      await cdb.execute(`UPDATE jump_dd_table SET dd_value=9.99 WHERE jump_code='3' AND discipline='mogul' AND gender='M'`);
      cdb.close();
    }
    rel = await cApi.must('POST', `/api/meets/${f6.meet.id}/release-for-adoption`);
    // L-1: claim a seat before adopting — the registry must reset with the
    // new adoption (next meet must not start with seats "in use").
    await vApi.must('POST', '/api/venue/seats/claim', { seat: 'J2', device_label: 'Stale Tablet' });
    r = await vApi.post('/api/venue/adopt', { code: rel.code, cloud_url: cloud.base });
    c.eq(r.status, 200, 'M-4: adoption with DD chart succeeds');
    {
      const vdb = openDb(venue.dbPath);
      const seats = await vdb.queryOne('SELECT COUNT(*) AS c FROM venue_seats');
      c.eq(parseInt(seats.c), 0, 'L-1: seat registry cleared by the new adoption');
      vdb.close();
    }
    // L-1: atomic claim — double claim yields a clean 409, never a raw 500.
    await vApi.must('POST', '/api/venue/seats/claim', { seat: 'J1', device_label: 'A' });
    r = await vApi.post('/api/venue/seats/claim', { seat: 'J1', device_label: 'B' });
    c.eq(r.status, 409, 'L-1: second claim of a taken seat is a clean 409');
    c.eq(r.data.error, 'seat_taken', 'L-1: seat_taken named');
    {
      const vdb = openDb(venue.dbPath);
      const dd = await vdb.queryOne(`SELECT dd_value FROM jump_dd_table WHERE jump_code='3' AND discipline='mogul' AND gender='M'`);
      c.eq(dd && dd.dd_value, 9.99, 'M-4: venue scores with the cloud-edited DD value, not the stock seed');
      vdb.close();
    }

    // =====================================================================
    // M-3 — deleting the adopted meet on the venue is refused
    // =====================================================================
    r = await vApi.del(`/api/meets/${f6.meet.id}`);
    c.eq(r.status, 423, 'M-3: venue refuses deleting the adopted meet');
    {
      const vdb = openDb(venue.dbPath);
      const still = await vdb.queryOne('SELECT id FROM meets WHERE id=?', [f6.meet.id]);
      c.ok(!!still, 'M-3: the adopted meet survives the delete attempt');
      vdb.close();
    }

    // =====================================================================
    // M-16 — FR-8: adoption-locked athlete rows skipped by cloud restore
    // =====================================================================
    r = await cApi.post('/api/admin/athletes/restore', { ids: [f6.aths[0].id] });
    c.eq(r.status, 200, 'M-16: restore endpoint responds');
    c.eq(r.data.skipped_locked, 1, 'M-16: adoption-locked athlete skipped by admin restore');
    // export-bibs-to-athletes skips locked athletes: register f6's (locked)
    // athlete into unadopted f1's event and export bibs there.
    await cApi.must('POST', `/api/events/${f1.ev.id}/registrations`, { athlete_id: f6.aths[0].id, bib_number: 77 });
    r = await cApi.post(`/api/events/${f1.ev.id}/registrations/export-bibs-to-athletes`, {});
    c.eq(r.status, 200, 'M-16: export-bibs on an unadopted meet responds');
    c.ok(r.data.skipped_locked >= 1, `M-16: locked athlete's bib update skipped (skipped_locked=${r.data.skipped_locked})`);
    {
      const cdb = openDb(cloud.dbPath);
      const a = await cdb.queryOne('SELECT bib FROM athletes WHERE id=?', [f6.aths[0].id]);
      c.ok(!a || a.bib !== 77, 'M-16: locked athlete master row untouched');
      cdb.close();
    }

    // Abandon f6 so the venue is free again (H-5 action reused as cleanup).
    await vApi.must('POST', '/api/venue/abandon', {});

    // =====================================================================
    // H-4c / M-3 / M-8 — cloud /changes validation (direct-adopted meet, no
    // venue worker interference)
    // =====================================================================
    const f7 = await buildCloudMeet(cApi, 'M8 Apply Meet');
    const runId7 = await playMogulRun(cApi, f7.ev.id, f7.judges, f7.regs[0].id, 1, 0);
    rel = await cApi.must('POST', `/api/meets/${f7.meet.id}/release-for-adoption`);
    const adoptResp = await cApi.must('POST', '/api/sync/adopt', { code: rel.code, protocol_version: protocol.SYNC_PROTOCOL_VERSION });
    const syncApi7 = new Api(cloud.base, { token: adoptResp.sync_token });
    const changesUrl = `/api/sync/meets/${f7.meet.id}/changes`;
    const push = (changes) => syncApi7.post(changesUrl, { protocol_version: protocol.SYNC_PROTOCOL_VERSION, changes });

    // null pk refused
    r = await push([{ seq: 1, tbl: 'runs', op: 'upsert', pk: { id: null }, row: { id: null, event_id: f7.ev.id } }]);
    c.eq(r.status, 422, 'H-4c: null-pk upsert refused');
    c.ok(/null_pk/.test(r.data.failure && r.data.failure.error), 'H-4c: null_pk named');

    // out-of-scope row (references another meet's event) refused
    r = await push([{ seq: 2, tbl: 'runs', op: 'upsert', pk: { id: 'foreign-run' }, row: { id: 'foreign-run', event_id: f1.ev.id, registration_id: f1.regs[0].id, run_number: 1, round: 'qualification', status: 'complete' } }]);
    c.eq(r.status, 422, 'H-4c: out-of-scope upsert refused');
    c.ok(/out_of_scope/.test(r.data.failure && r.data.failure.error), 'H-4c: out_of_scope named');
    {
      const cdb = openDb(cloud.dbPath);
      const foreign = await cdb.queryOne(`SELECT id FROM runs WHERE id='foreign-run'`);
      c.ok(!foreign, 'H-4c: the foreign row was NOT applied');
      cdb.close();
    }

    // meets delete refused (M-3 cloud side)
    r = await push([{ seq: 3, tbl: 'meets', op: 'delete', pk: { id: f7.meet.id } }]);
    c.eq(r.status, 422, 'M-3: meets delete via upsync refused');
    c.ok(/meet_delete_refused/.test(r.data.failure && r.data.failure.error), 'M-3: refusal named');

    // M-8: unique-key conflicting judge_scores upsert applies cleanly
    {
      const cdb = openDb(cloud.dbPath);
      const existingJs = await cdb.queryOne(`SELECT * FROM judge_scores WHERE run_id=? LIMIT 1`, [runId7]);
      c.ok(!!existingJs, 'M-8: cloud has an existing judge_scores row');
      r = await push([{
        seq: 4, tbl: 'judge_scores', op: 'upsert', pk: { id: 'venue-resubmit-1' },
        row: { id: 'venue-resubmit-1', run_id: existingJs.run_id, judge_id: existingJs.judge_id, score_type: existingJs.score_type, raw_score: 13.7, submitted_at: '2026-08-23 10:00:00' },
      }]);
      c.eq(r.status, 200, `M-8: different-id upsert under the FR-11 unique key applies (was a permanent 422 wedge) — ${JSON.stringify(r.data)}`);
      const after = await cdb.queryAll(`SELECT id FROM judge_scores WHERE run_id=? AND judge_id=? AND score_type=?`, [existingJs.run_id, existingJs.judge_id, existingJs.score_type]);
      c.eq(after.length, 1, 'M-8: exactly one row under the unique key');
      c.eq(after[0].id, 'venue-resubmit-1', 'M-8: the venue row displaced the conflicting cloud row');
      cdb.close();
    }
    // Clean up f7's cloud lock.
    await cApi.must('POST', `/api/admin/adoption/${f7.meet.id}/force-unlock`, { confirm_name: f7.meet.name });

    // =====================================================================
    // M-10 / M-9 — PIN-gated update, token rotation, verify-pin throttle
    // =====================================================================
    await vApi.must('POST', '/api/venue/pins', { control_pin: '4321', crew_pin: '8765' });
    const tok = (await vApi.must('POST', '/api/venue/verify-pin', { kind: 'control', pin: '4321' })).token;
    r = await vApi.post('/api/venue/update', {});
    c.eq(r.status, 403, 'M-10: update without the Control token refused');
    r = await vApi.post('/api/venue/update', { control_token: tok });
    c.eq(r.status, 400, 'M-10: with token but no meet + no script configured → clean 400 (gating passed)');
    // handed_back refusal: adopt f1 again and hand it... instead simulate by
    // writing the state directly (cheap, and the guard only reads the state).
    {
      const vdb = openDb(venue.dbPath);
      await vdb.execute(`UPDATE app_settings SET value=? WHERE key='venue_meet_id'`, [f1.meet.id]);
      await vdb.execute(`UPDATE app_settings SET value='handed_back' WHERE key='venue_meet_state'`);
      vdb.close();
    }
    r = await vApi.post('/api/venue/update', { control_token: tok });
    c.eq(r.status, 409, 'M-10: update refused in the overnight handed_back state');
    {
      const vdb = openDb(venue.dbPath);
      await vdb.execute(`UPDATE app_settings SET value='' WHERE key='venue_meet_id'`);
      await vdb.execute(`UPDATE app_settings SET value='' WHERE key='venue_meet_state'`);
      vdb.close();
    }
    // M-9: throttle — 10 wrong PINs lock the IP even for the right PIN.
    for (let i = 0; i < 10; i++) {
      await vApi.post('/api/venue/verify-pin', { kind: 'control', pin: '0000' });
    }
    r = await vApi.post('/api/venue/verify-pin', { kind: 'control', pin: '4321' });
    c.eq(r.status, 429, 'M-9: verify-pin throttled after 10 failures (4-digit oracle closed)');

    // =====================================================================
    // L-9 — adopt refused while a check-in is in flight
    // =====================================================================
    {
      const vdb = openDb(venue.dbPath);
      await vdb.execute(`UPDATE app_settings SET value=? WHERE key='venue_meet_id'`, [f1.meet.id]);
      await vdb.execute(`UPDATE app_settings SET value='checking_in' WHERE key='venue_meet_state'`);
      vdb.close();
    }
    r = await vApi.post('/api/venue/adopt', { code: 'ABCDEF12' });
    c.eq(r.status, 409, 'L-9: adopt during an in-flight check-in refused');
    c.eq(r.data.error, 'already_hosting', 'L-9: already_hosting named');
    {
      const vdb = openDb(venue.dbPath);
      await vdb.execute(`UPDATE app_settings SET value='' WHERE key='venue_meet_id'`);
      await vdb.execute(`UPDATE app_settings SET value='' WHERE key='venue_meet_state'`);
      vdb.close();
    }

    // =====================================================================
    // L-8 — invalid release-code throttle (LAST: throttles this IP on the
    // scratch cloud for 15 minutes)
    // =====================================================================
    for (let i = 0; i < 10; i++) {
      await cApi.post('/api/sync/peek', { code: 'WRONGCOD', protocol_version: protocol.SYNC_PROTOCOL_VERSION });
    }
    r = await cApi.post('/api/sync/peek', { code: 'WRONGCOD', protocol_version: protocol.SYNC_PROTOCOL_VERSION });
    c.eq(r.status, 429, 'L-8: invalid-code attempts throttled on /peek');
    r = await cApi.post('/api/sync/adopt', { code: 'WRONGCOD', protocol_version: protocol.SYNC_PROTOCOL_VERSION });
    c.eq(r.status, 429, 'L-8: throttle covers /adopt too');
  } finally {
    await cloud.stop().catch(() => {});
    await venue.stop().catch(() => {});
  }

  return c;
}

module.exports = { main };
