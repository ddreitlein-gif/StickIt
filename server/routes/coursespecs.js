const router = require('express').Router({ mergeParams: true });
const { queryAll, queryOne, execute, uuidv4 } = require('../db/schema');
const { calcSpeedScore } = require('../scoring/engine');
const { normalizeGender } = require('../utils/gender');

// Pace speed constants by standard
const PACE_SPEEDS = {
  usss: { M: 9.70, F: 8.20 },   // USSS / USA
  fis:  { M: 10.30, F: 9.00 },  // FIS (ICR 4207.2)
};

function calcPaceTime(lengthM, gender, standard) {
  if (!lengthM || lengthM <= 0) return null;
  const speeds = PACE_SPEEDS[standard] || PACE_SPEEDS.usss;
  const speed = gender === 'F' ? speeds.F : speeds.M;
  return Math.floor((lengthM / speed) * 100) / 100;
}

// After course spec saved, update pace_time and course_length on all mogul /
// dual_mogul events under this meet.  Pace time is derived from the meet-level
// course spec (gender-specific overrides take priority over auto-calc).
async function propagatePaceToEvents(meetId, lengthM, overrideM, overrideF, standard) {
  if (!lengthM) return;
  const events = await queryAll(
    `SELECT id, gender, has_speed FROM events WHERE meet_id = ? AND discipline IN ('mogul','dual_mogul')`,
    [meetId]
  );
  for (const ev of events) {
    // Derive pace time from meet-level spec (gender-specific override > auto-calc)
    let pt;
    if (normalizeGender(ev.gender) === 'F' && overrideF) {
      pt = overrideF;
    } else if (normalizeGender(ev.gender) !== 'F' && overrideM) {
      pt = overrideM;
    } else {
      pt = calcPaceTime(lengthM, ev.gender, standard || 'usss');
    }
    if (pt != null) {
      await execute(
        `UPDATE events SET pace_time = ?, course_length = ?, updated_at = datetime('now') WHERE id = ?`,
        [pt, lengthM, ev.id]
      );
      // Recalculate speed scores and totals on all completed runs with a run_time
      if (ev.has_speed) {
        await recalcSpeedScores(ev.id, pt);
      }
    }
  }
}

// Recalculate speed_score and total_score for all completed runs in an event
// when pace_time changes.  Turns and air scores are pace-independent.
async function recalcSpeedScores(eventId, newPaceTime) {
  const runs = await queryAll(
    `SELECT id, run_time, turns_score, air_score FROM runs WHERE event_id = ? AND status = 'complete' AND run_time IS NOT NULL AND run_status IS NULL`,
    [eventId]
  );
  for (const r of runs) {
    const newSpeed = calcSpeedScore(r.run_time, newPaceTime);
    const newTotal = Math.floor(((r.turns_score || 0) + (r.air_score || 0) + newSpeed) * 100) / 100;
    await execute(
      `UPDATE runs SET speed_score = ?, total_score = ?, updated_at = datetime('now') WHERE id = ?`,
      [newSpeed, newTotal, r.id]
    );
  }
}

