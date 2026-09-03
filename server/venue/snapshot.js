/**
 * server/venue/snapshot.js — USB snapshot worker (v2 Step 5, R11).
 *
 * Periodic (5-minute) snapshot of the meet database to a second USB stick on
 * the Pi — closes the gap between total Pi loss and the last successful
 * upsync. Degrades gracefully (home-screen warning) when the stick is absent;
 * never blocks anything.
 *
 * H-10 hardening:
 *   - When STICKIT_SNAPSHOT_REQUIRE_MOUNT=1 (set by the Pi systemd unit), the
 *     target directory must be a real mountpoint (its st_dev differs from its
 *     parent's). The image bakes the mountpoint directory into the SD card
 *     with a nofail fstab entry, so a bare existsSync check would happily
 *     write "USB snapshots" onto the same SD card whose death R11 exists to
 *     survive — while reporting healthy.
 *   - The snapshot is produced with `VACUUM INTO` a temp file on the stick
 *     (an internally consistent point-in-time copy — no torn db+WAL pair),
 *     then renamed into place (same device, atomic).
 *   - Pruning uses async fs calls so judge submits never stall on slow USB.
 *
 * Target dir: STICKIT_SNAPSHOT_DIR (the Pi image mounts the stick there).
 * Interval override for the harness: STICKIT_SNAPSHOT_INTERVAL_MS.
 */

const fs = require('fs');
const fsp = require('fs').promises;
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

/** Is dir a real mountpoint (different device than its parent)? */
async function isMountpoint(dir) {
  const st = await fsp.stat(dir);
  const parent = await fsp.stat(path.dirname(dir));
  return st.dev !== parent.dev;
}

let snapshotRunning = false;
let lastLoggedError = null; // v2.4.00 (L-3): collapse repeated identical failures in the journal

async function doSnapshot() {
  const dir = status.dir;
  if (!dir) { status.available = false; return; }
  if (snapshotRunning) return; // slow-USB overlap guard
  snapshotRunning = true;
  try {
    let dirOk = fs.existsSync(dir);
    if (dirOk && process.env.STICKIT_SNAPSHOT_REQUIRE_MOUNT === '1') {
      dirOk = await isMountpoint(dir).catch(() => false);
      if (!dirOk) {
        status.available = false;
        status.last_error = 'Snapshot USB stick not mounted — snapshots would land on the SD card';
        return;
      }
    }
    if (!dirOk) {
      status.available = false;
      status.last_error = 'Snapshot USB stick not found';
      return;
    }
    const src = dbFilePath();
    if (!src || !fs.existsSync(src)) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const finalPath = path.join(dir, `stickit_snapshot_${stamp}.db`);
    const tmpPath = path.join(dir, `.stickit_snapshot_tmp_${stamp}.db`);
    // VACUUM INTO produces a consistent point-in-time copy through the live
    // connection (WAL included) — no torn db/-wal pair, no file-copy race.
    try {
      const { rawExecute } = require('../db/schema');
      await fsp.rm(tmpPath, { force: true });
      await rawExecute(`VACUUM INTO ?`, [tmpPath]);
      await fsp.rename(tmpPath, finalPath); // same device — atomic
    } catch (e) {
      await fsp.rm(tmpPath, { force: true }).catch(() => {});
      throw e;
    }
    // Prune oldest beyond MAX_SNAPSHOTS (timestamps sort lexicographically).
    const files = (await fsp.readdir(dir)).filter(f => /^stickit_snapshot_.*\.db$/.test(f)).sort().reverse();
    for (const f of files.slice(MAX_SNAPSHOTS)) {
      await fsp.unlink(path.join(dir, f)).catch(() => {});
      await fsp.unlink(path.join(dir, f + '-wal')).catch(() => {});
    }
    status.available = true;
    status.last_snapshot_at = new Date().toISOString();
    status.last_error = null;
    status.count = Math.min(files.length, MAX_SNAPSHOTS); // files already includes the new snapshot
    console.log(`[snapshot] written ${path.basename(finalPath)} (${status.count} on the stick)`);
  } catch (e) {
    status.available = false;
    status.last_error = e.message;
  } finally {
    snapshotRunning = false;
    // v2.4.00 (physical test L-3): one journal line per snapshot RESULT so a
    // stick problem (F-2 was found only on the home screen) shows in
    // `journalctl -u stickit-venue`. Repeated identical failures collapse to
    // one line until the message changes or the stick recovers.
    if (!status.available) {
      const msg = status.last_error || 'Snapshot USB stick not available';
      if (msg !== lastLoggedError) {
        console.error(`[snapshot] FAILED: ${msg}${status.dir ? ` (dir ${status.dir})` : ''}`);
        lastLoggedError = msg;
      }
    } else if (lastLoggedError) {
      console.log('[snapshot] stick available again — snapshots resumed');
      lastLoggedError = null;
    }
  }
}

let timer = null;

function startVenueSnapshots() {
  if (timer) return;
  const interval = parseInt(process.env.STICKIT_SNAPSHOT_INTERVAL_MS) || 5 * 60 * 1000;
  const run = () => { doSnapshot().catch(e => { status.available = false; status.last_error = e.message; }); };
  run(); // one immediately so the status is fresh at boot
  timer = setInterval(run, interval);
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
