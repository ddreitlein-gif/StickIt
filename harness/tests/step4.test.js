/**
 * Step 4 acceptance tests — upsync.
 *
 *   A. FR-7 OUTBOX AUDIT GATE: with the cloud DOWN for the whole simulated
 *      event, play a full meet against the venue (mogul runs, HJ approve +
 *      rejection, DNS, dual bracket, phase REPLACE displacement,
 *      run_round_status REPLACE, batch() reorders, registration/athlete/
 *      officials/course edits, event cascade delete, training-day exclusion
 *      toggles) — then replay the captured outbox onto the post-adoption base
 *      state and diff table-by-table against the live venue DB. Zero
 *      differences proves the FR-5 capture layer missed nothing.
 *   B. Outage recovery: restart the cloud → the queued outbox replays; cloud
 *      mirror checksums match the venue exactly; idempotent replay; cloud
 *      restart mid-adoption (FR-9 case) is inherent to this flow.
 *   C. Live sync: with the uplink up, HJ-approval → cloud-visible latency
 *      (R14 gate) and the FR-19 per-event WS nudge.
 *   D. Auth failures: bad token 401; after force-unlock 410 (revoked).
 *   E. VIEWER-API PARITY GATE: the same script played on a venue-adopted meet
 *      (synced up) vs directly on the cloud yields identical /api/viewer
 *      responses after FR-23 normalization.
 */

const path = require('path');
const { Checks } = require('../lib/checks');
const { Instance, SERVER_DIR } = require('../lib/instance');
const { Api } = require('../lib/client');
const { openDb } = require('../lib/db');
const { buildMeet } = require('../lib/fixtures');
const { seedMogulJudges, seedDualJudges, playMogulRun, playRejection, playDualBracket } = require('../lib/driver');
const { normalizeCorpus } = require('../lib/normalize');

const protocol = require(path.join(SERVER_DIR, 'sync', 'protocol.js'));

async function readAllSyncTables(db) {
  const out = {};
  for (const t of protocol.SYNC_TABLES) {
    const spec = protocol.TABLES[t];
    const rows = await db.queryAll(`SELECT ${spec.columns.join(',')} FROM ${t}`);
    out[t] = rows.map(r => protocol.manifestRow(t, r));
  }
  return out;
}

async function meetChecksums(db, meetId) {
  const out = {};
  for (const t of protocol.CHECKSUM_TABLES) {
    const rows = await db.queryAll(protocol.selectForMeet(t), [meetId]);
    out[t] = protocol.tableChecksum(t, rows.map(r => protocol.manifestRow(t, r)));
  }
  return out;
}

