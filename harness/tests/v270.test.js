/**
 * v2.7.00 acceptance — unified registration import
 * (StickIt_Registration_Import_Implementation_Prompt_09-19-26.md, section 8).
 *
 *   A. Pure functions: header detection, every synonym incl. accented French,
 *      "Last, First" split, gender first-character rule, the three birth-date
 *      forms (never parseInt), USSS "ID" text flagged, windows-1252 decoded,
 *      XLSX ≡ CSV, duplicate / empty headers do not throw.
 *   B. Tokeniser (M, M2, D).
 *   C. Resolution rules on a Copper-shaped meet; banquet / coaches; ambiguous;
 *      date_mismatch; series word; no-entry-information files; saved mapping.
 *   D. Identity: USSS People File by name, twins by gender / club word,
 *      ambiguous_usss, local athlete gains its number, locked athlete not
 *      updated but registered, unknown flagged + not written unless ticked,
 *      same USSS # on two names, SkiReg 3 rows → 1 athlete / 3 registrations.
 *   E. Endpoint: preview writes nothing, commit writes + audit + map, 400 / 409
 *      / 423, event_id filter, idempotent second commit, import-csv gone.
 *   F. Import codes: auto-assign, PUT 409, backfill, clone, export/import,
 *      venue NULL after adoption + cloud value survives check-in, protocol 3.
 *   G. Athlete-only endpoints (CSV / XLSX / paste; reconcile shape).
 *   H. Real sample files — env-gated: STICKIT_REG_SAMPLES=<folder>.
 *   I. Playwright: meet page → dialog → preview → confirm → Registration tab;
 *      the Events step on an ambiguous file; the per-event button.
 */

const path = require('path');
const fs = require('fs');
const { Checks } = require('../lib/checks');
const { Instance, SERVER_DIR } = require('../lib/instance');
const { Api } = require('../lib/client');
const { openDb } = require('../lib/db');
const { newTablet } = require('../lib/browser');

const R = require(path.join(SERVER_DIR, 'import', 'registrationImport.js'));
const FIX = path.join(__dirname, '..', 'fixtures', 'registration');
const { PEOPLE, TWINS, UNKNOWN } = require(path.join(FIX, 'build_fixtures.js'));
const SHOTS = path.join(__dirname, '..', '.scratch', 'v270-shots');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fx = (name) => fs.readFileSync(path.join(FIX, name));

async function waitFor(fn, { timeout = 20000, every = 250 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return null;
    await sleep(every);
  }
}

