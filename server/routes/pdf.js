const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { queryAll, queryOne } = require('../db/schema');
const { rankResults, pickBestRun, applyTierRanks } = require('../scoring/engine');
const PDFDocument = require('pdfkit');
const { normalizeGender } = require('../utils/gender');
const { computeDualFfsp } = require('../dual/ffsp');
const { rankDualPlacements } = require('../dual/placement_ranking');

// Logo paths
const USSS_LOGO = path.join(__dirname, '..', 'public', 'logos', 'usss.png');
const STICKIT_LOGO = path.join(__dirname, '..', 'public', 'logos', 'stickit.png');
const MEET_LOGOS_DIR = path.join(__dirname, '..', 'data', 'logos');

// Multer setup for meet logo uploads
const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, MEET_LOGOS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `meet_${req.params.meetId}${ext}`);
  },
});
const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

function getMeetLogoPath(meetId) {
  for (const ext of ['.png', '.jpg', '.jpeg']) {
    const p = path.join(MEET_LOGOS_DIR, `meet_${meetId}${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Native pdfkit helpers — shared by all report types
// ---------------------------------------------------------------------------
function streamPdf(res, doc, filename) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);
}

function pdfHeader(doc, meet, event, subtitle) {
  const marginL = doc.page.margins.left;
  const marginR = doc.page.margins.right;
  const pageW = doc.page.width - marginL - marginR;
  const headerY = doc.y;
  const logoH = 36; // logo height in points
  const logoMargin = 8; // space between logo and text

  // USSS logo — upper left
  let leftLogoW = 0;
  if (fs.existsSync(USSS_LOGO)) {
    try {
      doc.image(USSS_LOGO, marginL, headerY, { height: logoH });
      // Estimate width from aspect ratio (USSS logo is ~3:4 w:h)
      leftLogoW = logoH * 0.75 + logoMargin;
    } catch (e) { /* skip if image fails */ }
  }

  // Meet/event logo — upper right
  let rightLogoW = 0;
  const meetLogoPath = getMeetLogoPath(meet?.id);
  if (meetLogoPath) {
    try {
      // Fit logo to height, place right-aligned
      const img = doc.openImage(meetLogoPath);
      const aspect = img.width / img.height;
      const w = logoH * aspect;
      rightLogoW = w + logoMargin;
      doc.image(meetLogoPath, doc.page.width - marginR - w, headerY, { height: logoH });
    } catch (e) { /* skip if image fails */ }
  }

  // Center text between logos
  const textX = marginL + leftLogoW;
  const textW = pageW - leftLogoW - rightLogoW;
  doc.fontSize(16).font('Helvetica-Bold').text(meet?.name || 'Freestyle Meet', textX, headerY, { width: textW, align: 'center' });
  doc.fontSize(11).font('Helvetica').text(event.name + (subtitle ? ` — ${subtitle}` : ''), textX, doc.y, { width: textW, align: 'center' });
  const meta = [meet?.location, meet?.date].filter(Boolean).join(' | ');
  if (meta) doc.fontSize(8).fillColor('#666').text(meta, textX, doc.y, { width: textW, align: 'center' });
  doc.fillColor('#000');

  // Ensure we're past the logo height
  if (doc.y < headerY + logoH) doc.y = headerY + logoH;
  doc.moveDown(0.3);
  doc.moveTo(marginL, doc.y).lineTo(doc.page.width - marginR, doc.y).lineWidth(1).stroke('#000');
  doc.moveDown(0.5);
}

function drawTable(doc, columns, rows, opts = {}) {
  const startX = doc.page.margins.left;
  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const rowH = opts.rowHeight || 16;
  const fontSize = opts.fontSize || 8;
  const headerFontSize = opts.headerFontSize || 7;
  const headerColor = opts.headerColor || '#1B3A5C';
  const useGridLines = opts.gridLines || false;
  const vCenter = opts.verticalCenter || false;

  // Calculate column widths
  const totalWeight = columns.reduce((s, c) => s + (c.width || 1), 0);
  const colWidths = columns.map(c => ((c.width || 1) / totalWeight) * pageW);
  const colXs = [];
  let cx = startX;
  for (const w of colWidths) { colXs.push(cx); cx += w; }

  // Helper to draw header row
  const drawTableHeader = () => {
    doc.save();
    doc.rect(startX, doc.y, pageW, rowH + 2).fill(headerColor);
    doc.fillColor('#fff').fontSize(headerFontSize).font('Helvetica-Bold');
    const hy = doc.y + 3;
    columns.forEach((c, i) => {
      doc.text(c.header.toUpperCase(), colXs[i] + 3, hy, { width: colWidths[i] - 6, align: c.align || 'left', lineBreak: false });
    });
    doc.y = hy + rowH - 1;
    doc.restore();
    doc.fillColor('#000');
  };

  drawTableHeader();
  let gridStartY = doc.y;
  let gridRowCount = 0;

  // Helper: draw grid lines for a page segment
  const drawGridSegment = (segStartY, segRowCount) => {
    if (!useGridLines || segRowCount === 0) return;
    doc.lineWidth(0.5).strokeColor('#000');
    let ly = segStartY;
    for (let i = 0; i <= segRowCount; i++) {
      doc.moveTo(startX, ly).lineTo(startX + pageW, ly).stroke();
      ly += rowH;
    }
    for (let i = 0; i <= columns.length; i++) {
      const lx = i < columns.length ? colXs[i] : startX + pageW;
      doc.moveTo(lx, segStartY).lineTo(lx, segStartY + segRowCount * rowH).stroke();
    }
    doc.strokeColor('#000');
  };

  // Data rows
  rows.forEach((row, ri) => {
    // New page check
    if (doc.y + rowH > doc.page.height - doc.page.margins.bottom - 20) {
      drawGridSegment(gridStartY, gridRowCount);
      addPageWithFooter(doc, null, opts.footerOpts);
      drawTableHeader();
      gridStartY = doc.y;
      gridRowCount = 0;
    }

    const ry = doc.y + 1;
    // Alternate row shading (skip when using grid lines)
    if (!useGridLines && ri % 2 === 0) {
      doc.save();
      doc.rect(startX, ry - 1, pageW, rowH).fill('#f5f5f5');
      doc.restore();
      doc.fillColor('#000');
    }

    const textY = vCenter ? ry + (rowH - fontSize) / 2 - 1 : ry + 2;
    doc.fontSize(fontSize).font('Helvetica');
    columns.forEach((c, i) => {
      const val = c.value(row);
      const str = val != null ? String(val) : '';
      if (c.bold) doc.font('Helvetica-Bold');
      doc.text(str, colXs[i] + 3, textY, { width: colWidths[i] - 6, align: c.align || 'left', lineBreak: false });
      if (c.bold) doc.font('Helvetica');
    });
    doc.y = ry + rowH;
    gridRowCount++;
  });

  // Grid lines for the last page segment
  if (useGridLines && rows.length > 0) {
    drawGridSegment(gridStartY, gridRowCount);
  } else if (!useGridLines) {
    // Bottom line
    doc.moveTo(startX, doc.y).lineTo(startX + pageW, doc.y).lineWidth(0.5).stroke('#ccc');
  }
}

// Stamp the footer on the CURRENT page (does not add a new page)
function stampFooter(doc, opts = {}) {
  const pageW = doc.page.width;
  const marginL = doc.page.margins.left;
  const marginR = doc.page.margins.right;
  const footerY = doc.page.height - doc.page.margins.bottom + 8;
  const savedY = doc.y;
  const savedBottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.fontSize(7).fillColor('#bbb')
    .text(
      `Generated ${new Date().toLocaleString()}  ·  StickIt Freestyle Scoring System`,
      marginL, footerY,
      { width: pageW - marginL - marginR, align: 'center' }
    );

  // StickIt logo — lower right (skip for timer sheet)
  if (!opts.skipLogo && fs.existsSync(STICKIT_LOGO)) {
    try {
      const logoH = 20;
      const img = doc.openImage(STICKIT_LOGO);
      const aspect = img.width / img.height;
      const logoW = logoH * aspect;
      doc.image(STICKIT_LOGO, pageW - marginR - logoW, footerY - 4, { height: logoH });
    } catch (e) { /* skip if image fails */ }
  }

  doc.page.margins.bottom = savedBottomMargin;
  doc.y = savedY;
  doc.fillColor('#000');
}

// Add a new page, but stamp footer on the current page first
function addPageWithFooter(doc, pageOpts, footerOpts) {
  stampFooter(doc, footerOpts);
  if (pageOpts) doc.addPage(pageOpts);
  else doc.addPage();
}

function fmtScore(v) { return v != null ? Number(v).toFixed(2) : ''; }
function fmtTime(v) { return v != null ? (v == -1 ? 'NT' : Number(v).toFixed(2)) : ''; }

// ---------------------------------------------------------------------------
// Shared: compute USSS age group from birth year
// ---------------------------------------------------------------------------
function computeAgeGroup(birthYear, meetDate) {
  if (!birthYear) return '';
  const d = meetDate ? new Date(meetDate) : new Date();
  // Season runs July 1 – June 30; use the July year as reference
  const seasonStartYear = d.getMonth() < 6 ? d.getFullYear() - 1 : d.getFullYear();
  const age = seasonStartYear - parseInt(birthYear);
  if (age <= 6) return '7';
  if (age <= 8) return '9';
  if (age <= 10) return '11';
  if (age <= 12) return '13';
  if (age <= 14) return '15';
  if (age <= 16) return '17';
  if (age <= 18) return '19';
  if (age <= 20) return 'Sr';
  return 'Vet';
}

// ---------------------------------------------------------------------------
// Shared: fetch officials, judges, course specs for footer block
// ---------------------------------------------------------------------------
async function fetchOfficialsAndCourseSpecs(meetId, eventId) {
  const officials = await queryAll(
    `SELECT * FROM officials WHERE meet_id=? AND (event_id IS NULL OR event_id='') ORDER BY role, name`,
    [meetId]
  );
  const eventOfficials = await queryAll(
    `SELECT * FROM officials WHERE meet_id=? AND event_id=? ORDER BY role, name`,
    [meetId, eventId]
  );
  const judges = await queryAll(
    `SELECT * FROM judges WHERE event_id=? ORDER BY role`, [eventId]
  );
  const courseSpec = await queryOne(
    `SELECT * FROM course_specs WHERE meet_id=? ORDER BY rowid LIMIT 1`, [meetId]
  );
  return { officials: [...officials, ...eventOfficials], judges, courseSpec };
}

// ---------------------------------------------------------------------------
// Shared: draw officials + course specs footer block at END of document
// ---------------------------------------------------------------------------
function drawOfficialsCourseFooter(doc, info, event) {
  const { officials, judges, courseSpec } = info;
  const startX = doc.page.margins.left;
  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  // Check if we need a new page (need ~150pt for the block)
  if (doc.y + 150 > doc.page.height - doc.page.margins.bottom) {
    addPageWithFooter(doc);
  }

  doc.moveDown(1);
  doc.moveTo(startX, doc.y).lineTo(startX + pageW, doc.y).lineWidth(0.5).stroke('#999');
  doc.moveDown(0.5);

  // 3-column layout: Judges (left), Officials (middle), Course (right)
  const colW = pageW / 3;
  const col1X = startX;
  const col2X = startX + colW;
  const col3X = startX + colW * 2;
  let y = doc.y;
  const lineH = 11;
  const fs = 7.5;
  const topY = y;

  // --- Left column: Judges ---
  const judgeRoleLabel = (role) => {
    if (/^TL\d/i.test(role)) {
      const n = role.replace(/\D/g, '');
      return `Judge ${n}(T&L)`;
    }
    if (/^Air(\d)/i.test(role)) {
      const n = parseInt(role.replace(/\D/g, ''));
      const jn = (event.num_tl_judges || 3) + n;
      return `Judge ${jn}(Air)`;
    }
    if (role === 'HJ') return 'Head Judge';
    return role;
  };

  let jy = topY;
  for (const j of judges) {
    if (j.role === 'HJ') continue;
    const label = judgeRoleLabel(j.role);
    doc.fontSize(fs).font('Helvetica-Bold').fillColor('#000')
      .text(`${label}: `, col1X, jy, { continued: true, width: colW - 4, lineBreak: false });
    doc.font('Helvetica').text(j.name || '', { lineBreak: false });
    jy += lineH;
  }

  // --- Middle column: Officials ---
  const roleMap = {
    'Head Judge': 'Head Judge',
    'Chief of Competition': 'Chief of Comp',
    'Technical Delegate': 'T.D.',
    'Chief of Score': 'Chief of Scoring',
    'Chief of Course': 'Chief of Course',
    'Chief of Start': 'Chief of Start',
    'Competition Secretary': 'Comp Secretary',
  };
  let oy = topY;
  for (const o of officials) {
    const label = roleMap[o.role] || o.role;
    doc.fontSize(fs).font('Helvetica-Bold').fillColor('#000')
      .text(`${label}: `, col2X, oy, { continued: true, width: colW - 4, lineBreak: false });
    doc.font('Helvetica').text(o.name || '', { lineBreak: false });
    oy += lineH;
  }

  // --- Right column: Course specs ---
  let ry = topY;
  if (courseSpec) {
    const specs = [];
    if (courseSpec.course_name) specs.push(['Course', courseSpec.course_name]);
    if (courseSpec.length_m != null) specs.push(['Length', `${courseSpec.length_m} m`]);
    if (courseSpec.width_m != null) specs.push(['Width', `${courseSpec.width_m} m`]);
    if (courseSpec.pitch_deg != null) specs.push(['Pitch', `${courseSpec.pitch_deg} deg`]);
    // Show pace time appropriate to event gender
    const g = (event.gender || '').toUpperCase();
    if (g === 'F') {
      const fPace = courseSpec.pace_time_override_f || event.pace_time;
      if (fPace != null) specs.push(['Pace: Female', `= ${fmtScore(fPace)}`]);
    } else if (g === 'M') {
      const mPace = courseSpec.pace_time_override_m || event.pace_time;
      if (mPace != null) specs.push(['Pace: Male', `= ${fmtScore(mPace)}`]);
    } else {
      if (courseSpec.pace_time_override_m != null || event.pace_time)
        specs.push(['Pace: Male', `= ${fmtScore(courseSpec.pace_time_override_m || event.pace_time)}`]);
      if (courseSpec.pace_time_override_f != null)
        specs.push(['Pace: Female', `= ${fmtScore(courseSpec.pace_time_override_f)}`]);
    }

    for (const [label, val] of specs) {
      doc.fontSize(fs).font('Helvetica-Bold').fillColor('#000')
        .text(`${label}: `, col3X, ry, { continued: true, width: colW - 4, lineBreak: false });
      doc.font('Helvetica').text(val, { lineBreak: false });
      ry += lineH;
    }
  } else if (event.pace_time) {
    const paceLabel = (event.gender || '').toUpperCase() === 'F' ? 'Pace: Female' : 'Pace: Male';
    doc.fontSize(fs).font('Helvetica-Bold').fillColor('#000')
      .text(`${paceLabel}: `, col3X, ry, { continued: true, width: colW - 4, lineBreak: false });
    doc.font('Helvetica').text(fmtScore(event.pace_time), { lineBreak: false });
    ry += lineH;
  }

  doc.y = Math.max(jy, oy, ry) + 8;
}

// ---------------------------------------------------------------------------
// Shared: fetch per-judge scores for all runs of a given run_number
// ---------------------------------------------------------------------------
async function fetchRunJudgeScores(eventId, runNumber) {
  const scores = await queryAll(
    `SELECT js.run_id, js.score_type, js.raw_score, j.role
     FROM judge_scores js
     JOIN judges j ON j.id = js.judge_id
     WHERE js.run_id IN (
       SELECT id FROM runs WHERE event_id=? AND run_number=?
     )
     ORDER BY js.run_id, j.role, js.score_type`,
    [eventId, runNumber]
  );

  const map = {};
  for (const s of scores) {
    if (!map[s.run_id]) map[s.run_id] = { tl: [], air1: [], air2: [] };
    const entry = map[s.run_id];
    if (s.score_type === 'turns' && /^TL/i.test(s.role)) {
      entry.tl.push(s.raw_score);
    } else if (s.score_type === 'air_jump1') {
      entry.air1.push(s.raw_score);
    } else if (s.score_type === 'air_jump2') {
      entry.air2.push(s.raw_score);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Shared: fetch ALL per-judge scores for an event (all run_numbers)
// ---------------------------------------------------------------------------
async function fetchAllJudgeScores(eventId) {
  const scores = await queryAll(
    `SELECT js.run_id, js.score_type, js.raw_score, j.role
     FROM judge_scores js
     JOIN judges j ON j.id = js.judge_id
     WHERE js.run_id IN (
       SELECT id FROM runs WHERE event_id=?
     )
     ORDER BY js.run_id, j.role, js.score_type`,
    [eventId]
  );

  const map = {};
  for (const s of scores) {
    if (!map[s.run_id]) map[s.run_id] = { tl: [], air1: [], air2: [] };
    const entry = map[s.run_id];
    if (s.score_type === 'turns' && /^TL/i.test(s.role)) {
      entry.tl.push(s.raw_score);
    } else if (s.score_type === 'air_jump1') {
      entry.air1.push(s.raw_score);
    } else if (s.score_type === 'air_jump2') {
      entry.air2.push(s.raw_score);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Shared: draw Winfree-style detailed results table (2 lines per athlete)
// Landscape layout with per-judge T&L, per-jump air, time, speed, total
// ---------------------------------------------------------------------------
function drawDetailedResultsTable(doc, rows, judgeScoresMap, opts = {}) {
  const startX = doc.page.margins.left;
  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const rowH = 10;
  const fs = 6.5;
  const hdrFs = 6;
  const showEvent = opts.showEventCol || false;
  const ev = opts.event || {};
  const numTL = ev.num_tl_judges || 3;
  const numAir = ev.num_air_judges || 2;
  const numJumps = ev.num_jumps || 2;
  const hasSpeed = ev.has_speed !== undefined ? !!ev.has_speed : true;
  const isReducedPanel = numTL < 3;

  // Column definitions: Comp Series (3 TL, 2 Air) vs Devo/RQS (2 TL, 1 Air)
  let cols, tlGroupStart, tlGroupEnd, airGroupStart, airGroupEnd;
  // Column name constants for value mapping
  let colMap;

  if (isReducedPanel) {
    // Devo / RQS layout: J.1, J.2 (TL), J.3 (Air), Jumps, DofD, Judge, Time, Pts, Run
    cols = [
      { header: 'No', w: 18, align: 'right' },
      { header: 'Bib', w: 22, align: 'right' },
      { header: 'Gp', w: 20, align: 'left' },
      { header: 'Name', w: 90, align: 'left' },
      { header: 'Rep', w: 65, align: 'left' },
      { header: 'J.1', w: 30, align: 'right' },
      { header: 'J.2', w: 30, align: 'right' },
      { header: 'J.3', w: 30, align: 'right' },
      { header: 'Jumps', w: 32, align: 'left' },
      { header: 'DofD', w: 30, align: 'right' },
      { header: 'Judge', w: 36, align: 'right' },
      { header: 'Time', w: 36, align: 'right' },
      { header: 'Pts', w: 30, align: 'right' },
      { header: 'Run', w: 34, align: 'right' },
    ];
    if (showEvent) cols.push({ header: 'Event', w: 34, align: 'right' });
    tlGroupStart = 5; tlGroupEnd = 6;   // J.1 .. J.2
    airGroupStart = 7; airGroupEnd = 9;  // J.3 .. DofD
    colMap = 'reduced';
  } else {
    // Comp Series layout (unchanged)
    cols = [
      { header: 'No', w: 18, align: 'right' },
      { header: 'Bib', w: 22, align: 'right' },
      { header: 'Gp', w: 20, align: 'left' },
      { header: 'Name', w: 82, align: 'left' },
      { header: 'Rep', w: 55, align: 'left' },
      { header: 'J.1', w: 28, align: 'right' },
      { header: 'J.2', w: 28, align: 'right' },
      { header: 'J.3', w: 28, align: 'right' },
      { header: 'T&L', w: 30, align: 'right' },
      { header: 'J.4', w: 22, align: 'right' },
      { header: 'J.5', w: 22, align: 'right' },
      { header: 'Jumps', w: 28, align: 'left' },
      { header: 'DofD', w: 28, align: 'right' },
      { header: 'Airs', w: 28, align: 'right' },
      { header: 'Judge', w: 32, align: 'right' },
      { header: 'Time', w: 34, align: 'right' },
      { header: 'Pts', w: 28, align: 'right' },
      { header: 'Run', w: 30, align: 'right' },
    ];
    if (showEvent) cols.push({ header: 'Event', w: 32, align: 'right' });
    tlGroupStart = 5; tlGroupEnd = 8;    // J.1 .. T&L
    airGroupStart = 9; airGroupEnd = 13;  // J.4 .. Airs
    colMap = 'standard';
  }

  // Scale columns to fit page width
  const totalW = cols.reduce((s, c) => s + c.w, 0);
  const scale = pageW / totalW;
  const colWidths = cols.map(c => c.w * scale);
  const colXs = [];
  let cx = startX;
  for (const w of colWidths) { colXs.push(cx); cx += w; }

  // For reduced panel: single-line rows when num_jumps===1, 2-line when num_jumps>=2
  const linesPerRow = (isReducedPanel && numJumps === 1) ? 1 : 2;

  // --- Draw header ---
  function drawHeader() {
    // Two-row header matching Winfree: "T&L-->" and "Air-->" labels
    const headerH = rowH * 2 + 2;
    doc.save();
    doc.rect(startX, doc.y, pageW, headerH).fill('#1B3A5C');
    doc.fillColor('#fff').fontSize(hdrFs).font('Helvetica-Bold');

    // Top header row: group labels
    const topY = doc.y + 2;
    const tlStart = colXs[tlGroupStart];
    const tlEnd = colXs[tlGroupEnd] + colWidths[tlGroupEnd];
    doc.text('T&L-->', tlStart + 2, topY, { width: tlEnd - tlStart - 4, align: 'center', lineBreak: false });
    const airStart = colXs[airGroupStart];
    const airEnd = colXs[airGroupEnd] + colWidths[airGroupEnd];
    doc.text('Air-->', airStart + 2, topY, { width: airEnd - airStart - 4, align: 'center', lineBreak: false });

    // Bottom header row: column names
    const botY = topY + rowH;
    cols.forEach((c, i) => {
      doc.text(c.header, colXs[i] + 2, botY, { width: colWidths[i] - 4, align: c.align || 'left', lineBreak: false });
    });

    // Separator lines under column groups
    doc.moveTo(tlStart, botY - 1).lineTo(tlEnd, botY - 1).strokeColor('#666').lineWidth(0.3).stroke();
    doc.moveTo(airStart, botY - 1).lineTo(airEnd, botY - 1).strokeColor('#666').lineWidth(0.3).stroke();

    doc.y = botY + rowH;
    doc.restore();
    doc.fillColor('#000');
  }

  drawHeader();

  // --- Draw data rows ---
  rows.forEach((r, ri) => {
    const groupH = rowH * linesPerRow;
    // Page break check
    if (doc.y + groupH > doc.page.height - doc.page.margins.bottom - 20) {
      addPageWithFooter(doc);
      drawHeader();
    }

    const js = judgeScoresMap[r.id] || { tl: [], air1: [], air2: [] };
    const baseY = doc.y;

    // Alternating shading per athlete group
    if (ri % 2 === 0) {
      doc.save();
      doc.rect(startX, baseY, pageW, groupH).fill('#f5f5f5');
      doc.restore();
      doc.fillColor('#000');
    }

    // --- Line 1: main scores ---
    const y1 = baseY + 1;
    doc.fontSize(fs).font('Helvetica');

    let vals1;
    if (colMap === 'reduced') {
      const judgeTotal = r.turns_score != null && r.air_score != null ? (r.turns_score + r.air_score) : null;
      vals1 = [
        r.run_status || r.rank || '',
        r.bib_number || '',
        r.gp || '',
        `${(r.last_name || '').toUpperCase()},${r.first_name || ''}`,
        (r.club || '').substring(0, 12),
        js.tl[0] != null ? js.tl[0].toFixed(1) : '',          // J.1 (TL1)
        js.tl[1] != null ? js.tl[1].toFixed(1) : '',          // J.2 (TL2)
        js.air1[0] != null ? js.air1[0].toFixed(1) : '',      // J.3 (Air jump1)
        r.jump1_code || '',                                     // Jumps
        r.jump1_dd != null ? r.jump1_dd.toFixed(3) : '',       // DofD
        judgeTotal != null ? judgeTotal.toFixed(2) : '',        // Judge
        hasSpeed && r.run_time != null ? (r.run_time == -1 ? 'NT' : r.run_time.toFixed(2)) : (!hasSpeed ? '' : (r.run_status || '')), // Time
        hasSpeed && r.speed_score != null ? r.speed_score.toFixed(2) : (!hasSpeed ? '' : ''), // Pts
        r.total_score != null ? r.total_score.toFixed(2) : (r.run_status || ''), // Run
      ];
      if (showEvent) vals1.push(r.event_score != null ? r.event_score.toFixed(2) : '');
    } else {
      vals1 = [
        r.run_status || r.rank || '',           // No
        r.bib_number || '',                      // Bib
        r.gp || '',                              // Gp
        `${(r.last_name || '').toUpperCase()},${r.first_name || ''}`, // Name
        (r.club || '').substring(0, 10),         // Rep (truncated)
        js.tl[0] != null ? js.tl[0].toFixed(1) : '',  // J.1
        js.tl[1] != null ? js.tl[1].toFixed(1) : '',  // J.2
        js.tl[2] != null ? js.tl[2].toFixed(1) : '',  // J.3
        r.turns_score != null ? r.turns_score.toFixed(1) : '', // T&L
        js.air1[0] != null ? js.air1[0].toFixed(1) : '', // J.4 jump1
        js.air1[1] != null ? js.air1[1].toFixed(1) : '', // J.5 jump1
        r.jump1_code || '',                      // Jump1 code
        r.jump1_dd != null ? r.jump1_dd.toFixed(3) : '', // DofD jump1
        r.air_score != null ? r.air_score.toFixed(2) : '', // Airs total
        r.turns_score != null && r.air_score != null ? (r.turns_score + r.air_score).toFixed(2) : '', // Judge total
        r.run_time != null ? (r.run_time == -1 ? 'NT' : r.run_time.toFixed(2)) : (r.run_status || ''),  // Time
        r.speed_score != null ? r.speed_score.toFixed(2) : '',  // Pts
        r.total_score != null ? r.total_score.toFixed(2) : (r.run_status || ''), // Run total
      ];
      if (showEvent) vals1.push(r.event_score != null ? r.event_score.toFixed(2) : '');
    }

    vals1.forEach((v, i) => {
      if (i === 2) doc.font('Helvetica-Bold');
      doc.text(String(v), colXs[i] + 2, y1, { width: colWidths[i] - 4, align: cols[i].align, lineBreak: false });
      if (i === 2) doc.font('Helvetica');
    });

    // --- Line 2: second jump details (only for 2-line layouts) ---
    if (linesPerRow >= 2) {
      const y2 = baseY + rowH + 1;
      const vals2 = new Array(cols.length).fill('');
      if (colMap === 'reduced') {
        // Reduced panel line 2: air jump2 in J.3, jump2 code in Jumps, jump2 dd in DofD
        vals2[7] = js.air1[0] != null && numJumps >= 2 ? (js.air2 && js.air2[0] != null ? js.air2[0].toFixed(1) : '') : '';
        if (numJumps >= 2) {
          vals2[7] = js.air2 && js.air2[0] != null ? js.air2[0].toFixed(1) : '';
          vals2[8] = r.jump2_code || '';
          vals2[9] = r.jump2_dd != null ? r.jump2_dd.toFixed(3) : '';
        }
      } else {
        // Comp Series line 2: J.4 jump2, J.5 jump2, jump2 code, jump2 dd
        vals2[9] = js.air2[0] != null ? js.air2[0].toFixed(1) : '';   // J.4 jump2
        vals2[10] = js.air2[1] != null ? js.air2[1].toFixed(1) : '';  // J.5 jump2
        vals2[11] = r.jump2_code || '';                                // Jump2 code
        vals2[12] = r.jump2_dd != null ? r.jump2_dd.toFixed(3) : '';   // Jump2 DD
      }

      vals2.forEach((v, i) => {
        if (v) doc.text(String(v), colXs[i] + 2, y2, { width: colWidths[i] - 4, align: cols[i].align, lineBreak: false });
      });
    }

    doc.y = baseY + groupH;
  });

  // Bottom line
  doc.moveTo(startX, doc.y).lineTo(startX + pageW, doc.y).lineWidth(0.5).stroke('#ccc');
}

// ---------------------------------------------------------------------------
// Shared: Winfree-style sub-header (event type, round, location, event name)
// ---------------------------------------------------------------------------
function drawWinfreeSubHeader(doc, meet, event, reportType, sortLabel, runNumber) {
  const startX = doc.page.margins.left;
  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.moveTo(startX, doc.y).lineTo(startX + pageW, doc.y).lineWidth(0.5).stroke('#999');
  doc.moveDown(0.3);

  const disc = event.discipline || 'mogul';
  const discipline = disc === 'dual_mogul' ? 'Dual Moguls' : disc.charAt(0).toUpperCase() + disc.slice(1) + 's';
  const runLabel = runNumber === 'final' ? `${discipline} Final Results` : runNumber ? `${discipline} Run ${runNumber}` : discipline;
  const genderLabel = normalizeGender(event.gender) === 'F' ? 'Female' : normalizeGender(event.gender) === 'M' ? 'Male' : 'Female/Male';
  const now = new Date();
  const dateStr = `Date: ${now.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}`;
  const timeStr = `Time: ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;

  const cw = pageW / 3; // equal thirds for proper centering

  const y = doc.y;
  doc.fontSize(7.5).font('Helvetica').fillColor('#000');
  doc.text(runLabel, startX, y, { width: cw, lineBreak: false });
  doc.text(reportType, startX + cw, y, { width: cw, align: 'center', lineBreak: false });
  doc.text('Report Created', startX + cw * 2, y, { width: cw, align: 'right', lineBreak: false });

  const y2 = y + 10;
  doc.text(genderLabel, startX, y2, { width: cw, lineBreak: false });
  if (sortLabel) {
    doc.font('Helvetica-Bold').text(sortLabel, startX + cw, y2, { width: cw, align: 'center', lineBreak: false });
    doc.font('Helvetica');
  }
  doc.text(dateStr, startX + cw * 2, y2, { width: cw, align: 'right', lineBreak: false });

  const y3 = y2 + 10;
  doc.text(meet?.location || '', startX, y3, { width: cw, lineBreak: false });
  doc.text(event.name || '', startX + cw, y3, { width: cw, align: 'center', lineBreak: false });
  doc.text(timeStr, startX + cw * 2, y3, { width: cw, align: 'right', lineBreak: false });

  doc.y = y3 + 12;
  doc.moveTo(startX, doc.y).lineTo(startX + pageW, doc.y).lineWidth(0.5).stroke('#999');
  doc.moveDown(0.5);
}

// ---------------------------------------------------------------------------
// Shared: fetch event + meet
// ---------------------------------------------------------------------------
async function fetchEventMeet(eventId) {
  const event = await queryOne('SELECT * FROM events WHERE id=?', [eventId]);
  if (!event) throw new Error('Event not found');
  const meet = await queryOne('SELECT * FROM meets WHERE id=?', [event.meet_id]);
  return { event, meet };
}

// ---------------------------------------------------------------------------
// Shared: fetch registered (non-scratched) athletes with run_order and scores
// ---------------------------------------------------------------------------
async function fetchAthletes(eventId, round) {
  // v1.9.00: Check for phases and use phase_run_order when available
  const phases = await queryAll(
    `SELECT * FROM event_phases WHERE event_id=? ORDER BY sequence_order`, [eventId]
  );
  // If phases exist, find the active/first phase and use its run_order
  let phaseOrderMap = null;
  if (phases.length > 0) {
    const activePhase = phases.find(p => p.status === 'in_progress' || p.status === 'not_started') || phases[0];
    const phaseOrders = await queryAll(
      `SELECT registration_id, run_order FROM phase_run_order WHERE phase_id=?`, [activePhase.id]
    );
    phaseOrderMap = {};
    for (const po of phaseOrders) phaseOrderMap[po.registration_id] = po.run_order;
  }

  const regs = await queryAll(
    `SELECT reg.id as registration_id, reg.bib_number, reg.seed, reg.run_order, reg.status as reg_status,
            a.id as athlete_id, a.first_name, a.last_name, a.ussa_num, a.fis_id,
            a.club, a.nation, a.birth_year, a.gender
     FROM registrations reg
     JOIN athletes a ON a.id = reg.athlete_id
     WHERE reg.event_id=? AND reg.status != 'scratched'
     ORDER BY reg.run_order ASC, reg.bib_number ASC`,
    [eventId]
  );

  let scoresMap = {};
  if (round) {
    const runs = await queryAll(
      `SELECT r.*, reg.bib_number
       FROM runs r
       JOIN registrations reg ON reg.id = r.registration_id
       WHERE r.event_id=? AND r.round=?`,
      [eventId, round]
    );
    for (const r of runs) {
      const prev = scoresMap[r.registration_id];
      if (!prev || (r.total_score || 0) > (prev.total_score || 0)) {
        scoresMap[r.registration_id] = r;
      }
    }
  }

  return regs.map(reg => {
    const run = scoresMap[reg.registration_id] || {};
    return {
      ...reg,
      turns_score: run.turns_score != null ? run.turns_score : null,
      air_score:   run.air_score   != null ? run.air_score   : null,
      speed_score: run.speed_score != null ? run.speed_score : null,
      total_score: run.total_score != null ? run.total_score : null,
      run_time:    run.run_time    != null ? run.run_time    : null,
      deduction:   run.deduction   != null ? run.deduction   : null,
      jump1_dd:    run.jump1_dd    != null ? run.jump1_dd    : null,
      jump2_dd:    run.jump2_dd    != null ? run.jump2_dd    : null,
      run_status:  run.run_status  != null ? run.run_status  : null,
      start_num:   phaseOrderMap ? (phaseOrderMap[reg.registration_id] || reg.run_order) : reg.run_order,
      run_order:   phaseOrderMap ? (phaseOrderMap[reg.registration_id] || reg.run_order) : reg.run_order,
    };
  });
}

// ---------------------------------------------------------------------------
// Shared: fetch athletes with scores by run_number (int) instead of round
// ---------------------------------------------------------------------------
async function fetchAthletesByRunNumber(eventId, runNumber) {
  const regs = await queryAll(
    `SELECT reg.id as registration_id, reg.bib_number, reg.seed, reg.run_order, reg.status as reg_status,
            a.id as athlete_id, a.first_name, a.last_name, a.ussa_num, a.fis_id,
            a.club, a.nation, a.birth_year, a.gender
     FROM registrations reg
     JOIN athletes a ON a.id = reg.athlete_id
     WHERE reg.event_id=? AND reg.status != 'scratched'
     ORDER BY reg.run_order ASC, reg.bib_number ASC`,
    [eventId]
  );

  const runs = await queryAll(
    `SELECT r.* FROM runs r WHERE r.event_id=? AND r.run_number=?`,
    [eventId, runNumber]
  );
  const scoresMap = {};
  for (const r of runs) {
    const prev = scoresMap[r.registration_id];
    if (!prev || (r.total_score || 0) > (prev.total_score || 0)) {
      scoresMap[r.registration_id] = r;
    }
  }

  return regs.map(reg => {
    const run = scoresMap[reg.registration_id] || {};
    return {
      ...reg,
      run_id:      run.id          ?? null,
      turns_score: run.turns_score ?? null,
      air_score:   run.air_score   ?? null,
      speed_score: run.speed_score ?? null,
      total_score: run.total_score ?? null,
      run_time:    run.run_time    ?? null,
      deduction:   run.deduction   ?? null,
      jump1_dd:    run.jump1_dd    ?? null,
      jump2_dd:    run.jump2_dd    ?? null,
      jump1_code:  run.jump1_code  ?? null,
      jump2_code:  run.jump2_code  ?? null,
      run_status:  run.run_status  ?? null,
      start_num:   reg.run_order,
    };
  });
}

// ---------------------------------------------------------------------------
// Shared: build ranked results with component data
// ---------------------------------------------------------------------------
async function buildResultsData(eventId, round) {
  const { event, meet } = await fetchEventMeet(eventId);

  // v1.9.00: Phase-aware results
  const phases = await queryAll(
    `SELECT * FROM event_phases WHERE event_id=? ORDER BY sequence_order`, [eventId]
  );

  if (phases.length > 0) {
    const types = phases.map(p => p.phase_type);
    const isBestOf2 = types.includes('best_of_2');
    const isQualFinals = types.includes('final_1') || types.includes('final_2') || types.includes('qualifier_2');

    const runQuery = (runNumbers) => {
      const ph = runNumbers.map(() => '?').join(',');
      return queryAll(
        `SELECT r.*, reg.bib_number, reg.seed, a.first_name, a.last_name,
                a.ussa_num, a.club, a.birth_year, a.gender
         FROM runs r
         JOIN registrations reg ON reg.id = r.registration_id
         JOIN athletes a ON a.id = reg.athlete_id
         WHERE r.event_id = ? AND r.run_number IN (${ph}) AND r.status = 'complete' AND r.run_status IS NULL
         ORDER BY r.total_score DESC`,
        [eventId, ...runNumbers]
      );
    };

    let results;
    let phaseLabel = 'Results';

    if (isBestOf2) {
      const runNumbers = phases.map(p => p.run_number);
      const runs = await runQuery(runNumbers);
      const best = pickBestRun(runs, event.discipline);
      results = rankResults(Object.values(best), event.discipline);
      phaseLabel = 'Best of 2 Results';
    } else if (isQualFinals) {
      const f2 = phases.find(p => p.phase_type === 'final_2');
      const f1 = phases.find(p => p.phase_type === 'final_1');
      const qualRunNumbers = phases.filter(p => p.phase_type === 'run' || p.phase_type === 'qualifier_2').map(p => p.run_number);
      const tiers = [];
      let globalRank = 1;
      const rankedIds = new Set();

      if (f2 && f2.status === 'finalized') {
        const runs = await runQuery([f2.run_number]);
        const f2Tier = rankResults(runs, event.discipline);
        globalRank = applyTierRanks(f2Tier, event.discipline, globalRank);
        for (const r of f2Tier) { tiers.push(r); rankedIds.add(r.registration_id); }
      }
      if (f1) {
        const runs = await runQuery([f1.run_number]);
        const f1Tier = rankResults(runs, event.discipline).filter(r => !rankedIds.has(r.registration_id));
        globalRank = applyTierRanks(f1Tier, event.discipline, globalRank);
        for (const r of f1Tier) { tiers.push(r); rankedIds.add(r.registration_id); }
      }
      if (qualRunNumbers.length > 0) {
        const runs = await runQuery(qualRunNumbers);
        const best = pickBestRun(runs, event.discipline);
        const qTier = rankResults(Object.values(best), event.discipline).filter(r => !rankedIds.has(r.registration_id));
        globalRank = applyTierRanks(qTier, event.discipline, globalRank);
        for (const r of qTier) { tiers.push(r); rankedIds.add(r.registration_id); }
      }
      results = tiers;
      phaseLabel = 'Overall Results';
    } else {
      const runs = await runQuery([1]);
      results = rankResults(runs, event.discipline);
    }

    return { meet, event, round: phaseLabel, is_final: event.status === 'complete', results };
  }

  // Legacy: no phases
  const runs = await queryAll(
    `SELECT r.*, reg.bib_number, reg.seed, a.first_name, a.last_name,
            a.ussa_num, a.club, a.birth_year, a.gender
     FROM runs r
     JOIN registrations reg ON reg.id = r.registration_id
     JOIN athletes a ON a.id = reg.athlete_id
     WHERE r.event_id=? AND r.round=? AND r.status='complete'`,
    [eventId, round]
  );

  const best = pickBestRun(runs, event.discipline);

  return {
    meet,
    event,
    round,
    is_final: event.status === 'complete',
    results:  rankResults(Object.values(best), event.discipline),
  };
}

// ---------------------------------------------------------------------------
// Safe filename helper
// ---------------------------------------------------------------------------
function safeFilename(event, suffix) {
  const name = (event.name || 'event').replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '');
  return `${name}_${suffix}.pdf`;
}

// ===========================================================================
// GET /api/pdf/results/:eventId  (legacy -- keep for backward compatibility)
// ===========================================================================
router.get('/results/:eventId', async (req, res) => {
  try {
    const { round = 'qualification' } = req.query;
    const data = await buildResultsData(req.params.eventId, round);
    generateResultsPdf(res, data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===========================================================================
// POST /api/pdf/results  -- enhanced results with component breakdown
// ===========================================================================
router.post('/results', async (req, res) => {
  try {
    const { eventId, options = {} } = req.body;
    const round = options.round || 'qualification';
    const data  = await buildResultsData(eventId, round);
    generateResultsPdf(res, data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function generateResultsPdf(res, data) {
  const { meet, event, results, round } = data;
  const isAerials = event.discipline === 'aerials';
  const roundLabel = (round || 'qualification').replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 36, bottom: 36, left: 36, right: 36 } });
  streamPdf(res, doc, safeFilename(event, `results_${round}`));

  pdfHeader(doc, meet, event, `${roundLabel} Results`);

  // Pace time info / aerials panel info
  if (isAerials && event.aerials_panel_size) {
    // v1.18.00 — aerials v2 calculation header
    const eventTypeLabel = ({
      fis_major: 'FIS OWG/WSC/WC',
      fis_nac: 'FIS NAC/NorAm',
      fis_other: 'FIS Other',
      usa_national: 'USA National',
      usa_regional: 'USA Regional',
    })[event.event_type] || event.event_type || 'USA Regional';
    const reduction = event.aerials_panel_size <= 4
      ? `Reduction: ${event.aerials_reduction_method || 'sum_all'}`
      : 'Drop H/L per component';
    doc.fontSize(8).fillColor('#666').text(`${eventTypeLabel} | ${event.aerials_panel_size} scoring judges | ${reduction} | Truncated to 2dp`, { align: 'center' });
    doc.fillColor('#000').moveDown(0.3);
  } else if (event.pace_time) {
    const paceGenderLabel = (event.gender || '').toUpperCase() === 'F' ? 'Female' : 'Male';
    doc.fontSize(8).fillColor('#666').text(`Pace Time (${paceGenderLabel}): ${fmtScore(event.pace_time)}s | T&L Judges: ${event.num_tl_judges} | Air Judges: ${event.num_air_judges}`, { align: 'center' });
    doc.fillColor('#000').moveDown(0.3);
  }

  // Enrich with age group
  for (const r of results) r.gp = (r.gender || '').charAt(0).toUpperCase() + computeAgeGroup(r.birth_year, meet?.date);

  const columns = [
    { header: 'Place', width: 0.6, value: r => r.run_status || r.rank, bold: true },
    { header: 'Bib', width: 0.5, value: r => r.bib_number || '' },
    { header: 'Gp', width: 0.4, value: r => r.gp || '' },
    { header: 'Athlete', width: 2.5, value: r => `${r.last_name}, ${r.first_name}`, bold: true },
    { header: 'Club', width: 1.2, value: r => r.club || '' },
    { header: 'USSA #', width: 1.2, value: r => r.ussa_num || '' },
    { header: isAerials ? 'Form' : 'Turns', width: 0.8, align: 'right', value: r => fmtScore(r.turns_score) },
    { header: 'Air', width: 0.8, align: 'right', value: r => fmtScore(r.air_score) },
  ];
  if (!isAerials) {
    columns.push({ header: 'Time', width: 0.8, align: 'right', value: r => fmtTime(r.run_time) });
  }
  columns.push(
    { header: isAerials ? 'Landing' : 'Speed', width: 0.8, align: 'right', value: r => fmtScore(r.speed_score) },
    { header: 'Total', width: 0.8, align: 'right', value: r => r.run_status || fmtScore(r.total_score), bold: true },
    { header: 'Jumps', width: 1.5, value: r => [r.jump1_code, r.jump2_code].filter(Boolean).join(' / ') || '' },
  );

  drawTable(doc, columns, results);
  stampFooter(doc);
  doc.end();
}

// ===========================================================================
// POST /api/pdf/run-order — Compact 3-column Winfree-style entrants list
// ===========================================================================
router.post('/run-order', async (req, res) => {
  try {
    const { eventId, options = {} } = req.body;
    const { event, meet } = await fetchEventMeet(eventId);
    const athletes = await fetchAthletes(eventId, null);
    const isAlpha = options.sort === 'alpha';
    let sorted;
    if (isAlpha) {
      sorted = [...athletes].sort((a, b) => (a.last_name || '').localeCompare(b.last_name || '') || (a.first_name || '').localeCompare(b.first_name || ''));
    } else {
      sorted = [...athletes].sort((a, b) => (parseInt(a.run_order) || 999) - (parseInt(b.run_order) || 999));
    }

    // Enrich with age group
    for (const a of sorted) a.gp = (a.gender || '').charAt(0).toUpperCase() + computeAgeGroup(a.birth_year, meet?.date);

    const sortLabel = isAlpha ? 'Alphabetical' : 'By Moguls Run-order';
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 36, bottom: 36, left: 36, right: 36 } });
    streamPdf(res, doc, safeFilename(event, 'run_order'));
    pdfHeader(doc, meet, event, 'Entrants');
    drawWinfreeSubHeader(doc, meet, event, 'Entrants', sortLabel, options.runNumber || 1);

    // 3-column compact layout
    const startX = doc.page.margins.left;
    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colCount = 3;
    const colW = pageW / colCount;
    const rowH = 11;
    const fs = 6.5;
    const hdrFs = 6;

    // Sub-columns: Ord (if not alpha), Bib, Gp, Name, Rep
    const subCols = isAlpha ? [
      { header: 'Bib', w: 0.12, align: 'right' },
      { header: 'Gp', w: 0.12, align: 'left' },
      { header: 'Name', w: 0.40, align: 'left' },
      { header: 'Rep', w: 0.36, align: 'left' },
    ] : [
      { header: 'Ord', w: 0.10, align: 'right' },
      { header: 'Bib', w: 0.10, align: 'right' },
      { header: 'Gp', w: 0.10, align: 'left' },
      { header: 'Name', w: 0.34, align: 'left' },
      { header: 'Rep', w: 0.36, align: 'left' },
    ];

    // Calculate rows per page column
    const headerTopY = doc.y;
    const availH = doc.page.height - doc.page.margins.bottom - 20 - headerTopY;
    const rowsPerCol = Math.floor((availH - rowH) / rowH); // subtract header row

    // Split athletes into pages
    const athletesPerPage = rowsPerCol * colCount;
    const totalPages = Math.ceil(sorted.length / athletesPerPage);

    for (let page = 0; page < totalPages; page++) {
      if (page > 0) {
        addPageWithFooter(doc);
        pdfHeader(doc, meet, event, 'Entrants');
        drawWinfreeSubHeader(doc, meet, event, 'Entrants', sortLabel, options.runNumber || 1);
      }

      const pageStart = page * athletesPerPage;
      const pageAthletes = sorted.slice(pageStart, pageStart + athletesPerPage);

      for (let col = 0; col < colCount; col++) {
        const colStart = col * rowsPerCol;
        const colAthletes = pageAthletes.slice(colStart, colStart + rowsPerCol);
        if (!colAthletes.length) continue;

        const cx = startX + col * colW;
        let cy = doc.y;

        // Column header
        doc.save();
        doc.rect(cx, cy, colW - 2, rowH).fill('#1B3A5C');
        doc.fillColor('#fff').fontSize(hdrFs).font('Helvetica-Bold');
        let sx = cx;
        for (const sc of subCols) {
          const sw = (colW - 2) * sc.w;
          doc.text(sc.header, sx + 1, cy + 2, { width: sw - 2, align: sc.align, lineBreak: false });
          sx += sw;
        }
        doc.restore();
        doc.fillColor('#000');
        cy += rowH;

        // Data rows
        colAthletes.forEach((a, ri) => {
          if (ri % 2 === 0) {
            doc.save();
            doc.rect(cx, cy, colW - 2, rowH).fill('#f5f5f5');
            doc.restore();
            doc.fillColor('#000');
          }

          doc.fontSize(fs).font('Helvetica');
          const vals = isAlpha ? [
            a.bib_number || '',
            a.gp || '',
            `${(a.last_name || '').toUpperCase()},${a.first_name || ''}`,
            (a.club || '').substring(0, 8),
          ] : [
            a.run_order || '',
            a.bib_number || '',
            a.gp || '',
            `${(a.last_name || '').toUpperCase()},${a.first_name || ''}`,
            (a.club || '').substring(0, 8),
          ];
          let sx = cx;
          vals.forEach((v, i) => {
            const sw = (colW - 2) * subCols[i].w;
            doc.text(String(v), sx + 1, cy + 2, { width: sw - 2, align: subCols[i].align, lineBreak: false });
            sx += sw;
          });
          cy += rowH;
        });
      }
    }

    // Athlete count at bottom
    doc.moveDown(1);
    doc.fontSize(7).fillColor('#666')
      .text(`Male = ${sorted.filter(a => (a.gender||'').toUpperCase() === 'M').length}, Female = ${sorted.filter(a => (a.gender||'').toUpperCase() === 'F').length}`,
        { align: 'left' });

    stampFooter(doc);
    doc.end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Keep start-list as alias for backward compatibility
router.post('/start-list', async (req, res) => {
  req.url = '/run-order';
  router.handle(req, res);
});

// ===========================================================================
// POST /api/pdf/phase-run-order — Run order for a specific phase
// ===========================================================================
router.post('/phase-run-order', async (req, res) => {
  try {
    const { eventId, phaseId } = req.body;
    if (!eventId || !phaseId) return res.status(400).json({ error: 'eventId and phaseId required' });

    const { event, meet } = await fetchEventMeet(eventId);
    const phase = await queryOne('SELECT * FROM event_phases WHERE id=? AND event_id=?', [phaseId, eventId]);
    if (!phase) return res.status(404).json({ error: 'Phase not found' });

    const athletes = await queryAll(
      `SELECT pro.run_order, reg.bib_number, reg.seed,
              a.first_name, a.last_name, a.ussa_num, a.fis_id,
              a.club, a.nation, a.birth_year
       FROM phase_run_order pro
       JOIN registrations reg ON reg.id = pro.registration_id
       JOIN athletes a ON a.id = reg.athlete_id
       WHERE pro.phase_id = ?
       ORDER BY pro.run_order ASC`,
      [phaseId]
    );

    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 36, bottom: 36, left: 36, right: 36 } });
    streamPdf(res, doc, safeFilename(event, `${phase.label.replace(/\s+/g, '_')}_run_order`));
    pdfHeader(doc, meet, event, `${phase.label} — Run Order`);

    doc.fontSize(8).fillColor('#666').text(`${athletes.length} athletes`, { align: 'center' });
    doc.fillColor('#000').moveDown(0.3);

    // Enrich with age group
    for (const a of athletes) a.gp = (a.gender || '').charAt(0).toUpperCase() + computeAgeGroup(a.birth_year, meet?.date);

    drawTable(doc, [
      { header: 'Order', width: 0.5, value: r => r.run_order || '' },
      { header: 'Bib', width: 0.5, value: r => r.bib_number || '', bold: true },
      { header: 'Gp', width: 0.4, value: r => r.gp || '' },
      { header: 'Athlete', width: 2.5, value: r => `${r.last_name}, ${r.first_name}`, bold: true },
      { header: 'Club', width: 2.6, value: r => r.club || '' },
      { header: 'YOB', width: 0.5, value: r => r.birth_year || '' },
    ], athletes);
    stampFooter(doc);
    doc.end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===========================================================================
// POST /api/pdf/check-bib
// ===========================================================================
router.post('/check-bib', async (req, res) => {
  try {
    const { eventId, options = {} } = req.body;
    const runNumber = options.runNumber || 1;
    const { event, meet } = await fetchEventMeet(eventId);
    const athletes = await fetchAthletesByRunNumber(eventId, runNumber);
    const sorted = [...athletes].sort((a, b) => (parseInt(a.bib_number) || 999) - (parseInt(b.bib_number) || 999));

    // Enrich with age group
    for (const a of sorted) a.gp = (a.gender || '').charAt(0).toUpperCase() + computeAgeGroup(a.birth_year, meet?.date);

    // Fetch per-judge scores
    const judgeScores = await fetchRunJudgeScores(eventId, runNumber);

    const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margins: { top: 36, bottom: 36, left: 28, right: 28 } });
    streamPdf(res, doc, safeFilename(event, 'check_bib'));
    pdfHeader(doc, meet, event, 'Check Sheet (by Bib)');
    drawWinfreeSubHeader(doc, meet, event, 'Check Sheet', 'By Bib', runNumber);

    const bibCols = [
      { header: 'Bib', width: 0.4, value: r => r.bib_number || '', bold: true },
      { header: 'Gp', width: 0.3, value: r => r.gp || '' },
      { header: 'Athlete', width: 1.6, value: r => `${r.last_name}, ${r.first_name}` },
      { header: 'TL1', width: 0.5, align: 'right', value: r => { const js = judgeScores[r.run_id]; return js && js.tl[0] != null ? js.tl[0].toFixed(1) : ''; } },
      { header: 'TL2', width: 0.5, align: 'right', value: r => { const js = judgeScores[r.run_id]; return js && js.tl[1] != null ? js.tl[1].toFixed(1) : ''; } },
      { header: 'TL3', width: 0.5, align: 'right', value: r => { const js = judgeScores[r.run_id]; return js && js.tl[2] != null ? js.tl[2].toFixed(1) : ''; } },
      { header: 'Air 1', width: 0.5, align: 'right', value: r => { const js = judgeScores[r.run_id]; return js && js.air1[0] != null ? js.air1[0].toFixed(1) : ''; } },
      { header: 'Air 2', width: 0.5, align: 'right', value: r => { const js = judgeScores[r.run_id]; return js && js.air2[0] != null ? js.air2[0].toFixed(1) : ''; } },
      { header: 'Jumps', width: 0.7, value: r => [r.jump1_code, r.jump2_code].filter(Boolean).join('/') },
      { header: 'Speed', width: 0.5, align: 'right', value: r => fmtScore(r.speed_score) },
      { header: 'Total', width: 0.6, align: 'right', value: r => r.run_status || fmtScore(r.total_score), bold: true },
      { header: 'Status', width: 0.5, value: r => r.run_status || '' },
    ];
    drawTable(doc, bibCols, sorted);
    stampFooter(doc);
    doc.end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===========================================================================
// POST /api/pdf/check-order
// ===========================================================================
router.post('/check-order', async (req, res) => {
  try {
    const { eventId, options = {} } = req.body;
    const runNumber = options.runNumber || 1;
    const { event, meet } = await fetchEventMeet(eventId);
    const athletes = await fetchAthletesByRunNumber(eventId, runNumber);
    const sorted = [...athletes].sort((a, b) => (parseInt(a.run_order) || 999) - (parseInt(b.run_order) || 999));

    // Enrich with age group
    for (const a of sorted) a.gp = (a.gender || '').charAt(0).toUpperCase() + computeAgeGroup(a.birth_year, meet?.date);

    // Fetch per-judge scores
    const judgeScores = await fetchRunJudgeScores(eventId, runNumber);

    const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margins: { top: 36, bottom: 36, left: 28, right: 28 } });
    streamPdf(res, doc, safeFilename(event, 'check_order'));
    pdfHeader(doc, meet, event, 'Check Sheet (by Run Order)');
    drawWinfreeSubHeader(doc, meet, event, 'Check Sheet', 'By Run Order', runNumber);

    const orderCols = [
      { header: 'Ord', width: 0.35, value: r => r.start_num || '' },
      { header: 'Bib', width: 0.35, value: r => r.bib_number || '', bold: true },
      { header: 'Gp', width: 0.3, value: r => r.gp || '' },
      { header: 'Athlete', width: 1.6, value: r => `${r.last_name}, ${r.first_name}` },
      { header: 'TL1', width: 0.5, align: 'right', value: r => { const js = judgeScores[r.run_id]; return js && js.tl[0] != null ? js.tl[0].toFixed(1) : ''; } },
      { header: 'TL2', width: 0.5, align: 'right', value: r => { const js = judgeScores[r.run_id]; return js && js.tl[1] != null ? js.tl[1].toFixed(1) : ''; } },
      { header: 'TL3', width: 0.5, align: 'right', value: r => { const js = judgeScores[r.run_id]; return js && js.tl[2] != null ? js.tl[2].toFixed(1) : ''; } },
      { header: 'Air 1', width: 0.5, align: 'right', value: r => { const js = judgeScores[r.run_id]; return js && js.air1[0] != null ? js.air1[0].toFixed(1) : ''; } },
      { header: 'Air 2', width: 0.5, align: 'right', value: r => { const js = judgeScores[r.run_id]; return js && js.air2[0] != null ? js.air2[0].toFixed(1) : ''; } },
      { header: 'Jumps', width: 0.7, value: r => [r.jump1_code, r.jump2_code].filter(Boolean).join('/') },
      { header: 'Speed', width: 0.5, align: 'right', value: r => fmtScore(r.speed_score) },
      { header: 'Total', width: 0.6, align: 'right', value: r => r.run_status || fmtScore(r.total_score), bold: true },
      { header: 'Status', width: 0.5, value: r => r.run_status || '' },
    ];
    drawTable(doc, orderCols, sorted);
    stampFooter(doc);
    doc.end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===========================================================================
// POST /api/pdf/registration
// ===========================================================================
router.post('/registration', async (req, res) => {
  try {
    const { eventId, options = {} } = req.body;
    const sortBy = options.sort || 'alpha';
    const { event, meet } = await fetchEventMeet(eventId);

    // Fetch ALL athletes across all events in this meet (meet-wide registration)
    const athletes = await queryAll(
      `SELECT DISTINCT a.id as athlete_id, a.first_name, a.last_name, a.ussa_num, a.fis_id,
              a.club, a.nation, a.birth_year, a.gender,
              reg.bib_number
       FROM registrations reg
       JOIN athletes a ON a.id = reg.athlete_id
       JOIN events e ON e.id = reg.event_id
       WHERE e.meet_id=? AND reg.status != 'scratched'`,
      [meet.id]
    );

    // Dedup by athlete_id, keeping first non-null bib
    const seen = {};
    const deduped = [];
    for (const a of athletes) {
      if (!seen[a.athlete_id]) {
        seen[a.athlete_id] = a;
        deduped.push(a);
      } else if (!seen[a.athlete_id].bib_number && a.bib_number) {
        seen[a.athlete_id].bib_number = a.bib_number;
      }
    }

    // Build event abbreviation map: M for mogul, DM for dual_mogul
    const meetEvents = await queryAll(
      'SELECT id, discipline FROM events WHERE meet_id=?', [meet.id]
    );
    const discCounts = {};
    for (const ev of meetEvents) {
      const abbr = ev.discipline === 'dual_mogul' ? 'DM' : ev.discipline === 'aerials' ? 'AE' : 'M';
      if (!discCounts[abbr]) discCounts[abbr] = [];
      discCounts[abbr].push(ev.id);
    }
    // Assign numbers only when count > 1
    const eventAbbrMap = {};
    for (const [abbr, ids] of Object.entries(discCounts)) {
      if (ids.length === 1) {
        eventAbbrMap[ids[0]] = abbr;
      } else {
        ids.forEach((id, i) => { eventAbbrMap[id] = `${abbr}${i + 1}`; });
      }
    }

    // Collect per-athlete event abbreviations
    const allRegs = await queryAll(
      `SELECT reg.athlete_id, reg.event_id
       FROM registrations reg
       JOIN events e ON e.id = reg.event_id
       WHERE e.meet_id=? AND reg.status != 'scratched'`,
      [meet.id]
    );
    const athleteEventsMap = {};
    for (const r of allRegs) {
      if (!athleteEventsMap[r.athlete_id]) athleteEventsMap[r.athlete_id] = new Set();
      if (eventAbbrMap[r.event_id]) athleteEventsMap[r.event_id] = athleteEventsMap[r.event_id]; // no-op safety
      athleteEventsMap[r.athlete_id].add(eventAbbrMap[r.event_id] || '?');
    }

    // Enrich with age group and event abbreviations
    const enriched = deduped.map(a => ({
      ...a,
      gp: (a.gender || '').charAt(0).toUpperCase() + computeAgeGroup(a.birth_year, meet?.date),
      events: [...(athleteEventsMap[a.athlete_id] || [])].join(', '),
    }));

    let sorted;
    if (sortBy === 'bib') {
      sorted = [...enriched].sort((a, b) => (parseInt(a.bib_number) || 999) - (parseInt(b.bib_number) || 999));
    } else {
      sorted = [...enriched].sort((a, b) => (a.last_name || '').localeCompare(b.last_name || '') || (a.first_name || '').localeCompare(b.first_name || ''));
    }

    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 36, bottom: 36, left: 36, right: 36 } });
    streamPdf(res, doc, safeFilename(event, 'registration'));
    pdfHeader(doc, meet, event, `Registration List (by ${sortBy === 'bib' ? 'Bib' : 'Name'})`);

    doc.fontSize(8).fillColor('#666').text(`${sorted.length} athletes registered`, { align: 'center' });
    doc.fillColor('#000').moveDown(0.3);

    drawTable(doc, [
      { header: 'Bib', width: 0.5, value: r => r.bib_number || '', bold: true },
      { header: 'Gp', width: 0.4, value: r => r.gp || '' },
      { header: 'Athlete', width: 2.5, value: r => `${r.last_name}, ${r.first_name}`, bold: true },
      { header: 'Club', width: 1.8, value: r => r.club || '' },
      { header: 'USSA #', width: 1, value: r => r.ussa_num || '' },
      { header: 'YOB', width: 0.5, value: r => r.birth_year || '' },
      { header: 'Events', width: 1, value: r => r.events || '' },
    ], sorted);
    stampFooter(doc);
    doc.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===========================================================================
// POST /api/pdf/training-day/:id — Training day participant roster
// ===========================================================================
router.post('/training-day/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const td = await queryOne('SELECT * FROM training_days WHERE id=?', [id]);
    if (!td) return res.status(404).json({ error: 'Training day not found' });
    const meet = await queryOne('SELECT * FROM meets WHERE id=?', [td.meet_id]);
    if (!meet) return res.status(404).json({ error: 'Meet not found' });

    // All non-scratched registrations across every event in the meet,
    // deduped by athlete, with the first non-null bib retained.
    const rows = await queryAll(
      `SELECT DISTINCT a.id AS athlete_id, a.first_name, a.last_name,
              a.ussa_num, a.club, a.deleted_at, r.bib_number
       FROM registrations r
       JOIN athletes a ON a.id = r.athlete_id
       JOIN events e   ON e.id = r.event_id
       WHERE e.meet_id=? AND r.status != 'scratched'`,
      [meet.id]
    );
    const live = rows.filter(r => !r.deleted_at);
    const seen = {};
    const deduped = [];
    for (const a of live) {
      if (!seen[a.athlete_id]) { seen[a.athlete_id] = a; deduped.push(a); }
      else if (!seen[a.athlete_id].bib_number && a.bib_number) {
        seen[a.athlete_id].bib_number = a.bib_number;
      }
    }

    // Apply exclusion filter — only included athletes appear on the PDF
    const exclusionRows = await queryAll(
      'SELECT athlete_id FROM training_day_exclusions WHERE training_day_id=?',
      [id]
    );
    const excluded = new Set(exclusionRows.map(r => r.athlete_id));
    const included = deduped.filter(a => !excluded.has(a.athlete_id));

    // Sort by bib (numeric ASC, blanks last), then by last name
    included.sort((a, b) => {
      const ba = parseInt(a.bib_number);
      const bb = parseInt(b.bib_number);
      const aHas = Number.isFinite(ba);
      const bHas = Number.isFinite(bb);
      if (aHas && bHas && ba !== bb) return ba - bb;
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      return (a.last_name || '').localeCompare(b.last_name || '') ||
             (a.first_name || '').localeCompare(b.first_name || '');
    });

    // Subtitle: training day name plus optional date
    let dateStr = '';
    if (td.date) {
      try {
        dateStr = new Date(td.date + 'T12:00:00').toLocaleDateString('en-US', {
          weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
        });
      } catch { dateStr = td.date; }
    }
    const subtitle = dateStr ? `${td.name} — ${dateStr}` : td.name;

    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 36, bottom: 36, left: 36, right: 36 } });
    const slug = (s) => (s || '').replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '');
    const filename = `Training_Day_${slug(meet.name)}_${slug(td.name) || 'roster'}.pdf`;
    streamPdf(res, doc, filename);
    pdfHeader(doc, meet, { name: 'Training Day Participants' }, subtitle);

    doc.fontSize(8).fillColor('#666').text(`${included.length} participant${included.length === 1 ? '' : 's'}`, { align: 'center' });
    doc.fillColor('#000').moveDown(0.3);

    drawTable(doc, [
      { header: 'Bib',    width: 0.6, value: r => r.bib_number || '', bold: true },
      { header: 'Last',   width: 1.8, value: r => r.last_name || '', bold: true },
      { header: 'First',  width: 1.8, value: r => r.first_name || '' },
      { header: 'USSA #', width: 1.0, value: r => r.ussa_num || '' },
      { header: 'Club',   width: 2.0, value: r => r.club || '' },
    ], included);
    stampFooter(doc);
    doc.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===========================================================================
// POST /api/pdf/timer-sheet — Manual Time Sheet (triple-spaced for on-hill)
// ===========================================================================
router.post('/timer-sheet', async (req, res) => {
  try {
    const { eventId, options = {} } = req.body;
    const { event, meet } = await fetchEventMeet(eventId);
    const athletes = await fetchAthletes(eventId, null);

    const sorted = [...athletes].sort((a, b) =>
      (parseInt(a.run_order) || 999) - (parseInt(b.run_order) || 999)
    );

    // Enrich with age group
    for (const a of sorted) a.gp = (a.gender || '').charAt(0).toUpperCase() + computeAgeGroup(a.birth_year, meet?.date);

    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 36, bottom: 36, left: 36, right: 36 } });
    streamPdf(res, doc, safeFilename(event, 'timer_sheet'));
    pdfHeader(doc, meet, event, 'Scoring Sheets');
    drawWinfreeSubHeader(doc, meet, event, 'Scoring Sheets', 'By Moguls Run-order', options.runNumber || 1);

    drawTable(doc, [
      { header: 'Start', width: 0.5, value: r => r.start_num || r.run_order || '' },
      { header: 'Bib#', width: 0.5, value: r => r.bib_number || '', bold: true },
      { header: 'Name', width: 2.5, value: r => `${(r.last_name || '').toUpperCase()},${r.first_name || ''}`, bold: true },
      { header: 'Top Time', width: 1.2, value: () => '' },
      { header: 'Bottom Time', width: 1.2, value: () => '' },
    ], sorted, { rowHeight: 32, headerColor: '#1a1a1a', gridLines: true, verticalCenter: true, footerOpts: { skipLogo: true } });
    stampFooter(doc, { skipLogo: true });
    doc.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===========================================================================
// POST /api/pdf/run-results — Winfree-style detailed per-run results
// ===========================================================================
router.post('/run-results', async (req, res) => {
  try {
    const { eventId, options = {} } = req.body;
    const rawRunNumber = options.runNumber || 1;
    const isFinal = rawRunNumber === 'final';
    const runNumber = isFinal ? null : parseInt(rawRunNumber);
    const { event, meet } = await fetchEventMeet(eventId);

    let ranked, judgeScores;
    if (isFinal) {
      // Final Results: use buildResultsData for aggregated rankings
      const data = await buildResultsData(eventId, 'qualification');
      ranked = data.results;
      // Collect judge scores across all runs
      const maxRun = await queryOne('SELECT MAX(run_number) as mx FROM runs WHERE event_id=?', [eventId]);
      judgeScores = {};
      for (let rn = 1; rn <= (maxRun?.mx || 1); rn++) {
        const js = await fetchRunJudgeScores(eventId, rn);
        Object.assign(judgeScores, js);
      }
    } else {
      const runs = await queryAll(
        `SELECT r.*, reg.bib_number, reg.run_order, a.first_name, a.last_name,
                a.club, a.birth_year, a.gender, a.ussa_num
         FROM runs r
         JOIN registrations reg ON reg.id = r.registration_id
         JOIN athletes a ON a.id = reg.athlete_id
         WHERE r.event_id=? AND r.run_number=? AND r.status='complete'
         ORDER BY r.total_score DESC`,
        [eventId, runNumber]
      );

      // Add DNS/DNF/DSQ athletes
      const statusRuns = await queryAll(
        `SELECT r.*, reg.bib_number, reg.run_order, a.first_name, a.last_name,
                a.club, a.birth_year, a.gender, a.ussa_num
         FROM runs r
         JOIN registrations reg ON reg.id = r.registration_id
         JOIN athletes a ON a.id = reg.athlete_id
         WHERE r.event_id=? AND r.run_number=? AND r.run_status IS NOT NULL`,
        [eventId, runNumber]
      );
      // Merge status runs not already in completed runs
      const runIds = new Set(runs.map(r => r.id));
      for (const sr of statusRuns) {
        if (!runIds.has(sr.id)) runs.push(sr);
      }

      ranked = rankResults(runs, event.discipline);
      judgeScores = await fetchRunJudgeScores(eventId, runNumber);
    }

    // Enrich with age group
    for (const r of ranked) r.gp = (r.gender || '').charAt(0).toUpperCase() + computeAgeGroup(r.birth_year, meet?.date);

    const titleLabel = isFinal ? 'Final Results' : `Run ${runNumber}`;
    const doc = new PDFDocument({
      size: 'LETTER',
      layout: 'landscape',
      margins: { top: 36, bottom: 36, left: 28, right: 28 }
    });
    streamPdf(res, doc, safeFilename(event, isFinal ? 'final_results' : `run_results_${runNumber}`));
    pdfHeader(doc, meet, event, titleLabel);
    drawWinfreeSubHeader(doc, meet, event, titleLabel, 'By Score', isFinal ? 'final' : runNumber);

    drawDetailedResultsTable(doc, ranked, judgeScores, { event });

    // Officials + course specs footer
    const info = await fetchOfficialsAndCourseSpecs(meet.id, eventId);
    drawOfficialsCourseFooter(doc, info, event);

    stampFooter(doc);
    doc.end();
  } catch (e) {
    console.error('run-results PDF error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ===========================================================================
// POST /api/pdf/event-results-summary — Simple summary by score
// ===========================================================================
router.post('/event-results-summary', async (req, res) => {
  try {
    const { eventId } = req.body;
    const data = await buildResultsData(eventId, 'qualification');
    const { meet, event, results, round } = data;

    // Enrich with age group
    for (const r of results) r.gp = (r.gender || '').charAt(0).toUpperCase() + computeAgeGroup(r.birth_year, meet?.date);

    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 36, bottom: 36, left: 36, right: 36 } });
    streamPdf(res, doc, safeFilename(event, 'event_results_summary'));
    pdfHeader(doc, meet, event, 'Press');

    const phaseLabel = typeof round === 'string' && round !== 'qualification' ? round : '';
    drawWinfreeSubHeader(doc, meet, event, phaseLabel || 'Press', 'By Score');

    drawTable(doc, [
      { header: 'No', width: 0.4, value: r => r.run_status || r.rank, bold: true },
      { header: 'Bib#', width: 0.5, value: r => r.bib_number || '' },
      { header: 'Gp', width: 0.4, value: r => r.gp || '' },
      { header: 'Name', width: 1.8, value: r => `${(r.last_name || '').toUpperCase()},${r.first_name || ''}`, bold: true },
      { header: 'Representing', width: 2.5, value: r => r.club || '' },
      { header: 'Score', width: 1, align: 'right', value: r => r.run_status || fmtScore(r.total_score), bold: true },
    ], results);

    // Pace times at bottom — filtered by event gender
    const courseSpec = await queryOne('SELECT * FROM course_specs WHERE meet_id=? ORDER BY rowid LIMIT 1', [meet.id]);
    const g = (event.gender || '').toUpperCase();
    let paceText = null;
    if (g === 'F' || g === 'M') {
      const paceVal = g === 'F'
        ? (courseSpec?.pace_time_override_f || event.pace_time)
        : (courseSpec?.pace_time_override_m || event.pace_time);
      if (paceVal != null) paceText = `Pace Time — ${g === 'F' ? 'Female' : 'Male'}: ${fmtScore(paceVal)}s`;
    } else {
      const parts = [];
      const paceM = courseSpec?.pace_time_override_m || event.pace_time;
      const paceF = courseSpec?.pace_time_override_f;
      if (paceM != null) parts.push(`Male: ${fmtScore(paceM)}s`);
      if (paceF != null) parts.push(`Female: ${fmtScore(paceF)}s`);
      if (parts.length) paceText = `Pace Time — ${parts.join(', ')}`;
    }
    if (paceText) {
      doc.moveDown(0.5);
      doc.fontSize(7).fillColor('#888').text(paceText, { align: 'left' });
      doc.fillColor('#000');
    }

    stampFooter(doc);
    doc.end();
  } catch (e) {
    console.error('event-results-summary PDF error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ===========================================================================
// POST /api/pdf/event-results-detailed — All runs per athlete, full breakdown
// ===========================================================================
router.post('/event-results-detailed', async (req, res) => {
  try {
    const { eventId } = req.body;
    const { event, meet } = await fetchEventMeet(eventId);

    // Get best score per athlete for ranking (phase-aware)
    const data = await buildResultsData(eventId, 'qualification');
    const ranked = data.results;

    // Get ALL runs for each athlete
    const allRuns = await queryAll(
      `SELECT r.*, reg.bib_number, reg.run_order, a.first_name, a.last_name,
              a.club, a.birth_year, a.gender, a.ussa_num
       FROM runs r
       JOIN registrations reg ON reg.id = r.registration_id
       JOIN athletes a ON a.id = reg.athlete_id
       WHERE r.event_id=? AND (r.status='complete' OR r.run_status IS NOT NULL)
       ORDER BY r.registration_id, r.run_number`,
      [eventId]
    );

    // Group runs by registration_id
    const runsByReg = {};
    for (const r of allRuns) {
      if (!runsByReg[r.registration_id]) runsByReg[r.registration_id] = [];
      runsByReg[r.registration_id].push(r);
    }

    // Fetch all judge scores
    const allJudgeScores = await fetchAllJudgeScores(eventId);

    // Build flat list: for each ranked athlete, list each run
    const flatRows = [];
    for (const athlete of ranked) {
      const athleteRuns = runsByReg[athlete.registration_id] || [];
      const eventScore = athlete.total_score;
      const gp = (athlete.gender || '').charAt(0).toUpperCase() + computeAgeGroup(athlete.birth_year, meet?.date);

      if (athleteRuns.length === 0) {
        // DNS with no runs
        flatRows.push({
          ...athlete,
          gp,
          event_score: eventScore,
          isFirstRun: true,
          isLastRun: true,
        });
      } else {
        athleteRuns.forEach((run, i) => {
          flatRows.push({
            ...run,
            rank: i === 0 ? athlete.rank : '',
            gp,
            event_score: i === athleteRuns.length - 1 ? eventScore : null,
            isFirstRun: i === 0,
            isLastRun: i === athleteRuns.length - 1,
          });
        });
      }
    }

    const doc = new PDFDocument({
      size: 'LETTER',
      layout: 'landscape',
      margins: { top: 36, bottom: 36, left: 28, right: 28 }
    });
    streamPdf(res, doc, safeFilename(event, 'event_results_detailed'));
    pdfHeader(doc, meet, event, 'Event');
    drawWinfreeSubHeader(doc, meet, event, 'Event', 'By Score');

    drawDetailedResultsTable(doc, flatRows, allJudgeScores, { showEventCol: true, event });

    // Officials + course specs footer
    const info = await fetchOfficialsAndCourseSpecs(meet.id, eventId);
    drawOfficialsCourseFooter(doc, info, event);

    stampFooter(doc);
    doc.end();
  } catch (e) {
    console.error('event-results-detailed PDF error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ===========================================================================
// POST /api/pdf/event-results-component — Detailed Results with Component Scoring
// ===========================================================================
router.post('/event-results-component', async (req, res) => {
  try {
    const { eventId } = req.body;
    const { event, meet } = await fetchEventMeet(eventId);

    if (!event.component_scoring) {
      return res.status(400).json({ error: 'Component scoring is not enabled for this event' });
    }

    // Get ranked results (phase-aware)
    const data = await buildResultsData(eventId, 'qualification');
    const ranked = data.results;

    // Determine format for best-run marking
    const phases = await queryAll(
      `SELECT * FROM event_phases WHERE event_id=? ORDER BY sequence_order`, [eventId]
    );
    const phaseTypes = phases.map(p => p.phase_type);
    const isBestOf2 = phaseTypes.includes('best_of_2');

    // Get ALL completed runs for each athlete
    const allRuns = await queryAll(
      `SELECT r.*, reg.bib_number, a.first_name, a.last_name,
              a.club, a.birth_year, a.gender
       FROM runs r
       JOIN registrations reg ON reg.id = r.registration_id
       JOIN athletes a ON a.id = reg.athlete_id
       WHERE r.event_id=? AND (r.status='complete' OR r.run_status IS NOT NULL)
       ORDER BY r.registration_id, r.run_number`,
      [eventId]
    );
    const runsByReg = {};
    for (const r of allRuns) {
      if (!runsByReg[r.registration_id]) runsByReg[r.registration_id] = [];
      runsByReg[r.registration_id].push(r);
    }

    // Fetch per-judge scores WITH component data
    const judgeScores = await queryAll(
      `SELECT js.run_id, js.score_type, js.raw_score,
              js.tl_carving, js.tl_abext, js.tl_upper_body, js.tl_deduction,
              j.role
       FROM judge_scores js
       JOIN judges j ON j.id = js.judge_id
       WHERE js.run_id IN (SELECT id FROM runs WHERE event_id=?)
       ORDER BY js.run_id, j.role, js.score_type`,
      [eventId]
    );
    // Build map: run_id -> { tlJudges: [{role, raw, crv, ub, ae, ded}...], air1: [scores], air2: [scores] }
    const jsMap = {};
    for (const s of judgeScores) {
      if (!jsMap[s.run_id]) jsMap[s.run_id] = { tlJudges: [], air1: [], air2: [] };
      const entry = jsMap[s.run_id];
      if (s.score_type === 'turns' && /^TL/i.test(s.role)) {
        entry.tlJudges.push({
          role: s.role, raw: s.raw_score,
          crv: s.tl_carving, ub: s.tl_upper_body, ae: s.tl_abext, ded: s.tl_deduction
        });
      } else if (s.score_type === 'air_jump1') {
        entry.air1.push(s.raw_score);
      } else if (s.score_type === 'air_jump2') {
        entry.air2.push(s.raw_score);
      }
    }

    // Phase labels for run numbers
    const phaseLabels = {};
    for (const p of phases) phaseLabels[p.run_number] = p.label;

    const numTl = event.num_tl_judges || 3;

    // --- PDF Setup ---
    const doc = new PDFDocument({
      size: 'LETTER',
      layout: 'landscape',
      margins: { top: 36, bottom: 36, left: 24, right: 24 }
    });
    streamPdf(res, doc, safeFilename(event, 'results_component'));
    pdfHeader(doc, meet, event, 'Event');
    drawWinfreeSubHeader(doc, meet, event, 'Event', 'By Score');

    // --- Column layout ---
    const pageW = doc.page.width;
    const mL = doc.page.margins.left;
    const mR = doc.page.margins.right;
    const usable = pageW - mL - mR;
    const fontSize = 8;
    const headerFontSize = 7;
    const subHeaderFontSize = 6.5;
    const rowH = 16;
    const headerH = 30;
    const bottomLimit = doc.page.height - doc.page.margins.bottom - 20;

    // Identity columns (wider for readability)
    const colPlace = 22;
    const colBib = 24;
    const colGp = 22;
    const colName = 95;
    const colClub = 60;
    const idW = colPlace + colBib + colGp + colName + colClub;

    // TL component columns (per judge) — wider
    const colComp = 24;  // Crv, UB, A/E, Ded each
    const colTot = 30;   // Judge total
    const tlJudgeW = colComp * 4 + colTot; // 126 per judge
    const colTLSum = 32;

    // Final Score column — rightmost, always present
    const colFinalScore = 48;

    // Pre-compute vertical separator x positions (shared by TL header, TL data, and air rows)
    const finalScoreXConst = mL + usable - colFinalScore;
    const tlSeps = [];  // x positions of vertical lines between judge groups
    for (let j = 0; j <= numTl; j++) tlSeps.push(mL + idW + j * tlJudgeW);
    // tlSeps = [247, 373, 499, 625] for 3 judges
    const tlSumSepX = tlSeps[numTl]; // after last judge, before T&L sum

    // Air row columns — ALIGNED to TL judge group boundaries
    // Jump 1 fills TL Judge 1 width (126pt), Jump 2 fills TL Judge 2 width (126pt)
    const jumpGroupW = tlJudgeW; // 126pt — same as one TL judge group
    const colCode = 42;
    const colDD = 42;
    const colAirScore = jumpGroupW - colCode - colDD; // 42
    // Remaining columns fill TL Judge 3 + T&L sum + gap to Final Score
    const airRemainW = finalScoreXConst - tlSeps[2]; // from Judge 3 start to Final Score
    const colAirTot = Math.floor(airRemainW * 0.18);
    const colTime = Math.floor(airRemainW * 0.24);
    const colSpeed = Math.floor(airRemainW * 0.24);
    const colRunTot = airRemainW - colAirTot - colTime - colSpeed;

    // --- Color families: TL = cool blue, Air = warm sand ---
    // TL headers
    const TL_HEADER_BG = '#1B3A5C';     // dark navy
    const TL_SUBHEADER_BG = '#2a5a8a';  // medium blue
    // TL data rows (scoring area only)
    const TL_DATA_EVEN = '#e4edf7';     // light blue
    const TL_DATA_ODD = '#edf3fb';
    // Air headers
    const AIR_HEADER_BG = '#5C4A1B';    // dark amber/brown
    const AIR_SUBHEADER_BG = '#7a6530'; // medium amber
    // Air data rows (scoring area only)
    const AIR_DATA_EVEN = '#f5edda';    // light warm sand
    const AIR_DATA_ODD = '#faf3e4';
    // Identity area (neutral white for both row types)
    const ID_BG_EVEN = '#f5f7fa';
    const ID_BG_ODD = '#ffffff';
    // Separators
    const JUDGE_SEPARATOR = '#8899aa';

    function ensureSpace(doc, needed) {
      if (doc.y + needed > bottomLimit) {
        addPageWithFooter(doc);
        return true;
      }
      return false;
    }

    // --- Draw column headers ---
    function drawColumnHeaders(doc) {
      const y = doc.y;
      let x = mL;
      const topH = headerH * 0.47;  // group header row
      const botH = headerH - topH;  // sub-header row

      // Identity header background (dark neutral)
      doc.rect(mL, y, idW, headerH).fill('#2c3e50');
      // TL scoring header background — extends all the way to Final Score column
      doc.rect(mL + idW, y, finalScoreXConst - (mL + idW), headerH).fill(TL_HEADER_BG);
      // Final Score header — far right
      doc.rect(finalScoreXConst, y, colFinalScore, headerH).fill('#1a1a1a');

      // Identity column headers (vertically centered in full header)
      doc.fillColor('#fff').fontSize(headerFontSize);
      const midY = y + headerH / 2 - 3;
      doc.text('Pl', x + 1, midY, { width: colPlace, align: 'center' });
      x += colPlace;
      doc.text('Bib', x, midY, { width: colBib, align: 'center' });
      x += colBib;
      doc.text('Gp', x, midY, { width: colGp, align: 'center' });
      x += colGp;
      doc.text('Name', x + 2, midY, { width: colName, align: 'left' });
      x += colName;
      doc.text('Club', x + 2, midY, { width: colClub, align: 'left' });
      x += colClub;

      // TL Judge group headers — sub-header backgrounds first
      for (let j = 1; j <= numTl; j++) {
        const gx = mL + idW + (j - 1) * tlJudgeW;
        doc.rect(gx, y + topH, tlJudgeW, botH).fill(TL_SUBHEADER_BG);
      }

      // Vertical separator lines at pre-computed positions
      for (let j = 0; j <= numTl; j++) {
        doc.rect(tlSeps[j], y, 0.75, headerH).fill('#4a7ab5');
      }
      doc.rect(finalScoreXConst, y, 0.75, headerH).fill('#555');

      // TL Judge group text
      x = mL + idW;
      for (let j = 1; j <= numTl; j++) {
        doc.fillColor('#fff').fontSize(headerFontSize);
        doc.font('Helvetica-Bold').text(`TL Judge ${j}`, x, y + 2, { width: tlJudgeW, align: 'center' });
        doc.font('Helvetica');

        doc.fillColor('#fff').fontSize(subHeaderFontSize);
        let sx = x;
        doc.text('Carving', sx, y + topH + 3, { width: colComp, align: 'center' }); sx += colComp;
        doc.text('UB', sx, y + topH + 3, { width: colComp, align: 'center' }); sx += colComp;
        doc.text('Ab/Ext', sx, y + topH + 3, { width: colComp, align: 'center' }); sx += colComp;
        doc.text('Ded', sx, y + topH + 3, { width: colComp, align: 'center' }); sx += colComp;
        doc.text('Total', sx, y + topH + 3, { width: colTot, align: 'center' }); sx += colTot;

        x += tlJudgeW;
      }

      // T&L text
      doc.fontSize(headerFontSize).fillColor('#fff');
      doc.font('Helvetica-Bold').text('T&L', x, midY, { width: colTLSum, align: 'center' });
      x += colTLSum;

      // Final Score text
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(6.5);
      doc.text('Final', finalScoreXConst, midY - 3, { width: colFinalScore, align: 'center' });
      doc.text('Score', finalScoreXConst, midY + 5, { width: colFinalScore, align: 'center' });
      doc.font('Helvetica').fontSize(headerFontSize);

      doc.fillColor('#000');
      doc.y = y + headerH + 1;
    }

    // --- Draw Air/Speed sub-header ---
    function drawAirSubHeader(doc) {
      const y = doc.y;
      const airH = rowH + 4;

      // Step 1: Paint backgrounds
      doc.rect(mL, y, idW, airH).fill('#3d3225');
      doc.rect(mL + idW, y, finalScoreXConst - (mL + idW), airH).fill(AIR_HEADER_BG);
      doc.rect(finalScoreXConst, y, colFinalScore, airH).fill('#e0e0e0');
      // Sub-header backgrounds for jump groups — aligned to TL judge boundaries
      doc.rect(tlSeps[0], y + airH * 0.5, jumpGroupW, airH * 0.5).fill(AIR_SUBHEADER_BG);
      doc.rect(tlSeps[1], y + airH * 0.5, jumpGroupW, airH * 0.5).fill(AIR_SUBHEADER_BG);

      // Step 2: Vertical separators at SAME positions as TL header
      doc.rect(tlSeps[0], y, 0.75, airH).fill('#a08050');
      doc.rect(tlSeps[1], y, 0.75, airH).fill('#a08050');
      doc.rect(tlSeps[2], y, 0.75, airH).fill('#a08050');

      // Step 3: Write text
      doc.fillColor('#fff');
      doc.fontSize(subHeaderFontSize).font('Helvetica-Bold');
      doc.text('Air / Speed', mL + colPlace, y + (airH / 2) - 3, { width: idW - colPlace, align: 'left' });
      doc.font('Helvetica');

      // Jump 1 — within Judge 1 area (tlSeps[0] to tlSeps[1])
      let x = tlSeps[0];
      doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#fff');
      doc.text('Jump 1', x, y + 1, { width: jumpGroupW, align: 'center' });
      doc.font('Helvetica').fontSize(subHeaderFontSize).fillColor('#fff');
      doc.text('Code', x, y + airH * 0.5 + 3, { width: colCode, align: 'center' }); x += colCode;
      doc.text('DD', x, y + airH * 0.5 + 3, { width: colDD, align: 'center' }); x += colDD;
      doc.text('Score', x, y + airH * 0.5 + 3, { width: colAirScore, align: 'center' });

      // Jump 2 — within Judge 2 area (tlSeps[1] to tlSeps[2])
      x = tlSeps[1];
      doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#fff');
      doc.text('Jump 2', x, y + 1, { width: jumpGroupW, align: 'center' });
      doc.font('Helvetica').fontSize(subHeaderFontSize).fillColor('#fff');
      doc.text('Code', x, y + airH * 0.5 + 3, { width: colCode, align: 'center' }); x += colCode;
      doc.text('DD', x, y + airH * 0.5 + 3, { width: colDD, align: 'center' }); x += colDD;
      doc.text('Score', x, y + airH * 0.5 + 3, { width: colAirScore, align: 'center' });

      // Totals — within Judge 3 + T&L area (tlSeps[2] to finalScoreX)
      x = tlSeps[2];
      doc.fillColor('#fff').fontSize(subHeaderFontSize);
      const totY = y + (airH / 2) - 3;
      doc.text('Air', x, totY, { width: colAirTot, align: 'center' }); x += colAirTot;
      doc.text('Time', x, totY, { width: colTime, align: 'center' }); x += colTime;
      doc.text('Speed', x, totY, { width: colSpeed, align: 'center' }); x += colSpeed;
      doc.text('Run Tot', x, totY, { width: colRunTot, align: 'center' });

      doc.fillColor('#000');
      doc.y = y + airH;
    }

    // --- Draw one athlete block ---
    function drawHeaders(doc) {
      drawColumnHeaders(doc);
      drawAirSubHeader(doc);
    }

    function drawAthleteBlock(doc, athlete, runs, athleteIdx) {
      const numRuns = runs.length;
      const linesNeeded = numRuns * (rowH * 2 + 2) + rowH;
      if (ensureSpace(doc, linesNeeded + headerH + rowH + 2)) {
        drawHeaders(doc);
      }

      const isEven = athleteIdx % 2 === 0;
      const idBg = isEven ? ID_BG_EVEN : ID_BG_ODD;
      const tlBg = isEven ? TL_DATA_EVEN : TL_DATA_ODD;
      const airBg = isEven ? AIR_DATA_EVEN : AIR_DATA_ODD;

      for (let ri = 0; ri < runs.length; ri++) {
        const run = runs[ri];
        const js = jsMap[run.id] || { tlJudges: [], air1: [], air2: [] };
        const isBestRun = isBestOf2 && run.total_score === athlete.total_score && run.run_status == null;
        const runLabel = phaseLabels[run.run_number] || `Run ${run.run_number}`;

        if (ensureSpace(doc, rowH * 3 + headerH + rowH + 4)) {
          drawHeaders(doc);
        }

        // --- Row 1: T&L Components ---
        let y = doc.y;

        // Step 1: Paint backgrounds
        // Identity area spans BOTH rows so club name can wrap without being covered
        doc.rect(mL, y, idW, rowH * 2).fill(idBg);
        // TL scoring area (row 1 only)
        doc.rect(mL + idW, y, finalScoreXConst - (mL + idW), rowH).fill(tlBg);
        // Final Score column spans both rows
        doc.rect(finalScoreXConst, y, colFinalScore, rowH * 2).fill(isEven ? '#eaeaea' : '#f2f2f2');
        if (isBestRun && numRuns > 1) {
          doc.rect(mL, y, 3, rowH).fill('#2563eb');
        }

        // Step 2: Vertical separator lines at pre-computed positions
        for (let j = 0; j <= numTl; j++) {
          doc.rect(tlSeps[j], y, 0.75, rowH).fill(JUDGE_SEPARATOR);
        }
        doc.rect(finalScoreXConst, y, 0.75, rowH * 2).fill('#888');

        // Step 3: Write identity text
        doc.fillColor('#000').fontSize(fontSize);
        let x = mL;
        const textY = y + 4;
        if (ri === 0) {
          doc.font('Helvetica-Bold').text(String(athlete.rank || ''), x, textY, { width: colPlace, align: 'center' });
          doc.font('Helvetica').text(String(athlete.bib_number || ''), x + colPlace, textY, { width: colBib, align: 'center' });
          doc.text(athlete.gp || '', x + colPlace + colBib, textY, { width: colGp, align: 'center' });
          const name = `${(athlete.last_name || '').toUpperCase()}, ${athlete.first_name || ''}`;
          doc.font('Helvetica-Bold').text(name, x + colPlace + colBib + colGp + 2, textY, { width: colName - 4, align: 'left', lineBreak: false });
          doc.font('Helvetica').fontSize(7);
          doc.text(athlete.club || '', x + colPlace + colBib + colGp + colName + 2, textY, { width: colClub - 4, align: 'left' });
          doc.fontSize(fontSize);
        } else {
          doc.fillColor('#555').fontSize(7).font('Helvetica-Bold');
          doc.text(runLabel, x + colPlace + colBib + colGp + 2, textY, { width: colName, align: 'left' });
          doc.fillColor('#000').fontSize(fontSize).font('Helvetica');
        }

        // Step 4: Write TL judge data
        x = mL + idW;
        const tlJudges = js.tlJudges.sort((a, b) => (a.role || '').localeCompare(b.role || ''));
        for (let j = 0; j < numTl; j++) {
          const tj = tlJudges[j];
          if (tj) {
            doc.fillColor('#000').fontSize(fontSize);
            doc.text(tj.crv != null ? tj.crv.toFixed(1) : '', x + 2, textY, { width: colComp - 2, align: 'center' }); x += colComp;
            doc.text(tj.ub != null ? tj.ub.toFixed(1) : '', x, textY, { width: colComp, align: 'center' }); x += colComp;
            doc.text(tj.ae != null ? tj.ae.toFixed(1) : '', x, textY, { width: colComp, align: 'center' }); x += colComp;
            doc.fillColor('#990000').text(tj.ded != null ? tj.ded.toFixed(1) : '', x, textY, { width: colComp, align: 'center' });
            doc.fillColor('#000'); x += colComp;
            doc.font('Helvetica-Bold').text(fmtScore(tj.raw), x, textY, { width: colTot, align: 'center' });
            doc.font('Helvetica'); x += colTot;
          } else {
            x += tlJudgeW;
          }
        }

        // T&L Sum
        doc.font('Helvetica-Bold').fontSize(fontSize);
        doc.text(fmtScore(run.turns_score), x, textY, { width: colTLSum, align: 'center' });
        doc.font('Helvetica');

        // Final Score — show on last run, centered vertically across both rows
        if (ri === runs.length - 1) {
          doc.font('Helvetica-Bold').fontSize(10).fillColor('#000');
          doc.text(fmtScore(athlete.total_score), finalScoreXConst, y + rowH - 5, { width: colFinalScore, align: 'center' });
          doc.font('Helvetica').fontSize(fontSize);
        }

        doc.y = y + rowH;

        // --- Row 2: Air / Speed / Run Total ---
        y = doc.y;

        // Step 1: Paint air scoring background only (identity bg already painted from Row 1)
        doc.rect(mL + idW, y, finalScoreXConst - (mL + idW), rowH).fill(airBg);
        // Final Score column already painted from Row 1

        // Step 2: Vertical separators at SAME positions as TL row
        for (let j = 0; j <= numTl; j++) {
          doc.rect(tlSeps[j], y, 0.75, rowH).fill('#a08050');
        }

        // Step 3: Write text
        doc.fillColor('#000').fontSize(fontSize);

        // Run label for first run's air row
        if (ri === 0 && numRuns > 1) {
          doc.fillColor('#555').fontSize(7).font('Helvetica-Bold');
          doc.text(runLabel, mL + colPlace + colBib + colGp + 2, y + 4, { width: colName, align: 'left' });
          doc.fillColor('#000').fontSize(fontSize).font('Helvetica');
        }

        // DNS/DNF/DSQ
        if (run.run_status) {
          doc.fillColor('#c00').font('Helvetica-Bold').fontSize(9);
          doc.text(run.run_status.toUpperCase(), mL + idW + 4, y + 3, { width: 200, align: 'left' });
          doc.fillColor('#000').font('Helvetica').fontSize(fontSize);
          doc.y = y + rowH + 2;
          continue;
        }

        // Jump 1 — within Judge 1 area (tlSeps[0] to tlSeps[1])
        x = tlSeps[0];
        doc.text(run.jump1_code || '', x + 2, y + 4, { width: colCode - 2, align: 'center' }); x += colCode;
        doc.text(run.jump1_dd != null ? run.jump1_dd.toFixed(2) : '', x, y + 4, { width: colDD, align: 'center' }); x += colDD;
        const air1Avg = js.air1.length > 0 ? (js.air1.reduce((a, b) => a + b, 0) / js.air1.length) : null;
        doc.text(air1Avg != null ? air1Avg.toFixed(1) : '', x, y + 4, { width: colAirScore, align: 'center' });

        // Jump 2 — within Judge 2 area (tlSeps[1] to tlSeps[2])
        x = tlSeps[1];
        doc.text(run.jump2_code || '', x + 2, y + 4, { width: colCode - 2, align: 'center' }); x += colCode;
        doc.text(run.jump2_dd != null ? run.jump2_dd.toFixed(2) : '', x, y + 4, { width: colDD, align: 'center' }); x += colDD;
        const air2Avg = js.air2.length > 0 ? (js.air2.reduce((a, b) => a + b, 0) / js.air2.length) : null;
        doc.text(air2Avg != null ? air2Avg.toFixed(1) : '', x, y + 4, { width: colAirScore, align: 'center' });

        // Air/Time/Speed/RunTot — within Judge 3 + T&L area (tlSeps[2] to finalScoreX)
        x = tlSeps[2];
        doc.font('Helvetica-Bold').text(fmtScore(run.air_score), x, y + 4, { width: colAirTot, align: 'center' });
        doc.font('Helvetica'); x += colAirTot;

        doc.text(fmtTime(run.run_time), x, y + 4, { width: colTime, align: 'center' }); x += colTime;
        doc.text(fmtScore(run.speed_score), x, y + 4, { width: colSpeed, align: 'center' }); x += colSpeed;
        doc.font('Helvetica-Bold').text(fmtScore(run.total_score), x, y + 4, { width: colRunTot, align: 'center' });
        doc.font('Helvetica');

        doc.y = y + rowH + 2;
      }

      // Thicker separator line after athlete
      doc.moveTo(mL, doc.y).lineTo(mL + usable, doc.y).lineWidth(0.8).strokeColor('#999').stroke();
      doc.y += 2;
    }

    // --- Render ---
    drawHeaders(doc);

    let athleteIdx = 0;
    for (const athlete of ranked) {
      const runs = runsByReg[athlete.registration_id] || [];
      const gp = (athlete.gender || '').charAt(0).toUpperCase() + computeAgeGroup(athlete.birth_year, meet?.date);

      if (runs.length === 0) {
        // DNS athlete with no runs at all
        ensureSpace(doc, rowH * 2);
        const y = doc.y;
        doc.rect(mL, y, idW, rowH).fill(athleteIdx % 2 === 0 ? ID_BG_EVEN : ID_BG_ODD);
        doc.rect(mL + idW, y, finalScoreXConst - (mL + idW), rowH).fill(athleteIdx % 2 === 0 ? TL_DATA_EVEN : TL_DATA_ODD);
        doc.rect(finalScoreXConst, y, colFinalScore, rowH).fill(athleteIdx % 2 === 0 ? '#eaeaea' : '#f2f2f2');
        doc.fillColor('#000').fontSize(fontSize);
        let x = mL;
        doc.font('Helvetica-Bold').text(String(athlete.rank || ''), x, y + 4, { width: colPlace, align: 'center' });
        doc.font('Helvetica').text(String(athlete.bib_number || ''), x + colPlace, y + 4, { width: colBib, align: 'center' });
        doc.text(gp, x + colPlace + colBib, y + 4, { width: colGp, align: 'center' });
        const name = `${(athlete.last_name || '').toUpperCase()}, ${athlete.first_name || ''}`;
        doc.font('Helvetica-Bold').text(name, x + colPlace + colBib + colGp + 2, y + 4, { width: colName - 4, align: 'left', lineBreak: false });
        doc.font('Helvetica').fontSize(7);
        doc.text(athlete.club || '', x + colPlace + colBib + colGp + colName + 2, y + 4, { width: colClub - 4, align: 'left' });
        doc.fontSize(fontSize);
        doc.fillColor('#c00').font('Helvetica-Bold').fontSize(9).text('DNS', mL + idW + 4, y + 3, { width: 60 });
        doc.fillColor('#000').font('Helvetica').fontSize(fontSize);
        doc.y = y + rowH + 2;
        doc.moveTo(mL, doc.y).lineTo(mL + usable, doc.y).lineWidth(0.8).strokeColor('#999').stroke();
        doc.y += 2;
        athleteIdx++;
        continue;
      }

      drawAthleteBlock(doc, { ...athlete, gp }, runs, athleteIdx);
      athleteIdx++;
    }

    // Officials + course specs footer
    const info = await fetchOfficialsAndCourseSpecs(meet.id, eventId);
    drawOfficialsCourseFooter(doc, info, event);

    stampFooter(doc);
    doc.end();
  } catch (e) {
    console.error('event-results-component PDF error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ===========================================================================
// POST /api/pdf/event-results-group-summary — Summary grouped by age category
// ===========================================================================
router.post('/event-results-group-summary', async (req, res) => {
  try {
    const { eventId } = req.body;
    const data = await buildResultsData(eventId, 'qualification');
    const { meet, event, results } = data;

    // Enrich with age group
    for (const r of results) r.gp = (r.gender || '').charAt(0).toUpperCase() + computeAgeGroup(r.birth_year, meet?.date);

    // Group by gp
    const groups = {};
    for (const r of results) {
      const key = r.gp || 'Unknown';
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }

    // Sort groups: standard USSS order
    const gpOrder = ['F11','F13','F15','F17','F19','FSr','M11','M13','M15','M17','M19','MSr'];
    const sortedKeys = Object.keys(groups).sort((a, b) => {
      const ai = gpOrder.indexOf(a);
      const bi = gpOrder.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    // Re-rank within each group
    for (const key of sortedKeys) {
      const grp = groups[key].sort((a, b) => {
        if (a.run_status && !b.run_status) return 1;
        if (!a.run_status && b.run_status) return -1;
        return (b.total_score || 0) - (a.total_score || 0);
      });
      let rank = 1;
      for (const r of grp) {
        if (r.run_status) { r.rank = r.run_status; }
        else { r.rank = rank++; }
      }
    }

    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 36, bottom: 36, left: 36, right: 36 } });
    streamPdf(res, doc, safeFilename(event, 'event_results_group_summary'));
    pdfHeader(doc, meet, event, 'Press');
    drawWinfreeSubHeader(doc, meet, event, 'Press', 'By Group Score');

    const columns = [
      { header: 'No', width: 0.4, value: r => r.rank, bold: true },
      { header: 'Bib#', width: 0.5, value: r => r.bib_number || '' },
      { header: 'Gp', width: 0.4, value: r => r.gp || '' },
      { header: 'Name', width: 1.8, value: r => `${(r.last_name || '').toUpperCase()},${r.first_name || ''}`, bold: true },
      { header: 'Representing', width: 2.5, value: r => r.club || '' },
      { header: 'Score', width: 1, align: 'right', value: r => r.run_status || fmtScore(r.total_score), bold: true },
    ];

    for (const key of sortedKeys) {
      // Check if group header + at least 2 rows fit
      if (doc.y + 40 > doc.page.height - doc.page.margins.bottom - 20) {
        addPageWithFooter(doc);
      }
      // Group section separator
      doc.moveDown(0.3);
      drawTable(doc, columns, groups[key]);
    }

    stampFooter(doc);
    doc.end();
  } catch (e) {
    console.error('event-results-group-summary PDF error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ===========================================================================
// POST /api/pdf/event-results-group-detailed — Detailed grouped by age category
// ===========================================================================
router.post('/event-results-group-detailed', async (req, res) => {
  try {
    const { eventId } = req.body;
    const { event, meet } = await fetchEventMeet(eventId);

    // Get best score per athlete for ranking (phase-aware)
    const data = await buildResultsData(eventId, 'qualification');
    const ranked = data.results;

    // Enrich with age group
    for (const r of ranked) r.gp = (r.gender || '').charAt(0).toUpperCase() + computeAgeGroup(r.birth_year, meet?.date);

    // Group by gp
    const groups = {};
    for (const r of ranked) {
      const key = r.gp || 'Unknown';
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }

    // Sort groups
    const gpOrder = ['F11','F13','F15','F17','F19','FSr','M11','M13','M15','M17','M19','MSr'];
    const sortedKeys = Object.keys(groups).sort((a, b) => {
      const ai = gpOrder.indexOf(a);
      const bi = gpOrder.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    // Re-rank within each group
    for (const key of sortedKeys) {
      const grp = groups[key].sort((a, b) => {
        if (a.run_status && !b.run_status) return 1;
        if (!a.run_status && b.run_status) return -1;
        return (b.total_score || 0) - (a.total_score || 0);
      });
      let rank = 1;
      for (const r of grp) {
        if (r.run_status) { r.rank = r.run_status; }
        else { r.rank = rank++; }
      }
    }

    // Get ALL runs for each athlete
    const allRuns = await queryAll(
      `SELECT r.*, reg.bib_number, reg.run_order, a.first_name, a.last_name,
              a.club, a.birth_year, a.gender, a.ussa_num
       FROM runs r
       JOIN registrations reg ON reg.id = r.registration_id
       JOIN athletes a ON a.id = reg.athlete_id
       WHERE r.event_id=? AND (r.status='complete' OR r.run_status IS NOT NULL)
       ORDER BY r.registration_id, r.run_number`,
      [eventId]
    );

    const runsByReg = {};
    for (const r of allRuns) {
      if (!runsByReg[r.registration_id]) runsByReg[r.registration_id] = [];
      runsByReg[r.registration_id].push(r);
    }

    const allJudgeScores = await fetchAllJudgeScores(eventId);

    const doc = new PDFDocument({
      size: 'LETTER',
      layout: 'landscape',
      margins: { top: 36, bottom: 36, left: 28, right: 28 }
    });
    streamPdf(res, doc, safeFilename(event, 'event_results_group_detailed'));
    pdfHeader(doc, meet, event, 'Event');
    drawWinfreeSubHeader(doc, meet, event, 'Event', 'By Group Score');

    for (const key of sortedKeys) {
      // Build flat rows for this group
      const flatRows = [];
      for (const athlete of groups[key]) {
        const athleteRuns = runsByReg[athlete.registration_id] || [];
        const eventScore = athlete.total_score;

        if (athleteRuns.length === 0) {
          flatRows.push({
            ...athlete,
            event_score: eventScore,
            isFirstRun: true,
            isLastRun: true,
          });
        } else {
          athleteRuns.forEach((run, i) => {
            flatRows.push({
              ...run,
              rank: i === 0 ? athlete.rank : '',
              gp: athlete.gp,
              event_score: i === athleteRuns.length - 1 ? eventScore : null,
              isFirstRun: i === 0,
              isLastRun: i === athleteRuns.length - 1,
            });
          });
        }
      }

      // Group separator
      if (doc.y + 40 > doc.page.height - doc.page.margins.bottom - 20) {
        addPageWithFooter(doc);
      }
      doc.moveDown(0.3);

      drawDetailedResultsTable(doc, flatRows, allJudgeScores, { showEventCol: true, event });
    }

    // Officials + course specs footer
    const info = await fetchOfficialsAndCourseSpecs(meet.id, eventId);
    drawOfficialsCourseFooter(doc, info, event);

    stampFooter(doc);
    doc.end();
  } catch (e) {
    console.error('event-results-group-detailed PDF error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ===========================================================================
// POST /api/pdf/dual-seed-list — Seeding list with prior results & USSS data
// ===========================================================================
router.post('/dual-seed-list', async (req, res) => {
  try {
    const { eventId } = req.body;
    const { event, meet } = await fetchEventMeet(eventId);

    // Load seeded registrations with USSS data
    const rows = await queryAll(
      `SELECT reg.dual_seed, reg.bib_number, reg.dual_seed_source, reg.dual_seed_source_value,
              a.first_name, a.last_name, a.gender, a.club, a.birth_year, a.ussa_num,
              up.dm_points
         FROM registrations reg
         JOIN athletes a ON a.id = reg.athlete_id
         LEFT JOIN usss_people up ON up.ussa_id = a.ussa_num
        WHERE reg.event_id = ? AND reg.status NOT IN ('scratched','dns')
          AND reg.dual_seed IS NOT NULL
        ORDER BY reg.dual_seed ASC`,
      [eventId]
    );

    // Parse MO rank and USSS rank from dual_seed_source_value
    for (const r of rows) {
      r.gp = (r.gender || '').charAt(0).toUpperCase() + computeAgeGroup(r.birth_year, meet?.date);
      r.mo_rank = '';
      r.usss_rank = '';
      const sv = r.dual_seed_source_value || '';
      // Formats: "Best of MO 3 / USSS 5 = 3", "MO rank 3", "USSS 5", "unranked"
      const moMatch = sv.match(/MO\s*(?:rank\s*)?(\d+)/i);
      if (moMatch) r.mo_rank = moMatch[1];
      const usssMatch = sv.match(/USSS\s+(\d+)/i);
      if (usssMatch) r.usss_rank = usssMatch[1];
    }

    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 36, bottom: 36, left: 36, right: 36 } });
    streamPdf(res, doc, safeFilename(event, 'dual_seed_list'));
    pdfHeader(doc, meet, event, 'Seeding List');
    drawWinfreeSubHeader(doc, meet, event, 'Seeding List', 'By Seed Order');

    drawTable(doc, [
      { header: 'Seed', width: 0.4, value: r => r.dual_seed != null ? Math.round(r.dual_seed) : '', bold: true },
      { header: 'Bib', width: 0.4, value: r => r.bib_number || '' },
      { header: 'Gp', width: 0.4, value: r => r.gp || '' },
      { header: 'Name', width: 2.0, value: r => `${(r.last_name || '').toUpperCase()},${r.first_name || ''}`, bold: true },
      { header: 'Club', width: 2.0, value: r => r.club || '' },
      { header: 'MO Place', width: 0.6, align: 'right', value: r => r.mo_rank },
      { header: 'USSS Pts', width: 0.7, align: 'right', value: r => r.dm_points != null ? String(r.dm_points) : '' },
      { header: 'USSS Rank', width: 0.7, align: 'right', value: r => r.usss_rank },
    ], rows);

    stampFooter(doc);
    doc.end();
  } catch (e) {
    console.error('dual-seed-list PDF error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ===========================================================================
// POST /api/pdf/dual-results — Final placement list from bracket outcomes
// ===========================================================================
router.post('/dual-results', async (req, res) => {
  try {
    const { eventId } = req.body;
    const { event, meet } = await fetchEventMeet(eventId);

    const bracket = await queryAll(
      `SELECT db.*,
        ab.first_name as blue_first, ab.last_name as blue_last, rb.bib_number as blue_bib,
        ab.gender as blue_gender, ab.birth_year as blue_birth_year, ab.club as blue_club,
        ar.first_name as red_first, ar.last_name as red_last, rr.bib_number as red_bib,
        ar.gender as red_gender, ar.birth_year as red_birth_year, ar.club as red_club,
        rb.dual_seed as blue_dual_seed, rr.dual_seed as red_dual_seed,
        rb.status as blue_reg_status, rr.status as red_reg_status,
        (SELECT SUM(djp.blue_points) FROM dual_judge_points djp WHERE djp.match_id = db.id) as blue_total,
        (SELECT SUM(djp.red_points)  FROM dual_judge_points djp WHERE djp.match_id = db.id) as red_total
       FROM dual_bracket db
       LEFT JOIN registrations rb ON rb.id = db.registration_id_blue
       LEFT JOIN athletes ab ON ab.id = rb.athlete_id
       LEFT JOIN registrations rr ON rr.id = db.registration_id_red
       LEFT JOIN athletes ar ON ar.id = rr.athlete_id
       WHERE db.event_id = ?
       ORDER BY db.bracket_round DESC, db.bracket_position`,
      [eventId]
    );

    if (!bracket.length) {
      return res.status(400).json({ error: 'No bracket data found' });
    }

    const runoffOption = event.runoff_option || 'runoff_to_4th';

    // ICR 4312 placement ranking. Map to the PDF's display shape (place / bib / name).
    const ranked = rankDualPlacements({ bracket, meetDate: meet?.date, isSeededGroups: true });
    const placed = ranked.map(r => ({
      place: r.rank,
      rank: r.rank,
      registration_id: r.registration_id,
      bib: r.bib_number,
      gp: r.gp,
      name: `${(r.last_name || '').toUpperCase()},${r.first_name || ''}`,
      club: r.club,
      run_status: r.run_status,
      reg_status: r.reg_status,
    }));

    // FFSP: only when event is complete
    if (event.status === 'complete') {
      const ffspMap = computeDualFfsp({ event, bracket, placements: placed });
      for (const p of placed) {
        const entry = ffspMap.get(p.registration_id);
        if (entry) p.ffsp = entry.ffsp;
      }
    }

    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 36, bottom: 36, left: 36, right: 36 } });
    streamPdf(res, doc, safeFilename(event, 'dual_results'));
    pdfHeader(doc, meet, event, 'Final Results');
    drawWinfreeSubHeader(doc, meet, event, 'Final Results', 'By Place');

    drawTable(doc, [
      { header: 'Place', width: 0.5, value: r => r.place != null ? r.place : (r.run_status || ''), bold: true },
      { header: 'Bib', width: 0.5, value: r => r.bib },
      { header: 'Gp', width: 0.4, value: r => r.gp },
      { header: 'Name', width: 1.8, value: r => r.name, bold: true },
      { header: 'Representing', width: 2.0, value: r => r.club },
      { header: 'Points', width: 0.7, value: r => r.ffsp != null ? r.ffsp.toFixed(2) : '\u2014' },
    ], placed);

    if (event.status === 'complete' && placed.some(p => p.ffsp != null)) {
      doc.moveDown(0.5);
      doc.fontSize(8).font('Helvetica-Oblique').fillColor('#555')
        .text('Official FFSP scores are calculated by U.S. Ski and Snowboard and are subject to change.', { align: 'center' });
      doc.fillColor('black').font('Helvetica');
    }

    const info = await fetchOfficialsAndCourseSpecs(meet.id, eventId);
    drawOfficialsCourseFooter(doc, info, event);
    stampFooter(doc);
    doc.end();
  } catch (e) {
    console.error('dual-results PDF error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ===========================================================================
// Shared bracket helpers — used by dual-bracket and bracket-keeper
// ===========================================================================

const BRACKET_SQL = `SELECT db.*,
  ab.first_name as blue_first, ab.last_name as blue_last, rb.bib_number as blue_bib,
  ar.first_name as red_first,  ar.last_name as red_last,  rr.bib_number as red_bib,
  rb.dual_seed as blue_dual_seed, rr.dual_seed as red_dual_seed
 FROM dual_bracket db
 LEFT JOIN registrations rb ON rb.id = db.registration_id_blue
 LEFT JOIN athletes ab      ON ab.id = rb.athlete_id
 LEFT JOIN registrations rr ON rr.id = db.registration_id_red
 LEFT JOIN athletes ar      ON ar.id = rr.athlete_id
 WHERE db.event_id = ?
 ORDER BY db.bracket_round DESC, db.bracket_position`;

function parseBracketData(bracket, runoffOption) {
  const mainMatches  = bracket.filter(m => !m.is_small_final);
  const consolMatches = bracket
    .filter(m => m.is_small_final)
    .sort((a, b) => b.bracket_round - a.bracket_round || a.bracket_position - b.bracket_position);
  const totalRound = Math.max(...mainMatches.map(m => m.bracket_round));
  const finalsRound = (runoffOption === 'runoff_to_8th' && totalRound >= 3) ? 3 : 2;
  const qualRounds = [];
  for (let r = totalRound; r > finalsRound; r--) qualRounds.push(r);
  const finalsRounds = [];
  for (let r = finalsRound; r >= 1; r--) finalsRounds.push(r);
  return { mainMatches, consolMatches, totalRound, finalsRound, qualRounds, finalsRounds };
}

function buildBracketPairings(event, mainMatches, consolMatches, qualRounds, finalsRounds, runoffOption) {
  const genderPrefix = normalizeGender(event.gender) === 'F' ? 'W' : 'M';
  const pairingNums = new Map();
  let pNum = 0;
  function addMainRoundPairings(round) {
    const rm = mainMatches
      .filter(m => m.bracket_round === round && !m.is_bye)
      .sort((a, b) => a.bracket_position - b.bracket_position);
    for (const m of rm) { pNum++; pairingNums.set(m.id, pNum); }
  }
  for (const r of qualRounds) addMainRoundPairings(r);
  if (runoffOption === 'runoff_to_8th' && finalsRounds.includes(3)) {
    addMainRoundPairings(3);
    if (consolMatches[2]) { pNum++; pairingNums.set(consolMatches[2].id, pNum); }
    addMainRoundPairings(2);
    if (consolMatches[1]) { pNum++; pairingNums.set(consolMatches[1].id, pNum); }
    if (consolMatches[0]) { pNum++; pairingNums.set(consolMatches[0].id, pNum); }
    addMainRoundPairings(1);
  } else {
    for (const r of finalsRounds) {
      addMainRoundPairings(r);
      if (r === 2 && consolMatches[0]) { pNum++; pairingNums.set(consolMatches[0].id, pNum); }
    }
  }
  function pairingLabel(match) {
    const n = pairingNums.get(match.id);
    if (n == null) return null;
    return `${genderPrefix}-${String(n).padStart(2, '0')}`;
  }
  return pairingLabel;
}

function buildBracketPositions(rounds, seedMatches, colW, boxW, colX0, areaTop, areaH, allMain, bracketTotal, boxH) {
  const pos = {};
  if (!rounds.length || !seedMatches.length) return pos;
  const firstRound = rounds[0];
  pos[firstRound] = {};
  const n   = seedMatches.length;
  const gap = n > 1 ? (areaH - n * boxH) / (n + 1) : 0;
  const startY = n > 1 ? areaTop + gap : areaTop + (areaH - boxH) / 2;
  seedMatches.forEach((m, i) => {
    const x = colX0;
    const y = startY + i * (boxH + gap);
    pos[firstRound][m.bracket_position] = { x, y, centerY: y + boxH / 2, rightX: x + 2 + boxW };
  });
  for (let ci = 1; ci < rounds.length; ci++) {
    const round     = rounds[ci];
    const prevRound = rounds[ci - 1];
    pos[round]      = {};
    const colX      = colX0 + ci * colW;
    const seedPositions = seedMatches.map(m => m.bracket_position);
    const roundOffset   = bracketTotal - round;
    const divisor       = Math.pow(2, roundOffset);
    const posMin        = Math.ceil(Math.min(...seedPositions) / divisor);
    const posMax        = Math.ceil(Math.max(...seedPositions) / divisor);
    const rMatches = allMain
      .filter(m => m.bracket_round === round && m.bracket_position >= posMin && m.bracket_position <= posMax)
      .sort((a, b) => a.bracket_position - b.bracket_position);
    for (const m of rMatches) {
      const f1 = pos[prevRound]?.[2 * m.bracket_position - 1];
      const f2 = pos[prevRound]?.[2 * m.bracket_position];
      const centerY = (f1 && f2) ? (f1.centerY + f2.centerY) / 2 : f1 ? f1.centerY : f2 ? f2.centerY : areaTop + areaH / 2;
      const y = centerY - boxH / 2;
      pos[round][m.bracket_position] = { x: colX, y, centerY, rightX: colX + 2 + boxW };
    }
  }
  return pos;
}

function drawBracketConnectors(doc, rounds, pos, connectorColor) {
  for (let ci = 0; ci < rounds.length - 1; ci++) {
    const curRound  = rounds[ci];
    const nextRound = rounds[ci + 1];
    for (const [nextPosStr, nextLoc] of Object.entries(pos[nextRound] || {})) {
      const nextPos = parseInt(nextPosStr);
      const f1 = pos[curRound]?.[2 * nextPos - 1];
      const f2 = pos[curRound]?.[2 * nextPos];
      if (!f1 || !f2) continue;
      const midX    = (f1.rightX + nextLoc.x + 2) / 2;
      const parentY = (f1.centerY + f2.centerY) / 2;
      doc.moveTo(f1.rightX, f1.centerY).lineTo(midX, f1.centerY).strokeColor(connectorColor).lineWidth(0.7).stroke();
      doc.moveTo(f2.rightX, f2.centerY).lineTo(midX, f2.centerY).strokeColor(connectorColor).lineWidth(0.7).stroke();
      doc.moveTo(midX, f1.centerY).lineTo(midX, f2.centerY).strokeColor(connectorColor).lineWidth(0.7).stroke();
      doc.moveTo(midX, parentY).lineTo(nextLoc.x + 2, parentY).strokeColor(connectorColor).lineWidth(0.7).stroke();
    }
  }
}

function roundLabel(round) {
  return round === 1 ? 'Championship Final'
       : round === 2 ? 'Semifinals'
       : round === 3 ? 'Quarterfinals'
       : `Round of ${Math.pow(2, round)}`;
}

function drawBracketSection(doc, rounds, pos, allMain, colW, boxW, areaTop, drawMatchFn, colors) {
  drawBracketConnectors(doc, rounds, pos, colors.connector);
  const drawnLabels = new Set();
  for (let ci = 0; ci < rounds.length; ci++) {
    const round  = rounds[ci];
    const rLabel = roundLabel(round);
    for (const [posStr, loc] of Object.entries(pos[round] || {})) {
      const bPos = parseInt(posStr);
      const m = allMain.find(mm => mm.bracket_round === round && mm.bracket_position === bPos);
      if (!m) continue;
      drawMatchFn(m, loc.x + 2, loc.y, boxW, m._places || {});
      if (!drawnLabels.has(round)) {
        drawnLabels.add(round);
        doc.fillColor(colors.label).fontSize(7).font('Helvetica-Bold')
          .text(rLabel, loc.x + 2, areaTop - 12, { width: boxW, align: 'center' });
      }
    }
  }
}

function renderBracketPages(doc, bk, drawHeaderFn, drawMatchFn, colors, layout) {
  const { mainMatches, consolMatches, totalRound, finalsRound, qualRounds, finalsRounds } = bk;
  const { MARG, UW, BOX_H } = layout;
  let BKTOP, BKH, firstPage = true;

  if (qualRounds.length > 0) {
    const firstRoundMatches = mainMatches
      .filter(m => m.bracket_round === totalRound)
      .sort((a, b) => a.bracket_position - b.bracket_position);
    const N = firstRoundMatches.length;
    const numHalves = N <= 8 ? 1 : N <= 16 ? 2 : 4;
    const halfSize  = Math.ceil(N / numHalves);
    const colW = UW / qualRounds.length;
    const boxW = colW - 16;
    for (let hi = 0; hi < numHalves; hi++) {
      if (!firstPage) addPageWithFooter(doc);
      firstPage = false;
      const halfMatches = firstRoundMatches.slice(hi * halfSize, (hi + 1) * halfSize);
      const partLabel   = numHalves > 1 ? ` — Part ${hi + 1} of ${numHalves}` : '';
      const hdr = drawHeaderFn(`Road to Semi-Finals${partLabel}`);
      BKTOP = hdr.BKTOP; BKH = hdr.BKH;
      const pos = buildBracketPositions(qualRounds, halfMatches, colW, boxW, MARG, BKTOP, BKH, mainMatches, totalRound, BOX_H);
      drawBracketSection(doc, qualRounds, pos, mainMatches, colW, boxW, BKTOP, drawMatchFn, colors);
    }
  }

  // Finals page
  if (!firstPage) addPageWithFooter(doc);
  const finalsPageLabel = finalsRound === 3
    ? 'Finals — Quarterfinals through Championship'
    : 'Finals — Semifinals through Championship';
  const hdr = drawHeaderFn(finalsPageLabel);
  BKTOP = hdr.BKTOP; BKH = hdr.BKH;

  const mainH    = Math.floor(BKH * 0.65);
  const consolTop = BKTOP + mainH + 14;
  const fColW = UW / finalsRounds.length;
  const fBoxW = fColW - 16;

  const finFirstMatches = mainMatches
    .filter(m => m.bracket_round === finalsRound)
    .sort((a, b) => a.bracket_position - b.bracket_position);

  const fPos = buildBracketPositions(finalsRounds, finFirstMatches, fColW, fBoxW, MARG, BKTOP, mainH, mainMatches, totalRound, BOX_H);
  drawBracketSection(doc, finalsRounds, fPos, mainMatches, fColW, fBoxW, BKTOP, drawMatchFn, colors);

  // Consolation matches
  if (consolMatches.length > 0) {
    doc.moveTo(MARG, consolTop - 6).lineTo(MARG + UW, consolTop - 6)
      .strokeColor(colors.connector).lineWidth(0.4).stroke();
    doc.fillColor(colors.label).fontSize(7).font('Helvetica-Bold')
      .text('Consolation', MARG, consolTop - 4, { width: UW, align: 'center' });
    const consolLabels = ['3rd / 4th Place', '5th / 6th Place', '7th / 8th Place'];
    const cW = UW / consolMatches.length;
    consolMatches.forEach((m, i) => {
      const cx  = MARG + i * cW + 4;
      const cw  = cW - 8;
      const lbl = consolLabels[i] || `Place ${i * 2 + 3} / ${i * 2 + 4}`;
      doc.fillColor(colors.label).fontSize(7).font('Helvetica-Bold')
        .text(lbl, cx, consolTop + 8, { width: cw, align: 'center' });
      drawMatchFn(m, cx, consolTop + 20, cw);
    });
  }
}

// Compact horizontal-tree renderer used by /dual-bracket.
// Page split: 16-athletes -> 1 page, 32 -> 2 pages, 64 -> 3 pages.
function renderCompactBracketPages(doc, bk, drawHeaderFn, drawMatchFn, colors, layout) {
  const { mainMatches, consolMatches, totalRound } = bk;
  const { MARG, UW, BOX_H, runoffOption } = layout;
  const ORDINAL = ['1st','2nd','3rd','4th','5th','6th','7th','8th'];

  // Annotate the Championship Final with per-side place strings (1st/2nd) so
  // drawBracketSection picks them up via m._places. Only when complete.
  const finalMatch = mainMatches.find(m => m.bracket_round === 1 && !m.is_small_final);
  if (finalMatch && finalMatch.status === 'complete' && !finalMatch.is_bye && finalMatch.winner_registration_id) {
    const blueWon = finalMatch.winner_registration_id === finalMatch.registration_id_blue;
    finalMatch._places = blueWon
      ? { bluePlace: '1st', redPlace: '2nd' }
      : { bluePlace: '2nd', redPlace: '1st' };
  }

  const compactLabel = (round) => round === 1 ? 'Final'
    : round === 2 ? 'Semifinals'
    : round === 3 ? 'Quarterfinals'
    : `Round of ${Math.pow(2, round)}`;

  function computePages() {
    if (totalRound <= 4) {
      const all = [];
      for (let r = totalRound; r >= 1; r--) all.push(r);
      return [{ rounds: all, splitHalves: false, hasConsol: true }];
    }
    if (totalRound === 5) {
      return [
        { rounds: [5, 4], splitHalves: false, hasConsol: false },
        { rounds: [3, 2, 1], splitHalves: false, hasConsol: true },
      ];
    }
    if (totalRound === 6) {
      return [
        { rounds: [6], splitHalves: true,  hasConsol: false },
        { rounds: [5, 4], splitHalves: false, hasConsol: false },
        { rounds: [3, 2, 1], splitHalves: false, hasConsol: true },
      ];
    }
    const pages = [];
    for (let r = totalRound; r >= 4; r -= 2) {
      const numMatches = Math.pow(2, r - 1);
      if (numMatches > 16) {
        pages.push({ rounds: [r], splitHalves: true, hasConsol: false });
      } else {
        const pageRounds = [r];
        if (r - 1 >= 4) pageRounds.push(r - 1);
        pages.push({ rounds: pageRounds, splitHalves: false, hasConsol: false });
      }
    }
    pages.push({ rounds: [3, 2, 1], splitHalves: false, hasConsol: true });
    return pages;
  }

  const pages = computePages();
  const totalPages = pages.length;
  let firstPage = true;

  for (let pi = 0; pi < pages.length; pi++) {
    const { rounds, splitHalves, hasConsol } = pages[pi];
    if (!firstPage) addPageWithFooter(doc);
    firstPage = false;

    const subtitle = totalPages === 1
      ? 'Complete Bracket'
      : rounds.length === 1
        ? compactLabel(rounds[0])
        : `${compactLabel(rounds[0])} \u2192 ${compactLabel(rounds[rounds.length - 1])}`;

    const hdr = drawHeaderFn(subtitle);
    const { BKTOP, BKH } = hdr;

    const showConsol = hasConsol && consolMatches.length > 0;
    const mainH = BKH;
    let finalPos = null;
    let finalBoxW = null;

    if (splitHalves) {
      const round = rounds[0];
      const allFirst = mainMatches
        .filter(m => m.bracket_round === round)
        .sort((a, b) => a.bracket_position - b.bracket_position);
      const halfSize = Math.ceil(allFirst.length / 2);
      const halves = [allFirst.slice(0, halfSize), allFirst.slice(halfSize)];
      const halfW = (UW - 12) / 2;
      const halfBoxW = halfW - 16;
      for (let hi = 0; hi < 2; hi++) {
        const halfX = MARG + hi * (halfW + 12);
        const n = halves[hi].length;
        const gap = n > 1 ? (mainH - n * BOX_H) / (n + 1) : 0;
        const startY = n > 1 ? BKTOP + gap : BKTOP + (mainH - BOX_H) / 2;
        halves[hi].forEach((m, i) => {
          const y = startY + i * (BOX_H + gap);
          drawMatchFn(m, halfX + 2, y, halfBoxW);
        });
      }
      doc.fillColor(colors.label).fontSize(7).font('Helvetica-Bold')
        .text(roundLabel(round), MARG, BKTOP - 12, { width: UW, align: 'center' });
    } else {
      const colW = UW / rounds.length;
      const boxW = colW - 16;
      const seedMatches = mainMatches
        .filter(m => m.bracket_round === rounds[0])
        .sort((a, b) => a.bracket_position - b.bracket_position);
      const pos = buildBracketPositions(rounds, seedMatches, colW, boxW, MARG, BKTOP, mainH, mainMatches, totalRound, BOX_H);
      drawBracketSection(doc, rounds, pos, mainMatches, colW, boxW, BKTOP, drawMatchFn, colors);
      const finalRound = rounds[rounds.length - 1];
      finalPos = pos[finalRound]?.[1] || null;
      finalBoxW = boxW;
    }

    if (showConsol && finalPos) {
      const consolLabels = ['3rd / 4th Place', '5th / 6th Place', '7th / 8th Place'];
      const cx = finalPos.x;
      const cw = finalBoxW;
      const labelH = 10;
      const interGap = 8;
      const firstGap = 14;
      let y = finalPos.y + BOX_H + firstGap;
      consolMatches.forEach((m, i) => {
        const lbl = consolLabels[i] || `Place ${i * 2 + 3} / ${i * 2 + 4}`;
        doc.fillColor(colors.label).fontSize(7).font('Helvetica-Bold')
          .text(lbl, cx, y, { width: cw, align: 'center' });
        let opts = {};
        const includeThis = i === 0 || runoffOption === 'runoff_to_8th';
        if (includeThis && m.status === 'complete' && !m.is_bye && m.winner_registration_id) {
          const placeBase = 3 + i * 2;  // 3, 5, 7
          const blueWon = m.winner_registration_id === m.registration_id_blue;
          opts = blueWon
            ? { bluePlace: ORDINAL[placeBase - 1], redPlace: ORDINAL[placeBase] }
            : { bluePlace: ORDINAL[placeBase],     redPlace: ORDINAL[placeBase - 1] };
        }
        drawMatchFn(m, cx, y + labelH, cw, opts);
        y += labelH + BOX_H + interGap;
      });
    }
  }
}

// ===========================================================================
// POST /api/pdf/dual-bracket  — FIS-style bracket tree
// ===========================================================================
router.post('/dual-bracket', async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const { eventId } = req.body;

    const { event, meet } = await fetchEventMeet(eventId);
    const runoffOption = event.runoff_option || 'runoff_to_4th';

    const bracket = await queryAll(BRACKET_SQL, [eventId]);
    if (!bracket.length) {
      return res.status(400).json({ error: 'No bracket data found for this event' });
    }

    // Fetch judge point splits for all completed matches (for score display on bracket)
    const completedMatchIds = bracket.filter(m => m.status === 'complete' && !m.is_bye).map(m => m.id);
    const matchScores = {};  // match_id → { blueTotal, redTotal, splitStr }
    if (completedMatchIds.length > 0) {
      const { calcDualMogulPointSplit } = require('../scoring/engine');
      const allJudgePoints = await queryAll(
        `SELECT * FROM dual_judge_points WHERE match_id IN (${completedMatchIds.map(() => '?').join(',')}) ORDER BY match_id, judge_number`,
        completedMatchIds
      );
      // Group by match_id
      const byMatch = {};
      for (const jp of allJudgePoints) {
        if (!byMatch[jp.match_id]) byMatch[jp.match_id] = [];
        byMatch[jp.match_id].push(jp);
      }
      for (const [matchId, rows] of Object.entries(byMatch)) {
        const judgeScoresForCalc = rows.map(r => ({
          judgeNumber: r.judge_number, bluePoints: r.blue_points, redPoints: r.red_points, timeTied: !!r.time_tied,
        }));
        const split = calcDualMogulPointSplit(judgeScoresForCalc);
        // Build split string: #++#+#+#=## (skip J4 if time tied with 0/0)
        const parts = [];
        for (const r of rows) {
          if (r.time_tied) continue; // skip time tied J4 (0/0)
          parts.push(r.blue_points != null ? r.blue_points : 0);
        }
        const blueSplitStr = parts.join('+') + '=' + split.blueTotal;
        const redParts = [];
        for (const r of rows) {
          if (r.time_tied) continue;
          redParts.push(r.red_points != null ? r.red_points : 0);
        }
        const redSplitStr = redParts.join('+') + '=' + split.redTotal;
        matchScores[matchId] = { blueTotal: split.blueTotal, redTotal: split.redTotal, blueSplitStr, redSplitStr };
      }
    }

    const bk = parseBracketData(bracket, runoffOption);
    const { mainMatches, consolMatches, totalRound, finalsRound, qualRounds, finalsRounds } = bk;
    const pairingLabel = buildBracketPairings(event, mainMatches, consolMatches, qualRounds, finalsRounds, runoffOption);

    // PDF setup — landscape letter
    const doc = new PDFDocument({
      size: 'LETTER',
      layout: 'landscape',
      margins: { top: 36, bottom: 36, left: 36, right: 36 }
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="${safeFilename(event, 'dual_bracket')}"`);
    doc.pipe(res);

    // Colors
    const NAVY  = '#1a3a6b';
    const BLUE  = '#2563eb';
    const RED   = '#dc2626';
    const LBLUE = '#eff6ff';
    const LRED  = '#fef2f2';
    const GRAY  = '#64748b';
    const LGRAY = '#e2e8f0';

    // Medal coloring for finals-stage place annotations
    const ORDINAL = ['1st','2nd','3rd','4th','5th','6th','7th','8th'];
    const MEDAL_COLORS = {
      '1st': '#d4af37', '2nd': '#a8a8a8', '3rd': '#b8732e',
      '4th': GRAY, '5th': GRAY, '6th': GRAY, '7th': GRAY, '8th': GRAY,
    };

    // Layout constants (landscape letter = 792 × 612)
    const MARG     = 36;
    const PW       = 792;
    const PH       = 612;
    const UW       = PW - 2 * MARG;   // 720
    const BAR_W    = 4;                // colored course-indicator bar
    const ROW_H    = 11;               // height of one athlete row (compact)
    const BOX_H    = ROW_H * 2;       // height of one match box (2 rows)

    function drawHeader(subtitle) {
      doc.y = MARG;
      pdfHeader(doc, meet, event, 'Dual Mogul Bracket');
      doc.fontSize(7.5).fillColor('#64748b')
        .text(subtitle, MARG, doc.y, { width: UW, align: 'center' });
      doc.fillColor('#000');
      doc.moveDown(0.3);
      const BKTOP = doc.y + 14;
      const BKH = PH - MARG - BKTOP;
      return { BKTOP, BKH };
    }

    // -----------------------------------------------------------------------
    // drawAthleteRow — one half of a match box
    // -----------------------------------------------------------------------
    function drawAthleteRow(x, y, w, course, first, last, bib, isWinner, isTBD, scoreStr, loserStatus, place) {
      const barClr = course === 'blue' ? BLUE : RED;
      const bgClr  = isTBD    ? '#f8fafc'
                   : isWinner ? (course === 'blue' ? '#bfdbfe' : '#fecaca')  // darker winner bg
                   :             (course === 'blue' ? LBLUE : LRED);

      // Background fill
      doc.rect(x, y, w, ROW_H).fillColor(bgClr).fill();
      // Course color bar on left edge
      doc.rect(x, y, BAR_W, ROW_H).fillColor(barClr).fill();
      // Border
      doc.rect(x, y, w, ROW_H).strokeColor(LGRAY).lineWidth(0.3).stroke();

      if (isTBD) {
        doc.fillColor('#94a3b8').fontSize(6).font('Helvetica')
          .text('TBD', x + BAR_W + 3, y + (ROW_H - 6) / 2, { width: w - BAR_W - 6 });
        return;
      }
      const bibStr  = bib  ? String(bib)  : '—';
      const nameStr = (last || first)
        ? `${(last || '').toUpperCase()}, ${first || ''}`
        : '—';
      const bibX    = x + BAR_W + 3;
      const bibW    = 18;
      const nameX   = bibX + bibW + 3;
      const scoreW  = scoreStr ? 45 : (loserStatus ? 22 : 0);
      // When a final-place medal is shown, reserve a fixed slot to the left of
      // the score column so place labels line up vertically across all rows.
      const placeW    = place ? 22 : 0;
      const placeGap  = place ? 8  : 0;
      const scoreRsv  = place ? 45 : scoreW;
      const nameW   = w - BAR_W - bibW - 10 - scoreRsv - placeGap - placeW;
      const textY   = y + (ROW_H - 7) / 2;

      doc.fillColor(isWinner ? NAVY : GRAY).fontSize(7)
        .font('Helvetica-Bold')
        .text(bibStr, bibX, textY, { width: bibW, align: 'right' });
      doc.fillColor(isWinner ? NAVY : GRAY)
        .font(isWinner ? 'Helvetica-Bold' : 'Helvetica')
        .text(nameStr, nameX, textY, { width: nameW, ellipsis: true, lineBreak: false });

      // Score or loser status on right side
      if (scoreStr) {
        doc.fillColor(isWinner ? NAVY : '#94a3b8').fontSize(5.5)
          .font(isWinner ? 'Helvetica-Bold' : 'Helvetica')
          .text(scoreStr, x + w - scoreW - 3, y + ROW_H - 8, { width: scoreW, align: 'right', lineBreak: false });
      } else if (loserStatus) {
        doc.fillColor('#94a3b8').fontSize(6).font('Helvetica-Bold')
          .text(loserStatus, x + w - scoreW - 3, textY, { width: scoreW, align: 'right', lineBreak: false });
      }

      // Final-place medal annotation (1st/2nd/3rd/4th, etc.) — right-aligned at
      // a fixed offset from the box right edge so labels line up vertically
      // across all rows in the finals column regardless of name length or
      // whether the row shows a real score (45pt) or a DNF/DNS/DSQ tag (22pt).
      if (place) {
        const placeColor = MEDAL_COLORS[place] || GRAY;
        const placeRightX = x + w - 45 - placeGap;  // left of max scoreW reserve
        const placeX      = placeRightX - placeW;
        doc.fillColor(placeColor).font('Helvetica-Bold').fontSize(7)
          .text(place, placeX, textY, { width: placeW, align: 'right', lineBreak: false });
      }
    }

    // -----------------------------------------------------------------------
    // drawMatch — draw the two-row match box at (x, y) with given width
    // -----------------------------------------------------------------------
    function drawMatch(m, x, y, w, opts = {}) {
      const done    = m.status === 'complete';
      const blueWon = done && m.winner_registration_id === m.registration_id_blue;
      const redWon  = done && m.winner_registration_id === m.registration_id_red;
      const blueTBD = !m.registration_id_blue;
      const redTBD  = !m.registration_id_red;
      const bluePlace = opts.bluePlace || null;
      const redPlace  = opts.redPlace  || null;

      // Get score data for completed matches
      const sc = done ? matchScores[m.id] : null;
      const blueScore = sc ? sc.blueSplitStr : null;
      const redScore  = sc ? sc.redSplitStr  : null;
      // Loser status (DNF/DNS/DSQ) for non-scored matches
      const blueLost = done && !blueWon;
      const redLost  = done && !redWon;
      const blueLoserStatus = blueLost && m.loser_status && !sc ? m.loser_status : null;
      const redLoserStatus  = redLost  && m.loser_status && !sc ? m.loser_status : null;

      if (m.is_bye) {
        drawAthleteRow(x, y, w, 'blue', null, 'BYE', m.blue_bib, false, false);
        doc.rect(x, y + ROW_H, w, ROW_H).fillColor('#f1f5f9').fill();
        doc.rect(x, y + ROW_H, w, ROW_H).strokeColor(LGRAY).lineWidth(0.3).stroke();
      } else {
        const redOnTop = !m.is_small_final && (totalRound - m.bracket_round) % 2 === 1;
        const topCourse  = redOnTop ? 'red'  : 'blue';
        const botCourse  = redOnTop ? 'blue' : 'red';
        const topFirst   = redOnTop ? m.red_first  : m.blue_first;
        const topLast    = redOnTop ? m.red_last   : m.blue_last;
        const topBib     = redOnTop ? m.red_bib    : m.blue_bib;
        const topWon     = redOnTop ? redWon       : blueWon;
        const topTBD     = redOnTop ? redTBD       : blueTBD;
        const topScore   = redOnTop ? redScore     : blueScore;
        const topLoser   = redOnTop ? redLoserStatus  : blueLoserStatus;
        const topPlace   = redOnTop ? redPlace        : bluePlace;
        const botFirst   = redOnTop ? m.blue_first : m.red_first;
        const botLast    = redOnTop ? m.blue_last  : m.red_last;
        const botBib     = redOnTop ? m.blue_bib   : m.red_bib;
        const botWon     = redOnTop ? blueWon      : redWon;
        const botTBD     = redOnTop ? blueTBD      : redTBD;
        const botScore   = redOnTop ? blueScore    : redScore;
        const botLoser   = redOnTop ? blueLoserStatus : redLoserStatus;
        const botPlace   = redOnTop ? bluePlace       : redPlace;
        drawAthleteRow(x, y,        w, topCourse, topFirst, topLast, topBib, topWon, topTBD, topScore, topLoser, topPlace);
        drawAthleteRow(x, y + ROW_H, w, botCourse, botFirst, botLast, botBib, botWon, botTBD, botScore, botLoser, botPlace);
      }

      // Pairing number — just above the match box (compact layout has no
      // room inside the row without colliding with the per-row score).
      const lbl = pairingLabel(m);
      if (lbl) {
        doc.fillColor(NAVY).fontSize(5.5).font('Helvetica-Bold')
          .text(lbl, x, y - 7, { width: w - 3, align: 'right' });
      }
    }

    const colors = { connector: '#94a3b8', label: NAVY };
    renderCompactBracketPages(doc, bk, drawHeader, drawMatch, colors, { MARG, UW, BOX_H, runoffOption });

    stampFooter(doc);
    doc.end();
  } catch (e) {
    console.error('dual-bracket PDF error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ===========================================================================
// POST /api/pdf/bracket-keeper  — B&W bracket for spectators to follow along
// ===========================================================================
router.post('/bracket-keeper', async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const { eventId } = req.body;

    const { event, meet } = await fetchEventMeet(eventId);
    const runoffOption = event.runoff_option || 'runoff_to_4th';

    const bracket = await queryAll(BRACKET_SQL, [eventId]);
    if (!bracket.length) {
      return res.status(400).json({ error: 'No bracket data found for this event' });
    }

    const bk = parseBracketData(bracket, runoffOption);
    const { mainMatches, consolMatches, totalRound, qualRounds, finalsRounds } = bk;
    const pairingLabel = buildBracketPairings(event, mainMatches, consolMatches, qualRounds, finalsRounds, runoffOption);

    const doc = new PDFDocument({
      size: 'LETTER',
      layout: 'landscape',
      margins: { top: 36, bottom: 36, left: 36, right: 36 }
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="${safeFilename(event, 'bracket_keeper')}"`);
    doc.pipe(res);

    const BK_BLACK = '#000000';
    const BK_GRAY  = '#666666';
    const MARG     = 36;
    const PW       = 792;
    const PH       = 612;
    const UW       = PW - 2 * MARG;
    const ROW_H    = 22;
    const BOX_H    = ROW_H * 2;

    function drawHeader(subtitle) {
      doc.y = MARG;
      pdfHeader(doc, meet, event, 'Bracket Keeper');
      doc.fontSize(7.5).fillColor(BK_GRAY)
        .text(subtitle, MARG, doc.y, { width: UW, align: 'center' });
      doc.fillColor(BK_BLACK);
      doc.moveDown(0.3);
      const BKTOP = doc.y + 14;
      const BKH = PH - MARG - BKTOP;
      return { BKTOP, BKH };
    }

    function drawBKRow(x, y, w, course, first, last, bib, isTBD) {
      doc.rect(x, y, w, ROW_H).fillColor('#ffffff').fill();
      doc.rect(x, y, w, ROW_H).strokeColor(BK_BLACK).lineWidth(0.5).stroke();
      const innerX = x + 4;
      const innerW = w - 8;
      if (isTBD || (!first && !last)) {
        const courseLabel = course === 'blue' ? 'Blue' : 'Red';
        doc.fillColor(BK_GRAY).fontSize(5).font('Helvetica')
          .text(courseLabel, innerX, y + ROW_H - 7, { width: innerW, lineBreak: false });
      } else {
        const bibStr  = bib ? String(bib) : '';
        const nameStr = `${(last || '').toUpperCase()}, ${first || ''}`;
        doc.fillColor(BK_BLACK).fontSize(7.5).font('Helvetica-Bold')
          .text(bibStr, innerX, y + 3, { continued: true, lineBreak: false });
        doc.font('Helvetica')
          .text(`  ${nameStr}`, { lineBreak: false });
        const courseLabel = course === 'blue' ? 'Blue' : 'Red';
        doc.fillColor(BK_GRAY).fontSize(5).font('Helvetica')
          .text(courseLabel, innerX, y + ROW_H - 7, { width: innerW, lineBreak: false });
      }
    }

    function drawBKMatch(m, x, y, w) {
      const blueTBD = !m.registration_id_blue;
      const redTBD  = !m.registration_id_red;
      if (m.is_bye) {
        drawBKRow(x, y, w, 'blue', null, 'BYE', m.blue_bib, false);
        doc.rect(x, y + ROW_H, w, ROW_H).fillColor('#ffffff').fill();
        doc.rect(x, y + ROW_H, w, ROW_H).strokeColor(BK_BLACK).lineWidth(0.5).stroke();
      } else {
        const redOnTop = !m.is_small_final && (totalRound - m.bracket_round) % 2 === 1;
        if (redOnTop) {
          drawBKRow(x, y,         w, 'red',  m.red_first,  m.red_last,  m.red_bib,  redTBD);
          drawBKRow(x, y + ROW_H, w, 'blue', m.blue_first, m.blue_last, m.blue_bib, blueTBD);
        } else {
          drawBKRow(x, y,         w, 'blue', m.blue_first, m.blue_last, m.blue_bib, blueTBD);
          drawBKRow(x, y + ROW_H, w, 'red',  m.red_first,  m.red_last,  m.red_bib,  redTBD);
        }
      }
      const lbl = pairingLabel(m);
      if (lbl) {
        doc.fillColor(BK_BLACK).fontSize(6).font('Helvetica-Bold')
          .text(lbl, x, y + 1, { width: w - 3, align: 'right' });
      }
    }

    const colors = { connector: '#999999', label: BK_BLACK };
    renderBracketPages(doc, bk, drawHeader, drawBKMatch, colors, { MARG, UW, BOX_H });

    stampFooter(doc);
    doc.end();
  } catch (e) {
    console.error('bracket-keeper PDF error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ===========================================================================
// POST /api/pdf/group-awards
// ===========================================================================
router.post('/group-awards', async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const { eventId, groups = [] } = req.body;

    if (!groups.length) return res.status(400).json({ error: 'groups array required' });

    const { event, meet } = await fetchEventMeet(eventId);

    // Fetch all completed runs with full athlete info
    const runs = await queryAll(
      `SELECT r.*, reg.id as registration_id, reg.bib_number, reg.seed,
              a.first_name, a.last_name, a.ussa_num, a.club, a.birth_year, a.gender,
              e.division
       FROM runs r
       JOIN registrations reg ON reg.id = r.registration_id
       JOIN athletes a ON a.id = reg.athlete_id
       JOIN events e ON e.id = r.event_id
       WHERE r.event_id=? AND r.status='complete'`,
      [eventId]
    );

    // Best run per athlete
    const best = pickBestRun(runs, event.discipline);
    const allResults = Object.values(best).filter(r => r.total_score != null);

    // Build per-group results
    const groupResults = groups.map(g => {
      const { label, filter = {} } = g;
      const filtered = allResults.filter(r => {
        if (filter.genderCode) {
          const ag = (r.gender || '').toUpperCase();
          if (ag !== filter.genderCode.toUpperCase()) return false;
        }
        if (filter.divisionContains) {
          const div = (r.division || '').toLowerCase();
          if (!div.includes(filter.divisionContains.toLowerCase())) return false;
        }
        if (filter.birthYearMin) {
          if (!r.birth_year || parseInt(r.birth_year) < parseInt(filter.birthYearMin)) return false;
        }
        if (filter.birthYearMax) {
          if (!r.birth_year || parseInt(r.birth_year) > parseInt(filter.birthYearMax)) return false;
        }
        return true;
      });

      const sorted = filtered.sort((a, b) => b.total_score - a.total_score);
      const top3   = sorted.slice(0, 3).map((r, i) => ({ ...r, place: i + 1 }));
      return { label, top3, total: sorted.length };
    });

    // Build PDF
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 36, bottom: 36, left: 54, right: 54 }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="${safeFilename(event, 'group_awards')}"`);
    doc.pipe(res);

    const NAVY  = '#1a3a6b';
    const GOLD  = '#b8860b';
    const SILV  = '#6b6b6b';
    const BRNZ  = '#7a4200';
    const GRAY  = '#64748b';
    const LGRAY = '#e2e8f0';
    const GREEN = '#16a34a';
    const pageW = doc.page.width - 108;

    const placeColor = p => p === 1 ? GOLD : p === 2 ? SILV : p === 3 ? BRNZ : GRAY;
    const placeLabel = p => p === 1 ? '1st' : p === 2 ? '2nd' : p === 3 ? '3rd' : `${p}th`;

    // Cover header
    doc.fillColor(NAVY).fontSize(18).font('Helvetica-Bold')
      .text(meet.name, 54, 36, { width: pageW, align: 'center' });
    doc.fillColor(GRAY).fontSize(12).font('Helvetica')
      .text(`${event.name} -- Group Awards`, 54, 58, { width: pageW, align: 'center' });
    const today = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
    doc.fillColor(GRAY).fontSize(9)
      .text(`Generated ${today}`, 54, 76, { width: pageW, align: 'center' });

    let curY = 100;

    for (const grp of groupResults) {
      // Check if we need a new page
      const blockH = 28 + (grp.top3.length * 36) + 20;
      if (curY + blockH > doc.page.height - 36) {
        addPageWithFooter(doc);
        curY = 36;
      }

      // Group header bar
      doc.rect(54, curY, pageW, 22).fill(NAVY);
      doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold')
        .text(grp.label, 60, curY + 5, { width: pageW - 12 });
      doc.fillColor(LGRAY).fontSize(9).font('Helvetica')
        .text(`${grp.total} athletes`, 54, curY + 5, { width: pageW - 6, align: 'right' });
      curY += 26;

      if (!grp.top3.length) {
        doc.fillColor(GRAY).fontSize(10).font('Helvetica')
          .text('No results found for this group.', 60, curY + 4);
        curY += 24;
      } else {
        for (const r of grp.top3) {
          const rowH    = 32;
          const bgColor = r.place % 2 === 0 ? '#f8fafc' : '#ffffff';
          doc.rect(54, curY, pageW, rowH).fill(bgColor);

          // Place medal circle
          const cx = 76, cy = curY + rowH / 2;
          doc.circle(cx, cy, 11).fillAndStroke(placeColor(r.place), placeColor(r.place));
          doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold')
            .text(placeLabel(r.place), cx - 11, cy - 7, { width: 22, align: 'center' });

          // Athlete info
          doc.fillColor('#1e293b').fontSize(11).font('Helvetica-Bold')
            .text(`${r.last_name}, ${r.first_name}`, 96, curY + 4, { width: 220 });
          doc.fillColor(GRAY).fontSize(9).font('Helvetica')
            .text(`Bib #${r.bib_number || '--'}  |  ${r.club || ''}`, 96, curY + 18, { width: 220 });

          // Score
          doc.fillColor(NAVY).fontSize(13).font('Helvetica-Bold')
            .text(r.total_score != null ? Number(r.total_score).toFixed(2) : '--',
              54 + pageW - 70, curY + 8, { width: 60, align: 'right' });

          // Thin divider
          doc.moveTo(54, curY + rowH).lineTo(54 + pageW, curY + rowH).strokeColor(LGRAY).lineWidth(0.5).stroke();
          curY += rowH;
        }
      }
      curY += 14;
    }

    // Footer on last page -- StickIt brand: "Stick" black, "It" red
    {
      doc.fontSize(8).font('Helvetica');
      const stickW = doc.widthOfString('Stick');
      const itW    = doc.widthOfString('It');
      const totalW = stickW + itW;
      const startX = 54 + (pageW - totalW) / 2;
      const yFoot  = doc.page.height - 30;
      doc.fillColor('#000000').text('Stick', startX, yFoot, { lineBreak: false });
      doc.fillColor('#EF4444').text('It', startX + stickW, yFoot, { lineBreak: false });
      doc.fillColor(GRAY);
    }

    doc.end();
  } catch (e) {
    console.error('group-awards PDF error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ===========================================================================
// POST /api/pdf/upload-logo/:meetId — Upload event/meet logo
// ===========================================================================
router.post('/upload-logo/:meetId', logoUpload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No valid image file provided. Use PNG or JPEG.' });
  res.json({ ok: true, filename: req.file.filename });
});

// DELETE /api/pdf/logo/:meetId — Remove uploaded meet logo
router.delete('/logo/:meetId', (req, res) => {
  const logoPath = getMeetLogoPath(req.params.meetId);
  if (logoPath) {
    fs.unlinkSync(logoPath);
    res.json({ ok: true });
  } else {
    res.json({ ok: true, message: 'No logo found' });
  }
});

// GET /api/pdf/logo/:meetId — Check if meet logo exists
router.get('/logo/:meetId', (req, res) => {
  const logoPath = getMeetLogoPath(req.params.meetId);
  res.json({ hasLogo: !!logoPath });
});

// ---------------------------------------------------------------------------
// TD Report — fillable PDF using pdf-lib
// POST /api/pdf/td-report   body: { meetId }
// ---------------------------------------------------------------------------
router.post('/td-report', async (req, res) => {
  try {
    const { meetId } = req.body;
    if (!meetId) return res.status(400).json({ error: 'meetId required' });

    const { PDFDocument: PDFLibDoc, StandardFonts, rgb } = require('pdf-lib');

    const meet = await queryOne('SELECT * FROM meets WHERE id=?', [meetId]);
    if (!meet) return res.status(404).json({ error: 'Meet not found' });

    const events = await queryAll(
      `SELECT e.*, (SELECT COUNT(*) FROM registrations r WHERE r.event_id=e.id) as athlete_count
       FROM events e WHERE e.meet_id=? ORDER BY e.event_date, e.created_at`, [meetId]
    );
    // Fetch event-level officials (with fallback to meet-level for legacy meets)
    let allEventOfficials = await queryAll(
      `SELECT o.*, e.discipline, e.gender, e.id as evt_id
       FROM officials o JOIN events e ON o.event_id = e.id
       WHERE o.meet_id=? AND o.event_id IS NOT NULL AND o.event_id != ''
       ORDER BY e.event_date, e.created_at, o.role`, [meetId]
    );
    if (allEventOfficials.length === 0) {
      // Fallback: use meet-level officials for legacy meets
      allEventOfficials = await queryAll(
        `SELECT * FROM officials WHERE meet_id=? AND (event_id IS NULL OR event_id='') ORDER BY role`, [meetId]
      );
    }
    const courseSpecs = await queryAll(
      'SELECT * FROM course_specs WHERE meet_id=? ORDER BY rowid', [meetId]
    );
    const judges = await queryAll(
      `SELECT j.name, j.role, j.ussa_id, e.discipline, e.gender, e.id as event_id FROM judges j
       JOIN events e ON j.event_id=e.id WHERE e.meet_id=?
       ORDER BY e.event_date, e.created_at, j.role`, [meetId]
    );

    // Build event code abbreviations
    const hasMogul = events.some(e => e.discipline === 'mogul');
    const hasDual = events.some(e => e.discipline === 'dual_mogul');
    const hasAerials = events.some(e => e.discipline === 'aerials');
    const isDivisional = events.some(e => e.is_divisional);

    // USSS codes grouped by gender with discipline suffix
    const discAbbr = (d) => d === 'dual_mogul' ? 'DM' : d === 'aerials' ? 'A' : 'M';
    const femaleEvents = events.filter(e => e.gender === 'F');
    const maleEvents = events.filter(e => e.gender === 'M');
    const womenCodesList = femaleEvents.map(e => e.usss_code ? `${e.usss_code} ${discAbbr(e.discipline)}` : null).filter(Boolean);
    const menCodesList = maleEvents.map(e => e.usss_code ? `${e.usss_code} ${discAbbr(e.discipline)}` : null).filter(Boolean);

    // Competitor counts by discipline
    const competitorsByEvent = events.map(e => {
      const gLabel = e.gender === 'F' ? 'F' : 'M';
      return { date: e.event_date || meet.date, name: e.name, count: `${gLabel}=${e.athlete_count || 0}` };
    });
    // Group by discipline for M=/F= format
    const disciplineGroups = {};
    for (const e of events) {
      const key = e.discipline + '_' + (e.event_date || meet.date);
      if (!disciplineGroups[key]) disciplineGroups[key] = { date: e.event_date || meet.date, name: e.name, m: 0, f: 0 };
      if (e.gender === 'M') disciplineGroups[key].m = e.athlete_count || 0;
      else disciplineGroups[key].f = e.athlete_count || 0;
      // Use the name from the first event found (strip gender prefix for cleaner display)
      if (!disciplineGroups[key].displayName) {
        disciplineGroups[key].displayName = e.name.replace(/^(Comp Series |Devo |RQS\/EQS )?(Male |Female )?/, '');
      }
    }
    const eventRows = Object.values(disciplineGroups);

    // Build merged officials map: role → formatted string
    // Group by role, primary = first event, alternates = officials with different names from other events
    const firstEventId = events.length > 0 ? events[0].id : null;
    const mergedOfficials = new Map();
    function fmtName(o) {
      let s = o.name || '';
      if (o.ussa_id) s += ' ' + o.ussa_id;
      return s;
    }
    for (const o of allEventOfficials) {
      const evtId = o.evt_id || null; // null for meet-level fallback
      if (!mergedOfficials.has(o.role)) {
        mergedOfficials.set(o.role, { primary: o, alternates: [] });
      } else if (evtId && evtId !== firstEventId) {
        const entry = mergedOfficials.get(o.role);
        // Only add if name is different from primary
        if (o.name !== entry.primary.name) {
          // Avoid duplicate alternates
          if (!entry.alternates.some(a => a.name === o.name)) {
            entry.alternates.push(o);
          }
        }
      }
    }
    function fmtMergedOfficial(role) {
      const entry = mergedOfficials.get(role);
      if (!entry) return '';
      const hasAlternates = entry.alternates.length > 0;
      if (!hasAlternates) return fmtName(entry.primary);
      // Show primary with discipline tag, then alternates
      const pDisc = entry.primary.discipline ? ` [${discAbbr(entry.primary.discipline)}]` : '';
      let s = fmtName(entry.primary) + pDisc;
      for (const alt of entry.alternates) {
        const aDisc = alt.discipline ? ` [${discAbbr(alt.discipline)}]` : '';
        s += ' / ' + fmtName(alt) + aDisc;
      }
      return s;
    }
    const findMergedOfficial = (role) => mergedOfficials.has(role) ? fmtMergedOfficial(role) : '';

    // --- Build PDF ---
    const pdfDoc = await PDFLibDoc.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const form = pdfDoc.getForm();

    const W = 612, H = 792; // Letter
    const ML = 36, MR = 36, MT = 36;
    const PW = W - ML - MR; // page width usable

    // ===================== PAGE 1 =====================
    const p1 = pdfDoc.addPage([W, H]);
    let y = H - MT;

    // --- USSS Logo ---
    try {
      const logoBytes = fs.readFileSync(USSS_LOGO);
      const logoImg = await pdfDoc.embedPng(logoBytes);
      const logoH = 50;
      const logoW = logoH * (logoImg.width / logoImg.height);
      p1.drawImage(logoImg, { x: ML, y: y - logoH, width: logoW, height: logoH });
    } catch (_) { /* logo not found — skip */ }

    // --- Title ---
    y -= 20;
    const title = 'USSS Freestyle Technical Delegate Report';
    const titleW = bold.widthOfTextAtSize(title, 13);
    p1.drawText(title, { x: (W - titleW) / 2, y, font: bold, size: 13, color: rgb(0, 0, 0) });
    y -= 12;

    // Submission instructions
    const instrText = 'The TD is responsible for electronically completing this form and sending it to USSS and the event organizer.';
    const instrW = font.widthOfTextAtSize(instrText, 6.5);
    p1.drawText(instrText, { x: (W - instrW) / 2, y, font, size: 6.5, color: rgb(0, 0, 0) });
    y -= 8;
    const instr2 = 'Send to: USSS Freestyle Head TD, ResultPackets@ussa.org, Organizing Committee, Division Head TD';
    const instr2W = font.widthOfTextAtSize(instr2, 6.5);
    p1.drawText(instr2, { x: (W - instr2W) / 2, y, font, size: 6.5, color: rgb(0, 0, 0) });
    y -= 16;

    // Helper: draw a labeled row with static text or fillable field
    const FS = 9;
    const FIELD_H = 16;
    const LINE_H = 20;

    function drawLabelValue(page, label, value, lx, ly, lw, vw) {
      page.drawText(label, { x: lx, y: ly + 3, font: bold, size: FS, color: rgb(0, 0, 0) });
      if (value) {
        page.drawText(String(value), { x: lx + lw, y: ly + 3, font, size: FS, color: rgb(0, 0, 0) });
      }
    }

    function addTextField(name, x, y, w, h, value) {
      const tf = form.createTextField(name);
      if (value) tf.setText(String(value));
      tf.addToPage(p1, { x, y: y - 2, width: w, height: h || FIELD_H, borderWidth: 0.5, borderColor: rgb(0.7, 0.7, 0.7) });
      return tf;
    }

    function addTextFieldOnPage(page, name, x, y, w, h, value) {
      const tf = form.createTextField(name);
      if (value) tf.setText(String(value));
      tf.addToPage(page, { x, y: y - 2, width: w, height: h || FIELD_H, borderWidth: 0.5, borderColor: rgb(0.7, 0.7, 0.7) });
      return tf;
    }

    // --- Competition Info ---
    // Row 1: NAME OF COMPETITION
    const boxY = y;
    p1.drawRectangle({ x: ML, y: y - 30, width: PW, height: 30, borderWidth: 0.5, borderColor: rgb(0, 0, 0), color: rgb(1, 1, 1) });
    p1.drawText('NAME OF COMPETITION', { x: ML + 4, y: y - 12, font: bold, size: 8, color: rgb(0, 0, 0) });
    p1.drawText(meet.name || '', { x: ML + 4, y: y - 26, font, size: 10, color: rgb(0, 0, 0) });
    y -= 30;

    // Row 2: TYPE OF COMPETITION | DATE | WOMEN Event Code
    const r2h = 30;
    p1.drawRectangle({ x: ML, y: y - r2h, width: PW * 0.35, height: r2h, borderWidth: 0.5, borderColor: rgb(0, 0, 0), color: rgb(1, 1, 1) });
    p1.drawText('TYPE OF COMPETITION', { x: ML + 4, y: y - 12, font: bold, size: 7, color: rgb(0, 0, 0) });
    const compTypes = [];
    if (hasMogul) compTypes.push('Moguls');
    if (hasDual) compTypes.push('Dual Moguls');
    if (hasAerials) compTypes.push('Aerials');
    if (isDivisional) compTypes.push('DIC');
    const compType = compTypes.join(', ');
    addTextField('type_of_competition', ML + 4, y - r2h + 2, PW * 0.35 - 8, 14, compType);

    p1.drawRectangle({ x: ML + PW * 0.35, y: y - r2h, width: PW * 0.40, height: r2h, borderWidth: 0.5, borderColor: rgb(0, 0, 0), color: rgb(1, 1, 1) });
    p1.drawText('DATE', { x: ML + PW * 0.35 + 4, y: y - 12, font: bold, size: 7, color: rgb(0, 0, 0) });
    p1.drawText(meet.date || '', { x: ML + PW * 0.35 + 4, y: y - 26, font, size: 9, color: rgb(0, 0, 0) });

    p1.drawRectangle({ x: ML + PW * 0.75, y: y - r2h, width: PW * 0.25, height: r2h, borderWidth: 0.5, borderColor: rgb(0, 0, 0), color: rgb(1, 1, 1) });
    p1.drawText('WOMEN', { x: ML + PW * 0.75 + 4, y: y - 10, font: bold, size: 7, color: rgb(0, 0, 0) });
    p1.drawText('Event Code', { x: ML + PW * 0.75 + 4, y: y - 19, font, size: 7, color: rgb(0, 0, 0) });
    if (womenCodesList.length > 0) {
      const mid = Math.ceil(womenCodesList.length / 2);
      p1.drawText(womenCodesList.slice(0, mid).join('  '), { x: ML + PW * 0.75 + 50, y: y - 10, font, size: 6.5, color: rgb(0, 0, 0) });
      if (womenCodesList.length > mid) {
        p1.drawText(womenCodesList.slice(mid).join('  '), { x: ML + PW * 0.75 + 50, y: y - 20, font, size: 6.5, color: rgb(0, 0, 0) });
      }
    }
    y -= r2h;

    // Row 3: SKI AREA | DIVISION | MEN Event Code
    p1.drawRectangle({ x: ML, y: y - r2h, width: PW * 0.35, height: r2h, borderWidth: 0.5, borderColor: rgb(0, 0, 0), color: rgb(1, 1, 1) });
    p1.drawText('SKI AREA', { x: ML + 4, y: y - 12, font: bold, size: 7, color: rgb(0, 0, 0) });
    p1.drawText(meet.location || '', { x: ML + 4, y: y - 26, font, size: 9, color: rgb(0, 0, 0) });

    p1.drawRectangle({ x: ML + PW * 0.35, y: y - r2h, width: PW * 0.40, height: r2h, borderWidth: 0.5, borderColor: rgb(0, 0, 0), color: rgb(1, 1, 1) });
    p1.drawText('DIVISION', { x: ML + PW * 0.35 + 4, y: y - 12, font: bold, size: 7, color: rgb(0, 0, 0) });
    addTextField('division', ML + PW * 0.35 + 4, y - r2h + 2, PW * 0.40 - 8, 14, meet.meet_ranking || '');

    p1.drawRectangle({ x: ML + PW * 0.75, y: y - r2h, width: PW * 0.25, height: r2h, borderWidth: 0.5, borderColor: rgb(0, 0, 0), color: rgb(1, 1, 1) });
    p1.drawText('MEN', { x: ML + PW * 0.75 + 4, y: y - 10, font: bold, size: 7, color: rgb(0, 0, 0) });
    p1.drawText('Event Code', { x: ML + PW * 0.75 + 4, y: y - 19, font, size: 7, color: rgb(0, 0, 0) });
    if (menCodesList.length > 0) {
      const mid = Math.ceil(menCodesList.length / 2);
      p1.drawText(menCodesList.slice(0, mid).join('  '), { x: ML + PW * 0.75 + 50, y: y - 10, font, size: 6.5, color: rgb(0, 0, 0) });
      if (menCodesList.length > mid) {
        p1.drawText(menCodesList.slice(mid).join('  '), { x: ML + PW * 0.75 + 50, y: y - 20, font, size: 6.5, color: rgb(0, 0, 0) });
      }
    }
    y -= r2h;

    // --- Officials ---
    y -= 8;
    const offLabelW = 140;
    const offFieldW = PW - offLabelW;
    const offRoles = [
      { label: 'Technical Delegate', role: 'Technical Delegate' },
      { label: '     Assistant', role: null },
      { label: 'Chief of Competition', role: 'Chief of Competition' },
      { label: '     Assistant', role: null },
      { label: 'Head Judge', role: 'Head Judge' },
      { label: 'Chief of Scoring', role: 'Chief of Score' },
      { label: '     Assistant', role: null },
    ];

    for (let i = 0; i < offRoles.length; i++) {
      const or = offRoles[i];
      p1.drawText(or.label, { x: ML, y: y - 10, font, size: 9, color: rgb(0, 0, 0) });
      const offVal = or.role ? findMergedOfficial(or.role) : '';
      const fieldName = 'official_' + i;
      addTextField(fieldName, ML + offLabelW, y - 14, offFieldW, FIELD_H, offVal);
      y -= LINE_H;
    }

    // --- Events Schedule Table ---
    y -= 8;
    const colWidths = [PW * 0.12, PW * 0.30, PW * 0.17, PW * 0.17, PW * 0.24];
    const headers = ['DATE', 'EVENT', 'START TIME', 'FINISH TIME', '# OF\nCOMPETITORS'];
    const headerH = 22;

    // Header row
    let cx = ML;
    for (let c = 0; c < 5; c++) {
      p1.drawRectangle({ x: cx, y: y - headerH, width: colWidths[c], height: headerH, borderWidth: 0.5, borderColor: rgb(0, 0, 0), color: rgb(1, 1, 1) });
      const hText = headers[c].includes('\n') ? headers[c].split('\n') : [headers[c]];
      for (let hi = 0; hi < hText.length; hi++) {
        p1.drawText(hText[hi], { x: cx + 4, y: y - 10 - hi * 10, font: bold, size: 7.5, color: rgb(0, 0, 0) });
      }
      cx += colWidths[c];
    }
    y -= headerH;

    // Data rows (5 slots)
    const rowH = 26;
    for (let r = 0; r < 5; r++) {
      cx = ML;
      const ev = eventRows[r] || null;
      for (let c = 0; c < 5; c++) {
        p1.drawRectangle({ x: cx, y: y - rowH, width: colWidths[c], height: rowH, borderWidth: 0.5, borderColor: rgb(0, 0, 0), color: rgb(1, 1, 1) });
        cx += colWidths[c];
      }
      // Pre-fill known data
      if (ev) {
        p1.drawText(ev.date || '', { x: ML + 4, y: y - 14, font, size: 8, color: rgb(0, 0, 0) });
        p1.drawText(ev.displayName || ev.name || '', { x: ML + colWidths[0] + 4, y: y - 14, font, size: 8, color: rgb(0, 0, 0) });
        const compStr = `M=${ev.m}\nF=${ev.f}`;
        p1.drawText(`M=${ev.m}`, { x: ML + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 4, y: y - 10, font, size: 8, color: rgb(0, 0, 0) });
        p1.drawText(`F=${ev.f}`, { x: ML + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 4, y: y - 20, font, size: 8, color: rgb(0, 0, 0) });
      }
      // Fillable start/finish time fields
      addTextField(`start_time_${r}`, ML + colWidths[0] + colWidths[1] + 2, y - rowH + 4, colWidths[2] - 4, 18, '');
      addTextField(`finish_time_${r}`, ML + colWidths[0] + colWidths[1] + colWidths[2] + 2, y - rowH + 4, colWidths[3] - 4, 18, '');
      y -= rowH;
    }

    // --- Comments section ---
    y -= 12;
    p1.drawText('COMMENTS', { x: ML, y, font: bold, size: 9, color: rgb(0, 0, 0) });
    y -= 4;
    p1.drawText('ORGANIZING COMMITTEE:', { x: ML, y: y - 14, font: bold, size: 9, color: rgb(0, 0, 0) });
    addTextField('organizing_committee', ML + 160, y - 18, PW - 160, FIELD_H, '');
    y -= LINE_H;

    p1.drawText('HOST AREA:', { x: ML, y: y - 14, font: bold, size: 9, color: rgb(0, 0, 0) });
    addTextField('host_area', ML + 80, y - 18, PW - 80, FIELD_H, '');
    y -= LINE_H;

    // Build judges summary from first event, noting differences from other events
    const firstEventJudges = judges.filter(j => j.event_id === firstEventId);
    const otherEventJudges = judges.filter(j => j.event_id !== firstEventId);
    let judgesStr = firstEventJudges.map(j => `${j.role}: ${j.name}${j.ussa_id ? ' ' + j.ussa_id : ''}`).join('\n');
    // Find judges in other events with different names for the same role
    const diffs = [];
    for (const oj of otherEventJudges) {
      const match = firstEventJudges.find(fj => fj.role === oj.role);
      if (!match || match.name !== oj.name) {
        if (!diffs.some(d => d.role === oj.role && d.name === oj.name)) {
          const evName = events.find(e => e.id === oj.event_id);
          diffs.push({ role: oj.role, name: oj.name, disc: evName ? discAbbr(evName.discipline) : '' });
        }
      }
    }
    if (diffs.length > 0) {
      judgesStr += '\nDiff: ' + diffs.map(d => `${d.role}: ${d.name} [${d.disc}]`).join(', ');
    }
    p1.drawText('JUDGES:', { x: ML, y: y - 14, font: bold, size: 9, color: rgb(0, 0, 0) });
    y -= LINE_H;
    const jField = form.createTextField('judges_comment');
    jField.enableMultiline();
    if (judgesStr) jField.setText(judgesStr);
    jField.addToPage(p1, { x: ML, y: y - 80, width: PW, height: 80, borderWidth: 0.5, borderColor: rgb(0.7, 0.7, 0.7) });
    y -= 96;

    // --- Attachments ---
    p1.drawText('ATTACHMENTS:', { x: ML, y, font: bold, size: 9, color: rgb(0, 0, 0) });
    const cbLabels = ['ACCIDENT', 'JURY DECISION', 'PROTEST', 'DISCIPLINE'];
    let cbX = ML + 100;
    for (const lbl of cbLabels) {
      p1.drawText(lbl, { x: cbX + 16, y, font, size: 8, color: rgb(0, 0, 0) });
      const cb = form.createCheckBox('attach_' + lbl.toLowerCase().replace(/\s+/g, '_'));
      cb.addToPage(p1, { x: cbX, y: y - 3, width: 12, height: 12 });
      cbX += font.widthOfTextAtSize(lbl, 8) + 40;
    }

    // ===================== PAGE 2: Course Specifications =====================
    const p2 = pdfDoc.addPage([W, H]);
    y = H - MT;

    // Title
    const csTitle = 'COURSE SPECIFICATIONS';
    const csTitleW = bold.widthOfTextAtSize(csTitle, 12);
    p2.drawText(csTitle, { x: (W - csTitleW) / 2, y, font: bold, size: 12, color: rgb(0, 0, 0) });
    p2.moveTo((W - csTitleW) / 2, y - 2);
    y -= 20;

    // Course spec data
    const cs = courseSpecs[0] || {};
    const moTrail = cs.course_name || '';
    const moLength = cs.length_m ? `${cs.length_m}` : '';
    const moWidth = cs.width_m ? `${cs.width_m}` : '';
    const moPitch = cs.pitch_deg ? `${cs.pitch_deg}` : '';
    // Use same values for dual moguls column if only one course spec
    const cs2 = courseSpecs[1] || cs;
    const dmTrail = cs2.course_name || moTrail;
    const dmLength = cs2.length_m ? `${cs2.length_m}` : moLength;
    const dmWidth = cs2.width_m ? `${cs2.width_m}` : moWidth;
    const dmPitch = cs2.pitch_deg ? `${cs2.pitch_deg}` : moPitch;

    // Table layout
    const labelCol = PW * 0.36;
    const moCol = PW * 0.32;
    const dmCol = PW * 0.32;
    const tRowH = 22;

    function drawCsRow(page, yPos, label, moVal, dmVal, unit, fillable, fieldBaseName) {
      // Label cell
      page.drawRectangle({ x: ML, y: yPos - tRowH, width: labelCol, height: tRowH, borderWidth: 0.5, borderColor: rgb(0, 0, 0), color: rgb(1, 1, 1) });
      page.drawText(label, { x: ML + 4, y: yPos - 14, font, size: 8, color: rgb(0, 0, 0) });

      // Moguls cell
      page.drawRectangle({ x: ML + labelCol, y: yPos - tRowH, width: moCol, height: tRowH, borderWidth: 0.5, borderColor: rgb(0, 0, 0), color: rgb(1, 1, 1) });
      if (fillable) {
        addTextFieldOnPage(page, fieldBaseName + '_mo', ML + labelCol + 4, yPos - tRowH + 2, moCol * 0.6, 14, moVal || '');
        if (unit) page.drawText(unit, { x: ML + labelCol + moCol * 0.65, y: yPos - 14, font, size: 7, color: rgb(0.4, 0.4, 0.4) });
      } else {
        const displayVal = moVal ? `${moVal} ${unit || ''}` : '';
        page.drawText(displayVal, { x: ML + labelCol + 4, y: yPos - 14, font, size: 9, color: rgb(0, 0, 0) });
      }

      // Dual Moguls cell
      page.drawRectangle({ x: ML + labelCol + moCol, y: yPos - tRowH, width: dmCol, height: tRowH, borderWidth: 0.5, borderColor: rgb(0, 0, 0), color: rgb(1, 1, 1) });
      if (fillable) {
        addTextFieldOnPage(page, fieldBaseName + '_dm', ML + labelCol + moCol + 4, yPos - tRowH + 2, dmCol * 0.6, 14, dmVal || '');
        if (unit) page.drawText(unit, { x: ML + labelCol + moCol + dmCol * 0.65, y: yPos - 14, font, size: 7, color: rgb(0.4, 0.4, 0.4) });
      } else {
        const displayVal = dmVal ? `${dmVal} ${unit || ''}` : '';
        page.drawText(displayVal, { x: ML + labelCol + moCol + 4, y: yPos - 14, font, size: 9, color: rgb(0, 0, 0) });
      }

      return yPos - tRowH;
    }

    // Header row
    p2.drawRectangle({ x: ML, y: y - tRowH, width: labelCol, height: tRowH, borderWidth: 0.5, borderColor: rgb(0, 0, 0), color: rgb(0.9, 0.9, 0.9) });
    p2.drawRectangle({ x: ML + labelCol, y: y - tRowH, width: moCol, height: tRowH, borderWidth: 0.5, borderColor: rgb(0, 0, 0), color: rgb(0.9, 0.9, 0.9) });
    p2.drawText('MOGULS', { x: ML + labelCol + moCol / 2 - 20, y: y - 14, font: bold, size: 9, color: rgb(0, 0, 0) });
    p2.drawRectangle({ x: ML + labelCol + moCol, y: y - tRowH, width: dmCol, height: tRowH, borderWidth: 0.5, borderColor: rgb(0, 0, 0), color: rgb(0.9, 0.9, 0.9) });
    p2.drawText('DUAL MOGULS', { x: ML + labelCol + moCol + dmCol / 2 - 32, y: y - 14, font: bold, size: 9, color: rgb(0, 0, 0) });
    y -= tRowH;

    // Data rows
    y = drawCsRow(p2, y, 'NAME OF TRAIL', moTrail, dmTrail, '', false, 'trail');
    y = drawCsRow(p2, y, 'LENGTH OF COURSE', moLength, dmLength, 'Meters', false, 'length');
    y = drawCsRow(p2, y, 'WIDTH OF COURSE (between panels)', moWidth, dmWidth, 'Meters', false, 'width');
    y = drawCsRow(p2, y, 'INCLINATION', moPitch, dmPitch, 'Degrees', false, 'incl');

    // Air site rows (fillable — not tracked in StickIt)
    // Landing pad length: Jump 1 and Jump 2 sub-columns for each
    const airRows = [
      'MOGUL AIR SITE landing pad length',
      'MOGUL AIR SITE landing pad steepness',
      'MOGUL AIR Take off angle/Height',
    ];
    for (let i = 0; i < airRows.length; i++) {
      const label = airRows[i];
      // Each row has 4 sub-fields: MO Jump1, MO Jump2, DM Jump1, DM Jump2
      p2.drawRectangle({ x: ML, y: y - tRowH, width: labelCol, height: tRowH, borderWidth: 0.5, borderColor: rgb(0, 0, 0), color: rgb(1, 1, 1) });
      p2.drawText(label, { x: ML + 4, y: y - 14, font, size: 7, color: rgb(0, 0, 0) });

      const subW = moCol / 2;
      // Moguls Jump 1 & 2
      p2.drawRectangle({ x: ML + labelCol, y: y - tRowH, width: subW, height: tRowH, borderWidth: 0.5, borderColor: rgb(0, 0, 0), color: rgb(1, 1, 1) });
      p2.drawText('Jump 1', { x: ML + labelCol + 2, y: y - 8, font, size: 6, color: rgb(0.4, 0.4, 0.4) });
      addTextFieldOnPage(p2, `air_${i}_mo_j1`, ML + labelCol + 2, y - tRowH + 1, subW - 4, 12, '');

      p2.drawRectangle({ x: ML + labelCol + subW, y: y - tRowH, width: subW, height: tRowH, borderWidth: 0.5, borderColor: rgb(0, 0, 0), color: rgb(1, 1, 1) });
      p2.drawText('Jump 2', { x: ML + labelCol + subW + 2, y: y - 8, font, size: 6, color: rgb(0.4, 0.4, 0.4) });
      addTextFieldOnPage(p2, `air_${i}_mo_j2`, ML + labelCol + subW + 2, y - tRowH + 1, subW - 4, 12, '');

      // DM Jump 1 & 2
      const dmSubW = dmCol / 2;
      p2.drawRectangle({ x: ML + labelCol + moCol, y: y - tRowH, width: dmSubW, height: tRowH, borderWidth: 0.5, borderColor: rgb(0, 0, 0), color: rgb(1, 1, 1) });
      p2.drawText('Jump 1', { x: ML + labelCol + moCol + 2, y: y - 8, font, size: 6, color: rgb(0.4, 0.4, 0.4) });
      addTextFieldOnPage(p2, `air_${i}_dm_j1`, ML + labelCol + moCol + 2, y - tRowH + 1, dmSubW - 4, 12, '');

      p2.drawRectangle({ x: ML + labelCol + moCol + dmSubW, y: y - tRowH, width: dmSubW, height: tRowH, borderWidth: 0.5, borderColor: rgb(0, 0, 0), color: rgb(1, 1, 1) });
      p2.drawText('Jump 2', { x: ML + labelCol + moCol + dmSubW + 2, y: y - 8, font, size: 6, color: rgb(0.4, 0.4, 0.4) });
      addTextFieldOnPage(p2, `air_${i}_dm_j2`, ML + labelCol + moCol + dmSubW + 2, y - tRowH + 1, dmSubW - 4, 12, '');

      y -= tRowH;
    }

    // --- Safety Issues ---
    y -= 16;
    p2.drawText('SAFETY ISSUES OR PROBLEMS WITH ANY VENUES', { x: ML, y, font: bold, size: 9, color: rgb(0, 0, 0) });
    y -= 6;
    const safetyField = form.createTextField('safety_issues');
    safetyField.enableMultiline();
    safetyField.addToPage(p2, { x: ML, y: y - 80, width: PW, height: 80, borderWidth: 0.5, borderColor: rgb(0.7, 0.7, 0.7) });

    // --- Serialize and send ---
    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="TD-Report-${(meet.name || 'meet').replace(/[^a-zA-Z0-9]/g, '_')}.pdf"`);
    res.send(Buffer.from(pdfBytes));

  } catch (e) {
    console.error('TD Report error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
