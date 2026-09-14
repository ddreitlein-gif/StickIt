// StickIt v2.6.00 -- Broadcast Board dual helpers. DISPLAY ONLY.
//
// Everything here reads the rows GET /api/events/:id/dual already serves
// (pairing_number, round_name, sides, status) and groups them into the blocks
// of the day exactly as server/dual/runOrder.js roundBlocks() does: every
// qualifying round, the semifinal block (both 5-8 consolation semis + both
// 1-4 semis when the bracket runs off to 8th), then the finals block.
// Nothing here predicts which COURSE an advancing athlete takes -- that is
// the server's 4310.3.1 rule (v2.5.07). An unfilled side is shown as
// "Winner of 11" / "Loser of 12" from the feeder match's pairing number, on
// no course, until the server writes the athlete into a slot (David's ruling
// 09-14-26).

export const byRunOrder = (a, b) =>
  ((a.pairing_number ?? 1e9) - (b.pairing_number ?? 1e9))
  || (b.bracket_round - a.bracket_round)
  || (a.bracket_position - b.bracket_position);

export const isPlayable = m => !!(m && !m.is_bye && m.registration_id_blue && m.registration_id_red);
export const isOpen = m => !!(m && !m.is_bye && m.status !== 'complete');

/** The blocks of the day in run order: [{ key, name, matches }]. */
export function blocksOf(matches, runoffOption) {
  const main = matches.filter(m => !m.is_small_final);
  const small = matches.filter(m => m.is_small_final);
  if (!main.length) return [];
  const totalRound = Math.max(...main.map(m => Number(m.bracket_round)));
  const has58 = runoffOption === 'runoff_to_8th' && totalRound >= 3;
  const blocks = [];
  for (let r = totalRound; r > 2; r--) {
    blocks.push({
      key: `main-${r}`, name: `Round of ${2 ** r}`,
      matches: main.filter(m => Number(m.bracket_round) === r).sort(byRunOrder),
    });
  }
  if (totalRound >= 2) {
    const semis = main.filter(m => Number(m.bracket_round) === 2);
    const cons = has58 ? small.filter(m => Number(m.bracket_round) === 2) : [];
    blocks.push({ key: 'semis', name: 'Semifinals', matches: [...cons, ...semis].sort(byRunOrder) });
  }
  blocks.push({
    key: 'finals', name: 'Finals',
    matches: [...small.filter(m => Number(m.bracket_round) === 1), ...main.filter(m => Number(m.bracket_round) === 1)].sort(byRunOrder),
  });
  return blocks;
}

/**
 * Where the board is in the day.
 *   { blocks, currentIndex, current, nextBlock, nextMatch, finalsDone, championshipDone }
 * current = the block holding the active match if one is open, else the block
 * of the first PLAYABLE open match in run order (a 5-8 semi that can never
 * fill must not pin the board on an empty block -- same anchor as the
 * Scoring tab, v2.5.04).
 */
export function dualPosition(matches, runoffOption, activeMatchId) {
  const blocks = blocksOf(matches, runoffOption);
  const active = activeMatchId ? matches.find(m => m.id === activeMatchId) : null;
  const ordered = matches.filter(m => !m.is_bye).slice().sort(byRunOrder);
  let nextMatch = active && isOpen(active) ? active : null;
  if (!nextMatch) nextMatch = ordered.find(m => isPlayable(m) && isOpen(m)) || null;
  let currentIndex = -1;
  if (nextMatch) currentIndex = blocks.findIndex(b => b.matches.some(m => m.id === nextMatch.id));
  const championship = matches.find(m => !m.is_small_final && Number(m.bracket_round) === 1) || null;
  const championshipDone = !!(championship && championship.status === 'complete');
  return {
    blocks,
    currentIndex,
    current: currentIndex >= 0 ? blocks[currentIndex] : null,
    nextBlock: currentIndex >= 0 && currentIndex + 1 < blocks.length ? blocks[currentIndex + 1] : null,
    nextMatch,
    championshipDone,
  };
}

/** Is this bracket the post-F-2 shape (round-1 5/6 + 7/8 finals exist)? */
const hasNew58 = matches => matches.some(m => m.is_small_final && Number(m.bracket_round) === 1 && Number(m.bracket_position) >= 3);

const find = (matches, round, pos, small) =>
  matches.find(m => Number(m.bracket_round) === round && Number(m.bracket_position) === pos && !!m.is_small_final === !!small) || null;

/**
 * The matches that feed `m`: [{ match, take: 'winner' | 'loser' }].
 * Structure only (which match feeds which), never the side.
 */
export function feedersOf(m, matches) {
  const R = Number(m.bracket_round), p = Number(m.bracket_position);
  const main = matches.filter(x => !x.is_small_final);
  const totalRound = main.length ? Math.max(...main.map(x => Number(x.bracket_round))) : 0;
  const out = [];
  const push = (match, take) => { if (match) out.push({ match, take }); };
  if (!m.is_small_final) {
    if (R >= totalRound) return out;                       // first round: seeded, no feeders
    push(find(matches, R + 1, 2 * p - 1, false), 'winner');
    push(find(matches, R + 1, 2 * p, false), 'winner');
    return out;
  }
  if (R === 1 && p === 2) {                                // 3/4 final <- semi losers
    push(find(matches, 2, 1, false), 'loser');
    push(find(matches, 2, 2, false), 'loser');
    return out;
  }
  if (!hasNew58(matches)) return out;                      // legacy pre-F-2 shape: no placeholders
  if (R === 2 && (p === 3 || p === 4)) {                   // 5-8 semis <- QF losers (mirror of the main draw)
    const q = p === 3 ? [1, 2] : [3, 4];
    push(find(matches, 3, q[0], false), 'loser');
    push(find(matches, 3, q[1], false), 'loser');
    return out;
  }
  if (R === 1 && p === 3) {                                // 5/6 final <- cons semi winners
    push(find(matches, 2, 3, true), 'winner');
    push(find(matches, 2, 4, true), 'winner');
    return out;
  }
  if (R === 1 && p === 4) {                                // 7/8 final <- cons semi losers
    push(find(matches, 2, 3, true), 'loser');
    push(find(matches, 2, 4, true), 'loser');
    return out;
  }
  return out;
}

const loserOf = m => (m.winner_registration_id === m.registration_id_blue ? m.registration_id_red : m.registration_id_blue);

/**
 * Placeholder labels for the sides of `m` the server has not filled yet:
 * ["Winner of 11", "Loser of 12"]. A feeder whose outcome already sits in one
 * of m's slots is not outstanding.
 */
export function outstandingFeeders(m, matches) {
  const sides = new Set([m.registration_id_blue, m.registration_id_red].filter(Boolean));
  return feedersOf(m, matches).filter(f => {
    const fm = f.match;
    if (fm.status === 'complete' && fm.winner_registration_id) {
      const id = f.take === 'winner' ? fm.winner_registration_id : loserOf(fm);
      if (id && sides.has(id)) return false;
    }
    return true;
  }).map(f => {
    const n = f.match.pairing_number;
    const who = f.take === 'winner' ? 'Winner' : 'Loser';
    return n != null ? `${who} of ${n}` : (f.match.is_bye ? 'Bye' : who);
  });
}

export const pad2 = n => (n == null ? '' : String(n).padStart(2, '0'));

export function winnerSide(m) {
  if (!m || !m.winner_registration_id) return null;
  if (m.winner_registration_id === m.registration_id_blue) return 'blue';
  if (m.winner_registration_id === m.registration_id_red) return 'red';
  return null;
}
