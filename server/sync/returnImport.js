/**
 * server/sync/returnImport.js — cloud-side import of a venue RETURN package
 * (v2.5.00, the offline check-in / handback path).
 *
 * A return package is the venue's complete, self-verifying record of the
 * adopted meet (see package.js buildReturnPackage). Applying it collapses the
 * online flow's flush → checksum verify → repush → unlock into one idempotent
 * step. Nothing is written until every pre-check passes:
 *
 *   format → protocol version → meet identity → mode → adoption state +
 *   embedded sync token (a file from an OLDER adoption of the same meet can
 *   never overwrite the current one) → self-consistency (the file's own
 *   checksums recomputed from its rows) → ONE atomic batch replacing the
 *   cloud's meet-scoped rows (repush semantics; master tables upsert-only,
 *   H-3; audit_log upsert-only, FR-12) → independent cloud checksum verify →
 *   unlock (checkin → 'checked_in', handback → NULL).
 *
 * Reached two ways, same function: the officials upload
 * (POST /api/adoption/:meetId/import-return, login) and the venue's own
 * "Send to cloud now" (POST /api/sync/meets/:meetId/return, bearer token).
 */

const { queryOne, execute, batch } = require('../db/schema');
const protocol = require('./protocol');
const { hashToken } = require('./adoption');
const { hashesEqual, cloudChecksums, compareChecksums, replaceTableStatements, upsertSql } = require('./cloudApply');
const { IMPORT_ORDER, writeLogo } = require('./adoptionImport');

class ReturnImportError extends Error {
  constructor(httpCode, code, message, extra = {}) {
    super(message);
    this.httpCode = httpCode;
    this.code = code;
    this.extra = extra;
  }
}

const fail = (httpCode, code, message, extra) => { throw new ReturnImportError(httpCode, code, message, extra); };

/**
 * Apply a return package to `meet` (a fresh meets row). Returns
 * { ok, mode, recorded_mode, verified_tables, counts, exported_at }.
 */
