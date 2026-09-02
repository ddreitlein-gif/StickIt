/**
 * server/sync/package.js — adoption package builder (v2 Step 2, cloud side).
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
 * Build the full adoption package for a meet. MUST be called only AFTER the
 * adoption lock is set (lock-drain-snapshot order, Section 5.2) — a write
 * landing during a lock-before-snapshot window would be silently overwritten
 * by upsync and invisible to the checksum.
 */
async function buildAdoptionPackage(meetId) {
  const tables = {};
  // M-2: read every snapshot table inside ONE read transaction (batch mode
  // 'read') so a slow concurrent write can never land between table reads and
  // tear the snapshot. Falls back to sequential reads if the driver refuses.
  const stmts = protocol.SNAPSHOT_TABLES.map(t => ({ sql: protocol.selectForMeet(t), args: [meetId] }));
  let resultRows;
  try {
    const sets = await getClient().batch(stmts, 'read');
    resultRows = sets.map(rs => rs.rows.map(rowToObj));
  } catch (_) {
    resultRows = [];
    for (const s of stmts) resultRows.push(await queryAll(s.sql, s.args));
  }
  protocol.SNAPSHOT_TABLES.forEach((table, i) => {
    tables[table] = resultRows[i].map(r => protocol.manifestRow(table, r));
  });
  if (!tables.meets || tables.meets.length !== 1) {
    throw new Error(`Adoption package: meet ${meetId} not found`);
  }

  let logo = null;
  const logoPath = findLogoFile(meetId);
  if (logoPath) {
    logo = {
      filename: path.basename(logoPath),
      base64: fs.readFileSync(logoPath).toString('base64'),
    };
  }

  let bottom_logo = null;
  const bottomLogoPath = findBottomLogoFile(meetId);
  if (bottomLogoPath) {
    bottom_logo = {
      filename: path.basename(bottomLogoPath),
      base64: fs.readFileSync(bottomLogoPath).toString('base64'),
    };
  }

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

module.exports = { buildAdoptionPackage, findLogoFile, findBottomLogoFile, MEET_LOGOS_DIR };
