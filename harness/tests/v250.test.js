/**
 * v2.5.00 acceptance — offline adoption backup file + offline return
 * (USB via the scoring laptop's browser; David's 09-06-26 rulings).
 *
 * HTTP layer:
 *   A. Release + backup adoption file: the file locks the cloud at once,
 *      keeps the release code, records adopted_via='file'.
 *   B. Code still works over a never-synced file lock ("first to talk to the
 *      cloud wins"): token re-minted, the file goes stale (401 → worker
 *      terminal on the venue that imported it).
 *   C. Undo of a file lock the venue never synced under: full unlock.
 *   D. Once the file's venue synced: code refused, undo refused, re-issue
 *      refused.
 *   E. Legacy export path keeps the code; "download again" re-mints.
 *   F. Offline return end-to-end: cloud down → online check-in refuses →
 *      return file written (freeze, archive, download, status) → cloud back →
 *      refusals (wrong meet, tampered, protocol) leave the cloud untouched →
 *      import → checksum parity, unlock, idempotent second import, status
 *      'received'.
 *   G. Handback file delivered by the venue itself ("Send to cloud now");
 *      mode override on upload (handback file applied as check-in).
 *   H. Stale return file (older adoption) refused before any write.
 *   I. Force-unlock while a return file is pending → refused, venue intact.
 * Playwright layer (FR-21):
 *   J. Cloud release dialog with the backup-file checkbox; the More menu
 *      offers the return-file import while adopted.
 *   K. Venue home: archived card with Download return file + cloud line; the
 *      offline check-in dialog offers "Return via file".
 */

const path = require('path');
const fs = require('fs');
const { Checks } = require('../lib/checks');
const { Instance, SERVER_DIR } = require('../lib/instance');
const { Api } = require('../lib/client');
const { openDb } = require('../lib/db');
const { buildMeet } = require('../lib/fixtures');
const { playMogulRun } = require('../lib/driver');
const { newTablet } = require('../lib/browser');

const protocol = require(path.join(SERVER_DIR, 'sync', 'protocol.js'));
const FULL_JUDGES = ['TL1', 'TL2', 'TL3', 'Air1', 'Air2', 'HJ'];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, { timeout = 20000, every = 250 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return null;
    await sleep(every);
  }
}

async function meetChecksums(db, meetId) {
  const out = {};
  for (const t of protocol.CHECKSUM_TABLES) {
    const rows = await db.queryAll(protocol.selectForMeet(t), [meetId]);
    out[t] = protocol.tableChecksum(t, rows.map(r => protocol.manifestRow(t, r)));
  }
  return out;
}

async function waitDrained(vApi, timeout = 25000) {
  return waitFor(async () => {
    const s = await vApi.must('GET', '/api/venue/status');
    return s.sync && s.sync.state === 'up_to_date' && s.sync.queued === 0 ? s : null;
  }, { timeout });
}

// Download a file-ish endpoint and parse the JSON body.
async function fetchJsonFile(base, path, { method = 'POST', token = null, body } = {}) {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) { data = text; }
  return { status: r.status, ok: r.ok, data, headers: r.headers };
}

async function controlToken(vApi) {
  return (await vApi.must('POST', '/api/venue/verify-pin', { kind: 'control', pin: '2468' })).token;
}

