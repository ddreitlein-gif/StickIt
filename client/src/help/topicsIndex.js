// Single source of truth for the Help system.
// Topics are listed in display order. Sidebar groups in display order too.
//
// To add a topic: create a markdown file in ./topics/<slug>.md and add an entry
// here with the same slug. Order within group matters — it controls the
// Previous/Next navigation at the bottom of each topic.

import.meta.glob // (no-op for tree-shaking notes)

// Load every topic body at build time.
const TOPIC_FILES = import.meta.glob('./topics/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

function loadBody(slug) {
  const key = `./topics/${slug}.md`
  return TOPIC_FILES[key] || ''
}

export const GROUPS = [
  { id: 'getting-started', label: 'Getting Started' },
  { id: 'printable',       label: 'Printable Guides' },
  { id: 'meets',           label: 'Officials — Meets' },
  { id: 'events',          label: 'Officials — Events' },
  { id: 'registration',    label: 'Officials — Athletes & Registration' },
  { id: 'judges-setup',    label: 'Officials — Judges' },
  { id: 'scoring',         label: 'Officials — Scoring' },
  { id: 'results',         label: 'Officials — Results & Reports' },
  { id: 'tablets',         label: 'Judges (Tablets)' },
  { id: 'admin',           label: 'Admin Panel' },
  { id: 'public',          label: 'Public Surfaces' },
  { id: 'reference',       label: 'Reference' },
]

const RAW_TOPICS = [
  // Getting Started
  { slug: 'welcome',                  group: 'getting-started', title: 'Welcome' },
  { slug: 'overview',                 group: 'getting-started', title: 'App overview & user roles' },
  { slug: 'quick-start',              group: 'getting-started', title: 'Quick start: Run your first meet' },

  // Printable Guides (custom-rendered card page — see HelpContent.jsx)
  { slug: 'printable-guides',         group: 'printable', title: 'Printable PDF guides', custom: true },

  // Officials — Meets
  { slug: 'meets-create',             group: 'meets', title: 'Creating a meet' },
  { slug: 'meets-edit',               group: 'meets', title: 'Editing meet settings' },
  { slug: 'meets-course-specs',       group: 'meets', title: 'Course specifications' },
  { slug: 'meets-training-days',      group: 'meets', title: 'Training days' },
  { slug: 'meets-import',             group: 'meets', title: 'Importing a meet from file' },
  { slug: 'meets-export',             group: 'meets', title: 'Exporting a meet' },
  { slug: 'meets-delete',             group: 'meets', title: 'Deleting a meet' },

  // Officials — Events
  { slug: 'events-add',               group: 'events', title: 'Adding an event' },
  { slug: 'events-edit',              group: 'events', title: 'Editing an event' },
  { slug: 'events-divisions',         group: 'events', title: 'Categories & divisions explained' },
  { slug: 'events-phases',            group: 'events', title: 'Multi-phase events' },
  { slug: 'events-dual',              group: 'events', title: 'Dual mogul setup' },
  { slug: 'events-aerials',           group: 'events', title: 'Aerials event setup' },
  { slug: 'events-lock',              group: 'events', title: 'Locking & unlocking events' },

  // Officials — Athletes & Registration
  { slug: 'athletes-db',              group: 'registration', title: 'The Athletes database' },
  { slug: 'reg-register',             group: 'registration', title: 'Registering athletes for an event' },
  { slug: 'reg-usss',                 group: 'registration', title: 'Importing from USSS People database' },
  { slug: 'reg-skireg',               group: 'registration', title: 'Importing from SkiReg CSV' },
  { slug: 'reg-manual',               group: 'registration', title: 'Manual athlete entry' },
  { slug: 'reg-bibs',                 group: 'registration', title: 'Bib assignment' },
  { slug: 'reg-runorder',             group: 'registration', title: 'Building run order' },
  { slug: 'reg-age-groups',           group: 'registration', title: 'Run order with age groups' },
  { slug: 'reg-runorder-lock',        group: 'registration', title: 'Locking run order' },

  // Officials — Judges
  { slug: 'judges-add',               group: 'judges-setup', title: 'Adding & assigning judges' },
  { slug: 'judges-urls',              group: 'judges-setup', title: 'Judge tablet URLs' },
  { slug: 'judges-seed-aerials',      group: 'judges-setup', title: 'Seeding an aerials panel' },

  // Officials — Scoring
  { slug: 'scoring-live',             group: 'scoring', title: 'Live scoring flow' },
  { slug: 'scoring-manual',           group: 'scoring', title: 'Manual score entry' },
  { slug: 'scoring-voice',            group: 'scoring', title: 'Voice manual score entry' },
  { slug: 'scoring-edit',             group: 'scoring', title: 'Editing a finalized score' },
  { slug: 'scoring-statuses',         group: 'scoring', title: 'Run statuses: DNS, DNF, DSQ, NT' },
  { slug: 'scoring-hj-review',        group: 'scoring', title: 'Head Judge review & approval' },

  // Officials — Results & Reports
  { slug: 'results-table',            group: 'results', title: 'Reading the results table' },
  { slug: 'results-tiebreak',         group: 'results', title: 'Tie-break rules' },
  { slug: 'results-ffsp',             group: 'results', title: 'FFSP points (dual mogul)' },
  { slug: 'reports-pdf',              group: 'results', title: 'PDF reports' },
  { slug: 'reports-csv-xlsx',         group: 'results', title: 'CSV / Excel exports' },
  { slug: 'reports-transmit',         group: 'results', title: 'USSS transmit XML' },

  // Judges (Tablets)
  { slug: 'tablet-tl',                group: 'tablets', title: 'T&L Judge tablet' },
  { slug: 'tablet-air',               group: 'tablets', title: 'Air Judge tablet' },
  { slug: 'tablet-aerials',           group: 'tablets', title: 'Aerials Judge tablet' },
  { slug: 'tablet-dual',              group: 'tablets', title: 'Dual Mogul Judge tablet' },
  { slug: 'tablet-time',              group: 'tablets', title: 'Timekeeper tablet' },
  { slug: 'tablet-hj',                group: 'tablets', title: 'Head Judge tablet' },
  { slug: 'tablet-hc',                group: 'tablets', title: 'High-contrast (HC) mode' },

  // Admin Panel
  { slug: 'admin-dashboard',          group: 'admin', title: 'Admin Dashboard' },
  { slug: 'admin-security',           group: 'admin', title: 'Password protection & login' },
  { slug: 'admin-users',              group: 'admin', title: 'User management' },
  { slug: 'admin-events',             group: 'admin', title: 'Event Management: locking, hiding, re-opening' },
  { slug: 'admin-usss-people',        group: 'admin', title: 'USSS People database (Admin viewer)' },
  { slug: 'admin-athletes',           group: 'admin', title: 'Athletes database management' },
  { slug: 'admin-backups',            group: 'admin', title: 'Backups' },
  { slug: 'admin-audit',              group: 'admin', title: 'Audit log' },

  // Public Surfaces
  { slug: 'public-home',              group: 'public', title: 'Home page' },
  { slug: 'public-livescores',        group: 'public', title: 'Live Scores listing' },
  { slug: 'public-scoreboard',        group: 'public', title: 'Reading a Scoreboard' },
  { slug: 'public-overlay',           group: 'public', title: 'Broadcast Overlay (OBS/YoloBox)' },

  // Reference
  { slug: 'ref-jump-dds',             group: 'reference', title: 'Jump codes & DDs' },
  { slug: 'ref-formulas',             group: 'reference', title: 'Scoring formulas' },
  { slug: 'ref-viewer-api',           group: 'reference', title: 'Viewer API (third-party apps)' },
  { slug: 'ref-glossary',             group: 'reference', title: 'Glossary' },
]

// Materialize: load bodies, build group->topics index, and build a flat ordered list.
export const TOPICS = RAW_TOPICS.map((t, idx) => {
  const body = loadBody(t.slug)
  const groupLabel = GROUPS.find(g => g.id === t.group)?.label || t.group
  // First ~280 chars of body, stripped of markdown markers, for search excerpts
  const excerpt = body
    .replace(/^##.*$/gm, '')
    .replace(/[#*`>\-]/g, ' ')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280)
  return { ...t, index: idx, groupLabel, body, excerpt }
})

export const TOPICS_BY_SLUG = Object.fromEntries(TOPICS.map(t => [t.slug, t]))

export function topicsInGroup(groupId) {
  return TOPICS.filter(t => t.group === groupId)
}

export function neighbors(slug) {
  const t = TOPICS_BY_SLUG[slug]
  if (!t) return { prev: null, next: null }
  return {
    prev: t.index > 0 ? TOPICS[t.index - 1] : null,
    next: t.index < TOPICS.length - 1 ? TOPICS[t.index + 1] : null,
  }
}

export function searchTopics(query) {
  const q = query.trim().toLowerCase()
  if (!q) return TOPICS
  return TOPICS.filter(t =>
    t.title.toLowerCase().includes(q) ||
    t.groupLabel.toLowerCase().includes(q) ||
    t.excerpt.toLowerCase().includes(q) ||
    t.body.toLowerCase().includes(q)
  )
}
