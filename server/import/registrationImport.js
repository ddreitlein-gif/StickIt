/**
 * server/import/registrationImport.js — v2.7.00 unified registration import.
 *
 * ONE pipeline for every registration file StickIt reads (SkiReg exports,
 * RMF / Winfree "Data" spreadsheets, XLSX), used by:
 *   - POST /api/meets/:id/registrations/import   (meet-level; preview + commit)
 *   - POST /api/import/athletes/csv and POST /api/athletes/reconcile
 *     (athlete-only: stages 1, 2 and the identity steps — no event stage)
 *
 * Stages (StickIt_Registration_Import_Implementation_Prompt_09-19-26.md):
 *   1. parseFile(buffer, filename)     read CSV / XLSX, find the header row
 *   2. mapColumns(headers, opts)       synonym table + entry columns
 *      readRecord / normalizeValues    value rules (name split, gender, year,
 *                                      USSS #, bib)
 *   3. markers + resolveMarker         entry markers → exactly one event or
 *                                      "not an event" (rules 1–8, saved map)
 *   4. identity                        USSS # → FIS → USSS People File by
 *                                      name → athletes by name → new
 *   5. previewImport / commitImport    two-phase, commit re-runs the preview
 *
 * Stages 1–3 are pure functions (no DB) so the harness can unit-test them
 * without a server. Nothing here touches scoring, run order, phases,
 * brackets, tablets, or the venue/sync code. Rows written on commit are
 * ordinary `athletes` / `registrations` rows, indistinguishable from manual
 * entry. No third-party call of any kind (David's ruling, 09-19-26).
 */

const crypto = require('crypto');
const { parse: csvParse } = require('csv-parse/sync');

// ═══════════════════════════════════════════════════════════════════════════
// Stage 2 tables
// ═══════════════════════════════════════════════════════════════════════════

/** Canonical field ← normalised header forms (Winfree list + SkiReg + exports). */
const SYNONYMS = {
  last_name:  ['lastname', 'last', 'name', 'surname', 'familyname', 'nom', 'nomdefamille', 'dernier'],
  first_name: ['firstname', 'first', 'givenname', 'prenom', 'premiere'],
  gender:     ['gender', 'sex', 'sexe', 'group', 'groupe', 'gp', 'grp', 'mf'],
  birth_year: ['birthyear', 'yearofbirth', 'yob', 'born', 'birthday', 'birthdate', 'dateofbirth', 'dob', 'dobyear', 'year', 'anneedenaissance', 'ne', 'nee'],
  ussa_num:   ['id', 'ussaid', 'ussa', 'ussanum', 'ussanumber', 'usssid', 'usss', 'usssnum', 'usssnumber', 'usssmember', 'usssmembernumber', 'memberid', 'membernumber', 'nationalid'],
  fis_id:     ['fisid', 'fis', 'fiscode', 'fisnum', 'fisnumber'],
  club:       ['club', 'clubname', 'team', 'teamname', 'mountain', 'montagne', 'rep', 'representing', 'from'],
  nation:     ['nation', 'nat', 'country', 'pays'],
  bib:        ['bib', 'bibnumber', 'dossard'],
  category:   ['categoryentered', 'categoryenteredmerchandiseordered', 'category', 'event', 'eventname'],
  events:     ['events', 'epreuves'],
};

/** Headers that are known and deliberately ignored (never reported as unmapped). */
const IGNORED_HEADERS = new Set([
  'division', 'clubcode', 'age', 'email', 'points', 'date', 'registered', 'city', 'state', 'notes',
  'fundraisingpageviews', 'customtax', 'quantity', 'merchsummary', 'transactiontype', 'no', 'score',
  'j1', 'j2', 'j3', 'j4', 'j5', 'j6', 'j7', 'tl', 'jumps', 'dofd', 'airs', 'judge', 'time', 'pts', 'run',
  'total', 'rank', 'place', 'turns', 'air', 'speed', 'dd',
]);

const FIELD_NAMES = Object.keys(SYNONYMS);

const REVERSE = (() => {
  const m = new Map();
  for (const [field, list] of Object.entries(SYNONYMS)) {
    for (const s of list) m.set(s, field);
    m.set(field.replace(/[^a-z0-9]/g, ''), field);
  }
  return m;
})();

const LAST_NAME_FORMS = new Set(SYNONYMS.last_name);

/** NFD-decompose, strip marks, lower-case, keep a-z0-9 only (Winfree rule). */
function normalizeHeader(h) {
  return String(h == null ? '' : h)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Name normalisation for identity matching: NFD, strip marks, lower, letters only. */
function normalizeName(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z]/g, '');
}

// ═══════════════════════════════════════════════════════════════════════════
// Stage 1 — reading
// ═══════════════════════════════════════════════════════════════════════════

function decodeText(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (_) {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

function isXlsx(buffer, filename) {
  if (/\.xlsx$/i.test(String(filename || ''))) return true;
  // ZIP magic (xlsx is a zip) — a mis-named upload still reads.
  return buffer && buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text || '').join('').trim();
    if (v.result !== undefined) return cellText(v.result);
    if (v.text !== undefined) return String(v.text).trim();
    if (v.hyperlink) return String(v.text || v.hyperlink).trim();
    if (v.error) return '';
    return String(v).trim();
  }
  return String(v).trim();
}

/** CSV bytes → array of string arrays (no header interpretation yet). */
function csvToGrid(buffer) {
  const text = decodeText(buffer);
  try {
    return csvParse(text, {
      columns: false,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    }).map(r => r.map(c => (c == null ? '' : String(c).trim())));
  } catch (e) {
    const err = new Error('CSV parse failed: ' + e.message);
    err.code = 'bad_file';
    throw err;
  }
}

/** XLSX bytes → array of string arrays from the first worksheet. */
async function xlsxToGrid(buffer) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch (e) {
    const err = new Error('XLSX read failed: ' + e.message);
    err.code = 'bad_file';
    throw err;
  }
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const grid = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = row.values; // 1-indexed, may have holes
    const out = [];
    for (let i = 1; i < vals.length; i++) out.push(cellText(vals[i]));
    grid.push(out);
  });
  return grid;
}

/**
 * Winfree header rule: the header is the first row (within the first 20) that
 * contains a Last Name synonym after normalisation. Rows above are ignored.
 */
function findHeaderRow(grid) {
  const limit = Math.min(grid.length, 20);
  for (let i = 0; i < limit; i++) {
    if (grid[i].some(c => LAST_NAME_FORMS.has(normalizeHeader(c)))) return i;
  }
  return -1;
}

