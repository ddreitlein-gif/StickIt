// Assembles the Complete User Guide PDF: cover -> TOC (two-pass page numbers)
// -> per-group divider pages -> every topic, with PDF outline bookmarks.
const { COLORS, PAGE, PAGE_W, PAGE_H, CONTENT_W, newDoc, coverPage, stampFooters, writeDoc } = require('./style');
const { renderTopic } = require('./markdown');
const { loadGuide } = require('./topics_loader');

const LEFT = PAGE.margins.left;

async function buildCompleteGuide(outPath, version) {
  const { groups, topics } = loadGuide();
  const slugSet = new Set(topics.map(t => t.slug));
  const warnings = [];

  const doc = newDoc({ title: 'StickIt Complete User Guide', subject: 'StickIt user documentation' });
  coverPage(doc, {
    title: 'Complete User Guide',
    subtitle: `${topics.length} topics covering every StickIt feature`,
    audience: 'Officials, judges, admins, and stream crews',
    version,
    accent: COLORS.navy,
  });

  // ── TOC pass 1: render with blank number slots, remember where they go ────
  const curPage = () => doc.bufferedPageRange().count - 1;
  doc.addPage();
  doc.font('Helvetica-Bold').fontSize(22).fillColor(COLORS.navy).text('Contents', LEFT, doc.y, { width: CONTENT_W });
  doc.y += 10;
  const tocSlots = {}; // slug -> { pageIndex, y }
  const numW = 30;
  for (const group of groups) {
    if (doc.y + 60 > PAGE_H - PAGE.margins.bottom) doc.addPage();
    doc.y += 8;
    doc.font('Helvetica-Bold').fontSize(11.5).fillColor(COLORS.navy)
      .text(group.label, LEFT, doc.y, { width: CONTENT_W });
    doc.y += 3;
    for (const t of topics.filter(t => t.group === group.id)) {
      if (doc.y + 16 > PAGE_H - PAGE.margins.bottom) doc.addPage();
      const y = doc.y;
      doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.ink)
        .text(t.title, LEFT + 14, y, { width: CONTENT_W - 14 - numW - 6, lineBreak: false, goTo: `t-${t.slug}` });
      // dotted leader
      const textEnd = LEFT + 14 + doc.widthOfString(t.title) + 5;
      const dotsEnd = LEFT + CONTENT_W - numW - 4;
      if (dotsEnd > textEnd + 10) {
        doc.save().moveTo(textEnd, y + 7).lineTo(dotsEnd, y + 7)
          .lineWidth(0.5).dash(1, { space: 2.5 }).strokeColor(COLORS.grayLight).stroke().undash().restore();
      }
      tocSlots[t.slug] = { pageIndex: curPage(), y };
      doc.y = y + 14;
    }
  }

  // ── Content: group dividers + topics ──────────────────────────────────────
  const topicPage = {}; // slug -> printed page number (= buffered index, cover is 0)
  for (const group of groups) {
    const groupTopics = topics.filter(t => t.group === group.id);
    // Divider page
    doc.addPage();
    const bandY = 230;
    doc.rect(0, bandY, PAGE_W, 80).fill(COLORS.navyDeep);
    doc.font('Helvetica-Bold').fontSize(26).fillColor('#ffffff')
      .text(group.label, 40, bandY + 26, { width: PAGE_W - 80, align: 'center' });
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.gray);
    let ly = bandY + 110;
    for (const t of groupTopics) {
      doc.text(t.title, 0, ly, { width: PAGE_W, align: 'center' });
      ly += 16;
    }
    const groupNode = doc.outline.addItem(group.label);

    for (const t of groupTopics) {
      doc.addPage();
      topicPage[t.slug] = curPage();
      groupNode.addItem(t.title);
      renderTopic(doc, t, { slugSet, warn: (m) => warnings.push(m) });
    }
  }

  // ── TOC pass 2: fill in real page numbers ─────────────────────────────────
  for (const t of topics) {
    const slot = tocSlots[t.slug];
    const page = topicPage[t.slug];
    if (!slot || !page) continue;
    doc.switchToPage(slot.pageIndex);
    doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.gray)
      .text(String(page), LEFT + CONTENT_W - numW, slot.y, { width: numW, align: 'right', lineBreak: false });
  }

  stampFooters(doc, { version, guideTitle: 'Complete User Guide' });
  const pages = doc.bufferedPageRange().count;
  await writeDoc(doc, outPath);
  return { pages, topics: topics.length, warnings };
}

module.exports = { buildCompleteGuide };
