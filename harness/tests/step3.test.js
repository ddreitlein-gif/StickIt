/**
 * Step 3 acceptance tests — venue mode + home screen.
 *
 * HTTP layer: PIN set/verify/change (R3), venue auth middleware (FR-14:
 * Control token gates officials mutations; tablet endpoints stay public),
 * FR-16 judge-pin bypass, seat registry claim/conflict/force-release (R1),
 * role targets + auto-follow across interleaved events (FR-15), overlay pin
 * override (R4), connection info (D3).
 *
 * Playwright layer (FR-21): home screen states, PIN tiles, seat picker,
 * device role memory (reboot-return), FR-14 end-to-end from the browser,
 * self-hosted fonts (no external requests), cloud root unaffected.
 */

const path = require('path');
const { Checks } = require('../lib/checks');
const { Instance } = require('../lib/instance');
const { Api } = require('../lib/client');
const { openDb } = require('../lib/db');
const { buildMeet } = require('../lib/fixtures');
const { newTablet, shutdownBrowser } = require('../lib/browser');

async function main() {
  const c = new Checks('step3');
  const cloud = new Instance({ name: 'step3-cloud', port: 3131, mode: 'cloud' });
  const venue = new Instance({ name: 'step3-venue', port: 3132, mode: 'venue' });

  try {
    await cloud.start();
    await venue.start();
    const cApi = new Api(cloud.base);
    const vApi = new Api(venue.base);

    // ---- Fixture: interleaved meet — M + F mogul events ------------------
    const A = await buildMeet(cApi, { name: 'Venue Day', gender: 'M', judges: ['TL1', 'TL2', 'TL3', 'Air1', 'Air2', 'HJ'], athletes: 2, startRun: false });
    const evF = await cApi.must('POST', `/api/meets/${A.meet.id}/events`, {
      discipline: 'mogul', division: 'comp_series', gender: 'F', name: 'Venue Day F mogul',
    });
    const judgesF = [];
    for (const role of ['TL1', 'TL2', 'TL3', 'Air1', 'Air2', 'HJ']) {
      judgesF.push(await cApi.must('POST', `/api/events/${evF.id}/judges`, { name: `F ${role}`, role }));
    }
    const athF = await cApi.must('POST', '/api/athletes', { first_name: 'Fem', last_name: 'Racer', gender: 'F', birth_year: 2009, ussa_num: '7300001' });
    const regF = await cApi.must('POST', `/api/events/${evF.id}/registrations`, { athlete_id: athF.id, bib_number: 51 });

    const rel = await cApi.must('POST', `/api/meets/${A.meet.id}/release-for-adoption`);
    await vApi.must('POST', '/api/venue/adopt', { code: rel.code, cloud_url: cloud.base });

    // ---- PINs (R3) -------------------------------------------------------
    let r = await vApi.get('/api/venue/pins/status');
    c.deepEq(r.data, { control_set: false, crew_set: false }, 'PINs unset after adoption');
    r = await vApi.post('/api/venue/pins', { control_pin: '12', crew_pin: '3456' });
    c.eq(r.status, 400, 'non-4-digit PIN rejected');
    r = await vApi.post('/api/venue/pins', { control_pin: '4321', crew_pin: '1111' });
    c.eq(r.status, 200, 'PINs set');
    r = await vApi.post('/api/venue/verify-pin', { kind: 'control', pin: '9999' });
    c.eq(r.status, 403, 'wrong Control PIN refused');
    r = await vApi.post('/api/venue/verify-pin', { kind: 'control', pin: '4321' });
    c.eq(r.status, 200, 'Control PIN verifies');
    const controlToken = r.data.token;
    c.ok(!!controlToken, 'Control session token issued');
    r = await vApi.post('/api/venue/verify-pin', { kind: 'crew', pin: '1111' });
    c.ok(r.status === 200 && r.data.ok && !r.data.token, 'Crew PIN verifies (no token — page gate only)');
    r = await vApi.post('/api/venue/pins', { control_pin: '5555', crew_pin: '6666' });
    c.eq(r.status, 403, 'changing PINs without the current Control token refused');

    // ---- FR-14: Control token gates officials mutations ------------------
    r = await vApi.put(`/api/meets/${A.meet.id}`, { location: 'No Token' });
    c.eq(r.status, 401, 'officials mutation without Control token is 401 (venue auth)');
    const vAuthed = new Api(venue.base, { token: controlToken });
    r = await vAuthed.put(`/api/meets/${A.meet.id}`, { location: 'Venue Located' });
    c.eq(r.status, 200, 'officials mutation WITH Control token succeeds (FR-14)');

    // Tablet endpoints stay public (V6): score submit with no token.
    const runM = await vAuthed.must('POST', `/api/events/${A.event.id}/runs`, { registration_id: A.regs[0].id, run_number: 1 });
    r = await vApi.post(`/api/events/${A.event.id}/runs/${runM.id}/scores`, {
      judge_id: A.judges[0].id, score_type: 'turns', raw_score: 12.5,
    });
    c.eq(r.status, 200, 'judge tablet score submit needs no token (public, V6 policy)');

    // ---- FR-16: judges.pin ignored in venue mode -------------------------
    const vdb = openDb(venue.dbPath);
    await vdb.execute(`UPDATE judges SET pin='7777' WHERE id=?`, [A.judges[1].id]);
    r = await vApi.post(`/api/events/${A.event.id}/runs/${runM.id}/scores`, {
      judge_id: A.judges[1].id, score_type: 'turns', raw_score: 13.0,
    });
    c.eq(r.status, 200, 'per-judge pin bypassed in venue mode (FR-16)');

    // ---- Seats (R1) ------------------------------------------------------
    r = await vApi.get('/api/venue/seats');
    // v2.4.00 (T-4): only the seats the active event's format uses (5-judge mogul → J1–J5).
    c.eq(r.data.seats.length, 5, 'seat registry lists only the 5 seats a 5-judge mogul event uses (T-4)');
    c.eq(r.data.seat_count, 5, 'seat_count reported for the active event format');
    c.ok(r.data.seats[0].judge && r.data.seats[0].judge.role === 'TL1', `seat J1 maps to TL1 of the active event (got ${JSON.stringify(r.data.seats[0].judge)})`);
    r = await vApi.post('/api/venue/seats/claim', { seat: 'J1', device_label: 'iPad Alpha' });
    c.eq(r.status, 200, 'seat J1 claimed');
    r = await vApi.post('/api/venue/seats/claim', { seat: 'J1', device_label: 'iPad Beta' });
    c.eq(r.status, 409, 'taken seat refuses a second claim');
    r = await vApi.post('/api/venue/seats/force-release', { seat: 'J1' });
    c.eq(r.status, 403, 'force-release without Control token refused');
    r = await vApi.post('/api/venue/seats/force-release', { seat: 'J1', control_token: controlToken });
    c.eq(r.status, 200, 'force-release with Control token works');
    r = await vApi.post('/api/venue/seats/claim', { seat: 'J1', device_label: 'iPad Beta' });
    c.eq(r.status, 200, 'seat re-claimable after force-release');

    // ---- FR-15: role targets + auto-follow -------------------------------
    r = await vApi.get('/api/venue/role-target?role=judge&seat=J1');
    c.ok(r.data.url && r.data.url.startsWith('/judge/'), `judge seat target url (${r.data.url})`);
    c.eq(r.data.event_id, A.event.id, 'judge target follows the M event (its run just started)');
    r = await vApi.get('/api/venue/role-target?role=hj');
    c.ok(/^\/headjudge\//.test(r.data.url), `hj target url (${r.data.url})`);
    r = await vApi.get('/api/venue/role-target?role=timekeeper');
    c.ok(/^\/timekeeper\//.test(r.data.url), 'timekeeper target url');
    r = await vApi.get('/api/venue/role-target?role=scoreboard');
    c.ok(/^\/scoreboard\//.test(r.data.url), 'scoreboard target url');

    // Interleave: start a run in the F event → every role follows it.
    await vAuthed.must('POST', `/api/events/${evF.id}/runs`, { registration_id: regF.id, run_number: 1 });
    r = await vApi.get('/api/venue/role-target?role=judge&seat=J1');
    c.eq(r.data.event_id, evF.id, 'judge seat auto-follows to the F event after its run starts (FR-15)');
    c.ok(r.data.url.includes('?judge='), 'followed target carries the F event judge short code');
    r = await vApi.get('/api/venue/role-target?role=scoreboard');
    c.eq(r.data.event_id, evF.id, 'scoreboard auto-follows too');

    // ---- R4: overlay pin override ---------------------------------------
    r = await vApi.get('/api/venue/overlay-target');
    c.eq(r.data.event_id, evF.id, 'overlay follows the action by default');
    r = await vApi.post('/api/venue/overlay-pin', { event_id: A.event.id });
    c.eq(r.status, 403, 'overlay pin without Control token refused');
    r = await vAuthed.post('/api/venue/overlay-pin', { event_id: A.event.id });
    c.eq(r.status, 200, 'overlay pinned with Control token');
    r = await vApi.get('/api/venue/overlay-target');
    c.eq(r.data.event_id, A.event.id, 'overlay honors the pin');
    c.eq(r.data.pinned_event_id, A.event.id, 'pinned_event_id reported');
    r = await vApi.get('/api/venue/role-target?role=judge&seat=J1');
    c.eq(r.data.event_id, evF.id, 'judge seats keep auto-following while overlay is pinned');
    await vAuthed.post('/api/venue/overlay-pin', { event_id: null });
    r = await vApi.get('/api/venue/overlay-target');
    c.eq(r.data.event_id, evF.id, 'unpin returns overlay to auto-follow');

    // ---- Connection info (D3) -------------------------------------------
    r = await vApi.get('/api/venue/connection-info');
    c.ok(/^http:\/\/.+:\d+$/.test(r.data.numeric_url), `numeric url (${r.data.numeric_url})`);
    c.ok(r.data.overlay_url.endsWith('/overlay'), 'complete numeric overlay URL for the YoloBox');
    c.ok(r.data.mdns_url.includes('stickit.local'), 'mDNS URL advertised');

    // ---- Cloud unaffected ------------------------------------------------
    r = await cApi.get('/api/venue/status');
    c.eq(r.data.mode, 'cloud', 'cloud instance still reports cloud mode');
    r = await cApi.post('/api/venue/adopt', { code: 'X' });
    c.ok(r.status === 404 || r.status === 423, `venue endpoints not served in cloud mode (${r.status})`);
    r = await vApi.post('/api/sync/adopt', { code: 'X', protocol_version: 1 });
    c.ok(r.status === 404 || r.status === 423, 'sync endpoints not served in venue mode');

    // =====================================================================
    // Playwright layer (FR-21)
    // =====================================================================
    const externalRequests = [];

    // Tablet 1: scoreboard (open tile) + font self-hosting check
    {
      const tab = await newTablet();
      const page = await tab.newPage();
      page.on('request', req => {
        const u = req.url();
        if (!u.startsWith(venue.base) && !u.startsWith('data:') && !u.startsWith('blob:')) externalRequests.push(u);
      });
      await page.goto(venue.base + '/?menu=1', { waitUntil: 'networkidle' });
      c.ok(await page.locator('text=VENUE').first().isVisible(), 'venue home renders the venue menu');
      c.ok(await page.locator('text=Venue Day').first().isVisible(), 'adopted meet name shown');
      await page.locator('text=Scoreboard').click();
      await page.waitForURL('**/venue/role/scoreboard');
      const iframeSrc = await page.locator('iframe').getAttribute('src');
      c.ok(iframeSrc && iframeSrc.startsWith('/scoreboard/'), `scoreboard tile opens without PIN, embeds ${iframeSrc}`);
      await tab.close();
    }
    c.deepEq(externalRequests.filter(u => /fonts\.(googleapis|gstatic)\.com/.test(u)), [], 'NO Google Fonts requests — fonts self-hosted (FR-18)');
    c.deepEq(externalRequests, [], 'venue pages make ZERO external-origin requests (fully offline-capable)');

    // Tablet 2: crew PIN gate + seat picker + reboot-return role memory
    {
      const tab = await newTablet();
      let page = await tab.newPage();
      await page.goto(venue.base + '/?menu=1', { waitUntil: 'domcontentloaded' });
      await page.locator('text=🎿 Judge').click();
      await page.waitForSelector('[data-testid="venue-pin"]');
      await page.fill('[data-testid="venue-pin"]', '9999');
      await page.locator('button:has-text("OK")').click();
      await page.waitForSelector('text=Wrong PIN');
      c.ok(true, 'wrong Crew PIN shows an error');
      await page.fill('[data-testid="venue-pin"]', '1111');
      await page.locator('button:has-text("OK")').click();
      await page.waitForSelector('text=Pick Your Judge Seat');
      c.ok(true, 'right Crew PIN opens the seat picker');
      // J2 should be free — take it
      const j2card = page.locator('div', { hasText: /^J2/ }).locator('button:has-text("Take")').first();
      await page.locator('button:has-text("Take")').first().click(); // first free seat (J2 — J1 taken above)
      await page.waitForURL('**/venue/role/judge?seat=*');
      const url1 = page.url();
      c.ok(/seat=J\d/.test(url1), `seat claimed via UI → ${url1}`);
      await page.waitForSelector('iframe');
      const src = await page.locator('iframe').getAttribute('src');
      c.ok(src.startsWith('/judge/'), `judge iframe embedded (${src})`);
      // "Reboot": close the page, open a new one in the same context (same
      // localStorage), go to the root — must return straight to the role page.
      await page.close();
      page = await tab.newPage();
      await page.goto(venue.base + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForURL('**/venue/role/judge?seat=*', { timeout: 10000 });
      c.ok(true, 'rebooted tablet returns straight to its judge seat (device role memory)');
      await tab.close();
    }

    // Tablet 3: Control PIN → Scoring Computer → FR-14 mutation from browser
    {
      const tab = await newTablet();
      const page = await tab.newPage();
      await page.goto(venue.base + '/?menu=1', { waitUntil: 'domcontentloaded' });
      await page.locator('text=Scoring Computer').click();
      await page.waitForSelector('[data-testid="venue-pin"]');
      await page.fill('[data-testid="venue-pin"]', '4321');
      await page.locator('button:has-text("OK")').click();
      await page.waitForURL('**/dashboard', { timeout: 10000 });
      c.ok(true, 'Control PIN opens the Scoring Computer (full Officials console)');
      const tok = await page.evaluate(() => localStorage.getItem('stickit_auth_token'));
      c.ok(!!tok, 'Control session token stored under stickit_auth_token (FR-14)');
      const putStatus = await page.evaluate(async (meetId) => {
        const r = await fetch(`/api/meets/${meetId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('stickit_auth_token')}` },
          body: JSON.stringify({ location: 'Browser Mutation' }),
        });
        return r.status;
      }, A.meet.id);
      c.eq(putStatus, 200, 'officials mutation end-to-end through the Control PIN gate (FR-14)');
      await tab.close();
    }

    // Cloud root unaffected
    {
      const tab = await newTablet();
      const page = await tab.newPage();
      await page.goto(cloud.base + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('text=LIVE SCORES', { timeout: 10000 }).catch(() => {});
      const hasVenueMenu = await page.locator('text=STICKIT VENUE').count();
      c.eq(hasVenueMenu, 0, 'cloud root shows the normal Home, not the venue menu');
      await tab.close();
    }

    vdb.close();
  } finally {
    await shutdownBrowser().catch(() => {});
    await cloud.stop().catch(() => {});
    await venue.stop().catch(() => {});
  }

  return c;
}

module.exports = { main };
