const router = require('express').Router();
const { queryAll, queryOne, execute, uuidv4 } = require('../db/schema');
const { logAudit } = require('./audit');
const { parseFileAsync, normalizeRow } = require('./reconcileHelpers');
const R = require('../import/registrationImport');

// v2.7.00 — USSS People File lookup (the step the athlete-only importers
// lacked): a row without a USSS # is looked up by name (gender, then a shared
// club word as tie-breakers); a row with one gets its blank birth year / club /
// FIS id filled. Index built once per import.
async function loadPeopleIndex() {
  try {
    const people = await queryAll("SELECT ussa_id, type, last_name, first_name, division, gender, yob, club_name, fis_id FROM usss_people WHERE type IN ('C','CO')");
    return R.buildPeopleIndex(people);
  } catch (_) { return null; }
}

function enrichFromUsss(norm, peopleIndex) {
  if (!peopleIndex || !peopleIndex.count) return;
  const { person } = R.lookupUsssPerson(peopleIndex, norm);
  if (person) R.enrichFromPerson(norm, person);
}

/** Read the whole request body as bytes (CSV text or an XLSX upload). */
function readBodyBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Import a single row:
//   - Match by ussa_num, fis_id, or name
//   - UPDATE existing: only overwrite non-blank incoming fields
//   - Preserve existing bib if import row has blank bib
//   - CREATE if no match found
// ---------------------------------------------------------------------------
async function importRow(norm, eventId) {
  const { first_name, last_name, ussa_num, fis_id, nation, club, gender, birth_year, bib } = norm;

  if (!first_name || !last_name) {
    return { status: 'skipped', reason: 'Missing first or last name' };
  }

  const gen    = gender || null;
  const by     = birth_year || null;
  const bibNum = bib ? (parseInt(bib, 10) || null) : null;

  // Locate existing athlete
  let existing = null;
  if (ussa_num) {
    existing = await queryOne('SELECT * FROM athletes WHERE TRIM(ussa_num)=?', [ussa_num]);
  }
  if (!existing && fis_id) {
    existing = await queryOne('SELECT * FROM athletes WHERE TRIM(fis_id)=?', [fis_id]);
  }
  if (!existing) {
    existing = await queryOne(
      `SELECT * FROM athletes
       WHERE LOWER(TRIM(first_name))=LOWER(?) AND LOWER(TRIM(last_name))=LOWER(?)`,
      [first_name, last_name]
    );
  }

  // v2.0.00 (FR-8) -- an athlete registered in an adopted meet is locked on
  // the cloud; skip the update rather than silently diverging from the venue.
  if (existing) {
    const { isAthleteAdoptionLocked } = require('../sync/adoption');
    if (await isAthleteAdoptionLocked(existing.id)) {
      return { status: 'skipped', reason: 'Athlete is registered in a meet currently adopted by a venue server (locked)' };
    }
  }

  if (existing) {
    // Merge: overwrite only with non-blank incoming values
    await execute(
      `UPDATE athletes SET
         first_name = ?,
         last_name  = ?,
         ussa_num   = CASE WHEN ? != '' THEN ? ELSE ussa_num END,
         fis_id     = CASE WHEN ? != '' THEN ? ELSE fis_id END,
         nation     = CASE WHEN ? != '' THEN ? ELSE nation END,
         club       = CASE WHEN ? != '' THEN ? ELSE club END,
         gender     = CASE WHEN ? IS NOT NULL THEN ? ELSE gender END,
         birth_year = CASE WHEN ? IS NOT NULL THEN ? ELSE birth_year END,
         bib        = CASE WHEN ? IS NOT NULL THEN ? ELSE bib END,
         updated_at = datetime('now')
       WHERE id = ?`,
      [
        first_name, last_name,
        ussa_num,   ussa_num,
        fis_id,     fis_id,
        nation,     nation,
        club,       club,
        gen,        gen,
        by,         by,
        bibNum,     bibNum,
        existing.id,
      ]
    );

    // Update registration bib only if eventId provided and import bib is non-blank
    if (eventId && bib) {
      const reg = await queryOne(
        `SELECT id FROM registrations WHERE event_id=? AND athlete_id=?`,
        [eventId, existing.id]
      );
      if (reg) {
        await execute(
          `UPDATE registrations SET bib_number=?, updated_at=datetime('now') WHERE id=?`,
          [bib, reg.id]
        );
      }
    }

    return { status: 'updated', id: existing.id, name: `${first_name} ${last_name}` };
  }

  // No existing match -- create new athlete
  const id = uuidv4();
  await execute(
    `INSERT INTO athletes
       (id, first_name, last_name, ussa_num, fis_id, nation, club, gender, birth_year)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      id, first_name, last_name,
      ussa_num   || null,
      fis_id     || null,
      nation     || null,
      club       || null,
      gen, by,
    ]
  );
  return { status: 'added', id, name: `${first_name} ${last_name}` };
}

// ---------------------------------------------------------------------------
// Shared: run import for an array of raw row objects
// ---------------------------------------------------------------------------
async function runImport(rows, eventId) {
  const summary = { added: 0, updated: 0, skipped: 0, errors: [], total: rows.length };
  const peopleIndex = await loadPeopleIndex();

  for (const raw of rows) {
    try {
      const norm   = normalizeRow(raw);
      enrichFromUsss(norm, peopleIndex);
      const result = await importRow(norm, eventId || null);
      if      (result.status === 'added')   summary.added++;
      else if (result.status === 'updated') summary.updated++;
      else {
        summary.skipped++;
        if (result.reason) {
          summary.errors.push({
            name:   `${raw.first_name || raw.last_name || '(unknown)'}`,
            reason: result.reason,
          });
        }
      }
    } catch (e) {
      summary.errors.push({ name: '(row error)', reason: e.message });
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// POST /api/import/athletes  -- JSON body: { rows: [...], eventId? }
// ---------------------------------------------------------------------------
router.post('/athletes', async (req, res) => {
  try {
    const { rows, eventId } = req.body;
    if (!rows || !Array.isArray(rows))
      return res.status(400).json({ error: 'rows array required' });
    // v2.0.00 -- refuse imports that target an event of an adopted meet
    if (eventId) {
      const { meetIdForEvent, isMeetAdopted } = require('../sync/adoption');
      if (await isMeetAdopted(await meetIdForEvent(eventId))) {
        return res.status(423).json({ error: 'meet_adopted', message: 'This event belongs to a meet adopted by a venue server; enter registrations on the venue server instead.' });
      }
    }
    const summary = await runImport(rows, eventId || null);
    try { await logAudit('import', 'athletes', null, null, { added: summary.added, updated: summary.updated, total: summary.total }); } catch (_) {}
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/import/athletes/csv  -- raw CSV text body
// Optional query: ?eventId=xxx  (updates bib numbers in registrations)
// ---------------------------------------------------------------------------
// v2.7.00 — body is raw bytes: CSV text (as before) or an XLSX workbook; the
// client names the file in X-File-Name (or ?filename=) so XLSX is recognised.
router.post('/athletes/csv', async (req, res) => {
  try {
    const buffer = await readBodyBuffer(req);
    if (!buffer.length || (!R.parseFile && !buffer.toString('utf8').trim())) return res.status(400).json({ error: 'Empty CSV' });
    const filename = decodeURIComponent(String(req.get('x-file-name') || req.query.filename || 'upload.csv'));
    if (!/\.xlsx$/i.test(filename) && !buffer.toString('utf8').trim()) return res.status(400).json({ error: 'Empty CSV' });

    let parsedFile;
    try {
      parsedFile = await parseFileAsync(buffer, filename);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    if (parsedFile.error) return res.status(400).json({ error: parsedFile.error });
    const { rows } = parsedFile;
    if (!rows.length) return res.status(400).json({ error: 'No data rows found in CSV' });

    const eventId = req.query.eventId || null;
    // v2.0.00 -- refuse imports that target an event of an adopted meet
    if (eventId) {
      const { meetIdForEvent, isMeetAdopted } = require('../sync/adoption');
      if (await isMeetAdopted(await meetIdForEvent(eventId))) {
        return res.status(423).json({ error: 'meet_adopted', message: 'This event belongs to a meet adopted by a venue server; enter registrations on the venue server instead.' });
      }
    }
    const summary = await runImport(rows, eventId);
    try { await logAudit('import', 'athletes', null, null, { added: summary.added, updated: summary.updated, total: summary.total, eventId }); } catch (_) {}
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
