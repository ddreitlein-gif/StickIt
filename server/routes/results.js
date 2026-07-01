const router = require('express').Router({ mergeParams: true });
const { queryAll, queryOne } = require('../db/schema');
const { rankResults, pickBestRun, assembleTieredResults, makeTierKeyForRun } = require('../scoring/engine');
const { computeDualFfsp } = require('../dual/ffsp');
const { rankDualPlacements } = require('../dual/placement_ranking');

// Shared helper: ranked results for a single run_number
async function rankedRunResults(eventId, runNumber, discipline) {
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
  return rankResults(runs, discipline);
}

// Shared helper: best score per athlete across multiple run_numbers
async function bestScoreResults(eventId, runNumbers, discipline) {
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
  const best = pickBestRun(runs, discipline);
  return rankResults(Object.values(best), discipline);
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

      const placed = rankDualPlacements({
        bracket,
        meetDate: meet?.date,
        isSeededGroups: true,
      });

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
      const discipline = event ? event.discipline : 'mogul';

      if (format === 'best_of_2') {
        const runNumbers = phases.map(p => p.run_number);
        const results = await bestScoreResults(eventId, runNumbers, discipline);
        const flaggedRuns = await queryAll(
          `SELECT r.*, reg.bib_number, a.first_name, a.last_name, a.ussa_num, a.club
           FROM runs r JOIN registrations reg ON reg.id=r.registration_id JOIN athletes a ON a.id=reg.athlete_id
           WHERE r.event_id=? AND r.status='complete' AND r.run_status IS NOT NULL`, [eventId]
        );
        // One tier spanning both runs: scored -> DNF -> RNS -> DNS, then DSQ.
        // Multi-run statuses resolve by precedence (DSQ > DNF > RNS > DNS).
        return res.json(assembleTieredResults({
          tiers: [{ key: null, label: null, scoredRuns: results }],
          flaggedRuns,
          discipline,
        }));
      }

      if (format === 'qualifier_finals') {
        const f2 = phases.find(p => p.phase_type === 'final_2');
        const f1 = phases.find(p => p.phase_type === 'final_1');
        const qualRunNumbers = phases.filter(p => p.phase_type === 'run' || p.phase_type === 'qualifier_2').map(p => p.run_number);

        // Tier descriptors, highest first. Flagged athletes place at the
        // bottom of the tier they claim (highest phase they appeared in,
        // USSS 4012.3), consuming places so lower tiers continue numbering.
        // DSQ is event-scoped: absolute bottom, tagged tier 'flagged'.
        const tiers = [];
        if (f2 && f2.status === 'finalized') {
          tiers.push({ key: 'final_2', label: 'Final 2', runNumbers: [f2.run_number],
            scoredRuns: await rankedRunResults(eventId, f2.run_number, discipline) });
        }
        if (f1) {
          tiers.push({ key: 'final_1', label: 'Final 1', runNumbers: [f1.run_number],
            scoredRuns: await rankedRunResults(eventId, f1.run_number, discipline) });
        }
        if (qualRunNumbers.length > 0) {
          tiers.push({ key: 'qualifier', label: 'Qualification', runNumbers: qualRunNumbers,
            scoredRuns: await bestScoreResults(eventId, qualRunNumbers, discipline) });
        }

        const flaggedRuns = await queryAll(
          `SELECT r.*, reg.bib_number, a.first_name, a.last_name, a.ussa_num, a.club
           FROM runs r JOIN registrations reg ON reg.id=r.registration_id JOIN athletes a ON a.id=reg.athlete_id
           WHERE r.event_id=? AND r.status='complete' AND r.run_status IS NOT NULL`, [eventId]
        );

        return res.json(assembleTieredResults({
          tiers, flaggedRuns, tierKeyForRun: makeTierKeyForRun(tiers), discipline,
        }));
      }

      // Single phase - rank run 1, statused athletes at the bottom in order
      const results = await rankedRunResults(eventId, 1, discipline);
      const flaggedRuns = await queryAll(
        `SELECT r.*, reg.bib_number, a.first_name, a.last_name, a.ussa_num, a.club
         FROM runs r JOIN registrations reg ON reg.id=r.registration_id JOIN athletes a ON a.id=reg.athlete_id
         WHERE r.event_id=? AND r.status='complete' AND r.run_status IS NOT NULL`, [eventId]
      );
      return res.json(assembleTieredResults({
        tiers: [{ key: null, label: null, scoredRuns: results }],
        flaggedRuns,
        discipline,
      }));
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

    const discipline = event ? event.discipline : 'mogul';
    const best = pickBestRun(scored, discipline);

    // Single tier: scored -> DNF -> RNS (legacy) -> DNS, then DSQ at the
    // bottom. Statused athletes carry numeric ranks (competition ranking);
    // display surfaces keep printing the status code via run_status.
    res.json(assembleTieredResults({
      tiers: [{ key: null, label: null, scoredRuns: Object.values(best) }],
      flaggedRuns: flagged,
      discipline,
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /judge-scores — bulk per-judge scores + all runs for scoreboard detail view
router.get('/judge-scores', async (req, res) => {
  try {
    const eventId = req.params.eventId;

    // All per-judge scores keyed by run_id
    const scores = await queryAll(
      `SELECT js.run_id, js.score_type, js.raw_score, j.role, j.judge_number, j.name
       FROM judge_scores js
       JOIN judges j ON j.id = js.judge_id
       WHERE js.run_id IN (
         SELECT id FROM runs WHERE event_id=?
       )
       ORDER BY js.run_id, j.judge_number, j.role, js.score_type`,
      [eventId]
    );

    const judgeScores = {};
    for (const s of scores) {
      if (!judgeScores[s.run_id]) judgeScores[s.run_id] = { tl: [], air1: [], air2: [], aeRows: [] };
      const entry = judgeScores[s.run_id];
      if (s.score_type === 'turns' && /^TL/i.test(s.role)) {
        entry.tl.push(s.raw_score);
      } else if (s.score_type === 'air_jump1') {
        entry.air1.push(s.raw_score);
      } else if (s.score_type === 'air_jump2') {
        entry.air2.push(s.raw_score);
      } else if (/^ae_/.test(s.score_type)) {
        // v1.18.00 — Aerials v2 per-judge-per-jump structure
        entry.aeRows.push({
          judge_number: s.judge_number,
          name: s.name,
          score_type: s.score_type,
          raw_score: s.raw_score,
        });
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
