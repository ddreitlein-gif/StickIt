/**
 * Step 5 acceptance tests — check-in, handback, snapshots.
 *
 *   A. TWO-DAY MEET CYCLE (Section 11 item 3, D8): adopt → interleaved singles
 *      day (M/F alternating; every role auto-following across event
 *      boundaries; concurrent Scoring Computer work on the idle event incl.
 *      a locally-generated results PDF) → Hand Back to Cloud with checksum
 *      verification → duals bracket built ON THE CLOUD from the synced
 *      results → re-release → one-tap re-adopt (replace) → duals day →
 *      Check In. No human steps beyond the scripted volunteer actions.
 *   B. FR-10: venue freeze — tablet writes cleanly refused during check-in
 *      and after; role pages show the freeze screens (Playwright).
 *   C. Checksum mismatch: tampered cloud row → check-in 409s (never unlocks)
 *      when called directly; the venue flow auto-repushes and verifies.
 *   D. Crash test (Section 11 item 9): SIGKILL the venue mid-scoring →
 *      restart → data integrity + outbox continuity + tablet role memory.
 *   E. USB snapshot worker (R11): snapshots appear on the "stick"; absent
 *      stick degrades to a home-screen warning.
 */

const fs = require('fs');
const path = require('path');
const { Checks } = require('../lib/checks');
const { Instance, scratchDir, SERVER_DIR } = require('../lib/instance');
const { Api } = require('../lib/client');
const { openDb } = require('../lib/db');
const { seedMogulJudges, seedDualJudges, playMogulRun, playDualBracket } = require('../lib/driver');
const { newTablet, shutdownBrowser } = require('../lib/browser');

const protocol = require(path.join(SERVER_DIR, 'sync', 'protocol.js'));

