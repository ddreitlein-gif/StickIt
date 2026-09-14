/**
 * v2.6.00 acceptance — the Broadcast Board (/broadcast/:eventId) and the two
 * public logo image endpoints (Implementation Plan 09-12-26, Section 10).
 *
 * HTTP + Playwright, one cloud instance:
 *   A  Route: resolves by short code and by UUID; an unknown code renders
 *      "Event not found".
 *   B  Moguls, 24 athletes, Best of 2 (one DNF): Frame 1 rows carry exactly
 *      five fields; the leader pages cycle 1–8 / 9–16 / 17–23 on the timer;
 *      Still To Come = the next three of /runs/upcoming; the DNF athlete
 *      never appears on a leader row; the root ignores pointer events and
 *      holds no interactive element; no LIVE text.
 *   C  Latest Result: a score published while the board is open (WebSocket
 *      path) and one published to a board whose WebSocket is stubbed out
 *      (poll path) both surface the right athlete, time, total and ordinal.
 *   D  Logo panel: absent with no logo; event logo alone; event + bottom logo
 *      — the images come from the new endpoints, which serve the uploaded
 *      bytes unchanged and 404 when no logo exists.
 *   E  16-athlete dual, runoff to 8th: rows numbered from pairing_number, NEXT
 *      on the first playable open match, split chips with the winner solid,
 *      feeder placeholders in Coming Up; after the semifinal block the finals
 *      block lists the championship first with the 7/8 pairing NEXT; after
 *      the championship the podium follows the bracket placements
 *      (UNOFFICIAL, then OFFICIAL once finalized); no score column for duals.
 *   F  No request leaves the origin (fonts self-hosted).
 *   G  Scoreboard + Overlay smoke (unchanged pages still render).
 *   H  With password protection ON the logo image endpoints stay public.
 *   Screenshots of every frame at 1920x1080 and 1280x720 land in
 *   harness/.scratch/v260-shots/ for eyeballing.
 */

const fs = require('fs');
const path = require('path');
const { Checks } = require('../lib/checks');
const { Instance, SCRATCH_ROOT } = require('../lib/instance');
const { Api } = require('../lib/client');
const { buildMeet } = require('../lib/fixtures');
const { seedMogulJudges, seedDualJudges, playMogulRun } = require('../lib/driver');
const { newTablet, shutdownBrowser } = require('../lib/browser');

const SHOTS = path.join(SCRATCH_ROOT, 'v260-shots');
const LOGO_PNG = path.join(__dirname, '..', '..', 'server', 'public', 'logos', 'stickit.png');
const BOTTOM_PNG = path.join(__dirname, '..', '..', 'server', 'public', 'logos', 'usss.png');

