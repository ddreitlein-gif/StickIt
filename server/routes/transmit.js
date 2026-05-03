const router = require('express').Router();
const { queryAll, queryOne } = require('../db/schema');
const { rankResults } = require('../scoring/engine');
const { logAudit } = require('./audit');
const archiver = require('archiver');
const { normalizeGender } = require('../utils/gender');

const STICKIT_VERSION = 'v1.13';
const CRLF = '\r\n';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatScore(val) {
  // Round to 2 decimal places max, suppress trailing zeros
  if (val == null || val === '') return '0';
  const n = Number(val);
  if (isNaN(n)) return '0';
  // Round to 2 decimal places
  const rounded = Math.round(n * 100) / 100;
  // Convert to string, suppress trailing zeros
  return String(rounded);
}

function indent(level) {
  return '  '.repeat(level);
}

async function buildJudgePointsMap(bracket) {
  if (bracket.length === 0) return new Map();
  const rows = await queryAll(
    'SELECT * FROM dual_judge_points WHERE match_id IN (' +
    bracket.map(() => '?').join(',') + ')',
    bracket.map(m => m.id)
  );
  const map = new Map();
  for (const jp of rows) {
    if (!map.has(jp.match_id)) map.set(jp.match_id, []);
    map.get(jp.match_id).push(jp);
  }
  return map;
}

// ── XML Generation ───────────────────────────────────────────────────────────

