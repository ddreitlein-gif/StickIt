/**
 * v2.8.02 — the mogul judge tablet shows the REJECTED score inside the red
 * "Your score was rejected" box (T&L: total + breakdown; Air: jump code + score).
 *
 * Playwright against the committed build in server/public — rebuild the
 * client before running when client source changed.
 */

const { Checks } = require('../lib/checks');
const { Instance } = require('../lib/instance');
const { Api } = require('../lib/client');
const { seedMogulJudges } = require('../lib/driver');
const { newTablet, shutdownBrowser } = require('../lib/browser');

async function main() {
  const c = new Checks('v2802');
  const inst = new Instance({ name: 'v2802-cloud', port: 3197, mode: 'cloud' });
  try {
    await inst.start();
    const api = new Api(inst.base);
    const meet = await api.must('POST', '/api/meets', { name: 'Rej', location: 'X', date: '2026-11-21', meet_ranking: 'C' });
    const ev = await api.must('POST', `/api/meets/${meet.id}/events`, { discipline: 'mogul', division: 'comp_series', gender: 'F', name: 'Rej F' });
    const judges = await seedMogulJudges(api, ev.id);
    const ath = await api.must('POST', '/api/athletes', { first_name: 'Sydney', last_name: 'Martin', gender: 'F', birth_year: 2008, ussa_num: '8891002' });
    const reg = await api.must('POST', `/api/events/${ev.id}/registrations`, { athlete_id: ath.id, bib_number: 55 });
    const run = await api.must('POST', `/api/events/${ev.id}/runs`, { registration_id: reg.id, run_number: 1 });
    const S = `/api/events/${ev.id}/runs/${run.id}`;
    const rowsOf = async (jid) => (await api.must('GET', `/api/events/${ev.id}/runs/active`)).submitted.filter(s => s.judge_id === jid);
    const reject = async (jid, type) => {
      const row = (await rowsOf(jid)).find(s => s.score_type === type);
      await api.must('POST', `${S}/scores/${row.id}/reject`, {});
    };
    const tab = await newTablet();
    const box = (page) => page.locator('.tablet-card', { hasText: 'Your score was rejected' });
    const flat = (t) => t.replace(/\n/g, ' | ');

    // 1. T&L, submitted before the tablet (re)loaded -> values come from the poll
    await api.must('POST', `${S}/scores`, { judge_id: judges.TL1.id, score_type: 'turns', raw_score: 15.3, carving: 8.1, abext: 3.9, upper_body: 3.5, deduction: 0.2 });
    const tl = await tab.newPage();
    await tl.setViewportSize({ width: 1180, height: 820 });
    await tl.goto(`${inst.base}/judge/${ev.id}?judge=${judges.TL1.id}`);
    await tl.waitForSelector('text=Score Submitted', { timeout: 15000 });
    await reject(judges.TL1.id, 'turns');
    await box(tl).waitFor({ timeout: 10000 });
    let txt = await box(tl).innerText();
    c.ok(/Rejected score:\s*T&L Total 15\.3/.test(txt), `T&L reloaded tablet: total shown (${flat(txt)})`);
    c.ok(txt.includes('8.1 + 3.9 + 3.5 - 0.2 = 15.3'), 'T&L reloaded tablet: breakdown shown');

    // 2. T&L resubmits through the real pads, HJ rejects again -> local values
    await tl.getByRole('button', { name: '7.0', exact: true }).first().click();
    await tl.getByRole('button', { name: '4.0', exact: true }).nth(1).click();
    await tl.getByRole('button', { name: '3.0', exact: true }).nth(2).click();
    await tl.getByRole('button', { name: 'Submit Score', exact: true }).click();
    await tl.waitForSelector('text=Score Submitted', { timeout: 10000 });
    c.eq(await box(tl).count(), 0, 'red box gone after resubmit');
    await reject(judges.TL1.id, 'turns');
    await box(tl).waitFor({ timeout: 10000 });
    txt = await box(tl).innerText();
    c.ok(/T&L Total 14\.0/.test(txt) && txt.includes('7.0 + 4.0 + 3.0 - 0.0 = 14.0'), `T&L pad submit: second rejection shows the NEW score (${flat(txt)})`);
    c.ok(!txt.includes('15.3'), 'the earlier rejected score is not left behind');

    // 3. Air: jump 1 rejected, then jump 2
    await api.must('PUT', S, { jump1_code: '3', jump2_code: 'bT' });
    for (const j of ['Air1', 'Air2']) {
      await api.must('POST', `${S}/scores`, { judge_id: judges[j].id, score_type: 'air_jump1', raw_score: 7.5, jump_code: '3' });
      await api.must('POST', `${S}/scores`, { judge_id: judges[j].id, score_type: 'air_jump2', raw_score: 6.8, jump_code: 'bT' });
    }
    const a1 = await tab.newPage();
    await a1.goto(`${inst.base}/judge/${ev.id}?judge=${judges.Air1.id}`);
    const a2 = await tab.newPage();
    await a2.goto(`${inst.base}/judge/${ev.id}?judge=${judges.Air2.id}`);
    await a1.waitForSelector('text=Score Submitted', { timeout: 15000 });
    await a2.waitForSelector('text=Score Submitted', { timeout: 15000 });
    await reject(judges.Air1.id, 'air_jump1');
    await box(a1).waitFor({ timeout: 10000 });
    txt = await box(a1).innerText();
    c.ok(/Rejected score:\s*Jump 1: 3 7\.5/.test(txt) && !/Jump 2/.test(txt), `Air: only jump 1 shown (${flat(txt)})`);
    await reject(judges.Air1.id, 'air_jump2');
    await a1.waitForFunction(() => /Jump 2: bT 6\.8/.test(document.body.innerText), null, { timeout: 10000 });
    txt = await box(a1).innerText();
    c.ok(/Jump 1: 3 7\.5/.test(txt) && /Jump 2: bT 6\.8/.test(txt), 'Air: both jumps shown after the second rejection');

    // 4. Reject Codes (poll path, no reject message) on the other Air tablet
    c.eq(await box(a2).count(), 0, 'Air2 untouched by Air1 rejections');
    await api.must('PUT', S, { clear_jump_codes: true });
    await box(a2).waitFor({ timeout: 10000 });
    txt = await box(a2).innerText();
    c.ok(/Jump 1: 3 7\.5/.test(txt) && /Jump 2: bT 6\.8/.test(txt), `Air Reject Codes (poll): both jumps shown (${flat(txt)})`);

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
