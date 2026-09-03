/**
 * v2.4.00 acceptance — post-physical-test fix release (09-03-26 findings).
 *
 * HTTP layer:
 *   L-1  boot-time migrations on a venue: bib backfill is a true one-time
 *        migration (app_settings marker), its writes are captured by the
 *        outbox when it does run (capture installed BEFORE initSchema) and
 *        reach the cloud; DNS/DNF rows are never "backfilled" again.
 *   L-3  journal lines: sync worker offline / back online / drained,
 *        snapshot written / FAILED (collapsed).
 *   T-4  seat picker offers only the seats the active event's format uses
 *        (5-judge → J1–J5, 7-judge → J1–J7 with J6/J7 = Air), claimed
 *        out-of-format seats stay force-releasable, TL4/TL5 accepted.
 *   T-2  seat release is public (a tablet frees its own seat).
 *   T-6  /runs/active reports finalized after the HJ finalizes the event;
 *        a second Finalize is idempotent.
 *   T-1  before any run the HJ follows the first-created event; the first
 *        Start Run moves the spotlight.
 *   E-1  copy judges from another event: same meet + discipline only,
 *        filled roles kept, unsupported roles skipped, new ids/short codes,
 *        venue-side copy rides the sync.
 * Playwright layer (FR-21):
 *   T-2  judge role bar (seat · judge · event), amber notice on a singles →
 *        duals switch, Leave seat → seat freed + picker with dual roles,
 *        Change role → menu + memory cleared + seat freed; HJ bar without
 *        Leave seat; scoreboard has no bar, only the corner button.
 *   T-7  Scoring Computer sidebar "Venue Menu" → menu with the remembered-
 *        role strip → back; reload still returns to the console (FR-15).
 *   T-5  meet page More menu on the venue hides Release for Adoption / Clone
 *        Meet and offers "Venue Menu (end of day)"; cloud unchanged.
 */

const path = require('path');
const fs = require('fs');
const { Checks } = require('../lib/checks');
const { Instance } = require('../lib/instance');
const { Api } = require('../lib/client');
const { openDb } = require('../lib/db');
const { buildMeet } = require('../lib/fixtures');
const { playMogulRun } = require('../lib/driver');
const { newTablet, shutdownBrowser } = require('../lib/browser');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, { timeout = 15000, every = 250 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return null;
    await sleep(every);
  }
}

async function waitDrained(vApi, timeout = 20000) {
  return waitFor(async () => {
    const s = await vApi.must('GET', '/api/venue/status');
    return s.sync && s.sync.state === 'up_to_date' && s.sync.queued === 0 ? s : null;
  }, { timeout });
}

