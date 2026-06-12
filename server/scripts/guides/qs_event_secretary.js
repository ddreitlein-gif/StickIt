// Quick Start Guide — Event Secretary (4 content pages)
// Role framing: all the work BEFORE and AFTER the event, often from home.
const { COLORS, CONTENT_W } = require('./style');

module.exports = {
  file: 'StickIt_QuickStart_Event_Secretary.pdf',
  title: 'Event Secretary',
  audience: 'The person who sets up the meet beforehand and files results afterward',
  accent: COLORS.navy,
  pages: [

    // ── Page 1: Before the meet ─────────────────────────────────────────────
    (doc, d) => {
      let y = d.pageTitle(doc, 'Before the Meet (from home)', { sub: 'Everything here can be done days ahead, from any computer. Log in at the Officials page.' });

      y = d.step(doc, y, 1, 'Create the meet',
        'Officials dashboard  ›  New Meet. Name, location, start date. Then open the meet and fill in the Course Specifications ' +
        '(course length and the USSS/FIS pace setting) — times can’t be scored without them.');

      y = d.step(doc, y, 2, 'Add the events',
        'One event per discipline + gender + day (e.g. “Comp Series Male Mogul”). Each discipline asks its own setup questions:');
      const cardY = y - 4;
      const cw = (CONTENT_W - 34 - 24) / 3;
      const cards = [
        ['MOGULS', 'category, number of judges & jumps, timed'],
        ['DUAL MOGULS', 'bracket size, run-off to 4th or 8th place'],
        ['AERIALS', 'event type, judge panel size, jumps'],
      ];
      cards.forEach((c, i) => {
        const x = d.LEFT + 34 + i * (cw + 12);
        d.labelBox(doc, x, cardY, cw, 30, c[0], { fontSize: 10 });
        doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.gray).text(c[1], x + 2, cardY + 36, { width: cw - 4, align: 'center' });
      });
      y = cardY + 72;

      y = d.step(doc, y, 3, 'Assign the judges',
        'Event  ›  Setup tab  ›  add each judge by name. The app creates a private web address for every judge seat — ' +
        'those links (on the Links tab) are what you hand to the judges and timekeeper on event morning.');

      y += 4;
      y = d.callout(doc, y, 'Pick the right category when creating an event (Comp Series, Devo, RQS-EQS, FIS). It sets the judge panel and scoring rules — changing it after scoring starts is not possible.', { kind: 'caution' });
    },

    // ── Page 2: Getting athletes in ─────────────────────────────────────────
    (doc, d) => {
      let y = d.pageTitle(doc, 'Getting Athletes In');

      y = d.body(doc, y, 'Three ways into the registration list — use whichever fits what you were given:');

      const bw = (CONTENT_W - 32) / 3;
      const srcY = y + 4;
      d.labelBox(doc, d.LEFT, srcY, bw, 58, ['USSS DATABASE', 'sync the member list,', 'then pick athletes'], { fontSize: 9 });
      d.labelBox(doc, d.LEFT + bw + 16, srcY, bw, 58, ['SKIREG FILE', 'upload the CSV from', 'online registration'], { fontSize: 9 });
      d.labelBox(doc, d.LEFT + 2 * (bw + 16), srcY, bw, 58, ['TYPE BY HAND', 'for the occasional', 'walk-up athlete'], { fontSize: 9 });
      [0, 1, 2].forEach(i => d.arrow(doc, d.LEFT + i * (bw + 16) + bw / 2, srcY + 61, d.LEFT + CONTENT_W / 2 + (i - 1) * 30, srcY + 92));
      d.labelBox(doc, d.LEFT + CONTENT_W / 2 - 110, srcY + 95, 220, 34, 'Registered athletes', { fill: COLORS.greenBg, stroke: COLORS.green, color: COLORS.green, fontSize: 11 });
      y = srcY + 95 + 34 + 18;

      y = d.step(doc, y, 1, 'Sync the USSS database first',
        'Officials sidebar  ›  USSS Database  ›  Sync Now. Do this before every meet so names, membership numbers, birth years, and clubs fill in automatically.');

      y = d.step(doc, y, 2, 'Register the athletes',
        'Event  ›  Registration tab. Search the USSS list and tap to register, or upload the SkiReg CSV (it matches athletes by their USSS number and even brings bibs along).');

      y = d.step(doc, y, 3, 'Bibs, then run order',
        'Use Assign Bibs for numbers, then Random Order or By Age Groups to build the run order. Red rows mean an athlete is missing required info — fix those first.');

      y = d.step(doc, y, 4, 'Lock the order',
        'When the order is final, tap Lock Order. Late additions then ask where to slot in instead of reshuffling everyone.');
    },

    // ── Page 3: Training days + meet-day handoff ─────────────────────────────
    (doc, d) => {
      let y = d.pageTitle(doc, 'Training Days & Meet-Day Handoff');

      y = d.step(doc, y, 1, 'Set up training days (optional)',
        'Meet page  ›  Training Days. Create one per session (name + date). Every registered athlete is included automatically — ' +
        'uncheck anyone who shouldn’t train, then Print PDF for the on-hill roster.');

      y = d.step(doc, y, 2, 'Prepare the link sheet',
        'Each event’s Links tab lists the judge, head judge, timekeeper, and scoreboard addresses. Print or copy them so the ' +
        'Chief of Score can hand them out on event morning.');

      y = d.step(doc, y, 3, 'Hand off to the Chief of Score',
        'On event day the Chief of Score runs everything live: starting runs, fixing scores, printing mid-day reports, late registrations and bib changes. ' +
        'You set the table; they serve the meal.');

      y += 8;
      y = d.callout(doc, y,
        'There is a separate Quick Start Guide for the Chief of Score — make sure whoever sits in that chair has it. ' +
        'The overlap is intentional: anything you set up, they can patch on the day.',
        { kind: 'good' });
      y = d.callout(doc, y,
        'Working from home? Everything in this guide works over the internet on the live server — you do not need to be at the hill.',
        { kind: 'tip' });
    },

    // ── Page 4: After the meet ───────────────────────────────────────────────
    (doc, d) => {
      let y = d.pageTitle(doc, 'After the Meet (from home)');

      y = d.flowRow(doc, y, [['Final results', 'PDFs'], ['USSS results file', '(transmit XML)'], ['Export the meet', 'to a file'], ['Keep the export', 'as your archive']], { boxH: 50, fontSize: 9.5 }) + 20;

      y = d.step(doc, y, 1, 'Check every event shows Complete',
        'Open the meet — each event should say Complete. If one doesn’t, the Chief of Score (or an admin) needs to finish it first.');

      y = d.step(doc, y, 2, 'Generate the USSS results file',
        'Meet page  ›  USSS Transmit. The app builds the official XML results file for each event. Upload it to USSS within the required window (usually 72 hours). ' +
        'Athletes who didn’t start or finish are included automatically with the right status.');

      y = d.step(doc, y, 3, 'Export and archive the meet',
        'Meet page  ›  the More menu  ›  Export Meet. You get a single file containing everything — every athlete, score, bracket, and training day. ' +
        'Keep it with your season records; it can be re-imported onto any StickIt server later.');

      y += 8;
      y = d.callout(doc, y, 'Transmit only after every event is Complete — a partial transmit means re-doing it.', { kind: 'stop' });
      y = d.callout(doc, y, 'The export file is your insurance policy. One per meet, stored somewhere safe, and you can always rebuild.', { kind: 'tip' });
    },
  ],
};
