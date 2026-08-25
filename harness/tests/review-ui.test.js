/**
 * Review-fix Playwright regression tests (client-side findings the HTTP-only
 * suites missed — StickIt_v2_Review_Findings_08-23-26.md).
 *
 *   H-9: day-2 re-adoption through the REAL venue UI — the replace-offer
 *        confirm dialog must appear and complete the adoption. (The server
 *        returned the right shape all along; the client regex could never
 *        match the thrown machine code.)
 *
 * Runs against the committed build in server/public — rebuild the client
 * before running when client source changed.
 */

const { Checks } = require('../lib/checks');
const { Instance } = require('../lib/instance');
const { Api } = require('../lib/client');
const { seedMogulJudges, playMogulRun } = require('../lib/driver');
const { newTablet, shutdownBrowser } = require('../lib/browser');

async function main() {
  const c = new Checks('review-ui');
  const cloud = new Instance({ name: 'reviewui-cloud', port: 3195, mode: 'cloud' });
  // The UI adopt flow cannot pass cloud_url — point the venue's default cloud
  // at the scratch cloud instance.
  const venue = new Instance({
    name: 'reviewui-venue', port: 3196, mode: 'venue',
    env: { STICKIT_CLOUD_URL: 'http://127.0.0.1:3195' },
  });

  try {
    await cloud.start();
    await venue.start();
    const cApi = new Api(cloud.base);
    const vApi = new Api(venue.base);

    // ---- Day 1 on the wire: build, adopt, score, hand back ---------------
    const meet = await cApi.must('POST', '/api/meets', { name: 'UI Two Day', location: 'Review Bowl', date: '2026-08-23', meet_ranking: 'C' });
    const ev = await cApi.must('POST', `/api/meets/${meet.id}/events`, { discipline: 'mogul', division: 'comp_series', gender: 'M', name: 'UI M' });
    const judges = await seedMogulJudges(cApi, ev.id);
    const ath = await cApi.must('POST', '/api/athletes', { first_name: 'Ui', last_name: 'Racer', gender: 'M', birth_year: 2008, ussa_num: '8891001' });
    const reg = await cApi.must('POST', `/api/events/${ev.id}/registrations`, { athlete_id: ath.id, bib_number: 1 });
    let rel = await cApi.must('POST', `/api/meets/${meet.id}/release-for-adoption`);
    await vApi.must('POST', '/api/venue/adopt', { code: rel.code, cloud_url: cloud.base });
    await playMogulRun(vApi, ev.id, judges, reg.id, 1, 0);
    await vApi.must('POST', '/api/venue/checkin', { mode: 'handback' });

    // ---- Day 2 through the real UI (H-9) ---------------------------------
    rel = await cApi.must('POST', `/api/meets/${meet.id}/release-for-adoption`);
    const tab = await newTablet();
    const page = await tab.newPage();
    let sawReplaceDialog = false;
    page.on('dialog', async (d) => {
      if (/Replace the local copy/i.test(d.message())) {
        sawReplaceDialog = true;
        await d.accept();
      } else {
        await d.accept();
      }
    });
    await page.goto(venue.base + '/?menu=1', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('input[placeholder="RELEASE CODE"]', { timeout: 15000 });
    await page.fill('input[placeholder="RELEASE CODE"]', rel.code);
    await page.getByRole('button', { name: 'Adopt', exact: true }).click({ timeout: 5000 });
    // The replace-confirm fires, the retry with replace:true runs, and the
    // home screen flips to State 2 (role tiles).
    await page.waitForSelector('text=Scoring Computer', { timeout: 20000 });
    c.ok(sawReplaceDialog, 'H-9: the replace-offer confirm dialog appeared (day-2 re-adoption reachable from the UI)');
    const vs = await vApi.must('GET', '/api/venue/status');
    c.eq(vs.meet_state, 'adopted', 'H-9: UI re-adoption completed — meet adopted');
    c.eq(vs.adopted_meet && vs.adopted_meet.id, meet.id, 'H-9: the adopted meet is the day-1 meet');
    await page.close();

    // ---- M-15: Scoring Computer reboot-return --------------------------
    // A device remembered as role 'dashboard' must land on /dashboard after a
    // reboot, not on /venue/role/dashboard (bad_role → permanent "Waiting...").
    {
      const p2 = await tab.newPage();
      await p2.goto(venue.base + '/?menu=1', { waitUntil: 'domcontentloaded' });
      await p2.evaluate(() => localStorage.setItem('stickit_venue_role', JSON.stringify({ role: 'dashboard' })));
      await p2.close();
      const p3 = await tab.newPage();
      await p3.goto(venue.base + '/', { waitUntil: 'domcontentloaded' });
      await p3.waitForURL('**/dashboard', { timeout: 15000 });
      c.ok(true, 'M-15: Scoring Computer reboot-return lands on /dashboard');
      await p3.evaluate(() => localStorage.removeItem('stickit_venue_role'));
      await p3.close();
    }

    // ---- M-13: root gate resilience ------------------------------------
    // (a) A failed/hung /api/venue/status must not blank the app: with the
    // status endpoint aborted, the page must still paint (cloud fallback).
    {
      const t2 = await newTablet();
      const p4 = await t2.newPage();
      let failing = true;
      await p4.route('**/api/venue/status', (route) => {
        if (failing) return route.abort();
        return route.continue();
      });
      await p4.goto(venue.base + '/?menu=1', { waitUntil: 'domcontentloaded' });
      await p4.waitForFunction(() => document.body.innerText.trim().length > 0, { timeout: 8000 });
      c.ok(true, 'M-13: app paints despite a failing /api/venue/status (no blank page)');
      // (b) When the endpoint recovers, the venue routes register WITHOUT a
      // manual reload (the failure was not cached for the session).
      failing = false;
      await p4.waitForSelector('text=STICKIT', { timeout: 20000 });
      const isVenueHome = await p4.waitForFunction(
        () => /VENUE/i.test(document.body.innerText), { timeout: 20000 }
      ).then(() => true).catch(() => false);
      c.ok(isVenueHome, 'M-13: venue home appears after the status endpoint recovers (no manual reload)');
      await p4.close();
      await t2.close();
    }

    await tab.close();
  } finally {
    await shutdownBrowser().catch(() => {});
    await cloud.stop().catch(() => {});
    await venue.stop().catch(() => {});
  }

  return c;
}

module.exports = { main };
