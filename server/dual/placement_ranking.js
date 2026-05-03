// ICR 4312 — Ranking and Tie-Breaking of those eliminated in Dual Moguls knock-out rounds.
//
// Per FIS ICR 2022 (sections 4312.1 – 4312.6):
//   - Within each eliminated round: scored competitors first (highest score, then seed),
//     then DNF (by seed), then DNS (by seed).
//   - DNS in the FIRST round of Dual Moguls with Seeded Groups (4312.4): not classified,
//     no rank, listed above DSQ.
//   - DSQ: listed below DNS, no rank.
//   - Both-DNF in the same round (4312.5): the head judge selects who DNF'd first by
//     marking that competitor as the loser; not handled here.
//
// Per StickIt operational direction:
//   - reg_status='scratched' → excluded from the bracket and placement results entirely.
//   - run_status='RNS' → treated as DNS.

function classifyDualLoser({ run_status, reg_status } = {}) {
  const reg = (reg_status || '').toLowerCase();
  const run = (run_status || '').toUpperCase();
  if (reg === 'scratched') return 'scratched';
  if (run === 'DSQ') return 'dsq';
  if (run === 'DNS' || run === 'RNS') return 'dns';
  if (run === 'DNF') return 'dnf';
  return 'scored';
}

function computeAgeGroup(birthYear, meetDateStr) {
  if (!birthYear) return '';
  const d = meetDateStr ? new Date(meetDateStr) : new Date();
  const seasonStartYear = d.getMonth() < 6 ? d.getFullYear() - 1 : d.getFullYear();
  const age = seasonStartYear - parseInt(birthYear);
  if (age <= 6) return '7';
  if (age <= 8) return '9';
  if (age <= 10) return '11';
  if (age <= 12) return '13';
  if (age <= 14) return '15';
  if (age <= 16) return '17';
  if (age <= 18) return '19';
  if (age <= 20) return 'Sr';
  return 'Vet';
}

function makeEntry({ regId, first, last, bib, gender, birthYear, club, runStatus, regStatus, rank, meetDate }) {
  const gp = (gender || '').charAt(0).toUpperCase() + computeAgeGroup(birthYear, meetDate);
  return {
    rank,
    registration_id: regId,
    bib_number: bib || '',
    gp,
    first_name: first || '',
    last_name: last || '',
    club: club || '',
    run_status: runStatus || null,
    reg_status: regStatus || null,
  };
}

// Build a per-side description of one bracket match's loser.
// Returns null if there is no resolvable loser to place.
function loserSide(m) {
  if (!m.winner_registration_id) return null;
  const loserIsBlue = m.winner_registration_id !== m.registration_id_blue;
  if (loserIsBlue) {
    if (!m.registration_id_blue) return null;
    return {
      regId: m.registration_id_blue,
      first: m.blue_first, last: m.blue_last, bib: m.blue_bib,
      gender: m.blue_gender, birthYear: m.blue_birth_year, club: m.blue_club,
      seed: m.blue_dual_seed || 999,
      score: Number(m.blue_total) || 0,
      run_status: m.loser_status || null,
      reg_status: m.blue_reg_status || null,
    };
  }
  if (!m.registration_id_red) return null;
  return {
    regId: m.registration_id_red,
    first: m.red_first, last: m.red_last, bib: m.red_bib,
    gender: m.red_gender, birthYear: m.red_birth_year, club: m.red_club,
    seed: m.red_dual_seed || 999,
    score: Number(m.red_total) || 0,
    run_status: m.loser_status || null,
    reg_status: m.red_reg_status || null,
  };
}

// Same as loserSide but for the winner of a championship-final / consolation slot.
function winnerSide(m) {
  if (!m.winner_registration_id) return null;
  const winnerIsBlue = m.winner_registration_id === m.registration_id_blue;
  if (winnerIsBlue) {
    if (!m.registration_id_blue) return null;
    return {
      regId: m.registration_id_blue,
      first: m.blue_first, last: m.blue_last, bib: m.blue_bib,
      gender: m.blue_gender, birthYear: m.blue_birth_year, club: m.blue_club,
      reg_status: m.blue_reg_status || null,
    };
  }
  if (!m.registration_id_red) return null;
  return {
    regId: m.registration_id_red,
    first: m.red_first, last: m.red_last, bib: m.red_bib,
    gender: m.red_gender, birthYear: m.red_birth_year, club: m.red_club,
    reg_status: m.red_reg_status || null,
  };
}

