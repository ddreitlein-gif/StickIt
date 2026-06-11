/**
 * Winfree .fre file parser for the StickIt scoring review.
 *
 * Format notes (reverse engineered 06-10-26 from the 2026 season files):
 *  - INI-like sections: [param], [EventM], [EventD], [EventM2]..., [entrant]
 *  - CRLF line endings; a trailing backslash continues the line.
 *  - Values use ~ as a list separator.
 *  - Entrant records begin at Name= lines inside [entrant].
 *      Name=LAST,First Club_With_Underscores GX/YYYY USSANUM BIB M1D1
 *        G = gender letter (M/F), X = age class letter, YYYY = birth year
 *  - Mogul run lines:  M1= / M2= (event M) and M21= / M22= (event M2):
 *      M1=<bib> <time*100> <tl1*100> ... <tlN*100> <airJ1tot*100> [<airJ2tot*100>];ma= <air detail>
 *      air detail per air judge: dd1/score1/dd2/score2  (dd *1000, score *10)
 *      followed by jump codes "c1/c2" (or single code).
 *      Status markers like [DNS] [DNF] [DSQ] [RNS] may appear after the bib.
 *  - Dual lines: D1=..D6= one per round the athlete skied:
 *      D<round>=<bib> <?> <j1*100> <j2*100> <j3*100> <j4*100> <j5*100> <x> <y>
 *      The five j values are that athlete's own votes from each judge (0..5, *100).
 *      [DNF]/[DNS] markers may appear.
 *  - Order/M= <run1 start order> [<run2 start order>]
 *  - Order/D= ladder position for each successive duals round.
 *  - Seed/D= duals seed.
 *  - [EventX] keys: Judge=, Runoff=, EventIdM/F=, Homo=<name>~<length_m>~... etc.
 */
const fs = require('fs');

function readLogicalLines(path) {
  const raw = fs.readFileSync(path, 'latin1').replace(/\r/g, '');
  // Join continuation lines (trailing backslash).
  const joined = raw.replace(/\\\n/g, '');
  return joined.split('\n');
}

function parseFre(path) {
  const lines = readLogicalLines(path);
  const doc = { params: {}, events: {}, entrants: [] };
  let section = null;
  let cur = null; // current entrant

  for (const line of lines) {
    if (!line.trim()) continue;
    const secMatch = line.match(/^\[(.+)\]$/);
    if (secMatch) {
      section = secMatch[1];
      if (section.startsWith('Event')) {
        doc.events[section.slice(5)] = { keys: {} };
      }
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq);
    const val = line.slice(eq + 1);

    if (section === 'param') {
      doc.params[key] = val;
      continue;
    }
    if (section && section.startsWith('Event')) {
      doc.events[section.slice(5)].keys[key] = val;
      continue;
    }
    if (section === 'entrant') {
      if (key === 'Name') {
        cur = parseNameLine(val);
        doc.entrants.push(cur);
        continue;
      }
      if (!cur) continue;
      if (key.startsWith('Order/')) {
        cur.orders[key.slice(6)] = val.trim().split(/\s+/).map(Number);
      } else if (key.startsWith('Seed/')) {
        cur.seeds[key.slice(5)] = Number(val.trim());
      } else if (/^M\d+$/.test(key)) {
        cur.moRuns[key] = parseMogulRunLine(val);
      } else if (/^D\d+$/.test(key)) {
        cur.dualRounds[key.slice(1)] = parseDualLine(val);
      } else {
        cur.extra[key] = val;
      }
    }
  }
  return doc;
}

function parseNameLine(val) {
  // LAST,First Club GX/YYYY USSA BIB EVENTS   (club may be '?')
  const parts = val.trim().split(/\s+/);
  const name = parts[0] || '';
  // Find the GX/YYYY token (two letters slash 4 digits)
  let gi = parts.findIndex(p => /^[A-Z][A-Z?]\/\d{4}$/.test(p));
  if (gi < 0) gi = parts.findIndex(p => /\/\d{4}$/.test(p));
  const gTok = gi >= 0 ? parts[gi] : '';
  const gender = gTok.startsWith('M') ? 'M' : gTok.startsWith('F') ? 'F' : '?';
  const birthYear = gTok ? Number(gTok.split('/')[1]) : null;
  const club = gi > 1 ? parts.slice(1, gi).join(' ') : '';
  const ussa = gi >= 0 && parts[gi + 1] ? parts[gi + 1] : '';
  const bib = gi >= 0 && parts[gi + 2] ? Number(parts[gi + 2]) : null;
  const events = gi >= 0 && parts[gi + 3] ? parts[gi + 3] : '';
  return {
    name, club, gender, birthYear, ussa, bib, events,
    orders: {}, seeds: {}, moRuns: {}, dualRounds: {}, extra: {},
  };
}

