#!/usr/bin/env node
/**
 * seed_telluride_extras.js
 *
 * Adds to the existing Telluride meet:
 * 1. Fixes officials (correct role names, event_id associations)
 * 2. Fixes judge roles (TL1/TL2/TL3/Air1/Air2 + adds HJ)
 * 3. Creates Female & Male Dual Mogul events with full bracket results
 *    parsed from the Winfree DM bracket file
 */

const { queryAll, queryOne, execute, uuidv4 } = require('../db/schema');

const MEET_ID = '97f09a76-ee35-4968-8cc6-23edabeb34a0';

// Official data from the Winfree files
const OFFICIALS = [
  { role: 'Head Judge',           name: 'ELLIS, Christopher' },
  { role: 'Chief of Competition', name: 'JACHIMOWICZ, Jason' },
  { role: 'Technical Delegate',   name: 'WATKINS, Zak' },
  { role: 'Chief of Score',       name: 'CUPP, Erica' },
];

// Judge names from the Winfree files
const JUDGE_NAMES = {
  TL1: 'ANDRINGA, Conrad',
  TL2: 'COORS, Elizabeth',
  TL3: 'SILVERSTONE, Mandy',
  Air1: 'DOWLING, Lara',
  Air2: 'RAINEN, Lauren',
  HJ:  'ELLIS, Christopher',
};

// DM judge roles
const DM_JUDGE_ROLES = [
  { role: 'DualTurns1', name: 'ANDRINGA, Conrad' },
  { role: 'DualTurns2', name: 'COORS, Elizabeth' },
  { role: 'DualAir',    name: 'SILVERSTONE, Mandy' },
  { role: 'DualTime',   name: 'DOWLING, Lara' },
  { role: 'DualOverall',name: 'RAINEN, Lauren' },
  { role: 'HJ',         name: 'ELLIS, Christopher' },
];

// Parse the bracket TXT data
// Format: r{round}.{pairing}{color}:{bib}){LAST},{First}({seed})  j1+j2+j3+j4+j5=Total<cumulative>
function parseBracketData(lines) {
  const matches = [];
  const matchRe = /r(\d+)\.(\d+)([br]):(\d+)\)([A-Z]+),(\w[\w\s]*?)\((\d+)\)\s+(.*)/;

  for (const line of lines) {
    const m = line.match(matchRe);
    if (!m) continue;
    const [, round, pairing, color, bib, lastName, firstName, seed, scoreStr] = m;

    let judgePoints = null;
    let total = null;
    let status = null;

    const scoreMatch = scoreStr.match(/(\d+)\+(\d+)\+(\d+)\+(\d+)\+(\d+)=(\d+)/);
    if (scoreMatch) {
      judgePoints = [
        parseInt(scoreMatch[1]),
        parseInt(scoreMatch[2]),
        parseInt(scoreMatch[3]),
        parseInt(scoreMatch[4]),
        parseInt(scoreMatch[5]),
      ];
      total = parseInt(scoreMatch[6]);
    } else if (scoreStr.includes('(DNF)')) {
      status = 'DNF';
    } else if (scoreStr.includes('(NoShow)') || scoreStr.includes('(DNS)')) {
      status = 'DNS';
    }

    // Check for placement marker like <2nd> <4th> etc.
    const placeMatch = scoreStr.match(/<(\d+)(?:st|nd|rd|th)>/);

    matches.push({
      round: parseInt(round),
      pairing: parseInt(pairing),
      color, // 'b' = blue, 'r' = red
      bib: parseInt(bib),
      lastName: lastName.trim(),
      firstName: firstName.trim(),
      seed: parseInt(seed),
      judgePoints,
      total,
      status,
      placement: placeMatch ? parseInt(placeMatch[1]) : null,
    });
  }
  return matches;
}