async function waitFor(fn, timeoutMs = 45000, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return null;
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

/** Play the identical scoring script used by the parity gate (Part E). */
async function playParityScript(api, authApi, eventId, judges, regs) {
  for (let i = 0; i < 3; i++) {
    await playMogulRun(api, eventId, judges, regs[i].id, 1, i);
  }
  await api.must('POST', `/api/events/${eventId}/runs/status-only`, {
    registration_id: regs[3].id, run_number: 1, round: 'qualification', run_status: 'DNS',
  });
}

async function main() {
  const c = new Checks('step4');
  const cloud = new Instance({ name: 'step4-cloud', port: 3141, mode: 'cloud' });
  const venue = new Instance({ name: 'step4-venue', port: 3142, mode: 'venue' });
  const venue2 = new Instance({ name: 'step4-venue2', port: 3143, mode: 'venue' });

  try {
    await cloud.start();
    await venue.start();
    const cApi = new Api(cloud.base);
    const vApi = new Api(venue.base);

    // ---- Fixture on the cloud -------------------------------------------
    const A = await buildMeet(cApi, { name: 'Audit Meet', judges: [], athletes: 4, startRun: false });
    const judgesM = await seedMogulJudges(cApi, A.event.id);
    // Dual event with 6 athletes (4 shared + 2 new)
    const evD = await cApi.must('POST', `/api/meets/${A.meet.id}/events`, {
      discipline: 'dual_mogul', division: 'comp_series', gender: 'M', name: 'Audit Duals M',
    });
    await seedDualJudges(cApi, evD.id);
    const dualRegs = [];
    for (const a of A.athletes) {
      dualRegs.push(await cApi.must('POST', `/api/events/${evD.id}/registrations`, { athlete_id: a.id }));
    }
    for (let i = 0; i < 2; i++) {
      const a = await cApi.must('POST', '/api/athletes', { first_name: `Extra${i}`, last_name: 'Dualist', gender: 'M', birth_year: 2007, ussa_num: `740000${i}` });
      dualRegs.push(await cApi.must('POST', `/api/events/${evD.id}/registrations`, { athlete_id: a.id }));
    }
    // Phase-coverage event (REPLACE displacement)
    const evP = await cApi.must('POST', `/api/meets/${A.meet.id}/events`, {
      discipline: 'mogul', division: 'comp_series', gender: 'M', name: 'Audit Phase Event',
    });
    const pRegs = [];
    for (let i = 0; i < 3; i++) {
      pRegs.push(await cApi.must('POST', `/api/events/${evP.id}/registrations`, { athlete_id: A.athletes[i].id }));
    }

    // ---- Adopt, then take the cloud DOWN --------------------------------
    const rel = await cApi.must('POST', `/api/meets/${A.meet.id}/release-for-adoption`);
    await vApi.must('POST', '/api/venue/adopt', { code: rel.code, cloud_url: cloud.base });
    await cloud.stop();
    c.ok(true, 'cloud stopped — full-outage event begins');

    const vdb = openDb(venue.dbPath);
    const base = await readAllSyncTables(vdb); // post-adoption base state

    // ---- Play the full meet on the venue (cloud down) --------------------
    // Mogul: 2 clean runs + 1 rejection flow + 1 DNS
    await playMogulRun(vApi, A.event.id, judgesM, A.regs[0].id, 1, 0);
    await playMogulRun(vApi, A.event.id, judgesM, A.regs[1].id, 1, 1);
    await playRejection(vApi, vdb, A.event.id, judgesM, A.regs[2].id, 1, 2);
    await vApi.must('POST', `/api/events/${A.event.id}/runs/status-only`, {
      registration_id: A.regs[3].id, run_number: 1, round: 'qualification', run_status: 'DNS',
    });
    // run_round_status REPLACE
    await vApi.must('POST', `/api/events/${A.event.id}/runs/round-status/1/finalize`, {});
    await vApi.must('POST', `/api/events/${A.event.id}/runs/round-status/1/approve`, {});

    // Dual bracket, full (paper-score path; venue auth pass-through pre-PINs)
    const matchCount = await playDualBracket(vApi, vApi, evD.id);
    c.ok(matchCount > 0, `dual bracket played (${matchCount} matches)`);

    // Phase REPLACE displacement: score Run 1 on the phase event, finalize it,
    // create best_of_2 (fresh phase_run_order rows), then reorder registrations
    // (re-syncs phase 1 rows with NEW ids → the old rows are displaced under
    // UNIQUE(phase_id, registration_id)).
    const judgesP = await seedMogulJudges(vApi, evP.id);
    for (let i = 0; i < pRegs.length; i++) {
      await playMogulRun(vApi, evP.id, judgesP, pRegs[i].id, 1, i);
    }
    await vApi.must('POST', `/api/events/${evP.id}/runs/round-status/1/finalize`, {});
    await vApi.must('POST', `/api/events/${evP.id}/phases`, { phase_type: 'best_of_2' });
    const reorder = pRegs.map((r, i) => ({ id: r.id, run_order: pRegs.length - i }));
    await vApi.must('PUT', `/api/events/${evP.id}/registrations/reorder`, reorder);

    // Late changes (R6): athlete edit, bib change, officials, course spec, meet rename
    await vApi.must('PUT', `/api/athletes/${A.athletes[0].id}`, { club: 'Venue Edited FC' });
    await vApi.must('PUT', `/api/events/${A.event.id}/registrations/${A.regs[0].id}`, { bib_number: 99 });
    const off = await vApi.must('POST', `/api/meets/${A.meet.id}/officials`, { role: 'Head Judge', name: 'Venue HJ' });
    await vApi.must('DELETE', `/api/meets/${A.meet.id}/officials/${off.id}`);
    await vApi.must('POST', `/api/meets/${A.meet.id}/course-specs`, { course_name: 'Venue Course', length_m: 232, pitch_deg: 25, pace_standard: 'usss' });
    await vApi.must('PUT', `/api/meets/${A.meet.id}`, { name: 'Audit Meet (venue)' });
    // Training day exclusion toggle (INSERT OR IGNORE + delete)
    await vApi.must('POST', `/api/training-days/${A.trainingDay.id}/exclusions`, { athlete_id: A.athletes[1].id, exclude: true });
    await vApi.must('POST', `/api/training-days/${A.trainingDay.id}/exclusions`, { athlete_id: A.athletes[1].id, exclude: false });
    // Scratch event + cascade delete (multi-table non-PK deletes)
    const evX = await vApi.must('POST', `/api/meets/${A.meet.id}/events`, {
      discipline: 'mogul', division: 'comp_series', gender: 'M', name: 'Scratch Event',
    });
    const jX = await seedMogulJudges(vApi, evX.id);
    const regX = await vApi.must('POST', `/api/events/${evX.id}/registrations`, { athlete_id: A.athletes[0].id });
    await playMogulRun(vApi, evX.id, jX, regX.id, 1, 3);
    await vApi.must('DELETE', `/api/meets/${A.meet.id}/events/${evX.id}`);

    // ---- A. FR-7 audit: replay outbox onto base, diff vs live ------------
    const outboxRows = await vdb.queryAll('SELECT * FROM sync_outbox ORDER BY seq');
    c.ok(outboxRows.length > 100, `outbox captured the event (${outboxRows.length} records)`);

    const replayed = {};
    for (const t of protocol.SYNC_TABLES) {
      replayed[t] = new Map(base[t].map(r => [protocol.pkString(t, r), r]));
    }
    for (const row of outboxRows) {
      const pk = JSON.parse(row.pk);
      const key = protocol.pkString(row.tbl, pk);
      if (row.op === 'delete') replayed[row.tbl].delete(key);
      else replayed[row.tbl].set(key, protocol.manifestRow(row.tbl, JSON.parse(row.row_json)));
    }
    const live = await readAllSyncTables(vdb);
    let auditClean = true;
    for (const t of protocol.SYNC_TABLES) {
      const replayedSum = protocol.tableChecksum(t, [...replayed[t].values()]);
      const liveSum = protocol.tableChecksum(t, live[t]);
      const same = JSON.stringify(replayedSum) === JSON.stringify(liveSum);
      if (!same) auditClean = false;
      c.ok(same, `FR-7 audit: outbox replay ≡ live venue DB for ${t} (live ${liveSum.count} rows)`);
    }
    c.ok(auditClean, 'FR-7 OUTBOX AUDIT GATE: capture layer missed nothing');

    // ---- B. Cloud restart → replay + mirror correctness ------------------
    await cloud.start();
    c.ok(true, 'cloud restarted (mid-adoption restart, FR-9 case)');
    const cdb = openDb(cloud.dbPath);
    const drained = await waitFor(async () => {
      const n = await vdb.queryOne('SELECT COUNT(*) AS c FROM sync_outbox');
      return parseInt(n.c) === 0 ? true : null;
    }, 60000);
    c.ok(drained, 'outbox drained to the cloud after reconnect');
    const vSums = await meetChecksums(vdb, A.meet.id);
    const cSums = await meetChecksums(cdb, A.meet.id);
    c.deepEq(cSums, vSums, 'cloud mirror checksums ≡ venue after full-outage replay (all checksum tables)');
    const cloudMeet = await cdb.queryOne('SELECT name, adoption_status, last_applied_seq FROM meets WHERE id=?', [A.meet.id]);
    c.eq(cloudMeet.name, 'Audit Meet (venue)', 'venue rename mirrored');
    c.eq(cloudMeet.adoption_status, 'adopted', 'cloud lock state SURVIVED the meets-row upserts (manifest-only apply)');
    c.ok(Number(cloudMeet.last_applied_seq) > 100, `last_applied_seq recorded (${cloudMeet.last_applied_seq})`);

    // Idempotent replay: re-send an old change directly.
    const token = (await vdb.queryOne(`SELECT value FROM app_settings WHERE key='venue_sync_token'`)).value;
    const syncApi = new Api(cloud.base, { token });
    let r = await syncApi.post(`/api/sync/meets/${A.meet.id}/changes`, {
      protocol_version: protocol.SYNC_PROTOCOL_VERSION,
      changes: [{ seq: 1, tbl: 'meets', op: 'upsert', pk: { id: A.meet.id }, row: base.meets[0], idempotency_key: 'replayed' }],
    });
    c.eq(r.status, 200, 'replayed old batch accepted');
    c.eq(r.data.skipped, 1, 'already-applied seq skipped (idempotent replay)');
    const nameAfter = await cdb.queryOne('SELECT name FROM meets WHERE id=?', [A.meet.id]);
    c.eq(nameAfter.name, 'Audit Meet (venue)', 'stale replay did not regress the mirror');

    // ---- C. Live latency (R14) + FR-19 nudge -----------------------------
    // WS client subscribed to the mogul event on the CLOUD.
    const nudges = [];
    const ws = new WebSocket(cloud.base.replace('http', 'ws') + '/ws');
    await new Promise(res => { ws.onopen = res; });
    ws.send(JSON.stringify({ type: 'subscribe', eventId: A.event.id }));
    ws.onmessage = (m) => { try { const d = JSON.parse(m.data); if (d.type === 'sync_applied') nudges.push(Date.now()); } catch (_) {} };

    const latencies = [];
    for (let i = 0; i < 3; i++) {
      const runId = await playMogulRun(vApi, A.event.id, judgesM, A.regs[i].id, 2, i, { approve: false });
      const t0 = Date.now();
      await vApi.must('POST', `/api/events/${A.event.id}/runs/${runId}/approve`, {});
      const seen = await waitFor(async () => {
        const row = await cdb.queryOne('SELECT total_score, status FROM runs WHERE id=?', [runId]);
        return row && row.status === 'complete' && row.total_score != null ? true : null;
      }, 15000, 50);
      c.ok(seen, `run ${i + 1} visible on the cloud after HJ approval`);
      latencies.push(Date.now() - t0);
    }
    const maxLatency = Math.max(...latencies);
    c.ok(maxLatency < 5000, `R14 LATENCY GATE: HJ approval → cloud mirror in ${latencies.map(l => l + 'ms').join(', ')} (max ${maxLatency}ms < 5s)`);
    const nudged = await waitFor(async () => (nudges.length > 0 ? true : null), 5000, 100);
    c.ok(nudged, `FR-19: cloud emitted per-event sync_applied WS nudge (${nudges.length} received)`);
    ws.close();

    // ---- Many short outages during active scoring ------------------------
    // Close out round 2 first (legacy round blocking needs the prior round
    // finalized), then each outage round scores one athlete + DNSes the rest.
    const finishRound = async (rn, scoredIdx) => {
      for (let j = 0; j < A.regs.length; j++) {
        if (j === scoredIdx) continue;
        await vApi.must('POST', `/api/events/${A.event.id}/runs/status-only`, {
          registration_id: A.regs[j].id, run_number: rn, round: 'qualification', run_status: 'DNS',
        });
      }
      await vApi.must('POST', `/api/events/${A.event.id}/runs/round-status/${rn}/finalize`, {});
    };
    await vApi.must('POST', `/api/events/${A.event.id}/runs/status-only`, {
      registration_id: A.regs[3].id, run_number: 2, round: 'qualification', run_status: 'DNS',
    });
    await vApi.must('POST', `/api/events/${A.event.id}/runs/round-status/2/finalize`, {});
    for (let i = 0; i < 3; i++) {
      await cloud.stop();
      const rn = 3 + i;
      await playMogulRun(vApi, A.event.id, judgesM, A.regs[i].id, rn, i);
      await finishRound(rn, i);
      await cloud.start();
      const ok = await waitFor(async () => {
        const n = await vdb.queryOne('SELECT COUNT(*) AS c FROM sync_outbox');
        return parseInt(n.c) === 0 ? true : null;
      }, 60000);
      c.ok(ok, `short outage ${i + 1}: queue replayed after reconnect`);
    }
    const vSums2 = await meetChecksums(vdb, A.meet.id);
    const cSums2 = await meetChecksums(cdb, A.meet.id);
    c.deepEq(cSums2, vSums2, 'no duplicate and no lost scores across repeated short outages (checksums equal)');

    // ---- D. Auth failures ------------------------------------------------
    r = await new Api(cloud.base, { token: 'wrong-token' }).post(`/api/sync/meets/${A.meet.id}/changes`, {
      protocol_version: protocol.SYNC_PROTOCOL_VERSION, changes: [],
    });
    c.eq(r.status, 401, 'wrong sync token → 401');
    r = await syncApi.post(`/api/sync/meets/${A.meet.id}/changes`, { protocol_version: 999, changes: [] });
    c.eq(r.status, 409, 'protocol mismatch on changes → 409');
    await cApi.must('POST', `/api/admin/adoption/${A.meet.id}/force-unlock`, { confirm_name: 'Audit Meet (venue)' });
    r = await syncApi.post(`/api/sync/meets/${A.meet.id}/changes`, {
      protocol_version: protocol.SYNC_PROTOCOL_VERSION, changes: [],
    });
    c.eq(r.status, 410, 'after force-unlock, upsync gets 410 adoption_revoked (R8)');

    // ---- E. VIEWER-API PARITY GATE ---------------------------------------
    await venue2.start();
    const v2Api = new Api(venue2.base);
    // Shared athletes so content is identical between the two meets.
    const athletes = [];
    for (let i = 0; i < 4; i++) {
      athletes.push(await cApi.must('POST', '/api/athletes', {
        first_name: `Par${i}`, last_name: 'Ity', gender: 'M', birth_year: 2008, ussa_num: `750000${i}`, confirm: true,
      }));
    }
    const mkMeet = async (name) => {
      const meet = await cApi.must('POST', '/api/meets', { name, location: 'Parity', date: '2026-08-23', meet_ranking: 'C' });
      const ev = await cApi.must('POST', `/api/meets/${meet.id}/events`, { discipline: 'mogul', division: 'comp_series', gender: 'M', name: `${name} M mogul` });
      const judges = await seedMogulJudges(cApi, ev.id);
      const regs = [];
      for (let i = 0; i < 4; i++) {
        regs.push(await cApi.must('POST', `/api/events/${ev.id}/registrations`, { athlete_id: athletes[i].id, bib_number: i + 1 }));
      }
      return { meet, ev, judges, regs };
    };
    const C = await mkMeet('Parity Cloud');
    const V = await mkMeet('Parity Venue');
    // Cloud-scored meet:
    await playParityScript(cApi, cApi, C.ev.id, C.judges, C.regs);
    // Venue-scored meet: adopt on venue2, same script, sync up.
    const rel2 = await cApi.must('POST', `/api/meets/${V.meet.id}/release-for-adoption`);
    await v2Api.must('POST', '/api/venue/adopt', { code: rel2.code, cloud_url: cloud.base });
    await playParityScript(v2Api, v2Api, V.ev.id, V.judges, V.regs);
    const v2db = openDb(venue2.dbPath);
    const drained2 = await waitFor(async () => {
      const n = await v2db.queryOne('SELECT COUNT(*) AS c FROM sync_outbox');
      return parseInt(n.c) === 0 ? true : null;
    }, 60000);
    c.ok(drained2, 'parity meet synced to the cloud');

    // /results/scores returns `scores` and `runs` arrays whose ORDER is not
    // part of the API contract (the iOS client groups by run_id, v1.23.00) and
    // follows physical row order — canonically sort them by semantic keys
    // before comparison (documented in docs/SYNC_PROTOCOL.md §8).
    const canonScores = (data) => {
      if (!data || !Array.isArray(data.runs) || !Array.isArray(data.scores)) return data;
      const runKey = Object.fromEntries(data.runs.map(r => [r.run_id, `${r.run_time}|${r.jump1_code}|${r.jump2_code}`]));
      const out = { ...data };
      out.runs = [...data.runs].sort((a, b) => (runKey[a.run_id] < runKey[b.run_id] ? -1 : 1));
      out.scores = [...data.scores].sort((a, b) => {
        const ka = `${runKey[a.run_id]}|${a.score_type}|${a.role}|${a.judge_number}|${a.raw_score}`;
        const kb = `${runKey[b.run_id]}|${b.score_type}|${b.role}|${b.judge_number}|${b.raw_score}`;
        return ka < kb ? -1 : 1;
      });
      return out;
    };
    const endpoints = [
      { mk: (ev) => `/api/viewer/events/${ev.id}/status`, canon: (d) => d },
      { mk: (ev) => `/api/viewer/events/${ev.id}/results`, canon: (d) => d },
      { mk: (ev) => `/api/viewer/events/${ev.id}/results/scores`, canon: canonScores },
      { mk: (ev) => `/api/viewer/events/${ev.id}/rounds`, canon: (d) => d },
    ];
    for (const { mk, canon } of endpoints) {
      const rc = await cApi.get(mk(C.ev));
      const rv = await cApi.get(mk(V.ev));
      c.eq(rc.status, rv.status, `viewer parity status: ${mk(C.ev).replace(C.ev.id, ':id')}`);
      const nc = JSON.stringify(normalizeCorpus(canon(rc.data), { dropKeys: ['name', 'event_name', 'meet_name'] }));
      const nv = JSON.stringify(normalizeCorpus(canon(rv.data), { dropKeys: ['name', 'event_name', 'meet_name'] }));
      const same = nc === nv;
      c.ok(same, `VIEWER PARITY: ${mk(C.ev).replace(C.ev.id, ':id')} identical after FR-23 normalization${same ? '' : `\n      cloud: ${nc.slice(0, 400)}\n      venue: ${nv.slice(0, 400)}`}`);
    }
    v2db.close();
    vdb.close();
    cdb.close();
  } finally {
    await cloud.stop().catch(() => {});
    await venue.stop().catch(() => {});
    await venue2.stop().catch(() => {});
  }

  return c;
}

module.exports = { main };