async function applyReturnPackage({ meet, pkg, modeOverride = null, via, actor = null, broadcast = null }) {
  // 1. Shape.
  if (!pkg || typeof pkg !== 'object' || pkg.format !== 'stickit-return-package' || !pkg.tables || typeof pkg.tables !== 'object') {
    fail(400, 'bad_package', 'This is not a StickIt return file. Use the "Return file" downloaded from the venue server — not an adoption file or a regular meet export.');
  }
  // 2. Protocol.
  if (pkg.protocol_version !== protocol.SYNC_PROTOCOL_VERSION) {
    fail(409, 'protocol_mismatch',
      `Sync protocol mismatch: cloud speaks version ${protocol.SYNC_PROTOCOL_VERSION}, the file is version ${pkg.protocol_version ?? 'unknown'}. Update StickIt on the older side.`,
      { expected: protocol.SYNC_PROTOCOL_VERSION, received: pkg.protocol_version ?? null });
  }
  // 3. Identity.
  const meetRows = Array.isArray(pkg.tables.meets) ? pkg.tables.meets : [];
  if (pkg.meet_id !== meet.id || meetRows.length !== 1 || meetRows[0].id !== meet.id) {
    fail(400, 'wrong_meet',
      `This return file belongs to a different meet${pkg.meet_name ? ` ("${pkg.meet_name}")` : ''}. Open that meet and import it there.`,
      { file_meet_id: pkg.meet_id || null, file_meet_name: pkg.meet_name || null });
  }
  // 4. Mode.
  const recordedMode = pkg.mode === 'checkin' || pkg.mode === 'handback' ? pkg.mode : null;
  const mode = modeOverride || recordedMode;
  if (mode !== 'checkin' && mode !== 'handback') {
    fail(400, 'bad_mode', 'mode must be checkin or handback');
  }
  // 5. State + token.
  if (!meet.sync_token_hash) {
    if (meet.adoption_status === 'checked_in') {
      fail(410, 'already_returned',
        `This meet was already checked in${meet.last_sync_at ? ` (${meet.last_sync_at})` : ''} — the return file has been imported. Nothing to do.`,
        { adoption_status: meet.adoption_status, last_sync_at: meet.last_sync_at || null });
    }
    fail(409, 'not_adopted',
      'This meet is not adopted on the cloud — the lock was undone or force-unlocked, or a handback file was already imported. The cloud copy may have changed since this file was written, so it is refused. If the venue data is still needed, recover it with the standard Export/Import.',
      { adoption_status: meet.adoption_status || null });
  }
  if (meet.adoption_status !== 'adopted') {
    fail(409, 'not_adopted', `Meet adoption status is ${meet.adoption_status || 'none'}.`, { adoption_status: meet.adoption_status || null });
  }
  if (!pkg.sync_token || !hashesEqual(hashToken(String(pkg.sync_token)), meet.sync_token_hash)) {
    fail(401, 'stale_return_file',
      'This return file was written under an earlier adoption of this meet (the meet has since been adopted again, or by another venue server). Only the current venue can return it.');
  }

  // 6. Self-consistency: every checksum table present, rows well-formed, and
  //    the file's checksums reproduce from its own rows.
  const badTables = [];
  const counts = {};
  for (const t of protocol.CHECKSUM_TABLES) {
    const rows = pkg.tables[t];
    if (!Array.isArray(rows) || !pkg.checksums || !pkg.checksums[t]) { badTables.push(t); continue; }
    const spec = protocol.TABLES[t];
    const manifest = rows.map(r => protocol.manifestRow(t, r || {}));
    if (manifest.some(r => spec.pk.some(c => r[c] === null || r[c] === undefined))) { badTables.push(t); continue; }
    // Rows of meet-keyed tables must name THIS meet (defense in depth on top
    // of the token: a crafted file cannot plant events in another meet).
    if (spec.scope === 'meet' && manifest.some(r => r.meet_id !== meet.id)) { badTables.push(t); continue; }
    const sum = protocol.tableChecksum(t, manifest);
    if (sum.hash !== pkg.checksums[t].hash || sum.count !== pkg.checksums[t].count) badTables.push(t);
    counts[t] = manifest.length;
  }
  if (badTables.length) {
    fail(400, 'file_corrupt',
      `The return file failed its own integrity check (${badTables.join(', ')}). It may be truncated or edited. Download it from the venue server again.`,
      { tables: badTables });
  }
  const auditRows = Array.isArray(pkg.tables.audit_log) ? pkg.tables.audit_log : [];

  // 7. Statements — parents first, then audit_log upsert-only — in ONE batch.
  const stmts = [];
  for (const t of IMPORT_ORDER) {
    if (!protocol.CHECKSUM_TABLES.includes(t)) continue;
    const { stmts: s } = await replaceTableStatements(meet.id, t, pkg.tables[t]);
    stmts.push(...s);
  }
  const auditSpec = protocol.TABLES.audit_log;
  let auditCount = 0;
  for (const raw of auditRows) {
    const row = protocol.manifestRow('audit_log', raw || {});
    if (row.id === null || row.id === undefined) continue;
    stmts.push({ sql: upsertSql('audit_log'), args: auditSpec.columns.map(c => row[c]) });
    auditCount++;
  }
  counts.audit_log = auditCount;
  await batch(stmts);

  // 8. Logos (best-effort).
  counts.logo = writeLogo(pkg.logo, `meet_${meet.id}.`, 'logo');
  counts.bottom_logo = writeLogo(pkg.bottom_logo, `meet_${meet.id}_bottom.`, 'bottom logo');

  // 9. Independent verify — the cloud recomputes from what actually landed.
  const cloud = await cloudChecksums(meet.id);
  const cmp = compareChecksums(pkg.checksums, cloud);
  if (!cmp.match) {
    // Rows are applied but the meet stays adopted: a re-import is idempotent.
    await execute(`UPDATE meets SET last_sync_at=datetime('now'), updated_at=updated_at WHERE id=?`, [meet.id]);
    fail(409, 'checksum_mismatch',
      `Verification failed after import — these tables still differ: ${cmp.mismatched.join(', ')}. The cloud copy stays locked; nothing was lost. Try the import again, or call support.`,
      { mismatched: cmp.mismatched });
  }

  // 10. Unlock — guarded by the token hash read above, so a code re-adoption
  //     racing this import leaves zero rows instead of unlocking the wrong one.
  const r = await execute(
    `UPDATE meets SET adoption_status=?, sync_token_hash=NULL, last_sync_at=datetime('now'), updated_at=updated_at
     WHERE id=? AND sync_token_hash=?`,
    [mode === 'checkin' ? 'checked_in' : null, meet.id, meet.sync_token_hash]
  );
  if (!r.rowsAffected) {
    fail(409, 'state_changed', 'The meet changed adoption state while the file was being imported. Refresh and try again.');
  }

  // 11. Audit.
  try {
    const { logAudit } = require('../routes/audit');
    await logAudit(mode === 'checkin' ? 'meet_checked_in' : 'meet_handed_back', 'meet', meet.id, null, {
      via: via || 'return_file',
      recorded_mode: recordedMode,
      applied_mode: mode,
      exported_at: pkg.exported_at || null,
      by: actor,
      verified_tables: protocol.CHECKSUM_TABLES.length,
      counts,
    });
  } catch (_) {}

  // 12. FR-19 nudge per event in the file.
  if (typeof broadcast === 'function') {
    for (const ev of (pkg.tables.events || [])) {
      if (ev && ev.id) { try { broadcast(ev.id, 'sync_applied', {}); } catch (_) {} }
    }
  }

  return {
    ok: true,
    mode,
    recorded_mode: recordedMode,
    verified_tables: protocol.CHECKSUM_TABLES.length,
    counts,
    exported_at: pkg.exported_at || null,
  };
}

/** Express helper: run the import for req.params.meetId and answer. */
async function handleReturnImport(req, res, { meet, pkg, mode, via }) {
  try {
    const out = await applyReturnPackage({
      meet, pkg, modeOverride: mode || null, via,
      actor: (req.user && (req.user.username || req.user.display_name)) || null,
      broadcast: req.app && req.app.broadcast ? req.app.broadcast : null,
    });
    res.json(out);
  } catch (e) {
    if (e instanceof ReturnImportError) {
      return res.status(e.httpCode).json({ error: e.code, message: e.message, ...e.extra });
    }
    res.status(500).json({ error: e.message });
  }
}

module.exports = { applyReturnPackage, handleReturnImport, ReturnImportError };
