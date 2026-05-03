const router = require('express').Router({ mergeParams: true });
const { queryAll, queryOne, execute, uuidv4, getClient } = require('../db/schema');
const { calcMogulScore, calcAerialsScore, areJumpsRepeats } = require('../scoring/engine');
const { logAudit } = require('./audit');
const { requireUnlocked } = require('../middleware/lockCheck');
const lockCheck = requireUnlocked();

// Age group helpers for transition messages
function computeAgeClass(birthYear, eventDate) {
  if (!birthYear) return null;
  const d = eventDate ? new Date(eventDate) : new Date();
  const seasonStartYear = d.getMonth() < 6 ? d.getFullYear() - 1 : d.getFullYear();
  const age = seasonStartYear - parseInt(birthYear);
  if (age <= 6) return 'U7';
  if (age <= 8) return 'U9';
  if (age <= 10) return 'U11';
  if (age <= 12) return 'U13';
  if (age <= 14) return 'U15';
  if (age <= 16) return 'U17';
  if (age <= 18) return 'U19';
  if (age <= 20) return 'Sr';
  return 'Vet';
}

// Compute overall rank for an athlete, accounting for multi-phase events (best-of-2, etc.)
async function computeOverallRank(eventId, registrationId, myScore) {
  if (myScore == null) return null;
  try {
    const phases = await queryAll(`SELECT id FROM event_phases WHERE event_id=?`, [eventId]);
    if (phases.length > 0) {
      // Phase-based: rank by each athlete's best score across all runs
      const bestScores = await queryAll(
        `SELECT registration_id, MAX(total_score) as best FROM runs
         WHERE event_id=? AND status='complete' AND run_status IS NULL AND total_score IS NOT NULL
         GROUP BY registration_id`,
        [eventId]
      );
      // Get this athlete's best score across all runs
      const myBest = bestScores.find(r => r.registration_id === registrationId);
      const myBestScore = myBest ? myBest.best : myScore;
      return bestScores.filter(r => r.best > myBestScore).length + 1;
    } else {
      // No phases: rank by individual run score (existing behavior)
      const allComplete = await queryAll(
        `SELECT total_score FROM runs WHERE event_id=? AND status='complete' AND run_status IS NULL AND total_score IS NOT NULL`,
        [eventId]
      );
      return allComplete.filter(r => r.total_score > myScore).length + 1;
    }
  } catch (_) { return null; }
}

async function getAgeGroupTransition(eventId, completedRegistrationId) {
  try {
    const event = await queryOne('SELECT event_date, division FROM events WHERE id=?', [eventId]);
    // Age group transitions only apply to Devo events
    if (event?.division !== 'devo') return null;
    // Get completed athlete's age class
    const completedAthlete = await queryOne(
      `SELECT a.birth_year FROM registrations r JOIN athletes a ON a.id=r.athlete_id WHERE r.id=?`,
      [completedRegistrationId]
    );
    const completedAge = computeAgeClass(completedAthlete?.birth_year, event?.event_date);

    // Get next-up athlete's age class (first unrun athlete by run_order)
    const phases = await queryAll(`SELECT * FROM event_phases WHERE event_id=? ORDER BY sequence_order`, [eventId]);
    let nextAthlete = null;
    if (phases.length > 0) {
      const activePhase = phases.find(p => p.status === 'in_progress') || phases.find(p => p.status === 'not_started');
      if (activePhase) {
        nextAthlete = await queryOne(
          `SELECT a.birth_year FROM phase_run_order pro
           JOIN registrations reg ON reg.id = pro.registration_id
           JOIN athletes a ON a.id = reg.athlete_id
           WHERE pro.phase_id = ? AND reg.status = 'registered'
             AND reg.id NOT IN (SELECT r.registration_id FROM runs r WHERE r.event_id = ? AND r.run_number = ?)
           ORDER BY pro.run_order ASC LIMIT 1`,
          [activePhase.id, eventId, activePhase.run_number]
        );
      }
    } else {
      nextAthlete = await queryOne(
        `SELECT a.birth_year FROM registrations reg
         JOIN athletes a ON a.id = reg.athlete_id
         WHERE reg.event_id = ? AND reg.status = 'registered' AND reg.run_order IS NOT NULL
           AND reg.id NOT IN (SELECT r.registration_id FROM runs r WHERE r.event_id = ? AND r.run_number = 1)
         ORDER BY reg.run_order ASC LIMIT 1`,
        [eventId, eventId]
      );
    }
    const nextAge = computeAgeClass(nextAthlete?.birth_year, event?.event_date);

    if (completedAge && nextAge && completedAge !== nextAge) {
      return { completed: completedAge, next: nextAge };
    }
    // Also check if this was the last athlete (no next) — signal group complete
    if (completedAge && !nextAthlete) {
      return { completed: completedAge, next: null, last: true };
    }
    return null;
  } catch (_) { return null; }
}

// Apply lock check to all mutations on this router
router.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return lockCheck(req, res, next);
  next();
});

