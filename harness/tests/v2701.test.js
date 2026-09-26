/**
 * v2.7.01 acceptance — query indexes (the Turso rows-read fix).
 *
 *   A. GOLDEN COMPARE. One database file, built and scored through the REAL
 *      v2.7.00 server (git tag v2.7.00, a worktree at harness/.v270baseline —
 *      no query indexes), then served by THIS tree (which creates the twelve
 *      indexes at boot). Every read endpoint the tablets, Scoreboard, Overlay,
 *      Broadcast Board, Viewer API, Officials pages, exports (CSV / XLSX / HTML)
 *      and PDFs (pdftotext) use is captured on both and diffed. Fixtures: a
 *      24-athlete Best-of-2 mogul event with a rejection and a DNF, a
 *      qualifier / finals mogul event with a DNS, an aerials v2 event, a
 *      16-athlete dual with runoff to 8th played to completion, and the
 *      RMF_Mock_Comp_08-30-26.zip import (when present on this Mac).
 *      The ONLY tolerated difference: audit rows sharing one timestamp second
 *      come back newest-first (the timestamp index now satisfies the ORDER BY
 *      and is walked in reverse) where the sorter returned them oldest-first —
 *      the (c) case recorded in the release note. Those lists are compared
 *      with a deterministic tie order; everything else must be byte-identical.
 *   B. EXPLAIN QUERY PLAN for the Turso Top Queries (section 2 of the prompt)
 *      and every static SELECT in the server that reads an indexed table,
 *      before (indexes dropped on a copy) and after. The section-2 queries
 *      must SEARCH their indexed table USING INDEX idx_… afterwards. The full
 *      plan listing is written to harness/.scratch/v2701/plans.txt.
 *   C. VENUE MODE. Adopt → cloud stopped → venue rebooted (the index block
 *      runs on an adopted box) → runs scored offline → sync_outbox holds only
 *      manifest-table row changes (no DDL, no sqlite_master) → cloud back →
 *      drained → check-in succeeds with equal checksums; the venue's
 *      sqlite_master lists the twelve.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Checks } = require('../lib/checks');
const { Instance, scratchDir, SCRATCH_ROOT, REPO_ROOT, SERVER_DIR } = require('../lib/instance');
const { Api } = require('../lib/client');
const { openDb } = require('../lib/db');
const { buildMeet } = require('../lib/fixtures');
const { seedMogulJudges, seedDualJudges, playMogulRun, playRejection } = require('../lib/driver');
const AdmZip = require(path.join(SERVER_DIR, 'node_modules', 'adm-zip'));
const protocol = require(path.join(SERVER_DIR, 'sync', 'protocol.js'));

const BASELINE_TAG = 'v2.7.00';
const BASE_DIR = path.join(REPO_ROOT, 'harness', '.v270baseline');
const OUT_DIR = path.join(SCRATCH_ROOT, 'v2701');
const RMF_ZIP = '/Users/daviddreitlein/Desktop/Scoring Server/Archives/RMF_Mock_Comp_08-30-26.zip';

const INDEX_NAMES = [
  'idx_runs_event_status', 'idx_runs_event_run_number', 'idx_runs_event_round_status', 'idx_runs_registration',
  'idx_registrations_event_status', 'idx_registrations_athlete', 'idx_judges_event', 'idx_events_meet',
  'idx_dual_bracket_event', 'idx_event_phases_event', 'idx_heats_event', 'idx_audit_log_timestamp',
];
const INDEXED_TABLES = ['runs', 'registrations', 'judges', 'events', 'dual_bracket', 'event_phases', 'heats', 'audit_log'];

const WOMEN = ['Elena Marchetti', 'Sadie Whitcomb', 'Nora Kestrel', 'Piper Lindqvist', 'Maren Oduya', 'Cleo Bannister', 'Tess Harlan', 'Juniper Vale', 'Ingrid Solheim', 'Rosa Ferreira', 'Willa Strand', 'Katya Morozova', 'Aurora Blackwood', 'Freya Castellanos', 'Imogen Okafor', 'Lucia Petrova', 'Matilda Reyes', 'Noa Lindgren', 'Ophelia Tanaka', 'Priya Delacroix', 'Quinn Abernathy', 'Sienna Kowalczyk', 'Thea Villanueva', 'Zara Whitfield'];
const MEN = ['Mateo Reyes', 'Oskar Lindgren', 'Caleb Whitfield', 'Diego Delgado', 'Jonas Kowalski', 'Kwame Osei', 'Liam Brennan', 'Ren Takahashi', 'Anders Holm', 'Bryce Calloway', 'Emeka Nwosu', 'Felix Marchand', 'Gabriel Sousa', 'Hugo Bergstrom', 'Ivan Petrov', 'Jasper Quill'];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function ensureBaseline() {
  if (!fs.existsSync(path.join(BASE_DIR, 'server', 'index.js'))) {
    execFileSync('git', ['worktree', 'add', '--force', BASE_DIR, BASELINE_TAG], { cwd: REPO_ROOT });
  }
  const nm = path.join(BASE_DIR, 'server', 'node_modules');
  if (!fs.existsSync(nm)) fs.symlinkSync(path.join(SERVER_DIR, 'node_modules'), nm, 'dir');
  const v = fs.readFileSync(path.join(BASE_DIR, 'server', 'version.js'), 'utf8');
  if (!v.includes('2.7.00')) throw new Error('baseline worktree is not v2.7.00');
}

async function indexNames(db) {
  const rows = await db.queryAll(`SELECT name FROM sqlite_master WHERE type='index' AND name IN (${INDEX_NAMES.map(() => '?').join(',')})`, INDEX_NAMES);
  return rows.map(r => r.name).sort();
}

// ---------------------------------------------------------------------------
// Fixture builders (all through the HTTP API of whichever server is given)
// ---------------------------------------------------------------------------
async function makeEvent(api, { name, gender, discipline, names, extra = {} }) {
  const M = await buildMeet(api, { name, gender, discipline, athletes: 0, judges: [], startRun: false });
  if (Object.keys(extra).length) {
    // events are created by buildMeet with defaults; aerials needs its panel
    // config at creation → create a second event with the config and use it.
    M.event = await api.must('POST', `/api/meets/${M.meet.id}/events`, {
      discipline, division: 'comp_series', gender, name: `${name} ${gender} ${discipline} v2`, ...extra,
    });
  }
  const regs = [];
  for (let i = 0; i < names.length; i++) {
    const [first, last] = names[i].split(' ');
    const a = await api.must('POST', '/api/athletes', {
      first_name: first, last_name: last, gender, birth_year: 2006 + (i % 6),
      ussa_num: `${name.replace(/[^A-Za-z0-9]/g, '').toUpperCase()}${gender}${1000 + i}`,
      club: ['Aspen Valley', 'Steamboat', 'Winter Park'][i % 3],
    });
    regs.push(await api.must('POST', `/api/events/${M.event.id}/registrations`, { athlete_id: a.id, bib_number: 200 + i }));
  }
  await api.must('PUT', `/api/events/${M.event.id}/registrations/reorder`, regs.map((r, i) => ({ id: r.id, run_order: i + 1 })));
  return { ...M, regs };
}

async function scoreUpcoming(api, ev, judges, runNumber, varyFn) {
  for (let guard = 0; guard < 60; guard++) {
    const up = await api.must('GET', `/api/events/${ev}/runs/upcoming`);
    if (!up.athletes || !up.athletes.length) return;
    const a = up.athletes[0];
    await playMogulRun(api, ev, judges, a.id, runNumber, varyFn(guard));
  }
}

async function buildBestOf2(api, db) {
  const W = await makeEvent(api, { name: 'Golden BestOf2', gender: 'F', discipline: 'mogul', names: WOMEN });
  const ev = W.event.id;
  const judges = await seedMogulJudges(api, ev);
  for (let i = 0; i < W.regs.length; i++) {
    if (i === 7) await api.must('POST', `/api/events/${ev}/runs/status-only`, { registration_id: W.regs[i].id, run_number: 1, run_status: 'DNF' });
    else if (i === 3) await playRejection(api, db, ev, judges, W.regs[i].id, 1, 2);
    else await playMogulRun(api, ev, judges, W.regs[i].id, 1, ((i * 7) % 11) - 3);
  }
  await api.must('POST', `/api/events/${ev}/runs/round-status/1/finalize`, {});
  await api.must('POST', `/api/events/${ev}/phases`, { phase_type: 'best_of_2', run_order_method: '16_down' });
  await scoreUpcoming(api, ev, judges, 2, g => ((g * 5) % 9) - 2);
  const phases = await api.must('GET', `/api/events/${ev}/phases`);
  const p2 = phases.find(p => p.run_number === 2);
  await api.must('POST', `/api/events/${ev}/phases/${p2.id}/finalize`, {});
  return W;
}

async function buildQualFinals(api) {
  const M = await makeEvent(api, { name: 'Golden QualFinals', gender: 'M', discipline: 'mogul', names: MEN.slice(0, 12) });
  const ev = M.event.id;
  const judges = await seedMogulJudges(api, ev);
  for (let i = 0; i < M.regs.length; i++) {
    if (i === 5) await api.must('POST', `/api/events/${ev}/runs/status-only`, { registration_id: M.regs[i].id, run_number: 1, run_status: 'DNS' });
    else await playMogulRun(api, ev, judges, M.regs[i].id, 1, ((i * 3) % 7) - 2);
  }
  await api.must('POST', `/api/events/${ev}/runs/round-status/1/finalize`, {});
  await api.must('POST', `/api/events/${ev}/phases`, { phase_type: 'final_1', final_size: 6, run_order_method: 'last_to_first' });
  await scoreUpcoming(api, ev, judges, 2, g => ((g * 4) % 5) - 1);
  const phases = await api.must('GET', `/api/events/${ev}/phases`);
  const f1 = phases.find(p => p.phase_type === 'final_1');
  await api.must('POST', `/api/events/${ev}/phases/${f1.id}/finalize`, {});
  return M;
}

async function buildAerials(api) {
  const M = await makeEvent(api, {
    name: 'Golden Aerials', gender: 'M', discipline: 'aerials', names: ['Tobias Wren', 'Silas Marlow', 'Ezra Holloway', 'Nikolai Bardem', 'Rafael Quintero', 'Leo Sandoval', 'Miles Ashford', 'Owen Tremblay'],
    extra: { event_type: 'usa_regional', aerials_panel_size: 3, aerials_reduction_method: 'sum_all' },
  });
  const ev = M.event.id;
  await api.must('POST', `/api/events/${ev}/judges/seed-aerials`, {});
  for (let i = 0; i < M.regs.length; i++) {
    const judge_scores = [];
    for (let jn = 1; jn <= 3; jn++) for (let jp = 1; jp <= 2; jp++) {
      judge_scores.push({ judge_number: jn, jump: jp, air: Math.round((1.2 + ((i + jn) % 4) * 0.2) * 10) / 10, form: Math.round((3.0 + ((i + jp) % 5) * 0.3) * 10) / 10, landing: Math.round((1.5 + ((i * jn) % 3) * 0.4) * 10) / 10 });
    }
    await api.must('POST', `/api/events/${ev}/runs/manual`, {
      registration_id: M.regs[i].id, run_number: 1, aerials_v2: true, jump1_code: 'S', jump2_code: 'Tk', judge_scores,
    });
  }
  await api.must('POST', `/api/events/${ev}/runs/round-status/1/finalize`, {});
  return M;
}

const readyInOrder = (bracket) => bracket
  .filter(m => m.status === 'pending' && m.registration_id_blue && m.registration_id_red && !m.is_bye)
  .sort((a, b) => (a.pairing_number ?? 1e9) - (b.pairing_number ?? 1e9));

async function buildDual(api) {
  const M = await buildMeet(api, { name: 'Golden Dual', gender: 'M', discipline: 'dual_mogul', athletes: 16, judges: [], startRun: false });
  const ev = M.event.id;
  await seedDualJudges(api, ev);
  await api.must('PUT', `/api/events/${ev}/dual/runoff-option`, { runoff_option: 'runoff_to_8th' });
  await api.must('POST', `/api/events/${ev}/dual/seed-random`, {});
  await api.must('POST', `/api/events/${ev}/dual/seed-fis`, {});
  for (let guard = 0; guard < 80; guard++) {
    const bracket = await api.must('GET', `/api/events/${ev}/dual`);
    const next = readyInOrder(bracket)[0];
    if (!next) break;
    await api.must('PUT', `/api/events/${ev}/dual/active-match`, { match_id: next.id });
    const side = next.pairing_number % 3 === 0 ? 'red' : 'blue';
    const bp = side === 'blue' ? 3 : 2, rp = side === 'blue' ? 2 : 3;
    for (let n = 1; n <= 5; n++) await api.must('POST', `/api/events/${ev}/dual/${next.id}/judge-points`, { judge_number: n, blue_points: bp, red_points: rp });
    await api.must('POST', `/api/events/${ev}/dual/${next.id}/approve`, {});
  }
  return M;
}

async function importRmfZip(base) {
  if (!fs.existsSync(RMF_ZIP)) return null;
  const send = async (qs) => {
    const fd = new FormData();
    fd.append('file', new Blob([fs.readFileSync(RMF_ZIP)], { type: 'application/zip' }), path.basename(RMF_ZIP));
    const r = await fetch(`${base}/api/meets/import${qs}`, { method: 'POST', body: fd });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  let r = await send('');
  if (r.data && r.data.pending_import_id) r = await send(`?pending_import_id=${r.data.pending_import_id}&conflict_action=import`);
  if (r.status !== 200) throw new Error(`RMF import -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

// ---------------------------------------------------------------------------
// Corpus capture
// ---------------------------------------------------------------------------
async function fetchRaw(base, method, p, body) {
  const r = await fetch(base + p, {
    method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ct = r.headers.get('content-type') || '';
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, ct, buf };
}

function pdfText(buf) {
  const f = path.join(OUT_DIR, `tmp_${process.pid}_${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(f, buf);
  try {
    return execFileSync('pdftotext', ['-layout', f, '-'], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
  } finally { try { fs.unlinkSync(f); } catch (_) {} }
}

function xlsxText(buf) {
  const zip = new AdmZip(buf);
  return zip.getEntries()
    .filter(e => /^xl\/(worksheets\/sheet\d+\.xml|sharedStrings\.xml)$/.test(e.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName))
    .map(e => `## ${e.entryName}\n${e.getData().toString('utf8')}`).join('\n');
}

/** Turn a response into comparable text; strips request-time stamps + the version string. */
function canonBody({ status, ct, buf }) {
  let text;
  if (/pdf/.test(ct)) text = pdfText(buf);
  else if (/spreadsheetml|officedocument/.test(ct)) text = xlsxText(buf);
  else text = buf.toString('utf8');
  text = text
    .replace(/Generated [^\n·]*\d{1,2}:\d{2}(:\d{2})?( [AP]M)?/g, 'Generated «ts»')
    .replace(/Generated \d{1,2}\/\d{1,2}\/\d{4}/g, 'Generated «ts»')
    .replace(/Time: \d{1,2}:\d{2}(:\d{2})? ?[AP]M/g, 'Time: «ts»')
    .replace(/v?2\.7\.0[01]\b/g, 'vX')
    .replace(/"uptime":[^,}]*/g, '"uptime":0');
  return `${status} ${ct.split(';')[0]}\n${text}`;
}

