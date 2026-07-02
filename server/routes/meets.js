const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const multer = require('multer');
const { queryAll, queryOne, execute, uuidv4, shortCode } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { VERSION } = require('../version');
const EXPORT_VERSION = VERSION.replace(/^v/, '');

const MEET_LOGOS_DIR = path.join(__dirname, '..', 'data', 'logos');
const importUpload = multer({ dest: path.join(__dirname, '..', 'data', 'tmp'), limits: { fileSize: 50 * 1024 * 1024 } });
// recordWrite is not called directly here; the autosave middleware in index.js
// accounts for all successful write requests automatically.

router.get('/', async (req, res) => {
  try {
    const excludeLocked = req.query.excludeLocked === '1';
    const lockedFilter = excludeLocked ? ' AND locked = 0' : '';
    let sql = `SELECT m.*, (SELECT COUNT(*) FROM events WHERE meet_id = m.id${lockedFilter}) as event_count FROM meets m`;
    if (excludeLocked) {
      // Hide meets where all events are locked (but keep meets with zero total events)
      sql += ` WHERE (SELECT COUNT(*) FROM events WHERE meet_id = m.id AND locked = 0) > 0 OR (SELECT COUNT(*) FROM events WHERE meet_id = m.id) = 0`;
    }
    sql += ` ORDER BY m.date DESC, m.created_at DESC`;
    const meets = await queryAll(sql);
    res.json(meets);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Live Scores public listing ──────────────────────────────────────────────
router.get('/livescores', async (req, res) => {
  try {
    const { division, page = 1, limit = 10 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(50, parseInt(limit, 10) || 10));

    // v1.25.02 -- exclude meets whose every event is hidden from Live Scores
    // (zero-event meets keep current behavior and still appear)
    const visClause = `((SELECT COUNT(*) FROM events WHERE meet_id = m.id AND hide_livescores = 0) > 0
        OR (SELECT COUNT(*) FROM events WHERE meet_id = m.id) = 0)`;
    let meetWhere = `WHERE ${visClause}`;
    const meetParams = [];
    if (division) {
      meetWhere = `WHERE m.meet_ranking = ? AND ${visClause}`;
      meetParams.push(division);
    }

    const countRow = await queryOne(`SELECT COUNT(*) as cnt FROM meets m ${meetWhere}`, meetParams);
    const totalMeets = countRow ? countRow.cnt : 0;
    const totalPages = Math.ceil(totalMeets / limitNum) || 1;
    const offset = (pageNum - 1) * limitNum;

    const meets = await queryAll(
      `SELECT m.* FROM meets m ${meetWhere} ORDER BY m.date DESC, m.created_at DESC LIMIT ? OFFSET ?`,
      [...meetParams, limitNum, offset]
    );

    const meetIds = meets.map(m => m.id);
    let events = [];
    if (meetIds.length > 0) {
      const placeholders = meetIds.map(() => '?').join(',');
      events = await queryAll(
        `SELECT e.id, e.meet_id, e.name, e.discipline, e.division, e.gender, e.status, e.short_code
         FROM events e WHERE e.meet_id IN (${placeholders}) AND e.hide_livescores = 0
         ORDER BY e.discipline, e.gender`,
        meetIds
      );
    }

    const eventsByMeet = {};
    for (const e of events) {
      if (!eventsByMeet[e.meet_id]) eventsByMeet[e.meet_id] = [];
      eventsByMeet[e.meet_id].push(e);
    }

    const result = meets.map(m => ({
      ...m,
      events: eventsByMeet[m.id] || []
    }));

    res.json({ meets: result, page: pageNum, totalPages, totalMeets });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /export-all — bundle all currently-visible meets into a zip-of-zips
// Must be registered before /:id so Express doesn't treat "export-all" as a meet ID.
router.get('/export-all', requireAuth, async (req, res) => {
  try {
    const meets = await queryAll(
      `SELECT m.* FROM meets m
       WHERE (SELECT COUNT(*) FROM events WHERE meet_id = m.id AND locked = 0) > 0
          OR (SELECT COUNT(*) FROM events WHERE meet_id = m.id) = 0
       ORDER BY m.date DESC, m.created_at DESC`
    );

    const outerZip = new AdmZip();
    const manifestMeets = [];

    for (const m of meets) {
      const built = await buildMeetExportZip(m.id);
      if (!built) continue;
      const childName = `meet_${m.id}.zip`;
      outerZip.addFile(childName, built.buffer);
      manifestMeets.push({
        filename: childName,
        meet_id: m.id,
        name: m.name,
        location: m.location,
        date: m.date,
        meet_ranking: m.meet_ranking,
      });
    }

    const manifest = {
      stickit_version: EXPORT_VERSION,
      export_date: new Date().toISOString(),
      meet_count: manifestMeets.length,
      meets: manifestMeets,
    };
    outerZip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));

    const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="StickIt_AllMeets_${dateStamp}.zip"`);
    res.send(outerZip.toBuffer());
  } catch (e) {
    console.error('meet export-all error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const meet = await queryOne('SELECT * FROM meets WHERE id = ?', [req.params.id]);
    if (!meet) return res.status(404).json({ error: 'Meet not found' });
    const excludeLocked = req.query.excludeLocked === '1';
    const lockedFilter = excludeLocked ? ' AND e.locked = 0' : '';
    const events = await queryAll(`SELECT e.*, (SELECT COUNT(*) FROM registrations WHERE event_id = e.id AND status != 'scratched') as athlete_count, (SELECT COUNT(*) FROM judges WHERE event_id = e.id) as judge_count, (CASE WHEN EXISTS (SELECT 1 FROM runs WHERE event_id = e.id) THEN 1 ELSE 0 END) as has_runs FROM events e WHERE e.meet_id = ?${lockedFilter} ORDER BY e.discipline, e.division, e.gender`, [req.params.id]);
    res.json({ ...meet, events });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, location, date, meet_ranking } = req.body;
    if (!name || !location || !date || !meet_ranking) return res.status(400).json({ error: 'name, location, date, and meet_ranking are required' });
    const id = uuidv4();
    await execute('INSERT INTO meets (id, name, location, date, short_code, meet_ranking) VALUES (?, ?, ?, ?, ?, ?)', [id, name.trim(), location.trim(), date, shortCode(), meet_ranking.trim()]);
    const meet = await queryOne('SELECT * FROM meets WHERE id = ?', [id]);
    res.status(201).json(meet);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', requireAuth, async (req, res) => {
  try {
    const meet = await queryOne('SELECT * FROM meets WHERE id = ?', [req.params.id]);
    if (!meet) return res.status(404).json({ error: 'Meet not found' });
    const { name, location, date, status, meet_ranking } = req.body;
    await execute(`UPDATE meets SET name=COALESCE(?,name), location=COALESCE(?,location), date=COALESCE(?,date), status=COALESCE(?,status), updated_at=datetime('now') WHERE id=?`,
      [name||null, location||null, date||null, status||null, req.params.id]);
    if (meet_ranking !== undefined) {
      await execute(`UPDATE meets SET meet_ranking=?, updated_at=datetime('now') WHERE id=?`, [meet_ranking, req.params.id]);
    }
    res.json(await queryOne('SELECT * FROM meets WHERE id = ?', [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Shared helper: delete a meet and all its child data
async function deleteMeetCascade(meetId) {
  const events = await queryAll('SELECT id FROM events WHERE meet_id = ?', [meetId]);
  const eventIds = events.map(e => e.id);

  if (eventIds.length > 0) {
    for (const eid of eventIds) {
      // Judge scores
      const runs = await queryAll('SELECT id FROM runs WHERE event_id = ?', [eid]);
      const runIds = runs.map(r => r.id);
      if (runIds.length > 0) {
        const ph = runIds.map(() => '?').join(',');
        await execute(`DELETE FROM judge_scores WHERE run_id IN (${ph})`, runIds);
      }
      // Dual judge points
      const matches = await queryAll('SELECT id FROM dual_bracket WHERE event_id = ?', [eid]);
      const matchIds = matches.map(m => m.id);
      if (matchIds.length > 0) {
        const ph = matchIds.map(() => '?').join(',');
        await execute(`DELETE FROM dual_judge_points WHERE match_id IN (${ph})`, matchIds);
      }
      // Phase run order (via event_phases)
      const phases = await queryAll('SELECT id FROM event_phases WHERE event_id = ?', [eid]);
      for (const p of phases) {
        await execute('DELETE FROM phase_run_order WHERE phase_id = ?', [p.id]);
      }
      await execute('DELETE FROM event_phases WHERE event_id = ?', [eid]);
      await execute('DELETE FROM run_round_status WHERE event_id = ?', [eid]);
      await execute('DELETE FROM runs WHERE event_id = ?', [eid]);
      await execute('DELETE FROM registrations WHERE event_id = ?', [eid]);
      await execute('DELETE FROM judges WHERE event_id = ?', [eid]);
      await execute('DELETE FROM dual_bracket WHERE event_id = ?', [eid]);
      await execute('DELETE FROM heats WHERE event_id = ?', [eid]);
    }
    const ph = eventIds.map(() => '?').join(',');
    await execute(`DELETE FROM events WHERE id IN (${ph})`, eventIds);
  }

  await execute('DELETE FROM officials WHERE meet_id = ?', [meetId]);
  await execute('DELETE FROM course_specs WHERE meet_id = ?', [meetId]);

  // Training days + per-day exclusions
  const trainingDays = await queryAll('SELECT id FROM training_days WHERE meet_id = ?', [meetId]);
  for (const td of trainingDays) {
    await execute('DELETE FROM training_day_exclusions WHERE training_day_id = ?', [td.id]);
  }
  await execute('DELETE FROM training_days WHERE meet_id = ?', [meetId]);

  // Delete meet logo if present
  for (const ext of ['.png', '.jpg', '.jpeg']) {
    const logoPath = path.join(MEET_LOGOS_DIR, `meet_${meetId}${ext}`);
    if (fs.existsSync(logoPath)) { try { fs.unlinkSync(logoPath); } catch {} }
  }

  await execute('DELETE FROM meets WHERE id = ?', [meetId]);
}

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await deleteMeetCascade(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/meets/:id/status -- per-event scoring progress for the meet dashboard
router.get('/:id/status', async (req, res) => {
  try {
    const meet = await queryOne('SELECT * FROM meets WHERE id = ?', [req.params.id]);
    if (!meet) return res.status(404).json({ error: 'Meet not found' });

    const events = await queryAll(
      `SELECT e.*, (SELECT COUNT(*) FROM registrations WHERE event_id = e.id AND status NOT IN ('scratched','dns')) as reg_total
       FROM events e WHERE e.meet_id = ? ORDER BY e.discipline, e.division, e.gender`,
      [req.params.id]
    );

    const summaries = await Promise.all(events.map(async (ev) => {
      // Registration counts by gender
      const regM = await queryOne(
        `SELECT COUNT(*) as cnt FROM registrations r JOIN athletes a ON a.id = r.athlete_id
         WHERE r.event_id = ? AND a.gender = 'M' AND r.status NOT IN ('scratched','dns')`,
        [ev.id]
      );
      const regF = await queryOne(
        `SELECT COUNT(*) as cnt FROM registrations r JOIN athletes a ON a.id = r.athlete_id
         WHERE r.event_id = ? AND a.gender = 'F' AND r.status NOT IN ('scratched','dns')`,
        [ev.id]
      );

      // Runs with a completed score this round (most recent round with runs)
      const latestRound = await queryOne(
        `SELECT round FROM runs WHERE event_id = ? AND total_score IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
        [ev.id]
      );
      const round = latestRound ? latestRound.round : 'qualification';

      const scoredM = await queryOne(
        `SELECT COUNT(DISTINCT r.registration_id) as cnt
         FROM runs r JOIN registrations reg ON reg.id = r.registration_id
         JOIN athletes a ON a.id = reg.athlete_id
         WHERE r.event_id = ? AND r.round = ? AND r.total_score IS NOT NULL AND a.gender = 'M'`,
        [ev.id, round]
      );
      const scoredF = await queryOne(
        `SELECT COUNT(DISTINCT r.registration_id) as cnt
         FROM runs r JOIN registrations reg ON reg.id = r.registration_id
         JOIN athletes a ON a.id = reg.athlete_id
         WHERE r.event_id = ? AND r.round = ? AND r.total_score IS NOT NULL AND a.gender = 'F'`,
        [ev.id, round]
      );

      const regMcount = parseInt(regM.cnt) || 0;
      const regFcount = parseInt(regF.cnt) || 0;
      const scoredMcount = parseInt(scoredM.cnt) || 0;
      const scoredFcount = parseInt(scoredF.cnt) || 0;

      // Current leader (highest total_score this round)
      const leader = await queryOne(
        `SELECT a.first_name, a.last_name, MAX(r.total_score) as best_score
         FROM runs r
         JOIN registrations reg ON reg.id = r.registration_id
         JOIN athletes a ON a.id = reg.athlete_id
         WHERE r.event_id = ? AND r.round = ? AND r.total_score IS NOT NULL
         GROUP BY a.id ORDER BY best_score DESC LIMIT 1`,
        [ev.id, round]
      );

      return {
        event_id:     ev.id,
        name:         ev.name,
        discipline:   ev.discipline,
        division:     ev.division,
        gender:       ev.gender,
        status:       ev.status,
        round,
        reg_male:     regMcount,
        reg_female:   regFcount,
        reg_total:    regMcount + regFcount,
        scored_male:  scoredMcount,
        scored_female: scoredFcount,
        remaining_male:   Math.max(0, regMcount - scoredMcount),
        remaining_female: Math.max(0, regFcount - scoredFcount),
        leader_name:  leader ? `${leader.first_name} ${leader.last_name}` : null,
        leader_score: leader ? leader.best_score : null,
      };
    }));

    res.json({ meet, events: summaries });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/meets/:id/clone -- create a new meet copying events and optionally registrations
router.post('/:id/clone', requireAuth, async (req, res) => {
  try {
    const source = await queryOne('SELECT * FROM meets WHERE id = ?', [req.params.id]);
    if (!source) return res.status(404).json({ error: 'Meet not found' });

    const { name, date, location, includeAthletes = false } = req.body;
    if (!name || !date || !location) {
      return res.status(400).json({ error: 'name, date, and location are required' });
    }

    const newMeetId = uuidv4();
    await execute(
      `INSERT INTO meets (id, name, location, date, status, short_code) VALUES (?, ?, ?, ?, 'setup', ?)`,
      [newMeetId, name.trim(), location.trim(), date, shortCode()]
    );
    // recordWrite() is intentionally omitted here -- the middleware accounts for
    // this POST request automatically on success.  Extra manual calls would
    // double-count this request in the autosave write counter.

    const sourceEvents = await queryAll(
      `SELECT * FROM events WHERE meet_id = ? ORDER BY created_at`,
      [req.params.id]
    );

    for (const ev of sourceEvents) {
      const newEventId = uuidv4();
      await execute(
        `INSERT INTO events
           (id, meet_id, discipline, division, gender, name, status,
            num_tl_judges, num_air_judges, has_speed,
            turns_weight, air_weight, speed_weight,
            pace_time, course_length, bracket_size, has_small_final,
            usss_code, runoff_option, dual_seed_method,
            event_type, aerials_panel_size, aerials_hj_scores, aerials_reduction_method)
         VALUES (?,?,?,?,?,?,  'setup', ?,?,?, ?,?,?, ?,?, ?,?, ?, ?,?, ?,?,?,?)`,
        [
          newEventId, newMeetId,
          ev.discipline, ev.division, ev.gender, ev.name,
          ev.num_tl_judges, ev.num_air_judges, ev.has_speed,
          ev.turns_weight, ev.air_weight, ev.speed_weight,
          ev.pace_time || null, ev.course_length || null,
          ev.bracket_size || null, ev.has_small_final,
          ev.usss_code || null,
          ev.runoff_option || 'runoff_to_4th', ev.dual_seed_method || 'random',
          ev.event_type || 'usa_regional',
          ev.aerials_panel_size || null,
          ev.aerials_hj_scores || 0,
          ev.aerials_reduction_method || null,
        ]
      );
      // recordWrite() is intentionally omitted here -- the middleware handles
      // write counting for the outer POST /clone request.

      if (includeAthletes) {
        const regs = await queryAll(
          `SELECT * FROM registrations WHERE event_id = ? AND status != 'scratched' ORDER BY run_order, bib_number`,
          [ev.id]
        );
        for (const reg of regs) {
          await execute(
            `INSERT INTO registrations (id, event_id, athlete_id, bib_number, seed, status, run_order)
             VALUES (?, ?, ?, ?, ?, 'registered', ?)`,
            [uuidv4(), newEventId, reg.athlete_id, reg.bib_number || null, reg.seed || null, reg.run_order || null]
          );
        }
        // recordWrite() omitted -- same reason as above.
      }
    }

    // Clone the course spec if one exists for the source meet.
    const sourceSpec = await queryOne(
      'SELECT * FROM course_specs WHERE meet_id = ? ORDER BY rowid LIMIT 1',
      [req.params.id]
    );
    if (sourceSpec) {
      await execute(
        `INSERT INTO course_specs (id, meet_id, width_m, length_m, pitch_deg, pace_time_override_m, pace_time_override_f, pace_standard)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), newMeetId, sourceSpec.width_m, sourceSpec.length_m, sourceSpec.pitch_deg,
         sourceSpec.pace_time_override_m, sourceSpec.pace_time_override_f, sourceSpec.pace_standard ?? 'usss']
      );
    }

    const newMeet = await queryOne('SELECT * FROM meets WHERE id = ?', [newMeetId]);
    const newEvents = await queryAll(
      `SELECT e.*, (SELECT COUNT(*) FROM registrations WHERE event_id = e.id AND status != 'scratched') as athlete_count
       FROM events e WHERE e.meet_id = ? ORDER BY e.discipline, e.division, e.gender`,
      [newMeetId]
    );

    res.status(201).json({ ...newMeet, events: newEvents });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── v1.4 Feature 4: Close Meet and Export to USSS ─────────────────────────
const archiver = require('archiver');
const transmit = require('./transmit');
const { logAudit } = require('./audit');

const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'meet';
const todayStamp = () => {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}-${dd}-${yy}`;
};

const CATEGORY_MAP = { N: 'Nonscored', U: 'Scored', A: 'Aerials', C: 'Canadian' };

async function buildCloseValidation(meetId) {
  const meet = await queryOne('SELECT * FROM meets WHERE id=?', [meetId]);
  if (!meet) return { error: 'Meet not found', status: 404 };

  const events = await queryAll('SELECT * FROM events WHERE meet_id=? ORDER BY discipline, gender, division', [meetId]);

  // Derive codex letter from the first event's USSS code (e.g. "U23458" → "U")
  const firstCodex = events.find(e => e.usss_code && String(e.usss_code).trim());
  const letter = firstCodex ? String(firstCodex.usss_code).trim().charAt(0).toUpperCase() : '';
  if (!CATEGORY_MAP[letter]) {
    return {
      error: `Unrecognized USSS codex letter '${letter}'. Event USSS codes must begin with N (nonscored), U (scored), A (aerials), or C (Canadian). Please set a valid USSS code on at least one event and try again.`,
      status: 400,
    };
  }
  const category = CATEGORY_MAP[letter];
  const officials = await queryAll('SELECT * FROM officials WHERE meet_id=?', [meetId]);

  const problemsByEvent = {};
  const addProblem = (evId, evName, msg) => {
    if (!problemsByEvent[evId]) problemsByEvent[evId] = { eventName: evName, problems: [] };
    problemsByEvent[evId].problems.push(msg);
  };

  for (const ev of events) {
    const codex = ev.usss_code;
    if (!codex || !String(codex).trim()) {
      addProblem(ev.id, ev.name, 'Missing USSS event code');
    }
    const td = officials.find(o => o.event_id === ev.id && o.role === 'Technical Delegate');
    if (!td) {
      addProblem(ev.id, ev.name, 'No Technical Delegate assigned');
    }
    const regCount = await queryOne('SELECT COUNT(*) as cnt FROM registrations WHERE event_id=?', [ev.id]);
    if (!regCount || parseInt(regCount.cnt) === 0) {
      addProblem(ev.id, ev.name, 'No registered athletes');
    }
    if (ev.discipline === 'dual_mogul') {
      const matchCount = await queryOne(`SELECT COUNT(*) as cnt FROM dual_bracket WHERE event_id=? AND status='complete'`, [ev.id]);
      if (!matchCount || parseInt(matchCount.cnt) === 0) {
        addProblem(ev.id, ev.name, 'No completed dual matches');
      }
    } else {
      const runCount = await queryOne(`SELECT COUNT(*) as cnt FROM runs WHERE event_id=? AND status='complete'`, [ev.id]);
      if (!runCount || parseInt(runCount.cnt) === 0) {
        addProblem(ev.id, ev.name, 'No completed runs');
      }
    }
  }

  return {
    meet, category, letter, events, officials,
    problems: Object.values(problemsByEvent),
  };
}

router.get('/:id/close-validation', async (req, res) => {
  try {
    const v = await buildCloseValidation(req.params.id);
    if (v.error) return res.status(v.status).json({ error: v.error });
    res.json({ category: v.category, problems: v.problems });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/reopen', requireAuth, async (req, res) => {
  try {
    const meet = await queryOne('SELECT * FROM meets WHERE id=?', [req.params.id]);
    if (!meet) return res.status(404).json({ error: 'Meet not found' });
    await execute(`UPDATE meets SET status='active', updated_at=datetime('now') WHERE id=?`, [req.params.id]);
    await execute(`UPDATE events SET status='active', updated_at=datetime('now') WHERE meet_id=?`, [req.params.id]);
    try { await logAudit('meet_reopened', 'meet', req.params.id, null, {}); } catch (_) {}
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/close', requireAuth, async (req, res) => {
  try {
    const force = req.query.force === 'true';
    const v = await buildCloseValidation(req.params.id);
    if (v.error) return res.status(v.status).json({ error: v.error });

    if (v.problems.length > 0 && !force) {
      return res.status(400).json({ problems: v.problems });
    }

    const { meet, category, events, officials } = v;
    const { rankResults } = require('../scoring/engine');

    const xmlFiles = [];
    for (const ev of events) {
      const codex = ev.usss_code;
      const natCode = (codex || '').trim();
      if (!natCode) continue;

      const td = officials.find(o => o.event_id === ev.id && o.role === 'Technical Delegate');
      const tdInfo = td ? {
        lastName:  td.last_name || td.lastName || '',
        firstName: td.first_name || td.firstName || '',
        usssNum:   td.ussa_id || td.usss_num || '',
      } : { lastName: '', firstName: '', usssNum: '' };

      try {
        if (ev.discipline === 'dual_mogul') {
          const bracket = await queryAll(
            `SELECT db.*,
               rb.bib_number as blue_bib, rb.athlete_id as blue_athlete_id,
               rr.bib_number as red_bib, rr.athlete_id as red_athlete_id,
               ab.first_name as blue_first, ab.last_name as blue_last, ab.ussa_num as blue_ussa,
               ab.birth_year as blue_birth_year, ab.nation as blue_nation,
               ar.first_name as red_first, ar.last_name as red_last, ar.ussa_num as red_ussa,
               ar.birth_year as red_birth_year, ar.nation as red_nation
             FROM dual_bracket db
             LEFT JOIN registrations rb ON rb.id = db.registration_id_blue
             LEFT JOIN athletes ab ON ab.id = rb.athlete_id
             LEFT JOIN registrations rr ON rr.id = db.registration_id_red
             LEFT JOIN athletes ar ON ar.id = rr.athlete_id
             WHERE db.event_id=?
             ORDER BY db.bracket_round DESC, db.bracket_position`,
            [ev.id]
          );
          const completeMatches = bracket.filter(m => m.status === 'complete');
          if (completeMatches.length === 0) continue;

          const judges = await queryAll('SELECT * FROM judges WHERE event_id=?', [ev.id]);
          const regs = await queryAll(
            `SELECT reg.*, a.first_name, a.last_name, a.ussa_num, a.birth_year, a.nation
             FROM registrations reg JOIN athletes a ON a.id = reg.athlete_id WHERE reg.event_id=?`,
            [ev.id]
          );

          const judgePointsMap = await transmit.buildJudgePointsMap(bracket);

          const xml = transmit.generateDualMogulXml({
            meet, event: ev, bracket, registrations: regs, judges, officials,
            natCode, category, tdInfo, judgePointsMap,
          });
          xmlFiles.push({ fileName: `${slugify(ev.name)}_${ev.gender}_${natCode}.xml`, xml });
        } else {
          const completeRuns = await queryAll(
            `SELECT r.*, reg.bib_number, reg.seed, a.first_name, a.last_name,
                    a.ussa_num, a.birth_year, a.nation, a.gender as athlete_gender
             FROM runs r
             JOIN registrations reg ON reg.id = r.registration_id
             JOIN athletes a ON a.id = reg.athlete_id
             WHERE r.event_id=? AND r.status='complete' AND r.round='qualification'`,
            [ev.id]
          );
          if (completeRuns.length === 0) continue;

          const judges = await queryAll('SELECT * FROM judges WHERE event_id=?', [ev.id]);

          const athleteRuns = {};
          for (const r of completeRuns) {
            if (r.run_status) continue;
            if (!athleteRuns[r.registration_id]) {
              athleteRuns[r.registration_id] = { ...r, _run1_total: null, _run2_total: null };
            }
            if (r.run_number === 1) {
              athleteRuns[r.registration_id]._run1_total = r.total_score;
              if (!athleteRuns[r.registration_id].total_score || r.total_score > athleteRuns[r.registration_id].total_score) {
                Object.assign(athleteRuns[r.registration_id], r);
              }
            } else if (r.run_number === 2) {
              athleteRuns[r.registration_id]._run2_total = r.total_score;
              if (r.total_score > athleteRuns[r.registration_id].total_score) {
                Object.assign(athleteRuns[r.registration_id], r);
              }
            }
          }
          for (const data of Object.values(athleteRuns)) {
            if (data._run1_total == null && data._run2_total == null) {
              if (data.run_number === 1) data._run1_total = data.total_score;
              else data._run2_total = data.total_score;
            }
            if (data._run1_total == null) data._run1_total = 0;
            if (data._run2_total == null) data._run2_total = 0;
          }
          const ranked = rankResults(Object.values(athleteRuns), ev.discipline);

          const xml = transmit.generateSingleMogulXml({
            meet, event: ev, ranked, judges, officials,
            natCode, category, tdInfo,
          });
          xmlFiles.push({ fileName: `${slugify(ev.name)}_${ev.gender}_${natCode}.xml`, xml });
        }
      } catch (perEventErr) {
        console.error(`close: error generating XML for event ${ev.id}:`, perEventErr);
      }
    }

    await execute(`UPDATE meets SET status='complete', updated_at=datetime('now') WHERE id=?`, [req.params.id]);
    await execute(`UPDATE events SET status='complete', updated_at=datetime('now') WHERE meet_id=?`, [req.params.id]);
    try {
      await logAudit('meet_closed_and_exported', 'meet', req.params.id, null, {
        category, files: xmlFiles.map(f => f.fileName),
        overrideProblems: force ? v.problems : [],
      });
    } catch (_) {}

    const zipName = `${slugify(meet.name)}_USSS_Transmit_${todayStamp()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);
    for (const f of xmlFiles) archive.append(Buffer.from(f.xml, 'utf8'), { name: f.fileName });
    await archive.finalize();
  } catch (e) {
    console.error('close meet error:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});


// ---------------------------------------------------------------------------
// GET /:id/export — export entire meet as ZIP
// ---------------------------------------------------------------------------
async function buildMeetExportZip(meetId) {
  const meet = await queryOne('SELECT * FROM meets WHERE id=?', [meetId]);
  if (!meet) return null;

  const events = await queryAll('SELECT * FROM events WHERE meet_id=?', [meetId]);
  const eventIds = events.map(e => e.id);

  // Collect all data
  let registrations = [], athletes = [], judges = [], runs = [], judgeScores = [];
  let dualBracket = [], dualJudgePoints = [], heats = [], eventPhases = [], phaseRunOrder = [];
  let runRoundStatus = [];

  if (eventIds.length > 0) {
    const ph = eventIds.map(() => '?').join(',');
    registrations = await queryAll(`SELECT * FROM registrations WHERE event_id IN (${ph})`, eventIds);
    judges = await queryAll(`SELECT * FROM judges WHERE event_id IN (${ph})`, eventIds);
    runs = await queryAll(`SELECT * FROM runs WHERE event_id IN (${ph})`, eventIds);
    dualBracket = await queryAll(`SELECT * FROM dual_bracket WHERE event_id IN (${ph})`, eventIds);
    heats = await queryAll(`SELECT * FROM heats WHERE event_id IN (${ph})`, eventIds);
    eventPhases = await queryAll(`SELECT * FROM event_phases WHERE event_id IN (${ph})`, eventIds);
    runRoundStatus = await queryAll(`SELECT * FROM run_round_status WHERE event_id IN (${ph})`, eventIds);

    const runIds = runs.map(r => r.id);
    if (runIds.length > 0) {
      const rph = runIds.map(() => '?').join(',');
      judgeScores = await queryAll(`SELECT * FROM judge_scores WHERE run_id IN (${rph})`, runIds);
    }

    const matchIds = dualBracket.map(m => m.id);
    if (matchIds.length > 0) {
      const mph = matchIds.map(() => '?').join(',');
      dualJudgePoints = await queryAll(`SELECT * FROM dual_judge_points WHERE match_id IN (${mph})`, matchIds);
    }

    const phaseIds = eventPhases.map(p => p.id);
    if (phaseIds.length > 0) {
      const pph = phaseIds.map(() => '?').join(',');
      phaseRunOrder = await queryAll(`SELECT * FROM phase_run_order WHERE phase_id IN (${pph})`, phaseIds);
    }

    const athleteIds = [...new Set(registrations.map(r => r.athlete_id))];
    if (athleteIds.length > 0) {
      const aph = athleteIds.map(() => '?').join(',');
      athletes = await queryAll(`SELECT * FROM athletes WHERE id IN (${aph})`, athleteIds);
    }
  }

  const officials = await queryAll(`SELECT * FROM officials WHERE meet_id=?`, [meetId]);
  const courseSpecs = await queryAll(`SELECT * FROM course_specs WHERE meet_id=?`, [meetId]);

  // v1.25.01 — training days + per-day exclusions round-trip
  const trainingDays = await queryAll(`SELECT * FROM training_days WHERE meet_id=?`, [meetId]);
  let trainingDayExclusions = [];
  const tdIds = trainingDays.map(t => t.id);
  if (tdIds.length > 0) {
    const tph = tdIds.map(() => '?').join(',');
    trainingDayExclusions = await queryAll(`SELECT * FROM training_day_exclusions WHERE training_day_id IN (${tph})`, tdIds);
  }

  const exportData = {
    stickit_version: EXPORT_VERSION,
    export_date: new Date().toISOString(),
    meet,
    events,
    athletes,
    registrations,
    judges,
    officials,
    course_specs: courseSpecs,
    runs,
    judge_scores: judgeScores,
    dual_bracket: dualBracket,
    dual_judge_points: dualJudgePoints,
    heats,
    event_phases: eventPhases,
    phase_run_order: phaseRunOrder,
    run_round_status: runRoundStatus,
    training_days: trainingDays,
    training_day_exclusions: trainingDayExclusions,
  };

  const zip = new AdmZip();
  zip.addFile('meet_export.json', Buffer.from(JSON.stringify(exportData, null, 2)));

  for (const ext of ['.png', '.jpg', '.jpeg']) {
    const logoPath = path.join(MEET_LOGOS_DIR, `meet_${meetId}${ext}`);
    if (fs.existsSync(logoPath)) {
      zip.addLocalFile(logoPath, '', `meet_logo${ext}`);
      break;
    }
  }

  const safeName = (meet.name || 'meet').replace(/[^a-zA-Z0-9_-]/g, '_');
  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return {
    buffer: zip.toBuffer(),
    filename: `${safeName}_Export_${dateStamp}.zip`,
    meet,
  };
}

router.get('/:id/export', requireAuth, async (req, res) => {
  try {
    const result = await buildMeetExportZip(req.params.id);
    if (!result) return res.status(404).json({ error: 'Meet not found' });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.buffer);
  } catch (e) {
    console.error('meet export error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// GET /export-all — bundle all currently-visible meets into a zip-of-zips
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Import helpers: pending cache, executeImport, executeMerge
// ---------------------------------------------------------------------------
const pendingImports = new Map(); // pendingId -> { data, zipPath, timestamp }
// Cleanup every 10 minutes: evict pending imports older than 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingImports) {
    if (now - v.timestamp > 30 * 60 * 1000) {
      try { fs.unlinkSync(v.zipPath); } catch {}
      pendingImports.delete(k);
    }
  }
}, 10 * 60 * 1000);

// Deduplicate athletes: match existing by USSA#, FIS ID, or name+DOB; create new otherwise
async function deduplicateAthletes(athletes) {
  const athleteMap = {};
  for (const a of (athletes || [])) {
    let existingId = null;
    if (a.ussa_num) {
      const existing = await queryOne('SELECT id FROM athletes WHERE ussa_num=?', [a.ussa_num]);
      if (existing) existingId = existing.id;
    }
    if (!existingId && a.fis_id) {
      const existing = await queryOne('SELECT id FROM athletes WHERE fis_id=?', [a.fis_id]);
      if (existing) existingId = existing.id;
    }
    if (!existingId && a.first_name && a.last_name) {
      const existing = await queryOne(
        'SELECT id FROM athletes WHERE first_name=? AND last_name=? AND birth_year=?',
        [a.first_name, a.last_name, a.birth_year || null]
      );
      if (existing) existingId = existing.id;
    }
    if (existingId) {
      athleteMap[a.id] = existingId;
    } else {
      const newId = uuidv4();
      athleteMap[a.id] = newId;
      await execute(
        `INSERT INTO athletes (id, ussa_num, fis_id, first_name, last_name, birth_year, gender, club, nation, bib, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [newId, a.ussa_num || null, a.fis_id || null, a.first_name, a.last_name,
         a.birth_year || null, a.gender || null, a.club || null, a.nation || null, a.bib || null]
      );
    }
  }
  return athleteMap;
}

// Copy logo from ZIP to the logos directory for a given meetId
function copyLogoFromZip(zipPath, meetId) {
  try {
    const zip = new AdmZip(zipPath);
    for (const ext of ['.png', '.jpg', '.jpeg']) {
      const logoEntry = zip.getEntry(`meet_logo${ext}`);
      if (logoEntry) {
        if (!fs.existsSync(MEET_LOGOS_DIR)) fs.mkdirSync(MEET_LOGOS_DIR, { recursive: true });
        fs.writeFileSync(path.join(MEET_LOGOS_DIR, `meet_${meetId}${ext}`), logoEntry.getData());
        break;
      }
    }
  } catch {}
}

// Execute a fresh import (creates new meet with new IDs)
async function executeImport(data, zipPath, opts = {}) {
  const meetName = opts.meetNameOverride || data.meet.name || 'Imported Meet';
  const athleteMap = await deduplicateAthletes(data.athletes);
  const eventMap = {}, regMap = {}, judgeMap = {}, heatMap = {}, phaseMap = {}, bracketMap = {}, runMap = {};
  const trainingDayMap = {};

  const newMeetId = uuidv4();
  for (const e of (data.events || [])) eventMap[e.id] = uuidv4();
  for (const r of (data.registrations || [])) regMap[r.id] = uuidv4();
  for (const j of (data.judges || [])) judgeMap[j.id] = uuidv4();
  for (const h of (data.heats || [])) heatMap[h.id] = uuidv4();
  for (const p of (data.event_phases || [])) phaseMap[p.id] = uuidv4();
  for (const b of (data.dual_bracket || [])) bracketMap[b.id] = uuidv4();
  for (const r of (data.runs || [])) runMap[r.id] = uuidv4();

  // Insert meet
  const m = data.meet;
  await execute(
    `INSERT INTO meets (id, name, location, date, status, meet_ranking, short_code, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [newMeetId, meetName, m.location ?? '', m.date ?? '', m.status ?? 'setup', m.meet_ranking ?? null, shortCode()]
  );

  // Insert events
  for (const e of (data.events || [])) {
    await execute(
      `INSERT INTO events (id, meet_id, discipline, division, gender, name, status,
        num_tl_judges, num_air_judges, has_speed, turns_weight, air_weight, speed_weight,
        pace_time, bracket_size, has_small_final, usss_code, runoff_option, dual_seed_method,
        score_spread_threshold, component_scoring, score_entry_mode, course_length,
        qualifier_event_id, finals_event_id, event_date, num_jumps, is_divisional, locked,
        short_code, pace_time_override, dual_random_seed, order_locked, hide_livescores,
        event_type, aerials_panel_size, aerials_hj_scores, aerials_reduction_method,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [eventMap[e.id], newMeetId, e.discipline ?? null, e.division ?? null, e.gender ?? null, e.name ?? 'Unnamed Event', e.status ?? 'setup',
       e.num_tl_judges ?? 3, e.num_air_judges ?? 2, e.has_speed ?? 1,
       e.turns_weight ?? 0.6, e.air_weight ?? 0.2, e.speed_weight ?? 0.2,
       e.pace_time ?? null, e.bracket_size ?? 128, e.has_small_final ?? 1,
       e.usss_code ?? null, e.runoff_option ?? 'runoff_to_4th', e.dual_seed_method ?? 'random',
       e.score_spread_threshold ?? 2.0, e.component_scoring ?? 1, e.score_entry_mode ?? 'tablet',
       e.course_length ?? null,
       e.qualifier_event_id ? (eventMap[e.qualifier_event_id] ?? null) : null,
       e.finals_event_id ? (eventMap[e.finals_event_id] ?? null) : null,
       e.event_date ?? null, e.num_jumps ?? 2, e.is_divisional ?? 0, e.locked ?? 0,
       shortCode(), e.pace_time_override ?? null, e.dual_random_seed ?? null, e.order_locked ?? 0, e.hide_livescores ?? 0,
       e.event_type ?? 'usa_regional', e.aerials_panel_size ?? null, e.aerials_hj_scores ?? 0, e.aerials_reduction_method ?? null]
    );
  }

  // Insert registrations
  for (const r of (data.registrations || [])) {
    await execute(
      `INSERT INTO registrations (id, event_id, athlete_id, bib_number, seed, status, run_order,
        heat_id, round_scratched, dual_seed, dual_seed_source, dual_seed_source_value, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [regMap[r.id], eventMap[r.event_id] ?? null, athleteMap[r.athlete_id] ?? null,
       r.bib_number ?? null, r.seed ?? null, r.status ?? 'registered', r.run_order ?? null,
       r.heat_id ? (heatMap[r.heat_id] ?? null) : null, r.round_scratched ?? null,
       r.dual_seed ?? null, r.dual_seed_source ?? null, r.dual_seed_source_value ?? null]
    );
  }

  // Insert judges
  for (const j of (data.judges || [])) {
    await execute(
      `INSERT INTO judges (id, event_id, name, role, pin, ussa_id, short_code, judge_number, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [judgeMap[j.id], eventMap[j.event_id] ?? null, j.name ?? '', j.role ?? '', j.pin ?? null, j.ussa_id ?? null, shortCode(), j.judge_number ?? null]
    );
  }

  // Insert officials
  for (const o of (data.officials || [])) {
    await execute(
      `INSERT INTO officials (id, meet_id, event_id, role, name, ussa_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), newMeetId, o.event_id ? (eventMap[o.event_id] ?? null) : null,
       o.role ?? '', o.name ?? '', o.ussa_id ?? null]
    );
  }

  // Insert course specs
  for (const cs of (data.course_specs || [])) {
    await execute(
      `INSERT INTO course_specs (id, meet_id, course_name, width_m, length_m, pitch_deg, pace_time_override_m, pace_time_override_f, pace_standard)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), newMeetId, cs.course_name ?? null, cs.width_m ?? null, cs.length_m ?? null,
       cs.pitch_deg ?? null, cs.pace_time_override_m ?? null, cs.pace_time_override_f ?? null, cs.pace_standard ?? 'usss']
    );
  }

  // Insert training days + per-day exclusions (v1.25.01)
  for (const td of (data.training_days || [])) {
    const newTdId = uuidv4();
    trainingDayMap[td.id] = newTdId;
    await execute(
      `INSERT INTO training_days (id, meet_id, name, date, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [newTdId, newMeetId, td.name ?? '', td.date ?? null]
    );
  }
  for (const tde of (data.training_day_exclusions || [])) {
    const newTdId = trainingDayMap[tde.training_day_id];
    const newAthleteId = athleteMap[tde.athlete_id];
    if (!newTdId || !newAthleteId) continue; // skip orphaned exclusion rows
    await execute(
      `INSERT OR IGNORE INTO training_day_exclusions (training_day_id, athlete_id) VALUES (?, ?)`,
      [newTdId, newAthleteId]
    );
  }

  // Insert heats
  for (const h of (data.heats || [])) {
    await execute(
      `INSERT INTO heats (id, event_id, heat_number, heat_name, round, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [heatMap[h.id], eventMap[h.event_id] ?? null, h.heat_number ?? 1, h.heat_name ?? null, h.round ?? 'qualification']
    );
  }

  // Insert event phases
  for (const p of (data.event_phases || [])) {
    await execute(
      `INSERT INTO event_phases (id, event_id, phase_type, run_number, label, run_order_method,
        pass_through_count, final_size, q2_field_limit, status, review_message, sequence_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [phaseMap[p.id], eventMap[p.event_id] ?? null, p.phase_type ?? null, p.run_number ?? 1, p.label ?? null,
       p.run_order_method ?? 'same', p.pass_through_count ?? null, p.final_size ?? null,
       p.q2_field_limit ?? null,
       p.status ?? 'not_started', p.review_message ?? null, p.sequence_order ?? 0]
    );
  }

  // Insert phase run order
  for (const pro of (data.phase_run_order || [])) {
    const mappedPhase = phaseMap[pro.phase_id] ?? null;
    const mappedReg = regMap[pro.registration_id] ?? null;
    if (!mappedPhase || !mappedReg) continue;
    await execute(
      `INSERT INTO phase_run_order (id, phase_id, registration_id, run_order) VALUES (?, ?, ?, ?)`,
      [uuidv4(), mappedPhase, mappedReg, pro.run_order ?? null]
    );
  }

  // Insert run round status
  for (const rrs of (data.run_round_status || [])) {
    const mappedEvent = eventMap[rrs.event_id] ?? null;
    if (!mappedEvent) continue;
    await execute(
      `INSERT OR IGNORE INTO run_round_status (event_id, run_number, status, review_message, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [mappedEvent, rrs.run_number ?? 1, rrs.status ?? 'not_started', rrs.review_message ?? null]
    );
  }

  // Insert runs
  for (const r of (data.runs || [])) {
    const mappedReg = regMap[r.registration_id] ?? null;
    if (!mappedReg) continue;
    await execute(
      `INSERT INTO runs (id, event_id, registration_id, run_number, round,
        bracket_round, bracket_position, course,
        jump1_code, jump1_dd, jump2_code, jump2_dd,
        turns_score, air_score, air_score_no_dd, speed_score, total_score, run_time,
        status, run_status, hj_pending,
        tl_carving, tl_abext, tl_upper_body, tl_deduction,
        manually_entered, aerials_model, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [runMap[r.id], eventMap[r.event_id] ?? null, mappedReg,
       r.run_number ?? 1, r.round ?? 'qualification',
       r.bracket_round ?? null, r.bracket_position ?? null, r.course ?? null,
       r.jump1_code ?? null, r.jump1_dd ?? null, r.jump2_code ?? null, r.jump2_dd ?? null,
       r.turns_score ?? null, r.air_score ?? null, r.air_score_no_dd ?? null, r.speed_score ?? null, r.total_score ?? null,
       r.run_time ?? null, r.status ?? 'pending', r.run_status ?? null, r.hj_pending ?? 0,
       r.tl_carving ?? null, r.tl_abext ?? null, r.tl_upper_body ?? null, r.tl_deduction ?? null,
       r.manually_entered ?? 0, r.aerials_model ?? null]
    );
  }

  // Insert judge scores
  for (const js of (data.judge_scores || [])) {
    const mappedRun = runMap[js.run_id] ?? null;
    const mappedJudge = judgeMap[js.judge_id] ?? null;
    if (!mappedRun || !mappedJudge) continue;
    await execute(
      `INSERT INTO judge_scores (id, run_id, judge_id, score_type, raw_score,
        tl_carving, tl_abext, tl_upper_body, tl_deduction, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [uuidv4(), mappedRun, mappedJudge,
       js.score_type ?? 'tl', js.raw_score ?? 0,
       js.tl_carving ?? null, js.tl_abext ?? null, js.tl_upper_body ?? null, js.tl_deduction ?? null]
    );
  }

  // Insert dual bracket
  for (const b of (data.dual_bracket || [])) {
    await execute(
      `INSERT INTO dual_bracket (id, event_id, bracket_round, bracket_position,
        registration_id_blue, registration_id_red, winner_registration_id,
        status, is_small_final, seed_blue, seed_red, is_bye, loser_status,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [bracketMap[b.id], eventMap[b.event_id] ?? null, b.bracket_round ?? 1, b.bracket_position ?? 1,
       b.registration_id_blue ? (regMap[b.registration_id_blue] ?? null) : null,
       b.registration_id_red ? (regMap[b.registration_id_red] ?? null) : null,
       b.winner_registration_id ? (regMap[b.winner_registration_id] ?? null) : null,
       b.status ?? 'pending', b.is_small_final ?? 0, b.seed_blue ?? null, b.seed_red ?? null,
       b.is_bye ?? 0, b.loser_status ?? null]
    );
  }

  // Insert dual judge points
  for (const djp of (data.dual_judge_points || [])) {
    const mappedMatch = bracketMap[djp.match_id] ?? null;
    if (!mappedMatch) continue;
    await execute(
      `INSERT INTO dual_judge_points (id, match_id, judge_number, blue_points, red_points, time_tied, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [uuidv4(), mappedMatch, djp.judge_number ?? 1,
       djp.blue_points ?? 0, djp.red_points ?? 0, djp.time_tied ?? 0]
    );
  }

  // Copy logo
  copyLogoFromZip(zipPath, newMeetId);

  return {
    meetId: newMeetId,
    summary: {
      events: (data.events || []).length,
      athletes: (data.athletes || []).length,
      registrations: (data.registrations || []).length,
      runs: (data.runs || []).length,
      dualMatches: (data.dual_bracket || []).length,
    },
  };
}

// Helper: is timestamp A newer than B? (both ISO date strings or null)
function isNewer(a, b) {
  if (!a) return false;
  if (!b) return true;
  return new Date(a) > new Date(b);
}

// Merge import data into an existing meet
async function executeMerge(existingMeetId, data, zipPath) {
  const summary = { events_added: 0, events_updated: 0, registrations_added: 0, registrations_updated: 0,
    runs_added: 0, runs_updated: 0, judges_added: 0, judges_updated: 0 };

  const existingMeet = await queryOne('SELECT * FROM meets WHERE id=?', [existingMeetId]);
  if (!existingMeet) throw new Error('Existing meet not found');

  // 1. Update meet record if import is newer
  const m = data.meet;
  if (isNewer(m.updated_at, existingMeet.updated_at)) {
    await execute(
      `UPDATE meets SET name=?, location=?, date=?, status=?, meet_ranking=?, updated_at=datetime('now') WHERE id=?`,
      [m.name ?? existingMeet.name, m.location ?? existingMeet.location, m.date ?? existingMeet.date,
       m.status ?? existingMeet.status, m.meet_ranking ?? existingMeet.meet_ranking, existingMeetId]
    );
  }

  // 2. Deduplicate athletes
  const athleteMap = await deduplicateAthletes(data.athletes);

  // 3. Match events by discipline + gender
  const existingEvents = await queryAll('SELECT * FROM events WHERE meet_id=?', [existingMeetId]);
  const eventMap = {};
  const eventIsNewer = {}; // track whether import event is newer per event id

  for (const ie of (data.events || [])) {
    // Try to find matching existing event
    const candidates = existingEvents.filter(ee => ee.discipline === ie.discipline && ee.gender === ie.gender);
    let match = null;
    if (candidates.length === 1) {
      match = candidates[0];
    } else if (candidates.length > 1) {
      // Multiple matches — also compare name
      match = candidates.find(ee => ee.name === ie.name) || null;
    }

    if (match) {
      eventMap[ie.id] = match.id;
      eventIsNewer[ie.id] = isNewer(ie.updated_at, match.updated_at);
      if (eventIsNewer[ie.id]) {
        await execute(
          `UPDATE events SET name=?, status=?, division=?,
            num_tl_judges=?, num_air_judges=?, has_speed=?, turns_weight=?, air_weight=?, speed_weight=?,
            pace_time=?, bracket_size=?, has_small_final=?, usss_code=?, runoff_option=?, dual_seed_method=?,
            score_spread_threshold=?, component_scoring=?, score_entry_mode=?, course_length=?,
            event_date=?, num_jumps=?, is_divisional=?, pace_time_override=?, dual_random_seed=?, order_locked=?,
            hide_livescores=?,
            updated_at=datetime('now') WHERE id=?`,
          [ie.name ?? match.name, ie.status ?? match.status, ie.division ?? match.division,
           ie.num_tl_judges ?? match.num_tl_judges, ie.num_air_judges ?? match.num_air_judges, ie.has_speed ?? match.has_speed,
           ie.turns_weight ?? match.turns_weight, ie.air_weight ?? match.air_weight, ie.speed_weight ?? match.speed_weight,
           ie.pace_time ?? match.pace_time, ie.bracket_size ?? match.bracket_size, ie.has_small_final ?? match.has_small_final,
           ie.usss_code ?? match.usss_code, ie.runoff_option ?? match.runoff_option, ie.dual_seed_method ?? match.dual_seed_method,
           ie.score_spread_threshold ?? match.score_spread_threshold, ie.component_scoring ?? match.component_scoring,
           ie.score_entry_mode ?? match.score_entry_mode, ie.course_length ?? match.course_length,
           ie.event_date ?? match.event_date, ie.num_jumps ?? match.num_jumps, ie.is_divisional ?? match.is_divisional,
           ie.pace_time_override ?? match.pace_time_override, ie.dual_random_seed ?? match.dual_random_seed,
           ie.order_locked ?? match.order_locked, ie.hide_livescores ?? match.hide_livescores, match.id]
        );
        summary.events_updated++;
      }
    } else {
      // New event — insert
      const newId = uuidv4();
      eventMap[ie.id] = newId;
      eventIsNewer[ie.id] = true;
      await execute(
        `INSERT INTO events (id, meet_id, discipline, division, gender, name, status,
          num_tl_judges, num_air_judges, has_speed, turns_weight, air_weight, speed_weight,
          pace_time, bracket_size, has_small_final, usss_code, runoff_option, dual_seed_method,
          score_spread_threshold, component_scoring, score_entry_mode, course_length,
          qualifier_event_id, finals_event_id, event_date, num_jumps, is_divisional, locked,
          short_code, pace_time_override, dual_random_seed, order_locked, hide_livescores,
          event_type, aerials_panel_size, aerials_hj_scores, aerials_reduction_method,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [newId, existingMeetId, ie.discipline ?? null, ie.division ?? null, ie.gender ?? null, ie.name ?? 'Unnamed Event', ie.status ?? 'setup',
         ie.num_tl_judges ?? 3, ie.num_air_judges ?? 2, ie.has_speed ?? 1,
         ie.turns_weight ?? 0.6, ie.air_weight ?? 0.2, ie.speed_weight ?? 0.2,
         ie.pace_time ?? null, ie.bracket_size ?? 128, ie.has_small_final ?? 1,
         ie.usss_code ?? null, ie.runoff_option ?? 'runoff_to_4th', ie.dual_seed_method ?? 'random',
         ie.score_spread_threshold ?? 2.0, ie.component_scoring ?? 1, ie.score_entry_mode ?? 'tablet',
         ie.course_length ?? null, null, null,
         ie.event_date ?? null, ie.num_jumps ?? 2, ie.is_divisional ?? 0, ie.locked ?? 0,
         shortCode(), ie.pace_time_override ?? null, ie.dual_random_seed ?? null, ie.order_locked ?? 0, ie.hide_livescores ?? 0,
         ie.event_type ?? 'usa_regional', ie.aerials_panel_size ?? null, ie.aerials_hj_scores ?? 0, ie.aerials_reduction_method ?? null]
      );
      summary.events_added++;
    }
  }

  // 4. Registrations — match by event_id + athlete_id
  const regMap = {};
  for (const r of (data.registrations || [])) {
    const mappedEvent = eventMap[r.event_id] ?? null;
    const mappedAthlete = athleteMap[r.athlete_id] ?? null;
    if (!mappedEvent || !mappedAthlete) continue;
    const existing = await queryOne('SELECT id FROM registrations WHERE event_id=? AND athlete_id=?', [mappedEvent, mappedAthlete]);
    if (existing) {
      regMap[r.id] = existing.id;
      if (eventIsNewer[r.event_id]) {
        await execute(
          `UPDATE registrations SET bib_number=COALESCE(?,bib_number), seed=COALESCE(?,seed),
           status=COALESCE(?,status), run_order=COALESCE(?,run_order),
           dual_seed=COALESCE(?,dual_seed), dual_seed_source=COALESCE(?,dual_seed_source),
           dual_seed_source_value=COALESCE(?,dual_seed_source_value) WHERE id=?`,
          [r.bib_number ?? null, r.seed ?? null, r.status ?? null, r.run_order ?? null,
           r.dual_seed ?? null, r.dual_seed_source ?? null, r.dual_seed_source_value ?? null, existing.id]
        );
        summary.registrations_updated++;
      }
    } else {
      const newId = uuidv4();
      regMap[r.id] = newId;
      await execute(
        `INSERT INTO registrations (id, event_id, athlete_id, bib_number, seed, status, run_order,
          heat_id, round_scratched, dual_seed, dual_seed_source, dual_seed_source_value, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [newId, mappedEvent, mappedAthlete,
         r.bib_number ?? null, r.seed ?? null, r.status ?? 'registered', r.run_order ?? null,
         null, r.round_scratched ?? null,
         r.dual_seed ?? null, r.dual_seed_source ?? null, r.dual_seed_source_value ?? null]
      );
      summary.registrations_added++;
    }
  }

  // 5. Judges — match by event_id + role
  const judgeMap = {};
  for (const j of (data.judges || [])) {
    const mappedEvent = eventMap[j.event_id] ?? null;
    if (!mappedEvent) continue;
    const existing = await queryOne('SELECT id FROM judges WHERE event_id=? AND role=?', [mappedEvent, j.role]);
    if (existing) {
      judgeMap[j.id] = existing.id;
      await execute(`UPDATE judges SET name=COALESCE(?,name), pin=COALESCE(?,pin), ussa_id=COALESCE(?,ussa_id) WHERE id=?`,
        [j.name ?? null, j.pin ?? null, j.ussa_id ?? null, existing.id]);
      summary.judges_updated++;
    } else {
      const newId = uuidv4();
      judgeMap[j.id] = newId;
      await execute(
        `INSERT INTO judges (id, event_id, name, role, pin, ussa_id, short_code, judge_number, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [newId, mappedEvent, j.name ?? '', j.role ?? '', j.pin ?? null, j.ussa_id ?? null, shortCode(), j.judge_number ?? null]
      );
      summary.judges_added++;
    }
  }

  // 6. Officials — match by meet_id + event_id + role
  for (const o of (data.officials || [])) {
    const mappedEvent = o.event_id ? (eventMap[o.event_id] ?? null) : null;
    const existing = await queryOne(
      `SELECT id FROM officials WHERE meet_id=? AND COALESCE(event_id,'')=COALESCE(?,'') AND role=?`,
      [existingMeetId, mappedEvent, o.role ?? '']
    );
    if (existing) {
      await execute(`UPDATE officials SET name=COALESCE(?,name), ussa_id=COALESCE(?,ussa_id) WHERE id=?`,
        [o.name ?? null, o.ussa_id ?? null, existing.id]);
    } else {
      await execute(
        `INSERT INTO officials (id, meet_id, event_id, role, name, ussa_id) VALUES (?, ?, ?, ?, ?, ?)`,
        [uuidv4(), existingMeetId, mappedEvent, o.role ?? '', o.name ?? '', o.ussa_id ?? null]
      );
    }
  }

  // 7. Course specs — match by meet_id + course_name
  for (const cs of (data.course_specs || [])) {
    const existing = await queryOne('SELECT id FROM course_specs WHERE meet_id=? AND course_name=?', [existingMeetId, cs.course_name ?? null]);
    if (existing) {
      await execute(
        `UPDATE course_specs SET width_m=COALESCE(?,width_m), length_m=COALESCE(?,length_m),
         pitch_deg=COALESCE(?,pitch_deg), pace_time_override_m=COALESCE(?,pace_time_override_m),
         pace_time_override_f=COALESCE(?,pace_time_override_f), pace_standard=COALESCE(?,pace_standard) WHERE id=?`,
        [cs.width_m ?? null, cs.length_m ?? null, cs.pitch_deg ?? null,
         cs.pace_time_override_m ?? null, cs.pace_time_override_f ?? null, cs.pace_standard ?? null, existing.id]
      );
    } else {
      await execute(
        `INSERT INTO course_specs (id, meet_id, course_name, width_m, length_m, pitch_deg, pace_time_override_m, pace_time_override_f, pace_standard)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), existingMeetId, cs.course_name ?? null, cs.width_m ?? null, cs.length_m ?? null,
         cs.pitch_deg ?? null, cs.pace_time_override_m ?? null, cs.pace_time_override_f ?? null, cs.pace_standard ?? 'usss']
      );
    }
  }

  // 7b. Training days — match by meet_id + name (v1.25.01)
  const trainingDayMap = {};
  for (const td of (data.training_days || [])) {
    const existing = await queryOne('SELECT * FROM training_days WHERE meet_id=? AND name=?', [existingMeetId, td.name ?? '']);
    if (existing) {
      trainingDayMap[td.id] = existing.id;
      if (isNewer(td.updated_at, existing.updated_at)) {
        await execute(
          `UPDATE training_days SET date=?, updated_at=datetime('now') WHERE id=?`,
          [td.date ?? existing.date, existing.id]
        );
      }
    } else {
      const newId = uuidv4();
      trainingDayMap[td.id] = newId;
      await execute(
        `INSERT INTO training_days (id, meet_id, name, date, created_at, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [newId, existingMeetId, td.name ?? '', td.date ?? null]
      );
    }
  }
  // Exclusions are additive-only on merge; composite PK keeps this idempotent.
  for (const tde of (data.training_day_exclusions || [])) {
    const mappedTd = trainingDayMap[tde.training_day_id] ?? null;
    const mappedAthlete = athleteMap[tde.athlete_id] ?? null;
    if (!mappedTd || !mappedAthlete) continue;
    await execute(
      `INSERT OR IGNORE INTO training_day_exclusions (training_day_id, athlete_id) VALUES (?, ?)`,
      [mappedTd, mappedAthlete]
    );
  }

  // 8. Heats
  const heatMap = {};
  for (const h of (data.heats || [])) {
    const mappedEvent = eventMap[h.event_id] ?? null;
    if (!mappedEvent) continue;
    const existing = await queryOne('SELECT id FROM heats WHERE event_id=? AND heat_number=? AND round=?',
      [mappedEvent, h.heat_number ?? 1, h.round ?? 'qualification']);
    if (existing) { heatMap[h.id] = existing.id; }
    else {
      const newId = uuidv4();
      heatMap[h.id] = newId;
      await execute(
        `INSERT INTO heats (id, event_id, heat_number, heat_name, round, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [newId, mappedEvent, h.heat_number ?? 1, h.heat_name ?? null, h.round ?? 'qualification']
      );
    }
  }

  // 9. Event phases
  const phaseMap = {};
  for (const p of (data.event_phases || [])) {
    const mappedEvent = eventMap[p.event_id] ?? null;
    if (!mappedEvent) continue;
    const existing = await queryOne('SELECT * FROM event_phases WHERE event_id=? AND run_number=?', [mappedEvent, p.run_number ?? 1]);
    if (existing) {
      phaseMap[p.id] = existing.id;
      if (isNewer(p.updated_at, existing.updated_at)) {
        await execute(
          `UPDATE event_phases SET status=?, review_message=?, label=?, run_order_method=?,
           pass_through_count=?, final_size=?, q2_field_limit=?, sequence_order=?, updated_at=datetime('now') WHERE id=?`,
          [p.status ?? existing.status, p.review_message ?? null, p.label ?? existing.label,
           p.run_order_method ?? existing.run_order_method, p.pass_through_count ?? existing.pass_through_count,
           p.final_size ?? existing.final_size, p.q2_field_limit ?? existing.q2_field_limit ?? null,
           p.sequence_order ?? existing.sequence_order, existing.id]
        );
      }
    } else {
      const newId = uuidv4();
      phaseMap[p.id] = newId;
      await execute(
        `INSERT INTO event_phases (id, event_id, phase_type, run_number, label, run_order_method,
          pass_through_count, final_size, q2_field_limit, status, review_message, sequence_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [newId, mappedEvent, p.phase_type ?? null, p.run_number ?? 1, p.label ?? null,
         p.run_order_method ?? 'same', p.pass_through_count ?? null, p.final_size ?? null,
         p.q2_field_limit ?? null,
         p.status ?? 'not_started', p.review_message ?? null, p.sequence_order ?? 0]
      );
    }
  }

  // 10. Run round status
  for (const rrs of (data.run_round_status || [])) {
    const mappedEvent = eventMap[rrs.event_id] ?? null;
    if (!mappedEvent) continue;
    const existing = await queryOne('SELECT * FROM run_round_status WHERE event_id=? AND run_number=?', [mappedEvent, rrs.run_number ?? 1]);
    if (existing) {
      if (isNewer(rrs.updated_at, existing.updated_at)) {
        await execute(`UPDATE run_round_status SET status=?, review_message=?, updated_at=datetime('now') WHERE event_id=? AND run_number=?`,
          [rrs.status ?? existing.status, rrs.review_message ?? null, mappedEvent, rrs.run_number ?? 1]);
      }
    } else {
      await execute(
        `INSERT OR IGNORE INTO run_round_status (event_id, run_number, status, review_message, updated_at) VALUES (?, ?, ?, ?, datetime('now'))`,
        [mappedEvent, rrs.run_number ?? 1, rrs.status ?? 'not_started', rrs.review_message ?? null]
      );
    }
  }

  // 11. Phase run order
  for (const pro of (data.phase_run_order || [])) {
    const mappedPhase = phaseMap[pro.phase_id] ?? null;
    const mappedReg = regMap[pro.registration_id] ?? null;
    if (!mappedPhase || !mappedReg) continue;
    const existing = await queryOne('SELECT id FROM phase_run_order WHERE phase_id=? AND registration_id=?', [mappedPhase, mappedReg]);
    if (existing) {
      await execute(`UPDATE phase_run_order SET run_order=? WHERE id=?`, [pro.run_order ?? null, existing.id]);
    } else {
      await execute(`INSERT INTO phase_run_order (id, phase_id, registration_id, run_order) VALUES (?, ?, ?, ?)`,
        [uuidv4(), mappedPhase, mappedReg, pro.run_order ?? null]);
    }
  }

  // 12. Runs — match by event_id + registration_id + run_number + round
  const runMap = {};
  for (const r of (data.runs || [])) {
    const mappedEvent = eventMap[r.event_id] ?? null;
    const mappedReg = regMap[r.registration_id] ?? null;
    if (!mappedEvent || !mappedReg) continue;
    const existing = await queryOne(
      'SELECT * FROM runs WHERE event_id=? AND registration_id=? AND run_number=? AND round=?',
      [mappedEvent, mappedReg, r.run_number ?? 1, r.round ?? 'qualification']
    );
    if (existing) {
      runMap[r.id] = existing.id;
      if (isNewer(r.updated_at, existing.updated_at)) {
        await execute(
          `UPDATE runs SET jump1_code=COALESCE(?,jump1_code), jump1_dd=COALESCE(?,jump1_dd),
           jump2_code=COALESCE(?,jump2_code), jump2_dd=COALESCE(?,jump2_dd),
           turns_score=COALESCE(?,turns_score), air_score=COALESCE(?,air_score),
           speed_score=COALESCE(?,speed_score), total_score=COALESCE(?,total_score),
           run_time=COALESCE(?,run_time), status=COALESCE(?,status),
           run_status=COALESCE(?,run_status), hj_pending=COALESCE(?,hj_pending),
           tl_carving=COALESCE(?,tl_carving), tl_abext=COALESCE(?,tl_abext),
           tl_upper_body=COALESCE(?,tl_upper_body), tl_deduction=COALESCE(?,tl_deduction),
           manually_entered=COALESCE(?,manually_entered), updated_at=datetime('now') WHERE id=?`,
          [r.jump1_code ?? null, r.jump1_dd ?? null, r.jump2_code ?? null, r.jump2_dd ?? null,
           r.turns_score ?? null, r.air_score ?? null, r.speed_score ?? null, r.total_score ?? null,
           r.run_time ?? null, r.status ?? null, r.run_status ?? null, r.hj_pending ?? null,
           r.tl_carving ?? null, r.tl_abext ?? null, r.tl_upper_body ?? null, r.tl_deduction ?? null,
           r.manually_entered ?? null, existing.id]
        );
        summary.runs_updated++;
      }
    } else {
      const newId = uuidv4();
      runMap[r.id] = newId;
      await execute(
        `INSERT INTO runs (id, event_id, registration_id, run_number, round,
          bracket_round, bracket_position, course,
          jump1_code, jump1_dd, jump2_code, jump2_dd,
          turns_score, air_score, air_score_no_dd, speed_score, total_score, run_time,
          status, run_status, hj_pending,
          tl_carving, tl_abext, tl_upper_body, tl_deduction,
          manually_entered, aerials_model, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [newId, mappedEvent, mappedReg,
         r.run_number ?? 1, r.round ?? 'qualification',
         r.bracket_round ?? null, r.bracket_position ?? null, r.course ?? null,
         r.jump1_code ?? null, r.jump1_dd ?? null, r.jump2_code ?? null, r.jump2_dd ?? null,
         r.turns_score ?? null, r.air_score ?? null, r.air_score_no_dd ?? null, r.speed_score ?? null, r.total_score ?? null,
         r.run_time ?? null, r.status ?? 'pending', r.run_status ?? null, r.hj_pending ?? 0,
         r.tl_carving ?? null, r.tl_abext ?? null, r.tl_upper_body ?? null, r.tl_deduction ?? null,
         r.manually_entered ?? 0, r.aerials_model ?? null]
      );
      summary.runs_added++;
    }
  }

  // 13. Judge scores — match by run_id + judge_id + score_type
  for (const js of (data.judge_scores || [])) {
    const mappedRun = runMap[js.run_id] ?? null;
    const mappedJudge = judgeMap[js.judge_id] ?? null;
    if (!mappedRun || !mappedJudge) continue;
    const existing = await queryOne(
      'SELECT id, submitted_at FROM judge_scores WHERE run_id=? AND judge_id=? AND score_type=?',
      [mappedRun, mappedJudge, js.score_type ?? 'tl']
    );
    if (existing) {
      if (isNewer(js.submitted_at, existing.submitted_at)) {
        await execute(
          `UPDATE judge_scores SET raw_score=?, tl_carving=?, tl_abext=?, tl_upper_body=?, tl_deduction=?, submitted_at=datetime('now') WHERE id=?`,
          [js.raw_score ?? 0, js.tl_carving ?? null, js.tl_abext ?? null, js.tl_upper_body ?? null, js.tl_deduction ?? null, existing.id]
        );
      }
    } else {
      await execute(
        `INSERT INTO judge_scores (id, run_id, judge_id, score_type, raw_score, tl_carving, tl_abext, tl_upper_body, tl_deduction, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [uuidv4(), mappedRun, mappedJudge, js.score_type ?? 'tl', js.raw_score ?? 0,
         js.tl_carving ?? null, js.tl_abext ?? null, js.tl_upper_body ?? null, js.tl_deduction ?? null]
      );
    }
  }

  // 14. Dual bracket — match by event_id + bracket_round + bracket_position + is_small_final
  const bracketMap = {};
  for (const b of (data.dual_bracket || [])) {
    const mappedEvent = eventMap[b.event_id] ?? null;
    if (!mappedEvent) continue;
    const existing = await queryOne(
      'SELECT * FROM dual_bracket WHERE event_id=? AND bracket_round=? AND bracket_position=? AND is_small_final=?',
      [mappedEvent, b.bracket_round ?? 1, b.bracket_position ?? 1, b.is_small_final ?? 0]
    );
    if (existing) {
      bracketMap[b.id] = existing.id;
      if (isNewer(b.updated_at, existing.updated_at)) {
        await execute(
          `UPDATE dual_bracket SET registration_id_blue=?, registration_id_red=?, winner_registration_id=?,
           status=?, seed_blue=?, seed_red=?, is_bye=?, loser_status=?, updated_at=datetime('now') WHERE id=?`,
          [b.registration_id_blue ? (regMap[b.registration_id_blue] ?? null) : null,
           b.registration_id_red ? (regMap[b.registration_id_red] ?? null) : null,
           b.winner_registration_id ? (regMap[b.winner_registration_id] ?? null) : null,
           b.status ?? existing.status, b.seed_blue ?? existing.seed_blue, b.seed_red ?? existing.seed_red,
           b.is_bye ?? existing.is_bye, b.loser_status ?? existing.loser_status, existing.id]
        );
      }
    } else {
      const newId = uuidv4();
      bracketMap[b.id] = newId;
      await execute(
        `INSERT INTO dual_bracket (id, event_id, bracket_round, bracket_position,
          registration_id_blue, registration_id_red, winner_registration_id,
          status, is_small_final, seed_blue, seed_red, is_bye, loser_status,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [newId, mappedEvent, b.bracket_round ?? 1, b.bracket_position ?? 1,
         b.registration_id_blue ? (regMap[b.registration_id_blue] ?? null) : null,
         b.registration_id_red ? (regMap[b.registration_id_red] ?? null) : null,
         b.winner_registration_id ? (regMap[b.winner_registration_id] ?? null) : null,
         b.status ?? 'pending', b.is_small_final ?? 0, b.seed_blue ?? null, b.seed_red ?? null,
         b.is_bye ?? 0, b.loser_status ?? null]
      );
    }
  }

  // 15. Dual judge points — match by match_id + judge_number
  for (const djp of (data.dual_judge_points || [])) {
    const mappedMatch = bracketMap[djp.match_id] ?? null;
    if (!mappedMatch) continue;
    const existing = await queryOne('SELECT * FROM dual_judge_points WHERE match_id=? AND judge_number=?',
      [mappedMatch, djp.judge_number ?? 1]);
    if (existing) {
      if (isNewer(djp.updated_at, existing.updated_at)) {
        await execute(
          `UPDATE dual_judge_points SET blue_points=?, red_points=?, time_tied=?, updated_at=datetime('now') WHERE id=?`,
          [djp.blue_points ?? 0, djp.red_points ?? 0, djp.time_tied ?? 0, existing.id]
        );
      }
    } else {
      await execute(
        `INSERT INTO dual_judge_points (id, match_id, judge_number, blue_points, red_points, time_tied, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [uuidv4(), mappedMatch, djp.judge_number ?? 1, djp.blue_points ?? 0, djp.red_points ?? 0, djp.time_tied ?? 0]
      );
    }
  }

  // 16. Logo — overwrite if import has one
  copyLogoFromZip(zipPath, existingMeetId);

  return { meetId: existingMeetId, summary };
}

// ---------------------------------------------------------------------------
// POST /import — import a meet from ZIP (with duplicate detection)
// ---------------------------------------------------------------------------
router.post('/import', requireAuth, importUpload.single('file'), async (req, res) => {
  try {
    const pendingId = req.query.pending_import_id;
    const conflictAction = req.query.conflict_action;

    // --- Step 2: resolve a pending import ---
    if (pendingId) {
      const pending = pendingImports.get(pendingId);
      if (!pending) return res.status(410).json({ error: 'Import session expired. Please upload the file again.' });

      const { data, zipPath } = pending;
      pendingImports.delete(pendingId);

      try {
        if (conflictAction === 'cancel') {
          try { fs.unlinkSync(zipPath); } catch {}
          return res.json({ ok: true, cancelled: true });
        }

        if (conflictAction === 'import') {
          const result = await executeImport(data, zipPath);
          try { fs.unlinkSync(zipPath); } catch {}
          return res.json({ ok: true, ...result });
        }

        if (conflictAction === 'overwrite') {
          const existing = await queryOne('SELECT id FROM meets WHERE LOWER(name) = LOWER(?)', [data.meet.name ?? '']);
          if (existing) await deleteMeetCascade(existing.id);
          const result = await executeImport(data, zipPath);
          try { fs.unlinkSync(zipPath); } catch {}
          return res.json({ ok: true, ...result });
        }

        if (conflictAction === 'duplicate') {
          let dupName = (data.meet.name ?? 'Imported Meet') + ' (Duplicate)';
          let n = 2;
          while (await queryOne('SELECT id FROM meets WHERE LOWER(name) = LOWER(?)', [dupName])) {
            dupName = (data.meet.name ?? 'Imported Meet') + ` (Duplicate ${n++})`;
          }
          const result = await executeImport(data, zipPath, { meetNameOverride: dupName });
          try { fs.unlinkSync(zipPath); } catch {}
          return res.json({ ok: true, ...result });
        }

        if (conflictAction === 'merge') {
          const existing = await queryOne('SELECT id FROM meets WHERE LOWER(name) = LOWER(?)', [data.meet.name ?? '']);
          if (!existing) {
            // Meet was deleted between step 1 and step 2; just do a fresh import
            const result = await executeImport(data, zipPath);
            try { fs.unlinkSync(zipPath); } catch {}
            return res.json({ ok: true, ...result });
          }
          const result = await executeMerge(existing.id, data, zipPath);
          try { fs.unlinkSync(zipPath); } catch {}
          return res.json({ ok: true, ...result });
        }

        try { fs.unlinkSync(zipPath); } catch {}
        return res.status(400).json({ error: 'Invalid conflict_action. Must be cancel, import, overwrite, duplicate, or merge.' });
      } catch (err) {
        try { fs.unlinkSync(zipPath); } catch {}
        throw err;
      }
    }

    // --- Step 1: upload and check for conflicts ---
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // --- Multi-meet bundle detection (v1.16.22) ---
    let outerZipObj = null;
    try { outerZipObj = new AdmZip(req.file.path); } catch {}
    if (outerZipObj) {
      const manifestEntry = outerZipObj.getEntry('manifest.json');
      if (manifestEntry) {
        let manifest = null;
        try { manifest = JSON.parse(manifestEntry.getData().toString('utf8')); } catch {}
        if (manifest && Array.isArray(manifest.meets)) {
          const tmpDir = path.join(__dirname, '..', 'data', 'tmp');
          if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
          const meetsResult = [];
          for (const m of manifest.meets) {
            const childEntry = outerZipObj.getEntry(m.filename);
            if (!childEntry) continue;
            const tmpPath = path.join(tmpDir, `multimeet_${uuidv4()}.zip`);
            fs.writeFileSync(tmpPath, childEntry.getData());
            let childData = null;
            try {
              const childZip = new AdmZip(tmpPath);
              const childJson = childZip.getEntry('meet_export.json');
              if (!childJson) { try { fs.unlinkSync(tmpPath); } catch {}; continue; }
              childData = JSON.parse(childJson.getData().toString('utf8'));
            } catch {
              try { fs.unlinkSync(tmpPath); } catch {}
              continue;
            }
            if (!childData?.meet || !childData?.events) {
              try { fs.unlinkSync(tmpPath); } catch {}
              continue;
            }
            const existingMeet = await queryOne(
              'SELECT id, name, updated_at, created_at FROM meets WHERE LOWER(name) = LOWER(?)',
              [childData.meet.name ?? '']
            );
            const newPendingId = uuidv4();
            pendingImports.set(newPendingId, { data: childData, zipPath: tmpPath, timestamp: Date.now() });
            meetsResult.push({
              pending_import_id: newPendingId,
              name: childData.meet.name,
              location: childData.meet.location,
              date: childData.meet.date,
              export_date: childData.export_date ?? null,
              conflict: existingMeet ? {
                existing_meet: {
                  id: existingMeet.id,
                  name: existingMeet.name,
                  updated_at: existingMeet.updated_at,
                  created_at: existingMeet.created_at,
                },
                import_meet: {
                  name: childData.meet.name,
                  updated_at: childData.meet.updated_at ?? null,
                  export_date: childData.export_date ?? null,
                },
              } : null,
            });
          }
          try { fs.unlinkSync(req.file.path); } catch {}
          return res.json({ multi_meet: true, meet_count: meetsResult.length, meets: meetsResult });
        }
      }
    }

    let data;
    try {
      const zip = outerZipObj || new AdmZip(req.file.path);
      const jsonEntry = zip.getEntry('meet_export.json');
      if (!jsonEntry) throw new Error('meet_export.json not found in ZIP');
      data = JSON.parse(jsonEntry.getData().toString('utf8'));
    } catch (zipErr) {
      // Fall back to raw JSON file
      try {
        data = JSON.parse(fs.readFileSync(req.file.path, 'utf8'));
      } catch {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Invalid file: not a valid ZIP or JSON export' });
      }
    }
    if (!data.meet || !data.events) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Invalid export file: missing meet or events data' });
    }

    // Check for existing meet with same name
    const existingMeet = await queryOne(
      'SELECT id, name, updated_at, created_at FROM meets WHERE LOWER(name) = LOWER(?)',
      [data.meet.name ?? '']
    );

    if (existingMeet) {
      // Conflict — cache data, return conflict info
      const newPendingId = uuidv4();
      pendingImports.set(newPendingId, { data, zipPath: req.file.path, timestamp: Date.now() });
      return res.json({
        conflict: true,
        pending_import_id: newPendingId,
        existing_meet: {
          id: existingMeet.id,
          name: existingMeet.name,
          updated_at: existingMeet.updated_at,
          created_at: existingMeet.created_at,
        },
        import_meet: {
          name: data.meet.name,
          updated_at: data.meet.updated_at ?? null,
          export_date: data.export_date ?? null,
        },
      });
    }

    // No conflict — proceed with normal import
    const result = await executeImport(data, req.file.path);
    fs.unlinkSync(req.file.path);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('meet import error:', e);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
