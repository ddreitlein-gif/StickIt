// Markdown -> pdfkit renderer for the Complete User Guide.
// Mirrors the exact dialect of client/src/help/MarkdownRenderer.jsx:
// h1-h4, paragraphs (consecutive-line joining), ul/ol with indented continuation
// lines, **bold**, *italic*, `code`, [text](url) links, > blockquote,
// --- hr, fenced ``` code blocks, and simple pipe tables.
const { COLORS, PAGE, CONTENT_W, BOTTOM_Y, ensureSpace } = require('./style');

const LEFT = PAGE.margins.left;

// The built-in PDF fonts only cover WinAnsi (CP1252). Map the Unicode symbols
// that appear in the help topics to printable equivalents.
const GLYPH_MAP = {
  '→': '›',  // → -> ›
  '←': '‹',  // ← -> ‹
  '↔': '‹›', // ↔
  '−': '-',       // Unicode minus
  '✓': '[yes]',   // ✓
  '✅': '[yes]',   // ✅
  '✗': '[no]',    // ✗
  '✕': 'x',       // ✕
  '≥': '>=',
  '▲': '(up)',    // ▲
  '▼': '(down)',  // ▼
  '▾': '',        // ▾ dropdown caret
  '▶': '›',  // ▶
  '◄': '‹',  // ◄
  '●': '•',  // ● -> bullet
  '✎': '(edit)',  // ✎
  '─': '-',       // box-drawing
  '├': '|-',
  '└': '`-',
  '\u{1F4CB}': '',     // 📋
  '\u{1F399}': '',     // 🎙
  '️': '',        // emoji variation selector
};
const GLYPH_RE = new RegExp(`[${Object.keys(GLYPH_MAP).join('')}]`, 'gu');
function sanitize(text) {
  return text.replace(GLYPH_RE, (ch) => GLYPH_MAP[ch] ?? '?');
}

// ── Inline tokenizer ─────────────────────────────────────────────────────────
// Returns flat runs: { text, bold, italic, code, link }
function tokenizeInline(text, inherited = {}) {
  const runs = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        runs.push({ ...inherited, text: text.slice(i + 1, end), code: true });
        i = end + 1;
        continue;
      }
    }
    if (text[i] === '[') {
      const closeBracket = text.indexOf(']', i + 1);
      if (closeBracket !== -1 && text[closeBracket + 1] === '(') {
        const closeParen = text.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          const linkText = text.slice(i + 1, closeBracket);
          const url = text.slice(closeBracket + 2, closeParen);
          runs.push(...tokenizeInline(linkText, { ...inherited, link: url }));
          i = closeParen + 1;
          continue;
        }
      }
    }
    if (text[i] === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end !== -1) {
        runs.push(...tokenizeInline(text.slice(i + 2, end), { ...inherited, bold: true }));
        i = end + 2;
        continue;
      }
    }
    if (text[i] === '*') {
      const end = text.indexOf('*', i + 1);
      if (end !== -1 && end !== i + 1) {
        runs.push(...tokenizeInline(text.slice(i + 1, end), { ...inherited, italic: true }));
        i = end + 1;
        continue;
      }
    }
    let next = i + 1;
    while (next < text.length && !['`', '[', '*'].includes(text[next])) next++;
    runs.push({ ...inherited, text: text.slice(i, next) });
    i = next;
  }
  return runs;
}

function plainText(runs) { return runs.map(r => r.text).join(''); }

