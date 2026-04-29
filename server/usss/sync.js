const { queryAll, queryOne, execute, batch, getClient, uuidv4 } = require('../db/schema');

const BASE_URL = 'https://media.usskiandsnowboard.org/CompServices/Points/Freestyle/';

// ── USSS People File Parser ──────────────────────────────────────────────────

function parseUsssFile(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) throw new Error('Empty file');

  // Parse header -- strip everything after "FISID" in last column
  let headerLine = lines[0];
  const fisidIdx = headerLine.toUpperCase().indexOf('FISID');
  if (fisidIdx >= 0) {
    headerLine = headerLine.substring(0, fisidIdx + 5);
  }
  const headers = headerLine.split(',').map(h => h.trim().toUpperCase());

  const colIndex = {};
  const colNames = ['TYPE', 'LAST', 'FIRST', 'D', 'USSAID', 'G', 'YOB', 'CLUBNAME',
    'AE', 'DM', 'MO', 'HP', 'BA', 'SX', 'SS', 'FISID'];
  for (const name of colNames) {
    const idx = headers.indexOf(name);
    if (idx >= 0) colIndex[name] = idx;
  }

  if (colIndex.USSAID === undefined) throw new Error('USSAID column not found in header');

  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split(',');
    const get = (name) => {
      if (colIndex[name] === undefined) return null;
      const val = cols[colIndex[name]];
      return val !== undefined ? val.trim() : null;
    };

    const ussa_id = get('USSAID');
    if (!ussa_id) continue;

    const type = get('TYPE');
    const last_name = get('LAST');
    const first_name = get('FIRST');
    if (!last_name || !first_name) continue;

    const aeStr = get('AE');
    const dmStr = get('DM');
    const moStr = get('MO');
    const fisStr = get('FISID');
    const yobStr = get('YOB');

    records.push({
      ussa_id,
      type: type || 'C',
      last_name,
      first_name,
      division: get('D') || null,
      gender: get('G') || null,
      yob: yobStr ? parseInt(yobStr) || null : null,
      club_name: get('CLUBNAME') || null,
      ae_points: aeStr ? parseFloat(aeStr) || null : null,
      dm_points: dmStr ? parseFloat(dmStr) || null : null,
      mo_points: moStr ? parseFloat(moStr) || null : null,
      fis_id: fisStr || null,
    });
  }

  return records;
}

// ── File Naming and Sorting ──────────────────────────────────────────────────

function parseFileName(name) {
  // Patterns: "People YYYY Fall.txt" or "People YYYY List N.txt"
  const fallMatch = name.match(/People\s+(\d{4})\s+Fall\.txt/i);
  if (fallMatch) {
    return { year: parseInt(fallMatch[1]), listNum: -1, identifier: 'Fall', fileName: name };
  }
  const listMatch = name.match(/People\s+(\d{4})\s+List\s+(\d+)\.txt/i);
  if (listMatch) {
    return { year: parseInt(listMatch[1]), listNum: parseInt(listMatch[2]), identifier: `List ${listMatch[2]}`, fileName: name };
  }
  return null;
}

function findMostRecentFile(fileNames) {
  const parsed = fileNames.map(parseFileName).filter(Boolean);
  if (!parsed.length) return null;

  parsed.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.listNum - a.listNum;
  });
  return parsed[0];
}

// ── Directory Listing Parser ─────────────────────────────────────────────────

function parseDirectoryListing(html) {
  const fileNames = [];
  // Look for anchor tags whose href contains "People" and ends with ".txt"
  const regex = /href="([^"]*People[^"]*\.txt)"/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    // Decode URL-encoded filename
    const decoded = decodeURIComponent(match[1]);
    // Extract just the filename (strip path)
    const name = decoded.split('/').pop();
    if (name) fileNames.push(name);
  }
  return fileNames;
}

// ── Upsert Records ───────────────────────────────────────────────────────────

