const router = require('express').Router();
const { queryAll, queryOne } = require('../db/schema');
const { rankResults, resolveEffectiveStatus } = require('../scoring/engine');
const { logAudit } = require('./audit');
const archiver = require('archiver');

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

// v1.26.00 — RNS is a legacy Winfree convention with no USSS/FIS status
// vocabulary equivalent; map it to DNF at emission time only (stored data
// is untouched).
function xmlStatus(s) {
  const up = String(s || 'DNS').toUpperCase();
  return up === 'RNS' ? 'DNF' : up;
}

// Order FS_notranked entries: DNF (incl. mapped RNS) -> DNS -> DSQ, bib asc.
// Cosmetic per the v1.26.00 spec; Status values take priority over order.
function sortNotClassified(arr, statusOf, bibOf) {
  const prec = { DNF: 1, DNS: 2, DSQ: 3 };
  const bibNum = v => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
  };
  return [...arr].sort((a, b) =>
    ((prec[xmlStatus(statusOf(a))] || 9) - (prec[xmlStatus(statusOf(b))] || 9)) ||
    (bibNum(bibOf(a)) - bibNum(bibOf(b)))
  );
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

// v1.27.00 — fully-automatic transmit: the category derives from each event's
// division (previously the operator picked one category for the whole meet).
const DIVISION_TO_CATEGORY = {
  comp_series: 'DIV',
  rqs_eqs: 'EQS',
  rqs: 'EQS',
  devo: 'ROC',
  devo_junior: 'ROC',
  open: 'DIV',
};

