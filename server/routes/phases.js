const router = require('express').Router({ mergeParams: true });
const { queryAll, queryOne, execute, uuidv4 } = require('../db/schema');
const { rankResults, pickBestRun, applyTierRanks, takeUpToRank } = require('../scoring/engine');
const { requireUnlocked } = require('../middleware/lockCheck');
router.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return requireUnlocked()(req, res, next);
  next();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

// Resolve event discipline once (cached per call site by callers)
async function getDiscipline(eventId) {
  const evt = await queryOne('SELECT discipline FROM events WHERE id=?', [eventId]);
  return evt ? evt.discipline : 'mogul';
}

// Get ranked results for a given run_number within an event
async function rankedRunResults(eventId, runNumber, discipline) {
  const runs = await queryAll(
    `SELECT r.*, reg.bib_number, a.first_name, a.last_name, a.ussa_num, a.club, a.nation, a.fis_id, a.birth_year
     FROM runs r
     JOIN registrations reg ON reg.id = r.registration_id
     JOIN athletes a ON a.id = reg.athlete_id
     WHERE r.event_id = ? AND r.run_number = ? AND r.status = 'complete' AND r.run_status IS NULL
     ORDER BY r.total_score DESC`,
    [eventId, runNumber]
  );
  const disc = discipline || await getDiscipline(eventId);
  return rankResults(runs, disc);
}

// Get best score per athlete across multiple run_numbers
async function bestScoreResults(eventId, runNumbers, discipline) {
  const placeholders = runNumbers.map(() => '?').join(',');
  const runs = await queryAll(
    `SELECT r.*, reg.bib_number, a.first_name, a.last_name, a.ussa_num, a.club, a.nation, a.fis_id, a.birth_year
     FROM runs r
     JOIN registrations reg ON reg.id = r.registration_id
     JOIN athletes a ON a.id = reg.athlete_id
     WHERE r.event_id = ? AND r.run_number IN (${placeholders}) AND r.status = 'complete' AND r.run_status IS NULL
     ORDER BY r.total_score DESC`,
    [eventId, ...runNumbers]
  );
  const disc = discipline || await getDiscipline(eventId);
  const best = pickBestRun(runs, disc);
  return rankResults(Object.values(best), disc);
}

// Determine the event format from existing phases
function getFormat(phases) {
  if (!phases || phases.length === 0) return 'none';
  const types = phases.map(p => p.phase_type);
  if (types.includes('final_1') || types.includes('final_2') || types.includes('qualifier_2')) return 'qualifier_finals';
  if (types.includes('best_of_2')) return 'best_of_2';
  return 'single';
}

// Build run order based on method
function buildRunOrder(athletes, method, priorRanked) {
  let ordered = [...athletes];

  switch (method) {
    case 'random': {
      // Fisher-Yates shuffle
      for (let i = ordered.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
      }
      break;
    }
    case 'last_to_first': {
      if (priorRanked && priorRanked.length) {
        // Sort by prior rank descending (worst first, best last)
        const rankMap = {};
        priorRanked.forEach(r => { rankMap[r.registration_id] = r.rank; });
        ordered.sort((a, b) => {
          const ra = rankMap[a.id] || rankMap[a.registration_id] || 999;
          const rb = rankMap[b.id] || rankMap[b.registration_id] || 999;
          return rb - ra; // higher rank number (worse) goes first
        });
      }
      break;
    }
    case '16_down': {
      if (priorRanked && priorRanked.length) {
        const rankMap = {};
        priorRanked.forEach(r => { rankMap[r.registration_id] = r.rank; });
        // Split: top 16 reversed, then 17+ reversed
        const withRank = ordered.map(a => ({
          ...a,
          _rank: rankMap[a.id] || rankMap[a.registration_id] || 999
        }));
        withRank.sort((a, b) => a._rank - b._rank); // sort by rank ascending
        const top16 = withRank.slice(0, 16).reverse(); // 16th first, 1st last
        const rest = withRank.slice(16); // 17th, 18th, ... in order
        ordered = [...top16, ...rest];
      }
      break;
    }
    case 'same':
    default:
      // Keep existing order (sorted by run_order from prior phase)
      ordered.sort((a, b) => (a.run_order || a._prior_order || 999) - (b.run_order || b._prior_order || 999));
      break;
  }

  return ordered;
}

