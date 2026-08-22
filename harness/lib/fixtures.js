/**
 * Shared meet fixtures for harness suites — built through the REAL HTTP APIs
 * (never direct DB writes), so fixtures exercise the same paths operators use.
 */

let bibCounter = 0;
let ussaCounter = 7000001;

/**
 * Build a meet with one event, judges, athletes, registrations, a training
 * day, and (optionally) one started run.
 *
 * opts: { name, gender='M', discipline='mogul', division='comp_series',
 *         athletes=2, judges=['TL1','Air1'], startRun=true }
 */
async function buildMeet(api, opts = {}) {
  const {
    name = `Meet ${Date.now()}`,
    gender = 'M',
    discipline = 'mogul',
    division = 'comp_series',
    athletes: athleteCount = 2,
    judges: judgeRoles = ['TL1', 'Air1'],
    startRun = true,
    bibStart = null,
    ussaStart = null,
  } = opts;

  const meet = await api.must('POST', '/api/meets', {
    name, location: 'Harness Mountain', date: '2026-08-22', meet_ranking: 'C',
  });

  const event = await api.must('POST', `/api/meets/${meet.id}/events`, {
    discipline, division, gender, name: `${name} ${gender} ${discipline}`,
  });

  const judges = [];
  for (const role of judgeRoles) {
    judges.push(await api.must('POST', `/api/events/${event.id}/judges`, { name: `Judge ${role}`, role }));
  }

  const athletes = [];
  const regs = [];
  for (let i = 0; i < athleteCount; i++) {
    const a = await api.must('POST', '/api/athletes', {
      first_name: `Ath${i}`, last_name: `Of${name.replace(/[^A-Za-z0-9]/g, '')}`,
      gender, birth_year: 2008, ussa_num: String(ussaStart != null ? ussaStart + i : ussaCounter++),
    });
    athletes.push(a);
    regs.push(await api.must('POST', `/api/events/${event.id}/registrations`, {
      athlete_id: a.id, bib_number: bibStart != null ? bibStart + i : ++bibCounter,
    }));
  }

  const trainingDay = await api.must('POST', `/api/meets/${meet.id}/training-days`, {
    name: 'Official Training', date: '2026-08-21',
  });

  let run = null;
  if (startRun && regs.length) {
    run = await api.must('POST', `/api/events/${event.id}/runs`, {
      registration_id: regs[0].id, run_number: 1,
    });
  }

  return { meet, event, judges, athletes, regs, trainingDay, run };
}

module.exports = { buildMeet };