function generateSingleMogulXml(params) {
  const {
    meet, event, ranked, judges, officials,
    natCode, category, tdInfo
  } = params;

  const sex = event.gender;
  const eventDate = new Date(meet.date + 'T12:00:00');
  const day = eventDate.getDate();
  const month = eventDate.getMonth() + 1;
  const year = eventDate.getFullYear();

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<Fisresults>');

  // Raceheader
  lines.push(`${indent(1)}<Raceheader Sector="FS" Sex="${sex}">`);
  lines.push(`${indent(2)}<Season>${year}</Season>`);
  lines.push(`${indent(2)}<Codex></Codex>`);
  lines.push(`${indent(2)}<NAT_code>${natCode}</NAT_code>`);
  lines.push(`${indent(2)}<Nation>USA</Nation>`);
  lines.push(`${indent(2)}<Discipline>MO</Discipline>`);
  lines.push(`${indent(2)}<Category>${category}</Category>`);
  lines.push(`${indent(2)}<Racedate>`);
  lines.push(`${indent(3)}<Day>${day}</Day>`);
  lines.push(`${indent(3)}<Month>${month}</Month>`);
  lines.push(`${indent(3)}<Year>${year}</Year>`);
  lines.push(`${indent(2)}</Racedate>`);
  lines.push(`${indent(2)}<Eventname>${escapeXml(meet.name)}</Eventname>`);
  lines.push(`${indent(2)}<Place>${escapeXml(meet.location)}</Place>`);

  // TD block for DIV/DIC only
  if (category === 'DIV' || category === 'DIC') {
    lines.push(`${indent(2)}<TD Function="Delegate">`);
    lines.push(`${indent(3)}<Tdnumb>999</Tdnumb>`);
    lines.push(`${indent(3)}<Tdnation></Tdnation>`);
    lines.push(`${indent(3)}<Tdlastname>${escapeXml((tdInfo.lastName || '').toUpperCase())}</Tdlastname>`);
    lines.push(`${indent(3)}<Tdfirstname>${escapeXml(tdInfo.firstName || '')}</Tdfirstname>`);
    lines.push(`${indent(3)}<NAT_tdnum>${escapeXml(tdInfo.usssNum || '')}</NAT_tdnum>`);
    lines.push(`${indent(2)}</TD>`);
  }

  lines.push(`${indent(1)}</Raceheader>`);

  // FS_race
  lines.push(`${indent(1)}<FS_race>`);

  // Jury elements
  const juryLines = buildJuryElements(judges, officials);
  for (const jl of juryLines) lines.push(jl);

  // FS_raceinfo
  const scoringJudgeCount = judges.filter(j => j.role !== 'HJ').length;
  lines.push(`${indent(2)}<FS_raceinfo>`);
  lines.push(`${indent(3)}<Dataprocessingby>StickIt ${STICKIT_VERSION}</Dataprocessingby>`);
  lines.push(`${indent(3)}<NumberRuns>2</NumberRuns>`);
  lines.push(`${indent(3)}<NumberJudges>${scoringJudgeCount}</NumberJudges>`);
  lines.push(`${indent(2)}</FS_raceinfo>`);

  // FS_classified
  lines.push(`${indent(2)}<FS_classified>`);

  for (const r of ranked) {
    // Skip non-finishers
    if (r.run_status) continue;

    lines.push(`${indent(3)}<FS_ranked Status="QLF">`);
    lines.push(`${indent(4)}<Rank>${r.rank}</Rank>`);
    lines.push(`${indent(4)}<Bib>${r.bib_number || ''}</Bib>`);
    lines.push(`${indent(4)}<Competitor>`);
    lines.push(`${indent(5)}<Fiscode>9999999</Fiscode>`);
    lines.push(`${indent(5)}<Lastname>${escapeXml((r.last_name || '').toUpperCase())}</Lastname>`);
    lines.push(`${indent(5)}<Firstname>${escapeXml(r.first_name || '')}</Firstname>`);
    lines.push(`${indent(5)}<Sex>${sex}</Sex>`);
    lines.push(`${indent(5)}<Nation>${escapeXml(r.nation || 'USA')}</Nation>`);
    lines.push(`${indent(5)}<Yearofbirth>${r.birth_year || ''}</Yearofbirth>`);
    lines.push(`${indent(5)}<NAT_code>${escapeXml(r.ussa_num || '')}</NAT_code>`);
    lines.push(`${indent(4)}</Competitor>`);
    lines.push(`${indent(4)}<FS_result>`);

    // Compute best of run 1 and run 2
    const run1 = r._run1_total != null ? Number(r._run1_total) : 0;
    const run2 = r._run2_total != null ? Number(r._run2_total) : 0;
    const best = Math.max(run1, run2);

    lines.push(`${indent(5)}<Pointsdescend>${formatScore(best)}</Pointsdescend>`);
    lines.push(`${indent(5)}<Run_1>${formatScore(run1)}</Run_1>`);
    lines.push(`${indent(5)}<Run_2>${formatScore(run2)}</Run_2>`);
    lines.push(`${indent(5)}<Level></Level>`);
    lines.push(`${indent(4)}</FS_result>`);
    lines.push(`${indent(3)}</FS_ranked>`);
  }

  lines.push(`${indent(2)}</FS_classified>`);

  // FS_notclassified (always present, even if empty)
  lines.push(`${indent(2)}<FS_notclassified>`);
  lines.push(`${indent(2)}</FS_notclassified>`);

  lines.push(`${indent(1)}</FS_race>`);
  lines.push('</Fisresults>');

  return lines.join(CRLF) + CRLF;
}