/**
 * Audit lists: rows sharing one timestamp second come back in the opposite
 * order once the timestamp index satisfies ORDER BY timestamp DESC (walked in
 * reverse: newest rowid first) — the sorter returned them oldest-first. The
 * displayed order within one second was never defined; make the comparison
 * order deterministic so the assertion checks the SET + the cross-second order.
 */
function canonForKey(key, text) {
  const nl = text.indexOf('\n');
  const head = text.slice(0, nl), body = text.slice(nl + 1);
  const sortTies = (rows) => rows.filter(r => r.action !== 'export').slice()
    .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || '') || JSON.stringify(a).localeCompare(JSON.stringify(b)));
  try {
    if (/\/api\/audit\/filters/.test(key)) {
      const j = JSON.parse(body); j.actions = (j.actions || []).filter(a => a !== 'export');
      return head + '\n' + JSON.stringify(j);
    }
    if (/\/api\/audit\?/.test(key)) return head + '\n' + JSON.stringify(sortTies(JSON.parse(body)));
    if (/\/api\/admin\/dashboard/.test(key)) {
      const j = JSON.parse(body);
      // environment fields (port, the server's own data folder, disk, sockets) are not data
      for (const k of ['port', 'db', 'disk', 'ip_addresses', 'ws_connections', 'uptime_seconds', 'uptime']) delete j[k];
      for (const k of Object.keys(j)) if (Array.isArray(j[k]) && j[k].length && j[k][0] && 'timestamp' in j[k][0] && 'action' in j[k][0]) j[k] = sortTies(j[k]);
      return head + '\n' + JSON.stringify(j);
    }
    if (/\/api\/pdf\/td-report/.test(key)) {
      // officials / judges that tie completely on (event_date, created_at, role)
      // are listed per event instead of per insertion: sort the items of each line
      // (pdftotext wraps an item over two lines, so compare the sorted multiset of items)
      return head + '\n' + body.replace(/\s*\[[A-Z]+\]/g, '').split(/,\s*|\n/).map(t => t.trim()).filter(Boolean).sort().join('|');
    }
  } catch (_) { /* not JSON */ }
  return text;
}

