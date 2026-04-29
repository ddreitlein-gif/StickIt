const router = require('express').Router({ mergeParams: true });
const { queryAll, queryOne } = require('../db/schema');
const { rankResults } = require('../scoring/engine');
const { computeDualFfsp } = require('../dual/ffsp');

// Shared helper: ranked results for a single run_number
async function rankedRunResults(eventId, runNumber) {
  const runs = await queryAll(
    `SELECT r.*, reg.bib_number, reg.seed, a.first_name, a.last_name, a.ussa_num, a.nation, a.fis_id, a.club,
            r.tl_carving, r.tl_abext, r.tl_upper_body, r.tl_deduction
     FROM runs r
     JOIN registrations reg ON reg.id = r.registration_id
     JOIN athletes a ON a.id = reg.athlete_id
     WHERE r.event_id = ? AND r.run_number = ? AND r.status = 'complete' AND r.run_status IS NULL
     ORDER BY r.total_score DESC`,
    [eventId, runNumber]
  );
  return rankResults(runs);
}

// Shared helper: best score per athlete across multiple run_numbers
async function bestScoreResults(eventId, runNumbers) {
  const placeholders = runNumbers.map(() => '?').join(',');
  const runs = await queryAll(
    `SELECT r.*, reg.bib_number, reg.seed, a.first_name, a.last_name, a.ussa_num, a.nation, a.fis_id, a.club,
            r.tl_carving, r.tl_abext, r.tl_upper_body, r.tl_deduction
     FROM runs r
     JOIN registrations reg ON reg.id = r.registration_id
     JOIN athletes a ON a.id = reg.athlete_id
     WHERE r.event_id = ? AND r.run_number IN (${placeholders}) AND r.status = 'complete' AND r.run_status IS NULL
     ORDER BY r.total_score DESC`,
    [eventId, ...runNumbers]
  );
  const best = {};
  for (const r of runs) {
    if (!best[r.registration_id] || r.total_score > best[r.registration_id].total_score) {
      best[r.registration_id] = r;
    }
  }
  return rankResults(Object.values(best));
}

function getFormat(phases) {
  if (!phases || phases.length === 0) return 'none';
  const types = phases.map(p => p.phase_type);
  if (types.includes('final_1') || types.includes('final_2') || types.includes('qualifier_2')) return 'qualifier_finals';
  if (types.includes('best_of_2')) return 'best_of_2';
  return 'single';
}