function generateDualMogulXml(params) {
  const {
    meet, event, bracket, registrations, judges, officials,
    natCode, category, tdInfo, judgePointsMap
  } = params;

  const sex = event.gender;
  const eventDate = new Date(meet.date + 'T12:00:00');
  const day = eventDate.getDate();
  const month = eventDate.getMonth() + 1;
  const year = eventDate.getFullYear();

  // Determine number of bracket rounds conducted
  const maxRound = bracket.reduce((mx, m) => Math.max(mx, m.bracket_round || 0), 0);

  // Build standings from bracket
  const standings = computeDualStandings(bracket, registrations, maxRound, judgePointsMap);

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<Fisresults>');

  // Raceheader
  lines.push(`${indent(1)}<Raceheader Sector="FS" Sex="${sex}">`);
  lines.push(`${indent(2)}<Season>${year}</Season>`);
  lines.push(`${indent(2)}<Codex></Codex>`);
  lines.push(`${indent(2)}<NAT_code>${natCode}</NAT_code>`);
  lines.push(`${indent(2)}<Nation>USA</Nation>`);
  lines.push(`${indent(2)}<Discipline>DM</Discipline>`);
  lines.push(`${indent(2)}<Category>${category}</Category>`);
  lines.push(`${indent(2)}<Racedate>`);
  lines.push(`${indent(3)}<Day>${day}</Day>`);
  lines.push(`${indent(3)}<Month>${month}</Month>`);
  lines.push(`${indent(3)}<Year>${year}</Year>`);
  lines.push(`${indent(2)}</Racedate>`);
  lines.push(`${indent(2)}<Eventname>${escapeXml(meet.name)}</Eventname>`);
  lines.push(`${indent(2)}<Place>${escapeXml(meet.location)}</Place>`);

  if (category === 'DIV' || category === 'DIC') {
    lines.push(`${indent(2)}<TD Function="Delegate">`);
    lines.push(`${indent(3)}<Tdnumb>999</Tdnumb>`);
    lines.push(`${indent(3)}<Tdnation></Tdnation>`);
    lines.push(`${indent(3)}<Tdlastname>${escapeXml((tdInfo.lastName || '').toUpperCase())}</Tdlastname>`);
    lines.push(`${indent(3)}<Tdfirstname>${escapeXml(tdInfo.firstName || '')}</Tdfirstname>`);
    lines.push(`${indent(3)}<NAT_tdnum>${escapeXml(tdInfo.usssNum || '')}</NAT_tdnum>`);
    lines.push(`${indent(2)}</TD>`);
  }

  lines.push(`${indent(1)}</Raceheader>`);

  // FS_race
  lines.push(`${indent(1)}<FS_race>`);

  // Jury
  const juryLines = buildJuryElements(judges, officials);
  for (const jl of juryLines) lines.push(jl);

  // FS_raceinfo
  const scoringJudgeCount = judges.filter(j => j.role !== 'HJ').length;
  lines.push(`${indent(2)}<FS_raceinfo>`);
  lines.push(`${indent(3)}<Dataprocessingby>StickIt ${STICKIT_VERSION}</Dataprocessingby>`);
  lines.push(`${indent(3)}<NumberRuns>${maxRound}</NumberRuns>`);
  lines.push(`${indent(3)}<NumberJudges>${scoringJudgeCount}</NumberJudges>`);
  lines.push(`${indent(2)}</FS_raceinfo>`);

  // FS_classified
  lines.push(`${indent(2)}<FS_classified>`);

  for (const s of standings) {
    lines.push(`${indent(3)}<FS_ranked Status="QLF">`);
    lines.push(`${indent(4)}<Rank>${s.rank}</Rank>`);
    lines.push(`${indent(4)}<Bib>${s.bib || ''}</Bib>`);
    lines.push(`${indent(4)}<Competitor>`);
    lines.push(`${indent(5)}<Fiscode>9999999</Fiscode>`);
    lines.push(`${indent(5)}<Lastname>${escapeXml((s.lastName || '').toUpperCase())}</Lastname>`);
    lines.push(`${indent(5)}<Firstname>${escapeXml(s.firstName || '')}</Firstname>`);
    lines.push(`${indent(5)}<Sex>${sex}</Sex>`);
    lines.push(`${indent(5)}<Nation>${escapeXml(s.nation || 'USA')}</Nation>`);
    lines.push(`${indent(5)}<Yearofbirth>${s.birthYear || ''}</Yearofbirth>`);
    lines.push(`${indent(5)}<NAT_code>${escapeXml(s.ussaNum || '')}</NAT_code>`);
    lines.push(`${indent(4)}</Competitor>`);
    lines.push(`${indent(4)}<FS_result>`);
    lines.push(`${indent(5)}<Pointsdescend>${formatScore(s.pointsdescend)}</Pointsdescend>`);

    // Run_N elements: athlete's match score per round
    for (const rn of s.runElements) {
      lines.push(`${indent(5)}<Run_${rn.round}>${rn.matchScore}</Run_${rn.round}>`);
    }

    lines.push(`${indent(5)}<Level>${escapeXml(s.level)}</Level>`);
    lines.push(`${indent(4)}</FS_result>`);
    lines.push(`${indent(3)}</FS_ranked>`);
  }

  lines.push(`${indent(2)}</FS_classified>`);

  lines.push(`${indent(2)}<FS_notclassified>`);
  lines.push(`${indent(2)}</FS_notclassified>`);

  lines.push(`${indent(1)}</FS_race>`);
  lines.push('</Fisresults>');

  return lines.join(CRLF) + CRLF;
}