async function main() {
  const c = new Checks('v240');
  const cloud = new Instance({ name: 'v240-cloud', port: 3181, mode: 'cloud' });
  const venue = new Instance({ name: 'v240-venue', port: 3182, mode: 'venue' });
  const snapDir = path.join(venue.dir, 'snap');
  fs.mkdirSync(snapDir, { recursive: true });
  venue.extraEnv = { STICKIT_SNAPSHOT_DIR: snapDir, STICKIT_SNAPSHOT_INTERVAL_MS: '1500' };
  let venueBad = null;

  try {
    await cloud.start();
    await venue.start();
    const cApi = new Api(cloud.base);
    const vApi = new Api(venue.base);
    const cdb = openDb(cloud.dbPath);
    const vdb = openDb(venue.dbPath);

    // =====================================================================
    // Fixture (cloud): evM 5-judge mogul (fully staffed, 3 athletes),
    // ev7 7-judge mogul (TL4/TL5 only), evF 5-judge mogul (HJ only),
    // evD dual (5 dual judges, 4 athletes registered).
    // =====================================================================
    const A = await buildMeet(cApi, { name: 'PostTest', gender: 'M', judges: ['TL1', 'TL2', 'TL3', 'Air1', 'Air2', 'HJ'], athletes: 3, startRun: false });
    const evM = A.event;
    const judgesM = Object.fromEntries(A.judges.map(j => [j.role, j]));
    const ev7 = await cApi.must('POST', `/api/meets/${A.meet.id}/events`, {
      discipline: 'mogul', division: 'comp_series', gender: 'F', name: 'PostTest F 7-judge', num_tl_judges: 5, num_air_judges: 2,
    });
    let r = await cApi.post(`/api/events/${ev7.id}/judges`, { name: 'Seven TL4', role: 'TL4' });
    c.eq(r.status, 201, 'TL4 accepted by the judges endpoint (7-judge format; was a 400 before v2.4.00)');
    await cApi.must('POST', `/api/events/${ev7.id}/judges`, { name: 'Seven TL5', role: 'TL5' });
    const ath7 = await cApi.must('POST', '/api/athletes', { first_name: 'Seven', last_name: 'Racer', gender: 'F', birth_year: 2009, ussa_num: '7400001' });
    const reg7 = await cApi.must('POST', `/api/events/${ev7.id}/registrations`, { athlete_id: ath7.id, bib_number: 71 });
    const evF = await cApi.must('POST', `/api/meets/${A.meet.id}/events`, {
      discipline: 'mogul', division: 'comp_series', gender: 'F', name: 'PostTest F 5-judge',
    });
    await cApi.must('POST', `/api/events/${evF.id}/judges`, { name: 'Own HJ', role: 'HJ' });
    const regF = await cApi.must('POST', `/api/events/${evF.id}/registrations`, { athlete_id: ath7.id, bib_number: 72 });
    const evD = await cApi.must('POST', `/api/meets/${A.meet.id}/events`, {
      discipline: 'dual_mogul', division: 'comp_series', gender: 'M', name: 'PostTest Duals',
    });
    for (const role of ['DualTurns1', 'DualTurns2', 'DualAir', 'DualTime', 'DualOverall']) {
      await cApi.must('POST', `/api/events/${evD.id}/judges`, { name: `DJ ${role}`, role });
    }
    const dualAthletes = [];
    for (let i = 0; i < 4; i++) {
      const a = await cApi.must('POST', '/api/athletes', { first_name: `Dual${i}`, last_name: 'Racer', gender: 'M', birth_year: 2008, ussa_num: String(7500001 + i) });
      dualAthletes.push(a);
      await cApi.must('POST', `/api/events/${evD.id}/registrations`, { athlete_id: a.id, bib_number: 80 + i });
    }
    const otherMeet = await buildMeet(cApi, { name: 'OtherMeet', judges: ['TL1', 'Air1'], athletes: 1, startRun: false });

    // =====================================================================
    // E-1 — copy judges (cloud)
    // =====================================================================
    r = await cApi.post(`/api/events/${evF.id}/judges/copy-from-event`, { sourceEventId: evM.id });
    c.eq(r.status, 200, 'E-1: copy judges evM → evF succeeds');
    c.eq(r.data.copied, 5, 'E-1: 5 judges copied (TL1-3, Air1-2)');
    c.eq(r.data.skipped_filled, 1, 'E-1: the HJ already on evF is kept, not overwritten');
    const jF = await cApi.must('GET', `/api/events/${evF.id}/judges`);
    c.eq(jF.length, 6, 'E-1: evF now has 6 judges');
    c.eq(jF.find(j => j.role === 'HJ').name, 'Own HJ', 'E-1: evF keeps its own HJ');
    const srcTL1 = judgesM.TL1, dstTL1 = jF.find(j => j.role === 'TL1');
    c.eq(dstTL1.name, srcTL1.name, 'E-1: copied judge name matches the source');
    c.ok(dstTL1.id !== srcTL1.id && dstTL1.short_code && dstTL1.short_code !== srcTL1.short_code, 'E-1: copied judge has a NEW id and short code (tablet URLs are per event)');
    r = await cApi.post(`/api/events/${evM.id}/judges/copy-from-event`, { sourceEventId: ev7.id });
    c.eq(r.status, 200, 'E-1: copy ev7 → evM succeeds');
    c.eq(r.data.copied, 0, 'E-1: nothing copied into a fully staffed 5-judge event');
    c.eq(r.data.skipped_role, 2, 'E-1: TL4/TL5 skipped — the 5-judge target format has no such roles');
    r = await cApi.post(`/api/events/${ev7.id}/judges/copy-from-event`, { sourceEventId: evM.id });
    c.eq(r.data.copied, 6, 'E-1: evM → ev7 copies TL1-3, Air1-2, HJ (TL4/TL5 already there)');
    c.eq((await cApi.must('GET', `/api/events/${ev7.id}/judges`)).length, 8, 'E-1: ev7 is now fully staffed (8 rows)');
    r = await cApi.post(`/api/events/${evD.id}/judges/copy-from-event`, { sourceEventId: evM.id });
    c.eq(r.status, 400, 'E-1: mogul → dual refused (same discipline only)');
    r = await cApi.post(`/api/events/${evM.id}/judges/copy-from-event`, { sourceEventId: otherMeet.event.id });
    c.eq(r.status, 400, 'E-1: another meet\'s event refused');
    r = await cApi.post(`/api/events/${evM.id}/judges/copy-from-event`, { sourceEventId: evM.id });
    c.eq(r.status, 400, 'E-1: copying from itself refused');
    r = await cApi.post(`/api/events/${evM.id}/judges/copy-from-event`, {});
    c.eq(r.status, 400, 'E-1: missing sourceEventId → 400');

    // =====================================================================
    // T-6 — finalized flag (cloud, separate meet)
    // =====================================================================
    {
      const B = await buildMeet(cApi, { name: 'FinalizeMe', judges: ['TL1', 'TL2', 'TL3', 'Air1', 'Air2', 'HJ'], athletes: 1, startRun: false });
      const jB = Object.fromEntries(B.judges.map(j => [j.role, j]));
      await playMogulRun(cApi, B.event.id, jB, B.regs[0].id, 1, 0);
      r = await cApi.get(`/api/events/${B.event.id}/runs/active`);
      c.eq(r.data, null, 'T-6: no active run and not finalized → null');
      r = await cApi.post(`/api/events/${B.event.id}/finalize`, {});
      c.eq(r.status, 200, 'T-6: HJ finalizes the event');
      r = await cApi.get(`/api/events/${B.event.id}/runs/active`);
      c.deepEq(r.data, { event_completed: true, finalized: true }, 'T-6: /runs/active reports event_completed + finalized after Finalize (reloaded HJ tablet shows Event Completed)');
      const before = await cdb.queryOne('SELECT status, updated_at FROM events WHERE id=?', [B.event.id]);
      const auditBefore = await cdb.queryOne('SELECT COUNT(*) AS n FROM audit_log');
      r = await cApi.post(`/api/events/${B.event.id}/finalize`, {});
      c.eq(r.status, 200, 'T-6: a second Finalize is accepted');
      const after = await cdb.queryOne('SELECT status FROM events WHERE id=?', [B.event.id]);
      const auditAfter = await cdb.queryOne('SELECT COUNT(*) AS n FROM audit_log');
      c.ok(before.status === 'complete' && after.status === 'complete' && Number(auditAfter.n) === Number(auditBefore.n), 'T-6: second Finalize is idempotent (still complete, no audit row)');
    }

    // =====================================================================
    // Adoption
    // =====================================================================
    const rel = await cApi.must('POST', `/api/meets/${A.meet.id}/release-for-adoption`);
    await vApi.must('POST', '/api/venue/adopt', { code: rel.code, cloud_url: cloud.base });
    await vApi.must('POST', '/api/venue/pins', { control_pin: '4321', crew_pin: '1111' });
    const controlToken = (await vApi.must('POST', '/api/venue/verify-pin', { kind: 'control', pin: '4321' })).token;
    const vAuthed = new Api(venue.base, { token: controlToken });

    // =====================================================================
    // T-1 — before any run, the HJ follows the first-created event
    // =====================================================================
    r = await vApi.get('/api/venue/role-target?role=hj');
    c.eq(r.data.event_id, evM.id, 'T-1: before any run the Head Judge tablet follows the FIRST-created event (fallback guess)');

    // =====================================================================
    // T-4 — seats follow the active event's format
    // =====================================================================
    r = await vApi.get('/api/venue/seats');
    c.eq(r.data.seats.length, 5, 'T-4: 5-judge mogul event → 5 seats offered');
    c.deepEq(r.data.seats.map(s => s.role), ['TL1', 'TL2', 'TL3', 'Air1', 'Air2'], 'T-4: seat roles J1–J5 = TL1-3, Air1-2');
    c.eq(r.data.seat_count, 5, 'T-4: seat_count 5');
    c.ok(r.data.seats.every(s => s.in_event === true), 'T-4: every offered seat is in the event');
    await vAuthed.must('POST', `/api/events/${ev7.id}/runs`, { registration_id: reg7.id, run_number: 1 });
    r = await vApi.get('/api/venue/role-target?role=hj');
    c.eq(r.data.event_id, ev7.id, 'T-1: the first Start Run (from the Scoring Computer) moves the spotlight; every tablet follows');
    r = await vApi.get('/api/venue/seats');
    c.eq(r.data.seats.length, 7, 'T-4: 7-judge mogul event → 7 seats offered');
    c.deepEq(r.data.seats.map(s => s.role), ['TL1', 'TL2', 'TL3', 'TL4', 'TL5', 'Air1', 'Air2'], 'T-4: 7-judge seats J1–J5 = T&L, J6–J7 = Air');
    c.eq(r.data.seats[3].judge && r.data.seats[3].judge.name, 'Seven TL4', 'T-4: J4 maps to TL4 (previously unreachable)');
    r = await vApi.get('/api/venue/role-target?role=judge&seat=J6');
    c.ok(r.data.judge && r.data.judge.role === 'Air1', 'T-4: seat J6 auto-follows to Air 1 of the 7-judge event');
    r = await vApi.post('/api/venue/seats/claim', { seat: 'J7', device_label: 'iPad Seven' });
    c.eq(r.status, 200, 'T-4: J7 claimed while the 7-judge event is active');
    // Switch back to the 5-judge event: J7 is out of format but still claimed.
    await vAuthed.must('POST', `/api/events/${evM.id}/runs`, { registration_id: A.regs[0].id, run_number: 1 });
    r = await vApi.get('/api/venue/seats');
    c.eq(r.data.seats.filter(s => s.in_event).length, 5, 'T-4: back on the 5-judge event → 5 in-event seats');
    const j7 = r.data.seats.find(s => s.seat === 'J7');
    c.ok(j7 && j7.in_event === false && j7.claimed, 'T-4: the claimed J7 is still listed (in_event:false) so it can be force-released');
    c.ok(!r.data.seats.find(s => s.seat === 'J6'), 'T-4: unclaimed out-of-format J6 is omitted');
    r = await vApi.post('/api/venue/seats/force-release', { seat: 'J7', control_token: controlToken });
    c.eq(r.status, 200, 'T-4: out-of-format seat force-released');
    // Abandon the ev7 run so the fixture stays simple.
    const active7 = await vApi.must('GET', `/api/events/${ev7.id}/runs/active`);
    if (active7 && active7.id) await vAuthed.must('POST', `/api/events/${ev7.id}/runs/${active7.id}/abandon`, {});

    // =====================================================================
    // T-2 — a tablet can free its own seat (public)
    // =====================================================================
    await vApi.must('POST', '/api/venue/seats/claim', { seat: 'J2', device_label: 'iPad Two' });
    r = await vApi.post('/api/venue/seats/release', { seat: 'J2' });
    c.eq(r.status, 200, 'T-2: seat release needs no token (Leave seat on the tablet)');
    r = await vApi.get('/api/venue/seats');
    c.ok(!r.data.seats.find(s => s.seat === 'J2').claimed, 'T-2: J2 is free again');

    // =====================================================================
    // L-1 — DNS rows, scored run, restart, capture ordering
    // =====================================================================
    // Abandon the evM run started above, then play a real run + a DNS row.
    const activeM = await vApi.must('GET', `/api/events/${evM.id}/runs/active`);
    if (activeM && activeM.id) await vAuthed.must('POST', `/api/events/${evM.id}/runs/${activeM.id}/abandon`, {});
    await playMogulRun(vAuthed, evM.id, judgesM, A.regs[0].id, 1, 0);
    r = await vApi.post(`/api/events/${evM.id}/runs/status-only`, { registration_id: A.regs[1].id, run_number: 1, round: 'qualification', run_status: 'DNS' });
    c.ok(r.status === 200 || r.status === 201, `L-1: DNS row recorded on the venue (${r.status})`);
    c.ok(await waitDrained(vApi), 'L-1: outbox drained to the cloud before the restart');
    const venueNullBibs = await vdb.queryOne(`SELECT COUNT(*) AS n FROM athletes WHERE bib IS NULL`);
    c.ok(Number(venueNullBibs.n) >= 3, `L-1: adopted athletes arrive with NULL athletes.bib (${venueNullBibs.n}) — exactly the physical-test condition`);
    c.ok(await vdb.queryOne(`SELECT value FROM app_settings WHERE key='migration_v16_bib_done'`), 'L-1: bib migration marker set at the venue\'s first boot');

    // Restart 1: marker present → the bib backfill must NOT run, and DNS rows
    // must not be "backfilled".
    const logMark1 = venue.log.length;
    await venue.stop();
    await venue.start();
    const boot1 = venue.log.slice(logMark1).join('\n');
    c.ok(!/v1\.6 migration\] athletes\.bib backfilled/.test(boot1), 'L-1: with the marker set, the bib backfill does not reopen on a re-populated venue table');
    c.ok(!/air_score_no_dd backfill\] backfilled/.test(boot1), 'L-1: DNS/DNF rows are no longer "backfilled" (NULL over NULL) on boot');
    c.eq(Number((await vdb.queryOne(`SELECT COUNT(*) AS n FROM sync_outbox`)).n), 0, 'L-1: boot produced no outbox rows');

    // Restart 2: force the migration to run (marker removed) on the adopted
    // rows — its writes must be captured and reach the cloud.
    await vdb.execute(`DELETE FROM app_settings WHERE key='migration_v16_bib_done'`);
    const logMark2 = venue.log.length;
    await venue.stop();
    await venue.start();
    const boot2 = venue.log.slice(logMark2).join('\n');
    c.ok(/v1\.6 migration\] athletes\.bib backfilled for \d+ athletes/.test(boot2), 'L-1: forced bib backfill ran on the adopted athletes');
    c.ok(!/air_score_no_dd backfill\] backfilled/.test(boot2), 'L-1: still no air_score_no_dd backfill of statused rows');
    c.ok(await waitDrained(vApi), 'L-1: post-boot outbox drained');
    const cloudBib = await cdb.queryOne('SELECT bib FROM athletes WHERE id=?', [A.athletes[0].id]);
    c.eq(Number(cloudBib.bib), Number(A.regs[0].bib_number), 'L-1: the boot-time write was CAPTURED and reached the cloud (capture installed before initSchema)');
    c.ok(await vdb.queryOne(`SELECT value FROM app_settings WHERE key='migration_v16_bib_done'`), 'L-1: marker re-set after the migration');
    const logMark3 = venue.log.length;
    await venue.stop();
    await venue.start();
    c.ok(!/v1\.6 migration\] athletes\.bib backfilled/.test(venue.log.slice(logMark3).join('\n')), 'L-1: third boot — one-time migration stays closed');

    // =====================================================================
    // L-3 — journal lines
    // =====================================================================
    c.ok(await waitFor(() => venue.log.some(l => /\[snapshot\] written stickit_snapshot_/.test(l)), { timeout: 8000 }), 'L-3: snapshot worker logs each written snapshot');
    await cloud.stop();
    const logMark4 = venue.log.length;
    await vApi.must('POST', `/api/events/${evM.id}/runs/status-only`, { registration_id: A.regs[2].id, run_number: 1, round: 'qualification', run_status: 'DNF' });
    c.ok(await waitFor(() => venue.log.slice(logMark4).some(l => /\[sync worker\] cloud unreachable/.test(l)), { timeout: 15000 }), 'L-3: going offline is logged once');
    await sleep(2500);
    c.eq(venue.log.slice(logMark4).filter(l => /cloud unreachable/.test(l)).length, 1, 'L-3: repeated retries while offline do not repeat the line');
    await cloud.start();
    c.ok(await waitFor(() => venue.log.slice(logMark4).some(l => /\[sync worker\] cloud reachable again — pushed \d+ change/.test(l)), { timeout: 40000 }), 'L-3: coming back online is logged with the pushed count');
    c.ok(await waitFor(() => venue.log.slice(logMark4).some(l => /\[sync worker\] queue drained/.test(l)), { timeout: 40000 }), 'L-3: drained is logged');
    c.ok(await waitDrained(vApi, 30000), 'L-3: cloud caught up after the outage');
    venueBad = new Instance({ name: 'v240-venue-badsnap', port: 3183, mode: 'venue', env: { STICKIT_SNAPSHOT_DIR: '/nonexistent/stickit-snap', STICKIT_SNAPSHOT_INTERVAL_MS: '500' } });
    await venueBad.start();
    await sleep(2200);
    c.eq(venueBad.log.filter(l => /\[snapshot\] FAILED/.test(l)).length, 1, 'L-3: a missing snapshot stick is logged once, not every interval');
    await venueBad.stop();
    venueBad = null;

    // =====================================================================
    // E-1 on the venue — copied judges ride the sync
    // =====================================================================
    // A fresh 5-judge event created on the venue, staffed by copying evM.
    const evV = await vAuthed.must('POST', `/api/meets/${A.meet.id}/events`, {
      discipline: 'mogul', division: 'comp_series', gender: 'M', name: 'PostTest Venue-created',
    });
    r = await vApi.post(`/api/events/${evV.id}/judges/copy-from-event`, { sourceEventId: evM.id });
    c.eq(r.status, 401, 'E-1 venue: copy judges needs the Control token (officials mutation)');
    r = await vAuthed.post(`/api/events/${evV.id}/judges/copy-from-event`, { sourceEventId: evM.id });
    c.eq(r.status, 200, 'E-1 venue: copy with the Control token succeeds');
    c.eq(r.data.copied, 6, 'E-1 venue: 6 judges copied');
    c.ok(await waitDrained(vApi), 'E-1 venue: outbox drained');
    const cloudCopied = await cdb.queryAll('SELECT role, name, short_code FROM judges WHERE event_id=? ORDER BY role', [evV.id]);
    c.eq(cloudCopied.length, 6, 'E-1 venue: the copied judges arrived on the cloud through the sync');
    const venueCopied = await vdb.queryAll('SELECT role, name, short_code FROM judges WHERE event_id=? ORDER BY role', [evV.id]);
    c.deepEq(cloudCopied, venueCopied, 'E-1 venue: cloud rows byte-equal to the venue rows (ids/short codes preserved)');

    // =====================================================================
    // Duals prepared for the discipline-switch walkthrough
    // =====================================================================
    await vAuthed.must('POST', `/api/events/${evD.id}/dual/seed-random`, {});
    await vAuthed.must('POST', `/api/events/${evD.id}/dual/seed-fis`, {});
    const bracket = await vApi.must('GET', `/api/events/${evD.id}/dual`);
    const matches = bracket.matches || bracket;
    const firstMatch = matches.find(m => m.registration_id_blue && m.registration_id_red && !m.is_bye);
    c.ok(!!firstMatch, 'duals: a playable first match exists');
    // Put a singles event (evF, 5-judge, staffed by the E-1 copy) in the spotlight first.
    await vAuthed.must('POST', `/api/events/${evF.id}/runs`, { registration_id: regF.id, run_number: 1 });
    r = await vApi.get('/api/venue/role-target?role=judge&seat=J3');
    c.ok(r.data.discipline === 'mogul' && r.data.judge && r.data.judge.role === 'TL3', 'switch: seat J3 is T&L 3 while singles run');

    // =====================================================================
    // Playwright layer
    // =====================================================================
    // --- Judge tablet: bar, amber switch notice, Leave seat, Change role ---
    {
      const tab = await newTablet();
      const page = await tab.newPage();
      const dialogs = [];
      page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
      await page.goto(venue.base + '/?menu=1', { waitUntil: 'domcontentloaded' });
      await page.locator('text=🎿 Judge').click();
      await page.waitForSelector('[data-testid="venue-pin"]');
      await page.fill('[data-testid="venue-pin"]', '1111');
      await page.locator('button:has-text("OK")').click();
      await page.waitForSelector('text=Pick Your Judge Seat');
      c.ok(await page.locator('text=5 seats').count() > 0, 'T-4 UI: picker says how many seats the active event uses');
      c.eq(await page.locator('button:has-text("Take")').count(), 5, 'T-4 UI: exactly 5 Take buttons on a 5-judge event');
      c.ok(await page.locator('text=T&L 3').count() > 0, 'T-4 UI: seat role shown beside the seat number');
      // Take J3 (third card)
      await page.locator('button:has-text("Take")').nth(2).click();
      await page.waitForURL('**/venue/role/judge?seat=J3');
      const bar = page.locator('[data-testid="venue-role-bar"]');
      await bar.waitFor({ timeout: 10000 });
      // The bar renders before the first role-target poll answers — wait for it.
      const waitBar = (re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('[data-testid="venue-role-bar"]')?.innerText || ''), re.source, { timeout: 12000 }).then(() => true).catch(() => false);
      await waitBar(/PostTest F 5-judge/);
      let barText = await bar.innerText();
      c.ok(/Judge J3/.test(barText) && /Judge TL3/.test(barText) && /T&L 3/.test(barText) && /PostTest F 5-judge/.test(barText), `T-2 UI: role bar names seat, judge, role and event (${barText.replace(/\s+/g, ' ')})`);
      c.ok(await page.locator('iframe').count() === 1, 'T-2 UI: the judge page is embedded below the bar');
      const iframeBox = await page.locator('iframe').boundingBox();
      const barBox = await bar.boundingBox();
      c.ok(iframeBox && barBox && iframeBox.y >= barBox.y + barBox.height - 1, 'T-2 UI: the bar sits above the embedded page — nothing is covered');
      c.ok(await page.locator('button:has-text("Leave seat")').isVisible() && await page.locator('button:has-text("Change role")').isVisible(), 'T-2 UI: Leave seat + Change role buttons visible');

      // Singles → duals: start the first dual match; the bar turns amber.
      await vApi.must('PUT', `/api/events/${evD.id}/dual/active-match`, { match_id: firstMatch.id });
      await page.waitForSelector('text=Now following', { timeout: 12000 });
      barText = await bar.innerText();
      c.ok(/Dual Moguls/.test(barText) && /Air Judge in seat J3/.test(barText), `switch UI: amber notice says what this seat means in duals (${barText.replace(/\s+/g, ' ')})`);
      const barBg = await bar.evaluate(el => getComputedStyle(el).backgroundColor);
      c.ok(/251, 191, 36|245, 158, 11|amber/.test(barBg) || !/15, 23, 42/.test(barBg), `switch UI: bar is amber (${barBg})`);

      // Leave seat → seat freed, picker with dual roles.
      await page.locator('button:has-text("Leave seat")').click();
      await page.waitForURL('**/?menu=1&pick=judge', { timeout: 10000 });
      await page.waitForSelector('text=Pick Your Judge Seat', { timeout: 10000 });
      c.ok(dialogs.some(m => /Leave seat J3/.test(m)), 'T-2 UI: Leave seat asked for confirmation');
      r = await vApi.get('/api/venue/seats');
      c.ok(!r.data.seats.find(s => s.seat === 'J3').claimed, 'T-2 UI: J3 released on the server');
      c.ok(await page.locator('text=Turns Judge 1').count() > 0 && await page.locator('text=Air Judge').count() > 0, 'switch UI: picker now shows the DUAL roles for each seat');
      c.eq(await page.locator('button:has-text("Take")').count(), 5, 'switch UI: 5 dual seats offered');
      const mem1 = await page.evaluate(() => localStorage.getItem('stickit_venue_role'));
      c.eq(mem1, null, 'T-2 UI: role memory cleared by Leave seat');
      await page.locator('button:has-text("Take")').first().click();
      await page.waitForURL('**/venue/role/judge?seat=J1');
      await bar.waitFor({ timeout: 10000 });
      await waitBar(/Turns Judge 1/);
      barText = await bar.innerText();
      c.ok(/Judge J1/.test(barText) && /Turns Judge 1/.test(barText), `switch UI: re-seated as J1 = Turns Judge 1 in duals (${barText.replace(/\s+/g, ' ')})`);

      // Change role → menu, memory cleared, seat freed.
      await page.locator('button:has-text("Change role")').click();
      await page.waitForURL('**/?menu=1', { timeout: 10000 });
      await page.waitForSelector('text=Scoring Computer', { timeout: 10000 });
      c.ok(dialogs.some(m => /Change this tablet's role/.test(m)), 'T-2 UI: Change role asked for confirmation');
      c.eq(await page.evaluate(() => localStorage.getItem('stickit_venue_role')), null, 'T-2 UI: role memory cleared by Change role');
      r = await vApi.get('/api/venue/seats');
      c.ok(!r.data.seats.find(s => s.seat === 'J1').claimed, 'T-2 UI: J1 released on the server by Change role');
      c.eq(await page.locator('text=This device is set up as').count(), 0, 'T-7 UI: no remembered-role strip after Change role');
      await tab.close();
    }

    // --- Head Judge tablet: bar without Leave seat; reload returns (FR-15) ---
    {
      const tab = await newTablet();
      let page = await tab.newPage();
      page.on('dialog', d => d.accept());
      await page.goto(venue.base + '/?menu=1', { waitUntil: 'domcontentloaded' });
      await page.locator('text=Head Judge').first().click();
      await page.waitForSelector('[data-testid="venue-pin"]');
      await page.fill('[data-testid="venue-pin"]', '4321');
      await page.locator('button:has-text("OK")').click();
      await page.waitForURL('**/venue/role/hj', { timeout: 10000 });
      const bar = page.locator('[data-testid="venue-role-bar"]');
      await bar.waitFor({ timeout: 10000 });
      await page.waitForFunction(() => /PostTest Duals/.test(document.querySelector('[data-testid="venue-role-bar"]')?.innerText || ''), null, { timeout: 12000 }).catch(() => {});
      const t = await bar.innerText();
      c.ok(/Head Judge/.test(t) && /PostTest Duals/.test(t), `T-2 UI: HJ bar names the role and followed event (${t.replace(/\s+/g, ' ')})`);
      c.eq(await page.locator('button:has-text("Leave seat")').count(), 0, 'T-2 UI: HJ bar has no Leave seat');
      c.eq(await page.locator('button:has-text("Change role")').count(), 1, 'T-2 UI: HJ bar has Change role');
      await page.close();
      page = await tab.newPage();
      await page.goto(venue.base + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForURL('**/venue/role/hj', { timeout: 10000 });
      c.ok(true, 'FR-15: a reloaded HJ tablet still returns to Head Judge — only Change role changes it');
      await tab.close();
    }

    // --- Scoreboard: no bar, corner button only ---
    {
      const tab = await newTablet();
      const page = await tab.newPage();
      await page.goto(venue.base + '/?menu=1', { waitUntil: 'domcontentloaded' });
      await page.locator('text=Scoreboard').click();
      await page.waitForURL('**/venue/role/scoreboard');
      await page.waitForSelector('iframe');
      c.eq(await page.locator('[data-testid="venue-role-bar"]').count(), 0, 'T-2 UI: scoreboard (TV) has no role bar');
      c.eq(await page.locator('button:has-text("Change role")').count(), 1, 'T-2 UI: scoreboard has the corner Change role button');
      await tab.close();
    }

    // --- Scoring Computer: Venue Menu link, remembered strip, back, reload ---
    {
      const tab = await newTablet();
      let page = await tab.newPage();
      await page.goto(venue.base + '/?menu=1', { waitUntil: 'domcontentloaded' });
      await page.locator('text=Scoring Computer').click();
      await page.waitForSelector('[data-testid="venue-pin"]');
      await page.fill('[data-testid="venue-pin"]', '4321');
      await page.locator('button:has-text("OK")').click();
      await page.waitForURL('**/dashboard', { timeout: 10000 });
      const link = page.locator('a:has-text("Venue Menu")');
      await link.waitFor({ timeout: 10000 });
      c.ok(true, 'T-7 UI: officials sidebar shows "Venue Menu" on the venue server');
      await link.click();
      await page.waitForURL('**/?menu=1', { timeout: 10000 });
      await page.waitForSelector('text=This device is set up as', { timeout: 10000 });
      c.ok(await page.locator('text=Scoring Computer').first().isVisible(), 'T-7 UI: venue menu reached with the remembered-role strip');
      c.ok(await page.locator('text=Hand Back to Cloud').isVisible() && await page.locator('text=Check In Meet').isVisible(), 'T-7 UI: end-of-day actions reachable from the Scoring Computer');
      await page.locator('button:has-text("Back to Scoring Computer")').click();
      await page.waitForURL('**/dashboard', { timeout: 10000 });
      c.ok(true, 'T-7 UI: Back to Scoring Computer returns to the console');
      await page.close();
      page = await tab.newPage();
      await page.goto(venue.base + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForURL('**/dashboard', { timeout: 10000 });
      c.ok(true, 'FR-15/M-15: a reloaded Scoring Computer still returns to the console (memory kept)');

      // --- T-5: meet page More menu on the venue ---
      await page.goto(`${venue.base}/dashboard/meets/${A.meet.id}`, { waitUntil: 'domcontentloaded' });
      const more = page.locator('button:has-text("More")');
      await more.waitFor({ timeout: 15000 });
      await more.click();
      await page.waitForSelector('text=Venue Menu (end of day)', { timeout: 10000 });
      c.eq(await page.locator('button:has-text("Release for Adoption")').count(), 0, 'T-5 UI: Release for Adoption hidden on the venue');
      c.eq(await page.locator('button:has-text("Clone Meet")').count(), 0, 'T-5 UI: Clone Meet hidden on the venue');
      c.eq(await page.locator('button:has-text("Export Meet")').count(), 1, 'T-5 UI: Export Meet (USB recovery) still offered');
      await page.locator('button:has-text("Venue Menu (end of day)")').click();
      await page.waitForURL('**/?menu=1', { timeout: 10000 });
      c.ok(true, 'T-5 UI: "Venue Menu (end of day)" leads to the venue menu');
      await tab.close();
    }

    // --- Cloud meet page unchanged ---
    {
      const tab = await newTablet();
      const page = await tab.newPage();
      await page.goto(`${cloud.base}/dashboard/meets/${otherMeet.meet.id}`, { waitUntil: 'domcontentloaded' });
      const more = page.locator('button:has-text("More")');
      await more.waitFor({ timeout: 15000 });
      await more.click();
      await page.waitForSelector('button:has-text("Release for Adoption")', { timeout: 10000 });
      c.eq(await page.locator('button:has-text("Venue Menu")').count(), 0, 'T-5 UI: cloud meet page has no Venue Menu item');
      c.eq(await page.locator('button:has-text("Clone Meet")').count(), 1, 'T-5 UI: cloud meet page keeps Clone Meet');
      c.eq(await page.locator('a:has-text("Venue Menu")').count(), 0, 'T-7 UI: cloud sidebar keeps "Home" (no Venue Menu)');
      await tab.close();
    }

    cdb.close();
    vdb.close();
  } finally {
    await shutdownBrowser().catch(() => {});
    if (venueBad) await venueBad.stop().catch(() => {});
    await venue.stop().catch(() => {});
    await cloud.stop().catch(() => {});
  }

  return c;
}

module.exports = { main };
