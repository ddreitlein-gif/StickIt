// Quick Start Guide — Timekeeper (2 content pages)
const { COLORS, CONTENT_W } = require('./style');

module.exports = {
  file: 'StickIt_QuickStart_Timekeeper.pdf',
  title: 'Timekeeper',
  audience: 'The person entering run times on the timing tablet',
  accent: COLORS.green,
  pages: [

    // ── Page 1: Your screen + the basic job ────────────────────────────────
    (doc, d) => {
      let y = d.pageTitle(doc, 'Your Screen', { sub: 'Open the web address you were given — that is the whole login. No password.' });

      // Big annotated tablet mockup
      const inner = d.tabletFrame(doc, d.LEFT, y, CONTENT_W, 268, { title: 'TIMEKEEPER  —  Bib 14 · Jane Skier' });
      const padX = inner.x;

      // Time display with backspace
      d.labelBox(doc, padX, inner.y, 230, 54, '27.34', { fill: '#0e1628', stroke: '#0e1628', color: '#4ade80', fontSize: 30 });
      d.labelBox(doc, padX + 238, inner.y, 56, 54, 'DEL', { fill: '#fef2f2', stroke: COLORS.red, color: COLORS.red, fontSize: 16 });
      // Numpad below
      const numBottom = d.numpadSketch(doc, padX, inner.y + 64, 294, { keyH: 27, gap: 5 });
      // NT + Submit buttons
      d.labelBox(doc, padX, numBottom + 10, 90, 34, 'No Time', { fill: COLORS.redBg, stroke: COLORS.red, color: COLORS.red, fontSize: 11 });
      d.labelBox(doc, padX + 98, numBottom + 10, 196, 34, 'Submit Time', { fill: COLORS.greenBg, stroke: COLORS.green, color: COLORS.green, fontSize: 12 });

      // Right sidebar
      const sx = padX + 312;
      const sw = inner.w - 312;
      d.labelBox(doc, sx, inner.y, sw, 56, ['NEXT UP', 'Bib 15 · Sam Racer'], { fontSize: 9.5 });
      d.labelBox(doc, sx, inner.y + 64, sw, 76, ['PREVIOUS TIMES', '14  27.34', '12  29.81'], { fill: '#f8fafc', stroke: COLORS.grayLight, color: COLORS.ink, fontSize: 9, bold: false });
      d.labelBox(doc, sx, inner.y + 148, sw, 44, ['PACE TIME', '31.42'], { fill: COLORS.amberBg, stroke: COLORS.amber, color: COLORS.amber, fontSize: 9.5 });
      d.labelBox(doc, sx, inner.y + 200, sw, 34, ['Manual Time', 'Calculation'], { fill: COLORS.amberBg, stroke: COLORS.amber, color: COLORS.amber, fontSize: 8.5 });

      y = y + 268 + 22;

      // The three steps
      y = d.step(doc, y, 1, 'Wait for the athlete to finish',
        'The screen shows who is on course (bib and name at the top). If the name looks wrong, do not enter a time — wave to the Chief of Score.');
      y = d.step(doc, y, 2, 'Type the time with the number pad',
        'Type it exactly as your stopwatch shows it, with the decimal point — for example 27.34. The mistake key (DEL) erases the last digit.');
      y = d.step(doc, y, 3, 'Tap the green Submit Time button',
        'Check the big number first. Once you submit, the screen moves on and waits for the next athlete.');
    },

    // ── Page 2: Special situations ──────────────────────────────────────────
    (doc, d) => {
      let y = d.pageTitle(doc, 'Special Situations');

      y = d.step(doc, y, 1, 'No valid time (NT)',
        'The athlete finished but you have no usable time — the clock failed or you missed it. Tap the red No Time button and confirm. ' +
        'Their run still counts; they simply get zero speed points. Their time shows as "NT" everywhere.');

      y = d.step(doc, y, 2, 'Manual time calculation',
        'If you are timing with a top clock and a bottom clock, tap the amber "Manual Time Calculation" button. ' +
        'Enter both readings and the tablet does the math for you — no mental subtraction at the bottom of a cold hill.');

      y = d.step(doc, y, 3, 'Starting runs from your tablet',
        'At some events the Chief of Score will ask you to start each run. When they do, the Next Up card on your screen shows a ' +
        'blue Start Run button — tap it as the athlete leaves the gate.');

      y = d.step(doc, y, 4, 'Athlete never starts (DNS)',
        'If the next athlete never leaves the gate, tap the small DNS button next to Start Run and confirm. ' +
        'That marks them "Did Not Start" and moves the line along.');

      y += 6;
      y = d.callout(doc, y,
        'Times only matter for moguls and dual moguls. Aerials events are not timed — there is no timekeeper tablet for aerials.',
        { kind: 'good' });

      y = d.callout(doc, y,
        'Faster than the pace time = more speed points, up to the cap. Your job is only the time — the tablet calculates all points automatically.',
        { kind: 'tip' });

      y = d.callout(doc, y,
        'Keep the tablet charged and the browser page open all day. If the page ever looks frozen, pull down to refresh — your place is saved.',
        { kind: 'caution' });
    },
  ],
};
