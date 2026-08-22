/**
 * Step 2 acceptance tests — adoption package + ID-preserving import.
 *
 *   A. Full adopt cycle cloud→venue through the real endpoints (release code
 *      → POST /api/venue/adopt → package import), with the cloud locked and
 *      the code burned.
 *   B. Byte-for-byte verification: per-table protocol checksums identical on
 *      both sides for every snapshot table (IDs, short codes, timestamps
 *      preserved) + logo file round-trip.
 *   C. Version-handshake refusals in both directions; expired code; already
 *      hosting; double redemption.
 *   D. Re-adoption "replace local copy" (D8): meet_exists refusal without the
 *      flag, full replacement with it (local divergence discarded).
 *   E. USB plan B: Export for Adoption (lock at export) → import-package on a
 *      fresh venue instance → checksums match.
 */

const fs = require('fs');
const path = require('path');
const { Checks } = require('../lib/checks');
const { Instance, SERVER_DIR } = require('../lib/instance');
const { Api } = require('../lib/client');
const { openDb } = require('../lib/db');
const { buildMeet } = require('../lib/fixtures');

const protocol = require(path.join(SERVER_DIR, 'sync', 'protocol.js'));
const LOGO_DIR = path.join(SERVER_DIR, 'data', 'logos');

async function checksums(db, meetId, tables) {
  const out = {};
  for (const t of tables) {
    const rows = await db.queryAll(protocol.selectForMeet(t), [meetId]);
    out[t] = protocol.tableChecksum(t, rows.map(r => protocol.manifestRow(t, r)));
  }
  return out;
}