// ── GET all phases for event ─────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const phases = await queryAll(
      `SELECT * FROM event_phases WHERE event_id = ? ORDER BY sequence_order`,
      [req.params.eventId]
    );
    res.json(phases);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST create next phase ───────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const eventId = req.params.eventId;
    const event = await queryOne('SELECT * FROM events WHERE id=?', [eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const { phase_type, run_order_method, pass_through_count = 0, final_size = 0 } = req.body;

    if (!phase_type) return res.status(400).json({ error: 'phase_type required' });

    const existingPhases = await queryAll(
      `SELECT * FROM event_phases WHERE event_id = ? ORDER BY sequence_order`, [eventId]
    );

    const format = getFormat(existingPhases);

    // Validate phase_type based on what exists
    if (phase_type === 'best_of_2') {
      if (existingPhases.some(p => p.phase_type !== 'run')) {
        return res.status(400).json({ error: 'Cannot add Best of 2 when qualifier/finals phases exist' });
      }
      if (existingPhases.some(p => p.phase_type === 'best_of_2')) {
        return res.status(400).json({ error: 'Best of 2 already added' });
      }
    }

    if (phase_type === 'qualifier_2') {
      if (format === 'best_of_2') {
        return res.status(400).json({ error: 'Cannot add Qualifier 2 to a Best of 2 event' });
      }
      if (existingPhases.some(p => p.phase_type === 'qualifier_2')) {
        return res.status(400).json({ error: 'Qualifier 2 already exists' });
      }
      if (existingPhases.some(p => p.phase_type === 'final_1')) {
        return res.status(400).json({ error: 'Cannot add Qualifier 2 after Final 1' });
      }
    }

    if (phase_type === 'final_1') {
      if (format === 'best_of_2') {
        return res.status(400).json({ error: 'Cannot add Final 1 to a Best of 2 event' });
      }
      if (existingPhases.some(p => p.phase_type === 'final_1')) {
        return res.status(400).json({ error: 'Final 1 already exists' });
      }
    }

    if (phase_type === 'final_2') {
      if (!existingPhases.some(p => p.phase_type === 'final_1')) {
        return res.status(400).json({ error: 'Final 1 must exist before adding Final 2' });
      }
      const f1 = existingPhases.find(p => p.phase_type === 'final_1');
      if (f1.status !== 'finalized') {
        return res.status(400).json({ error: 'Final 1 must be finalized before adding Final 2' });
      }
      if (existingPhases.some(p => p.phase_type === 'final_2')) {
        return res.status(400).json({ error: 'Final 2 already exists' });
      }
    }

    // Check that the previous phase is finalized
    if (existingPhases.length > 0) {
      const lastPhase = existingPhases[existingPhases.length - 1];
      if (lastPhase.status !== 'finalized') {
        return res.status(400).json({ error: `${lastPhase.label} must be finalized before adding next phase` });
      }
    } else {
      // First "next phase" being added - check that Run 1 is finalized via run_round_status
      const rrs = await queryOne(
        `SELECT status FROM run_round_status WHERE event_id=? AND run_number=1`, [eventId]
      );
      if (!rrs || rrs.status !== 'finalized') {
        return res.status(400).json({ error: 'Run 1 must be finalized before adding the next phase' });
      }
    }

    // If no phases exist yet, create Phase 1 retroactively
    const createdPhases = [];
    if (existingPhases.length === 0) {
      const phase1Label = (phase_type === 'best_of_2') ? 'Run 1' : 'Qualifier 1';
      const phase1Id = uuidv4();
      await execute(
        `INSERT INTO event_phases (id, event_id, phase_type, run_number, label, run_order_method, status, sequence_order)
         VALUES (?, ?, 'run', 1, ?, 'same', 'finalized', 1)`,
        [phase1Id, eventId, phase1Label]
      );

      // Copy existing run_order from registrations into phase_run_order for Phase 1
      const regs = await queryAll(
        `SELECT id, run_order FROM registrations WHERE event_id=? AND status='registered' AND run_order IS NOT NULL`,
        [eventId]
      );
      for (const r of regs) {
        await execute(
          `INSERT OR IGNORE INTO phase_run_order (id, phase_id, registration_id, run_order) VALUES (?, ?, ?, ?)`,
          [uuidv4(), phase1Id, r.id, r.run_order]
        );
      }
      createdPhases.push({ id: phase1Id, label: phase1Label, phase_type: 'run', run_number: 1, sequence_order: 1 });
    }

    // Determine run_number and label for the new phase
    const allPhases = [...existingPhases, ...createdPhases];
    const nextRunNumber = allPhases.length > 0 ? Math.max(...allPhases.map(p => p.run_number)) + 1 : 2;
    const nextSequence = allPhases.length + 1;

    let label;
    let defaultMethod = run_order_method || 'same';
    switch (phase_type) {
      case 'best_of_2':
        label = 'Run 2';
        if (!run_order_method) defaultMethod = '16_down';
        break;
      case 'qualifier_2':
        label = 'Qualifier 2';
        if (!run_order_method) defaultMethod = 'last_to_first';
        break;
      case 'final_1':
        label = 'Final 1';
        if (!run_order_method) defaultMethod = 'last_to_first';
        break;
      case 'final_2':
        label = 'Final 2';
        if (!run_order_method) defaultMethod = 'last_to_first';
        break;
      default:
        return res.status(400).json({ error: 'Invalid phase_type' });
    }

    // If adding Q2 or F1, relabel Phase 1 from "Run 1" to "Qualifier 1"
    if ((phase_type === 'qualifier_2' || phase_type === 'final_1') && allPhases.length > 0) {
      const p1 = allPhases.find(p => p.run_number === 1);
      if (p1 && p1.label === 'Run 1') {
        await execute(`UPDATE event_phases SET label='Qualifier 1' WHERE id=?`, [p1.id]);
      }
    }

    // Create the new phase
    const newId = uuidv4();
    await execute(
      `INSERT INTO event_phases (id, event_id, phase_type, run_number, label, run_order_method, pass_through_count, final_size, status, sequence_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'not_started', ?)`,
      [newId, eventId, phase_type, nextRunNumber, label, defaultMethod, pass_through_count || 0, final_size || 0, nextSequence]
    );

    // Determine eligible athletes and assign run order
    const allRegs = await queryAll(
      `SELECT id, run_order FROM registrations WHERE event_id=? AND status='registered'`,
      [eventId]
    );

    let eligible = [];
    let priorRanked = null;

    if (phase_type === 'best_of_2') {
      // All athletes are eligible
      eligible = allRegs;
      // Get prior ranking from run 1
      priorRanked = await rankedRunResults(eventId, 1);
    } else if (phase_type === 'qualifier_2') {
      // Remove pass-through athletes (top N from Q1)
      const q1Ranked = await rankedRunResults(eventId, 1);
      const ptCount = pass_through_count || 0;
      const passThroughIds = new Set(takeUpToRank(q1Ranked, ptCount).map(r => r.registration_id));
      eligible = allRegs.filter(r => !passThroughIds.has(r.id));
      priorRanked = q1Ranked;
    } else if (phase_type === 'final_1') {
      const fSize = final_size || 16;
      const q2Phase = allPhases.find(p => p.phase_type === 'qualifier_2');

      if (q2Phase) {
        // Pass-through from Q1 + top from Q2
        const ptCount = q2Phase.pass_through_count || 0;
        const q1Ranked = await rankedRunResults(eventId, 1);
        const passThrough = takeUpToRank(q1Ranked, ptCount);
        const passThroughIds = new Set(passThrough.map(r => r.registration_id));

        const q2Ranked = await rankedRunResults(eventId, q2Phase.run_number);
        const remainingSlots = fSize - ptCount;
        const q2Qualifiers = takeUpToRank(q2Ranked, Math.max(0, remainingSlots));

        const eligibleIds = new Set([
          ...passThrough.map(r => r.registration_id),
          ...q2Qualifiers.map(r => r.registration_id),
        ]);
        eligible = allRegs.filter(r => eligibleIds.has(r.id));

        // For run order, use best qualifier scores for ranking
        const bestQual = await bestScoreResults(eventId, [1, q2Phase.run_number]);
        priorRanked = bestQual.filter(r => eligibleIds.has(r.registration_id));
      } else {
        // No Q2 - just top from Q1
        const q1Ranked = await rankedRunResults(eventId, 1);
        const topQ1 = takeUpToRank(q1Ranked, fSize);
        const eligibleIds = new Set(topQ1.map(r => r.registration_id));
        eligible = allRegs.filter(r => eligibleIds.has(r.id));
        priorRanked = topQ1;
      }
    } else if (phase_type === 'final_2') {
      const f1Phase = allPhases.find(p => p.phase_type === 'final_1');
      const fSize = final_size || 8;
      const f1Ranked = await rankedRunResults(eventId, f1Phase.run_number);
      const topF1 = takeUpToRank(f1Ranked, fSize);
      const eligibleIds = new Set(topF1.map(r => r.registration_id));
      eligible = allRegs.filter(r => eligibleIds.has(r.id));
      priorRanked = topF1;
    }

    // Attach prior order for 'same' method
    if (allPhases.length > 0) {
      const prevPhase = allPhases[allPhases.length - 1];
      const prevOrders = await queryAll(
        `SELECT registration_id, run_order FROM phase_run_order WHERE phase_id=?`,
        [prevPhase.id]
      );
      const prevMap = {};
      prevOrders.forEach(o => { prevMap[o.registration_id] = o.run_order; });
      eligible = eligible.map(e => ({ ...e, _prior_order: prevMap[e.id] || e.run_order || 999 }));
    }

    const ordered = buildRunOrder(eligible, defaultMethod, priorRanked);

    // Save phase_run_order
    for (let i = 0; i < ordered.length; i++) {
      const regId = ordered[i].id || ordered[i].registration_id;
      await execute(
        `INSERT OR REPLACE INTO phase_run_order (id, phase_id, registration_id, run_order) VALUES (?, ?, ?, ?)`,
        [uuidv4(), newId, regId, i + 1]
      );
    }

    if (req.app.broadcast) {
      req.app.broadcast(eventId, 'phase_created', { phase_id: newId, phase_type, label });
    }

    // Detect undersized field — the cut produced fewer athletes than the
    // configured size. Most often happens when the prior phase had many
    // DNS/DNF/DSQ runs or fewer registrations than expected. Tied-rank
    // expansion is the opposite case (handled by takeUpToRank itself).
    let undersizedNotice = null;
    if (phase_type === 'final_1' || phase_type === 'final_2') {
      const expected = (phase_type === 'final_1') ? (final_size || 16) : (final_size || 8);
      if (ordered.length < expected) {
        undersizedNotice = `${label} configured for ${expected} athletes but only ${ordered.length} qualified — proceeding with ${ordered.length}.`;
      }
    } else if (phase_type === 'qualifier_2') {
      // Q2 takes everyone NOT in pass-through. Undersized would mean Q1 had
      // fewer-than-pass-through athletes; warn so admin notices.
      const ptCount = pass_through_count || 0;
      const q1Count = (priorRanked || []).length;
      if (ptCount > q1Count) {
        undersizedNotice = `${label}: pass-through configured at ${ptCount} but only ${q1Count} athletes completed Qualifier 1.`;
      }
    }

    const result = await queryOne('SELECT * FROM event_phases WHERE id=?', [newId]);
    res.status(201).json({
      phase: result,
      eligible_count: ordered.length,
      created_phases: createdPhases.length > 0 ? createdPhases : undefined,
      undersized_notice: undersizedNotice,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE cancel/remove a phase (weather interruption) ──────────────────────
router.delete('/:phaseId', async (req, res) => {
  try {
    const eventId = req.params.eventId;
    const phaseId = req.params.phaseId;

    const phase = await queryOne('SELECT * FROM event_phases WHERE id=? AND event_id=?', [phaseId, eventId]);
    if (!phase) return res.status(404).json({ error: 'Phase not found' });

    // Cannot delete Phase 1 (run_number=1 / sequence_order=1)
    if (phase.sequence_order === 1) {
      return res.status(400).json({ error: 'Cannot delete the first phase' });
    }

    // Can only delete the last phase (must delete in reverse order)
    const allPhases = await queryAll(
      `SELECT * FROM event_phases WHERE event_id=? ORDER BY sequence_order`, [eventId]
    );
    if (allPhases[allPhases.length - 1].id !== phaseId) {
      return res.status(400).json({ error: 'Can only delete the last phase. Remove later phases first.' });
    }

    // Delete runs for this phase's run_number
    await execute(`DELETE FROM judge_scores WHERE run_id IN (SELECT id FROM runs WHERE event_id=? AND run_number=?)`,
      [eventId, phase.run_number]);
    await execute(`DELETE FROM runs WHERE event_id=? AND run_number=?`, [eventId, phase.run_number]);

    // Delete phase_run_order
    await execute(`DELETE FROM phase_run_order WHERE phase_id=?`, [phaseId]);

    // Delete run_round_status entry
    await execute(`DELETE FROM run_round_status WHERE event_id=? AND run_number=?`, [eventId, phase.run_number]);

    // Delete the phase
    await execute(`DELETE FROM event_phases WHERE id=?`, [phaseId]);

    // If only Phase 1 remains and it was relabeled, check if we should revert
    const remaining = await queryAll(`SELECT * FROM event_phases WHERE event_id=? ORDER BY sequence_order`, [eventId]);
    if (remaining.length === 1 && remaining[0].label === 'Qualifier 1') {
      // Revert to "Run 1" since there's no qualifier/finals context anymore
      await execute(`UPDATE event_phases SET label='Run 1' WHERE id=?`, [remaining[0].id]);
    }

    // If no phases remain except Phase 1, and it's the only one, we could clean up
    // But Phase 1 should remain as it has valid data

    if (req.app.broadcast) {
      req.app.broadcast(eventId, 'phase_deleted', { phase_id: phaseId });
    }

    res.json({ success: true, deleted: phase.label });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Phase status endpoints ───────────────────────────────────────────────────

// GET computed phase statuses (like round-status but phase-aware)
router.get('/status', async (req, res) => {
  try {
    const eventId = req.params.eventId;
    const phases = await queryAll(
      `SELECT * FROM event_phases WHERE event_id=? ORDER BY sequence_order`, [eventId]
    );

    if (phases.length === 0) return res.json([]);

    const result = [];
    for (const phase of phases) {
      // Count eligible athletes for this phase
      const eligibleRow = await queryOne(
        `SELECT COUNT(*) as cnt FROM phase_run_order WHERE phase_id=?`, [phase.id]
      );
      const totalAthletes = eligibleRow ? parseInt(eligibleRow.cnt) : 0;

      // Count completed runs
      const completedRow = await queryOne(
        `SELECT COUNT(*) as cnt FROM runs WHERE event_id=? AND run_number=? AND status='complete'`,
        [eventId, phase.run_number]
      );
      const completed = completedRow ? parseInt(completedRow.cnt) : 0;

      // Count scoring
      const scoringRow = await queryOne(
        `SELECT COUNT(*) as cnt FROM runs WHERE event_id=? AND run_number=? AND status='scoring'`,
        [eventId, phase.run_number]
      );
      const scoring = scoringRow ? parseInt(scoringRow.cnt) : 0;

      // Compute status
      let status = phase.status;
      if (status !== 'finalized' && status !== 'hj_review') {
        if (completed >= totalAthletes && totalAthletes > 0 && scoring === 0) {
          status = 'complete';
        } else if (completed > 0 || scoring > 0) {
          status = 'in_progress';
        } else {
          status = 'not_started';
        }
      }

      result.push({
        id: phase.id,
        phase_type: phase.phase_type,
        run_number: phase.run_number,
        label: phase.label,
        status,
        completed,
        total: totalAthletes,
        remaining: Math.max(0, totalAthletes - completed),
        scoring,
        review_message: phase.review_message,
        sequence_order: phase.sequence_order,
        run_order_method: phase.run_order_method,
        pass_through_count: phase.pass_through_count,
        final_size: phase.final_size,
      });
    }

    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST finalize phase
router.post('/:phaseId/finalize', async (req, res) => {
  try {
    const { eventId, phaseId } = req.params;
    const phase = await queryOne('SELECT * FROM event_phases WHERE id=? AND event_id=?', [phaseId, eventId]);
    if (!phase) return res.status(404).json({ error: 'Phase not found' });

    // Check all eligible athletes completed
    const eligibleRow = await queryOne(`SELECT COUNT(*) as cnt FROM phase_run_order WHERE phase_id=?`, [phaseId]);
    const total = eligibleRow ? parseInt(eligibleRow.cnt) : 0;
    const completedRow = await queryOne(
      `SELECT COUNT(*) as cnt FROM runs WHERE event_id=? AND run_number=? AND status='complete'`,
      [eventId, phase.run_number]
    );
    const completed = completedRow ? parseInt(completedRow.cnt) : 0;

    if (completed < total) {
      return res.status(400).json({ error: `Only ${completed}/${total} athletes completed. All must be complete to finalize.` });
    }

    await execute(`UPDATE event_phases SET status='finalized', review_message=NULL, updated_at=datetime('now') WHERE id=?`, [phaseId]);

    // Also update run_round_status for compatibility
    await execute(
      `INSERT OR REPLACE INTO run_round_status (event_id, run_number, status, review_message, updated_at) VALUES (?, ?, 'finalized', NULL, datetime('now'))`,
      [eventId, phase.run_number]
    );

    if (req.app.broadcast) {
      req.app.broadcast(eventId, 'run_round_status', { run_number: phase.run_number, status: 'finalized', phase_id: phaseId });
    }
    res.json({ success: true, status: 'finalized' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST send phase to HJ for review
router.post('/:phaseId/send-review', async (req, res) => {
  try {
    const { eventId, phaseId } = req.params;
    await execute(`UPDATE event_phases SET status='hj_review', review_message=NULL, updated_at=datetime('now') WHERE id=? AND event_id=?`, [phaseId, eventId]);

    const phase = await queryOne('SELECT * FROM event_phases WHERE id=?', [phaseId]);
    await execute(
      `INSERT OR REPLACE INTO run_round_status (event_id, run_number, status, review_message, updated_at) VALUES (?, ?, 'hj_review', NULL, datetime('now'))`,
      [eventId, phase.run_number]
    );

    if (req.app.broadcast) {
      req.app.broadcast(eventId, 'run_round_status', { run_number: phase.run_number, status: 'hj_review', phase_id: phaseId });
    }
    res.json({ success: true, status: 'hj_review' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST HJ approves phase
router.post('/:phaseId/approve', async (req, res) => {
  try {
    const { eventId, phaseId } = req.params;
    await execute(`UPDATE event_phases SET status='finalized', review_message=NULL, updated_at=datetime('now') WHERE id=? AND event_id=?`, [phaseId, eventId]);

    const phase = await queryOne('SELECT * FROM event_phases WHERE id=?', [phaseId]);
    await execute(
      `INSERT OR REPLACE INTO run_round_status (event_id, run_number, status, review_message, updated_at) VALUES (?, ?, 'finalized', NULL, datetime('now'))`,
      [eventId, phase.run_number]
    );

    // Check if all phases are now finalized (event completed)
    const allPhases = await queryAll('SELECT status FROM event_phases WHERE event_id=?', [eventId]);
    const eventCompleted = allPhases.length > 0 && allPhases.every(p => p.status === 'finalized');

    if (req.app.broadcast) {
      req.app.broadcast(eventId, 'run_round_status', { run_number: phase.run_number, status: 'finalized', phase_id: phaseId, event_completed: eventCompleted });
    }
    res.json({ success: true, status: 'finalized', event_completed: eventCompleted });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST HJ returns phase for review
router.post('/:phaseId/return', async (req, res) => {
  try {
    const { eventId, phaseId } = req.params;
    const message = req.body.message || 'Returned for review by Head Judge';
    await execute(`UPDATE event_phases SET status='complete', review_message=?, updated_at=datetime('now') WHERE id=? AND event_id=?`, [message, phaseId, eventId]);

    const phase = await queryOne('SELECT * FROM event_phases WHERE id=?', [phaseId]);
    await execute(
      `INSERT OR REPLACE INTO run_round_status (event_id, run_number, status, review_message, updated_at) VALUES (?, ?, 'complete', ?, datetime('now'))`,
      [eventId, phase.run_number, message]
    );

    if (req.app.broadcast) {
      req.app.broadcast(eventId, 'run_round_status', { run_number: phase.run_number, status: 'complete', review_message: message, phase_id: phaseId });
    }
    res.json({ success: true, status: 'complete', review_message: message });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST reopen finalized phase
router.post('/:phaseId/reopen', async (req, res) => {
  try {
    const { eventId, phaseId } = req.params;
    const phase = await queryOne('SELECT * FROM event_phases WHERE id=? AND event_id=?', [phaseId, eventId]);
    if (!phase) return res.status(404).json({ error: 'Phase not found' });

    // Cannot reopen if a later phase exists
    const laterPhase = await queryOne(
      `SELECT id FROM event_phases WHERE event_id=? AND sequence_order > ?`, [eventId, phase.sequence_order]
    );
    if (laterPhase) {
      return res.status(400).json({ error: 'Cannot reopen: later phases exist. Delete them first.' });
    }

    await execute(`UPDATE event_phases SET status='complete', review_message=NULL, updated_at=datetime('now') WHERE id=?`, [phaseId]);

    await execute(
      `INSERT OR REPLACE INTO run_round_status (event_id, run_number, status, review_message, updated_at) VALUES (?, ?, 'complete', NULL, datetime('now'))`,
      [eventId, phase.run_number]
    );

    if (req.app.broadcast) {
      req.app.broadcast(eventId, 'run_round_status', { run_number: phase.run_number, status: 'complete', phase_id: phaseId });
    }
    res.json({ success: true, status: 'complete' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET eligible athletes + run order for a phase ────────────────────────────
router.get('/:phaseId/eligible', async (req, res) => {
  try {
    const { eventId, phaseId } = req.params;
    const phase = await queryOne('SELECT * FROM event_phases WHERE id=? AND event_id=?', [phaseId, eventId]);
    if (!phase) return res.status(404).json({ error: 'Phase not found' });

    const athletes = await queryAll(
      `SELECT pro.run_order, reg.id as registration_id, reg.bib_number, a.first_name, a.last_name
       FROM phase_run_order pro
       JOIN registrations reg ON reg.id = pro.registration_id
       JOIN athletes a ON a.id = reg.athlete_id
       WHERE pro.phase_id = ?
       ORDER BY pro.run_order`,
      [phaseId]
    );

    res.json(athletes);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET phase-based results ──────────────────────────────────────────────────
router.get('/results', async (req, res) => {
  try {
    const eventId = req.params.eventId;
    const phases = await queryAll(
      `SELECT * FROM event_phases WHERE event_id=? ORDER BY sequence_order`, [eventId]
    );

    if (phases.length === 0) return res.json({ format: 'none', results: [] });

    const format = getFormat(phases);

    if (format === 'best_of_2') {
      const runNumbers = phases.map(p => p.run_number);
      const results = await bestScoreResults(eventId, runNumbers);

      // Attach per-run scores for display
      const allRuns = await queryAll(
        `SELECT r.id, r.registration_id, r.run_number, r.total_score, r.turns_score, r.air_score, r.speed_score, r.run_time, r.run_status, r.jump1_code, r.jump2_code
         FROM runs r WHERE r.event_id=? AND r.status='complete'
         ORDER BY r.run_number`, [eventId]
      );
      const runsByReg = {};
      for (const r of allRuns) {
        if (!runsByReg[r.registration_id]) runsByReg[r.registration_id] = {};
        // Keep best score per run_number per registration
        if (!runsByReg[r.registration_id][r.run_number] || r.total_score > runsByReg[r.registration_id][r.run_number].total_score) {
          runsByReg[r.registration_id][r.run_number] = r;
        }
      }

      const enriched = results.map(r => ({
        ...r,
        runs: runsByReg[r.registration_id] || {},
        best_score: r.total_score,
      }));

      // Get flagged athletes
      const flaggedRuns = await queryAll(
        `SELECT r.*, reg.bib_number, a.first_name, a.last_name, a.ussa_num, a.club
         FROM runs r JOIN registrations reg ON reg.id=r.registration_id JOIN athletes a ON a.id=reg.athlete_id
         WHERE r.event_id=? AND r.status='complete' AND r.run_status IS NOT NULL`,
        [eventId]
      );
      const scoredIds = new Set(results.map(r => r.registration_id));
      const flagged = {};
      for (const r of flaggedRuns) {
        if (!scoredIds.has(r.registration_id)) flagged[r.registration_id] = r;
      }

      res.json({
        format: 'best_of_2',
        phases: phases.map(p => ({ id: p.id, label: p.label, run_number: p.run_number, phase_type: p.phase_type })),
        results: [...enriched, ...Object.values(flagged).map(r => ({ ...r, rank: null, runs: runsByReg[r.registration_id] || {} }))],
      });
    } else if (format === 'qualifier_finals') {
      // Phase-based tiered ranking
      const f2 = phases.find(p => p.phase_type === 'final_2');
      const f1 = phases.find(p => p.phase_type === 'final_1');
      const q2 = phases.find(p => p.phase_type === 'qualifier_2');
      const qualRunNumbers = phases.filter(p => p.phase_type === 'run' || p.phase_type === 'qualifier_2').map(p => p.run_number);

      const discipline = await getDiscipline(eventId);
      const tiers = [];
      let globalRank = 1;
      const rankedIds = new Set();

      // Tier 1: Final 2 athletes
      if (f2 && f2.status === 'finalized') {
        const f2Results = await rankedRunResults(eventId, f2.run_number, discipline);
        globalRank = applyTierRanks(f2Results, discipline, globalRank);
        for (const r of f2Results) {
          r.tier = 'final_2';
          r.tier_label = 'Final 2';
          tiers.push(r);
          rankedIds.add(r.registration_id);
        }
      }

      // Tier 2: Final 1 athletes not in Final 2
      if (f1) {
        const f1Results = await rankedRunResults(eventId, f1.run_number, discipline);
        const f1Filtered = f1Results.filter(r => !rankedIds.has(r.registration_id));
        globalRank = applyTierRanks(f1Filtered, discipline, globalRank);
        for (const r of f1Filtered) {
          r.tier = 'final_1';
          r.tier_label = 'Final 1';
          tiers.push(r);
          rankedIds.add(r.registration_id);
        }
      }

      // Tier 3: Qualifier athletes not in Finals
      if (qualRunNumbers.length > 0) {
        const qualResults = await bestScoreResults(eventId, qualRunNumbers, discipline);
        const qFiltered = qualResults.filter(r => !rankedIds.has(r.registration_id));
        globalRank = applyTierRanks(qFiltered, discipline, globalRank);
        for (const r of qFiltered) {
          r.tier = 'qualifier';
          r.tier_label = q2 ? 'Qualification' : 'Qualifier 1';
          tiers.push(r);
          rankedIds.add(r.registration_id);
        }
      }

      // Flagged athletes (DNS/DNF/DSQ)
      const allRuns = await queryAll(
        `SELECT r.*, reg.bib_number, a.first_name, a.last_name, a.ussa_num, a.club
         FROM runs r JOIN registrations reg ON reg.id=r.registration_id JOIN athletes a ON a.id=reg.athlete_id
         WHERE r.event_id=? AND r.status='complete' AND r.run_status IS NOT NULL`,
        [eventId]
      );
      for (const r of allRuns) {
        if (!rankedIds.has(r.registration_id)) {
          r.rank = null;
          r.tier = 'flagged';
          r.tier_label = r.run_status;
          tiers.push(r);
          rankedIds.add(r.registration_id);
        }
      }

      // Attach per-phase run data for display
      const allRunData = await queryAll(
        `SELECT r.id, r.registration_id, r.run_number, r.total_score, r.turns_score, r.air_score, r.speed_score, r.run_time, r.run_status, r.jump1_code, r.jump2_code
         FROM runs r WHERE r.event_id=? AND r.status='complete' ORDER BY r.run_number`, [eventId]
      );
      const runsByReg = {};
      for (const r of allRunData) {
        if (!runsByReg[r.registration_id]) runsByReg[r.registration_id] = {};
        if (!runsByReg[r.registration_id][r.run_number] || r.total_score > (runsByReg[r.registration_id][r.run_number].total_score || 0)) {
          runsByReg[r.registration_id][r.run_number] = r;
        }
      }
      tiers.forEach(r => { r.runs = runsByReg[r.registration_id] || {}; });

      res.json({
        format: 'qualifier_finals',
        phases: phases.map(p => ({ id: p.id, label: p.label, run_number: p.run_number, phase_type: p.phase_type, status: p.status })),
        results: tiers,
      });
    } else {
      // Single run - just return standard results
      const results = await rankedRunResults(eventId, 1);
      res.json({
        format: 'single',
        phases: phases.map(p => ({ id: p.id, label: p.label, run_number: p.run_number, phase_type: p.phase_type })),
        results,
      });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
