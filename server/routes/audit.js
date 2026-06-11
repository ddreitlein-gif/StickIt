const router = require('express').Router();
const { queryAll, execute, uuidv4 } = require('../db/schema');

// ---------------------------------------------------------------------------
// Shared helper -- call from any route to record an audit event.
// Failures are silently ignored by callers (wrapped in try/catch there).
// ---------------------------------------------------------------------------
async function logAudit(action, entity, entityId, oldValue, newValue, userNote) {
  await execute(
    `INSERT INTO audit_log (id, action, entity, entity_id, old_value, new_value, user_note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      action,
      entity,
      entityId  || null,
      oldValue  != null ? JSON.stringify(oldValue)  : null,
      newValue  != null ? JSON.stringify(newValue)  : null,
      userNote  || null,
    ]
  );
}

// ---------------------------------------------------------------------------
// GET /api/audit  -- returns log entries newest first, with optional filters.
// Query params: limit (default 200), entity, action, from, to (ISO dates)
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit) || 200, 1000);
    const entity = req.query.entity || '';
    const action = req.query.action || '';
    const from   = req.query.from || '';
    const to     = req.query.to || '';

    let sql  = 'SELECT * FROM audit_log WHERE 1=1';
    const args = [];

    if (entity) { sql += ' AND entity=?';  args.push(entity); }
    if (action) { sql += ' AND action=?';  args.push(action); }
    // v1.25.00 (B-6) — date range
    if (from)   { sql += ' AND timestamp >= ?'; args.push(from); }
    if (to)     { sql += " AND timestamp < date(?, '+1 day')"; args.push(to); }

    sql += ' ORDER BY timestamp DESC LIMIT ?';
    args.push(limit);

    const rows = await queryAll(sql, args);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// GET /api/audit/filters -- distinct actions + entities actually in the log,
// so the filter dropdowns never go stale (v1.25.00, B-6).
// ---------------------------------------------------------------------------
router.get('/filters', async (req, res) => {
  try {
    const actions  = await queryAll('SELECT DISTINCT action FROM audit_log ORDER BY action');
    const entities = await queryAll('SELECT DISTINCT entity FROM audit_log ORDER BY entity');
    res.json({
      actions:  actions.map(r => r.action).filter(Boolean),
      entities: entities.map(r => r.entity).filter(Boolean),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.logAudit = logAudit;
