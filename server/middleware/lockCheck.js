const { queryOne } = require('../db/schema');

function requireUnlocked(eventIdParam = 'eventId') {
  return async (req, res, next) => {
    const eventId = req.params[eventIdParam];
    if (!eventId) return next();
    try {
      const event = await queryOne('SELECT locked FROM events WHERE id=?', [eventId]);
      if (event && event.locked) {
        return res.status(403).json({ error: 'Event is locked. Unlock in Admin panel to make changes.' });
      }
    } catch (_) {}
    next();
  };
}

module.exports = { requireUnlocked };
