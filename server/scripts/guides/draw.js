// Drawn-diagram primitives for the quick start guides: flow rows, numbered
// steps, callouts, simplified tablet mockups, chips, URL bars.
const { COLORS, PAGE, PAGE_W, CONTENT_W } = require('./style');

const LEFT = PAGE.margins.left;

function roundedBox(doc, x, y, w, h, { fill = null, stroke = COLORS.blueSoft, radius = 8, lineWidth = 1.5 } = {}) {
  doc.save().lineWidth(lineWidth);
  if (fill && stroke) doc.roundedRect(x, y, w, h, radius).fillAndStroke(fill, stroke);
  else if (fill) doc.roundedRect(x, y, w, h, radius).fill(fill);
  else doc.roundedRect(x, y, w, h, radius).strokeColor(stroke).stroke();
  doc.restore();
}

// Box with centered (possibly multi-line) label.
function labelBox(doc, x, y, w, h, lines, { fill = COLORS.blueBg, stroke = COLORS.blueSoft, color = COLORS.navy, fontSize = 10.5, bold = true } = {}) {
  roundedBox(doc, x, y, w, h, { fill, stroke });
  const arr = Array.isArray(lines) ? lines : [lines];
  const lh = fontSize * 1.25;
  let ty = y + h / 2 - (arr.length * lh) / 2 + 1.5;
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).fillColor(color);
  for (const line of arr) {
    doc.text(line, x + 4, ty, { width: w - 8, align: 'center', lineBreak: false });
    ty += lh;
  }
}

function arrow(doc, x1, y1, x2, y2, { color = COLORS.blue, width = 1.5, head = 6 } = {}) {
  doc.save().strokeColor(color).lineWidth(width).moveTo(x1, y1).lineTo(x2, y2).stroke();
  const ang = Math.atan2(y2 - y1, x2 - x1);
  doc.fillColor(color)
    .moveTo(x2, y2)
    .lineTo(x2 - head * Math.cos(ang - 0.45), y2 - head * Math.sin(ang - 0.45))
    .lineTo(x2 - head * Math.cos(ang + 0.45), y2 - head * Math.sin(ang + 0.45))
    .fill();
  doc.restore();
}

// Horizontal flow: boxes joined by right-arrows, centered in the content area.
// labels: array of string | string[] (multi-line). Returns bottom y.
function flowRow(doc, y, labels, { boxH = 46, gap = 24, fontSize = 10 } = {}) {
  const n = labels.length;
  const boxW = (CONTENT_W - gap * (n - 1)) / n;
  let x = LEFT;
  labels.forEach((label, idx) => {
    labelBox(doc, x, y, boxW, boxH, label, { fontSize });
    if (idx < n - 1) {
      arrow(doc, x + boxW + 3, y + boxH / 2, x + boxW + gap - 3, y + boxH / 2);
    }
    x += boxW + gap;
  });
  return y + boxH;
}

// Vertical flow: boxes joined by down-arrows. Returns bottom y.
function flowColumn(doc, y, labels, { boxH = 42, gap = 20, boxW = CONTENT_W * 0.72, fontSize = 11 } = {}) {
  const x = LEFT + (CONTENT_W - boxW) / 2;
  labels.forEach((label, idx) => {
    labelBox(doc, x, y, boxW, boxH, label, { fontSize });
    if (idx < labels.length - 1) {
      arrow(doc, x + boxW / 2, y + boxH + 3, x + boxW / 2, y + boxH + gap - 3);
    }
    y += boxH + gap;
  });
  return y - gap + 4;
}

function stepCircle(doc, x, y, n, { r = 12, fill = COLORS.blue } = {}) {
  doc.circle(x, y, r).fill(fill);
  doc.font('Helvetica-Bold').fontSize(r).fillColor('#ffffff')
    .text(String(n), x - r, y - r * 0.58, { width: r * 2, align: 'center', lineBreak: false });
}

// Numbered step: circle + bold title + wrapped body. Returns new y.
function step(doc, y, n, title, body, { fontSize = 11 } = {}) {
  const textX = LEFT + 34;
  const textW = CONTENT_W - 34;
  stepCircle(doc, LEFT + 12, y + 10, n);
  doc.font('Helvetica-Bold').fontSize(fontSize + 1.5).fillColor(COLORS.navy)
    .text(title, textX, y, { width: textW });
  doc.y += 2;
  doc.font('Helvetica').fontSize(fontSize).fillColor(COLORS.ink)
    .text(body, textX, doc.y, { width: textW, lineGap: 2 });
  return doc.y + 12;
}

const CALLOUT_KINDS = {
  tip:     { bar: COLORS.blue,  bg: COLORS.blueBg,  word: 'TIP' },
  caution: { bar: COLORS.amber, bg: COLORS.amberBg, word: 'CAREFUL' },
  stop:    { bar: COLORS.red,   bg: COLORS.redBg,   word: 'IMPORTANT' },
  good:    { bar: COLORS.green, bg: COLORS.greenBg, word: 'GOOD TO KNOW' },
};