// GET the single course spec for a meet (returns object or null)
router.get('/', async (req, res) => {
  try {
    const spec = await queryOne(
      'SELECT * FROM course_specs WHERE meet_id = ? ORDER BY rowid LIMIT 1',
      [req.params.meetId]
    );
    if (spec) {
      const std = spec.pace_standard || 'usss';
      spec.calc_pace_m = calcPaceTime(spec.length_m, 'M', std);
      spec.calc_pace_f = calcPaceTime(spec.length_m, 'F', std);
    }
    res.json(spec || null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT create-or-update the single course spec for the meet
router.put('/', async (req, res) => {
  try {
    const { course_name, width_m, length_m, pitch_deg, pace_time_override_m, pace_time_override_f, pace_standard } = req.body;

    const existing = await queryOne(
      'SELECT * FROM course_specs WHERE meet_id = ? ORDER BY rowid LIMIT 1',
      [req.params.meetId]
    );

    const nameVal   = course_name != null ? course_name.trim() || null : null;
    const widthVal  = width_m  != null ? parseFloat(width_m)  : null;
    const lengthVal = length_m != null ? parseFloat(length_m) : null;
    const pitchVal  = pitch_deg != null ? parseFloat(pitch_deg) : null;
    const overrideM = pace_time_override_m != null ? parseFloat(pace_time_override_m) : null;
    const overrideF = pace_time_override_f != null ? parseFloat(pace_time_override_f) : null;
    const stdVal    = pace_standard === 'fis' ? 'fis' : 'usss';

    let id;
    if (existing) {
      id = existing.id;
      await execute(
        `UPDATE course_specs SET
           course_name = ?,
           width_m     = ?,
           length_m    = ?,
           pitch_deg   = ?,
           pace_time_override_m = ?,
           pace_time_override_f = ?,
           pace_standard = ?
         WHERE id = ?`,
        [nameVal, widthVal, lengthVal, pitchVal, overrideM, overrideF, stdVal, id]
      );
    } else {
      id = uuidv4();
      await execute(
        `INSERT INTO course_specs (id, meet_id, course_name, width_m, length_m, pitch_deg, pace_time_override_m, pace_time_override_f, pace_standard)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, req.params.meetId, nameVal, widthVal, lengthVal, pitchVal, overrideM, overrideF, stdVal]
      );
    }

    // Propagate pace time to all mogul/dual_mogul events
    await propagatePaceToEvents(req.params.meetId, lengthVal, overrideM, overrideF, stdVal);

    const spec = await queryOne('SELECT * FROM course_specs WHERE id = ?', [id]);
    spec.calc_pace_m = calcPaceTime(spec.length_m, 'M', stdVal);
    spec.calc_pace_f = calcPaceTime(spec.length_m, 'F', stdVal);
    res.json(spec);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Legacy POST -- treat as create-or-update of the single course spec
router.post('/', async (req, res) => {
  // Forward to the PUT handler logic
  const { course_name, width_m, length_m, pitch_deg, pace_time_override_m, pace_time_override_f, pace_standard } = req.body;
  req.body = { course_name, width_m, length_m, pitch_deg, pace_time_override_m, pace_time_override_f, pace_standard };

  const existing = await queryOne(
    'SELECT * FROM course_specs WHERE meet_id = ? ORDER BY rowid LIMIT 1',
    [req.params.meetId]
  ).catch(() => null);

  // Delete any extra rows beyond the first (enforce single-course constraint)
  try {
    const all = await queryAll('SELECT id FROM course_specs WHERE meet_id = ? ORDER BY rowid', [req.params.meetId]);
    if (all.length > 1) {
      for (let i = 1; i < all.length; i++) {
        await execute('DELETE FROM course_specs WHERE id = ?', [all[i].id]);
      }
    }
  } catch (_) {}

  // Reuse PUT handler
  try {
    const nameVal   = course_name != null ? String(course_name).trim() || null : null;
    const widthVal  = width_m  != null ? parseFloat(width_m)  : null;
    const lengthVal = length_m != null ? parseFloat(length_m) : null;
    const pitchVal  = pitch_deg != null ? parseFloat(pitch_deg) : null;
    const overrideM = pace_time_override_m != null ? parseFloat(pace_time_override_m) : null;
    const overrideF = pace_time_override_f != null ? parseFloat(pace_time_override_f) : null;
    const stdVal    = pace_standard === 'fis' ? 'fis' : 'usss';

    let id;
    if (existing) {
      id = existing.id;
      await execute(
        `UPDATE course_specs SET course_name=?, width_m=?, length_m=?, pitch_deg=?, pace_time_override_m=?, pace_time_override_f=?, pace_standard=? WHERE id=?`,
        [nameVal, widthVal, lengthVal, pitchVal, overrideM, overrideF, stdVal, id]
      );
    } else {
      id = uuidv4();
      await execute(
        `INSERT INTO course_specs (id, meet_id, course_name, width_m, length_m, pitch_deg, pace_time_override_m, pace_time_override_f, pace_standard) VALUES (?,?,?,?,?,?,?,?,?)`,
        [id, req.params.meetId, nameVal, widthVal, lengthVal, pitchVal, overrideM, overrideF, stdVal]
      );
    }

    await propagatePaceToEvents(req.params.meetId, lengthVal, overrideM, overrideF, stdVal);

    const spec = await queryOne('SELECT * FROM course_specs WHERE id = ?', [id]);
    spec.calc_pace_m = calcPaceTime(spec.length_m, 'M', stdVal);
    spec.calc_pace_f = calcPaceTime(spec.length_m, 'F', stdVal);
    res.status(201).json(spec);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Legacy per-id PUT -- redirect to the single-course PUT
router.put('/:id', async (req, res) => {
  try {
    const { width_m, length_m, pitch_deg, pace_time_override_m, pace_time_override_f, pace_standard } = req.body;

    const widthVal  = width_m  != null ? parseFloat(width_m)  : null;
    const lengthVal = length_m != null ? parseFloat(length_m) : null;
    const pitchVal  = pitch_deg != null ? parseFloat(pitch_deg) : null;
    const overrideM = pace_time_override_m != null ? parseFloat(pace_time_override_m) : null;
    const overrideF = pace_time_override_f != null ? parseFloat(pace_time_override_f) : null;
    const stdVal    = pace_standard === 'fis' ? 'fis' : 'usss';

    await execute(
      `UPDATE course_specs SET width_m=?, length_m=?, pitch_deg=?, pace_time_override_m=?, pace_time_override_f=?, pace_standard=? WHERE id=? AND meet_id=?`,
      [widthVal, lengthVal, pitchVal, overrideM, overrideF, stdVal, req.params.id, req.params.meetId]
    );

    await propagatePaceToEvents(req.params.meetId, lengthVal, overrideM, overrideF, stdVal);

    const spec = await queryOne('SELECT * FROM course_specs WHERE id = ?', [req.params.id]);
    spec.calc_pace_m = calcPaceTime(spec.length_m, 'M', stdVal);
    spec.calc_pace_f = calcPaceTime(spec.length_m, 'F', stdVal);
    res.json(spec);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE the course spec
router.delete('/:id', async (req, res) => {
  try {
    await execute('DELETE FROM course_specs WHERE id = ? AND meet_id = ?',
      [req.params.id, req.params.meetId]);

    // After deleting the course spec, check whether a remaining spec exists.
    // If none exists, clear pace_time and course_length on all mogul/dual_mogul
    // events under this meet so they are not left with stale values.
    // If another spec exists (should be rare given the single-spec constraint),
    // re-propagate from it so events stay consistent.
    const remaining = await queryOne(
      'SELECT * FROM course_specs WHERE meet_id = ? ORDER BY rowid LIMIT 1',
      [req.params.meetId]
    );
    if (!remaining) {
      // No spec left -- clear course_length and pace_time from all events
      await execute(
        `UPDATE events SET course_length = NULL, pace_time = NULL, updated_at = datetime('now')
         WHERE meet_id = ? AND discipline IN ('mogul','dual_mogul')`,
        [req.params.meetId]
      );
    } else {
      // A spec still exists -- propagate from it so events are consistent.
      await propagatePaceToEvents(
        req.params.meetId,
        remaining.length_m,
        remaining.pace_time_override_m,
        remaining.pace_time_override_f,
        remaining.pace_standard || 'usss'
      );
    }

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