/**
 * Turn a grid into { headers, rows, warnings, header_row_index }.
 * Records are keyed by the raw header text. Empty headers are dropped
 * (their cells are never read); a duplicate header gets " (n)" appended so
 * nothing collides — its normalised form then fails to map and is reported.
 */
function gridToRecords(grid) {
  const hIdx = findHeaderRow(grid);
  if (hIdx < 0) {
    const err = new Error('No header row found: the first 20 rows contain no Last Name column');
    err.code = 'no_header';
    err.first_rows = grid.slice(0, 3);
    throw err;
  }
  const rawHeaders = grid[hIdx];
  const keys = [];      // per column: key or null (dropped)
  const seen = new Map();
  const headers = [];
  for (let i = 0; i < rawHeaders.length; i++) {
    const raw = String(rawHeaders[i] || '').trim();
    if (!raw) { keys.push(null); continue; }
    let key = raw;
    const n = (seen.get(raw) || 0) + 1;
    seen.set(raw, n);
    if (n > 1) key = `${raw} (${n})`;
    keys.push(key);
    headers.push(key);
  }
  const rows = [];
  for (let r = hIdx + 1; r < grid.length; r++) {
    const cells = grid[r];
    if (!cells.some(c => String(c || '').trim() !== '')) continue;
    const rec = {};
    for (let i = 0; i < keys.length; i++) {
      if (!keys[i]) continue;
      rec[keys[i]] = i < cells.length ? String(cells[i] == null ? '' : cells[i]).trim() : '';
    }
    rows.push(rec);
  }
  return { headers, rows, warnings: [], header_row_index: hIdx };
}

/** Synchronous CSV path (text or bytes). */
function parseCsvBuffer(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer), 'utf8');
  return gridToRecords(csvToGrid(buf));
}

/** parseFile(buffer, filename) → { headers, rows, warnings, header_row_index } */
async function parseFile(buffer, filename) {
  if (!buffer || !buffer.length) {
    const err = new Error('Empty file');
    err.code = 'bad_file';
    throw err;
  }
  if (isXlsx(buffer, filename)) return gridToRecords(await xlsxToGrid(buffer));
  return parseCsvBuffer(buffer);
}

// ═══════════════════════════════════════════════════════════════════════════
// Stage 2 — column mapping
// ═══════════════════════════════════════════════════════════════════════════

/**
 * mapColumns(headers, { overrides, events, rows })
 *   → { map, unmapped, entry_columns, duplicates, ignored, fieldHeaders }
 *
 * overrides: { '<raw header>': '<field>' | 'ignore' } from the column step.
 * events:    the target meet's events (entry-column detection, Winfree
 *            method 1: a header equal to an event's import_code, name, or
 *            usss_code after normalisation). Omit for the athlete-only paths.
 * rows:      optional, used only to fill the unmapped sample values.
 */
