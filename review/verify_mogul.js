/**
 * Mogul verification harness (Phase 2).
 *
 * For every mogul event in a .fre file, recomputes each run three ways:
 *   spec    independent rule-derived value (review/lib/spec.js, with rulings)
 *   engine  StickIt's actual engine (server/scoring/engine.js)
 *   winfree reconstruction using the judge air totals embedded in the .fre
 *           (Winfree's own per-judge floor convention)
 * then ranks best-of-two and compares against official outputs:
 *   - FIS XML exports (exact bib -> rank -> Pointsdescend) when provided
 *   - text-layer result PDFs (parsed externally) when provided
 *
 * Usage: node review/verify_mogul.js <file.fre> [--xml g=path ...] [--len N]
 *        [--division comp|rqs|devo] [--jumps 1|2] [--nospeed] [--v]
 */
const fs = require('fs');
const path = require('path');
const { parseFre } = require('./lib/parseFre');
const spec = require('./lib/spec');
const engine = require(path.join(__dirname, '..', 'server', 'scoring', 'engine.js'));

function parseXmlResults(xmlPath) {
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const out = [];
  const re = /<FS_ranked[^>]*>([\s\S]*?)<\/FS_ranked>/g;
  let m;
  while ((m = re.exec(xml))) {
    const blk = m[1];
    const g = (tag) => { const mm = blk.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)); return mm ? mm[1] : null; };
    out.push({
      rank: Number(g('Rank')),
      bib: Number(g('Bib')),
      points: Number(g('Pointsdescend')),
      last: g('Lastname'),
    });
  }
  // not-ranked block too
  const nr = /<FS_notranked[^>]*Status="([^"]*)"[^>]*>([\s\S]*?)<\/FS_notranked>/g;
  const notRanked = [];
  while ((m = nr.exec(xml))) {
    const blk = m[2];
    const bm = blk.match(/<Bib>(\d+)<\/Bib>/);
    notRanked.push({ status: m[1], bib: bm ? Number(bm[1]) : null });
  }
  return { ranked: out, notRanked };
}

function airInputs(run) {
  // Build per-jump judge score arrays + DDs from the ma detail.
  const det = run.airDetail || [];
  const j1 = { scores: [], dd: 0 };
  const j2 = { scores: [], dd: 0 };
  for (const d of det) {
    if (d.s1 != null && d.s1 > 0) { j1.scores.push(d.s1); if (d.dd1) j1.dd = d.dd1; }
    if (d.s2 != null && d.s2 > 0) { j2.scores.push(d.s2); if (d.dd2) j2.dd = d.dd2; }
  }
  return { j1, j2 };
}

function computeRun(run, opts) {
  const { division, numJumps, hasSpeed, pace } = opts;
  const { j1, j2 } = airInputs(run);
  const codes = run.codes || [];
  const isRepeat = numJumps >= 2 && codes.length >= 2 &&
    engine.areJumpsRepeats(codes[0], codes[1]);

  // --- spec value ---
  const sTurns = spec.turnsScore(run.tlScores);
  const sAir = spec.airScore(j1, j2, numJumps, division, isRepeat);
  const sSpeed = hasSpeed ? spec.speedScore(run.time, pace) : 0;
  const sTotal = spec.totalScore(sTurns, sAir, sSpeed);

  // --- StickIt engine value ---
  let dd1 = j1.dd, dd2 = j2.dd;
  if (isRepeat) {
    const adj = engine.applyRepeatJumpRule(dd1, dd2, division);
    dd1 = adj.dd1; dd2 = adj.dd2;
  }
  const er = engine.calcMogulScore({
    tlScores: run.tlScores,
    airScoresJump1: j1.scores, dd1,
    airScoresJump2: j2.scores, dd2,
    runTime: hasSpeed ? run.time : null,
    paceTime: hasSpeed ? pace : null,
    hasSpeed,
    numTlJudges: run.tlScores.length,
    numJumps,
  });

  // --- Winfree reconstruction (their embedded per-judge air totals) ---
  const wAirTotals = run.airJudgeTotals || [];
  const wAirCount = wAirTotals.filter(x => x > 0).length || wAirTotals.length;
  let wAir = wAirTotals.length
    ? wAirTotals.reduce((a, b) => a + b, 0) / (wAirCount || 1)
    : 0;
  if (numJumps === 1) wAir = Math.min(wAir * 2, 20);
  wAir = spec.trunc2(Math.min(wAir, 20));
  const wTurns = sTurns;
  const wSpeed = sSpeed;
  const wTotal = spec.totalScore(wTurns, wAir, wSpeed);

  return {
    status: run.status, time: run.time, codes,
    isRepeat,
    specv: { turns: sTurns, air: sAir, speed: sSpeed, total: sTotal,
             airNoDd: spec.airNoDd(j1, j2, numJumps) },
    eng:  { turns: er.turnsContrib, air: er.airContrib, speed: er.speedContrib,
            total: er.total, airNoDd: er.airNoDd },
    winf: { turns: wTurns, air: wAir, speed: wSpeed, total: wTotal },
  };
}