async function run() {
  console.log('=== Telluride Extras Seed Script ===\n');

  // Get existing events
  const events = await queryAll('SELECT * FROM events WHERE meet_id=?', [MEET_ID]);
  const femaleEvent = events.find(e => e.gender === 'F');
  const maleEvent = events.find(e => e.gender === 'M');

  if (!femaleEvent || !maleEvent) {
    console.error('Could not find existing mogul events');
    process.exit(1);
  }

  console.log('Found mogul events:');
  console.log(`  Female: ${femaleEvent.name} (${femaleEvent.id})`);
  console.log(`  Male:   ${maleEvent.name} (${maleEvent.id})`);

  // ── Step 1: Fix officials ───────────────────────────────────────────────
  console.log('\n--- Step 1: Fix officials ---');

  // Delete old officials with wrong roles
  await execute('DELETE FROM officials WHERE meet_id=?', [MEET_ID]);
  console.log('Cleared old officials');

  // Insert officials for each event
  const allEventIds = [femaleEvent.id, maleEvent.id];
  for (const off of OFFICIALS) {
    for (const eventId of allEventIds) {
      await execute(
        'INSERT INTO officials (id, meet_id, role, name, event_id) VALUES (?,?,?,?,?)',
        [uuidv4(), MEET_ID, off.role, off.name, eventId]
      );
    }
  }
  console.log(`Inserted officials for ${allEventIds.length} events`);

  // ── Step 2: Fix judge roles ─────────────────────────────────────────────
  console.log('\n--- Step 2: Fix judge roles ---');

  for (const ev of [femaleEvent, maleEvent]) {
    // Delete existing judges
    await execute('DELETE FROM judges WHERE event_id=?', [ev.id]);

    // Insert with proper roles
    for (const [role, name] of Object.entries(JUDGE_NAMES)) {
      await execute(
        'INSERT INTO judges (id, event_id, role, name) VALUES (?,?,?,?)',
        [uuidv4(), ev.id, role, name]
      );
    }
    console.log(`Fixed judges for ${ev.name}: TL1, TL2, TL3, Air1, Air2, HJ`);
  }

  // ── Step 3: Create Dual Mogul events ────────────────────────────────────
  console.log('\n--- Step 3: Create Dual Mogul events ---');

  // Read the DM bracket file
  const fs = require('fs');
  const dmText = fs.readFileSync(
    '/Users/daviddreitlein/Desktop/Scoring Server/Claude Uploads/Tellirode Comp Series /Telluride Divisional Champs 2026 dm.TXT',
    'utf8'
  );
  const dmLines = dmText.split('\n');

  // Split into female and male sections
  const femaleStart = dmLines.findIndex(l => l.trim() === 'Female:');
  const maleStart = dmLines.findIndex(l => l.trim() === 'Male:');

  const femaleLines = dmLines.slice(femaleStart, maleStart);
  const maleLines = dmLines.slice(maleStart);

  const femaleBracket = parseBracketData(femaleLines);
  const maleBracket = parseBracketData(maleLines);

  console.log(`Parsed ${femaleBracket.length} female bracket entries`);
  console.log(`Parsed ${maleBracket.length} male bracket entries`);

  // Get USSS codes from header (U0600 = female DM, U0599 = male DM)

  // Create DM events
  const dmFemaleId = uuidv4();
  const dmMaleId = uuidv4();

  await execute(
    `INSERT INTO events (id,meet_id,discipline,division,gender,name,num_tl_judges,num_air_judges,num_jumps,has_speed,turns_weight,air_weight,speed_weight,bracket_size,has_small_final,runoff_option,component_scoring,score_entry_mode,usss_code,is_divisional,event_date)
     VALUES (?,?,'dual_mogul','comp_series','F','Comp Series Female Dual Mogul',3,2,2,1,0.60,0.20,0.20,128,1,'runoff_to_8th',1,'paper','U0600',0,'2026-03-08')`,
    [dmFemaleId, MEET_ID]
  );

  await execute(
    `INSERT INTO events (id,meet_id,discipline,division,gender,name,num_tl_judges,num_air_judges,num_jumps,has_speed,turns_weight,air_weight,speed_weight,bracket_size,has_small_final,runoff_option,component_scoring,score_entry_mode,usss_code,is_divisional,event_date)
     VALUES (?,?,'dual_mogul','comp_series','M','Comp Series Male Dual Mogul',3,2,2,1,0.60,0.20,0.20,128,1,'runoff_to_8th',1,'paper','U0599',0,'2026-03-08')`,
    [dmMaleId, MEET_ID]
  );

  console.log(`Created Female DM event: ${dmFemaleId}`);
  console.log(`Created Male DM event: ${dmMaleId}`);

  // Add officials to DM events
  for (const off of OFFICIALS) {
    for (const eventId of [dmFemaleId, dmMaleId]) {
      await execute(
        'INSERT INTO officials (id, meet_id, role, name, event_id) VALUES (?,?,?,?,?)',
        [uuidv4(), MEET_ID, off.role, off.name, eventId]
      );
    }
  }

  // Add DM judges to DM events
  for (const eventId of [dmFemaleId, dmMaleId]) {
    for (const j of DM_JUDGE_ROLES) {
      await execute(
        'INSERT INTO judges (id, event_id, role, name) VALUES (?,?,?,?)',
        [uuidv4(), eventId, j.role, j.name]
      );
    }
  }
  console.log('Added officials and judges to DM events');

  // ── Step 4: Register athletes for DM events ─────────────────────────────
  console.log('\n--- Step 4: Register athletes for DM events ---');

  async function registerDmAthletes(bracketData, dmEventId, gender) {
    // Get unique athletes from bracket data
    const athleteMap = new Map(); // bib -> {lastName, firstName, seed}
    for (const entry of bracketData) {
      if (!athleteMap.has(entry.bib)) {
        athleteMap.set(entry.bib, { lastName: entry.lastName, firstName: entry.firstName, seed: entry.seed, bib: entry.bib });
      }
    }

    // Find existing athletes by matching name (they're already in the athletes table from mogul events)
    const regMap = new Map(); // bib -> registration_id

    for (const [bib, data] of athleteMap) {
      // Try to find existing athlete
      let athlete = await queryOne(
        `SELECT a.id FROM athletes a JOIN registrations r ON r.athlete_id=a.id
         WHERE r.bib_number=? AND r.event_id IN (SELECT id FROM events WHERE meet_id=? AND discipline='mogul' AND gender=?)`,
        [bib, MEET_ID, gender]
      );

      if (!athlete) {
        // Try by name
        athlete = await queryOne(
          `SELECT id FROM athletes WHERE UPPER(last_name)=? AND UPPER(first_name)=?`,
          [data.lastName.toUpperCase(), data.firstName.toUpperCase()]
        );
      }

      if (!athlete) {
        // Create new athlete
        const athleteId = uuidv4();
        await execute(
          'INSERT INTO athletes (id, first_name, last_name) VALUES (?,?,?)',
          [athleteId, data.firstName, data.lastName]
        );
        athlete = { id: athleteId };
      }

      // Register for DM event
      const regId = uuidv4();
      await execute(
        'INSERT INTO registrations (id, event_id, athlete_id, bib_number, seed, status) VALUES (?,?,?,?,?,?)',
        [regId, dmEventId, athlete.id, bib, data.seed, 'active']
      );
      regMap.set(bib, regId);
    }

    console.log(`  Registered ${athleteMap.size} ${gender} athletes for DM`);
    return regMap;
  }

  const femaleRegMap = await registerDmAthletes(femaleBracket, dmFemaleId, 'F');
  const maleRegMap = await registerDmAthletes(maleBracket, dmMaleId, 'M');

  // ── Step 5: Create brackets and populate results ────────────────────────
  console.log('\n--- Step 5: Create brackets with results ---');

  async function createBracket(bracketData, dmEventId, regMap, gender) {
    // Group by round+pairing to build match pairs
    const matchPairs = new Map(); // "round.pairing" -> {blue: entry, red: entry}

    for (const entry of bracketData) {
      const key = `${entry.round}.${entry.pairing}`;
      if (!matchPairs.has(key)) matchPairs.set(key, {});
      const pair = matchPairs.get(key);
      if (entry.color === 'b') pair.blue = entry;
      else pair.red = entry;
    }

    // Determine max round to compute total_rounds
    let maxRound = 0;
    for (const entry of bracketData) {
      if (entry.round > maxRound) maxRound = entry.round;
    }

    let matchCount = 0;

    for (const [key, pair] of matchPairs) {
      const [roundStr, pairingStr] = key.split('.');
      const bracketRound = parseInt(roundStr);
      const bracketPosition = parseInt(pairingStr);

      const blueRegId = pair.blue ? regMap.get(pair.blue.bib) : null;
      const redRegId = pair.red ? regMap.get(pair.red.bib) : null;

      // Determine winner
      let winnerId = null;
      let winnerSide = null;
      let status = 'complete';

      if (pair.blue && pair.red) {
        if (pair.blue.status === 'DNF' || pair.blue.status === 'DNS') {
          winnerId = redRegId;
          winnerSide = 'red';
        } else if (pair.red.status === 'DNF' || pair.red.status === 'DNS') {
          winnerId = blueRegId;
          winnerSide = 'blue';
        } else if (pair.blue.total != null && pair.red.total != null) {
          if (pair.blue.total > pair.red.total) {
            winnerId = blueRegId;
            winnerSide = 'blue';
          } else {
            winnerId = redRegId;
            winnerSide = 'red';
          }
        }
      } else if (pair.blue && !pair.red) {
        // Bye
        winnerId = blueRegId;
        winnerSide = 'blue';
        status = 'complete';
      } else if (pair.red && !pair.blue) {
        winnerId = redRegId;
        winnerSide = 'red';
        status = 'complete';
      }

      const matchId = uuidv4();
      const pairingLabel = `W-${String(bracketPosition).padStart(2,'0')}`;

      // Compute blue/red totals from judge points
      let blueTotal = null, redTotal = null;
      if (pair.blue && pair.blue.judgePoints) {
        blueTotal = pair.blue.total;
      }
      if (pair.red && pair.red.judgePoints) {
        redTotal = pair.red.total;
      }

      const isBye = (!pair.blue || !pair.red) ? 1 : 0;
      const loserStatus = pair.blue?.status === 'DNF' ? 'DNF' : pair.blue?.status === 'DNS' ? 'DNS' : pair.red?.status === 'DNF' ? 'DNF' : pair.red?.status === 'DNS' ? 'DNS' : null;
      const blueS = pair.blue ? pair.blue.seed : null;
      const redS = pair.red ? pair.red.seed : null;

      await execute(
        `INSERT INTO dual_bracket (id, event_id, bracket_round, bracket_position, registration_id_blue, registration_id_red,
         winner_registration_id, status, is_bye, loser_status, seed_blue, seed_red)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [matchId, dmEventId, bracketRound, bracketPosition, blueRegId || null, redRegId || null,
         winnerId, status, isBye, loserStatus, blueS, redS]
      );

      // Insert judge points for both athletes
      if (pair.blue && pair.blue.judgePoints) {
        for (let i = 0; i < 5; i++) {
          const redPts = pair.red && pair.red.judgePoints ? pair.red.judgePoints[i] : 0;
          await execute(
            `INSERT INTO dual_judge_points (id, match_id, judge_number, blue_points, red_points) VALUES (?,?,?,?,?)`,
            [uuidv4(), matchId, i + 1, pair.blue.judgePoints[i], redPts]
          );
        }
      } else if (pair.red && pair.red.judgePoints) {
        for (let i = 0; i < 5; i++) {
          const bluePts = pair.blue && pair.blue.judgePoints ? pair.blue.judgePoints[i] : 0;
          await execute(
            `INSERT INTO dual_judge_points (id, match_id, judge_number, blue_points, red_points) VALUES (?,?,?,?,?)`,
            [uuidv4(), matchId, i + 1, bluePts, pair.red.judgePoints[i]]
          );
        }
      }

      matchCount++;
    }

    console.log(`  Created ${matchCount} ${gender} bracket matches`);
  }

  await createBracket(femaleBracket, dmFemaleId, femaleRegMap, 'F');
  await createBracket(maleBracket, dmMaleId, maleRegMap, 'M');

  // Activate DM events
  await execute(`UPDATE events SET status='active' WHERE id IN (?,?)`, [dmFemaleId, dmMaleId]);

  console.log('\n=== Done! ===');
  console.log('Added:');
  console.log('  - Fixed officials for all 4 events');
  console.log('  - Fixed judge roles (TL1/TL2/TL3/Air1/Air2/HJ) for mogul events');
  console.log('  - Created Female Dual Mogul event with bracket results');
  console.log('  - Created Male Dual Mogul event with bracket results');

  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
