/**
 * v2.5.07 acceptance — dual mogul bracket: blue / red courses per USSS/FIS
 * 4310.3.1, the mirrored 5–8 consolation pairing, first-round courses on an
 * odd shell, and the labels (Findings doc 09-13-26).
 *
 * The rule, restated INDEPENDENTLY of the implementation (from the findings
 * document's wording, not from dual.js):
 *   winner of (round R, position p) → BLUE when R and p have the same parity,
 *                                     RED otherwise;
 *   a loser dropping into a consolation match → the OPPOSITE slot.
 *   QF losers: positions 1+2 → consolation semi pos 3, 3+4 → pos 4.
 *
 * HTTP layer (cloud instance):
 *   A  16 athletes, runoff to 8th (shell 16, even first round): every
 *      first-round upper slot is BLUE; the whole day is walked in pairing
 *      order with alternating winners and EVERY advancement / drop checked
 *      against the rule; the 5–8 semis hold QF1+QF2 and QF3+QF4 losers; the
 *      v2.5.06 end-of-round notices still fire.
 *   B  28 athletes, runoff to 8th (shell 32, ODD first round): every
 *      first-round upper slot is RED (better seed on red), bye rows keep the
 *      athlete in blue, bye winners land per the rule, full walk verified.
 *   C  6 athletes, runoff to 8th (shell 8, odd first round; byes; unfillable
 *      5–8 semis): first-round courses, bye advancement, full walk.
 *   D  Telluride replay, both genders: the quarterfinals laid out by Manual
 *      Bracketing exactly as on the RMF Divisional Champs sheet (Mar 8 2026),
 *      the recorded winners applied — StickIt must reproduce every semifinal,
 *      consolation-semifinal and final OCCUPANT AND SIDE and the places 1–8.
 *   E  Head Judge order independence: semifinal 1 decided BEFORE semifinal 2
 *      → 3/4 final sides identical to the rule (used to swap by arrival).
 *   F  GET /dual + /active-match carry round_name (no gender word).
 * Playwright layer (FR-21):
 *   G  the broadcast overlay captions the 7/8 final "7TH / 8TH PLACE".
 */

const { Checks } = require('../lib/checks');
const { Instance } = require('../lib/instance');
const { Api } = require('../lib/client');
const { buildMeet } = require('../lib/fixtures');
const { seedDualJudges } = require('../lib/driver');
const { newTablet, shutdownBrowser } = require('../lib/browser');

// ---- the rule, independently restated -------------------------------------
const winnerSlot = (round, pos) => ((round % 2) === (pos % 2)) ? 'blue' : 'red';
const loserSlot  = (round, pos) => (winnerSlot(round, pos) === 'blue' ? 'red' : 'blue');
const consSemiPos = (qfPos) => 2 + Math.ceil(qfPos / 2);

async function makeDual(api, { name, gender, athletes, runoff, seed = true }) {
  const M = await buildMeet(api, { name, gender, discipline: 'dual_mogul', athletes, judges: [], startRun: false });
  const judges = await seedDualJudges(api, M.event.id);
  await api.must('PUT', `/api/events/${M.event.id}/dual/runoff-option`, { runoff_option: runoff });
  await api.must('POST', `/api/events/${M.event.id}/dual/seed-random`, {});
  if (seed) await api.must('POST', `/api/events/${M.event.id}/dual/seed-fis`, {});
  return { ...M, judges };
}

const readyInOrder = (bracket) => bracket
  .filter(m => m.status === 'pending' && m.registration_id_blue && m.registration_id_red && !m.is_bye)
  .sort((a, b) => (a.pairing_number ?? 1e9) - (b.pairing_number ?? 1e9));

const find = (bracket, round, pos, small) => bracket.find(m => m.bracket_round === round && m.bracket_position === pos && !!m.is_small_final === !!small);
const hasNew58 = (bracket) => bracket.some(m => m.is_small_final && m.bracket_round === 1 && m.bracket_position === 3);

/** Decide a match: `side` 'blue' | 'red' wins (5 judges + HJ approve). */
async function decide(api, eventId, m, side) {
  const bp = side === 'blue' ? 3 : 2, rp = side === 'blue' ? 2 : 3;
  for (let n = 1; n <= 5; n++) {
    await api.must('POST', `/api/events/${eventId}/dual/${m.id}/judge-points`, { judge_number: n, blue_points: bp, red_points: rp });
  }
  await api.must('POST', `/api/events/${eventId}/dual/${m.id}/approve`, {});
}