async function waitFor(fn, timeoutMs = 45000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return null;
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

async function meetChecksums(db, meetId) {
  const out = {};
  for (const t of protocol.CHECKSUM_TABLES) {
    const rows = await db.queryAll(protocol.selectForMeet(t), [meetId]);
    out[t] = protocol.tableChecksum(t, rows.map(r => protocol.manifestRow(t, r)));
  }
  return out;
}

async function main() {
  const c = new Checks('step5');
  const snapDir = scratchDir('step5-usb-stick');
  const cloud = new Instance({ name: 'step5-cloud', port: 3171, mode: 'cloud' });
  const venue = new Instance({
    name: 'step5-venue', port: 3172, mode: 'venue',
    env: { STICKIT_SNAPSHOT_DIR: snapDir, STICKIT_SNAPSHOT_INTERVAL_MS: '1500' },
  });

  try {
    await cloud.start();
    await venue.start();
    const cApi = new Api(cloud.base);
    const vApi = new Api(venue.base);

    // ---- Build the two-day meet on the cloud ----------------------------
    const meet = await cApi.must('POST', '/api/meets', { name: 'Two Day Classic', location: 'Harness Bowl', date: '2026-08-22', meet_ranking: 'B' });
    const evM = await cApi.must('POST', `/api/meets/${meet.id}/events`, { discipline: 'mogul', division: 'comp_series', gender: 'M', name: 'Singles M' });
    const evF = await cApi.must('POST', `/api/meets/${meet.id}/events`, { discipline: 'mogul', division: 'comp_series', gender: 'F', name: 'Singles F' });
    const judgesM = await seedMogulJudges(cApi, evM.id);
    const judgesF = await seedMogulJudges(cApi, evF.id);
    const mAth = [], fAth = [], mRegs = [], fRegs = [];
    for (let i = 0; i < 4; i++) {
      mAth.push(await cApi.must('POST', '/api/athletes', { first_name: `TdM${i}`, last_name: 'Racer', gender: 'M', birth_year: 2008, ussa_num: `770000${i}` }));
      mRegs.push(await cApi.must('POST', `/api/events/${evM.id}/registrations`, { athlete_id: mAth[i].id, bib_number: i + 1 }));
      fAth.push(await cApi.must('POST', '/api/athletes', { first_name: `TdF${i}`, last_name: 'Racer', gender: 'F', birth_year: 2009, ussa_num: `771000${i}` }));
      fRegs.push(await cApi.must('POST', `/api/events/${evF.id}/registrations`, { athlete_id: fAth[i].id, bib_number: 50 + i + 1 }));
    }

    // ---- Day 1: adopt + interleaved singles ------------------------------
    let rel = await cApi.must('POST', `/api/meets/${meet.id}/release-for-adoption`);
    await vApi.must('POST', '/api/venue/adopt', { code: rel.code, cloud_url: cloud.base });
    await vApi.must('POST', '/api/venue/pins', { control_pin: '2468', crew_pin: '1357' });
    const controlToken = (await vApi.must('POST', '/api/venue/verify-pin', { kind: 'control', pin: '2468' })).token;
    const vAuthed = new Api(venue.base, { token: controlToken });

    // Interleave W/M runs; assert every role follows each boundary (FR-15).
    const order = [
      { ev: evF, judges: judgesF, regs: fRegs }, { ev: evM, judges: judgesM, regs: mRegs },
      { ev: evF, judges: judgesF, regs: fRegs }, { ev: evM, judges: judgesM, regs: mRegs },
    ];
    for (let i = 0; i < order.length; i++) {
      const { ev, judges, regs } = order[i];
      const runId = await playMogulRun(vApi, ev.id, judges, regs[Math.floor(i / 2)].id, 1, i, { approve: false });
      // Mid-run: all roles must point at this event with zero device interaction.
      for (const role of ['judge&seat=J1', 'hj', 'timekeeper', 'scoreboard']) {
        const t = (await vApi.get(`/api/venue/role-target?role=${role.split('&')[0]}&${role.includes('seat') ? 'seat=J1' : ''}`)).data;
        if (i === 0 && role === 'hj') c.ok(true, 'role-target checks begin');
        if (t.event_id !== ev.id) c.ok(false, `FR-15: ${role} follows ${ev.name} at boundary ${i} (got ${t.event_name})`);
      }
      // Concurrent Scoring Computer work on the OTHER (idle) event: edit its
      // run order and print its results PDF while this run is mid-approval.
      const idle = ev.id === evM.id ? { ev: evF, regs: fRegs } : { ev: evM, regs: mRegs };
      await vAuthed.must('PUT', `/api/events/${idle.ev.id}/registrations/reorder`,
        idle.regs.map((r, j) => ({ id: r.id, run_order: j + 1 })));
      const pdf = await fetch(`${venue.base}/api/pdf/event-results-detailed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${controlToken}` },
        body: JSON.stringify({ eventId: idle.ev.id }),
      });
      if (i === 0) c.ok(pdf.ok && (pdf.headers.get('content-type') || '').includes('pdf'), 'Scoring Computer prints the idle event\'s results PDF locally mid-run (6.2)');
      await vApi.must('POST', `/api/events/${ev.id}/runs/${runId}/approve`, {});
    }
    c.ok(true, 'FR-15: judge/HJ/timekeeper/scoreboard auto-followed every interleaved boundary');
    // Finish day 1: score remaining athletes + DNS
    for (const { ev, judges, regs } of [{ ev: evM, judges: judgesM, regs: mRegs }, { ev: evF, judges: judgesF, regs: fRegs }]) {
      await playMogulRun(vApi, ev.id, judges, regs[2].id, 1, 5);
      await vApi.must('POST', `/api/events/${ev.id}/runs/status-only`, {
        registration_id: regs[3].id, run_number: 1, round: 'qualification', run_status: 'DNS',
      });
    }

    // ---- D. Crash test mid-day (Section 11 item 9) -----------------------
    // Tablet with role memory, then SIGKILL the venue mid-scoring.
    const tab = await newTablet();
    {
      const page = await tab.newPage();
      await page.goto(venue.base + '/?menu=1', { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => localStorage.setItem('stickit_venue_role', JSON.stringify({ role: 'judge', seat: 'J3' })));
      await page.close();
    }
    // Legacy round gating: run 2 needs round 1 finalized.
    await vApi.must('POST', `/api/events/${evM.id}/runs/round-status/1/finalize`, {});
    await cloud.stop(); // outage so the outbox holds rows across the crash
    const crashRunId = await playMogulRun(vApi, evM.id, judgesM, mRegs[0].id, 2, 6, { approve: false });
    const vdbPre = openDb(venue.dbPath);
    const depthBefore = parseInt((await vdbPre.queryOne('SELECT COUNT(*) AS c FROM sync_outbox')).c);
    vdbPre.close();
    c.ok(depthBefore > 0, `outbox holds ${depthBefore} rows before the crash`);
    await venue.kill();
    c.ok(true, 'venue server SIGKILLed mid-scoring');
    await venue.start();
    const vdb = openDb(venue.dbPath);
    const crashRun = await vdb.queryOne('SELECT id, status FROM runs WHERE id=?', [crashRunId]);
    c.ok(!!crashRun, 'crash test: the mid-scoring run survived the kill');
    const depthAfter = parseInt((await vdb.queryOne('SELECT COUNT(*) AS c FROM sync_outbox')).c);
    c.ok(depthAfter >= depthBefore, `crash test: outbox continuity (${depthAfter} rows after restart)`);
    // Finish the crashed run + catch up
    await vApi.must('POST', `/api/events/${evM.id}/runs/${crashRunId}/approve`, {});
    await cloud.start();
    const cdb = openDb(cloud.dbPath);
    const caughtUp = await waitFor(async () => {
      const n = await vdb.queryOne('SELECT COUNT(*) AS c FROM sync_outbox');
      return parseInt(n.c) === 0 ? true : null;
    }, 60000);
    c.ok(caughtUp, 'crash test: queue drained after restart + reconnect');
    // Tablet role memory: reopened browser goes straight back to its seat.
    {
      const page = await tab.newPage();
      await page.goto(venue.base + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForURL('**/venue/role/judge?seat=J3', { timeout: 10000 });
      c.ok(true, 'crash test: tablet returned to its judge seat after venue restart');
      await page.close();
    }

    // ---- C. Checksum mismatch (direct): never unlock ---------------------
    const token = (await vdb.queryOne(`SELECT value FROM app_settings WHERE key='venue_sync_token'`)).value;
    const syncApi = new Api(cloud.base, { token });
    let r = await syncApi.post(`/api/sync/meets/${meet.id}/checkin`, {
      protocol_version: protocol.SYNC_PROTOCOL_VERSION,
      checksums: { meets: { count: 1, hash: 'bogus' } },
      mode: 'handback',
    });
    c.eq(r.status, 409, 'check-in with mismatched checksums is refused');
    c.eq(r.data.error, 'checksum_mismatch', 'mismatch named');
    c.ok(Array.isArray(r.data.mismatched) && r.data.mismatched.length > 0, `mismatched tables reported (${(r.data.mismatched || []).length})`);
    const stillAdopted = await cdb.queryOne('SELECT adoption_status FROM meets WHERE id=?', [meet.id]);
    c.eq(stillAdopted.adoption_status, 'adopted', 'NEVER unlocks on a failed checksum (R7)');

    // Tamper a cloud row → the venue flow must auto-repush and still succeed.
    await cdb.execute(`UPDATE runs SET total_score = 1.23 WHERE event_id=? AND total_score IS NOT NULL`, [evM.id]);

    // ---- B+A. Handback (FR-10 order) -------------------------------------
    r = await vApi.post('/api/venue/checkin', { mode: 'handback' });
    c.eq(r.status, 403, 'check-in without the Control PIN refused');
    r = await vAuthed.post('/api/venue/checkin', { mode: 'handback' });
    c.eq(r.status, 200, `Hand Back to Cloud succeeds (${JSON.stringify(r.data)})`);
    c.ok(Array.isArray(r.data.repushed) && r.data.repushed.includes('runs'), 'tampered cloud table auto-repushed then verified');
    const afterHb = await cdb.queryOne('SELECT adoption_status, sync_token_hash FROM meets WHERE id=?', [meet.id]);
    c.eq(afterHb.adoption_status, null, 'handback returns the meet to normal cloud editing (D8)');
    c.eq(afterHb.sync_token_hash, null, 'sync token cleared at handback');
    const hbSums = await meetChecksums(cdb, meet.id);
    const vSums = await meetChecksums(vdb, meet.id);
    c.deepEq(hbSums, vSums, 'cloud archive provably identical to the venue at handback (R7)');

    // FR-10: venue is frozen — tablet writes cleanly refused.
    r = await vApi.post(`/api/events/${evM.id}/runs/${crashRunId}/scores`, {
      judge_id: judgesM.TL1.id, score_type: 'turns', raw_score: 10,
    });
    c.eq(r.status, 423, 'tablet write after handback is cleanly refused (FR-10)');
    c.eq(r.data.error, 'venue_frozen', 'freeze error named');
    // Role pages show the stop screen (Playwright).
    {
      const page = await tab.newPage();
      await page.goto(venue.base + '/venue/role/timekeeper', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('text=you can stop', { timeout: 10000 });
      c.ok(true, 'role page shows the "handed back — stop" screen (FR-10)');
      // Scoreboard is a read-only broadcast surface — it must keep rendering
      // results through check-in/handback (same carve-out as the Overlay).
      await page.goto(venue.base + '/venue/role/scoreboard', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('iframe[title="venue-scoreboard"]', { timeout: 10000 });
      c.ok(true, 'scoreboard role stays live through handback (broadcast carve-out)');
      await page.close();
    }

    // ---- Overnight: David builds the duals bracket ON THE CLOUD ----------
    const evD = await cApi.must('POST', `/api/meets/${meet.id}/events`, {
      discipline: 'dual_mogul', division: 'comp_series', gender: 'M', name: 'Duals M',
    });
    await seedDualJudges(cApi, evD.id);
    for (const a of mAth) {
      await cApi.must('POST', `/api/events/${evD.id}/registrations`, { athlete_id: a.id });
    }
    await cApi.must('POST', `/api/events/${evD.id}/dual/seed-mogul-event`, { source_event_id: evM.id });
    await cApi.must('POST', `/api/events/${evD.id}/dual/seed-fis`, {});
    const cloudBracket = await cApi.must('GET', `/api/events/${evD.id}/dual`);
    const cbMatches = cloudBracket.matches || cloudBracket;
    c.ok(cbMatches.length > 0, `overnight duals bracket built on the cloud from synced singles results (${cbMatches.length} matches)`);

    // ---- Day 2: re-release → one-tap re-adopt → duals day → check-in ----
    rel = await cApi.must('POST', `/api/meets/${meet.id}/release-for-adoption`);
    r = await vApi.post('/api/venue/adopt', { code: rel.code, cloud_url: cloud.base });
    c.eq(r.status, 409, 're-adopt recognizes the archived local copy');
    c.eq(r.data.offer_replace, true, 'offers the one-tap replace (D8)');
    r = await vApi.post('/api/venue/adopt', { code: rel.code, cloud_url: cloud.base, replace: true });
    c.eq(r.status, 200, 'replace re-adoption succeeds — day 2 begins');
    const venueBracket = await vApi.must('GET', `/api/events/${evD.id}/dual`);
    const vbMatches = venueBracket.matches || venueBracket;
    c.eq(vbMatches.length, cbMatches.length, 'venue received the overnight bracket');
    // PINs persist on the venue (device-local settings, not meet data)
    const pinsStatus = await vApi.must('GET', '/api/venue/pins/status');
    c.eq(pinsStatus.control_set, true, 'PINs survive re-adoption');

    const matchCount = await playDualBracket(vApi, vAuthed, evD.id, { skipSeed: true });
    c.ok(matchCount > 0, `duals day played (${matchCount} matches)`);

    r = await vAuthed.post('/api/venue/checkin', { mode: 'checkin' });
    c.eq(r.status, 200, 'final Check In succeeds');
    const final = await cdb.queryOne('SELECT adoption_status FROM meets WHERE id=?', [meet.id]);
    c.eq(final.adoption_status, 'checked_in', 'cloud marks the permanent record (checked_in)');
    const ciSums = await meetChecksums(cdb, meet.id);
    const vSums2 = await meetChecksums(vdb, meet.id);
    c.deepEq(ciSums, vSums2, 'TWO-DAY CYCLE: final archive provably identical to the venue (R7)');
    // Cloud editable again; venue archival read-only.
    r = await cApi.put(`/api/meets/${meet.id}`, { location: 'Post Meet Edit' });
    c.eq(r.status, 200, 'cloud editable after check-in');
    r = await vApi.put(`/api/meets/${meet.id}`, { location: 'Nope' });
    c.eq(r.status, 423, 'venue archival read-only after check-in');
    // Venue home reports checked_in
    const vs = await vApi.must('GET', '/api/venue/status');
    c.eq(vs.meet_state, 'checked_in', 'venue state is checked_in');

    // ---- E. USB snapshot worker (R11) ------------------------------------
    const snaps = fs.readdirSync(snapDir).filter(f => f.endsWith('.db'));
    c.ok(snaps.length > 0, `USB snapshots written (${snaps.length} on the stick)`);
    c.eq(vs.snapshot && vs.snapshot.available, true, 'snapshot status healthy on the home screen');
    // Snapshot is a readable database containing the meet
    const sdb = openDb(path.join(snapDir, snaps.sort().reverse()[0]));
    const snapMeet = await sdb.queryOne('SELECT id FROM meets WHERE id=?', [meet.id]);
    c.ok(!!snapMeet, 'latest snapshot contains the meet (recoverable)');
    sdb.close();
    // Absent stick degrades to a warning (fresh venue instance, bogus dir).
    const venue3 = new Instance({
      name: 'step5-venue3', port: 3173, mode: 'venue',
      env: { STICKIT_SNAPSHOT_DIR: path.join(snapDir, 'not-mounted'), STICKIT_SNAPSHOT_INTERVAL_MS: '1000' },
    });
    await venue3.start();
    const v3s = (await new Api(venue3.base).get('/api/venue/status')).data;
    c.ok(v3s.snapshot && v3s.snapshot.configured === true && v3s.snapshot.available === false && !!v3s.snapshot.warning, `absent stick degrades to a home-screen warning (${v3s.snapshot && v3s.snapshot.warning})`);
    await venue3.stop();

    await tab.close();
    vdb.close();
    cdb.close();
  } finally {
    await shutdownBrowser().catch(() => {});
    await cloud.stop().catch(() => {});
    await venue.stop().catch(() => {});
  }

  return c;
}

module.exports = { main };