async function main() {
  const c = new Checks('v250');
  const cloud = new Instance({ name: 'v250-cloud', port: 3201, mode: 'cloud' });
  const venue = new Instance({ name: 'v250-venue', port: 3202, mode: 'venue' });
  const venue2 = new Instance({ name: 'v250-venue2', port: 3203, mode: 'venue' });
  const snapDir = path.join(venue.dir, 'snap');
  fs.mkdirSync(snapDir, { recursive: true });
  venue.extraEnv = { STICKIT_SNAPSHOT_DIR: snapDir, STICKIT_SNAPSHOT_INTERVAL_MS: '1500' };

  try {
    await cloud.start();
    await venue.start();
    await venue2.start();
    const cApi = new Api(cloud.base);
    const vApi = new Api(venue.base);
    const v2Api = new Api(venue2.base);
    const cdb = openDb(cloud.dbPath);
    const vdb = openDb(venue.dbPath);
    const v2db = openDb(venue2.dbPath);
    await vApi.must('POST', '/api/venue/pins', { control_pin: '2468', crew_pin: '1357' });
    await v2Api.must('POST', '/api/venue/pins', { control_pin: '2468', crew_pin: '1357' });
    let r;

    // =====================================================================
    // A. Release + backup adoption file
    // =====================================================================
    const A = await buildMeet(cApi, { name: 'FileLock A', judges: FULL_JUDGES, athletes: 2, startRun: false });
    const relA = await cApi.must('POST', `/api/meets/${A.meet.id}/release-for-adoption`);
    r = await fetchJsonFile(cloud.base, `/api/adoption/${A.meet.id}/export-file`);
    c.eq(r.status, 200, 'A: backup adoption file created right after release');
    const fileA = r.data;
    c.eq(fileA.format, 'stickit-adoption-package', 'A: file is an adoption package');
    c.ok(!!fileA.sync_token, 'A: file carries a sync token');
    c.ok((r.headers.get('content-disposition') || '').includes('StickIt_Adoption_FileLock_A.json'), 'A: download filename names the meet');
    r = await cApi.put(`/api/meets/${A.meet.id}`, { location: 'Nope' });
    c.eq(r.status, 423, 'A: cloud copy locked the moment the file exists (ruling 1)');
    let adA = await cApi.must('GET', `/api/meets/${A.meet.id}/adoption`);
    c.eq(adA.adopted, true, 'A: adoption endpoint reports adopted');
    c.eq(adA.adopted_via, 'file', 'A: adopted_via=file');
    c.eq(adA.last_sync_at, null, 'A: venue has not synced yet');
    let rowA = await cdb.queryOne('SELECT release_code_hash, adopted_via, sync_token_hash FROM meets WHERE id=?', [A.meet.id]);
    c.ok(!!rowA.release_code_hash, 'A: the release code is KEPT alongside the file lock');
    r = await fetchJsonFile(cloud.base, `/api/adoption/${A.meet.id}/export-file`);
    c.eq(r.status, 409, 'A: a plain second export while file-locked is refused');
    c.eq(r.data.error, 'already_adopted', 'A: … as already_adopted (client offers "download again")');
    r = await cApi.post(`/api/meets/${A.meet.id}/release-for-adoption`);
    c.eq(r.status, 423, 'A: New Release Code refused while locked (mount guard)');

    // =====================================================================
    // B. Code still works over the never-synced file lock; the file goes stale
    // =====================================================================
    const hashBefore = rowA.sync_token_hash;
    r = await cApi.post('/api/sync/adopt', { code: relA.code, protocol_version: protocol.SYNC_PROTOCOL_VERSION });
    c.eq(r.status, 200, 'B: code redemption succeeds on a never-synced file lock');
    const tokenA_code = r.data.sync_token;
    rowA = await cdb.queryOne('SELECT release_code_hash, adopted_via, sync_token_hash, adoption_status FROM meets WHERE id=?', [A.meet.id]);
    c.eq(rowA.adoption_status, 'adopted', 'B: still adopted');
    c.eq(rowA.adopted_via, 'code', 'B: adopted_via flipped to code');
    c.ok(rowA.sync_token_hash !== hashBefore, 'B: token re-minted (file token superseded)');
    c.eq(rowA.release_code_hash, null, 'B: code burned by redemption');
    r = await fetch(`${cloud.base}/api/sync/meets/${A.meet.id}/checksums`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fileA.sync_token}` },
      body: JSON.stringify({ protocol_version: protocol.SYNC_PROTOCOL_VERSION, checksums: {} }),
    });
    c.eq(r.status, 401, 'B: the stale file token is refused (401)');
    // A venue that imports the stale file: first write → worker terminal.
    r = await v2Api.post('/api/venue/import-package', { package: fileA, cloud_url: cloud.base });
    c.eq(r.status, 200, 'B: stale file still imports locally (the venue cannot know yet)');
    await playMogulRun(v2Api, A.event.id, Object.fromEntries(A.judges.map(j => [j.role, j])), A.regs[0].id, 1, 0);
    const revoked = await waitFor(async () => {
      const s = await v2Api.must('GET', '/api/venue/status');
      return s.sync && s.sync.revoked ? s : null;
    });
    c.ok(!!revoked, 'B: the stale-file venue\'s worker stops with the revoked banner (invalid sync token)');
    // Clean venue2 for later sections.
    const v2tok = await controlToken(v2Api);
    await new Api(venue2.base, { token: v2tok }).must('POST', '/api/venue/abandon', {});
    // Close meet A on the cloud with the code token (direct check-in) so it is out of the way.
    const cSumsA = await meetChecksums(cdb, A.meet.id);
    r = await new Api(cloud.base, { token: tokenA_code }).post(`/api/sync/meets/${A.meet.id}/checkin`, { protocol_version: protocol.SYNC_PROTOCOL_VERSION, checksums: cSumsA, mode: 'handback' });
    c.eq(r.status, 200, 'B: (cleanup) code-adopted meet handed back directly');

    // =====================================================================
    // C. Undo a never-synced file lock
    // =====================================================================
    const B = await buildMeet(cApi, { name: 'FileLock B', judges: FULL_JUDGES, athletes: 1, startRun: false });
    await cApi.must('POST', `/api/meets/${B.meet.id}/release-for-adoption`);
    r = await fetchJsonFile(cloud.base, `/api/adoption/${B.meet.id}/export-file`);
    c.eq(r.status, 200, 'C: file lock created');
    r = await cApi.post(`/api/meets/${B.meet.id}/unrelease`);
    c.eq(r.status, 423, 'C: legacy unrelease path is 423 under the mount guard (client uses /api/adoption)');
    r = await cApi.post(`/api/adoption/${B.meet.id}/unrelease`);
    c.eq(r.status, 200, 'C: undo of a never-synced file lock succeeds');
    c.eq(r.data.file_lock_cleared, true, 'C: response says the file lock was cleared');
    const rowB = await cdb.queryOne('SELECT adoption_status, adopted_via, sync_token_hash, release_code_hash FROM meets WHERE id=?', [B.meet.id]);
    c.ok(rowB.adoption_status === null && rowB.adopted_via === null && rowB.sync_token_hash === null && rowB.release_code_hash === null, 'C: status, adopted_via, token, and code all cleared');
    r = await cApi.put(`/api/meets/${B.meet.id}`, { location: 'Editable again' });
    c.eq(r.status, 200, 'C: cloud editable again');
    r = await cApi.post(`/api/adoption/${B.meet.id}/unrelease`);
    c.eq(r.status, 400, 'C: undo with nothing to undo → 400');

    // =====================================================================
    // D. File lock whose venue synced: code / undo / re-issue all refused
    // =====================================================================
    const Cm = await buildMeet(cApi, { name: 'Offline Meet C', judges: FULL_JUDGES, athletes: 3, startRun: false });
    const judgesC = Object.fromEntries(Cm.judges.map(j => [j.role, j]));
    const relC = await cApi.must('POST', `/api/meets/${Cm.meet.id}/release-for-adoption`);
    r = await fetchJsonFile(cloud.base, `/api/adoption/${Cm.meet.id}/export-file`);
    const fileC = r.data;
    r = await vApi.post('/api/venue/import-package', { package: fileC, cloud_url: cloud.base });
    c.eq(r.status, 200, 'D: venue adopts meet C from the backup file');
    await playMogulRun(vApi, Cm.event.id, judgesC, Cm.regs[0].id, 1, 0);
    c.ok(!!(await waitDrained(vApi)), 'D: venue synced its first run under the file token');
    adA = await cApi.must('GET', `/api/meets/${Cm.meet.id}/adoption`);
    c.ok(!!adA.last_sync_at && adA.adopted_via === 'file', 'D: cloud shows last_sync_at with adopted_via=file');
    r = await cApi.post('/api/sync/adopt', { code: relC.code, protocol_version: protocol.SYNC_PROTOCOL_VERSION });
    c.eq(r.status, 409, 'D: code refused once the file venue synced');
    c.ok(/backup adoption file/i.test(r.data.message || ''), 'D: refusal names the backup-file adoption');
    r = await cApi.post(`/api/adoption/${Cm.meet.id}/unrelease`);
    c.eq(r.status, 423, 'D: undo refused once the file venue synced');
    r = await fetchJsonFile(cloud.base, `/api/adoption/${Cm.meet.id}/export-file`, { body: { again: true } });
    c.eq(r.status, 409, 'D: re-issue refused once the file venue synced');
    c.eq(r.data.error, 'already_synced', 'D: … as already_synced');

    // =====================================================================
    // E. Legacy export path + "download again" re-mint
    // =====================================================================
    const D = await buildMeet(cApi, { name: 'FileLock D', judges: FULL_JUDGES, athletes: 1, startRun: false });
    await cApi.must('POST', `/api/meets/${D.meet.id}/release-for-adoption`);
    r = await fetchJsonFile(cloud.base, `/api/meets/${D.meet.id}/export-for-adoption`);
    c.eq(r.status, 200, 'E: legacy export-for-adoption still works');
    const fileD1 = r.data;
    let rowD = await cdb.queryOne('SELECT release_code_hash, adopted_via FROM meets WHERE id=?', [D.meet.id]);
    c.ok(!!rowD.release_code_hash && rowD.adopted_via === 'file', 'E: legacy path also keeps the code + records adopted_via=file');
    r = await fetchJsonFile(cloud.base, `/api/adoption/${D.meet.id}/export-file`, { body: { again: true } });
    c.eq(r.status, 200, 'E: download again re-mints on a never-synced file lock');
    c.eq(r.headers.get('x-stickit-reminted'), '1', 'E: response flags the re-mint');
    const fileD2 = r.data;
    c.ok(fileD2.sync_token !== fileD1.sync_token, 'E: new token in the new file');
    const chk = (tok) => fetch(`${cloud.base}/api/sync/meets/${D.meet.id}/checksums`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ protocol_version: protocol.SYNC_PROTOCOL_VERSION, checksums: {} }),
    });
    c.eq((await chk(fileD1.sync_token)).status, 401, 'E: the earlier file\'s token is dead');
    c.eq((await chk(fileD2.sync_token)).status, 200, 'E: the new file\'s token is live');
    await cApi.must('POST', `/api/adoption/${D.meet.id}/unrelease`);

    // =====================================================================
    // F. Offline return end-to-end (meet C on venue)
    // =====================================================================
    await playMogulRun(vApi, Cm.event.id, judgesC, Cm.regs[1].id, 1, 1);
    await waitDrained(vApi);
    await cloud.stop();
    // Score one more athlete with the cloud down — this only ever reaches the cloud through the file.
    await playMogulRun(vApi, Cm.event.id, judgesC, Cm.regs[2].id, 1, 2);
    let vtok = await controlToken(vApi);
    let vAuthed = new Api(venue.base, { token: vtok });
    r = await vAuthed.post('/api/venue/checkin', { mode: 'checkin' });
    c.eq(r.status, 502, 'F: online check-in refuses with the cloud down');
    c.eq(r.data.reason, 'offline', 'F: … reason offline (client offers "Return via file")');
    let st = await vApi.must('GET', '/api/venue/status');
    c.eq(st.meet_state, 'adopted', 'F: venue reverted to adopted after the failed online attempt');
    r = await vApi.post('/api/venue/return-file', { mode: 'checkin' });
    c.eq(r.status, 403, 'F: return-file needs the Control PIN');
    r = await vAuthed.post('/api/venue/return-file', { mode: 'checkin' });
    c.eq(r.status, 200, 'F: return file written with the cloud down');
    c.ok(r.data.file && r.data.file.bytes > 1000 && /StickIt_Return_Offline_Meet_C_CheckIn\.json/.test(r.data.file.name), 'F: response carries the file name + size');
    c.ok(!!r.data.file.snapshot_copy && fs.existsSync(r.data.file.snapshot_copy), 'F: a copy landed on the STICKITSNAP stick');
    const returnPath = path.join(SERVER_DIR, 'data', 'return', `${Cm.meet.id}.json`);
    c.ok(fs.existsSync(returnPath), 'F: return file stored under server/data/return');
    st = await vApi.must('GET', '/api/venue/status');
    c.eq(st.meet_state, 'checked_in', 'F: venue archived (file export is final — ruling 2)');
    c.ok(st.return_file && st.return_file.available && st.return_file.mode === 'checkin', 'F: /api/venue/status reports the stored return file');
    r = await vApi.post(`/api/events/${Cm.event.id}/runs`, { registration_id: Cm.regs[0].id, run_number: 2 });
    c.eq(r.status, 423, 'F: tablet write after the file export is refused (FR-10)');
    c.eq(parseInt((await vdb.queryOne('SELECT COUNT(*) AS c FROM sync_outbox')).c), 0, 'F: outbox cleared — the file supersedes the queue');
    r = await vAuthed.post('/api/venue/return-file', { mode: 'checkin' });
    c.eq(r.status, 403, 'F: the Control token rotated at final check-in (old token refused)');
    vtok = await controlToken(vApi);
    vAuthed = new Api(venue.base, { token: vtok });
    r = await vAuthed.post('/api/venue/return-file', { mode: 'checkin' });
    c.eq(r.status, 409, 'F: a second return-file call is refused');
    c.eq(r.data.error, 'already_archived', 'F: … as already_archived (download it instead)');
    r = await fetchJsonFile(venue.base, '/api/venue/return-file', { method: 'GET', token: vtok });
    c.eq(r.status, 200, 'F: return file downloads');
    const retC = r.data;
    c.eq(retC.format, 'stickit-return-package', 'F: it is a return package');
    c.eq(retC.mode, 'checkin', 'F: recorded mode = checkin');
    c.eq(retC.meet_id, Cm.meet.id, 'F: names the meet');
    c.ok(protocol.CHECKSUM_TABLES.every(t => Array.isArray(retC.tables[t]) && retC.checksums[t]), 'F: every checksum table + checksum present');
    c.ok(Array.isArray(retC.tables.audit_log) && retC.tables.audit_log.length > 0, 'F: audit_log rides along');
    c.eq(retC.tables.runs.length, 3, 'F: all three runs (incl. the one scored offline) are in the file');
    const vSumsC = await meetChecksums(vdb, Cm.meet.id);
    c.deepEq(retC.checksums, vSumsC, 'F: file checksums equal the venue DB checksums');
    r = await vApi.get('/api/venue/return-status');
    c.eq(r.data.cloud, 'unknown', 'F: return-status: cloud unreachable → unknown');

    await cloud.start();
    const cApi2 = new Api(cloud.base);
    r = await vApi.get('/api/venue/return-status');
    c.eq(r.data.cloud, 'pending', 'F: return-status: cloud reachable, file not imported → pending');
    const cSumsBefore = await meetChecksums(cdb, Cm.meet.id);
    c.ok(cSumsBefore.runs.count === 2, 'F: cloud holds only the 2 synced runs before the import');
    // Refusals — the cloud must be untouched after each.
    r = await cApi2.post(`/api/adoption/${A.meet.id}/import-return`, { package: retC });
    c.eq(r.status, 400, 'F: importing on the wrong meet → 400');
    c.eq(r.data.error, 'wrong_meet', 'F: … wrong_meet');
    const tampered = JSON.parse(JSON.stringify(retC));
    tampered.tables.runs[0].total_score = 99.99;
    r = await cApi2.post(`/api/adoption/${Cm.meet.id}/import-return`, { package: tampered });
    c.eq(r.status, 400, 'F: tampered file → 400');
    c.eq(r.data.error, 'file_corrupt', 'F: … file_corrupt');
    c.deepEq(r.data.tables, ['runs'], 'F: names the bad table');
    r = await cApi2.post(`/api/adoption/${Cm.meet.id}/import-return`, { package: { ...retC, protocol_version: 999 } });
    c.eq(r.status, 409, 'F: protocol mismatch → 409');
    r = await cApi2.post(`/api/adoption/${Cm.meet.id}/import-return`, { package: { ...retC, format: 'stickit-adoption-package' } });
    c.eq(r.status, 400, 'F: an adoption file is not a return file → 400 bad_package');
    r = await cApi2.post(`/api/adoption/${Cm.meet.id}/import-return`, { package: retC, mode: 'sideways' });
    c.eq(r.status, 400, 'F: bad mode override → 400');
    c.deepEq(await meetChecksums(cdb, Cm.meet.id), cSumsBefore, 'F: the refusals wrote nothing');
    // The real import.
    r = await cApi2.post(`/api/adoption/${Cm.meet.id}/import-return`, { package: retC });
    c.eq(r.status, 200, 'F: return file imported on the cloud');
    c.eq(r.data.mode, 'checkin', 'F: applied as check-in');
    c.eq(r.data.recorded_mode, 'checkin', 'F: recorded mode echoed');
    c.eq(r.data.verified_tables, protocol.CHECKSUM_TABLES.length, 'F: every checksum table verified');
    c.eq(r.data.counts.runs, 3, 'F: counts report the 3 runs');
    c.deepEq(await meetChecksums(cdb, Cm.meet.id), vSumsC, 'F: cloud checksums now equal the venue (offline run included)');
    const rowC = await cdb.queryOne('SELECT adoption_status, sync_token_hash, last_sync_at, adopted_via FROM meets WHERE id=?', [Cm.meet.id]);
    c.eq(rowC.adoption_status, 'checked_in', 'F: cloud state checked_in');
    c.eq(rowC.sync_token_hash, null, 'F: token cleared');
    r = await cApi2.put(`/api/meets/${Cm.meet.id}`, { location: 'Home again' });
    c.eq(r.status, 200, 'F: cloud editable after the file check-in');
    const audC = await cdb.queryOne(`SELECT new_value FROM audit_log WHERE action='meet_checked_in' AND entity_id=? ORDER BY timestamp DESC LIMIT 1`, [Cm.meet.id]);
    c.ok(audC && /official_upload/.test(audC.new_value) && /"applied_mode":"checkin"/.test(audC.new_value), 'F: audit row records via=official_upload + applied mode');
    r = await cApi2.post(`/api/adoption/${Cm.meet.id}/import-return`, { package: retC });
    c.eq(r.status, 410, 'F: importing the same file again → 410');
    c.eq(r.data.error, 'already_returned', 'F: … already_returned');
    r = await waitFor(async () => { const x = await vApi.get('/api/venue/return-status'); return x.data.cloud === 'received' ? x : null; }, { timeout: 10000 });
    c.ok(!!r, 'F: return-status flips to received once the cloud has it');
    c.ok(!!(r && r.data.received_at), 'F: received_at persisted');
    r = await vAuthed.post('/api/venue/return-file/send', {});
    c.eq(r.status, 200, 'F: send after the upload is harmless');
    c.eq(r.data.already_received, true, 'F: … reports already received');
    st = await vApi.must('GET', '/api/venue/status');
    c.eq(st.meet_state, 'checked_in', 'F: venue stays checked_in throughout');

    // =====================================================================
    // G. Handback file delivered by the venue itself + mode override on upload
    // =====================================================================
    const E = await buildMeet(cApi2, { name: 'Overnight E', judges: FULL_JUDGES, athletes: 2, startRun: false });
    const judgesE = Object.fromEntries(E.judges.map(j => [j.role, j]));
    const relE = await cApi2.must('POST', `/api/meets/${E.meet.id}/release-for-adoption`);
    r = await v2Api.post('/api/venue/adopt', { code: relE.code, cloud_url: cloud.base });
    c.eq(r.status, 200, 'G: venue2 adopts meet E by code');
    await playMogulRun(v2Api, E.event.id, judgesE, E.regs[0].id, 1, 0);
    await waitDrained(v2Api);
    await cloud.stop();
    await playMogulRun(v2Api, E.event.id, judgesE, E.regs[1].id, 1, 1);
    let v2Authed = new Api(venue2.base, { token: await controlToken(v2Api) });
    r = await v2Authed.post('/api/venue/return-file', { mode: 'handback' });
    c.eq(r.status, 200, 'G: handback return file written offline');
    c.eq(r.data.file.snapshot_copy, null, 'G: no stick on venue2 → no copy, still fine');
    st = await v2Api.must('GET', '/api/venue/status');
    c.eq(st.meet_state, 'handed_back', 'G: venue2 archived as handed_back');
    r = await v2Authed.post('/api/venue/return-file/send', {});
    c.eq(r.status, 502, 'G: send with the cloud down → 502 cloud_unreachable');
    await cloud.start();
    r = await v2Authed.post('/api/venue/return-file/send', {});
    c.eq(r.status, 200, 'G: venue delivers its own return file once the uplink is back (Control token kept on handback)');
    c.eq(r.data.mode, 'handback', 'G: applied as handback');
    const rowE = await cdb.queryOne('SELECT adoption_status, sync_token_hash FROM meets WHERE id=?', [E.meet.id]);
    c.ok(rowE.adoption_status === null && rowE.sync_token_hash === null, 'G: cloud unlocked (handback)');
    c.deepEq(await meetChecksums(cdb, E.meet.id), await meetChecksums(v2db, E.meet.id), 'G: cloud == venue2 after the direct send');
    const audE = await cdb.queryOne(`SELECT new_value FROM audit_log WHERE action='meet_handed_back' AND entity_id=? ORDER BY timestamp DESC LIMIT 1`, [E.meet.id]);
    c.ok(audE && /venue_direct/.test(audE.new_value), 'G: audit row records via=venue_direct');
    r = await v2Api.get('/api/venue/return-status');
    c.eq(r.data.cloud, 'received', 'G: return-status received after the send');
    r = await cApi2.put(`/api/meets/${E.meet.id}`, { location: 'Brackets built overnight' });
    c.eq(r.status, 200, 'G: overnight cloud edit works');
    // Mode override: meet F handback file uploaded as a check-in.
    const F = await buildMeet(cApi2, { name: 'Override F', judges: FULL_JUDGES, athletes: 1, startRun: false });
    const relF = await cApi2.must('POST', `/api/meets/${F.meet.id}/release-for-adoption`);
    await v2Api.must('POST', '/api/venue/adopt', { code: relF.code, cloud_url: cloud.base });
    await playMogulRun(v2Api, F.event.id, Object.fromEntries(F.judges.map(j => [j.role, j])), F.regs[0].id, 1, 0);
    await waitDrained(v2Api);
    v2Authed = new Api(venue2.base, { token: await controlToken(v2Api) });
    r = await v2Authed.post('/api/venue/return-file', { mode: 'handback' });
    c.eq(r.status, 200, 'G: meet F handback file written (cloud up — file path always available)');
    r = await fetchJsonFile(venue2.base, '/api/venue/return-file', { method: 'GET', token: v2Authed.token });
    const retF = r.data;
    c.eq(retF.mode, 'handback', 'G: file records handback');
    r = await cApi2.post(`/api/adoption/${F.meet.id}/import-return`, { package: retF, mode: 'checkin' });
    c.eq(r.status, 200, 'G: upload with mode override succeeds');
    c.eq(r.data.recorded_mode, 'handback', 'G: recorded_mode = handback');
    c.eq(r.data.mode, 'checkin', 'G: applied mode = checkin (ruling 3)');
    c.eq((await cdb.queryOne('SELECT adoption_status FROM meets WHERE id=?', [F.meet.id])).adoption_status, 'checked_in', 'G: cloud state follows the override');
    r = await v2Api.get('/api/venue/return-status');
    c.eq(r.data.cloud, 'received', 'G: venue2 sees checked_in as received even though it expected a handback');

    // =====================================================================
    // H. Stale return file (older adoption) refused before any write
    // =====================================================================
    // Meet C is checked_in on the cloud (H-2: re-exportable). Re-issue a file,
    // adopt on venue2 (replace), then try the OLD return file from venue.
    r = await fetchJsonFile(cloud.base, `/api/adoption/${Cm.meet.id}/export-file`);
    c.eq(r.status, 200, 'H: checked_in meet re-exported (day-2 recovery path)');
    r = await v2Api.post('/api/venue/import-package', { package: r.data, cloud_url: cloud.base });
    c.eq(r.status, 200, 'H: venue2 adopts the re-issued meet C');
    const cSumsH = await meetChecksums(cdb, Cm.meet.id);
    r = await cApi2.post(`/api/adoption/${Cm.meet.id}/import-return`, { package: retC });
    c.eq(r.status, 401, 'H: the old return file is refused');
    c.eq(r.data.error, 'stale_return_file', 'H: … as stale_return_file');
    c.deepEq(await meetChecksums(cdb, Cm.meet.id), cSumsH, 'H: nothing written');
    c.eq((await cdb.queryOne('SELECT adoption_status FROM meets WHERE id=?', [Cm.meet.id])).adoption_status, 'adopted', 'H: cloud stays adopted by venue2');
    // Venue1 (checked_in) still shows its file as received — the meet moved on.
    r = await vApi.get('/api/venue/return-status');
    c.eq(r.data.cloud, 'received', 'H: venue1 keeps reporting received (cloud adopted again AFTER its export)');
    v2Authed = new Api(venue2.base, { token: await controlToken(v2Api) });
    await v2Authed.must('POST', '/api/venue/abandon', {});
    await cApi2.must('POST', `/api/adoption/${Cm.meet.id}/unrelease`);

    // =====================================================================
    // I. Force-unlock while a return file is pending
    // =====================================================================
    const G = await buildMeet(cApi2, { name: 'Lost G', judges: FULL_JUDGES, athletes: 1, startRun: false });
    const relG = await cApi2.must('POST', `/api/meets/${G.meet.id}/release-for-adoption`);
    await v2Api.must('POST', '/api/venue/adopt', { code: relG.code, cloud_url: cloud.base });
    await playMogulRun(v2Api, G.event.id, Object.fromEntries(G.judges.map(j => [j.role, j])), G.regs[0].id, 1, 0);
    await waitDrained(v2Api);
    v2Authed = new Api(venue2.base, { token: await controlToken(v2Api) });
    r = await v2Authed.post('/api/venue/return-file', { mode: 'checkin' });
    c.eq(r.status, 200, 'I: return file written');
    r = await fetchJsonFile(venue2.base, '/api/venue/return-file', { method: 'GET', token: (await controlToken(v2Api)) });
    const retG = r.data;
    r = await cApi2.post(`/api/admin/adoption/${G.meet.id}/force-unlock`, { confirm_name: G.meet.name });
    c.eq(r.status, 200, 'I: admin force-unlocks the meet');
    c.eq((await cdb.queryOne('SELECT adopted_via FROM meets WHERE id=?', [G.meet.id])).adopted_via, null, 'I: force-unlock clears adopted_via');
    r = await cApi2.post(`/api/adoption/${G.meet.id}/import-return`, { package: retG });
    c.eq(r.status, 409, 'I: upload after force-unlock refused');
    c.eq(r.data.error, 'not_adopted', 'I: … not_adopted');
    v2Authed = new Api(venue2.base, { token: await controlToken(v2Api) });
    r = await v2Authed.post('/api/venue/return-file/send', {});
    c.eq(r.status, 409, 'I: venue send after force-unlock refused');
    r = await v2Api.get('/api/venue/return-status');
    c.eq(r.data.cloud, 'unlocked', 'I: return-status reports the cloud as unlocked');
    c.ok(fs.existsSync(path.join(SERVER_DIR, 'data', 'return', `${G.meet.id}.json`)), 'I: the venue\'s return file is still there (never auto-deleted)');

    // =====================================================================
    // J/K. Playwright (built bundle)
    // =====================================================================
    if (process.env.V250_SKIP_UI !== '1') {
      const tab = await newTablet();
      // 127.0.0.1 is a secure context, so headless Chromium would open the
      // native File System Access save dialog and hang. Real venues are http
      // (plain download) and real officials get the picker on https; here we
      // force the plain-download branch of saveFile().
      await tab.context.addInitScript(() => {
        try { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }); } catch (_) {}
      });
      try {
        // J. Cloud meet page: release dialog + import item while adopted.
        const H = await buildMeet(cApi2, { name: 'UI Meet H', judges: FULL_JUDGES, athletes: 1, startRun: false });
        const page = await tab.newPage();
        await page.goto(`${cloud.base}/dashboard/meets/${H.meet.id}`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: 'More ▾' }).click();
        await page.getByRole('button', { name: /Release for Adoption/ }).click();
        const cb = page.getByTestId('release-backup-file');
        await cb.waitFor({ timeout: 10000 });
        c.eq(await cb.isChecked(), true, 'J: release dialog offers the backup file, ticked by default');
        await page.getByTestId('release-confirm').click();
        await page.getByText(/Release Code/).first().waitFor({ timeout: 10000 });
        const locked = await waitFor(async () => (await cApi2.get(`/api/meets/${H.meet.id}/adoption`)).data.adopted ? true : null, { timeout: 10000 });
        c.ok(!!locked, 'J: confirming the dialog locked the meet (file created)');
        await page.getByTestId('release-file-note').waitFor({ timeout: 10000 });
        c.ok(true, 'J: code modal notes the backup file was saved');
        await page.getByRole('button', { name: /Done/ }).click();
        await page.getByTestId('adoption-banner-file').waitFor({ timeout: 10000 });
        c.ok(true, 'J: amber "waiting for the venue" banner shown for a file lock');
        await page.getByRole('button', { name: 'More ▾' }).click();
        // (.last(): the amber banner carries the same two actions as links.)
        c.ok(await page.getByRole('button', { name: /Import venue return file/ }).last().isVisible(), 'J: More menu offers the return-file import while adopted');
        c.ok(await page.getByRole('button', { name: /Download adoption file again/ }).last().isVisible(), 'J: More menu offers "Download adoption file again" on a never-synced file lock');
        await page.close();

        // K. Venue home (venue is checked_in with a stored file).
        const vp = await tab.newPage();
        await vp.goto(`${venue.base}/?menu=1`, { waitUntil: 'domcontentloaded' });
        await vp.getByTestId('return-file-card').waitFor({ timeout: 10000 });
        c.ok(await vp.getByRole('button', { name: /Download return file/ }).isVisible(), 'K: archived venue home offers the return-file download');
        await vp.getByText(/Received by/).waitFor({ timeout: 10000 });
        c.ok(true, 'K: cloud line shows received');
        await vp.close();
        // Offline dialog: venue2 holds meet G (checked_in) — adopt a fresh meet on it, stop the cloud, try Check In.
        const K = await buildMeet(cApi2, { name: 'UI Meet K', judges: FULL_JUDGES, athletes: 1, startRun: false });
        const relK = await cApi2.must('POST', `/api/meets/${K.meet.id}/release-for-adoption`);
        await v2Api.must('POST', '/api/venue/adopt', { code: relK.code, cloud_url: cloud.base });
        await cloud.stop();
        const kp = await tab.newPage();
        kp.on('dialog', async d => { await d.accept(); });
        await kp.goto(`${venue2.base}/?menu=1`, { waitUntil: 'domcontentloaded' });
        await kp.getByRole('button', { name: /Check In Meet/ }).click();
        await kp.getByTestId('venue-pin').fill('2468');
        await kp.getByRole('button', { name: 'OK' }).click();
        await kp.getByTestId('return-file-offer').waitFor({ timeout: 20000 });
        c.ok(true, 'K: offline check-in offers "Return via file instead"');
        await kp.getByTestId('return-file-offer').click();
        await kp.getByTestId('return-file-card').waitFor({ timeout: 20000 });
        c.ok(true, 'K: return file written from the offer; archived card shown');
        st = await v2Api.must('GET', '/api/venue/status');
        c.eq(st.meet_state, 'checked_in', 'K: venue2 archived by the UI flow');
        await kp.close();
        await cloud.start();
      } finally {
        await tab.close().catch(() => {});
      }
    }

    cdb.close(); vdb.close(); v2db.close();
  } finally {
    await cloud.stop().catch(() => {});
    await venue.stop().catch(() => {});
    await venue2.stop().catch(() => {});
    // The scratch venues share the repo's server/data/return directory.
    try { fs.rmSync(path.join(SERVER_DIR, 'data', 'return'), { recursive: true, force: true }); } catch (_) {}
  }
  return c;
}

module.exports = { main };
