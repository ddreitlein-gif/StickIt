/**
 * v2.6.02 acceptance — the Bracket Keeper PDF (Winfree-style line tree).
 *
 * The keeper only READS the bracket dual.js built; everything on the sheet is
 * derived from data. The suite checks the derivation against reality and the
 * printed text against the derivation:
 *
 *   1  Routing map vs reality — keeperRoutes()' winner / loser destination and
 *      course equal where advanceWinner actually put every athlete, on a
 *      16-athlete runoff-to-8th bracket played to completion, on 28 athletes
 *      (32 shell, 4 byes) and on 6 athletes (8 shell, unfillable 5–8 semis).
 *   2  Pairing labels — every label printed equals pairing_label from GET /dual;
 *      byes print none; two digits per gender (W-01 / M-14).
 *   3  Page plan — 16 shell 2 pages (1 for runoff to 4th / none); 28 and 32
 *      athletes 3; 8 shell 2 (runoff to 8th); 64 shell 6; legacy pre-F-2 bracket renders.
 *   4  Pre-printing — every entrant with bib, name and seed on their first-round
 *      line; a bye athlete pre-printed on the line they enter.
 *   5  Open lines — exactly one "Won W-nn" / "Lost W-nn" per empty structural
 *      slot; section outputs name the next match and page, or the placing.
 *   6  Mid-day print — after the quarterfinals: same page count, identical line
 *      geometry, the winners printed on the next round's lines.
 *   7  Type — nothing below 7 pt (the 7 pt stampFooter line is the floor).
 *   8  /dual-bracket regression — the 32-shell finals page shows both semifinals
 *      and the connectors into the final after the one-line
 *      buildBracketPositions fix; 16- and 8-shell positions identical to the
 *      old anchor's.
 *   9  Route gate — /bracket-keeper stays requireAuth (401 with protection on).
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
const name = (m, side) => `${m[`${side}_last`].toUpperCase()}, ${m[`${side}_first`]}`;
const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
    if (txt && /\b(re|Tf|BT|ET|l)\b/.test(txt)) ops.push(...txt.split('\n'));
    i = end + E.length;
  }
  return ops;
}
const lines = (ops) => ops.filter(l => /\b(l|m)$/.test(l)).map(l => l.split(' ').slice(0, 2).map(v => Math.round(parseFloat(v) * 10) / 10).join(',') + l.slice(-1)).sort();
const fontSizes = (ops) => ops.filter(l => /Tf$/.test(l)).map(l => parseFloat(l.split(' ')[1]));

// ---- the rule, restated independently of the implementation --------------
const winnerCourse = (round, pos) => ((round % 2) === (pos % 2)) ? 'blue' : 'red';
const loserCourse  = (round, pos) => (winnerCourse(round, pos) === 'blue' ? 'red' : 'blue');

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
  for (const m of bracket.filter(mm => mm.is_bye)) {
    const r = routes.get(m.id);
    if (!r.win) { bad.push(`bye ${m.bracket_round}.${m.bracket_position}: no destination`); continue; }
    checked++;
    const d = byId.get(r.win.id);
    if (!d || d[`registration_id_${r.win.course}`] !== m.registration_id_blue) bad.push(`bye ${m.bracket_round}.${m.bracket_position}: athlete not in ${r.win.course} of ${d && d.pairing_label}`);
  }
  c.ok(checked > 0 && bad.length === 0, `${tag}: routing map agrees with advanceWinner for every played match and bye (${checked} destinations${bad.length ? ' — ' + bad.join('; ') : ''})`);
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

/** Expected "Won W-nn" / "Lost W-nn" counts: one per EMPTY slot fed by a match. */
function expectedOpenLabels(bracket, runoff) {
  const routes = keeperRoutes(bracket, runoff), origins = keeperOrigins(bracket, routes);
  let won = 0, lost = 0;
  for (const m of bracket) {
    if (m.is_bye) continue;
    const o = origins.get(m.id) || {};
    for (const s of ['blue', 'red']) {
      if (m[`registration_id_${s}`] || !o[s]) continue;
      if (o[s].kind === 'winner') won++;
      if (o[s].kind === 'loser') lost++;
    }
  }
  return { won, lost };
}
const countRaw = (raw, re) => (raw.match(re) || []).length;

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
    c.eq(pdfInfoPages(rA.file), 2, 'A: 16 shell, runoff to 8th → 2 pages (tree + 3rd/4th, then 5th–8th and 7th/8th)');
    const textA = pdfText(rA.file, ['-layout']);
    const rawA = pdfText(rA.file, ['-raw']);
    const pagesA = pdfPagesText(rA.file, ['-layout']);
    c.ok(/Round of 16 to Final/.test(pagesA[0]) && /3rd \/ 4th Place/.test(pagesA[0]) && /5th – 8th Place/.test(pagesA[1]) && /7th \/ 8th Place/.test(pagesA[1]), 'A: section titles — Round of 16 to Final + 3rd/4th on page 1, 5th–8th + 7th/8th on page 2');
    c.ok(/Page 1 of 2/.test(pagesA[0]) && /Page 2 of 2/.test(pagesA[1]), 'A: Page n of N in the footer');

    // 2. pairing labels
    const labels = bracket.filter(m => !m.is_bye && m.pairing_label).map(m => m.pairing_label);
    c.ok(labels.length === 14 && labels.every(l => /^W-\d\d$/.test(l)), `A: 14 labels, all W-nn (${labels[0]} … ${labels[labels.length - 1]})`);
    c.ok(labels.every(l => textA.includes(l)), 'A: every pairing_label from GET /dual is printed');
    c.ok(!/W-0[0]\b|W-1[5-9]|W-[2-9]\d/.test(textA), 'A: no label outside W-01 … W-14 (byes carry none, no second numbering)');

    // 4. pre-printing
    const first = bracket.filter(m => m.bracket_round === 4 && !m.is_small_final);
    const byes = first.filter(m => m.is_bye);
    c.eq(byes.length, 6, 'A: six byes');
    const entrants = [];
    for (const m of first) for (const s of ['blue', 'red']) if (m[`registration_id_${s}`]) entrants.push({ m, s });
    c.eq(entrants.length, 10, 'A: ten entrants in the Round of 16');
    c.ok(entrants.filter(e => !e.m.is_bye).every(e => new RegExp(`${e.m[`${e.s}_bib`]}\\s+${rx(name(e.m, e.s))}`).test(pagesA[0])) && /\(\d+\)/.test(pagesA[0]), 'A: every first-round skier pre-printed as "bib  LAST, First" with seeds in parentheses');
    const routesA = keeperRoutes(bracket, 'runoff_to_8th');
    const byIdA = new Map(bracket.map(m => [m.id, m]));
    c.ok(byes.every(b => { const d = byIdA.get(routesA.get(b.id).win.id); return d[`registration_id_${routesA.get(b.id).win.course}`] === b.registration_id_blue && new RegExp(`${b.blue_bib}\\s+${rx(b.blue_last.toUpperCase())},`).test(pagesA[0]); }),
      'A: every bye athlete is pre-printed on the quarterfinal line they enter (no first-round line for a bye)');

    // 5. open lines + outputs
    const exp = expectedOpenLabels(bracket, 'runoff_to_8th');
    c.eq(countRaw(rawA, /^Won W-\d\d/gm), exp.won, `A: one "Won W-nn" per empty winner-fed line (${exp.won})`);
    c.eq(countRaw(rawA, /^Lost W-\d\d/gm), exp.lost, `A: one "Lost W-nn" per empty loser-fed line (${exp.lost})`);
    const tA = norm(textA);
    c.ok(/1st/.test(tA) && /3rd/.test(tA) && /5th/.test(tA) && /7th/.test(tA) && /\(loser 2nd\)/.test(tA), 'A: placings 1st / 3rd / 5th / 7th at the end of the deciding lines');
    c.ok(countRaw(textA, /\bBlue\b/g) >= 14 && countRaw(textA, /\bRed\b/g) >= 14, 'A: a course word under every line');
    c.ok(/Lost W-04 \(p\.1\)/.test(tA) || /Lost W-04\s+\(p\.1\)/.test(tA), 'A: a feeder on another page carries its page number');
    c.ok(!/sheet/i.test(tA) && !/WINNER →|How to keep|Start list|RUN ORDER/i.test(tA), 'A: no run-order strip, instructions, start list or pointers — lines, labels and placings only');
    const opsA = contentOps(rA.buf);
    const sizesA = fontSizes(opsA);
    c.ok(sizesA.length > 40 && sizesA.every(s => s >= 7), `A: nothing below 7 pt (${sizesA.length} text objects)`);

    // 6. mid-day
    const midA = await play(api, evA, { onlyRoundAtLeast: 3, mainOnly: true });
    c.eq(midA.filter(m => !m.is_small_final && m.bracket_round >= 3 && !m.is_bye && m.status === 'complete').length, 6, 'A: 2 Round-of-16 matches + 4 quarterfinals played');
    const rA2 = await fetchPdf(cloud.base, 'bracket-keeper', evA, F('a_mid.pdf'));
    c.eq(pdfInfoPages(rA2.file), 2, 'A mid-day: still 2 pages');
    c.ok(lines(contentOps(rA2.buf)).join('|') === lines(opsA).join('|'), 'A mid-day: every line and connector at the identical position');
    const textA2 = norm(pdfText(rA2.file, ['-layout']));
    const semisA = midA.filter(m => m.bracket_round === 2 && !m.is_bye);
    c.ok(semisA.length === 4 && semisA.every(m => textA2.includes(`${m.blue_bib} ${m.blue_last.toUpperCase()},`) && textA2.includes(`${m.red_bib} ${m.red_last.toUpperCase()},`)), 'A mid-day: semifinal and 5–8 semifinal lines print the athletes from the rows');
    const exp2 = expectedOpenLabels(midA, 'runoff_to_8th');
    c.eq(countRaw(pdfText(rA2.file, ['-raw']), /^Won W-\d\d/gm), exp2.won, `A mid-day: "Won" labels only on the lines still open (${exp2.won})`);
    const finalA = await play(api, evA);
    routingVsReality(c, finalA, 'runoff_to_8th', 'A complete');
    const rA3 = await fetchPdf(cloud.base, 'bracket-keeper', evA, F('a_done.pdf'));
    c.eq(pdfInfoPages(rA3.file), 2, 'A complete: still 2 pages');
    c.eq(countRaw(pdfText(rA3.file, ['-raw']), /^(Won|Lost) W-\d\d/gm), 0, 'A complete: no open lines left');

    // =====================================================================
    // B. page plans: runoff to 4th / no runoff / full 16
    // =====================================================================
    const B4 = await makeDual(api, { name: 'Keeper B4', gender: 'F', athletes: 10, runoff: 'runoff_to_4th' });
    const rB4 = await fetchPdf(cloud.base, 'bracket-keeper', B4.event.id, F('b4.pdf'));
    c.eq(pdfInfoPages(rB4.file), 1, 'B: 16 shell, runoff to 4th → 1 page');
    const tB4 = norm(pdfText(rB4.file, ['-layout']));
    c.ok(/3rd \/ 4th Place/.test(tB4) && !/5th/.test(tB4), 'B: runoff to 4th — 3rd/4th section, no 5th–8th');
    const B0 = await makeDual(api, { name: 'Keeper B0', gender: 'M', athletes: 10, runoff: 'no_runoff' });
    const rB0 = await fetchPdf(cloud.base, 'bracket-keeper', B0.event.id, F('b0.pdf'));
    c.eq(pdfInfoPages(rB0.file), 1, 'B: 16 shell, no runoff → 1 page');
    const tB0 = norm(pdfText(rB0.file, ['-layout']));
    c.ok(!/3rd \/ 4th/.test(tB0) && /M-0\d/.test(tB0) && /1st/.test(tB0), 'B: no runoff — no 3rd/4th section, labels M-nn');
    const B16 = await makeDual(api, { name: 'Keeper B16', gender: 'M', athletes: 16, runoff: 'runoff_to_8th' });
    const rB16 = await fetchPdf(cloud.base, 'bracket-keeper', B16.event.id, F('b16.pdf'));
    c.eq(pdfInfoPages(rB16.file), 2, 'B: full 16 (no byes) → 2 pages, same tree');
    const b16 = await api.must('GET', `/api/events/${B16.event.id}/dual`);
    c.ok(b16.filter(m => !m.is_bye).every(m => pdfText(rB16.file).includes(m.pairing_label)), 'B: full 16 — all 20 labels printed');

    // =====================================================================
    // C. 28 athletes (32 shell, 4 byes): 3 pages, routing vs reality, /dual-bracket fix
    // =====================================================================
    const C28 = await makeDual(api, { name: 'Keeper C', gender: 'F', athletes: 28, runoff: 'runoff_to_8th' });
    const evC = C28.event.id;
    bracket = await api.must('GET', `/api/events/${evC}/dual`);
    const rC = await fetchPdf(cloud.base, 'bracket-keeper', evC, F('c_blank.pdf'));
    c.eq(pdfInfoPages(rC.file), 3, 'C: 32 shell, 28 entered → 3 pages (two quarter sections per page + semis/finals)');
    const pC = pdfPagesText(rC.file, ['-layout']);
    c.ok(/Section 1 of 4/.test(pC[0]) && /Section 2 of 4/.test(pC[0]) && /Section 4 of 4/.test(pC[1]) && /Semi-Finals and Final/.test(pC[2]), 'C: sections 1–2 on page 1, 3–4 on page 2, semis/finals/consolation on page 3');
    const qfs = bracket.filter(m => m.bracket_round === 3 && !m.is_small_final);
    const semisC = bracket.filter(m => m.bracket_round === 2 && !m.is_small_final);
    c.ok(qfs.every(q => { const d = semisC.find(s => s.id === keeperRoutes(bracket, 'runoff_to_8th').get(q.id).win.id); return new RegExp(`to ${d.pairing_label} \\(p\\.3\\)`).test(norm(pC[q.bracket_position <= 2 ? 0 : 1])); }),
      'C: each quarter section ends with "to W-nn (p.3)" naming the semifinal on page 3');
    c.ok(semisC.every(s => new RegExp(`Won ${qfs[0].pairing_label.slice(0, 2)}\\d\\d\\s+\\(p\\.[12]\\)`).test(pC[2])), 'C: the semifinal lines say Won W-nn (p.n)');
    const tC = norm(pdfText(rC.file, ['-layout']));
    const labelsC = bracket.filter(m => !m.is_bye).map(m => m.pairing_label);
    c.ok(labelsC.length === 32 && labelsC.every(l => /^W-\d\d$/.test(l) && tC.includes(l)), 'C: all 32 labels printed, two digits');
    const entrantsC = [];
    for (const m of bracket.filter(mm => mm.bracket_round === 5 && !mm.is_small_final)) for (const s of ['blue', 'red']) if (m[`registration_id_${s}`]) entrantsC.push(name(m, s));
    c.ok(entrantsC.length === 28 && entrantsC.every(n => tC.includes(n)), 'C: all 28 entrants pre-printed');
    const expC = expectedOpenLabels(bracket, 'runoff_to_8th');
    const rawC = pdfText(rC.file, ['-raw']);
    c.eq(countRaw(rawC, /^Won W-\d\d/gm) + countRaw(rawC, /^Lost W-\d\d/gm), expC.won + expC.lost, `C: one open-line label per empty slot (${expC.won + expC.lost})`);
    const rDB = await fetchPdf(cloud.base, 'dual-bracket', evC, F('c_dual_bracket.pdf'));
    c.eq(rDB.status, 200, 'C: /dual-bracket renders');
    const pDB = pdfPagesText(rDB.file, ['-layout']);
    c.eq(pDB.length, 2, 'C: /dual-bracket 32 shell → 2 pages');
    const finalC = bracket.find(m => m.bracket_round === 1 && !m.is_small_final);
    c.ok(semisC.every(m => pDB[1].includes(m.pairing_label)) && pDB[1].includes(finalC.pairing_label), `C: /dual-bracket finals page shows BOTH semifinals (${semisC.map(m => m.pairing_label).join(', ')}) and the final — the second semifinal used to be dropped`);
    const doneC = await play(api, evC);
    routingVsReality(c, doneC, 'runoff_to_8th', 'C complete (32 shell)');
    const rC2 = await fetchPdf(cloud.base, 'bracket-keeper', evC, F('c_done.pdf'));
    c.eq(pdfInfoPages(rC2.file), 3, 'C complete: still 3 pages');
    c.ok(lines(contentOps(rC2.buf)).join('|') === lines(contentOps(rC.buf)).join('|'), 'C complete: line geometry identical to the blank sheet');
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
        'C: buildBracketPositions — 16-shell single page identical to the old anchor');
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
    // D. 6 athletes (8 shell, byes, unfillable 5–8 semis), full 32, 4 shell
    // =====================================================================
    const D6 = await makeDual(api, { name: 'Keeper D6', gender: 'M', athletes: 6, runoff: 'runoff_to_8th' });
    const rD = await fetchPdf(cloud.base, 'bracket-keeper', D6.event.id, F('d6.pdf'));
    c.eq(rD.status, 200, 'D: 6-athlete keeper renders');
    c.eq(pdfInfoPages(rD.file), 2, 'D: 8 shell, runoff to 8th → 2 pages (tree + 3rd/4th, then 5th–8th and 7th/8th)');
    const tD = norm(pdfText(rD.file, ['-layout']));
    c.ok(/\(bye — no loser\)/.test(tD) && /Quarter-Finals to Final/.test(tD), 'D: a 5–8 line fed by a bye quarterfinal reads (bye — no loser)');
    const doneD = await play(api, D6.event.id);
    routingVsReality(c, doneD, 'runoff_to_8th', 'D complete (8 shell, byes)');
    const D32 = await makeDual(api, { name: 'Keeper D32', gender: 'M', athletes: 32, runoff: 'runoff_to_8th' });
    const rD32 = await fetchPdf(cloud.base, 'bracket-keeper', D32.event.id, F('d32.pdf'));
    c.eq(pdfInfoPages(rD32.file), 3, 'D: full 32 (no byes) → 3 pages');
    const D4 = await makeDual(api, { name: 'Keeper D4', gender: 'F', athletes: 4, runoff: 'runoff_to_4th' });
    const rD4 = await fetchPdf(cloud.base, 'bracket-keeper', D4.event.id, F('d4.pdf'));
    c.eq(pdfInfoPages(rD4.file), 1, 'D: 4 shell → 1 page');
    c.ok(/Semi-Finals to Final/.test(pdfText(rD4.file)) && /3rd \/ 4th/.test(pdfText(rD4.file)), 'D: 4 shell — Semi-Finals to Final + 3rd/4th');

    // =====================================================================
    // E. 64 shell: 50 entrants and a near-full draw
    // =====================================================================
    const E50 = await makeDual(api, { name: 'Keeper E50', gender: 'M', athletes: 50, runoff: 'runoff_to_8th' });
    const rE = await fetchPdf(cloud.base, 'bracket-keeper', E50.event.id, F('e50.pdf'));
    c.eq(rE.status, 200, 'E: 50-entrant 64 shell renders');
    c.eq(pdfInfoPages(rE.file), 6, 'E: 64 shell → 6 pages (two eighths per page, quarterfinals to final + consolation)');
    const pE = pdfPagesText(rE.file, ['-layout']);
    c.ok(/Section 1 of 8/.test(pE[0]) && /Quarter-Finals to Final/.test(pE[4]) && /7th \/ 8th Place/.test(pE[5]), 'E: Round of 64 sections first, quarterfinals → final, consolation last');
    const bE = await api.must('GET', `/api/events/${E50.event.id}/dual`);
    const tE = norm(pdfText(rE.file, ['-layout']));
    c.ok(bE.filter(m => !m.is_bye).every(m => tE.includes(m.pairing_label)), 'E: every label printed on the 64 shell');
    c.ok(fontSizes(contentOps(rE.buf)).every(s => s >= 7), 'E: nothing below 7 pt');
    const E62 = await makeDual(api, { name: 'Keeper E62', gender: 'F', athletes: 62, runoff: 'runoff_to_8th' });
    const rE62 = await fetchPdf(cloud.base, 'bracket-keeper', E62.event.id, F('e62.pdf'));
    c.ok(rE62.status === 200 && pdfInfoPages(rE62.file) === 6, 'E: near-full 64 shell → 6 pages too (the tree does not depend on byes)');

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
    c.ok(/5th \/ 6th Place/.test(tF) && /7th \/ 8th Place/.test(tF), 'F: legacy round-2 small finals print as the 5th/6th and 7th/8th sections');
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