async function captureCorpus(base) {
  const out = {};
  const get = async (p) => { out[`GET ${p}`] = canonBody(await fetchRaw(base, 'GET', p)); };
  const post = async (p, body) => { out[`POST ${p} ${JSON.stringify(body)}`] = canonBody(await fetchRaw(base, 'POST', p, body)); };

  for (const p of ['/api/version', '/api/meets', '/api/meets/livescores', '/api/athletes', '/api/viewer/events',
    '/api/audit?limit=1000', '/api/audit/filters', '/api/admin/dashboard', '/api/admin/events', '/api/admin/athletes',
    '/api/jump-dds', '/api/jump-dds?discipline=aerials', '/api/auth/status']) await get(p);

  const meets = await (await fetch(`${base}/api/meets`)).json();
  for (const meet of meets) {
    const mid = meet.id;
    for (const p of [`/api/meets/${mid}`, `/api/meets/${mid}/status`, `/api/meets/${mid}/adoption`, `/api/meets/${mid}/close-validation`,
      `/api/meets/${mid}/events`, `/api/meets/${mid}/officials`, `/api/meets/${mid}/course-specs`, `/api/meets/${mid}/training-days`,
      `/api/export/usss-transmit-check/${mid}`, `/api/pdf/logo/${mid}`, `/api/pdf/bottom-logo/${mid}`]) await get(p);
    await post('/api/pdf/td-report', { meetId: mid });
    const tds = await (await fetch(`${base}/api/meets/${mid}/training-days`)).json();
    for (const td of (Array.isArray(tds) ? tds : [])) {
      await get(`/api/training-days/${td.id}/participants`);
      await post(`/api/pdf/training-day/${td.id}`, { eventId: null, options: {} });
    }
    const events = await (await fetch(`${base}/api/meets/${mid}/events`)).json();
    for (const e of events) {
      const eid = e.id;
      const E = `/api/events/${eid}`;
      for (const p of [`/api/meets/${mid}/events/${eid}`, `${E}/judges`, `${E}/registrations`, `${E}/heats`, `${E}/runs`, `${E}/runs?status=complete`,
        `${E}/runs/info`, `${E}/runs/next-up`, `${E}/runs/upcoming`, `${E}/runs/upcoming?run_number=1`, `${E}/runs/upcoming?run_number=2`, `${E}/runs/active`,
        `${E}/runs/round-status`, `${E}/runs/round-review/1`, `${E}/runs/round-review/2`,
        `${E}/results`, `${E}/results?round=qualification`, `${E}/results/judge-scores`,
        `${E}/phases`, `${E}/phases/status`, `${E}/phases/results`,
        `${E}/dual`, `${E}/dual/round-state`, `${E}/dual/active-match`, `${E}/dual/review-state`,
        `/api/meets/${mid}/officials/event/${eid}`,
        `/api/viewer/events/${eid}/status`, `/api/viewer/events/${eid}/status?upcoming_limit=all`, `/api/viewer/events/${eid}/results`,
        `/api/viewer/events/${eid}/results?run_number=1`, `/api/viewer/events/${eid}/results?run_number=2`,
        `/api/viewer/events/${eid}/results/scores`, `/api/viewer/events/${eid}/results/scores?run_number=1`,
        `/api/viewer/events/${eid}/results/phases`, `/api/viewer/events/${eid}/placements`, `/api/viewer/events/${eid}/rounds`,
        `/api/viewer/resolve/${e.short_code}`,
        `/api/export/csv/${eid}`, `/api/export/ussas/${eid}`, `/api/export/results-csv/${eid}`, `/api/export/results-xlsx/${eid}`,
        `/api/export/results-html/${eid}`, `/api/print/results/${eid}`]) await get(p);
      const runs = await (await fetch(`${E}/runs`.replace(/^/, base))).json();
      for (const r of (Array.isArray(runs) ? runs : [])) await get(`${E}/runs/${r.id}/scores`);
      const phases = await (await fetch(`${base}${E}/phases`)).json();
      for (const ph of (Array.isArray(phases) ? phases : [])) {
        await get(`${E}/phases/${ph.id}/eligible`);
        await post('/api/pdf/phase-run-order', { eventId: eid, phaseId: ph.id });
      }
      const bracket = await (await fetch(`${base}${E}/dual`)).json();
      for (const m of (Array.isArray(bracket) ? bracket : [])) {
        await get(`${E}/dual/${m.id}/judge-points`);
        await get(`/api/viewer/events/${eid}/dual-matches/${m.id}/judge-points`);
      }
      for (const p of ['results', 'run-order', 'start-list', 'check-bib', 'check-order', 'registration', 'timer-sheet', 'run-results',
        'event-results-summary', 'event-results-detailed', 'event-results-component', 'event-results-group-summary',
        'event-results-group-detailed', 'dual-seed-list', 'dual-results', 'dual-bracket', 'bracket-keeper']) {
        await post(`/api/pdf/${p}`, { eventId: eid, options: {} });
      }
      await post('/api/pdf/group-awards', { eventId: eid, groups: [] });
    }
  }
  return out;
}

