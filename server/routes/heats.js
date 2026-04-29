const router = require('express').Router({ mergeParams: true });
const { queryAll, queryOne, execute, batch, uuidv4 } = require('../db/schema');
const { requireUnlocked } = require('../middleware/lockCheck');
router.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return requireUnlocked()(req, res, next);
  next();
});

// GET /api/events/:eventId/heats
// Returns all heats for the event, each with an athletes array.
router.get('/', async (req, res) => {
  try {
    const heats = await queryAll(
      `SELECT * FROM heats WHERE event_id=? ORDER BY round, heat_number`,
      [req.params.eventId]
    );
    // Attach athletes to each heat
    for (const h of heats) {
      h.athletes = await queryAll(
        `SELECT r.*, a.first_name, a.last_name, a.ussa_num, a.fis_id, a.nation, a.club, r.bib_number
         FROM registrations r JOIN athletes a ON a.id=r.athlete_id
         WHERE r.event_id=? AND r.heat_id=? AND r.status NOT IN ('scratched','dns')
         ORDER BY r.bib_number, a.last_name`,
        [req.params.eventId, h.id]
      );
    }
    res.json(heats);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/events/:eventId/heats
// Body: { heat_number, heat_name, round }
router.post('/', async (req, res) => {
  try {
    const { heat_number, heat_name, round = 'qualification' } = req.body;
    if (!heat_number) return res.status(400).json({ error: 'heat_number required' });
    const id = uuidv4();
    await execute(
      `INSERT INTO heats (id, event_id, heat_number, heat_name, round) VALUES (?,?,?,?,?)`,
      [id, req.params.eventId, heat_number, heat_name || `Heat ${heat_number}`, round]
    );
    res.status(201).json(await queryOne('SELECT * FROM heats WHERE id=?', [id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/events/:eventId/heats/:heatId
router.put('/:heatId', async (req, res) => {
  try {
    const { heat_number, heat_name, round } = req.body;
    const updates = [], vals = [];
    if (heat_number !== undefined) { updates.push('heat_number=?'); vals.push(heat_number); }
    if (heat_name   !== undefined) { updates.push('heat_name=?');   vals.push(heat_name); }
    if (round       !== undefined) { updates.push('round=?');       vals.push(round); }
    if (!updates.length) return res.json({ ok: true });
    updates.push(`updated_at=datetime('now')`);
    vals.push(req.params.heatId, req.params.eventId);
    await execute(`UPDATE heats SET ${updates.join(',')} WHERE id=? AND event_id=?`, vals);
    res.json(await queryOne('SELECT * FROM heats WHERE id=?', [req.params.heatId]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/events/:eventId/heats/:heatId
router.delete('/:heatId', async (req, res) => {
  try {
    // Unassign athletes from this heat before deleting
    await execute(
      `UPDATE registrations SET heat_id=NULL WHERE event_id=? AND heat_id=?`,
      [req.params.eventId, req.params.heatId]
    );
    await execute(`DELETE FROM heats WHERE id=? AND event_id=?`, [req.params.heatId, req.params.eventId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/events/:eventId/heats/athlete-assign
// Body: { registration_id, heat_id } -- heat_id null to unassign
router.put('/athlete-assign', async (req, res) => {
  try {
    const { registration_id, heat_id } = req.body;
    if (!registration_id) return res.status(400).json({ error: 'registration_id required' });
    await execute(
      `UPDATE registrations SET heat_id=? WHERE id=? AND event_id=?`,
      [heat_id || null, registration_id, req.params.eventId]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/events/:eventId/heats/assign-random
// Creates heats (if none exist for round) and randomly distributes athletes.
// Body: { numHeats, round }
router.post('/assign-random', async (req, res) => {
  try {
    const { numHeats = 2, round = 'qualification' } = req.body;
    if (numHeats < 1 || numHeats > 20) return res.status(400).json({ error: 'numHeats must be 1-20' });

    const athletes = await queryAll(
      `SELECT r.id, a.gender FROM registrations r JOIN athletes a ON a.id=r.athlete_id
       WHERE r.event_id=? AND r.status NOT IN ('scratched','dns')`,
      [req.params.eventId]
    );
    if (!athletes.length) return res.status(400).json({ error: 'No active athletes to assign' });

    // Ensure heats exist for this round
    let heats = await queryAll(
      `SELECT * FROM heats WHERE event_id=? AND round=? ORDER BY heat_number`,
      [req.params.eventId, round]
    );
    const stmts = [];
    if (heats.length !== numHeats) {
      // Delete existing heats for this round and recreate
      stmts.push({ sql: `DELETE FROM heats WHERE event_id=? AND round=?`, args: [req.params.eventId, round] });
      stmts.push({ sql: `UPDATE registrations SET heat_id=NULL WHERE event_id=?`, args: [req.params.eventId] });
      await batch(stmts);
      heats = [];
      for (let i = 1; i <= numHeats; i++) {
        const id = uuidv4();
        await execute(
          `INSERT INTO heats (id, event_id, heat_number, heat_name, round) VALUES (?,?,?,?,?)`,
          [id, req.params.eventId, i, `Heat ${i}`, round]
        );
        heats.push({ id });
      }
      // Re-fetch to get all columns
      heats = await queryAll(
        `SELECT * FROM heats WHERE event_id=? AND round=? ORDER BY heat_number`,
        [req.params.eventId, round]
      );
    }

    // Shuffle athletes
    const arr = [...athletes];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }

    // Distribute round-robin across heats
    const assignStmts = arr.map((ath, i) => ({
      sql: `UPDATE registrations SET heat_id=? WHERE id=? AND event_id=?`,
      args: [heats[i % numHeats].id, ath.id, req.params.eventId],
    }));
    await batch(assignStmts);
    res.json({ ok: true, heats: heats.length, athletes: arr.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/events/:eventId/heats/assign-ranked
// Distributes athletes into heats seeded (snake) by prior results or seed column.
// Body: { numHeats, round, sourceRound }
router.post('/assign-ranked', async (req, res) => {
  try {
    const { numHeats = 2, round = 'qualification', sourceRound = 'qualification' } = req.body;
    if (numHeats < 1 || numHeats > 20) return res.status(400).json({ error: 'numHeats must be 1-20' });

    // Try to get results from a prior round first; fall back to seed column
    const results = await queryAll(
      `SELECT r.registration_id, MAX(r.total_score) as best_score
       FROM runs r
       WHERE r.event_id=? AND r.round=? AND r.status='complete' AND r.total_score IS NOT NULL
       GROUP BY r.registration_id
       ORDER BY best_score DESC`,
      [req.params.eventId, sourceRound]
    );

    // All active athletes
    const athletes = await queryAll(
      `SELECT r.id, r.seed FROM registrations r
       WHERE r.event_id=? AND r.status NOT IN ('scratched','dns')`,
      [req.params.eventId]
    );
    if (!athletes.length) return res.status(400).json({ error: 'No active athletes to assign' });

    // Build ordered list: scored athletes first (by score), then unscored (by seed, then random)
    const scoredIds = new Set(results.map(r => r.registration_id));
    const scored    = results.map(r => ({ id: r.registration_id }));
    const unscored  = athletes
      .filter(a => !scoredIds.has(a.id))
      .sort((a, b) => (a.seed || 9999) - (b.seed || 9999));
    const ordered = [...scored, ...unscored];

    // Ensure heats exist
    let heats = await queryAll(
      `SELECT * FROM heats WHERE event_id=? AND round=? ORDER BY heat_number`,
      [req.params.eventId, round]
    );
    if (heats.length !== numHeats) {
      await execute(`DELETE FROM heats WHERE event_id=? AND round=?`, [req.params.eventId, round]);
      await execute(`UPDATE registrations SET heat_id=NULL WHERE event_id=?`, [req.params.eventId]);
      heats = [];
      for (let i = 1; i <= numHeats; i++) {
        const id = uuidv4();
        await execute(
          `INSERT INTO heats (id, event_id, heat_number, heat_name, round) VALUES (?,?,?,?,?)`,
          [id, req.params.eventId, i, `Heat ${i}`, round]
        );
        heats.push({ id });
      }
      heats = await queryAll(
        `SELECT * FROM heats WHERE event_id=? AND round=? ORDER BY heat_number`,
        [req.params.eventId, round]
      );
    }

    // Snake distribution: 1,2,...N,N,...2,1,1,...
    let dir = 1, heatIdx = 0;
    const assignStmts = ordered.map((ath) => {
      const stmt = {
        sql: `UPDATE registrations SET heat_id=? WHERE id=? AND event_id=?`,
        args: [heats[heatIdx].id, ath.id, req.params.eventId],
      };
      heatIdx += dir;
      if (heatIdx >= numHeats) { heatIdx = numHeats - 1; dir = -1; }
      else if (heatIdx < 0)   { heatIdx = 0;             dir =  1; }
      return stmt;
    });
    await batch(assignStmts);
    res.json({ ok: true, heats: heats.length, athletes: ordered.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/events/:eventId/heats/select-finals
// Body: { quotaPerHeat, totalFinalists }
// Returns a preview list without committing to the finals event.
// Add commit=true to body to actually register selected athletes in finals_event_id.
router.post('/select-finals', async (req, res) => {
  try {
    const { quotaPerHeat = 2, totalFinalists = 16, commit = false, round = 'qualification' } = req.body;

    // Get the event to find finals_event_id if committing
    const event = await queryOne('SELECT * FROM events WHERE id=?', [req.params.eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    if (commit && !event.finals_event_id) {
      return res.status(400).json({ error: 'No finals event linked.  Link a finals event first.' });
    }

    // Get all heats for this round
    const heats = await queryAll(
      `SELECT * FROM heats WHERE event_id=? AND round=? ORDER BY heat_number`,
      [req.params.eventId, round]
    );
    if (!heats.length) return res.status(400).json({ error: 'No heats found for this round' });

    // Get best score per athlete in the qualification round
    const allScores = await queryAll(
      `SELECT r.registration_id, reg.heat_id, MAX(r.total_score) as best_score,
              a.first_name, a.last_name, a.id as athlete_id, reg.bib_number, reg.seed
       FROM runs r
       JOIN registrations reg ON reg.id=r.registration_id
       JOIN athletes a ON a.id=reg.athlete_id
       WHERE r.event_id=? AND r.round=? AND r.status='complete' AND r.total_score IS NOT NULL
       GROUP BY r.registration_id`,
      [req.params.eventId, round]
    );

    const selected = new Set();
    const finalists = [];

    // Step A: top quotaPerHeat from each heat
    for (const heat of heats) {
      const heatAthletes = allScores
        .filter(s => s.heat_id === heat.id)
        .sort((a, b) => b.best_score - a.best_score);
      for (let i = 0; i < quotaPerHeat && i < heatAthletes.length; i++) {
        if (!selected.has(heatAthletes[i].registration_id)) {
          selected.add(heatAthletes[i].registration_id);
          finalists.push({ ...heatAthletes[i], selection_method: `Heat ${heat.heat_number} quota` });
        }
      }
    }

    // Step B: fill remaining slots from overall ranked list
    if (finalists.length < totalFinalists) {
      const overall = [...allScores].sort((a, b) => b.best_score - a.best_score);
      for (const ath of overall) {
        if (finalists.length >= totalFinalists) break;
        if (!selected.has(ath.registration_id)) {
          selected.add(ath.registration_id);
          finalists.push({ ...ath, selection_method: 'Overall fill' });
        }
      }
    }

    if (!commit) {
      return res.json({ preview: true, finalists, count: finalists.length });
    }

    // Commit: register athletes in the finals event
    const finalsEventId = event.finals_event_id;
    const insertStmts = [];
    for (const f of finalists) {
      const existing = await queryOne(
        'SELECT id FROM registrations WHERE event_id=? AND athlete_id=?',
        [finalsEventId, f.athlete_id]
      );
      if (!existing) {
        insertStmts.push({
          sql: `INSERT INTO registrations (id, event_id, athlete_id, bib_number, seed) VALUES (?,?,?,?,?)`,
          args: [uuidv4(), finalsEventId, f.athlete_id, f.bib_number || null, finalists.indexOf(f) + 1],
        });
      }
    }
    if (insertStmts.length) await batch(insertStmts);
    res.json({ committed: true, finalists, registered: insertStmts.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