function main() {
  const args = process.argv.slice(2);
  const frePath = args[0];
  const opt = { division: 'comp', numJumps: 2, hasSpeed: true, verbose: false, len: null, xml: {}, event: 'M' };
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--xml') { const [g, p] = args[++i].split('='); opt.xml[g] = p; }
    else if (args[i] === '--len') opt.len = Number(args[++i]);
    else if (args[i] === '--division') opt.division = args[++i];
    else if (args[i] === '--jumps') opt.numJumps = Number(args[++i]);
    else if (args[i] === '--nospeed') opt.hasSpeed = false;
    else if (args[i] === '--event') opt.event = args[++i];
    else if (args[i] === '--pace') { const [g, p] = args[++i].split('='); (opt.pace ||= {})[g] = Number(p); }
    else if (args[i] === '--pdf') opt.pdf = args[++i];
    else if (args[i] === '--calibrate') opt.calibrate = true;
    else if (args[i] === '--v') opt.verbose = true;
  }

  const doc = parseFre(frePath);
  const ev = doc.events[opt.event];
  if (!ev) { console.error('No event', opt.event, 'in file. Events:', Object.keys(doc.events)); process.exit(1); }
  const homo = (ev.keys.Homo || '').split('~');
  const courseLen = opt.len || Number(homo[1]) || null;
  console.log(`# ${path.basename(frePath)}  event=${opt.event}  title=${ev.keys.EventTitle}`);
  console.log(`# course length=${courseLen}m  judges=${ev.keys.Judge}  division=${opt.division} jumps=${opt.numJumps} speed=${opt.hasSpeed}`);

  const runKeyPrefix = opt.event === 'M' ? 'M' : opt.event; // M -> M1/M2; M2 -> M21/M22
  let pdfRes = null;
  if (opt.pdf) {
    const { parsePdfResults } = require('./lib/parsePdfResults');
    pdfRes = parsePdfResults(fs.readFileSync(opt.pdf, 'utf8'));
    console.log(`# pdf: ${path.basename(opt.pdf)}  paceM=${pdfRes.paceM} paceF=${pdfRes.paceF}  athletes=${pdfRes.athletes.length}`);
  }

  for (const gender of ['F', 'M']) {
    let pace = opt.hasSpeed
      ? (opt.pace?.[gender]
         ?? (pdfRes && (gender === 'M' ? pdfRes.paceM : pdfRes.paceF))
         ?? spec.paceTime(courseLen, gender, 'usss'))
      : null;

    // --calibrate: solve the pace time Winfree actually used from official XML
    // totals.  total = turns + air + speed  =>  speed = official - turns - air;
    // speed = 48 - 32 t / p  =>  p = 32 t / (48 - speed).  Use the median across
    // athletes whose implied speed falls strictly inside (0, 20).
    if (opt.calibrate && opt.hasSpeed && opt.xml[gender]) {
      const xml = parseXmlResults(opt.xml[gender]);
      const cands = [];
      for (const x of xml.ranked) {
        const e = doc.entrants.find(en => en.gender === gender && en.bib === x.bib);
        if (!e) continue;
        for (const k of Object.keys(e.moRuns)) {
          const run = e.moRuns[k];
          if (run.status || !run.time || run.time <= 0) continue;
          const turns = spec.turnsScore(run.tlScores);
          const at = run.airJudgeTotals || [];
          const n = at.filter(v => v > 0).length || at.length || 1;
          const air = spec.trunc2(at.reduce((a, b) => a + b, 0) / n);
          const sp = +(x.points - turns - air).toFixed(2);
          if (sp > 0.5 && sp < 19.5) cands.push(32 * run.time / (48 - sp));
        }
      }
      if (cands.length >= 3) {
        // Right-run candidates cluster tightly; wrong-run candidates scatter.
        // Take the mode of the values rounded to 0.01.
        const freq = {};
        for (const c of cands) { const k = c.toFixed(2); freq[k] = (freq[k] || 0) + 1; }
        const best = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
        pace = Number(best[0]);
        console.log(`  [calibrated pace ${gender} = ${pace}  (${best[1]}/${cands.length} samples agree)]`);
      }
    }
    const runKeyRe = opt.event === 'M' ? /^M\d$/ : new RegExp(`^${opt.event}\\d$`);
    const entrants = doc.entrants.filter(e => e.gender === gender &&
      Object.keys(e.moRuns).some(k => runKeyRe.test(k)));
    if (!entrants.length) continue;
    console.log(`\n## Gender ${gender}  (${entrants.length} athletes, pace=${pace})`);

    const rows = [];
    for (const e of entrants) {
      const keys = Object.keys(e.moRuns).filter(k => runKeyRe.test(k)).sort();
      const runs = keys.map(k => computeRun(e.moRuns[k], { ...opt, pace }));
      // best of runs by spec tie-break, ignoring statused runs
      const scored = runs.filter(r => !r.status);
      const pickBest = (arr, key) => arr.length
        ? arr.reduce((b, r) => {
            const A = { total: r[key].total, turns: r[key].turns, airNoDd: r[key].airNoDd ?? 0, time: r.time };
            const B = b ? { total: b[key].total, turns: b[key].turns, airNoDd: b[key].airNoDd ?? 0, time: b.time } : null;
            return !B || spec.compareMogul(A, B) < 0 ? r : b;
          }, null)
        : null;
      const bestS = pickBest(scored, 'specv');
      const bestE = pickBest(scored, 'eng');
      const bestW = pickBest(scored, 'winf');
      rows.push({
        bib: e.bib, name: e.name, runs,
        spec: bestS ? { ...bestS.specv, time: bestS.time } : null,
        eng:  bestE ? { ...bestE.eng,  time: bestE.time } : null,
        winf: bestW ? { ...bestW.winf, time: bestW.time } : null,
        allStatus: scored.length === 0 ? runs.map(r => r.status).join('/') : null,
      });
    }

    // Rank each pipeline
    const mk = (key) => spec.rank(
      rows.filter(r => r[key]).map(r => ({ bib: r.bib, name: r.name, ...r[key] })),
      spec.compareMogul);
    const rs = mk('spec'), re_ = mk('eng'), rw = mk('winf');

    // Compare engine vs spec
    let diffs = 0;
    for (const r of rows) {
      if (!r.spec && !r.eng) continue;
      const d = Math.abs((r.spec?.total ?? -1) - (r.eng?.total ?? -1));
      if (d > 0.001) {
        diffs++;
        console.log(`  ENGINE!=SPEC bib ${r.bib} ${r.name}: spec=${r.spec?.total} engine=${r.eng?.total} ` +
          `(turns ${r.spec?.turns}/${r.eng?.turns} air ${r.spec?.air}/${r.eng?.air} speed ${r.spec?.speed}/${r.eng?.speed})`);
      }
    }
    console.log(`  engine-vs-spec total diffs: ${diffs}/${rows.length}`);

    // Compare vs XML if given
    const xmlPath = opt.xml[gender];
    if (xmlPath) {
      const xml = parseXmlResults(xmlPath);
      let exact = 0, near = 0, far = 0;
      for (const x of xml.ranked) {
        const r = rows.find(rr => rr.bib === x.bib);
        if (!r) { console.log(`  XML bib ${x.bib} not found in .fre`); continue; }
        const sv = r.spec?.total, ev2 = r.eng?.total, wv = r.winf?.total;
        const dS = sv != null ? +(x.points - sv).toFixed(2) : null;
        const dE = ev2 != null ? +(x.points - ev2).toFixed(2) : null;
        const dW = wv != null ? +(x.points - wv).toFixed(2) : null;
        const flag = dW === 0 ? '' : Math.abs(dW ?? 99) <= 0.02 ? ' ~' : ' **';
        if (dW === 0) exact++; else if (Math.abs(dW ?? 99) <= 0.02) near++; else far++;
        const srk = rs.find(z => z.bib === x.bib)?.rank;
        if (opt.verbose || dW !== 0 || dE !== 0 || srk !== x.rank) {
          console.log(`  XML r${x.rank} bib ${x.bib} ${x.last} pts=${x.points} | spec=${sv}(d${dS}) eng=${ev2}(d${dE}) winf=${wv}(d${dW}) specRank=${srk}${flag}`);
        }
      }
      console.log(`  XML compare: winfree-reconstruction exact=${exact} within0.02=${near} off=${far} of ${xml.ranked.length}`);
    } else if (pdfRes) {
      const pa = pdfRes.athletes.filter(a => (a.group || '').startsWith(gender) && a.eventTotal != null);
      let exact = 0, off = 0;
      for (const x of pa) {
        const r = rows.find(rr => rr.bib === x.bib);
        if (!r) { console.log(`  PDF bib ${x.bib} ${x.name} not in .fre ${gender}`); continue; }
        const sv = r.spec?.total, ev2 = r.eng?.total, wv = r.winf?.total;
        const dW = wv != null ? +(x.eventTotal - wv).toFixed(2) : null;
        const dE = ev2 != null ? +(x.eventTotal - ev2).toFixed(2) : null;
        const srk = rs.find(z => z.bib === x.bib)?.rank;
        if (dW === 0) exact++; else off++;
        if (opt.verbose || dW !== 0 || dE !== 0 || srk !== x.rank) {
          console.log(`  PDF r${x.rank} bib ${x.bib} ${x.name} pts=${x.eventTotal} | spec=${sv} eng=${ev2}(d${dE}) winf=${wv}(d${dW}) specRank=${srk}`);
        }
      }
      console.log(`  PDF compare ${gender}: winfree-reconstruction exact=${exact} off=${off} of ${pa.length}`);
    } else if (opt.verbose) {
      rs.slice(0, 10).forEach(r =>
        console.log(`  spec r${r.rank} bib ${r.bib} ${r.name} total=${r.total} (T${r.turns} A${r.air})`));
    }
  }
}

main();