function mapColumns(headers, opts = {}) {
  const overrides = opts.overrides || {};
  const events = opts.events || [];
  const rows = opts.rows || [];

  const eventKeys = new Map(); // normalised header → { import_code, event_ids }
  for (const ev of events) {
    for (const cand of [ev.import_code, ev.name, ev.usss_code]) {
      const n = normalizeHeader(cand);
      if (!n) continue;
      const cur = eventKeys.get(n) || { import_code: null, event_ids: [] };
      if (cand === ev.import_code) cur.import_code = String(ev.import_code).toUpperCase();
      if (!cur.event_ids.includes(ev.id)) cur.event_ids.push(ev.id);
      eventKeys.set(n, cur);
    }
  }

  const map = {};
  const fieldHeaders = {};
  const unmapped = [];
  const entry_columns = [];
  const ignored = [];

  const sampleFor = (h) => {
    for (const r of rows) {
      const v = r[h];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  };

  for (const h of headers) {
    const n = normalizeHeader(h);
    let field = null;
    if (Object.prototype.hasOwnProperty.call(overrides, h)) {
      const o = overrides[h];
      if (o === 'ignore' || o === '' || o == null) { ignored.push(h); continue; }
      if (FIELD_NAMES.includes(o)) field = o;
      else if (o === 'entry' && eventKeys.has(n)) field = null;
      else { ignored.push(h); continue; }
    }
    if (!field && !Object.prototype.hasOwnProperty.call(overrides, h)) {
      if (REVERSE.has(n)) field = REVERSE.get(n);
      else if (IGNORED_HEADERS.has(n) || /^j\d+$/.test(n)) { ignored.push(h); continue; }
    }
    if (field) {
      map[h] = field;
      (fieldHeaders[field] = fieldHeaders[field] || []).push(h);
      continue;
    }
    if (eventKeys.has(n)) {
      const ek = eventKeys.get(n);
      entry_columns.push({ header: h, import_code: ek.import_code, event_ids: ek.event_ids.slice(), event_id: ek.event_ids.length === 1 ? ek.event_ids[0] : null });
      continue;
    }
    unmapped.push({ header: h, sample: sampleFor(h) });
  }

  const duplicates = Object.entries(fieldHeaders)
    .filter(([, hs]) => hs.length > 1)
    .map(([field, hs]) => ({ field, headers: hs.slice() }));

  return { map, unmapped, entry_columns, duplicates, ignored, fieldHeaders };
}

// ═══════════════════════════════════════════════════════════════════════════
// Stage 2 — value rules
// ═══════════════════════════════════════════════════════════════════════════

function collapseWs(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

function parseGender(raw) {
  const v = collapseWs(raw);
  if (!v) return { value: '', warning: null };
  const c = v.charAt(0).toUpperCase();
  if (c === 'M' || c === 'F') return { value: c, warning: null };
  return { value: '', warning: 'bad_gender' };
}

/** First four-digit group between 1900 and the current year anywhere in the value. NEVER parseInt. */
function parseBirthYear(raw) {
  const v = collapseWs(raw);
  if (!v) return { value: null, warning: null };
  const max = new Date().getFullYear();
  const re = /(?<!\d)(\d{4})(?!\d)/g;
  let m;
  while ((m = re.exec(v))) {
    const y = parseInt(m[1], 10);
    if (y >= 1900 && y <= max) return { value: y, warning: null };
  }
  return { value: null, warning: 'bad_birth_year' };
}

/** Digits only after stripping spaces; empty unless 5–8 digits. */
function parseUssaNum(raw) {
  const v = String(raw == null ? '' : raw).replace(/\s+/g, '');
  if (!v) return { value: '', warning: null };
  // Excel sometimes hands "7002294.0"; a trailing ".0" is not a digit problem.
  const cleaned = v.replace(/\.0+$/, '');
  if (/^\d{5,8}$/.test(cleaned)) return { value: cleaned, warning: null };
  return { value: '', warning: 'bad_ussa_num' };
}

function parseBib(raw) {
  const v = collapseWs(raw);
  if (!v) return null;
  if (!/^\d+$/.test(v.replace(/\.0+$/, ''))) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * normalizeValues(fields) — fields is an object of canonical-field → raw
 * string. Returns typed values + row warnings. Shared by the meet importer
 * and the athlete-only wrappers (reconcileHelpers.normalizeRow).
 */
function normalizeValues(fields) {
  const get = (k) => collapseWs(fields[k]);
  const warnings = [];
  let first_name = get('first_name');
  let last_name = get('last_name');
  if (!first_name && last_name.includes(',')) {
    const i = last_name.indexOf(',');
    first_name = collapseWs(last_name.slice(i + 1));
    last_name = collapseWs(last_name.slice(0, i));
  }
  const g = parseGender(fields.gender);
  if (g.warning) warnings.push(g.warning);
  const by = parseBirthYear(fields.birth_year);
  if (by.warning) warnings.push(by.warning);
  const u = parseUssaNum(fields.ussa_num);
  if (u.warning) warnings.push(u.warning);
  const fis = get('fis_id').replace(/\.0+$/, '');
  return {
    first_name,
    last_name,
    gender: g.value,
    birth_year: by.value,
    ussa_num: u.value,
    fis_id: fis,
    nation: get('nation').toUpperCase(),
    club: get('club'),
    bib: parseBib(fields.bib),
    category: get('category'),
    events: get('events'),
    warnings,
  };
}

/** Pick each canonical field's raw value from a record: first non-empty header wins. */
function extractFields(record, fieldHeaders) {
  const out = {};
  for (const f of FIELD_NAMES) {
    out[f] = '';
    for (const h of (fieldHeaders[f] || [])) {
      const v = record[h];
      if (v != null && String(v).trim() !== '') { out[f] = String(v); break; }
    }
  }
  return out;
}

/** readRecord(record, mapping) → normalised values + which entry columns are ticked. */
function readRecord(record, mapping) {
  const values = normalizeValues(extractFields(record, mapping.fieldHeaders));
  values.entry_columns = [];
  for (const ec of mapping.entry_columns) {
    const v = record[ec.header];
    if (v != null && String(v).trim() !== '') values.entry_columns.push(ec);
  }
  return values;
}

// ═══════════════════════════════════════════════════════════════════════════
// Stage 3 — markers and resolution
// ═══════════════════════════════════════════════════════════════════════════

const NO_INFO_MARKER = '(no entry information)';

/** Longest-match-first, left-to-right tokeniser for a Winfree Events string. */
function tokenizeEvents(str, codes) {
  const list = [...new Set((codes || []).filter(Boolean).map(c => String(c).toUpperCase()))]
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
  const s = String(str == null ? '' : str).toUpperCase();
  const out = [];
  let i = 0;
  let remainder = null;
  while (i < s.length) {
    const ch = s[i];
    if (ch === ' ' || ch === ',' || ch === ';' || ch === '/' || ch === '\t') { i++; continue; }
    let hit = null;
    for (const c of list) {
      if (s.startsWith(c, i)) { hit = c; break; }
    }
    if (!hit) { remainder = s.slice(i).trim(); break; }
    if (!out.includes(hit)) out.push(hit);
    i += hit.length;
  }
  return { codes: out, remainder };
}

/** Category text → matching key: lower-case, strip *, collapse whitespace. */
function normalizeMarker(display) {
  return collapseWs(String(display == null ? '' : display).toLowerCase().replace(/\*/g, ''));
}

/**
 * Build the row's markers. Each: { marker_norm, marker_display, source,
 * code?, event_ids? }. `codes` are the meet's import codes for tokenising.
 */
function markersForRow(values, codes) {
  const out = [];
  const warnings = [];
  // A purely numeric "category" is never an event name (Winfree results
  // exports carry scores under an Event column).
  if (values.category && !/^[\d.\s-]+$/.test(values.category)) {
    out.push({ source: 'category', marker_display: collapseWs(values.category), marker_norm: normalizeMarker(values.category) });
  }
  if (values.events) {
    const t = tokenizeEvents(values.events, codes);
    for (const c of t.codes) out.push({ source: 'events', code: c, marker_display: `Events: ${c}`, marker_norm: `events:${c.toLowerCase()}` });
    if (t.remainder) warnings.push({ code: 'bad_events_code', detail: t.remainder });
  }
  for (const ec of (values.entry_columns || [])) {
    out.push({ source: 'column', code: ec.import_code, event_ids: ec.event_ids, marker_display: ec.header, marker_norm: `column:${normalizeHeader(ec.header)}` });
  }
  if (!out.length) out.push({ source: 'none', marker_display: NO_INFO_MARKER, marker_norm: NO_INFO_MARKER });
  return { markers: out, warnings };
}

const NOT_EVENT_RE = /\b(banquet|ticket|coach|official|judge|volunteer|fee|merch|donation|parent|spectator)/;
const GENDER_F_RE = /\b(women|womens|female|females|girls|girl|ladies|lady)\b/;
const GENDER_M_RE = /\b(men|mens|male|males|boys|boy)\b/;
const SERIES_WORDS = ['devo', 'rqs', 'comp', 'fis', 'invitational', 'championship'];
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const WEEKDAYS = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };

function genderWord(text) {
  const t = String(text || '').toLowerCase();
  if (GENDER_F_RE.test(t)) return 'F';
  if (GENDER_M_RE.test(t)) return 'M';
  return '';
}

function disciplineWord(text) {
  const t = String(text || '').toLowerCase();
  if (/\bduals?\b/.test(t) || /\bdual\s*mogul/.test(t) || /\bdm\b/.test(t)) return 'dual_mogul';
  if (/aerial/.test(t)) return 'aerials';
  if (/mogul/.test(t) || /\bsingles?\b/.test(t) || /\bmo\b/.test(t)) return 'mogul';
  return '';
}

/** Date / day cue in a marker: { month, day } | { weekday } | null. */
function dateCue(text) {
  const t = String(text || '').toLowerCase();
  let m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)[a-z]*\.?\s*(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (m && MONTHS[m[1]]) return { month: MONTHS[m[1]], day: parseInt(m[2], 10) };
  m = t.match(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?(?![\d/])/);
  if (m) return { month: parseInt(m[1], 10), day: parseInt(m[2], 10) };
  m = t.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|wed|thurs|thur|thu|fri|sat)\b/);
  if (m) return { weekday: WEEKDAYS[m[1]] };
  return null;
}

