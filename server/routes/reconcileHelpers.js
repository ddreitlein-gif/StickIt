// ---------------------------------------------------------------------------
// Shared CSV parsing helpers used by both import.js and athletes.js (reconcile).
// ---------------------------------------------------------------------------

const SYNONYMS = {
  last_name:  ['name', 'last', 'lastname', 'nom', 'nomdefamille', 'dernier', 'surname', 'familyname'],
  first_name: ['first', 'firstname', 'prenom', 'premiere', 'givenname'],
  gender:     ['gender', 'sex', 'sexe', 'group', 'groupe', 'gp', 'mf'],
  birth_year: ['born', 'birthday', 'birthyear', 'yob', 'dobyear', 'year'],
  ussa_num:   ['id', 'ussa', 'ussa#', 'ussaid', 'ussanum', 'usssnum', 'ussanumber'],
  fis_id:     ['fis', 'fis#', 'fisid', 'fiscode', 'fisnum', 'fisnumber'],
  club:       ['club', 'team', 'mountain', 'rep', 'montagne', 'clubname', 'teamname'],
  nation:     ['nation', 'country', 'nat', 'pays'],
  bib:        ['bib', 'dossard', 'bibnumber', 'bib#'],
};

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildHeaderMap(rawHeaders) {
  const reverseMap = {};
  for (const [canonical, synonyms] of Object.entries(SYNONYMS)) {
    for (const syn of synonyms) reverseMap[normalize(syn)] = canonical;
    reverseMap[normalize(canonical)] = canonical;
  }
  const result = {};
  for (const h of rawHeaders) {
    const norm = normalize(h);
    if (reverseMap[norm]) result[h] = reverseMap[norm];
  }
  return result;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };

  const rawHeaders = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const headerMap  = buildHeaderMap(rawHeaders);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const vals = [];
    let cur = '', inQuote = false;
    for (const ch of line + ',') {
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) { vals.push(cur.trim()); cur = ''; }
      else cur += ch;
    }

    const row = {};
    rawHeaders.forEach((h, idx) => {
      const canonical = headerMap[h] || normalize(h);
      row[canonical]  = vals[idx] !== undefined ? vals[idx].replace(/^"|"$/g, '').trim() : '';
    });
    rows.push(row);
  }
  return { headers: rawHeaders, rows };
}

function normalizeRow(row) {
  const get = (...keys) => {
    for (const k of keys) {
      if (row[k] !== undefined && String(row[k]).trim() !== '') return String(row[k]).trim();
    }
    return '';
  };

  const genderRaw = get('gender');
  let gender = genderRaw.toUpperCase().charAt(0);
  if (!['M', 'F'].includes(gender)) gender = '';

  const birthRaw   = get('birth_year');
  const birth_year = birthRaw ? parseInt(birthRaw) || null : null;

  return {
    first_name: get('first_name'),
    last_name:  get('last_name'),
    ussa_num:   get('ussa_num'),
    fis_id:     get('fis_id'),
    nation:     get('nation').toUpperCase(),
    club:       get('club'),
    gender,
    birth_year,
    bib:        get('bib'),
  };
}

module.exports = { parseCSV, normalizeRow, SYNONYMS };