// ── Build jury elements ──────────────────────────────────────────────────────

function buildJuryElements(judges, officials) {
  const lines = [];
  const emit = (fn, lastName, firstName, natNum) => {
    lines.push(`${indent(2)}<Jury Function="${fn}">`);
    lines.push(`${indent(3)}<Jurylastname>${escapeXml((lastName || '').toUpperCase())}</Jurylastname>`);
    lines.push(`${indent(3)}<Juryfirstname>${escapeXml(firstName || '')}</Juryfirstname>`);
    lines.push(`${indent(3)}<Jurynation>UNK</Jurynation>`);
    lines.push(`${indent(3)}<NAT_num>${escapeXml(natNum || '')}</NAT_num>`);
    lines.push(`${indent(2)}</Jury>`);
  };

  // Parse name into first/last (stored as single "name" field)
  const parseName = (fullName) => {
    if (!fullName) return { first: '', last: '' };
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return { first: '', last: parts[0] };
    const last = parts[parts.length - 1];
    const first = parts.slice(0, -1).join(' ');
    return { first, last };
  };

  // Turns judges first
  const turnsJudges = judges.filter(j =>
    j.role.startsWith('TL') || j.role.startsWith('DualTurns')
  );
  for (const j of turnsJudges) {
    const { first, last } = parseName(j.name);
    emit('Judge', last, first, j.ussa_id || '');
  }

  // Head Judge (also listed as Judge per spec)
  const hjJudge = judges.find(j => j.role === 'HJ');
  if (hjJudge) {
    const { first, last } = parseName(hjJudge.name);
    emit('Judge', last, first, hjJudge.ussa_id || '');
    emit('HeadJudge', last, first, hjJudge.ussa_id || '');
  } else {
    // Check officials for Head Judge
    const hjOfficial = officials.find(o => o.role === 'Head Judge');
    if (hjOfficial) {
      const { first, last } = parseName(hjOfficial.name);
      emit('HeadJudge', last, first, hjOfficial.ussa_id || '');
    }
  }

  // Officials mapping
  const officialRoleMap = [
    { dbRole: 'Chief of Competition', xmlFunc: 'ChiefComp' },
    { dbRole: 'Chief of Course', xmlFunc: 'ChiefCourse' },
    { dbRole: 'Chief of Score', xmlFunc: 'ChiefCalc' },
    { dbRole: 'Chief of Start', xmlFunc: 'ChiefStart' },
    { dbRole: 'Competition Secretary', xmlFunc: 'CompetitionSec' },
  ];

  for (const mapping of officialRoleMap) {
    const off = officials.find(o => o.role === mapping.dbRole);
    if (off) {
      const { first, last } = parseName(off.name);
      emit(mapping.xmlFunc, last, first, off.ussa_id || '');
    }
  }

  return lines;
}


// ── Dual mogul standings computation ─────────────────────────────────────────