/** POST a registration file to the meet-level importer. */
async function importFile(base, meetId, buffer, filename, fields = {}, mode = 'preview', token = null) {
  const fd = new FormData();
  fd.append('file', new Blob([buffer]), filename);
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    fd.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  const r = await fetch(`${base}/api/meets/${meetId}/registrations/import?mode=${mode}`, {
    method: 'POST', body: fd, headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  let data = null;
  try { data = await r.json(); } catch (_) {}
  return { status: r.status, ok: r.ok, data };
}

/** Build the fixture People File text (USSS format) and upload it. */
async function seedPeople(base) {
  const lines = ['TYPE,LAST,FIRST,D,USSAID,G,YOB,CLUBNAME,AE,DM,MO,HP,BA,SX,SS,FISID - File Created 4/27/2026'];
  for (const p of [...PEOPLE, ...TWINS]) lines.push(`C,${p[0]},${p[1]},R,${p[4]},${p[2]},${p[3]},${p[5]},,,,,,,,${p[4] === '9900001' ? '2540001' : ''}`);
  const fd = new FormData();
  fd.append('file', new Blob([lines.join('\n') + '\n']), 'People 2026 List 1.txt'); // older than the live list so a later real sync still runs
  const r = await fetch(`${base}/api/usss/upload`, { method: 'POST', body: fd });
  if (!r.ok) throw new Error(`usss upload -> ${r.status}`);
  return r.json();
}

/** Create a meet with named events (each [name, gender, discipline, event_date?, import_code?]). */
async function buildEventsMeet(api, name, defs) {
  const meet = await api.must('POST', '/api/meets', { name, location: 'Harness Mountain', date: '2026-02-21', meet_ranking: 'C' });
  const events = [];
  for (const [ename, gender, discipline, date, code] of defs) {
    const body = { name: ename, gender, discipline, division: discipline === 'dual_mogul' ? 'comp_series' : 'comp_series' };
    if (code) body.import_code = code;
    let e = await api.must('POST', `/api/meets/${meet.id}/events`, body);
    if (date) e = await api.must('PUT', `/api/meets/${meet.id}/events/${e.id}`, { event_date: date });
    events.push(e);
  }
  return { meet, events, byName: Object.fromEntries(events.map(e => [e.name, e])) };
}

const COPPER = [
  ["Men's Moguls Sat", 'M', 'mogul', '2026-02-21'],
  ["Women's Moguls Sat", 'F', 'mogul', '2026-02-21'],
  ["Men's Moguls Sun", 'M', 'mogul', '2026-02-22'],
  ["Women's Moguls Sun", 'F', 'mogul', '2026-02-22'],
  ["Men's Duals", 'M', 'dual_mogul', '2026-02-22'],
  ["Women's Duals", 'F', 'dual_mogul', '2026-02-22'],
];

async function tableCounts(db) {
  const out = {};
  for (const t of ['athletes', 'registrations', 'audit_log', 'meet_import_map']) {
    out[t] = parseInt((await db.queryOne(`SELECT COUNT(*) AS n FROM ${t}`)).n);
  }
  return out;
}

async function main() {
  const c = new Checks('v270');
  const cloud = new Instance({ name: 'v270-cloud', port: 3271, mode: 'cloud', env: { STICKIT_DISABLE_USSS_SYNC: '1', STICKIT_DEBUG_ROUTES: '1' } });
  const venue = new Instance({ name: 'v270-venue', port: 3272, mode: 'venue', env: { STICKIT_DISABLE_USSS_SYNC: '1' } });
  fs.mkdirSync(SHOTS, { recursive: true });
  let tab = null;

  try {
    await cloud.start();
    const api = new Api(cloud.base);
    const db = openDb(cloud.dbPath);
    let r;

    // =====================================================================
    // A. Pure functions
    // =====================================================================
    {
      const p = await R.parseFile(fx('edge_headers.csv'), 'edge_headers.csv');
      c.eq(p.header_row_index, 2, 'A: header found below two junk rows');
      const m = R.mapColumns(p.headers, {});
      c.deepEq(m.map, { 'Nom de Famille': 'last_name', 'Prénom': 'first_name', 'Sexe': 'gender', 'Année de Naissance': 'birth_year', 'ID#': 'ussa_num' }, 'A: accented French headers + ID# map');
      const rows = p.rows.map(rec => R.readRecord(rec, m));
      c.deepEq([rows[0].last_name, rows[0].first_name], ['Anders', 'Cole'], 'A: "Last, First" split when first name blank');
      c.deepEq(rows.map(x => x.gender), ['M', 'F', 'F', 'F'], 'A: gender first-character rule (Male / Femelle / F17 / F)');
      c.deepEq(rows.map(x => x.birth_year), [2010, 2009, 2011, null], 'A: 2010-03-07, 3/7/2009, 2011-03-04T00:00 → years; text → null');
      c.ok(rows[3].warnings.includes('bad_birth_year'), 'A: text in the birth column warns bad_birth_year');
      c.eq(R.parseBirthYear('3/7/1990').value, 1990, 'A: 3/7/1990 is 1990, not 3');
      c.eq(R.parseBirthYear('1990').value, 1990, 'A: bare year');
      c.deepEq(R.parseUssaNum('ID'), { value: '', warning: 'bad_ussa_num' }, 'A: literal "ID" in the ID column flagged');
      c.eq(R.parseUssaNum(' 7002294 ').value, '7002294', 'A: USSS # trimmed');

      // every synonym in the table maps, including the sample-folder spellings
      const probe = ['Bib#', 'USSS Member #', 'Year of Birth', 'Representing', 'From', 'Née', 'USSA#', 'Date of Birth', 'Gp', 'Grp', 'Team', 'Category Entered', 'Category Entered / Merchandise Ordered', 'Events', 'Epreuves', 'FIS#', 'Nation'];
      const pm = R.mapColumns(probe, {}).map;
      c.deepEq(Object.values(pm), ['bib', 'ussa_num', 'birth_year', 'club', 'club', 'birth_year', 'ussa_num', 'birth_year', 'gender', 'gender', 'club', 'category', 'category', 'events', 'events', 'fis_id', 'nation'], 'A: sample-folder header spellings all map');
      let allOk = true;
      for (const [field, forms] of Object.entries(R.SYNONYMS)) for (const f of forms) if (R.mapColumns([f], {}).map[f] !== field) allOk = false;
      c.ok(allOk, 'A: every normalised synonym form maps to its field');
      c.eq(Object.keys(R.mapColumns(['Division', 'Email', 'Points', 'J.1'], {}).map).length, 0, 'A: ignore-list headers are not mapped');
      c.eq(R.mapColumns(['Division', 'Email'], {}).unmapped.length, 0, 'A: ignore-list headers are not reported as unmapped');
      c.eq(R.mapColumns(['Mystery'], {}).unmapped[0].header, 'Mystery', 'A: unknown header reported as unmapped');

      const w = await R.parseFile(fx('win1252.csv'), 'win1252.csv');
      c.eq(w.rows[0]['Last Name'], 'Pérez', 'A: windows-1252 name decoded');
      const csvP = await R.parseFile(fx('skireg_copper.csv'), 'skireg_copper.csv');
      const xlsP = await R.parseFile(fx('skireg_copper.xlsx'), 'skireg_copper.xlsx');
      c.deepEq(xlsP.headers, csvP.headers, 'A: XLSX headers identical to CSV');
      c.deepEq(xlsP.rows, csvP.rows, 'A: XLSX rows identical to CSV');
      let threw = false;
      try { const d = await R.parseFile(fx('dup_headers.csv'), 'dup_headers.csv'); c.eq(d.rows[0]['Bib (2)'], '6', 'A: duplicate header kept apart'); } catch (e) { threw = true; }
      c.ok(!threw, 'A: duplicate + empty headers do not throw');
      const t = await R.parseFile(fx('rmf_trailing_headers.csv'), 'x.csv');
      c.eq(t.headers.length, 6, 'A: trailing empty headers dropped');
      const bom = await R.parseFile(fx('reg_7710_bom.csv'), 'x.csv');
      c.eq(R.mapColumns(bom.headers, {}).map['First'], 'first_name', 'A: BOM stripped before the header is read');
      const nh = await R.parseFile(Buffer.from('a,b,c\n1,2,3\n'), 'x.csv').catch(e => e);
      c.eq(nh.code, 'no_header', 'A: no Last Name column → no_header');
    }

    // =====================================================================
    // B. Tokeniser
    // =====================================================================
    {
      const codes = ['M', 'M2', 'D'];
      const T = (s) => R.tokenizeEvents(s, codes);
      c.deepEq(T('MD').codes, ['M', 'D'], 'B: MD');
      c.deepEq(T('MM2').codes, ['M', 'M2'], 'B: MM2 (longest first)');
      c.deepEq(T('MDM2').codes, ['M', 'D', 'M2'], 'B: MDM2');
      c.deepEq(T('DM').codes, ['D', 'M'], 'B: DM');
      c.deepEq(T('M2').codes, ['M2'], 'B: M2');
      c.deepEq(T('mdm2').codes, ['M', 'D', 'M2'], 'B: lower-case');
      c.deepEq(T('M, D').codes, ['M', 'D'], 'B: comma + space ignored');
      const mq = T('MQ');
      c.deepEq([mq.codes, mq.remainder], [['M'], 'Q'], 'B: MQ → M plus remainder Q');
    }

    // =====================================================================
    // C. Resolution (pure)
    // =====================================================================
    const evs = (defs) => defs.map((d, i) => ({ id: `e${i}`, name: d[0], gender: d[1], discipline: d[2], event_date: d[3] || null, import_code: d[4] || null }));
    {
      const E = evs(COPPER);
      const cat = (s) => ({ source: 'category', marker_display: s, marker_norm: R.normalizeMarker(s) });
      const res = (s, g) => R.resolveMarker(cat(s), g, E, {});
      const nameOf = (rr) => rr.resolution && rr.resolution.event_id ? E.find(e => e.id === rr.resolution.event_id).name : (rr.resolution ? 'NOT_EVENT' : `UNRESOLVED:${rr.reason}`);
      c.eq(nameOf(res("Saturday Men's Moguls (Feb 21)", 'M')), "Men's Moguls Sat", 'C: Sat men');
      c.eq(nameOf(res("Saturday Women's Moguls (Feb 21)", 'F')), "Women's Moguls Sat", 'C: Sat women');
      c.eq(nameOf(res("Sunday Men's Moguls (Feb 22) *** FULL ***", 'M')), "Men's Moguls Sun", 'C: Sun men with *** FULL *** noise');
      c.eq(nameOf(res("Sunday Women's Moguls (Feb 22) *** FULL **I", 'F')), "Women's Moguls Sun", 'C: Sun women with **I noise');
      c.eq(nameOf(res('Sunday Mens Dual Moguls (Feb 22)', 'M')), "Men's Duals", 'C: men duals');
      c.eq(nameOf(res("Sunday Women's Dual Moguls (Feb 22)", 'F')), "Women's Duals", 'C: women duals');
      c.eq(nameOf(res('Banquet Tickets', 'F')), 'NOT_EVENT', 'C: Banquet Tickets → not an event');
      c.eq(nameOf(res('Coaches / Officials / Judges', 'M')), 'NOT_EVENT', 'C: Coaches / Officials / Judges → not an event');
      c.eq(nameOf(res('Non Rocky Athlete Registration Fee', 'M')), 'NOT_EVENT', 'C: registration fee → not an event');
      c.eq(nameOf(res('Men Moguls', 'M')), 'UNRESOLVED:ambiguous', 'C: no date on a two-moguls meet → ambiguous');
      c.eq(nameOf(res("Men's Moguls (Feb 23rd)", 'M')), 'UNRESOLVED:date_mismatch', 'C: Feb 23 matches no event → date_mismatch, never falls through');
      c.eq(nameOf(res("Men's Moguls (3/1)", 'M')), 'UNRESOLVED:date_mismatch', 'C: numeric date cue recognised');
      c.eq(nameOf(res('Saturday Moguls', 'F')), "Women's Moguls Sat", 'C: weekday cue');
      c.eq(nameOf(res("Men's Moguls (Feb 21)", '')), "Men's Moguls Sat", 'C: gender word supplies the gender when the row has none');
      c.eq(nameOf(res('Moguls (Feb 21)', '')), 'UNRESOLVED:no_gender', 'C: no gender anywhere → no_gender');
      c.eq(nameOf(res('Sunday Ski Thing', 'M')), 'UNRESOLVED:no_discipline', 'C: no discipline word → no_discipline');
      c.eq(res("Women's Moguls (Feb 21)", 'M').marker_gender, 'F', 'C: marker gender word reported for the conflict flag');
      // code / column markers
      const E2 = evs(COPPER.map((d, i) => [...d, ['M', 'M', 'M2', 'M2', 'D', 'D'][i]]));
      const codeRes = (code, g) => R.resolveMarker({ source: 'events', code, marker_display: `Events: ${code}`, marker_norm: `events:${code.toLowerCase()}` }, g, E2, {});
      c.eq(E2.find(e => e.id === codeRes('M2', 'F').resolution.event_id).name, "Women's Moguls Sun", 'C: Events code M2 + F → Women\'s Moguls Sun');
      c.eq(codeRes('A', 'M').reason, 'no_event', 'C: code with no event → no_event');
      // series word
      const E3 = evs([["Devo Men's Moguls", 'M', 'mogul'], ["RQS Men's Moguls", 'M', 'mogul'], ["Devo Women's Moguls", 'F', 'mogul']]);
      const s = R.resolveMarker(cat('Mens Devo Singles (Feb 1)'), 'M', E3, {});
      c.eq(s.resolution && E3.find(e => e.id === s.resolution.event_id).name, "Devo Men's Moguls", 'C: series word Devo picks the Devo event (no dates on the meet)');
      const s2 = R.resolveMarker(cat('Mens RQS/Devo Dual Moguls (March 15)'), 'M', evs([["Men's Dual Moguls", 'M', 'dual_mogul']]), {});
      c.ok(s2.resolution && s2.resolution.event_id === 'e0', 'C: single candidate resolves before the series/date rules');
      // synthetic marker
      const none = { source: 'none', marker_display: R.NO_INFO_MARKER, marker_norm: R.NO_INFO_MARKER };
      const E4 = evs([["Devo Men's Moguls", 'M', 'mogul'], ["Devo Women's Moguls", 'F', 'mogul']]);
      c.eq(R.resolveMarker(none, 'F', E4, {}).resolution.event_id, 'e1', 'C: no-entry-information file on a one-event-per-gender meet resolves');
      c.eq(R.resolveMarker(none, 'M', E, {}).reason, 'ambiguous', 'C: no-entry-information file on a two-moguls meet prompts');
      c.eq(R.resolveMarker(none, 'M', E, { target_event_id: 'e2' }).resolution.event_id, 'e2', 'C: per-event button: no-info rows go straight into that event (David, 09-19-26)');
      c.eq(R.resolveMarker(none, 'F', E, { target_event_id: 'e2' }).reason, 'other_gender', 'C: per-event button: other-gender rows are not this event');
      // saved mapping overrides everything
      const saved = new Map([['banquet tickets|F', { event_id: 'e1' }], ['men moguls|', { event_id: 'e2' }]]);
      c.eq(R.resolveMarker(cat('Banquet Tickets'), 'F', E, { saved }).resolution.event_id, 'e1', 'C: saved mapping overrides the not-an-event rule');
      c.eq(R.resolveMarker(cat('Men Moguls'), 'M', E, { saved }).resolution.event_id, 'e2', 'C: saved gender-less mapping applies to a gendered row');
    }

    // =====================================================================
    // D + E. Identity + endpoint on a Copper-shaped meet with the fixture People File
    // =====================================================================
    await seedPeople(cloud.base);
    const CM = await buildEventsMeet(api, 'Copper Harness 2026', COPPER);
    const evName = (id) => (CM.events.find(e => e.id === id) || {}).name;
    c.deepEq(CM.events.map(e => e.import_code), ['M', 'M', 'M2', 'M2', 'D', 'D'], 'F: import codes auto-assigned M / M2 / D per gender in creation order');

    // a local athlete without a USSS # who is in the file (gains the number on commit)
    const local = await api.must('POST', '/api/athletes', { first_name: 'Chase', last_name: 'Atherly', gender: 'M' });
    c.ok(!local.ussa_num, 'D: local athlete created without a USSS #');

    const before = await tableCounts(db);
    r = await importFile(cloud.base, CM.meet.id, fx('skireg_copper.csv'), 'skireg_copper.csv');
    c.eq(r.status, 200, 'E: preview 200');
    const P = r.data;
    c.deepEq(await tableCounts(db), before, 'E: preview writes nothing');
    c.eq(P.needs_mapping, false, 'C/E: Copper SkiReg file resolves without a prompt');
    c.eq(P.columns.unmapped.length, 0, 'E: SkiReg headers all known (ignore list covers City/Notes/State…)');
    c.eq(P.markers.filter(m => m.resolution === null).length, 0, 'C: every marker resolved');
    c.eq(P.markers.filter(m => m.reason === 'not_an_event').length, 2, 'C: banquet + coaches markers not events');
    c.eq(P.athletes.not_an_event, 2, 'E: two people only in non-event rows');
    c.eq(P.usss_people_loaded, true, 'D: People File loaded');
    const anders = P.athletes.to_register.find(x => x.last_name === 'Anders');
    c.ok(anders && anders.ussa_num === '9900001' && anders.birth_year === 2010, 'D: name-only SkiReg row gains USSS # + birth year from the People File');
    c.eq(anders && anders.fis_id, '2540001', 'D: FIS id supplied by the People File');
    c.eq(anders && anders.source, 'usss_people', 'D: source badge = People File');
    c.deepEq(anders && anders.events.map(evName).sort(), ["Men's Duals", "Men's Moguls Sat", "Men's Moguls Sun"], 'D: three SkiReg rows → one person with three events');
    c.eq(anders && anders.bib, 100, 'D: the mogul row\'s bib carried onto the person');
    const twinM = P.athletes.to_register.find(x => x.last_name === 'SameName');
    c.eq(twinM && twinM.ussa_num, '9900201', 'D: same-name pair resolved by gender');
    const twinClub = P.athletes.to_register.find(x => x.last_name === 'Sameclub');
    c.eq(twinClub && twinClub.ussa_num, '9900203', 'D: same-name same-gender pair resolved by a shared club word');
    const unknown = P.athletes.needs_attention.find(x => x.last_name === 'Nowhere');
    c.ok(unknown && unknown.flags.includes('no_usss_match'), 'D: athlete not in the People File flagged no_usss_match');
    const ath = P.athletes.to_register.find(x => x.last_name === 'Atherly');
    c.eq(ath && ath.athlete_id, local.id, 'D: existing local athlete matched by name (People File number re-run against athletes)');
    c.eq(ath && ath.ussa_num, '9900002', 'D: … and carries the recovered number');
    const menSat = P.events.find(e => e.name === "Men's Moguls Sat");
    c.deepEq([menSat.to_register, menSat.flagged], [10, 1], 'E: per-event counts (8 men + 2 twins to register, unknown flagged)');
    c.eq(P.events.find(e => e.name === "Women's Duals").to_register, 3, 'E: women duals count');

    // commit without the flagged row
    r = await importFile(cloud.base, CM.meet.id, fx('skireg_copper.csv'), 'skireg_copper.csv', { preview_token: 'stale' }, 'commit');
    c.eq(r.status, 409, 'E: preview_token mismatch → 409');
    c.eq(r.data.error, 'preview_changed', 'E: … preview_changed');
    r = await importFile(cloud.base, CM.meet.id, fx('skireg_copper.csv'), 'skireg_copper.csv', { preview_token: P.preview_token }, 'commit');
    c.eq(r.status, 200, 'E: commit 200');
    c.eq(r.data.committed, true, 'E: committed flag');
    const expectRegs = P.athletes.to_register.reduce((n, x) => n + x.events.length, 0);
    c.eq(r.data.inserted.registrations, expectRegs, `E: ${expectRegs} registrations written`);
    c.eq(r.data.inserted.athletes_created, P.athletes.to_register.filter(x => !x.athlete_id).length, 'E: new athletes created');
    c.eq(r.data.inserted.athletes_updated, 1, 'E: the local athlete updated (number filled)');
    const localAfter = await api.must('GET', `/api/athletes/${local.id}`);
    c.eq(localAfter.ussa_num, '9900002', 'D: local athlete without a USSS # gained it');
    const nowhere = await db.queryOne("SELECT id FROM athletes WHERE last_name='Nowhere'");
    c.ok(!nowhere, 'D: flagged athlete NOT written when not ticked');
    const audit = await db.queryOne("SELECT * FROM audit_log WHERE action='import' AND entity='registrations' ORDER BY timestamp DESC LIMIT 1");
    c.ok(audit && audit.entity_id === CM.meet.id, 'E: audit row per commit');
    const regsA = await db.queryAll("SELECT r.event_id, r.bib_number FROM registrations r JOIN athletes a ON a.id=r.athlete_id WHERE a.ussa_num='9900001'");
    c.eq(regsA.length, 3, 'D: Anders has three registrations');
    c.ok(regsA.every(x => x.bib_number === 100), 'D: bib 100 on every registration');

    // second commit of the same file → nothing new
    r = await importFile(cloud.base, CM.meet.id, fx('skireg_copper.csv'), 'skireg_copper.csv');
    c.eq(r.data.athletes.to_register.length, 0, 'E: second preview: nothing to register');
    c.eq(r.data.athletes.already_registered.length, P.athletes.to_register.length, 'E: … everyone already registered');
    r = await importFile(cloud.base, CM.meet.id, fx('skireg_copper.csv'), 'skireg_copper.csv', { preview_token: r.data.preview_token, include_flagged: [unknown.key] }, 'commit');
    c.eq(r.data.inserted.registrations, 1, 'D/E: ticked flagged athlete registered (1 registration)');
    c.eq(r.data.inserted.athletes_created, 1, 'D: … and created without a USSS #');

    // same USSS # on two names → both flagged; Events column file
    r = await importFile(cloud.base, CM.meet.id, fx('rmf_events.csv'), 'rmf_events.csv');
    c.eq(r.data.columns.map['Events'], 'events', 'A: Events column mapped');
    c.eq(r.data.columns.map['FIS'], 'fis_id', 'A: FIS column mapped');
    const dupes = r.data.athletes.needs_attention.filter(x => x.flags.includes('duplicate_ussa_num'));
    c.deepEq(dupes.map(x => x.last_name).sort(), ['Crumble', 'Dupe'], 'D: same USSS # on two names → both flagged duplicate_ussa_num');
    const m3 = r.data.athletes.already_registered.find(x => x.last_name === 'Balloon') || r.data.athletes.to_register.find(x => x.last_name === 'Balloon');
    c.ok(m3, 'B/C: MDM2 row present');

    // tick columns (rmf_ticks) — entry columns detected
    r = await importFile(cloud.base, CM.meet.id, fx('rmf_ticks.csv'), 'rmf_ticks.csv');
    c.deepEq(r.data.columns.entry_columns.map(ec => ec.header), ['M', 'M2', 'D'], 'C: tick columns M / M2 / D detected as entry columns');
    c.eq(r.data.columns.unmapped.length, 0, 'C: no unmapped headers on a tick-column file');
    c.eq(r.data.needs_mapping, false, 'C: tick columns resolve without a prompt');

    // event_id filter
    const dualsM = CM.byName["Men's Duals"];
    const fresh = await api.must('POST', '/api/athletes', { first_name: 'Filter', last_name: 'Only', gender: 'M', ussa_num: '99009999' });
    const filterCsv = 'Last Name,First Name,Gender,Born,ID,Club,Events\nOnly,Filter,M,2010,99009999,Harness,MD\nOnly,Filtra,F,2010,99009998,Harness,MD\n';
    r = await importFile(cloud.base, CM.meet.id, Buffer.from(filterCsv), 'f.csv', { event_id: dualsM.id });
    c.eq(r.data.athletes.to_register.length, 1, 'E: event_id filter — one person for this event');
    c.deepEq(r.data.athletes.to_register[0].events, [dualsM.id], 'E: … registered only into the filtered event');
    c.eq(r.data.athletes.not_in_this_event.length, 1, 'E: the other-gender row reported as not_in_this_event');
    r = await importFile(cloud.base, CM.meet.id, Buffer.from(filterCsv), 'f.csv', { event_id: dualsM.id, preview_token: r.data.preview_token }, 'commit');
    c.eq(r.data.inserted.registrations, 1, 'E: filtered commit writes one registration');
    c.eq((await db.queryAll('SELECT * FROM registrations WHERE athlete_id=?', [fresh.id])).length, 1, 'E: … only in the filtered event');

    // no-info file with the per-event button (David's ruling) vs meet-level
    r = await importFile(cloud.base, CM.meet.id, fx('rmf_devo.csv'), 'rmf_devo.csv');
    c.eq(r.data.needs_mapping, true, 'C: no-entry-information file on a multi-event meet prompts (meet-level)');
    r = await importFile(cloud.base, CM.meet.id, fx('rmf_devo.csv'), 'rmf_devo.csv', { event_id: CM.byName["Women's Moguls Sun"].id });
    c.eq(r.data.needs_mapping, false, 'C: … but from the event\'s own Registration tab it does not');
    c.eq(r.data.markers.find(m => m.gender === 'F').reason, 'default_event', 'C: women rows → this event');
    c.eq(r.data.markers.find(m => m.gender === 'M').reason, 'other_gender', 'C: men rows → other gender, not blocking');
    r = await importFile(cloud.base, CM.meet.id, fx('rmf_devo.csv'), 'rmf_devo.csv', { event_id: CM.byName["Women's Moguls Sun"].id, preview_token: r.data.preview_token }, 'commit');
    c.eq(r.status, 200, 'E: per-event no-info commit succeeds');
    c.eq(r.data.inserted.registrations, 2, 'E: two women not yet in Sun moguls registered (bib blank keeps null)');

    // mapping required; saved mapping; re-import prompts only for the new category
    const AM = await buildEventsMeet(api, 'Ambiguous Harness', [["Men's Moguls A", 'M', 'mogul'], ["Men's Moguls B", 'M', 'mogul'], ["Women's Moguls", 'F', 'mogul']]);
    r = await importFile(cloud.base, AM.meet.id, fx('skireg_ambiguous.csv'), 'skireg_ambiguous.csv');
    c.eq(r.data.needs_mapping, true, 'C: "Men Moguls" on a two-moguls meet → prompt');
    const unresolved = r.data.markers.filter(m => m.resolution === null && m.reason !== 'not_an_event');
    c.deepEq(unresolved.map(m => [m.marker_display, m.gender, m.reason]), [['Men Moguls', 'M', 'ambiguous']], 'C: exactly the men\'s marker unresolved; women\'s resolved; fee row not an event');
    c.deepEq(unresolved[0].candidates.map(id => AM.events.find(e => e.id === id).name).sort(), ["Men's Moguls A", "Men's Moguls B"], 'C: candidates listed');
    r = await importFile(cloud.base, AM.meet.id, fx('skireg_ambiguous.csv'), 'skireg_ambiguous.csv', { preview_token: r.data.preview_token }, 'commit');
    c.eq(r.status, 400, 'E: commit while needs_mapping → 400');
    c.eq(r.data.error, 'mapping_required', 'E: … mapping_required');
    const mapping = [{ marker_norm: 'men moguls', gender: 'M', event_id: AM.byName["Men's Moguls B"].id, marker_display: 'Men Moguls' }];
    r = await importFile(cloud.base, AM.meet.id, fx('skireg_ambiguous.csv'), 'skireg_ambiguous.csv', { mapping });
    c.eq(r.data.needs_mapping, false, 'C: operator mapping resolves it');
    r = await importFile(cloud.base, AM.meet.id, fx('skireg_ambiguous.csv'), 'skireg_ambiguous.csv', { mapping, preview_token: r.data.preview_token }, 'commit');
    c.eq(r.status, 200, 'E: commit with mapping 200');
    c.eq(r.data.mapping_saved, 1, 'E: mapping saved');
    c.eq(parseInt((await db.queryOne('SELECT COUNT(*) AS n FROM meet_import_map WHERE meet_id=?', [AM.meet.id])).n), 1, 'E: meet_import_map row written');
    c.eq(r.data.events.find(e => e.name === "Men's Moguls B").to_register, 4, 'E: four men registered into B');
    // re-import with one NEW category → only that one prompts
    const again = fs.readFileSync(path.join(FIX, 'skireg_ambiguous.csv'), 'utf8') + `,Men Moguls Late Entry,Harness City,Liam,Dorsey,,0.0000,0.0000,M,CO,Aspen Harness Ski Club,,\n`;
    r = await importFile(cloud.base, AM.meet.id, Buffer.from(again), 'skireg_ambiguous2.csv');
    const un2 = r.data.markers.filter(m => m.resolution === null && m.reason !== 'not_an_event');
    c.deepEq(un2.map(m => m.marker_display), ['Men Moguls Late Entry'], 'C: saved mapping applied silently; only the new category prompts');
    c.eq(r.data.markers.find(m => m.marker_display === 'Men Moguls').reason, 'saved', 'C: saved marker reported as saved');

    // locked athlete (adopted meet): not updated, but registered elsewhere; adopted meet → 423
    const LM = await buildEventsMeet(api, 'Locked Harness', [["Men's Moguls", 'M', 'mogul']]);
    const lockedAth = await api.must('POST', '/api/athletes', { first_name: 'Lee', last_name: 'Lockman', gender: 'M', confirm: true });
    await api.must('POST', `/api/events/${LM.events[0].id}/registrations`, { athlete_id: lockedAth.id, bib_number: 1 });
    await db.client.execute({ sql: "UPDATE meets SET adoption_status='adopted', adopted_at=datetime('now') WHERE id=?", args: [LM.meet.id] });
    const lockCsv = Buffer.from('Last Name,First Name,Gender,Born,ID,Club\nLockman,Lee,M,2010,99007777,Harness\n');
    r = await importFile(cloud.base, LM.meet.id, lockCsv, 'lock.csv');
    c.eq(r.status, 423, 'E: adopted meet → 423');
    const NM = await buildEventsMeet(api, 'Other Harness', [["Men's Moguls", 'M', 'mogul']]);
    r = await importFile(cloud.base, NM.meet.id, lockCsv, 'lock.csv');
    const lockRow = r.data.athletes.to_register.find(x => x.last_name === 'Lockman');
    c.eq(lockRow && lockRow.athlete_id, lockedAth.id, 'D: locked athlete matched by name');
    r = await importFile(cloud.base, NM.meet.id, lockCsv, 'lock.csv', { preview_token: r.data.preview_token }, 'commit');
    const lockedAfter = await api.must('GET', `/api/athletes/${lockedAth.id}`);
    c.ok(!lockedAfter.ussa_num, 'D: locked athlete NOT updated (USSS # still empty)');
    c.eq((await db.queryAll('SELECT * FROM registrations WHERE athlete_id=? AND event_id=?', [lockedAth.id, NM.events[0].id])).length, 1, 'D: … but registered in the unlocked meet');
    await db.client.execute({ sql: 'UPDATE meets SET adoption_status=NULL, adopted_at=NULL WHERE id=?', args: [LM.meet.id] });

    // old per-event route is gone; column overrides; bad events code + ID text; XLSX via endpoint
    r = await api.post(`/api/events/${CM.events[0].id}/registrations/import-csv?mode=preview`, {});
    c.eq(r.status, 404, 'E: POST /import-csv → 404 (removed)');
    r = await importFile(cloud.base, CM.meet.id, fx('reg_7722_swapped.csv'), 'reg_7722_swapped.csv');
    c.deepEq(r.data.columns.duplicates, [{ field: 'club', headers: ['Club', 'Team'] }], 'A: Club + Team both mapped to club → duplicate warning');
    c.eq(r.data.markers[0].reason, 'no_gender', 'A: … gender lost until the column is fixed');
    r = await importFile(cloud.base, CM.meet.id, fx('reg_7722_swapped.csv'), 'reg_7722_swapped.csv', { column_overrides: { Club: 'gender' } });
    c.eq(r.data.columns.map['Club'], 'gender', 'A: column override applied');
    c.eq(r.data.columns.map['Year of Birth'], 'birth_year', 'A: Year of Birth mapped');
    c.ok(r.data.markers.every(m => m.gender === 'M'), 'A: … rows now carry the gender');
    r = await importFile(cloud.base, CM.meet.id, fx('rmf_id_text.csv'), 'rmf_id_text.csv');
    const idText = [...r.data.athletes.to_register, ...r.data.athletes.needs_attention, ...r.data.athletes.already_registered].find(x => x.last_name === 'Agee-Test');
    c.ok(idText, 'A: row with literal ID text still read');
    const mq = r.data.athletes.needs_attention.find(x => x.last_name === 'Anders');
    c.ok(mq && mq.flags.includes('bad_events_code'), 'B: MQ row flagged bad_events_code');
    r = await importFile(cloud.base, CM.meet.id, fx('skireg_copper.xlsx'), 'skireg_copper.xlsx');
    c.eq(r.status, 200, 'A: XLSX accepted by the endpoint');
    c.eq(r.data.rows_read, P.rows_read, 'A: XLSX reads the same rows as the CSV');
    r = await importFile(cloud.base, CM.meet.id, fx('winfree_results.csv'), 'winfree_results.csv');
    c.eq(r.status, 200, 'H: Winfree results export parses without error');
    c.ok(r.data.rows_read >= 2, 'H: … names read');
    r = await importFile(cloud.base, CM.meet.id, fx('winfree_startlist.csv'), 'winfree_startlist.csv');
    c.eq(r.data.columns.map['From'], 'club', 'A: Winfree start list "From" → club');
    r = await importFile(cloud.base, CM.meet.id, fx('skireg_date_mismatch.csv'), 'x.csv');
    c.eq(r.data.markers[0].reason, 'date_mismatch', 'C: endpoint reports date_mismatch');
    const SM = await buildEventsMeet(api, 'Series Harness', [["Devo Men's Moguls", 'M', 'mogul'], ["RQS Men's Moguls", 'M', 'mogul'], ["Devo Women's Moguls", 'F', 'mogul'], ["RQS Women's Moguls", 'F', 'mogul']]);
    r = await importFile(cloud.base, SM.meet.id, fx('skireg_series.csv'), 'x.csv');
    c.eq(r.data.needs_mapping, false, 'C: Devo / RQS categories resolve by series word');
    c.deepEq(r.data.events.map(e => e.to_register), [3, 3, 2, 0], 'C: … into the right events');
    // no-header via the endpoint
    r = await importFile(cloud.base, CM.meet.id, Buffer.from('a,b\n1,2\n'), 'junk.csv');
    c.eq(r.status, 400, 'E: file without a Last Name column → 400');
    c.eq(r.data.error, 'no_header', 'E: … no_header with the first rows echoed');
    c.ok(Array.isArray(r.data.first_rows) && r.data.first_rows.length === 2, 'E: … first rows echoed');

    // =====================================================================
    // F. Import codes
    // =====================================================================
    r = await api.put(`/api/meets/${CM.meet.id}/events/${CM.byName["Men's Moguls Sun"].id}`, { import_code: 'M' });
    c.eq(r.status, 409, 'F: PUT duplicate import code → 409');
    r = await api.put(`/api/meets/${CM.meet.id}/events/${CM.byName["Men's Moguls Sun"].id}`, { import_code: 'm-3' });
    c.eq(r.status, 400, 'F: invalid import code → 400');
    r = await api.put(`/api/meets/${CM.meet.id}/events/${CM.byName["Men's Moguls Sun"].id}`, { import_code: 'm3' });
    c.eq(r.data.import_code, 'M3', 'F: PUT upper-cases + stores');
    r = await api.put(`/api/meets/${CM.meet.id}/events/${CM.byName["Men's Moguls Sun"].id}`, { import_code: 'M2' });
    c.eq(r.data.import_code, 'M2', 'F: restored to M2');
    const ev1 = await api.must('GET', `/api/meets/${CM.meet.id}/events/${CM.events[0].id}`);
    c.eq(ev1.import_code, 'M', 'F: event GET carries import_code');
    const list = await api.must('GET', `/api/meets/${CM.meet.id}/events`);
    c.ok(list.every(e => e.import_code), 'F: event list carries import_code');
    const explicit = await api.must('POST', `/api/meets/${CM.meet.id}/events`, { name: "Men's Aerials", gender: 'M', discipline: 'aerials', division: 'comp_series', import_code: 'AX' });
    c.eq(explicit.import_code, 'AX', 'F: explicit import code on create');
    r = await api.post(`/api/meets/${CM.meet.id}/events`, { name: "Men's Aerials 2", gender: 'M', discipline: 'aerials', division: 'comp_series', import_code: 'AX' });
    c.eq(r.status, 409, 'F: duplicate explicit code on create → 409');
    const auto = await api.must('POST', `/api/meets/${CM.meet.id}/events`, { name: "Men's Aerials 2", gender: 'M', discipline: 'aerials', division: 'comp_series' });
    c.eq(auto.import_code, 'A', 'F: aerials auto code A');
    // backfill on a "pre-v2.7.00" database: NULL codes, Sun created before Sat → date order wins
    const BM = await buildEventsMeet(api, 'Backfill Harness', [["Men's Moguls Sun", 'M', 'mogul', '2026-03-08'], ["Men's Moguls Sat", 'M', 'mogul', '2026-03-07'], ["Men's Duals", 'M', 'dual_mogul', '2026-03-08']]);
    await db.client.execute({ sql: 'UPDATE events SET import_code=NULL WHERE meet_id=?', args: [BM.meet.id] });
    await db.client.execute({ sql: "DELETE FROM app_settings WHERE key='migration_v27_import_code_done'", args: [] });
    await cloud.stop();
    await cloud.start();
    const bf = await api.must('GET', `/api/meets/${BM.meet.id}/events`);
    c.deepEq(bf.map(e => [e.name, e.import_code]).sort(), [["Men's Duals", 'D'], ["Men's Moguls Sat", 'M'], ["Men's Moguls Sun", 'M2']], 'F: backfill assigns codes in event_date order');
    c.ok(await db.queryOne("SELECT value FROM app_settings WHERE key='migration_v27_import_code_done'"), 'F: backfill marker written');
    // clone copies
    const clone = await api.must('POST', `/api/meets/${BM.meet.id}/clone`, { name: 'Backfill Clone', date: '2026-03-14', location: 'Harness Mountain' });
    const cl = await api.must('GET', `/api/meets/${clone.id || clone.meet?.id}/events`);
    c.deepEq(cl.map(e => e.import_code).sort(), ['D', 'M', 'M2'], 'F: clone copies import codes');
    c.eq(parseInt((await db.queryOne('SELECT COUNT(*) AS n FROM meet_import_map WHERE meet_id=?', [clone.id || clone.meet?.id])).n), 0, 'F: clone does not copy the mapping table');
    // export / import round-trip
    const zipRes = await fetch(`${cloud.base}/api/meets/${BM.meet.id}/export`);
    c.eq(zipRes.status, 200, 'F: export zip');
    const zipBuf = Buffer.from(await zipRes.arrayBuffer());
    const fd = new FormData();
    fd.append('file', new Blob([zipBuf]), 'export.zip');
    let imp = await fetch(`${cloud.base}/api/meets/import`, { method: 'POST', body: fd });
    let impData = await imp.json();
    if (impData.conflict && impData.pending_import_id) {
      imp = await fetch(`${cloud.base}/api/meets/import?pending_import_id=${impData.pending_import_id}&conflict_action=import`, { method: 'POST' });
      impData = await imp.json();
    }
    c.eq(imp.status, 200, `F: import zip (${JSON.stringify(impData).slice(0, 80)})`);
    const allMeets = await api.must('GET', '/api/meets');
    const importedMeet = allMeets.find(m => m.name === 'Backfill Harness' && m.id !== BM.meet.id);
    if (importedMeet) {
      const ie = await api.must('GET', `/api/meets/${importedMeet.id}/events`);
      c.deepEq(ie.map(e => e.import_code).sort(), ['D', 'M', 'M2'], 'F: import round-trips import codes');
    } else {
      c.ok(false, `F: imported meet not found (${JSON.stringify(impData).slice(0, 200)})`);
    }
    // meet delete removes the mapping table rows
    await api.must('DELETE', `/api/meets/${AM.meet.id}`);
    c.eq(parseInt((await db.queryOne('SELECT COUNT(*) AS n FROM meet_import_map WHERE meet_id=?', [AM.meet.id])).n), 0, 'F: meet delete removes meet_import_map rows');
    // event delete removes mapping rows pointing at it
    const DM = await buildEventsMeet(api, 'Del Harness', [["Men's Moguls A", 'M', 'mogul'], ["Men's Moguls B", 'M', 'mogul']]);
    r = await importFile(cloud.base, DM.meet.id, fx('skireg_ambiguous.csv'), 'x.csv', { mapping: [{ marker_norm: 'men moguls', gender: 'M', event_id: DM.events[1].id }] });
    await importFile(cloud.base, DM.meet.id, fx('skireg_ambiguous.csv'), 'x.csv', { mapping: [{ marker_norm: 'men moguls', gender: 'M', event_id: DM.events[1].id }], preview_token: r.data.preview_token }, 'commit');
    await api.must('DELETE', `/api/meets/${DM.meet.id}/events/${DM.events[1].id}`);
    c.eq(parseInt((await db.queryOne('SELECT COUNT(*) AS n FROM meet_import_map WHERE event_id=?', [DM.events[1].id])).n), 0, 'F: event delete removes mapping rows pointing at it');

    // venue: protocol 3, import_code NULL after adoption, cloud value survives check-in, no outbox rows for meet_import_map
    await venue.start();
    const vApi = new Api(venue.base);
    const vdb = openDb(venue.dbPath);
    const vs = await vApi.must('GET', '/api/venue/status');
    c.eq(vs.protocol_version, 3, 'F: /api/venue/status still protocol 3');
    await vApi.must('POST', '/api/venue/pins', { control_pin: '2468', crew_pin: '1357' });
    const VM = await buildEventsMeet(api, 'Venue Harness', [["Men's Moguls", 'M', 'mogul', '2026-03-07'], ["Women's Moguls", 'F', 'mogul', '2026-03-07']]);
    r = await importFile(cloud.base, VM.meet.id, fx('rmf_devo.csv'), 'rmf_devo.csv');
    await importFile(cloud.base, VM.meet.id, fx('rmf_devo.csv'), 'rmf_devo.csv', { preview_token: r.data.preview_token }, 'commit');
    const rel = await api.must('POST', `/api/meets/${VM.meet.id}/release-for-adoption`);
    r = await vApi.post('/api/venue/adopt', { code: rel.code, cloud_url: cloud.base });
    c.eq(r.status, 200, 'F: venue adopts');
    const vEvents = await vdb.queryAll('SELECT import_code FROM events WHERE meet_id=?', [VM.meet.id]);
    c.ok(vEvents.length === 2 && vEvents.every(e => e.import_code == null), 'F: import_code NULL on the venue after adoption');
    c.eq(parseInt((await vdb.queryOne('SELECT COUNT(*) AS n FROM meet_import_map')).n), 0, 'F: meet_import_map not in the adoption package');
    // an import on the venue-mode instance writes no outbox rows for the map table
    const vCtl = (await vApi.must('POST', '/api/venue/verify-pin', { kind: 'control', pin: '2468' })).token;
    const vOutboxBefore = parseInt((await vdb.queryOne('SELECT COUNT(*) AS n FROM sync_outbox')).n);
    r = await importFile(venue.base, VM.meet.id, Buffer.from('Last Name,First Name,Gender,Born,ID,Club\nVenueside,Val,M,2010,99001234,Harness\n'), 'v.csv', {}, 'preview', vCtl);
    c.eq(r.status, 200, 'F: importer runs in venue mode');
    r = await importFile(venue.base, VM.meet.id, Buffer.from('Last Name,First Name,Gender,Born,ID,Club\nVenueside,Val,M,2010,99001234,Harness\n'), 'v.csv', { preview_token: r.data.preview_token }, 'commit', vCtl);
    c.eq(r.status, 200, 'F: venue-mode commit');
    const outboxTables = (await vdb.queryAll('SELECT DISTINCT tbl AS table_name FROM sync_outbox')).map(x => x.table_name);
    c.ok(!outboxTables.includes('meet_import_map'), `F: no outbox rows for meet_import_map (tables: ${outboxTables.join(',')})`);
    c.ok(parseInt((await vdb.queryOne('SELECT COUNT(*) AS n FROM sync_outbox')).n) >= vOutboxBefore, 'F: athlete/registration writes captured as usual');
    const stats = await vApi.must('GET', '/api/venue/capture-stats');
    c.ok(stats && !(JSON.stringify(stats).includes('meet_import_map')), 'F: capture-stats never mentions meet_import_map');
    await waitFor(async () => { const s = await vApi.must('GET', '/api/venue/status'); return s.sync && s.sync.state === 'up_to_date' && s.sync.queued === 0; }, { timeout: 25000 });
    r = await fetch(`${venue.base}/api/venue/checkin`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${vCtl}` }, body: JSON.stringify({ mode: 'checkin' }) });
    c.eq(r.status, 200, `F: check-in ${r.status}`);
    const cEvents = await db.queryAll('SELECT name, import_code FROM events WHERE meet_id=? ORDER BY name', [VM.meet.id]);
    c.deepEq(cEvents.map(e => e.import_code), ['M', 'M'], 'F: cloud import codes survive check-in (upsert of manifest columns only)');
    const vAth = await db.queryOne("SELECT id FROM athletes WHERE ussa_num='99001234'");
    c.ok(vAth, 'F: venue-side imported athlete reached the cloud through the normal sync');

    // =====================================================================
    // G. Athlete-only endpoints
    // =====================================================================
    const postCsv = async (buf, name, extraHeaders = {}) => {
      const rr = await fetch(`${cloud.base}/api/import/athletes/csv`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name), ...extraHeaders }, body: buf });
      return { status: rr.status, data: await rr.json() };
    };
    const fresh1 = 'Last Name,First Name,Gender,Born,ID,Club,Bib\nGamma,One,M,2010,99005001,Harness,\nGamma,Two,F,2011,99005002,Harness,\n';
    r = await postCsv(Buffer.from(fresh1), 'g.csv');
    c.deepEq([r.data.added, r.data.updated, r.data.skipped, r.data.total], [2, 0, 0, 2], 'G: athletes/csv adds 2 (v2.6.03 shape: added/updated/skipped/errors/total)');
    r = await postCsv(Buffer.from(fresh1), 'g.csv');
    c.deepEq([r.data.added, r.data.updated], [0, 2], 'G: second run updates 2');
    r = await postCsv(Buffer.from('Last Name,First Name,Gender,Club\nDorsey,Liam,M,Aspen Harness Ski Club\n'), 'names.csv');
    c.eq(r.data.updated + r.data.added, 1, 'G: name-only row processed');
    const dorsey = await db.queryOne("SELECT ussa_num, birth_year FROM athletes WHERE last_name='Dorsey' AND first_name='Liam'");
    c.deepEq([dorsey.ussa_num, dorsey.birth_year], ['9900006', 2012], 'G: USSS lookup fills the number + birth year on a name-only file');
    r = await postCsv(fx('skireg_copper.xlsx'), 'skireg_copper.xlsx');
    c.eq(r.status, 200, 'G: XLSX accepted by athletes/csv');
    c.ok(r.data.total > 20 && r.data.errors.length === 0, 'G: … all rows processed');
    r = await fetch(`${cloud.base}/api/import/athletes/csv`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'Last Name,First Name,Gender,Born,ID\nPasted,Pat,M,2010,99005003\n' });
    c.eq((await r.json()).added, 1, 'G: pasted text body still works');
    const rec = await fetch(`${cloud.base}/api/athletes/reconcile`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'rmf_ticks.csv' }, body: fx('rmf_ticks.csv') });
    const recData = await rec.json();
    c.deepEq(Object.keys(recData).sort(), ['notInFile', 'toAdd', 'toUpdate'], 'G: reconcile diff shape unchanged');
    c.ok(Array.isArray(recData.toUpdate) && recData.toUpdate.every(u => Array.isArray(u.diffs)), 'G: reconcile diffs shape');

    // =====================================================================
    // H. Real sample files (env-gated)
    // =====================================================================
    const SAMPLES = process.env.STICKIT_REG_SAMPLES;
    if (SAMPLES && fs.existsSync(SAMPLES)) {
      const hc = new Checks('v270-samples');
      const sync = await api.post('/api/usss/sync', {});
      hc.ok(sync.ok, `H: real People File synced (${JSON.stringify(sync.data).slice(0, 80)})`);
      const files = fs.readdirSync(SAMPLES).filter(f => /\.(csv|xlsx)$/i.test(f) && !/^\./.test(f)).sort();
      // RMF-shaped meet: M / M2 / D per gender with two moguls dates
      const RM = await buildEventsMeet(api, 'Samples RMF', COPPER);
      for (const f of files) {
        const buf = fs.readFileSync(path.join(SAMPLES, f));
        const isReg = /^REG_/i.test(f);
        const isResults = /Steamboat Comp 2026( 2| 3)?\.CSV$|Telluride Comp Divisionals 2025\.CSV$/i.test(f);
        if (isResults) {
          const rr = await importFile(cloud.base, RM.meet.id, buf, f);
          hc.eq(rr.status, 200, `H: ${f} (Winfree results) parses without error`);
          hc.ok(rr.data.rows_read > 0 && rr.data.columns.map['Last'] === 'last_name', `H: ${f} names read`);
          continue;
        }
        if (!isReg) {
          const rr = await importFile(cloud.base, RM.meet.id, buf, f);
          if (rr.status !== 200) { hc.ok(false, `H: ${f} → ${rr.status} ${JSON.stringify(rr.data).slice(0, 120)}`); continue; }
          const d = rr.data;
          const un = d.columns.unmapped.map(u => u.header);
          hc.eq(un.length, 0, `H: ${f}: 0 unmapped headers (${un.join(',')})`);
          const all = [...d.athletes.to_register, ...d.athletes.already_registered, ...d.athletes.not_in_this_event, ...d.athletes.needs_attention];
          const noGender = d.markers.filter(m => m.resolution === null && !['not_an_event', 'other_gender'].includes(m.reason));
          const isDevoLike = d.markers.every(m => m.source === 'none');
          if (isDevoLike) hc.ok(true, `H: ${f}: no entry information (prompts on a multi-event meet, by design)`);
          else hc.eq(noGender.length, 0, `H: ${f}: every marker resolved (${noGender.map(m => m.marker_display + ':' + m.reason).join(';')})`);
          const withNum = all.filter(x => x.ussa_num).length;
          const rawP = await R.parseFile(buf, f);
          const rawM = R.mapColumns(rawP.headers, {});
          const rawNoId = rawP.rows.map(rec => R.readRecord(rec, rawM)).filter(v => (v.first_name || v.last_name) && !v.ussa_num).length;
          hc.ok(all.length > 0 && (all.length - withNum) <= rawNoId, `H: ${f}: USSS numbers present ${withNum}/${all.length} (file lacks ${rawNoId}; lookup filled ${Math.max(0, rawNoId - (all.length - withNum))})`);
          continue;
        }
        // SkiReg family: build a meet from the file's own categories, then preview against it
        const probe = await importFile(cloud.base, RM.meet.id, buf, f);
        if (probe.status !== 200) { hc.ok(false, `H: ${f} → ${probe.status}`); continue; }
        const defs = [];
        for (const m of probe.data.markers) {
          if (m.source !== 'category' || m.reason === 'not_an_event') continue;
          const g = m.gender || R.genderWord(m.marker_display);
          const disc = R.disciplineWord(m.marker_display);
          if (!g || !disc) continue;
          const cue = R.dateCue(m.marker_display);
          const date = cue && cue.month ? `2026-${String(cue.month).padStart(2, '0')}-${String(cue.day).padStart(2, '0')}` : null;
          const key = `${g}|${disc}|${date}`;
          if (!defs.some(d => d[4] === key)) defs.push([m.marker_display.replace(/\*/g, '').trim(), g, disc, date, key]);
        }
        const SMm = await buildEventsMeet(api, `Samples ${f}`, defs.map(d => d.slice(0, 4)));
        const rr = await importFile(cloud.base, SMm.meet.id, buf, f);
        const d = rr.data;
        const notEvents = d.markers.filter(m => m.reason === 'not_an_event').map(m => m.marker_display);
        const unresolved = d.markers.filter(m => m.resolution === null && m.reason !== 'not_an_event');
        if (d.markers.every(m => m.source === 'none')) {
          hc.ok(rr.status === 200 && d.rows_read > 0, `H: ${f}: older REG layout (no entry information) parses; ${d.rows_read} rows`);
          if (/REG_7722/i.test(f)) hc.ok(d.columns.duplicates.some(x => x.field === 'club'), `H: ${f}: duplicate club mapping warned`);
          continue;
        }
        hc.eq(unresolved.length, 0, `H: ${f}: no prompt (${unresolved.map(m => m.marker_display + ':' + m.reason).join(';')}) · not events: ${notEvents.join(' | ')}`);
        const all = [...d.athletes.to_register, ...d.athletes.needs_attention];
        const withNum = all.filter(x => x.ussa_num).length;
        hc.ok(all.length > 0 && withNum / all.length >= 0.90, `H: ${f}: USSS match ${withNum}/${all.length} (${(100 * withNum / Math.max(1, all.length)).toFixed(1)}%)`);
        if (/REG_7722/i.test(f)) hc.ok(d.columns.duplicates.some(x => x.field === 'club'), `H: ${f}: duplicate club mapping warned`);
      }
      c.ok(hc.failed === 0, `H: real sample pass: ${hc.passed} passed, ${hc.failed} failed`);
      c.samples = hc;
    } else {
      console.log('    (H: real sample pass skipped — set STICKIT_REG_SAMPLES=<folder>)');
    }

    // =====================================================================
    // I. Playwright
    // =====================================================================
    tab = await newTablet();
    const page = await tab.newPage();
    await page.setViewportSize({ width: 1400, height: 1000 });
    const PM = await buildEventsMeet(api, 'Playwright Copper', COPPER);
    const PMexp = (await importFile(cloud.base, PM.meet.id, fx('skireg_copper.csv'), 'skireg_copper.csv')).data;
    const PMmenSat = PMexp.events.find(e => e.name === "Men's Moguls Sat");
    await page.goto(`${cloud.base}/dashboard/meets/${PM.meet.id}`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('meet-import-registrations').click();
    await page.getByTestId('import-file').setInputFiles(path.join(FIX, 'skireg_copper.csv'));
    await page.getByTestId('import-analyze').click();
    await page.getByTestId('import-preview-step').waitFor({ timeout: 15000 });
    c.eq(await page.getByTestId('import-columns-step').count(), 0, 'I: no Columns step on a clean SkiReg file');
    c.eq(await page.getByTestId('import-events-step').count(), 0, 'I: no Events step on the Copper file');
    c.eq(await page.getByTestId('import-event-card').count(), 6, 'I: six event cards');
    const cardText = await page.getByTestId('import-event-cards').innerText();
    c.ok(cardText.includes(`+${PMmenSat.to_register} to register`) && cardText.includes(`+${PMexp.events.find(e => e.name === "Women's Duals").to_register} to register`), 'I: cards show the right counts');
    c.eq(await page.getByTestId('import-to-register-row').count(), PMexp.athletes.to_register.length, 'I: To Register rows');
    c.eq(await page.getByTestId('import-needs-attention').count(), PMexp.athletes.needs_attention.length ? 1 : 0, 'I: Needs Attention table shown when the preview has flagged rows');
    await page.screenshot({ path: path.join(SHOTS, 'preview_copper.png'), fullPage: false });
    await page.getByTestId('import-confirm').click();
    await page.getByTestId('import-result').waitFor({ timeout: 15000 });
    await page.screenshot({ path: path.join(SHOTS, 'result_copper.png') });
    await page.getByTestId('import-done').click();
    await page.goto(`${cloud.base}/dashboard/meets/${PM.meet.id}/events/${PM.byName["Men's Moguls Sat"].id}`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Registration', { exact: true }).first().click().catch(() => {});
    await page.getByTestId('reg-import-code').waitFor({ timeout: 15000 });
    c.eq(await page.getByTestId('reg-import-code').innerText(), 'Import code M', 'I: Registration tab shows the import code');
    const regRows = await api.must('GET', `/api/events/${PM.byName["Men's Moguls Sat"].id}/registrations`);
    c.eq(regRows.length, PMmenSat.to_register, `I: Registration tab lists the ${PMmenSat.to_register} imported athletes`);
    const regHeader = page.getByText('Registered Athletes').first();
    if (!(await page.getByText('Anders').count())) await regHeader.click().catch(() => {});
    await page.getByText('Anders').first().waitFor({ timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(SHOTS, 'registration_tab.png') });
    c.ok((await page.getByText('Anders').count()) > 0, 'I: an imported athlete listed on the Registration tab');

    // ambiguous fixture → Events step
    const PA = await buildEventsMeet(api, 'Playwright Ambiguous', [["Men's Moguls A", 'M', 'mogul'], ["Men's Moguls B", 'M', 'mogul'], ["Women's Moguls", 'F', 'mogul']]);
    await page.goto(`${cloud.base}/dashboard/meets/${PA.meet.id}`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('meet-import-registrations').click();
    await page.getByTestId('import-file').setInputFiles(path.join(FIX, 'skireg_ambiguous.csv'));
    await page.getByTestId('import-analyze').click();
    await page.getByTestId('import-events-step').waitFor({ timeout: 15000 });
    c.eq(await page.locator('[data-testid="import-marker-row"][data-unresolved="1"]').count(), 1, 'I: Events step with exactly one unresolved row');
    c.ok(await page.getByTestId('import-confirm').isDisabled(), 'I: Confirm disabled while unresolved');
    await page.screenshot({ path: path.join(SHOTS, 'events_step.png') });
    const row = page.locator('[data-testid="import-marker-row"][data-unresolved="1"]').first();
    await row.getByTestId('import-marker-select').selectOption(PA.byName["Men's Moguls B"].id);
    await waitFor(async () => !(await page.getByTestId('import-confirm').isDisabled()), { timeout: 15000 });
    c.ok(!(await page.getByTestId('import-confirm').isDisabled()), 'I: Confirm enabled after the pick');
    await page.getByTestId('import-confirm').click();
    await page.getByTestId('import-result').waitFor({ timeout: 15000 });
    await page.getByTestId('import-done').click();
    c.eq((await api.must('GET', `/api/events/${PA.byName["Men's Moguls B"].id}/registrations`)).length, 4, 'I: four men registered into B after the pick');
    c.eq(parseInt((await db.queryOne('SELECT COUNT(*) AS n FROM meet_import_map WHERE meet_id=?', [PA.meet.id])).n), 3, 'I: whole confirmed table saved (men, women, fee)');

    // per-event button
    const PE = await buildEventsMeet(api, 'Playwright PerEvent', COPPER);
    const target = PE.byName["Men's Duals"];
    await page.goto(`${cloud.base}/dashboard/meets/${PE.meet.id}/events/${target.id}`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('reg-import-button').waitFor({ timeout: 15000 });
    await page.getByTestId('reg-import-button').click();
    await page.getByTestId('import-file').setInputFiles(path.join(FIX, 'skireg_copper.csv'));
    await page.getByTestId('import-analyze').click();
    await page.getByTestId('import-preview-step').waitFor({ timeout: 15000 });
    await page.screenshot({ path: path.join(SHOTS, 'per_event.png') });
    await page.getByTestId('import-confirm').click();
    await page.getByTestId('import-result').waitFor({ timeout: 15000 });
    await page.getByTestId('import-done').click();
    const perEventRegs = await db.queryAll('SELECT event_id FROM registrations WHERE event_id IN (SELECT id FROM events WHERE meet_id=?)', [PE.meet.id]);
    c.ok(perEventRegs.length === 5 && perEventRegs.every(x => x.event_id === target.id), 'I: per-event button registered only that event\'s rows (5 men duals)');
    console.log(`    screenshots: ${SHOTS}`);
  } finally {
    if (tab) await tab.close().catch(() => {});
    await venue.stop().catch(() => {});
    await cloud.stop().catch(() => {});
  }
  return c.samples ? [c, c.samples] : c;
}

module.exports = { main };
if (require.main === module) main().then(res => { const list = Array.isArray(res) ? res : [res]; for (const x of list) console.log(x.summary()); process.exit(list.some(x => x.failed) ? 1 : 0); });
