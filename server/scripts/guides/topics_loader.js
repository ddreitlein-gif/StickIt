// Loads the help-system topics for the Complete User Guide PDF.
// topicsIndex.js is an ES module using import.meta.glob, so we regex-extract
// the GROUPS and RAW_TOPICS arrays from its source text instead of requiring it.
const fs = require('fs');
const path = require('path');

const HELP_DIR = path.join(__dirname, '..', '..', '..', 'client', 'src', 'help');
const TOPICS_DIR = path.join(HELP_DIR, 'topics');
const INDEX_FILE = path.join(HELP_DIR, 'topicsIndex.js');

function loadGuide() {
  if (!fs.existsSync(INDEX_FILE)) {
    throw new Error(
      `Cannot find ${INDEX_FILE}.\n` +
      'This script must run locally from the repo (it reads client/src/help/). It cannot run on a server-only deploy.'
    );
  }
  const src = fs.readFileSync(INDEX_FILE, 'utf8');

  const groups = [];
  const groupsSlice = src.slice(src.indexOf('export const GROUPS'), src.indexOf('const RAW_TOPICS'));
  for (const m of groupsSlice.matchAll(/\{\s*id:\s*'([^']+)',\s*label:\s*'([^']+)'\s*\}/g)) {
    groups.push({ id: m[1], label: m[2] });
  }

  const topics = [];
  const topicsSlice = src.slice(src.indexOf('const RAW_TOPICS'), src.indexOf('export const TOPICS'));
  for (const m of topicsSlice.matchAll(/\{\s*slug:\s*'([^']+)',\s*group:\s*'([^']+)',\s*title:\s*'([^']+)'\s*(?:,\s*custom:\s*true\s*)?\}/g)) {
    const custom = /custom:\s*true/.test(m[0]);
    if (custom) continue; // the printable-guides card page is not printable content itself
    topics.push({ slug: m[1], group: m[2], title: m[3] });
  }

  if (groups.length < 5 || topics.length < 60) {
    throw new Error(`topicsIndex.js parse looks wrong: ${groups.length} groups, ${topics.length} topics. Did the file format change?`);
  }

  for (const t of topics) {
    const f = path.join(TOPICS_DIR, `${t.slug}.md`);
    if (!fs.existsSync(f)) throw new Error(`Missing topic file: ${f}`);
    t.body = fs.readFileSync(f, 'utf8');
  }

  // Drop empty groups (e.g. 'printable' once its only topic is filtered out).
  const usedGroups = new Set(topics.map(t => t.group));
  return { groups: groups.filter(g => usedGroups.has(g.id)), topics };
}

module.exports = { loadGuide };
