const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { queryOne, execute } = require('../db/schema');
const { requireAuth, isAuthEnabled, getJwtSecret } = require('../middleware/auth');

const router = express.Router();

// POST /login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const user = await queryOne(
      `SELECT id, username, password_hash, display_name, role, is_active FROM users WHERE username=? AND is_active=1`,
      [username]
    );
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const token = jwt.sign(
      { sub: user.id, role: user.role },
      getJwtSecret(),
      { expiresIn: '8h' }
    );
    res.json({ token, user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role } });
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
router.get('/me', requireAuth, (req, res) => {
  const { id, username, display_name, role } = req.user;
  res.json({ id, username, display_name, role });
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
    if (new_password.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
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
    await execute(
      `UPDATE users SET password_hash=?, updated_at=datetime('now') WHERE id=?`,
      [hash, req.user.id]
    );
    await execute(
      `INSERT INTO audit_log (id, action, entity_type, entity_id, new_value) VALUES (?,?,?,?,?)`,
      [require('uuid').v4(), 'password_changed', 'user', req.user.id, JSON.stringify({ username: req.user.username })]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[auth] change-password error:', e);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

module.exports = router;
