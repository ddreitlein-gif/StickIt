/**
 * autosave.js -- time-based DB backup
 *
 * Every BACKUP_INTERVAL_MINUTES, if at least one write has occurred since the
 * previous backup, copies the SQLite database file to data/backups/ with a
 * timestamp. Keeps the last MAX_BACKUPS only.
 *
 * Time-based (rather than write-counter-based) so that an unexpected server
 * restart can't strand a partial counter and cause backups to be skipped.
 */

const fs   = require('fs');
const path = require('path');
const { execute } = require('./schema');

const DATA_DIR    = path.join(__dirname, '../../data');
const DB_PATH     = path.join(DATA_DIR, 'scoring.db');
const BACKUP_DIR  = path.join(DATA_DIR, 'backups');
const BACKUP_INTERVAL_MINUTES = 5;
const BACKUP_INTERVAL_MS = BACKUP_INTERVAL_MINUTES * 60 * 1000;
const MAX_BACKUPS = 10;

let writeCounter = 0;            // lifetime write count for telemetry
let writesSinceLastBackup = 0;   // reset to 0 after each backup
let backupTimer = null;

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function pruneBackups() {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.db'))
    .sort()              // ISO timestamps sort correctly lexicographically
    .reverse();          // newest first
  if (files.length > MAX_BACKUPS) {
    files.slice(MAX_BACKUPS).forEach(f => {
      try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch (_) {}
    });
  }
}

async function doBackup() {
  if (!fs.existsSync(DB_PATH)) return;   // remote libsql -- nothing to copy
  ensureBackupDir();
  const ts   = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const dest = path.join(BACKUP_DIR, `scoring_${ts}.db`);
  if (fs.existsSync(dest)) return;   // already backed up this second
  try {
    await execute(`VACUUM INTO ?`, [dest]);
    pruneBackups();
    console.log(`[autosave] backup written: ${path.basename(dest)}`);
  } catch (err) {
    console.error('[autosave] backup failed:', err.message);
  }
}

/**
 * Call after each write operation (score submit, athlete update, etc.).
 * Records that a backup is wanted at the next interval tick.
 */
function recordWrite() {
  writeCounter++;
  writesSinceLastBackup++;
}

/**
 * Start the periodic backup timer. Call once at server startup.
 * Idempotent — repeated calls are no-ops.
 *
 * @param {(err: Error, context: { writes: number }) => void} [onError]
 *   Optional callback invoked when a backup throws. Use this to push
 *   failures into the AdminDashboard error log.
 */
function startAutoBackup(onError) {
  if (backupTimer) return;
  backupTimer = setInterval(() => {
    if (writesSinceLastBackup > 0) {
      const n = writesSinceLastBackup;
      writesSinceLastBackup = 0;
      doBackup().catch(err => {
        console.error(`[autosave] periodic backup failed (covered ${n} writes):`, err.message);
        if (typeof onError === 'function') {
          try { onError(err, { writes: n }); } catch (_) {}
        }
      });
    }
  }, BACKUP_INTERVAL_MS);
  if (typeof backupTimer.unref === 'function') backupTimer.unref();
}

/**
 * Stop the periodic backup timer (used by tests; not called in production).
 */
function stopAutoBackup() {
  if (backupTimer) {
    clearInterval(backupTimer);
    backupTimer = null;
  }
}

/**
 * Returns metadata for available backups (newest first).
 */
function listBackups() {
  ensureBackupDir();
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.db'))
    .sort()
    .reverse();

  return files.map(f => {
    const stat = fs.statSync(path.join(BACKUP_DIR, f));
    return {
      filename: f,
      size_bytes: stat.size,
      created_at: stat.mtime.toISOString(),
    };
  });
}

function getWriteCount() { return writeCounter; }
function getPendingWrites() { return writesSinceLastBackup; }

module.exports = {
  recordWrite,
  listBackups,
  getWriteCount,
  getPendingWrites,
  doBackup,
  startAutoBackup,
  stopAutoBackup,
  BACKUP_DIR,
  BACKUP_INTERVAL_MINUTES,
  MAX_BACKUPS,
};
