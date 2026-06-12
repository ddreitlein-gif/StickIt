const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { queryAll, queryOne, execute } = require('../db/schema');
const { VERSION } = require('../version');
const { isAuthEnabled } = require('../middleware/auth');
const { VALID_ROLES } = require('../auth/roles');

// ── Users CRUD ──────────────────────────────────────────────────────────────

router.get('/users', async (req, res) => {
  try {
    const users = await queryAll(
      `SELECT id, username, display_name, role, is_active, created_at, updated_at,
              CASE WHEN password_hash IS NOT NULL THEN 1 ELSE 0 END AS has_password
       FROM users ORDER BY display_name`
    );
    res.json(users);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// v1.25.00 (A-4) — refuse changes that would lock the admin panel out entirely.
// req.user is only set when auth is enabled; the last-admin rule applies always.
async function deactivationGuard(req, res, target) {
  if (req.user && req.user.id === target.id) {
    res.status(400).json({ error: 'You cannot deactivate your own account' });
    return false;
  }
  if (target.role === 'system_admin' || target.role === 'event_admin') {
    const row = await queryOne(
      `SELECT COUNT(*) AS cnt FROM users WHERE is_active=1 AND role IN ('event_admin','system_admin') AND id != ?`,
      [target.id]
    );
    if (!row || parseInt(row.cnt) === 0) {
      res.status(400).json({ error: 'Cannot deactivate the last active admin' });
      return false;
    }
  }
  return true;
}

router.get('/users/:id', async (req, res) => {
  try {
    const user = await queryOne('SELECT id, username, display_name, role, is_active, created_at, updated_at FROM users WHERE id=?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/users', async (req, res) => {
  try {
    const { username, display_name, role, password } = req.body;
    if (!username || !display_name) return res.status(400).json({ error: 'username and display_name are required' });
    if (role && !VALID_ROLES.includes(role)) return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
    const existing = await queryOne('SELECT id FROM users WHERE username=?', [username.trim().toLowerCase()]);
    if (existing) return res.status(409).json({ error: 'Username already exists' });
    const id = uuidv4();
    const hash = password ? await bcrypt.hash(password, 10) : null;
    await execute(
      'INSERT INTO users (id, username, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)',
      [id, username.trim().toLowerCase(), hash, display_name.trim(), role || 'official']
    );
    if (hash) {
      await execute(
        `INSERT INTO audit_log (id, action, entity, entity_id, new_value) VALUES (?,?,?,?,?)`,
        [uuidv4(), 'password_set', 'user', id, JSON.stringify({ username: username.trim().toLowerCase() })]
      );
    }
    const user = await queryOne('SELECT id, username, display_name, role, is_active, created_at, updated_at FROM users WHERE id=?', [id]);
    res.status(201).json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/users/:id', async (req, res) => {
  try {
    const user = await queryOne('SELECT * FROM users WHERE id=?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { display_name, role, is_active, password } = req.body;
    if (role && !VALID_ROLES.includes(role)) return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
    const deactivating = (is_active === 0 || is_active === false) && user.is_active;
    if (deactivating && !(await deactivationGuard(req, res, user))) return;
    await execute(
      `UPDATE users SET display_name=COALESCE(?,display_name), role=COALESCE(?,role), is_active=COALESCE(?,is_active), updated_at=datetime('now') WHERE id=?`,
      [display_name || null, role || null, is_active !== undefined ? is_active : null, req.params.id]
    );
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await execute(
        `UPDATE users SET password_hash=?, updated_at=datetime('now') WHERE id=?`,
        [hash, req.params.id]
      );
      await execute(
        `INSERT INTO audit_log (id, action, entity, entity_id, new_value) VALUES (?,?,?,?,?)`,
        [uuidv4(), 'password_set', 'user', req.params.id, JSON.stringify({ username: user.username })]
      );
    }
    const updated = await queryOne('SELECT id, username, display_name, role, is_active, created_at, updated_at FROM users WHERE id=?', [req.params.id]);
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/users/:id', async (req, res) => {
  try {
    const user = await queryOne('SELECT * FROM users WHERE id=?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.is_active && !(await deactivationGuard(req, res, user))) return;
    await execute(`UPDATE users SET is_active=0, updated_at=datetime('now') WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Auth Settings ───────────────────────────────────────────────────────────

router.get('/auth-settings', async (req, res) => {
  try {
    const envForced = process.env.STICKIT_AUTH === 'off';
    const enabled = await isAuthEnabled();
    const adminRow = await queryOne(
      `SELECT COUNT(*) AS cnt FROM users WHERE is_active=1 AND role IN ('event_admin','system_admin') AND password_hash IS NOT NULL`
    );
    const hasAdminPassword = adminRow && parseInt(adminRow.cnt) > 0;
    res.json({ enabled, envForced, hasAdminPassword });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/auth-settings', async (req, res) => {
  try {
    const { enabled } = req.body;
    if (enabled === true || enabled === 1) {
      const adminRow = await queryOne(
        `SELECT COUNT(*) AS cnt FROM users WHERE is_active=1 AND role IN ('event_admin','system_admin') AND password_hash IS NOT NULL`
      );
      const hasAdminPassword = adminRow && parseInt(adminRow.cnt) > 0;
      if (!hasAdminPassword) {
        return res.status(400).json({ error: 'Set an admin password before enabling protection.' });
      }
    }
    const val = (enabled === true || enabled === 1) ? '1' : '0';
    await execute(
      `INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('auth_enabled', ?, datetime('now'))`,
      [val]
    );
    await execute(
      `INSERT INTO audit_log (id, action, entity, entity_id, new_value) VALUES (?,?,?,?,?)`,
      [uuidv4(), 'auth_settings_changed', 'app_settings', 'auth_enabled', JSON.stringify({ auth_enabled: val })]
    );
    res.json({ enabled: val === '1' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Event Lock/Unlock ───────────────────────────────────────────────────────

router.get('/events', async (req, res) => {
  try {
    const events = await queryAll(
      `SELECT e.id, e.name, e.discipline, e.division, e.gender, e.status, e.locked, e.hide_livescores, e.created_at,
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

// ── Live Scores Visibility (v1.25.02) ───────────────────────────────────────
// Independent of lock: hidden events drop off the public /livescores listing
// and the Viewer API event list; direct scoreboard/overlay URLs keep working.

router.put('/events/:eventId/hide', async (req, res) => {
  try {
    await execute(`UPDATE events SET hide_livescores=1, updated_at=datetime('now') WHERE id=?`, [req.params.eventId]);
    try {
      const { logAudit } = require('./audit');
      await logAudit('event_hidden_livescores', 'event', req.params.eventId, null, { hide_livescores: 1 });
    } catch (_) {}
    res.json({ ok: true, hide_livescores: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/events/:eventId/show', async (req, res) => {
  try {
    await execute(`UPDATE events SET hide_livescores=0, updated_at=datetime('now') WHERE id=?`, [req.params.eventId]);
    try {
      const { logAudit } = require('./audit');
      await logAudit('event_shown_livescores', 'event', req.params.eventId, null, { hide_livescores: 0 });
    } catch (_) {}
    res.json({ ok: true, hide_livescores: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/meets/:meetId/hide-all', async (req, res) => {
  try {
    await execute(`UPDATE events SET hide_livescores=1, updated_at=datetime('now') WHERE meet_id=?`, [req.params.meetId]);
    try {
      const { logAudit } = require('./audit');
      await logAudit('meet_events_hidden_livescores', 'meet', req.params.meetId, null, { hide_livescores: 1 });
    } catch (_) {}
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/meets/:meetId/show-all', async (req, res) => {
  try {
    await execute(`UPDATE events SET hide_livescores=0, updated_at=datetime('now') WHERE meet_id=?`, [req.params.meetId]);
    try {
      const { logAudit } = require('./audit');
      await logAudit('meet_events_shown_livescores', 'meet', req.params.meetId, null, { hide_livescores: 0 });
    } catch (_) {}
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
    res.json({ version: VERSION, counts });
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
      auditLog = await queryAll(`SELECT action, entity, entity_id, timestamp, new_value FROM audit_log ORDER BY timestamp DESC LIMIT 20`);
    } catch (_) {}

    const PORT = process.env.PORT || 3001;

    const authEnabled = await isAuthEnabled();
    const envForced = process.env.STICKIT_AUTH === 'off';

    res.json({
      version: VERSION,
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
      auth: { enabled: authEnabled, env_forced: envForced },
      env: {
        deepgram_configured: !!process.env.DEEPGRAM_API_KEY,
        jwt_secret_set: !!process.env.STICKIT_JWT_SECRET,
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Athletes Master Database (v1.16.31) ────────────────────────────────────

router.get('/athletes', async (req, res) => {
  try {
    const { q, division } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
    // v1.25.00 (B-7): ?deleted=1 lists soft-deleted athletes for the restore view.
    const conds = [req.query.deleted === '1' ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'];
    const args = [];
    if (q && q.trim()) {
      const t = `%${q.trim()}%`;
      conds.push('(last_name LIKE ? OR first_name LIKE ? OR ussa_num LIKE ? OR fis_id LIKE ? OR club LIKE ?)');
      args.push(t, t, t, t, t);
    }
    if (division) {
      if (division === '__none__') {
        conds.push('(division IS NULL OR division = "")');
      } else {
        conds.push('division = ?');
        args.push(division);
      }
    }
    const where = `WHERE ${conds.join(' AND ')}`;
    const totalRow = await queryOne(`SELECT COUNT(*) as c FROM athletes ${where}`, args);
    const total = parseInt(totalRow?.c) || 0;
    const offset = (page - 1) * limit;
    const rows = await queryAll(
      `SELECT a.*,
              CASE WHEN a.ussa_num IS NULL OR a.ussa_num = '' THEN 0
                   WHEN EXISTS (SELECT 1 FROM usss_people u WHERE u.ussa_id = a.ussa_num) THEN 1
                   ELSE 0 END AS is_in_usss
       FROM athletes a ${where}
       ORDER BY a.last_name, a.first_name LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );
    res.json({ rows, total, page, limit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/athletes/divisions', async (req, res) => {
  try {
    const rows = await queryAll(
      `SELECT COALESCE(NULLIF(TRIM(division), ''), '__none__') as division, COUNT(*) as cnt
       FROM athletes WHERE deleted_at IS NULL
       GROUP BY COALESCE(NULLIF(TRIM(division), ''), '__none__')
       ORDER BY division`
    );
    res.json({ divisions: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Build SQL fragment + args from a delete request body. Always includes deleted_at IS NULL.
async function buildDeleteFilter(body) {
  const { mode, ids, division } = body || {};
  const baseConds = ['deleted_at IS NULL'];
  const args = [];
  if (mode === 'reset') {
    // no extra
  } else if (mode === 'selected') {
    if (!Array.isArray(ids) || !ids.length) return { error: 'ids required for mode=selected' };
    const placeholders = ids.map(() => '?').join(',');
    baseConds.push(`id IN (${placeholders})`);
    args.push(...ids);
  } else if (mode === 'by-division') {
    if (division === undefined || division === null) return { error: 'division required for mode=by-division' };
    if (division === '__none__' || division === '') {
      baseConds.push('(division IS NULL OR division = "")');
    } else {
      baseConds.push('division = ?');
      args.push(division);
    }
  } else if (mode === 'non-usss') {
    baseConds.push(`(ussa_num IS NULL OR ussa_num = '' OR ussa_num NOT IN (SELECT ussa_id FROM usss_people))`);
  } else {
    return { error: 'mode must be one of: reset, selected, by-division, non-usss' };
  }
  return { where: baseConds.join(' AND '), args };
}

router.post('/athletes/preview-delete', async (req, res) => {
  try {
    const filter = await buildDeleteFilter(req.body);
    if (filter.error) return res.status(400).json({ error: filter.error });
    const countRow = await queryOne(`SELECT COUNT(*) as c FROM athletes WHERE ${filter.where}`, filter.args);
    const count = parseInt(countRow?.c) || 0;
    const sample = await queryAll(
      `SELECT id, first_name, last_name, ussa_num, division FROM athletes WHERE ${filter.where} ORDER BY last_name, first_name LIMIT 10`,
      filter.args
    );
    res.json({ count, sample });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/athletes/delete', async (req, res) => {
  try {
    const filter = await buildDeleteFilter(req.body);
    if (filter.error) return res.status(400).json({ error: filter.error });
    const countRow = await queryOne(`SELECT COUNT(*) as c FROM athletes WHERE ${filter.where}`, filter.args);
    const count = parseInt(countRow?.c) || 0;
    if (count > 0) {
      await execute(
        `UPDATE athletes SET deleted_at=datetime('now') WHERE ${filter.where}`,
        filter.args
      );
    }
    try {
      const { logAudit } = require('./audit');
      await logAudit('athletes_bulk_deleted', 'athlete', null, null, { mode: req.body.mode, count, division: req.body.division || null, ids: req.body.ids || null });
    } catch (_) {}
    res.json({ deleted: count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// v1.25.00 (B-7) — restore soft-deleted athletes.
router.post('/athletes/restore', async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array required' });
    const placeholders = ids.map(() => '?').join(',');
    await execute(
      `UPDATE athletes SET deleted_at=NULL WHERE id IN (${placeholders}) AND deleted_at IS NOT NULL`,
      ids
    );
    try {
      const { logAudit } = require('./audit');
      await logAudit('athletes_restored', 'athlete', null, null, { count: ids.length, ids });
    } catch (_) {}
    res.json({ restored: ids.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// v1.25.00 (B-9b) — deliberately re-open a finalized event so scores can be corrected.
router.post('/events/:eventId/reopen', async (req, res) => {
  try {
    const ev = await queryOne('SELECT id, name, status, discipline FROM events WHERE id=?', [req.params.eventId]);
    if (!ev) return res.status(404).json({ error: 'Event not found' });
    if (ev.status !== 'complete') return res.status(400).json({ error: 'Event is not finalized' });
    await execute(`UPDATE events SET status='in_progress', updated_at=datetime('now') WHERE id=?`, [ev.id]);
    if (ev.discipline === 'dual_mogul') {
      await execute(`UPDATE events SET dual_bracket_review_status=NULL WHERE id=?`, [ev.id]);
    }
    try {
      const { logAudit } = require('./audit');
      await logAudit('event_reopened', 'event', ev.id, null, { name: ev.name, discipline: ev.discipline });
    } catch (_) {}
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── USSS People (view + CSV download) ───────────────────────────────────────

router.get('/usss/people', async (req, res) => {
  try {
    const { q, type } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
    const conds = [];
    const args = [];
    if (type && ['C', 'CO', 'O'].includes(type)) {
      conds.push('type = ?');
      args.push(type);
    }
    if (q && q.trim()) {
      const t = `${q.trim()}%`;
      conds.push('(last_name LIKE ? OR first_name LIKE ? OR ussa_id LIKE ? OR club_name LIKE ?)');
      args.push(t, t, t, t);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const totalRow = await queryOne(`SELECT COUNT(*) as c FROM usss_people ${where}`, args);
    const total = parseInt(totalRow?.c) || 0;
    const offset = (page - 1) * limit;
    const rows = await queryAll(
      `SELECT * FROM usss_people ${where} ORDER BY last_name, first_name LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );
    res.json({ rows, total, page, limit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/usss/people/download', async (req, res) => {
  try {
    const status = await queryOne('SELECT list_year, list_identifier FROM usss_sync_status WHERE id = 1');
    const rows = await queryAll('SELECT * FROM usss_people ORDER BY last_name, first_name');
    const cols = ['ussa_id','type','last_name','first_name','division','gender','yob','club_name','ae_points','dm_points','mo_points','fis_id','updated_at'];
    const esc = v => v == null ? '' : (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const csv = [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
    const slug = [status?.list_year, status?.list_identifier].filter(Boolean).join('_').replace(/\s+/g, '_');
    const fname = slug ? `usss_people_${slug}.csv` : 'usss_people.csv';
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(csv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Backups (v1.16.22) ──────────────────────────────────────────────────────

router.get('/backups', async (req, res) => {
  try {
    const { listBackups, getWriteCount, getPendingWrites, BACKUP_INTERVAL_MINUTES, MAX_BACKUPS } = require('../db/autosave');
    const backups = listBackups();
    const totalSize = backups.reduce((sum, b) => sum + (b.size_bytes || 0), 0);
    res.json({
      backups,
      stats: {
        count: backups.length,
        oldest: backups.length ? backups[backups.length - 1].created_at : null,
        newest: backups.length ? backups[0].created_at : null,
        total_size_bytes: totalSize,
        write_counter: getWriteCount(),
        pending_writes: getPendingWrites(),
        interval_minutes: BACKUP_INTERVAL_MINUTES,
        max: MAX_BACKUPS,
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/backups/create', async (req, res) => {
  try {
    const { doBackup, listBackups } = require('../db/autosave');
    await doBackup();
    const backups = listBackups();
    res.json({ ok: true, latest: backups[0] || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/backups/:filename/download', async (req, res) => {
  try {
    const path = require('path');
    const fs = require('fs');
    const { BACKUP_DIR } = require('../db/autosave');
    const { filename } = req.params;
    if (!/^scoring_[\w\-]+\.db$/.test(filename)) {
      return res.status(400).json({ error: 'Invalid backup filename' });
    }
    const fullPath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'Backup not found' });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    fs.createReadStream(fullPath).pipe(res);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// v1.25.00 (B-9a) — restore a backup over the live database. Takes a pre-restore
// safety backup first. The server must be restarted afterward to reload the DB.
router.post('/backups/:filename/restore', async (req, res) => {
  try {
    const path = require('path');
    const fs = require('fs');
    const { BACKUP_DIR, doBackup } = require('../db/autosave');
    const { filename } = req.params;
    if (!/^scoring_[\w\-]+\.db$/.test(filename)) {
      return res.status(400).json({ error: 'Invalid backup filename' });
    }
    const fullPath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'Backup not found' });
    await doBackup(); // pre-restore safety copy of the current DB
    const dbPath = path.join(__dirname, '../data/scoring.db');
    fs.copyFileSync(fullPath, dbPath);
    try {
      const { logAudit } = require('./audit');
      await logAudit('backup_restored', 'backup', filename, null, { filename });
    } catch (_) {}
    res.json({ ok: true, restart_required: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
