/**
 * server/sync/package.js — adoption package builder (v2 Step 2, cloud side)
 * + v2.5.00 return package builder (venue side).
 *
 * Manifest-driven (FR-6): every snapshot table is exported via
 * protocol.selectForMeet with the pinned column list — never SELECT * — and
 * rows are reduced to manifest columns, so import, sync, and checksum can
 * never disagree about what a row is. Includes the USSS people snapshot (R5)
 * and the meet logo file (disk file → base64).
 */

const fs = require('fs');
const path = require('path');
const { queryAll, getClient, rowToObj } = require('../db/schema');
const protocol = require('./protocol');

const MEET_LOGOS_DIR = path.join(__dirname, '..', 'data', 'logos');

function findLogoFile(meetId) {
  try {
    const files = fs.readdirSync(MEET_LOGOS_DIR);
    const match = files.find(f => f.startsWith(`meet_${meetId}.`));
    return match ? path.join(MEET_LOGOS_DIR, match) : null;
  } catch (_) {
    return null;
  }
}

// v2.3.01 — bottom (sponsor) logo, meet_<id>_bottom.<ext>
function findBottomLogoFile(meetId) {
  try {
    const files = fs.readdirSync(MEET_LOGOS_DIR);
    const match = files.find(f => f.startsWith(`meet_${meetId}_bottom.`));
    return match ? path.join(MEET_LOGOS_DIR, match) : null;
  } catch (_) {
    return null;
  }
}

/**
 * Read a list of manifest tables for one meet, reduced to manifest rows.
 * M-2: every table is read inside ONE read transaction (batch mode 'read') so
 * a slow concurrent write can never land between table reads and tear the
 * snapshot. Falls back to sequential reads if the driver refuses.
 */
async function snapshotTables(meetId, tableList) {
  const tables = {};
  const stmts = tableList.map(t => ({ sql: protocol.selectForMeet(t), args: [meetId] }));
  let resultRows;
  try {
    const sets = await getClient().batch(stmts, 'read');
    resultRows = sets.map(rs => rs.rows.map(rowToObj));
  } catch (_) {
    resultRows = [];
    for (const s of stmts) resultRows.push(await queryAll(s.sql, s.args));
  }
  tableList.forEach((table, i) => {
    tables[table] = resultRows[i].map(r => protocol.manifestRow(table, r));
  });
  return tables;
}

function readLogoEntry(filePath) {
  if (!filePath) return null;
  return {
    filename: path.basename(filePath),
    base64: fs.readFileSync(filePath).toString('base64'),
  };
}

function readLogos(meetId) {
  return {
    logo: readLogoEntry(findLogoFile(meetId)),
    bottom_logo: readLogoEntry(findBottomLogoFile(meetId)),
  };
}

/**
 * Build the full adoption package for a meet. MUST be called only AFTER the
 * adoption lock is set (lock-drain-snapshot order, Section 5.2) — a write
 * landing during a lock-before-snapshot window would be silently overwritten
 * by upsync and invisible to the checksum.
 */
async function buildAdoptionPackage(meetId) {
  const tables = await snapshotTables(meetId, protocol.SNAPSHOT_TABLES);
  if (!tables.meets || tables.meets.length !== 1) {
    throw new Error(`Adoption package: meet ${meetId} not found`);
  }
  const { logo, bottom_logo } = readLogos(meetId);
  return {
    format: 'stickit-adoption-package',
    protocol_version: protocol.SYNC_PROTOCOL_VERSION,
    meet_id: meetId,
    exported_at: new Date().toISOString(),
    tables,
    logo,
    bottom_logo, // v2.3.01 — optional; older importers ignore it
  };
}

/**
 * v2.5.00 — return package (venue side): the complete, self-verifying record
 * of the adopted meet for the offline (file) check-in / handback path.
 *
 *   tables     every CHECKSUM table's full meet-scoped row set (repush-shaped:
 *              the cloud replaces its rows with these) + audit_log (FR-12:
 *              synced but not checksummed; the cloud upserts these rows only).
 *   checksums  computed from the SAME rows placed in `tables`, so the cloud
 *              can prove the file is intact before writing anything.
 *
 * MUST be called with the venue frozen ('checking_in') and after the write
 * barrier — the file is the last word on this adoption.
 */
async function buildReturnPackage(meetId, { mode, sync_token }) {
  const tables = await snapshotTables(meetId, protocol.CHECKSUM_TABLES);
  if (!tables.meets || tables.meets.length !== 1) {
    throw new Error(`Return package: meet ${meetId} not found`);
  }
  // audit_log has scope 'venue_all' (selectForMeet refuses it): a venue holds
  // one meet, so its whole audit table rides along, upsert-only on the cloud.
  const auditSpec = protocol.TABLES.audit_log;
  const auditRows = await queryAll(`SELECT ${auditSpec.columns.join(', ')} FROM audit_log ORDER BY timestamp, id`);
  tables.audit_log = auditRows.map(r => protocol.manifestRow('audit_log', r));

  const checksums = {};
  for (const t of protocol.CHECKSUM_TABLES) {
    checksums[t] = protocol.tableChecksum(t, tables[t]);
  }
  const { logo, bottom_logo } = readLogos(meetId);
  return {
    format: 'stickit-return-package',
    protocol_version: protocol.SYNC_PROTOCOL_VERSION,
    meet_id: meetId,
    meet_name: tables.meets[0].name,
    mode,
    exported_at: new Date().toISOString(),
    sync_token,
    checksums,
    tables,
    logo,
    bottom_logo,
  };
}

module.exports = {
  buildAdoptionPackage,
  buildReturnPackage,
  snapshotTables,
  readLogos,
  findLogoFile,
  findBottomLogoFile,
  MEET_LOGOS_DIR,
};
