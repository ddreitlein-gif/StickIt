const router = require('express').Router();
const { queryAll, queryOne } = require('../db/schema');
const { rankResults, pickBestRun, applyTierRanks } = require('../scoring/engine');
const { logAudit } = require('./audit');

// v1.9.00: Phase-aware results helper (shared across export endpoints)
async function getPhaseAwareResults(eventId) {
  const phases = await queryAll(
    `SELECT * FROM event_phases WHERE event_id=? ORDER BY sequence_order`, [eventId]
  );
  if (!phases.length) return null; // caller should use legacy path

  const evRow = await queryOne('SELECT discipline FROM events WHERE id=?', [eventId]);
  const disc = evRow ? evRow.discipline : 'mogul';

  const types = phases.map(p => p.phase_type);
  const isBestOf2 = types.includes('best_of_2');
  const isQualFinals = types.includes('final_1') || types.includes('final_2') || types.includes('qualifier_2');

  const runQuery = (runNumbers) => {
    const ph = runNumbers.map(() => '?').join(',');
    return queryAll(
      `SELECT r.*, reg.bib_number, reg.seed, a.first_name, a.last_name, a.ussa_num, a.club, a.birth_year, a.gender, a.nation
       FROM runs r
       JOIN registrations reg ON reg.id = r.registration_id
       JOIN athletes a ON a.id = reg.athlete_id
       WHERE r.event_id = ? AND r.run_number IN (${ph}) AND r.status = 'complete' AND r.run_status IS NULL
       ORDER BY r.total_score DESC`,
      [eventId, ...runNumbers]
    );
  };

  if (isBestOf2) {
    const runNumbers = phases.map(p => p.run_number);
    const runs = await runQuery(runNumbers);
    const best = pickBestRun(runs, disc);
    return rankResults(Object.values(best), disc);
  }

  if (isQualFinals) {
    const f2 = phases.find(p => p.phase_type === 'final_2');
    const f1 = phases.find(p => p.phase_type === 'final_1');
    const qualRunNumbers = phases.filter(p => p.phase_type === 'run' || p.phase_type === 'qualifier_2').map(p => p.run_number);

    const tiers = [];
    let globalRank = 1;
    const rankedIds = new Set();

    const rankedRunResults = async (runNumber) => {
      const runs = await runQuery([runNumber]);
      return rankResults(runs, disc);
    };
    const bestScoreResults = async (runNumbers) => {
      const runs = await runQuery(runNumbers);
      const best = pickBestRun(runs, disc);
      return rankResults(Object.values(best), disc);
    };

    if (f2 && f2.status === 'finalized') {
      const f2Results = await rankedRunResults(f2.run_number);
      globalRank = applyTierRanks(f2Results, disc, globalRank);
      for (const r of f2Results) { r.tier = 'final_2'; tiers.push(r); rankedIds.add(r.registration_id); }
    }
    if (f1) {
      const f1Results = await rankedRunResults(f1.run_number);
      const f1Tier = f1Results.filter(r => !rankedIds.has(r.registration_id));
      globalRank = applyTierRanks(f1Tier, disc, globalRank);
      for (const r of f1Tier) { r.tier = 'final_1'; tiers.push(r); rankedIds.add(r.registration_id); }
    }
    if (qualRunNumbers.length > 0) {
      const qualResults = await bestScoreResults(qualRunNumbers);
      const qTier = qualResults.filter(r => !rankedIds.has(r.registration_id));
      globalRank = applyTierRanks(qTier, disc, globalRank);
      for (const r of qTier) { r.tier = 'qualifier'; tiers.push(r); rankedIds.add(r.registration_id); }
    }
    return tiers;
  }

  // Single phase
  const runs = await runQuery([1]);
  return rankResults(runs, disc);
}