// Split a single stored "First [Middle] Last" name into first/last.
function parseFullName(fullName) {
  if (!fullName) return { first: '', last: '' };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { first: '', last: parts[0] };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

// Shared by POST /usss-transmit and GET /usss-transmit-check (v1.27.00).
// Derives per-event category/natCode and collects every blocking problem —
// "block everything": nothing generates until every event in the meet is valid.
async function validateMeetForTransmit(meetId) {
  const meet = await queryOne('SELECT * FROM meets WHERE id=?', [meetId]);
  if (!meet) return { meet: null };

  const events = await queryAll('SELECT * FROM events WHERE meet_id=?', [meetId]);
  const eventInfos = [];

  for (const ev of events) {
    const problems = [];
    const category = DIVISION_TO_CATEGORY[ev.division] || null;
    const natCode = (ev.usss_code || '').trim();

    if (ev.status !== 'complete') problems.push('Event is not complete');
    if (!natCode) problems.push('Missing USSS code (set it on the event page)');
    if (!category) problems.push(`No USSS category for division "${ev.division || '(none)'}"`);

    if (ev.discipline === 'aerials') {
      const jc = await queryOne('SELECT COUNT(*) as cnt FROM judges WHERE event_id=?', [ev.id]);
      if (!jc || parseInt(jc.cnt) === 0) problems.push('No judges assigned');
    } else {
      const tj = await queryOne(
        `SELECT COUNT(*) as cnt FROM judges WHERE event_id=? AND (role LIKE 'TL%' OR role LIKE 'DualTurns%')`,
        [ev.id]
      );
      if (!tj || parseInt(tj.cnt) === 0) problems.push('No turns judges assigned');
    }

    eventInfos.push({ event: ev, category, natCode, problems });
  }

  // TD block is required in the XML when any event's category is DIV or DIC.
  // Pulled from meet officials (David's ruling) — meet-level rows preferred.
  const tdRequired = eventInfos.some(i => i.category === 'DIV' || i.category === 'DIC');
  const tds = await queryAll(
    `SELECT * FROM officials WHERE meet_id=? AND role='Technical Delegate'
     ORDER BY CASE WHEN event_id IS NULL OR event_id='' THEN 0 ELSE 1 END`,
    [meetId]
  );
  const tdOfficial = tds[0] || null;
  const tdProblems = [];
  if (tdRequired) {
    if (!tdOfficial) {
      tdProblems.push('No Technical Delegate assigned to this meet (add one under Officials)');
    } else if (!tdOfficial.ussa_id) {
      tdProblems.push(`Technical Delegate ${tdOfficial.name} has no USSS number (edit under Officials)`);
    }
  }

  return { meet, eventInfos, tdRequired, tdOfficial, tdProblems };
}

// ── XML Generation ───────────────────────────────────────────────────────────

function generateSingleMogulXml(params) {
  const {
    meet, event, ranked, notClassified = [], judges, officials,
    natCode, category, tdInfo,
    // v1.27.00 — 'MO' for mogul, 'AE' for aerials (same runs-based structure)
    disciplineCode = 'MO',
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
  lines.push(`${indent(2)}<Discipline>${disciplineCode}</Discipline>`);
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
  const juryLines = buildJuryElements(judges, officials, event.discipline);
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

  // FS_notclassified — DNS / DNF / DSQ (and legacy RNS -> DNF) athletes
  lines.push(`${indent(2)}<FS_notclassified>`);
  for (const r of sortNotClassified(notClassified, x => x.runStatus, x => x.bib_number)) {
    const status = xmlStatus(r.runStatus);
    lines.push(`${indent(3)}<FS_notranked Status="${escapeXml(status)}">`);
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
    lines.push(`${indent(3)}</FS_notranked>`);
  }
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

  // Split standings into classified (no DNS/DNF/DSQ/RNS) and notClassified
  const classifiedStandings = standings.filter(s => !s.runStatus);
  const notClassifiedStandings = standings.filter(s => s.runStatus);

  // FS_classified
  lines.push(`${indent(2)}<FS_classified>`);

  for (const s of classifiedStandings) {
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

  // FS_notclassified — DNS / DNF / DSQ (and legacy RNS -> DNF) athletes
  lines.push(`${indent(2)}<FS_notclassified>`);
  for (const s of sortNotClassified(notClassifiedStandings, x => x.runStatus, x => x.bib)) {
    const status = xmlStatus(s.runStatus);
    lines.push(`${indent(3)}<FS_notranked Status="${escapeXml(status)}">`);
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
    lines.push(`${indent(3)}</FS_notranked>`);
  }
  lines.push(`${indent(2)}</FS_notclassified>`);

  lines.push(`${indent(1)}</FS_race>`);
  lines.push('</Fisresults>');

  return lines.join(CRLF) + CRLF;
}


// ── Build jury elements ──────────────────────────────────────────────────────

function buildJuryElements(judges, officials, discipline = 'mogul') {
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

  // Scoring judges first — turns judges for mogul/dual; for aerials, the
  // AeJudgeN panel (v2) or legacy per-component judges (v1.27.00)
  const turnsJudges = judges.filter(j =>
    discipline === 'aerials'
      ? (j.role.startsWith('AeJudge') || j.role.startsWith('AirJudge') ||
         j.role.startsWith('FormJudge') || j.role.startsWith('LandingJudge'))
      : (j.role.startsWith('TL') || j.role.startsWith('DualTurns'))
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
      const won = match.winner_registration_id === blueRegId;
      athleteMatches[blueRegId].push({
        round: match.bracket_round,
        matchId: match.id,
        color: 'blue',
        opponentRegId: redRegId,
        won,
        // loser_status applies to whichever side lost this match
        loserStatus: !won ? (match.loser_status || null) : null,
        isSmallFinal: !!match.is_small_final,
        position: match.bracket_position,
      });
    }
    if (redRegId) {
      ensureAthlete(redRegId);
      const won = match.winner_registration_id === redRegId;
      athleteMatches[redRegId].push({
        round: match.bracket_round,
        matchId: match.id,
        color: 'red',
        opponentRegId: blueRegId,
        won,
        loserStatus: !won ? (match.loser_status || null) : null,
        isSmallFinal: !!match.is_small_final,
        position: match.bracket_position,
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

    // Special cases for final and consolation finals
    let isFinalWinner = false;
    let isFinalLoser = false;

    const finalMatch = normalMatches.find(m => m.round === 1);
    if (finalMatch) {
      isFinalWinner = finalMatch.won;
      isFinalLoser = !finalMatch.won;
    }

    // F-2: the TERMINAL consolation final decides 3/4, 5/6 or 7/8. Round-1 small
    // finals are terminal (pos 2/3/4 -> 3/4, 5/6, 7/8); round-2 small finals are
    // the new 5-8 SEMIS (a stepping stone, ignored for placement) or, on legacy
    // events with no round-1 5/6 final, the terminal 5/6 & 7/8 matches.
    const hasRound1SF = smallFinalMatches.some(m => m.round === 1);
    const terminalSF = smallFinalMatches.find(m => m.round === 1)
      || (!hasRound1SF ? smallFinalMatches.find(m => m.round === 2) : null);
    let sfBase = null; // the better of the two places this final decides
    if (terminalSF) {
      sfBase = terminalSF.round === 1
        ? (terminalSF.position === 3 ? 5 : terminalSF.position === 4 ? 7 : 3)
        : (terminalSF.position === 4 ? 7 : 5); // legacy round-2 terminal
    }

    // Determine sort order (lower = better)
    let sortOrder;
    if (isFinalWinner) sortOrder = 1;
    else if (isFinalLoser) sortOrder = 2;
    else if (sfBase != null) sortOrder = terminalSF.won ? sfBase : sfBase + 1;
    else sortOrder = 8 + Math.pow(2, deepestRound - 1); // beyond the 5-8 places

    // Level label
    let level = levelLabels[deepestRound] || `top ${Math.pow(2, deepestRound)}`;
    if (isFinalWinner || isFinalLoser) level = 'Final';
    else if (sfBase === 3) level = '3/4 final';
    else if (sfBase === 5) level = '5/6 final';
    else if (sfBase === 7) level = '7/8 final';

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

    // Tag DNS/DNF/DSQ/RNS athletes: never won a match AND elimination match has loser_status.
    const wonCount = matches.filter(m => m.won).length;
    let runStatus = null;
    if (wonCount === 0) {
      const statusedLoss = matches.find(m => !m.won && m.loserStatus);
      if (statusedLoss) runStatus = statusedLoss.loserStatus;
    }

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
      runStatus,
    });
  }

  // Sort by sortOrder then bib as tiebreaker
  athleteData.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return (a.bib || 0) - (b.bib || 0);
  });

  // Assign ranks ONLY to classified athletes (those without a runStatus).
  // notClassified athletes appear in FS_notclassified without a Rank element.
  let rankCounter = 0;
  for (const a of athleteData) {
    if (!a.runStatus) {
      rankCounter += 1;
      a.rank = rankCounter;
    }
  }

  // Compute Pointsdescend only for classified athletes
  for (const a of athleteData) {
    if (a.rank != null) {
      a.pointsdescend = Math.round(30 * Math.pow(0.98, a.rank - 1) * 1000) / 1000;
    }
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
    // v1.27.00 — fully automatic: category, USSS codes, and TD info all derive
    // from stored data. Body carries only { acknowledgeWarnings }.
    const v = await validateMeetForTransmit(req.params.meetId);
    if (!v.meet) return res.status(404).json({ error: 'Meet not found' });
    const { meet, eventInfos, tdOfficial, tdProblems } = v;

    // ── Validation — block everything on any problem ───────────────────────
    const errors = [];
    const warnings = [];

    if (eventInfos.length === 0) errors.push('This meet has no events.');
    for (const info of eventInfos) {
      for (const p of info.problems) errors.push(`${info.event.name}: ${p}`);
    }
    errors.push(...tdProblems);

    const tdName = parseFullName(tdOfficial ? tdOfficial.name : '');
    const tdInfo = {
      lastName: tdName.last,
      firstName: tdName.first,
      usssNum: tdOfficial ? (tdOfficial.ussa_id || '') : '',
    };

    // ── Gather data per event ──────────────────────────────────────────────
    const xmlFiles = [];

    // Officials for the meet
    const officials = await queryAll('SELECT * FROM officials WHERE meet_id=?', [req.params.meetId]);

    // Helper: process a runs-based event (single mogul or aerials — v1.27.00)
    const processRunsEvent = async (event, natCode, category) => {
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
        // Backstop — event.status === 'complete' is already required upstream
        errors.push(`${event.name}: No completed runs found`);
        return null;
      }

      // Judges for this event (presence validated in validateMeetForTransmit)
      const judges = await queryAll('SELECT * FROM judges WHERE event_id=?', [event.id]);

      // Build run 1 and run 2 per athlete; track DNS/DNF/DSQ/RNS statuses
      // so athletes with no successful runs can still appear in FS_notclassified.
      const athleteRuns = {};
      const athleteHasSuccess = {};
      const athleteStatuses = {}; // regId -> { run_number: status }
      for (const r of completeRuns) {
        const id = r.registration_id;
        if (r.run_status) {
          // Stash the status. Keep an identity record for the athlete in case
          // every one of their runs ends up status'd.
          if (!athleteStatuses[id]) athleteStatuses[id] = {};
          athleteStatuses[id][r.run_number] = r.run_status;
          if (!athleteRuns[id]) {
            athleteRuns[id] = { ...r, _run1_total: null, _run2_total: null };
          }
          continue;
        }
        athleteHasSuccess[id] = true;
        if (!athleteRuns[id]) {
          athleteRuns[id] = { ...r, _run1_total: null, _run2_total: null };
        }
        if (r.run_number === 1) {
          athleteRuns[id]._run1_total = r.total_score;
          if (!athleteRuns[id].total_score ||
              r.total_score > athleteRuns[id].total_score) {
            Object.assign(athleteRuns[id], r);
          }
        } else if (r.run_number === 2) {
          athleteRuns[id]._run2_total = r.total_score;
          if (!athleteRuns[id].total_score ||
              r.total_score > athleteRuns[id].total_score) {
            Object.assign(athleteRuns[id], r);
          }
        }
      }

      // Split into classified (≥1 successful run) vs notClassified (all status'd)
      const classified = [];
      const notClassified = [];
      for (const [regId, data] of Object.entries(athleteRuns)) {
        if (athleteHasSuccess[regId]) {
          if (data._run1_total == null && data._run2_total == null) {
            // Single run, use run_number to determine
            if (data.run_number === 1) data._run1_total = data.total_score;
            else data._run2_total = data.total_score;
          }
          if (data._run1_total == null) data._run1_total = 0;
          if (data._run2_total == null) data._run2_total = 0;
          classified.push(data);
        } else {
          const byRun = athleteStatuses[regId] || {};
          // v1.26.00: resolve by precedence (DSQ > DNF > RNS > DNS), not
          // by highest run_number.
          const runStatus = resolveEffectiveStatus(Object.values(byRun));
          notClassified.push({ ...data, runStatus });
        }
      }

      const ranked = rankResults(classified, event.discipline);

      // Warnings: athletes missing USSS number (across both groups)
      const allAthletes = [...ranked, ...notClassified];
      const missingUsss = allAthletes.filter(r => !r.ussa_num);
      if (missingUsss.length > 0) {
        const list = missingUsss.map(r => `${r.first_name} ${r.last_name} (bib ${r.bib_number})`).join(', ');
        warnings.push(`${event.name}: Athletes missing USSS#: ${list}`);
      }

      const disciplineCode = event.discipline === 'aerials' ? 'AE' : 'MO';
      const xml = generateSingleMogulXml({
        meet, event, ranked, notClassified, judges, officials,
        natCode, category, tdInfo, disciplineCode,
      });

      const fileName = `SF${natCode}_${event.gender}_${disciplineCode}.xml`;
      return { fileName, xml };
    };

    // Helper: process a dual mogul event
    const processDualEvent = async (event, natCode, category) => {
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
        // Backstop — event.status === 'complete' is already required upstream
        errors.push(`${event.name}: No completed matches found`);
        return null;
      }

      // Judges for this event (presence validated in validateMeetForTransmit)
      const judges = await queryAll('SELECT * FROM judges WHERE event_id=?', [event.id]);

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

    // Process every event in the meet (skip ones already errored — nothing
    // will be generated anyway, but keep collecting problems from the rest)
    for (const info of eventInfos) {
      if (info.problems.length > 0) continue;
      const ev = info.event;
      const result = ev.discipline === 'dual_mogul'
        ? await processDualEvent(ev, info.natCode, info.category)
        : await processRunsEvent(ev, info.natCode, info.category);
      if (result) xmlFiles.push(result);
    }

    // Hard block: no files generated
    if (errors.length > 0) {
      return res.status(400).json({ errors, warnings });
    }

    if (xmlFiles.length === 0) {
      return res.status(400).json({
        errors: ['No events produced output.'],
        warnings,
      });
    }

    // If only warnings, return them for client acknowledgment
    // Client must re-submit with acknowledgeWarnings=true
    if (warnings.length > 0 && !req.body.acknowledgeWarnings) {
      return res.status(200).json({
        needsAcknowledgment: true,
        warnings,
      });
    }

    // ── Generate ZIP ───────────────────────────────────────────────────────
    const allCodes = eventInfos.map(i => i.natCode).filter(Boolean).sort();
    const zipName = `SF${allCodes[0] || 'EXPORT'}.ZIP`;

    // application/octet-stream (not application/zip) so Safari's "Open safe
    // files" preference doesn't auto-extract the download — same fix as the
    // v1.16.25 meet exports.
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    for (const f of xmlFiles) {
      archive.append(Buffer.from(f.xml, 'utf8'), { name: f.fileName });
    }

    await archive.finalize();

    try {
      await logAudit('export', 'meet', req.params.meetId, null, {
        format: 'usss-transmit', files: xmlFiles.map(f => f.fileName),
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
// v1.27.00 — per-event readiness report for the transmit modal. Runs the same
// validation the POST enforces so the operator sees every problem up front.

router.get('/usss-transmit-check/:meetId', async (req, res) => {
  try {
    const v = await validateMeetForTransmit(req.params.meetId);
    if (!v.meet) return res.status(404).json({ error: 'Meet not found' });

    const events = v.eventInfos.map(i => ({
      id: i.event.id,
      name: i.event.name,
      discipline: i.event.discipline,
      gender: i.event.gender,
      status: i.event.status,
      usss_code: i.natCode || null,
      category: i.category,
      ready: i.problems.length === 0,
      problems: i.problems,
    }));

    res.json({
      events,
      td: {
        required: v.tdRequired,
        found: !!v.tdOfficial,
        name: v.tdOfficial ? v.tdOfficial.name : null,
        ussa_id: v.tdOfficial ? (v.tdOfficial.ussa_id || null) : null,
        problems: v.tdProblems,
      },
      ready: events.length > 0 && events.every(e => e.ready) && v.tdProblems.length === 0,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


router.generateSingleMogulXml = generateSingleMogulXml;
router.generateDualMogulXml = generateDualMogulXml;
router.buildJudgePointsMap = buildJudgePointsMap;

module.exports = router;