function computeDualStandings(bracket, registrations, maxRound, judgePointsMap = new Map()) {
  // Build a lookup for registrations
  const regMap = {};
  for (const reg of registrations) {
    regMap[reg.id] = reg;
  }

  // Build a map of athlete participation: regId -> [{round, opponentRegId, won}]
  const athleteMatches = {};
  const ensureAthlete = (regId) => {
    if (!athleteMatches[regId]) athleteMatches[regId] = [];
  };

  for (const match of bracket) {
    if (match.status !== 'complete') continue;
    const blueRegId = match.registration_id_blue;
    const redRegId = match.registration_id_red;

    if (blueRegId) {
      ensureAthlete(blueRegId);
      athleteMatches[blueRegId].push({
        round: match.bracket_round,
        matchId: match.id,
        color: 'blue',
        opponentRegId: redRegId,
        won: match.winner_registration_id === blueRegId,
        isSmallFinal: !!match.is_small_final,
      });
    }
    if (redRegId) {
      ensureAthlete(redRegId);
      athleteMatches[redRegId].push({
        round: match.bracket_round,
        matchId: match.id,
        color: 'red',
        opponentRegId: blueRegId,
        won: match.winner_registration_id === redRegId,
        isSmallFinal: !!match.is_small_final,
      });
    }
  }

  // Determine deepest round for each athlete
  const levelLabels = {
    1: 'Final',
    2: '3/4 final',
    3: 'semi-final',
    4: 'top 8',
    5: 'top 16',
    6: 'top 32',
    7: 'top 64',
  };

  // Compute rank from bracket placement
  // The champion won the final; runner-up lost the final;
  // 3rd place won the small final (if exists); 4th lost small final
  // Then by deepest round reached (lower round number = deeper)
  const athleteData = [];
  for (const [regId, matches] of Object.entries(athleteMatches)) {
    const reg = regMap[regId];
    if (!reg) continue;

    // Find deepest round (lowest bracket_round number for non-small-final)
    const normalMatches = matches.filter(m => !m.isSmallFinal);
    const smallFinalMatches = matches.filter(m => m.isSmallFinal);

    let deepestRound = normalMatches.length > 0
      ? Math.min(...normalMatches.map(m => m.round))
      : maxRound + 1;

    // Special cases for final and small final
    let isFinalWinner = false;
    let isFinalLoser = false;
    let isSmallFinalWinner = false;
    let isSmallFinalLoser = false;

    const finalMatch = normalMatches.find(m => m.round === 1);
    if (finalMatch) {
      isFinalWinner = finalMatch.won;
      isFinalLoser = !finalMatch.won;
    }

    if (smallFinalMatches.length > 0) {
      const sf = smallFinalMatches[0];
      isSmallFinalWinner = sf.won;
      isSmallFinalLoser = !sf.won;
    }

    // Determine sort order (lower = better)
    let sortOrder;
    if (isFinalWinner) sortOrder = 1;
    else if (isFinalLoser) sortOrder = 2;
    else if (isSmallFinalWinner) sortOrder = 3;
    else if (isSmallFinalLoser) sortOrder = 4;
    else sortOrder = 4 + Math.pow(2, deepestRound - 1); // Approximate position

    // Level label
    let level = levelLabels[deepestRound] || `top ${Math.pow(2, deepestRound)}`;
    if (isFinalWinner || isFinalLoser) level = 'Final';
    else if (isSmallFinalWinner || isSmallFinalLoser) level = '3/4 final';

    // Run elements: athlete's match score per round (skip byes)
    const runElements = [];
    for (const m of matches) {
      const matchPoints = judgePointsMap.get(m.matchId) || [];
      // Skip byes (no judge scores entered)
      if (matchPoints.length === 0) continue;
      let athleteScore = 0;
      for (const jp of matchPoints) {
        if (m.color === 'blue') athleteScore += (jp.blue_points || 0);
        else athleteScore += (jp.red_points || 0);
      }
      runElements.push({
        round: m.round,
        matchScore: athleteScore,
      });
    }
    // Sort by round number
    runElements.sort((a, b) => a.round - b.round);

    athleteData.push({
      regId,
      bib: reg.bib_number || '',
      firstName: reg.first_name || '',
      lastName: reg.last_name || '',
      nation: reg.nation || 'USA',
      birthYear: reg.birth_year || '',
      ussaNum: reg.ussa_num || '',
      sortOrder,
      level,
      runElements,
    });
  }

  // Sort by sortOrder then bib as tiebreaker
  athleteData.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return (a.bib || 0) - (b.bib || 0);
  });

  // Assign ranks
  for (let i = 0; i < athleteData.length; i++) {
    athleteData[i].rank = i + 1;
  }

  // Compute Pointsdescend: 30 * 0.98^(rank-1) (exponential decay, matches Winfree/USSS)
  for (const a of athleteData) {
    a.pointsdescend = Math.round(30 * Math.pow(0.98, a.rank - 1) * 1000) / 1000;
  }

  return athleteData;
}


