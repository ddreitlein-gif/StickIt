// ---------------------------------------------------------------------------
// Dual mogul RUN ORDER — the single source of truth for pairing numbers.
// v2.5.04
//
// Every consumer that needs "which match runs next" or "what is this match's
// pairing number" must go through here: the /dual bracket list and
// /active-match (pairing_number + pairing_label on every row), the bracket /
// bracket-keeper PDFs, the Head Judge tablet's Next Pairing, the Scoring tab's
// Up Next / On Deck / Remaining, and the Viewer API.
//
// Rules — the Winfree "Championship Duals Run-order", confirmed against the
// RMF Divisional Champs at Telluride (Mar 2026) result sheets on 09-07-26:
//
//   * Rounds BEFORE the semifinals run top to bottom (bracket_position
//     ascending): 1.1, 1.2, … then 2.1, 2.2, … and so on through the
//     quarterfinals.
//   * The SEMIFINAL round runs LAST to FIRST: the two 5–8 consolation semis
//     (pos 4, then pos 3) before the two 1–4 semifinals (pos 2, then pos 1).
//   * The FINALS run lowest places first: 7/8, 5/6, 3/4, then the 1/2
//     championship final — the highest pairing number ends the day.
//
// Pairing numbers are 1-based positions in this order, byes excluded, per
// gender (StickIt never interleaves men and women the way Winfree does).
//
// Legacy pre-F-2 runoff_to_8th brackets (round-2 small finals pos 3/4 as
// terminal 5/6 and 7/8, no round-1 pos 3/4) keep their historical order: the
// (round, pos) lookups below simply find nothing for the missing matches.
// ---------------------------------------------------------------------------

/**
 * Order a bracket's matches for the day.
 * @param {Array<{id, bracket_round, bracket_position, is_small_final, is_bye}>} matches
 * @param {string} runoffOption 'runoff_to_8th' | 'runoff_to_4th' | 'no_runoff'
 * @returns {Array} the non-bye matches in run order
 */
function runOrder(matches, runoffOption) {
  const main  = matches.filter(m => !m.is_small_final);
  const small = matches.filter(m => m.is_small_final);
  if (!main.length) return [];

  const totalRound  = Math.max(...main.map(m => m.bracket_round));
  const has58       = runoffOption === 'runoff_to_8th' && totalRound >= 3;
  const finalsRound = has58 ? 3 : 2;
  const out = [];

  const mainRound = (round, lastToFirst) => {
    main
      .filter(m => m.bracket_round === round && !m.is_bye)
      .sort((a, b) => lastToFirst
        ? b.bracket_position - a.bracket_position
        : a.bracket_position - b.bracket_position)
      .forEach(m => out.push(m));
  };
  const smallAt = (round, pos) => {
    const m = small.find(s => s.bracket_round === round && s.bracket_position === pos && !s.is_bye);
    if (m) out.push(m);
  };

  // Qualifying rounds (everything before the finals block): top to bottom.
  for (let r = totalRound; r > finalsRound; r--) mainRound(r, false);

  if (has58) {
    mainRound(3, false);   // quarterfinals, top to bottom
    smallAt(2, 4);         // 5–8 consolation semi (bottom)
    smallAt(2, 3);         // 5–8 consolation semi (top)
    mainRound(2, true);    // 1–4 semifinals, last to first
    smallAt(1, 4);         // 7/8 final
    smallAt(1, 3);         // 5/6 final
    smallAt(1, 2);         // 3/4 final
    mainRound(1, false);   // 1/2 championship final — last of the day
  } else {
    mainRound(2, true);    // semifinals, last to first (no-op for a 2-athlete bracket)
    smallAt(1, 2);         // 3/4 final (absent when no_runoff)
    mainRound(1, false);   // 1/2 championship final
  }
  return out;
}

/**
 * Map match.id → pairing number (1-based, run order, byes excluded).
 */
function pairingNumbers(matches, runoffOption) {
  const map = new Map();
  runOrder(matches, runoffOption).forEach((m, i) => map.set(m.id, i + 1));
  return map;
}

/** "W-01" / "M-17" */
function formatPairingLabel(genderPrefix, num) {
  return `${genderPrefix}-${String(num).padStart(2, '0')}`;
}

module.exports = { runOrder, pairingNumbers, formatPairingLabel };
