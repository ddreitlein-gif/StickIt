#!/usr/bin/env node
/**
 * Seed demo data for beta testing via REST API.
 * Usage: node scripts/seed-demo.js [BASE_URL]
 * Default: https://stickit-tga4.onrender.com
 */

const BASE = process.argv[2] || 'https://stickit-tga4.onrender.com';

const MALE_FIRST = ['Jake','Connor','Tyler','Ryan','Brody','Mason','Logan','Ethan','Cole','Nate'];
const FEMALE_FIRST = ['Ava','Emma','Lily','Sophie','Mia','Zoe','Chloe','Ella','Grace','Nora'];
const LAST = ['Anderson','Bennett','Carter','Davis','Evans','Fischer','Grant','Hayes','Jensen','Keller'];
const CLUBS = ['RMFSC','SSWSC','AVSC','PCSS','GMVF','BVSC','TFC','WPSC'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function birthYear() { return 2004 + Math.floor(Math.random() * 10); } // 2004-2013
function ussaNum() { return String(1000000 + Math.floor(Math.random() * 9000000)); }

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

function generateAthletes(gender, count) {
  const firsts = gender === 'M' ? MALE_FIRST : FEMALE_FIRST;
  const used = new Set();
  const athletes = [];
  while (athletes.length < count) {
    const first = pick(firsts);
    const last = pick(LAST);
    const key = `${first} ${last}`;
    if (used.has(key)) continue;
    used.add(key);
    athletes.push({
      first_name: first,
      last_name: last,
      gender,
      birth_year: birthYear(),
      ussa_num: ussaNum(),
      club: pick(CLUBS),
      nation: 'USA'
    });
  }
  return athletes;
}

async function createAthletesAndRegister(eventId, athletes) {
  for (let i = 0; i < athletes.length; i++) {
    const a = athletes[i];
    // Create athlete
    const created = await api('POST', '/api/athletes', { ...a, confirm: true });
    // Register with bib
    await api('POST', `/api/events/${eventId}/registrations`, {
      athlete_id: created.id,
      bib_number: i + 1
    });
  }
}

async function seed() {
  console.log(`Seeding demo data on ${BASE}\n`);

  // 1. Create meet
  const meet = await api('POST', '/api/meets', {
    name: 'Rocky Mountain Freestyle Open',
    location: 'Winter Park, CO',
    date: '2026-02-14'
  });
  console.log(`✓ Meet: ${meet.name} (${meet.id})`);

  // 2. Create events
  const events = [
    { discipline: 'mogul', division: 'open', gender: 'M', name: "Men's Moguls" },
    { discipline: 'mogul', division: 'open', gender: 'F', name: "Women's Moguls" },
    { discipline: 'dual_mogul', division: 'open', gender: 'M', name: "Men's Dual Moguls" },
    { discipline: 'dual_mogul', division: 'open', gender: 'F', name: "Women's Dual Moguls" },
  ];

  for (const ev of events) {
    const event = await api('POST', `/api/meets/${meet.id}/events`, ev);
    console.log(`  ✓ Event: ${event.name} (${event.id})`);

    // Generate 10 athletes per event
    const athletes = generateAthletes(ev.gender, 10);
    await createAthletesAndRegister(event.id, athletes);
    console.log(`    ✓ Registered ${athletes.length} athletes`);
  }

  console.log('\n✓ Done! Meet is ready for beta testing.');
  console.log(`  ${BASE}`);
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
