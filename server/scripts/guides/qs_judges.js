// Quick Start Guide — Judges (3 content pages)
const { COLORS, CONTENT_W } = require('./style');

module.exports = {
  file: 'StickIt_QuickStart_Judges.pdf',
  title: 'Judges',
  audience: 'Anyone scoring on a judge tablet',
  accent: COLORS.blue,
  pages: [

    // ── Page 1: Getting connected & the rhythm ──────────────────────────────
    (doc, d) => {
      let y = d.pageTitle(doc, 'Getting Connected', { sub: 'One web address is your whole login. No username, no password.' });

      y = d.body(doc, y, 'Before the event, the Chief of Score gives every judge their own web address. Type it into the tablet’s browser exactly as written (or scan the QR code if you were given one):');
      y = d.urlBar(doc, d.LEFT + 40, y + 2, CONTENT_W - 80, 'scoring.example.com/judge/AB12CD/XY34ZW') + 16;
      y = d.body(doc, y, 'That address is yours alone — it knows which event you are judging and which seat you are in. Keep the page open all day.');

      y += 6;
      doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.navy).text('The rhythm of every run', d.LEFT, y); y = doc.y + 10;
      y = d.flowColumn(doc, y, [
        'Athlete starts — your screen shows their bib & name',
        'You enter your score',
        'Tap Submit',
        'Screen clears and waits for the next athlete',
      ], { boxH: 38, gap: 16, fontSize: 11 }) + 18;

      y = d.callout(doc, y, 'Wrong athlete on your screen? Don’t score. Wave to the Chief of Score and they will fix it.', { kind: 'stop' });
      y = d.callout(doc, y, 'Bright sun? Tap the HC button in the corner for a high-contrast black-and-white screen. It changes nothing about your scores.', { kind: 'tip' });
    },

    // ── Page 2: Moguls & Dual Moguls ────────────────────────────────────────
    (doc, d) => {
      let y = d.pageTitle(doc, 'What You Score — Moguls & Duals', { sub: 'Your tablet only shows the job you were assigned. You can’t press the wrong judge’s buttons.' });

      // Mogul T&L
      const f1 = d.tabletFrame(doc, d.LEFT, y, (CONTENT_W - 16) / 2, 158, { title: 'MOGULS — TURNS JUDGE' });
      d.labelBox(doc, f1.x, f1.y, f1.w, 30, 'Turn score buttons  (0 – 20)', { fontSize: 9.5 });
      d.labelBox(doc, f1.x, f1.y + 38, f1.w, 30, 'Deduction buttons  (falls, etc.)', { fill: COLORS.amberBg, stroke: COLORS.amber, color: COLORS.amber, fontSize: 9.5 });
      d.labelBox(doc, f1.x, f1.y + 76, f1.w, 30, 'Submit', { fill: COLORS.greenBg, stroke: COLORS.green, color: COLORS.green, fontSize: 10.5 });

      // Mogul Air
      const f2 = d.tabletFrame(doc, d.LEFT + (CONTENT_W + 16) / 2, y, (CONTENT_W - 16) / 2, 158, { title: 'MOGULS — AIR JUDGE' });
      d.labelBox(doc, f2.x, f2.y, f2.w, 30, 'Jump codes  (what trick was it?)', { fontSize: 9.5 });
      d.labelBox(doc, f2.x, f2.y + 38, f2.w, 30, 'Jump scores  (how well done?)', { fontSize: 9.5 });
      d.labelBox(doc, f2.x, f2.y + 76, f2.w, 30, 'Submit', { fill: COLORS.greenBg, stroke: COLORS.green, color: COLORS.green, fontSize: 10.5 });
      y += 158 + 14;

      y = d.body(doc, y, 'Turns judges pick a turn score and any deductions. Air judges pick the jump code for each jump, then score each jump. Both Air judges must agree on the codes — if you disagree, the tablet says so and the Head Judge sorts it out.');

      y += 4;
      doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.navy).text('Dual moguls — splitting 5 points', d.LEFT, y); y = doc.y + 8;
      const f3 = d.tabletFrame(doc, d.LEFT + 60, y, CONTENT_W - 120, 120, { title: 'DUAL MOGULS — YOUR SPLIT' });
      const opts = ['5 – 0', '4 – 1', '3 – 2', '2 – 3', '1 – 4', '0 – 5'];
      const bw = (f3.w - 5 * 6) / 6;
      opts.forEach((o, i) => {
        const isPick = o === '3 – 2';
        d.labelBox(doc, f3.x + i * (bw + 6), f3.y + 14, bw, 40, o.split(' – ').join('–'),
          { fill: isPick ? COLORS.blueBg : '#f8fafc', stroke: isPick ? COLORS.blue : COLORS.grayLight, color: isPick ? COLORS.blue : COLORS.gray, fontSize: 11 });
      });
      doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.gray)
        .text('BLUE side «', f3.x, f3.y + 62, { lineBreak: false })
        .text('» RED side', f3.x, f3.y + 62, { width: f3.w, align: 'right', lineBreak: false });
      y += 120 + 12;

      y = d.body(doc, y, 'Two skiers race side by side. You have 5 points to split between them — tap the split that matches what you saw (3–2 means Blue earned 3, Red earned 2). The winner is decided by all five judges’ points together.');
    },

    // ── Page 3: Aerials + when things go wrong ──────────────────────────────
    (doc, d) => {
      let y = d.pageTitle(doc, 'Aerials + Fixing Mistakes');

      // Aerials frame
      const f = d.tabletFrame(doc, d.LEFT, y, CONTENT_W, 130, { title: 'AERIALS — EVERY JUDGE SCORES ALL THREE' });
      const colW = (f.w - 24) / 3;
      const parts = [['AIR', '0.0 – 2.0', 'takeoff & height'], ['FORM', '0.0 – 5.0', 'position in the air'], ['LANDING', '0.0 – 3.0', 'the landing']];
      parts.forEach((p, i) => {
        const x = f.x + i * (colW + 12);
        d.labelBox(doc, x, f.y + 4, colW, 62, [p[0], p[1]], { fontSize: 11 });
        doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.gray).text(p[2], x, f.y + 72, { width: colW, align: 'center' });
      });
      y += 130 + 12;
      y = d.body(doc, y, 'In aerials there are no separate turn or air judges — every judge enters Air, Form, and Landing for every jump. Submit each jump separately; two-jump events score each jump on its own.');

      y += 6;
      doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.navy).text('If your score is sent back', d.LEFT, y); y = doc.y + 10;
      y = d.flowRow(doc, y, [['You submit'], ['Head Judge', 'sends it back'], ['Your tablet shows', 'it again in red'], ['Fix it and', 'Submit again']], { boxH: 46, fontSize: 9.5 }) + 18;
      y = d.callout(doc, y, 'A returned score is not a punishment — it almost always means a typo (a 9.5 that should have been 5.9). Fix it and resubmit.', { kind: 'good' });

      y += 4;
      doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.navy).text('Judge’s checklist', d.LEFT, y); y = doc.y + 8;
      const items = [
        'Charge the tablet the night before — bring a battery pack for cold days.',
        'Keep the browser page open all day. Don’t close the tab between athletes.',
        'Never refresh in the middle of a run unless the Chief of Score asks you to.',
        'Lost the page? Re-type your address (or re-scan your QR code) — your seat is exactly where you left it.',
      ];
      for (const it of items) {
        d.check(doc, d.LEFT + 4, y + 2, { size: 10 });
        doc.font('Helvetica').fontSize(11).fillColor(COLORS.ink).text(it, d.LEFT + 22, y, { width: CONTENT_W - 22, lineGap: 2 });
        y = doc.y + 7;
      }
    },
  ],
};
