const router = require('express').Router({ mergeParams: true });
const { queryAll, queryOne, execute, uuidv4, shortCode } = require('../db/schema');

const VALID_ROLES = ['TL1','TL2','TL3','Air1','Air2','HJ',
  // Aerials v2 (v1.18.00) — single role, numbered 1..N via judge_number
  'AeJudge1','AeJudge2','AeJudge3','AeJudge4','AeJudge5','AeJudge6','AeJudge7',
  // Aerials legacy (pre-v1.18.00) — kept readable for historical events
  'AirJudge1','AirJudge2','AirJudge3',
  'FormJudge1','FormJudge2','FormJudge3',
  'LandingJudge1','LandingJudge2','LandingJudge3',
  // Dual mogul judge roles (5-judge format)
  'DualTurns1','DualTurns2','DualAir','DualTime','DualOverall'];

const { requireUnlocked } = require('../middleware/lockCheck');
router.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return requireUnlocked()(req, res, next);
  next();
});

router.get('/', async (req, res) => {
  try {
    res.json(await queryAll('SELECT * FROM judges WHERE event_id=? ORDER BY role', [req.params.eventId]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, role, pin, ussa_id, judge_number } = req.body;
    if (!name || !role) return res.status(400).json({ error: 'name and role required' });
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
    // HJ can coexist with scoring judges; enforce uniqueness only for scoring roles
    const ex = await queryOne('SELECT id FROM judges WHERE event_id=? AND role=?', [req.params.eventId, role]);
    if (ex) return res.status(409).json({ error: `${role} already assigned` });
    const id = uuidv4();
    await execute(
      `INSERT INTO judges (id,event_id,name,role,pin,ussa_id,short_code,judge_number) VALUES (?,?,?,?,?,?,?,?)`,
      [id, req.params.eventId, name.trim(), role, pin||null, ussa_id||null, shortCode(), judge_number || null]
    );
    res.status(201).json(await queryOne('SELECT * FROM judges WHERE id=?', [id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const j = await queryOne('SELECT * FROM judges WHERE id=? AND event_id=?', [req.params.id, req.params.eventId]);
    if (!j) return res.status(404).json({ error: 'Judge not found' });
    const fields = ['name','pin','ussa_id'];
    const updates = [], values = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f}=?`); values.push(req.body[f]); }
    }
    if (updates.length === 0) return res.json(j);
    values.push(req.params.id);
    await execute(`UPDATE judges SET ${updates.join(',')} WHERE id=?`, values);
    res.json(await queryOne('SELECT * FROM judges WHERE id=?', [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await execute('DELETE FROM judges WHERE id=? AND event_id=?', [req.params.id, req.params.eventId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// v1.18.00 — Seed aerials judge panel.
// Wipes existing aerials judges (any aerials role) and creates N AeJudgeK rows
// with judge_number 1..N. Adds an HJ row if hjScoring is requested (mapped to a
// numbered scoring slot for USA Regional). Existing HJ rows are left in place.
router.post('/seed-aerials', async (req, res) => {
  try {
    const event = await queryOne('SELECT * FROM events WHERE id=?', [req.params.eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.discipline !== 'aerials') return res.status(400).json({ error: 'Event is not aerials' });

    const panelSize = parseInt(event.aerials_panel_size) || parseInt(req.body.panel_size) || 5;
    if (panelSize < 2 || panelSize > 7) return res.status(400).json({ error: 'panel size must be 2..7' });

    // Block re-seed once any score has been submitted
    const scored = await queryOne(
      `SELECT COUNT(*) AS cnt FROM judge_scores js JOIN runs r ON r.id = js.run_id WHERE r.event_id = ?`,
      [req.params.eventId]
    );
    if (scored && parseInt(scored.cnt) > 0) {
      return res.status(400).json({ error: 'Cannot re-seed aerials panel after scoring has started' });
    }

    // Wipe all aerials scoring judges (legacy + new). Keep HJ row intact.
    const aerialsRoles = ['AeJudge1','AeJudge2','AeJudge3','AeJudge4','AeJudge5','AeJudge6','AeJudge7',
      'AirJudge1','AirJudge2','AirJudge3','FormJudge1','FormJudge2','FormJudge3','LandingJudge1','LandingJudge2','LandingJudge3'];
    const placeholders = aerialsRoles.map(() => '?').join(',');
    await execute(`DELETE FROM judges WHERE event_id=? AND role IN (${placeholders})`, [req.params.eventId, ...aerialsRoles]);

    const names = Array.isArray(req.body.names) ? req.body.names : [];
    for (let i = 1; i <= panelSize; i++) {
      const id = uuidv4();
      const name = (names[i - 1] || `Judge ${i}`).toString().trim();
      await execute(
        `INSERT INTO judges (id,event_id,name,role,pin,short_code,judge_number) VALUES (?,?,?,?,?,?,?)`,
        [id, req.params.eventId, name, `AeJudge${i}`, null, shortCode(), i]
      );
    }

    res.json(await queryAll('SELECT * FROM judges WHERE event_id=? ORDER BY role', [req.params.eventId]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
