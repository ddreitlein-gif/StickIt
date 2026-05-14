const express = require('express');
const router = express.Router({ mergeParams: true });
const { queryAll, queryOne, execute, uuidv4, shortCode } = require('../db/schema');
const { calcPaceTime } = require('../scoring/engine');
const { requireAuth } = require('../middleware/auth');

// v1.18.00 — Event Type rules. Centralized so POST/PUT and meets.js share the logic.
const EVENT_TYPES = ['fis_major', 'fis_nac', 'fis_other', 'usa_national', 'usa_regional'];
const REDUCTION_METHODS = ['sum_all', 'drop_high', 'drop_low', 'average'];

function aerialsRulesFor(eventType) {
  switch (eventType) {
    case 'fis_major':
    case 'fis_nac':
      return { panelMin: 5, panelMax: 7, hjMayScore: false };
    case 'fis_other':
      return { panelMin: 5, panelMax: 5, hjMayScore: false };
    case 'usa_national':
      return { panelMin: 2, panelMax: 5, hjMayScore: false };
    case 'usa_regional':
    default:
      return { panelMin: 2, panelMax: 5, hjMayScore: true };
  }
}

function validateAerialsConfig({ event_type, aerials_panel_size, aerials_hj_scores, aerials_reduction_method }) {
  if (!EVENT_TYPES.includes(event_type)) return 'Invalid event_type';
  const rules = aerialsRulesFor(event_type);
  const n = parseInt(aerials_panel_size);
  if (!Number.isFinite(n) || n < rules.panelMin || n > rules.panelMax) {
    return `Scoring judges must be ${rules.panelMin}-${rules.panelMax} for this event type`;
  }
  if (aerials_hj_scores && !rules.hjMayScore) {
    return 'Head Judge scoring is only allowed for USA Regional events';
  }
  if (n <= 4) {
    const m = aerials_reduction_method || 'sum_all';
    if (!REDUCTION_METHODS.includes(m)) return 'Invalid reduction method';
  }
  return null;
}


// After creating an event, inherit course_length and pace_time from the meet's course spec
async function inheritCourseSpec(meetId, eventId, gender) {
  const spec = await queryOne('SELECT * FROM course_specs WHERE meet_id = ? ORDER BY rowid LIMIT 1', [meetId]);
  if (!spec || !spec.length_m) return;
  let pt;
  if (gender === 'F' && spec.pace_time_override_f) {
    pt = spec.pace_time_override_f;
  } else if (gender !== 'F' && spec.pace_time_override_m) {
    pt = spec.pace_time_override_m;
  } else {
    pt = calcPaceTime(spec.length_m, gender, spec.pace_standard || 'usss');
  }
  await execute(
    `UPDATE events SET course_length = ?, pace_time = ?, updated_at = datetime('now') WHERE id = ?`,
    [spec.length_m, pt, eventId]
  );
}

