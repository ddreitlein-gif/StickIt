#!/usr/bin/env node
/**
 * Synthetic registration fixtures for harness/tests/v270.test.js.
 *
 * Every sample family in ~/Desktop/Scoring Server/Sample Registration Data
 * is reproduced here with its EXACT header line and quirks, but with invented
 * people (the real files hold minors' names and USSS numbers and must never
 * be committed — the repository is public). Run once to (re)generate:
 *
 *   node harness/fixtures/registration/build_fixtures.js
 *
 * The generated files are committed beside this script.
 */
const fs = require('fs');
const path = require('path');

const OUT = __dirname;
const SERVER_DIR = path.resolve(__dirname, '../../../server');

// Invented people — first/last/gender/born/ussa/club. USSS numbers 9900xxxx are
// reserved for fixtures (the harness seeds usss_people with the same people).
const PEOPLE = [
  ['Anders', 'Cole', 'M', 2010, '9900001', 'Harness Springs Winter Sports'],
  ['Atherly', 'Chase', 'M', 2009, '9900002', 'Team Harness Colorado'],
  ['Balloon', 'Asher', 'M', 2011, '9900003', 'Harness Park Freestyle Team'],
  ['Brownlee', 'Abe', 'M', 2011, '9900004', 'Harness Springs Winter Sports'],
  ['Crumble', 'Owen', 'M', 2008, '9900005', 'Harness Park Competition Center'],
  ['Dorsey', 'Liam', 'M', 2012, '9900006', 'Aspen Harness Ski Club'],
  ['Eckhart', 'Noah', 'M', 2007, '9900007', 'Team Harness Colorado'],
  ['Fenwick', 'Mason', 'M', 2010, '9900008', 'Ski and Snowboard Club Harness'],
  ['Agee-Test', 'Arabella', 'F', 2009, '9900101', 'Ski and Snowboard Club Harness'],
  ['Bellamy', 'Quinn', 'F', 2011, '9900102', 'Harness Springs Winter Sports'],
  ['Carrick', 'Mia', 'F', 2010, '9900103', 'Aspen Harness Ski Club'],
  ['Dunmore', 'Alivia', 'F', 2012, '9900104', 'Harness Park Freestyle Team'],
  ['Estrella', 'Lenna', 'F', 2008, '9900105', 'Team Harness Colorado'],
  ['Fairweather', 'Sloane', 'F', 2009, '9900106', 'Harness Park Competition Center'],
];
// Two people who share a name (resolved by gender, then club word).
const TWINS = [
  ['SameName', 'Jordan', 'M', 2010, '9900201', 'Harness Springs Winter Sports'],
  ['SameName', 'Jordan', 'F', 2011, '9900202', 'Aspen Harness Ski Club'],
  ['Sameclub', 'Taylor', 'M', 2009, '9900203', 'Harness Springs Winter Sports'],
  ['Sameclub', 'Taylor', 'M', 2012, '9900204', 'Team Summit Colorado'],
];
// Not in the People File at all.
const UNKNOWN = ['Nowhere', 'Fletcher', 'M', null, '', 'Harness Park Freestyle Team'];