function extractStatus(s) {
  const m = s.match(/\[(DNS|DNF|DSQ|RNS|DQ)\]/i);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Evaluate a Winfree component expression like "=(8.5+4.6+4.2)-1.2"
 * (carving + absorption/extension + upper body, minus deduction).
 * Computed in integer tenths to avoid float drift.  Returns POINTS.
 */
function evalComponentExpr(tok) {
  const expr = tok.slice(1); // strip '='
  let i = 0, sign = 1, acc = 0;
  const flat = expr.replace(/[()]/g, '');
  const parts = flat.match(/[+-]?[\d.]+/g) || [];
  for (const p of parts) {
    const v = Math.round(parseFloat(p) * 10);
    acc += v;
  }
  void i; void sign;
  return acc / 10;
}

function parseMogulRunLine(val) {
  // <numbers...>[;ma= <detail>]
  const [numPartRaw, maPartRaw] = val.split(';');
  const status = extractStatus(numPartRaw);
  const numPart = numPartRaw.replace(/\[[A-Za-z]+\]/g, ' ');
  const nums = numPart.trim().split(/\s+/).filter(Boolean).map(t =>
    t.startsWith('=') ? evalComponentExpr(t) * 100 : Number(t));
  const run = { bib: nums[0], status, raw: val.trim() };
  // remaining: time, tl..., airJudgeTotals...
  const rest = nums.slice(1);
  let airDetail = null;
  let codes = [];
  if (maPartRaw) {
    const ma = maPartRaw.replace(/^ma=\s*/, '').trim();
    const toks = ma.split(/\s+/).filter(Boolean);
    // last token is the jump code(s) if it is not a dd/score group
    const groups = [];
    for (const t of toks) {
      if (/^[\d?]+(\/[\d?]+){1,3}$/.test(t) && t.includes('/')) {
        const segs = t.split('/').map(x => (x === '?' ? null : Number(x)));
        if (segs.length === 4) { groups.push(segs); continue; }
      }
      codes.push(t);
    }
    airDetail = groups.map(g => ({
      dd1: g[0] != null ? g[0] / 1000 : null,
      s1: g[1] != null ? g[1] / 10 : null,
      dd2: g[2] != null ? g[2] / 1000 : null,
      s2: g[3] != null ? g[3] / 10 : null,
    }));
    codes = codes.join(' ').split('/').filter(Boolean);
  }
  // Air judge totals: one trailing numeric total per ACTIVE air judge.
  // Inactive judges (e.g. the unused second air slot at RQS/Devo) appear in
  // the ma detail with zero scores but contribute no total to the numeric part.
  const nAir = airDetail ? airDetail.filter(g => (g.s1 || 0) > 0 || (g.s2 || 0) > 0).length : 0;
  if (airDetail) {
    // Keep only the active judges so downstream score arrays line up.
    run.inactiveAirJudges = airDetail.length - nAir;
  }
  run.time = rest.length > 0 ? rest[0] / 100 : null;
  const mid = rest.slice(1);
  run.tlScores = mid.slice(0, Math.max(0, mid.length - nAir)).map(x => x / 100);
  run.airJudgeTotals = mid.slice(Math.max(0, mid.length - nAir)).map(x => x / 100);
  run.airDetail = airDetail;
  run.codes = codes;
  return run;
}

function parseDualLine(val) {
  const status = extractStatus(val);
  const cleaned = val.replace(/\[[A-Za-z]+\]/g, ' ');
  const toks = cleaned.trim().split(/\s+/).filter(Boolean);
  const bib = Number(toks[0]);
  const unk = toks[1]; // '?' observed in all files
  const nums = toks.slice(2).map(Number);
  // five judge vote values (*100), then two trailing fields
  const votes = nums.slice(0, 5).map(x => x / 100);
  return { bib, unk, votes, trailing: nums.slice(5), status, raw: val.trim() };
}

module.exports = { parseFre };
