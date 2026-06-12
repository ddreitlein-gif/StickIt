// Shared style system for the printable PDF guides.
// Used only by server/scripts/build_guide_pdfs.js at build/release time — never at runtime.
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const COLORS = {
  navy:     '#0c426d',
  navyDeep: '#082a48',
  blue:     '#0272c4',
  blueSoft: '#bae0fd',
  blueBg:   '#f0f7ff',
  red:      '#ef4444',
  redBg:    '#fef2f2',
  amber:    '#d97706',
  amberBg:  '#fffbeb',
  green:    '#16a34a',
  greenBg:  '#f0fdf4',
  ink:      '#1e293b',
  gray:     '#64748b',
  grayLight:'#e2e8f0',
  white:    '#ffffff',
};

const PAGE = { size: 'LETTER', margins: { top: 54, bottom: 64, left: 54, right: 54 } };
const PAGE_W = 612, PAGE_H = 792;
const CONTENT_W = PAGE_W - PAGE.margins.left - PAGE.margins.right; // 504
const BOTTOM_Y = PAGE_H - PAGE.margins.bottom;

const STICKIT_LOGO = path.join(__dirname, '..', '..', 'public', 'logos', 'stickit.png');

function newDoc({ title, subject }) {
  return new PDFDocument({
    ...PAGE,
    bufferPages: true,
    autoFirstPage: true,
    info: {
      Title: title,
      Subject: subject || title,
      Author: 'StickIt',
      // Pinned so regenerating without content changes keeps git diffs small.
      CreationDate: new Date('2026-01-01T00:00:00Z'),
    },
  });
}

// Full-bleed cover page drawn on the doc's current (first) page.
function coverPage(doc, { title, subtitle, audience, version, accent = COLORS.blue }) {
  // Top band
  doc.rect(0, 0, PAGE_W, 8).fill(accent);
  if (fs.existsSync(STICKIT_LOGO)) {
    doc.image(STICKIT_LOGO, PAGE_W / 2 - 70, 110, { width: 140 });
  }
  doc.fillColor(COLORS.gray).font('Helvetica').fontSize(13)
    .text('STICKIT FREESTYLE SCORING', 0, 280, { width: PAGE_W, align: 'center', characterSpacing: 2 });

  // Title band
  const bandY = 330;
  doc.rect(0, bandY, PAGE_W, 92).fill(COLORS.navyDeep);
  doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(31)
    .text(title, 40, bandY + (subtitle ? 16 : 30), { width: PAGE_W - 80, align: 'center' });
  if (subtitle) {
    doc.fillColor(COLORS.blueSoft).font('Helvetica').fontSize(15)
      .text(subtitle, 40, bandY + 58, { width: PAGE_W - 80, align: 'center' });
  }

  if (audience) {
    doc.fillColor(COLORS.ink).font('Helvetica').fontSize(13)
      .text(`For: ${audience}`, 0, bandY + 130, { width: PAGE_W, align: 'center' });
  }

  doc.fillColor(COLORS.gray).font('Helvetica').fontSize(10)
    .text(`StickIt ${version}`, 0, PAGE_H - 120, { width: PAGE_W, align: 'center' });
  doc.rect(0, PAGE_H - 8, PAGE_W, 8).fill(accent);
}

// Stamp footers on every page except the cover (page 0). Run LAST.
function stampFooters(doc, { version, guideTitle }) {
  const range = doc.bufferedPageRange();
  for (let i = 1; i < range.count; i++) {
    doc.switchToPage(i);
    // Writing below the bottom margin would trigger an automatic page add —
    // lift the margin while stamping this page.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = PAGE_H - 40;
    doc.fillColor(COLORS.gray).font('Helvetica').fontSize(8);
    doc.text(`StickIt ${version} — ${guideTitle}`, PAGE.margins.left, y, { lineBreak: false });
    doc.text(`Page ${i} of ${range.count - 1}`, PAGE.margins.left, y, { width: CONTENT_W, align: 'right', lineBreak: false });
    doc.moveTo(PAGE.margins.left, y - 6).lineTo(PAGE_W - PAGE.margins.right, y - 6)
      .lineWidth(0.5).strokeColor(COLORS.grayLight).stroke();
    doc.page.margins.bottom = savedBottom;
  }
}

function ensureSpace(doc, neededPts) {
  if (doc.y + neededPts > BOTTOM_Y) doc.addPage();
}

function writeDoc(doc, outPath) {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(outPath);
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.pipe(stream);
    doc.end();
  });
}

module.exports = { COLORS, PAGE, PAGE_W, PAGE_H, CONTENT_W, BOTTOM_Y, newDoc, coverPage, stampFooters, ensureSpace, writeDoc };
