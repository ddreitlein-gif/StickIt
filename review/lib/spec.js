/**
 * Independent implementation of the governing scoring rules, written from the
 * Phase 1 specification (review/StickIt_Scoring_Specification_06-10-26.md)
 * WITHOUT reference to StickIt code.  Used to derive expected values.
 *
 * Incorporates David's 06-10-26 rulings:
 *   A: 2-turn-judge sums scale by 1.5 (turns max stays 60).
 *   B: 1-jump events double the single jump's air (air max 20).
 *   C: per-jump with-DD air score capped at 10.0 (JH 6204.3.2).
 *   D: air = average of judges' raw scores per jump, truncated, then x DD
 *      (handbook order), truncated per jump.
 *   E: RQS repeat rule keeps the higher SCORED jump.
 */

function trunc2(n) { return Math.floor(n * 100 + 1e-9) / 100; }

/** Turns: sum of TL judge scores; 2-judge panels scale x1.5; 5-judge panels
 *  drop high+low.  (JH 6203.1.1 / 6203.2.1; ruling A) */
function turnsScore(tlScores) {
  const t = (tlScores || []).filter(s => s != null);
  if (t.length === 0) return 0;
  let sum;
  if (t.length >= 5) {
    const sorted = [...t].sort((a, b) => a - b);
    sum = sorted.slice(1, -1).reduce((a, b) => a + b, 0);
  } else if (t.length === 3) {
    sum = t.reduce((a, b) => a + b, 0);
  } else {
    sum = (3 / t.length) * t.reduce((a, b) => a + b, 0);
  }
  return trunc2(sum);
}

/** Air for one jump, handbook order (ruling D):
 *  avg(judges' raw 0-10 scores) -> truncate -> x DD -> truncate -> cap 10.0 (ruling C).
 *  Jump must receive at least 0.1 to earn DD (JH 6204.3.2). */
function jumpScore(rawScores, dd) {
  const s = (rawScores || []).filter(x => x != null && x > 0);
  if (s.length === 0 || !dd) return 0;
  const avg = trunc2(s.reduce((a, b) => a + b, 0) / s.length);
  if (avg < 0.1) return 0;
  return Math.min(trunc2(avg * dd), 10.0);
}

/**
 * Air total for a run.
 * @param {Object} j1 {scores:[], dd, code}
 * @param {Object} j2 {scores:[], dd, code} or null
 * @param {number} numJumps event jump count (1 = Devo)
 * @param {string} division 'rqs' applies the higher-scored repeat rule (ruling E)
 * @param {boolean} isRepeat whether the two codes are repeats (same code, USSS 4210.2.1)
 */
function airScore(j1, j2, numJumps, division, isRepeat) {
  let a1 = j1 ? jumpScore(j1.scores, j1.dd) : 0;
  let a2 = j2 ? jumpScore(j2.scores, j2.dd) : 0;
  if (numJumps === 1) {
    // Ruling B: double the single jump.
    return trunc2(Math.min(a1 * 2, 20.0));
  }
  if (isRepeat) {
    if ((division || '').toLowerCase() === 'rqs') {
      // RMF RQS: higher SCORED jump counts (ruling E).
      if (a2 > a1) a1 = 0; else a2 = 0;
    } else {
      // USSS 4210.2.1: only the first jump counts.
      a2 = 0;
    }
  }
  const landed1 = a1 > 0, landed2 = a2 > 0;
  if (landed1 !== landed2) {
    // USSS 4210.2.2: single jump in a 2-jump event capped at 50% of air max.
    return trunc2(Math.min(a1 + a2, 10.0));
  }
  return trunc2(Math.min(a1 + a2, 20.0));
}

/** Pace time = course length / pace speed (USSS 4207.2), truncated 2dp per 4008. */
function paceTime(courseLengthM, gender, standard = 'usss') {
  if (!courseLengthM || courseLengthM <= 0) return null;
  const speeds = { usss: { M: 9.70, F: 8.20 }, fis: { M: 10.30, F: 9.00 } };
  const s = speeds[standard] || speeds.usss;
  return trunc2(courseLengthM / (gender === 'F' ? s.F : s.M));
}

/** Speed Score = 48 - 32 (t/pace), clamped [0, 20] (ICR 4206.3; JH 6204.4),
 *  truncated 2dp (USSS 4008). */
function speedScore(time, pace) {
  if (!time || !pace || time <= 0 || pace <= 0) return 0;
  return trunc2(Math.max(0, Math.min(20, 48 - 32 * (time / pace))));
}

/** Total = turns + air + speed, truncated (USSS 4008). */
function totalScore(turns, air, speed) {
  return trunc2(turns + air + speed);
}

/** Mogul tie-break, USSS 4207.3: Total, Turns, Air WITHOUT DD, faster time. */
function compareMogul(a, b) {
  if (Math.abs(a.total - b.total) > 1e-9) return b.total - a.total;
  if (Math.abs(a.turns - b.turns) > 1e-9) return b.turns - a.turns;
  if (Math.abs((a.airNoDd ?? 0) - (b.airNoDd ?? 0)) > 1e-9) return (b.airNoDd ?? 0) - (a.airNoDd ?? 0);
  const at = a.time ?? Infinity, bt = b.time ?? Infinity;
  if (at !== bt) return at - bt;
  return 0;
}

/** Air without DD: raw execution.  Average of judges' raw scores per jump,
 *  summed across jumps (single-jump events doubled per ruling B). */
function airNoDd(j1, j2, numJumps) {
  const avg = j => {
    const s = (j && j.scores || []).filter(x => x != null && x > 0);
    return s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0;
  };
  const a1 = avg(j1), a2 = avg(j2);
  return trunc2(numJumps === 1 ? a1 * 2 : a1 + a2);
}

/** Rank with shared ranks (4207.3.4): equal on all tie-breaks -> same rank,
 *  next rank skips. */
function rank(items, cmp = compareMogul) {
  const sorted = [...items].sort(cmp);
  let r = 1;
  sorted.forEach((it, i) => {
    if (i > 0 && cmp(sorted[i], sorted[i - 1]) !== 0) r = i + 1;
    it.rank = r;
  });
  return sorted;
}

/** Dual moguls classic vote winner: simple majority of the judges' splits. */
function dualWinner(blueVotes, redVotes) {
  const b = blueVotes.reduce((a, x) => a + x, 0);
  const r = redVotes.reduce((a, x) => a + x, 0);
  return b > r ? 'blue' : r > b ? 'red' : null;
}

/** FFSP, dual moguls 4th place and below (USSS Event Scoring rule 4):
 *  PPR = thirdFfsp / CC;  place p gets thirdFfsp - (p - 3) * PPR. */
function dualFfsp(place, tier, cc) {
  if (place === 1) return tier[0];
  if (place === 2) return tier[1];
  if (place === 3) return tier[2];
  const ppr = tier[2] / cc;
  return Math.max(0, tier[2] - (place - 3) * ppr);
}

/** FFSP, moguls 4th and below: (score / thirdScore) * thirdFfsp. */
function mogulFfsp(score, thirdScore, thirdFfsp) {
  if (!thirdScore) return 0;
  return (score / thirdScore) * thirdFfsp;
}

module.exports = {
  trunc2, turnsScore, jumpScore, airScore, airNoDd, paceTime, speedScore,
  totalScore, compareMogul, rank, dualWinner, dualFfsp, mogulFfsp,
};