// GET CSV export of results for an event
router.get('/csv/:eventId', async (req, res) => {
  try {
    const event = await queryOne('SELECT * FROM events WHERE id=?', [req.params.eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const { round = 'qualification' } = req.query;

    // v1.9.00: Phase-aware results
    let ranked = await getPhaseAwareResults(req.params.eventId);
    if (!ranked) {
      // Legacy path
      const runs = await queryAll(
        `SELECT r.*, reg.bib_number, reg.seed, a.first_name, a.last_name, a.ussa_num, a.club, a.birth_year
         FROM runs r
         JOIN registrations reg ON reg.id = r.registration_id
         JOIN athletes a ON a.id = reg.athlete_id
         WHERE r.event_id=? AND r.round=? AND r.status='complete'`,
        [req.params.eventId, round]
      );
      const best = pickBestRun(runs, event.discipline);
      ranked = rankResults(Object.values(best), event.discipline);
    }

    const headers = ['Place','Bib','Last Name','First Name','USSA#','Club','Turns','Air','Time','Speed','Total','Jump 1','Jump 2'];
    const rows = ranked.map(r => [
      r.rank, r.bib_number, r.last_name, r.first_name, r.ussa_num||'',
      r.club||'', r.turns_score, r.air_score,
      r.run_time != null ? (r.run_time == -1 ? 'NT' : r.run_time) : '', r.speed_score||'', r.total_score,
      r.jump1_code||'', r.jump2_code||''
    ]);

    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${event.name.replace(/\s+/g,'_')}_results.csv"`);
    res.send('﻿' + csv); // F-6/F-11: UTF-8 BOM so Excel renders accented names
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET USSAS-format export
router.get('/ussas/:eventId', async (req, res) => {
  try {
    const event = await queryOne('SELECT * FROM events WHERE id=?', [req.params.eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // v1.9.00: Phase-aware results
    let ranked = await getPhaseAwareResults(req.params.eventId);
    if (!ranked) {
      const runs = await queryAll(
        `SELECT r.*, reg.bib_number, reg.seed, a.first_name, a.last_name, a.ussa_num, a.birth_year, a.gender
         FROM runs r
         JOIN registrations reg ON reg.id = r.registration_id
         JOIN athletes a ON a.id = reg.athlete_id
         WHERE r.event_id=? AND r.status='complete' AND r.round='qualification'`,
        [req.params.eventId]
      );
      const best = pickBestRun(runs, event.discipline);
      ranked = rankResults(Object.values(best), event.discipline);
    }

    // USSAS tab-delimited format: Place, USSA#, LastName, FirstName, BirthYear, Gender, Score
    const lines = ranked.map(r =>
      [r.rank, r.ussa_num||'', r.last_name, r.first_name, r.birth_year||'', r.gender||event.gender, r.total_score].join('\t')
    );
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${event.name.replace(/\s+/g,'_')}_ussas.txt"`);
    res.send(lines.join('\n'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/export/results-csv/:eventId  -- full results with per-judge T scores
router.get('/results-csv/:eventId', async (req, res) => {
  try {
    const event = await queryOne('SELECT * FROM events WHERE id=?', [req.params.eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const { round = 'qualification' } = req.query;

    // v1.9.00: Phase-aware results
    let ranked = await getPhaseAwareResults(req.params.eventId);
    if (!ranked) {
      const runs = await queryAll(
        `SELECT r.*, reg.bib_number, a.first_name, a.last_name, a.nation, a.club
         FROM runs r
         JOIN registrations reg ON reg.id = r.registration_id
         JOIN athletes a ON a.id = reg.athlete_id
         WHERE r.event_id=? AND r.round=? AND r.status='complete'`,
        [req.params.eventId, round]
      );
      const best = pickBestRun(runs, event.discipline);
      ranked = rankResults(Object.values(best), event.discipline);
    }

    // Pull judge scores for the winning runs
    const runIds = ranked.map(r => r.id);
    let scoreMap = {};
    let compMap  = {};
    if (runIds.length) {
      const placeholders = runIds.map(() => '?').join(',');
      const scoreRows = await queryAll(
        `SELECT js.run_id, js.score_type, js.raw_score, j.role
         FROM judge_scores js
         LEFT JOIN judges j ON j.id = js.judge_id
         WHERE js.run_id IN (${placeholders})`,
        runIds
      );
      for (const s of scoreRows) {
        if (!scoreMap[s.run_id]) scoreMap[s.run_id] = {};
        if (!scoreMap[s.run_id][s.score_type]) scoreMap[s.run_id][s.score_type] = [];
        scoreMap[s.run_id][s.score_type].push(s.raw_score);
      }
      // Per-judge component data
      const compRows = await queryAll(
        `SELECT js.run_id, js.raw_score, js.tl_carving, js.tl_abext, js.tl_upper_body, js.tl_deduction, j.role
         FROM judge_scores js LEFT JOIN judges j ON j.id = js.judge_id
         WHERE js.run_id IN (${placeholders}) AND js.score_type = 'turns'
         ORDER BY j.role`,
        runIds
      );
      for (const r of compRows) {
        if (!compMap[r.run_id]) compMap[r.run_id] = {};
        compMap[r.run_id][r.role || ''] = {
          raw: r.raw_score, carving: r.tl_carving, abext: r.tl_abext,
          upperBody: r.tl_upper_body, deduction: r.tl_deduction
        };
      }
    }

    const avgFmt = (arr) =>
      arr && arr.length
        ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)
        : '';

    const numTL = event.num_tl_judges || 3;
    const numAir = event.num_air_judges || 2;
    const numJumps = event.num_jumps || 2;
    const hasSpeed = event.has_speed !== undefined ? !!event.has_speed : true;
    const compScoring = event.component_scoring !== 0;
    const tlHeaders = [];
    for (let i = 1; i <= numTL; i++) {
      if (compScoring) {
        tlHeaders.push(`TL${i} Total`, `TL${i} Crv`, `TL${i} UB`, `TL${i} A/E`, `TL${i} Ded`);
      } else {
        tlHeaders.push(`TL${i} Total`, `TL${i} Ded`);
      }
    }

    // Dynamic air average headers based on panel
    const airAvgHeaders = [];
    for (let j = 1; j <= numAir; j++) airAvgHeaders.push(`Avg Jump ${j}`);
    // Dynamic jump headers
    const jumpHeaders = ['Jump 1 Code', 'Jump 1 DD'];
    if (numJumps >= 2) jumpHeaders.push('Jump 2 Code', 'Jump 2 DD');

    const headers = [
      'Rank', 'Bib', 'Last Name', 'First Name', 'Club',
      'T Score', 'A Score',
      ...(hasSpeed ? ['S Score'] : []),
      'Total',
      'Avg Turns (raw)', ...airAvgHeaders,
      ...jumpHeaders,
      ...(hasSpeed ? ['Run Time'] : []),
      ...tlHeaders
    ];

    const rows = ranked.map(r => {
      const c = scoreMap[r.id] || {};
      const tlCells = [];
      for (let i = 1; i <= numTL; i++) {
        const comp = (compMap[r.id] || {})[`TL${i}`] || {};
        if (compScoring) {
          tlCells.push(
            comp.raw      != null ? comp.raw      : '',
            comp.carving  != null ? comp.carving  : '',
            comp.upperBody != null ? comp.upperBody : '',
            comp.abext    != null ? comp.abext    : '',
            comp.deduction != null ? comp.deduction : ''
          );
        } else {
          tlCells.push(
            comp.raw       != null ? comp.raw       : '',
            comp.deduction != null ? comp.deduction : ''
          );
        }
      }
      // Dynamic air averages
      const airAvgCells = [];
      for (let j = 1; j <= numAir; j++) airAvgCells.push(avgFmt(c[j === 1 ? 'air_jump1' : 'air_jump2']));
      // Dynamic jump cells
      const jumpCells = [r.jump1_code || '', r.jump1_dd != null ? r.jump1_dd : ''];
      if (numJumps >= 2) jumpCells.push(r.jump2_code || '', r.jump2_dd != null ? r.jump2_dd : '');

      return [
        r.rank, r.bib_number, r.last_name, r.first_name,
        r.club || '',
        r.turns_score != null ? r.turns_score : '',
        r.air_score   != null ? r.air_score   : '',
        ...(hasSpeed ? [r.speed_score != null ? r.speed_score : ''] : []),
        r.total_score != null ? r.total_score : '',
        avgFmt(c['turns']),
        ...airAvgCells,
        ...jumpCells,
        ...(hasSpeed ? [r.run_time != null ? (r.run_time == -1 ? 'NT' : r.run_time) : ''] : []),
        ...tlCells
      ];
    });

    const csv = [headers, ...rows]
      .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const safeName = event.name.replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',
      `attachment; filename="${safeName}_results_full_${round}.csv"`);
    res.send('﻿' + csv); // F-11: UTF-8 BOM so Excel renders accented names
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/export/results-xlsx/:eventId  -- full results as Excel workbook
router.get('/results-xlsx/:eventId', async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const event = await queryOne('SELECT * FROM events WHERE id=?', [req.params.eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const { round = 'qualification' } = req.query;

    // v1.9.00: Phase-aware results
    let ranked = await getPhaseAwareResults(req.params.eventId);
    if (!ranked) {
      const runs = await queryAll(
        `SELECT r.*, reg.bib_number, a.first_name, a.last_name, a.nation, a.club
         FROM runs r
         JOIN registrations reg ON reg.id = r.registration_id
         JOIN athletes a ON a.id = reg.athlete_id
         WHERE r.event_id=? AND r.round=? AND r.status='complete'`,
        [req.params.eventId, round]
      );
      const best = pickBestRun(runs, event.discipline);
      ranked = rankResults(Object.values(best), event.discipline);
    }

    const runIds = ranked.map(r => r.id);
    let scoreMap = {};
    let compMapX  = {};
    if (runIds.length) {
      const placeholders = runIds.map(() => '?').join(',');
      const scoreRows = await queryAll(
        `SELECT js.run_id, js.score_type, js.raw_score
         FROM judge_scores js
         WHERE js.run_id IN (${placeholders})`,
        runIds
      );
      for (const s of scoreRows) {
        if (!scoreMap[s.run_id]) scoreMap[s.run_id] = {};
        if (!scoreMap[s.run_id][s.score_type]) scoreMap[s.run_id][s.score_type] = [];
        scoreMap[s.run_id][s.score_type].push(s.raw_score);
      }
      // Per-judge component data
      const compRows = await queryAll(
        `SELECT js.run_id, js.raw_score, js.tl_carving, js.tl_abext, js.tl_upper_body, js.tl_deduction, j.role
         FROM judge_scores js LEFT JOIN judges j ON j.id = js.judge_id
         WHERE js.run_id IN (${placeholders}) AND js.score_type = 'turns'
         ORDER BY j.role`,
        runIds
      );
      for (const r of compRows) {
        if (!compMapX[r.run_id]) compMapX[r.run_id] = {};
        compMapX[r.run_id][r.role || ''] = {
          raw: r.raw_score, carving: r.tl_carving, abext: r.tl_abext,
          upperBody: r.tl_upper_body, deduction: r.tl_deduction
        };
      }
    }

    const avgNum = (arr) =>
      arr && arr.length
        ? parseFloat((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2))
        : null;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'StickIt';
    wb.created = new Date();

    const ws = wb.addWorksheet('Results');

    const numTLx = event.num_tl_judges || 3;
    const numAirX = event.num_air_judges || 2;
    const numJumpsX = event.num_jumps || 2;
    const hasSpeedX = event.has_speed !== undefined ? !!event.has_speed : true;
    const compScoringX = event.component_scoring !== 0;
    const tlHeadersX = [];
    for (let i = 1; i <= numTLx; i++) {
      if (compScoringX) {
        tlHeadersX.push(`TL${i} Total`, `TL${i} Crv`, `TL${i} UB`, `TL${i} A/E`, `TL${i} Ded`);
      } else {
        tlHeadersX.push(`TL${i} Total`, `TL${i} Ded`);
      }
    }

    const airAvgHeadersX = [];
    for (let j = 1; j <= numAirX; j++) airAvgHeadersX.push(`Avg Jump ${j}`);
    const jumpHeadersX = ['Jump 1 Code', 'Jump 1 DD'];
    if (numJumpsX >= 2) jumpHeadersX.push('Jump 2 Code', 'Jump 2 DD');

    const headers = [
      'Rank', 'Bib', 'Last Name', 'First Name', 'Club',
      'T Score', 'A Score',
      ...(hasSpeedX ? ['S Score'] : []),
      'Total',
      'Avg Turns (raw)', ...airAvgHeadersX,
      ...jumpHeadersX,
      ...(hasSpeedX ? ['Run Time'] : []),
      ...tlHeadersX
    ];

    ws.addRow(headers);
    const headerRow = ws.getRow(1);
    headerRow.eachCell(cell => {
      cell.font  = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
      cell.alignment = { horizontal: 'center' };
    });
    headerRow.height = 18;

    for (const r of ranked) {
      const c = scoreMap[r.id] || {};
      const tlCellsX = [];
      for (let i = 1; i <= numTLx; i++) {
        const comp = (compMapX[r.id] || {})[`TL${i}`] || {};
        if (compScoringX) {
          tlCellsX.push(
            comp.raw       ?? null,
            comp.carving   ?? null,
            comp.upperBody ?? null,
            comp.abext     ?? null,
            comp.deduction ?? null
          );
        } else {
          tlCellsX.push(
            comp.raw       ?? null,
            comp.deduction ?? null
          );
        }
      }
      const airAvgCellsX = [];
      for (let j = 1; j <= numAirX; j++) airAvgCellsX.push(avgNum(c[j === 1 ? 'air_jump1' : 'air_jump2']));
      const jumpCellsX = [r.jump1_code || '', r.jump1_dd ?? null];
      if (numJumpsX >= 2) jumpCellsX.push(r.jump2_code || '', r.jump2_dd ?? null);

      ws.addRow([
        r.rank, r.bib_number, r.last_name, r.first_name,
        r.club || '',
        r.turns_score ?? null,
        r.air_score   ?? null,
        ...(hasSpeedX ? [r.speed_score ?? null] : []),
        r.total_score ?? null,
        avgNum(c['turns']),
        ...airAvgCellsX,
        ...jumpCellsX,
        ...(hasSpeedX ? [r.run_time != null ? (r.run_time == -1 ? 'NT' : r.run_time) : null] : []),
        ...tlCellsX
      ]);
    }

    // Zebra striping
    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      if (rowNum % 2 === 0) {
        row.eachCell({ includeEmpty: true }, cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4F8' } };
        });
      }
    });

    // Auto-width
    ws.columns.forEach(col => {
      let maxLen = 8;
      col.eachCell({ includeEmpty: true }, cell => {
        const len = cell.value != null ? String(cell.value).length : 0;
        if (len > maxLen) maxLen = len;
      });
      col.width = Math.min(maxLen + 3, 28);
    });

    // Freeze header row
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    const safeName = event.name.replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '');
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',
      `attachment; filename="${safeName}_results_full_${round}.xlsx"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/export/results-html/:eventId  -- self-contained HTML results page
router.get('/results-html/:eventId', async (req, res) => {
  try {
    const event = await queryOne('SELECT * FROM events WHERE id=?', [req.params.eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const meet = await queryOne('SELECT * FROM meets WHERE id=?', [event.meet_id]);
    const { round = 'qualification' } = req.query;

    // v1.9.00: Phase-aware results
    let ranked = await getPhaseAwareResults(req.params.eventId);
    if (!ranked) {
      const runs = await queryAll(
        `SELECT r.*, reg.bib_number, a.first_name, a.last_name, a.nation, a.club
         FROM runs r
         JOIN registrations reg ON reg.id = r.registration_id
         JOIN athletes a ON a.id = reg.athlete_id
         WHERE r.event_id=? AND r.round=? AND r.status='complete'`,
        [req.params.eventId, round]
      );
      const best = pickBestRun(runs, event.discipline);
      ranked = rankResults(Object.values(best), event.discipline);
    }

    const fmt = (v) => (v != null && v !== '') ? Number(v).toFixed(2) : '--';
    const roundLabel = round.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const meetName   = (meet && meet.name) ? meet.name : 'StickIt';
    const today      = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const safeName   = event.name.replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '');

    const rows = ranked.map((r, i) => {
      const placeCell = r.run_status
        ? `<td class="status ${r.run_status.toLowerCase()}">${r.run_status}</td>`
        : `<td class="place p${r.rank}">${r.rank}</td>`;
      const bg = i % 2 === 0 ? '' : ' class="alt"';
      return `  <tr${bg}>
    ${placeCell}
    <td class="bib">${r.bib_number || ''}</td>
    <td class="name">${r.last_name}, ${r.first_name}</td>
    <td class="club">${r.club || ''}</td>
    <td class="num">${r.run_status ? '--' : fmt(r.turns_score)}</td>
    <td class="num">${r.run_status ? '--' : fmt(r.air_score)}</td>
    <td class="num">${r.run_status ? '--' : fmt(r.speed_score)}</td>
    <td class="num total">${r.run_status ? '--' : fmt(r.total_score)}</td>
    <td class="jumps">${[r.jump1_code, r.jump2_code].filter(Boolean).join(' / ') || '--'}</td>
    <td class="num">${r.run_time ? (r.run_time == -1 ? 'NT' : Number(r.run_time).toFixed(2)) : '--'}</td>
  </tr>`;
    }).join('\n');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${event.name} -- ${roundLabel} Results</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px;
         color: #1a1a1a; background: #fff; padding: 24px; }
  header { margin-bottom: 20px; border-bottom: 3px solid #1a3a6b; padding-bottom: 12px; }
  header h1 { font-size: 20px; color: #1a3a6b; font-weight: bold; }
  header h2 { font-size: 15px; color: #444; font-weight: normal; margin-top: 4px; }
  .meta { font-size: 12px; color: #777; margin-top: 6px; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  thead th { background: #1a3a6b; color: #fff; font-weight: bold; font-size: 12px;
              padding: 7px 8px; text-align: left; white-space: nowrap; }
  thead th.num, td.num { text-align: right; }
  td { padding: 6px 8px; border-bottom: 1px solid #e8e8e8; vertical-align: middle; }
  tr.alt td { background: #f4f7fb; }
  td.place { font-weight: bold; font-size: 15px; width: 36px; color: #1a3a6b; }
  td.p1 { color: #b8860b; }
  td.p2 { color: #6b6b6b; }
  td.p3 { color: #7a4200; }
  td.bib { color: #555; font-size: 12px; width: 40px; }
  td.name { font-weight: bold; }
  td.club { color: #555; font-size: 12px; }
  td.total { font-weight: bold; font-size: 14px; color: #1a3a6b; }
  td.jumps { font-size: 12px; color: #555; }
  td.status { font-weight: bold; font-size: 11px; color: #c00; }
  footer { margin-top: 16px; font-size: 11px; color: #aaa; text-align: right; }
  @media print {
    body { padding: 12px; font-size: 11px; }
    header h1 { font-size: 16px; }
    td { padding: 4px 6px; }
  }
</style>
</head>
<body>
<header>
  <h1>${meetName}</h1>
  <h2>${event.name} &mdash; ${roundLabel} Results</h2>
  <div class="meta">Generated ${today}</div>
</header>
<table>
  <thead>
    <tr>
      <th>Place</th>
      <th>Bib</th>
      <th>Athlete</th>
      <th>Club</th>
      <th class="num">Turns</th>
      <th class="num">Air</th>
      <th class="num">Speed</th>
      <th class="num">Total</th>
      <th>Jumps</th>
      <th class="num">Time</th>
    </tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>
<footer>StickIt &mdash; ${event.name}</footer>
</body>
</html>`;

    const dl = `${safeName}_results_${round}.html`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${dl}"`);
    try { await logAudit('export', 'event', req.params.eventId, null, { format: 'html', round }); } catch (_) {}
    res.send(html);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
