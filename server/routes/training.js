const express = require('express');
const router = express.Router();
const { queryAll, queryOne, execute, uuidv4 } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');

// ── Helpers ─────────────────────────────────────────────────────────────────

async function buildParticipantList(trainingDayId) {
  const td = await queryOne('SELECT * FROM training_days WHERE id=?', [trainingDayId]);
  if (!td) return null;

  // All non-scratched registrations across every event in the meet,
  // joined to the athlete. Mirrors the dedup pattern used by /api/pdf/registration.
  const rows = await queryAll(
    `SELECT DISTINCT a.id AS athlete_id, a.first_name, a.last_name,
            a.ussa_num, a.club, a.birth_year, a.gender, a.deleted_at,
            r.bib_number
     FROM registrations r
     JOIN athletes a ON a.id = r.athlete_id
     JOIN events e   ON e.id = r.event_id
     WHERE e.meet_id=? AND r.status != 'scratched'`,
    [td.meet_id]
  );

  // Drop soft-deleted athletes
  const live = rows.filter(r => !r.deleted_at);

  // Dedup by athlete, keeping the first non-null bib seen
  const seen = {};
  const deduped = [];
  for (const a of live) {
    if (!seen[a.athlete_id]) {
      seen[a.athlete_id] = a;
      deduped.push(a);
    } else if (!seen[a.athlete_id].bib_number && a.bib_number) {
      seen[a.athlete_id].bib_number = a.bib_number;
    }
  }

  // Annotate with `included` based on the exclusion table
  const exclusionRows = await queryAll(
    'SELECT athlete_id FROM training_day_exclusions WHERE training_day_id=?',
    [trainingDayId]
  );
  const excluded = new Set(exclusionRows.map(r => r.athlete_id));

  const participants = deduped.map(a => ({
    athlete_id: a.athlete_id,
    first_name: a.first_name,
    last_name: a.last_name,
    ussa_num: a.ussa_num,
    club: a.club,
    birth_year: a.birth_year,
    gender: a.gender,
    bib_number: a.bib_number,
    included: !excluded.has(a.athlete_id),
  }));

  // Sort: bib ASC (blanks last), then last_name, then first_name
  participants.sort((a, b) => {
    const ba = parseInt(a.bib_number);
    const bb = parseInt(b.bib_number);
    const aHas = Number.isFinite(ba);
    const bHas = Number.isFinite(bb);
    if (aHas && bHas && ba !== bb) return ba - bb;
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    return (a.last_name || '').localeCompare(b.last_name || '') ||
           (a.first_name || '').localeCompare(b.first_name || '');
  });

  return { trainingDay: td, participants };
}

// ── Meet-scoped CRUD ────────────────────────────────────────────────────────

// GET /api/meets/:meetId/training-days
router.get('/meets/:meetId/training-days', requireAuth, async (req, res) => {
  try {
    const rows = await queryAll(
      `SELECT * FROM training_days WHERE meet_id=? ORDER BY date ASC, created_at ASC`,
      [req.params.meetId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/meets/:meetId/training-days   body: { name, date? }
router.post('/meets/:meetId/training-days', requireAuth, async (req, res) => {
  try {
    const { meetId } = req.params;
    const meet = await queryOne('SELECT id FROM meets WHERE id=?', [meetId]);
    if (!meet) return res.status(404).json({ error: 'Meet not found' });

    const name = (req.body.name || '').trim();
    const date = (req.body.date || '').trim() || null;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const id = uuidv4();
    await execute(
      `INSERT INTO training_days (id, meet_id, name, date) VALUES (?, ?, ?, ?)`,
      [id, meetId, name, date]
    );
    const row = await queryOne('SELECT * FROM training_days WHERE id=?', [id]);
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/meets/:meetId/training-days/:id   body: { name?, date? }
router.put('/meets/:meetId/training-days/:id', requireAuth, async (req, res) => {
  try {
    const { meetId, id } = req.params;
    const existing = await queryOne(
      'SELECT * FROM training_days WHERE id=? AND meet_id=?',
      [id, meetId]
    );
    if (!existing) return res.status(404).json({ error: 'Training day not found' });

    const name = req.body.name !== undefined ? String(req.body.name).trim() : existing.name;
    const date = req.body.date !== undefined ? (String(req.body.date).trim() || null) : existing.date;
    if (!name) return res.status(400).json({ error: 'name is required' });

    await execute(
      `UPDATE training_days SET name=?, date=?, updated_at=datetime('now') WHERE id=?`,
      [name, date, id]
    );
    const row = await queryOne('SELECT * FROM training_days WHERE id=?', [id]);
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/meets/:meetId/training-days/:id
router.delete('/meets/:meetId/training-days/:id', requireAuth, async (req, res) => {
  try {
    const { meetId, id } = req.params;
    const existing = await queryOne(
      'SELECT id FROM training_days WHERE id=? AND meet_id=?',
      [id, meetId]
    );
    if (!existing) return res.status(404).json({ error: 'Training day not found' });

    await execute('DELETE FROM training_day_exclusions WHERE training_day_id=?', [id]);
    await execute('DELETE FROM training_days WHERE id=?', [id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Per-training-day participant + exclusion endpoints ──────────────────────

// GET /api/training-days/:id/participants
router.get('/training-days/:id/participants', requireAuth, async (req, res) => {
  try {
    const result = await buildParticipantList(req.params.id);
    if (!result) return res.status(404).json({ error: 'Training day not found' });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/training-days/:id/exclusions
//   single: { athlete_id, exclude: boolean }
//   bulk (v1.25.00, C-17): { athlete_ids: [...], exclude: boolean }
router.post('/training-days/:id/exclusions', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { athlete_id, athlete_ids, exclude } = req.body || {};
    const ids = Array.isArray(athlete_ids) ? athlete_ids : (athlete_id ? [athlete_id] : []);
    if (!ids.length) return res.status(400).json({ error: 'athlete_id or athlete_ids required' });

    const td = await queryOne('SELECT id FROM training_days WHERE id=?', [id]);
    if (!td) return res.status(404).json({ error: 'Training day not found' });

    for (const aid of ids) {
      if (exclude) {
        await execute(
          `INSERT OR IGNORE INTO training_day_exclusions (training_day_id, athlete_id) VALUES (?, ?)`,
          [id, aid]
        );
      } else {
        await execute(
          `DELETE FROM training_day_exclusions WHERE training_day_id=? AND athlete_id=?`,
          [id, aid]
        );
      }
    }

    // Bump the training day's updated_at so changes show in the UI
    await execute(`UPDATE training_days SET updated_at=datetime('now') WHERE id=?`, [id]);

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/training-days/:id/reset — clear all exclusions
router.post('/training-days/:id/reset', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const td = await queryOne('SELECT id FROM training_days WHERE id=?', [id]);
    if (!td) return res.status(404).json({ error: 'Training day not found' });

    await execute('DELETE FROM training_day_exclusions WHERE training_day_id=?', [id]);
    await execute(`UPDATE training_days SET updated_at=datetime('now') WHERE id=?`, [id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