/**
 * Check where the winner and loser of `m` (decided with `side` winning)
 * landed, against the rule. Pushes human-readable violations.
 */
function checkAdvancement(bracket, m, side, runoff8, violations) {
  const R = m.bracket_round, p = m.bracket_position;
  const winner = side === 'blue' ? m.registration_id_blue : m.registration_id_red;
  const loser  = side === 'blue' ? m.registration_id_red  : m.registration_id_blue;
  const key = `${m.is_small_final ? 's' : 'm'}${R}.${p}`;
  const at = (mm, slot) => mm[`registration_id_${slot}`];

  if (!m.is_small_final && R > 1) {
    const nm = find(bracket, R - 1, Math.ceil(p / 2), false);
    const ws = winnerSlot(R, p);
    if (!nm || at(nm, ws) !== winner) violations.push(`${key}: winner not in ${ws} of m${R - 1}.${Math.ceil(p / 2)}`);
    if (R === 2) {
      const con = find(bracket, 1, 2, true);
      if (con && at(con, loserSlot(R, p)) !== loser) violations.push(`${key}: loser not in ${loserSlot(R, p)} of the 3/4 final`);
    }
    if (R === 3 && runoff8 && hasNew58(bracket)) {
      const con = find(bracket, 2, consSemiPos(p), true);
      if (!con || at(con, loserSlot(R, p)) !== loser) violations.push(`${key}: loser not in ${loserSlot(R, p)} of cons semi pos ${consSemiPos(p)}`);
    }
  }
  if (m.is_small_final && R === 2 && hasNew58(bracket)) {
    const f56 = find(bracket, 1, 3, true), f78 = find(bracket, 1, 4, true);
    if (!f56 || at(f56, winnerSlot(R, p)) !== winner) violations.push(`${key}: winner not in ${winnerSlot(R, p)} of the 5/6 final`);
    if (!f78 || at(f78, loserSlot(R, p)) !== loser) violations.push(`${key}: loser not in ${loserSlot(R, p)} of the 7/8 final`);
  }
}

/** Walk a bracket to the end in pairing order; verify every advancement. */
async function walk(api, ev, runoff8, pickSide = (m) => (m.pairing_number % 2 ? 'blue' : 'red')) {
  const violations = [];
  const played = [];
  const notices = [];
  for (let guard = 0; guard < 80; guard++) {
    let bracket = await api.must('GET', `/api/events/${ev}/dual`);
    const next = readyInOrder(bracket)[0];
    if (!next) break;
    await api.must('PUT', `/api/events/${ev}/dual/active-match`, { match_id: next.id });
    const side = pickSide(next);
    await decide(api, ev, next, side);
    bracket = await api.must('GET', `/api/events/${ev}/dual`);
    checkAdvancement(bracket, next, side, runoff8, violations);
    played.push(next);
    const rs = await api.must('GET', `/api/events/${ev}/dual/round-state`);
    notices.push([next.pairing_number, next.round_name, rs.ended_round_label]);
  }
  return { violations, played, notices, bracket: await api.must('GET', `/api/events/${ev}/dual`) };
}

function firstRoundChecks(c, bracket, tag) {
  const totalRound = Math.max(...bracket.filter(m => !m.is_small_final).map(m => m.bracket_round));
  const first = bracket.filter(m => !m.is_small_final && m.bracket_round === totalRound);
  const real = first.filter(m => !m.is_bye);
  const byes = first.filter(m => m.is_bye);
  const topIsRed = totalRound % 2 === 1;
  c.ok(real.length > 0 && real.every(m => topIsRed ? m.seed_red < m.seed_blue : m.seed_blue < m.seed_red),
    `${tag}: first round (round ${totalRound}, ${topIsRed ? 'odd → top competitor RED' : 'even → top competitor BLUE'}) — better seed on ${topIsRed ? 'red' : 'blue'} in all ${real.length} real pairings`);
  c.ok(byes.every(m => m.registration_id_blue && !m.registration_id_red && m.status === 'complete' && m.winner_registration_id === m.registration_id_blue),
    `${tag}: ${byes.length} bye row(s) keep the athlete in blue and are auto-won`);
  // bye winners land per the rule
  const bad = byes.filter(m => {
    const nm = find(bracket, totalRound - 1, Math.ceil(m.bracket_position / 2), false);
    return !nm || nm[`registration_id_${winnerSlot(totalRound, m.bracket_position)}`] !== m.registration_id_blue;
  });
  c.eq(bad.length, 0, `${tag}: every bye winner advanced into the rule's slot of the next round`);
  return { totalRound, byes };
}

