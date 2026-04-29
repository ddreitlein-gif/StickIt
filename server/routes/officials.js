const router = require('express').Router({ mergeParams: true });
const { queryAll, queryOne, execute, uuidv4 } = require('../db/schema');

const VALID_ROLES = [
  'Chief of Competition',
  'Chief of Course',
  'Chief of Score',
  'Technical Delegate',
  'Chief of Start',
  'Head Judge',
  'Competition Secretary',
];

// GET all officials for a meet (legacy meet-level)
router.get('/', async (req, res) => {
  try {
    const officials = await queryAll(
      'SELECT * FROM officials WHERE meet_id = ? AND (event_id IS NULL OR event_id = "") ORDER BY role, name',
      [req.params.meetId]
    );
    res.json(officials);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST add an official (meet-level or event-level)
router.post('/', async (req, res) => {
  try {
    const { role, name, ussa_id, event_id } = req.body;
    if (!role || !name) return res.status(400).json({ error: 'role and name are required' });
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const id = uuidv4();
    await execute('INSERT INTO officials (id, meet_id, role, name, ussa_id, event_id) VALUES (?, ?, ?, ?, ?, ?)',
      [id, req.params.meetId, role, name.trim(), ussa_id || null, event_id || null]);
    res.status(201).json(await queryOne('SELECT * FROM officials WHERE id = ?', [id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT update an official
router.put('/:id', async (req, res) => {
  try {
    const { role, name, ussa_id } = req.body;
    if (role && !VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const sets = [];
    const vals = [];
    if (role !== undefined) { sets.push('role=?'); vals.push(role); }
    if (name !== undefined) { sets.push('name=?'); vals.push(name.trim()); }
    if (ussa_id !== undefined) { sets.push('ussa_id=?'); vals.push(ussa_id || null); }
    if (!sets.length) {
      return res.json(await queryOne('SELECT * FROM officials WHERE id = ?', [req.params.id]));
    }
    vals.push(req.params.id, req.params.meetId);
    await execute(`UPDATE officials SET ${sets.join(',')} WHERE id=? AND meet_id=?`, vals);
    res.json(await queryOne('SELECT * FROM officials WHERE id = ?', [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE an official
router.delete('/:id', async (req, res) => {
  try {
    await execute('DELETE FROM officials WHERE id = ? AND meet_id = ?',
      [req.params.id, req.params.meetId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET officials for a specific event
router.get('/event/:eventId', async (req, res) => {
  try {
    const officials = await queryAll(
      'SELECT * FROM officials WHERE meet_id = ? AND event_id = ? ORDER BY role, name',
      [req.params.meetId, req.params.eventId]
    );
    res.json(officials);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST copy officials from another event in the same meet
router.post('/copy-from-event', async (req, res) => {
  try {
    const { sourceEventId, targetEventId } = req.body;
    if (!sourceEventId || !targetEventId) return res.status(400).json({ error: 'sourceEventId and targetEventId required' });

    const sourceOfficials = await queryAll(
      'SELECT * FROM officials WHERE meet_id = ? AND event_id = ?',
      [req.params.meetId, sourceEventId]
    );
    const targetOfficials = await queryAll(
      'SELECT role FROM officials WHERE meet_id = ? AND event_id = ?',
      [req.params.meetId, targetEventId]
    );
    const filledRoles = new Set(targetOfficials.map(o => o.role));

    const created = [];
    for (const src of sourceOfficials) {
      if (filledRoles.has(src.role)) continue;
      const id = uuidv4();
      await execute(
        'INSERT INTO officials (id, meet_id, role, name, ussa_id, event_id) VALUES (?, ?, ?, ?, ?, ?)',
        [id, req.params.meetId, src.role, src.name, src.ussa_id, targetEventId]
      );
      created.push(await queryOne('SELECT * FROM officials WHERE id = ?', [id]));
    }
    res.json({ copied: created.length, officials: created });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