// ── XML escape ───────────────────────────────────────────────────────────────

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}


// ── POST /api/export/usss-transmit/:meetId ───────────────────────────────────

router.post('/usss-transmit/:meetId', async (req, res) => {
  try {
    const meet = await queryOne('SELECT * FROM meets WHERE id=?', [req.params.meetId]);
    if (!meet) return res.status(404).json({ error: 'Meet not found' });

    const {
      category,
      maleMogulId, femaleMogulId,
      maleDualId, femaleDualId,
      tdLastName, tdFirstName, tdUsssNum,
    } = req.body;

    // ── Validation ─────────────────────────────────────────────────────────
    const errors = [];
    const warnings = [];

    if (!category) errors.push('USSS Category is required.');

    // Load all events for this meet
    const events = await queryAll('SELECT * FROM events WHERE meet_id=?', [req.params.meetId]);
    const mogulEvents = events.filter(e => e.discipline === 'mogul');
    const dualEvents = events.filter(e => e.discipline === 'dual_mogul');

    // Only require IDs for genders that have events
    const hasMaleMogul = mogulEvents.some(e => e.gender === 'male');
    const hasFemaleMogul = mogulEvents.some(e => e.gender === 'female');
    const hasMaleDual = dualEvents.some(e => e.gender === 'male');
    const hasFemaleDual = dualEvents.some(e => e.gender === 'female');

    if (hasMaleMogul && (!maleMogulId || !maleMogulId.trim())) errors.push('Male Mogul ID is required.');
    if (hasFemaleMogul && (!femaleMogulId || !femaleMogulId.trim())) errors.push('Female Mogul ID is required.');

    if ((category === 'DIV' || category === 'DIC')) {
      if (!tdLastName || !tdLastName.trim()) errors.push('TD Last Name is required for DIV/DIC.');
      if (!tdFirstName || !tdFirstName.trim()) errors.push('TD First Name is required for DIV/DIC.');
      if (!tdUsssNum || !tdUsssNum.trim()) errors.push('TD USSS Number is required for DIV/DIC.');
    }

    // Check if dual events exist and dual IDs are provided
    if (hasMaleDual && (!maleDualId || !maleDualId.trim())) errors.push('Male Dual ID is required (meet has dual mogul events).');
    if (hasFemaleDual && (!femaleDualId || !femaleDualId.trim())) errors.push('Female Dual ID is required (meet has dual mogul events).');

    // ── Gather data per event ──────────────────────────────────────────────
    const tdInfo = { lastName: tdLastName, firstName: tdFirstName, usssNum: tdUsssNum };
    const xmlFiles = [];
    const excluded = [];

    // Officials for the meet
    const officials = await queryAll('SELECT * FROM officials WHERE meet_id=?', [req.params.meetId]);

    // Helper: process a single mogul event
    const processMogulEvent = async (event, natCode) => {
      // Check finalization: at least one complete run (supports both legacy round-based and phase-based events)
      const completeRuns = await queryAll(
        `SELECT r.*, reg.bib_number, reg.seed, a.first_name, a.last_name,
                a.ussa_num, a.birth_year, a.nation, a.gender as athlete_gender
         FROM runs r
         JOIN registrations reg ON reg.id = r.registration_id
         JOIN athletes a ON a.id = reg.athlete_id
         WHERE r.event_id=? AND r.status='complete'`,
        [event.id]
      );

      if (completeRuns.length === 0) {
        excluded.push(event.name);
        return null;
      }

      // Judges for this event
      const judges = await queryAll('SELECT * FROM judges WHERE event_id=?', [event.id]);
      const turnsJudges = judges.filter(j =>
        j.role.startsWith('TL') || j.role.startsWith('DualTurns')
      );
      if (turnsJudges.length === 0) {
        errors.push(`No turns judges assigned to ${event.name}.`);
        return null;
      }

      // Build run 1 and run 2 per athlete
      const athleteRuns = {};
      for (const r of completeRuns) {
        if (r.run_status) continue; // Skip DNS/DNF/DSQ
        if (!athleteRuns[r.registration_id]) {
          athleteRuns[r.registration_id] = { ...r, _run1_total: null, _run2_total: null };
        }
        if (r.run_number === 1) {
          athleteRuns[r.registration_id]._run1_total = r.total_score;
          // If this is also the best, keep all fields
          if (!athleteRuns[r.registration_id].total_score ||
              r.total_score > athleteRuns[r.registration_id].total_score) {
            Object.assign(athleteRuns[r.registration_id], r);
          }
        } else if (r.run_number === 2) {
          athleteRuns[r.registration_id]._run2_total = r.total_score;
          if (r.total_score > athleteRuns[r.registration_id].total_score) {
            Object.assign(athleteRuns[r.registration_id], r);
          }
        }
      }

      // For athletes with only one run, set their run total
      for (const [regId, data] of Object.entries(athleteRuns)) {
        if (data._run1_total == null && data._run2_total == null) {
          // Single run, use run_number to determine
          if (data.run_number === 1) data._run1_total = data.total_score;
          else data._run2_total = data.total_score;
        }
        if (data._run1_total == null) data._run1_total = 0;
        if (data._run2_total == null) data._run2_total = 0;
      }

      const ranked = rankResults(Object.values(athleteRuns), event.discipline);

      // Warnings: athletes missing USSS number
      const missingUsss = ranked.filter(r => !r.ussa_num && !r.run_status);
      if (missingUsss.length > 0) {
        const list = missingUsss.map(r => `${r.first_name} ${r.last_name} (bib ${r.bib_number})`).join(', ');
        warnings.push(`${event.name}: Athletes missing USSS#: ${list}`);
      }

      const xml = generateSingleMogulXml({
        meet, event, ranked, judges, officials,
        natCode, category, tdInfo,
      });

      const fileName = `SF${natCode}_${event.gender}_MO.xml`;
      return { fileName, xml };
    };

    // Helper: process a dual mogul event
    const processDualEvent = async (event, natCode) => {
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
        [event.id]
      );

      const completeMatches = bracket.filter(m => m.status === 'complete');
      if (completeMatches.length === 0) {
        excluded.push(event.name);
        return null;
      }

      const judges = await queryAll('SELECT * FROM judges WHERE event_id=?', [event.id]);
      const turnsJudges = judges.filter(j =>
        j.role.startsWith('DualTurns') || j.role.startsWith('TL')
      );
      if (turnsJudges.length === 0) {
        errors.push(`No turns judges assigned to ${event.name}.`);
        return null;
      }

      // Build enriched registrations
      const regs = await queryAll(
        `SELECT reg.*, a.first_name, a.last_name, a.ussa_num, a.birth_year, a.nation
         FROM registrations reg
         JOIN athletes a ON a.id = reg.athlete_id
         WHERE reg.event_id=?`,
        [event.id]
      );

      const judgePointsMap = await buildJudgePointsMap(bracket);

      const xml = generateDualMogulXml({
        meet, event, bracket, registrations: regs, judges, officials,
        natCode, category, tdInfo, judgePointsMap,
      });

      const fileName = `SF${natCode}_${event.gender}_DM.xml`;
      return { fileName, xml };
    };

    // Process mogul events
    for (const ev of mogulEvents) {
      const natCode = normalizeGender(ev.gender) === 'M' ? maleMogulId : femaleMogulId;
      const result = await processMogulEvent(ev, (natCode || '').trim());
      if (result) xmlFiles.push(result);
    }

    // Process dual mogul events
    for (const ev of dualEvents) {
      const natCode = normalizeGender(ev.gender) === 'M' ? (maleDualId || '').trim() : (femaleDualId || '').trim();
      const result = await processDualEvent(ev, natCode);
      if (result) xmlFiles.push(result);
    }

    // Hard block: no files generated
    if (errors.length > 0) {
      return res.status(400).json({ errors, warnings });
    }

    if (xmlFiles.length === 0) {
      return res.status(400).json({
        errors: ['No events produced output. All events may be unfinalized.'],
        warnings,
        excluded,
      });
    }

    // If only warnings, return them for client acknowledgment
    // Client must re-submit with acknowledgeWarnings=true
    if (warnings.length > 0 && !req.body.acknowledgeWarnings) {
      return res.status(200).json({
        needsAcknowledgment: true,
        warnings,
        excluded,
      });
    }

    // ── Generate ZIP ───────────────────────────────────────────────────────
    const allIds = [maleMogulId, femaleMogulId, maleDualId, femaleDualId]
      .filter(Boolean)
      .map(s => s.trim());
    const lowestId = allIds.sort()[0] || 'EXPORT';

    const zipName = `SF${lowestId}.ZIP`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    for (const f of xmlFiles) {
      archive.append(Buffer.from(f.xml, 'utf8'), { name: f.fileName });
    }

    await archive.finalize();

    try {
      await logAudit('export', 'meet', req.params.meetId, null, {
        format: 'usss-transmit', category, files: xmlFiles.map(f => f.fileName),
      });
    } catch (_) {}

  } catch (e) {
    console.error('USSS transmit export error:', e);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    }
  }
});


