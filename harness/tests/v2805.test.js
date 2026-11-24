/**
 * v2.8.05 — "run sheet" renamed "quick reference sheet" (David, 2026-11-24:
 * officials confused the printed venue cards with run orders). Wording only.
 *
 *   A. THE EIGHT VENUE PDFs (server/public/docs/venue, as committed): each one
 *      says "quick reference sheet" and none says "run sheet"; sheets 1–5 carry
 *      the new title on one line; the footer names this version; Sheet 4 names
 *      the Broadcast Board (source per event, numeric address) and the
 *      checklist names both addresses; no arrow prints as "!'" (Helvetica has
 *      no arrow glyph — the arrows are now ", then"). Two older defects fixed
 *      in this release (David, 2026-11-24): every PDF is ONE page (the footer
 *      used to land alone on a second page), and the checklist items start
 *      with a drawn tick box, not the "&" an unencodable checkbox printed as.
 *   B. THE BUILT CLIENT (server/public/assets): the venue home page strings and
 *      the venue-server help topic use the new term; no "run sheet" anywhere in
 *      the bundle. Same for the help topic sources.
 *   C. SERVED: every venue PDF is served, byte-identical to the file, by a
 *      cloud server and by a venue server (file names unchanged: runsheet_*).
 *   D. VENUE HOME PAGE (Playwright): the PIN card and the End of day label read
 *      "quick reference sheet", the page never says "run sheet", and the label
 *      stays on one line at 1112 x 680 (iPad Air 3 landscape) and on a laptop.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Checks } = require('../lib/checks');
const { Instance, REPO_ROOT, SERVER_DIR } = require('../lib/instance');
const { Api } = require('../lib/client');
const { buildMeet } = require('../lib/fixtures');
const { newTablet, shutdownBrowser } = require('../lib/browser');
const { VERSION } = require(path.join(SERVER_DIR, 'version.js'));

const VENUE_DOCS = path.join(SERVER_DIR, 'public', 'docs', 'venue');
const ASSETS = path.join(SERVER_DIR, 'public', 'assets');
const TOPICS = path.join(REPO_ROOT, 'client', 'src', 'help', 'topics');

const SHEETS = {
  'runsheet_kit_setup.pdf': 'Quick Reference Sheet 1 — Kit Setup',
  'runsheet_adoption.pdf': 'Quick Reference Sheet 2 — Adopt the Meet',
  'runsheet_tablets.pdf': 'Quick Reference Sheet 3 — Tablets',
  'runsheet_livestream.pdf': 'Quick Reference Sheet 4 — Livestream (YoloBox)',
  'runsheet_end_of_day.pdf': 'Quick Reference Sheet 5 — End of Day',
};
const ALL = [...Object.keys(SHEETS), 'venue_card.pdf', 'preevent_checklist.pdf', 'runsheet_mac_fallback.pdf'];

const OLD = /run[\s-]*sheet/i;      // "run sheet", "run-sheet", "Run Sheets", wrapped over a line
const NEW = /quick reference sheet/i;

// pdfkit writes standard-font text as [<hex> kern <hex> ...] TJ in deflated
// streams, WinAnsi bytes. One entry per printed line, in print order.
function pdfLines(buf) {
  const cp1252 = new TextDecoder('windows-1252');
  const out = [];
  let i = 0;
  for (;;) {
    const s = buf.indexOf('stream\n', i); if (s < 0) break;
    const e = buf.indexOf('endstream', s); if (e < 0) break;
    i = e + 9;
    let txt;
    try { txt = zlib.inflateSync(buf.subarray(s + 7, e)).toString('latin1'); } catch (_) { continue; }
    for (const m of txt.matchAll(/\[((?:<[0-9a-fA-F]*>|[-\d.\s])*)\]\s*TJ/g)) {
      const bytes = [];
      for (const h of m[1].matchAll(/<([0-9a-fA-F]*)>/g)) bytes.push(...Buffer.from(h[1], 'hex'));
      out.push(cp1252.decode(Uint8Array.from(bytes)));
    }
  }
  return out;
}
const flat = (lines) => lines.join(' ').replace(/\s+/g, ' ');
// pdfkit leaves page objects uncompressed: one "/Type /Page" per page.
const pageCount = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page\b(?!s)/g) || []).length;
// Drawing operators of every content stream, as text.
function pdfOps(buf) {
  let out = '';
  let i = 0;
  for (;;) {
    const s = buf.indexOf('stream\n', i); if (s < 0) break;
    const e = buf.indexOf('endstream', s); if (e < 0) break;
    i = e + 9;
    try { out += zlib.inflateSync(buf.subarray(s + 7, e)).toString('latin1') + '\n'; } catch (_) { /* image / font stream */ }
  }
  return out;
}