function eventMatchesCue(ev, cue) {
  if (!ev.event_date) return false;
  const m = String(ev.event_date).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (cue.weekday !== undefined) return new Date(Date.UTC(y, mo - 1, d)).getUTCDay() === cue.weekday;
  return mo === cue.month && d === cue.day;
}

function seriesWords(text) {
  const t = String(text || '').toLowerCase();
  return SERIES_WORDS.filter(w => new RegExp(`\\b${w}`).test(t));
}

/**
 * resolveMarker(marker, gender, events, opts) → {
 *   resolution: { event_id } | null, reason, candidates: [event_id],
 *   marker_gender: 'M'|'F'|'' (gender word found in the marker text)
 * }
 * `gender` is the row's gender ('M' | 'F' | ''). opts.saved is a lookup
 * (marker_norm, gender) → { event_id }; opts.target_event_id enables David's
 * ruling for the per-event button (a file with no entry information
 * registers its matching-gender rows straight into that event).
 */
function resolveMarker(marker, gender, events, opts = {}) {
  const saved = opts.saved || null;
  const gw = marker.source === 'category' ? genderWord(marker.marker_display) : '';
  const base = { marker_gender: gw, candidates: [] };
  const ok = (event_id, reason) => ({ ...base, resolution: { event_id }, reason });
  const un = (reason, candidates = []) => ({ ...base, resolution: null, reason, candidates });

  // Saved mapping overrides everything (gender-specific first, then "both").
  if (saved) {
    const hit = saved.get(`${marker.marker_norm}|${gender || ''}`) || saved.get(`${marker.marker_norm}|`);
    if (hit) return ok(hit.event_id, hit.event_id ? 'saved' : 'not_an_event');
  }

  // Rule 1 — not an event (category text only).
  if (marker.source === 'category' && NOT_EVENT_RE.test(marker.marker_norm)) return ok(null, 'not_an_event');

  // Rule 2 — gender: the row's, else a gender word in the marker.
  const g = gender || gw;
  if (!g) return un('no_gender');

  // Rule 8 — synthetic marker.
  if (marker.source === 'none') {
    const target = opts.target_event_id ? events.find(e => e.id === opts.target_event_id) : null;
    if (target) {
      if (target.gender === g) return ok(target.id, 'default_event');
      return ok(null, 'other_gender');
    }
    const ofGender = events.filter(e => e.gender === g);
    const byDisc = {};
    for (const e of ofGender) (byDisc[e.discipline] = byDisc[e.discipline] || []).push(e);
    if (Object.values(byDisc).some(l => l.length > 1)) return un('ambiguous', ofGender.map(e => e.id));
    const cands = ofGender;
    if (!cands.length) return un('no_event');
    if (cands.length === 1) return ok(cands[0].id, 'rules');
    return un('ambiguous', cands.map(e => e.id));
  }

  // Rules 3–4 — discipline and candidates.
  let cands;
  if (marker.source === 'events' || marker.source === 'column') {
    const code = String(marker.code || '').toUpperCase();
    if (code) {
      cands = events.filter(e => e.gender === g && String(e.import_code || '').toUpperCase() === code);
    } else {
      cands = events.filter(e => e.gender === g && (marker.event_ids || []).includes(e.id));
    }
  } else {
    const disc = disciplineWord(marker.marker_display);
    if (!disc) return un('no_discipline');
    cands = events.filter(e => e.gender === g && e.discipline === disc);
  }
  if (!cands.length) return un('no_event');
  if (cands.length === 1) return ok(cands[0].id, 'rules');

  // Rule 5 — date / day cue. Only when at least one candidate carries an
  // event_date: a meet whose events have no dates cannot mismatch a cue.
  const cue = marker.source === 'category' ? dateCue(marker.marker_display) : null;
  if (cue && cands.some(e => e.event_date)) {
    const hit = cands.filter(e => eventMatchesCue(e, cue));
    if (hit.length === 1) return ok(hit[0].id, 'rules');
    if (hit.length === 0) return un('date_mismatch', cands.map(e => e.id));
    cands = hit;
  }

  // Rule 6 — series word against candidate names.
  const words = marker.source === 'category' ? seriesWords(marker.marker_display) : [];
  if (words.length) {
    const hit = cands.filter(e => words.some(w => String(e.name || '').toLowerCase().includes(w)));
    if (hit.length === 1) return ok(hit[0].id, 'rules');
    if (hit.length > 1) cands = hit;
  }

  // Rule 7.
  if (cands.length === 1) return ok(cands[0].id, 'rules');
  return un('ambiguous', cands.map(e => e.id));
}

// ═══════════════════════════════════════════════════════════════════════════
// Stage 4 — identity (USSS People File + athletes indexes)
// ═══════════════════════════════════════════════════════════════════════════

function buildPeopleIndex(people) {
  const byName = new Map();
  const byId = new Map();
  for (const p of people || []) {
    if (!p) continue;
    const t = String(p.type || '').toUpperCase();
    if (t !== 'C' && t !== 'CO') continue;
    const key = `${normalizeName(p.last_name)}|${normalizeName(p.first_name)}`;
    (byName.get(key) || byName.set(key, []).get(key)).push(p);
    if (p.ussa_id) byId.set(String(p.ussa_id).trim(), p);
  }
  return { byName, byId, count: byId.size };
}

function clubWords(s) {
  return new Set(String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z]+/).filter(w => w.length >= 4));
}

/**
 * lookupUsssPerson(index, values) → { person, ambiguous: [..] | null }
 * By ussa_num when the row has one; else by normalised name, then gender,
 * then a shared club word (4+ letters).
 */
