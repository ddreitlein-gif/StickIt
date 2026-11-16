/**
 * v2.8.01 -- PDF Reports tab: Run Order report sort, Time Sheet run label,
 * "Final Results" on list reports.
 *
 *   A  Run Order (and the /start-list alias) prints in RUN ORDER with the Ord
 *      column and the "By Moguls Run-order" sub-header when no sort is sent,
 *      when the Reports tab sends its own default ('run_order'), and for any
 *      value other than 'alpha' (the old registration 'bib' included);
 *      alphabetical only on an explicit sort:'alpha'
 *   B  Registration Listing still sorts by name (default) and by bib
 *   C  Manual Time Sheet labels the run that was selected
 *   D  runNumber 'final' on Run Order / Time Sheet prints no run number
 *      (never "Final Results"); nothing sent still prints "Run 1"
 *   E  Check Sheets unchanged: by bib / by run order, labelled with the run
 *   F  two-run event: Run Order, Time Sheet and Check Sheet by Run Order each
 *      print the order of the run SELECTED (Run 1 and Run 2 both printable
 *      while Run 2 is in progress); nothing sent prints the run in progress
 *
 * The six PDFs of the 11-16-26 verification are left in .scratch/v2801/.
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { Checks } = require('../lib/checks');
const { Instance } = require('../lib/instance');
const { Api } = require('../lib/client');
const { buildMeet } = require('../lib/fixtures');
const { seedMogulJudges, playMogulRun } = require('../lib/driver');

const SCRATCH = path.join(__dirname, '..', '.scratch', 'v2801');
fs.mkdirSync(SCRATCH, { recursive: true });
const F = (n) => path.join(SCRATCH, n);

// run order 1..6 -- neither alphabetical nor bib order
const ATHLETES = [
  { last: 'Zeller', first: 'Zed',   bib: 12 },
  { last: 'Adams',  first: 'Amy',   bib: 40 },
  { last: 'Moreno', first: 'Max',   bib: 7 },
  { last: 'Baker',  first: 'Bo',    bib: 33 },
  { last: 'Young',  first: 'Yan',   bib: 21 },
  { last: 'Carter', first: 'Cal',   bib: 5 },
];
const RUN_ORDER = ATHLETES.map(a => a.last.toUpperCase());
const ALPHA = [...RUN_ORDER].sort();
const BY_BIB = [...ATHLETES].sort((a, b) => a.bib - b.bib).map(a => a.last.toUpperCase());

async function pdf(base, which, eventId, options, file) {
  const body = options === undefined ? { eventId } : { eventId, options };
  const r = await fetch(`${base}/api/pdf/${which}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) return { status: r.status, text: '' };
  fs.writeFileSync(F(file), Buffer.from(await r.arrayBuffer()));
  return { status: r.status, text: execFileSync('pdftotext', ['-layout', F(file), '-']).toString() };
}
// last names in the order they appear in the PDF text
const nameOrder = (text) => {
  const hits = [];
  for (const n of RUN_ORDER) {
    const i = text.toUpperCase().indexOf(n + ',');
    if (i >= 0) hits.push([i, n]);
  }
  return hits.sort((a, b) => a[0] - b[0]).map(h => h[1]);
};

async function main() {
  const c = new Checks('v2801');
  const cloud = new Instance({ name: 'v2801-cloud', port: 3491, mode: 'cloud' });
  await cloud.start();
  const api = new Api(cloud.base);
  const base = cloud.base;

  try {
    const M = await buildMeet(api, { name: 'Report Sort', gender: 'M', discipline: 'mogul', athletes: 0, judges: [], startRun: false });
    const ev = M.event.id;
    const seeded = await seedMogulJudges(api, ev);
    const regs = [];
    for (let i = 0; i < ATHLETES.length; i++) {
      const a = ATHLETES[i];
      const ath = await api.must('POST', '/api/athletes', { first_name: a.first, last_name: a.last, gender: 'M', birth_year: 2008, ussa_num: `RS${7000 + i}`, club: 'Test Club' });
      regs.push(await api.must('POST', `/api/events/${ev}/registrations`, { athlete_id: ath.id, bib_number: a.bib }));
    }
    await api.must('PUT', `/api/events/${ev}/registrations/reorder`, regs.map((r, i) => ({ id: r.id, run_order: i + 1 })));

    // ---- A. Run Order ------------------------------------------------------
    const cases = [
      ['no options at all',            undefined,                              'ro_none.pdf'],
      ['empty options',                {},                                     'ro_empty.pdf'],
      ['Reports tab default',          { runNumber: 1, sort: 'run_order' },    'run_order_default.pdf'],
      ['old registration sort "bib"',  { runNumber: 1, sort: 'bib' },          'ro_bib.pdf'],
    ];
    for (const [label, opts, file] of cases) {
      const r = await pdf(base, 'run-order', ev, opts, file);
      c.eq(r.status, 200, `A: run-order (${label}) → 200`);
      c.deepEq(nameOrder(r.text), RUN_ORDER, `A: run-order (${label}) lists athletes in run order`);
      c.ok(/\bOrd\b/.test(r.text), `A: run-order (${label}) has the Ord column`);
      c.ok(/By Moguls Run-order/.test(r.text) && !/Alphabetical/.test(r.text), `A: run-order (${label}) sub-header "By Moguls Run-order"`);
    }
    const sl = await pdf(base, 'start-list', ev, {}, 'start_list.pdf');
    c.ok(sl.status === 200 && JSON.stringify(nameOrder(sl.text)) === JSON.stringify(RUN_ORDER) && /\bOrd\b/.test(sl.text),
      'A: /start-list alias (Print menu) still prints in run order with Ord');
    const al = await pdf(base, 'run-order', ev, { runNumber: 1, sort: 'alpha' }, 'run_order_alpha.pdf');
    c.deepEq(nameOrder(al.text), ALPHA, 'A: run-order with explicit sort:"alpha" is alphabetical');
    c.ok(/Alphabetical/.test(al.text) && !/\bOrd\b/.test(al.text) && !/By Moguls Run-order/.test(al.text),
      'A: explicit alpha → sub-header "Alphabetical", no Ord column');

    // ---- B. Registration Listing ------------------------------------------
    const rn = await pdf(base, 'registration', ev, { sort: 'alpha' }, 'registration_alpha.pdf');
    c.deepEq(nameOrder(rn.text), ALPHA, 'B: registration sort alpha → by name');
    c.ok(/by Name/.test(rn.text), 'B: registration alpha title "by Name"');
    const rd = await pdf(base, 'registration', ev, {}, 'reg_default.pdf');
    c.deepEq(nameOrder(rd.text), ALPHA, 'B: registration with no sort → by name');
    const rb = await pdf(base, 'registration', ev, { sort: 'bib' }, 'registration_bib.pdf');
    c.deepEq(nameOrder(rb.text), BY_BIB, 'B: registration sort bib → by bib');
    c.ok(/by Bib/.test(rb.text), 'B: registration bib title "by Bib"');

    // ---- C. Time Sheet run label ------------------------------------------
    const t1 = await pdf(base, 'timer-sheet', ev, { runNumber: 1 }, 'time_sheet_run1.pdf');
    c.ok(/Moguls Run 1\b/.test(t1.text), 'C: time sheet runNumber 1 → "Moguls Run 1"');
    c.deepEq(nameOrder(t1.text), RUN_ORDER, 'C: time sheet lists athletes in run order');
    const t2 = await pdf(base, 'timer-sheet', ev, { runNumber: 2 }, 'time_sheet_run2.pdf');
    c.ok(/Moguls Run 2\b/.test(t2.text) && !/Moguls Run 1\b/.test(t2.text), 'C: time sheet runNumber 2 → "Moguls Run 2"');
    const t0 = await pdf(base, 'timer-sheet', ev, {}, 'ts_none.pdf');
    c.ok(/Moguls Run 1\b/.test(t0.text), 'C: time sheet with nothing sent (Print menu) still "Moguls Run 1"');
    const r2 = await pdf(base, 'run-order', ev, { runNumber: 2, sort: 'run_order' }, 'ro_run2.pdf');
    c.ok(/Moguls Run 2\b/.test(r2.text), 'C: run-order runNumber 2 → "Moguls Run 2"');

    // ---- D. "Final Results" on list reports -------------------------------
    for (const [which, file] of [['run-order', 'ro_final.pdf'], ['timer-sheet', 'ts_final.pdf']]) {
      const f = await pdf(base, which, ev, { runNumber: 'final', sort: 'run_order' }, file);
      c.eq(f.status, 200, `D: ${which} runNumber "final" → 200`);
      c.ok(!/Final Results/.test(f.text) && !/Moguls Run \d/.test(f.text) && /Moguls/.test(f.text),
        `D: ${which} runNumber "final" prints "Moguls" with no run number and no "Final Results"`);
      c.deepEq(nameOrder(f.text), RUN_ORDER, `D: ${which} runNumber "final" still in run order`);
    }

    // ---- E. Check Sheets unchanged ----------------------------------------
    const cb = await pdf(base, 'check-bib', ev, { runNumber: 1 }, 'check_bib.pdf');
    c.deepEq(nameOrder(cb.text.replace(/, /g, ',')), BY_BIB, 'E: check sheet by bib sorted by bib');
    c.ok(/Moguls Run 1\b/.test(cb.text) && /By Bib/.test(cb.text), 'E: check sheet by bib header');
    const co = await pdf(base, 'check-order', ev, { runNumber: 2 }, 'check_order.pdf');
    c.deepEq(nameOrder(co.text.replace(/, /g, ',')), RUN_ORDER, 'E: check sheet by run order sorted by run order');
    c.ok(/Moguls Run 2\b/.test(co.text) && /By Run Order/.test(co.text), 'E: check sheet by run order header');

    // ---- F. two-run event: each run's sheet prints THAT run's order --------
    // Run 2 does not exist yet: a Run 2 sheet prints the stored (Run 1) order
    const pre = await pdf(base, 'run-order', ev, { runNumber: 2, sort: 'run_order' }, 'f_pre_run2.pdf');
    c.deepEq(nameOrder(pre.text), RUN_ORDER, 'F: before Run 2 is added, a Run 2 sheet prints the stored order');
    const js = seeded;
    for (let i = 0; i < regs.length; i++) await playMogulRun(api, ev, js, regs[i].id, 1, [3, 0, 5, 1, 4, 2][i]);
    await api.must('POST', `/api/events/${ev}/runs/round-status/1/finalize`, {});
    await api.must('POST', `/api/events/${ev}/phases`, { phase_type: 'best_of_2', run_order_method: 'same' });
    const phases = await api.must('GET', `/api/events/${ev}/phases`);
    const p2 = phases.find(p => p.run_number === 2);
    await api.must('POST', `/api/events/${ev}/phases/${p2.id}/rebuild-order`, { run_order_method: 'last_to_first' });
    const RUN2 = (await api.must('GET', `/api/events/${ev}/phases/${p2.id}/eligible`)).map(x => x.last_name.toUpperCase());
    c.ok(JSON.stringify(RUN2) !== JSON.stringify(RUN_ORDER) && RUN2.length === 6, `F: Run 2 order differs from Run 1 (${RUN2.join(', ')})`);

    // Run 2 is now the run in progress; both runs must still print correctly
    for (const [which, tag] of [['run-order', 'run_order'], ['timer-sheet', 'time_sheet'], ['check-order', 'check_order']]) {
      const a1 = await pdf(base, which, ev, { runNumber: 1, sort: 'run_order' }, `two_run_${tag}_run1.pdf`);
      const a2 = await pdf(base, which, ev, { runNumber: 2, sort: 'run_order' }, `two_run_${tag}_run2.pdf`);
      const fix = (t) => t.replace(/, /g, ',');
      c.deepEq(nameOrder(fix(a1.text)), RUN_ORDER, `F: ${which} Run 1 prints the Run 1 order while Run 2 is in progress`);
      c.ok(/Moguls Run 1\b/.test(a1.text), `F: ${which} Run 1 is labelled Run 1`);
      c.deepEq(nameOrder(fix(a2.text)), RUN2, `F: ${which} Run 2 prints the Run 2 order`);
      c.ok(/Moguls Run 2\b/.test(a2.text), `F: ${which} Run 2 is labelled Run 2`);
    }
    const cb2 = await pdf(base, 'check-bib', ev, { runNumber: 2 }, 'two_run_check_bib_run2.pdf');
    c.deepEq(nameOrder(cb2.text.replace(/, /g, ',')), BY_BIB, 'F: check sheet by bib for Run 2 still by bib, all six athletes');
    // nothing sent (Print menu) → the run in progress, labelled as such
    for (const which of ['start-list', 'timer-sheet']) {
      const n = await pdf(base, which, ev, {}, `two_run_${which}_none.pdf`);
      c.deepEq(nameOrder(n.text), RUN2, `F: ${which} with nothing sent prints the run in progress (Run 2)`);
      c.ok(/Moguls Run 2\b/.test(n.text), `F: ${which} with nothing sent is labelled Run 2`);
    }
    // the Ord numbers on the Run 2 sheet are 1..6 in Run 2 order
    const ro2 = fs.existsSync(F('two_run_run_order_run2.pdf')) ? execFileSync('pdftotext', ['-layout', F('two_run_run_order_run2.pdf'), '-']).toString() : '';
    const ords = ro2.split('\n').map(l => l.match(/^\s*(\d+)\s+\d+\s+M\d+/)).filter(Boolean).map(m => Number(m[1]));
    c.deepEq(ords, [1, 2, 3, 4, 5, 6], 'F: Run 2 sheet numbers the athletes 1 to 6');

    // ---- G. qualifier + final with a cut: each phase prints its own field ---
    const Q = await buildMeet(api, { name: 'Report Phases', gender: 'F', discipline: 'mogul', athletes: 0, judges: [], startRun: false });
    const evQ = Q.event.id;
    const jq = await seedMogulJudges(api, evQ);
    const regsQ = [];
    for (let i = 0; i < ATHLETES.length; i++) {
      const a = ATHLETES[i];
      const ath = await api.must('POST', '/api/athletes', { first_name: `Q${a.first}`, last_name: a.last, gender: 'F', birth_year: 2008, ussa_num: `RQ${8000 + i}`, club: 'Test Club' });
      regsQ.push(await api.must('POST', `/api/events/${evQ}/registrations`, { athlete_id: ath.id, bib_number: a.bib }));
    }
    await api.must('PUT', `/api/events/${evQ}/registrations/reorder`, regsQ.map((r, i) => ({ id: r.id, run_order: i + 1 })));
    for (let i = 0; i < regsQ.length; i++) await playMogulRun(api, evQ, jq, regsQ[i].id, 1, [3, 0, 5, 1, 4, 2][i]);
    await api.must('POST', `/api/events/${evQ}/runs/round-status/1/finalize`, {});
    await api.must('POST', `/api/events/${evQ}/phases`, { phase_type: 'final_1', final_size: 3, run_order_method: 'last_to_first' });
    const phQ = await api.must('GET', `/api/events/${evQ}/phases`);
    const f1 = phQ.find(p => p.phase_type === 'final_1');
    const FINAL = (await api.must('GET', `/api/events/${evQ}/phases/${f1.id}/eligible`)).map(x => x.last_name.toUpperCase());
    c.eq(FINAL.length, 3, `G: Final 1 holds 3 athletes (${FINAL.join(', ')})`);
    const fix = (t) => t.replace(/, /g, ',');
    for (const which of ['run-order', 'timer-sheet', 'check-order']) {
      const q1 = await pdf(base, which, evQ, { runNumber: 1, sort: 'run_order' }, `phases_${which}_q1.pdf`);
      c.deepEq(nameOrder(fix(q1.text)), RUN_ORDER, `G: ${which} Qualifier 1 prints all six in the qualifier order`);
      c.ok(/Moguls Run 1\b/.test(q1.text), `G: ${which} Qualifier 1 heading reads Run 1`);
      const ff = await pdf(base, which, evQ, { runNumber: f1.run_number, sort: 'run_order' }, `phases_${which}_f1.pdf`);
      c.deepEq(nameOrder(fix(ff.text)), FINAL, `G: ${which} Final 1 prints only the three finalists in the final order`);
      c.ok(new RegExp(`Moguls Run ${f1.run_number}\\b`).test(ff.text), `G: ${which} Final 1 heading reads Run ${f1.run_number}`);
    }
    const cbf = await pdf(base, 'check-bib', evQ, { runNumber: f1.run_number }, 'phases_check_bib_f1.pdf');
    c.eq(nameOrder(fix(cbf.text)).length, 3, 'G: check sheet by bib for Final 1 lists the three finalists');
    const rr = await pdf(base, 'run-results', evQ, { runNumber: 1 }, 'phases_run_results_q1.pdf');
    c.ok(rr.status === 200 && nameOrder(fix(rr.text)).length === 6, 'G: Run Results (untouched report) still lists all six for the qualifier');

    const errs = cloud.log.filter(l => /TypeError|ReferenceError/.test(l));
    c.eq(errs.length, 0, `no server errors in the log${errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await cloud.stop().catch(() => {});
  }
  return c;
}

module.exports = { main };