function runFont(run) {
  if (run.code) return 'Courier';
  if (run.bold && run.italic) return 'Helvetica-BoldOblique';
  if (run.bold) return 'Helvetica-Bold';
  if (run.italic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

// Render runs as wrapped, mixed-style text starting at (x, doc.y) with given width.
// ctx.resolveLink(url) -> { goTo } | { link } | null
function renderRuns(doc, runs, { x = LEFT, width = CONTENT_W, fontSize = 10, color = COLORS.ink, lineGap = 2.5, ctx }) {
  if (!runs.length) { return; }
  doc.x = x; doc.y = doc.y; // anchor
  runs.forEach((run, idx) => {
    const last = idx === runs.length - 1;
    doc.font(runFont(run)).fontSize(run.code ? fontSize - 0.5 : fontSize);
    const opts = { width, lineGap, continued: !last, link: null, goTo: null, underline: false };
    let fill = color;
    if (run.link && ctx) {
      const target = ctx.resolveLink(run.link);
      if (target) Object.assign(opts, target);
      fill = COLORS.blue;
      opts.underline = !!(target && (target.link || target.goTo));
    } else if (run.code) {
      fill = COLORS.navy;
    }
    doc.fillColor(fill);
    if (idx === 0) doc.text(run.text, x, doc.y, opts);
    else doc.text(run.text, opts);
  });
}

function estHeight(doc, runs, { width = CONTENT_W, fontSize = 10, lineGap = 2.5 }) {
  doc.font('Helvetica').fontSize(fontSize);
  return doc.heightOfString(plainText(runs) || ' ', { width, lineGap });
}

// ── Block helpers ────────────────────────────────────────────────────────────

function heading(doc, text, { size, color = COLORS.navy, before = 14, after = 6, rule = false, destination = null, ctx }) {
  const runs = tokenizeInline(text);
  ensureSpace(doc, before + size + 40); // heading + ~3 lines of body
  doc.y += before;
  doc.font('Helvetica-Bold').fontSize(size).fillColor(color);
  const opts = { width: CONTENT_W };
  if (destination) opts.destination = destination;
  doc.text(plainText(runs), LEFT, doc.y, opts);
  if (rule) {
    doc.moveTo(LEFT, doc.y + 3).lineTo(LEFT + CONTENT_W, doc.y + 3).lineWidth(1).strokeColor(COLORS.blueSoft).stroke();
    doc.y += 8;
  }
  doc.y += after;
}

function paragraph(doc, text, ctx) {
  const runs = tokenizeInline(text);
  ensureSpace(doc, Math.min(estHeight(doc, runs, {}), 60));
  renderRuns(doc, runs, { ctx });
  doc.y += 7;
}

function listBlock(doc, items, ordered, ctx) {
  items.forEach((item, n) => {
    const runs = tokenizeInline(item);
    const indent = 20;
    ensureSpace(doc, Math.min(estHeight(doc, runs, { width: CONTENT_W - indent }), 60) + 3);
    const marker = ordered ? `${n + 1}.` : '•';
    const y0 = doc.y;
    doc.font(ordered ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(ordered ? COLORS.navy : COLORS.blue);
    doc.text(marker, LEFT + 2, y0, { lineBreak: false });
    doc.y = y0;
    renderRuns(doc, runs, { x: LEFT + indent, width: CONTENT_W - indent, ctx });
    doc.y += 4;
  });
  doc.y += 4;
}

function codeBlock(doc, codeLines) {
  const fontSize = 8.5;
  const lineH = fontSize * 1.35;
  const pad = 9;
  let i = 0;
  while (i < codeLines.length) {
    const available = BOTTOM_Y - doc.y - pad * 2 - 6;
    let fit = Math.floor(available / lineH);
    if (fit < 3 && doc.y > PAGE.margins.top + 50) { doc.addPage(); continue; }
    fit = Math.max(fit, 3);
    const chunk = codeLines.slice(i, i + fit);
    const boxH = chunk.length * lineH + pad * 2;
    doc.roundedRect(LEFT, doc.y, CONTENT_W, boxH, 5).fillAndStroke(COLORS.blueBg, COLORS.blueSoft);
    doc.font('Courier').fontSize(fontSize).fillColor(COLORS.navy);
    let y = doc.y + pad;
    for (const line of chunk) {
      doc.text(line, LEFT + pad, y, { width: CONTENT_W - pad * 2, lineBreak: false });
      y += lineH;
    }
    doc.y = y + pad;
    i += fit;
    if (i < codeLines.length) doc.addPage();
  }
  doc.y += 7;
}

function blockquote(doc, text, ctx) {
  const runs = tokenizeInline(text);
  const indent = 16;
  const h = estHeight(doc, runs, { width: CONTENT_W - indent });
  ensureSpace(doc, Math.min(h, 80) + 6);
  const y0 = doc.y;
  renderRuns(doc, runs, { x: LEFT + indent, width: CONTENT_W - indent, color: COLORS.gray, ctx });
  doc.rect(LEFT + 2, y0 - 1, 3, doc.y - y0 + 2).fill(COLORS.blueSoft);
  doc.y += 8;
}

function hr(doc) {
  ensureSpace(doc, 20);
  doc.y += 6;
  doc.moveTo(LEFT, doc.y).lineTo(LEFT + CONTENT_W, doc.y).lineWidth(0.5).strokeColor(COLORS.blueSoft).stroke();
  doc.y += 10;
}

function drawMdTable(doc, headers, rows, ctx) {
  const fontSize = 8.5;
  const padX = 5, padY = 4;
  // Column widths proportional to measured content (clamped)
  doc.font('Helvetica').fontSize(fontSize);
  const all = [headers, ...rows];
  const rawW = headers.map((_, c) =>
    Math.max(...all.map(r => doc.widthOfString(plainText(tokenizeInline(r[c] || '')))), 24)
  );
  const clamped = rawW.map(w => Math.min(w + padX * 2 + 4, CONTENT_W * 0.55));
  const scale = CONTENT_W / clamped.reduce((a, b) => a + b, 0);
  const colW = clamped.map(w => w * Math.min(scale, 1.6)); // don't over-stretch narrow tables too far
  const tableW = colW.reduce((a, b) => a + b, 0);

  const rowHeight = (cells, font) => {
    doc.font(font).fontSize(fontSize);
    return Math.max(...cells.map((cell, c) =>
      doc.heightOfString(plainText(tokenizeInline(cell || '')) || ' ', { width: colW[c] - padX * 2 })
    )) + padY * 2;
  };

  let yRow;
  const drawRow = (cells, { header = false } = {}) => {
    const font = header ? 'Helvetica-Bold' : 'Helvetica';
    const h = rowHeight(cells, font);
    if (doc.y + h > BOTTOM_Y) { doc.addPage(); if (!header) drawRow(headers, { header: true }); }
    yRow = doc.y;
    if (header) doc.rect(LEFT, yRow, tableW, h).fill(COLORS.navyDeep);
    let x = LEFT;
    cells.forEach((cell, c) => {
      const runs = tokenizeInline(cell || '');
      if (header) {
        doc.font('Helvetica-Bold').fontSize(fontSize).fillColor('#ffffff');
        doc.text(plainText(runs), x + padX, yRow + padY, { width: colW[c] - padX * 2 });
      } else {
        doc.y = yRow + padY;
        renderRuns(doc, runs.length ? runs : [{ text: ' ' }], { x: x + padX, width: colW[c] - padX * 2, fontSize, lineGap: 1, ctx });
      }
      x += colW[c];
    });
    doc.y = yRow + h;
    if (!header) {
      doc.moveTo(LEFT, doc.y).lineTo(LEFT + tableW, doc.y).lineWidth(0.5).strokeColor(COLORS.grayLight).stroke();
    }
  };

  ensureSpace(doc, 60);
  drawRow(headers, { header: true });
  rows.forEach(r => drawRow(r));
  doc.y += 10;
}

// ── Table parser (same as client) ────────────────────────────────────────────
function parseTable(lines, startIdx) {
  const sep = lines[startIdx + 1];
  if (!sep || !/^\s*\|?\s*:?-+/.test(sep)) return null;
  const cells = (line) => line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
  const headers = cells(lines[startIdx]);
  const rows = [];
  let i = startIdx + 2;
  while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(cells(lines[i])); i++; }
  return { headers, rows, consumed: i - startIdx };
}

// ── Topic renderer ───────────────────────────────────────────────────────────
// ctx: { slugSet: Set<string>, warn(msg), titleDestination: 't-<slug>' }
function renderTopic(doc, topic, ctx) {
  const lines = sanitize(topic.body).split('\n');
  let i = 0;
  let firstH2Done = false;

  const linkCtx = {
    resolveLink(url) {
      if (url.startsWith('./') || url.startsWith('/help/')) {
        const slug = (url.startsWith('./') ? url.slice(2) : url.replace('/help/', '')).split('#')[0];
        if (ctx.slugSet.has(slug)) return { goTo: `t-${slug}` };
        ctx.warn(`[${topic.slug}] unresolved internal link: ${url}`);
        return null;
      }
      if (url.startsWith('#')) return null; // same-page anchor: styled text only
      if (/^https?:/.test(url)) return { link: url };
      return null;
    },
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { i++; continue; }

    if (trimmed.startsWith('```')) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) { codeLines.push(lines[i]); i++; }
      i++;
      codeBlock(doc, codeLines);
      continue;
    }
    if (/^-{3,}$|^\*{3,}$/.test(trimmed)) { hr(doc); i++; continue; }
    if (trimmed.startsWith('#### ')) { heading(doc, trimmed.slice(5), { size: 11, before: 10, after: 4, ctx: linkCtx }); i++; continue; }
    if (trimmed.startsWith('### ')) { heading(doc, trimmed.slice(4), { size: 13.5, before: 13, after: 5, ctx: linkCtx }); i++; continue; }
    if (trimmed.startsWith('## ')) {
      if (!firstH2Done) {
        firstH2Done = true;
        heading(doc, trimmed.slice(3), { size: 20, before: 0, after: 8, rule: true, destination: `t-${topic.slug}`, ctx: linkCtx });
      } else {
        heading(doc, trimmed.slice(3), { size: 16, before: 14, after: 6, ctx: linkCtx });
      }
      i++; continue;
    }
    if (trimmed.startsWith('# ')) { heading(doc, trimmed.slice(2), { size: 22, before: 0, after: 8, rule: true, ctx: linkCtx }); i++; continue; }

    if (trimmed.startsWith('> ')) {
      const quote = [];
      while (i < lines.length && lines[i].trim().startsWith('> ')) { quote.push(lines[i].trim().slice(2)); i++; }
      blockquote(doc, quote.join(' '), linkCtx);
      continue;
    }

    if (trimmed.startsWith('|')) {
      const table = parseTable(lines, i);
      if (table) { drawMdTable(doc, table.headers, table.rows, linkCtx); i += table.consumed; continue; }
    }

    if (/^\d+\.\s/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        const itemLines = [lines[i].trim().replace(/^\d+\.\s+/, '')];
        i++;
        while (i < lines.length && lines[i].startsWith('   ') && !/^\d+\.\s/.test(lines[i].trim())) { itemLines.push(lines[i].trim()); i++; }
        items.push(itemLines.join(' '));
      }
      listBlock(doc, items, true, linkCtx);
      continue;
    }

    if (/^[-*]\s/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i].trim())) {
        const itemLines = [lines[i].trim().replace(/^[-*]\s+/, '')];
        i++;
        while (i < lines.length && lines[i].startsWith('  ') && !/^[-*]\s/.test(lines[i].trim())) { itemLines.push(lines[i].trim()); i++; }
        items.push(itemLines.join(' '));
      }
      listBlock(doc, items, false, linkCtx);
      continue;
    }

    const paraLines = [line];
    i++;
    while (i < lines.length) {
      const t = lines[i].trim();
      if (!t) break;
      if (t.startsWith('#') || t.startsWith('> ') || t.startsWith('|') || t.startsWith('```') ||
          /^[-*]\s/.test(t) || /^\d+\.\s/.test(t) || /^-{3,}$|^\*{3,}$/.test(t)) break;
      paraLines.push(lines[i]);
      i++;
    }
    paragraph(doc, paraLines.join(' '), linkCtx);
  }
}

module.exports = { renderTopic, tokenizeInline, plainText };