async function main() {
  const c = new Checks('v2805');
  const cloud = new Instance({ name: 'v2805-cloud', port: 3431, mode: 'cloud' });
  const venue = new Instance({ name: 'v2805-venue', port: 3432, mode: 'venue' });
  try {
    // =====================================================================
    // A. The eight venue PDFs
    // =====================================================================
    const text = {};
    for (const f of ALL) {
      const buf = fs.readFileSync(path.join(VENUE_DOCS, f));
      const lines = pdfLines(buf);
      text[f] = { lines, flat: flat(lines) };
      c.eq(pageCount(buf), 1, `A: ${f} is one page`);
      c.ok(lines[lines.length - 1].startsWith(`StickIt ${VERSION} `), `A: ${f} — the footer is the last line on that page`);
      // A character Helvetica cannot print comes out as stray bytes, one of them a control code.
      c.ok(!/[\x00-\x1f]/.test(lines.join('')), `A: ${f} prints no unencodable character`);
      c.ok(NEW.test(text[f].flat), `A: ${f} says "quick reference sheet"`);
      c.ok(!OLD.test(text[f].flat), `A: ${f} never says "run sheet"`);
      c.ok(text[f].flat.includes(`StickIt ${VERSION} — venue quick reference sheet. Reprint after every software update.`),
        `A: ${f} footer names ${VERSION} and the new term`);
      // An unencodable arrow printed as "!" + 0x92 (the low bytes of U+2192).
      c.ok(!/!’|→|▾/.test(text[f].flat), `A: ${f} prints no broken arrow`);
    }
    for (const [f, title] of Object.entries(SHEETS)) {
      c.eq(text[f].lines[0], title, `A: ${f} title is one line: "${title}"`);
    }
    const s4 = text['runsheet_livestream.pdf'].flat;
    c.ok(s4.includes('Add one Broadcast Board source for each event running today.'), 'A: Sheet 4 has the Broadcast Board step');
    c.ok(s4.includes('/broadcast/') && s4.includes('in place of stickit.local'), 'A: Sheet 4 gives the board address in numeric form');
    c.ok(s4.includes('Overlay while an athlete is on course. Board between athletes.'), 'A: Sheet 4 says when to show the overlay and when the board');
    c.ok(s4.includes('Check the YoloBox overlay source uses EXACTLY that address.'), 'A: Sheet 4 keeps the overlay address check');
    const chk = text['preevent_checklist.pdf'].flat;
    c.ok(chk.includes('overlay and Broadcast Board addresses') && chk.includes('Quick Reference Sheet 4'), 'A: checklist names both addresses and Quick Reference Sheet 4');
    c.ok(chk.includes('printed quick reference sheets 1–5'), 'A: checklist kit line lists the quick reference sheets');
    const chkLines = text['preevent_checklist.pdf'].lines;
    c.ok(!chkLines.some(l => /^\s*&/.test(l)), 'A: no checklist line starts with "&"');
    c.ok(chkLines.some(l => l.startsWith('Kit packed: 2 StickIt boxes (one spare)')), 'A: checklist items start with their own text');
    const boxes = (pdfOps(fs.readFileSync(path.join(VENUE_DOCS, 'preevent_checklist.pdf'))).match(/^48\.5 [\d.]+ 9 9 re$/gm) || []).length;
    c.eq(boxes, 14, 'A: checklist draws one tick box for each of its 14 items');
    c.ok(text['venue_card.pdf'].flat.includes('enter the PIN from the quick reference sheet'), 'A: stand card points at the quick reference sheet');
    c.ok(text['runsheet_mac_fallback.pdf'].flat.includes('Adopt the meet exactly as on Quick Reference Sheet 2.'), 'A: Mac fallback sheet cross-reference');
    c.ok(text['runsheet_kit_setup.pdf'].flat.includes('Quick Reference Sheet 2 (Adopt the Meet)'), 'A: Sheet 1 cross-reference');
    c.ok(text['runsheet_adoption.pdf'].flat.includes('Quick Reference Sheet 3 (Tablets)'), 'A: Sheet 2 cross-reference');
    c.ok(text['runsheet_end_of_day.pdf'].flat.includes('NEW code (Quick Reference Sheet 2)'), 'A: Sheet 5 cross-reference');

    // =====================================================================
    // B. The built client and the help topic sources
    // =====================================================================
    const bundles = fs.readdirSync(ASSETS).filter(f => /^index-.*\.js$/.test(f) && !/ \d+\./.test(f));
    c.eq(bundles.length, 1, 'B: exactly one built index bundle in server/public/assets');
    const js = fs.readFileSync(path.join(ASSETS, bundles[0]), 'utf8');
    c.ok(js.includes('Write both on the quick reference sheet.'), 'B: bundle — PIN card says "quick reference sheet"');
    c.ok(js.includes('End of day (see the quick reference sheet)'), 'B: bundle — End of day label says "quick reference sheet"');
    c.ok(js.includes('The printed quick reference sheets (Kit Setup, Adopt the Meet, Tablets, Livestream, End of Day)'), 'B: bundle — venue-server help intro');
    c.ok(js.includes('Write both PINs on Quick Reference Sheet 2 (Adopt the Meet).'), 'B: bundle — venue-server help PIN line');
    c.ok(!OLD.test(js), 'B: bundle never says "run sheet"');
    const stale = fs.readdirSync(TOPICS).filter(f => f.endsWith('.md') && OLD.test(fs.readFileSync(path.join(TOPICS, f), 'utf8')));
    c.deepEq(stale, [], 'B: no help topic says "run sheet"');

    // =====================================================================
    // C. Served by the cloud and by a venue server
    // =====================================================================
    await cloud.start();
    await venue.start();
    for (const [who, base] of [['cloud', cloud.base], ['venue', venue.base]]) {
      for (const f of ALL) {
        const r = await fetch(`${base}/docs/venue/${f}`);
        const body = Buffer.from(await r.arrayBuffer());
        c.ok(r.ok && (r.headers.get('content-type') || '').includes('pdf') && body.equals(fs.readFileSync(path.join(VENUE_DOCS, f))),
          `C: ${f} served by the ${who} server, byte-identical to the file`);
      }
    }

    // =====================================================================
    // D. Venue home page
    // =====================================================================
    const cApi = new Api(cloud.base);
    const vApi = new Api(venue.base);
    const A = await buildMeet(cApi, { name: 'QuickRef', gender: 'M', judges: ['TL1', 'TL2', 'TL3', 'Air1', 'Air2', 'HJ'], athletes: 2, startRun: false });
    const rel = await cApi.must('POST', `/api/meets/${A.meet.id}/release-for-adoption`);
    await vApi.must('POST', '/api/venue/adopt', { code: rel.code, cloud_url: cloud.base });

    const tab = await newTablet();
    const page = await tab.newPage();
    await page.setViewportSize({ width: 1112, height: 680 });
    await page.goto(venue.base + '/?menu=1', { waitUntil: 'domcontentloaded' });
    const pinCard = page.locator('[data-testid="pin-setup-card"]');
    await pinCard.waitFor({ timeout: 15000 });
    c.ok((await pinCard.innerText()).includes('Write both on the quick reference sheet.'), 'D: PIN card says "Write both on the quick reference sheet."');
    c.ok(!OLD.test(await page.locator('body').innerText()), 'D: venue home (PINs not set) never says "run sheet"');

    await vApi.must('POST', '/api/venue/pins', { control_pin: '4321', crew_pin: '1111' });
    const label = page.locator('text=End of day (see the quick reference sheet)');
    // One line = the box is no taller than a single line of its own text.
    const oneLine = () => label.evaluate((el) => {
      const cs = getComputedStyle(el);
      const range = document.createRange();
      range.selectNodeContents(el);
      return {
        rects: range.getClientRects().length,
        height: el.getBoundingClientRect().height,
        lineHeight: parseFloat(cs.lineHeight),
        overflow: el.scrollWidth > el.clientWidth,
        transform: cs.textTransform,
      };
    });
    for (const [name, width, height] of [['iPad Air 3 landscape', 1112, 680], ['scoring laptop', 1440, 900]]) {
      await page.setViewportSize({ width, height });
      await page.goto(venue.base + '/?menu=1', { waitUntil: 'domcontentloaded' });
      await label.waitFor({ timeout: 15000 });
      const m = await oneLine();
      c.ok(m.rects === 1 && m.height <= m.lineHeight * 1.2 && !m.overflow,
        `D: End of day label fits on one line, ${name} ${width} x ${height} (${m.rects} line box, ${m.height}px high, line height ${m.lineHeight}px)`);
      c.eq(m.transform, 'uppercase', `D: label is still the small uppercase heading (${name})`);
      c.ok(!OLD.test(await page.locator('body').innerText()), `D: venue home (meet adopted, PINs set) never says "run sheet" (${name})`);
      if (process.env.STICKIT_V2805_SHOTS) {
        await page.screenshot({ path: path.join(process.env.STICKIT_V2805_SHOTS, `venue_home_${width}.png`), fullPage: true });
      }
    }
    c.ok(await page.locator('text=Hand Back to Cloud').isVisible() && await page.locator('text=Check In Meet').isVisible(),
      'D: the end-of-day buttons are still under the label');
    await tab.close();
  } finally {
    await shutdownBrowser().catch(() => {});
    await venue.stop().catch(() => {});
    await cloud.stop().catch(() => {});
  }
  return c;
}

module.exports = { main };
