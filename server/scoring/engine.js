/**
 * Freestyle Mogul Scoring Engine
 * US Ski & Snowboard / FIS rules
 *
 * Total = Turns + Air + Speed (max 100.0)
 *
 * Turns (max 60.0) -- FIS JH 6203:
 *   - Each T&L judge scores 0.1 to 20.0
 *   - 5-judge format (3 TL judges):  sum all 3 scores  -> max 60
 *   - 7-judge format (5 TL judges):  drop high and low, sum the 3 counting -> max 60
 *
 * Air (max 20.0) -- FIS JH 6204:
 *   - Each jump scored 0-10 by air judges; per-judge contribution = score * DD
 *   - jump_score = average of per-judge (score * DD) values
 *   - air = jump1_score + jump2_score, capped at 20.0
 *   - 1-jump events double the single jump; single-jump-in-2-jump-event capped
 *     at 10.0 per USSS 4210.2.2
 *
 * Speed (max 20.0) -- USSS / FIS ICR 4206.3:
 *   - speed = max(0, 48 - 32 * (run_time / pace_time)), capped at 20.0
 *   - pace_time is derived from course length and the configured pace standard
 *     (USSS: 9.70 m/s M / 8.20 m/s F; FIS: 10.30 m/s M / 9.00 m/s F)
 *
 * All published scores and intermediate values are truncated (floor) to 2
 * decimal places per FIS rules; DD values are preserved at full precision.
 */

/**
 * Drop highest and lowest scores from array, return average of remainder.
 * If fewer than 3 scores, just average all.
 */
function dropHighLow(scores) {
  if (!scores || scores.length === 0) return 0;
  if (scores.length <= 2) {
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }
  const sorted = [...scores].sort((a, b) => a - b);
  const trimmed = sorted.slice(1, sorted.length - 1);
  return trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
}

/**
 * Calculate turns score contribution (0-20 scale before weighting).
 * @param {number[]} tlScores - Array of T&L judge raw scores (0.1-20.0)
 * @returns {number} averaged turns score on 0-20 scale
 */
function calcTurnsScore(tlScores) {
  if (!tlScores || tlScores.length === 0) return 0;
  return floorToHundredth(dropHighLow(tlScores));
}

/**
 * Calculate turns SUM score per FIS rules.
 * 3 judges (5-judge format): sum all 3 scores
 * 5 judges (7-judge format): drop high and low, sum remaining 3
 * 1-2 judges: sum all (non-standard)
 * @param {number[]} tlScores - Array of T&L judge raw scores (0.1-20.0)
 * @returns {number} summed turns score on 0-60 scale
 */
function calcTurnsSumScore(tlScores) {
  if (!tlScores || tlScores.length === 0) return 0;
  if (tlScores.length <= 2) {
    // Non-standard: sum all
    return tlScores.reduce((a, b) => a + b, 0);
  }
  if (tlScores.length <= 3) {
    // 5-judge format: 3 TL judges, sum all 3
    return tlScores.reduce((a, b) => a + b, 0);
  }
  // 7-judge format or more: drop high and low, sum remaining
  const sorted = [...tlScores].sort((a, b) => a - b);
  const trimmed = sorted.slice(1, sorted.length - 1);
  return trimmed.reduce((a, b) => a + b, 0);
}

/**
 * Calculate air score for a single jump (Winfree-compatible).
 * Floor each judge's (score × DD) individually, then average.
 * Returns the UN-rounded average — truncation to hundredths happens
 * at the combined-jump level in calcMogulScore.
 * @param {number[]} airJudgeScores - Raw scores from air judges (0-10 each)
 * @param {number} dd - Degree of difficulty multiplier
 * @returns {number} jump air score (avg of per-judge floored values, full precision)
 */
function calcJumpScore(airJudgeScores, dd) {
  if (!airJudgeScores || airJudgeScores.length === 0 || !dd) return 0;
  const perJudge = airJudgeScores.map(s => floorToHundredth(s * dd));
  return perJudge.reduce((a, b) => a + b, 0) / perJudge.length;
}

/**
 * Calculate speed score per ICR 4206.3.
 * Formula: Speed Score = 48 - 32 * (competitor_time / pace_time)
 * Maximum value = 20.0, minimum = 0.0
 *
 * Pace time is calculated from course length:
 *   Men:   course_length_m / 10.30
 *   Women: course_length_m / 9.00
 * Or may be manually overridden.
 *
 * @param {number} runTime - Actual run time in seconds
 * @param {number} paceTime - Event pace time in seconds
 * @returns {number} speed score (0-20)
 */
function calcSpeedScore(runTime, paceTime) {
  if (!runTime || !paceTime || runTime <= 0 || paceTime <= 0) return 0;
  const speedScore = 48 - 32 * (runTime / paceTime);
  return floorToHundredth(Math.max(0, Math.min(speedScore, 20)));
}

/**
 * Calculate pace time from course length per ICR 4207.2.
 * Men's pace speed:  10.30 m/s
 * Women's pace speed: 9.00 m/s
 *
 * @param {number} courseLengthM - Course length in metres
 * @param {string} gender - 'M' or 'F'
 * @returns {number} pace time in seconds, rounded to 2 decimal places
 */