// GET all runs for event
router.get('/', async (req, res) => {
  try {
    const { round, status } = req.query;
    let sql = `SELECT r.*, reg.bib_number, a.first_name, a.last_name, a.ussa_num
               FROM runs r
               JOIN registrations reg ON reg.id = r.registration_id
               JOIN athletes a ON a.id = reg.athlete_id
               WHERE r.event_id = ?`;
    const args = [req.params.eventId];
    if (round)  { sql += ' AND r.round=?';  args.push(round); }
    if (status) { sql += ' AND r.status=?'; args.push(status); }
    sql += ' ORDER BY reg.bib_number, r.run_number';
    res.json(await queryAll(sql, args));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET event info (pace_time, course_length, gender, discipline) -- used by Timekeeper / Judge tablets
router.get('/info', async (req, res) => {
  try {
    const event = await queryOne('SELECT pace_time, course_length, gender, discipline, component_scoring, score_entry_mode, num_jumps, division FROM events WHERE id=?', [req.params.eventId]);
    res.json(event ? { pace_time: event.pace_time, course_length: event.course_length, gender: event.gender, discipline: event.discipline, component_scoring: event.component_scoring, score_entry_mode: event.score_entry_mode, num_jumps: event.num_jumps, division: event.division } : null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET next-up athlete (first unrun athlete in run order)
// v1.9.00: Phase-aware — accepts ?run_number=N, uses phase_run_order when phases exist
router.get('/next-up', async (req, res) => {
  try {
    const eventId = req.params.eventId;
    const requestedRunNumber = req.query.run_number ? parseInt(req.query.run_number) : null;

    // Check if event has phases
    const phases = await queryAll(
      `SELECT * FROM event_phases WHERE event_id=? ORDER BY sequence_order`, [eventId]
    );

    if (phases.length > 0) {
      // Find the active phase (in_progress or not_started after a finalized one)
      let activePhase = phases.find(p => p.status === 'in_progress');
      if (!activePhase) {
        // Find the first not_started phase after all finalized ones
        const lastFinalized = [...phases].reverse().find(p => p.status === 'finalized');
        if (lastFinalized) {
          activePhase = phases.find(p => p.sequence_order > lastFinalized.sequence_order && p.status === 'not_started');
        } else {
          activePhase = phases.find(p => p.status === 'not_started');
        }
      }
      // Allow override via query param
      const runNumber = requestedRunNumber || (activePhase ? activePhase.run_number : 1);
      const phase = phases.find(p => p.run_number === runNumber);

      if (phase) {
        // Use phase_run_order for ordering, filter out athletes who already have a run for this run_number
        const next = await queryOne(
          `SELECT reg.id, reg.bib_number, pro.run_order, a.first_name, a.last_name
           FROM phase_run_order pro
           JOIN registrations reg ON reg.id = pro.registration_id
           JOIN athletes a ON a.id = reg.athlete_id
           WHERE pro.phase_id = ? AND reg.status = 'registered'
             AND reg.id NOT IN (SELECT r.registration_id FROM runs r WHERE r.event_id = ? AND r.run_number = ?)
           ORDER BY pro.run_order ASC
           LIMIT 1`,
          [phase.id, eventId, runNumber]
        );
        return res.json(next ? { ...next, run_number: runNumber, phase_label: phase.label } : null);
      }
    }

    // Legacy: no phases — use registrations.run_order
    const runNumber = requestedRunNumber || 1;
    const next = await queryOne(
      `SELECT reg.id, reg.bib_number, reg.run_order, a.first_name, a.last_name
       FROM registrations reg
       JOIN athletes a ON a.id = reg.athlete_id
       WHERE reg.event_id = ? AND reg.status = 'registered' AND reg.run_order IS NOT NULL
         AND reg.id NOT IN (SELECT r.registration_id FROM runs r WHERE r.event_id = ? AND r.run_number = ?)
       ORDER BY reg.run_order ASC
       LIMIT 1`,
      [eventId, eventId, runNumber]
    );
    res.json(next ? { ...next, run_number: runNumber } : null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET active run -- includes run_position and total_runners when run_order is set
router.get('/active', async (req, res) => {
  try {
    // Check for forerunner run first (no registration join needed)
    let run = await queryOne(
      `SELECT r.* FROM runs r WHERE r.event_id = ? AND r.status = 'scoring' AND r.registration_id = '__forerunner__'
       ORDER BY r.created_at DESC LIMIT 1`,
      [req.params.eventId]
    );
    if (run) {
      const submitted = await queryAll(
        `SELECT js.id, js.judge_id, js.score_type, js.raw_score,
                js.tl_carving, js.tl_abext, js.tl_upper_body, js.tl_deduction,
                j.role, j.name
         FROM judge_scores js JOIN judges j ON j.id = js.judge_id WHERE js.run_id = ?`,
        [run.id]
      );
      return res.json({ ...run, bib_number: '', first_name: 'Forerunner', last_name: '', club: '', run_order: null, submitted, run_position: null, total_runners: null, phase_label: null, is_forerunner: true });
    }

    run = await queryOne(
      `SELECT r.*, reg.bib_number, reg.run_order, a.first_name, a.last_name, a.club
       FROM runs r
       JOIN registrations reg ON reg.id = r.registration_id
       JOIN athletes a ON a.id = reg.athlete_id
       WHERE r.event_id = ? AND r.status = 'scoring'
       ORDER BY r.created_at DESC LIMIT 1`,
      [req.params.eventId]
    );
    if (!run) {
      // Check if all phases are finalized (event completed)
      const allPhases = await queryAll(`SELECT status FROM event_phases WHERE event_id=?`, [req.params.eventId]);
      const eventCompleted = allPhases.length > 0 && allPhases.every(p => p.status === 'finalized');
      if (eventCompleted) return res.json({ event_completed: true });
      // Also check if event itself is marked complete (no phases scenario)
      const evt = await queryOne(`SELECT status FROM events WHERE id=?`, [req.params.eventId]);
      if (evt && evt.status === 'complete') return res.json({ event_completed: true });
      return res.json(null);
    }

    const submitted = await queryAll(
      `SELECT js.id, js.judge_id, js.score_type, js.raw_score,
              js.tl_carving, js.tl_abext, js.tl_upper_body, js.tl_deduction,
              j.role, j.name
       FROM judge_scores js JOIN judges j ON j.id = js.judge_id WHERE js.run_id = ?`,
      [run.id]
    );

    let run_position = null;
    let total_runners = null;

    // v1.9.00: Use phase_run_order for position when phases exist
    const activePhase = await queryOne(
      `SELECT ep.id, ep.label, pro.run_order as phase_run_order
       FROM event_phases ep
       JOIN phase_run_order pro ON pro.phase_id = ep.id AND pro.registration_id = ?
       WHERE ep.event_id = ? AND ep.run_number = ?`,
      [run.registration_id, req.params.eventId, run.run_number]
    );
    const effectiveRunOrder = activePhase ? activePhase.phase_run_order : run.run_order;

    if (effectiveRunOrder != null) {
      const totRow = activePhase
        ? await queryOne(
            `SELECT COUNT(*) as cnt FROM phase_run_order WHERE phase_id=?`, [activePhase.id]
          )
        : await queryOne(
            `SELECT COUNT(*) as cnt FROM registrations WHERE event_id=? AND status NOT IN ('scratched','dns')`,
            [req.params.eventId]
      );
      run_position  = effectiveRunOrder;
      total_runners = totRow ? parseInt(totRow.cnt) : null;
    }

    const phaseLabel = activePhase ? activePhase.label : null;
    res.json({ ...run, submitted, run_position, total_runners, phase_label: phaseLabel });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Manual score entry helpers ─────────────────────────────────────────────────

// Resolve DD value for a jump code; throws with a user-readable message on miss.
async function resolveJumpDD(code, disc, gender) {
  let r = await queryOne(
    `SELECT dd_value FROM jump_dd_table WHERE jump_code=? AND discipline=? AND gender=?`,
    [code, disc, gender]
  );
  if (!r) {
    r = await queryOne(
      `SELECT dd_value FROM jump_dd_table WHERE jump_code=? AND discipline=?`,
      [code, disc]
    );
  }
  if (!r) throw new Error(`Jump code '${code}' not found in the DD table`);
  return r.dd_value;
}

// GET /:runId/scores -- return judge scores for a run (used by Edit Score pre-population)
router.get('/:runId/scores', async (req, res) => {
  try {
    const run = await queryOne('SELECT id FROM runs WHERE id=? AND event_id=?',
      [req.params.runId, req.params.eventId]);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    const scores = await queryAll(
      `SELECT js.id, js.judge_id, js.score_type, js.raw_score,
              js.tl_carving, js.tl_abext, js.tl_upper_body, js.tl_deduction,
              j.role, j.name
       FROM judge_scores js JOIN judges j ON j.id=js.judge_id
       WHERE js.run_id=? ORDER BY j.role, js.score_type`,
      [run.id]
    );
    res.json(scores);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /manual -- Create + immediately complete a run without entering 'scoring' state.
// No run_started broadcast; overlay never shows "Now Scoring..." for this run.
router.post('/manual', async (req, res) => {
  try {
    const event = await queryOne('SELECT * FROM events WHERE id=?', [req.params.eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const {
      registration_id, run_number = 1, round = 'qualification',
      jump1_code, jump2_code,
      tl_scores = [], tl_components = [],
      air_jump1_scores = [], air_jump2_scores = [],
      form_scores = [], landing_scores = [],
      run_time, run_status,
    } = req.body;

    if (!registration_id) return res.status(400).json({ error: 'registration_id required' });
    const regCheck = await queryOne('SELECT id FROM registrations WHERE id=? AND event_id=?',
      [registration_id, req.params.eventId]);
    if (!regCheck) return res.status(400).json({ error: 'registration_id does not belong to this event' });

    const disc        = event.discipline === 'aerials' ? 'aerials' : 'mogul';
    const eventGender = event.gender || 'M';

    // Auto-activate event on first run (same as normal run start)
    try {
      if (event.status === 'setup') {
        await execute(`UPDATE events SET status='active', updated_at=datetime('now') WHERE id=?`, [req.params.eventId]);
        if (req.app.broadcast) req.app.broadcast(req.params.eventId, 'event_status_changed', { eventId: req.params.eventId, status: 'active' });
      }
    } catch (_) {}

    // DNS / DNF / DSQ path -- record status, no scores needed
    if (run_status && ['DNS', 'DNF', 'DSQ'].includes(run_status)) {
      const id = uuidv4();
      await execute(
        `INSERT INTO runs (id,event_id,registration_id,run_number,round,status,run_status,manually_entered)
         VALUES (?,?,?,?,?,'complete',?,1)`,
        [id, req.params.eventId, registration_id, run_number, round, run_status]
      );
      const created = await queryOne('SELECT * FROM runs WHERE id=?', [id]);
      const dnsAgt = await getAgeGroupTransition(req.params.eventId, registration_id);
      if (req.app.broadcast) req.app.broadcast(req.params.eventId, 'run_updated', { id, manually_entered: 1, ...(dnsAgt && { age_group_transition: dnsAgt }) });
      try { await logAudit('manual_run_status', 'run', id, null, { run_status, registration_id }); } catch (_) {}
      return res.status(201).json({ ok: true, run: created });
    }

    // Scored path -- validate and resolve jump codes
    let dd1 = null, dd2 = null;
    if (jump1_code) {
      try { dd1 = await resolveJumpDD(jump1_code, disc, eventGender); }
      catch (e) { return res.status(400).json({ error: e.message }); }
    }
    if (jump2_code) {
      const duplicate = !!(jump1_code && areJumpsRepeats(jump1_code, jump2_code));
      if (duplicate && event.discipline !== 'aerials') {
        dd2 = 0;
      } else {
        try { dd2 = await resolveJumpDD(jump2_code, disc, eventGender); }
        catch (e) { return res.status(400).json({ error: e.message }); }
      }
    }

    // Compute scores using the same engine functions as the normal scoring flow
    let result;
    if (event.discipline === 'aerials') {
      result = calcAerialsScore({
        airJump1Scores: air_jump1_scores, dd1: dd1 || 0,
        airJump2Scores: air_jump2_scores, dd2: dd2 || 0,
        formScores:    form_scores,
        landingScores: landing_scores,
      });
    } else {
      result = calcMogulScore({
        tlScores:       tl_scores,
        airScoresJump1: air_jump1_scores, dd1: dd1 || 0,
        airScoresJump2: air_jump2_scores, dd2: dd2 || 0,
        runTime:        run_time || null,
        paceTime:       event.pace_time,
        turnsWeight:    event.turns_weight,
        airWeight:      event.air_weight,
        speedWeight:    event.speed_weight,
        hasSpeed:       !!event.has_speed,
        numTlJudges:    event.num_tl_judges,
        numJumps:       event.num_jumps || 2,
      });
    }

    const id = uuidv4();
    const airNoDdValue = event.discipline === 'aerials'
      ? null
      : (result.airNoDd != null ? result.airNoDd : result.airContrib);
    await execute(
      `INSERT INTO runs (id,event_id,registration_id,run_number,round,status,hj_pending,
         jump1_code,jump1_dd,jump2_code,jump2_dd,run_time,
         turns_score,air_score,air_score_no_dd,speed_score,total_score,manually_entered)
       VALUES (?,?,?,?,?,'complete',0,?,?,?,?,?,?,?,?,?,?,1)`,
      [id, req.params.eventId, registration_id, run_number, round,
       jump1_code || null, dd1, jump2_code || null, dd2, run_time || null,
       result.turnsContrib, result.airContrib, airNoDdValue, result.speedContrib, result.total]
    );

    // Store per-judge scores in judge_scores (if event has judges configured)
    const allJudges = await queryAll(
      `SELECT id, role FROM judges WHERE event_id=? ORDER BY role`,
      [req.params.eventId]
    );
    const tlJudgesArr  = allJudges.filter(j => /^TL\d/.test(j.role)).sort((a, b) => a.role.localeCompare(b.role));
    const airJudgesArr = allJudges.filter(j => /^Air\d/.test(j.role)).sort((a, b) => a.role.localeCompare(b.role));

    for (let i = 0; i < tl_scores.length; i++) {
      const judge = tlJudgesArr[i]; if (!judge) continue;
      const comp = tl_components[i] || {};
      await execute(
        `INSERT INTO judge_scores (id,run_id,judge_id,score_type,raw_score,tl_carving,tl_abext,tl_upper_body,tl_deduction)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [uuidv4(), id, judge.id, 'turns', tl_scores[i],
         comp.carving ?? null, comp.absExt ?? null, comp.upperBody ?? null, comp.deduction ?? null]
      );
    }
    for (let i = 0; i < air_jump1_scores.length; i++) {
      const judge = airJudgesArr[i]; if (!judge) continue;
      await execute(`INSERT INTO judge_scores (id,run_id,judge_id,score_type,raw_score) VALUES (?,?,?,?,?)`,
        [uuidv4(), id, judge.id, 'air_jump1', air_jump1_scores[i]]);
    }
    for (let i = 0; i < air_jump2_scores.length; i++) {
      const judge = airJudgesArr[i]; if (!judge) continue;
      await execute(`INSERT INTO judge_scores (id,run_id,judge_id,score_type,raw_score) VALUES (?,?,?,?,?)`,
        [uuidv4(), id, judge.id, 'air_jump2', air_jump2_scores[i]]);
    }
    // Update runs table component columns with last judge's values (backward compat)
    if (tl_components.length > 0) {
      const last = tl_components[tl_components.length - 1];
      await execute(
        `UPDATE runs SET tl_carving=?, tl_abext=?, tl_upper_body=?, tl_deduction=? WHERE id=?`,
        [last.carving ?? null, last.absExt ?? null, last.upperBody ?? null, last.deduction ?? null, id]
      );
    }

    const created = await queryOne('SELECT * FROM runs WHERE id=?', [id]);

    // Broadcast score_update WITHOUT total -- overlay WS gate (d.total == null) prevents display.
    // Broadcast run_updated to refresh the scoring panel.
    if (req.app.broadcast) {
      req.app.broadcast(req.params.eventId, 'score_update', { runId: id });
      req.app.broadcast(req.params.eventId, 'run_updated', { id, manually_entered: 1 });
    }
    try { await logAudit('manual_run_scored', 'run', id, null, { total: result.total, registration_id }); } catch (_) {}
    return res.status(201).json({ ok: true, run: created });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /:runId/manual-score -- Re-score or update status of an existing run (Edit Score)
router.post('/:runId/manual-score', async (req, res) => {
  try {
    const run = await queryOne('SELECT * FROM runs WHERE id=? AND event_id=?',
      [req.params.runId, req.params.eventId]);
    if (!run) return res.status(404).json({ error: 'Run not found' });

    const event = await queryOne('SELECT * FROM events WHERE id=?', [req.params.eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const {
      jump1_code, jump2_code,
      tl_scores = [], tl_components = [],
      air_jump1_scores = [], air_jump2_scores = [],
      form_scores = [], landing_scores = [],
      run_time, run_status,
    } = req.body;

    const disc        = event.discipline === 'aerials' ? 'aerials' : 'mogul';
    const eventGender = event.gender || 'M';

    // DNS / DNF / DSQ path
    if (run_status && ['DNS', 'DNF', 'DSQ'].includes(run_status)) {
      await execute(
        `UPDATE runs SET run_status=?, status='complete', hj_pending=0, manually_entered=1,
           turns_score=NULL, air_score=NULL, air_score_no_dd=NULL, speed_score=NULL, total_score=NULL,
           updated_at=datetime('now') WHERE id=?`,
        [run_status, run.id]
      );
      const updated = await queryOne('SELECT * FROM runs WHERE id=?', [run.id]);
      if (req.app.broadcast) {
        req.app.broadcast(req.params.eventId, 'score_update', { runId: run.id });
        req.app.broadcast(req.params.eventId, 'run_updated', updated);
      }
      try { await logAudit('manual_score_status', 'run', run.id, null, { run_status }); } catch (_) {}
      return res.json({ ok: true, run: updated });
    }

    // Scored path -- use provided codes, falling back to existing codes on the run
    const numJumps = event.num_jumps || 2;
    const code1 = jump1_code || run.jump1_code;
    const code2 = numJumps === 1 ? null : (jump2_code || run.jump2_code);
    let dd1 = run.jump1_dd;
    let dd2 = numJumps === 1 ? null : run.jump2_dd;

    if (jump1_code) {
      try { dd1 = await resolveJumpDD(jump1_code, disc, eventGender); }
      catch (e) { return res.status(400).json({ error: e.message }); }
    }
    if (jump2_code) {
      const duplicate = !!(code1 && areJumpsRepeats(code1, jump2_code));
      if (duplicate && event.discipline !== 'aerials') {
        dd2 = 0;
      } else {
        try { dd2 = await resolveJumpDD(jump2_code, disc, eventGender); }
        catch (e) { return res.status(400).json({ error: e.message }); }
      }
    }

    const finalTime = run_time !== undefined ? run_time : run.run_time;

    let result;
    if (event.discipline === 'aerials') {
      result = calcAerialsScore({
        airJump1Scores: air_jump1_scores, dd1: dd1 || 0,
        airJump2Scores: air_jump2_scores, dd2: dd2 || 0,
        formScores:    form_scores,
        landingScores: landing_scores,
      });
    } else {
      result = calcMogulScore({
        tlScores:       tl_scores,
        airScoresJump1: air_jump1_scores, dd1: dd1 || 0,
        airScoresJump2: air_jump2_scores, dd2: dd2 || 0,
        runTime:        finalTime || null,
        paceTime:       event.pace_time,
        turnsWeight:    event.turns_weight,
        airWeight:      event.air_weight,
        speedWeight:    event.speed_weight,
        hasSpeed:       !!event.has_speed,
        numTlJudges:    event.num_tl_judges,
        numJumps:       event.num_jumps || 2,
      });
    }

    const airNoDdValueEdit = event.discipline === 'aerials'
      ? null
      : (result.airNoDd != null ? result.airNoDd : result.airContrib);
    await execute(
      `UPDATE runs SET
         jump1_code=?, jump1_dd=?, jump2_code=?, jump2_dd=?,
         run_time=?, run_status=NULL,
         turns_score=?, air_score=?, air_score_no_dd=?, speed_score=?, total_score=?,
         status='complete', hj_pending=0, manually_entered=1,
         updated_at=datetime('now')
       WHERE id=?`,
      [code1 || null, dd1, code2 || null, dd2,
       finalTime || null,
       result.turnsContrib, result.airContrib, airNoDdValueEdit, result.speedContrib, result.total,
       run.id]
    );

    // Overwrite judge_scores with fresh per-judge data for this run
    await execute(`DELETE FROM judge_scores WHERE run_id=?`, [run.id]);
    const allJudgesEdit = await queryAll(
      `SELECT id, role FROM judges WHERE event_id=? ORDER BY role`,
      [req.params.eventId]
    );
    const tlJudgesEdit  = allJudgesEdit.filter(j => /^TL\d/.test(j.role)).sort((a, b) => a.role.localeCompare(b.role));
    const airJudgesEdit = allJudgesEdit.filter(j => /^Air\d/.test(j.role)).sort((a, b) => a.role.localeCompare(b.role));

    for (let i = 0; i < tl_scores.length; i++) {
      const judge = tlJudgesEdit[i]; if (!judge) continue;
      const comp = tl_components[i] || {};
      await execute(
        `INSERT INTO judge_scores (id,run_id,judge_id,score_type,raw_score,tl_carving,tl_abext,tl_upper_body,tl_deduction)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [uuidv4(), run.id, judge.id, 'turns', tl_scores[i],
         comp.carving ?? null, comp.absExt ?? null, comp.upperBody ?? null, comp.deduction ?? null]
      );
    }
    for (let i = 0; i < air_jump1_scores.length; i++) {
      const judge = airJudgesEdit[i]; if (!judge) continue;
      await execute(`INSERT INTO judge_scores (id,run_id,judge_id,score_type,raw_score) VALUES (?,?,?,?,?)`,
        [uuidv4(), run.id, judge.id, 'air_jump1', air_jump1_scores[i]]);
    }
    for (let i = 0; i < air_jump2_scores.length; i++) {
      const judge = airJudgesEdit[i]; if (!judge) continue;
      await execute(`INSERT INTO judge_scores (id,run_id,judge_id,score_type,raw_score) VALUES (?,?,?,?,?)`,
        [uuidv4(), run.id, judge.id, 'air_jump2', air_jump2_scores[i]]);
    }
    // Update runs table component columns with last judge's values (backward compat)
    if (tl_components.length > 0) {
      const last = tl_components[tl_components.length - 1];
      await execute(
        `UPDATE runs SET tl_carving=?, tl_abext=?, tl_upper_body=?, tl_deduction=? WHERE id=?`,
        [last.carving ?? null, last.absExt ?? null, last.upperBody ?? null, last.deduction ?? null, run.id]
      );
    }

    const updated = await queryOne('SELECT * FROM runs WHERE id=?', [run.id]);
    if (req.app.broadcast) {
      req.app.broadcast(req.params.eventId, 'score_update', { runId: run.id });
      req.app.broadcast(req.params.eventId, 'run_updated', updated);
    }
    try { await logAudit('manual_score_edited', 'run', run.id, null, { total: result.total }); } catch (_) {}
    res.json({ ok: true, run: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /forerunner -- start a forerunner (judge test) run
router.post('/forerunner', async (req, res) => {
  try {
    const event = await queryOne('SELECT * FROM events WHERE id=?', [req.params.eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // Guard: no forerunner after real runs have been scored
    const realRuns = await queryOne(
      `SELECT COUNT(*) as cnt FROM runs WHERE event_id=? AND registration_id != '__forerunner__' AND status='complete'`,
      [req.params.eventId]
    );
    if (realRuns && parseInt(realRuns.cnt) > 0) {
      return res.status(400).json({ error: 'Cannot start forerunner after scoring has begun' });
    }

    // Guard: no concurrent active run
    const activeRun = await queryOne(
      `SELECT id FROM runs WHERE event_id=? AND status='scoring'`, [req.params.eventId]
    );
    if (activeRun) {
      return res.status(400).json({ error: 'A run is already in progress' });
    }

    const id = uuidv4();
    await execute(
      `INSERT INTO runs (id,event_id,registration_id,run_number,round,status) VALUES (?,?,'__forerunner__',0,'forerunner','scoring')`,
      [id, req.params.eventId]
    );

    if (req.app.broadcast) {
      req.app.broadcast(req.params.eventId, 'run_started', {
        bib: '', first_name: 'Forerunner', last_name: '', club: '', run_number: 0, is_forerunner: true,
      });
    }

    res.status(201).json({ id, is_forerunner: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST create/start a new run
router.post('/', async (req, res) => {
  try {
    const event = await queryOne('SELECT * FROM events WHERE id=?', [req.params.eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const { registration_id, run_number=1, round='qualification', jump1_code, jump2_code, bracket_round, bracket_position, course } = req.body;
    if (!registration_id) return res.status(400).json({ error: 'registration_id required' });

    // Verify the registration belongs to this event before creating a run.
    const regCheck = await queryOne(
      'SELECT id FROM registrations WHERE id=? AND event_id=?',
      [registration_id, req.params.eventId]
    );
    if (!regCheck) return res.status(400).json({ error: 'registration_id does not belong to this event' });

    // v1.9.00: Block starting run N+1 until prior phase/run is finalized
    if (run_number > 1 && event.discipline !== 'dual_mogul') {
      // Check if event has phases
      const phases = await queryAll(
        `SELECT * FROM event_phases WHERE event_id=? ORDER BY sequence_order`, [req.params.eventId]
      );
      if (phases.length > 0) {
        // Phase-aware blocking: the phase for this run_number must exist and be not_started
        const thisPhase = phases.find(p => p.run_number === run_number);
        if (!thisPhase) {
          return res.status(400).json({ error: `No phase exists for Run ${run_number}. Add a phase first.` });
        }
        const prevPhase = phases.find(p => p.run_number === run_number - 1);
        if (prevPhase && prevPhase.status !== 'finalized') {
          return res.status(400).json({ error: `${prevPhase.label} must be finalized before starting ${thisPhase.label}.` });
        }
      } else {
        // Legacy: check run_round_status
        const prevRound = await queryOne(
          `SELECT status FROM run_round_status WHERE event_id=? AND run_number=?`,
          [req.params.eventId, run_number - 1]
        );
        if (!prevRound || prevRound.status !== 'finalized') {
          return res.status(400).json({ error: `Run ${run_number - 1} must be finalized before starting Run ${run_number}.` });
        }
      }
    }

    const duplicateJumps = !!(jump1_code && jump2_code && areJumpsRepeats(jump1_code, jump2_code));

    let dd1 = null, dd2 = null;
    const disc = event.discipline === 'dual_mogul' ? 'dual_mogul'
               : event.discipline === 'aerials'    ? 'aerials'
               : 'mogul';
    const eventGender = event.gender || 'M';
    if (jump1_code) {
      const r = await queryOne(`SELECT dd_value FROM jump_dd_table WHERE jump_code=? AND discipline=? AND gender=?`, [jump1_code, disc, eventGender]);
      if (!r) {
        // Fallback: try without gender filter for backward compatibility / aerials
        const r2 = await queryOne(`SELECT dd_value FROM jump_dd_table WHERE jump_code=? AND discipline=?`, [jump1_code, disc]);
        dd1 = r2 ? r2.dd_value : null;
      } else {
        dd1 = r.dd_value;
      }
    }
    if (jump2_code) {
      if (duplicateJumps && event.discipline !== 'aerials') {
        // Repeat jump rule (domestic): only the first scoring jump counts.
        // The second jump's DD is set to 0 so it contributes nothing to the score.
        // Do NOT force dd2=1.0 (that silently distorts the second jump's value).
        dd2 = 0;
      } else {
        const r = await queryOne(`SELECT dd_value FROM jump_dd_table WHERE jump_code=? AND discipline=? AND gender=?`, [jump2_code, disc, eventGender]);
        if (!r) {
          const r2 = await queryOne(`SELECT dd_value FROM jump_dd_table WHERE jump_code=? AND discipline=?`, [jump2_code, disc]);
          dd2 = r2 ? r2.dd_value : null;
        } else {
          dd2 = r.dd_value;
        }
      }
    }

    const id = uuidv4();
    await execute(
      `INSERT INTO runs (id,event_id,registration_id,run_number,round,status,jump1_code,jump1_dd,jump2_code,jump2_dd,bracket_round,bracket_position,course)
       VALUES (?,?,?,?,?,'scoring',?,?,?,?,?,?,?)`,
      [id, req.params.eventId, registration_id, run_number, round, jump1_code||null, dd1, jump2_code||null, dd2, bracket_round||null, bracket_position||null, course||null]
    );
    const created = await queryOne('SELECT * FROM runs WHERE id=?', [id]);

    // v1.4 Feature 3: Auto-activate event on first run
    try {
      if (event.status === 'setup') {
        await execute(`UPDATE events SET status='active', updated_at=datetime('now') WHERE id=?`, [req.params.eventId]);
        try { await logAudit('event_auto_activated', 'event', req.params.eventId, null, { triggering_run_id: id }); } catch (_) {}
        if (req.app.broadcast) {
          req.app.broadcast(req.params.eventId, 'event_status_changed', { eventId: req.params.eventId, status: 'active' });
        }
      }
    } catch (_) {}

    // Broadcast run_started so overlay and scoreboard can react immediately
    const reg = await queryOne(
      `SELECT r.bib_number, a.first_name, a.last_name, a.club FROM registrations r JOIN athletes a ON a.id=r.athlete_id WHERE r.id=?`,
      [registration_id]
    );
    if (reg && req.app.broadcast) {
      const broadcastData = {
        bib: reg.bib_number,
        first_name: reg.first_name,
        last_name: reg.last_name,
        club: reg.club || '',
        run_number,
      };

      // For dual mogul, look up both blue and red competitors from the bracket
      if (event.discipline === 'dual_mogul' && bracket_round != null && bracket_position != null) {
        try {
          const slot = await queryOne(
            `SELECT db.registration_id_blue, db.registration_id_red FROM dual_bracket db WHERE db.event_id=? AND db.bracket_round=? AND db.bracket_position=?`,
            [req.params.eventId, bracket_round, bracket_position]
          );
          if (slot) {
            const [blue, red] = await Promise.all([
              slot.registration_id_blue ? queryOne(
                `SELECT r.bib_number, a.first_name, a.last_name FROM registrations r JOIN athletes a ON a.id=r.athlete_id WHERE r.id=?`,
                [slot.registration_id_blue]
              ) : null,
              slot.registration_id_red ? queryOne(
                `SELECT r.bib_number, a.first_name, a.last_name FROM registrations r JOIN athletes a ON a.id=r.athlete_id WHERE r.id=?`,
                [slot.registration_id_red]
              ) : null,
            ]);
            if (blue) {
              broadcastData.blue = { bib: blue.bib_number, first_name: blue.first_name, last_name: blue.last_name };
              broadcastData.name  = `${blue.first_name} ${blue.last_name}`;
              broadcastData.bib   = blue.bib_number;
            }
            if (red) {
              broadcastData.red  = { bib: red.bib_number, first_name: red.first_name, last_name: red.last_name };
              broadcastData.name2 = `${red.first_name} ${red.last_name}`;
              broadcastData.bib2  = red.bib_number;
            }
          }
        } catch (_) {}
      }

      req.app.broadcast(req.params.eventId, 'run_started', broadcastData);
    }

    res.status(201).json({ ...created, duplicate_jumps: duplicateJumps });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT update run (jump codes, time, status)
router.put('/:runId', async (req, res) => {
  try {
    const { jump1_code, jump2_code, run_time, status, clear_jump_codes } = req.body;

    // If HJ is clearing jump codes so they can be re-entered
    if (clear_jump_codes) {
      await execute(
        `UPDATE runs SET jump1_code=NULL, jump2_code=NULL, jump1_dd=NULL, jump2_dd=NULL, updated_at=datetime('now') WHERE id=? AND event_id=?`,
        [req.params.runId, req.params.eventId]
      );
      // Also delete air judge scores so they detect rejection and can re-enter codes + scores
      const airJudges = await queryAll(
        `SELECT id FROM judges WHERE event_id=? AND role LIKE 'Air%'`,
        [req.params.eventId]
      );
      if (airJudges.length) {
        const placeholders = airJudges.map(() => '?').join(',');
        await execute(
          `DELETE FROM judge_scores WHERE run_id=? AND judge_id IN (${placeholders})`,
          [req.params.runId, ...airJudges.map(j => j.id)]
        );
      }
      const updated = await queryOne('SELECT * FROM runs WHERE id=?', [req.params.runId]);
      if (req.app.broadcast) req.app.broadcast(req.params.eventId, 'run_updated', updated);
      return res.json(updated);
    }

    // Block jump code overwrite if codes are already set (prevent Air Judge 2 from overwriting Air Judge 1)
    if (jump1_code || jump2_code) {
      const existing = await queryOne('SELECT jump1_code, jump2_code FROM runs WHERE id=? AND event_id=?', [req.params.runId, req.params.eventId]);
      if (existing && existing.jump1_code && existing.jump2_code) {
        // If Air Judge 2 submits the same codes, allow it (no-op update, judge proceeds)
        const codesMatch = (jump1_code || '').trim().toUpperCase() === (existing.jump1_code || '').trim().toUpperCase()
                        && (jump2_code || '').trim().toUpperCase() === (existing.jump2_code || '').trim().toUpperCase();
        if (!codesMatch) {
          return res.status(409).json({ error: 'Jump codes differ from the other Air Judge.  Contact the Head Judge to resolve.' });
        }
        // Codes match -- fall through to the normal update (effectively a no-op)
      }
    }

    const duplicateJumps = !!(jump1_code && jump2_code && areJumpsRepeats(jump1_code, jump2_code));

    // Resolve DD values when jump codes are provided
    let dd1 = undefined, dd2 = undefined;
    if (jump1_code || jump2_code) {
      const event = await queryOne('SELECT * FROM events WHERE id=?', [req.params.eventId]);
      if (!event) return res.status(404).json({ error: 'Event not found' });
      const disc = event.discipline === 'dual_mogul' ? 'dual_mogul'
                 : event.discipline === 'aerials'    ? 'aerials'
                 : 'mogul';
      const eventGender = event.gender || 'M';
      if (jump1_code) {
        const r = await queryOne(`SELECT dd_value FROM jump_dd_table WHERE jump_code=? AND discipline=? AND gender=?`, [jump1_code, disc, eventGender]);
        if (!r) {
          const r2 = await queryOne(`SELECT dd_value FROM jump_dd_table WHERE jump_code=? AND discipline=?`, [jump1_code, disc]);
          dd1 = r2 ? r2.dd_value : null;
        } else {
          dd1 = r.dd_value;
        }
      }
      if (jump2_code) {
        if (duplicateJumps && event.discipline !== 'aerials') {
          // Repeat jump rule (domestic): only the first scoring jump counts.
          // Set dd2=0 so the second jump contributes nothing to the score.
          // Do NOT force dd2=1.0 (that silently distorts the second jump's value).
          dd2 = 0;
        } else {
          const r = await queryOne(`SELECT dd_value FROM jump_dd_table WHERE jump_code=? AND discipline=? AND gender=?`, [jump2_code, disc, eventGender]);
          if (!r) {
            const r2 = await queryOne(`SELECT dd_value FROM jump_dd_table WHERE jump_code=? AND discipline=?`, [jump2_code, disc]);
            dd2 = r2 ? r2.dd_value : null;
          } else {
            dd2 = r.dd_value;
          }
        }
      }
    }

    await execute(
      `UPDATE runs SET jump1_code=COALESCE(?,jump1_code), jump2_code=COALESCE(?,jump2_code),
       jump1_dd=COALESCE(?,jump1_dd), jump2_dd=COALESCE(?,jump2_dd),
       run_time=COALESCE(?,run_time), status=COALESCE(?,status), updated_at=datetime('now') WHERE id=? AND event_id=?`,
      [jump1_code||null, jump2_code||null, dd1 !== undefined ? dd1 : null, dd2 !== undefined ? dd2 : null, run_time||null, status||null, req.params.runId, req.params.eventId]
    );
    // Broadcast after time submit so tablets refresh
    const updated = await queryOne('SELECT * FROM runs WHERE id=?', [req.params.runId]);
    if (req.app.broadcast) req.app.broadcast(req.params.eventId, 'run_updated', updated);

    // If run_time was just submitted and the run is not yet complete, attempt finalization.
    // Covers the case where all judges scored before the timekeeper submitted the time.
    if (run_time && updated.status !== 'complete') {
      const final = await tryFinalize(updated, req.params.eventId);
      if (final && req.app.broadcast) {
        const hjRow = await queryOne(`SELECT id FROM judges WHERE event_id=? AND role='HJ'`, [req.params.eventId]);
        if (!hjRow) {
          const rank = await computeOverallRank(req.params.eventId, updated.registration_id, final.total);
          const agt = await getAgeGroupTransition(req.params.eventId, updated.registration_id);
          req.app.broadcast(req.params.eventId, 'score_update', { ...final, runId: updated.id, rank, ...(agt && { age_group_transition: agt }) });
        } else {
          req.app.broadcast(req.params.eventId, 'score_update', { runId: updated.id, interim: true, hjPending: true });
        }
      }
    }

    res.json({ ...updated, duplicate_jumps: duplicateJumps });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST submit a judge score for a run
router.post('/:runId/scores', async (req, res) => {
  try {
    const run = await queryOne('SELECT * FROM runs WHERE id=? AND event_id=?', [req.params.runId, req.params.eventId]);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.status === 'complete') return res.status(400).json({ error: 'Run already complete' });

    const { judge_id, score_type, raw_score, pin, carving, abext, upper_body, deduction } = req.body;
    if (!judge_id || !score_type || raw_score === undefined) {
      return res.status(400).json({ error: 'judge_id, score_type, and raw_score required' });
    }
    const judge = await queryOne('SELECT * FROM judges WHERE id=? AND event_id=?', [judge_id, req.params.eventId]);
    if (!judge) return res.status(403).json({ error: 'Judge not registered for this event' });
    if (judge.pin && pin !== judge.pin) return res.status(403).json({ error: 'Invalid PIN' });

    const validTypes = ['turns','air_jump1','air_jump2','form','landing'];
    if (!validTypes.includes(score_type)) return res.status(400).json({ error: 'Invalid score_type' });
    if (score_type === 'turns' && (raw_score < 0.1 || raw_score > 20.0)) return res.status(400).json({ error: 'Turns score must be 0.1-20.0' });
    if (score_type !== 'turns' && (raw_score < 0 || raw_score > 10)) return res.status(400).json({ error: 'Air/form/landing score must be 0-10' });

    const ex = await queryOne('SELECT id FROM judge_scores WHERE run_id=? AND judge_id=? AND score_type=?', [run.id, judge_id, score_type]);
    const isTurns = score_type === 'turns';
    if (ex) {
      await execute(
        `UPDATE judge_scores SET raw_score=?, submitted_at=datetime('now'),
           tl_carving=?, tl_abext=?, tl_upper_body=?, tl_deduction=?
         WHERE id=?`,
        [raw_score,
         isTurns ? (carving    ?? null) : null,
         isTurns ? (abext      ?? null) : null,
         isTurns ? (upper_body ?? null) : null,
         isTurns ? (deduction  ?? null) : null,
         ex.id]
      );
    } else {
      await execute(
        `INSERT INTO judge_scores
           (id,run_id,judge_id,score_type,raw_score,tl_carving,tl_abext,tl_upper_body,tl_deduction)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [uuidv4(), run.id, judge_id, score_type, raw_score,
         isTurns ? (carving    ?? null) : null,
         isTurns ? (abext      ?? null) : null,
         isTurns ? (upper_body ?? null) : null,
         isTurns ? (deduction  ?? null) : null]
      );
    }

    // Store T&L component scores on the run row when a turns score is submitted
    if (score_type === 'turns' && (carving !== undefined || abext !== undefined || upper_body !== undefined || deduction !== undefined)) {
      const compUpdates = [];
      const compArgs    = [];
      if (carving    !== undefined && carving    !== null) { compUpdates.push('tl_carving=?');    compArgs.push(carving); }
      if (abext      !== undefined && abext      !== null) { compUpdates.push('tl_abext=?');      compArgs.push(abext); }
      if (upper_body !== undefined && upper_body !== null) { compUpdates.push('tl_upper_body=?'); compArgs.push(upper_body); }
      if (deduction  !== undefined && deduction  !== null) { compUpdates.push('tl_deduction=?');  compArgs.push(deduction); }
      if (compUpdates.length) {
        compArgs.push(run.id);
        await execute(`UPDATE runs SET ${compUpdates.join(', ')} WHERE id=?`, compArgs);
      }
    }

    const final = await tryFinalize(run, req.params.eventId);
    if (final && req.app.broadcast) {
      // v1.5 Feature 2: Only broadcast score_update with totals when there is
      // no HJ configured (i.e. tryFinalize published the run directly).  When
      // an HJ is configured, the run is held in hj_pending and the HJ-approve
      // route is responsible for the broadcast that flips the overlay.
      // Broadcasting ...final here would leak `total` and cause the single
      // mogul overlay to switch to the score panel before HJ approval.
      const hjRow = await queryOne(`SELECT id FROM judges WHERE event_id=? AND role='HJ'`, [req.params.eventId]);
      if (!hjRow) {
        const rank = await computeOverallRank(req.params.eventId, run.registration_id, final.total);
        const agt2 = await getAgeGroupTransition(req.params.eventId, run.registration_id);
        req.app.broadcast(req.params.eventId, 'score_update', { ...final, runId: run.id, rank, ...(agt2 && { age_group_transition: agt2 }) });
      } else {
        // HJ present: notify scoring/HJ tablets that scores were posted, but
        // DO NOT include total/rank (overlay gate is `total == null && score == null`).
        req.app.broadcast(req.params.eventId, 'score_update', { runId: run.id, interim: true, hjPending: true });
      }
    }

    // Audit log
    try { await logAudit('score_submitted', 'run', run.id, null, { judge_id, score_type, raw_score }); } catch (_) {}

    res.json({ ok: true, final_score: final });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function tryFinalize(run, eventId) {
  const event = await queryOne('SELECT * FROM events WHERE id=?', [eventId]);

  if (event.discipline === 'aerials') {
    return tryFinalizeAerials(run, event);
  }

  // Fetch scores joined to judge role so HJ-only judges are excluded from the turns count
  const scores = await queryAll(
    `SELECT js.score_type, js.raw_score, j.role
     FROM judge_scores js
     JOIN judges j ON j.id = js.judge_id
     WHERE js.run_id=?`,
    [run.id]
  );
  // Only count turns scores submitted by designated T&L judges (TL1/TL2/TL3).
  // A judge holding a dual role (assigned both a TL position AND the HJ position as
  // separate judge records) will contribute their TL score here correctly.
  // A standalone HJ who is not also assigned a TL role will not affect the count.
  const tl = scores.filter(s => s.score_type === 'turns' && /^TL/.test(s.role)).map(s => s.raw_score);
  const a1 = scores.filter(s => s.score_type === 'air_jump1').map(s => s.raw_score);
  const a2 = scores.filter(s => s.score_type === 'air_jump2').map(s => s.raw_score);

  if (tl.length < event.num_tl_judges) return null;
  if (a1.length < event.num_air_judges) return null;
  const needsJump2 = (event.num_jumps || 2) >= 2;
  if (needsJump2 && a2.length < event.num_air_judges) return null;
  if (event.has_speed && !run.run_time) return null;

  const result = calcMogulScore({
    tlScores: tl,
    airScoresJump1: a1, dd1: run.jump1_dd || 0,
    airScoresJump2: a2, dd2: run.jump2_dd || 0,
    runTime: run.run_time,
    paceTime: event.pace_time,
    turnsWeight: event.turns_weight,
    airWeight: event.air_weight,
    speedWeight: event.speed_weight,
    hasSpeed: !!event.has_speed,
    numTlJudges: event.num_tl_judges,
    numJumps: event.num_jumps || 2,
  });

  // Check whether a Head Judge is configured for this event
  const hj = await queryOne(`SELECT id FROM judges WHERE event_id=? AND role='HJ'`, [eventId]);
  if (hj) {
    // Store computed scores but hold in hj_pending state -- do not mark complete yet
    await execute(
      `UPDATE runs SET turns_score=?, air_score=?, air_score_no_dd=?, speed_score=?, total_score=?, hj_pending=1, updated_at=datetime('now') WHERE id=?`,
      [result.turnsContrib, result.airContrib, result.airNoDd ?? null, result.speedContrib, result.total, run.id]
    );
  } else {
    // No HJ configured -- publish immediately (backward-compatible)
    await execute(
      `UPDATE runs SET turns_score=?, air_score=?, air_score_no_dd=?, speed_score=?, total_score=?, status='complete', hj_pending=0, updated_at=datetime('now') WHERE id=?`,
      [result.turnsContrib, result.airContrib, result.airNoDd ?? null, result.speedContrib, result.total, run.id]
    );
  }
  return result;
}

async function tryFinalizeAerials(run, event) {
  // For aerials: need air scores for each jump from air judges,
  // plus form and landing scores.
  // num_tl_judges = number of form judges; num_air_judges = number of air judges.
  // Landing judges count = num_air_judges (same pool, configured per event).
  const scores = await queryAll(
    `SELECT js.score_type, js.raw_score FROM judge_scores js WHERE js.run_id=?`,
    [run.id]
  );

  const a1       = scores.filter(s => s.score_type === 'air_jump1').map(s => s.raw_score);
  const a2       = scores.filter(s => s.score_type === 'air_jump2').map(s => s.raw_score);
  const form     = scores.filter(s => s.score_type === 'form').map(s => s.raw_score);
  const landing  = scores.filter(s => s.score_type === 'landing').map(s => s.raw_score);

  // Require at least one score of each type before finalizing
  const numAir     = event.num_air_judges || 1;
  const numForm    = event.num_tl_judges  || 1;
  const numLanding = event.num_air_judges || 1;

  if (a1.length < numAir || a2.length < numAir) return null;
  if (form.length < numForm)    return null;
  if (landing.length < numLanding) return null;

  const result = calcAerialsScore({
    airJump1Scores: a1, dd1: run.jump1_dd || 0,
    airJump2Scores: a2, dd2: run.jump2_dd || 0,
    formScores:    form,
    landingScores: landing,
  });

  const hj = await queryOne(`SELECT id FROM judges WHERE event_id=? AND role='HJ'`, [event.id]);
  if (hj) {
    await execute(
      `UPDATE runs SET turns_score=?, air_score=?, speed_score=?, total_score=?, hj_pending=1, updated_at=datetime('now') WHERE id=?`,
      [result.turnsContrib, result.airContrib, result.speedContrib, result.total, run.id]
    );
  } else {
    await execute(
      `UPDATE runs SET turns_score=?, air_score=?, speed_score=?, total_score=?, status='complete', hj_pending=0, updated_at=datetime('now') WHERE id=?`,
      [result.turnsContrib, result.airContrib, result.speedContrib, result.total, run.id]
    );
  }
  return result;
}

// POST /:runId/approve -- Head Judge approves a pending score; publishes to scoreboard.
// Also accepts calls when hj_pending=0 and status='scoring' (manual finalize path).
router.post('/:runId/approve', async (req, res) => {
  try {
    const run = await queryOne('SELECT * FROM runs WHERE id=? AND event_id=?', [req.params.runId, req.params.eventId]);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.status === 'complete') return res.status(400).json({ error: 'Run is already complete' });

    // If scores are fully in and hj_pending is already set, just publish.
    // If called manually (hj_pending=0, status=scoring), run tryFinalize first to
    // compute whatever scores exist, then force-complete regardless of completeness.
    if (!run.hj_pending) {
      // Manual finalize path -- compute scores from whatever has been submitted so far
      const finalResult = await tryFinalize(run, req.params.eventId);

      // Guard: do not force-complete if scores could not be computed
      const refreshed = await queryOne('SELECT * FROM runs WHERE id=?', [req.params.runId]);
      if (refreshed.total_score == null) {
        // Gather status info for error message
        const event = await queryOne('SELECT * FROM events WHERE id=?', [req.params.eventId]);
        const scores = await queryAll(
          `SELECT js.score_type, j.role FROM judge_scores js JOIN judges j ON j.id=js.judge_id WHERE js.run_id=?`,
          [run.id]
        );
        const tlCount = scores.filter(s => s.score_type === 'turns' && /^TL/.test(s.role)).length;
        const airCount = Math.min(
          scores.filter(s => s.score_type === 'air_jump1').length,
          scores.filter(s => s.score_type === 'air_jump2').length
        );
        const hasTime = refreshed.run_time != null;
        const needTL = event.num_tl_judges || 3;
        const needAir = event.num_air_judges || 2;
        return res.status(400).json({
          error: `Cannot finalize: missing scores.  T&L: ${tlCount}/${needTL}, Air: ${airCount}/${needAir}, Time: ${hasTime ? 'received' : 'pending'}.  Use DNS/RNS/DSQ/DNF if the athlete did not complete the run.`
        });
      }

      // Force status to complete
      await execute(
        `UPDATE runs SET status='complete', hj_pending=0, updated_at=datetime('now') WHERE id=? AND event_id=?`,
        [req.params.runId, req.params.eventId]
      );
    } else {
      // Normal approval path -- all scores computed, just publish
      await execute(
        `UPDATE runs SET status='complete', hj_pending=0, updated_at=datetime('now') WHERE id=? AND event_id=?`,
        [req.params.runId, req.params.eventId]
      );
    }

    const updated = await queryOne('SELECT * FROM runs WHERE id=?', [req.params.runId]);

    // Forerunner: auto-delete after approval, clear overlay
    if (run.registration_id === '__forerunner__') {
      await execute('DELETE FROM judge_scores WHERE run_id=?', [run.id]);
      await execute('DELETE FROM runs WHERE id=?', [run.id]);
      if (req.app.broadcast) {
        req.app.broadcast(req.params.eventId, 'score_update', { is_forerunner: true, total: null, runId: run.id });
        req.app.broadcast(req.params.eventId, 'run_updated', { id: run.id, deleted: true });
      }
      return res.json({ ok: true, forerunner_deleted: true });
    }

    // Compute current rank for the overlay (phase-aware for best-of-2, etc.)
    const rank = await computeOverallRank(req.params.eventId, updated.registration_id, updated.total_score);

    // Check for age group transition
    const ageTransition = await getAgeGroupTransition(req.params.eventId, updated.registration_id);

    if (req.app.broadcast) {
      req.app.broadcast(req.params.eventId, 'score_update', {
        total: updated.total_score,
        turnsContrib: updated.turns_score,
        airContrib: updated.air_score,
        speedContrib: updated.speed_score,
        runId: updated.id,
        rank,
        ...(ageTransition && { age_group_transition: ageTransition }),
      });
    }

    // Audit log
    try { await logAudit('hj_approved', 'run', req.params.runId, null, { total: updated.total_score, rank }); } catch (_) {}

    res.json({ ok: true, run: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /:runId -- Cancel/delete a run (only if no scores submitted yet)
router.delete('/:runId', async (req, res) => {
  try {
    const run = await queryOne('SELECT * FROM runs WHERE id=? AND event_id=?', [req.params.runId, req.params.eventId]);
    if (!run) return res.status(404).json({ error: 'Run not found' });

    // Forerunner runs can always be deleted (with their scores)
    if (run.registration_id === '__forerunner__') {
      await execute('DELETE FROM judge_scores WHERE run_id=?', [run.id]);
      await execute('DELETE FROM runs WHERE id=?', [run.id]);
      if (req.app.broadcast) req.app.broadcast(req.params.eventId, 'run_updated', { id: run.id, deleted: true });
      return res.json({ ok: true });
    }

    const scoreCount = await queryOne('SELECT COUNT(*) as cnt FROM judge_scores WHERE run_id=?', [run.id]);
    if (scoreCount && parseInt(scoreCount.cnt) > 0) {
      return res.status(400).json({ error: `Cannot delete: ${scoreCount.cnt} score(s) already submitted.  Use Undo Last Score or set DNS/RNS/DSQ/DNF instead.` });
    }

    await execute('DELETE FROM runs WHERE id=?', [run.id]);
    if (req.app.broadcast) req.app.broadcast(req.params.eventId, 'run_updated', { id: run.id, deleted: true });
    try { await logAudit('run_deleted', 'run', run.id, null, { registration_id: run.registration_id }); } catch (_) {}
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /:runId/reopen -- Reopen a completed run for rescoring
router.post('/:runId/reopen', async (req, res) => {
  try {
    const run = await queryOne('SELECT * FROM runs WHERE id=? AND event_id=?', [req.params.runId, req.params.eventId]);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.status !== 'complete') return res.status(400).json({ error: 'Only completed runs can be reopened' });

    const activeRun = await queryOne(`SELECT id FROM runs WHERE event_id=? AND status='scoring'`, [req.params.eventId]);
    if (activeRun) return res.status(400).json({ error: 'Cannot reopen: a run is currently in progress. Finish the active run first.' });

    // v1.8.03: Block reopening runs in a finalized round
    const roundStatus = await queryOne(
      `SELECT status FROM run_round_status WHERE event_id=? AND run_number=?`,
      [req.params.eventId, run.run_number]
    );
    if (roundStatus && roundStatus.status === 'finalized') {
      return res.status(400).json({ error: `Run ${run.run_number} is finalized. Reopen the run round first.` });
    }

    await execute(
      `UPDATE runs SET status='scoring', hj_pending=0, updated_at=datetime('now') WHERE id=?`,
      [run.id]
    );

    const updated = await queryOne('SELECT * FROM runs WHERE id=?', [run.id]);
    if (req.app.broadcast) req.app.broadcast(req.params.eventId, 'score_update', { runId: run.id, reopened: true });
    try { await logAudit('run_reopened', 'run', run.id, null, { previous_total: run.total_score }); } catch (_) {}
    res.json({ ok: true, run: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /:runId/scores/last -- Undo the most recently submitted judge score for the active run
router.delete('/:runId/scores/last', async (req, res) => {
  try {
    const run = await queryOne('SELECT * FROM runs WHERE id=? AND event_id=?', [req.params.runId, req.params.eventId]);
    if (!run) return res.status(404).json({ error: 'Run not found' });

    // Find the most recently submitted score for this run
    const last = await queryOne(
      `SELECT id FROM judge_scores WHERE run_id=? ORDER BY submitted_at DESC LIMIT 1`,
      [run.id]
    );
    if (!last) return res.status(404).json({ error: 'No scores to undo' });

    await execute(`DELETE FROM judge_scores WHERE id=?`, [last.id]);

    // If run was complete or hj_pending, revert to scoring and clear computed scores
    if (run.status === 'complete' || run.hj_pending) {
      await execute(
        `UPDATE runs SET status='scoring', hj_pending=0, turns_score=NULL, air_score=NULL, air_score_no_dd=NULL, speed_score=NULL, total_score=NULL, updated_at=datetime('now') WHERE id=?`,
        [run.id]
      );
    }

    const updated = await queryOne('SELECT * FROM runs WHERE id=?', [run.id]);
    if (req.app.broadcast) req.app.broadcast(req.params.eventId, 'score_update', { runId: run.id, undone: true });
    res.json({ ok: true, run: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /:runId/scores/:judgeScoreId/reject -- Head Judge rejects a specific judge score
router.post('/:runId/scores/:judgeScoreId/reject', async (req, res) => {
  try {
    const run = await queryOne('SELECT * FROM runs WHERE id=? AND event_id=?', [req.params.runId, req.params.eventId]);
    if (!run) return res.status(404).json({ error: 'Run not found' });

    const scoreRow = await queryOne('SELECT * FROM judge_scores WHERE id=? AND run_id=?', [req.params.judgeScoreId, req.params.runId]);
    if (!scoreRow) return res.status(404).json({ error: 'Score not found' });

    // Delete the rejected score
    await execute('DELETE FROM judge_scores WHERE id=?', [req.params.judgeScoreId]);

    // Recompute partial totals from remaining scores (regardless of completeness)
    const event = await queryOne('SELECT * FROM events WHERE id=?', [req.params.eventId]);
    const remaining = await queryAll(
      `SELECT js.score_type, js.raw_score, j.role
       FROM judge_scores js
       JOIN judges j ON j.id = js.judge_id
       WHERE js.run_id=?`,
      [run.id]
    );

    const { calcMogulScore, calcAerialsScore } = require('../scoring/engine');

    let partial = null;
    if (event.discipline === 'aerials') {
      const a1      = remaining.filter(s => s.score_type === 'air_jump1').map(s => s.raw_score);
      const a2      = remaining.filter(s => s.score_type === 'air_jump2').map(s => s.raw_score);
      const form    = remaining.filter(s => s.score_type === 'form').map(s => s.raw_score);
      const landing = remaining.filter(s => s.score_type === 'landing').map(s => s.raw_score);
      if (a1.length > 0 || a2.length > 0 || form.length > 0 || landing.length > 0) {
        partial = calcAerialsScore({
          airJump1Scores: a1.length > 0 ? a1 : [0], dd1: run.jump1_dd || 0,
          airJump2Scores: a2.length > 0 ? a2 : [0], dd2: run.jump2_dd || 0,
          formScores:    form.length    > 0 ? form    : [0],
          landingScores: landing.length > 0 ? landing : [0],
        });
      }
    } else {
      const tl = remaining.filter(s => s.score_type === 'turns' && /^TL/.test(s.role)).map(s => s.raw_score);
      const a1 = remaining.filter(s => s.score_type === 'air_jump1').map(s => s.raw_score);
      const a2 = remaining.filter(s => s.score_type === 'air_jump2').map(s => s.raw_score);
      if (tl.length > 0 || a1.length > 0 || a2.length > 0) {
        partial = calcMogulScore({
          tlScores: tl.length > 0 ? tl : [0],
          airScoresJump1: a1.length > 0 ? a1 : [0], dd1: run.jump1_dd || 0,
          airScoresJump2: a2.length > 0 ? a2 : [0], dd2: run.jump2_dd || 0,
          runTime: run.run_time,
          paceTime: event.pace_time,
          turnsWeight: event.turns_weight,
          airWeight: event.air_weight,
          speedWeight: event.speed_weight,
          hasSpeed: !!event.has_speed,
          numTlJudges: event.num_tl_judges,
          numJumps: event.num_jumps || 2,
        });
      }
    }

    // Reset run to pending / open for rescoring; store partial totals if available
    await execute(
      `UPDATE runs SET
        status='scoring',
        hj_pending=0,
        turns_score=?,
        air_score=?,
        air_score_no_dd=?,
        speed_score=?,
        total_score=?,
        updated_at=datetime('now')
       WHERE id=?`,
      [
        partial ? partial.turnsContrib : null,
        partial ? partial.airContrib   : null,
        partial && partial.airNoDd != null ? partial.airNoDd : null,
        partial ? partial.speedContrib : null,
        partial ? partial.total        : null,
        run.id,
      ]
    );

    const updated = await queryOne('SELECT * FROM runs WHERE id=?', [run.id]);
    if (req.app.broadcast) req.app.broadcast(req.params.eventId, 'score_update', {
      runId: run.id,
      rejected: true,
      rejectedScoreId: req.params.judgeScoreId,
      rejectedJudgeId: scoreRow.judge_id,
      rejectedScoreType: scoreRow.score_type,
      total: updated.total_score,
      turnsContrib: updated.turns_score,
      airContrib: updated.air_score,
      speedContrib: updated.speed_score,
    });

    res.json({ ok: true, run: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /:runId/time -- Head Judge rejects/clears the submitted time
router.delete('/:runId/time', async (req, res) => {
  try {
    const run = await queryOne('SELECT * FROM runs WHERE id=? AND event_id=?', [req.params.runId, req.params.eventId]);
    if (!run) return res.status(404).json({ error: 'Run not found' });

    // Clear the run time
    await execute(
      `UPDATE runs SET run_time=NULL, updated_at=datetime('now') WHERE id=? AND event_id=?`,
      [req.params.runId, req.params.eventId]
    );

    // If run was hj_pending or complete, revert to scoring and clear computed scores
    if (run.hj_pending || run.status === 'complete') {
      await execute(
        `UPDATE runs SET status='scoring', hj_pending=0, turns_score=NULL, air_score=NULL, air_score_no_dd=NULL, speed_score=NULL, total_score=NULL, updated_at=datetime('now') WHERE id=? AND event_id=?`,
        [req.params.runId, req.params.eventId]
      );
    }

    const updated = await queryOne('SELECT * FROM runs WHERE id=?', [req.params.runId]);
    if (req.app.broadcast) req.app.broadcast(req.params.eventId, 'run_updated', updated);
    try { await logAudit('time_rejected', 'run', req.params.runId, null, { cleared_time: run.run_time }); } catch (_) {}
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /:runId/status -- set DNS / RNS / DSQ flag (Head Judge; Phase 6b will use separate interface)
router.put('/:runId/status', async (req, res) => {
  try {
    const { run_status } = req.body;
    const VALID = [null, '', 'DNS', 'RNS', 'DSQ', 'DNF'];
    if (!VALID.includes(run_status)) return res.status(400).json({ error: 'run_status must be DNS, RNS, DSQ, DNF, or null' });

    const run = await queryOne('SELECT * FROM runs WHERE id=? AND event_id=?', [req.params.runId, req.params.eventId]);
    if (!run) return res.status(404).json({ error: 'Run not found' });

    const statusVal = run_status || null;
    if (statusVal) {
      // Flag set -- mark run complete with the flag; no scores required.
      // Clear hj_pending and null out computed scores so DNF/DNS/DSQ athletes
      // don't retain stale speed/turns/air/total values.
      await execute(
        `UPDATE runs SET run_status=?, status='complete', hj_pending=0,
           turns_score=NULL, air_score=NULL, air_score_no_dd=NULL, speed_score=NULL, total_score=NULL,
           updated_at=datetime('now') WHERE id=? AND event_id=?`,
        [statusVal, req.params.runId, req.params.eventId]
      );
    } else {
      // Flag cleared -- revert to pending so scoring can proceed
      await execute(
        `UPDATE runs SET run_status=NULL, status='pending', updated_at=datetime('now') WHERE id=? AND event_id=?`,
        [req.params.runId, req.params.eventId]
      );
    }

    const updated = await queryOne('SELECT * FROM runs WHERE id=?', [req.params.runId]);
    if (req.app.broadcast) req.app.broadcast(req.params.eventId, 'run_updated', updated);
    try { await logAudit('run_status_set', 'run', req.params.runId, null, { run_status: statusVal }); } catch (_) {}
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Run Round Status (v1.8.03) ──────────────────────────────────────────────

// GET run round statuses for an event (includes computed completion stats)
router.get('/round-status', async (req, res) => {
  try {
    const eventId = req.params.eventId;
    const event = await queryOne('SELECT * FROM events WHERE id=?', [eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // Count total registered athletes (non-scratched)
    const totalRow = await queryOne(
      `SELECT COUNT(*) as cnt FROM registrations WHERE event_id=? AND status='registered'`,
      [eventId]
    );
    const totalAthletes = totalRow ? parseInt(totalRow.cnt) : 0;

    // Get all completed runs grouped by run_number
    const runStats = await queryAll(
      `SELECT run_number, COUNT(*) as completed
       FROM runs WHERE event_id=? AND status='complete'
       GROUP BY run_number ORDER BY run_number`,
      [eventId]
    );

    // Get any in-progress (scoring) runs
    const scoringRuns = await queryAll(
      `SELECT run_number, COUNT(*) as cnt FROM runs WHERE event_id=? AND status='scoring'
       GROUP BY run_number`,
      [eventId]
    );
    const scoringByRun = {};
    scoringRuns.forEach(r => { scoringByRun[r.run_number] = parseInt(r.cnt); });

    // Get stored statuses
    const storedStatuses = await queryAll(
      `SELECT * FROM run_round_status WHERE event_id=?`, [eventId]
    );
    const statusMap = {};
    storedStatuses.forEach(s => { statusMap[s.run_number] = s; });

    // Build response for each run number that has activity, plus run 1 always
    const runNumbers = new Set([1]);
    runStats.forEach(r => runNumbers.add(r.run_number));
    Object.keys(statusMap).forEach(n => runNumbers.add(parseInt(n)));
    // Also include any run number that has scoring activity
    scoringRuns.forEach(r => runNumbers.add(r.run_number));

    const result = [];
    for (const rn of [...runNumbers].sort((a, b) => a - b)) {
      const completedRow = runStats.find(r => r.run_number === rn);
      const completed = completedRow ? parseInt(completedRow.completed) : 0;
      const scoring = scoringByRun[rn] || 0;
      const stored = statusMap[rn];

      let status;
      if (stored && (stored.status === 'finalized' || stored.status === 'hj_review')) {
        status = stored.status;
      } else if (completed >= totalAthletes && totalAthletes > 0 && scoring === 0) {
        status = 'complete';
      } else if (completed > 0 || scoring > 0) {
        status = 'in_progress';
      } else {
        status = 'not_started';
      }

      // If stored says finalized but we derived complete/in_progress, trust stored
      if (stored && stored.status === 'finalized') status = 'finalized';

      // v1.9.00: Include phase label if phases exist
      let name = `Run ${rn}`;
      const phase = await queryOne(
        `SELECT label FROM event_phases WHERE event_id=? AND run_number=?`,
        [eventId, rn]
      );
      if (phase) name = phase.label;

      result.push({
        run_number: rn,
        status,
        completed,
        total: totalAthletes,
        remaining: Math.max(0, totalAthletes - completed),
        scoring,
        review_message: stored?.review_message || null,
        name,
      });
    }

    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST finalize a run round
router.post('/round-status/:runNumber/finalize', async (req, res) => {
  try {
    const eventId = req.params.eventId;
    const runNumber = parseInt(req.params.runNumber);

    // Verify all athletes are complete for this run
    const totalRow = await queryOne(
      `SELECT COUNT(*) as cnt FROM registrations WHERE event_id=? AND status='registered'`,
      [eventId]
    );
    const completedRow = await queryOne(
      `SELECT COUNT(*) as cnt FROM runs WHERE event_id=? AND run_number=? AND status='complete'`,
      [eventId, runNumber]
    );
    const total = totalRow ? parseInt(totalRow.cnt) : 0;
    const completed = completedRow ? parseInt(completedRow.cnt) : 0;
    if (completed < total) {
      return res.status(400).json({ error: `Only ${completed}/${total} athletes completed. All must be complete to finalize.` });
    }

    await execute(
      `INSERT OR REPLACE INTO run_round_status (event_id, run_number, status, review_message, updated_at)
       VALUES (?, ?, 'finalized', NULL, datetime('now'))`,
      [eventId, runNumber]
    );

    if (req.app.broadcast) {
      req.app.broadcast(eventId, 'run_round_status', { run_number: runNumber, status: 'finalized' });
    }
    res.json({ success: true, status: 'finalized' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST send run round to HJ for review
router.post('/round-status/:runNumber/send-review', async (req, res) => {
  try {
    const eventId = req.params.eventId;
    const runNumber = parseInt(req.params.runNumber);

    await execute(
      `INSERT OR REPLACE INTO run_round_status (event_id, run_number, status, review_message, updated_at)
       VALUES (?, ?, 'hj_review', NULL, datetime('now'))`,
      [eventId, runNumber]
    );

    // Also update event_phases if phases exist
    await execute(
      `UPDATE event_phases SET status='hj_review', updated_at=datetime('now')
       WHERE event_id=? AND run_number=?`,
      [eventId, runNumber]
    );

    if (req.app.broadcast) {
      req.app.broadcast(eventId, 'run_round_status', { run_number: runNumber, status: 'hj_review' });
    }
    res.json({ success: true, status: 'hj_review' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST HJ approves and finalizes run round
router.post('/round-status/:runNumber/approve', async (req, res) => {
  try {
    const eventId = req.params.eventId;
    const runNumber = parseInt(req.params.runNumber);

    await execute(
      `INSERT OR REPLACE INTO run_round_status (event_id, run_number, status, review_message, updated_at)
       VALUES (?, ?, 'finalized', NULL, datetime('now'))`,
      [eventId, runNumber]
    );

    // Also update event_phases if phases exist
    await execute(
      `UPDATE event_phases SET status='finalized', review_message=NULL, updated_at=datetime('now')
       WHERE event_id=? AND run_number=?`,
      [eventId, runNumber]
    );

    // Check if all phases are now finalized (event completed)
    const allPhases = await queryAll(`SELECT status FROM event_phases WHERE event_id=?`, [eventId]);
    const eventCompleted = allPhases.length > 0 && allPhases.every(p => p.status === 'finalized');

    if (req.app.broadcast) {
      req.app.broadcast(eventId, 'run_round_status', { run_number: runNumber, status: 'finalized', event_completed: eventCompleted });
    }
    res.json({ success: true, status: 'finalized', event_completed: eventCompleted });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST HJ returns run round for review (back to complete, not finalized)
router.post('/round-status/:runNumber/return', async (req, res) => {
  try {
    const eventId = req.params.eventId;
    const runNumber = parseInt(req.params.runNumber);
    const message = req.body.message || 'Run returned for review by Head Judge';

    await execute(
      `INSERT OR REPLACE INTO run_round_status (event_id, run_number, status, review_message, updated_at)
       VALUES (?, ?, 'complete', ?, datetime('now'))`,
      [eventId, runNumber, message]
    );

    // Also update event_phases if phases exist
    await execute(
      `UPDATE event_phases SET status='complete', review_message=?, updated_at=datetime('now')
       WHERE event_id=? AND run_number=?`,
      [message, eventId, runNumber]
    );

    if (req.app.broadcast) {
      req.app.broadcast(eventId, 'run_round_status', { run_number: runNumber, status: 'complete', review_message: message });
    }
    res.json({ success: true, status: 'complete', review_message: message });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST reopen a finalized run round
router.post('/round-status/:runNumber/reopen', async (req, res) => {
  try {
    const eventId = req.params.eventId;
    const runNumber = parseInt(req.params.runNumber);

    await execute(
      `INSERT OR REPLACE INTO run_round_status (event_id, run_number, status, review_message, updated_at)
       VALUES (?, ?, 'complete', NULL, datetime('now'))`,
      [eventId, runNumber]
    );

    // Also update event_phases if phases exist
    await execute(
      `UPDATE event_phases SET status='complete', review_message=NULL, updated_at=datetime('now')
       WHERE event_id=? AND run_number=?`,
      [eventId, runNumber]
    );

    if (req.app.broadcast) {
      req.app.broadcast(eventId, 'run_round_status', { run_number: runNumber, status: 'complete' });
    }
    res.json({ success: true, status: 'complete' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET run review data for HJ (scores in place order for a given run number)
router.get('/round-review/:runNumber', async (req, res) => {
  try {
    const eventId = req.params.eventId;
    const runNumber = parseInt(req.params.runNumber);

    const event = await queryOne('SELECT * FROM events WHERE id=?', [eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // Get all completed runs for this run number with athlete info, ordered by total_score desc
    const runs = await queryAll(
      `SELECT r.*, reg.bib_number, a.first_name, a.last_name
       FROM runs r
       JOIN registrations reg ON reg.id = r.registration_id
       JOIN athletes a ON a.id = reg.athlete_id
       WHERE r.event_id = ? AND r.run_number = ? AND r.status = 'complete'
       ORDER BY CASE WHEN r.run_status IS NOT NULL THEN 1 ELSE 0 END,
                r.total_score DESC`,
      [eventId, runNumber]
    );

    // For each run, get judge scores
    const results = [];
    let place = 0;
    for (const run of runs) {
      place++;
      const scores = await queryAll(
        `SELECT js.*, j.role, j.name FROM judge_scores js
         JOIN judges j ON j.id = js.judge_id
         WHERE js.run_id = ?`,
        [run.id]
      );

      // Group scores by role
      const tlScores = scores.filter(s => /^TL/.test(s.role)).map(s => ({
        role: s.role, raw_score: s.raw_score
      }));
      const airScores = scores.filter(s => /^Air/.test(s.role)).map(s => ({
        role: s.role, score_type: s.score_type, raw_score: s.raw_score
      }));

      results.push({
        place: run.run_status ? null : place,
        run_id: run.id,
        bib_number: run.bib_number,
        first_name: run.first_name,
        last_name: run.last_name,
        tl_scores: tlScores,
        air_scores: airScores,
        speed_score: run.speed_score,
        run_time: run.run_time,
        total_score: run.total_score,
        turns_score: run.turns_score,
        air_score: run.air_score,
        run_status: run.run_status,
      });
    }

    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