async function main() {
  const c = new Checks('step2');
  const cloud = new Instance({ name: 'step2-cloud', port: 3121, mode: 'cloud' });
  const venue = new Instance({ name: 'step2-venue', port: 3122, mode: 'venue' });
  const venue2 = new Instance({ name: 'step2-venue2', port: 3123, mode: 'venue' });
  const logoFiles = [];

  try {
    await cloud.start();
    await venue.start();
    const cApi = new Api(cloud.base);
    const vApi = new Api(venue.base);
    const cdb = openDb(cloud.dbPath);

    // ---- Fixture: a meet with data in many snapshot tables ---------------
    const A = await buildMeet(cApi, {
      name: 'Package Meet', judges: ['TL1', 'TL2', 'TL3', 'Air1', 'Air2', 'HJ'], athletes: 4,
    });
    // Judge scores on the started run (turns + air)
    await cApi.must('POST', `/api/events/${A.event.id}/runs/${A.run.id}/scores`, {
      judge_id: A.judges[0].id, score_type: 'turns', raw_score: 14.2, carving: 7.1, abext: 4.0, upper_body: 3.1, deduction: 0,
    });
    await cApi.must('POST', `/api/events/${A.event.id}/runs/${A.run.id}/scores`, {
      judge_id: A.judges[3].id, score_type: 'air_jump1', raw_score: 6.5,
    });
    // Officials + course spec + training-day exclusion
    await cApi.must('POST', `/api/meets/${A.meet.id}/officials`, { role: 'Technical Delegate', name: 'Mary Jo Smith', ussa_id: '1234567' });
    await cApi.must('POST', `/api/meets/${A.meet.id}/course-specs`, { course_name: 'Main', length_m: 250, pitch_deg: 26, pace_standard: 'usss' });
    await cApi.must('POST', `/api/training-days/${A.trainingDay.id}/exclusions`, { athlete_id: A.athletes[0].id, exclude: true });
    // USSS people snapshot rows (R5) — master data, inserted directly
    await cdb.execute(`INSERT INTO usss_people (ussa_id, type, last_name, first_name, division, gender, yob, club_name, mo_points) VALUES
      ('7100001','C','Snow','Jane','RM','F',2010,'Harness FC', 55.5),
      ('7100002','C','Frost','Jack','RM','M',2009,'Harness FC', 44.25)`);
    // Meet logo file
    const logoPath = path.join(LOGO_DIR, `meet_${A.meet.id}.png`);
    fs.mkdirSync(LOGO_DIR, { recursive: true });
    fs.writeFileSync(logoPath, Buffer.from('89504e470d0a1a0a-harness-fake-png', 'utf8'));
    logoFiles.push(logoPath);

    // ---- C1. protocol mismatch straight at the cloud ---------------------
    let r = await cApi.post('/api/sync/adopt', { code: 'WHATEVER', protocol_version: 999 });
    c.eq(r.status, 409, 'cloud adopt refuses protocol mismatch');
    c.eq(r.data.error, 'protocol_mismatch', 'mismatch error is named');

    // ---- A. Release + venue adopt ---------------------------------------
    r = await cApi.post(`/api/meets/${A.meet.id}/release-for-adoption`);
    const code = r.data.code;
    c.ok(!!code, 'meet released, code issued');

    r = await vApi.post('/api/venue/adopt', { code: 'WRONGCOD', cloud_url: cloud.base });
    c.eq(r.status, 404, 'wrong code refused');

    r = await vApi.post('/api/venue/adopt', { code, cloud_url: cloud.base });
    c.eq(r.status, 200, `venue adopt succeeds (${JSON.stringify(r.data).slice(0, 120)})`);
    c.eq(r.data.meet && r.data.meet.id, A.meet.id, 'adopted meet id preserved');
    c.ok(r.data.logo === true, 'logo imported');

    // Cloud locked + code burned
    r = await cApi.put(`/api/meets/${A.meet.id}`, { location: 'Nope' });
    c.eq(r.status, 423, 'cloud is locked after adoption');
    r = await cApi.post('/api/sync/adopt', { code, protocol_version: protocol.SYNC_PROTOCOL_VERSION });
    c.eq(r.status, 404, 'release code is burned after redemption');

    // Venue status reflects the adoption
    r = await vApi.get('/api/venue/status');
    c.eq(r.data.mode, 'venue', 'venue status mode');
    c.eq(r.data.adopted_meet && r.data.adopted_meet.id, A.meet.id, 'venue status names the adopted meet');
    c.eq(r.data.meet_state, 'adopted', 'venue meet_state is adopted');

    // ---- B. Byte-for-byte parity ----------------------------------------
    const vdb = openDb(venue.dbPath);
    const cloudSums = await checksums(cdb, A.meet.id, protocol.SNAPSHOT_TABLES);
    const venueSums = await checksums(vdb, A.meet.id, protocol.SNAPSHOT_TABLES);
    for (const t of protocol.SNAPSHOT_TABLES) {
      c.deepEq(venueSums[t], cloudSums[t], `checksum parity after adoption: ${t} (${cloudSums[t].count} rows)`);
    }
    // Spot-check literal preservation: short code + created_at of the meet
    const cMeet = await cdb.queryOne('SELECT short_code, created_at FROM meets WHERE id=?', [A.meet.id]);
    const vMeet = await vdb.queryOne('SELECT short_code, created_at, adoption_status FROM meets WHERE id=?', [A.meet.id]);
    c.eq(vMeet.short_code, cMeet.short_code, 'short_code preserved byte-for-byte');
    c.eq(vMeet.created_at, cMeet.created_at, 'created_at preserved byte-for-byte');
    c.eq(vMeet.adoption_status, null, 'venue local meets row carries NO cloud lock state');
    const logoBytes = fs.readFileSync(logoPath);
    c.ok(logoBytes.length > 0, 'logo file present after import (shared dir — same path)');

    // Venue is the authority: scoring works locally
    r = await vApi.post(`/api/events/${A.event.id}/runs/${A.run.id}/scores`, {
      judge_id: A.judges[1].id, score_type: 'turns', raw_score: 13.0,
    });
    c.eq(r.status, 200, 'venue accepts judge scores (it is the sole authority)');

    // ---- C2. already hosting --------------------------------------------
    r = await vApi.post('/api/venue/adopt', { code: 'ANYTHING', cloud_url: cloud.base });
    c.eq(r.status, 409, 'venue refuses adopting a second meet while hosting');
    c.eq(r.data.error, 'already_hosting', 'already_hosting error named');

    // ---- D. Replace local copy (re-adoption, D8) ------------------------
    // Simulate the overnight cycle ending: mark the venue copy handed back,
    // force-unlock + re-release on the cloud (Step 5 wires the real handback).
    await vdb.execute(`UPDATE app_settings SET value='handed_back' WHERE key='venue_meet_state'`);
    r = await cApi.post(`/api/admin/adoption/${A.meet.id}/force-unlock`, { confirm_name: 'Package Meet' });
    c.eq(r.status, 200, 'cloud force-unlocked for re-release (stand-in for handback)');
    // Cloud-side overnight edit the venue does NOT have:
    await cApi.must('PUT', `/api/meets/${A.meet.id}`, { location: 'Overnight Updated' });
    // Venue-side local divergence that must be discarded by replace:
    await vdb.execute(`UPDATE meets SET location='Stale Venue Edit' WHERE id=?`, [A.meet.id]);

    r = await cApi.post(`/api/meets/${A.meet.id}/release-for-adoption`);
    const code2 = r.data.code;
    c.ok(!!code2, 're-released with a new code');

    r = await vApi.post('/api/venue/adopt', { code: code2, cloud_url: cloud.base });
    c.eq(r.status, 409, 're-adopt without replace refuses (meet_exists)');
    c.eq(r.data.error, 'meet_exists', 'meet_exists error named');
    c.eq(r.data.offer_replace, true, 'response offers the one-tap replace');
    // The refusal happened via peek BEFORE redemption — the one-time code is
    // NOT burned and the cloud is NOT locked yet.
    r = await cApi.get(`/api/meets/${A.meet.id}/adoption`);
    c.eq(r.data.adopted, false, 'meet_exists refusal did not burn the code or lock the cloud');
    c.eq(r.data.released, true, 'meet still shows released');

    r = await vApi.post('/api/venue/adopt', { code: code2, cloud_url: cloud.base, replace: true });
    c.eq(r.status, 200, 're-adopt with replace succeeds');
    const vMeet2 = await vdb.queryOne('SELECT location FROM meets WHERE id=?', [A.meet.id]);
    c.eq(vMeet2.location, 'Overnight Updated', 'replace discarded local divergence and took the cloud version');
    const cloudSums2 = await checksums(cdb, A.meet.id, protocol.CHECKSUM_TABLES);
    const venueSums2 = await checksums(vdb, A.meet.id, protocol.CHECKSUM_TABLES);
    c.deepEq(venueSums2, cloudSums2, 'full checksum parity after replace re-adoption');

    // ---- C3. expired code ------------------------------------------------
    const B = await buildMeet(cApi, { name: 'Expired Meet', startRun: false });
    r = await cApi.post(`/api/meets/${B.meet.id}/release-for-adoption`);
    const codeB = r.data.code;
    await cdb.execute(`UPDATE meets SET release_code_expires_at='2020-01-01T00:00:00.000Z' WHERE id=?`, [B.meet.id]);
    r = await cApi.post('/api/sync/adopt', { code: codeB, protocol_version: protocol.SYNC_PROTOCOL_VERSION });
    c.eq(r.status, 404, 'expired code refused');
    c.eq(r.data.error, 'code_expired', 'expiry error named');

    // ---- E. USB plan B ---------------------------------------------------
    await venue2.start();
    const v2Api = new Api(venue2.base);
    const C = await buildMeet(cApi, { name: 'USB Meet', athletes: 2 });
    r = await cApi.post(`/api/meets/${C.meet.id}/export-for-adoption`);
    c.eq(r.status, 200, 'Export for Adoption succeeds');
    const usbPkg = r.data; // JSON body (package + sync_token)
    c.ok(!!usbPkg.sync_token, 'USB export carries the sync token');
    c.eq(usbPkg.format, 'stickit-adoption-package', 'USB export is an adoption package');
    // Lock was set atomically at export time:
    r = await cApi.put(`/api/meets/${C.meet.id}`, { location: 'Nope' });
    c.eq(r.status, 423, 'cloud locked at export time (no lock-later window)');

    // Bad protocol version refused on import
    r = await v2Api.post('/api/venue/import-package', { package: { ...usbPkg, protocol_version: 999 } });
    c.eq(r.status, 409, 'venue import refuses protocol mismatch');

    r = await v2Api.post('/api/venue/import-package', { package: usbPkg });
    c.eq(r.status, 200, 'USB package imports on a fresh venue server');
    const v2db = openDb(venue2.dbPath);
    const cSumsC = await checksums(cdb, C.meet.id, protocol.CHECKSUM_TABLES);
    const vSumsC = await checksums(v2db, C.meet.id, protocol.CHECKSUM_TABLES);
    c.deepEq(vSumsC, cSumsC, 'checksum parity after USB import');
    r = await v2Api.get('/api/venue/status');
    c.eq(r.data.adopted_meet && r.data.adopted_meet.id, C.meet.id, 'venue2 status shows the USB-adopted meet');
    v2db.close();

    vdb.close();
    cdb.close();
  } finally {
    for (const f of logoFiles) { try { fs.unlinkSync(f); } catch (_) {} }
    await cloud.stop().catch(() => {});
    await venue.stop().catch(() => {});
    await venue2.stop().catch(() => {});
  }

  return c;
}

module.exports = { main };