function csv(rows) { return rows.map(r => r.map(c => (c == null ? '' : String(c))).map(c => /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(',')).join('\r\n') + '\r\n'; }
function write(name, text) { fs.writeFileSync(path.join(OUT, name), text); }

// ── Family B: current SkiReg export (Copper-shaped, six categories + noise) ──
const SKIREG_HDR = ['Bib', 'Category Entered / Merchandise Ordered', 'City', 'First Name', 'Last Name', 'Notes', 'Fundraising Pageviews', 'Custom Tax', 'Gender', 'State', 'Team'];
function skiregRow(p, cat, bib) { return [bib || '', cat, 'Harness City', p[1], p[0], '', '0.0000', '0.0000', p[2], 'CO', p[5]]; }
(() => {
  const rows = [SKIREG_HDR];
  const men = PEOPLE.filter(p => p[2] === 'M'), women = PEOPLE.filter(p => p[2] === 'F');
  men.forEach((p, i) => {
    rows.push(skiregRow(p, 'Saturday Men\'s Moguls (Feb 21)', 100 + i));
    if (i < 6) rows.push(skiregRow(p, 'Sunday Men\'s Moguls (Feb 22) *** FULL ***'));
    if (i < 5) rows.push(skiregRow(p, 'Sunday Mens Dual Moguls (Feb 22)'));
  });
  women.forEach((p, i) => {
    rows.push(skiregRow(p, 'Saturday Women\'s Moguls (Feb 21)', 200 + i));
    if (i < 4) rows.push(skiregRow(p, 'Sunday Women\'s Moguls (Feb 22) *** FULL **I'));
    if (i < 3) rows.push(skiregRow(p, 'Sunday Women\'s Dual Moguls (Feb 22)'));
  });
  rows.push(skiregRow(['Parent', 'Pat', 'F', null, '', ''], 'Banquet Tickets'));
  rows.push(skiregRow(['Coachman', 'Chris', 'M', null, '', 'Harness Springs Winter Sports'], 'Coaches / Officials / Judges'));
  rows.push(skiregRow(UNKNOWN, 'Saturday Men\'s Moguls (Feb 21)', 199));
  rows.push(skiregRow(TWINS[0], 'Saturday Men\'s Moguls (Feb 21)', 150));   // resolved by gender
  rows.push(skiregRow(TWINS[2], 'Saturday Men\'s Moguls (Feb 21)', 151));   // same gender → club word
  write('skireg_copper.csv', csv(rows));
})();

// SkiReg, single-day RQS/Devo meet, no dates — needs the Events step.
(() => {
  const rows = [['Bib', 'Category Entered', 'City', 'First Name', 'Last Name', 'Notes', 'Fundraising Pageviews', 'Custom Tax', 'Gender', 'State', 'Team', 'Quantity', 'MerchSummary']];
  PEOPLE.slice(0, 4).forEach(p => rows.push([...skiregRow(p, 'Men Moguls'), '', '']));
  PEOPLE.slice(8, 11).forEach(p => rows.push([...skiregRow(p, 'Women\'s Moguls'), '', '']));
  rows.push([...skiregRow(PEOPLE[0], 'Non Rocky Athlete Registration Fee'), '1', '']);
  write('skireg_ambiguous.csv', csv(rows));
})();

// SkiReg with a date that matches no event.
(() => {
  const rows = [SKIREG_HDR];
  PEOPLE.slice(0, 3).forEach(p => rows.push(skiregRow(p, 'Men\'s Moguls (Feb 23rd)')));
  write('skireg_date_mismatch.csv', csv(rows));
})();

// SkiReg Devo / RQS with series words (no dates in the category).
(() => {
  const rows = [SKIREG_HDR];
  PEOPLE.slice(0, 3).forEach(p => rows.push(skiregRow(p, 'Mens Devo Singles')));
  PEOPLE.slice(3, 6).forEach(p => rows.push(skiregRow(p, 'Mens RQS Singles')));
  PEOPLE.slice(8, 10).forEach(p => rows.push(skiregRow(p, 'Womens Devo Singles')));
  write('skireg_series.csv', csv(rows));
})();

// ── Family A: RMF / Winfree Data files ─────────────────────────────────────
// Tick columns M, M2, D (Copper Comp 2026 Data.csv shape).
(() => {
  const rows = [['Last Name', 'First Name', 'Gender', 'Born', 'ID', 'Club', 'Bib', 'M', 'M2', 'D']];
  PEOPLE.forEach((p, i) => rows.push([p[0], p[1], p[2], p[3], p[4], p[5], 100 + i, 'X', i % 2 ? 'X' : '', i % 3 ? 'X' : '']));
  write('rmf_ticks.csv', csv(rows));
})();
// Events column (Winter Park 2026 Data File.csv shape, with a FIS column and one duplicate number).
(() => {
  const rows = [['Last Name', 'First Name', 'Gender', 'Born', 'ID', 'Club', 'Bib', 'Events', 'FIS']];
  PEOPLE.forEach((p, i) => rows.push([p[0], p[1], p[2], p[3], p[4], p[5], 100 + i, ['MD', 'MM2', 'MDM2', 'M', 'D', 'DM'][i % 6], i === 0 ? '2540001' : '']));
  rows.push(['Dupe', 'Easton', 'M', 2010, '9900005', 'Harness Springs Winter Sports', 300, 'M', '']); // same ID as Crumble
  write('rmf_events.csv', csv(rows));
})();
// Devo file — no entry information (Aspen Devo 2026 Data.csv shape).
(() => {
  const rows = [['Last Name', 'First Name', 'Gender', 'Born', 'ID', 'Club', 'Bib']];
  PEOPLE.forEach(p => rows.push([p[0], p[1], p[2], p[3], p[4], p[5], '']));
  write('rmf_devo.csv', csv(rows));
})();
// Steamboat DM Reg Data.csv shape: swapped Born/ID, two trailing empty headers.
(() => {
  const rows = [['Last Name', 'First Name', 'Gender', 'ID', 'Club', 'Born', '', '']];
  PEOPLE.slice(0, 5).forEach(p => rows.push([p[0], p[1], p[2], p[4], p[5], p[3], '', '']));
  write('rmf_trailing_headers.csv', csv(rows));
})();
// SteamJan2025Data.csv shape: Events first, literal "ID" text in the ID column, bad Events code.
(() => {
  const rows = [['Events', 'First Name', 'Last Name', 'Gender', 'Club', 'Born', 'ID']];
  rows.push(['MD', PEOPLE[8][1], PEOPLE[8][0], 'F', PEOPLE[8][5], 2009, 'ID']);
  rows.push(['MQ', PEOPLE[0][1], PEOPLE[0][0], 'M', PEOPLE[0][5], 2010, PEOPLE[0][4]]);
  rows.push(['MD', PEOPLE[1][1], PEOPLE[1][0], 'M', PEOPLE[1][5], 2009, PEOPLE[1][4]]);
  write('rmf_id_text.csv', csv(rows));
})();

// ── Family C: older REG files ──────────────────────────────────────────────
// REG_7710: First, Last, Sex, Club, Born, ID with a UTF-8 BOM.
(() => {
  const rows = [['First', 'Last', 'Sex', 'Club', 'Born', 'ID']];
  PEOPLE.slice(0, 3).forEach(p => rows.push([p[1], p[0], p[2], p[5], p[3], p[4]]));
  write('reg_7710_bom.csv', '﻿' + csv(rows));
})();
// REG_7722: Club holds the gender letter, Team holds the club, Year of Birth.
(() => {
  const rows = [['First Name', 'Last Name', 'Club', 'Team', 'ID', 'Year of Birth']];
  PEOPLE.slice(0, 3).forEach(p => rows.push([p[1], p[0], p[2], p[5], p[4], p[3]]));
  write('reg_7722_swapped.csv', csv(rows));
})();

// ── Family D/E: Winfree results export + start list ────────────────────────
(() => {
  const rows = [['No', 'Bib', 'Last', 'First', 'Gp', 'Rep', 'J.1', 'J.2', 'J.3', 'T&L', 'J.4', 'J.5', 'Jumps', 'DofD', 'Airs', 'Judge', 'Time', 'Pts', 'Run', 'Event', '']];
  rows.push(['1', '89', 'ESTRELLA', 'Lenna', 'F19', 'Tea', '16.1', '16.2', '16.1', '48.4', '6.6', '5.9', '3', '0.780', '10.58', '58.98', '30.04', '15.42', '74.40', '', '']);
  rows.push(['', '', '', '', '', '', '', '', '', '', '7.0', '7.1', 'bp', '0.810']);
  rows.push(['2', '75', 'DUNMORE', 'Alivia', 'F15', 'Har', '15.1', '15.2', '15.1', '45.4', '6.6', '5.9', '3', '0.780', '10.58', '55.98', '31.04', '14.42', '70.40', '', '']);
  write('winfree_results.csv', csv(rows));
  const sl = [['Bib#', 'Last', 'First', 'ID#', 'From']];
  PEOPLE.slice(0, 3).forEach((p, i) => sl.push([100 + i, p[0], p[1], p[4], p[5]]));
  write('winfree_startlist.csv', csv(sl));
})();

// ── Pure-function edge cases ───────────────────────────────────────────────
// Two junk rows above the header (Winfree rule) + French accented headers + Last, First split.
(() => {
  const rows = [
    ['Harness Invitational 2026', '', '', '', ''],
    ['', '', '', '', ''],
    ['Nom de Famille', 'Prénom', 'Sexe', 'Année de Naissance', 'ID#'],
    ['Anders, Cole', '', 'Male', '2010-03-07', '9900001'],
    ['Agee-Test', 'Arabella', 'Femelle', '3/7/2009', '9900101'],
    ['Bellamy', 'Quinn', 'F17', '2011-03-04T00:00', '9900102'],
    ['Carrick', 'Mia', 'F', 'unknown', '9900103'],
  ];
  write('edge_headers.csv', csv(rows));
})();
// Windows-1252 encoded name (é as 0xE9) — not valid UTF-8.
(() => {
  const text = 'Last Name,First Name,Gender,Born,ID\r\nP\xe9rez,Jos\xe9,M,2010,7900001\r\n';
  fs.writeFileSync(path.join(OUT, 'win1252.csv'), Buffer.from(text, 'latin1'));
})();
// Duplicate + empty headers must not throw.
(() => {
  write('dup_headers.csv', csv([['Last Name', 'First Name', 'Bib', 'Bib', '', 'Gender'], ['Anders', 'Cole', '5', '6', '', 'M']]));
})();

// ── XLSX twin of skireg_copper.csv ─────────────────────────────────────────
(async () => {
  const ExcelJS = require(path.join(SERVER_DIR, 'node_modules', 'exceljs'));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  const text = fs.readFileSync(path.join(OUT, 'skireg_copper.csv'), 'utf8');
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    // naive split is fine — the fixture has no quoted commas
    ws.addRow(line.split(',').map(c => (/^\d+$/.test(c) ? Number(c) : c)));
  }
  await wb.xlsx.writeFile(path.join(OUT, 'skireg_copper.xlsx'));
  console.log('fixtures written to', OUT);
})();

module.exports = { PEOPLE, TWINS, UNKNOWN };