router.get('/', async (req, res) => {
  try {
    const meet = await queryOne('SELECT id FROM meets WHERE id = ?', [req.params.meetId]);
    if (!meet) return res.status(404).json({ error: 'Meet not found' });
    const events = await queryAll(
      `SELECT e.*, (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status != 'scratched') as athlete_count, (SELECT COUNT(*) FROM judges j WHERE j.event_id = e.id) as judge_count FROM events e WHERE e.meet_id = ? ORDER BY e.discipline, e.division, e.gender`,
      [req.params.meetId]
    );
    res.json(events);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const event = await queryOne('SELECT * FROM events WHERE id = ? AND meet_id = ?', [req.params.id, req.params.meetId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const registrations = await queryAll(
      `SELECT r.*, a.first_name, a.last_name, a.ussa_num, a.fis_id, a.nation, a.club, a.birth_year FROM registrations r JOIN athletes a ON a.id = r.athlete_id WHERE r.event_id = ? ORDER BY CASE WHEN r.run_order IS NULL THEN 1 ELSE 0 END, r.run_order, r.bib_number, a.last_name`,
      [req.params.id]
    );
    const judges = await queryAll('SELECT * FROM judges WHERE event_id = ? ORDER BY role', [req.params.id]);
    const meet = await queryOne('SELECT short_code FROM meets WHERE id = ?', [req.params.meetId]);
    res.json({ ...event, meet_short_code: meet ? meet.short_code : null, registrations, judges });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const { discipline, division, gender, name, num_tl_judges=3, num_air_judges=2, num_jumps=2, has_speed=1, turns_weight=0.60, air_weight=0.20, speed_weight=0.20, has_small_final=1, runoff_option, component_scoring, score_entry_mode='tablet', is_divisional=0 } = req.body;
    if (!discipline || !division || !gender || !name) return res.status(400).json({ error: 'discipline, division, gender, and name are required' });

    // Component scoring: default ON for comp_series mogul, OFF for devo/rqs_eqs mogul
    const effectiveComponentScoring = component_scoring !== undefined
      ? parseInt(component_scoring)
      : (discipline === 'mogul' && (division === 'devo' || division === 'rqs_eqs') ? 0 : 1);

    // v1.18.00 — event_type & aerials config
    const event_type = EVENT_TYPES.includes(req.body.event_type) ? req.body.event_type : 'usa_regional';
    let aerials_panel_size = null;
    let aerials_hj_scores = 0;
    let aerials_reduction_method = null;
    if (discipline === 'aerials') {
      const rules = aerialsRulesFor(event_type);
      aerials_panel_size = parseInt(req.body.aerials_panel_size) || rules.panelMin;
      aerials_hj_scores = (rules.hjMayScore && req.body.aerials_hj_scores) ? 1 : 0;
      if (aerials_panel_size <= 4) {
        aerials_reduction_method = REDUCTION_METHODS.includes(req.body.aerials_reduction_method)
          ? req.body.aerials_reduction_method
          : 'sum_all';
      }
      const err = validateAerialsConfig({ event_type, aerials_panel_size, aerials_hj_scores, aerials_reduction_method });
      if (err) return res.status(400).json({ error: err });
    }

    const id = uuidv4();
    await execute(
      `INSERT INTO events (id,meet_id,discipline,division,gender,name,num_tl_judges,num_air_judges,num_jumps,has_speed,turns_weight,air_weight,speed_weight,bracket_size,has_small_final,runoff_option,component_scoring,score_entry_mode,is_divisional,short_code,event_type,aerials_panel_size,aerials_hj_scores,aerials_reduction_method) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, req.params.meetId, discipline, division, gender, name, num_tl_judges, num_air_judges, num_jumps, has_speed, turns_weight, air_weight, speed_weight, 128, has_small_final, runoff_option || 'runoff_to_4th', effectiveComponentScoring, score_entry_mode, is_divisional ? 1 : 0, shortCode(), event_type, aerials_panel_size, aerials_hj_scores, aerials_reduction_method]
    );

    // Inherit course_length and pace_time from meet's course spec
    if (discipline === 'mogul' || discipline === 'dual_mogul') {
      await inheritCourseSpec(req.params.meetId, id, gender);
    }

    res.status(201).json(await queryOne('SELECT * FROM events WHERE id = ?', [id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', requireAuth, async (req, res) => {
  try {
    const event = await queryOne('SELECT * FROM events WHERE id = ? AND meet_id = ?', [req.params.id, req.params.meetId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    // Guard: cannot change component_scoring after scoring has started
    if (req.body.component_scoring !== undefined) {
      const runCount = await queryOne('SELECT COUNT(*) AS cnt FROM runs WHERE event_id = ?', [req.params.id]);
      if (runCount && parseInt(runCount.cnt) > 0) {
        return res.status(400).json({ error: 'Cannot change component scoring after scoring has started' });
      }
    }
    // Guard: cannot change score_entry_mode after scoring has started
    if (req.body.score_entry_mode !== undefined) {
      const runCount = await queryOne('SELECT COUNT(*) AS cnt FROM runs WHERE event_id = ?', [req.params.id]);
      const dualCount = await queryOne(
        'SELECT COUNT(*) AS cnt FROM dual_judge_points djp JOIN dual_bracket db ON db.id = djp.match_id WHERE db.event_id = ?',
        [req.params.id]
      );
      if ((runCount && parseInt(runCount.cnt) > 0) || (dualCount && parseInt(dualCount.cnt) > 0)) {
        return res.status(400).json({ error: 'Cannot change score entry mode after scoring has started' });
      }
    }

    // v1.18.00 — Guard: cannot change event_type or aerials_panel_size after any aerials run is complete
    if (req.body.event_type !== undefined || req.body.aerials_panel_size !== undefined) {
      const completed = await queryOne(
        "SELECT COUNT(*) AS cnt FROM runs WHERE event_id = ? AND status = 'complete'",
        [req.params.id]
      );
      if (completed && parseInt(completed.cnt) > 0) {
        return res.status(400).json({ error: 'Cannot change event type or panel size after scoring has started' });
      }
    }

    // v1.18.00 — Validate aerials config when any aerials field is changing
    if (event.discipline === 'aerials' && (
      req.body.event_type !== undefined ||
      req.body.aerials_panel_size !== undefined ||
      req.body.aerials_hj_scores !== undefined ||
      req.body.aerials_reduction_method !== undefined
    )) {
      const merged = {
        event_type:               req.body.event_type               !== undefined ? req.body.event_type               : event.event_type,
        aerials_panel_size:       req.body.aerials_panel_size       !== undefined ? req.body.aerials_panel_size       : event.aerials_panel_size,
        aerials_hj_scores:        req.body.aerials_hj_scores        !== undefined ? req.body.aerials_hj_scores        : event.aerials_hj_scores,
        aerials_reduction_method: req.body.aerials_reduction_method !== undefined ? req.body.aerials_reduction_method : event.aerials_reduction_method,
      };
      const err = validateAerialsConfig(merged);
      if (err) return res.status(400).json({ error: err });
    }

    // course_length, pace_time, pace_time_override are meet-level (managed via Course Specs) -- not editable per event
    const fields = ['name','num_tl_judges','num_air_judges','num_jumps','has_speed','turns_weight','air_weight','speed_weight','bracket_size','has_small_final','status','usss_code','qualifier_event_id','finals_event_id','runoff_option','score_spread_threshold','event_date','component_scoring','score_entry_mode','is_divisional','order_locked','event_type','aerials_panel_size','aerials_hj_scores','aerials_reduction_method'];
    const updates = [], values = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f}=?`); values.push(req.body[f]); }
    }

    if (updates.length === 0) return res.json(event);
    updates.push(`updated_at=datetime('now')`);
    values.push(req.params.id);
    await execute(`UPDATE events SET ${updates.join(',')} WHERE id=?`, values);
    res.json(await queryOne('SELECT * FROM events WHERE id = ?', [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const eventId = req.params.id;
    const meetId  = req.params.meetId;

    // Verify the event belongs to the meet
    const event = await queryOne('SELECT id FROM events WHERE id = ? AND meet_id = ?', [eventId, meetId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // Delete judge_scores via run IDs
    const runs = await queryAll('SELECT id FROM runs WHERE event_id = ?', [eventId]);
    const runIds = runs.map(r => r.id);
    if (runIds.length > 0) {
      const runPlaceholders = runIds.map(() => '?').join(',');
      await execute(`DELETE FROM judge_scores WHERE run_id IN (${runPlaceholders})`, runIds);
    }

    // Delete dual_judge_points via bracket match IDs
    const matches = await queryAll('SELECT id FROM dual_bracket WHERE event_id = ?', [eventId]);
    const matchIds = matches.map(m => m.id);
    if (matchIds.length > 0) {
      const matchPlaceholders = matchIds.map(() => '?').join(',');
      await execute(`DELETE FROM dual_judge_points WHERE match_id IN (${matchPlaceholders})`, matchIds);
    }

    // Delete direct children
    await execute('DELETE FROM runs WHERE event_id = ?', [eventId]);
    await execute('DELETE FROM registrations WHERE event_id = ?', [eventId]);
    await execute('DELETE FROM judges WHERE event_id = ?', [eventId]);
    await execute('DELETE FROM dual_bracket WHERE event_id = ?', [eventId]);
    await execute('DELETE FROM heats WHERE event_id = ?', [eventId]);
    await execute('DELETE FROM phase_run_order WHERE phase_id IN (SELECT id FROM event_phases WHERE event_id = ?)', [eventId]);
    await execute('DELETE FROM event_phases WHERE event_id = ?', [eventId]);
    await execute('DELETE FROM run_round_status WHERE event_id = ?', [eventId]);

    // Delete the event
    await execute('DELETE FROM events WHERE id = ?', [eventId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