// ── GET /api/export/usss-transmit-check/:meetId ──────────────────────────────
// Quick check: which events are available for export

router.get('/usss-transmit-check/:meetId', async (req, res) => {
  try {
    const events = await queryAll('SELECT * FROM events WHERE meet_id=?', [req.params.meetId]);
    const result = { mogul: { M: false, F: false }, dual: { M: false, F: false }, hasDual: false };

    for (const ev of events) {
      if (ev.discipline === 'mogul') {
        const count = await queryOne(
          `SELECT COUNT(*) as cnt FROM runs WHERE event_id=? AND status='complete' AND round='qualification'`,
          [ev.id]
        );
        if (count && parseInt(count.cnt) > 0) {
          result.mogul[ev.gender] = true;
        }
      } else if (ev.discipline === 'dual_mogul') {
        result.hasDual = true;
        const count = await queryOne(
          `SELECT COUNT(*) as cnt FROM dual_bracket WHERE event_id=? AND status='complete'`,
          [ev.id]
        );
        if (count && parseInt(count.cnt) > 0) {
          result.dual[ev.gender] = true;
        }
      }
    }

    result.hasFinalized = result.mogul.M || result.mogul.F || result.dual.M || result.dual.F;
    result.divisions = [...new Set(events.map(e => e.division))];
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});


router.generateSingleMogulXml = generateSingleMogulXml;
router.generateDualMogulXml = generateDualMogulXml;
router.buildJudgePointsMap = buildJudgePointsMap;

module.exports = router;