async function upsertRecords(records) {
  const BATCH_SIZE = 100;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk = records.slice(i, i + BATCH_SIZE);
    const stmts = chunk.map(r => ({
      sql: `INSERT OR REPLACE INTO usss_people (ussa_id, type, last_name, first_name, division, gender, yob, club_name, ae_points, dm_points, mo_points, fis_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      args: [r.ussa_id, r.type, r.last_name, r.first_name, r.division, r.gender, r.yob, r.club_name, r.ae_points, r.dm_points, r.mo_points, r.fis_id],
    }));
    await getClient().batch(stmts, 'write');
  }
}

// ── Automatic Sync ───────────────────────────────────────────────────────────

async function syncFromServer() {
  // 1. Fetch directory listing
  const dirRes = await fetch(BASE_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 StickIt/1.3' },
  });
  if (!dirRes.ok) throw new Error(`Failed to fetch directory listing: HTTP ${dirRes.status}`);
  const html = await dirRes.text();

  // 2. Parse file links
  const fileNames = parseDirectoryListing(html);
  if (!fileNames.length) throw new Error('No People files found in directory listing');

  // 3. Find most recent file
  const mostRecent = findMostRecentFile(fileNames);
  if (!mostRecent) throw new Error('Could not determine most recent People file');

  // 4. Check if already synced
  const status = await queryOne('SELECT * FROM usss_sync_status WHERE id = 1');
  if (status && status.file_name === mostRecent.fileName) {
    console.log(`USSS sync: already current (${mostRecent.fileName})`);
    return { skipped: true, fileName: mostRecent.fileName };
  }

  // 5. Fetch the file
  const fileUrl = BASE_URL + encodeURIComponent(mostRecent.fileName).replace(/%20/g, '%20');
  const fileRes = await fetch(fileUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 StickIt/1.3' },
  });
  if (!fileRes.ok) throw new Error(`Failed to fetch ${mostRecent.fileName}: HTTP ${fileRes.status}`);
  const fileText = await fileRes.text();

  // 6. Parse and upsert
  const records = parseUsssFile(fileText);
  await upsertRecords(records);

  // 7. Update sync status
  await execute(
    `INSERT OR REPLACE INTO usss_sync_status (id, last_sync_at, list_year, list_identifier, file_name, record_count, source) VALUES (1, datetime('now'), ?, ?, ?, ?, 'auto')`,
    [String(mostRecent.year), mostRecent.identifier, mostRecent.fileName, records.length]
  );

  console.log(`USSS sync complete: ${mostRecent.fileName} (${records.length} records)`);
  return { skipped: false, fileName: mostRecent.fileName, recordCount: records.length };
}

// ── Manual Upload ────────────────────────────────────────────────────────────

async function processUpload(fileText, originalFileName) {
  const records = parseUsssFile(fileText);
  await upsertRecords(records);

  // Extract year and identifier from filename if possible
  let listYear = 'Manual Upload';
  let listIdentifier = 'Manual Upload';
  const parsed = originalFileName ? parseFileName(originalFileName) : null;
  if (parsed) {
    listYear = String(parsed.year);
    listIdentifier = parsed.identifier;
  }

  await execute(
    `INSERT OR REPLACE INTO usss_sync_status (id, last_sync_at, list_year, list_identifier, file_name, record_count, source) VALUES (1, datetime('now'), ?, ?, ?, ?, 'manual')`,
    [listYear, listIdentifier, originalFileName || 'uploaded file', records.length]
  );

  return { recordCount: records.length, listYear, listIdentifier };
}

// ── Scheduled Sync ───────────────────────────────────────────────────────────

let lastSyncDay = -1;

function startScheduledSync() {
  // Run once on startup after 10-second delay
  setTimeout(async () => {
    try {
      const result = await syncFromServer();
      if (!result.skipped) {
        console.log(`USSS startup sync: loaded ${result.recordCount} records from ${result.fileName}`);
      }
    } catch (err) {
      console.error('USSS startup sync failed:', err.message);
    }
  }, 10000);

  // Check every 60 seconds for 3:00 AM
  setInterval(() => {
    const now = new Date();
    const day = now.getDate();
    if (now.getHours() === 3 && now.getMinutes() === 0 && lastSyncDay !== day) {
      lastSyncDay = day;
      syncFromServer().catch(err => {
        console.error('USSS scheduled sync failed:', err.message);
      });
    }
  }, 60000);
}

module.exports = { syncFromServer, processUpload, parseUsssFile, startScheduledSync };