// Full-width callout box. Returns new y.
function callout(doc, y, text, { kind = 'tip', fontSize = 10.5 } = {}) {
  const k = CALLOUT_KINDS[kind] || CALLOUT_KINDS.tip;
  const pad = 10;
  doc.font('Helvetica-Bold').fontSize(9);
  const labelW = Math.max(doc.widthOfString(k.word) + 14, 50);
  const bodyX = LEFT + 12 + labelW;
  const bodyW = CONTENT_W - 12 - labelW - pad;
  doc.font('Helvetica').fontSize(fontSize);
  const bodyH = doc.heightOfString(text, { width: bodyW, lineGap: 1.5 });
  const h = Math.max(bodyH + pad * 2, 34);
  roundedBox(doc, LEFT, y, CONTENT_W, h, { fill: k.bg, stroke: k.bg, radius: 6 });
  doc.rect(LEFT, y, 4, h).fill(k.bar);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(k.bar)
    .text(k.word, LEFT + 12, y + pad + 1, { lineBreak: false });
  doc.font('Helvetica').fontSize(fontSize).fillColor(COLORS.ink)
    .text(text, bodyX, y + pad, { width: bodyW, lineGap: 1.5 });
  return y + h + 12;
}

// Vector checkmark (built-in fonts have no ✓ glyph). Returns nothing.
function check(doc, x, y, { size = 9, color = COLORS.green, width = 2 } = {}) {
  doc.save().strokeColor(color).lineWidth(width).lineCap('round')
    .moveTo(x, y + size * 0.55)
    .lineTo(x + size * 0.35, y + size * 0.9)
    .lineTo(x + size, y)
    .stroke().restore();
}

// Simplified device outline with a dark title bar. Returns the inner rect.
function tabletFrame(doc, x, y, w, h, { title = '' } = {}) {
  roundedBox(doc, x, y, w, h, { stroke: COLORS.navy, lineWidth: 2.5, radius: 10 });
  const barH = 22;
  doc.save();
  doc.roundedRect(x, y, w, barH + 10, 10).clip();
  doc.rect(x, y, w, barH).fill(COLORS.navyDeep);
  doc.restore();
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#ffffff')
    .text(title, x + 8, y + 6.5, { width: w - 16, align: 'center', lineBreak: false });
  return { x: x + 8, y: y + barH + 8, w: w - 16, h: h - barH - 16 };
}

// Small pill chip. Returns chip width.
function chip(doc, x, y, text, { fill = COLORS.blueBg, color = COLORS.navy, fontSize = 9.5, padX = 8, h = 17 } = {}) {
  doc.font('Helvetica-Bold').fontSize(fontSize);
  const w = doc.widthOfString(text) + padX * 2;
  doc.roundedRect(x, y, w, h, h / 2).fill(fill);
  doc.fillColor(color).text(text, x + padX, y + (h - fontSize) / 2 - 0.5, { lineBreak: false });
  return w;
}

// Simplified browser address bar.
function urlBar(doc, x, y, w, text) {
  roundedBox(doc, x, y, w, 26, { fill: '#f8fafc', stroke: COLORS.grayLight, radius: 13, lineWidth: 1 });
  doc.circle(x + 14, y + 13, 5).lineWidth(1.2).strokeColor(COLORS.gray).stroke();
  doc.font('Courier-Bold').fontSize(10.5).fillColor(COLORS.navy)
    .text(text, x + 28, y + 8, { width: w - 36, lineBreak: false });
  return y + 26;
}

// 3x4 calculator-order numpad sketch (7-8-9 top row). Returns bottom y.
function numpadSketch(doc, x, y, w, { keyH = 26, gap = 5 } = {}) {
  const rows = [['7', '8', '9'], ['4', '5', '6'], ['1', '2', '3'], ['', '0', '.']];
  const keyW = (w - gap * 2) / 3;
  for (const row of rows) {
    let kx = x;
    for (const key of row) {
      if (key !== '') {
        labelBox(doc, kx, y, keyW, keyH, key, { fill: '#f1f5f9', stroke: COLORS.grayLight, color: COLORS.ink, fontSize: 12 });
      }
      kx += keyW + gap;
    }
    y += keyH + gap;
  }
  return y - gap;
}

// Big page heading for quick-start pages.
function pageTitle(doc, text, { sub = null } = {}) {
  doc.font('Helvetica-Bold').fontSize(21).fillColor(COLORS.navy).text(text, LEFT, PAGE.margins.top, { width: CONTENT_W });
  if (sub) {
    doc.font('Helvetica').fontSize(11).fillColor(COLORS.gray).text(sub, LEFT, doc.y + 2, { width: CONTENT_W });
  }
  doc.moveTo(LEFT, doc.y + 8).lineTo(LEFT + CONTENT_W, doc.y + 8).lineWidth(1.5).strokeColor(COLORS.blueSoft).stroke();
  return doc.y + 20;
}

// Section sub-heading within a page. Returns new y.
function sectionTitle(doc, y, text, { color = COLORS.navy } = {}) {
  doc.font('Helvetica-Bold').fontSize(14).fillColor(color).text(text, LEFT, y, { width: CONTENT_W });
  return doc.y + 6;
}

// Plain body paragraph. Returns new y.
function body(doc, y, text, { fontSize = 11, width = CONTENT_W, x = LEFT } = {}) {
  doc.font('Helvetica').fontSize(fontSize).fillColor(COLORS.ink).text(text, x, y, { width, lineGap: 2.5 });
  return doc.y + 8;
}

module.exports = {
  LEFT, roundedBox, labelBox, arrow, flowRow, flowColumn, stepCircle, step,
  callout, check, tabletFrame, chip, urlBar, numpadSketch, pageTitle, sectionTitle, body,
};
