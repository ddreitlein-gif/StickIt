const router = require('express').Router();
const { queryAll, queryOne } = require('../db/schema');
const { rankResults, pickBestRun } = require('../scoring/engine');
const { normalizeGender } = require('../utils/gender');
const { requireAuth } = require('../middleware/auth');

// Printable HTML results page -- open in browser and print to PDF
router.get('/results/:eventId', requireAuth, async (req, res) => {
  try {
    const event = await queryOne('SELECT * FROM events WHERE id=?', [req.params.eventId]);
    if (!event) return res.status(404).send('Event not found');

    const meet = await queryOne('SELECT * FROM meets WHERE id=?', [event.meet_id]);
    const { round = 'qualification' } = req.query;

    const runs = await queryAll(
      `SELECT r.*, reg.bib_number, reg.seed, a.first_name, a.last_name, a.ussa_num, a.club, a.birth_year
       FROM runs r
       JOIN registrations reg ON reg.id = r.registration_id
       JOIN athletes a ON a.id = reg.athlete_id
       WHERE r.event_id=? AND r.round=? AND r.status='complete'`,
      [req.params.eventId, round]
    );

    const best = pickBestRun(runs, event.discipline);
    const results = rankResults(Object.values(best), event.discipline);

    const roundLabel = round.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
    const genderLabel = normalizeGender(event.gender) === 'M' ? 'Male' : 'Female';
    const divLabel = (event.division || '').replace(/\b\w/g, c => c.toUpperCase());
    const discLabel = event.discipline === 'dual_mogul' ? 'Dual Mogul' : 'Mogul';

    const rows = results.map((r, i) => `
      <tr class="${i % 2 === 0 ? 'even' : ''}">
        <td class="place">${r.rank}</td>
        <td class="bib">${r.bib_number || ''}</td>
        <td class="name">${r.last_name}, ${r.first_name}</td>
        <td class="club">${r.club || ''}</td>
        <td class="ussa">${r.ussa_num || ''}</td>
        <td class="score">${r.turns_score != null ? Number(r.turns_score).toFixed(2) : ''}</td>
        <td class="score">${r.air_score != null ? Number(r.air_score).toFixed(2) : ''}</td>
        <td class="score" style="color:#666;font-family:monospace">${r.run_time != null ? Number(r.run_time).toFixed(2) : ''}</td>
        <td class="score">${r.speed_score != null ? Number(r.speed_score).toFixed(2) : ''}</td>
        <td class="total">${r.total_score != null ? Number(r.total_score).toFixed(2) : ''}</td>
        <td class="jumps">${[r.jump1_code, r.jump2_code].filter(Boolean).join(' / ') || ''}</td>
      </tr>`).join('');

    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${meet?.name || 'Meet'} — ${event.name} Results</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #000; background: #fff; }
  .header { text-align: center; padding: 12pt 0 8pt; border-bottom: 2pt solid #000; margin-bottom: 10pt; }
  .header h1 { font-size: 16pt; font-weight: bold; }
  .header h2 { font-size: 12pt; font-weight: normal; margin-top: 3pt; }
  .meta { font-size: 9pt; color: #555; margin-top: 4pt; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #1a1a1a; color: #fff; padding: 4pt 6pt; text-align: left; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.05em; }
  td { padding: 4pt 6pt; border-bottom: 0.5pt solid #ddd; font-size: 9.5pt; }
  tr.even td { background: #f7f7f7; }
  td.place { font-weight: bold; font-size: 11pt; width: 30pt; }
  td.bib { width: 30pt; font-family: monospace; }
  td.name { font-weight: 600; }
  td.club { color: #555; font-size: 9pt; }
  td.ussa { font-family: monospace; font-size: 9pt; color: #666; }
  td.score { text-align: right; width: 48pt; }
  td.total { text-align: right; font-weight: bold; font-size: 11pt; width: 48pt; }
  td.jumps { font-family: monospace; font-size: 9pt; color: #444; }
  .footer { margin-top: 12pt; font-size: 8pt; color: #888; text-align: center; }
  @media print {
    @page { margin: 0.75in; }
    .no-print { display: none; }
  }
  .print-btn { margin: 10pt 0; padding: 6pt 16pt; background: #333; color: #fff; border: none; cursor: pointer; border-radius: 4pt; font-size: 10pt; }
</style>
</head>
<body>
<div class="no-print" style="padding:8pt; background:#f0f0f0; text-align:right;">
  <button class="print-btn" onclick="window.print()">Print / Save PDF</button>
</div>
<div class="header">
  <h1>${meet?.name || 'Freestyle Meet'}</h1>
  <h2>${discLabel} — ${genderLabel} ${divLabel} — ${roundLabel} Results</h2>
  <div class="meta">${meet?.location || ''} &nbsp;|&nbsp; ${meet?.date || ''} &nbsp;|&nbsp; Pace Time: ${event.pace_time ? event.pace_time + 's' : 'N/A'} &nbsp;|&nbsp; T&L Judges: ${event.num_tl_judges} &nbsp;|&nbsp; Air Judges: ${event.num_air_judges}</div>
</div>
<table>
  <thead>
    <tr>
      <th>Place</th><th>Bib</th><th>Athlete</th><th>Club</th><th>USSA #</th>
      <th style="text-align:right">Turns</th>
      <th style="text-align:right">Air</th>
      <th style="text-align:right">Time</th>
      <th style="text-align:right">Speed</th>
      <th style="text-align:right">Total</th>
      <th>Jumps</th>
    </tr>
  </thead>
  <tbody>${rows || '<tr><td colspan="11" style="text-align:center;padding:12pt;color:#999;">No results yet.</td></tr>'}</tbody>
</table>
<div class="footer">
  Generated ${new Date().toLocaleString()} &nbsp;|&nbsp; Freestyle Mogul Scoring System
</div>
</body>
</html>`);
  } catch (e) { res.status(500).send(e.message); }
});

module.exports = router;
