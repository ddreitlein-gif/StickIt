const router = require('express').Router({ mergeParams: true });
const { queryAll, queryOne, execute, batch, uuidv4 } = require('../db/schema');
const { normalizeGender } = require('../utils/gender');
const { requireUnlocked } = require('../middleware/lockCheck');
router.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return requireUnlocked()(req, res, next);
  next();
});

// GET all registrations -- ordered by run_order when set, bib/name otherwise
router.get('/', async (req, res) => {
  try {
    const regs = await queryAll(
      `SELECT r.*, a.first_name, a.last_name, a.ussa_num, a.fis_id, a.nation, a.club, a.birth_year, a.gender
       FROM registrations r JOIN athletes a ON a.id = r.athlete_id
       WHERE r.event_id = ?
       ORDER BY CASE WHEN r.run_order IS NULL THEN 1 ELSE 0 END,
                r.run_order, r.bib_number, a.last_name`,
      [req.params.eventId]
    );
    res.json(regs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST register an athlete
router.post('/', async (req, res) => {
  try {
    const { athlete_id, bib_number, seed } = req.body;
    if (!athlete_id) return res.status(400).json({ error: 'athlete_id required' });

    // Gender enforcement: athlete gender must match event gender
    const event   = await queryOne('SELECT gender FROM events WHERE id=?', [req.params.eventId]);
    const athlete = await queryOne('SELECT gender, first_name, last_name FROM athletes WHERE id=?', [athlete_id]);
    if (event && athlete && event.gender && athlete.gender) {
      const evtG = normalizeGender(event.gender);
      const athG = normalizeGender(athlete.gender);
      if (evtG && athG && evtG !== athG) {
        const evtLabel = evtG === 'M' ? 'men\'s' : 'women\'s';
        const athLabel = athG === 'M' ? 'male' : 'female';
        return res.status(400).json({
          error: `${athlete.first_name} ${athlete.last_name} is registered as ${athLabel} and cannot be added to a ${evtLabel} event.`
        });
      }
    }

    const ex = await queryOne('SELECT id FROM registrations WHERE event_id=? AND athlete_id=?', [req.params.eventId, athlete_id]);
    if (ex) return res.status(409).json({ error: 'Athlete already registered in this event' });

    // Auto-assign next bib number if none provided
    let assignedBib = bib_number || null;
    if (!assignedBib) {
      const maxBib = await queryOne(
        `SELECT MAX(bib_number) as max_bib FROM registrations WHERE event_id=?`,
        [req.params.eventId]
      );
      assignedBib = (maxBib && maxBib.max_bib ? maxBib.max_bib : 0) + 1;
    }

    const id = uuidv4();
    await execute(
      `INSERT INTO registrations (id,event_id,athlete_id,bib_number,seed) VALUES (?,?,?,?,?)`,
      [id, req.params.eventId, athlete_id, assignedBib, seed || null]
    );
    res.status(201).json(await queryOne(
      `SELECT r.*, a.first_name, a.last_name, a.ussa_num FROM registrations r JOIN athletes a ON a.id=r.athlete_id WHERE r.id=?`, [id]
    ));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- action routes must precede /:id to avoid Express wildcard conflicts ----

// PUT /reorder -- bulk-update run_order for all registrations
router.put('/reorder', async (req, res) => {
  try {
    const items = req.body; // [{ id, run_order }, ...]
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'Array of { id, run_order } required' });
    }
    const stmts = items.map(item => ({
      sql: `UPDATE registrations SET run_order=? WHERE id=? AND event_id=?`,
      args: [item.run_order, item.id, req.params.eventId],
    }));
    await batch(stmts);

    // v1.9.00: Sync Phase 1 phase_run_order if phases exist
    const phase1 = await queryOne(
      `SELECT id FROM event_phases WHERE event_id=? AND run_number=1`, [req.params.eventId]
    );
    if (phase1) {
      const syncStmts = items.map(item => ({
        sql: `UPDATE phase_run_order SET run_order=? WHERE phase_id=? AND registration_id=?`,
        args: [item.run_order, phase1.id, item.id],
      }));
      await batch(syncStmts);
    }

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /random-order -- assign random run_order; females run first in combined events
router.post('/random-order', async (req, res) => {
  try {
    const regs = await queryAll(
      `SELECT r.id, a.gender FROM registrations r JOIN athletes a ON a.id=r.athlete_id
       WHERE r.event_id=? AND r.status NOT IN ('scratched','dns')`,
      [req.params.eventId]
    );
    if (!regs.length) return res.status(400).json({ error: 'No active athletes to order' });

    // Generate seed first, then use a seeded PRNG so the draw is reproducible
    const seed = Math.floor(Math.random() * 1000) + 1;

    // Simple seeded PRNG (mulberry32) -- deterministic given the same seed
    function mulberry32(s) {
      return function() {
        s |= 0; s = s + 0x6D2B79F5 | 0;
        let t = Math.imul(s ^ s >>> 15, 1 | s);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }
    const rng = mulberry32(seed);

    const shuffle = (arr) => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };

    const female  = regs.filter(r => normalizeGender(r.gender) === 'F');
    const male    = regs.filter(r => normalizeGender(r.gender) !== 'F');
    const ordered = [...shuffle(female), ...shuffle(male)];

    const stmts = ordered.map((r, i) => ({
      sql: `UPDATE registrations SET run_order=? WHERE id=?`,
      args: [i + 1, r.id],
    }));
    stmts.push({ sql: `UPDATE events SET order_seed=? WHERE id=?`, args: [seed, req.params.eventId] });
    await batch(stmts);

    // v1.9.00: Sync Phase 1 phase_run_order if phases exist
    const phase1 = await queryOne(
      `SELECT id FROM event_phases WHERE event_id=? AND run_number=1`, [req.params.eventId]
    );
    if (phase1) {
      const syncStmts = ordered.map((r, i) => ({
        sql: `UPDATE phase_run_order SET run_order=? WHERE phase_id=? AND registration_id=?`,
        args: [i + 1, phase1.id, r.id],
      }));
      await batch(syncStmts);
    }

    res.json({ ok: true, seed, count: ordered.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /order-by-age-groups -- order athletes by age group (U7 first, ascending), random within each group
router.post('/order-by-age-groups', async (req, res) => {
  try {
    const event = await queryOne('SELECT event_date FROM events WHERE id=?', [req.params.eventId]);
    const regs = await queryAll(
      `SELECT r.id, a.gender, a.birth_year FROM registrations r JOIN athletes a ON a.id=r.athlete_id
       WHERE r.event_id=? AND r.status NOT IN ('scratched','dns')`,
      [req.params.eventId]
    );
    if (!regs.length) return res.status(400).json({ error: 'No active athletes to order' });

    const AGE_ORDER = ['U7','U9','U11','U13','U15','U17','U19','Sr','Vet'];
    function computeAgeClass(birthYear, eventDate) {
      if (!birthYear) return 'Vet';
      const d = eventDate ? new Date(eventDate) : new Date();
      const seasonStartYear = d.getMonth() < 6 ? d.getFullYear() - 1 : d.getFullYear();
      const age = seasonStartYear - parseInt(birthYear);
      if (age <= 6) return 'U7';
      if (age <= 8) return 'U9';
      if (age <= 10) return 'U11';
      if (age <= 12) return 'U13';
      if (age <= 14) return 'U15';
      if (age <= 16) return 'U17';
      if (age <= 18) return 'U19';
      if (age <= 20) return 'Sr';
      return 'Vet';
    }

    // Tag each athlete with their age class
    for (const r of regs) r._ageClass = computeAgeClass(r.birth_year, event?.event_date);

    // Shuffle helper
    const shuffle = (arr) => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };

    // Group by age class, sort groups by AGE_ORDER, shuffle within each group
    const ordered = [];
    for (const ag of AGE_ORDER) {
      const group = regs.filter(r => r._ageClass === ag);
      if (group.length) ordered.push(...shuffle(group));
    }

    const stmts = ordered.map((r, i) => ({
      sql: `UPDATE registrations SET run_order=? WHERE id=?`,
      args: [i + 1, r.id],
    }));
    await batch(stmts);

    // Sync Phase 1 phase_run_order if phases exist
    const phase1 = await queryOne(
      `SELECT id FROM event_phases WHERE event_id=? AND run_number=1`, [req.params.eventId]
    );
    if (phase1) {
      const syncStmts = ordered.map((r, i) => ({
        sql: `UPDATE phase_run_order SET run_order=? WHERE phase_id=? AND registration_id=?`,
        args: [i + 1, phase1.id, r.id],
      }));
      await batch(syncStmts);
    }

    res.json({ ok: true, count: ordered.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /seed-from-results -- reverse qualification finish order (worst runs first)
router.post('/seed-from-results', async (req, res) => {
  try {
    const results = await queryAll(
      `SELECT r.registration_id, MAX(r.total_score) as best_score
       FROM runs r
       WHERE r.event_id=? AND r.round='qualification' AND r.status='complete' AND r.total_score IS NOT NULL
       GROUP BY r.registration_id
       ORDER BY best_score DESC`,
      [req.params.eventId]
    );
    if (!results.length) return res.status(400).json({ error: 'No qualification results found' });

    // results[0] = best qualifier; they run last (highest run_order number)
    const stmts = results.map((r, i) => ({
      sql: `UPDATE registrations SET run_order=? WHERE id=? AND event_id=?`,
      args: [results.length - i, r.registration_id, req.params.eventId],
    }));
    await batch(stmts);
    res.json({ ok: true, count: results.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /seed-from-qualifier -- seed this event's run order from the linked qualifier results
// Body: { topByes }  -- athletes ranked 1..topByes get a bye (run_order null) and are placed at the end
router.post('/seed-from-qualifier', async (req, res) => {
  try {
    const { topByes = 0 } = req.body || {};
    // Find the qualifier event linked to this event
    const event = await queryOne(
      `SELECT e.*, e.qualifier_event_id FROM events e
       WHERE e.id=? AND e.qualifier_event_id IS NOT NULL`,
      [req.params.eventId]
    );
    if (!event) return res.status(400).json({ error: 'No qualifier event linked to this event' });

    const qualResults = await queryAll(
      `SELECT r.registration_id, MAX(r.total_score) as best_score,
              reg.athlete_id
       FROM runs r
       JOIN registrations reg ON reg.id=r.registration_id
       WHERE r.event_id=? AND r.status='complete' AND r.total_score IS NOT NULL
       GROUP BY r.registration_id
       ORDER BY best_score DESC`,
      [event.qualifier_event_id]
    );
    if (!qualResults.length) return res.status(400).json({ error: 'No qualifier results found' });

    // Map qualifier athlete_id -> rank (1 = best)
    const rankMap = new Map();
    qualResults.forEach((r, i) => rankMap.set(r.athlete_id, i + 1));

    // Get registrations in this (finals) event
    const regs = await queryAll(
      `SELECT r.id, r.athlete_id FROM registrations r WHERE r.event_id=? AND r.status NOT IN ('scratched','dns')`,
      [req.params.eventId]
    );
    if (!regs.length) return res.status(400).json({ error: 'No active athletes in this event' });

    // Sort by qualifier rank (ascending = worst first for run order; best runs last)
    regs.sort((a, b) => {
      const ra = rankMap.get(a.athlete_id) || 9999;
      const rb = rankMap.get(b.athlete_id) || 9999;
      return rb - ra; // worst qualifier runs first (lowest run_order number)
    });

    // Assign run_order; top-ranked (bye) athletes get run_order=null (they skip the opening round)
    // Non-bye athletes receive sequential run_order 1..N with worst qualifier running first.
    const byeCount = Math.min(topByes, regs.length);
    let position = 1;
    const stmts = regs.map((r) => {
      const rank  = rankMap.get(r.athlete_id) || 9999;
      const isBye = byeCount > 0 && rank <= byeCount;
      return {
        sql:  `UPDATE registrations SET run_order=? WHERE id=? AND event_id=?`,
        args: [isBye ? null : position++, r.id, req.params.eventId],
      };
    });
    await batch(stmts);
    res.json({ ok: true, count: regs.length, byes: byeCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /import-bibs-from-athletes -- pull bib from athletes.bib into registrations.bib_number
router.post('/import-bibs-from-athletes', async (req, res) => {
  try {
    const regs = await queryAll(
      `SELECT r.id, r.athlete_id, a.bib
       FROM registrations r JOIN athletes a ON a.id = r.athlete_id
       WHERE r.event_id = ? AND r.status != 'scratched'`,
      [req.params.eventId]
    );
    const stmts = [];
    for (const r of regs) {
      if (r.bib != null) {
        stmts.push({
          sql:  `UPDATE registrations SET bib_number = ? WHERE id = ?`,
          args: [r.bib, r.id],
        });
      }
    }
    if (stmts.length) await batch(stmts);
    res.json({ ok: true, updated: stmts.length, total: regs.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Shared helper: build bib lookup from source event registrations.
// Matches by athlete_id first, then falls back to name (case-insensitive)
// for cases where the same person is registered under different athlete records.
async function buildBibLookup(sourceEventId, tgtRegs) {
  const srcRegs = await queryAll(
    `SELECT r.athlete_id, r.bib_number, LOWER(a.first_name) AS fn, LOWER(a.last_name) AS ln
     FROM registrations r JOIN athletes a ON a.id = r.athlete_id
     WHERE r.event_id = ? AND r.bib_number IS NOT NULL AND r.status != 'scratched'`,
    [sourceEventId]
  );
  const srcByAthlete = new Map();
  const srcByName = new Map();
  for (const r of srcRegs) {
    srcByAthlete.set(r.athlete_id, r.bib_number);
    const nameKey = `${r.ln}|${r.fn}`;
    if (!srcByName.has(nameKey)) srcByName.set(nameKey, r.bib_number);
  }
  // For each target reg, find matching source bib (athlete_id first, then name)
  return (tgtReg) => {
    const byId = srcByAthlete.get(tgtReg.athlete_id);
    if (byId != null) return byId;
    const nameKey = `${tgtReg.ln}|${tgtReg.fn}`;
    return srcByName.get(nameKey) ?? null;
  };
}

const TGT_REG_SQL = `SELECT r.id, r.athlete_id, r.bib_number, LOWER(a.first_name) AS fn, LOWER(a.last_name) AS ln
  FROM registrations r JOIN athletes a ON a.id = r.athlete_id
  WHERE r.event_id = ? AND r.status != 'scratched'`;

// POST /import-bibs-from-event -- copy bib_number from another event's registrations
router.post('/import-bibs-from-event', async (req, res) => {
  try {
    const { sourceEventId } = req.body;
    if (!sourceEventId) return res.status(400).json({ error: 'sourceEventId required' });

    const tgtRegs = await queryAll(TGT_REG_SQL, [req.params.eventId]);
    const lookup = await buildBibLookup(sourceEventId, tgtRegs);

    const stmts = [];
    let updated = 0, overwritten = 0, skipped = 0;
    for (const r of tgtRegs) {
      const srcBib = lookup(r);
      if (srcBib == null) { skipped++; continue; }
      if (r.bib_number != null && r.bib_number !== srcBib) overwritten++;
      stmts.push({
        sql:  `UPDATE registrations SET bib_number = ? WHERE id = ?`,
        args: [srcBib, r.id],
      });
      updated++;
    }
    if (stmts.length) await batch(stmts);
    res.json({ ok: true, updated, overwritten, skipped });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /preview-import-bibs-from-event -- preview without writing
router.post('/preview-import-bibs-from-event', async (req, res) => {
  try {
    const { sourceEventId } = req.body;
    if (!sourceEventId) return res.status(400).json({ error: 'sourceEventId required' });

    const tgtRegs = await queryAll(TGT_REG_SQL, [req.params.eventId]);
    const lookup = await buildBibLookup(sourceEventId, tgtRegs);

    let matched = 0, overwritten = 0, skipped = 0;
    for (const r of tgtRegs) {
      const srcBib = lookup(r);
      if (srcBib == null) { skipped++; continue; }
      if (r.bib_number != null && r.bib_number !== srcBib) overwritten++;
      matched++;
    }
    res.json({ matched, overwritten, skipped });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /export-bibs-to-athletes -- push registrations.bib_number into athletes.bib
router.post('/export-bibs-to-athletes', async (req, res) => {
  try {
    const regs = await queryAll(
      `SELECT r.athlete_id, r.bib_number
       FROM registrations r
       WHERE r.event_id = ? AND r.status != 'scratched' AND r.bib_number IS NOT NULL`,
      [req.params.eventId]
    );
    const stmts = regs.map(r => ({
      sql:  `UPDATE athletes SET bib = ? WHERE id = ?`,
      args: [r.bib_number, r.athlete_id],
    }));
    if (stmts.length) await batch(stmts);
    res.json({ ok: true, updated: stmts.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /:id -- update bib, seed, status, or round_scratched
router.put('/:id', async (req, res) => {
  try {
    const { bib_number, seed, status, round_scratched } = req.body;
    const updates = [];
    const vals    = [];
    if (bib_number !== undefined)    { updates.push('bib_number=?');    vals.push(bib_number || null); }
    if (seed       !== undefined)    { updates.push('seed=?');          vals.push(seed || null); }
    if (status     !== undefined)    { updates.push('status=?');        vals.push(status); }
    if (round_scratched !== undefined) {
      updates.push('round_scratched=?');
      vals.push(round_scratched ? JSON.stringify(round_scratched) : null);
    }
    // When scratching an athlete with order locked, clear their run_order
    if (status === 'scratched') {
      const evt = await queryOne('SELECT order_locked FROM events WHERE id=?', [req.params.eventId]);
      if (evt && evt.order_locked) {
        updates.push('run_order=?');
        vals.push(null);
        // Also remove from phase_run_order if phases exist
        const phases = await queryAll('SELECT id FROM event_phases WHERE event_id=?', [req.params.eventId]);
        if (phases.length) {
          await execute('DELETE FROM phase_run_order WHERE registration_id=? AND phase_id IN (SELECT id FROM event_phases WHERE event_id=?)',
            [req.params.id, req.params.eventId]);
        }
      }
    }
    if (!updates.length) return res.json({ ok: true });
    vals.push(req.params.id, req.params.eventId);
    await execute(`UPDATE registrations SET ${updates.join(',')} WHERE id=? AND event_id=?`, vals);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /bulk -- register multiple athletes at once
router.post('/bulk', async (req, res) => {
  try {
    const { athlete_ids } = req.body;
    if (!Array.isArray(athlete_ids) || athlete_ids.length === 0) {
      return res.status(400).json({ error: 'athlete_ids array is required' });
    }

    const event = await queryOne('SELECT gender FROM events WHERE id=?', [req.params.eventId]);

    // Get current max bib for auto-assignment
    const maxBibRow = await queryOne(
      `SELECT MAX(bib_number) as max_bib FROM registrations WHERE event_id=?`,
      [req.params.eventId]
    );
    let nextBib = (maxBibRow && maxBibRow.max_bib ? maxBibRow.max_bib : 0) + 1;

    let registered = 0;
    const skipped  = [];
    const errors   = [];

    for (const athlete_id of athlete_ids) {
      try {
        const athlete = await queryOne('SELECT id, first_name, last_name, gender FROM athletes WHERE id=?', [athlete_id]);
        if (!athlete) { skipped.push({ athlete_id, reason: 'Athlete not found' }); continue; }

        // Gender check
        if (event && event.gender && athlete.gender && normalizeGender(event.gender) !== normalizeGender(athlete.gender)) {
          skipped.push({ athlete_id, name: `${athlete.first_name} ${athlete.last_name}`, reason: 'Gender mismatch' });
          continue;
        }

        // Already registered?
        const ex = await queryOne('SELECT id FROM registrations WHERE event_id=? AND athlete_id=?', [req.params.eventId, athlete_id]);
        if (ex) { skipped.push({ athlete_id, name: `${athlete.first_name} ${athlete.last_name}`, reason: 'Already registered' }); continue; }

        const id = uuidv4();
        await execute(
          `INSERT INTO registrations (id,event_id,athlete_id,bib_number) VALUES (?,?,?,?)`,
          [id, req.params.eventId, athlete_id, nextBib]
        );
        nextBib++;
        registered++;
      } catch (e) {
        errors.push({ athlete_id, reason: e.message });
      }
    }

    res.json({ registered, skipped, errors });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /:id -- scratch
router.delete('/:id', async (req, res) => {
  try {
    await execute(`UPDATE registrations SET status='scratched' WHERE id=? AND event_id=?`, [req.params.id, req.params.eventId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ── v1.5 Feature 1: CSV Registration Upload ────────────────────────────────
const multer = require('multer');
const { parse: csvParse } = require('csv-parse/sync');
const csvUpload = multer({ storage: multer.memoryStorage() });

function matchesDiscipline(categoryRaw, discipline) {
  const c = (categoryRaw || '').toLowerCase();
  // "singles" is a synonym for single mogul used in some SkiReg exports
  // (e.g. "Mens Devo Singles").
  const isMogul = c.includes('mogul') || c.includes('singles');
  // For dual mogul: accept any mogul category (USSS registrations often use
  // "Women's Moguls" / "Men's Moguls" for both single and dual participants,
  // without a separate "Dual Moguls" category).
  if (discipline === 'dual_mogul')  return isMogul;
  if (discipline === 'aerials')     return c.includes('aerial');
  // single mogul / 'mogul'
  return isMogul && !c.includes('dual');
}

async function processCsvRows(rows, event, eventId, commit, overrideEventCheck = []) {
  const toRegister = [];
  const skippedOtherEvent = [];
  const skippedGenderMismatch = [];
  const skippedAlreadyRegistered = [];
  const skippedUnrecognized = [];
  const seenUsss = new Map(); // dedup by USSS# (merges bib from mogul+dual rows)

  for (const row of rows) {
    const lastName  = (row['Last Name']  || '').trim();
    const firstName = (row['First Name'] || '').trim();
    const gender    = normalizeGender(row['Gender']);
    const birthYear = parseInt((row['Birth Year'] || '').trim(), 10) || null;
    const usssId    = (row['USSS Member #'] || '').trim();
    const team      = (row['Team']       || '').trim();
    const bibRaw    = (row['Bib']        || '').trim();
    const category  = (row['Category Entered'] || row['Category Entered / Merchandise Ordered'] || '').trim();
    const name      = `${firstName} ${lastName}`.trim();

    if (!lastName && !firstName && !usssId) continue; // blank row

    if (!matchesDiscipline(category, event.discipline)) {
      if (!overrideEventCheck.includes(usssId)) {
        skippedOtherEvent.push({ usssId, name, category });
        continue;
      }
    }
    if (event.gender && gender && normalizeGender(event.gender) !== gender) {
      skippedGenderMismatch.push({ usssId, name, gender, category });
      continue;
    }
    if (!usssId) {
      skippedUnrecognized.push({ usssId, name, category, reason: 'missing USSS Member #' });
      continue;
    }

    // Look up or create athlete
    let athlete = await queryOne('SELECT * FROM athletes WHERE ussa_num=?', [usssId]);
    // Fallback: match by name (+ birth_year when available) to prevent duplicates
    if (!athlete && firstName && lastName) {
      athlete = await queryOne(
        `SELECT * FROM athletes WHERE LOWER(first_name)=LOWER(?) AND LOWER(last_name)=LOWER(?)${birthYear ? ' AND birth_year=?' : ''}`,
        birthYear ? [firstName, lastName, birthYear] : [firstName, lastName]
      );
    }
    let athleteExists = !!athlete;
    let athleteId;
    if (athlete) {
      athleteId = athlete.id;
      // Update missing fields on existing athlete
      if (commit) {
        const updates = [], params = [];
        if (!athlete.ussa_num && usssId) { updates.push('ussa_num=?'); params.push(usssId); }
        if (!athlete.birth_year && birthYear) { updates.push('birth_year=?'); params.push(birthYear); }
        if (!athlete.gender && gender) { updates.push('gender=?'); params.push(gender); }
        if (!athlete.club && team) { updates.push('club=?'); params.push(team); }
        // v1.16.31 -- restore soft-deleted athlete when re-imported via CSV
        if (athlete.deleted_at) { updates.push('deleted_at=NULL'); }
        if (updates.length) { params.push(athleteId); await execute(`UPDATE athletes SET ${updates.join(', ')} WHERE id=?`, params); }
      }
    } else {
      athleteId = uuidv4();
      if (commit) {
        await execute(
          `INSERT INTO athletes (id, ussa_num, first_name, last_name, birth_year, gender, club)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [athleteId, usssId, firstName, lastName, birthYear, gender || null, team || null]
        );
      }
    }

    // Bib from CSV only (auto-sync from athletes.bib removed in v1.16)
    let bib = null;
    let bibSource = 'none';
    if (bibRaw) {
      const parsed = parseInt(bibRaw, 10);
      if (!isNaN(parsed)) { bib = parsed; bibSource = 'csv'; }
    }

    // Deduplicate by USSS# — SkiReg CSVs have separate mogul + dual mogul rows
    // for the same athlete; merge bib from whichever row has it
    if (seenUsss.has(usssId)) {
      const prev = seenUsss.get(usssId);
      if (!prev.entry.bib && bib) {
        prev.entry.bib = bib;
        prev.entry.bibSource = bibSource;
        if (commit && prev.regId) {
          await execute('UPDATE registrations SET bib_number=? WHERE id=?', [bib, prev.regId]);
        }
      }
      continue;
    }

    // Already registered?
    const existingReg = await queryOne(
      'SELECT id FROM registrations WHERE event_id=? AND athlete_id=?',
      [eventId, athleteId]
    );
    if (existingReg) {
      skippedAlreadyRegistered.push({ usssId, name });
      continue;
    }

    let regId = null;
    if (commit) {
      regId = uuidv4();
      await execute(
        `INSERT INTO registrations (id, event_id, athlete_id, bib_number, seed)
         VALUES (?, ?, ?, ?, ?)`,
        [regId, eventId, athleteId, bib, null]
      );
    }

    const entry = {
      usssId, firstName, lastName, gender, birthYear, team,
      bib, bibSource, athleteExists,
    };
    seenUsss.set(usssId, { entry, regId });
    toRegister.push(entry);
  }

  return { toRegister, skippedOtherEvent, skippedGenderMismatch, skippedAlreadyRegistered, skippedUnrecognized };
}

router.post('/import-csv', csvUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const mode = (req.query.mode === 'commit') ? 'commit' : 'preview';

    const event = await queryOne('SELECT * FROM events WHERE id=?', [req.params.eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // Strip BOM, normalize line endings
    let text = req.file.buffer.toString('utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    let rows;
    try {
      rows = csvParse(text, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
        relax_column_count: true,
      });
    } catch (e) {
      return res.status(400).json({ error: 'CSV parse failed: ' + e.message });
    }

    let overrideEventCheck = [];
    if (mode === 'commit' && req.body.overrideEventCheck) {
      try { overrideEventCheck = JSON.parse(req.body.overrideEventCheck); } catch {}
    }

    const result = await processCsvRows(rows, event, req.params.eventId, mode === 'commit', overrideEventCheck);

    const response = {
      eventDiscipline: event.discipline,
      eventGender: event.gender,
      ...result,
    };
    if (mode === 'commit') {
      response.committed = true;
      response.insertedCount = result.toRegister.length;
      response.skippedCount =
        result.skippedOtherEvent.length +
        result.skippedGenderMismatch.length +
        result.skippedAlreadyRegistered.length +
        result.skippedUnrecognized.length;
    }
    res.json(response);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
