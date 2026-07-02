'use strict';

const router = require('express').Router({ mergeParams: true });
const cors = require('cors');
const { queryAll, queryOne } = require('../db/schema');

router.use(cors({ origin: '*' }));

// Returns the active run number and phase info for an event.
// Prioritises in_progress → most recently complete → last not_started.
async function getActiveRound(eventId) {
  const phase = await queryOne(
    `SELECT id, run_number, label FROM event_phases
     WHERE event_id = ?
     ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'complete' THEN 1 ELSE 2 END,
              sequence_order DESC
     LIMIT 1`,
    [eventId]
  );
  if (phase) return { runNumber: phase.run_number, phaseId: phase.id, phaseLabel: phase.label };

  const rrs = await queryOne(
    `SELECT run_number FROM run_round_status WHERE event_id = ?
     ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'complete' THEN 1 ELSE 2 END,
              run_number DESC
     LIMIT 1`,
    [eventId]
  );
  const n = rrs ? rrs.run_number : 1;
  return { runNumber: n, phaseId: null, phaseLabel: `Run ${n}` };
}

// ── Route 1: Event List ──────────────────────────────────────────────────────
// GET /api/viewer/events?status=<optional filter>
router.get('/events', async (req, res) => {
  try {
    const { status } = req.query;
    const args = [];
    // v1.25.02 -- hidden events are excluded from the public listing only;
    // resolve/status/results endpoints stay open for direct short-code access
    const where = status
      ? (args.push(status), 'WHERE e.hide_livescores = 0 AND e.status = ?')
      : 'WHERE e.hide_livescores = 0';
    const events = await queryAll(
      `SELECT e.id, e.name, e.status, e.event_date, e.discipline,
              m.name AS meet_name, m.location AS venue, m.date AS meet_date
       FROM events e
       JOIN meets m ON m.id = e.meet_id
       ${where}
       ORDER BY m.date DESC, e.id`,
      args
    );
    res.json(events.map(e => ({
      id: e.id,
      name: e.name,
      discipline: e.discipline,
      meet_name: e.meet_name,
      venue: e.venue,
      date: e.event_date || e.meet_date,
      status: e.status
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Route 5: Short-Code Lookup ───────────────────────────────────────────────
// Registered before /:eventId routes to avoid path ambiguity.
// GET /api/viewer/resolve/:shortCode
router.get('/resolve/:shortCode', async (req, res) => {
  try {
    const event = await queryOne(
      `SELECT e.id, e.name, e.status, e.discipline, e.short_code, e.event_date,
              m.name AS meet_name, m.location AS venue, m.date AS meet_date
       FROM events e
       JOIN meets m ON m.id = e.meet_id
       WHERE e.short_code = ?`,
      [req.params.shortCode]
    );
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json({
      id: event.id,
      name: event.name,
      discipline: event.discipline,
      status: event.status,
      short_code: event.short_code,
      meet_name: event.meet_name,
      venue: event.venue,
      date: event.event_date || event.meet_date
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Route 2: Event Status + Upcoming Athletes ────────────────────────────────
// GET /api/viewer/events/:eventId/status
router.get('/events/:eventId/status', async (req, res) => {
  try {
    const { eventId } = req.params;
    const event = await queryOne(
      'SELECT id, status, discipline FROM events WHERE id = ?',
      [eventId]
    );
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // Athlete currently on course
    const onCourse = await queryOne(
      `SELECT a.first_name, a.last_name, reg.bib_number
       FROM runs r
       JOIN registrations reg ON reg.id = r.registration_id
       JOIN athletes a ON a.id = reg.athlete_id
       WHERE r.event_id = ? AND r.status = 'scoring'
       LIMIT 1`,
      [eventId]
    );

    // Active round (in_progress preferred, then most recent complete)
    const phase = await queryOne(
      `SELECT id, label, run_number FROM event_phases
       WHERE event_id = ?
       ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'complete' THEN 1 ELSE 2 END,
                sequence_order DESC
       LIMIT 1`,
      [eventId]
    );
    const roundFallback = !phase ? await queryOne(
      `SELECT 'Run ' || run_number AS label, run_number
       FROM run_round_status WHERE event_id = ?
       ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'complete' THEN 1 ELSE 2 END,
                run_number DESC
       LIMIT 1`,
      [eventId]
    ) : null;
    const round = phase || roundFallback;

    // Upcoming athletes — next 10 in run order who have not yet started
    let upcoming = [];
    if (round) {
      if (phase) {
        upcoming = await queryAll(
          `SELECT a.first_name, a.last_name, reg.bib_number, pro.run_order
           FROM phase_run_order pro
           JOIN registrations reg ON reg.id = pro.registration_id
           JOIN athletes a ON a.id = reg.athlete_id
           WHERE pro.phase_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM runs r
               WHERE r.registration_id = pro.registration_id
                 AND r.event_id = ?
                 AND r.run_number = ?
                 AND r.status IN ('scoring', 'complete')
             )
           ORDER BY pro.run_order
           LIMIT 10`,
          [phase.id, eventId, phase.run_number]
        );
      } else {
        upcoming = await queryAll(
          `SELECT a.first_name, a.last_name, reg.bib_number, reg.run_order
           FROM registrations reg
           JOIN athletes a ON a.id = reg.athlete_id
           WHERE reg.event_id = ?
             AND reg.status = 'registered'
             AND reg.run_order IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM runs r
               WHERE r.registration_id = reg.id
                 AND r.run_number = ?
                 AND r.status IN ('scoring', 'complete')
             )
           ORDER BY reg.run_order
           LIMIT 10`,
          [eventId, round.run_number]
        );
      }
    }

    res.json({
      event_id: event.id,
      status: event.status,
      current_round: round ? round.label : null,
      current_run_number: round ? round.run_number : null,
      athlete_on_course: onCourse ? {
        bib_number: onCourse.bib_number,
        first_name: onCourse.first_name,
        last_name: onCourse.last_name
      } : null,
      upcoming_athletes: upcoming.map(u => ({
        run_order: u.run_order,
        bib_number: u.bib_number,
        first_name: u.first_name,
        last_name: u.last_name
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Route 6: Per-Judge Score Breakdowns ──────────────────────────────────────
// Registered before /events/:eventId/results to avoid Express swallowing /scores.
// GET /api/viewer/events/:eventId/results/scores
router.get('/events/:eventId/results/scores', async (req, res) => {
  try {
    const { eventId } = req.params;
    const event = await queryOne('SELECT id FROM events WHERE id = ?', [eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const { runNumber } = await getActiveRound(eventId);

    const scores = await queryAll(
      `SELECT js.run_id, js.score_type, js.raw_score,
              j.role, j.judge_number, j.name AS judge_name
       FROM judge_scores js
       JOIN judges j ON j.id = js.judge_id
       WHERE js.run_id IN (
         SELECT id FROM runs
         WHERE event_id = ? AND run_number = ? AND status = 'complete'
       )
       ORDER BY js.run_id, j.judge_number, j.role, js.score_type`,
      [eventId, runNumber]
    );

    // Per-run context so the app can pair each judge's air score with the jump
    // code + the exact DD applied, and show the actual finish time.
    const runRows = await queryAll(
      `SELECT id AS run_id, registration_id, run_time,
              jump1_code, jump1_dd, jump2_code, jump2_dd
       FROM runs
       WHERE event_id = ? AND run_number = ? AND status = 'complete'`,
      [eventId, runNumber]
    );
    const runs = runRows.map(r => ({
      run_id: r.run_id,
      registration_id: r.registration_id,
      run_time: (r.run_time != null && r.run_time >= 0) ? r.run_time : null,
      jump1_code: r.jump1_code || null,
      jump1_dd: r.jump1_dd != null ? r.jump1_dd : null,
      jump2_code: r.jump2_code || null,
      jump2_dd: r.jump2_dd != null ? r.jump2_dd : null
    }));

    res.json({ run_number: runNumber, scores, runs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Route 3: Results ─────────────────────────────────────────────────────────
// GET /api/viewer/events/:eventId/results
router.get('/events/:eventId/results', async (req, res) => {
  try {
    const { eventId } = req.params;
    const event = await queryOne(
      'SELECT id, status, discipline FROM events WHERE id = ?',
      [eventId]
    );
    if (!event) return res.status(404).json({ error: 'Event not found' });

    if (event.discipline === 'dual_mogul') {
      const bracket = await queryAll(
        `SELECT db.id AS id, db.bracket_round, db.bracket_position, db.status AS match_status,
                ab.first_name AS blue_first, ab.last_name AS blue_last, rb.bib_number AS blue_bib,
                ar.first_name AS red_first, ar.last_name AS red_last, rr.bib_number AS red_bib,
                db.winner_registration_id,
                (SELECT SUM(djp.blue_points) FROM dual_judge_points djp WHERE djp.match_id = db.id) AS blue_score,
                (SELECT SUM(djp.red_points)  FROM dual_judge_points djp WHERE djp.match_id = db.id) AS red_score,
                db.is_bye
         FROM dual_bracket db
         LEFT JOIN registrations rb ON rb.id = db.registration_id_blue
         LEFT JOIN athletes ab ON ab.id = rb.athlete_id
         LEFT JOIN registrations rr ON rr.id = db.registration_id_red
         LEFT JOIN athletes ar ON ar.id = rr.athlete_id
         WHERE db.event_id = ?
         ORDER BY db.bracket_round DESC, db.bracket_position`,
        [eventId]
      );
      return res.json({ discipline: 'dual_mogul', bracket });
    }

    const { runNumber } = await getActiveRound(eventId);

    const runs = await queryAll(
      `SELECT r.registration_id, r.total_score, r.turns_score,
              r.air_score, r.speed_score, r.run_status, r.run_time,
              r.jump1_code, r.jump1_dd, r.jump2_code, r.jump2_dd,
              reg.bib_number, a.first_name, a.last_name
       FROM runs r
       JOIN registrations reg ON reg.id = r.registration_id
       JOIN athletes a ON a.id = reg.athlete_id
       WHERE r.event_id = ? AND r.run_number = ? AND r.status = 'complete'
       ORDER BY r.total_score DESC`,
      [eventId, runNumber]
    );

    // Best run per athlete (highest total_score)
    const best = {};
    for (const r of runs) {
      if (!best[r.registration_id] ||
          (r.total_score || 0) > (best[r.registration_id].total_score || 0)) {
        best[r.registration_id] = r;
      }
    }

    const ranked = Object.values(best)
      .sort((a, b) => (b.total_score || 0) - (a.total_score || 0))
      .map((r, i) => ({
        rank: i + 1,
        bib_number: r.bib_number,
        first_name: r.first_name,
        last_name: r.last_name,
        turns_score: r.turns_score,
        air_score: r.air_score,
        time_score: r.speed_score,
        total_score: r.total_score,
        // Actual finish time in seconds. null = No Time (NT) or no timed
        // component (e.g. Devo); time_score above is the derived speed score.
        run_time: (r.run_time != null && r.run_time >= 0) ? r.run_time : null,
        // Jumps as scored: code + the exact DD applied (0 DD means the jump was
        // dropped by the repeat-jump rule).
        jump1_code: r.jump1_code || null,
        jump1_dd: r.jump1_dd != null ? r.jump1_dd : null,
        jump2_code: r.jump2_code || null,
        jump2_dd: r.jump2_dd != null ? r.jump2_dd : null,
        run_status: r.run_status || null
      }));

    res.json({ discipline: event.discipline, results: ranked });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/viewer/events/:eventId/dual-matches/:matchId/judge-points
// v1.26.00 — per-judge blue/red point splits for one dual match, so the iOS
// app can show the tap-to-expand breakdown without touching the internal
// /dual API.
router.get('/events/:eventId/dual-matches/:matchId/judge-points', async (req, res) => {
  try {
    const { eventId, matchId } = req.params;
    const match = await queryOne(
      'SELECT id FROM dual_bracket WHERE id = ? AND event_id = ?',
      [matchId, eventId]
    );
    if (!match) return res.status(404).json({ error: 'Match not found' });

    const rows = await queryAll(
      `SELECT judge_number, blue_points, red_points, time_tied
       FROM dual_judge_points WHERE match_id = ? ORDER BY judge_number`,
      [matchId]
    );
    res.json({ match_id: matchId, judges: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Route 4: Round List ──────────────────────────────────────────────────────
// GET /api/viewer/events/:eventId/rounds
router.get('/events/:eventId/rounds', async (req, res) => {
  try {
    const { eventId } = req.params;
    const event = await queryOne('SELECT id FROM events WHERE id = ?', [eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const phases = await queryAll(
      `SELECT id, label AS round_name, run_number, status
       FROM event_phases WHERE event_id = ?
       ORDER BY sequence_order`,
      [eventId]
    );
    if (phases.length > 0) return res.json(phases);

    // Fallback for events without phases
    const rounds = await queryAll(
      `SELECT event_id || '-' || run_number AS id,
              'Run ' || run_number AS round_name,
              run_number, status
       FROM run_round_status WHERE event_id = ?
       ORDER BY run_number`,
      [eventId]
    );
    res.json(rounds);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