// ---------------------------------------------------------------------------
async function main() {
  const c = new Checks('v2507');
  const cloud = new Instance({ name: 'v2507-cloud', port: 3311, mode: 'cloud' });
  try {
    await cloud.start();
    const api = new Api(cloud.base);
    let bracket, r;

    // =====================================================================
    // A. 16 athletes, runoff to 8th (shell 16 — even first round)
    // =====================================================================
    const A = await makeDual(api, { name: 'Course A', gender: 'F', athletes: 16, runoff: 'runoff_to_8th' });
    const evA = A.event.id;
    bracket = await api.must('GET', `/api/events/${evA}/dual`);
    firstRoundChecks(c, bracket, 'A');
    const qfLosersA = {};
    const wA = await walk(api, evA, true);
    c.eq(wA.played.length, 20, 'A: played all 20 matches (8 + 4 + 2 cons semis + 2 semis + 4 finals)');
    c.eq(wA.violations.length, 0, `A: every winner / loser landed in the rule's slot (${wA.violations.join('; ') || 'none'})`);
    // 5–8 pairing mirrors the main draw
    for (const m of wA.bracket.filter(m => !m.is_small_final && m.bracket_round === 3)) {
      qfLosersA[m.bracket_position] = m.winner_registration_id === m.registration_id_blue ? m.registration_id_red : m.registration_id_blue;
    }
    const cs3 = find(wA.bracket, 2, 3, true), cs4 = find(wA.bracket, 2, 4, true);
    const idsOf = (m) => [m.registration_id_blue, m.registration_id_red].sort().join(',');
    c.eq(idsOf(cs3), [qfLosersA[1], qfLosersA[2]].sort().join(','), 'A: consolation semi pos 3 = losers of QF 1 and QF 2');
    c.eq(idsOf(cs4), [qfLosersA[3], qfLosersA[4]].sort().join(','), 'A: consolation semi pos 4 = losers of QF 3 and QF 4');
    c.eq(cs3.registration_id_red, qfLosersA[1], 'A: QF1 loser is RED in cons semi 3 (opposite of the QF1 winner, blue in the semi)');
    c.eq(cs3.registration_id_blue, qfLosersA[2], 'A: QF2 loser is BLUE in cons semi 3');
    c.eq(cs4.registration_id_red, qfLosersA[3], 'A: QF3 loser is RED in cons semi 4');
    c.eq(cs4.registration_id_blue, qfLosersA[4], 'A: QF4 loser is BLUE in cons semi 4');
    // v2.5.06 end-of-round notices are intact
    const noticeAt = (n) => (wA.notices.find(x => x[0] === n) || [])[2];
    c.eq(noticeAt(8), 'End of Round of 16 for Females', 'A: end-of-round notice after the last Round-of-16 match (v2.5.06 kept)');
    c.eq(noticeAt(12), 'End of Round of 8 for Females', 'A: end-of-round notice after the last quarterfinal');
    c.eq(noticeAt(14), null, 'A: no notice between the 5–8 semis and the 1–4 semis');
    c.eq(noticeAt(16), 'End of Semi-Finals for Females', 'A: end-of-round notice after the last semifinal');
    c.eq(noticeAt(20), null, 'A: nothing after the championship final');
    c.ok(wA.notices.every(x => !/Place/.test(x[1] || '') || x[2] === null), 'A: no notice after any final');
    // places 1–8 come from the finals exactly as before (placement untouched)
    r = await api.must('GET', `/api/events/${evA}/results`);
    const fin = find(wA.bracket, 1, 1, false), f34 = find(wA.bracket, 1, 2, true), f56 = find(wA.bracket, 1, 3, true), f78 = find(wA.bracket, 1, 4, true);
    const loserOf = (m) => (m.winner_registration_id === m.registration_id_blue ? m.registration_id_red : m.registration_id_blue);
    const placeOf = (reg) => (r.find(x => x.registration_id === reg) || {}).rank;
    c.deepEq([fin.winner_registration_id, loserOf(fin), f34.winner_registration_id, loserOf(f34), f56.winner_registration_id, loserOf(f56), f78.winner_registration_id, loserOf(f78)].map(placeOf),
      [1, 2, 3, 4, 5, 6, 7, 8], 'A: places 1–8 = 1/2 final, 3/4 final, 5/6 final, 7/8 final winners and losers');

    // =====================================================================
    // B. 28 athletes, runoff to 8th (shell 32 — ODD first round)
    // =====================================================================
    const B = await makeDual(api, { name: 'Course B', gender: 'M', athletes: 28, runoff: 'runoff_to_8th' });
    const evB = B.event.id;
    bracket = await api.must('GET', `/api/events/${evB}/dual`);
    const fb = firstRoundChecks(c, bracket, 'B');
    c.eq(fb.totalRound, 5, 'B: 28 athletes → shell 32, first round = round 5 (Round of 32)');
    c.eq(fb.byes.length, 4, 'B: four byes');
    const wB = await walk(api, evB, true, (m) => (m.bracket_position % 2 ? 'red' : 'blue'));
    c.eq(wB.played.length, 32, 'B: played all 32 matches (12 + 8 + 4 + 2 cons semis + 2 semis + 4 finals)');
    c.eq(wB.violations.length, 0, `B: every winner / loser landed in the rule's slot on the odd shell (${wB.violations.join('; ') || 'none'})`);
    c.ok(wB.notices.some(x => x[2] === 'End of Round of 32 for Males') && wB.notices.some(x => x[2] === 'End of Semi-Finals for Males'),
      'B: "End of Round of 32 / Semi-Finals for Males" notices fired');

    // =====================================================================
    // C. 6 athletes, runoff to 8th (shell 8 — odd first round, byes)
    // =====================================================================
    const C = await makeDual(api, { name: 'Course C', gender: 'M', athletes: 6, runoff: 'runoff_to_8th' });
    const evC = C.event.id;
    bracket = await api.must('GET', `/api/events/${evC}/dual`);
    const fc = firstRoundChecks(c, bracket, 'C');
    c.eq(fc.totalRound, 3, 'C: 6 athletes → shell 8, first round = Round of 8 (odd → top competitor red)');
    const wC = await walk(api, evC, true);
    c.eq(wC.violations.length, 0, `C: every winner / loser landed in the rule's slot (${wC.violations.join('; ') || 'none'})`);
    const cC3 = find(wC.bracket, 2, 3, true), cC4 = find(wC.bracket, 2, 4, true);
    c.ok(cC3 && cC4 && [cC3, cC4].every(m => (m.registration_id_blue ? 1 : 0) + (m.registration_id_red ? 1 : 0) === 1),
      'C: each 5–8 semi holds exactly one QF loser (the bye QFs have none) and never fills');
    c.ok(wC.notices.some(x => x[2] === 'End of Semi-Finals for Males'), 'C: "End of Semi-Finals for Males" still fires with unfillable 5–8 semis');

    // =====================================================================
    // D. Telluride replay (RMF Divisional Champs, Mar 8 2026), both genders
    // =====================================================================
    const SHEETS = {
      Male: {
        qf:    [['Harvey', 'Carrington', 'Carrington'], ['Martin', 'Cope', 'Cope'], ['Julia', 'Anderson', 'Julia'], ['Dean', 'Sheinbaum', 'Sheinbaum']],
        semis: { 'm2.1': ['Carrington', 'Cope', 'Cope'], 'm2.2': ['Julia', 'Sheinbaum', 'Julia'], 's2.3': ['Martin', 'Harvey', 'Martin'], 's2.4': ['Dean', 'Anderson', 'Dean'] },
        finals: { 'm1.1': ['Julia', 'Cope', 'Cope'], 's1.2': ['Carrington', 'Sheinbaum', 'Sheinbaum'], 's1.3': ['Dean', 'Martin', 'Martin'], 's1.4': ['Harvey', 'Anderson', 'Harvey'] },
        places: ['Cope', 'Julia', 'Sheinbaum', 'Carrington', 'Martin', 'Dean', 'Harvey', 'Anderson'],
      },
      Female: {
        qf:    [['Renaudin', 'Broecker', 'Broecker'], ['Soard', 'Kirschner', 'Soard'], ['Spraker', 'Lemnah', 'Spraker'], ['Salthouse', 'Thrush', 'Thrush']],
        semis: { 'm2.1': ['Broecker', 'Soard', 'Broecker'], 'm2.2': ['Spraker', 'Thrush', 'Spraker'], 's2.3': ['Kirschner', 'Renaudin', 'Renaudin'], 's2.4': ['Salthouse', 'Lemnah', 'Lemnah'] },
        finals: { 'm1.1': ['Spraker', 'Broecker', 'Spraker'], 's1.2': ['Soard', 'Thrush', 'Thrush'], 's1.3': ['Lemnah', 'Renaudin', 'Lemnah'], 's1.4': ['Kirschner', 'Salthouse', 'Kirschner'] },
        places: ['Spraker', 'Broecker', 'Thrush', 'Soard', 'Lemnah', 'Renaudin', 'Kirschner', 'Salthouse'],
      },
    };
    for (const [gw, S] of Object.entries(SHEETS)) {
      const gender = gw === 'Male' ? 'M' : 'F';
      // buildMeet with 0 athletes; the 8 athletes are created by name below
      const T = await buildMeet(api, { name: `Telluride ${gw}`, gender, discipline: 'dual_mogul', athletes: 0, judges: [], startRun: false });
      await seedDualJudges(api, T.event.id);
      await api.must('PUT', `/api/events/${T.event.id}/dual/runoff-option`, { runoff_option: 'runoff_to_8th' });
      const event = T.event;
      const regByName = {};
      const names = [...new Set(S.qf.flatMap(q => [q[0], q[1]]))];
      for (const last of names) {
        const a = await api.must('POST', '/api/athletes', { first_name: gw === 'Male' ? 'M' : 'F', last_name: last, gender, birth_year: 2008, ussa_num: `T${gw[0]}${last}` });
        regByName[last] = (await api.must('POST', `/api/events/${event.id}/registrations`, { athlete_id: a.id, bib_number: 100 + names.indexOf(last) })).id;
      }
      await api.must('POST', `/api/events/${event.id}/dual/seed-random`, {});
      // Manual Bracketing: the quarterfinals exactly as printed (blue, red)
      const slots = S.qf.map(([b, rd], i) => ({ matchIndex: i + 1, blue: regByName[b], red: regByName[rd] }));
      await api.must('POST', `/api/events/${event.id}/dual/seed-manual`, { slots });
      const ev = event.id;
      const nameOf = (reg) => Object.keys(regByName).find(k => regByName[k] === reg) || null;
      const sidesOf = (m) => [nameOf(m.registration_id_blue), nameOf(m.registration_id_red)];
      const playByName = async (m, winnerLast) => {
        const side = m.registration_id_blue === regByName[winnerLast] ? 'blue' : (m.registration_id_red === regByName[winnerLast] ? 'red' : null);
        if (!side) throw new Error(`${winnerLast} is not in match ${m.bracket_round}.${m.bracket_position}`);
        await api.must('PUT', `/api/events/${ev}/dual/active-match`, { match_id: m.id });
        await decide(api, ev, m, side);
      };
      bracket = await api.must('GET', `/api/events/${ev}/dual`);
      c.eq(bracket.filter(m => !m.is_small_final && m.bracket_round === 3).map(sidesOf).map(s => s.join('/')).join(' | '),
        S.qf.map(q => `${q[0]}/${q[1]}`).join(' | '), `D ${gw}: quarterfinals laid out as on the sheet (blue/red)`);
      // Play the quarterfinals in run order with the sheet's winners
      for (const m of readyInOrder(bracket)) await playByName(m, S.qf[m.bracket_position - 1][2]);
      bracket = await api.must('GET', `/api/events/${ev}/dual`);
      const got = (key) => { const [t, rp] = [key[0], key.slice(1).split('.').map(Number)]; return find(bracket, rp[0], rp[1], t === 's'); };
      for (const [key, [b, rd]] of Object.entries(S.semis)) {
        c.deepEq(sidesOf(got(key)), [b, rd], `D ${gw}: ${key} = ${b} (blue) vs ${rd} (red) — as on the sheet`);
      }
      // Semifinal block in run order (5.4, 5.3, 5.2, 5.1 on the sheet)
      for (const m of readyInOrder(bracket)) {
        const key = `${m.is_small_final ? 's' : 'm'}${m.bracket_round}.${m.bracket_position}`;
        await playByName(m, S.semis[key][2]);
      }
      bracket = await api.must('GET', `/api/events/${ev}/dual`);
      for (const [key, [b, rd]] of Object.entries(S.finals)) {
        c.deepEq(sidesOf(got(key)), [b, rd], `D ${gw}: ${key} = ${b} (blue) vs ${rd} (red) — as on the sheet`);
      }
      for (const m of readyInOrder(bracket)) {
        const key = `${m.is_small_final ? 's' : 'm'}${m.bracket_round}.${m.bracket_position}`;
        await playByName(m, S.finals[key][2]);
      }
      r = await api.must('GET', `/api/events/${ev}/results`);
      c.deepEq(r.slice().sort((a, b) => a.rank - b.rank).map(x => x.last_name), S.places, `D ${gw}: places 1–8 as on the sheet`);
    }

    // =====================================================================
    // E. Head Judge order independence (runoff to 4th, 8 athletes)
    // =====================================================================
    const E = await makeDual(api, { name: 'Course E', gender: 'F', athletes: 8, runoff: 'runoff_to_4th' });
    const evE = E.event.id;
    bracket = await api.must('GET', `/api/events/${evE}/dual`);
    for (const m of readyInOrder(bracket)) { await api.must('PUT', `/api/events/${evE}/dual/active-match`, { match_id: m.id }); await decide(api, evE, m, 'blue'); }
    bracket = await api.must('GET', `/api/events/${evE}/dual`);
    const s1 = find(bracket, 2, 1, false), s2 = find(bracket, 2, 2, false);
    // decide semi 1 FIRST (pairing order would be semi 2 first)
    await api.must('PUT', `/api/events/${evE}/dual/active-match`, { match_id: s1.id }); await decide(api, evE, s1, 'red');
    await api.must('PUT', `/api/events/${evE}/dual/active-match`, { match_id: s2.id }); await decide(api, evE, s2, 'red');
    bracket = await api.must('GET', `/api/events/${evE}/dual`);
    const f34E = find(bracket, 1, 2, true), finE = find(bracket, 1, 1, false);
    c.eq(f34E.registration_id_blue, s1.registration_id_blue, 'E: semi-1 loser is BLUE in the 3/4 final even though semi 1 was decided first');
    c.eq(f34E.registration_id_red, s2.registration_id_blue, 'E: semi-2 loser is RED in the 3/4 final');
    c.eq(finE.registration_id_red, s1.registration_id_red, 'E: semi-1 winner is RED in the final (top competitor red in the Final Round)');
    c.eq(finE.registration_id_blue, s2.registration_id_red, 'E: semi-2 winner is BLUE in the final');

    // =====================================================================
    // F. round_name (bare label) on GET /dual and /active-match
    // =====================================================================
    c.ok(wA.bracket.filter(m => !m.is_bye).every(m => typeof m.round_name === 'string' && !/^Female /.test(m.round_name) && m.round_label === `Female ${m.round_name}`),
      'F: every GET /dual row carries round_name = round_label without the gender word');
    await api.must('PUT', `/api/events/${evA}/dual/active-match`, { match_id: f78.id });
    r = await api.must('GET', `/api/events/${evA}/dual/active-match`);
    c.eq(r.round_name, '7th / 8th Place', 'F: /active-match round_name for the 7/8 final');
    c.eq(r.round_label, 'Female 7th / 8th Place', 'F: /active-match round_label unchanged (v2.5.06)');

    // =====================================================================
    // G. Overlay caption (Playwright)
    // =====================================================================
    const tab = await newTablet();
    const op = await tab.newPage();
    await op.goto(`${cloud.base}/overlay/${evA}`, { waitUntil: 'domcontentloaded' });
    await op.getByText('7TH / 8TH PLACE', { exact: true }).waitFor({ timeout: 15000 });
    c.ok(true, 'G UI: overlay lower third captions the 7/8 final "7TH / 8TH PLACE" (was "SMALL FINAL")');
    await api.must('PUT', `/api/events/${evA}/dual/active-match`, { match_id: cs3.id });
    await op.getByText('5TH – 8TH PLACE SEMIFINAL', { exact: true }).waitFor({ timeout: 15000 });
    c.ok(true, 'G UI: overlay captions a consolation semi "5TH – 8TH PLACE SEMIFINAL" (was "SEMIFINAL")');
    await tab.close();
  } finally {
    await shutdownBrowser().catch(() => {});
    await cloud.stop().catch(() => {});
  }
  return c;
}

module.exports = { main };
