/**
 * v2.8.00 acceptance — "Skip athlete" (move down the run order for THIS run).
 *
 * The stored order (registrations.run_order, phase_run_order, pairing numbers)
 * is never edited; skips live in run_order_skips and only change the effective
 * order every next-up consumer computes. The suite drives the real HTTP API:
 *
 *   A  flat event: skip by 1 → /upcoming, /next-up, `skipped`, run_order kept,
 *      DB row (base_order / sort_order), audit row, stored order untouched
 *   B  skip k / clamp past the end / last → moved:false / validation
 *   C  repeat skips (one UPSERTed row), restore, 404 on a second restore
 *   D  DNS of a skipped athlete, skip during a live run, stale card 409,
 *      run_position unchanged
 *   E  phased: a Run 1 skip never reaches Run 2; a Run 2 skip leaves Run 1 and
 *      the stored order alone; rebuild-order makes a changed-number row inert
 *   F  no effect: results, judge scores, viewer results, CSV, start-list /
 *      run-order PDFs byte-identical across a skip; viewer upcoming follows it
 *   G  dual: run_sequence between pairings, labels + PDFs unchanged, block
 *      clamp, only-pending → moved:false, later-block start 409 then 200,
 *      restore, /reset clears the rows
 *   H  access: adopted meet 423, locked event 403, password protection ON →
 *      public skip 200 / anonymous restore 401 / token 200
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { Checks } = require('../lib/checks');
const { Instance } = require('../lib/instance');
const { Api } = require('../lib/client');
const { buildMeet } = require('../lib/fixtures');
const { seedMogulJudges, seedDualJudges, playMogulRun } = require('../lib/driver');
const { openDb } = require('../lib/db');

const SCRATCH = path.join(__dirname, '..', '.scratch', 'v280');
fs.mkdirSync(SCRATCH, { recursive: true });
const F = (n) => path.join(SCRATCH, n);

// ---- fixtures ---------------------------------------------------------------
async function makeEvent(api, { name, gender = 'M', n, bibStart = 300 }) {
  const M = await buildMeet(api, { name, gender, discipline: 'mogul', athletes: 0, judges: [], startRun: false });
  const judges = await seedMogulJudges(api, M.event.id);
  const regs = [];
  for (let i = 0; i < n; i++) {
    const a = await api.must('POST', '/api/athletes', {
      first_name: `S${i}`, last_name: `Skip${name.replace(/[^A-Za-z0-9]/g, '')}`, gender, birth_year: 2006 + (i % 4),
      ussa_num: `${name.replace(/[^A-Za-z0-9]/g, '').toUpperCase()}${gender}${2000 + i}`,
    });
    regs.push(await api.must('POST', `/api/events/${M.event.id}/registrations`, { athlete_id: a.id, bib_number: bibStart + i }));
  }
  await api.must('PUT', `/api/events/${M.event.id}/registrations/reorder`, regs.map((r, i) => ({ id: r.id, run_order: i + 1 })));
  return { ...M, judges, regs };
}
async function makeDual(api, { name, gender, athletes, runoff }) {
  const M = await buildMeet(api, { name, gender, discipline: 'dual_mogul', athletes, judges: [], startRun: false });
  await seedDualJudges(api, M.event.id);
  await api.must('PUT', `/api/events/${M.event.id}/dual/runoff-option`, { runoff_option: runoff });
  await api.must('POST', `/api/events/${M.event.id}/dual/seed-random`, {});
  await api.must('POST', `/api/events/${M.event.id}/dual/seed-fis`, {});
  return M;
}
async function decide(api, eventId, m, side) {
  const bp = side === 'blue' ? 3 : 2, rp = side === 'blue' ? 2 : 3;
  for (let n = 1; n <= 5; n++) {
    await api.must('POST', `/api/events/${eventId}/dual/${m.id}/judge-points`, { judge_number: n, blue_points: bp, red_points: rp });
  }
  await api.must('POST', `/api/events/${eventId}/dual/${m.id}/approve`, {});
}
const readyBySequence = (bracket) => bracket
  .filter(m => m.status === 'pending' && m.registration_id_blue && m.registration_id_red && !m.is_bye)
  .sort((a, b) => ((a.run_sequence ?? a.pairing_number ?? 1e9) - (b.run_sequence ?? b.pairing_number ?? 1e9)));

// ---- comparable snapshots ---------------------------------------------------
const pdfText = (buf, file) => { fs.writeFileSync(file, buf); return execFileSync('pdftotext', ['-layout', file, '-']).toString()
  .replace(/Generated[^\n]*/g, 'Generated «ts»').replace(/Time: [^\n]*/g, 'Time: «ts»'); };
