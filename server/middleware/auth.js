const jwt = require('jsonwebtoken');
const { queryOne } = require('../db/schema');

let _jwtSecret = null;

function getJwtSecret() {
  if (_jwtSecret) return _jwtSecret;
  if (process.env.STICKIT_JWT_SECRET) {
    _jwtSecret = process.env.STICKIT_JWT_SECRET;
    return _jwtSecret;
  }
  const crypto = require('crypto');
  _jwtSecret = crypto.randomBytes(64).toString('hex');
  console.warn('[auth] STICKIT_JWT_SECRET not set — using a per-boot random secret. Tokens will be invalidated on every server restart.');
  return _jwtSecret;
}

async function isAuthEnabled() {
  if (process.env.STICKIT_AUTH === 'off') return false;
  try {
    const row = await queryOne(`SELECT value FROM app_settings WHERE key='auth_enabled'`);
    return row && row.value === '1';
  } catch (_) {
    return false;
  }
}

async function requireAuth(req, res, next) {
  if (!(await isAuthEnabled())) return next();
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, getJwtSecret());
    const user = await queryOne(`SELECT id, username, display_name, role, is_active FROM users WHERE id=?`, [payload.sub]);
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }
    req.user = user;
    next();
  } catch (_) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

const ROLE_RANK = { official: 1, judge: 2, event_admin: 3, system_admin: 3 };

function requireRole(role) {
  return async (req, res, next) => {
    if (!(await isAuthEnabled())) return next();
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const userRank = ROLE_RANK[req.user.role] || 0;
    const requiredRank = ROLE_RANK[role] || 0;
    if (userRank < requiredRank) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, isAuthEnabled, getJwtSecret };
