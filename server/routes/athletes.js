const router = require('express').Router();
const { queryAll, queryOne, execute, uuidv4 } = require('../db/schema');
const { logAudit } = require('./audit');

// Convert ALL-CAPS names to standard name case: "ANDERSON" → "Anderson"
// Handles multi-word names: "DE LA CRUZ" → "De La Cruz"
// Handles hyphenated names: "SMITH-JONES" → "Smith-Jones", "O'BRIEN" → "O'Brien"
// Only transforms if the entire string is uppercase; preserves mixed case like "McDonald"
function toNameCase(str) {
  if (!str) return str;
  const trimmed = str.trim();
  if (trimmed === trimmed.toUpperCase() && trimmed.length > 1) {
    return trimmed.toLowerCase().replace(/(^|[\s\-'])(\w)/g, (_, sep, ch) => sep + ch.toUpperCase());
  }
  return trimmed;
}

router.get('/', async (req, res) => {
  try {
    const { q } = req.query;
    let athletes;
    if (q && q.trim()) {
      const s = `%${q.trim()}%`;
      athletes = await queryAll(
        `SELECT * FROM athletes WHERE deleted_at IS NULL AND (first_name LIKE ? OR last_name LIKE ? OR ussa_num LIKE ? OR fis_id LIKE ?) ORDER BY last_name, first_name LIMIT 50`,
        [s, s, s, s]
      );
    } else {
      athletes = await queryAll('SELECT * FROM athletes WHERE deleted_at IS NULL ORDER BY last_name, first_name LIMIT 500');
    }
    res.json(athletes);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const a = await queryOne('SELECT * FROM athletes WHERE id = ?', [req.params.id]);
    if (!a) return res.status(404).json({ error: 'Athlete not found' });
    res.json(a);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Shared duplicate-check helper -- returns an error string or null
async function checkDuplicates(body, excludeId) {
  const { ussa_num, fis_id, first_name, last_name } = body;
  if (ussa_num) {
    const ex = await queryOne(
      `SELECT id FROM athletes WHERE ussa_num = ? AND id != ?`,
      [ussa_num, excludeId || '']
    );
    if (ex) return `USSA number ${ussa_num} is already assigned to another athlete.`;
  }
  if (fis_id) {
    const ex = await queryOne(
      `SELECT id FROM athletes WHERE fis_id = ? AND id != ?`,
      [fis_id, excludeId || '']
    );
    if (ex) return `FIS ID ${fis_id} is already assigned to another athlete.`;
  }
  // Name warning -- returned as a separate key so client can distinguish
  if (first_name && last_name) {
    const ex = await queryOne(
      `SELECT id FROM athletes WHERE first_name = ? AND last_name = ? AND id != ?`,
      [first_name.trim(), last_name.trim(), excludeId || '']
    );
    if (ex) return { warning: `Another athlete named ${first_name} ${last_name} already exists. Save anyway to continue.`, warningOnly: true };
  }
  return null;
}

router.post('/', async (req, res) => {
  try {
    const { first_name, last_name, ussa_num, fis_id, birth_year, gender, club, division } = req.body;
    if (!first_name || !last_name) return res.status(400).json({ error: 'first_name and last_name required' });

    const dup = await checkDuplicates(req.body, null);
    if (dup) {
      if (dup.warningOnly) {
        // Name-only warning -- caller must pass confirm:true to proceed
        if (!req.body.confirm) return res.status(409).json({ warning: dup.warning });
      } else {
        return res.status(409).json({ error: dup });
      }
    }

    const id = uuidv4();
    await execute(
      `INSERT INTO athletes (id,first_name,last_name,ussa_num,fis_id,birth_year,gender,club,division) VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, toNameCase(first_name), toNameCase(last_name), ussa_num||null, fis_id||null, birth_year||null, gender||null, club||null, division||null]
    );
    const created = await queryOne('SELECT * FROM athletes WHERE id = ?', [id]);
    try { await logAudit('athlete_created', 'athlete', id, null, { first_name, last_name, ussa_num, fis_id }); } catch (_) {}
    res.status(201).json(created);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { ussa_num, fis_id, first_name, last_name } = req.body;

    const dup = await checkDuplicates(req.body, req.params.id);
    if (dup) {
      if (dup.warningOnly) {
        if (!req.body.confirm) return res.status(409).json({ warning: dup.warning });
      } else {
        return res.status(409).json({ error: dup });
      }
    }

    // v1.6: 'bib' is included in the updatable fields.  When bib is
    // updated, we also cascade the new value into registrations.bib_number
    // for every registration of this athlete in events whose status is
    // 'setup' (not 'active' or 'complete').  Registrations in started or
    // completed events are NOT touched.
    const fields = ['first_name','last_name','ussa_num','fis_id','birth_year','gender','club','bib','division'];
    const updates = [], vals = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f}=?`);
        const v = req.body[f];
        vals.push((f === 'first_name' || f === 'last_name') ? toNameCase(v) : v);
      }
    }
    if (!updates.length) return res.json(await queryOne('SELECT * FROM athletes WHERE id=?', [req.params.id]));
    const old = await queryOne('SELECT * FROM athletes WHERE id=?', [req.params.id]);
    vals.push(req.params.id);
    await execute(`UPDATE athletes SET ${updates.join(',')} WHERE id=?`, vals);


    const updated = await queryOne('SELECT * FROM athletes WHERE id=?', [req.params.id]);
    try { await logAudit('athlete_updated', 'athlete', req.params.id, old, updated); } catch (_) {}
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// POST /api/athletes/from-usss  -- create-or-find athletes from USSS records
// Body: { ussa_ids: [...] }
// For each USSS person: if an athlete with that ussa_num already exists, return
// it.  Otherwise create a new athlete record from the USSS data.
// Returns: { athletes: [{ athlete_id, ussa_id, created, first_name, last_name }] }
// ---------------------------------------------------------------------------
router.post('/from-usss', async (req, res) => {
  try {
    const { ussa_ids } = req.body;
    if (!Array.isArray(ussa_ids) || !ussa_ids.length) {
      return res.status(400).json({ error: 'ussa_ids array required' });
    }

    const out = [];
    for (const ussa_id of ussa_ids) {
      if (!ussa_id) continue;
      const usss = await queryOne('SELECT * FROM usss_people WHERE ussa_id = ?', [String(ussa_id)]);
      if (!usss) { out.push({ ussa_id, error: 'not found in USSS' }); continue; }

      const existing = await queryOne('SELECT * FROM athletes WHERE ussa_num = ?', [String(ussa_id)]);
      if (existing) {
        // v1.16.31 -- if soft-deleted, restore by clearing deleted_at
        if (existing.deleted_at) {
          await execute('UPDATE athletes SET deleted_at=NULL WHERE id=?', [existing.id]);
          try { await logAudit('athlete_restored', 'athlete', existing.id, { deleted_at: existing.deleted_at }, { source: 'usss', ussa_num: ussa_id }); } catch (_) {}
          out.push({ athlete_id: existing.id, ussa_id, created: false, restored: true, first_name: existing.first_name, last_name: existing.last_name });
        } else {
          out.push({ athlete_id: existing.id, ussa_id, created: false, first_name: existing.first_name, last_name: existing.last_name });
        }
        continue;
      }

      const id = uuidv4();
      await execute(
        `INSERT INTO athletes (id,first_name,last_name,ussa_num,fis_id,birth_year,gender,club,division) VALUES (?,?,?,?,?,?,?,?,?)`,
        [id, toNameCase(usss.first_name), toNameCase(usss.last_name), usss.ussa_id, usss.fis_id || null, usss.yob || null, usss.gender || null, usss.club_name || null, usss.division || null]
      );
      try { await logAudit('athlete_created', 'athlete', id, null, { source: 'usss', ussa_num: usss.ussa_id, first_name: usss.first_name, last_name: usss.last_name }); } catch (_) {}
      out.push({ athlete_id: id, ussa_id, created: true, first_name: usss.first_name, last_name: usss.last_name });
    }

    res.json({ athletes: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// POST /api/athletes/reconcile  -- diff CSV against database, return diff
// Body: CSV text (Content-Type: text/plain)
// Returns: { toAdd[], toUpdate[], notInFile[] } -- no writes.
// ---------------------------------------------------------------------------
router.post('/reconcile', async (req, res) => {
  try {
    let text = '';
    await new Promise((resolve, reject) => {
      req.on('data', chunk => { text += chunk; });
      req.on('end', resolve);
      req.on('error', reject);
    });
    if (!text.trim()) return res.status(400).json({ error: 'Empty CSV' });

    const { parseCSV, normalizeRow } = require('./reconcileHelpers');
    const { rows } = parseCSV(text);
    if (!rows.length) return res.status(400).json({ error: 'No data rows in CSV' });

    const dbAthletes = await queryAll('SELECT * FROM athletes WHERE deleted_at IS NULL ORDER BY last_name, first_name');

    const toAdd     = [];
    const toUpdate  = [];
    const fileIds   = new Set(); // IDs of DB athletes matched in the file

    const COMPARE_FIELDS = ['first_name','last_name','ussa_num','fis_id','club','birth_year','gender','division'];

    for (const raw of rows) {
      const norm = normalizeRow(raw);
      if (!norm.first_name || !norm.last_name) continue;

      // Match priority: ussa_num > fis_id > name
      let existing = null;
      if (norm.ussa_num) existing = dbAthletes.find(a => a.ussa_num && a.ussa_num.trim() === norm.ussa_num.trim());
      if (!existing && norm.fis_id) existing = dbAthletes.find(a => a.fis_id && a.fis_id.trim() === norm.fis_id.trim());
      if (!existing) existing = dbAthletes.find(a =>
        a.first_name.toLowerCase() === norm.first_name.toLowerCase() &&
        a.last_name.toLowerCase()  === norm.last_name.toLowerCase()
      );

      if (!existing) {
        toAdd.push(norm);
      } else {
        fileIds.add(existing.id);
        // Compare fields -- report fields that differ
        const diffs = [];
        for (const f of COMPARE_FIELDS) {
          const incoming = norm[f] != null ? String(norm[f]).trim() : '';
          const current  = existing[f] != null ? String(existing[f]).trim() : '';
          if (incoming && incoming !== current) {
            diffs.push({ field: f, current, incoming });
          }
        }
        if (diffs.length) {
          toUpdate.push({ id: existing.id, first_name: existing.first_name, last_name: existing.last_name, diffs });
        }
      }
    }

    // Athletes in DB but not in file
    const notInFile = dbAthletes
      .filter(a => !fileIds.has(a.id))
      .map(a => ({ id: a.id, first_name: a.first_name, last_name: a.last_name, ussa_num: a.ussa_num, fis_id: a.fis_id, club: a.club }));

    res.json({ toAdd, toUpdate, notInFile });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// POST /api/athletes/reconcile/apply  -- apply selected changes from diff
// Body: { add: [athleteData], update: [{ id, fields: { field: newValue } }] }
// Returns: { added, updated }
// ---------------------------------------------------------------------------
router.post('/reconcile/apply', async (req, res) => {
  try {
    const { add = [], update = [] } = req.body;
    let added = 0, updated = 0;

    for (const norm of add) {
      if (!norm.first_name || !norm.last_name) continue;
      const id = uuidv4();
      await execute(
        `INSERT INTO athletes (id,first_name,last_name,ussa_num,fis_id,birth_year,gender,club,division) VALUES (?,?,?,?,?,?,?,?,?)`,
        [id, toNameCase(norm.first_name), toNameCase(norm.last_name), norm.ussa_num||null, norm.fis_id||null, norm.birth_year||null, norm.gender||null, norm.club||null, norm.division||null]
      );
      try { await logAudit('athlete_created', 'athlete', id, null, { source: 'reconcile', first_name: norm.first_name, last_name: norm.last_name }); } catch (_) {}
      added++;
    }

    for (const item of update) {
      if (!item.id || !item.fields || !Object.keys(item.fields).length) continue;
      const ALLOWED = ['first_name','last_name','ussa_num','fis_id','birth_year','gender','club','division'];
      const sets = [], vals = [];
      for (const [f, v] of Object.entries(item.fields)) {
        if (ALLOWED.includes(f)) { sets.push(`${f}=?`); vals.push((f === 'first_name' || f === 'last_name') ? toNameCase(v) : v); }
      }
      if (!sets.length) continue;
      const old = await queryOne('SELECT * FROM athletes WHERE id=?', [item.id]);
      vals.push(item.id);
      await execute(`UPDATE athletes SET ${sets.join(',')} WHERE id=?`, vals);
      const nw = await queryOne('SELECT * FROM athletes WHERE id=?', [item.id]);
      try { await logAudit('athlete_updated', 'athlete', item.id, old, nw); } catch (_) {}
      updated++;
    }

    res.json({ added, updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// POST /api/athletes/usss-sync  -- sync existing athletes with USSS database
// Updates athlete master records from usss_people for athletes with a ussa_num.
// Does NOT add new athletes or modify registrations/scores/run data.
// ---------------------------------------------------------------------------
router.post('/usss-sync', async (req, res) => {
  try {
    const athletes = await queryAll("SELECT * FROM athletes WHERE deleted_at IS NULL AND ussa_num IS NOT NULL AND ussa_num != ''");
    let matched = 0, updated = 0, not_found = 0;

    for (const a of athletes) {
      const usss = await queryOne('SELECT * FROM usss_people WHERE ussa_id = ?', [a.ussa_num]);
      if (!usss) { not_found++; continue; }
      matched++;

      // Check if any fields differ
      const updates = [];
      const vals = [];
      const ncFirst = toNameCase(usss.first_name);
      const ncLast = toNameCase(usss.last_name);
      if (ncFirst && ncFirst !== a.first_name) { updates.push('first_name=?'); vals.push(ncFirst); }
      if (ncLast && ncLast !== a.last_name) { updates.push('last_name=?'); vals.push(ncLast); }
      if (usss.gender && usss.gender !== a.gender) { updates.push('gender=?'); vals.push(usss.gender); }
      if (usss.yob && usss.yob !== a.birth_year) { updates.push('birth_year=?'); vals.push(usss.yob); }
      if (usss.club_name && usss.club_name !== a.club) { updates.push('club=?'); vals.push(usss.club_name); }
      if (usss.fis_id && usss.fis_id !== a.fis_id) { updates.push('fis_id=?'); vals.push(usss.fis_id); }
      if (usss.division && usss.division !== a.division) { updates.push('division=?'); vals.push(usss.division); }

      if (updates.length > 0) {
        vals.push(a.id);
        await execute(`UPDATE athletes SET ${updates.join(',')} WHERE id=?`, vals);
        updated++;
      }
    }

    res.json({ matched, updated, not_found });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
