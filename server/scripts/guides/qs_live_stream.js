// Quick Start Guide — Live Stream Crew (2 content pages)
const { COLORS, CONTENT_W } = require('./style');

module.exports = {
  file: 'StickIt_QuickStart_Live_Stream.pdf',
  title: 'Live Stream Crew',
  audience: 'Anyone running the broadcast, a lodge TV, or a results screen',
  accent: COLORS.amber,
  pages: [

    // ── Page 1: The two screens ─────────────────────────────────────────────
    (doc, d) => {
      let y = d.pageTitle(doc, 'The Two Screens You Can Show', { sub: 'Both are just web addresses. Ask the Chief of Score for the event’s links.' });

      // Scoreboard mockup
      const half = (CONTENT_W - 16) / 2;
      const f1 = d.tabletFrame(doc, d.LEFT, y, half, 150, { title: 'SCOREBOARD  —  full page' });
      d.labelBox(doc, f1.x, f1.y, f1.w, 24, 'NOW COMPETING  ·  Bib 14', { fill: COLORS.redBg, stroke: COLORS.red, color: COLORS.red, fontSize: 8.5 });
      ['1   #7   A. Skier      84.12', '2   #3   B. Racer      81.40', '3   #14  C. Jumper   79.95'].forEach((row, i) => {
        d.labelBox(doc, f1.x, f1.y + 32 + i * 26, f1.w, 20, row, { fill: '#f8fafc', stroke: COLORS.grayLight, color: COLORS.ink, fontSize: 8, bold: false });
      });
      doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.gray)
        .text('Great on a lodge TV or a second monitor.', d.LEFT, y + 154, { width: half, align: 'center' });

      // Overlay mockup
      const f2 = d.tabletFrame(doc, d.LEFT + half + 16, y, half, 150, { title: 'OVERLAY  —  floats over video' });
      doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.gray).text('(transparent background)', f2.x, f2.y + 2, { width: f2.w, align: 'center' });
      d.labelBox(doc, f2.x + 8, f2.y + f2.h - 40, f2.w - 16, 34, ['#14  C. JUMPER          79.95', 'Turns 41.2 · Air 14.8 · Speed 16.1'], { fill: '#0e1628', stroke: '#0e1628', color: '#ffffff', fontSize: 8 });
      doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.gray)
        .text('Lower-third graphics for the live stream.', d.LEFT + half + 16, y + 154, { width: half, align: 'center' });

      y += 178;
      y = d.urlBar(doc, d.LEFT + 30, y, CONTENT_W - 60, 'scoring.example.com/scoreboard/AB12CD       (scoreboard)') + 8;
      y = d.urlBar(doc, d.LEFT + 30, y, CONTENT_W - 60, 'scoring.example.com/overlay/AB12CD            (overlay)') + 16;

      doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.navy).text('OBS setup (60 seconds)', d.LEFT, y); y = doc.y + 8;
      y = d.step(doc, y, 1, 'Add a Browser Source', 'In OBS: Sources  ›  +  ›  Browser.');
      y = d.step(doc, y, 2, 'Paste the overlay address', 'The /overlay/... link for your event.');
      y = d.step(doc, y, 3, 'Set the size', 'Width 1920, height 1080. That’s it — the background is transparent automatically.');
      y = d.body(doc, y, 'YoloBox: add a URL/web source and paste the same overlay address.');
    },

    // ── Page 2: During the show ─────────────────────────────────────────────
    (doc, d) => {
      let y = d.pageTitle(doc, 'During the Show');

      y = d.step(doc, y, 1, 'The graphics run themselves',
        'When a run starts, the athlete’s name ribbon appears. When the score is final, it animates in on its own. There is nothing for you to trigger.');

      y = d.step(doc, y, 2, 'Hiding the overlay (interviews, delays)',
        'On the scoring computer, the event’s Scoring tab has a small “Broadcast Overlay: Hide / Show” control. Ask the Chief of Score to tap Hide — ' +
        'the graphic disappears and stays hidden until Show is tapped or the next run starts.');
      const chipY = y - 4;
      let cx = d.LEFT + 34;
      cx += d.chip(doc, cx, chipY, 'Broadcast Overlay:', { fill: '#f1f5f9', color: COLORS.gray }) + 8;
      cx += d.chip(doc, cx, chipY, 'Hide', { fill: COLORS.redBg, color: COLORS.red }) + 6;
      d.chip(doc, cx, chipY, 'Show', { fill: COLORS.greenBg, color: COLORS.green });
      y = chipY + 32;

      y = d.step(doc, y, 3, 'Dual moguls look different — that’s normal',
        'For head-to-head duals the overlay switches to a Blue-vs-Red versus layout by itself, and shows the winner when the match is decided.');

      y = d.step(doc, y, 4, 'Sunny outdoor TV? Use Sun Mode',
        'The Scoreboard page has a sun/moon toggle for a bright high-contrast look. The overlay ignores it on purpose — broadcast graphics stay consistent.');

      y += 6;
      doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.navy).text('Troubleshooting', d.LEFT, y); y = doc.y + 8;
      const fixes = [
        ['Overlay is blank', 'Check the address — it must be the /overlay/ link for THIS event.'],
        ['Graphics frozen', 'Refresh the browser source (OBS: right-click  ›  Refresh). Scores reappear in seconds.'],
        ['Wrong event showing', 'Each event has its own link. Get today’s link from the Chief of Score.'],
        ['Score seems behind', 'The overlay updates within ~3 seconds of the Head Judge approving. Patience beats refreshing.'],
      ];
      for (const [prob, fix] of fixes) {
        d.roundedBox(doc, d.LEFT, y, CONTENT_W, 36, { fill: '#f8fafc', stroke: COLORS.grayLight, radius: 6 });
        doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.red).text(prob, d.LEFT + 10, y + 6, { width: 130 });
        doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.ink).text(fix, d.LEFT + 148, y + 6, { width: CONTENT_W - 158, lineGap: 1 });
        y += 42;
      }
    },
  ],
};