function diffCorpus(before, after) {
  const diffs = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const a = before[k], b = after[k];
    if (a === b) continue;
    if (a == null || b == null) { diffs.push({ key: k, note: 'present on one side only' }); continue; }
    // first differing line
    const al = a.split('\n'), bl = b.split('\n');
    let i = 0; while (i < al.length && i < bl.length && al[i] === bl[i]) i++;
    diffs.push({ key: k, line: i + 1, before: (al[i] || '').slice(0, 220), after: (bl[i] || '').slice(0, 220) });
  }
  return diffs;
}

// ---------------------------------------------------------------------------
// B. EXPLAIN QUERY PLAN
// ---------------------------------------------------------------------------
const TOP_QUERIES = [
  ['dual judge points by event (dual.js / viewer.js)', `SELECT djp.* FROM dual_judge_points djp JOIN dual_bracket db ON db.id = djp.match_id WHERE db.event_id = ? ORDER BY djp.judge_number`, 'dual_bracket'],
  ['phase for a run number (runs.js:333)', `SELECT ep.id, ep.label, pro.run_order as phase_run_order FROM event_phases ep JOIN phase_run_order pro ON pro.phase_id = ep.id AND pro.registration_id = ? WHERE ep.event_id = ? AND ep.run_number = ?`, 'event_phases'],
  ['meet events list with counts (meets.js:611)', `SELECT e.*, (SELECT COUNT(*) FROM registrations WHERE event_id = e.id AND status != 'scratched') as athlete_count FROM events e WHERE e.meet_id = ? ORDER BY e.discipline, e.division, e.gender`, 'events'],
  ['/next-up legacy (runs.js:195)', `SELECT reg.id, reg.bib_number, reg.run_order, a.first_name, a.last_name FROM registrations reg JOIN athletes a ON a.id = reg.athlete_id WHERE reg.event_id = ? AND reg.status = 'registered' AND reg.run_order IS NOT NULL AND reg.id NOT IN (SELECT r.registration_id FROM runs r WHERE r.event_id = ? AND r.run_number = ?) ORDER BY reg.run_order ASC LIMIT 1`, 'registrations'],
  ['/runs/active scoring run (runs.js:295)', `SELECT r.*, reg.bib_number, reg.run_order, a.first_name, a.last_name, a.club FROM runs r JOIN registrations reg ON reg.id = r.registration_id JOIN athletes a ON a.id = reg.athlete_id WHERE r.event_id = ? AND r.status = 'scoring' ORDER BY r.created_at DESC LIMIT 1`, 'runs'],
  ['/upcoming legacy (runs.js:261)', `SELECT reg.id, reg.bib_number, reg.run_order, a.first_name, a.last_name FROM registrations reg JOIN athletes a ON a.id = reg.athlete_id WHERE reg.event_id = ? AND reg.status = 'registered' AND reg.run_order IS NOT NULL AND reg.id NOT IN (SELECT r.registration_id FROM runs r WHERE r.event_id = ? AND r.run_number = ?) ORDER BY reg.run_order ASC`, 'registrations'],
  ['forerunner lookup (runs.js:278)', `SELECT r.* FROM runs r WHERE r.event_id = ? AND r.status = 'scoring' AND r.registration_id = '__forerunner__' ORDER BY r.created_at DESC LIMIT 1`, 'runs'],
  ['round results (results.js:172)', `SELECT r.*, reg.bib_number, reg.seed, a.first_name, a.last_name FROM runs r JOIN registrations reg ON reg.id = r.registration_id JOIN athletes a ON a.id = reg.athlete_id WHERE r.event_id = ? AND r.round = ? AND r.status = 'complete' ORDER BY r.total_score DESC`, 'runs'],
  ['/next-up phase (runs.js:178)', `SELECT reg.id, reg.bib_number, pro.run_order, a.first_name, a.last_name FROM phase_run_order pro JOIN registrations reg ON reg.id = pro.registration_id JOIN athletes a ON a.id = reg.athlete_id WHERE pro.phase_id = ? AND reg.status = 'registered' AND reg.id NOT IN (SELECT r.registration_id FROM runs r WHERE r.event_id = ? AND r.run_number = ?) ORDER BY pro.run_order ASC LIMIT 1`, 'runs'],
];

