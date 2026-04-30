/**
 * autosave.js -- lightweight write counter with periodic DB backup
 *
 * After every BACKUP_INTERVAL write operations, copies the SQLite database
 * file to data/backups/ with a timestamp.  Keeps the last MAX_BACKUPS only.
 */

const fs   = require('fs');
const path = require('path');
const { execute } = require('./schema');

const DATA_DIR    = path.join(__dirname, '../../data');
const DB_PATH     = path.join(DATA_DIR, 'scoring.db');
const BACKUP_DIR  = path.join(DATA_DIR, 'backups');
const BACKUP_INTERVAL = 5;   // writes between backups
const MAX_BACKUPS     = 10;

let writeCounter = 0;

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
 * Triggers a backup every BACKUP_INTERVAL calls.
 */
function recordWrite() {
  writeCounter++;
  if (writeCounter % BACKUP_INTERVAL === 0) {
    doBackup();
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

module.exports = { recordWrite, listBackups, getWriteCount, doBackup, BACKUP_DIR, BACKUP_INTERVAL, MAX_BACKUPS };
