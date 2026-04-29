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
// Query params: limit (default 200), entity, action
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit) || 200, 1000);
    const entity = req.query.entity || '';
    const action = req.query.action || '';

    let sql  = 'SELECT * FROM audit_log WHERE 1=1';
    const args = [];

    if (entity) { sql += ' AND entity=?';  args.push(entity); }
    if (action) { sql += ' AND action=?';  args.push(action); }

    sql += ' ORDER BY timestamp DESC LIMIT ?';
    args.push(limit);

    const rows = await queryAll(sql, args);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.logAudit = logAudit;
