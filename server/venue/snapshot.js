/**
 * server/venue/snapshot.js — USB snapshot worker (v2 Step 5, R11).
 *
 * Periodic (5-minute) snapshot of the meet database to a second USB stick on
 * the Pi, reusing the autosave.js copy pattern — closes the gap between total
 * Pi loss and the last successful upsync. Degrades gracefully (home-screen
 * warning) when the stick is absent; never blocks anything.
 *
 * Target dir: STICKIT_SNAPSHOT_DIR (the Pi image mounts the stick there).
 * Interval override for the harness: STICKIT_SNAPSHOT_INTERVAL_MS.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const MAX_SNAPSHOTS = 20;

const status = {
  dir: process.env.STICKIT_SNAPSHOT_DIR || null,
  available: false,
  last_snapshot_at: null,
  last_error: null,
  count: 0,
};

function dbFilePath() {
  const url = process.env.LIBSQL_URL || `file:${path.join(DATA_DIR, 'scoring.db')}`;
  return url.startsWith('file:') ? url.slice(5) : null;
}

function doSnapshot() {
  const dir = status.dir;
  if (!dir) { status.available = false; return; }
  try {
    if (!fs.existsSync(dir)) {
      status.available = false;
      status.last_error = 'Snapshot USB stick not found';
      return;
    }
    const src = dbFilePath();
    if (!src || !fs.existsSync(src)) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(src, path.join(dir, `stickit_snapshot_${stamp}.db`));
    // Best effort: WAL sidecar too, so the snapshot is consistent.
    if (fs.existsSync(src + '-wal')) {
      try { fs.copyFileSync(src + '-wal', path.join(dir, `stickit_snapshot_${stamp}.db-wal`)); } catch (_) {}
    }
    // Prune oldest beyond MAX_SNAPSHOTS (timestamps sort lexicographically).
    const files = fs.readdirSync(dir).filter(f => /^stickit_snapshot_.*\.db$/.test(f)).sort().reverse();
    for (const f of files.slice(MAX_SNAPSHOTS)) {
      try { fs.unlinkSync(path.join(dir, f)); } catch (_) {}
      try { fs.unlinkSync(path.join(dir, f + '-wal')); } catch (_) {}
    }
    status.available = true;
    status.last_snapshot_at = new Date().toISOString();
    status.last_error = null;
    status.count = Math.min(files.length + 1, MAX_SNAPSHOTS);
  } catch (e) {
    status.available = false;
    status.last_error = e.message;
  }
}

let timer = null;

function startVenueSnapshots() {
  if (timer) return;
  const interval = parseInt(process.env.STICKIT_SNAPSHOT_INTERVAL_MS) || 5 * 60 * 1000;
  doSnapshot(); // one immediately so the status is fresh at boot
  timer = setInterval(doSnapshot, interval);
  if (timer.unref) timer.unref();
}

function getSnapshotStatus() {
  return {
    configured: !!status.dir,
    available: status.available,
    last_snapshot_at: status.last_snapshot_at,
    warning: !status.dir
      ? 'No snapshot USB stick configured'
      : (status.available ? null : (status.last_error || 'Snapshot USB stick not available')),
  };
}

module.exports = { startVenueSnapshots, getSnapshotStatus, doSnapshot };
