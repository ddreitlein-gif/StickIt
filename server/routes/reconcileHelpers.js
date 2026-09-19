// ---------------------------------------------------------------------------
// Shared CSV parsing helpers used by import.js and athletes.js (reconcile).
//
// v2.7.00: thin wrappers over server/import/registrationImport.js (the one
// parser + header synonym table + value rules for every registration file).
// Same exported names and row shapes as before so no caller breaks:
//   parseCSV(text|buffer, filename?) → { headers, rows }
//     rows are keyed by canonical field (last_name, first_name, gender,
//     birth_year, ussa_num, fis_id, club, nation, bib, category, events) with
//     any unmapped column also present under its normalised header.
//   normalizeRow(row) → typed values (same keys as v2.6.03 + category/events)
//   SYNONYMS → the canonical-field synonym table
//   parseFileAsync(buffer, filename) → XLSX-aware variant of parseCSV
// ---------------------------------------------------------------------------

const R = require('../import/registrationImport');

function toRows(parsed) {
  const mapping = R.mapColumns(parsed.headers, {});
  const rows = parsed.rows.map(rec => {
    const fields = R.extractFields(rec, mapping.fieldHeaders);
    const row = {};
    for (const [k, v] of Object.entries(fields)) if (v !== '') row[k] = v;
    for (const f of R.FIELD_NAMES) if (row[f] === undefined) row[f] = '';
    for (const h of parsed.headers) {
      if (mapping.map[h]) continue;
      const n = R.normalizeHeader(h);
      if (n && row[n] === undefined) row[n] = rec[h] == null ? '' : String(rec[h]);
    }
    return row;
  });
  return { headers: parsed.headers, rows, header_row_index: parsed.header_row_index, mapping };
}

function parseCSV(text, filename) {
  let parsed;
  try {
    parsed = R.parseCsvBuffer(Buffer.isBuffer(text) ? text : Buffer.from(String(text || ''), 'utf8'));
  } catch (e) {
    if (e && e.code === 'no_header') return { headers: [], rows: [], error: e.message };
    throw e;
  }
  return toRows(parsed);
}

async function parseFileAsync(buffer, filename) {
  let parsed;
  try {
    parsed = await R.parseFile(buffer, filename);
  } catch (e) {
    if (e && e.code === 'no_header') return { headers: [], rows: [], error: e.message };
    throw e;
  }
  return toRows(parsed);
}

function normalizeRow(row) {
  const v = R.normalizeValues(row || {});
  return {
    first_name: v.first_name,
    last_name:  v.last_name,
    ussa_num:   v.ussa_num,
    fis_id:     v.fis_id,
    nation:     v.nation,
    club:       v.club,
    gender:     v.gender,
    birth_year: v.birth_year,
    bib:        v.bib == null ? '' : String(v.bib),
    category:   v.category,
    events:     v.events,
    warnings:   v.warnings,
  };
}

module.exports = { parseCSV, parseFileAsync, normalizeRow, SYNONYMS: R.SYNONYMS };