function lookupUsssPerson(index, values) {
  if (!index || !index.count) return { person: null, ambiguous: null };
  if (values.ussa_num) {
    const p = index.byId.get(values.ussa_num);
    return { person: p || null, ambiguous: null };
  }
  const key = `${normalizeName(values.last_name)}|${normalizeName(values.first_name)}`;
  if (!normalizeName(values.last_name) || !normalizeName(values.first_name)) return { person: null, ambiguous: null };
  let cands = index.byName.get(key) || [];
  if (cands.length > 1 && values.gender) {
    const g = cands.filter(p => String(p.gender || '').toUpperCase().charAt(0) === values.gender);
    if (g.length) cands = g;
  }
  if (cands.length > 1 && values.club) {
    const words = clubWords(values.club);
    const c = cands.filter(p => { const w = clubWords(p.club_name); for (const x of words) if (w.has(x)) return true; return false; });
    if (c.length) cands = c;
  }
  if (cands.length === 1) return { person: cands[0], ambiguous: null };
  if (cands.length > 1) return { person: null, ambiguous: cands };
  return { person: null, ambiguous: null };
}

/** Fill blank identity fields of `values` from a USSS People File record. Returns the fields filled. */
function enrichFromPerson(values, person) {
  const filled = [];
  if (person.ussa_id && !values.ussa_num) { values.ussa_num = String(person.ussa_id).trim(); filled.push('ussa_num'); }
  if (person.yob && !values.birth_year) { values.birth_year = parseInt(person.yob, 10) || null; if (values.birth_year) filled.push('birth_year'); }
  if (person.club_name && !values.club) { values.club = String(person.club_name).trim(); filled.push('club'); }
  if (person.fis_id && !values.fis_id) { values.fis_id = String(person.fis_id).trim(); filled.push('fis_id'); }
  if (person.division && !values.division) { values.division = String(person.division).trim(); filled.push('division'); }
  if (person.gender && !values.gender) { const g = String(person.gender).toUpperCase().charAt(0); if (g === 'M' || g === 'F') { values.gender = g; filled.push('gender'); } }
  return filled;
}

function buildAthleteIndex(athletes) {
  const byUssa = new Map(), byFis = new Map(), byName = new Map();
  for (const a of athletes || []) {
    if (a.ussa_num && String(a.ussa_num).trim()) byUssa.set(String(a.ussa_num).trim(), a);
    if (a.fis_id && String(a.fis_id).trim()) byFis.set(String(a.fis_id).trim(), a);
    const k = `${normalizeName(a.last_name)}|${normalizeName(a.first_name)}`;
    (byName.get(k) || byName.set(k, []).get(k)).push(a);
  }
  return { byUssa, byFis, byName };
}

/**
 * resolveIdentity(values, athleteIndex, peopleIndex) — the five steps of
 * section 5.3. Mutates `values` with People File enrichment. Returns
 * { athlete, source, flags: [], usss_candidates }.
 */
function resolveIdentity(values, ai, pi) {
  const flags = [];
  let usss_candidates = null;
  let peopleHit = false;

  // 1. athletes by USSS #
  if (values.ussa_num && ai.byUssa.has(values.ussa_num)) {
    const p = pi && pi.byId.get(values.ussa_num);
    if (p) enrichFromPerson(values, p);
    return { athlete: ai.byUssa.get(values.ussa_num), source: 'ussa', flags, usss_candidates };
  }
  // 2. athletes by FIS id
  if (values.fis_id && ai.byFis.has(values.fis_id)) {
    return { athlete: ai.byFis.get(values.fis_id), source: 'fis', flags, usss_candidates };
  }
  // 3. USSS People File
  if (pi && pi.count) {
    const { person, ambiguous } = lookupUsssPerson(pi, values);
    if (person) {
      enrichFromPerson(values, person);
      peopleHit = true;
      if (values.ussa_num && ai.byUssa.has(values.ussa_num)) {
        return { athlete: ai.byUssa.get(values.ussa_num), source: 'usss_people', flags, usss_candidates };
      }
      if (values.fis_id && ai.byFis.has(values.fis_id)) {
        return { athlete: ai.byFis.get(values.fis_id), source: 'usss_people', flags, usss_candidates };
      }
    } else if (ambiguous) {
      flags.push('ambiguous_usss');
      usss_candidates = ambiguous.map(p => ({ ussa_id: p.ussa_id, first_name: p.first_name, last_name: p.last_name, gender: p.gender, yob: p.yob, club_name: p.club_name }));
    }
  }
  // 4. athletes by name (+ birth year when known)
  const k = `${normalizeName(values.last_name)}|${normalizeName(values.first_name)}`;
  let cands = (normalizeName(values.last_name) && normalizeName(values.first_name)) ? (ai.byName.get(k) || []) : [];
  if (cands.length > 1 && values.birth_year) {
    const by = cands.filter(a => a.birth_year == null || parseInt(a.birth_year, 10) === values.birth_year);
    if (by.length) cands = by;
  }
  if (cands.length) {
    const live = cands.find(a => !a.deleted_at) || cands[0];
    return { athlete: live, source: peopleHit ? 'usss_people' : 'athletes', flags, usss_candidates };
  }
  // 5. new
  if (!values.ussa_num) flags.push('no_usss_match');
  return { athlete: null, source: peopleHit ? 'usss_people' : 'new', flags, usss_candidates };
}

// ═══════════════════════════════════════════════════════════════════════════
// Stage 5 — preview / commit (DB-aware)
// ═══════════════════════════════════════════════════════════════════════════

const NON_BLOCKING_REASONS = new Set(['not_an_event', 'other_gender']);

function personNameKey(v) {
  return `${normalizeName(v.last_name)}|${normalizeName(v.first_name)}`;
}