function calcPaceTime(courseLengthM, gender, standard) {
  if (!courseLengthM || courseLengthM <= 0) return null;
  const speeds = { usss: { M: 9.70, F: 8.20 }, fis: { M: 10.30, F: 9.00 } };
  const s = speeds[standard] || speeds.usss;
  const paceSpeed = gender === 'F' ? s.F : s.M;
  return floorToHundredth(courseLengthM / paceSpeed);
}

/**
 * Calculate the complete mogul score for a single run.
 *
 * FIS Scoring (5-judge format, JH 6203.2):
 *   Turns: 3 judges score 0.0-20.0 each; sum of 3 = max 60.0 points
 *   Air:   2 judges per jump; average their scores; jump_score = avg * DD
 *          Air total = jump1_score + jump2_score; max 20.0 points
 *   Speed: ICR 4206.3: 48 - 32*(time/pace_time), max 20.0 points
 *   Total = Turns + Air + Speed; max 100.0
 *
 * 7-judge format (JH 6203.1):
 *   Turns: 5 judges; drop high and low of turns AND deductions separately;
 *          sum of 3 counting turns + 3 counting deductions = max 60.0 points
 *   Air:   2 judges averaged per jump, same as above
 *   Speed: same as above
 *
 * Single-jump-in-2-jump-event cap (USSS 4210.2.2):
 *   When the event is configured for 2 jumps but the athlete only lands one
 *   (the other jump has no DD/code or no air judge scores), the landed jump's
 *   air contribution is capped at 10.0 -- 50% of the 20-point air maximum --
 *   so a high-DD single jump cannot match the air score of an athlete who
 *   landed two jumps. Does not apply to 1-jump events (DEVO numJumps === 1).
 *
 * @param {Object} params
 * @param {number[]} params.tlScores - T&L judge scores array (each 0.0-20.0)
 * @param {number[]} params.airScoresJump1 - Air judge scores for jump 1 (each 0-10)
 * @param {number} params.dd1 - DD for jump 1
 * @param {number[]} params.airScoresJump2 - Air judge scores for jump 2 (each 0-10)
 * @param {number} params.dd2 - DD for jump 2
 * @param {number} params.runTime - Run time in seconds
 * @param {number} params.paceTime - Pace time in seconds
 * @param {number} params.turnsWeight - Weight for turns (default 0.60, used for normalization)
 * @param {number} params.airWeight - Weight for air (default 0.20)
 * @param {number} params.speedWeight - Weight for speed (default 0.20)
 * @param {boolean} params.hasSpeed - Whether speed is scored
 * @returns {Object} Full scoring breakdown
 */
