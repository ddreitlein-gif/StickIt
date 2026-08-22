const jwt = require('jsonwebtoken');
const { queryOne, execute } = require('../db/schema');
const { ROLE_RANK } = require('../auth/roles');

let _jwtSecret = null;

// v1.25.00 (A-6) — Persist the JWT secret in app_settings so server restarts /
// deploys no longer invalidate every session. Called once at boot from index.js
// after initSchema(). STICKIT_JWT_SECRET env var always wins.
async function initJwtSecret() {
  if (process.env.STICKIT_JWT_SECRET) {
    _jwtSecret = process.env.STICKIT_JWT_SECRET;
    return;
  }
  try {
    const row = await queryOne(`SELECT value FROM app_settings WHERE key='jwt_secret'`);
    if (row && row.value) {
      _jwtSecret = row.value;
      return;
    }
    const crypto = require('crypto');
    const secret = crypto.randomBytes(64).toString('hex');
    await execute(
      `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('jwt_secret', ?)`,
      [secret]
    );
    _jwtSecret = secret;
    console.log('[auth] Generated and persisted a new JWT secret (app_settings.jwt_secret).');
  } catch (e) {
    console.error('[auth] Failed to persist JWT secret — falling back to per-boot secret:', e.message);
    const crypto = require('crypto');
    _jwtSecret = crypto.randomBytes(64).toString('hex');
  }
}

function getJwtSecret() {
  if (_jwtSecret) return _jwtSecret;
  if (process.env.STICKIT_JWT_SECRET) {
    _jwtSecret = process.env.STICKIT_JWT_SECRET;
    return _jwtSecret;
  }
  // initJwtSecret() not yet run (shouldn't happen in normal boot order).
  const crypto = require('crypto');
  _jwtSecret = crypto.randomBytes(64).toString('hex');
  console.warn('[auth] getJwtSecret called before initJwtSecret — using a per-boot random secret.');
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

// v2.0.00 (Step 3, R3/FR-14) -- venue-mode variant: the officials-mutation
// endpoints that cloud mode protects with JWT are gated by the Control-PIN
// session token instead. The token lives under the SAME localStorage key
// (stickit_auth_token) and rides the existing authHeaders() path. Before PINs
// are set (fresh Pi, pre-adoption) this is a pass-through, like auth-disabled
// cloud mode. Cloud username/password auth is never used at the venue.
async function venueRequireControl(req, res, next) {
  try {
    const { queryOne } = require('../db/schema');
    const pinRow = await queryOne(`SELECT value FROM app_settings WHERE key='venue_control_pin_hash'`);
    if (!pinRow || !pinRow.value) return next(); // PINs not set yet
    const tokRow = await queryOne(`SELECT value FROM app_settings WHERE key='venue_control_token'`);
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!tokRow || !token || token !== tokRow.value) {
      return res.status(401).json({ error: 'Control PIN required', venue_pin: 'control' });
    }
    // The Control station is the venue's full operator (LAN trusted, R3):
    // satisfies every role check locally.
    req.user = { id: 'venue-control', username: 'venue-control', display_name: 'Scoring Computer', role: 'system_admin', is_active: 1 };
    return next();
  } catch (e) {
    return next(e);
  }
}

async function requireAuth(req, res, next) {
  const { isVenueMode } = require('../venue/mode');
  if (isVenueMode()) return venueRequireControl(req, res, next);
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

function requireRole(role) {
  return async (req, res, next) => {
    // v2.0.00 (Step 3) -- venue mode: requireAuth (venueRequireControl) already
    // attached the Scoring Computer identity (system_admin-equivalent locally),
    // or passed through when PINs aren't set. Role ranks don't apply.
    const { isVenueMode } = require('../venue/mode');
    if (isVenueMode()) return next();
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

module.exports = { requireAuth, requireRole, isAuthEnabled, getJwtSecret, initJwtSecret };