/** Group parsed rows into people (section 5.3 person key) and merge their fields. */
function groupPeople(rowValues) {
  const groups = new Map(); // key → person
  const nameToUssa = new Map(); // nameKey → Set(ussa)

  const add = (key, v) => {
    let p = groups.get(key);
    if (!p) {
      p = {
        key, rows: [], first_name: '', last_name: '', gender: '', birth_year: null, ussa_num: '', fis_id: '',
        club: '', nation: '', division: '', bib: null, markers: [], warnings: new Set(), row_numbers: [],
      };
      groups.set(key, p);
    }
    p.rows.push(v);
    p.row_numbers.push(v.row_number);
    if (!p.first_name && v.first_name) p.first_name = v.first_name;
    if (!p.last_name && v.last_name) p.last_name = v.last_name;
    if (!p.gender && v.gender) p.gender = v.gender;
    if (p.birth_year == null && v.birth_year != null) p.birth_year = v.birth_year;
    if (!p.ussa_num && v.ussa_num) p.ussa_num = v.ussa_num;
    if (!p.fis_id && v.fis_id) p.fis_id = v.fis_id;
    if (!p.club && v.club) p.club = v.club;
    if (!p.nation && v.nation) p.nation = v.nation;
    if (p.bib == null && v.bib != null) p.bib = v.bib;
    for (const w of v.warnings) p.warnings.add(typeof w === 'string' ? w : w.code);
    for (const m of v.markers) {
      if (!p.markers.some(x => x.marker_norm === m.marker_norm)) p.markers.push(m);
    }
  };

  // First pass: numbered rows by number, checking for two names under one number.
  const namesByUssa = new Map();
  for (const v of rowValues) {
    if (v.ussa_num) (namesByUssa.get(v.ussa_num) || namesByUssa.set(v.ussa_num, new Set()).get(v.ussa_num)).add(personNameKey(v));
  }
  for (const v of rowValues) {
    const nk = personNameKey(v);
    if (v.ussa_num) {
      const names = namesByUssa.get(v.ussa_num);
      const key = names.size > 1 ? `u:${v.ussa_num}|${nk}` : `u:${v.ussa_num}`;
      add(key, v);
      if (names.size > 1) groups.get(key).warnings.add('duplicate_ussa_num');
      (nameToUssa.get(nk) || nameToUssa.set(nk, new Set()).get(nk)).add(v.ussa_num);
    }
  }
  // Second pass: name-only rows join a single numbered group of the same name, else their own group.
  for (const v of rowValues) {
    if (v.ussa_num) continue;
    const nk = personNameKey(v);
    const nums = nameToUssa.get(nk);
    if (nums && nums.size === 1) {
      const u = [...nums][0];
      const names = namesByUssa.get(u);
      add(names.size > 1 ? `u:${u}|${nk}` : `u:${u}`, v);
    } else {
      add(`n:${nk}`, v);
    }
  }
  // One name under two numbers → both flagged.
  for (const [nk, nums] of nameToUssa) {
    if (nums.size > 1 && nk !== '|') {
      for (const u of nums) {
        const names = namesByUssa.get(u);
        const key = names.size > 1 ? `u:${u}|${nk}` : `u:${u}`;
        const p = groups.get(key);
        if (p) p.warnings.add('duplicate_ussa_num');
      }
    }
  }
  return [...groups.values()];
}

function sha256(...parts) {
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(Buffer.isBuffer(p) ? p : String(p));
  return h.digest('hex');
}

/**
 * Load everything the preview needs from the database in one pass.
 * db: { queryAll, queryOne } (server/db/schema). meet: the meets row.
 */
async function loadContext(db, meet) {
  const events = await db.queryAll(
    'SELECT id, name, gender, discipline, import_code, event_date, usss_code FROM events WHERE meet_id = ? ORDER BY event_date, created_at',
    [meet.id]
  );
  const eventIds = events.map(e => e.id);
  let registrations = [];
  if (eventIds.length) {
    const ph = eventIds.map(() => '?').join(',');
    registrations = await db.queryAll(`SELECT id, event_id, athlete_id, bib_number FROM registrations WHERE event_id IN (${ph})`, eventIds);
  }
  const athletes = await db.queryAll('SELECT id, ussa_num, fis_id, first_name, last_name, gender, birth_year, club, division, deleted_at FROM athletes');
  let people = [];
  try {
    people = await db.queryAll("SELECT ussa_id, type, last_name, first_name, division, gender, yob, club_name, fis_id FROM usss_people WHERE type IN ('C','CO')");
  } catch (_) { people = []; }
  let savedRows = [];
  try {
    savedRows = await db.queryAll('SELECT marker_norm, marker_display, gender, event_id FROM meet_import_map WHERE meet_id = ?', [meet.id]);
  } catch (_) { savedRows = []; }
  return { meet, events, registrations, athletes, people, savedRows };
}

/**
 * previewImport(ctx, file, opts) → the response of section 5.2 (pure given ctx).
 *   file: { buffer, filename }
 *   opts: { event_id, column_overrides, mapping, include_flagged }
 */
