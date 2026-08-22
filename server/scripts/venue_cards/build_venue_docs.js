#!/usr/bin/env node
/**
 * StickIt v2 — printed venue material generator (Step 6, constraint 8).
 *
 * Generates the one-page volunteer run sheets, the venue card (address + QR +
 * overlay URL), the pre-event checklist, and the Mac fallback sheet (R9) as
 * PDFs into server/public/docs/venue/ — committed like the guide PDFs, served
 * by the venue server itself AND the cloud, regenerated per release so they
 * stay current with the software.
 *
 *   node server/scripts/venue_cards/build_venue_docs.js
 *
 * Every sheet is written for a volunteer with minimal technical knowledge,
 * with David NOT on site (constraint 8): big type, numbered steps, no jargon.
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { VERSION } = require('../../version');

const OUT_DIR = path.join(__dirname, '..', '..', 'public', 'docs', 'venue');
fs.mkdirSync(OUT_DIR, { recursive: true });

const NAVY = '#0e1628';
const BLUE = '#2a5ca8';
const AMBER = '#b45309';
const RED = '#b02a36';
const GRAY = '#475569';

function newDoc(file) {
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 40, bottom: 40, left: 48, right: 48 } });
  doc.pipe(fs.createWriteStream(path.join(OUT_DIR, file)));
  return doc;
}

function header(doc, title, subtitle) {
  doc.rect(0, 0, doc.page.width, 86).fill(NAVY);
  doc.fill('#ffffff').font('Helvetica-Bold').fontSize(24).text(title, 48, 22);
  doc.font('Helvetica').fontSize(11).fill('#93c5fd').text(subtitle, 48, 54);
  doc.fill('#000000');
  doc.y = 108;
}

function footer(doc) {
  doc.font('Helvetica').fontSize(8).fill(GRAY)
    .text(`StickIt ${VERSION} — venue run sheet. Reprint after every software update.`,
      48, doc.page.height - 34, { width: doc.page.width - 96, align: 'center' });
  doc.fill('#000000');
}

function step(doc, n, title, body) {
  const y = doc.y;
  doc.circle(60, y + 9, 11).fill(BLUE);
  doc.fill('#ffffff').font('Helvetica-Bold').fontSize(12).text(String(n), 49, y + 3, { width: 22, align: 'center' });
  doc.fill('#000000').font('Helvetica-Bold').fontSize(13).text(title, 82, y, { width: 460 });
  if (body) doc.font('Helvetica').fontSize(11).fill('#1f2937').text(body, 82, doc.y + 2, { width: 460 });
  doc.fill('#000000');
  doc.y += 12;
}

function callout(doc, text, color = AMBER) {
  const y = doc.y;
  const h = doc.heightOfString(text, { width: 440 }) + 18;
  doc.roundedRect(48, y, doc.page.width - 96, h, 6).lineWidth(1.2).stroke(color);
  doc.font('Helvetica-Bold').fontSize(10.5).fill(color).text(text, 60, y + 9, { width: 440 });
  doc.fill('#000000');
  doc.y = y + h + 14;
}

function bigMono(doc, text) {
  doc.font('Courier-Bold').fontSize(20).fill(NAVY).text(text, { align: 'center' });
  doc.fill('#000000');
  doc.moveDown(0.4);
}

async function venueCard() {
  const doc = newDoc('venue_card.pdf');
  header(doc, 'StickIt — Judges’ Stand Card', 'Post this at the judges’ stand. Tablets connect here all day.');

  doc.font('Helvetica-Bold').fontSize(14).text('On every tablet, open Safari and go to:', { align: 'center' });
  doc.moveDown(0.3);
  bigMono(doc, 'http://stickit.local:3001');
  const qr = await QRCode.toDataURL('http://stickit.local:3001', { width: 220, margin: 1 });
  doc.image(Buffer.from(qr.split(',')[1], 'base64'), doc.page.width / 2 - 90, doc.y, { width: 180 });
  doc.y += 196;
  doc.font('Helvetica').fontSize(11).fill(GRAY).text('…or scan the code. Then tap your role and enter the PIN from the run sheet.', { align: 'center' });
  doc.fill('#000000');
  doc.moveDown(1.2);

  doc.font('Helvetica-Bold').fontSize(14).text('Livestream box (YoloBox) overlay address:');
  doc.moveDown(0.3);
  doc.font('Courier-Bold').fontSize(16).fill(AMBER).text('http://  ___ . ___ . ___ . ___  :3001/overlay');
  doc.fill('#000000');
  doc.font('Helvetica').fontSize(10.5).fill(GRAY).text(
    'Write the number in from the Pi’s Connection Info page each event morning (menu → Connection Info). ' +
    'At UniFi venues the number never changes; at Starlink-router venues check it every event day.', { width: 500 });
  doc.fill('#000000');
  doc.moveDown(1);
  callout(doc, 'No internet needed for scoring. If the internet drops, keep scoring exactly as normal — everything uploads by itself the moment it returns.');
  footer(doc);
  doc.end();
}

function kitSetup() {
  const doc = newDoc('runsheet_kit_setup.pdf');
  header(doc, 'Run Sheet 1 — Kit Setup', 'Morning of the event, before anyone scores. Takes about 5 minutes.');
  step(doc, 1, 'Plug the StickIt box (Raspberry Pi) into power and the network.',
    'UniFi venue: any LAN port on the venue router. Starlink-router venue: one of the two Ethernet ports on the back of the Starlink router.');
  step(doc, 2, 'Plug the small USB backup stick into the StickIt box.',
    'It is labeled STICKIT-SNAP. The home screen warns you if it is missing — scoring still works without it.');
  step(doc, 3, 'Wait about one minute for the green light to settle.');
  step(doc, 4, 'On any tablet, open Safari and go to  http://stickit.local:3001',
    'You should see the StickIt Venue menu. If not: wait another minute, then pull the power plug, plug back in, try again.');
  step(doc, 5, 'The spare StickIt box stays in the kit bag.',
    'Only swap it in if the first box will not come up after two power cycles — then repeat from step 1 with the spare and use Run Sheet 2 to adopt the meet onto it.');
  callout(doc, 'Nothing to configure. The box remembers nothing between meets — Run Sheet 2 (Adopt the Meet) loads today’s meet onto it.');
  footer(doc);
  doc.end();
}

function adoption() {
  const doc = newDoc('runsheet_adoption.pdf');
  header(doc, 'Run Sheet 2 — Adopt the Meet', 'After kit setup. You need the release code from the meet official.');
  step(doc, 1, 'Get the release code.',
    'The official releases the meet on stickitski.com and reads you an 8-character code (letters and numbers) over the phone, or it is written on this sheet:  CODE: ______________');
  step(doc, 2, 'On a tablet, open  http://stickit.local:3001  and type the code into "Adopt Meet".',
    'This needs internet for a moment. If it says a copy already exists (day two of a meet), tap Replace when asked — that is normal.');
  step(doc, 3, 'Set the two PINs when asked, and write them here.',
    'Control PIN (scoring computer + head judge): ________     Crew PIN (judges + timekeeper): ________');
  step(doc, 4, 'Done. The meet name shows at the top, with "Sync: Up to date".',
    'Hand out tablets — Run Sheet 3 (Tablets) gets each person to their screen.');
  callout(doc, 'The code works exactly once. If adoption fails partway, call the official to release a new code — nothing is harmed.');
  callout(doc, 'No internet right now? Plan B: the official can hand you the meet on a USB stick as a file — use "Import from file" on the same screen.', RED);
  footer(doc);
  doc.end();
}

function tablets() {
  const doc = newDoc('runsheet_tablets.pdf');
  header(doc, 'Run Sheet 3 — Tablets', 'One per person. A tablet remembers its job — even after a reboot.');
  step(doc, 1, 'Open Safari on the tablet and go to  http://stickit.local:3001',
    'Or scan the QR code on the judges’ stand card.');
  step(doc, 2, 'Tap the person’s role.',
    'Judges: tap Judge, enter the Crew PIN, then tap the seat number that matches where they are sitting (J1, J2, …). Timekeeper: tap Timekeeper, Crew PIN. Head Judge / Scoring Computer: Control PIN. Scoreboard: no PIN.');
  step(doc, 3, 'That’s it. The screen follows the competition by itself.',
    'When events alternate (women’s / men’s), every tablet switches automatically. Nobody ever types a web address mid-day.');
  step(doc, 4, 'If a tablet dies or reboots, just reopen Safari.',
    'It goes straight back to its job. If Safari lost the page, go to stickit.local:3001 again — same thing.');
  callout(doc, 'Seat already "in use" from a dead tablet? On the seat picker, tap "Force release" under that seat and enter the Control PIN.');
  footer(doc);
  doc.end();
}

function livestream() {
  const doc = newDoc('runsheet_livestream.pdf');
  header(doc, 'Run Sheet 4 — Livestream (YoloBox)', 'The score overlay for the stream. Set once, check each morning.');
  step(doc, 1, 'On the tablet menu, open Connection Info.',
    'It shows the overlay address as a number, like  http://192.168.1.50:3001/overlay');
  step(doc, 2, 'Check the YoloBox browser/web source uses EXACTLY that address.',
    'UniFi venue: it is stored from last time and the number never changes — just confirm. Starlink-router venue: the number can change — fix it if different.');
  step(doc, 3, 'The overlay follows the action by itself.',
    'It always shows the athlete on course, in whichever event is running. The scoring computer can pin it to one event if the broadcast needs that (Scoring tab → "Pin overlay to this event").');
  callout(doc, 'The overlay is transparent — if the stream shows a black screen instead of the video with scores on top, the YoloBox source type is wrong (needs the web/browser overlay source), not StickIt.');
  footer(doc);
  doc.end();
}

function endOfDay() {
  const doc = newDoc('runsheet_end_of_day.pdf');
  header(doc, 'Run Sheet 5 — End of Day', 'After the last run is approved. Two different endings — pick the right one.');
  doc.font('Helvetica-Bold').fontSize(13).fill(BLUE).text('First: tear down tablets (both endings)');
  doc.fill('#000000');
  doc.moveDown(0.3);
  step(doc, 1, 'Confirm the head judge has approved the final results.');
  step(doc, 2, 'Collect the judge tablets. Leave the StickIt box powered and connected.');
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(13).fill(BLUE).text('Ending A — more competition days remain (e.g. duals tomorrow)');
  doc.fill('#000000');
  doc.moveDown(0.3);
  step(doc, 3, 'On the menu, tap "Hand Back to Cloud" (Control PIN).',
    'It verifies every score against stickitski.com — under a minute with internet. Tonight’s bracket work happens on the website; tomorrow you adopt again with a NEW code (Run Sheet 2).');
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(13).fill(BLUE).text('Ending B — the meet is finished');
  doc.fill('#000000');
  doc.moveDown(0.3);
  step(doc, 4, 'On the menu, tap "Check In Meet" (Control PIN).',
    'Same verification; the results become the permanent record on stickitski.com. When it shows "checked in", power everything down and pack the kit.');
  callout(doc, 'Both need internet. If it says the cloud is unreachable, scoring data is safe on the box — leave it powered, get the internet back (or move the box somewhere with internet), and tap the button again.', RED);
  footer(doc);
  doc.end();
}

function preEvent() {
  const doc = newDoc('preevent_checklist.pdf');
  header(doc, 'Pre-Event Checklist', 'For the organizer, the week before. Both network profiles.');
  doc.font('Helvetica-Bold').fontSize(13).fill(BLUE).text('Both profiles');
  doc.fill('#000000'); doc.moveDown(0.3);
  const item = (t) => { doc.font('Helvetica').fontSize(11.5).text(`☐  ${t}`, { width: 500 }); doc.moveDown(0.35); };
  item('Kit packed: 2 StickIt boxes (one spare), power supplies, Ethernet cable, USB snapshot stick (STICKIT-SNAP), printed run sheets 1–5 + judges’ stand card.');
  item('StickIt box software updated at home: plug in, open stickit.local:3001, click Update StickIt (only shows when no meet is loaded).');
  item('Meet fully built on stickitski.com: events, registrations, judges, run orders, course specs.');
  item('Plan for the release code: who releases the meet, and how the code reaches the venue (phone / written down).');
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(13).fill(BLUE).text('UniFi venue (primary)');
  doc.fill('#000000'); doc.moveDown(0.3);
  item('DHCP reservation for the Pi confirmed in the UniFi console (permanent IP, e.g. 192.168.1.50).');
  item('YoloBox already has the overlay URL stored in fixed-IP form — no changes expected.');
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(13).fill(BLUE).text('Starlink Gen 3 built-in router venue (RQS / Devo)');
  doc.fill('#000000'); doc.moveDown(0.3);
  item('Pi plugs into one of the router’s two built-in Ethernet LAN ports.');
  item('The numeric IP can occasionally change: verify the YoloBox overlay URL against Connection Info each event morning (it is on Run Sheet 4).');
  item('iPads use http://stickit.local:3001 (name, not number) — unaffected by IP changes.');
  footer(doc);
  doc.end();
}

function macFallback() {
  const doc = newDoc('runsheet_mac_fallback.pdf');
  header(doc, 'Emergency — Run StickIt from a Mac', 'Only if BOTH StickIt boxes are dead (R9). Full doc: docs/VENUE_MAC_FALLBACK.md');
  step(doc, 1, 'On the Mac, install Node.js if needed (nodejs.org, LTS).');
  step(doc, 2, 'Get the StickIt code onto the Mac.',
    'From GitHub (github.com/ddreitlein-gif/StickIt → Code → Download ZIP) or the kit USB stick. Unzip it.');
  step(doc, 3, 'Open Terminal, then run (one line at a time):');
  doc.font('Courier-Bold').fontSize(12).fill(NAVY);
  doc.text('cd ~/Downloads/StickIt-*/server', 82);
  doc.text('npm install', 82);
  doc.text('STICKIT_MODE=venue node index.js', 82);
  doc.fill('#000000'); doc.moveDown(0.6);
  step(doc, 4, 'Find the Mac’s network address.',
    'System Settings → Wi-Fi/Ethernet → Details → IP address, e.g. 192.168.1.77. Tablets go to  http://THAT-ADDRESS:3001  (write it on the stand card — stickit.local does not point at the Mac).');
  step(doc, 5, 'Adopt the meet exactly as on Run Sheet 2.',
    'Keep the Mac plugged in, lid open, and set Energy/Lock Screen so it never sleeps.');
  callout(doc, 'The Terminal window must stay open all day — closing it stops scoring.', RED);
  footer(doc);
  doc.end();
}

(async () => {
  await venueCard();
  kitSetup();
  adoption();
  tablets();
  livestream();
  endOfDay();
  preEvent();
  macFallback();
  // pdfkit streams close asynchronously; give them a beat before reporting.
  setTimeout(() => {
    const files = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.pdf'));
    console.log(`Venue docs written to ${OUT_DIR}:`);
    for (const f of files) console.log(`  - ${f} (${fs.statSync(path.join(OUT_DIR, f)).size} bytes)`);
  }, 500);
})();