function calcMogulScore(params) {
  const {
    tlScores = [],
    airScoresJump1 = [],
    dd1 = 0,
    airScoresJump2 = [],
    dd2 = 0,
    runTime = null,
    paceTime = null,
    turnsWeight = 0.60,
    airWeight = 0.20,
    speedWeight = 0.20,
    hasSpeed = true,
    numTlJudges = 3,
    numJumps = 2,
  } = params;

  // --- Turns ---
  // FIS 5-judge format (3 TL judges): sum all 3 scores, max 60
  // FIS 7-judge format (5 TL judges): drop high and low, sum remaining 3, max 60
  // If 1-2 judges: sum all (non-standard but handle gracefully)
  const turnsRaw = calcTurnsScore(tlScores); // averaged score on 0-20 scale (for tiebreaker)
  let turnsContrib;
  if (numTlJudges < 3) {
    // Non-standard panel: scale up to 3-judge equivalent (e.g. 2 judges × 1.5 = 60 max)
    turnsContrib = floorToHundredth((3 / numTlJudges) * tlScores.reduce((a, b) => a + b, 0));
  } else {
    turnsContrib = floorToHundredth(calcTurnsSumScore(tlScores));
  }
  // turnsContrib is now on 0-60 scale (3 counting judges * 20 max each)

  // --- Air ---
  // Each jump: average air judge scores, multiply by DD
  // Per JH 6204.3: score = form_score (0-10) * DD; air total = jump1 + jump2
  // Max per jump = 10.0 * max_DD; FIS caps effective air contribution at 20.0
  const jump1Score = calcJumpScore(airScoresJump1, dd1);
  const jump2Score = numJumps >= 2 ? calcJumpScore(airScoresJump2, dd2) : 0;
  let airRaw;
  if (numJumps === 1) {
    // Single jump: double the score to compensate for missing second jump
    airRaw = floorToHundredth(Math.min(jump1Score * 2, 20.0));
  } else {
    // USSS 4210.2.2: in a 2-jump event, if only one jump is landed (no DD/code
    // or no air scores on the other), cap that single jump at 10 (50% of 20).
    const jump1Landed = dd1 > 0 && airScoresJump1 && airScoresJump1.length > 0;
    const jump2Landed = dd2 > 0 && airScoresJump2 && airScoresJump2.length > 0;
    if (jump1Landed && !jump2Landed) {
      airRaw = floorToHundredth(Math.min(jump1Score, 10.0));
    } else if (!jump1Landed && jump2Landed) {
      airRaw = floorToHundredth(Math.min(jump2Score, 10.0));
    } else {
      airRaw = floorToHundredth(Math.min(jump1Score + jump2Score, 20.0));
    }
  }
  const airContrib = airRaw; // Already on the correct scale (max ~20 with typical DDs)

  // Air without DD -- raw execution score for FIS ICR 4207.3 tie-break.
  // Per-jump average of raw judge scores (0-10), summed across jumps. Single-jump
  // events double the one jump average to keep the value comparable to two-jump runs.
  const avgRaw = (arr) => (arr && arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const j1Raw = avgRaw(airScoresJump1);
  const j2Raw = numJumps >= 2 ? avgRaw(airScoresJump2) : 0;
  const airNoDd = floorToHundredth(numJumps === 1 ? j1Raw * 2 : j1Raw + j2Raw);

  // --- Speed ---
  // ICR 4206.3: Speed Score = 48 - 32 * (time / pace_time), max 20.0
  let speedRaw = 0;
  let speedContrib = 0;
  if (hasSpeed && runTime && paceTime) {
    speedRaw = calcSpeedScore(runTime, paceTime); // 0-20
    speedContrib = speedRaw;
  }

  // --- Total ---
  const total = floorToHundredth(turnsContrib + airContrib + speedContrib);

  return {
    turnsRaw,          // 0-20 (averaged, for tiebreaker)
    turnsContrib,      // 0-60 (sum of counting judges)
    jump1Score,        // raw jump 1 air score (avg * DD)
    jump2Score,        // raw jump 2 air score (avg * DD)
    airRaw,            // combined air (jump1 + jump2)
    airContrib,        // 0-~20 air contribution
    airNoDd,           // FIS ICR 4207.3 tiebreaker -- raw air execution, pre-DD
    speedRaw,          // 0-20 (ICR 4206.3)
    speedContrib,      // 0-20 speed contribution
    total,             // 0-100
  };
}

/**
 * Parse a mogul jump code into its canonical repeat-detection key.
 *
 * There are two fundamentally different jump code families in this app:
 *
 * SPIN CODES (start with digits -- represent rotations):
 *   <degrees>[o][modifier]
 *   degrees  -- 3 (360), 7 (720), 10 (1080), 14 (1440)
 *   o        -- off-axis flag (optional)
 *   modifier -- p (position) or G (grab), optional
 *   Examples: '3', '3p', '3G', '3op', '3oG', '7', '7p', '7op', '7oG',
 *             '10', '10p', '10G', '10op', '10oG', '14op', '14oG'
 *
 * FLIP CODES (start with a direction letter b/f/l):
 *   <direction>[modifier]
 *   direction -- b (back), f (front), l (loop)
 *   modifier  -- L (lay), P (pike uppercase), T (tuck), G (grab), F (full),
 *                p (position, lowercase), dF (double full), tF (triple full),
 *                pF (position full), GF (grab full)
 *   Examples: 'bL', 'bp', 'bP', 'bT', 'bG', 'bF', 'bdF', 'btF',
 *             'fT', 'fP', 'fp', 'fG', 'fF',
 *             'l', 'lp', 'lG', 'lF', 'lpF', 'lGF'
 *
 * BASIC SPREAD CODES (uppercase-only letter combinations):
 *   Single: S, T, D, X, Y, M, K, Z
 *   Multi:  SS, TS, TT, TD, DTS, TST, TTS, TTSS, TTSSD
 *
 * DOMESTIC REPEAT RULE (USSS/RMF override):
 *   'p' (position modifier) counts as a different jump from the same family
 *   without 'p'. bL (back layout) and bp (back position) are NOT repeats.
 *
 * 'r' suffix (right takeoff) is cosmetic and never distinguishes jumps.
 *
 * @param {string} code - Raw jump code string
 * @returns {{ key: string }|null}  key is the canonical repeat-detection string
 */
function parseJumpCode(code) {
  if (!code) return null;
  // Strip trailing 'r' (right-takeoff cosmetic marker, case-insensitive).
  // Only strip trailing r to avoid corrupting codes like 'fF' etc.
  const s = code.trim().replace(/r$/i, '');
  if (!s) return null;

  // --- SPIN CODES: start with one or more digits ---
  // Pattern: digits, optional 'o' (off-axis), optional modifier p/G
  const spinMatch = s.match(/^(\d+)(o?)([pPgG]?)$/);
  if (spinMatch) {
    const degrees = spinMatch[1];           // '3', '7', '10', '14'
    const offAxis = spinMatch[2] ? 'o' : ''; // 'o' or ''
    // Normalize modifier: p/P -> 'p', g/G -> 'G', empty -> ''
    const rawMod = spinMatch[3];
    const mod = rawMod === 'p' || rawMod === 'P' ? 'p'
              : rawMod === 'g' || rawMod === 'G' ? 'G'
              : '';
    return { key: `spin_${degrees}${offAxis}${mod}` };
  }

  // --- FLIP CODES: start with b, f, or l ---
  const flipMatch = s.match(/^([bfl])(.*)$/i);
  if (flipMatch) {
    const dir  = flipMatch[1].toLowerCase();  // b, f, l
    const rest = flipMatch[2];                // everything after the direction

    // Preserve case for the rest: 'bL' -> rest='L', 'bp' -> rest='p'.
    // The position modifier 'p' (lowercase) is distinct from 'L', 'P' (tuck/pike).
    // Lowercase the rest only enough to normalize true duplicates (e.g. 'BL' == 'bL').
    // Strategy: lowercase the whole rest, but that would merge bP and bp.
    // Instead keep original case of rest so bL, bp, bP are all distinct.
    return { key: `flip_${dir}_${rest}` };
  }

  // --- BASIC SPREAD CODES: all-alpha, uppercase family (S, T, SS, TS, etc.) ---
  if (/^[A-Za-z]+$/.test(s)) {
    return { key: `spread_${s.toUpperCase()}` };
  }

  // Unrecognized format -- fall back to lowercased string
  return { key: s.toLowerCase() };
}

/**
 * Determine whether two mogul jump codes are repeats under domestic rules.
 *
 * Two jumps are repeats when their canonical repeat-detection keys are equal.
 * The key encodes jump family, off-axis status, and modifier in a way that
 * correctly implements the domestic rule: position ('p') counts as a different
 * jump than the same base without 'p'.
 *
 * Examples (code1 vs code2 -> key1 vs key2 -> result):
 *   bL  vs bp   -> flip_b_L  vs flip_b_p   -> NOT repeats (domestic rule)
 *   bL  vs bL   -> flip_b_L  vs flip_b_L   -> repeats
 *   3   vs 3    -> spin_3    vs spin_3      -> repeats
 *   3p  vs 3    -> spin_3p   vs spin_3      -> NOT repeats
 *   7   vs 7p   -> spin_7    vs spin_7p     -> NOT repeats
 *   7op vs 7p   -> spin_7op  vs spin_7p     -> NOT repeats (off-axis differs)
 *   7op vs 7op  -> spin_7op  vs spin_7op    -> repeats
 *   d   vs dr   -> spread_D  vs spread_D    -> repeats (r stripped)
 *   fF  vs fF   -> flip_f_F  vs flip_f_F   -> repeats
 *   fF  vs fp   -> flip_f_F  vs flip_f_p   -> NOT repeats
 *
 * @param {string} code1
 * @param {string} code2
 * @returns {boolean} true if the two jumps are considered repeats
 */
function areJumpsRepeats(code1, code2) {
  if (!code1 || !code2) return false;
  const p1 = parseJumpCode(code1);
  const p2 = parseJumpCode(code2);
  if (!p1 || !p2) return false;
  return p1.key === p2.key;
}

/**
 * Apply the domestic jump-repetition rule, returning the adjusted DDs for the
 * two jumps when they are repeats. Caller is responsible for detecting the
 * repeat (via `areJumpsRepeats`) and for skipping aerials.
 *
 * USSS first-counts (default — DEVO, Comp Series, and any non-RQS division):
 *   The first jump counts; the second jump's DD is zeroed.
 *
 * RMF RQS higher-counts (`events.division === 'rqs'`):
 *   The higher-DD jump counts; the lower-DD jump's DD is zeroed.
 *   On a tie (dd1 === dd2), falls through to first-counts (zero dd2).
 *
 * Reference: RMF Competition Guide (RQS section).
 *
 * @param {number} dd1 - resolved DD for jump 1
 * @param {number} dd2 - resolved DD for jump 2
 * @param {string} division - `events.division` (e.g. 'rqs', 'devo', 'comp')
 * @returns {{ dd1: number, dd2: number }} adjusted DDs (one will be 0)
 */
function applyRepeatJumpRule(dd1, dd2, division) {
  const a = Number(dd1) || 0;
  const b = Number(dd2) || 0;
  const div = (division || '').toLowerCase();
  if (div === 'rqs' && b > a) {
    return { dd1: 0, dd2: b };
  }
  return { dd1: a, dd2: 0 };
}

/**
 * Dual Mogul scoring -- temporary numbered-judge 5-point split model.
 *
 * This is an intentionally simplified model for domestic use.  It replaces the
 * FIS role-based (TL-vote / air-vote / speed-vote) model for now.
 *
 * Rules:
 *   - Each judge is identified by number only (Judge 1, Judge 2, ...).
 *   - Each judge distributes exactly 5 whole points across the two competitors.
 *   - Valid splits: 5/0, 4/1, 3/2, 2/3, 1/4, 0/5.
 *   - blue_points + red_points must equal 5.
 *   - Winner is determined by summing each competitor's points across all judges.
 *   - In the event of a total tie, no winner is determined (flag for TD decision).
 *
 * What is NOT implemented here:
 *   - Automatic judging caps
 *   - Structured moguls turn-deduction rule encoding
 *   - Official FIS dual moguls Classic or Direct Comparison scoring logic
 *   - Explicit air, turns, speed, or overall dual judge roles
 *
 * @param {Array<{judgeNumber: number, bluePoints: number, redPoints: number}>} judgeScores
 *   Array of individual judge point splits.  Each entry must satisfy
 *   bluePoints + redPoints === 5 and both values must be non-negative integers.
 * @returns {{ blueTotal: number, redTotal: number, winner: string|null,
 *             judgeCount: number, breakdown: Array }}
 */
function calcDualMogulPointSplit(judgeScores) {
  if (!judgeScores || judgeScores.length === 0) {
    return { blueTotal: 0, redTotal: 0, winner: null, judgeCount: 0, timeTied: false, breakdown: [] };
  }

  let blueTotal = 0;
  let redTotal  = 0;

  for (const js of judgeScores) {
    blueTotal += js.bluePoints;
    redTotal  += js.redPoints;
  }

  let winner = null;
  if (blueTotal > redTotal) winner = 'blue';
  else if (redTotal > blueTotal) winner = 'red';
  // Exact tie: winner remains null -- requires TD decision.

  const timeTied = judgeScores.some(js => js.timeTied);

  return {
    blueTotal,
    redTotal,
    winner,
    judgeCount: judgeScores.length,
    timeTied,
    breakdown: judgeScores.map(js => ({
      judgeNumber: js.judgeNumber,
      bluePoints:  js.bluePoints,
      redPoints:   js.redPoints,
      timeTied:    !!js.timeTied,
    })),
  };
}

/**
 * Validate a single judge's 5-point split.
 * Returns null if valid, or an error string if invalid.
 *
 * @param {number} bluePoints
 * @param {number} redPoints
 * @returns {string|null}
 */
function validateDualPointSplit(bluePoints, redPoints, { timeTied = false, isOverallWithTimeTied = false } = {}) {
  if (!Number.isInteger(bluePoints) || !Number.isInteger(redPoints)) {
    return 'blue_points and red_points must be integers';
  }
  if (bluePoints < 0 || redPoints < 0) {
    return 'blue_points and red_points must be non-negative';
  }
  if (timeTied) {
    if (bluePoints !== 0 || redPoints !== 0) {
      return 'Time tied entry must have blue_points=0 and red_points=0';
    }
    return null;
  }
  if (isOverallWithTimeTied) {
    if (bluePoints + redPoints !== 4) {
      return `When time is tied, Overall judge blue_points + red_points must equal 4 (got ${bluePoints} + ${redPoints} = ${bluePoints + redPoints})`;
    }
    return null;
  }
  if (bluePoints + redPoints !== 5) {
    return `blue_points + red_points must equal 5 (got ${bluePoints} + ${redPoints} = ${bluePoints + redPoints})`;
  }
  return null;
}

/**
 * Dual Mogul scoring (5-judge vote system) -- LEGACY / kept for reference.
 *
 * The active scoring model is now calcDualMogulPointSplit above.
 * This function is retained but is no longer called by the scoring routes.
 *
 * @param {Object} params
 * @param {Object} params.blue - Blue course competitor scores
 * @param {Object} params.red - Red course competitor scores
 * @param {number} params.numTlJudges
 * @param {number} params.numAirJudges
 * @returns {Object} winner, vote breakdown, scores
 */
function calcDualMogulResult(params) {
  const {
    blue,   // { tlScores, airJump1Scores, airJump2Scores, dd1, dd2, runTime }
    red,
    numTlJudges = 3,
    numAirJudges = 2,
    paceTime = null,
  } = params;

  // --- T&L votes (each judge must give different score to each skier) ---
  let blueVotes = 0;
  let redVotes = 0;
  const tlVotes = numTlJudges; // 3 or configured count

  for (let i = 0; i < tlVotes; i++) {
    const bScore = blue.tlScores[i] || 0;
    const rScore = red.tlScores[i] || 0;
    if (bScore > rScore) blueVotes++;
    else if (rScore > bScore) redVotes++;
    // No ties allowed -- if equal, flag as error in practice
  }

  // --- Air votes ---
  // Air judges score both competitors; sum of (score * DD) determines who wins air
  const blueAir1 = calcJumpScore(blue.airJump1Scores, blue.dd1);
  const blueAir2 = calcJumpScore(blue.airJump2Scores, blue.dd2);
  const redAir1  = calcJumpScore(red.airJump1Scores, red.dd1);
  const redAir2  = calcJumpScore(red.airJump2Scores, red.dd2);

  const blueAirTotal = roundToHundredth(blueAir1 + blueAir2);
  const redAirTotal  = roundToHundredth(redAir1 + redAir2);

  const airVotes = numAirJudges * 3; // 6 air votes available
  let blueAirVotes = 0;
  let redAirVotes = 0;

  if (Math.abs(blueAirTotal - redAirTotal) < 0.001) {
    // Air tie -- no air votes awarded
  } else if (blueAirTotal > redAirTotal) {
    blueAirVotes = airVotes;
  } else {
    redAirVotes = airVotes;
  }

  blueVotes += blueAirVotes;
  redVotes  += redAirVotes;

  // --- Speed votes ---
  const speedVotes = 6; // always 6 speed votes
  let blueSpeedVotes = 0;
  let redSpeedVotes = 0;

  if (blue.runTime && red.runTime) {
    if (blue.runTime < red.runTime) {
      blueSpeedVotes = speedVotes;
    } else if (red.runTime < blue.runTime) {
      redSpeedVotes = speedVotes;
    } else {
      // Speed tie -- split votes
      blueSpeedVotes = speedVotes / 2;
      redSpeedVotes = speedVotes / 2;
    }
  }

  blueVotes += blueSpeedVotes;
  redVotes  += redSpeedVotes;

  const winner = blueVotes > redVotes ? 'blue' : 'red';

  return {
    winner,
    blueVotes,
    redVotes,
    breakdown: {
      tlVotes: { blue: blueVotes - blueAirVotes - blueSpeedVotes, red: redVotes - redAirVotes - redSpeedVotes },
      airVotes: { blue: blueAirVotes, red: redAirVotes, blueTotal: blueAirTotal, redTotal: redAirTotal },
      speedVotes: { blue: blueSpeedVotes, red: redSpeedVotes },
    },
  };
}

/**
 * Calculate aerials score for a complete run (two jumps).
 *
 * Formula:
 *   jump_air_score = avg(air_judges) * DD  (drop high/low if 3 judges)
 *   form_score     = avg(form_judges)       (drop high/low if 3 judges)
 *   landing_score  = avg(landing_judges)    (drop high/low if 3 judges)
 *   total = jump1_air + jump2_air + form + landing
 *
 * @param {Object} params
 * @param {number[]} params.airJump1Scores  - Air judge scores for jump 1 (0-10 each)
 * @param {number}   params.dd1             - DD for jump 1
 * @param {number[]} params.airJump2Scores  - Air judge scores for jump 2 (0-10 each)
 * @param {number}   params.dd2             - DD for jump 2
 * @param {number[]} params.formScores      - Form judge scores (0-10 each)
 * @param {number[]} params.landingScores   - Landing judge scores (0-10 each)
 * @returns {Object} Full aerials scoring breakdown
 */
function calcAerialsScore(params) {
  const {
    airJump1Scores = [],
    dd1 = 0,
    airJump2Scores = [],
    dd2 = 0,
    formScores = [],
    landingScores = [],
  } = params;

  const airAvg1 = airJump1Scores.length > 0 ? dropHighLow(airJump1Scores) : 0;
  const airAvg2 = airJump2Scores.length > 0 ? dropHighLow(airJump2Scores) : 0;

  const jump1Air = floorToHundredth(airAvg1 * (dd1 || 0));
  const jump2Air = floorToHundredth(airAvg2 * (dd2 || 0));
  const airTotal = floorToHundredth(jump1Air + jump2Air);

  const formScore    = floorToHundredth(formScores.length    > 0 ? dropHighLow(formScores)    : 0);
  const landingScore = floorToHundredth(landingScores.length > 0 ? dropHighLow(landingScores) : 0);

  const total = floorToHundredth(airTotal + formScore + landingScore);

  // v1.18.01 — Pre-DD raw air execution score for USSS 4110.4.3 tie-break.
  // Simple mean per jump (no drop H/L, no DD, no cap). 1-jump events double the
  // single jump's average so the value remains comparable to 2-jump runs.
  const meanRaw1 = airJump1Scores.length > 0 ? airJump1Scores.reduce((a, b) => a + b, 0) / airJump1Scores.length : 0;
  const meanRaw2 = airJump2Scores.length > 0 ? airJump2Scores.reduce((a, b) => a + b, 0) / airJump2Scores.length : 0;
  const airNoDdRaw = airJump2Scores.length === 0 ? meanRaw1 * 2 : meanRaw1 + meanRaw2;
  const airNoDd = floorToHundredth(airNoDdRaw);

  return {
    jump1Air,
    jump2Air,
    airTotal,
    airNoDd,
    formScore,
    landingScore,
    total,
    // Map to the standard column names used in the runs table
    turnsContrib:  formScore,       // stored in turns_score column
    airContrib:    airTotal,        // stored in air_score column
    speedContrib:  landingScore,    // stored in speed_score column
  };
}

/**
 * Calculate aerials score (v2 — per-judge-per-jump model, v1.18.00).
 *
 * Each scoring judge submits Air, Form, and Landing for each jump.
 * Per FIS Judging Handbook 6002/6003.1:
 *   - Air ranges 0.0-2.0
 *   - Form ranges 0.0-5.0
 *   - Landing ranges 0.0-3.0
 *
 * Reduction:
 *   panelSize >= 5: drop 1 high + 1 low per component, sum the rest
 *   panelSize 2..4: apply operator-selected reductionMethod:
 *     'sum_all' (default) — sum all judges
 *     'drop_high'         — drop one highest, sum rest
 *     'drop_low'          — drop one lowest, sum rest
 *     'average'           — mean of all judges
 *
 * Per jump: total = (sumKeptAir + sumKeptForm + sumKeptLand) * DD, floored to 2dp.
 * Event total = sum across jumps.
 *
 * @param {Object} params
 * @param {Array<{judge_number:number, jump:number, air:number, form:number, landing:number}>} params.judgeScores
 * @param {number} params.dd1
 * @param {number} params.dd2
 * @param {number} params.panelSize  number of scoring judges
 * @param {string} [params.reductionMethod]  required only when panelSize <= 4
 * @param {number} [params.numJumps]  defaults to 2
 * @returns {Object} { jump1Score, jump2Score, total, perComponent, kept, dropped }
 */
function calcAerialsScoreV2(params) {
  const {
    judgeScores = [],
    dd1 = 0,
    dd2 = 0,
    panelSize = 0,
    reductionMethod = 'sum_all',
    numJumps = 2,
  } = params;

  function reduce(values) {
    if (!values || values.length === 0) return { kept: [], dropped: [], sum: 0 };
    if (panelSize >= 5 && values.length >= 3) {
      const sorted = [...values].sort((a, b) => a - b);
      const dropped = [sorted[0], sorted[sorted.length - 1]];
      const kept = sorted.slice(1, -1);
      return { kept, dropped, sum: kept.reduce((a, b) => a + b, 0) };
    }
    // Reduced panel (2-4) — apply selected method
    const sorted = [...values].sort((a, b) => a - b);
    if (reductionMethod === 'drop_low' && values.length >= 2) {
      const kept = sorted.slice(1);
      return { kept, dropped: [sorted[0]], sum: kept.reduce((a, b) => a + b, 0) };
    }
    if (reductionMethod === 'drop_high' && values.length >= 2) {
      const kept = sorted.slice(0, -1);
      return { kept, dropped: [sorted[sorted.length - 1]], sum: kept.reduce((a, b) => a + b, 0) };
    }
    if (reductionMethod === 'average') {
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      return { kept: [...values], dropped: [], sum: mean };
    }
    // sum_all (default)
    return { kept: [...values], dropped: [], sum: values.reduce((a, b) => a + b, 0) };
  }

  function scoreJump(jumpNum, dd) {
    const rows = judgeScores.filter(r => r.jump === jumpNum);
    const air  = rows.map(r => Number(r.air)  || 0);
    const form = rows.map(r => Number(r.form) || 0);
    const land = rows.map(r => Number(r.landing) || 0);

    const ra = reduce(air);
    const rf = reduce(form);
    const rl = reduce(land);

    const totalJudgesScore = ra.sum + rf.sum + rl.sum;
    const jumpScore = floorToHundredth(totalJudgesScore * (dd || 0));

    return {
      jumpScore,
      airSum: floorToHundredth(ra.sum),
      formSum: floorToHundredth(rf.sum),
      landSum: floorToHundredth(rl.sum),
      kept:    { air: ra.kept,    form: rf.kept,    landing: rl.kept },
      dropped: { air: ra.dropped, form: rf.dropped, landing: rl.dropped },
    };
  }

  const j1 = scoreJump(1, dd1);
  const j2 = numJumps >= 2 ? scoreJump(2, dd2) : null;

  const total = floorToHundredth(j1.jumpScore + (j2 ? j2.jumpScore : 0));

  // v1.18.01 — Pre-DD raw air execution score for USSS 4110.4.3 tie-break.
  // Simple mean of per-judge air per jump (no drop H/L, no DD, no cap). 1-jump
  // events double the single jump's average to remain comparable to 2-jump runs.
  const air1Vals = judgeScores.filter(r => r.jump === 1).map(r => Number(r.air) || 0);
  const air2Vals = judgeScores.filter(r => r.jump === 2).map(r => Number(r.air) || 0);
  const meanAir1 = air1Vals.length > 0 ? air1Vals.reduce((a, b) => a + b, 0) / air1Vals.length : 0;
  const meanAir2 = air2Vals.length > 0 ? air2Vals.reduce((a, b) => a + b, 0) / air2Vals.length : 0;
  const airNoDdRaw = (numJumps >= 2 && air2Vals.length > 0) ? meanAir1 + meanAir2 : meanAir1 * 2;
  const airNoDd = floorToHundredth(airNoDdRaw);

  return {
    jump1Score: j1.jumpScore,
    jump2Score: j2 ? j2.jumpScore : 0,
    total,
    airNoDd,
    // Aggregates that map to the existing runs columns:
    airTotal:     floorToHundredth(j1.airSum  + (j2 ? j2.airSum  : 0)),
    formScore:    floorToHundredth(j1.formSum + (j2 ? j2.formSum : 0)),
    landingScore: floorToHundredth(j1.landSum + (j2 ? j2.landSum : 0)),
    perJump: { jump1: j1, jump2: j2 },
    // Map to standard column names (back-compat with results/scoreboard/overlay):
    turnsContrib: floorToHundredth(j1.formSum + (j2 ? j2.formSum : 0)),
    airContrib:   floorToHundredth(j1.airSum  + (j2 ? j2.airSum  : 0)),
    speedContrib: floorToHundredth(j1.landSum + (j2 ? j2.landSum : 0)),
  };
}

/**
 * Mogul tiebreaker per FIS ICR 4207.3:
 *   1. Higher total score
 *   2. Higher turns score
 *   3. Higher air score WITHOUT Degree of Difficulty (raw execution)
 *   4. Higher speed score (= faster time)
 *   else tied -- listing order falls to ranking standings (handled outside the engine)
 *
 * Manually-entered runs may not have a recorded pre-DD air value; they fall back
 * to the post-DD air_score for this comparison only.
 */
function tieBreakMogul(a, b) {
  const aTotal = a.total_score ?? a.total ?? 0;
  const bTotal = b.total_score ?? b.total ?? 0;
  if (Math.abs(aTotal - bTotal) > 0.001) return bTotal - aTotal;
  const aTurns = a.turns_score ?? a.turnsRaw ?? a.turnsContrib ?? 0;
  const bTurns = b.turns_score ?? b.turnsRaw ?? b.turnsContrib ?? 0;
  if (Math.abs(aTurns - bTurns) > 0.001) return bTurns - aTurns;
  const aAirNoDd = a.air_score_no_dd ?? a.airNoDd ?? a.air_score ?? a.airRaw ?? 0;
  const bAirNoDd = b.air_score_no_dd ?? b.airNoDd ?? b.air_score ?? b.airRaw ?? 0;
  if (Math.abs(aAirNoDd - bAirNoDd) > 0.001) return bAirNoDd - aAirNoDd;
  const aSpeed = a.speed_score ?? a.speedRaw ?? 0;
  const bSpeed = b.speed_score ?? b.speedRaw ?? 0;
  if (Math.abs(aSpeed - bSpeed) > 0.001) return bSpeed - aSpeed;
  return 0;
}

/**
 * Aerials tiebreaker per USSS 4110.4.3:
 *   1. Higher total score
 *   2. Higher air score WITHOUT Degree of Difficulty (raw execution)
 *   3. Higher Form score   (stored in turns_score column for aerials)
 *   4. Higher Landing score (stored in speed_score column for aerials)
 *   else tied -- ranking falls to standings (handled outside the engine)
 *
 * Manually-entered or pre-v1.18.01 runs may not have a recorded pre-DD air
 * value; they fall back to the post-DD air_score for this comparison only.
 */
function tieBreakAerials(a, b) {
  const aTotal = a.total_score ?? a.total ?? 0;
  const bTotal = b.total_score ?? b.total ?? 0;
  if (Math.abs(aTotal - bTotal) > 0.001) return bTotal - aTotal;
  const aAirNoDd = a.air_score_no_dd ?? a.airNoDd ?? a.air_score ?? a.airRaw ?? 0;
  const bAirNoDd = b.air_score_no_dd ?? b.airNoDd ?? b.air_score ?? b.airRaw ?? 0;
  if (Math.abs(aAirNoDd - bAirNoDd) > 0.001) return bAirNoDd - aAirNoDd;
  const aForm = a.turns_score ?? a.turnsRaw ?? a.formScore ?? 0;
  const bForm = b.turns_score ?? b.turnsRaw ?? b.formScore ?? 0;
  if (Math.abs(aForm - bForm) > 0.001) return bForm - aForm;
  const aLanding = a.speed_score ?? a.speedRaw ?? a.landingScore ?? 0;
  const bLanding = b.speed_score ?? b.speedRaw ?? b.landingScore ?? 0;
  if (Math.abs(aLanding - bLanding) > 0.001) return bLanding - aLanding;
  return 0;
}

// Backwards-compatible alias -- defaults to mogul (FIS) ordering.
const tieBreak = tieBreakMogul;

/**
 * Sort and rank an array of run results.
 * @param {Object[]} results
 * @param {string} [discipline] - 'mogul' (default, FIS ICR 4207.3) or 'aerials'
 */
function rankResults(results, discipline) {
  const cmp = discipline === 'aerials' ? tieBreakAerials : tieBreakMogul;
  const sorted = [...results].sort((a, b) => cmp(a, b));
  let rank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && cmp(sorted[i], sorted[i - 1]) !== 0) {
      rank = i + 1;
    }
    sorted[i].rank = rank;
    sorted[i].tied = i > 0 && cmp(sorted[i], sorted[i - 1]) === 0;
  }
  return sorted;
}

