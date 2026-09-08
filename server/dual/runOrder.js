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

// ---------------------------------------------------------------------------
// v2.5.06 -- ROUND LABELS + END-OF-ROUND state for the dual tablets.
//
// Display only: nothing here feeds placement, scoring, or the run order above.
// A "block" is one step of the day in the run order: every qualifying round
// (Round of 64 … Round of 8), then the semifinal block (the two 5-8
// consolation semis + the two 1-4 semis when the bracket runs off to 8th),
// then the finals block (7/8, 5/6, 3/4, 1/2). The tablets show
//   * a per-match label ("Round of 32", "7th / 8th Place") on the match card,
//   * "End of Round of 32" on the waiting screens once EVERY playable match
//     of a block is complete and nothing in a later block has started.
// The finals block never ends "a round" -- the event-completed screen covers
// the end of the day -- so endedBlock() returns null there.
// ---------------------------------------------------------------------------

/** 'Female' | 'Male' from events.gender (any of the accepted spellings). */
function genderWord(gender) {
  const g = String(gender || '').trim().toUpperCase();
  return (g === 'F' || g === 'W' || g === 'FEMALE' || g === 'WOMEN' || g === "WOMEN'S") ? 'Female' : 'Male';
}

/**
 * Bare round label for one match (no gender prefix).
 *   main round r > 2      -> "Round of 2^r"   (r = 3 is "Round of 8")
 *   main round 2          -> "Semifinal"
 *   consolation round 2   -> "5th – 8th Place Semifinal"   (runoff to 8th)
 *                            legacy pre-F-2 brackets keep their terminal
 *                            5/6 (pos 3) and 7/8 (pos 4) meaning
 *   consolation round 1   -> pos 4 "7th / 8th Place", pos 3 "5th / 6th Place",
 *                            pos 2 "3rd / 4th Place"
 *   main round 1          -> "1st / 2nd Place"
 * @param {object} match
 * @param {Array} matches the whole bracket (legacy-shape detection only)
 */
function roundLabel(match, matches = []) {
  if (!match) return null;
  const r = Number(match.bracket_round);
  const pos = Number(match.bracket_position);
  if (match.is_small_final) {
    if (r === 1) {
      if (pos === 4) return '7th / 8th Place';
      if (pos === 3) return '5th / 6th Place';
      return '3rd / 4th Place';
    }
    if (r === 2) {
      const legacy = !matches.some(m => m.is_small_final && Number(m.bracket_round) === 1 && Number(m.bracket_position) >= 3);
      if (legacy && pos === 3) return '5th / 6th Place';
      if (legacy && pos === 4) return '7th / 8th Place';
      return '5th \u2013 8th Place Semifinal';
    }
    return `Consolation Round ${r}`;
  }
  if (r === 1) return '1st / 2nd Place';
  if (r === 2) return 'Semifinal';
  return `Round of ${2 ** r}`;
}

/**
 * The blocks of the day in run order, each { key, label, matches }.
 * `label` is the END-OF-ROUND wording ("Round of 16", "Semi-Finals"); the
 * finals block carries label null (no end-of-round panel after the finals).
 */
function roundBlocks(matches, runoffOption) {
  const main  = matches.filter(m => !m.is_small_final);
  const small = matches.filter(m => m.is_small_final);
  if (!main.length) return [];
  const totalRound  = Math.max(...main.map(m => Number(m.bracket_round)));
  const has58       = runoffOption === 'runoff_to_8th' && totalRound >= 3;
  const blocks = [];
  for (let r = totalRound; r > 2; r--) {
    blocks.push({ key: `main-${r}`, label: `Round of ${2 ** r}`, matches: main.filter(m => Number(m.bracket_round) === r) });
  }
  if (totalRound >= 2) {
    const semis = main.filter(m => Number(m.bracket_round) === 2);
    const cons  = has58 ? small.filter(m => Number(m.bracket_round) === 2) : [];
    blocks.push({ key: 'semis', label: 'Semi-Finals', matches: [...cons, ...semis] });
  }
  blocks.push({
    key: 'finals', label: null,
    matches: [...small.filter(m => Number(m.bracket_round) === 1), ...main.filter(m => Number(m.bracket_round) === 1)],
  });
  return blocks;
}

/**
 * Which block (if any) has just ENDED: every playable match of it is
 * complete, at least one match was played, no match of a later block has
 * started, and no still-open match is currently active. A match is playable
 * when both sides are known and it is not a bye -- so a 5-8 consolation semi
 * that can never fill (byes in a 6-athlete bracket) cannot hold a round open.
 * @returns {{key, label}|null}  null when nothing has just ended (mid-round,
 *          before the first match, or after the finals).
 */
function endedBlock(matches, runoffOption, activeMatchId = null) {
  const active = activeMatchId ? matches.find(m => m.id === activeMatchId) : null;
  if (active && active.status !== 'complete' && !active.is_bye) return null;
  const blocks = roundBlocks(matches, runoffOption);
  const playable = m => !m.is_bye && m.registration_id_blue && m.registration_id_red;
  const started  = m => !m.is_bye && (m.status === 'complete' || (m.status && m.status !== 'pending'));
  let last = null;
  for (const b of blocks) {
    const open = b.matches.filter(m => playable(m) && m.status !== 'complete');
    if (open.length) {
      // Anything started in this block means the previous block is history.
      if (b.matches.some(started)) return null;
      break;
    }
    if (b.matches.some(m => !m.is_bye && m.status === 'complete')) last = b;
  }
  if (!last || !last.label) return null;
  return { key: last.key, label: last.label };
}

module.exports = { runOrder, pairingNumbers, formatPairingLabel, genderWord, roundLabel, roundBlocks, endedBlock };