/** Every static SELECT literal in the server source that reads an indexed table. */
function extractServerSelects() {
  const dirs = ['routes', 'sync', 'import', 'dual', 'venue', 'db', 'middleware'].map(d => path.join(SERVER_DIR, d));
  const tblRe = new RegExp('\\b(FROM|JOIN)\\s+(' + INDEXED_TABLES.join('|') + ')\\b', 'i');
  const out = [];
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!/\.js$/.test(f) || / \d\.js$/.test(f)) continue;
      const src = fs.readFileSync(path.join(d, f), 'utf8');
      const re = /`([^`]*)`|'((?:[^'\\]|\\.)*)'/g; let m;
      while ((m = re.exec(src))) {
        const s = m[1] ?? m[2]; if (!s || !/^\s*SELECT\b/i.test(s) || !tblRe.test(s)) continue;
        const line = src.slice(0, m.index).split('\n').length;
        let sql = s.replace(/\s+/g, ' ').trim().replace(/\$\{[^}]*\}/g, '?');
        out.push({ site: `${path.basename(d)}/${f}:${line}`, sql });
      }
    }
  }
  return out;
}

/** Aliases a SQL text gives to `table` (FROM runs r / JOIN events AS e). */
function aliasesOf(sql, table) {
  const out = []; const re = new RegExp(`\\b(?:FROM|JOIN)\\s+${table}\\s+(?:AS\\s+)?(\\w+)`, 'gi'); let m;
  while ((m = re.exec(sql))) if (!/^(ON|WHERE|JOIN|LEFT|INNER|ORDER|GROUP|LIMIT|SET|USING)$/i.test(m[1])) out.push(m[1]);
  return out;
}

async function explain(db, sql) {
  const nq = (sql.match(/\?/g) || []).length;
  try {
    const rows = await db.queryAll(`EXPLAIN QUERY PLAN ${sql}`, Array.from({ length: nq }, () => 'x'));
    return rows.map(r => r.detail);
  } catch (e) { return [`(not explainable: ${e.message.split('\n')[0]})`]; }
}

// ---------------------------------------------------------------------------
async function main() {
  const c = new Checks('v2701');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  ensureBaseline();

  // =====================================================================
  // A. GOLDEN COMPARE
  // =====================================================================
  const dbPath = path.join(scratchDir('v2701-golden'), 'scoring.db');
  const before = new Instance({ name: 'v2701-v270', port: 3401, mode: 'cloud', dbPath, serverDir: path.join(BASE_DIR, 'server') });
  const after = new Instance({ name: 'v2701-cur', port: 3402, mode: 'cloud', dbPath });
  let corpusBefore, corpusAfter;
  try {
    await before.start();
    const ver = await (await fetch(`${before.base}/api/version`)).json();
    c.ok(String(ver.version).includes('2.7.00'), `A: baseline server is v2.7.00 (${ver.version})`);
    const api = new Api(before.base);
    const db0 = openDb(dbPath);
    c.deepEq(await indexNames(db0), [], 'A: the v2.7.00 database has none of the twelve indexes');

    const W = await buildBestOf2(api, db0);
    await buildQualFinals(api);
    await buildAerials(api);
    await buildDual(api);
    const rmf = await importRmfZip(before.base);
    console.log(`    · fixtures built on v2.7.00 (RMF mock zip ${rmf ? 'imported' : 'not present on this Mac — skipped'})`);
    await api.must('POST', `/api/meets/${W.meet.id}/officials`, { name: 'Chief Judge', role: 'Chief of Competition' }).catch(() => {});
    db0.close();

    // Second v2.7.00 boot BEFORE capturing, so both captures sit behind the same
    // number of boots (v2.7.00's own boot-time import-code backfill fills NULL
    // codes on the imported RMF events at its next boot — not an index effect).
    await before.stop();
    await before.start();
    corpusBefore = await captureCorpus(before.base);
    await before.stop();

    await after.start();
    const db1 = openDb(dbPath);
    c.deepEq(await indexNames(db1), INDEX_NAMES.slice().sort(), 'A: this tree created all twelve indexes on the same file');
    db1.close();
    c.ok(after.log.some(l => l.includes('12 of 12 query indexes present')), 'A: boot log reports 12 of 12');
    corpusAfter = await captureCorpus(after.base);
    await after.stop();

    fs.writeFileSync(path.join(OUT_DIR, 'corpus_before.json'), JSON.stringify(corpusBefore, null, 1));
    fs.writeFileSync(path.join(OUT_DIR, 'corpus_after.json'), JSON.stringify(corpusAfter, null, 1));
    const n = Object.keys(corpusBefore).length;
    c.ok(n > 400, `A: corpus holds ${n} captured responses`);
    const okStatuses = Object.values(corpusAfter).filter(v => /^2\d\d /.test(v)).length;
    c.ok(okStatuses > 300, `A: ${okStatuses} of them are 2xx (the rest are discipline-mismatch 400s captured on both sides)`);

    // Raw diff. The tolerated classes, each a recorded (c) case or a capture
    // artefact: (1) audit lists — rows sharing one timestamp second come back
    // newest-first (index walked in reverse) and the capture's own exports add
    // 'export' rows; (2) the TD report — officials / judges tying completely on
    // (event_date, created_at, role) list per event instead of per insertion;
    // (3) /api/version. Everything else must be byte-identical.
    const rawDiffs = diffCorpus(corpusBefore, corpusAfter);
    fs.writeFileSync(path.join(OUT_DIR, 'diffs_raw.json'), JSON.stringify(rawDiffs, null, 1));
    const TOLERATED = k => /\/api\/audit(\?|\/filters)|\/api\/admin\/dashboard|\/api\/pdf\/td-report|\/api\/version/.test(k);
    const hard = rawDiffs.filter(d => !TOLERATED(d.key));
    c.deepEq(hard.map(d => d.key), [], `A: every endpoint outside the recorded (c) classes is byte-identical (${rawDiffs.length} raw diff(s), ${hard.length} outside those classes)` + (hard.length ? '\n      ' + hard.slice(0, 8).map(d => `${d.key} @${d.line}\n        - ${d.before}\n        + ${d.after}`).join('\n      ') : ''));
    const tolerated = rawDiffs.filter(d => TOLERATED(d.key) && !/\/api\/version/.test(d.key));
    const stillDiff = tolerated.filter(d => {
      const a = canonForKey(d.key, corpusBefore[d.key]), b = canonForKey(d.key, corpusAfter[d.key]);
      if (/admin\/dashboard/.test(d.key)) {
        // LIMIT 20 newest. When the newest second holds more than 20 rows the
        // reverse index walk returns the NEWEST rows of that second where the
        // sorter returned the oldest (same (c) case). So: the timestamp
        // sequence must match for the after-list's length, and every after
        // row must exist in the full before audit list.
        const ja = JSON.parse(a.split('\n').slice(1).join('\n')), jb = JSON.parse(b.split('\n').slice(1).join('\n'));
        const full = JSON.parse(canonForKey('GET /api/audit?limit=1000', corpusBefore['GET /api/audit?limit=1000']).split('\n').slice(1).join('\n'));
        const sig = r => JSON.stringify([r.action, r.entity, r.entity_id, r.timestamp, r.new_value]);
        const known = new Set(full.map(sig));
        for (const k of Object.keys(ja)) {
          if (!Array.isArray(ja[k]) || !Array.isArray(jb[k])) { if (JSON.stringify(ja[k]) !== JSON.stringify(jb[k])) return true; continue; }
          if (jb[k].some(r => !known.has(sig(r)))) return true;
          if (ja[k].slice(0, jb[k].length).some((r, i) => r.timestamp !== jb[k][i].timestamp)) return true;
        }
        return false;
      }
      return a !== b;
    });
    c.deepEq(stillDiff.map(d => d.key), [], `A: the tolerated endpoints differ only in the recorded way (${tolerated.length} affected: ${tolerated.map(d => d.key.replace(/ \{.*$/, '')).join(', ')})`);
    {
      const k = 'GET /api/audit?limit=1000';
      const a = JSON.parse(corpusBefore[k].split('\n').slice(1).join('\n')).filter(r => r.action !== 'export');
      const b = JSON.parse(corpusAfter[k].split('\n').slice(1).join('\n')).filter(r => r.action !== 'export');
      c.eq(b.length, a.length, `A: audit list holds the same ${a.length} rows once the capture's own export rows are dropped`);
      c.ok(a.every((r, i) => b[i].timestamp === r.timestamp), 'A: the audit timestamp sequence is unchanged (only rows within one second re-ordered)');
      c.ok(JSON.stringify(a) !== JSON.stringify(b), 'A: (observed) same-second audit rows do come back in a different order — the recorded (c) case is real');
    }
  } finally {
    await before.stop().catch(() => {});
    await after.stop().catch(() => {});
  }

  // =====================================================================
  // B. EXPLAIN QUERY PLAN before / after on copies of the golden database
  // =====================================================================
  {
    const dir = scratchDir('v2701-plans');
    const noIdx = path.join(dir, 'before.db'), withIdx = path.join(dir, 'after.db');
    fs.copyFileSync(dbPath, noIdx); fs.copyFileSync(dbPath, withIdx);
    const dbB = openDb(noIdx), dbA = openDb(withIdx);
    for (const n of INDEX_NAMES) await dbB.execute(`DROP INDEX IF EXISTS ${n}`);
    c.deepEq(await indexNames(dbB), [], 'B: "before" copy has the twelve indexes dropped');
    c.eq((await indexNames(dbA)).length, 12, 'B: "after" copy keeps the twelve');
    const sizes = {};
    for (const t of ['runs', 'registrations', 'dual_bracket', 'dual_judge_points', 'events', 'event_phases', 'judges', 'audit_log']) {
      sizes[t] = (await dbA.queryOne(`SELECT COUNT(*) n FROM ${t}`)).n;
    }
    const lines = [`# v2.7.01 EXPLAIN QUERY PLAN before / after (golden harness DB; row counts ${JSON.stringify(sizes)})`, ''];
    for (const [label, sql, table] of TOP_QUERIES) {
      const pb = await explain(dbB, sql), pa = await explain(dbA, sql);
      lines.push(`## ${label}`, sql, '  before: ' + pb.join(' | '), '  after:  ' + pa.join(' | '), '');
      const names = [table, ...aliasesOf(sql, table)];
      // before: a full scan somewhere in the plan — of the indexed table itself, or of
      // the joined table SQLite chose as the outer loop because nothing else was indexed
      // (dual_judge_points / phase_run_order: the rows-read figures Turso showed)
      const scanBefore = pb.some(l => /^SCAN /.test(l));
      const searchAfter = pa.some(l => names.some(n => new RegExp(`^SEARCH ${n} USING (COVERING )?INDEX idx_`).test(l)));
      const scanAfter = pa.some(l => names.some(n => new RegExp(`^SCAN ${n}\\b`).test(l)));
      c.ok(scanBefore, `B: before — "${label}" runs a full scan (${pb.join(' | ')})`);
      c.ok(searchAfter && !scanAfter, `B: after — "${label}" searches ${table} USING INDEX (${pa.join(' | ')})`);
    }
    // every static SELECT in the server: record plans; count remaining scans
    const selects = extractServerSelects();
    lines.push('', `# All static SELECTs reading an indexed table (${selects.length})`, '');
    let stillScan = [];
    for (const q of selects) {
      const pb = await explain(dbB, q.sql), pa = await explain(dbA, q.sql);
      lines.push(`## ${q.site}`, q.sql, '  before: ' + pb.join(' | '), '  after:  ' + pa.join(' | '), '');
      const hasEq = /\b(event_id|meet_id|registration_id|athlete_id)\s*=\s*\?/i.test(q.sql) || /\b(event_id|meet_id)\s*IN\s*\(/i.test(q.sql);
      const scans = pa.filter(l => INDEXED_TABLES.some(t => [t, ...aliasesOf(q.sql, t)].some(n => new RegExp(`^SCAN ${n}\\b`).test(l))));
      if (hasEq && scans.length) stillScan.push(`${q.site}: ${scans.join(' | ')}`);
    }
    lines.push('', '# Static SELECTs with an event_id/meet_id equality that still SCAN an indexed table after:', ...stillScan);
    fs.writeFileSync(path.join(OUT_DIR, 'plans.txt'), lines.join('\n'));
    c.ok(selects.length > 150, `B: ${selects.length} static SELECTs explained (plans in ${path.relative(REPO_ROOT, path.join(OUT_DIR, 'plans.txt'))})`);
    c.deepEq(stillScan, [], 'B: no static SELECT with an event/meet equality still scans an indexed table');
    dbB.close(); dbA.close();
  }

  // =====================================================================
  // C. VENUE MODE
  // =====================================================================
  const cloud = new Instance({ name: 'v2701-cloud', port: 3403, mode: 'cloud' });
  const venue = new Instance({ name: 'v2701-venue', port: 3404, mode: 'venue' });
  try {
    await cloud.start(); await venue.start();
    const cApi = new Api(cloud.base), vApi = new Api(venue.base);
    const M = await buildMeet(cApi, { name: 'Index Venue', judges: ['TL1', 'TL2', 'TL3', 'Air1', 'Air2', 'HJ'], athletes: 4, startRun: false });
    const judges = Object.fromEntries(M.judges.map(j => [j.role, j]));
    const rel = await cApi.must('POST', `/api/meets/${M.meet.id}/release-for-adoption`);
    await vApi.must('POST', '/api/venue/adopt', { code: rel.code, cloud_url: cloud.base });
    await vApi.must('POST', '/api/venue/pins', { control_pin: '2468', crew_pin: '1357' });
    const token = (await vApi.must('POST', '/api/venue/verify-pin', { kind: 'control', pin: '2468' })).token;
    const vAuthed = new Api(venue.base, { token });

    // cloud goes away; the adopted venue box reboots (index block runs on an adopted DB)
    await cloud.stop();
    await venue.stop();
    venue.log.length = 0;
    await venue.start();
    c.ok(venue.log.some(l => l.includes('12 of 12 query indexes present')), 'C: venue reboot log reports 12 of 12 (adopted meet, cloud down)');
    const vdb = openDb(venue.dbPath);
    c.eq((await indexNames(vdb)).length, 12, 'C: the venue sqlite_master lists the twelve');
    const outboxAfterBoot = await vdb.queryAll(`SELECT tbl, op FROM sync_outbox ORDER BY seq`);
    // the outbox records exactly two ops: 'upsert' (row image) and 'delete' (pk)
    c.ok(!outboxAfterBoot.some(r => !Object.prototype.hasOwnProperty.call(protocol.TABLES, r.tbl) || !/^(upsert|delete)$/.test(r.op)),
      `C: nothing DDL-shaped in the outbox after the reboot (${outboxAfterBoot.length} row(s): ${JSON.stringify(outboxAfterBoot.slice(0, 5))})`);

    // score offline
    await playMogulRun(vApi, M.event.id, judges, M.regs[0].id, 1, 0);
    await playMogulRun(vApi, M.event.id, judges, M.regs[1].id, 1, 1);
    const outbox = await vdb.queryAll(`SELECT tbl, op, row_json FROM sync_outbox ORDER BY seq`);
    c.ok(outbox.length > 0, `C: offline scoring queued ${outbox.length} outbox rows`);
    const manifestTables = new Set(Object.keys(protocol.TABLES));
    const bad = outbox.filter(r => !manifestTables.has(r.tbl) || !/^(upsert|delete)$/.test(r.op) || /sqlite_master|CREATE INDEX/i.test(r.row_json || ''));
    c.ok(outbox.every(r => /^(upsert|delete)$/.test(r.op)), `C: outbox ops are the capture vocabulary only (${[...new Set(outbox.map(r => r.op))].join(', ')})`);
    c.deepEq(bad.map(r => `${r.tbl}/${r.op}`), [], `C: every outbox row is a manifest-table row change (tables: ${[...new Set(outbox.map(r => r.tbl))].join(', ')})`);

    // cloud back → drained → check in → checksums equal
    await cloud.start();
    const cdb = openDb(cloud.dbPath);
    let drained = false;
    for (let i = 0; i < 120 && !drained; i++) {
      await sleep(250);
      drained = (await vdb.queryOne(`SELECT COUNT(*) n FROM sync_outbox`)).n === 0;
    }
    c.ok(drained, 'C: outbox drained once the cloud is reachable again');
    const r = await vAuthed.post('/api/venue/checkin', { mode: 'checkin' });
    c.eq(r.status, 200, `C: check-in succeeds (${JSON.stringify(r.data).slice(0, 160)})`);
    const sums = async (db) => { const o = {}; for (const t of protocol.CHECKSUM_TABLES) { const rows = await db.queryAll(protocol.selectForMeet(t), [M.meet.id]); o[t] = protocol.tableChecksum(t, rows.map(x => protocol.manifestRow(t, x))); } return o; };
    c.deepEq(await sums(cdb), await sums(vdb), 'C: cloud and venue per-table checksums equal after check-in');
    const cloudRuns = await cdb.queryAll(`SELECT id, total_score FROM runs WHERE event_id=? AND status='complete' ORDER BY id`, [M.event.id]);
    c.eq(cloudRuns.length, 2, 'C: both offline-scored runs reached the cloud');
    vdb.close(); cdb.close();
  } finally {
    await cloud.stop().catch(() => {});
    await venue.stop().catch(() => {});
  }

  return c;
}

module.exports = { main };