// rankDualPlacements
// Inputs:
//   bracket  — dual_bracket rows joined with athlete/registration data and per-match
//              point totals (blue_total / red_total). Same shape that results.js gathers.
//   meetDate — meet date string; used only to compute the age-group label.
//   isSeededGroups — controls 4312.4 first-round-DNS handling. StickIt uses seeded
//                    groups in all current dual mogul flows; default true.
// Returns: array of placement entries in ICR 4312 order. Entries that should not be
// classified per the rule have rank === null.
function rankDualPlacements({ bracket, meetDate, isSeededGroups = true } = {}) {
  const placed = [];
  const placedRegIds = new Set();

  if (!Array.isArray(bracket) || bracket.length === 0) return placed;

  // bracketEntryRound = the highest bracket_round number present (4312.4 reference).
  let bracketEntryRound = 0;
  for (const m of bracket) {
    if (m.bracket_round > bracketEntryRound) bracketEntryRound = m.bracket_round;
  }

  function push(entry) {
    if (!entry || !entry.registration_id || placedRegIds.has(entry.registration_id)) return;
    placedRegIds.add(entry.registration_id);
    placed.push(entry);
  }

  function makeFromSide(side, rank) {
    return makeEntry({
      regId: side.regId,
      first: side.first, last: side.last, bib: side.bib,
      gender: side.gender, birthYear: side.birthYear, club: side.club,
      runStatus: side.run_status,
      regStatus: side.reg_status,
      rank,
      meetDate,
    });
  }

  // 1. Championship final → ranks 1, 2.
  const final1 = bracket.find(m => m.bracket_round === 1 && !m.is_small_final);
  if (final1 && final1.status === 'complete') {
    const w = winnerSide(final1);
    const l = loserSide(final1);
    if (w && classifyDualLoser({ reg_status: w.reg_status }) !== 'scratched') {
      push(makeFromSide({ ...w, run_status: null }, 1));
    }
    if (l && classifyDualLoser({ run_status: l.run_status, reg_status: l.reg_status }) !== 'scratched') {
      push(makeFromSide(l, 2));
    }
  }

  // 2. Consolation matches (small finals) → 3/4, 5/6, 7/8, …
  const consolMatches = bracket
    .filter(m => m.is_small_final)
    .sort((a, b) => a.bracket_position - b.bracket_position);
  consolMatches.forEach((m, i) => {
    if (m.status !== 'complete') return;
    const startPlace = 3 + i * 2;
    const w = winnerSide(m);
    const l = loserSide(m);
    if (w && classifyDualLoser({ reg_status: w.reg_status }) !== 'scratched') {
      push(makeFromSide({ ...w, run_status: null }, startPlace));
    }
    if (l && classifyDualLoser({ run_status: l.run_status, reg_status: l.reg_status }) !== 'scratched') {
      push(makeFromSide(l, startPlace + 1));
    }
  });

  // 3. Remaining losers per round, applying ICR 4312 hierarchy.
  // Rounds processed nearest-final first (round 2, then 3, …) so ranks ascend.
  const mainCompleted = bracket
    .filter(m => !m.is_small_final && m.status === 'complete' && m.bracket_round > 1);
  const roundGroups = {};
  for (const m of mainCompleted) {
    const l = loserSide(m);
    if (!l) continue;
    const cls = classifyDualLoser({ run_status: l.run_status, reg_status: l.reg_status });
    if (cls === 'scratched') continue;
    if (placedRegIds.has(l.regId)) continue;
    const r = m.bracket_round;
    if (!roundGroups[r]) roundGroups[r] = { scored: [], dnf: [], dns: [], dsq: [] };
    roundGroups[r][cls].push(l);
  }

  // Continue ranks from the highest rank already assigned. Using placed.length here
  // would under-count if a scratched athlete was skipped at the championship/consolation
  // tier (placed.length lags behind the actual rank used).
  let maxAssignedRank = 0;
  for (const p of placed) {
    if (typeof p.rank === 'number' && p.rank > maxAssignedRank) maxAssignedRank = p.rank;
  }
  let nextPlace = maxAssignedRank + 1;
  const roundKeys = Object.keys(roundGroups).map(Number).sort((a, b) => a - b);
  for (const round of roundKeys) {
    const group = roundGroups[round];

    // a) scored — highest score first; tie-break by seed (lower seed = higher rank).
    group.scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.seed || 999) - (b.seed || 999);
    });
    for (const l of group.scored) {
      push(makeFromSide(l, nextPlace++));
    }

    // b) DNF — by seed.
    group.dnf.sort((a, b) => (a.seed || 999) - (b.seed || 999));
    for (const l of group.dnf) {
      push(makeFromSide(l, nextPlace++));
    }

    // c) DNS — by seed; first-round DNS in seeded groups gets no rank (4312.4).
    group.dns.sort((a, b) => (a.seed || 999) - (b.seed || 999));
    const firstRoundDnsUnranked = isSeededGroups && round === bracketEntryRound;
    for (const l of group.dns) {
      if (firstRoundDnsUnranked) {
        push(makeFromSide(l, null));
      } else {
        push(makeFromSide(l, nextPlace++));
      }
    }

    // d) DSQ — listed below DNS, no rank.
    group.dsq.sort((a, b) => (a.seed || 999) - (b.seed || 999));
    for (const l of group.dsq) {
      push(makeFromSide(l, null));
    }
  }

  return placed;
}

module.exports = { rankDualPlacements, classifyDualLoser };