async function fetchPdf(base, which, eventId, file, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${base}/api/pdf/${which}`, { method: 'POST', headers, body: JSON.stringify({ eventId }) });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, text: r.ok ? pdfText(buf, file) : null };
}
async function snapshotNoEffect(api, base, ev, tag) {
  const results = await api.must('GET', `/api/events/${ev}/results`);
  const judgeScores = await api.must('GET', `/api/events/${ev}/results/judge-scores`);
  const viewerResults = await api.must('GET', `/api/viewer/events/${ev}/results`);
  const regs = (await api.must('GET', `/api/events/${ev}/registrations`)).map(r => [r.bib_number, r.run_order]);
  const csv = (await fetch(`${base}/api/export/results-csv/${ev}`)).status;
  const csvText = await (await fetch(`${base}/api/export/results-csv/${ev}`)).text();
  const startList = (await fetchPdf(base, 'start-list', ev, F(`${tag}_start.pdf`))).text;
  const runOrder = (await fetchPdf(base, 'run-order', ev, F(`${tag}_runorder.pdf`))).text;
  return JSON.stringify({ results, judgeScores, viewerResults, regs, csv, csvText, startList, runOrder });
}

async function main() {
  const c = new Checks('v280');
  const cloud = new Instance({ name: 'v280-cloud', port: 3481, mode: 'cloud' });
  await cloud.start();
  const api = new Api(cloud.base);
  const base = cloud.base;
  const db = openDb(cloud.dbPath);
  const up = async (ev, rn) => (await api.must('GET', `/api/events/${ev}/runs/upcoming${rn ? `?run_number=${rn}` : ''}`)).athletes;
  const bibs = (list) => list.map(a => a.bib_number);
  const skip = (ev, body) => api.post(`/api/events/${ev}/runs/skip`, body);
  const restore = (ev, regId, rn, opts) => api.del(`/api/events/${ev}/runs/skip/${regId}?run_number=${rn}`, undefined, opts);
  const skipRows = (ev) => db.queryAll('SELECT * FROM run_order_skips WHERE event_id=? ORDER BY created_at', [ev]);

  try {
    // =====================================================================
    // A. flat event, skip by 1
    // =====================================================================
    const A = await makeEvent(api, { name: 'Skip A', n: 8 });
    const evA = A.event.id;
    const R = A.regs;   // R[i] has bib 300+i, run_order i+1
    c.deepEq(bibs(await up(evA)), [300, 301, 302, 303, 304, 305, 306, 307], 'A: baseline upcoming order 300..307');

    let r = await skip(evA, { registration_id: R[0].id, run_number: 1, spots: 1 });
    c.eq(r.status, 200, 'A: POST /runs/skip by 1 → 200');
    c.ok(r.data.moved === true && r.data.from_position === 1 && r.data.to_position === 2 && r.data.spots_moved === 1,
      `A: moved from 1 to 2 (${JSON.stringify(r.data)})`);
    c.ok(/moved down 1 spot to position 2 of 8 for Run 1/.test(r.data.message), `A: message "${r.data.message}"`);
    let list = await up(evA);
    c.deepEq(bibs(list), [301, 300, 302, 303, 304, 305, 306, 307], 'A: upcoming now 301, 300, 302 …');
    c.ok(list[1].skipped === true && list[0].skipped === false && list[2].skipped === false, 'A: only the moved athlete carries skipped:true');
    c.eq(list[1].run_order, 1, 'A: the moved athlete still reports run_order 1 (printed start number)');
    const nu = await api.must('GET', `/api/events/${evA}/runs/next-up`);
    c.ok(nu && nu.bib_number === 301 && nu.skipped === false && nu.run_number === 1, `A: /next-up is bib 301 (${JSON.stringify(nu)})`);
    const nu2 = await api.must('GET', `/api/events/${evA}/runs/next-up?run_number=2`);
    c.ok(nu2 && nu2.bib_number === 300, 'A: /next-up?run_number=2 is still bib 300 — the skip is Run 1 only');
    c.deepEq(bibs(await up(evA, 2)), [300, 301, 302, 303, 304, 305, 306, 307], 'A: /upcoming?run_number=2 unchanged');
    let rows = await skipRows(evA);
    c.ok(rows.length === 1 && rows[0].registration_id === R[0].id && rows[0].run_number === 1
      && Number(rows[0].base_order) === 1 && Number(rows[0].sort_order) === 2.5 && rows[0].match_id == null,
      `A: one run_order_skips row, base_order 1, sort_order 2.5 (${JSON.stringify(rows)})`);
    const audit = await db.queryAll(`SELECT * FROM audit_log WHERE action='run_order_skip' AND entity_id=?`, [R[0].id]);
    c.ok(audit.length === 1 && /"spots_requested":1/.test(audit[0].new_value || '') && /"to_position":2/.test(audit[0].new_value || ''),
      `A: audit row run_order_skip with positions (${audit.length ? audit[0].new_value : 'none'})`);
    const regsA = await api.must('GET', `/api/events/${evA}/registrations`);
    c.deepEq(regsA.filter(x => x.id === R[0].id).map(x => x.run_order), [1], 'A: registrations.run_order untouched');

    // =====================================================================
    // B. skip k, clamp, last, validation
    // =====================================================================
    r = await skip(evA, { registration_id: R[2].id, run_number: 1, spots: 3 });   // bib 302 at index 2 → index 5
    c.ok(r.status === 200 && r.data.to_position === 6, `B: skip by 3 → position 6 (${JSON.stringify(r.data)})`);
    c.deepEq(bibs(await up(evA)), [301, 300, 303, 304, 305, 302, 306, 307], 'B: order after skip by 3');
    r = await skip(evA, { registration_id: R[0].id, run_number: 1, spots: 50 });   // bib 300 at index 1 → last
    c.ok(r.status === 200 && r.data.moved === true && r.data.to_position === 8 && r.data.spots_moved === 6 && r.data.spots_requested === 50,
      `B: skip by 50 clamps to last (${JSON.stringify(r.data)})`);
    c.deepEq(bibs(await up(evA)), [301, 303, 304, 305, 302, 306, 307, 300], 'B: order after the clamped skip');
    r = await skip(evA, { registration_id: R[0].id, run_number: 1, spots: 1 });
    c.ok(r.status === 200 && r.data.moved === false && /already last/.test(r.data.message), `B: skipping the last athlete → 200 moved:false (${r.data.message})`);
    rows = await skipRows(evA);
    c.eq(rows.length, 2, 'B: moved:false wrote no row (still 2 rows)');
    r = await skip(evA, { registration_id: R[1].id, run_number: 1, spots: 0 });
    c.eq(r.status, 400, 'B: spots 0 → 400');
    r = await skip(evA, { registration_id: R[1].id, run_number: 1, spots: 'abc' });
    c.eq(r.status, 400, 'B: spots "abc" → 400');
    r = await skip(evA, { registration_id: R[1].id, run_number: 1, spots: '2' });
    c.ok(r.status === 200 && r.data.spots_requested === 2, 'B: spots "2" (string from an input) accepted as 2');
    r = await skip(evA, { registration_id: R[1].id, run_number: 1, spots: 1, raw_score: 9 });
    c.ok(r.status === 400 && /Unexpected fields/.test(r.data.error), 'B: extra field refused (public endpoint)');
    r = await skip(evA, { run_number: 1 });
    c.eq(r.status, 400, 'B: missing registration_id → 400');
    r = await skip(evA, { registration_id: 'nope', run_number: 1 });
    c.ok(r.status === 400 && /does not belong/.test(r.data.error), 'B: foreign registration → 400');
    r = await skip(evA, { registration_id: R[1].id, run_number: 0 });
    c.eq(r.status, 400, 'B: run_number 0 → 400');
    r = await skip(evA, { registration_id: R[1].id });
    c.ok(r.status === 200, 'B: run_number and spots default to 1');

    // =====================================================================
    // C. repeat skips (one row), restore, second restore 404
    // =====================================================================
    // after B: 301 was skipped twice (by 2, then by 1) → [303, 304, 305, 301, 302, 306, 307, 300]
    c.deepEq(bibs(await up(evA)), [303, 304, 305, 301, 302, 306, 307, 300], 'C: order after two repeat skips of bib 301');
    rows = await skipRows(evA);
    c.eq(rows.filter(x => x.registration_id === R[1].id).length, 1, 'C: repeat skips UPSERT one row per athlete');
    r = await restore(evA, R[1].id, 1);
    c.eq(r.status, 200, 'C: DELETE /runs/skip/:registrationId → 200');
    list = await up(evA);
    c.ok(list[0].bib_number === 301 && list[0].skipped === false, `C: bib 301 back at its original spot (${bibs(list)})`);
    c.deepEq(bibs(list), [301, 303, 304, 305, 302, 306, 307, 300], 'C: the other skips are unaffected by the restore');
    r = await restore(evA, R[1].id, 1);
    c.eq(r.status, 404, 'C: second restore → 404');
    r = await restore(evA, 'nope', 1);
    c.eq(r.status, 400, 'C: restore of a foreign registration → 400');
    const auditR = await db.queryAll(`SELECT * FROM audit_log WHERE action='run_order_skip_restored' AND entity_id=?`, [R[1].id]);
    c.eq(auditR.length, 1, 'C: audit row run_order_skip_restored');

    // =====================================================================
    // D. DNS of a skipped athlete, skip during a live run, stale card
    // =====================================================================
    r = await api.post(`/api/events/${evA}/runs/status-only`, { registration_id: R[2].id, run_number: 1, round: 'qualification', run_status: 'DNS' });
    c.eq(r.status, 201, 'D: DNS (status-only) of a skipped athlete → 201');
    c.deepEq(bibs(await up(evA)), [301, 303, 304, 305, 306, 307, 300], 'D: the DNS athlete leaves the queue');
    const live = await api.must('POST', `/api/events/${evA}/runs`, { registration_id: R[1].id, run_number: 1, round: 'qualification' });
    r = await skip(evA, { registration_id: R[3].id, run_number: 1, spots: 1 });   // bib 303 now first in the queue
    c.ok(r.status === 200 && r.data.moved === true, 'D: skip while another run is in progress → 200');
    c.deepEq(bibs(await up(evA)), [304, 303, 305, 306, 307, 300], 'D: queue after the mid-run skip');
    r = await skip(evA, { registration_id: R[1].id, run_number: 1, spots: 1 });
    c.ok(r.status === 409 && /already has a Run 1 entry \(in progress\)/.test(r.data.error), `D: skipping the athlete on course → 409 (${r.data.error})`);
    const active = await api.must('GET', `/api/events/${evA}/runs/active`);
    c.eq(active.run_position, 2, 'D: /runs/active run_position is the stored run_order (2), not a skip key');
    r = await skip(evA, { registration_id: R[2].id, run_number: 1, spots: 1 });
    c.ok(r.status === 409 && /\(complete\)/.test(r.data.error), 'D: skipping a DNS\'d athlete → 409 (has a complete entry)');
    await api.must('POST', `/api/events/${evA}/runs/${live.id}/abandon`, {});

    // =====================================================================
    // E. phased: Run 1 skip never reaches Run 2; Run 2 skip leaves Run 1 alone
    // =====================================================================
    const P = await makeEvent(api, { name: 'Skip P', n: 6, bibStart: 400 });
    const evP = P.event.id;
    r = await skip(evP, { registration_id: P.regs[0].id, run_number: 1, spots: 2 });
    c.deepEq(bibs(await up(evP)), [401, 402, 400, 403, 404, 405], 'E: flat Run 1 order after skipping bib 400 by 2');
    // play Run 1 in the EFFECTIVE order (as the tablets would)
    const run1Order = [];
    for (let g = 0; g < 10; g++) {
      const q = await up(evP, 1);
      if (!q.length) break;
      run1Order.push(q[0].bib_number);
      await playMogulRun(api, evP, P.judges, q[0].id, 1, g);
    }
    c.deepEq(run1Order, [401, 402, 400, 403, 404, 405], 'E: Run 1 was run in the effective order');
    await api.must('POST', `/api/events/${evP}/runs/round-status/1/finalize`, {});
    const created = await api.must('POST', `/api/events/${evP}/phases`, { phase_type: 'best_of_2', run_order_method: 'same' });
    const phases = await api.must('GET', `/api/events/${evP}/phases`);
    const p1 = phases.find(p => p.run_number === 1), p2 = phases.find(p => p.run_number === 2);
    c.ok(p1 && p2 && created, 'E: Best of 2 created (Run 1 retro phase + Run 2)');
    c.deepEq(bibs(await up(evP, 2)), [400, 401, 402, 403, 404, 405], 'E: Run 2 ("same" order) follows the STORED Run 1 order, not the skipped one');
    const el1 = await api.must('GET', `/api/events/${evP}/phases/${p1.id}/eligible`);
    c.ok(el1[0].bib_number === 400 && el1[0].run_order === 1 && el1[0].skipped === true, 'E: Run 1 /eligible keeps stored order and flags bib 400 skipped (Run 1 row still live)');
    const el2 = await api.must('GET', `/api/events/${evP}/phases/${p2.id}/eligible`);
    c.ok(el2.every(x => x.skipped === false), 'E: Run 2 /eligible has no skipped athlete');
    r = await skip(evP, { registration_id: P.regs[1].id, run_number: 2, spots: 1 });   // bib 401 (Run 2 order 2) → after 402
    c.deepEq(bibs(await up(evP, 2)), [400, 402, 401, 403, 404, 405], 'E: Run 2 skip applied to Run 2 only');
    c.deepEq((await api.must('GET', `/api/events/${evP}/phases/${p1.id}/eligible`)).map(x => x.bib_number), [400, 401, 402, 403, 404, 405], 'E: Run 1 /eligible unchanged by the Run 2 skip');
    c.deepEq((await api.must('GET', `/api/events/${evP}/phases/${p2.id}/eligible`)).map(x => x.bib_number), [400, 401, 402, 403, 404, 405], 'E: Run 2 /eligible (stored order) unchanged by the skip');
    // rebuild-order with another method → bib 401's base number changes → the row is inert
    await api.must('POST', `/api/events/${evP}/phases/${p2.id}/rebuild-order`, { run_order_method: 'last_to_first' });
    const rebuilt = await api.must('GET', `/api/events/${evP}/phases/${p2.id}/eligible`);
    const q2 = await up(evP, 2);
    c.deepEq(bibs(q2), rebuilt.map(x => x.bib_number), 'E: after rebuild-order the queue equals the rebuilt stored order (stale skip row inert)');
    const b401 = q2.find(x => x.bib_number === 401);
    c.ok(b401 && b401.skipped === false, 'E: bib 401 no longer reports skipped (base number changed)');
    rows = await skipRows(evP);
    c.eq(rows.filter(x => x.run_number === 2).length, 1, 'E: the inert row is still there (self-healing needs no cleanup)');
    const fresh = q2.find((x, i) => x.bib_number !== 401 && i < q2.length - 1);
    r = await skip(evP, { registration_id: fresh.id, run_number: 2, spots: 1 });
    c.ok(r.status === 200 && r.data.moved === true, 'E: a fresh Run 2 skip (another athlete) after the rebuild works');
    rows = await skipRows(evP);
    c.eq(rows.filter(x => x.run_number === 2).length, 2, 'E: … as its own row');

    // =====================================================================
    // F. no effect on results / exports / PDFs; viewer upcoming follows the skip
    // =====================================================================
    const before = await snapshotNoEffect(api, base, evP, 'f_before');
    const qF = await up(evP, 2);
    r = await skip(evP, { registration_id: qF[1].id, run_number: 2, spots: 2 });
    c.eq(r.status, 200, 'F: skip in Run 2 (for the no-effect compare)');
    const after = await snapshotNoEffect(api, base, evP, 'f_after');
    c.ok(before === after, 'F: results, judge scores, viewer results, registrations order, CSV, start-list + run-order PDFs byte-identical across a skip');
    const vs = await api.must('GET', `/api/viewer/events/${evP}/status?upcoming_limit=all`);
    c.deepEq(vs.upcoming_athletes.map(u => u.bib_number), bibs(await up(evP, 2)), 'F: viewer /status upcoming_athletes follows the effective Run 2 order');
    c.ok(vs.upcoming_athletes.some(u => u.skipped === true) && vs.current_run_number === 2, 'F: viewer rows carry skipped + current_run_number 2');

    // =====================================================================
    // G. dual moguls
    // =====================================================================
    const D = await makeDual(api, { name: 'Skip D', gender: 'M', athletes: 16, runoff: 'runoff_to_8th' });
    const evD = D.event.id;
    const dskip = (body) => api.post(`/api/events/${evD}/dual/skip`, body);
    const drestore = (mid, opts) => api.del(`/api/events/${evD}/dual/skip/${mid}`, undefined, opts);
    let br = await api.must('GET', `/api/events/${evD}/dual`);
    const r16 = br.filter(m => m.bracket_round === 4 && !m.is_small_final).sort((a, b) => a.pairing_number - b.pairing_number);
    c.ok(r16.length === 8 && r16.every(m => m.run_sequence === m.pairing_number && m.skipped === false), 'G: 8 Round-of-16 matches, run_sequence == pairing_number, none skipped');
    const pdfBefore = (await fetchPdf(base, 'dual-bracket', evD, F('g_bracket_before.pdf'))).text + (await fetchPdf(base, 'bracket-keeper', evD, F('g_keeper_before.pdf'))).text;
    r = await dskip({ match_id: r16[0].id, spots: 2 });
    c.ok(r.status === 200 && r.data.moved === true && r.data.from_position === 1 && r.data.to_position === 3 && r.data.pairing_label === 'M-01',
      `G: skip M-01 by 2 → position 3 (${JSON.stringify(r.data)})`);
    c.ok(/Pairing M-01 moved down 2 spots to position 3 of 8 in the Round of 16/.test(r.data.message), `G: message "${r.data.message}"`);
    br = await api.must('GET', `/api/events/${evD}/dual`);
    let m1 = br.find(m => m.id === r16[0].id);
    c.ok(m1.pairing_number === 1 && m1.pairing_label === 'M-01' && m1.run_sequence === 3.5 && m1.skipped === true,
      `G: M-01 keeps pairing 1 / label, run_sequence 3.5, skipped (${JSON.stringify({ p: m1.pairing_number, l: m1.pairing_label, s: m1.run_sequence, k: m1.skipped })})`);
    c.deepEq(readyBySequence(br).slice(0, 4).map(m => m.pairing_label), ['M-02', 'M-03', 'M-01', 'M-04'], 'G: HJ-style ready sort now M-02, M-03, M-01, M-04');
    const pdfAfter = (await fetchPdf(base, 'dual-bracket', evD, F('g_bracket_after.pdf'))).text + (await fetchPdf(base, 'bracket-keeper', evD, F('g_keeper_after.pdf'))).text;
    c.ok(pdfBefore === pdfAfter, 'G: bracket + keeper PDFs byte-identical across the skip');
    r = await dskip({ match_id: r16[7].id, spots: 5 });
    c.ok(r.status === 200 && r.data.moved === false && /last match left in the Round of 16/.test(r.data.message), `G: skipping the last pending match of the block → moved:false (${r.data.message})`);
    r = await dskip({ match_id: r16[6].id, spots: 5 });
    c.ok(r.status === 200 && r.data.moved === true && r.data.to_position === 8, 'G: skip M-07 by 5 clamps to last of the block');
    br = await api.must('GET', `/api/events/${evD}/dual`);
    const m7 = br.find(m => m.id === r16[6].id);
    c.ok(m7.run_sequence > 8 && m7.run_sequence < 9, `G: M-07 run_sequence ${m7.run_sequence} sits after M-08 (8) and before the first quarterfinal (9)`);
    r = await dskip({ match_id: r16[0].id, spots: 1, blue_points: 3 });
    c.eq(r.status, 400, 'G: extra field refused');
    r = await dskip({ match_id: 'nope', spots: 1 });
    c.eq(r.status, 404, 'G: unknown match → 404');
    // play the Round of 16 except the skipped M-01 (in the effective order)
    for (let g = 0; g < 20; g++) {
      br = await api.must('GET', `/api/events/${evD}/dual`);
      const next = readyBySequence(br).filter(m => m.id !== r16[0].id && m.bracket_round === 4)[0];
      if (!next) break;
      await api.must('PUT', `/api/events/${evD}/dual/active-match`, { match_id: next.id });
      await decide(api, evD, next, next.pairing_number % 2 ? 'blue' : 'red');
    }
    br = await api.must('GET', `/api/events/${evD}/dual`);
    const readyQF = readyBySequence(br).filter(m => m.bracket_round === 3);
    c.ok(readyQF.length >= 1, `G: ${readyQF.length} quarterfinal(s) are ready while M-01 is still pending`);
    r = await api.put(`/api/events/${evD}/dual/active-match`, { match_id: readyQF[0].id });
    c.ok(r.status === 409 && /Pairing M-01 \(Round of 16\) was skipped and must still be run before M-/.test(r.data.error) && r.data.skipped_match_id === r16[0].id,
      `G: starting a quarterfinal before the skipped M-01 → 409 (${r.data.error})`);
    c.deepEq(readyBySequence(br)[0].pairing_label, 'M-01', 'G: the HJ-style ready sort still offers M-01 first');
    r = await dskip({ match_id: r16[1].id, spots: 1 });
    c.ok(r.status === 409 && /complete, already started, or not yet filled/.test(r.data.error), 'G: skipping a complete match → 409');
    r = await api.put(`/api/events/${evD}/dual/active-match`, { match_id: r16[0].id });
    c.eq(r.status, 200, 'G: starting the skipped M-01 itself → 200');
    const am = await api.must('GET', `/api/events/${evD}/dual/active-match`);
    c.ok(am.pairing_label === 'M-01' && am.run_sequence === 3.5 && am.skipped === true, 'G: /active-match carries run_sequence + skipped');
    await decide(api, evD, r16[0], 'blue');
    br = await api.must('GET', `/api/events/${evD}/dual`);
    r = await api.put(`/api/events/${evD}/dual/active-match`, { match_id: readyBySequence(br).filter(m => m.bracket_round === 3)[0].id });
    c.eq(r.status, 200, 'G: with M-01 complete the quarterfinal starts');
    await api.must('DELETE', `/api/events/${evD}/dual/active-match`);
    r = await drestore(r16[6].id);
    c.eq(r.status, 200, 'G: restore of M-07 (complete by now) → 200');
    br = await api.must('GET', `/api/events/${evD}/dual`);
    const m7b = br.find(m => m.id === r16[6].id);
    c.ok(m7b.skipped === false && m7b.run_sequence === 7, 'G: M-07 back to run_sequence 7');
    r = await drestore(r16[6].id);
    c.eq(r.status, 404, 'G: second restore → 404');
    c.eq((await skipRows(evD)).length, 1, 'G: one dual skip row left (M-01)');
    const dualAudit = await db.queryAll(`SELECT action FROM audit_log WHERE entity='dual_match' AND entity_id IN (?, ?) ORDER BY timestamp`, [r16[0].id, r16[6].id]);
    c.ok(dualAudit.some(a => a.action === 'dual_match_skip') && dualAudit.some(a => a.action === 'dual_match_skip_restored'), 'G: dual skip + restore audit rows');
    r = await api.post(`/api/events/${evD}/runs/skip`, { registration_id: D.regs[0].id, run_number: 1, spots: 1 });
    c.ok(r.status === 400 && /dual skip endpoint/.test(r.data.error), 'G: /runs/skip refuses a dual event');

    // =====================================================================
    // H. access: adoption lock 423, event lock 403, password protection
    // =====================================================================
    await db.execute(`UPDATE meets SET adoption_status='adopted', adopted_at=datetime('now'), sync_token_hash='fake-token-hash' WHERE id=?`, [A.meet.id]);
    r = await skip(evA, { registration_id: R[3].id, run_number: 1, spots: 1 });
    c.eq(r.status, 423, 'H: POST /runs/skip against an adopted meet → 423');
    r = await restore(evA, R[3].id, 1);
    c.eq(r.status, 423, 'H: restore against an adopted meet → 423');
    await db.execute(`UPDATE meets SET adoption_status='adopted', adopted_at=datetime('now'), sync_token_hash='fake-token-hash' WHERE id=?`, [D.meet.id]);
    r = await dskip({ match_id: r16[6].id, spots: 1 });
    c.eq(r.status, 423, 'H: POST /dual/skip against an adopted meet → 423');
    await db.execute(`UPDATE meets SET adoption_status=NULL, adopted_at=NULL, sync_token_hash=NULL WHERE id IN (?, ?)`, [A.meet.id, D.meet.id]);
    await db.execute(`UPDATE events SET locked=1 WHERE id=?`, [evP]);
    const qH = await up(evP, 2);
    r = await skip(evP, { registration_id: qH[0].id, run_number: 2, spots: 1 });
    c.eq(r.status, 403, 'H: locked event → 403');
    await db.execute(`UPDATE events SET locked=0 WHERE id=?`, [evP]);
    await api.must('POST', '/api/admin/users', { username: 'v280admin', display_name: 'V280 Admin', password: 'v280-password', role: 'system_admin' });
    await api.must('PUT', '/api/admin/auth-settings', { enabled: true });
    const anon = new Api(cloud.base);
    r = await anon.post(`/api/events/${evP}/runs/skip`, { registration_id: qH[0].id, run_number: 2, spots: 1 });
    c.eq(r.status, 200, 'H: protection ON → anonymous tablet skip still 200');
    r = await anon.get(`/api/events/${evP}/runs/next-up`);
    c.eq(r.status, 200, 'H: protection ON → /next-up still public');
    r = await anon.del(`/api/events/${evP}/runs/skip/${qH[0].id}?run_number=2`);
    c.eq(r.status, 401, 'H: protection ON → anonymous restore 401');
    r = await anon.del(`/api/events/${evD}/dual/skip/${r16[0].id}`);
    c.eq(r.status, 401, 'H: protection ON → anonymous dual restore 401');
    const login = await anon.post('/api/auth/login', { username: 'v280admin', password: 'v280-password' });
    const authed = new Api(cloud.base, { token: login.data && login.data.token });
    r = await authed.del(`/api/events/${evP}/runs/skip/${qH[0].id}?run_number=2`);
    c.eq(r.status, 200, 'H: … and 200 with a token');
    r = await anon.post(`/api/events/${evD}/dual/skip`, { match_id: r16[0].id, spots: 1 });
    c.ok(r.status === 409 || r.status === 200, 'H: protection ON → anonymous dual skip reaches the endpoint (not 401)');
    r = await authed.del(`/api/events/${evD}/dual/reset`);
    c.eq(r.status, 200, 'H: dual /reset → 200');
    c.eq((await skipRows(evD)).length, 0, 'H: /reset removed the event\'s dual skip rows');
    // =====================================================================
    // I. ultra review fixes (10-28-26): expected_position, phase delete,
    //    active dual match, replace-import cleanup
    // =====================================================================
    await authed.must('PUT', '/api/admin/auth-settings', { enabled: false });   // H left protection ON
    const I = await makeEvent(api, { name: 'Skip I', n: 5, bibStart: 500 });
    const evI = I.event.id;
    r = await skip(evI, { registration_id: I.regs[0].id, run_number: 1, spots: 1, expected_position: 1 });
    c.ok(r.status === 200 && r.data.moved === true, 'I: skip with expected_position 1 → 200');
    r = await skip(evI, { registration_id: I.regs[0].id, run_number: 1, spots: 1, expected_position: 1 });
    c.ok(r.status === 409 && /no longer at position 1 \(now 2 of 5\)/.test(r.data.error) && r.data.from_position === 2,
      `I: a second tablet's stale skip (expected_position 1) → 409 (${r.data.error})`);
    c.deepEq(bibs(await up(evI)), [501, 500, 502, 503, 504], 'I: the stale request moved nothing');
    r = await skip(evI, { registration_id: I.regs[0].id, run_number: 1, spots: 1, expected_position: 'x' });
    c.eq(r.status, 400, 'I: expected_position "x" → 400');
    r = await skip(evI, { registration_id: I.regs[0].id, run_number: 1, spots: 1, expected_position: 2 });
    c.ok(r.status === 200 && r.data.moved === true, 'I: expected_position 2 (correct) → 200');
    c.eq((await skipRows(evI)).length, 1, 'I: still one row for the athlete');
    // phase delete clears that run number's rows
    for (let g = 0; g < 10; g++) {
      const q = await up(evI, 1);
      if (!q.length) break;
      await playMogulRun(api, evI, I.judges, q[0].id, 1, g);
    }
    await api.must('POST', `/api/events/${evI}/runs/round-status/1/finalize`, {});
    await api.must('POST', `/api/events/${evI}/phases`, { phase_type: 'best_of_2', run_order_method: 'same' });
    let phI = await api.must('GET', `/api/events/${evI}/phases`);
    const pI2 = phI.find(p => p.run_number === 2);
    const qI2 = await up(evI, 2);
    r = await skip(evI, { registration_id: qI2[0].id, run_number: 2, spots: 1 });
    c.ok(r.status === 200 && (await skipRows(evI)).filter(x => x.run_number === 2).length === 1, 'I: Run 2 skip recorded');
    r = await api.del(`/api/events/${evI}/phases/${pI2.id}`);
    c.eq(r.status, 200, 'I: DELETE /phases/:id (weather cancel) → 200');
    c.eq((await skipRows(evI)).filter(x => x.run_number === 2).length, 0, 'I: the phase delete removed the Run 2 skip rows');
    c.eq((await skipRows(evI)).filter(x => x.run_number === 1).length, 1, 'I: … and left the Run 1 row alone');
    await api.must('POST', `/api/events/${evI}/phases`, { phase_type: 'best_of_2', run_order_method: 'same' });
    c.ok((await up(evI, 2)).every(a => a.skipped === false), 'I: the re-added phase has no revived skip');
    // dual: the active match cannot be skipped; stale expected_position refused
    const D2 = await makeDual(api, { name: 'Skip D2', gender: 'F', athletes: 8, runoff: 'runoff_to_4th' });
    const evD2 = D2.event.id;
    br = await api.must('GET', `/api/events/${evD2}/dual`);
    const r8 = readyBySequence(br);
    await api.must('PUT', `/api/events/${evD2}/dual/active-match`, { match_id: r8[0].id });
    r = await api.post(`/api/events/${evD2}/dual/skip`, { match_id: r8[0].id, spots: 1 });
    c.ok(r.status === 409 && /complete, already started/.test(r.data.error), 'I: the LIVE pairing (status still pending) cannot be skipped');
    r = await api.post(`/api/events/${evD2}/dual/skip`, { match_id: r8[1].id, spots: 1, expected_position: 1 });
    c.ok(r.status === 200 && r.data.moved === true && r.data.from_position === 1, 'I: the first WAITING pairing (after the live one) skips with expected_position 1');
    r = await api.post(`/api/events/${evD2}/dual/skip`, { match_id: r8[1].id, spots: 1, expected_position: 1 });
    c.ok(r.status === 409 && /no longer at position 1/.test(r.data.error), 'I: a stale dual skip → 409');
    br = await api.must('GET', `/api/events/${evD2}/dual`);
    c.ok(br.find(m => m.id === r8[0].id).skipped === false && br.find(m => m.id === r8[1].id).skipped === true, 'I: only the waiting pairing carries skipped');
    await api.must('DELETE', `/api/events/${evD2}/dual/active-match`);
    // replace-import cleanup statement
    const { clearMeetLocalStatements } = require('../../server/sync/adoptionImport');
    const stmts = clearMeetLocalStatements('m');
    c.ok(stmts.some(s => /DELETE FROM run_order_skips/.test(s.sql)), 'I: venue replace-import clears the meet\'s skip rows');
    c.ok(stmts.findIndex(s => /run_order_skips/.test(s.sql)) < stmts.findIndex(s => /DELETE FROM events /.test(s.sql)), 'I: … before the events rows go');

    const errs = cloud.log.filter(l => /run_order_skips|skips\.js|TypeError|ReferenceError/.test(l));
    c.eq(errs.length, 0, `H: no skip-related server errors in the log${errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''}`);
  } finally {
    db.close();
    await cloud.stop().catch(() => {});
  }
  return c;
}

module.exports = { main };