/**
 * Take the top-N from a ranked list (output of rankResults), expanding the cut
 * to include all athletes tied at the boundary rank. Per ICR 4207.3.4, when
 * athletes tie at the cut line, all of them advance. Example: target=16 with
 * ranks 1..15 then a 2-way tie at rank 16 -> returns 17 athletes (all rank<=16).
 *
 * @param {Object[]} ranked - output of rankResults (each item has .rank)
 * @param {number} n        - target size (configured cut)
 * @returns {Object[]} all athletes with rank <= rank-of-Nth-athlete
 */
function takeUpToRank(ranked, n) {
  if (!Array.isArray(ranked) || ranked.length === 0 || n <= 0) return [];
  if (n >= ranked.length) return ranked.slice();
  const cutoff = ranked[n - 1].rank;
  if (cutoff == null) return ranked.slice(0, n); // defensive -- shouldn't occur
  return ranked.filter(r => r.rank != null && r.rank <= cutoff);
}

function roundToHundredth(n) {
  return Math.round(n * 100) / 100;
}

function floorToHundredth(n) {
  return Math.floor(n * 100) / 100;
}

// Pick the best run per key from a flat array of runs, using the discipline's
// FIS-compliant tie-break to resolve equal-total cases (ICR 4207.3 for mogul;
// aerials uses Total → Air → Turns → Speed). Returns an object keyed by keyFn.
function pickBestRun(runs, discipline, keyFn = r => r.registration_id) {
  const cmp = discipline === 'aerials' ? tieBreakAerials : tieBreakMogul;
  const best = {};
  for (const r of runs) {
    const k = keyFn(r);
    if (k == null) continue;
    const cur = best[k];
    if (!cur || cmp(r, cur) < 0) best[k] = r;
  }
  return best;
}

