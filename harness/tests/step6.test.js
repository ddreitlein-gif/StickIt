/**
 * Step 6 acceptance tests — packaging + docs.
 *
 *   A. Pi image build assets: shell scripts parse (bash -n), systemd unit
 *      carries the venue env, avahi record, fstab snapshot mount, sudoers
 *      hook, Imager os_list JSON valid.
 *   B. Printed venue material: generator runs idempotently; all 8 PDFs exist,
 *      are real PDFs, and are served by BOTH the venue server and the cloud
 *      under /docs/venue/.
 *   C. Update flow: update-check (against a faked release feed) reports
 *      current/latest/update_available; /update refuses while a meet is
 *      adopted; runs the configured script otherwise (marker file).
 *   D. Ops docs exist (Mac fallback R9, rollback note Section 10).
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const { Checks } = require('../lib/checks');
const { Instance, scratchDir, SERVER_DIR, REPO_ROOT } = require('../lib/instance');
const { Api } = require('../lib/client');
const { buildMeet } = require('../lib/fixtures');

const IMG_DIR = path.join(SERVER_DIR, 'scripts', 'build_pi_image');
const VENUE_DOCS = path.join(SERVER_DIR, 'public', 'docs', 'venue');

async function main() {
  const c = new Checks('step6');

  // ---- A. Pi image build assets ----------------------------------------
  for (const f of ['build.sh', 'provision.sh', 'update-stickit.sh']) {
    try {
      execFileSync('bash', ['-n', path.join(IMG_DIR, f)]);
      c.ok(true, `${f} parses (bash -n)`);
    } catch (e) {
      c.ok(false, `${f} parses (bash -n): ${e.message}`);
    }
  }
  const unit = fs.readFileSync(path.join(IMG_DIR, 'stickit-venue.service'), 'utf8');
  c.ok(/STICKIT_MODE=venue/.test(unit), 'systemd unit sets STICKIT_MODE=venue');
  c.ok(/Restart=always/.test(unit), 'systemd unit auto-restarts (power-pull safe)');
  c.ok(/STICKIT_SNAPSHOT_DIR=\/media\/stickit-snapshot/.test(unit), 'systemd unit points at the snapshot mount (R11)');
  const prov = fs.readFileSync(path.join(IMG_DIR, 'provision.sh'), 'utf8');
  c.ok(/avahi/.test(prov) && /fake-hwclock/.test(prov) && /timesyncd/.test(prov), 'provisioning covers mDNS + NTP + fake-hwclock (D3, FR-17)');
  c.ok(/LABEL=STICKITSNAP /.test(prov) && !/STICKIT-SNAP /.test(prov), 'provisioning auto-mounts the STICKITSNAP stick (11-char ExFAT label, F-1)');
  c.ok(/uid=1000,gid=1000/.test(prov), 'snapshot mount owned by the stickit service user (F-2)');
  c.ok(/sudoers\.d/.test(prov), 'provisioning allows the Update button to run the update script');
  const osList = JSON.parse(fs.readFileSync(path.join(IMG_DIR, 'os_list_stickit.json'), 'utf8'));
  c.ok(Array.isArray(osList.os_list) && osList.os_list[0].url.includes('github.com'), 'Imager os_list catalog valid (GitHub Releases asset URL)');
  c.ok(fs.readFileSync(path.join(IMG_DIR, 'README.md'), 'utf8').includes('pi-gen'), 'image build documented');

  // ---- B. Printed venue material ---------------------------------------
  execFileSync('node', [path.join(SERVER_DIR, 'scripts', 'venue_cards', 'build_venue_docs.js')]);
  await new Promise(r => setTimeout(r, 800)); // pdf streams settle
  const expected = [
    'venue_card.pdf', 'runsheet_kit_setup.pdf', 'runsheet_adoption.pdf',
    'runsheet_tablets.pdf', 'runsheet_livestream.pdf', 'runsheet_end_of_day.pdf',
    'preevent_checklist.pdf', 'runsheet_mac_fallback.pdf',
  ];
  for (const f of expected) {
    const p = path.join(VENUE_DOCS, f);
    const ok = fs.existsSync(p) && fs.statSync(p).size > 1500 &&
      fs.readFileSync(p).slice(0, 5).toString() === '%PDF-';
    c.ok(ok, `venue doc generated: ${f}`);
  }

  // ---- C+B2. Live servers: docs served; update flow ---------------------
  // Fake GitHub release feed for the update check.
  const fake = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ tag_name: 'v9.9.99' }));
  });
  await new Promise(r => fake.listen(3199, r));
  const marker = path.join(scratchDir('step6'), 'update-ran.marker');
  const fakeScript = path.join(scratchDir('step6'), 'fake-update.sh');
  // The harness Bash sandbox blocks shell-level file writes; write the marker
  // through node instead (real update scripts do far more than this anyway).
  // v2.5.01: the real script reports progress in <script dir>/data/update-status.json;
  // the fake one writes a "done" result the same way so /update-status is covered.
  const statusFile = path.join(scratchDir('step6'), 'data', 'update-status.json');
  fs.writeFileSync(fakeScript, `#!/bin/bash\nnode -e "require('fs').writeFileSync('${marker}', 'ran'); require('fs').mkdirSync('${path.dirname(statusFile)}', {recursive:true}); require('fs').writeFileSync('${statusFile}', JSON.stringify({state:'done',step:'done',message:'Updated to v9.9.99',tag:'v9.9.99',at:new Date().toISOString()}))"\n`);
  fs.chmodSync(fakeScript, 0o755);

  const cloud = new Instance({ name: 'step6-cloud', port: 3181, mode: 'cloud' });
  const venue = new Instance({
    name: 'step6-venue', port: 3182, mode: 'venue',
    env: {
      STICKIT_UPDATE_URL: 'http://127.0.0.1:3199/fake-release',
      STICKIT_UPDATE_SCRIPT: fakeScript,
      STICKIT_UPDATE_SUDO: '0',
    },
  });

  try {
    await cloud.start();
    await venue.start();
    const cApi = new Api(cloud.base);
    const vApi = new Api(venue.base);

    // Docs served from both servers
    for (const base of [venue.base, cloud.base]) {
      const r = await fetch(`${base}/docs/venue/runsheet_adoption.pdf`);
      c.ok(r.ok && (r.headers.get('content-type') || '').includes('pdf'), `run sheets served by ${base === venue.base ? 'the venue server' : 'the cloud'}`);
    }

    // Update check against the fake feed
    let r = await vApi.get('/api/venue/update-check');
    c.eq(r.data.latest, 'v9.9.99', 'update-check reads the latest release');
    c.eq(r.data.update_available, true, 'update available detected');
    c.ok(!!r.data.current, `current version reported (${r.data.current})`);

    // /update refuses while a meet is adopted
    const A = await buildMeet(cApi, { name: 'Update Meet', athletes: 1, judges: [], startRun: false });
    const rel = await cApi.must('POST', `/api/meets/${A.meet.id}/release-for-adoption`);
    await vApi.must('POST', '/api/venue/adopt', { code: rel.code, cloud_url: cloud.base });
    r = await vApi.post('/api/venue/update', {});
    c.eq(r.status, 409, 'update refused while a meet is adopted');
    r = await vApi.get('/api/venue/update-status');
    c.eq(r.data.state, 'idle', 'v2.5.01: update-status idle before any run');
    // Hand the meet back, then update runs the script — with NO Control PIN
    // (v2.5.01, David's ruling 09-06-26) even though PINs are set.
    await vApi.must('POST', '/api/venue/checkin', { mode: 'checkin' });
    await vApi.must('POST', '/api/venue/pins', { control_pin: '1111', crew_pin: '2222' });
    r = await vApi.post('/api/venue/update', {});
    c.eq(r.status, 200, 'v2.5.01: update accepted with no meet adopted and NO Control PIN');
    const ran = await new Promise(res => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (fs.existsSync(marker)) { clearInterval(iv); res(true); }
        else if (Date.now() - t0 > 5000) { clearInterval(iv); res(false); }
      }, 100);
    });
    c.ok(ran, 'update script executed (marker file written)');
    await new Promise(r => setTimeout(r, 300));
    r = await vApi.get('/api/venue/update-status');
    c.eq(r.data.state, 'done', `v2.5.01: update-status reports the script's result (${JSON.stringify(r.data)})`);
    c.eq(r.data.tag, 'v9.9.99', 'v2.5.01: update-status carries the tag');
    c.ok(!!r.data.current, 'v2.5.01: update-status carries the running version');
  } finally {
    fake.close();
    await cloud.stop().catch(() => {});
    await venue.stop().catch(() => {});
  }

  // ---- D. Ops docs ------------------------------------------------------
  c.ok(fs.readFileSync(path.join(REPO_ROOT, 'docs', 'VENUE_MAC_FALLBACK.md'), 'utf8').includes('STICKIT_MODE=venue'), 'Mac fallback document (R9) present');
  const ops = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'VENUE_OPS.md'), 'utf8');
  c.ok(ops.includes('v1.30.03') && /mid-adoption/i.test(ops), 'ops rollback note covers the mid-adoption case (Section 10)');

  return c;
}

module.exports = { main };
