/**
 * Step 1 acceptance tests — remote judging flag + cloud lock machinery.
 *
 *   A. Release-for-adoption lifecycle (R13): code generation, hash-only
 *      storage, re-release, undo, remote-judging refusal.
 *   B. FR-20 GENERATED lock-coverage gate: enumerate every mutation route in
 *      the running app; every route is either meet-scoped (must 423 against an
 *      adopted meet) or on the documented exemption list; an unclassified
 *      route fails the suite.
 *   C. Targeted lock checks incl. public tablet endpoints, and a control meet
 *      proving the guard is inert when not adopted.
 *   D. FR-8 athlete locking (direct edit, usss-sync skip, admin bulk delete,
 *      import guard).
 *   E. Force-unlock (R8): typed-name confirmation, audit row, token cleared.
 *   F. FR-9 boot-time mutation guards: restart never touches adopted rows.
 *
 * NOTE: adoption is set by direct DB update here — the redemption endpoint is
 * a Step 2 deliverable; Step 1's contract is the lock machinery itself.
 */

const path = require('path');
const crypto = require('crypto');
const { Checks } = require('../lib/checks');
const { Instance, SERVER_DIR } = require('../lib/instance');
const { Api } = require('../lib/client');
const { openDb } = require('../lib/db');
const { buildMeet } = require('../lib/fixtures');

const PORT = 3111;

// FR-20 classification -------------------------------------------------------

// Meet-scoped prefixes: any mutation under these is guarded by the adoption
// lock middleware and must return 423 for an adopted meet.
const IN_SCOPE_PREFIXES = [
  '/api/meets/:',
  '/api/events/:',
  '/api/admin/meets/:',
  '/api/admin/events/:',
  '/api/training-days/:',
];

// Documented exemptions: mutation routes that are NOT meet-data mutations, or
// whose adoption handling is in-route (tested separately below). A mutation
// route matching none of these and no in-scope prefix FAILS the gate.
const EXEMPT_PREFIXES = [
  '/api/auth/',              // login/session — not meet data
  '/api/admin/users',        // user accounts
  '/api/admin/auth-settings',
  '/api/admin/backups',      // server backups
  '/api/admin/adoption/',    // force-unlock itself (R8)
  '/api/admin/athletes/',    // bulk athlete ops — FR-8 in-filter exclusion (tested below)
  '/api/pdf/',               // POST-but-read-only PDF generators
  '/api/print/',
  '/api/export/',            // exports + USSS transmit — read-only generators
  '/api/import/athletes',    // FR-8 in-route guard (tested below)
  '/api/usss/',              // USSS people master (global, never synced back)
  '/api/athletes',           // POST create + from-usss/reconcile/usss-sync — global
                             // master ops with FR-8 in-route guards (tested below);
                             // PUT /api/athletes/:id is guarded by mount and
                             // asserted in section D.
  '/api/meets',              // POST create (new meet) + POST /api/meets/import
                             // (conflict-target guard tested below)
  '/api/sync/',              // sync apply endpoints (Step 2+) — carry the venue's
                             // changes; authenticated by sync token
  '/api/venue/',             // venue-mode endpoints (Step 3+)
];

function classifyRoute(route) {
  const p = route.path;
  if (IN_SCOPE_PREFIXES.some(pre => p.startsWith(pre))) return 'in-scope';
  if (EXEMPT_PREFIXES.some(pre => p === pre.replace(/\/$/, '') || p.startsWith(pre))) return 'exempt';
  return 'unclassified';
}

function substituteParams(p, ctx) {
  return p.split('/').map(seg => {
    if (!seg.startsWith(':')) return seg;
    const name = seg.slice(1);
    if (ctx[name]) return ctx[name];
    return 'harness-dummy';
  }).join('/');
}

