const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { queryOne, execute } = require('../db/schema');
const { requireAuth, isAuthEnabled, getJwtSecret } = require('../middleware/auth');

const router = express.Router();

// v1.25.00 (A-7) — in-memory login throttle: 10 failures per username or IP per 15 minutes.
const LOGIN_FAIL_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAIL_LIMIT = 10;
const loginFailures = new Map(); // key -> [timestamps]

function recentFailures(key) {
  const now = Date.now();
  const arr = (loginFailures.get(key) || []).filter(t => now - t < LOGIN_FAIL_WINDOW_MS);
  loginFailures.set(key, arr);
  return arr.length;
}

function recordFailure(key) {
  const arr = loginFailures.get(key) || [];
  arr.push(Date.now());
  loginFailures.set(key, arr);
}

function clearFailures(key) {
  loginFailures.delete(key);
}

// POST /login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    // v2.0.01 — usernames are stored trim().toLowerCase() (admin.js), so the
    // lookup must normalize the same way. Mobile keyboards auto-capitalize the
    // first letter; case must never decide a login.
    const uname = String(username).trim().toLowerCase();
    const ipKey = `ip:${req.ip}`;
    const userKey = `user:${uname}`;
    if (recentFailures(ipKey) >= LOGIN_FAIL_LIMIT || recentFailures(userKey) >= LOGIN_FAIL_LIMIT) {
      return res.status(429).json({ error: 'Too many attempts — try again in a few minutes' });
    }
    const user = await queryOne(
      `SELECT id, username, password_hash, display_name, role, is_active, must_change_password FROM users WHERE username=? AND is_active=1`,
      [uname]
    );
    if (!user || !user.password_hash) {
      recordFailure(ipKey); recordFailure(userKey);
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      recordFailure(ipKey); recordFailure(userKey);
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    clearFailures(ipKey); clearFailures(userKey);
    // 12h expiry (A-6) so a long competition day doesn't expire tokens on-hill.
    const token = jwt.sign(
      { sub: user.id, role: user.role },
      getJwtSecret(),
      { expiresIn: '12h' }
    );
    res.json({ token, user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role, must_change_password: user.must_change_password || 0 } });
  } catch (e) {
    console.error('[auth] login error:', e);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /logout
router.post('/logout', (req, res) => {
  res.json({ ok: true });
});

// GET /me
router.get('/me', requireAuth, async (req, res) => {
  const { id, username, display_name, role } = req.user;
  // v2.0.01 — queried here (not in requireAuth's SELECT) so the venue-mode
  // fabricated venue-control user simply resolves to 0.
  let must_change_password = 0;
  try {
    const row = await queryOne(`SELECT must_change_password FROM users WHERE id=?`, [id]);
    must_change_password = (row && row.must_change_password) || 0;
  } catch (_) {}
  res.json({ id, username, display_name, role, must_change_password });
});

// GET /status — public
router.get('/status', async (req, res) => {
  const envForced = process.env.STICKIT_AUTH === 'off';
  const enabled = await isAuthEnabled();
  res.json({ enabled, envForced });
});

// POST /change-password
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'current_password and new_password are required' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    const user = await queryOne(`SELECT password_hash FROM users WHERE id=?`, [req.user.id]);
    if (!user || !user.password_hash) {
      return res.status(400).json({ error: 'No password set — use Admin → Users to set one first' });
    }
    const match = await bcrypt.compare(current_password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const hash = await bcrypt.hash(new_password, 10);
    // v2.0.01 — a self-chosen password satisfies the forced first-login change.
    await execute(
      `UPDATE users SET password_hash=?, must_change_password=0, updated_at=datetime('now') WHERE id=?`,
      [hash, req.user.id]
    );
    await execute(
      `INSERT INTO audit_log (id, action, entity, entity_id, new_value) VALUES (?,?,?,?,?)`,
      [require('uuid').v4(), 'password_changed', 'user', req.user.id, JSON.stringify({ username: req.user.username })]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[auth] change-password error:', e);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

module.exports = router;
