const router = require('express').Router({ mergeParams: true });
const { queryAll, queryOne, execute, uuidv4, shortCode } = require('../db/schema');

const VALID_ROLES = ['TL1','TL2','TL3','Air1','Air2','HJ',
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
    const { name, role, pin, ussa_id } = req.body;
    if (!name || !role) return res.status(400).json({ error: 'name and role required' });
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
    // HJ can coexist with scoring judges; enforce uniqueness only for scoring roles
    const ex = await queryOne('SELECT id FROM judges WHERE event_id=? AND role=?', [req.params.eventId, role]);
    if (ex) return res.status(409).json({ error: `${role} already assigned` });
    const id = uuidv4();
    await execute(
      `INSERT INTO judges (id,event_id,name,role,pin,ussa_id,short_code) VALUES (?,?,?,?,?,?,?)`,
      [id, req.params.eventId, name.trim(), role, pin||null, ussa_id||null, shortCode()]
    );
    res.status(201).json(await queryOne('SELECT * FROM judges WHERE id=?', [id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await execute('DELETE FROM judges WHERE id=? AND event_id=?', [req.params.id, req.params.eventId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