const WOMEN = ['Elena Marchetti', 'Sadie Whitcomb', 'Nora Kestrel', 'Piper Lindqvist', 'Maren Oduya', 'Cleo Bannister', 'Tess Harlan', 'Juniper Vale', 'Ingrid Solheim', 'Rosa Ferreira', 'Willa Strand', 'Katya Morozova', 'Aurora Blackwood', 'Freya Castellanos', 'Imogen Okafor', 'Lucia Petrova', 'Matilda Reyes', 'Noa Lindgren', 'Ophelia Tanaka', 'Priya Delacroix', 'Quinn Abernathy', 'Sienna Kowalczyk', 'Thea Villanueva', 'Zara Whitfield'];
const MEN = ['Mateo Reyes', 'Oskar Lindgren', 'Caleb Whitfield', 'Diego Delgado', 'Jonas Kowalski', 'Kwame Osei', 'Liam Brennan', 'Ren Takahashi', 'Anders Holm', 'Bryce Calloway', 'Emeka Nwosu', 'Felix Marchand', 'Gabriel Sousa', 'Hugo Bergstrom', 'Ivan Petrov', 'Jasper Quill'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const fullName = r => [r.first_name, r.last_name].filter(Boolean).join(' ');

async function makeEvent(api, { name, gender, discipline, names }) {
  const M = await buildMeet(api, { name, gender, discipline, athletes: 0, judges: [], startRun: false });
  const regs = [];
  for (let i = 0; i < names.length; i++) {
    const [first, last] = names[i].split(' ');
    const a = await api.must('POST', '/api/athletes', {
      first_name: first, last_name: last, gender, birth_year: 2006 + (i % 6),
      ussa_num: `V260${gender}${1000 + i}`, club: ['Aspen Valley', 'Steamboat', 'Winter Park'][i % 3],
    });
    regs.push(await api.must('POST', `/api/events/${M.event.id}/registrations`, { athlete_id: a.id, bib_number: 200 + i }));
  }
  await api.must('PUT', `/api/events/${M.event.id}/registrations/reorder`, regs.map((r, i) => ({ id: r.id, run_order: i + 1 })));
  return { ...M, regs };
}

async function uploadLogo(base, meetId, which, file) {
  const fd = new FormData();
  fd.append('logo', new Blob([fs.readFileSync(file)], { type: 'image/png' }), path.basename(file));
  const r = await fetch(`${base}/api/pdf/${which}/${meetId}`, { method: 'POST', body: fd });
  if (!r.ok) throw new Error(`upload ${which} -> ${r.status}`);
}

/** Open the board in a fresh context. noWs stubs WebSocket so only the 3 s poll can refresh. */
async function openBoard(tab, url, { width = 1920, height = 1080, noWs = false, requests = null } = {}) {
  const page = await tab.newPage();
  await page.setViewportSize({ width, height });
  if (noWs) {
    await page.addInitScript(() => {
      window.WebSocket = class { constructor() { this.readyState = 3; } send() {} close() {} };
    });
  }
  if (requests) page.on('request', req => requests.push(req.url()));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return page;
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const vp = page.viewportSize();
  await page.screenshot({ path: path.join(SHOTS, `${name}_${vp.width}x${vp.height}.png`) });
}

/** Collect footer captions over `ms` milliseconds. */
async function collectCaptions(page, ms) {
  const seen = new Set();
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const t = await page.locator('[data-testid="bb-caption"]').textContent().catch(() => '');
    if (t) seen.add(t.trim());
    await sleep(400);
  }
  return [...seen];
}

const readyInOrder = (bracket) => bracket
  .filter(m => m.status === 'pending' && m.registration_id_blue && m.registration_id_red && !m.is_bye)
  .sort((a, b) => (a.pairing_number ?? 1e9) - (b.pairing_number ?? 1e9));

async function decide(api, eventId, m, side) {
  const bp = side === 'blue' ? 3 : 2, rp = side === 'blue' ? 2 : 3;
  await api.must('PUT', `/api/events/${eventId}/dual/active-match`, { match_id: m.id });
  for (let n = 1; n <= 5; n++) {
    await api.must('POST', `/api/events/${eventId}/dual/${m.id}/judge-points`, { judge_number: n, blue_points: bp, red_points: rp });
  }
  await api.must('POST', `/api/events/${eventId}/dual/${m.id}/approve`, {});
}

async function playN(api, eventId, n) {
  for (let i = 0; i < n; i++) {
    const b = await api.must('GET', `/api/events/${eventId}/dual`);
    const next = readyInOrder(b)[0];
    if (!next) return;
    await decide(api, eventId, next, next.pairing_number % 3 === 0 ? 'red' : 'blue');
  }
}

