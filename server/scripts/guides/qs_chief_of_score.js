// Quick Start Guide — Chief of Score (4 content pages)
// Role framing: the Event Secretary sets everything up before the event;
// the Chief of Score runs the show on event day.
const { COLORS, CONTENT_W } = require('./style');

module.exports = {
  file: 'StickIt_QuickStart_Chief_of_Score.pdf',
  title: 'Chief of Score',
  audience: 'The on-site operator running scoring on event day',
  accent: COLORS.red,
  pages: [

    // ── Page 1: Your day at a glance ────────────────────────────────────────
    (doc, d) => {
      let y = d.pageTitle(doc, 'Your Day at a Glance', { sub: 'The Event Secretary set everything up. Your job is to keep runs flowing.' });

      y = d.flowColumn(doc, y, [
        'Open your meet, then the event   ›   Scoring tab',
        'Tap Start Run for the next athlete',
        'Judges & timekeeper enter scores on their tablets',
        'Head Judge approves the run',
        'Score appears on the scoreboard — automatically',
        'Repeat for every athlete',
      ], { boxH: 36, gap: 15, fontSize: 11 }) + 16;

      y = d.callout(doc, y, 'No Head Judge assigned? Scores finalize on their own as soon as every judge has entered. That is normal for small events.', { kind: 'good' });
      y = d.callout(doc, y, 'Dual moguls: instead of Start Run you start each MATCH from the Bracket. Aerials: same Start Run flow, judges score each jump.', { kind: 'tip' });
      y = d.callout(doc, y, 'An athlete not starting? Tap the yellow DNS button next to Start Run — it marks them Did Not Start and moves the line along.', { kind: 'tip' });
    },

    // ── Page 2: Fixing things during the day ───────────────────────────────
    (doc, d) => {
      let y = d.pageTitle(doc, 'Fixing Things During the Day');

      y = d.step(doc, y, 1, 'Enter scores by hand (Manual Entry)',
        'Tablet died? Scores coming in over the radio? Tap Manual Entry on the Scoring tab and type every judge’s score yourself. ' +
        'For moguls there is also a microphone option (Voice Manual Entry) — speak the scores instead of typing.');

      y = d.step(doc, y, 2, 'Fix a score that already went through',
        'Find the run in the results list and tap Manual Entry / Edit. Correct the number and save — the rankings everywhere update by themselves.');

      y = d.step(doc, y, 3, 'Mark a run status', '');
      const rowY = y - 6;
      let cx = d.LEFT + 34;
      const statuses = [['DNS', 'didn’t start'], ['DNF', 'didn’t finish'], ['DSQ', 'disqualified'], ['RNS', 're-run coming'], ['NT', 'no valid time']];
      for (const [code, meaning] of statuses) {
        const w = d.chip(doc, cx, rowY, code, { fill: COLORS.redBg, color: COLORS.red });
        doc.font('Helvetica').fontSize(9).fillColor(COLORS.gray).text(meaning, cx, rowY + 21, { width: Math.max(w, 80), lineBreak: false });
        cx += Math.max(w + 28, 88);
      }
      y = rowY + 44;

      y = d.step(doc, y, 4, 'Event-day registration fixes',
        'Late athlete? Registration tab  ›  search their name (or add them from the USSS list)  ›  register. ' +
        'Wrong bib? Tap the bib number in the table, type the new one, press Enter. The Event Secretary did the big setup — you only patch.');

      y += 4;
      y = d.callout(doc, y,
        'Discipline differences: aerials manual entry asks for Air, Form, and Landing for every judge and every jump. ' +
        'Dual mogul scores are fixed from the bracket (tap the match  ›  Enter/Edit Scores), not from a runs list.',
        { kind: 'caution' });
    },

    // ── Page 3: Printing PDFs during the event ──────────────────────────────
    (doc, d) => {
      let y = d.pageTitle(doc, 'Printing Reports During the Event', { sub: 'Coaches, TDs, and announcers will all ask. Here is the 10-second answer.' });

      y = d.flowRow(doc, y, [['Open the event’s', 'Reports tab'], ['Tap the report', 'you need'], ['The PDF opens in', 'a new tab'], ['Print it (or AirDrop', 'to the printer laptop)']], { boxH: 50, fontSize: 9.5 }) + 20;

      doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.navy).text('The reports you will actually print', d.LEFT, y); y = doc.y + 10;

      const rows = [
        ['Start List', 'Post it at the start before the first run.'],
        ['Check Sheet (by run order)', 'Hand to the Head Judge / TD mid-day to verify scores against paper.'],
        ['Event Results — Summary', 'Post after every round. Coaches will ask for this one.'],
        ['Event Results — Detailed', 'Full judge-by-judge breakdown when someone questions a score.'],
        ['Dual Bracket', 'Post between dual mogul rounds so athletes know their next match.'],
        ['Training Day Roster', 'If a training day is set up — the list of who may train.'],
      ];
      const c1 = 170;
      for (const [name, when] of rows) {
        d.roundedBox(doc, d.LEFT, y, CONTENT_W, 34, { fill: '#f8fafc', stroke: COLORS.grayLight, radius: 6 });
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COLORS.navy).text(name, d.LEFT + 10, y + 6, { width: c1 - 10 });
        doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.ink).text(when, d.LEFT + c1 + 8, y + 6, { width: CONTENT_W - c1 - 18, lineGap: 1 });
        y += 40;
      }
      y += 4;
      y = d.callout(doc, y, 'Print the Results Summary after every round. It takes 20 seconds and saves you twenty “what did she score?” conversations.', { kind: 'tip' });
    },

    // ── Page 4: End of day ───────────────────────────────────────────────────
    (doc, d) => {
      let y = d.pageTitle(doc, 'End of Day');

      y = d.step(doc, y, 1, 'Let the Head Judge finalize',
        'After the last run is approved, the Head Judge’s tablet shows a final review and a Finalize Event button. ' +
        'Once they tap it, the event is marked Complete and the final standings lock in.');

      y = d.step(doc, y, 2, 'Print the final results',
        'Reports tab  ›  Event Results. Post one copy, keep one for the TD packet.');

      y = d.step(doc, y, 3, 'Export the spreadsheets',
        'Reports tab  ›  CSV / Excel export. This is the file the webmaster or points-keeper wants.');

      y = d.step(doc, y, 4, 'Hand off to the Event Secretary',
        'Tell them every event shows Complete. They handle the official USSS results submission and the meet archive from home — that is not your job tonight.');

      y += 8;
      y = d.callout(doc, y,
        'Dual mogul finals run in this order at the end of the day: 7/8 place  ›  5/6 place  ›  3/4 place  ›  Championship. The bracket queues them automatically.',
        { kind: 'good' });
      y = d.callout(doc, y,
        'Made a mistake after finalizing? Only an admin can re-open a completed event (Admin  ›  Events  ›  Re-open). Scores can then be corrected and the event finalized again.',
        { kind: 'caution' });
    },
  ],
};
