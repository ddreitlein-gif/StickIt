/**
 * Freestyle Mogul Scoring Engine
 * US Ski & Snowboard Rules
 *
 * Score = Turns (60%) + Air (20%) + Speed (20%)
 *
 * Turns:
 *   - Each T&L judge scores 0.1 to 20.0
 *   - If 3+ judges: drop highest and lowest, average remainder
 *   - If 2 judges: average both
 *   - If 1 judge: use that score
 *   - Turns score = averaged judge score * 0.60 * (20/20) -- already on 20pt scale
 *   - Final turns contribution = avg * turns_weight
 *
 * Air:
 *   - Each jump scored 0-10 by air judge(s)
 *   - Jump score = raw_score * DD
 *   - If 2 air judges: average their scores for each jump
 *   - Air total = (jump1_scored + jump2_scored), max 20 points (FIS cap)
 *   - Air contribution to final = air_total * air_weight (normalized to 20-pt scale then weighted)
 *
 * Speed:
 *   - Speed score = pace_time / actual_time * 15 (capped at 15)
 *   - Or using the Winfree-style formula: speed points proportional to time vs pace
 *
 * Final Score = turns_contribution + air_contribution + speed_contribution
 * Maximum = 20 * 0.60 + 25 * 0.25 + 15 * 0.15... we normalize everything to 100-pt scale
 *
 * Actual formula (matching Winfree):
 *   turns_pts  = drop_high_low(tl_scores_avg) -- on 0-20 scale
 *   air_pts    = sum of (judge_avg_per_jump * DD) for each jump -- max ~25 with DDs
 *   speed_pts  = (pace_time / run_time) * pace_time_factor -- see below
 *   total = turns_pts * turns_weight + air_pts * air_weight + speed_pts * speed_weight
 *
 * But we normalize so max total = 100:
 *   turns max = 20, air max = 25 (FIS pace, roughly), speed max = 15
 *   total = (turns/20)*60 + (air/25)*25 + (speed/15)*15  -- simplified per Winfree
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
    airRaw = floorToHundredth(Math.min(jump1Score + jump2Score, 20.0));
  }
  const airContrib = airRaw; // Already on the correct scale (max ~20 with typical DDs)

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

  return {
    jump1Air,
    jump2Air,
    airTotal,
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
 * Tiebreaker logic for mogul results.
 * US Ski & Snowboard tiebreaker order:
 *   1. Higher total score on best run
 *   2. Higher air score on best run
 *   3. Higher turns score on best run
 *   4. Higher speed score (lower time) on best run
 *   5. Coin flip (flagged for TD decision)
 *
 * @param {Object} a - Run score object for skier A
 * @param {Object} b - Run score object for skier B
 * @returns {number} -1 if a wins, 1 if b wins, 0 if truly tied
 */
function tieBreak(a, b) {
  const aTotal = a.total_score ?? a.total ?? 0;
  const bTotal = b.total_score ?? b.total ?? 0;
  const aAir = a.air_score ?? a.airRaw ?? 0;
  const bAir = b.air_score ?? b.airRaw ?? 0;
  const aTurns = a.turns_score ?? a.turnsRaw ?? 0;
  const bTurns = b.turns_score ?? b.turnsRaw ?? 0;
  const aSpeed = a.speed_score ?? a.speedRaw ?? 0;
  const bSpeed = b.speed_score ?? b.speedRaw ?? 0;
  if (Math.abs(aTotal - bTotal) > 0.001) return bTotal - aTotal;
  if (Math.abs(aAir - bAir) > 0.001) return bAir - aAir;
  if (Math.abs(aTurns - bTurns) > 0.001) return bTurns - aTurns;
  if (Math.abs(aSpeed - bSpeed) > 0.001) return bSpeed - aSpeed;
  return 0; // True tie -- requires TD decision
}

/**
 * Sort and rank an array of run results.
 * Uses tieBreak for equal scores.
 *
 * @param {Object[]} results - Array of {registrationId, ...scoreFields}
 * @returns {Object[]} sorted with rank assigned
 */
function rankResults(results) {
  const sorted = [...results].sort((a, b) => tieBreak(a, b));
  let rank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && tieBreak(sorted[i], sorted[i - 1]) !== 0) {
      rank = i + 1;
    }
    sorted[i].rank = rank;
    sorted[i].tied = i > 0 && tieBreak(sorted[i], sorted[i - 1]) === 0;
  }
  return sorted;
}

function roundToHundredth(n) {
  return Math.round(n * 100) / 100;
}

function floorToHundredth(n) {
  return Math.floor(n * 100) / 100;
}

module.exports = {
  calcMogulScore,
  calcAerialsScore,
  calcDualMogulResult,
  calcDualMogulPointSplit,
  validateDualPointSplit,
  calcTurnsScore,
  calcJumpScore,
  calcSpeedScore,
  calcPaceTime,
  dropHighLow,
  areJumpsRepeats,
  rankResults,
  tieBreak,
  roundToHundredth,
  floorToHundredth,
};
