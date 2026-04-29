#!/usr/bin/env node
/**
 * Seed StickIt database with "RMF Divisional Champs at Telluride" data.
 * Parses the Winfree TXT and creates meet, events, athletes, registrations,
 * judges, officials, course specs, and all run scores.
 *
 * Usage: node server/scripts/seed_telluride.js
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Bootstrap the database
const DB_PATH = path.join(__dirname, '../../data/scoring.db');
process.env.LIBSQL_URL = `file:${DB_PATH}`;
const { queryAll, queryOne, execute, batch, initSchema } = require('../db/schema.js');
const { calcMogulScore } = require('../scoring/engine.js');

const TXT_PATH = path.join(
  '/Users/daviddreitlein/Desktop/Scoring Server/Claude Uploads',
  'Tellirode Comp Series ',
  'Telluride Divisional Champs 2026.TXT'
);

// ---------- Parser (same as validate_telluride.js) ----------

function parseRunTokens(tokens) {
  if (!tokens || tokens.length < 11) return null;
  if (tokens[0] === 'dns' || tokens[0] === 'dnf' || tokens[3] === 'dns' || tokens[3] === 'dnf') {
    return { status: 'dns_dnf' };
  }

  const j1 = parseFloat(tokens[0]);
  const j2 = parseFloat(tokens[1]);
  const j3 = parseFloat(tokens[2]);
  const tl = parseFloat(tokens[3]);
  const j4a = parseFloat(tokens[4]);
  const j5a = parseFloat(tokens[5]);
  const code1 = tokens[6];
  const dd1 = parseFloat(tokens[7]);
  const airs = parseFloat(tokens[8]);
  const judge = parseFloat(tokens[9]);

  let time = null, speedPts = 0, runTotal, eventScore = null;
  let nextIdx;

  if (tokens[10] === '(none)') {
    time = null;
    speedPts = 0;
    runTotal = parseFloat(tokens[11]);
    nextIdx = 12;
  } else {
    time = parseFloat(tokens[10]);
    const candidateSpeed = parseFloat(tokens[11]);
    const candidateRun = parseFloat(tokens[12]);
    if (tokens.length >= 13 && Math.abs(tl + airs + candidateSpeed - candidateRun) < 0.02) {
      speedPts = candidateSpeed;
      runTotal = candidateRun;
      nextIdx = 13;
    } else {
      speedPts = 0;
      runTotal = candidateSpeed;
      nextIdx = 12;
    }
  }

  if (nextIdx < tokens.length && /^\d/.test(tokens[nextIdx])) {
    eventScore = parseFloat(tokens[nextIdx]);
  }

  if (isNaN(j1) || isNaN(tl) || isNaN(runTotal)) return null;

  return {
    j1, j2, j3, tl,
    j4a, j5a, code1, dd1,
    j4b: null, j5b: null, code2: null, dd2: null,
    airs, judge, time, speedPts, runTotal, eventScore,
  };
}

function parseWinfreeTxt(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8');
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''));

  const athletes = [];
  let i = 0;

  while (i < lines.length && !lines[i].startsWith('=== ===')) i++;
  i++;
  if (i < lines.length && lines[i].trim() === '') i++;

  const athRe = /^\s*(\d+)\s+(\d+)\s+(.+?)\s+(F\d+|M\d+|[FM]Sr)\s+(\S+)\s+(.*)$/;

  while (i < lines.length) {
    const line = lines[i];
    if (line.match(/^Male\s+=/) || line.match(/^Winfree/)) break;

    const m = athRe.exec(line);
    if (!m) { i++; continue; }

    const rank = parseInt(m[1]);
    const bib = parseInt(m[2]);
    const name = m[3].trim();
    const group = m[4];
    const club = m[5];
    const gender = group.startsWith('F') ? 'F' : 'M';

    // Parse name into last, first
    const nameParts = name.split(',');
    const lastName = nameParts[0].trim();
    const firstName = (nameParts[1] || '').trim();

    // Derive birth year from age group
    const ageCode = group.substring(1); // e.g. "15", "17", "Sr"
    let birthYear = null;
    if (ageCode === 'Vet') {
      birthYear = 2003; // rough approximation — 21+ veteran
    } else if (ageCode === 'Sr') {
      birthYear = 2006; // rough approximation — 19-20 senior
    } else {
      const age = parseInt(ageCode);
      if (!isNaN(age)) {
        // USSS age groups: U15 means born in 2011 for 2025-2026 season (seasonStartYear=2025)
        birthYear = 2025 - age;
      }
    }

    const r1Tokens = m[6].trim().split(/\s+/).filter(Boolean);
    const run1 = parseRunTokens(r1Tokens);
    i++;

    if (i < lines.length && run1 && !run1.status) {
      const j2Tokens = lines[i].trim().split(/\s+/).filter(Boolean);
      if (j2Tokens.length >= 4 && /^[\d.]/.test(j2Tokens[0])) {
        run1.j4b = parseFloat(j2Tokens[0]);
        run1.j5b = parseFloat(j2Tokens[1]);
        run1.code2 = j2Tokens[2];
        run1.dd2 = parseFloat(j2Tokens[3]);
      }
      i++;
    }

    while (i < lines.length && lines[i].trim().startsWith('J.1=')) i++;

    let run2 = null;
    if (i < lines.length) {
      const r2line = lines[i].trim();
      const r2Tokens = r2line.split(/\s+/).filter(Boolean);
      run2 = parseRunTokens(r2Tokens);
      i++;
    }

    if (i < lines.length && run2 && !run2.status) {
      const j2Tokens = lines[i].trim().split(/\s+/).filter(Boolean);
      if (j2Tokens.length >= 4 && /^[\d.]/.test(j2Tokens[0])) {
        run2.j4b = parseFloat(j2Tokens[0]);
        run2.j5b = parseFloat(j2Tokens[1]);
        run2.code2 = j2Tokens[2];
        run2.dd2 = parseFloat(j2Tokens[3]);
      }
      i++;
    }

    while (i < lines.length && lines[i].trim().startsWith('J.1=')) i++;

    const eventScore = (run2 && run2.eventScore) || null;

    athletes.push({
      rank, bib, name, lastName, firstName, group, club, gender, birthYear,
      run1, run2, eventScore,
    });
  }

  return athletes;
}

// ---------- Database seed ----------

async function main() {
  await initSchema();

  console.log('Parsing Winfree TXT...');
  const athletes = parseWinfreeTxt(TXT_PATH);
  console.log(`Parsed ${athletes.length} athletes`);

  const females = athletes.filter(a => a.gender === 'F');
  const males = athletes.filter(a => a.gender === 'M');
  console.log(`  ${females.length} female, ${males.length} male`);

  // Check if meet already exists
  const existing = await queryOne("SELECT id FROM meets WHERE name = 'RMF Divisional Champs at Telluride'");
  if (existing) {
    console.log('\nMeet "RMF Divisional Champs at Telluride" already exists. Skipping seed.');
    console.log('To re-seed, delete the meet first.');
    process.exit(0);
  }

  // --- Meet ---
  const meetId = uuidv4();
  await execute(
    `INSERT INTO meets (id, name, location, date, status) VALUES (?, ?, ?, ?, ?)`,
    [meetId, 'RMF Divisional Champs at Telluride', 'Telluride, Colorado', '2026-03-07', 'active']
  );
  console.log(`\nCreated meet: ${meetId}`);

  // --- Course Specs ---
  const courseId = uuidv4();
  await execute(
    `INSERT INTO course_specs (id, meet_id, course_name, width_m, length_m, pitch_deg, pace_time_override_m, pace_time_override_f)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [courseId, meetId, 'Hermit', 11, 196, 25.6, 20.20, 23.90]
  );

  // --- Officials ---
  const officials = [
    { role: 'head_judge', name: 'ELLIS, Christopher' },
    { role: 'chief_of_comp', name: 'JACHIMOWICZ, Jason' },
    { role: 'td', name: 'WATKINS, Zak' },
    { role: 'chief_of_scoring', name: 'CUPP, Erica' },
  ];
  for (const o of officials) {
    await execute(
      `INSERT INTO officials (id, meet_id, role, name) VALUES (?, ?, ?, ?)`,
      [uuidv4(), meetId, o.role, o.name]
    );
  }

  // --- Events (Female MO + Male MO) ---
  const femaleEventId = uuidv4();
  const maleEventId = uuidv4();

  for (const [eventId, gender, usssCode] of [[femaleEventId, 'F', 'U0598'], [maleEventId, 'M', 'U0597']]) {
    const label = gender === 'F' ? 'Female' : 'Male';
    await execute(
      `INSERT INTO events (id, meet_id, discipline, division, gender, name, status,
        num_tl_judges, num_air_judges, has_speed, pace_time, component_scoring, usss_code, event_date, score_entry_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [eventId, meetId, 'mogul', 'comp_series', gender,
       `Comp Series ${label} Mogul`, 'active',
       3, 2, 1, gender === 'F' ? 23.90 : 20.20, 1, usssCode, '2026-03-07', 'paper']
    );
  }
  console.log(`Created events: Female MO (${femaleEventId}), Male MO (${maleEventId})`);

  // --- Judges (per event) ---
  const judgeRoles = [
    { name: 'DOWLING, Lara', role: 'tl' },
    { name: 'ANDRINGA, Conrad', role: 'tl' },
    { name: 'COORS, Elizabeth', role: 'tl' },
    { name: 'RAINEN, Lauren', role: 'air' },
    { name: 'SILVERSTONE, Mandy', role: 'air' },
  ];

  const judgeIdMap = {}; // eventId -> [j1id, j2id, j3id, j4id, j5id]
  for (const eventId of [femaleEventId, maleEventId]) {
    const ids = [];
    for (const j of judgeRoles) {
      const jId = uuidv4();
      await execute(
        `INSERT INTO judges (id, event_id, name, role) VALUES (?, ?, ?, ?)`,
        [jId, eventId, j.name, j.role]
      );
      ids.push(jId);
    }
    judgeIdMap[eventId] = ids;
  }

  // --- Athletes, Registrations, and Runs ---
  let runCount = 0;
  let scoreCount = 0;

  for (const a of athletes) {
    const eventId = a.gender === 'F' ? femaleEventId : maleEventId;
    const paceTime = a.gender === 'F' ? 23.90 : 20.20;
    const judgeIds = judgeIdMap[eventId];

    // Create athlete
    const athleteId = uuidv4();
    await execute(
      `INSERT INTO athletes (id, first_name, last_name, birth_year, gender, club, bib)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [athleteId, a.firstName, a.lastName, a.birthYear, a.gender, a.club, a.bib]
    );

    // Create registration
    const regId = uuidv4();
    await execute(
      `INSERT INTO registrations (id, event_id, athlete_id, bib_number, run_order, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [regId, eventId, athleteId, a.bib, a.rank, 'registered']
    );

    // Create runs
    for (const [runNum, run] of [[1, a.run1], [2, a.run2]]) {
      if (!run) continue;

      const runId = uuidv4();
      const isDns = run.status === 'dns_dnf';

      if (isDns) {
        await execute(
          `INSERT INTO runs (id, event_id, registration_id, run_number, status, run_status, manually_entered)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [runId, eventId, regId, runNum, 'complete', 'dns', 1]
        );
        runCount++;
        continue;
      }

      // Calculate scores via engine
      const hasSpeed = run.time !== null && run.time > 0;
      const result = calcMogulScore({
        tlScores: [run.j1, run.j2, run.j3],
        airScoresJump1: [run.j4a, run.j5a],
        dd1: run.dd1,
        airScoresJump2: run.j4b !== null ? [run.j4b, run.j5b] : [],
        dd2: run.dd2 || 0,
        runTime: run.time,
        paceTime: hasSpeed ? paceTime : null,
        hasSpeed,
      });

      // Look up jump codes in DD table for storage
      await execute(
        `INSERT INTO runs (id, event_id, registration_id, run_number,
          jump1_code, jump1_dd, jump2_code, jump2_dd,
          turns_score, air_score, speed_score, total_score,
          run_time, status, manually_entered, hj_pending)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [runId, eventId, regId, runNum,
         run.code1, run.dd1, run.code2 || null, run.dd2 || null,
         result.turnsContrib, result.airRaw, result.speedContrib, result.total,
         run.time, 'complete', 1, 0]
      );
      runCount++;

      // Insert judge_scores: TL judges (j1, j2, j3)
      for (let ji = 0; ji < 3; ji++) {
        const tlScore = [run.j1, run.j2, run.j3][ji];
        await execute(
          `INSERT INTO judge_scores (id, run_id, judge_id, score_type, raw_score)
           VALUES (?, ?, ?, ?, ?)`,
          [uuidv4(), runId, judgeIds[ji], 'tl', tlScore]
        );
        scoreCount++;
      }

      // Air judge 1 (J4) - jump 1
      await execute(
        `INSERT INTO judge_scores (id, run_id, judge_id, score_type, raw_score)
         VALUES (?, ?, ?, ?, ?)`,
        [uuidv4(), runId, judgeIds[3], 'air_jump1', run.j4a]
      );
      scoreCount++;

      // Air judge 2 (J5) - jump 1
      await execute(
        `INSERT INTO judge_scores (id, run_id, judge_id, score_type, raw_score)
         VALUES (?, ?, ?, ?, ?)`,
        [uuidv4(), runId, judgeIds[4], 'air_jump1', run.j5a]
      );
      scoreCount++;

      // Air judge 1 (J4) - jump 2
      if (run.j4b !== null) {
        await execute(
          `INSERT INTO judge_scores (id, run_id, judge_id, score_type, raw_score)
           VALUES (?, ?, ?, ?, ?)`,
          [uuidv4(), runId, judgeIds[3], 'air_jump2', run.j4b]
        );
        scoreCount++;
      }

      // Air judge 2 (J5) - jump 2
      if (run.j5b !== null) {
        await execute(
          `INSERT INTO judge_scores (id, run_id, judge_id, score_type, raw_score)
           VALUES (?, ?, ?, ?, ?)`,
          [uuidv4(), runId, judgeIds[4], 'air_jump2', run.j5b]
        );
        scoreCount++;
      }
    }
  }

  // Finalize run round statuses
  for (const eventId of [femaleEventId, maleEventId]) {
    for (const runNum of [1, 2]) {
      await execute(
        `INSERT OR IGNORE INTO run_round_status (event_id, run_number, status) VALUES (?, ?, ?)`,
        [eventId, runNum, 'finalized']
      );
    }
  }

  console.log(`\nInserted ${athletes.length} athletes, ${runCount} runs, ${scoreCount} judge scores`);
  console.log('\n=== Telluride Seed Complete ===');
  console.log(`Meet ID: ${meetId}`);
  console.log(`Female MO Event ID: ${femaleEventId}`);
  console.log(`Male MO Event ID: ${maleEventId}`);
  console.log('\nStart the server and navigate to the meet to see the data.');
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