// Apply Olympic-style skip ranking to a tier of athletes already ordered by
// the discipline's tie-break (e.g. output of rankResults), starting at
// startRank. Tied athletes share a rank; the next rank skips by the size of
// the tied group. Returns startRank + athletes.length so the caller can chain
// tiers (Final 2 → Final 1 → Qualifier).
function applyTierRanks(athletes, discipline, startRank) {
  const cmp = discipline === 'aerials' ? tieBreakAerials : tieBreakMogul;
  let rank = startRank;
  for (let i = 0; i < athletes.length; i++) {
    if (i > 0 && cmp(athletes[i], athletes[i - 1]) !== 0) {
      rank = startRank + i;
    }
    athletes[i].rank = rank;
  }
  return startRank + athletes.length;
}

module.exports = {
  calcMogulScore,
  calcAerialsScore,
  calcAerialsScoreV2,
  calcDualMogulResult,
  calcDualMogulPointSplit,
  validateDualPointSplit,
  calcTurnsScore,
  calcJumpScore,
  calcSpeedScore,
  calcPaceTime,
  dropHighLow,
  areJumpsRepeats,
  applyRepeatJumpRule,
  rankResults,
  takeUpToRank,
  tieBreak,
  tieBreakMogul,
  tieBreakAerials,
  pickBestRun,
  applyTierRanks,
  roundToHundredth,
  floorToHundredth,
};