router.get('/', async (req, res) => {
  try {
    const { round = 'qualification' } = req.query;
    const eventId = req.params.eventId;

    // Check if this is a dual mogul event — derive placements from bracket
    const event = await queryOne('SELECT id, discipline, meet_id, status, is_divisional FROM events WHERE id=?', [eventId]);
    if (event && event.discipline === 'dual_mogul') {
      const meet = await queryOne('SELECT date FROM meets WHERE id=?', [event.meet_id]);
      const bracket = await queryAll(
        `SELECT db.*,
          ab.first_name as blue_first, ab.last_name as blue_last, rb.bib_number as blue_bib,
          ab.gender as blue_gender, ab.birth_year as blue_birth_year, ab.club as blue_club,
          ar.first_name as red_first, ar.last_name as red_last, rr.bib_number as red_bib,
          ar.gender as red_gender, ar.birth_year as red_birth_year, ar.club as red_club,
          rb.dual_seed as blue_dual_seed, rr.dual_seed as red_dual_seed,
          rb.status as blue_reg_status, rr.status as red_reg_status,
          (SELECT SUM(djp.blue_points) FROM dual_judge_points djp WHERE djp.match_id = db.id) as blue_total,
          (SELECT SUM(djp.red_points)  FROM dual_judge_points djp WHERE djp.match_id = db.id) as red_total
         FROM dual_bracket db
         LEFT JOIN registrations rb ON rb.id = db.registration_id_blue
         LEFT JOIN athletes ab ON ab.id = rb.athlete_id
         LEFT JOIN registrations rr ON rr.id = db.registration_id_red
         LEFT JOIN athletes ar ON ar.id = rr.athlete_id
         WHERE db.event_id = ?
         ORDER BY db.bracket_round DESC, db.bracket_position`,
        [eventId]
      );

      if (!bracket.length) return res.json([]);

      const placed = [];
      const placedRegIds = new Set();

      function computeAgeGroup(birthYear) {
        if (!birthYear) return '';
        const d = meet?.date ? new Date(meet.date) : new Date();
        // Season runs July 1 – June 30; use the July year as reference
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

      function addAthlete(place, regId, first, last, bib, gender, birthYear, club, runStatus, regStatus) {
        if (!regId || placedRegIds.has(regId)) return;
        placedRegIds.add(regId);
        const gp = (gender || '').charAt(0).toUpperCase() + computeAgeGroup(birthYear);
        placed.push({
          rank: place,
          registration_id: regId,
          bib_number: bib || '',
          gp,
          first_name: first || '',
          last_name: last || '',
          club: club || '',
          run_status: runStatus || null,
          reg_status: regStatus || null,
        });
      }

      // Championship final (round 1, not small final)
      const final1 = bracket.find(m => m.bracket_round === 1 && !m.is_small_final);
      if (final1 && final1.status === 'complete') {
        const winnerIsBlue = final1.winner_registration_id === final1.registration_id_blue;
        if (winnerIsBlue) {
          addAthlete(1, final1.registration_id_blue, final1.blue_first, final1.blue_last, final1.blue_bib, final1.blue_gender, final1.blue_birth_year, final1.blue_club, null, final1.blue_reg_status);
          addAthlete(2, final1.registration_id_red, final1.red_first, final1.red_last, final1.red_bib, final1.red_gender, final1.red_birth_year, final1.red_club, final1.loser_status || null, final1.red_reg_status);
        } else {
          addAthlete(1, final1.registration_id_red, final1.red_first, final1.red_last, final1.red_bib, final1.red_gender, final1.red_birth_year, final1.red_club, null, final1.red_reg_status);
          addAthlete(2, final1.registration_id_blue, final1.blue_first, final1.blue_last, final1.blue_bib, final1.blue_gender, final1.blue_birth_year, final1.blue_club, final1.loser_status || null, final1.blue_reg_status);
        }
      }

      // Consolation matches (3rd/4th, 5th/6th, 7th/8th)
      const consolMatches = bracket
        .filter(m => m.is_small_final)
        .sort((a, b) => a.bracket_position - b.bracket_position);
      const consolPlaces = [3, 5, 7];
      consolMatches.forEach((m, i) => {
        if (m.status !== 'complete') return;
        const startPlace = consolPlaces[i] || (3 + i * 2);
        const winnerIsBlue = m.winner_registration_id === m.registration_id_blue;
        if (winnerIsBlue) {
          addAthlete(startPlace, m.registration_id_blue, m.blue_first, m.blue_last, m.blue_bib, m.blue_gender, m.blue_birth_year, m.blue_club, null, m.blue_reg_status);
          addAthlete(startPlace + 1, m.registration_id_red, m.red_first, m.red_last, m.red_bib, m.red_gender, m.red_birth_year, m.red_club, m.loser_status || null, m.red_reg_status);
        } else {
          addAthlete(startPlace, m.registration_id_red, m.red_first, m.red_last, m.red_bib, m.red_gender, m.red_birth_year, m.red_club, null, m.red_reg_status);
          addAthlete(startPlace + 1, m.registration_id_blue, m.blue_first, m.blue_last, m.blue_bib, m.blue_gender, m.blue_birth_year, m.blue_club, m.loser_status || null, m.blue_reg_status);
        }
      });

      // Remaining losers: ordered by round proximity to final, then by match
      // judge points (higher = better), then by seed as tiebreaker
      const mainCompleted = bracket
        .filter(m => !m.is_small_final && m.status === 'complete' && m.bracket_round > 1)
        .sort((a, b) => a.bracket_round - b.bracket_round || a.bracket_position - b.bracket_position);
      let nextPlace = placed.length + 1;
      const roundGroups = {};
      for (const m of mainCompleted) {
        if (!roundGroups[m.bracket_round]) roundGroups[m.bracket_round] = [];
        const loserIsBlue = m.winner_registration_id !== m.registration_id_blue;
        if (loserIsBlue && m.registration_id_blue && !placedRegIds.has(m.registration_id_blue)) {
          const pts = m.loser_status ? -1 : (m.blue_total || 0);
          roundGroups[m.bracket_round].push({ regId: m.registration_id_blue, first: m.blue_first, last: m.blue_last, bib: m.blue_bib, gender: m.blue_gender, birthYear: m.blue_birth_year, club: m.blue_club, seed: m.blue_dual_seed || 999, points: pts, loser_status: m.loser_status || null, reg_status: m.blue_reg_status });
        } else if (!loserIsBlue && m.registration_id_red && !placedRegIds.has(m.registration_id_red)) {
          const pts = m.loser_status ? -1 : (m.red_total || 0);
          roundGroups[m.bracket_round].push({ regId: m.registration_id_red, first: m.red_first, last: m.red_last, bib: m.red_bib, gender: m.red_gender, birthYear: m.red_birth_year, club: m.red_club, seed: m.red_dual_seed || 999, points: pts, loser_status: m.loser_status || null, reg_status: m.red_reg_status });
        }
      }
      const roundKeys = Object.keys(roundGroups).map(Number).sort((a, b) => a - b);
      for (const round of roundKeys) {
        const losers = roundGroups[round].sort((a, b) => {
          if (b.points !== a.points) return b.points - a.points;
          return (a.seed || 999) - (b.seed || 999);
        });
        for (const l of losers) {
          addAthlete(nextPlace, l.regId, l.first, l.last, l.bib, l.gender, l.birthYear, l.club, l.loser_status, l.reg_status);
          nextPlace++;
        }
      }

      // FFSP: only when event is complete
      if (event.status === 'complete') {
        const ffspMap = computeDualFfsp({ event, bracket, placements: placed });
        for (const p of placed) {
          const entry = ffspMap.get(p.registration_id);
          if (entry) p.ffsp = entry.ffsp;
        }
      }

      return res.json(placed);
    }

    // Check if this event has phases
    const phases = await queryAll(
      `SELECT * FROM event_phases WHERE event_id=? ORDER BY sequence_order`, [eventId]
    );

    if (phases.length > 0) {
      const format = getFormat(phases);

      if (format === 'best_of_2') {
        const runNumbers = phases.map(p => p.run_number);
        const results = await bestScoreResults(eventId, runNumbers);
        // Flagged
        const flaggedRuns = await queryAll(
          `SELECT r.*, reg.bib_number, a.first_name, a.last_name, a.ussa_num, a.club
           FROM runs r JOIN registrations reg ON reg.id=r.registration_id JOIN athletes a ON a.id=reg.athlete_id
           WHERE r.event_id=? AND r.status='complete' AND r.run_status IS NOT NULL`, [eventId]
        );
        const scoredIds = new Set(results.map(r => r.registration_id));
        const flagged = {};
        for (const r of flaggedRuns) {
          if (!scoredIds.has(r.registration_id)) flagged[r.registration_id] = r;
        }
        return res.json([...results, ...Object.values(flagged).map(r => ({ ...r, rank: null }))]);
      }

      if (format === 'qualifier_finals') {
        const f2 = phases.find(p => p.phase_type === 'final_2');
        const f1 = phases.find(p => p.phase_type === 'final_1');
        const qualRunNumbers = phases.filter(p => p.phase_type === 'run' || p.phase_type === 'qualifier_2').map(p => p.run_number);

        const tiers = [];
        let globalRank = 1;
        const rankedIds = new Set();

        // Tier 1: Final 2
        if (f2 && f2.status === 'finalized') {
          const f2Results = await rankedRunResults(eventId, f2.run_number);
          for (const r of f2Results) { r.rank = globalRank++; r.tier = 'final_2'; tiers.push(r); rankedIds.add(r.registration_id); }
        }

        // Tier 2: Final 1 not in F2
        if (f1) {
          const f1Results = await rankedRunResults(eventId, f1.run_number);
          for (const r of f1Results.filter(r => !rankedIds.has(r.registration_id))) {
            r.rank = globalRank++; r.tier = 'final_1'; tiers.push(r); rankedIds.add(r.registration_id);
          }
        }

        // Tier 3: Qualifiers not in Finals
        if (qualRunNumbers.length > 0) {
          const qualResults = await bestScoreResults(eventId, qualRunNumbers);
          for (const r of qualResults.filter(r => !rankedIds.has(r.registration_id))) {
            r.rank = globalRank++; r.tier = 'qualifier'; tiers.push(r); rankedIds.add(r.registration_id);
          }
        }

        // Flagged
        const allRuns = await queryAll(
          `SELECT r.*, reg.bib_number, a.first_name, a.last_name, a.ussa_num, a.club
           FROM runs r JOIN registrations reg ON reg.id=r.registration_id JOIN athletes a ON a.id=reg.athlete_id
           WHERE r.event_id=? AND r.status='complete' AND r.run_status IS NOT NULL`, [eventId]
        );
        for (const r of allRuns) {
          if (!rankedIds.has(r.registration_id)) { r.rank = null; r.tier = 'flagged'; tiers.push(r); rankedIds.add(r.registration_id); }
        }

        return res.json(tiers);
      }

      // Single phase - just rank run 1
      const results = await rankedRunResults(eventId, 1);
      return res.json(results);
    }

    // Legacy: no phases
    const runs = await queryAll(
      `SELECT r.*, reg.bib_number, reg.seed, a.first_name, a.last_name, a.ussa_num, a.nation, a.fis_id, a.club,
              r.tl_carving, r.tl_abext, r.tl_upper_body, r.tl_deduction
       FROM runs r
       JOIN registrations reg ON reg.id = r.registration_id
       JOIN athletes a ON a.id = reg.athlete_id
       WHERE r.event_id = ? AND r.round = ? AND r.status = 'complete'
       ORDER BY r.total_score DESC`,
      [eventId, round]
    );

    const flagged = runs.filter(r => r.run_status);
    const scored  = runs.filter(r => !r.run_status);

    const best = {};
    for (const r of scored) {
      if (!best[r.registration_id] || r.total_score > best[r.registration_id].total_score) {
        best[r.registration_id] = r;
      }
    }

    const bestFlag = {};
    for (const r of flagged) {
      if (!best[r.registration_id]) {
        bestFlag[r.registration_id] = r;
      }
    }

    const rankedScored = rankResults(Object.values(best));
    const flaggedList  = Object.values(bestFlag).map(r => ({ ...r, rank: null }));

    res.json([...rankedScored, ...flaggedList]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /judge-scores — bulk per-judge scores + all runs for scoreboard detail view
router.get('/judge-scores', async (req, res) => {
  try {
    const eventId = req.params.eventId;

    // All per-judge scores keyed by run_id
    const scores = await queryAll(
      `SELECT js.run_id, js.score_type, js.raw_score, j.role
       FROM judge_scores js
       JOIN judges j ON j.id = js.judge_id
       WHERE js.run_id IN (
         SELECT id FROM runs WHERE event_id=?
       )
       ORDER BY js.run_id, j.role, js.score_type`,
      [eventId]
    );

    const judgeScores = {};
    for (const s of scores) {
      if (!judgeScores[s.run_id]) judgeScores[s.run_id] = { tl: [], air1: [], air2: [] };
      const entry = judgeScores[s.run_id];
      if (s.score_type === 'turns' && /^TL/i.test(s.role)) {
        entry.tl.push(s.raw_score);
      } else if (s.score_type === 'air_jump1') {
        entry.air1.push(s.raw_score);
      } else if (s.score_type === 'air_jump2') {
        entry.air2.push(s.raw_score);
      }
    }

    // All completed runs for the event
    const runs = await queryAll(
      `SELECT r.id, r.registration_id, r.run_number, r.total_score, r.turns_score, r.air_score,
              r.speed_score, r.run_time, r.run_status, r.jump1_code, r.jump2_code
       FROM runs r
       WHERE r.event_id=? AND r.status='complete'
       ORDER BY r.run_number`,
      [eventId]
    );

    res.json({ judgeScores, runs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
