/**
 * Scripted meet driver — plays real competition flows against an instance's
 * HTTP API exactly as tablets and the Scoring Computer would (Section 11
 * item 1): judges submitting, HJ approving/rejecting, timekeeper, DNS,
 * manual entry, dual brackets, interleaved events.
 */

const JUMP1 = '3';
const JUMP2 = 'bT';

/**
 * Create judges TL1-3 / Air1-2 / HJ for an event (returns map role → judge).
 */
async function seedMogulJudges(api, eventId) {
  const judges = {};
  for (const role of ['TL1', 'TL2', 'TL3', 'Air1', 'Air2', 'HJ']) {
    judges[role] = await api.must('POST', `/api/events/${eventId}/judges`, { name: `J ${role}`, role });
  }
  return judges;
}

async function seedDualJudges(api, eventId) {
  const judges = {};
  for (const role of ['DualTurns1', 'DualTurns2', 'DualAir', 'DualTime', 'DualOverall']) {
    judges[role] = await api.must('POST', `/api/events/${eventId}/judges`, { name: `DJ ${role}`, role });
  }
  return judges;
}

/**
 * Score one mogul run end-to-end: start → jump codes → 3×TL + 2×Air(2 jumps)
 * → time → HJ approve (when hj=true). Values vary by `vary` for distinct rows.
 * Returns the run id.
 */
async function playMogulRun(api, eventId, judges, registrationId, runNumber, vary = 0, opts = {}) {
  const run = await api.must('POST', `/api/events/${eventId}/runs`, {
    registration_id: registrationId, run_number: runNumber,
  });
  const runId = run.id;
  await api.must('PUT', `/api/events/${eventId}/runs/${runId}`, { jump1_code: JUMP1, jump2_code: JUMP2 });
  const tl = [12.1, 13.4, 12.8].map(v => Math.round((v + vary * 0.3) * 10) / 10);
  for (let i = 0; i < 3; i++) {
    await api.must('POST', `/api/events/${eventId}/runs/${runId}/scores`, {
      judge_id: judges[`TL${i + 1}`].id, score_type: 'turns', raw_score: tl[i],
      carving: Math.min(10, tl[i] * 0.5), abext: 3.5, upper_body: 3.0, deduction: 0.1,
    });
  }
  for (const [i, role] of ['Air1', 'Air2'].entries()) {
    await api.must('POST', `/api/events/${eventId}/runs/${runId}/scores`, {
      judge_id: judges[role].id, score_type: 'air_jump1', raw_score: Math.round((5.5 + i * 0.5 + vary * 0.2) * 10) / 10,
    });
    await api.must('POST', `/api/events/${eventId}/runs/${runId}/scores`, {
      judge_id: judges[role].id, score_type: 'air_jump2', raw_score: Math.round((6.0 + i * 0.5 + vary * 0.2) * 10) / 10,
    });
  }
  await api.must('PUT', `/api/events/${eventId}/runs/${runId}`, { run_time: Math.round((24.5 + vary * 0.4) * 100) / 100 });
  if (opts.approve !== false) {
    // With an HJ configured the run holds in hj_pending; HJ approves.
    await api.must('POST', `/api/events/${eventId}/runs/${runId}/approve`, {});
  }
  return runId;
}

/**
 * HJ rejects one submitted score, judge resubmits (deletes + re-inserts a
 * judge_scores row — FR-5 delete coverage on the live path).
 */
async function playRejection(api, db, eventId, judges, registrationId, runNumber, vary = 0) {
  const run = await api.must('POST', `/api/events/${eventId}/runs`, {
    registration_id: registrationId, run_number: runNumber,
  });
  const runId = run.id;
  await api.must('PUT', `/api/events/${eventId}/runs/${runId}`, { jump1_code: JUMP1, jump2_code: JUMP2 });
  await api.must('POST', `/api/events/${eventId}/runs/${runId}/scores`, {
    judge_id: judges.TL1.id, score_type: 'turns', raw_score: 9.9,
  });
  const scoreRow = await db.queryOne(
    `SELECT id FROM judge_scores WHERE run_id=? AND judge_id=?`, [runId, judges.TL1.id]
  );
  await api.must('POST', `/api/events/${eventId}/runs/${runId}/scores/${scoreRow.id}/reject`, {});
  // Resubmit + complete the run
  for (let i = 0; i < 3; i++) {
    await api.must('POST', `/api/events/${eventId}/runs/${runId}/scores`, {
      judge_id: judges[`TL${i + 1}`].id, score_type: 'turns', raw_score: 12 + i + vary * 0.1,
    });
  }
  for (const role of ['Air1', 'Air2']) {
    await api.must('POST', `/api/events/${eventId}/runs/${runId}/scores`, {
      judge_id: judges[role].id, score_type: 'air_jump1', raw_score: 6.1,
    });
    await api.must('POST', `/api/events/${eventId}/runs/${runId}/scores`, {
      judge_id: judges[role].id, score_type: 'air_jump2', raw_score: 6.4,
    });
  }
  await api.must('PUT', `/api/events/${eventId}/runs/${runId}`, { run_time: 26.3 });
  await api.must('POST', `/api/events/${eventId}/runs/${runId}/approve`, {});
  return runId;
}

/**
 * Full dual bracket via paper scoring (authApi needs the Control token /
 * officials auth): seed-random → seed-fis → paper-score every real match to
 * completion. Returns match count.
 */
async function playDualBracket(api, authApi, eventId, opts = {}) {
  if (!opts.skipSeed) {
    await authApi.must('POST', `/api/events/${eventId}/dual/seed-random`, {});
    await authApi.must('POST', `/api/events/${eventId}/dual/seed-fis`, {});
  }
  // Score matches round by round until every match is complete.
  for (let guard = 0; guard < 40; guard++) {
    const bracket = await api.must('GET', `/api/events/${eventId}/dual`);
    const matches = bracket.matches || bracket;
    const playable = matches.filter(m =>
      m.status !== 'complete' && !m.is_bye && m.registration_id_blue && m.registration_id_red);
    if (!playable.length) break;
    for (const m of playable) {
      const judges = [1, 2, 3, 4, 5].map(n => ({
        judge_number: n,
        blue_points: n <= 3 ? 3 : 2,
        red_points: n <= 3 ? 2 : 3,
      }));
      await authApi.must('POST', `/api/events/${eventId}/dual/${m.id}/paper-score`, { judges });
    }
  }
  const bracket = await api.must('GET', `/api/events/${eventId}/dual`);
  const matches = bracket.matches || bracket;
  return matches.length;
}

module.exports = { seedMogulJudges, seedDualJudges, playMogulRun, playRejection, playDualBracket };