async function main() {
  const c = new Checks('step1');
  const cloud = new Instance({
    name: 'step1-cloud', port: PORT, mode: 'cloud',
    env: { STICKIT_DEBUG_ROUTES: '1' },
  });

  try {
    await cloud.start();
    const api = new Api(cloud.base);
    const db = openDb(cloud.dbPath);

    // Fixtures: meet A (to be adopted) and meet B (control).
    const A = await buildMeet(api, { name: 'Adopted Meet', judges: ['TL1', 'Air1', 'HJ'] });
    const B = await buildMeet(api, { name: 'Control Meet' });

    // ---- A. Release lifecycle ------------------------------------------
    // Remote-judging meet cannot be released (6.7)
    await api.must('PUT', `/api/meets/${A.meet.id}`, { remote_judging: 1 });
    let r = await api.post(`/api/meets/${A.meet.id}/release-for-adoption`);
    c.eq(r.status, 409, 'remote-judging meet refuses release (409)');
    c.eq(r.data.error, 'remote_judging_meet', 'refusal names remote_judging_meet');
    let ad = (await api.get(`/api/meets/${A.meet.id}/adoption`)).data;
    c.eq(ad.remote_judging, true, 'adoption state reports remote_judging');
    await api.must('PUT', `/api/meets/${A.meet.id}`, { remote_judging: 0 });

    r = await api.post(`/api/meets/${A.meet.id}/release-for-adoption`);
    c.eq(r.status, 200, 'release-for-adoption succeeds');
    const code1 = r.data.code;
    c.ok(/^[A-HJ-NP-Z2-9]{8}$/.test(code1 || ''), `release code is 8 chars from the unambiguous alphabet (${code1})`);
    let meetRow = await db.queryOne('SELECT * FROM meets WHERE id=?', [A.meet.id]);
    c.eq(meetRow.release_code_hash, crypto.createHash('sha256').update(code1).digest('hex'), 'only the code hash is stored');
    c.ok(!!meetRow.release_code_expires_at, 'expiry stored');
    ad = (await api.get(`/api/meets/${A.meet.id}/adoption`)).data;
    c.eq(ad.released, true, 'adoption state shows released');
    c.eq(ad.adopted, false, 'not yet adopted');

    // Re-release replaces the code
    r = await api.post(`/api/meets/${A.meet.id}/release-for-adoption`);
    const code2 = r.data.code;
    c.ok(code2 && code2 !== code1, 're-release generates a new code');

    // Undo release
    r = await api.post(`/api/meets/${A.meet.id}/unrelease`);
    c.eq(r.status, 200, 'unrelease succeeds');
    meetRow = await db.queryOne('SELECT release_code_hash FROM meets WHERE id=?', [A.meet.id]);
    c.eq(meetRow.release_code_hash, null, 'unrelease clears the code hash');
    r = await api.post(`/api/meets/${A.meet.id}/unrelease`);
    c.eq(r.status, 400, 'unrelease of a non-released meet is 400');

    // ---- Adopt meet A (direct DB — redemption arrives in Step 2) --------
    await db.execute(
      `UPDATE meets SET adoption_status='adopted', adopted_at=datetime('now'), sync_token_hash='fake-token-hash' WHERE id=?`,
      [A.meet.id]
    );

    // ---- B. FR-20 generated lock-coverage gate --------------------------
    const routes = (await api.get('/api/_debug/routes')).data.routes;
    c.ok(routes.length > 100, `route enumeration returns the full app (${routes.length} routes)`);
    const MUT = ['POST', 'PUT', 'PATCH', 'DELETE'];
    const mutationRoutes = [];
    for (const rt of routes) {
      for (const m of rt.methods.filter(x => MUT.includes(x))) {
        mutationRoutes.push({ path: rt.path, method: m });
      }
    }
    c.ok(mutationRoutes.length >= 100, `enumerated ${mutationRoutes.length} mutation routes`);

    const unclassified = mutationRoutes.filter(rt => classifyRoute(rt) === 'unclassified');
    c.deepEq(unclassified, [], 'every mutation route is classified (in-scope or documented exempt) — a new route cannot silently escape the lock');

    const ctx = {
      meetId: A.meet.id, id: A.meet.id, eventId: A.event.id,
      trainingDayId: A.trainingDay.id,
    };
    const inScope = mutationRoutes.filter(rt => classifyRoute(rt) === 'in-scope');
    let all423 = true;
    const misses = [];
    for (const rt of inScope) {
      // Substitute :id contextually — under /api/meets it is the meet, under
      // /api/training-days the training day; anything else gets a dummy (the
      // prefix guard fires before inner route matching).
      const localCtx = { ...ctx };
      if (rt.path.startsWith('/api/training-days/:')) localCtx.id = A.trainingDay.id;
      else if (rt.path.startsWith('/api/meets/:')) localCtx.id = A.meet.id;
      else localCtx.id = 'harness-dummy';
      const url = substituteParams(rt.path, localCtx);
      const resp = await api.req(rt.method, url, {});
      if (resp.status !== 423) {
        all423 = false;
        misses.push(`${rt.method} ${rt.path} -> ${resp.status}`);
      }
    }
    c.ok(all423, `all ${inScope.length} in-scope mutation routes return 423 for the adopted meet${misses.length ? ' — MISSES: ' + misses.join('; ') : ''}`);

    // ---- C. Targeted lock checks + control meet -------------------------
    r = await api.post(`/api/events/${A.event.id}/runs/${A.run.id}/scores`, {
      judge_id: A.judges[0].id, score_type: 'turns', raw_score: 12.0,
    });
    c.eq(r.status, 423, 'public tablet score submit against adopted meet is 423');
    r = await api.post(`/api/events/${A.event.id}/finalize`, {});
    c.eq(r.status, 423, 'HJ finalize against adopted meet is 423');
    r = await api.post(`/api/events/${A.event.id}/runs/status-only`, {
      registration_id: A.regs[1].id, run_number: 1, round: 'qualification', run_status: 'DNS',
    });
    c.eq(r.status, 423, 'tablet DNS status-only against adopted meet is 423');
    r = await api.put(`/api/meets/${A.meet.id}`, { name: 'Renamed' });
    c.eq(r.status, 423, 'meet rename against adopted meet is 423');
    r = await api.get(`/api/events/${A.event.id}`);
    c.eq(r.status, 200, 'reads of the adopted meet still work (mirror is live)');
    r = await api.get(`/api/meets/${A.meet.id}`);
    c.eq(r.status, 200, 'meet read still works');

    // Control meet B: everything still works
    r = await api.post(`/api/events/${B.event.id}/runs/${B.run.id}/scores`, {
      judge_id: B.judges[0].id, score_type: 'turns', raw_score: 13.5,
    });
    c.eq(r.status, 200, 'control meet: judge score submit works');
    r = await api.put(`/api/meets/${B.meet.id}`, { location: 'Elsewhere' });
    c.eq(r.status, 200, 'control meet: meet edit works');
    r = await api.post(`/api/meets/${B.meet.id}/training-days`, { name: 'TD2', date: '2026-08-23' });
    c.ok(r.status === 200 || r.status === 201, 'control meet: training day create works');

    // ---- D. FR-8 athlete locking ----------------------------------------
    r = await api.put(`/api/athletes/${A.athletes[0].id}`, { club: 'New Club' });
    c.eq(r.status, 423, 'edit of adoption-locked athlete is 423');
    r = await api.put(`/api/athletes/${B.athletes[0].id}`, { club: 'Fine Club' });
    c.eq(r.status, 200, 'edit of unlocked athlete works');

    r = await api.post('/api/athletes/usss-sync', {});
    c.eq(r.status, 200, 'usss-sync runs');
    c.ok(r.data.skipped_locked >= 2, `usss-sync skips locked athletes (skipped_locked=${r.data.skipped_locked})`);

    r = await api.post('/api/admin/athletes/preview-delete', { mode: 'selected', ids: [A.athletes[0].id] });
    c.eq(r.data.count, 0, 'admin bulk delete preview excludes locked athletes');
    r = await api.post('/api/admin/athletes/delete', { mode: 'selected', ids: [A.athletes[0].id, B.athletes[1].id] });
    c.eq(r.data.deleted, 1, 'admin bulk delete deletes only the unlocked athlete');
    const stillThere = await db.queryOne('SELECT deleted_at FROM athletes WHERE id=?', [A.athletes[0].id]);
    c.eq(stillThere.deleted_at, null, 'locked athlete was not soft-deleted');

    r = await api.post('/api/import/athletes', { rows: [{ first_name: 'X', last_name: 'Y' }], eventId: A.event.id });
    c.eq(r.status, 423, 'athlete import targeting adopted event is 423');
    r = await api.post('/api/import/athletes', {
      rows: [{ first_name: A.athletes[0].first_name, last_name: A.athletes[0].last_name, ussa_num: A.athletes[0].ussa_num }],
    });
    c.eq(r.status, 200, 'global athlete import runs');
    c.ok(r.data.skipped >= 1 && /locked/i.test(JSON.stringify(r.data.errors)), 'global import skips the locked athlete with a clear reason');

    // Unrelease attempt while adopted → guard
    r = await api.post(`/api/meets/${A.meet.id}/unrelease`);
    c.eq(r.status, 423, 'unrelease of an adopted meet is 423');

    // ---- E. Force-unlock (R8) -------------------------------------------
    r = await api.post(`/api/admin/adoption/${A.meet.id}/force-unlock`, { confirm_name: 'Wrong Name' });
    c.eq(r.status, 400, 'force-unlock with wrong typed name is refused');
    const adminList = (await api.get('/api/admin/adoption')).data;
    c.ok(adminList.meets.some(m => m.id === A.meet.id && m.adoption_status === 'adopted'), 'admin adoption list shows the adopted meet');
    r = await api.post(`/api/admin/adoption/${A.meet.id}/force-unlock`, { confirm_name: 'Adopted Meet' });
    c.eq(r.status, 200, 'force-unlock with exact meet name succeeds');
    meetRow = await db.queryOne('SELECT adoption_status, sync_token_hash FROM meets WHERE id=?', [A.meet.id]);
    c.eq(meetRow.adoption_status, null, 'force-unlock clears adoption_status');
    c.eq(meetRow.sync_token_hash, null, 'force-unlock invalidates the sync token');
    const auditRow = await db.queryOne(`SELECT * FROM audit_log WHERE action='meet_force_unlocked' AND entity_id=?`, [A.meet.id]);
    c.ok(!!auditRow, 'force-unlock is audit-logged');
    r = await api.put(`/api/meets/${A.meet.id}`, { location: 'Back Home' });
    c.eq(r.status, 200, 'mutations work again after force-unlock');

    // ---- F. FR-9 boot-time mutation guards ------------------------------
    // Re-adopt A, plant boot-mutation targets on both meets, restart, verify.
    await db.execute(`UPDATE meets SET adoption_status='adopted' WHERE id=?`, [A.meet.id]);
    await db.execute(`UPDATE events SET dual_manual_entry=1, gender='male' WHERE id=?`, [A.event.id]);
    await db.execute(`UPDATE events SET dual_manual_entry=1, gender='male' WHERE id=?`, [B.event.id]);
    await db.execute(`UPDATE events SET short_code=NULL WHERE id IN (?,?)`, [A.event.id, B.event.id]);
    await db.execute(`UPDATE athletes SET gender='male' WHERE id=?`, [A.athletes[0].id]);
    await db.execute(`UPDATE athletes SET gender='male' WHERE id=?`, [B.athletes[0].id]);
    db.close();
    await cloud.stop();
    await cloud.start();
    const db2 = openDb(cloud.dbPath);
    const evA = await db2.queryOne('SELECT dual_manual_entry, gender, short_code FROM events WHERE id=?', [A.event.id]);
    const evB = await db2.queryOne('SELECT dual_manual_entry, gender, short_code FROM events WHERE id=?', [B.event.id]);
    c.eq(evA.dual_manual_entry, 1, 'FR-9: adopted meet dual_manual_entry untouched at boot');
    c.eq(evA.gender, 'male', 'FR-9: adopted meet gender not normalized at boot');
    c.eq(evA.short_code, null, 'FR-9: adopted meet short_code not backfilled at boot');
    c.eq(evB.dual_manual_entry, 0, 'control meet dual_manual_entry cleared at boot');
    c.eq(evB.gender, 'M', 'control meet gender normalized at boot');
    c.ok(!!evB.short_code, 'control meet short_code backfilled at boot');
    const athA = await db2.queryOne('SELECT gender FROM athletes WHERE id=?', [A.athletes[0].id]);
    const athB = await db2.queryOne('SELECT gender FROM athletes WHERE id=?', [B.athletes[0].id]);
    c.eq(athA.gender, 'male', 'FR-9: locked athlete gender not normalized at boot');
    c.eq(athB.gender, 'M', 'control athlete gender normalized at boot');
    db2.close();
  } finally {
    await cloud.stop().catch(() => {});
  }

  return c;
}

module.exports = { main };