async function main() {
  const c = new Checks('v260');
  const cloud = new Instance({ name: 'v260-cloud', port: 3312, mode: 'cloud' });
  const tab = await newTablet();
  try {
    await cloud.start();
    const api = new Api(cloud.base);
    const origin = new URL(cloud.base).origin;

    // =====================================================================
    // Moguls fixture: 24 athletes, Run 1 complete (one DNF), Run 2 started
    // =====================================================================
    const W = await makeEvent(api, { name: 'Board Women', gender: 'F', discipline: 'mogul', names: WOMEN });
    const ev = W.event.id;
    const code = W.event.short_code;
    const judges = await seedMogulJudges(api, ev);
    const url = `${cloud.base}/broadcast/${code}?page=4`;

    // ---- A. route resolution --------------------------------------------
    {
      const p = await openBoard(tab, url);
      await p.locator('[data-testid="bb-leader-row"]').first().waitFor({ timeout: 15000 });
      c.ok(true, 'A: /broadcast/<short code> resolves and renders the board');
      const caption = (await p.locator('[data-testid="bb-caption"]').textContent()).trim();
      c.ok(/^START LIST · 24 ATHLETES$/.test(caption), `A: waiting state shows the START LIST (${caption})`);
      const firstRow = (await p.locator('[data-testid="bb-leader-row"]').first().textContent()).replace(/\s+/g, ' ');
      c.ok(firstRow.includes('Elena Marchetti') && firstRow.includes('200'), 'A: start list row 1 = first in run order with her bib');
      c.eq((await p.locator('[data-testid="bb-logo-panel"]').count()), 0, 'D: no logo uploaded → logo panel absent');
      c.ok((await p.locator('[data-testid="bb-still-to-come"]').textContent()).includes('Waiting for the first run'), 'A: Still To Come waits before the first run');
      await shot(p, 'A_start_list');
      await p.close();
      const p2 = await openBoard(tab, `${cloud.base}/broadcast/${ev}?page=4`);
      await p2.locator('[data-testid="bb-leaders"]').waitFor({ timeout: 15000 });
      c.ok(true, 'A: /broadcast/<uuid> resolves too');
      await p2.close();
      const p3 = await openBoard(tab, `${cloud.base}/broadcast/NOPE99`);
      await p3.locator('[data-testid="bb-not-found"]').waitFor({ timeout: 15000 });
      c.ok(true, 'A: unknown code renders "Event not found"');
      await shot(p3, 'A_not_found');
      await p3.close();
    }

    // Run 1: 23 scored + 1 DNF (Juniper Vale, index 7), finalize, add Run 2 (16 down)
    const dnfReg = W.regs[7];
    for (let i = 0; i < W.regs.length; i++) {
      if (i === 7) {
        await api.must('POST', `/api/events/${ev}/runs/status-only`, { registration_id: dnfReg.id, run_number: 1, run_status: 'DNF' });
      } else {
        await playMogulRun(api, ev, judges, W.regs[i].id, 1, ((i * 7) % 11) - 3);
      }
    }
    await api.must('POST', `/api/events/${ev}/runs/round-status/1/finalize`, {});
    await api.must('POST', `/api/events/${ev}/phases`, { phase_type: 'best_of_2', run_order_method: '16_down' });
    const up1 = await api.must('GET', `/api/events/${ev}/runs/upcoming`);
    c.eq(up1.run_number, 2, 'fixture: Run 2 is the active round');
    // three Run 2 scores before the board opens (hydration path for Latest Result)
    for (let i = 0; i < 3; i++) await playMogulRun(api, ev, judges, up1.athletes[i].id, 2, ((i * 5) % 9) - 2);

    // ---- B. Frame 1 -------------------------------------------------------
    {
      const requests = [];
      const p = await openBoard(tab, url, { requests });
      await p.locator('[data-testid="bb-leader-row"]').first().waitFor({ timeout: 15000 });
      const rows = p.locator('[data-testid="bb-leader-row"]');
      const n = await rows.count();
      c.ok(n === 8, `B: leader page 1 shows 8 rows (${n})`);
      const fieldCounts = await rows.evaluateAll(els => els.map(e => e.children.length));
      c.ok(fieldCounts.every(x => x === 5), `B: every leader row carries exactly five fields (${[...new Set(fieldCounts)].join(',')})`);
      const results = await api.must('GET', `/api/events/${ev}/results`);
      const scored = results.filter(r => !r.run_status && !r.effective_status);
      c.eq(scored.length, 23, 'B: 23 scored athletes in /results (one DNF)');
      const r1 = (await rows.first().textContent()).replace(/\s+/g, ' ');
      c.ok(r1.includes(fullName(scored[0])) && r1.includes(Number(scored[0].total_score).toFixed(2)), `B: row 1 = /results rank 1 with the total as returned (${fullName(scored[0])})`);
      c.ok(r1.includes(Number(scored[0].run_time).toFixed(2)), 'B: row 1 carries the run time to two decimals');
      // Still To Come = next three from /runs/upcoming
      const up = await api.must('GET', `/api/events/${ev}/runs/upcoming`);
      const stc = await p.locator('[data-testid="bb-stc-row"]').allTextContents();
      c.eq(stc.length, 3, 'B: Still To Come lists three starters');
      c.ok(stc.every((t, i) => t.replace(/\s+/g, ' ').includes(fullName(up.athletes[i]))), 'B: Still To Come = the next three of /runs/upcoming, in order');
      c.ok(stc.every(t => /Aspen Valley|Steamboat|Winter Park/.test(t)), 'B: Still To Come rows carry the team name');
      // header phase label
      c.eq((await p.locator('[data-testid="bb-phase"]').textContent()).trim(), 'Run 2 of 2', 'B: header phase label reads "Run 2 of 2"');
      // non-interactive
      const pe = await p.locator('[data-testid="broadcast-root"]').evaluate(el => getComputedStyle(el).pointerEvents);
      c.eq(pe, 'none', 'B: root has pointer-events: none');
      const us = await p.locator('[data-testid="broadcast-root"]').evaluate(el => getComputedStyle(el).userSelect || getComputedStyle(el).webkitUserSelect);
      c.eq(us, 'none', 'B: root has user-select: none');
      const interactive = await p.locator('[data-testid="broadcast-root"]').evaluate(el => el.querySelectorAll('button, a, input, select, textarea, [onclick], [tabindex]').length);
      c.eq(interactive, 0, 'B: no button / link / input / onclick / tabindex inside the board');
      const scroll = await p.evaluate(() => ({ x: document.documentElement.scrollWidth > window.innerWidth, y: document.documentElement.scrollHeight > window.innerHeight }));
      c.ok(!scroll.x && !scroll.y, 'B: the page never scrolls');
      await shot(p, 'B_leaders');
      // timer: the leader pages cycle 1–8 / 9–16 / 17–23 (Latest Result pages interleave)
      const captions = await collectCaptions(p, 30000);
      const leaderCaps = captions.filter(t => t.startsWith('LEADERS'));
      c.ok(leaderCaps.includes('LEADERS · RANKS 1–8 OF 23') && leaderCaps.includes('LEADERS · RANKS 9–16 OF 23') && leaderCaps.includes('LEADERS · RANKS 17–23 OF 23'),
        `B: leader pages cycle 1–8, 9–16, 17–23 on the timer (${leaderCaps.join(' | ')})`);
      c.ok(captions.some(t => t.startsWith('LATEST RESULT · UNOFFICIAL · RANKS 1–5 OF 23')), 'B: the Latest Result page is in the cycle (UNOFFICIAL in the caption)');
      // DNF athlete never on a leader row, across the whole cycle
      let sawDnf = false;
      for (let i = 0; i < 20; i++) {
        const txt = (await p.locator('[data-testid="bb-leader-row"]').allTextContents()).join(' ');
        if (txt.includes('Juniper Vale')) sawDnf = true;
        await sleep(600);
      }
      c.ok(!sawDnf, 'B: the DNF athlete never appears on a leader row');
      const html = await p.locator('[data-testid="broadcast-root"]').evaluate(el => el.innerText);
      c.ok(!/\bLIVE\b/.test(html), 'B: no LIVE text anywhere on the board');
      // F: every request stays on the origin
      const offOrigin = requests.filter(u => !u.startsWith('data:') && !u.startsWith('blob:') && new URL(u).origin !== origin);
      c.deepEq(offOrigin, [], 'F: no request leaves the origin (fonts self-hosted)');
      await p.setViewportSize({ width: 1280, height: 720 });
      await sleep(600);
      await shot(p, 'B_leaders');
      const scale = await p.locator('[data-testid="broadcast-stage"]').evaluate(el => el.style.transform);
      c.ok(/scale\(0\.66/.test(scale), `B: stage scales to a 1280x720 window (${scale})`);
      await p.close();
    }

    // ---- C. Latest Result: WebSocket path + poll-only path -----------------
    {
      const p = await openBoard(tab, url);
      await p.locator('[data-testid="bb-leader-row"]').first().waitFor({ timeout: 15000 });
      const up = await api.must('GET', `/api/events/${ev}/runs/upcoming`);
      const who = up.athletes[0];
      const runId = await playMogulRun(api, ev, judges, who.id, 2, 3);
      await p.locator('[data-testid="bb-latest-name"]', { hasText: fullName(who) }).waitFor({ timeout: 20000 });
      const pr = await api.must('GET', `/api/events/${ev}/phases/results`);
      const row = pr.results.find(r => r.registration_id === who.id);
      const res = await api.must('GET', `/api/events/${ev}/results`);
      const rank = res.find(r => r.registration_id === who.id).rank;
      const total = (await p.locator('[data-testid="bb-latest-total"]').textContent()).trim();
      const time = (await p.locator('[data-testid="bb-latest-time"]').textContent()).trim();
      const pos = (await p.locator('[data-testid="bb-latest-pos"]').textContent()).trim();
      c.eq(total, Number(row.runs['2'].total_score).toFixed(2), `C (WS): Latest Result total = the Run 2 total (${total})`);
      c.eq(time, Number(row.runs['2'].run_time).toFixed(2), `C (WS): Latest Result time = the Run 2 time (${time})`);
      const ord = n => `${n}${['TH', 'ST', 'ND', 'RD'][((n % 100) - 20) % 10] || ['TH', 'ST', 'ND', 'RD'][n % 100] || 'TH'}`;
      c.eq(pos, `NOW ${ord(rank)}`, `C (WS): position block = the combined-standings rank (${pos})`);
      const hl = await p.locator('[data-testid="bb-leader-row"].hl').textContent();
      c.ok(hl.replace(/\s+/g, ' ').includes(fullName(who)), 'C (WS): the athlete\'s row is outlined below the hero');
      c.ok(!!runId, 'C (WS): run id returned');
      await shot(p, 'C_latest');
      await p.close();

      // poll-only: WebSocket stubbed, a new score must surface within the 3 s poll
      const q = await openBoard(tab, url, { noWs: true });
      await q.locator('[data-testid="bb-leader-row"]').first().waitFor({ timeout: 15000 });
      const up2 = await api.must('GET', `/api/events/${ev}/runs/upcoming`);
      const who2 = up2.athletes[0];
      await playMogulRun(api, ev, judges, who2.id, 2, 1);
      await q.locator('[data-testid="bb-latest-name"]', { hasText: fullName(who2) }).waitFor({ timeout: 20000 });
      c.ok(true, 'C (poll): with WebSocket stubbed out the 3 s poll still surfaces the new Latest Result');
      await q.close();
    }

    // ---- D. logo panel + the two image endpoints --------------------------
    {
      const meetId = W.meet.id;
      let r = await fetch(`${cloud.base}/api/pdf/logo/${meetId}/image`);
      c.eq(r.status, 404, 'D: GET /logo/:meetId/image → 404 when no logo exists');
      r = await fetch(`${cloud.base}/api/pdf/bottom-logo/${meetId}/image`);
      c.eq(r.status, 404, 'D: GET /bottom-logo/:meetId/image → 404 when no logo exists');
      r = await fetch(`${cloud.base}/api/pdf/logo/..%2F..%2Fpublic%2Flogos%2Fstickit/image`);
      c.eq(r.status, 404, 'D: a traversal-shaped meet id is refused (404)');
      await uploadLogo(cloud.base, meetId, 'upload-logo', LOGO_PNG);
      r = await fetch(`${cloud.base}/api/pdf/logo/${meetId}/image`);
      c.eq(r.status, 200, 'D: event logo image → 200 after upload');
      c.eq(r.headers.get('content-type'), 'image/png', 'D: Content-Type image/png');
      c.eq(r.headers.get('cache-control'), 'no-cache', 'D: Cache-Control no-cache');
      const bytes = Buffer.from(await r.arrayBuffer());
      c.ok(bytes.equals(fs.readFileSync(LOGO_PNG)), 'D: the served bytes equal the uploaded file');
      const p = await openBoard(tab, url);
      await p.locator('[data-testid="bb-logo-panel"]').waitFor({ timeout: 15000 });
      c.eq(await p.locator('[data-testid="bb-logo-img"]').count(), 1, 'D: logo panel shows the event logo');
      c.eq(await p.locator('[data-testid="bb-bottom-logo-img"]').count(), 0, 'D: no bottom logo image yet');
      const src = await p.locator('[data-testid="bb-logo-img"]').getAttribute('src');
      c.ok(src.startsWith(`/api/pdf/logo/${meetId}/image`), `D: the image comes from the new endpoint (${src})`);
      const natural = await p.locator('[data-testid="bb-logo-img"]').evaluate(el => ({ nw: el.naturalWidth, w: el.getBoundingClientRect().width }));
      c.ok(natural.nw > 0 && natural.w <= natural.nw + 1, 'D: the event logo is never upscaled beyond its natural size');
      await shot(p, 'D_logo');
      await p.close();
      await uploadLogo(cloud.base, meetId, 'upload-bottom-logo', BOTTOM_PNG);
      r = await fetch(`${cloud.base}/api/pdf/bottom-logo/${meetId}/image`);
      c.ok(r.status === 200 && Buffer.from(await r.arrayBuffer()).equals(fs.readFileSync(BOTTOM_PNG)), 'D: bottom logo image served unchanged');
      const p2 = await openBoard(tab, url);
      await p2.locator('[data-testid="bb-bottom-logo-img"]').waitFor({ timeout: 15000 });
      c.eq(await p2.locator('[data-testid="bb-logo-img"]').count(), 1, 'D: with both uploaded the panel shows the event logo…');
      c.eq(await p2.locator('[data-testid="bb-bottom-logo-img"]').count(), 1, 'D: …and the bottom logo beneath it');
      await shot(p2, 'D_both_logos');
      await p2.close();
    }

    // ---- Moguls placings: finish Run 2 → UNOFFICIAL, finalize → OFFICIAL ----
    {
      const up = await api.must('GET', `/api/events/${ev}/runs/upcoming`);
      for (let i = 0; i < up.athletes.length; i++) await playMogulRun(api, ev, judges, up.athletes[i].id, 2, ((i * 3) % 9) - 4);
      const p = await openBoard(tab, url);
      await p.locator('[data-testid="bb-podium"]').waitFor({ timeout: 15000 });
      c.eq((await p.locator('[data-testid="bb-badge"]').textContent()).trim(), 'UNOFFICIAL', 'placings: every run complete, not finalized → Final Placings UNOFFICIAL (ruling 09-14-26)');
      const res = await api.must('GET', `/api/events/${ev}/results`);
      const pod1 = await p.locator('[data-testid="bb-pod-1"]').textContent();
      c.ok(pod1.includes(fullName(res[0])) && pod1.includes(Number(res[0].total_score).toFixed(2)), 'placings: podium 1 = /results rank 1 with total');
      const cap = (await p.locator('[data-testid="bb-caption"]').textContent()).trim();
      c.ok(cap.startsWith('PLACES 1–10 OF 24 · TWO RUNS, BEST COUNTS'), `placings: caption (${cap})`);
      const placeRows = await p.locator('[data-testid="bb-place-row"]').allTextContents();
      c.eq(placeRows.length, 7, 'placings: places table page 1 holds 7 rows');
      await shot(p, 'P_unofficial');
      await api.must('POST', `/api/events/${ev}/finalize`, {});
      await p.locator('[data-testid="bb-badge"]', { hasText: /^OFFICIAL$/ }).waitFor({ timeout: 20000 });
      c.eq((await p.locator('[data-testid="bb-badge"]').textContent()).trim(), 'OFFICIAL', 'placings: HJ finalize → OFFICIAL badge');
      // the DNF athlete sits at the bottom with her status, never a total
      const captions = await collectCaptions(p, 9000);
      c.ok(captions.some(t => t.startsWith('PLACES 11–17')), `placings: the list pages on the timer (${captions.join(' | ')})`);
      await p.close();
    }

    // =====================================================================
    // E. Dual, 16 athletes, runoff to 8th
    // =====================================================================
    {
      const D = await makeEvent(api, { name: 'Board Men', gender: 'M', discipline: 'dual_mogul', names: MEN });
      const dv = D.event.id;
      await seedDualJudges(api, dv);
      await api.must('PUT', `/api/events/${dv}/dual/runoff-option`, { runoff_option: 'runoff_to_8th' });
      await api.must('POST', `/api/events/${dv}/dual/seed-random`, {});
      await api.must('POST', `/api/events/${dv}/dual/seed-fis`, {});
      const durl = `${cloud.base}/broadcast/${D.event.short_code}?page=30`;
      await playN(api, dv, 3);
      let bracket = await api.must('GET', `/api/events/${dv}/dual`);
      const p = await openBoard(tab, durl);
      await p.locator('[data-testid="bb-round-board"]').waitFor({ timeout: 15000 });
      const nos = (await p.locator('[data-testid="bb-pair-no"]').allTextContents()).map(t => t.trim());
      const r16 = bracket.filter(m => !m.is_small_final && m.bracket_round === 4 && !m.is_bye).sort((a, b) => a.pairing_number - b.pairing_number);
      c.deepEq(nos, r16.map(m => String(m.pairing_number).padStart(2, '0')), 'E: Round of 16 rows numbered from pairing_number, in run order');
      const nextRow = p.locator('[data-testid="bb-pair-row"][data-next="1"]');
      c.eq(await nextRow.count(), 1, 'E: exactly one row is marked NEXT');
      const expectedNext = readyInOrder(bracket)[0];
      c.ok((await nextRow.locator('[data-testid="bb-pair-no"]').textContent()).trim() === String(expectedNext.pairing_number).padStart(2, '0'), 'E: NEXT = the first playable open match in run order');
      c.ok(/next/i.test(await nextRow.locator('.bb-next-tab').textContent()), 'E: the NEXT tab is rendered');
      // split chips on the completed rows
      const done = r16.filter(m => m.status === 'complete');
      const splits = p.locator('[data-testid="bb-split"]');
      c.eq(await splits.count(), done.length, `E: ${done.length} completed rows show the split chips`);
      for (let i = 0; i < done.length; i++) {
        const m = done[i];
        const blueChip = splits.nth(i).locator('[data-testid="bb-chip-blue"]');
        const redChip = splits.nth(i).locator('[data-testid="bb-chip-red"]');
        const bt = (await blueChip.textContent()).trim(), rt = (await redChip.textContent()).trim();
        const bc = await blueChip.getAttribute('class'), rc = await redChip.getAttribute('class');
        const blueWon = m.winner_registration_id === m.registration_id_blue;
        c.ok(bt === String(m.blue_total) && rt === String(m.red_total), `E: pairing ${m.pairing_number} chips = engine totals ${m.blue_total}/${m.red_total}`);
        c.ok(blueWon ? (/\bblue\b/.test(bc) && /\blose\b/.test(rc)) : (/\bred\b/.test(rc) && /\blose\b/.test(bc)), `E: pairing ${m.pairing_number} winner chip solid ${blueWon ? 'blue' : 'red'}, loser grey`);
      }
      c.ok((await p.locator('[data-testid="bb-phase"]').textContent()).trim() === 'Male Round of 16', 'E: header round title from the round label');
      const coming = await p.locator('[data-testid="bb-coming-up"]').textContent();
      c.ok(/COMING UP · ROUND OF 8/i.test(coming), 'E: Coming Up strip names the next block (Round of 8)');
      c.ok(/Winner of \d+/.test(coming), 'E: unfilled sides read "Winner of N" (feeder pairing number, no course)');
      const legend = await p.locator('[data-testid="bb-legend"]').textContent();
      c.ok(/Blue course/.test(legend) && /Red course/.test(legend), 'E: footer carries the blue / red course legend');
      c.ok(!/\bLIVE\b/.test(await p.locator('[data-testid="broadcast-root"]').evaluate(el => el.innerText)), 'E: no LIVE text on the dual board');
      await shot(p, 'E_round16');
      // play to the end of the semifinal block: 5 more R16 + 4 QF + 4 semis
      await playN(api, dv, 13);
      await p.locator('[data-testid="bb-finals-block"]').waitFor({ timeout: 20000 });
      bracket = await api.must('GET', `/api/events/${dv}/dual`);
      const finalsNos = (await p.locator('[data-testid="bb-finals-block"] [data-testid="bb-pair-no"]').allTextContents()).map(t => t.trim());
      const champ = bracket.find(m => !m.is_small_final && m.bracket_round === 1);
      const f78 = bracket.find(m => m.is_small_final && m.bracket_round === 1 && m.bracket_position === 4);
      c.eq(finalsNos[0], String(champ.pairing_number).padStart(2, '0'), 'E: finals block lists the championship first (highest pairing number)');
      c.eq(finalsNos[3], String(f78.pairing_number).padStart(2, '0'), 'E: …and the 7/8 final last');
      const chips = (await p.locator('[data-testid="bb-finals-block"] [data-testid="bb-round-chip"]').allTextContents()).map(t => t.trim());
      c.deepEq(chips, ['1st / 2nd Place', '3rd / 4th Place', '5th / 6th Place', '7th / 8th Place'], 'E: each finals row labelled from round_name (v2.5.07 wording)');
      const nextFinal = p.locator('[data-testid="bb-finals-block"] [data-testid="bb-pair-row"][data-next="1"] [data-testid="bb-pair-no"]');
      c.eq((await nextFinal.textContent()).trim(), String(f78.pairing_number).padStart(2, '0'), 'E: the 7/8 pairing is marked NEXT (runs first)');
      c.eq((await p.locator('[data-testid="bb-caption"]').textContent()).trim(), 'FINALS BLOCK · RUNS IN REVERSE PLACE ORDER', 'E: finals footer caption');
      // sides as the SERVER placed them (v2.5.07 rule) — the board just mirrors them
      const rows = await p.locator('[data-testid="bb-finals-block"] [data-testid="bb-pair-row"]').allTextContents();
      const nameOf = (reg) => { const r = D.regs.find(x => x.id === reg); const a = r && MEN[D.regs.indexOf(r)]; return a; };
      c.ok(rows[0].includes(nameOf(champ.registration_id_blue)) && rows[0].includes(nameOf(champ.registration_id_red)), 'E: championship row shows the two finalists the bracket placed');
      await shot(p, 'E_finals');
      // 7/8, 5/6, 3/4, championship
      await playN(api, dv, 4);
      await p.locator('[data-testid="bb-podium"]').waitFor({ timeout: 20000 });
      c.eq((await p.locator('[data-testid="bb-badge"]').textContent()).trim(), 'UNOFFICIAL', 'E: championship complete, not finalized → Final Placings UNOFFICIAL');
      const placed = await api.must('GET', `/api/events/${dv}/results`);
      for (const place of [1, 2, 3]) {
        const e = placed.find(x => x.rank === place);
        c.ok((await p.locator(`[data-testid="bb-pod-${place}"]`).textContent()).includes(fullName(e)), `E: podium ${place} = bracket placement ${place} (${fullName(e)})`);
      }
      c.eq(await p.locator('[data-testid="bb-places"].nototal').count(), 1, 'E: dual places table has no score column');
      c.ok(!/\d+\.\d\d/.test(await p.locator('[data-testid="bb-podium"]').textContent()), 'E: dual podium blocks carry no totals');
      c.ok((await p.locator('[data-testid="bb-caption"]').textContent()).includes('DUAL BRACKET'), 'E: dual format line in the footer');
      await shot(p, 'E_placings');
      await api.must('POST', `/api/events/${dv}/finalize`, {});
      await p.locator('[data-testid="bb-badge"]', { hasText: /^OFFICIAL$/ }).waitFor({ timeout: 20000 });
      c.ok(true, 'E: finalize → OFFICIAL');
      await p.setViewportSize({ width: 1280, height: 720 });
      await sleep(500);
      await shot(p, 'E_placings');
      await p.close();

      // ---- G. Scoreboard + Overlay smoke ------------------------------------
      const sb = await openBoard(tab, `${cloud.base}/scoreboard/${code}`);
      await sb.getByText('LIVE SCOREBOARD').waitFor({ timeout: 15000 });
      c.ok(true, 'G: /scoreboard/<code> still renders');
      await sb.close();
      const ov = await openBoard(tab, `${cloud.base}/overlay/${code}`);
      await ov.locator('.stickit-overlay-root').waitFor({ timeout: 15000 });
      c.ok(true, 'G: /overlay/<code> still renders');
      await ov.close();
    }

    // ---- H. password protection ON: the image endpoints stay public ------
    {
      await api.must('POST', '/api/admin/users', { username: 'v260admin', display_name: 'V260 Admin', password: 'v260-password', role: 'system_admin' });
      await api.must('PUT', '/api/admin/auth-settings', { enabled: true });
      const anon = new Api(cloud.base);
      let r = await anon.get('/api/admin/events');
      c.eq(r.status, 401, 'H: protection is on (admin API → 401 without a token)');
      r = await fetch(`${cloud.base}/api/pdf/logo/${W.meet.id}/image`);
      c.eq(r.status, 200, 'H: GET /logo/:meetId/image is public with protection on');
      r = await fetch(`${cloud.base}/api/pdf/bottom-logo/${W.meet.id}/image`);
      c.eq(r.status, 200, 'H: GET /bottom-logo/:meetId/image is public with protection on');
      const p = await openBoard(tab, url);
      await p.locator('[data-testid="bb-podium"]').waitFor({ timeout: 15000 });
      c.ok(true, 'H: the board itself needs no login');
      await p.close();
    }
  } finally {
    await tab.close().catch(() => {});
    await shutdownBrowser().catch(() => {});
    await cloud.stop().catch(() => {});
  }
  return c;
}

module.exports = { main };
