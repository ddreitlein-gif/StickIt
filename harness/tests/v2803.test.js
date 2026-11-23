/**
 * v2.8.03 — pre-season tablet changes (Release A of the 11-23-26 plan).
 *
 *   1. Dual judge tablet: the running Blue / Red totals are not shown.
 *   2. Head Judge tablet (moguls): T&L and Air lists in judge-number order.
 *   3. Dual judge tablet: select a split, then Confirm (two steps). Same
 *      request as before; a stale selection can never be confirmed.
 *   4. Time Judge only: static time differential reference card
 *      (FIS JH 6304.3.4).
 *   Layout: every dual control on screen without scrolling on an iPad Air 3
 *      in landscape (1112 wide; 720 visible under Safari's bars, 680 at the
 *      venue where the role bar sits above the page), normal and HC mode.
 *
 * Playwright against the committed build in server/public — rebuild the
 * client before running when client source changed.
 */

const { Checks } = require('../lib/checks');
const { Instance } = require('../lib/instance');
const { Api } = require('../lib/client');
const { buildMeet } = require('../lib/fixtures');
const { seedMogulJudges, seedDualJudges } = require('../lib/driver');
const { newTablet, shutdownBrowser } = require('../lib/browser');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const T = (id) => `[data-testid="${id}"]`;

const readyInOrder = (bracket) => bracket
  .filter(m => m.status === 'pending' && m.registration_id_blue && m.registration_id_red && !m.is_bye)
  .sort((a, b) => (a.pairing_number ?? 1e9) - (b.pairing_number ?? 1e9));

async function makeDual(api, name, settings) {
  const M = await buildMeet(api, { name, gender: 'F', discipline: 'dual_mogul', athletes: 8, judges: [], startRun: false });
  const judges = await seedDualJudges(api, M.event.id);
  if (settings) await api.must('PUT', `/api/meets/${M.meet.id}`, settings);
  await api.must('PUT', `/api/events/${M.event.id}/dual/runoff-option`, { runoff_option: 'runoff_to_4th' });
  await api.must('POST', `/api/events/${M.event.id}/dual/seed-random`, {});
  await api.must('POST', `/api/events/${M.event.id}/dual/seed-fis`, {});
  return { ...M, judges, ev: M.event.id };
}

