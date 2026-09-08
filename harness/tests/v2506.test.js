/**
 * v2.5.06 acceptance — dual mogul round notation + end-of-round notice.
 *
 * HTTP layer (cloud instance):
 *   A  16-athlete runoff-to-8th bracket: every non-bye row of GET /dual carries
 *      round_label ("Female Round of 16" … "Female 1st / 2nd Place"); GET
 *      /round-state is null before the first match; walking the bracket in
 *      pairing order, active_round_label names the active match's round,
 *      ended_round_label is null mid-round / while a match is open / after a
 *      final, and reads "End of Round of 16 / Round of 8 / Semi-Finals for
 *      Females" exactly between the last approval of a block and the next
 *      start. /active-match carries round_label.
 *   B  6-athlete runoff-to-8th (byes; unfillable 5–8 semis cannot hold the
 *      semifinal block open) — Male wording.
 *   C  runoff_to_4th + no_runoff labels; 404 on an unknown event.
 * Playwright layer (FR-21):
 *   D  judge tablet + HJ tablet: round label at the top of the match card,
 *      end-of-round panel on the waiting screens after the last approval of a
 *      round, gone once the next match starts (label then names the new round).
 */

const { Checks } = require('../lib/checks');
const { Instance } = require('../lib/instance');
const { Api } = require('../lib/client');
const { buildMeet } = require('../lib/fixtures');
const { seedDualJudges } = require('../lib/driver');
const { newTablet, shutdownBrowser } = require('../lib/browser');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function makeDual(api, { name, gender, athletes, runoff }) {
  const M = await buildMeet(api, { name, gender, discipline: 'dual_mogul', athletes, judges: [], startRun: false });
  const judges = await seedDualJudges(api, M.event.id);
  await api.must('PUT', `/api/events/${M.event.id}/dual/runoff-option`, { runoff_option: runoff });
  await api.must('POST', `/api/events/${M.event.id}/dual/seed-random`, {});
  await api.must('POST', `/api/events/${M.event.id}/dual/seed-fis`, {});
  return { ...M, judges };
}

const readyInOrder = (bracket) => bracket
  .filter(m => m.status === 'pending' && m.registration_id_blue && m.registration_id_red && !m.is_bye)
  .sort((a, b) => (a.pairing_number ?? 1e9) - (b.pairing_number ?? 1e9));

async function scoreAndApprove(api, eventId, m) {
  for (let n = 1; n <= 5; n++) {
    await api.must('POST', `/api/events/${eventId}/dual/${m.id}/judge-points`, {
      judge_number: n, blue_points: 3, red_points: 2,
    });
  }
  await api.must('POST', `/api/events/${eventId}/dual/${m.id}/approve`, {});
}

