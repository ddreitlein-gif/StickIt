// USSS Freestyle Points (FFSP) for dual mogul events.
// Pure function -- no DB calls. See CLAUDE.md / USSS comp guide for the rules.
//
// Inputs:
//   event       - { is_divisional, status, ... }
//   bracket     - dual_bracket rows already loaded by results.js / pdf.js
//                 (registration_id_blue/red, winner_registration_id, bracket_round,
//                  is_small_final, is_bye, loser_status)
//   placements  - ordered placement array, each entry { rank, registration_id,
//                 run_status?, reg_status? }
//
// Returns: Map<registration_id, { ffsp: number, excluded: boolean, reason?: string }>

function computeDualFfsp({ event, bracket, placements }) {
  const out = new Map();
  if (!Array.isArray(placements) || placements.length === 0) return out;
  if (!Array.isArray(bracket)) bracket = [];

  // Bracket entry round = the highest bracket_round number present.
  let bracketEntryRound = 0;
  for (const m of bracket) {
    if (m.bracket_round > bracketEntryRound) bracketEntryRound = m.bracket_round;
  }

  // For each registration_id, find their losing match's loser_status and round.
  // Athlete loses a match when winner_registration_id !== their registration_id
  // AND they were one of the two competitors. Skip byes.
  const loseInfoByReg = new Map();
  for (const m of bracket) {
    if (m.is_bye) continue;
    if (m.status !== 'complete') continue;
    const loserReg = m.winner_registration_id === m.registration_id_blue
      ? m.registration_id_red
      : m.registration_id_blue;
    if (!loserReg) continue;
    if (!loseInfoByReg.has(loserReg)) {
      loseInfoByReg.set(loserReg, { round: m.bracket_round, loser_status: m.loser_status || null });
    }
  }

  // Step 1: classify every athlete by status (ranked / dns / dsq / scratched / dnf / first_round_dnf).
  const statusByReg = new Map();
  for (const p of placements) {
    const regId = p.registration_id;
    if (!regId) continue;
    const regStatus = (p.reg_status || '').toLowerCase();
    const runStatus = (p.run_status || '').toUpperCase();

    let s = 'ranked';
    if (regStatus === 'scratched') s = 'scratched';
    else if (runStatus === 'DNS') s = 'dns';
    else if (runStatus === 'DSQ') s = 'dsq';
    else if (runStatus === 'DNF') s = 'dnf';
    else {
      // Not flagged on placement -- check the losing match's loser_status as a fallback.
      const li = loseInfoByReg.get(regId);
      if (li) {
        const ls = (li.loser_status || '').toUpperCase();
        if (ls === 'DNS') s = 'dns';
        else if (ls === 'DSQ') s = 'dsq';
        else if (ls === 'DNF') s = 'dnf';
      }
    }

    if (s === 'dnf') {
      const li = loseInfoByReg.get(regId);
      if (li && li.round === bracketEntryRound) s = 'first_round_dnf';
    }
    statusByReg.set(regId, s);
  }

  // Step 2: Counting Competitors -- excludes DNS, DSQ, scratched. DNFs count.
  let cc = 0;
  for (const s of statusByReg.values()) {
    if (s !== 'dns' && s !== 'dsq' && s !== 'scratched') cc++;
  }

  // Step 3: tier selection.
  let tier;
  if (event && event.is_divisional) tier = [1000, 970, 950];
  else if (cc >= 15) tier = [900, 875, 855];
  else tier = [800, 775, 760];

  const ppr = cc > 0 ? tier[2] / cc : 0;

  // Step 4: award FFSP per athlete.
  for (const p of placements) {
    const regId = p.registration_id;
    if (!regId) continue;
    const s = statusByReg.get(regId) || 'ranked';

    if (s === 'dns' || s === 'dsq' || s === 'scratched') {
      out.set(regId, { ffsp: 0, excluded: true, reason: s });
      continue;
    }
    if (s === 'first_round_dnf') {
      out.set(regId, { ffsp: 0, excluded: false, reason: 'first_round_dnf' });
      continue;
    }

    const rank = p.rank;
    let val;
    if (rank === 1) val = tier[0];
    else if (rank === 2) val = tier[1];
    else if (rank === 3) val = tier[2];
    else if (rank >= 4) val = tier[2] - (rank - 3) * ppr;
    else val = 0;
    if (val < 0) val = 0;
    out.set(regId, { ffsp: val, excluded: false });
  }

  return out;
}

module.exports = { computeDualFfsp };
