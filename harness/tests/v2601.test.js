/**
 * v2.6.01 acceptance — the redesigned Bracket Keeper PDF
 * (StickIt_Bracket_Keeper_Implementation_Prompt_09-15-26.md, section 7).
 *
 * The keeper only READS the bracket dual.js built; everything on the sheet is
 * derived from data. So the suite checks the derivation against reality and
 * the printed text against the derivation:
 *
 *   1  Routing map vs reality — keeperRoutes()' winner / loser destination and
 *      course equal where advanceWinner actually put every athlete, on a
 *      16-athlete runoff-to-8th bracket played to completion, on 28 athletes
 *      (32 shell, 4 byes) and on 6 athletes (8 shell, unfillable 5–8 semis).
 *   2  Pairing labels — every label printed equals pairing_label from GET /dual;
 *      byes print none; two digits per gender (W-01 / M-14).
 *   3  Page plan — 10-entrant 16 shell: runoff to 8th 3 pages, to 4th 2, none 2;
 *      full 16 → the Round of 16 spills to two pages (4 total); 28 → 5; 32 → 5;
 *      64 shell renders (page count reported); legacy pre-F-2 bracket renders.
 *   4  Pre-printing — every entrant with bib + name in the starting round; a bye
 *      athlete again in the slot they enter, labelled BYE · SEED n.
 *   5  Empty-slot labels — exactly one WINNER / LOSER stub label per structural
 *      slot; every header carries its pointer with course and page number.
 *   6  Mid-day print — after the quarterfinals: same page count, identical box
 *      geometry (every `re` rectangle of the content streams), both names on
 *      completed matches, a circle (4 bezier ops) per winner bib, semifinal /
 *      5–8 semifinal slots filled from the rows.
 *   7  Type floors — no text object below 8 pt (Tf operators), except the
 *      unchanged 7 pt stampFooter line, once per page.
 *   8  /dual-bracket regression — the 32-shell finals page shows both semifinals
 *      and the connectors into the final after the one-line
 *      buildBracketPositions fix; 16- and 8-shell positions are identical to
 *      the old anchor's.
 *   9  Route gate — /bracket-keeper stays requireAuth (401 with protection on);
 *      the regression suites (v2507 / v2506 / v260 / step1 / zz-gates /
 *      verify_v16) run separately.
 */

const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { Checks } = require('../lib/checks');
const { Instance } = require('../lib/instance');
const { Api } = require('../lib/client');
const { buildMeet } = require('../lib/fixtures');
const { seedDualJudges } = require('../lib/driver');
const { openDb } = require('../lib/db');

// the pure keeper helpers (pdf.js has no import-time DB access)
const pdfMod = require('../../server/routes/pdf.js');
const { keeperRoutes, keeperOrigins, buildBracketPositions } = pdfMod;

const SCRATCH = path.join(__dirname, '..', '.scratch', 'v2601');
fs.mkdirSync(SCRATCH, { recursive: true });

// ---- bracket driving --------------------------------------------------------
async function makeDual(api, { name, gender, athletes, runoff }) {
  const M = await buildMeet(api, { name, gender, discipline: 'dual_mogul', athletes, judges: [], startRun: false });
  await seedDualJudges(api, M.event.id);
  await api.must('PUT', `/api/events/${M.event.id}/dual/runoff-option`, { runoff_option: runoff });
  await api.must('POST', `/api/events/${M.event.id}/dual/seed-random`, {});
  await api.must('POST', `/api/events/${M.event.id}/dual/seed-fis`, {});
  return M;
}
const readyInOrder = (bracket) => bracket
  .filter(m => m.status === 'pending' && m.registration_id_blue && m.registration_id_red && !m.is_bye)
  .sort((a, b) => (a.pairing_number ?? 1e9) - (b.pairing_number ?? 1e9));
async function decide(api, eventId, m, side) {
  const bp = side === 'blue' ? 3 : 2, rp = side === 'blue' ? 2 : 3;
  for (let n = 1; n <= 5; n++) {
    await api.must('POST', `/api/events/${eventId}/dual/${m.id}/judge-points`, { judge_number: n, blue_points: bp, red_points: rp });
  }
  await api.must('POST', `/api/events/${eventId}/dual/${m.id}/approve`, {});
}
/** Play matches in pairing order; `stopAfter(m)` true → stop once m is played. */
async function play(api, ev, { onlyRoundAtLeast = 0, mainOnly = false } = {}) {
  for (let g = 0; g < 200; g++) {
    const b = await api.must('GET', `/api/events/${ev}/dual`);
    const next = readyInOrder(b).filter(m => (!mainOnly || !m.is_small_final) && m.bracket_round >= onlyRoundAtLeast)[0];
    if (!next) break;
    await api.must('PUT', `/api/events/${ev}/dual/active-match`, { match_id: next.id });
    await decide(api, ev, next, next.pairing_number % 2 ? 'blue' : 'red');
  }
  return api.must('GET', `/api/events/${ev}/dual`);
}