async function previewImport(ctx, file, opts = {}) {
  const { meet, events } = ctx;
  const event_id = opts.event_id || null;
  if (event_id && !events.some(e => e.id === event_id)) {
    const err = new Error('event_id does not belong to this meet');
    err.code = 'bad_event';
    err.httpCode = 400;
    throw err;
  }
  const column_overrides = opts.column_overrides || {};
  const clientMapping = Array.isArray(opts.mapping) ? opts.mapping : [];
  const include_flagged = new Set(Array.isArray(opts.include_flagged) ? opts.include_flagged : []);

  const parsed = await parseFile(file.buffer, file.filename);
  const mapping = mapColumns(parsed.headers, { overrides: column_overrides, events, rows: parsed.rows });
  const codes = events.map(e => e.import_code).filter(Boolean);

  // Saved map: DB rows, then the client's confirmed table on top.
  const saved = new Map();
  for (const r of ctx.savedRows) saved.set(`${r.marker_norm}|${r.gender || ''}`, { event_id: r.event_id || null, display: r.marker_display });
  for (const r of clientMapping) {
    if (!r || !r.marker_norm) continue;
    saved.set(`${r.marker_norm}|${r.gender || ''}`, { event_id: r.event_id || null });
  }

  // Rows → values + markers.
  const rowValues = [];
  parsed.rows.forEach((rec, i) => {
    const v = readRecord(rec, mapping);
    v.row_number = parsed.header_row_index + 2 + i; // 1-based line in the file
    if (!v.first_name && !v.last_name && !v.ussa_num) return; // nothing to read
    // A row without any name cannot be registered — no markers, just the flag.
    const mk = (v.first_name || v.last_name) ? markersForRow(v, codes) : { markers: [], warnings: [] };
    v.markers = mk.markers;
    v.warnings = v.warnings.concat(mk.warnings.map(w => w.code));
    rowValues.push(v);
  });

  const people = groupPeople(rowValues);

  // Resolve every distinct (marker, gender) pair once.
  const resCache = new Map();
  const markerStats = new Map(); // norm|gender → { marker, gender, count, res }
  const resolveFor = (marker, gender) => {
    const k = `${marker.marker_norm}|${gender || ''}`;
    if (!resCache.has(k)) resCache.set(k, resolveMarker(marker, gender, events, { saved, target_event_id: event_id }));
    return resCache.get(k);
  };

  const ai = buildAthleteIndex(ctx.athletes);
  const pi = buildPeopleIndex(ctx.people);
  const regSet = new Map();
  for (const r of ctx.registrations) regSet.set(`${r.event_id}|${r.athlete_id}`, r);

  const evById = new Map(events.map(e => [e.id, e]));
  const perEvent = new Map(events.map(e => [e.id, { event_id: e.id, name: e.name, gender: e.gender, discipline: e.discipline, import_code: e.import_code || null, event_date: e.event_date || null, to_register: 0, already_registered: 0, flagged: 0, not_in_this_event: 0 }]));

  const out = { to_register: [], already_registered: [], not_in_this_event: [], needs_attention: [], not_an_event: 0 };
  const flaggedKeys = [];

  for (const p of people) {
    const flags = new Set([...p.warnings].filter(w => ['bad_ussa_num', 'bad_birth_year', 'duplicate_ussa_num', 'bad_events_code', 'bad_gender'].includes(w)));
    if (!p.last_name && !p.first_name) flags.add('no_name');

    // Markers → events.
    const resolvedEvents = new Set();
    let unresolved = false;
    let notEventOnly = true;
    let genderFromMarker = '';
    for (const m of p.markers) {
      const r = resolveFor(m, p.gender);
      const key = `${m.marker_norm}|${p.gender || ''}`;
      const st = markerStats.get(key) || markerStats.set(key, { marker: m, gender: p.gender || '', count: 0, res: r }).get(key);
      st.count++;
      if (p.gender && r.marker_gender && r.marker_gender !== p.gender) flags.add('gender_conflict');
      if (!p.gender && r.marker_gender && !genderFromMarker) genderFromMarker = r.marker_gender;
      if (r.resolution) {
        if (r.resolution.event_id) { resolvedEvents.add(r.resolution.event_id); notEventOnly = false; }
      } else {
        unresolved = true; notEventOnly = false;
        if (r.reason === 'no_gender') flags.add('no_gender');
      }
    }
    if (!p.gender && genderFromMarker) p.gender = genderFromMarker;
    if (unresolved) flags.add('unresolved_marker');

    // Identity.
    const values = { first_name: p.first_name, last_name: p.last_name, gender: p.gender, birth_year: p.birth_year, ussa_num: p.ussa_num, fis_id: p.fis_id, club: p.club, division: p.division, nation: p.nation };
    const idr = (p.last_name || p.first_name) ? resolveIdentity(values, ai, pi) : { athlete: null, source: 'new', flags: [], usss_candidates: null };
    for (const f of idr.flags) flags.add(f);
    Object.assign(p, { gender: values.gender, birth_year: values.birth_year, ussa_num: values.ussa_num, fis_id: values.fis_id, club: values.club, division: values.division });

    const targetEvents = event_id ? [...resolvedEvents].filter(id => id === event_id) : [...resolvedEvents];
    const outsideEvents = event_id ? [...resolvedEvents].filter(id => id !== event_id) : [];
    const events_new = [], events_existing = [];
    for (const id of targetEvents) {
      if (idr.athlete && regSet.has(`${id}|${idr.athlete.id}`)) events_existing.push(id); else events_new.push(id);
    }

    const row = {
      key: p.key, first_name: p.first_name, last_name: p.last_name, gender: p.gender || null, birth_year: p.birth_year,
      ussa_num: p.ussa_num || null, fis_id: p.fis_id || null, club: p.club || null, division: p.division || null, bib: p.bib,
      source: idr.source, athlete_id: idr.athlete ? idr.athlete.id : null,
      events: events_new, already_in: events_existing, other_events: outsideEvents,
      markers: p.markers.map(m => m.marker_display), rows: p.row_numbers,
    };
    if (idr.usss_candidates) row.usss_candidates = idr.usss_candidates;

    // Identity conflicts inside the file matter even for people already registered.
    const relevant = events_new.length > 0 || unresolved || flags.has('duplicate_ussa_num') || flags.has('ambiguous_usss') || flags.has('bad_events_code');
    if (flags.size && relevant) {
      row.flags = [...flags];
      out.needs_attention.push(row);
      flaggedKeys.push(p.key);
      for (const id of events_new) perEvent.get(id).flagged++;
      for (const id of events_existing) perEvent.get(id).already_registered++;
      continue;
    }
    if (events_new.length) {
      out.to_register.push(row);
      for (const id of events_new) perEvent.get(id).to_register++;
      for (const id of events_existing) perEvent.get(id).already_registered++;
      continue;
    }
    if (events_existing.length) {
      out.already_registered.push(row);
      for (const id of events_existing) perEvent.get(id).already_registered++;
      continue;
    }
    if (outsideEvents.length || (event_id && p.markers.some(m => resolveFor(m, p.gender).reason === 'other_gender'))) {
      out.not_in_this_event.push(row);
      for (const id of outsideEvents) if (perEvent.has(id)) perEvent.get(id).not_in_this_event++;
      continue;
    }
    if (notEventOnly) out.not_an_event++;
  }

  // Marker table (every distinct marker, resolved ones too).
  const markers = [...markerStats.values()].map(({ marker, gender, count, res }) => ({
    marker_norm: marker.marker_norm,
    marker_display: marker.marker_display,
    source: marker.source,
    gender: gender || null,
    count,
    resolution: res.resolution,
    reason: res.reason,
    candidates: res.candidates || [],
  })).sort((a, b) => (a.marker_display.localeCompare(b.marker_display)) || String(a.gender).localeCompare(String(b.gender)));

  const needs_mapping = markers.some(m => m.resolution === null && !NON_BLOCKING_REASONS.has(m.reason));

  const preview_token = sha256(file.buffer, '|', JSON.stringify(clientMapping), '|', JSON.stringify(column_overrides), '|', event_id || '');

  // Which flagged rows the operator has ticked (echo for the commit).
  const included = flaggedKeys.filter(k => include_flagged.has(k));

  return {
    meet_id: meet.id,
    file_name: file.filename || null,
    rows_read: rowValues.length,
    header_row_index: parsed.header_row_index,
    columns: {
      map: mapping.map,
      unmapped: mapping.unmapped,
      entry_columns: mapping.entry_columns.map(ec => ({ header: ec.header, import_code: ec.import_code, event_id: ec.event_id, event_ids: ec.event_ids })),
      duplicates: mapping.duplicates,
      headers: parsed.headers,
    },
    markers,
    needs_mapping,
    event_id,
    events: [...perEvent.values()],
    athletes: out,
    people_count: people.length,
    usss_people_loaded: !!(pi && pi.count),
    preview_token,
    include_flagged: included,
    _people: people, // internal (stripped before responding)
    _evById: evById,
  };
}

