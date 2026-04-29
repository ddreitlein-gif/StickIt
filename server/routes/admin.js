const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, execute } = require('../db/schema');

const VALID_ROLES = ['official', 'event_admin', 'system_admin'];

// ── Users CRUD ──────────────────────────────────────────────────────────────

router.get('/users', async (req, res) => {
  try {
    const users = await queryAll('SELECT id, username, display_name, role, is_active, created_at, updated_at FROM users ORDER BY display_name');
    res.json(users);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/users/:id', async (req, res) => {
  try {
    const user = await queryOne('SELECT id, username, display_name, role, is_active, created_at, updated_at FROM users WHERE id=?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/users', async (req, res) => {
  try {
    const { username, display_name, role } = req.body;
    if (!username || !display_name) return res.status(400).json({ error: 'username and display_name are required' });
    if (role && !VALID_ROLES.includes(role)) return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
    const existing = await queryOne('SELECT id FROM users WHERE username=?', [username.trim().toLowerCase()]);
    if (existing) return res.status(409).json({ error: 'Username already exists' });
    const id = uuidv4();
    await execute(
      'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)',
      [id, username.trim().toLowerCase(), display_name.trim(), role || 'official']
    );
    const user = await queryOne('SELECT id, username, display_name, role, is_active, created_at, updated_at FROM users WHERE id=?', [id]);
    res.status(201).json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/users/:id', async (req, res) => {
  try {
    const user = await queryOne('SELECT * FROM users WHERE id=?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { display_name, role, is_active } = req.body;
    if (role && !VALID_ROLES.includes(role)) return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
    await execute(
      `UPDATE users SET display_name=COALESCE(?,display_name), role=COALESCE(?,role), is_active=COALESCE(?,is_active), updated_at=datetime('now') WHERE id=?`,
      [display_name || null, role || null, is_active !== undefined ? is_active : null, req.params.id]
    );
    const updated = await queryOne('SELECT id, username, display_name, role, is_active, created_at, updated_at FROM users WHERE id=?', [req.params.id]);
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/users/:id', async (req, res) => {
  try {
    const user = await queryOne('SELECT * FROM users WHERE id=?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    await execute(`UPDATE users SET is_active=0, updated_at=datetime('now') WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Event Lock/Unlock ───────────────────────────────────────────────────────

router.get('/events', async (req, res) => {
  try {
    const events = await queryAll(
      `SELECT e.id, e.name, e.discipline, e.division, e.gender, e.status, e.locked, e.created_at,
              m.id as meet_id, m.name as meet_name, m.date as meet_date, m.location as meet_location
       FROM events e JOIN meets m ON m.id = e.meet_id
       ORDER BY m.date DESC, e.name`
    );
    res.json(events);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/events/:eventId/lock', async (req, res) => {
  try {
    await execute(`UPDATE events SET locked=1, updated_at=datetime('now') WHERE id=?`, [req.params.eventId]);
    res.json({ ok: true, locked: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/events/:eventId/unlock', async (req, res) => {
  try {
    await execute(`UPDATE events SET locked=0, updated_at=datetime('now') WHERE id=?`, [req.params.eventId]);
    res.json({ ok: true, locked: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/meets/:meetId/lock-all', async (req, res) => {
  try {
    await execute(`UPDATE events SET locked=1, updated_at=datetime('now') WHERE meet_id=?`, [req.params.meetId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/meets/:meetId/unlock-all', async (req, res) => {
  try {
    await execute(`UPDATE events SET locked=0, updated_at=datetime('now') WHERE meet_id=?`, [req.params.meetId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── System Info ─────────────────────────────────────────────────────────────

router.get('/system', async (req, res) => {
  try {
    const counts = {};
    for (const table of ['meets', 'events', 'athletes', 'registrations', 'users']) {
      const row = await queryOne(`SELECT COUNT(*) as cnt FROM ${table}`);
      counts[table] = row ? row.cnt : 0;
    }
    res.json({ version: 'v1.16.18', counts });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Dashboard ──────────────────────────────────────────────────────────────

router.get('/dashboard', async (req, res) => {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const { listBackups } = require('../db/autosave');

  try {
    // Table counts
    const counts = {};
    for (const table of ['meets', 'events', 'athletes', 'registrations', 'users']) {
      const row = await queryOne(`SELECT COUNT(*) as cnt FROM ${table}`);
      counts[table] = row ? row.cnt : 0;
    }

    // Run counts by status
    const runRows = await queryAll(`SELECT status, COUNT(*) as cnt FROM runs GROUP BY status`);
    const runs = { scoring: 0, pending: 0, complete: 0 };
    for (const r of runRows) {
      if (r.status === 'scoring') runs.scoring = r.cnt;
      else if (r.status === 'pending') runs.pending = r.cnt;
      else if (r.status === 'complete') runs.complete = r.cnt;
    }

    // IP addresses
    const nets = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (!net.internal && net.family === 'IPv4') ips.push({ iface: name, address: net.address });
      }
    }

    // Database file info
    const dbPath = path.join(__dirname, '../data/scoring.db');
    let dbInfo = { file_size_bytes: 0, exists: false };
    try {
      const stat = fs.statSync(dbPath);
      dbInfo = { file_size_bytes: stat.size, exists: true };
    } catch (_) {}

    // Backups
    let backups = [];
    try { backups = listBackups(); } catch (_) {}

    // Disk space
    let disk = { free_bytes: 0, total_bytes: 0 };
    try {
      const stats = fs.statfsSync(dbPath);
      disk.free_bytes = stats.bfree * stats.bsize;
      disk.total_bytes = stats.blocks * stats.bsize;
    } catch (_) {}

    // Audit log
    let auditLog = [];
    try {
      auditLog = await queryAll(`SELECT action, entity_type, entity_id, created_at, changes FROM audit_log ORDER BY created_at DESC LIMIT 20`);
    } catch (_) {}

    const PORT = process.env.PORT || 3001;

    res.json({
      version: 'v1.16.18',
      uptime_seconds: Math.floor((Date.now() - (req.app.startedAt || Date.now())) / 1000),
      ip_addresses: ips,
      port: PORT,
      ws_connections: req.app.wss ? req.app.wss.clients.size : 0,
      counts,
      runs,
      db: {
        ...dbInfo,
        last_backup: backups.length > 0 ? backups[0].created_at : null,
        backup_count: backups.length,
      },
      disk,
      errors: (req.app.errorLog || []).slice(-50).reverse(),
      audit_log: auditLog,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