async function main() {
  const c = new Checks('v2506');
  const cloud = new Instance({ name: 'v2506-cloud', port: 3301, mode: 'cloud' });
  try {
    await cloud.start();
    const api = new Api(cloud.base);
    let r;

    // =====================================================================
    // A. 16 athletes, runoff to 8th, Female
    // =====================================================================
    const A = await makeDual(api, { name: 'RoundNote A', gender: 'F', athletes: 16, runoff: 'runoff_to_8th' });
    const ev = A.event.id;
    let bracket = await api.must('GET', `/api/events/${ev}/dual`);
    const real = bracket.filter(m => !m.is_bye);
    c.ok(real.every(m => typeof m.round_label === 'string' && m.round_label.startsWith('Female ')),
      'A: every GET /dual row carries a "Female …" round_label');
    const labelOf = (round, pos, small) => (bracket.find(m => m.bracket_round === round && m.bracket_position === pos && !!m.is_small_final === small) || {}).round_label;
    c.eq(labelOf(4, 1, false), 'Female Round of 16', 'A: round 4 = Round of 16');
    c.eq(labelOf(3, 4, false), 'Female Round of 8', 'A: round 3 = Round of 8');
    c.eq(labelOf(2, 2, false), 'Female Semifinal', 'A: main round 2 = Semifinal');
    c.eq(labelOf(2, 3, true), 'Female 5th – 8th Place Semifinal', 'A: consolation round 2 = 5th – 8th Place Semifinal');
    c.eq(labelOf(1, 4, true), 'Female 7th / 8th Place', 'A: cons 1.4 = 7th / 8th Place');
    c.eq(labelOf(1, 3, true), 'Female 5th / 6th Place', 'A: cons 1.3 = 5th / 6th Place');
    c.eq(labelOf(1, 2, true), 'Female 3rd / 4th Place', 'A: cons 1.2 = 3rd / 4th Place');
    c.eq(labelOf(1, 1, false), 'Female 1st / 2nd Place', 'A: championship = 1st / 2nd Place');

    r = await api.must('GET', `/api/events/${ev}/dual/round-state`);
    c.eq(r.gender_word, 'Female', 'A: round-state gender word');
    c.eq(r.active_round_label, null, 'A: no active round before the first match');
    c.eq(r.ended_round_label, null, 'A: nothing has ended before the first match');

    // Walk the whole day in pairing order; record the notice after each approval.
    const expectedEnd = {           // pairing number of the block's LAST match → notice
      8: 'End of Round of 16 for Females',
      12: 'End of Round of 8 for Females',
      16: 'End of Semi-Finals for Females',
    };
    const seen = [];
    let allLabelsOk = true, endedWhileOpenOk = true, notMidRoundOk = true, activeLabelOk = true;
    for (let guard = 0; guard < 40; guard++) {
      bracket = await api.must('GET', `/api/events/${ev}/dual`);
      const next = readyInOrder(bracket)[0];
      if (!next) break;
      await api.must('PUT', `/api/events/${ev}/dual/active-match`, { match_id: next.id });
      const am = await api.must('GET', `/api/events/${ev}/dual/active-match`);
      if (am.round_label !== next.round_label) activeLabelOk = false;
      r = await api.must('GET', `/api/events/${ev}/dual/round-state`);
      if (r.active_round_label !== next.round_label) allLabelsOk = false;
      if (r.ended_round_label !== null) endedWhileOpenOk = false;   // a match is open → no notice
      // judges in, HJ not yet approved → still open
      for (let n = 1; n <= 5; n++) {
        await api.must('POST', `/api/events/${ev}/dual/${next.id}/judge-points`, { judge_number: n, blue_points: 3, red_points: 2 });
      }
      r = await api.must('GET', `/api/events/${ev}/dual/round-state`);
      if (r.ended_round_label !== null) endedWhileOpenOk = false;
      await api.must('POST', `/api/events/${ev}/dual/${next.id}/approve`, {});
      r = await api.must('GET', `/api/events/${ev}/dual/round-state`);
      seen.push([next.pairing_number, r.ended_round_label]);
      const exp = expectedEnd[next.pairing_number] || null;
      if (r.ended_round_label !== exp) notMidRoundOk = false;
    }
    c.eq(seen.length, 20, 'A: played all 20 matches (8 + 4 + 2 cons semis + 2 semis + 4 finals)');
    c.ok(activeLabelOk, 'A: /active-match round_label matches the bracket row');
    c.ok(allLabelsOk, 'A: round-state active_round_label names the active match\'s round every time');
    c.ok(endedWhileOpenOk, 'A: no end-of-round notice while a match is open (started or awaiting HJ)');
    c.ok(notMidRoundOk, `A: notice only after pairing 8 (R16), 12 (R8), 16 (semis), never after a final: ${JSON.stringify(seen)}`);
    c.eq(seen.find(s => s[0] === 8)[1], 'End of Round of 16 for Females', 'A: "End of Round of 16 for Females" after the last R16 approval');
    c.eq(seen.find(s => s[0] === 12)[1], 'End of Round of 8 for Females', 'A: "End of Round of 8 for Females" after the last quarterfinal');
    c.eq(seen.find(s => s[0] === 14)[1], null, 'A: no notice between the 5–8 semis and the 1–4 semis (one block)');
    c.eq(seen.find(s => s[0] === 16)[1], 'End of Semi-Finals for Females', 'A: "End of Semi-Finals for Females" after the last semifinal');
    c.eq(seen.find(s => s[0] === 20)[1], null, 'A: nothing after the championship final');
    // Notice clears the moment the next match starts (checked inside the loop via endedWhileOpenOk)

    // =====================================================================
    // B. 6 athletes, runoff to 8th, Male — byes + unfillable 5–8 semis
    // =====================================================================
    const B = await makeDual(api, { name: 'RoundNote B', gender: 'M', athletes: 6, runoff: 'runoff_to_8th' });
    const evB = B.event.id;
    const seenB = [];
    for (let guard = 0; guard < 40; guard++) {
      bracket = await api.must('GET', `/api/events/${evB}/dual`);
      const next = readyInOrder(bracket)[0];
      if (!next) break;
      await api.must('PUT', `/api/events/${evB}/dual/active-match`, { match_id: next.id });
      await scoreAndApprove(api, evB, next);
      r = await api.must('GET', `/api/events/${evB}/dual/round-state`);
      seenB.push([next.round_label, r.ended_round_label]);
    }
    c.ok(seenB.length >= 5, `B: bracket played through (${seenB.length} matches)`);
    c.ok(seenB.some(s => s[1] === 'End of Round of 8 for Males'), 'B: "End of Round of 8 for Males" after the played quarterfinals (byes ignored)');
    c.ok(seenB.some(s => s[1] === 'End of Semi-Finals for Males'), `B: "End of Semi-Finals for Males" even though the 5–8 semis can never fill: ${JSON.stringify(seenB)}`);
    c.ok(seenB.every(s => !/Place/.test(s[0]) || s[1] === null), 'B: no notice after any final');

    // =====================================================================
    // C. runoff_to_4th / no_runoff labels; unknown event
    // =====================================================================
    const C4 = await makeDual(api, { name: 'RoundNote C4', gender: 'F', athletes: 8, runoff: 'runoff_to_4th' });
    bracket = await api.must('GET', `/api/events/${C4.event.id}/dual`);
    c.ok(bracket.some(m => m.round_label === 'Female Round of 8') && bracket.some(m => m.round_label === 'Female Semifinal')
      && bracket.some(m => m.round_label === 'Female 3rd / 4th Place') && bracket.some(m => m.round_label === 'Female 1st / 2nd Place')
      && !bracket.some(m => /5th/.test(m.round_label || '')), 'C: runoff_to_4th labels (R8, Semifinal, 3rd / 4th, 1st / 2nd; no 5th–8th)');
    const C0 = await makeDual(api, { name: 'RoundNote C0', gender: 'F', athletes: 4, runoff: 'no_runoff' });
    bracket = await api.must('GET', `/api/events/${C0.event.id}/dual`);
    c.ok(bracket.some(m => m.round_label === 'Female Semifinal') && bracket.some(m => m.round_label === 'Female 1st / 2nd Place'),
      'C: no_runoff labels (Semifinal, 1st / 2nd)');
    r = await api.req('GET', `/api/events/does-not-exist/dual/round-state`);
    c.eq(r.status, 404, 'C: round-state 404 on an unknown event');

    // =====================================================================
    // D. Playwright — judge tablet + HJ tablet
    // =====================================================================
    const D = await makeDual(api, { name: 'RoundNote D', gender: 'F', athletes: 8, runoff: 'runoff_to_4th' });
    const evD = D.event.id;
    // play the first three quarterfinals
    for (let i = 0; i < 3; i++) {
      bracket = await api.must('GET', `/api/events/${evD}/dual`);
      const next = readyInOrder(bracket)[0];
      await api.must('PUT', `/api/events/${evD}/dual/active-match`, { match_id: next.id });
      await scoreAndApprove(api, evD, next);
    }
    const tab = await newTablet();
    const jp = await tab.newPage();
    jp.on('dialog', d => d.accept());
    const hp = await tab.newPage();
    hp.on('dialog', d => d.accept());
    await jp.goto(`${cloud.base}/judge/${evD}?judge=${D.judges.DualAir.id}`, { waitUntil: 'domcontentloaded' });
    await hp.goto(`${cloud.base}/headjudge/${D.meet.id}/${evD}`, { waitUntil: 'domcontentloaded' });

    // Start the LAST quarterfinal → both tablets show "Female Round of 8"
    bracket = await api.must('GET', `/api/events/${evD}/dual`);
    let next = readyInOrder(bracket)[0];
    await api.must('PUT', `/api/events/${evD}/dual/active-match`, { match_id: next.id });
    await jp.locator('[data-testid="dual-round-label"]').first().waitFor({ timeout: 15000 });
    c.eq((await jp.locator('[data-testid="dual-round-label"]').first().innerText()).trim(), 'Female Round of 8', 'D UI: judge tablet match card is headed "Female Round of 8"');
    await hp.locator('[data-testid="dual-round-label"]').first().waitFor({ timeout: 15000 });
    c.eq((await hp.locator('[data-testid="dual-round-label"]').first().innerText()).trim(), 'Female Round of 8', 'D UI: HJ tablet match card is headed "Female Round of 8"');
    c.eq(await jp.locator('[data-testid="dual-round-ended"]').count(), 0, 'D UI: no end-of-round panel while the match is open (judge)');

    // Judges in (incl. this Air judge) → judge tablet shows Score Submitted; HJ approves → panel on both
    for (let n = 1; n <= 5; n++) {
      await api.must('POST', `/api/events/${evD}/dual/${next.id}/judge-points`, { judge_number: n, blue_points: 3, red_points: 2 });
    }
    await jp.getByText('Score Submitted', { exact: true }).waitFor({ timeout: 15000 });
    c.eq(await jp.locator('[data-testid="dual-round-ended"]').count(), 0, 'D UI: still no panel while the HJ has not approved');
    await api.must('POST', `/api/events/${evD}/dual/${next.id}/approve`, {});
    await jp.locator('[data-testid="dual-round-ended"]').waitFor({ timeout: 15000 });
    c.ok(/End of Round of 8 for Females/.test(await jp.locator('[data-testid="dual-round-ended"]').innerText()), 'D UI: judge tablet shows "End of Round of 8 for Females" on the Score Submitted / waiting screen');
    await hp.locator('[data-testid="dual-round-ended"]').waitFor({ timeout: 15000 });
    c.ok(/End of Round of 8 for Females/.test(await hp.locator('[data-testid="dual-round-ended"]').innerText()), 'D UI: HJ tablet shows "End of Round of 8 for Females" above Next Pairing');
    c.ok(/Female Semifinal/.test(await hp.locator('text=Next Pairing').locator('..').innerText()), 'D UI: HJ Next Pairing card names the next round (Female Semifinal)');

    // Judge tablet with the active match cleared (plain waiting screen) also shows it
    await api.must('DELETE', `/api/events/${evD}/dual/active-match`);
    await jp.locator('text=Waiting for next match').first().waitFor({ timeout: 15000 });
    await sleep(3500);
    c.ok(await jp.locator('[data-testid="dual-round-ended"]').count() === 1, 'D UI: panel stays on the judge tablet\'s plain waiting screen');
    c.ok(await hp.locator('[data-testid="dual-round-ended"]').count() === 1, 'D UI: panel stays on the HJ tablet with no active match');

    // Start the first semifinal → panel gone, label "Female Semifinal" on both
    bracket = await api.must('GET', `/api/events/${evD}/dual`);
    next = readyInOrder(bracket)[0];
    await api.must('PUT', `/api/events/${evD}/dual/active-match`, { match_id: next.id });
    await jp.waitForFunction(() => document.querySelector('[data-testid="dual-round-ended"]') === null, null, { timeout: 15000 });
    c.eq(await jp.locator('[data-testid="dual-round-ended"]').count(), 0, 'D UI: panel gone on the judge tablet once the next match starts');
    await jp.locator('[data-testid="dual-round-label"]').first().waitFor({ timeout: 15000 });
    c.eq((await jp.locator('[data-testid="dual-round-label"]').first().innerText()).trim(), 'Female Semifinal', 'D UI: judge tablet now headed "Female Semifinal"');
    await hp.waitForFunction(() => document.querySelector('[data-testid="dual-round-ended"]') === null, null, { timeout: 15000 });
    c.eq(await hp.locator('[data-testid="dual-round-ended"]').count(), 0, 'D UI: panel gone on the HJ tablet once the next match starts');
    c.eq((await hp.locator('[data-testid="dual-round-label"]').first().innerText()).trim(), 'Female Semifinal', 'D UI: HJ tablet now headed "Female Semifinal"');
    await tab.close();
  } finally {
    await shutdownBrowser().catch(() => {});
    await cloud.stop().catch(() => {});
  }
  return c;
}

module.exports = { main };