async function main() {
  const c = new Checks('v2803');
  const inst = new Instance({ name: 'v2803-cloud', port: 3198, mode: 'cloud' });
  try {
    await inst.start();
    const api = new Api(inst.base);
    const tab = await newTablet();

    const startNext = async (ev) => {
      const next = readyInOrder(await api.must('GET', `/api/events/${ev}/dual`))[0];
      await api.must('PUT', `/api/events/${ev}/dual/active-match`, { match_id: next.id });
      return next;
    };
    const rowsOf = async (ev, matchId) => (await api.must('GET', `/api/events/${ev}/dual/${matchId}/judge-points`)).rows || [];
    const rowOf = async (ev, matchId, n) => (await rowsOf(ev, matchId)).find(r => r.judge_number === n) || null;
    const post = (ev, matchId, n, b, r, extra = {}) =>
      api.must('POST', `/api/events/${ev}/dual/${matchId}/judge-points`, { judge_number: n, blue_points: b, red_points: r, ...extra });
    // What the Head Judge tablet does to reject one judge: clear all, re-post the rest.
    const hjReject = async (ev, matchId, n) => {
      const keep = (await rowsOf(ev, matchId)).filter(r => r.judge_number !== n);
      await api.must('DELETE', `/api/events/${ev}/dual/${matchId}/judge-points`);
      for (const r of keep) {
        await post(ev, matchId, r.judge_number, r.blue_points, r.red_points,
          { ...(r.time_tied === 1 ? { time_tied: true } : {}), ...(r.air_tied === 1 ? { air_tied: true } : {}) });
      }
    };
    const openJudge = async (ev, judge, size = { width: 1112, height: 720 }) => {
      const p = await tab.newPage();
      await p.setViewportSize(size);
      const posts = [];
      p.on('request', (req) => {
        if (req.method() === 'POST' && /\/judge-points$/.test(req.url())) posts.push({ url: req.url(), body: req.postDataJSON() });
      });
      await p.goto(`${inst.base}/judge/${ev}?judge=${judge.id}`, { waitUntil: 'domcontentloaded' });
      await p.waitForSelector(T('dual-confirm-panel'), { timeout: 15000 });
      return { p, posts };
    };
    const panelText = async (p) => (await p.locator(T('dual-confirm-panel')).innerText()).replace(/\s+/g, ' ').trim();
    const noPending = (p) => p.waitForFunction(() => !document.querySelector('[data-testid="dual-confirm"]'), null, { timeout: 10000 });

    // =====================================================================
    // A. Two-step submission, no totals — Turns Judge 1
    // =====================================================================
    const A = await makeDual(api, 'TwoStep A');
    let m = await startNext(A.ev);
    await post(A.ev, m.id, 2, 4, 1);
    await post(A.ev, m.id, 3, 3, 2);
    const j1 = await openJudge(A.ev, A.judges.DualTurns1);
    await sleep(3500);  // at least one poll with other judges' points on the match
    let body = await j1.p.locator('body').innerText();
    c.ok(!/\d\s*\/\s*5 judges/.test(body) && !/\bpts\b/.test(body), 'A1: no running Blue / Red total and no judge count on the judge tablet');
    c.ok(!/Blue\s+7|7\s+Red/.test(body), 'A1: the other judges\' points (Blue 7 / Red 3) appear nowhere');
    c.ok(/Select a split, then press Confirm/.test(body), 'A1: instruction line describes the two-step flow');
    c.eq(await j1.p.locator(T('dual-time-ref')).count(), 0, 'A1: no time differential card for a Turns judge');
    c.eq(await j1.p.locator(T('dual-confirm')).count(), 0, 'A1: no Confirm button before a selection');

    await j1.p.click(T('dual-split-4-1'));
    c.eq(await j1.p.locator(T('dual-pending-label')).innerText(), 'Blue 4 / Red 1', 'A2: a tap selects — the panel shows "Blue 4 / Red 1"');
    c.eq((await j1.p.locator(T('dual-confirm')).innerText()).trim(), 'Confirm Blue 4 / Red 1', 'A2: Confirm button carries the selection');
    c.eq(await j1.p.locator(T('dual-split-4-1')).getAttribute('aria-pressed'), 'true', 'A2: the selected split is highlighted');
    await sleep(4000);  // longer than the 3 s poll
    c.eq(j1.posts.length, 0, 'A2: nothing is sent by the tap');
    c.eq(await rowOf(A.ev, m.id, 1), null, 'A2: no score on the server after the tap');
    c.eq(await j1.p.locator(T('dual-pending-label')).innerText(), 'Blue 4 / Red 1', 'A2: the selection survives the 3 s refresh');

    await j1.p.click(T('dual-split-2-3'));
    c.eq(await j1.p.locator(T('dual-pending-label')).innerText(), 'Blue 2 / Red 3', 'A3: tapping another split changes the selection');
    c.eq(await j1.p.locator(T('dual-split-4-1')).getAttribute('aria-pressed'), 'false', 'A3: the earlier split is no longer highlighted');
    await j1.p.click(T('dual-cancel'));
    c.eq(await j1.p.locator(T('dual-confirm')).count(), 0, 'A3: Cancel clears the selection');
    c.ok(/Nothing is sent until you press Confirm/.test(await panelText(j1.p)), 'A3: the reserved panel is back to its empty state');
    c.eq(j1.posts.length, 0, 'A3: Cancel sends nothing');

    // no button moves when the panel fills
    const yOf = async (p, id) => Math.round((await p.locator(T(id)).boundingBox()).y);
    const before = [await yOf(j1.p, 'dual-split-5-0'), await yOf(j1.p, 'dual-split-2-3'), await yOf(j1.p, 'dual-confirm-panel')];
    await j1.p.click(T('dual-split-1-4'));
    const after = [await yOf(j1.p, 'dual-split-5-0'), await yOf(j1.p, 'dual-split-2-3'), await yOf(j1.p, 'dual-confirm-panel')];
    c.deepEq(after, before, 'A4: no button moves when the confirm panel fills (reserved space)');
    const cb = await j1.p.locator(T('dual-confirm')).boundingBox();
    const lowest = await j1.p.evaluate(() => Math.max(...[...document.querySelectorAll('.dual-split-btn')].map(e => e.getBoundingClientRect().bottom)));
    c.ok(cb.y >= lowest, 'A4: Confirm sits below every split button (never under the finger that selected)');

    // double tap on Confirm -> exactly one request, identical in shape to the old one
    await j1.p.locator(T('dual-confirm')).dblclick();
    await j1.p.getByText('Score Submitted', { exact: true }).waitFor({ timeout: 10000 });
    await sleep(500);
    c.eq(j1.posts.length, 1, 'A5: a double tap on Confirm sends exactly one request');
    c.deepEq(j1.posts[0] && j1.posts[0].body, { judge_number: 1, blue_points: 1, red_points: 4 }, 'A5: request body is the same shape as before the change');
    c.ok(j1.posts[0] && j1.posts[0].url.endsWith(`/api/events/${A.ev}/dual/${m.id}/judge-points`), 'A5: sent to the public judge-points endpoint of the current match');
    let row = await rowOf(A.ev, m.id, 1);
    c.ok(row && row.blue_points === 1 && row.red_points === 4, 'A5: the confirmed split is stored');
    body = await j1.p.locator('body').innerText();
    c.ok(/Blue 1/.test(body) && /4 Red/.test(body) && !/judges\)/.test(body), 'A5: Score Submitted shows only this judge\'s own split');

    // Head Judge rejects -> notice, select + confirm again
    await hjReject(A.ev, m.id, 1);
    await j1.p.locator(T('dual-rejected')).waitFor({ timeout: 10000 });
    c.ok(/Select a new split and press Confirm/.test(await j1.p.locator(T('dual-rejected')).innerText()), 'A6: rejected notice names the two-step flow');
    c.eq(await j1.p.locator(T('dual-confirm')).count(), 0, 'A6: no selection carried over a rejection');
    await j1.p.click(T('dual-split-3-2'));
    await j1.p.click(T('dual-confirm'));
    await j1.p.getByText('Score Submitted', { exact: true }).waitFor({ timeout: 10000 });
    row = await rowOf(A.ev, m.id, 1);
    c.ok(row && row.blue_points === 3 && row.red_points === 2, 'A6: resubmitted split stored after a rejection');

    // =====================================================================
    // B. Stale selections — Turns Judge 2
    // =====================================================================
    // judge 2 already has 4/1 from section A -> clear the match first
    await api.must('DELETE', `/api/events/${A.ev}/dual/${m.id}/judge-points`);
    const j2 = await openJudge(A.ev, A.judges.DualTurns2);
    // B1: the match changes under a selection
    await j2.p.click(T('dual-split-5-0'));
    c.eq(await j2.p.locator(T('dual-pending-label')).innerText(), 'Blue 5 / Red 0', 'B1: selection made on the first match');
    for (let n = 1; n <= 5; n++) await post(A.ev, m.id, n, 3, 2);
    await api.must('POST', `/api/events/${A.ev}/dual/${m.id}/approve`, {});
    const m2 = await startNext(A.ev);
    await j2.p.waitForFunction((label) => (document.body.innerText || '').includes(label), `Pairing ${m2.pairing_label || ''}`, { timeout: 15000 });
    await noPending(j2.p);
    c.eq(await j2.p.locator(T('dual-confirm')).count(), 0, 'B1: a selection is dropped when the match changes');
    c.eq(j2.posts.length, 0, 'B1: nothing was sent for the stale selection');
    c.eq(await rowOf(A.ev, m2.id, 2), null, 'B1: the new match has no score from this judge');

    // B2: same role scores on another device
    await j2.p.click(T('dual-split-4-1'));
    await post(A.ev, m2.id, 2, 2, 3);
    await j2.p.getByText('Score Submitted', { exact: true }).waitFor({ timeout: 10000 });
    c.eq(await j2.p.locator(T('dual-confirm')).count(), 0, 'B2: selection dropped when the score arrives from another device');
    row = await rowOf(A.ev, m2.id, 2);
    c.ok(row && row.blue_points === 2 && row.red_points === 3, 'B2: the other device\'s score is untouched');

    // B3: manual entry starts under a selection
    await hjReject(A.ev, m2.id, 2);
    await j2.p.locator(T('dual-split-4-1')).waitFor({ timeout: 10000 });
    await j2.p.click(T('dual-split-4-1'));
    await api.must('POST', `/api/events/${A.ev}/dual/manual-entry-start`, {});
    await j2.p.getByText('Manual Score Entry for This Round').waitFor({ timeout: 10000 });
    await api.must('POST', `/api/events/${A.ev}/dual/manual-entry-cancel`, {});
    await j2.p.locator(T('dual-split-4-1')).waitFor({ timeout: 10000 });
    c.eq(await j2.p.locator(T('dual-confirm')).count(), 0, 'B3: selection dropped when manual entry starts');

    // B4: the server refuses (backstop) -> selection cleared, plain message
    await j2.p.route('**/judge-points', (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Match already decided.  Contact the Head Judge.' }) });
    });
    await j2.p.click(T('dual-split-3-2'));
    await j2.p.click(T('dual-confirm'));
    await j2.p.locator(T('dual-error')).waitFor({ timeout: 10000 });
    c.ok(/Score not sent\.\s+Match already decided/.test(await j2.p.locator(T('dual-error')).innerText()), 'B4: a refused send shows a plain "Score not sent" message');
    c.eq(await j2.p.locator(T('dual-confirm')).count(), 0, 'B4: the selection is cleared after a failed send');
    c.eq(await rowOf(A.ev, m2.id, 2), null, 'B4: nothing stored');
    await j2.p.unroute('**/judge-points');
    // B5 (ultra review): the reply is lost but the server stored the score ->
    // "Score not sent" must not stay under the Score Submitted card
    await j2.p.route('**/judge-points', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fetch();          // the server stores the split
      return route.abort();         // ...and the tablet never hears back
    });
    await j2.p.click(T('dual-split-4-1'));
    await j2.p.click(T('dual-confirm'));
    await j2.p.getByText('Score Submitted', { exact: true }).waitFor({ timeout: 10000 });
    await j2.p.unroute('**/judge-points');
    row = await rowOf(A.ev, m2.id, 2);
    c.ok(row && row.blue_points === 4 && row.red_points === 1, 'B5: lost reply — the server did store the split');
    c.eq(await j2.p.locator(T('dual-error')).count(), 0, 'B5: no "Score not sent" message left under the Score Submitted card');
    await hjReject(A.ev, m2.id, 2);
    await j2.p.locator(T('dual-split-3-2')).waitFor({ timeout: 10000 });
    await j2.p.click(T('dual-split-3-2'));
    c.eq(await j2.p.locator(T('dual-error')).count(), 0, 'B4: a new selection replaces the message');
    await j2.p.click(T('dual-confirm'));
    await j2.p.getByText('Score Submitted', { exact: true }).waitFor({ timeout: 10000 });
    c.ok(!!(await rowOf(A.ev, m2.id, 2)), 'B4: the judge can select and confirm again');
    await j1.p.close();
    await j2.p.close();

    // =====================================================================
    // C. Time Judge + Overall Judge (scale 5 / 4)
    // =====================================================================
    const C = await makeDual(api, 'Scale C');
    m = await startNext(C.ev);
    const j4 = await openJudge(C.ev, C.judges.DualTime);
    const j5 = await openJudge(C.ev, C.judges.DualOverall);
    c.eq(await j4.p.locator(T('dual-time-ref')).count(), 1, 'C1: the Time Judge has the time differential card');
    const ref = (await j4.p.locator(T('dual-time-ref')).innerText()).replace(/\s+/g, ' ');
    c.ok(/0\.74 seconds or less 3 \/ 2/.test(ref) && /0\.75 to 1\.49 seconds 4 \/ 1/.test(ref) && /1\.5 seconds or more 5 \/ 0/.test(ref) && /Tied Time Tied/.test(ref),
      `C1: card carries the JH 6304.3.4 table (${ref})`);
    c.ok(/6304\.3\.4/.test(ref), 'C1: card cites FIS JH 6304.3.4');
    c.eq(await j5.p.locator(T('dual-time-ref')).count(), 0, 'C1: no card for the Overall Judge');
    c.eq(await j4.p.locator(T('dual-confirm')).count(), 0, 'C1: the card preselects nothing');

    // Overall Judge selects on the 5 scale, then time is declared tied
    c.ok(/Award 5 Points/i.test(await j5.p.locator('.dual-score-card').innerText()), 'C2: Overall Judge starts on the 5 point scale');
    await j5.p.click(T('dual-split-3-2'));
    await j4.p.click(T('dual-time-tied'));
    c.eq(await j4.p.locator(T('dual-pending-label')).innerText(), 'Time Tied', 'C2: Time Tied is a selection, not a send');
    c.eq((await j4.p.locator(T('dual-confirm')).innerText()).trim(), 'Confirm Time Tied', 'C2: Confirm button reads "Confirm Time Tied"');
    await sleep(600);
    c.eq(j4.posts.length, 0, 'C2: nothing sent by tapping Time Tied');
    await j4.p.click(T('dual-confirm'));
    await j4.p.getByText('Score Submitted', { exact: true }).waitFor({ timeout: 10000 });
    c.deepEq(j4.posts[0] && j4.posts[0].body, { judge_number: 4, blue_points: 0, red_points: 0, time_tied: true }, 'C2: Time Tied request body unchanged');
    row = await rowOf(C.ev, m.id, 4);
    c.ok(row && row.time_tied === 1, 'C2: time tied stored');
    await j5.p.waitForFunction(() => /Award 4 Points/i.test(document.querySelector('.dual-score-card')?.innerText || ''), null, { timeout: 10000 });
    await noPending(j5.p);
    c.eq(await j5.p.locator(T('dual-confirm')).count(), 0, 'C3: the Overall Judge\'s 5-scale selection is dropped when the scale becomes 4');
    c.ok(/Time Tied/.test(await j5.p.locator('.dual-score-card').innerText()), 'C3: the Overall Judge still sees the reason (Time Tied)');
    c.eq(await j5.p.locator(T('dual-split-3-2')).count(), 0, 'C3: the 5-point splits are gone');
    c.eq(j5.posts.length, 0, 'C3: nothing sent for the stale selection');
    await j5.p.click(T('dual-split-3-1'));
    await j5.p.click(T('dual-confirm'));
    await j5.p.getByText('Score Submitted', { exact: true }).waitFor({ timeout: 10000 });
    row = await rowOf(C.ev, m.id, 5);
    c.ok(row && row.blue_points === 3 && row.red_points === 1, 'C3: Overall Judge scores 3 / 1 on the 4 point scale');
    await j4.p.close();
    await j5.p.close();

    // =====================================================================
    // D. Air Judge with both Advanced settings on: Air Tied + NJ panel
    // =====================================================================
    const D = await makeDual(api, 'Air D', { nj_rule_enabled: true, air_tie_allowed: true });
    m = await startNext(D.ev);
    const j3 = await openJudge(D.ev, D.judges.DualAir);
    await j3.p.click(T('dual-split-4-1'));
    await j3.p.getByRole('button', { name: /Blue NJ/ }).click();
    c.eq(await j3.p.locator(T('dual-confirm')).count(), 0, 'D1: opening the NJ confirm closes the split confirm');
    c.eq(await j3.p.getByRole('button', { name: 'Confirm NJ', exact: true }).count(), 1, 'D1: the NJ confirm is labelled "Confirm NJ"');
    await j3.p.click(T('dual-split-2-3'));
    c.eq(await j3.p.getByRole('button', { name: 'Confirm NJ', exact: true }).count(), 0, 'D1: selecting a split closes the NJ confirm (one open at a time)');
    c.eq((await j3.p.locator(T('dual-confirm')).innerText()).trim(), 'Confirm Blue 2 / Red 3', 'D1: the split confirm is labelled with the split');
    await j3.p.click(T('dual-cancel'));
    await j3.p.click(T('dual-air-tied'));
    c.eq((await j3.p.locator(T('dual-confirm')).innerText()).trim(), 'Confirm Air Tied', 'D2: Air Tied is selected, then confirmed');
    c.eq(j3.posts.length, 0, 'D2: nothing sent before Confirm');
    await j3.p.click(T('dual-confirm'));
    await j3.p.getByText('Score Submitted', { exact: true }).waitFor({ timeout: 10000 });
    c.deepEq(j3.posts[0] && j3.posts[0].body, { judge_number: 3, blue_points: 0, red_points: 0, air_tied: true }, 'D2: Air Tied request body unchanged');
    await j3.p.close();
    const D0 = await makeDual(api, 'Air D0');
    await startNext(D0.ev);
    const j3d = await openJudge(D0.ev, D0.judges.DualAir);
    c.eq(await j3d.p.locator(T('dual-air-tied')).count(), 0, 'D3: Air Tied stays hidden by default');
    c.eq(await j3d.p.locator(T('dual-nj-panel')).count(), 0, 'D3: NJ panel stays hidden by default');
    await j3d.p.close();

    // =====================================================================
    // E. Layout — iPad Air 3 landscape, no scrolling, every role, normal + HC
    // =====================================================================
    const E = await makeDual(api, 'Layout E', { nj_rule_enabled: true, air_tie_allowed: true });
    await startNext(E.ev);
    const fits = (p, vh) => p.evaluate((h) => {
      const sel = '[data-testid^="dual-split-"], [data-testid="dual-time-tied"], [data-testid="dual-air-tied"], [data-testid="dual-confirm"], [data-testid="dual-cancel"], [data-testid="dual-confirm-panel"], [data-testid="dual-time-ref"], .dual-nj-toggle, [data-testid="dual-error"]';
      const out = [];
      for (const e of document.querySelectorAll(sel)) {
        const r = e.getBoundingClientRect();
        if (r.top < 0 || r.bottom > h || r.left < 0 || r.right > innerWidth) out.push(`${e.getAttribute('data-testid') || e.className}: ${Math.round(r.top)}-${Math.round(r.bottom)}`);
      }
      return { out, scrollY, cols: getComputedStyle(document.querySelector('.dual-judge-grid')).display, n: document.querySelectorAll(sel).length };
    }, vh);
    // HC mode is remembered per device, so set it explicitly for every page.
    const setHc = async (p, on) => {
      const isOn = (await p.locator('.tablet-root').first().getAttribute('data-hc')) === '1';
      if (isOn !== on) await p.click(on ? 'button.tablet-hc-toggle' : 'button.tablet-hc-back-badge');
      await p.waitForSelector(`.tablet-root[data-hc="${on ? 1 : 0}"]`);
    };
    const ROLES = [['DualTurns1', 'Turns 1'], ['DualTurns2', 'Turns 2'], ['DualAir', 'Air'], ['DualTime', 'Time'], ['DualOverall', 'Overall']];
    for (const [role, label] of ROLES) {
      const { p } = await openJudge(E.ev, E.judges[role], { width: 1112, height: 720 });
      for (const hcMode of [false, true]) {
        await setHc(p, hcMode);
        for (const vh of [720, 680]) {
          await p.setViewportSize({ width: 1112, height: vh });
          await p.click(role === 'DualTime' ? T('dual-time-tied') : role === 'DualAir' ? T('dual-air-tied') : T('dual-split-3-2'));
          await p.locator(T('dual-confirm')).waitFor();
          if (role === 'DualTurns1' && vh === 720) {
            // selected split digits: white on blue normally, amber in HC (like every other selected score button)
            const col = await p.evaluate(() => [...document.querySelectorAll('[data-testid="dual-split-3-2"] span')].map(e => getComputedStyle(e).color));
            const want = hcMode ? 'rgb(251, 191, 36)' : 'rgb(255, 255, 255)';
            c.ok(col.length === 3 && col.every(v => v === want), `E: selected split digits are ${hcMode ? 'amber in HC mode' : 'white in normal mode'} (${col[0]})`);
            const idle = await p.evaluate(() => [...document.querySelectorAll('[data-testid="dual-split-5-0"] span')].map(e => getComputedStyle(e).color));
            c.ok(idle[0] !== idle[2] && idle[0] !== want, `E: an unselected split keeps blue / red digits (${idle[0]} / ${idle[2]})`);
          }
          const f = await fits(p, vh);
          c.ok(f.out.length === 0 && f.scrollY === 0 && f.cols === 'grid',
            `E: ${label} judge, ${hcMode ? 'HC' : 'normal'}, 1112x${vh}: all ${f.n} controls on screen, two columns${f.out.length ? ' — OFF SCREEN: ' + f.out.join('; ') : ''}`);
          await p.click(T('dual-cancel'));
        }
      }
      if (role === 'DualAir') {
        // NJ confirm open (HC, venue height = the tightest case)
        await p.getByRole('button', { name: /Blue NJ/ }).click();
        const nj = await p.evaluate((h) => [...document.querySelectorAll('.dual-nj-panel button')].every(b => b.getBoundingClientRect().bottom <= h && b.getBoundingClientRect().top >= 0), 680);
        c.ok(nj, 'E: Air judge, HC, 1112x680: NJ toggles and the NJ Confirm / Cancel are on screen');
        await p.getByRole('button', { name: 'Cancel', exact: true }).click();
      }
      if (role === 'DualTime') {
        await p.setViewportSize({ width: 834, height: 1112 });
        const f = await fits(p, 1112);
        c.ok(f.cols !== 'grid', 'E: portrait (834 wide) keeps a single column');
        const order = await p.evaluate(() => {
          const y = (s) => document.querySelector(s).getBoundingClientRect().top;
          return y('.dual-col-info') < y('.dual-col-score') && y('.dual-col-score') < y('.dual-col-extra');
        });
        c.ok(order, 'E: portrait order is match card, score card, reference card');
      }
      await p.close();
    }
    // rejected notice + error message also on screen (Time judge, venue height)
    {
      const m5 = (await api.must('GET', `/api/events/${E.ev}/dual/active-match`));
      await post(E.ev, m5.id, 4, 3, 2);
      const { p } = await openJudge(E.ev, E.judges.DualTurns1, { width: 1112, height: 680 });
      const t4 = await tab.newPage();
      await t4.setViewportSize({ width: 1112, height: 680 });
      await t4.goto(`${inst.base}/judge/${E.ev}?judge=${E.judges.DualTime.id}`, { waitUntil: 'domcontentloaded' });
      await t4.getByText('Score Submitted', { exact: true }).waitFor({ timeout: 15000 });
      await setHc(t4, true);   // HC is the taller mode
      await hjReject(E.ev, m5.id, 4);
      await t4.locator(T('dual-rejected')).waitFor({ timeout: 10000 });
      await t4.route('**/judge-points', (route) => route.request().method() === 'POST'
        ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'blue_points + red_points must equal 5 (got 0 + 0 = 0)' }) })
        : route.continue());
      await t4.click(T('dual-split-5-0'));
      const rej = await t4.evaluate(() => ['dual-rejected', 'dual-time-ref', 'dual-confirm', 'dual-cancel'].map((id) => {
        const r = document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight;
      }));
      c.deepEq(rej, [true, true, true, true], 'E: Time judge, HC, 1112x680, after a rejection: rejected notice, reference card, Confirm and Cancel all on screen');
      await t4.click(T('dual-confirm'));
      await t4.locator(T('dual-error')).waitFor({ timeout: 10000 });
      c.ok(/The points to award changed for this match/.test(await t4.locator(T('dual-error')).innerText()), 'E: a scale refusal is worded plainly');
      const vis = await t4.evaluate(() => ['dual-error', 'dual-time-ref', 'dual-time-tied', 'dual-split-2-3'].map((id) => {
        const r = document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight;
      }));
      c.deepEq(vis, [true, true, true, true], 'E: Time judge, HC, 1112x680: error message, reference card and controls all on screen');
      await t4.close();
      await p.close();
    }

    // =====================================================================
    // F. Head Judge tablet (moguls): T&L and Air lists in judge-number order
    // =====================================================================
    const meet = await api.must('POST', '/api/meets', { name: 'Order F', location: 'X', date: '2026-11-23', meet_ranking: 'C' });
    const ev = await api.must('POST', `/api/meets/${meet.id}/events`, { discipline: 'mogul', division: 'comp_series', gender: 'M', name: 'Order M' });
    const judges = await seedMogulJudges(api, ev.id);
    const ath = await api.must('POST', '/api/athletes', { first_name: 'Cole', last_name: 'Order', gender: 'M', birth_year: 2008, ussa_num: '8892003' });
    const reg = await api.must('POST', `/api/events/${ev.id}/registrations`, { athlete_id: ath.id, bib_number: 71 });
    const run = await api.must('POST', `/api/events/${ev.id}/runs`, { registration_id: reg.id, run_number: 1 });
    const S = `/api/events/${ev.id}/runs/${run.id}`;
    const tl = (role, v) => api.must('POST', `${S}/scores`, { judge_id: judges[role].id, score_type: 'turns', raw_score: v, carving: 7.0, abext: 3.5, upper_body: 3.0, deduction: 0.0 });
    const air = async (role, v) => {
      await api.must('POST', `${S}/scores`, { judge_id: judges[role].id, score_type: 'air_jump1', raw_score: v, jump_code: '3' });
      await api.must('POST', `${S}/scores`, { judge_id: judges[role].id, score_type: 'air_jump2', raw_score: v, jump_code: 'bT' });
    };
    await api.must('PUT', S, { jump1_code: '3', jump2_code: 'bT' });
    await tl('TL2', 13.2); await tl('TL3', 13.3); await tl('TL1', 13.1);   // arrival order 2, 3, 1
    await air('Air2', 7.2); await air('Air1', 7.1);                         // arrival order 2, 1
    const active = await api.must('GET', `/api/events/${ev.id}/runs/active`);
    const arrival = [...new Set(active.submitted.filter(s => /^TL/.test(s.role)).map(s => s.role))];
    const hj = await tab.newPage();
    await hj.setViewportSize({ width: 1180, height: 820 });
    hj.on('dialog', d => d.accept());
    await hj.goto(`${inst.base}/headjudge/${meet.id}/${ev.id}`, { waitUntil: 'domcontentloaded' });
    await hj.getByText('T&L JUDGES', { exact: true }).first().waitFor({ timeout: 15000 });
    const roleOrder = (re) => hj.evaluate((src) => {
      const rx = new RegExp(src);
      return [...document.querySelectorAll('.tablet-card .text-xs.uppercase.font-bold')]
        .map(e => (e.childNodes[0] && e.childNodes[0].textContent || '').trim())
        .filter(t => rx.test(t));
    }, re.source);
    await hj.waitForFunction(() => /T&L 3/i.test(document.body.textContent) && /Air 2/i.test(document.body.textContent), null, { timeout: 15000 });
    c.ok(arrival.join() !== 'TL1,TL2,TL3', `F: the server still returns the rows unordered (${arrival.join(', ')}) — the tablet does the ordering`);
    c.deepEq(await roleOrder(/^T&L \d$/), ['T&L 1', 'T&L 2', 'T&L 3'], 'F: Head Judge tablet lists T&L 1, T&L 2, T&L 3');
    c.deepEq(await roleOrder(/^Air \d$/), ['Air 1', 'Air 2'], 'F: Head Judge tablet lists Air 1, Air 2');
    // a rejected and resubmitted judge no longer drops to the end
    const tl1Row = active.submitted.find(s => s.role === 'TL1' && s.score_type === 'turns');
    await api.must('POST', `${S}/scores/${tl1Row.id}/reject`, {});
    await tl('TL1', 14.4);
    await hj.waitForFunction(() => /14\.4/.test(document.body.innerText), null, { timeout: 15000 });
    c.deepEq(await roleOrder(/^T&L \d$/), ['T&L 1', 'T&L 2', 'T&L 3'], 'F: order holds after a reject and resubmit');
    await hj.close();

    await tab.close();
  } catch (e) {
    c.ok(false, 'threw: ' + ((e && e.stack) || e));
  } finally {
    await shutdownBrowser().catch(() => {});
    await inst.stop().catch(() => {});
  }
  return c;
}

module.exports = { main };