/** Strip internals before sending a preview to the client. */
function publicPreview(p) {
  const { _people, _evById, ...rest } = p;
  return rest;
}

/**
 * commitImport(db, ctx, file, opts) — re-runs the preview from the file, then
 * writes. opts.preview_token must equal the recomputed token (409 otherwise);
 * needs_mapping must be false (400). Returns the preview + commit fields.
 * db: { queryAll, queryOne, execute, uuidv4 }; helpers: { logAudit,
 * lockedAthleteIds: Set }.
 */
async function commitImport(db, ctx, file, opts = {}, helpers = {}) {
  const preview = await previewImport(ctx, file, opts);
  if (preview.needs_mapping) {
    const err = new Error('Some entry markers are not mapped to an event yet');
    err.code = 'mapping_required';
    err.httpCode = 400;
    throw err;
  }
  if (opts.preview_token && opts.preview_token !== preview.preview_token) {
    const err = new Error('The file or mapping changed since the preview — analyze again');
    err.code = 'preview_changed';
    err.httpCode = 409;
    throw err;
  }
  const include = new Set(preview.include_flagged);
  const locked = helpers.lockedAthleteIds || new Set();
  const inserted = { registrations: 0, athletes_created: 0, athletes_updated: 0 };

  const rows = [
    ...preview.athletes.to_register,
    ...preview.athletes.needs_attention.filter(r => include.has(r.key) && !(r.flags || []).includes('no_name')),
  ];

  for (const r of rows) {
    if (!r.events.length) continue;
    let athleteId = r.athlete_id;
    if (athleteId) {
      const existing = ctx.athletes.find(a => a.id === athleteId);
      const updates = [], params = [];
      if (existing) {
        if (!existing.ussa_num && r.ussa_num) { updates.push('ussa_num=?'); params.push(r.ussa_num); }
        if (!existing.fis_id && r.fis_id) { updates.push('fis_id=?'); params.push(r.fis_id); }
        if (existing.birth_year == null && r.birth_year) { updates.push('birth_year=?'); params.push(r.birth_year); }
        if (!existing.gender && r.gender) { updates.push('gender=?'); params.push(r.gender); }
        if (!existing.club && r.club) { updates.push('club=?'); params.push(r.club); }
        if (!existing.division && r.division) { updates.push('division=?'); params.push(r.division); }
        if (existing.deleted_at) updates.push('deleted_at=NULL');
      }
      if (updates.length && !locked.has(athleteId)) {
        updates.push("updated_at=datetime('now')");
        params.push(athleteId);
        await db.execute(`UPDATE athletes SET ${updates.join(', ')} WHERE id=?`, params);
        inserted.athletes_updated++;
      }
    } else {
      athleteId = db.uuidv4();
      await db.execute(
        `INSERT INTO athletes (id, ussa_num, fis_id, first_name, last_name, birth_year, gender, club, division, nation)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [athleteId, r.ussa_num || null, r.fis_id || null, r.first_name, r.last_name, r.birth_year || null, r.gender || null, r.club || null, r.division || null, null]
      );
      inserted.athletes_created++;
      // A second person in the same file could match this new row by name.
      ctx.athletes.push({ id: athleteId, ussa_num: r.ussa_num || null, fis_id: r.fis_id || null, first_name: r.first_name, last_name: r.last_name, gender: r.gender || null, birth_year: r.birth_year || null, club: r.club || null, division: r.division || null, deleted_at: null });
    }
    for (const eventId of r.events) {
      const dup = await db.queryOne('SELECT id FROM registrations WHERE event_id=? AND athlete_id=?', [eventId, athleteId]);
      if (dup) continue;
      await db.execute(
        `INSERT INTO registrations (id, event_id, athlete_id, bib_number, seed) VALUES (?, ?, ?, ?, NULL)`,
        [db.uuidv4(), eventId, athleteId, r.bib != null ? r.bib : null]
      );
      inserted.registrations++;
    }
  }

  // Save the confirmed mapping table.
  let mapping_saved = 0;
  for (const m of (Array.isArray(opts.mapping) ? opts.mapping : [])) {
    if (!m || !m.marker_norm) continue;
    const gender = m.gender ? String(m.gender).toUpperCase().charAt(0) : null;
    const eventId = m.event_id || null;
    if (eventId && !preview._evById.has(eventId)) continue;
    const display = m.marker_display || preview.markers.find(x => x.marker_norm === m.marker_norm)?.marker_display || m.marker_norm;
    const ex = await db.queryOne(
      'SELECT id FROM meet_import_map WHERE meet_id=? AND marker_norm=? AND gender IS ?',
      [ctx.meet.id, m.marker_norm, gender]
    );
    if (ex) {
      await db.execute("UPDATE meet_import_map SET event_id=?, marker_display=?, updated_at=datetime('now') WHERE id=?", [eventId, display, ex.id]);
    } else {
      await db.execute('INSERT INTO meet_import_map (id, meet_id, marker_norm, marker_display, gender, event_id) VALUES (?, ?, ?, ?, ?, ?)',
        [db.uuidv4(), ctx.meet.id, m.marker_norm, display, gender, eventId]);
    }
    mapping_saved++;
  }

  if (helpers.logAudit) {
    try {
      await helpers.logAudit('import', 'registrations', ctx.meet.id, null, {
        file_name: file.filename || null, event_id: opts.event_id || null, rows_read: preview.rows_read,
        ...inserted, mapping_saved,
        mapping: (Array.isArray(opts.mapping) ? opts.mapping : []).map(m => ({ marker_norm: m.marker_norm, gender: m.gender || null, event_id: m.event_id || null })),
        include_flagged: preview.include_flagged,
      });
    } catch (_) {}
  }

  return { ...publicPreview(preview), committed: true, inserted, mapping_saved };
}

module.exports = {
  // stage 1–2
  SYNONYMS, IGNORED_HEADERS, FIELD_NAMES, normalizeHeader, normalizeName,
  parseFile, parseCsvBuffer, findHeaderRow, mapColumns, extractFields, normalizeValues, readRecord,
  parseGender, parseBirthYear, parseUssaNum, parseBib,
  // stage 3
  NO_INFO_MARKER, tokenizeEvents, normalizeMarker, markersForRow, resolveMarker, dateCue, genderWord, disciplineWord,
  // stage 4
  buildPeopleIndex, lookupUsssPerson, enrichFromPerson, buildAthleteIndex, resolveIdentity,
  // stage 5
  loadContext, previewImport, publicPreview, commitImport, groupPeople,
};