// ---- PDF inspection --------------------------------------------------------
async function fetchPdf(base, which, eventId, file, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${base}/api/pdf/${which}`, { method: 'POST', headers, body: JSON.stringify({ eventId }) });
  const buf = Buffer.from(await r.arrayBuffer());
  if (r.ok) fs.writeFileSync(file, buf);
  return { status: r.status, buf, file, disposition: r.headers.get('content-disposition') };
}
const pdfInfoPages = (file) => parseInt(execFileSync('pdfinfo', [file]).toString().match(/^Pages:\s+(\d+)/m)[1], 10);
const pdfText = (file, opts = []) => execFileSync('pdftotext', [...opts, file, '-']).toString();
const pdfPagesText = (file, opts = []) => pdfText(file, opts).split('\f').filter((s, i, a) => i < a.length - 1 || s.trim());
const norm = (s) => s.replace(/\s+/g, ' ');

/** Every content-stream operator line of a pdfkit PDF (streams are FlateDecode). */
function contentOps(buf) {
  const ops = [];
  let i = 0;
  const S = Buffer.from('stream\n'), E = Buffer.from('endstream');
  while ((i = buf.indexOf(S, i)) >= 0) {
    const start = i + S.length;
    const end = buf.indexOf(E, start);
    if (end < 0) break;
    const raw = buf.subarray(start, end);
    let txt = null;
    try { txt = zlib.inflateSync(raw).toString('latin1'); } catch (_) { try { txt = zlib.inflateSync(raw.subarray(0, raw.length - 1)).toString('latin1'); } catch (__) { txt = null; } }
    if (txt && /\b(re|Tf|BT|ET)\b/.test(txt)) ops.push(...txt.split('\n'));
    i = end + E.length;
  }
  return ops;
}
const rects = (ops) => ops.filter(l => /\bre$/.test(l)).map(l => l.split(' ').slice(0, 4).map(v => Math.round(parseFloat(v) * 10) / 10).join(',')).sort();
const fontSizes = (ops) => ops.filter(l => /Tf$/.test(l)).map(l => parseFloat(l.split(' ')[1]));
const curveOps = (ops) => ops.filter(l => /\bc$/.test(l)).length;

// ---- the rule, restated independently of the implementation --------------
const winnerCourse = (round, pos) => ((round % 2) === (pos % 2)) ? 'blue' : 'red';
const loserCourse  = (round, pos) => (winnerCourse(round, pos) === 'blue' ? 'red' : 'blue');

/**
 * For a bracket played to completion: every match's routing destination holds
 * the athlete advanceWinner actually put there, in the routed course.
 */
function routingVsReality(c, bracket, runoff, tag) {
  const routes = keeperRoutes(bracket, runoff);
  const byId = new Map(bracket.map(m => [m.id, m]));
  const bad = [];
  let checked = 0;
  for (const m of bracket) {
    if (m.is_bye || m.status !== 'complete' || !m.winner_registration_id) continue;
    const r = routes.get(m.id);
    const winner = m.winner_registration_id;
    const loser = winner === m.registration_id_blue ? m.registration_id_red : m.registration_id_blue;
    if (r.win) {
      checked++;
      const d = byId.get(r.win.id);
      if (!d || d[`registration_id_${r.win.course}`] !== winner) bad.push(`${m.pairing_label}: winner not in ${r.win.course} of ${d && d.pairing_label}`);
      if (!m.is_small_final && r.win.course !== winnerCourse(m.bracket_round, m.bracket_position)) bad.push(`${m.pairing_label}: winner course ≠ rule`);
    }
    if (r.lose) {
      checked++;
      const d = byId.get(r.lose.id);
      if (!d || d[`registration_id_${r.lose.course}`] !== loser) bad.push(`${m.pairing_label}: loser not in ${r.lose.course} of ${d && d.pairing_label}`);
      if (r.lose.course !== loserCourse(m.bracket_round, m.bracket_position)) bad.push(`${m.pairing_label}: loser course ≠ rule`);
    }
    if (r.place) checked++;
  }
  // every bye's advancement too
  for (const m of bracket.filter(mm => mm.is_bye)) {
    const r = routes.get(m.id);
    if (!r.win) { bad.push(`bye ${m.bracket_round}.${m.bracket_position}: no destination`); continue; }
    checked++;
    const d = byId.get(r.win.id);
    if (!d || d[`registration_id_${r.win.course}`] !== m.registration_id_blue) bad.push(`bye ${m.bracket_round}.${m.bracket_position}: athlete not in ${r.win.course} of ${d && d.pairing_label}`);
  }
  c.ok(checked > 0 && bad.length === 0, `${tag}: routing map agrees with advanceWinner for every played match and bye (${checked} destinations${bad.length ? ' — ' + bad.join('; ') : ''})`);
  // the inverse map names the feeder of every filled slot
  const origins = keeperOrigins(bracket, routes);
  const badO = [];
  for (const m of bracket) {
    if (m.is_bye) continue;
    const o = origins.get(m.id) || {};
    for (const side of ['blue', 'red']) {
      const reg = m[`registration_id_${side}`];
      const org = o[side];
      if (!org) { if (reg) badO.push(`${m.pairing_label} ${side}: filled but no origin`); continue; }
      if (org.kind === 'winner' || org.kind === 'loser' || org.kind === 'bye') {
        const f = byId.get(org.from);
        const expect = org.kind === 'loser'
          ? (f.winner_registration_id === f.registration_id_blue ? f.registration_id_red : f.registration_id_blue)
          : f.winner_registration_id;
        if (reg && expect && reg !== expect) badO.push(`${m.pairing_label} ${side}: holds a different athlete than its ${org.kind} origin`);
      }
    }
  }
  c.eq(badO.length, 0, `${tag}: every filled slot holds the athlete its origin label names (${badO.join('; ') || 'none'})`);
}

// ---------------------------------------------------------------------------
async function main() {
  const c = new Checks('v2601');
  const cloud = new Instance({ name: 'v2601-cloud', port: 3313, mode: 'cloud' });
  try {
    await cloud.start();
    const api = new Api(cloud.base);
    const F = (n) => path.join(SCRATCH, n);

    // =====================================================================
    // A. 10-entrant 16 shell (the 09-15-26 test event shape), runoff to 8th
    // =====================================================================
    const A = await makeDual(api, { name: 'Keeper A', gender: 'F', athletes: 10, runoff: 'runoff_to_8th' });
    const evA = A.event.id;
    let bracket = await api.must('GET', `/api/events/${evA}/dual`);
    const rA = await fetchPdf(cloud.base, 'bracket-keeper', evA, F('a_blank.pdf'));
    c.eq(rA.status, 200, 'A: POST /api/pdf/bracket-keeper → 200');
    c.ok(/bracket_keeper/.test(rA.disposition || ''), `A: filename keeps safeFilename(event, 'bracket_keeper') (${rA.disposition})`);
    c.eq(pdfInfoPages(rA.file), 3, 'A: 16 shell, 10 entered, runoff to 8th → 3 pages');
    const textA = pdfText(rA.file, ['-layout']);
    const rawA = pdfText(rA.file, ['-raw']);
    const pagesA = pdfPagesText(rA.file, ['-layout']);
    c.ok(/ROUND OF 16/.test(pagesA[0]) && /QUARTERS/.test(pagesA[1]) && /5TH\s*[–-]\s*8TH RUNOFF/.test(pagesA[2]),
      'A: page titles — ROUND OF 16 / QUARTERS → FINAL / 5TH – 8TH RUNOFF');
    c.ok(/PAGE 1 OF 3/.test(pagesA[0]) && /PAGE 2 OF 3/.test(pagesA[1]) && /PAGE 3 OF 3/.test(pagesA[2]), 'A: BRACKET KEEPER · PAGE n OF N on every page');

    // 2. pairing labels: every non-bye label printed, two digits, W- prefix
    const labels = bracket.filter(m => !m.is_bye && m.pairing_label).map(m => m.pairing_label);
    c.ok(labels.length === 14 && labels.every(l => /^W-\d\d$/.test(l)), `A: 14 labels, all W-nn (${labels[0]} … ${labels[labels.length - 1]})`);
    c.ok(labels.every(l => textA.includes(l)), 'A: every pairing_label from GET /dual is printed');
    c.ok(!/W-0[0]\b|W-1[5-9]/.test(textA), 'A: no label outside W-01 … W-14 (byes carry none, no second numbering)');
    const byes = bracket.filter(m => m.is_bye);
    c.eq(byes.length, 6, 'A: six byes');
    c.ok(byes.every(m => new RegExp(`${m.blue_bib}\\s+${m.blue_last.toUpperCase()}, ${m.blue_first}`).test(pagesA[0]))
      && (pagesA[0].match(/DOES NOT SKI\s+W-\d\d · (RED|BLUE)/g) || []).length === 6 && (pagesA[0].match(/ALREADY ON PAGE 2/g) || []).length === 6,
      'A: every bye is a strip — bib, name, DOES NOT SKI → W-nn · COURSE, ALREADY ON PAGE 2 — on the Round of 16 page');
    c.ok(!/BYE\s+W-\d\d\s/.test(pagesA[0]), 'A: bye strips carry no pairing label');

    // 4. pre-printing: every entrant with bib + name in the starting round; bye athletes again where they enter
    const first = bracket.filter(m => m.bracket_round === 4 && !m.is_small_final);
    const entrants = [];
    for (const m of first) for (const s of ['blue', 'red']) if (m[`registration_id_${s}`]) entrants.push({ bib: m[`${s}_bib`], last: m[`${s}_last`].toUpperCase(), first: m[`${s}_first`] });
    c.eq(entrants.length, 10, 'A: ten entrants in the Round of 16');
    c.ok(entrants.every(e => new RegExp(`${e.bib}\\s+${e.last}, ${e.first}`).test(pagesA[0])), 'A: every entrant pre-printed with bib and name on page 1');
    c.ok(entrants.every(e => (textA.match(new RegExp(`${e.last}, ${e.first}`, 'g')) || []).length >= 2), 'A: every entrant also appears in the start list');
    const routesA = keeperRoutes(bracket, 'runoff_to_8th');
    const originsA = keeperOrigins(bracket, routesA);
    const byIdA = new Map(bracket.map(m => [m.id, m]));
    let byeOk = 0;
    for (const b of byes) {
      const d = byIdA.get(routesA.get(b.id).win.id);
      const seed = b.blue_dual_seed ?? b.seed_blue;
      // the destination quarterfinal (page 2) prints the athlete and the BYE · SEED n origin
      if (new RegExp(`${b.blue_bib}\\s+${b.blue_last.toUpperCase()}, ${b.blue_first}`).test(pagesA[1]) && new RegExp(`SEED ${seed}\\b`).test(pagesA[1]) && d[`registration_id_${routesA.get(b.id).win.course}`] === b.registration_id_blue) byeOk++;
    }
    c.eq(byeOk, 6, 'A: every bye athlete is pre-printed in the quarterfinal slot they enter, with BYE · SEED n');
    c.ok((rawA.match(/^BYE$/gm) || []).length >= 6, 'A: BYE origin labels in the stubs');

    // 5. empty-slot labels + pointers
    const expectStub = { WINNER: 0, LOSER: 0 };
    for (const m of bracket) {
      if (m.is_bye) continue;
      const o = originsA.get(m.id) || {};
      for (const s of ['blue', 'red']) if (o[s] && (o[s].kind === 'winner' || o[s].kind === 'loser')) expectStub[o[s].kind.toUpperCase()]++;
    }
    const stubW = (rawA.match(/^WINNER$/gm) || []).length, stubL = (rawA.match(/^LOSER$/gm) || []).length;
    c.eq(stubW, expectStub.WINNER, `A: one WINNER stub label per winner-fed slot (${expectStub.WINNER})`);
    c.eq(stubL, expectStub.LOSER, `A: one LOSER stub label per loser-fed slot (${expectStub.LOSER})`);
    // pointers — course and page per the routing map, page numbers from the plan (1 = R16, 2 = QF..F, 3 = runoff)
    const pageOfA = {};
    for (const m of bracket) {
      const key = m.pairing_label;
      if (!key) continue;
      if (m.bracket_round === 4) pageOfA[m.id] = 1;
      else if (m.is_small_final && (m.bracket_round === 2 || m.bracket_position >= 3)) pageOfA[m.id] = 3;
      else pageOfA[m.id] = 2;
    }
    const tA = norm(textA);
    let ptrOk = 0, ptrN = 0, ptrBad = [];
    for (const m of bracket) {
      if (m.is_bye) continue;
      const r = routesA.get(m.id);
      for (const [kind, d] of [['WINNER', r.win], ['LOSER', r.lose]]) {
        if (!d) continue;
        ptrN++;
        const dm = byIdA.get(d.id);
        let s = `${dm.pairing_label} · ${d.course.toUpperCase()}`;
        if (pageOfA[d.id] !== pageOfA[m.id]) s += ` · PG.${pageOfA[d.id]}`;
        if (tA.includes(s)) ptrOk++; else ptrBad.push(`${m.pairing_label} ${kind} → ${s}`);
      }
    }
    c.eq(ptrOk, ptrN, `A: every header pointer names its destination, course and page (${ptrN}${ptrBad.length ? ' — missing: ' + ptrBad.join('; ') : ''})`);
    c.ok(/LOSER\s+ELIMINATED/.test(tA), 'A: a loser with no destination prints LOSER → ELIMINATED');
    c.ok(/CHAMPIONSHIP FINAL · 1ST \/ 2ND/.test(tA) && /THIRD \/ FOURTH/.test(tA) && /FIFTH \/ SIXTH/.test(tA) && /SEVENTH \/ EIGHTH/.test(tA), 'A: place-deciding matches show the placing instead of pointers');
    c.ok(/COPY BOTH SEMIFINAL LOSERS IN BY HAND/.test(tA) && /COPY BOTH LOSERS FROM THE LEFT IN BY HAND/.test(tA) && !/NO LINE/.test(tA), 'A: no-line boxes carry the action caption, never a "NO LINE" caption');
    c.ok(/WINNER W-14/.test(tA) && /LOSER W-14/.test(tA) && /WINNER W-11/.test(tA) && /LOSER W-11/.test(tA), 'A: result panel pre-labels places 1–8 with WINNER/LOSER W-nn');
    c.ok(/Matches ski in number order, W-01 through W-14/.test(norm(pagesA[0])) && /Circle the winner/.test(pagesA[0]) && /FIRST MATCH/.test(pagesA[0]) && /10 ENTERED · 6 BYES/.test(pagesA[0]),
      'A: page 1 carries the how-to block (six steps) and the start list (10 ENTERED · 6 BYES, FIRST MATCH column)');
    c.ok(/R16 HERE/.test(pagesA[0]) && /QF PG2/.test(pagesA[0]) && /5-8 PG3/.test(pagesA[0]), 'A: run-order strip cells — R16 HERE / QF PG2 / 5-8 PG3');
    c.ok(!/sheet/i.test(tA.replace(/spreadsheet/gi, '')), 'A: the word "sheet" never appears (page / PG.)');

    // 7. type floors
    const opsA = contentOps(rA.buf);
    const sizesA = fontSizes(opsA);
    const below8 = sizesA.filter(s => s < 8);
    c.ok(sizesA.length > 50, `A: parsed ${sizesA.length} Tf operators`);
    c.ok(below8.every(s => s === 7) && below8.length <= 3, `A: no pre-printed text below 8 pt except the unchanged 7 pt stampFooter line (${below8.length} × 7 pt)`);

    // 6. mid-day: play the Round of 16 and the quarterfinals, print again
    const midA = await play(api, evA, { onlyRoundAtLeast: 3, mainOnly: true });
    c.eq(midA.filter(m => !m.is_small_final && m.bracket_round >= 3 && !m.is_bye && m.status === 'complete').length, 6, 'A: 2 Round-of-16 matches + 4 quarterfinals played');
    const rA2 = await fetchPdf(cloud.base, 'bracket-keeper', evA, F('a_mid.pdf'));
    c.eq(pdfInfoPages(rA2.file), 3, 'A mid-day: still 3 pages');
    const opsA2 = contentOps(rA2.buf);
    c.deepEq(rects(opsA2).length, rects(opsA).length, 'A mid-day: same number of rectangles');
    c.ok(rects(opsA2).join('|') === rects(opsA).join('|'), 'A mid-day: every box, cell, strip and tick rectangle is at the identical position');
    c.eq(curveOps(opsA2) - curveOps(opsA), 6 * 4, 'A mid-day: one printed circle (4 bezier ops) around each of the 6 winners\' bibs');
    const textA2 = norm(pdfText(rA2.file, ['-layout']));
    const done = midA.filter(m => !m.is_bye && m.status === 'complete');
    c.ok(done.every(m => textA2.includes(`${m.blue_last.toUpperCase()}, ${m.blue_first}`) && textA2.includes(`${m.red_last.toUpperCase()}, ${m.red_first}`)), 'A mid-day: completed matches print both names');
    const semisA = midA.filter(m => m.bracket_round === 2 && !m.is_bye);
    c.ok(semisA.length === 4 && semisA.every(m => m.registration_id_blue && m.registration_id_red), 'A mid-day: both semifinals and both 5–8 semifinals are filled');
    c.ok(semisA.every(m => textA2.includes(`${m.blue_last.toUpperCase()}, ${m.blue_first}`) && textA2.includes(`${m.red_last.toUpperCase()}, ${m.red_first}`)), 'A mid-day: semifinal and 5–8 semifinal slots print the athletes from the rows');
    const finalA = await play(api, evA);
    routingVsReality(c, finalA, 'runoff_to_8th', 'A complete');
    const rA3 = await fetchPdf(cloud.base, 'bracket-keeper', evA, F('a_done.pdf'));
    const textA3 = norm(pdfText(rA3.file, ['-layout']));
    const fin = finalA.find(m => m.bracket_round === 1 && !m.is_small_final);
    const champ = fin.winner_registration_id === fin.registration_id_blue ? `${fin.blue_last.toUpperCase()}, ${fin.blue_first}` : `${fin.red_last.toUpperCase()}, ${fin.red_first}`;
    c.ok(new RegExp(`1\\s+\\d+\\s+${champ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+WINNER W-14`).test(textA3), 'A complete: the result panel prints the champion on line 1');

    // =====================================================================
    // B. page plans: runoff to 4th / no runoff (10 entrants), full 16
    // =====================================================================
    const B4 = await makeDual(api, { name: 'Keeper B4', gender: 'F', athletes: 10, runoff: 'runoff_to_4th' });
    const rB4 = await fetchPdf(cloud.base, 'bracket-keeper', B4.event.id, F('b4.pdf'));
    c.eq(pdfInfoPages(rB4.file), 2, 'B: 16 shell, 10 entered, runoff to 4th → 2 pages');
    const tB4 = norm(pdfText(rB4.file, ['-layout']));
    c.ok(/THIRD \/ FOURTH/.test(tB4) && /WINNER W-10/.test(tB4) && /LOSER W-09/.test(tB4) && !/FIFTH/.test(tB4), 'B: runoff to 4th — 3/4 box + result panel places 1–4 on page 2');
    const B0 = await makeDual(api, { name: 'Keeper B0', gender: 'M', athletes: 10, runoff: 'no_runoff' });
    const rB0 = await fetchPdf(cloud.base, 'bracket-keeper', B0.event.id, F('b0.pdf'));
    c.eq(pdfInfoPages(rB0.file), 2, 'B: 16 shell, 10 entered, no runoff → 2 pages');
    const tB0 = norm(pdfText(rB0.file, ['-layout']));
    c.ok(!/THIRD \/ FOURTH/.test(tB0) && /WINNER M-09/.test(tB0) && /LOSER M-09/.test(tB0) && /^.*M-0\d.*$/.test(tB0), 'B: no runoff — no 3/4 box, result panel places 1–2, labels M-nn');
    const B16 = await makeDual(api, { name: 'Keeper B16', gender: 'M', athletes: 16, runoff: 'runoff_to_8th' });
    const rB16 = await fetchPdf(cloud.base, 'bracket-keeper', B16.event.id, F('b16.pdf'));
    c.eq(pdfInfoPages(rB16.file), 4, 'B: full 16 (no byes) — the Round of 16 needs two pages at ½-inch rows → 4 pages');
    const pB16 = pdfPagesText(rB16.file, ['-layout']);
    c.ok(/PART 1 OF 2/.test(pB16[0]) && /PART 2 OF 2/.test(pB16[1]) && /FIRST MATCH/.test(pB16[0]) && /16 ENTERED/.test(pB16[0]), 'B: full 16 — ROUND OF 16 · PART 1 OF 2 / PART 2 OF 2, start list on page 1');
    c.ok(/M-\d\d · (BLUE|RED) · PG\.3/.test(norm(pB16[0])), 'B: full 16 — Round of 16 pointers name the quarterfinal page (PG.3)');

    // =====================================================================
    // C. 28 athletes (32 shell, 4 byes): 5 pages, routing vs reality, /dual-bracket fix
    // =====================================================================
    const C28 = await makeDual(api, { name: 'Keeper C', gender: 'F', athletes: 28, runoff: 'runoff_to_8th' });
    const evC = C28.event.id;
    bracket = await api.must('GET', `/api/events/${evC}/dual`);
    const rC = await fetchPdf(cloud.base, 'bracket-keeper', evC, F('c_blank.pdf'));
    c.eq(pdfInfoPages(rC.file), 5, 'C: 32 shell, 28 entered → 5 pages (one quarter per page + semifinals & finals)');
    const pC = pdfPagesText(rC.file, ['-layout']);
    c.ok(/QUARTER 1 · UPPER HALF/.test(pC[0]) && /QUARTER 4 · LOWER HALF/.test(pC[3]) && /SEMIFINALS & FINALS/.test(pC[4]), 'C: page titles QUARTER 1 · UPPER HALF … SEMIFINALS & FINALS');
    c.ok(/MATCHES ON/.test(pC[0]) && /ON TO/.test(pC[0]) && /PG\.5/.test(pC[0]) && !/W-3\d/.test(pC[0].split('Circle the winner')[0]), 'C: 32 shell strip lists only the matches on this page plus where its output goes (ON TO PG.5)');
    const qfs = bracket.filter(m => m.bracket_round === 3 && !m.is_small_final);
    c.ok(qfs.every((m, i) => pC[i].includes(m.pairing_label)), 'C: quarterfinal q sits on page q');
    const semisC = bracket.filter(m => m.bracket_round === 2);
    c.ok(semisC.length === 4 && semisC.every(m => pC[4].includes(m.pairing_label)), 'C: both semifinals and both 5–8 semifinals on page 5');
    const labelsC = bracket.filter(m => !m.is_bye).map(m => m.pairing_label);
    const tC = norm(pdfText(rC.file, ['-layout']));
    c.ok(labelsC.length === 32 && labelsC.every(l => /^W-\d\d$/.test(l) && tC.includes(l)), 'C: all 32 labels printed, two digits');
    const entrantsC = [];
    for (const m of bracket.filter(mm => mm.bracket_round === 5 && !mm.is_small_final)) for (const s of ['blue', 'red']) if (m[`registration_id_${s}`]) entrantsC.push(`${m[`${s}_last`].toUpperCase()}, ${m[`${s}_first`]}`);
    c.ok(entrantsC.length === 28 && entrantsC.every(n => tC.includes(n)), 'C: all 28 entrants pre-printed in the Round of 32');
    const sizesC = fontSizes(contentOps(rC.buf)).filter(s => s < 8);
    c.ok(sizesC.every(s => s === 7) && sizesC.length <= 5, 'C: type floor holds on the 32 shell');
    // /dual-bracket regression (6.1): the [3,2,1] page shows both semifinals + final
    const rDB = await fetchPdf(cloud.base, 'dual-bracket', evC, F('c_dual_bracket.pdf'));
    c.eq(rDB.status, 200, 'C: /dual-bracket renders');
    const pDB = pdfPagesText(rDB.file, ['-layout']);
    c.eq(pDB.length, 2, 'C: /dual-bracket 32 shell → 2 pages');
    const mainSemis = bracket.filter(m => m.bracket_round === 2 && !m.is_small_final);
    const finalC = bracket.find(m => m.bracket_round === 1 && !m.is_small_final);
    c.ok(mainSemis.every(m => pDB[1].includes(m.pairing_label)) && pDB[1].includes(finalC.pairing_label), `C: /dual-bracket finals page shows BOTH semifinals (${mainSemis.map(m => m.pairing_label).join(', ')}) and the final — the second semifinal used to be dropped`);
    const doneC = await play(api, evC);
    routingVsReality(c, doneC, 'runoff_to_8th', 'C complete (32 shell)');
    const rC2 = await fetchPdf(cloud.base, 'bracket-keeper', evC, F('c_done.pdf'));
    c.eq(pdfInfoPages(rC2.file), 5, 'C complete: still 5 pages');
    c.ok(rects(contentOps(rC2.buf)).join('|') === rects(contentOps(rC.buf)).join('|'), 'C complete: geometry identical to the blank sheet');

    // buildBracketPositions: unit regression of the one-line fix
    {
      const mk = (rounds) => { const all = []; for (const r of rounds) for (let p = 1; p <= 2 ** (r - 1); p++) all.push({ bracket_round: r, bracket_position: p }); return all; };
      const oldPositions = (rounds, seedMatches, colW, boxW, colX0, areaTop, areaH, allMain, bracketTotal, boxH) => {
        const pos = {}; const firstRound = rounds[0]; pos[firstRound] = {};
        const n = seedMatches.length; const gap = n > 1 ? (areaH - n * boxH) / (n + 1) : 0; const startY = n > 1 ? areaTop + gap : areaTop + (areaH - boxH) / 2;
        seedMatches.forEach((m, i) => { const y = startY + i * (boxH + gap); pos[firstRound][m.bracket_position] = { x: colX0, y, centerY: y + boxH / 2, rightX: colX0 + 2 + boxW }; });
        for (let ci = 1; ci < rounds.length; ci++) {
          const round = rounds[ci], prevRound = rounds[ci - 1]; pos[round] = {}; const colX = colX0 + ci * colW;
          const seedPositions = seedMatches.map(m => m.bracket_position); const divisor = Math.pow(2, bracketTotal - round);
          const posMin = Math.ceil(Math.min(...seedPositions) / divisor), posMax = Math.ceil(Math.max(...seedPositions) / divisor);
          for (const m of allMain.filter(mm => mm.bracket_round === round && mm.bracket_position >= posMin && mm.bracket_position <= posMax)) {
            const f1 = pos[prevRound]?.[2 * m.bracket_position - 1], f2 = pos[prevRound]?.[2 * m.bracket_position];
            const centerY = (f1 && f2) ? (f1.centerY + f2.centerY) / 2 : f1 ? f1.centerY : f2 ? f2.centerY : areaTop + areaH / 2;
            pos[round][m.bracket_position] = { x: colX, y: centerY - boxH / 2, centerY, rightX: colX + 2 + boxW };
          }
        }
        return pos;
      };
      const all16 = mk([4, 3, 2, 1]), seeds16 = all16.filter(m => m.bracket_round === 4);
      c.eq(JSON.stringify(buildBracketPositions([4, 3, 2, 1], seeds16, 180, 164, 36, 100, 400, all16, 4, 22)), JSON.stringify(oldPositions([4, 3, 2, 1], seeds16, 180, 164, 36, 100, 400, all16, 4, 22)),
        'C: buildBracketPositions — 16-shell single page identical to the old anchor (first round drawn = top of the bracket)');
      const all8 = mk([3, 2, 1]), seeds8 = all8.filter(m => m.bracket_round === 3);
      c.eq(JSON.stringify(buildBracketPositions([3, 2, 1], seeds8, 240, 224, 36, 100, 400, all8, 3, 22)), JSON.stringify(oldPositions([3, 2, 1], seeds8, 240, 224, 36, 100, 400, all8, 3, 22)),
        'C: buildBracketPositions — 8-shell identical to the old anchor');
      const all32 = mk([5, 4, 3, 2, 1]), seeds32qf = all32.filter(m => m.bracket_round === 3);
      const newP = buildBracketPositions([3, 2, 1], seeds32qf, 240, 224, 36, 100, 400, all32, 5, 22);
      const oldP = oldPositions([3, 2, 1], seeds32qf, 240, 224, 36, 100, 400, all32, 5, 22);
      c.ok(Object.keys(oldP[2]).length === 1 && Object.keys(newP[2]).length === 2 && newP[1][1] && newP[2][2].centerY > newP[2][1].centerY,
        'C: buildBracketPositions — 32-shell [3,2,1] page: the old anchor placed one semifinal, the fix places both (and the final)');
    }

    // =====================================================================
    // D. 6 athletes (8 shell, byes, unfillable 5–8 semis) + 32 full + 4 shell
    // =====================================================================
    const D6 = await makeDual(api, { name: 'Keeper D6', gender: 'M', athletes: 6, runoff: 'runoff_to_8th' });
    const rD = await fetchPdf(cloud.base, 'bracket-keeper', D6.event.id, F('d6.pdf'));
    c.eq(rD.status, 200, 'D: 6-athlete keeper renders');
    c.eq(pdfInfoPages(rD.file), 2, 'D: 8 shell, runoff to 8th → 2 pages');
    const tD = norm(pdfText(rD.file, ['-layout']));
    c.ok(/NO LOSER/.test(tD), 'D: a 5–8 semifinal slot fed by a bye quarterfinal reads NO LOSER (BYE)');
    const doneD = await play(api, D6.event.id);
    routingVsReality(c, doneD, 'runoff_to_8th', 'D complete (8 shell, byes)');
    const D32 = await makeDual(api, { name: 'Keeper D32', gender: 'M', athletes: 32, runoff: 'runoff_to_8th' });
    const rD32 = await fetchPdf(cloud.base, 'bracket-keeper', D32.event.id, F('d32.pdf'));
    c.eq(pdfInfoPages(rD32.file), 5, 'D: full 32 (no byes) → 5 pages');
    const D4 = await makeDual(api, { name: 'Keeper D4', gender: 'F', athletes: 4, runoff: 'runoff_to_4th' });
    const rD4 = await fetchPdf(cloud.base, 'bracket-keeper', D4.event.id, F('d4.pdf'));
    c.eq(pdfInfoPages(rD4.file), 1, 'D: 4 shell → 1 page');
    c.ok(/SEMIS/.test(pdfText(rD4.file)) && /WINNER W-04/.test(norm(pdfText(rD4.file, ['-layout']))), 'D: 4 shell — SEMIS → FINAL title, result panel');

    // =====================================================================
    // E. 64 shell (compact variant): 50 entrants and a near-full draw
    // =====================================================================
    const E50 = await makeDual(api, { name: 'Keeper E50', gender: 'M', athletes: 50, runoff: 'runoff_to_8th' });
    const rE = await fetchPdf(cloud.base, 'bracket-keeper', E50.event.id, F('e50.pdf'));
    c.eq(rE.status, 200, 'E: 50-entrant 64 shell renders');
    const nE = pdfInfoPages(rE.file);
    c.ok(nE >= 5 && nE <= 9, `E: 50-entrant 64 shell → ${nE} pages (5 when every quarter's byes leave room, a quarter spills to two pages otherwise)`);
    const pE = pdfPagesText(rE.file, ['-layout']);
    c.ok(/ROUND OF 64/.test(pE[0]) && /SEMIFINALS & FINALS/.test(pE[nE - 1]), 'E: Round of 64 on page 1, semifinals & finals last');
    const bE = await api.must('GET', `/api/events/${E50.event.id}/dual`);
    const tE = norm(pdfText(rE.file, ['-layout']));
    c.ok(bE.filter(m => !m.is_bye).every(m => tE.includes(m.pairing_label)), 'E: every label printed on the 64 shell');
    const sizesE = fontSizes(contentOps(rE.buf)).filter(s => s < 8);
    c.ok(sizesE.every(s => s === 7) && sizesE.length <= nE, 'E: compact variant keeps the 8 pt floor');
    const E62 = await makeDual(api, { name: 'Keeper E62', gender: 'F', athletes: 62, runoff: 'runoff_to_8th' });
    const rE62 = await fetchPdf(cloud.base, 'bracket-keeper', E62.event.id, F('e62.pdf'));
    const nE62 = pdfInfoPages(rE62.file);
    c.ok(rE62.status === 200 && nE62 >= 6, `E: near-full 64 shell renders, spilled quarters → ${nE62} pages`);

    // =====================================================================
    // F. legacy pre-F-2 bracket (round-2 small finals terminal, no round-1 pos 3/4)
    // =====================================================================
    const FL = await makeDual(api, { name: 'Keeper F', gender: 'M', athletes: 8, runoff: 'runoff_to_8th' });
    {
      const db = openDb(cloud.dbPath);
      await db.execute('DELETE FROM dual_bracket WHERE event_id=? AND is_small_final=1 AND bracket_round=1 AND bracket_position IN (3,4)', [FL.event.id]);
      db.close();
    }
    const bF = await api.must('GET', `/api/events/${FL.event.id}/dual`);
    c.ok(!bF.some(m => m.is_small_final && m.bracket_round === 1 && m.bracket_position >= 3) && bF.filter(m => m.is_small_final && m.bracket_round === 2).length === 2, 'F: legacy shape in place');
    const rF = await fetchPdf(cloud.base, 'bracket-keeper', FL.event.id, F('f_legacy.pdf'));
    c.eq(rF.status, 200, 'F: legacy pre-F-2 bracket renders without error');
    const tF = norm(pdfText(rF.file, ['-layout']));
    c.ok(/FIFTH \/ SIXTH/.test(tF) && /SEVENTH \/ EIGHTH/.test(tF) && /WINNER M-0\d/.test(tF), 'F: legacy round-2 small finals print as the terminal 5/6 and 7/8 finals with result-panel sources');
    const routesF = keeperRoutes(bF, 'runoff_to_8th');
    const legacy56 = bF.find(m => m.is_small_final && m.bracket_round === 2 && m.bracket_position === 3);
    c.deepEq(routesF.get(legacy56.id).place, { win: 5, lose: 6 }, 'F: legacy (2,3) decides 5th / 6th');

    // =====================================================================
    // G. route gate: /bracket-keeper stays requireAuth
    // =====================================================================
    await api.must('POST', '/api/admin/users', { username: 'v2601admin', display_name: 'V2601 Admin', password: 'v2601-password', role: 'system_admin' });
    await api.must('PUT', '/api/admin/auth-settings', { enabled: true });
    const rG = await fetchPdf(cloud.base, 'bracket-keeper', evA, F('g.pdf'));
    c.eq(rG.status, 401, 'G: password protection ON → POST /api/pdf/bracket-keeper is 401 without a token (requireAuth kept)');
    const login = await new Api(cloud.base).post('/api/auth/login', { username: 'v2601admin', password: 'v2601-password' });
    const rG2 = await fetchPdf(cloud.base, 'bracket-keeper', evA, F('g2.pdf'), login.data && login.data.token);
    c.eq(rG2.status, 200, 'G: … and 200 with a token');
    const errs = cloud.log.filter(l => /bracket-keeper PDF error|dual-bracket PDF error/.test(l));
    c.eq(errs.length, 0, `G: no keeper / bracket PDF errors in the server log${errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await cloud.stop().catch(() => {});
  }
  return c;
}

module.exports = { main };
