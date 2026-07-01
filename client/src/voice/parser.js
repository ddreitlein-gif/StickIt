// v1.20.00 -- Voice transcript helpers (wizard model).
//
// The voice modal now uses a guided wizard: a cursor highlights one field, the
// operator says only the VALUE for that field (no section keywords), then says
// "Next" to advance, "Redo" to clear and re-enter, or "Submit" / "Done" to
// finish. Status overrides (DNS/DNF/DSQ) are toolbar buttons, not voice.
//
// This file exposes three pure helpers used by VoiceManualEntryModal:
//   - normalize(text)            : lowercase + light keyword/number cleanup
//   - detectCommand(utterance)   : 'next' | 'redo' | 'submit' | 'no_time' | null
//   - extractValueForField(...)  : returns { value, status } for one field
//
// extractValueForField dispatches by field type:
//   - 'time'         : decimal seconds, or null
//   - 'tl_component' : decimal 0..N (sub-field-specific range check)
//   - 'tl_raw'       : decimal 0..20
//   - 'air_score'    : decimal 0..10 (mogul) or 0..2 (aerials)
//   - 'jump_code'    : phrase-mapped + DB-validated canonical code
//
// Status returned: 'ok' (in range / valid), 'warn' (out of expected range),
// 'invalid' (jump code not in this event's DD table).

const SINGLE_DIGIT_WORDS = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9,
};

const SMALL_NUMBER_WORDS = {
  ...SINGLE_DIGIT_WORDS,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
};

// Common spoken-form -> canonical mogul jump code. Multi-word entries are
// matched first (longest first) so "twister spread" wins over "twister".
const JUMP_PHRASE_MAP = {
  'back full full': 'bFF',
  'back double full': 'bdF',
  'back twister twister': 'bTT',
  'back full twister': 'bFT',
  'back twister full': 'bFT',
  'back layout twister': 'bLT',
  'back twister layout': 'bLT',
  'back layout layout': 'bLL',
  'back full': 'bF',
  'back layout': 'bL',
  'back lay': 'bL',
  'back tuck': 'bT',
  'back top': 'bT',
  'back x': 'bp', // operator default: "back X" -> back position. Use "back cross" for the actual cross.
  'back cross': 'bX',
  'back iron cross': 'bX',
  'back position': 'bp',
  'back pike': 'bP',
  // v1.26.00 (FS-13): spoken "grab" = basic grab (lowercase g, +0.05);
  // "big grab" / "advanced grab" = advanced grab (uppercase G, +0.12).
  'back big grab': 'bG',
  'back advanced grab': 'bG',
  'back grab': 'bg',
  'front big grab': 'fG',
  'front advanced grab': 'fG',
  'front grab': 'fg',
  'loop big grab full': 'lGF',
  'loop advanced grab full': 'lGF',
  'loop grab full': 'lgF',
  'loop big grab': 'lG',
  'loop advanced grab': 'lG',
  'loop grab': 'lg',
  'b p': 'bp',
  'b position': 'bp',
  'twister twister spread': 'TTS',
  'twister twister daffy': 'TTD',
  'twister twister spread spread': 'TTSS',
  'twister spread': 'TS',
  'twister twister': 'TT',
  'twister daffy': 'TD',
  'daffy twister spread': 'DTS',
  'twister spread twister': 'TST',
  'iron cross': 'X',
  'twister': 'T',
  'spread': 'S',
  'daffy': 'D',
  'kosak': 'K',
  // Common Deepgram mishearings for "Kosak" (phonetic). The jump is named
  // after a person so spelling drifts; cover s/z and c/k swaps.
  'kozak': 'K',
  'kozack': 'K',
  'kozzak': 'K',
  'cozak': 'K',
  'cozack': 'K',
  'cosac': 'K',
  'cosack': 'K',
  'kosack': 'K',
  'kossack': 'K',
  'kossak': 'K',
  'kossac': 'K',
  'cosak': 'K',
  'kazak': 'K',
  'kazack': 'K',
  'mule': 'M',
  'three pretzel': '3p',
  'three p': '3p',
  'seven o p': '7op',
  'seven op': '7op',
  // Spin grabs — word and digit forms (Deepgram smart_format varies).
  'three big grab': '3G',
  'three advanced grab': '3G',
  'three grab': '3g',
  '3 big grab': '3G',
  '3 advanced grab': '3G',
  '3 grab': '3g',
  'three o big grab': '3oG',
  'three o advanced grab': '3oG',
  'three o grab': '3og',
  'seven big grab': '7G',
  'seven advanced grab': '7G',
  'seven grab': '7g',
  '7 big grab': '7G',
  '7 advanced grab': '7G',
  '7 grab': '7g',
  'seven o big grab': '7oG',
  'seven o advanced grab': '7oG',
  'seven o grab': '7og',
  'ten big grab': '10G',
  'ten advanced grab': '10G',
  'ten grab': '10g',
  '10 big grab': '10G',
  '10 advanced grab': '10G',
  '10 grab': '10g',
  'ten o big grab': '10oG',
  'ten o advanced grab': '10oG',
  'ten o grab': '10og',
  'fourteen o big grab': '14oG',
  'fourteen o advanced grab': '14oG',
  'fourteen o grab': '14og',
  // Stand-alone grabs — matched last (shortest) after every longer phrase.
  'big grab': 'G',
  'advanced grab': 'G',
  'grab': 'g',
  'no jump': 'N',
  'no air': 'N',
};

// Command words/phrases. Listed in priority order; we check `submit` before
// `next` so "submit it" doesn't match `next` substring etc. "enter" is a
// common Deepgram mishearing for "next" so we accept it as a synonym.
const COMMAND_PATTERNS = [
  { cmd: 'no_time', re: /\b(no\s+time|n\.?\s*t\.?)\b/ },
  { cmd: 'submit',  re: /\b(submit|done|finish|complete|review)\b/ },
  { cmd: 'redo',    re: /\b(redo|scratch\s+that|clear\s+(?:it|that|field)|correction)\b/ },
  { cmd: 'next',    re: /\b(next|advance|enter|go\s+next|next\s+field)\b/ },
];

// Single combined regex for the tokenizer (scan-and-split). Same vocabulary as
// COMMAND_PATTERNS but flat, with capture so we can dispatch.
const COMMAND_SCAN_RE = /\b(no\s+time|nt|submit|done|finish|complete|review|redo|scratch\s+that|correction|next|advance|enter)\b/g;
const COMMAND_WORD_TO_CMD = {
  'no time': 'no_time', 'nt': 'no_time',
  'submit': 'submit', 'done': 'submit', 'finish': 'submit', 'complete': 'submit', 'review': 'submit',
  'redo': 'redo', 'scratch that': 'redo', 'correction': 'redo',
  'next': 'next', 'advance': 'next', 'enter': 'next',
};

function normalize(text) {
  let t = String(text || '').toLowerCase();
  t = t.replace(/[,;!?]/g, ' ');
  t = t.replace(/(\D|^)\./g, '$1 ');
  t = t.replace(/\s+/g, ' ').trim();

  // "point N..." -> ".NNN"
  for (let i = 0; i < 8; i++) {
    const before = t;
    t = t.replace(/\bpoint\s+([a-z]+(?:\s+[a-z]+){0,3})\b/g, (m, after) => {
      const words = after.split(/\s+/);
      let dec = '';
      for (const w of words) {
        if (w in SINGLE_DIGIT_WORDS) dec += String(SINGLE_DIGIT_WORDS[w]);
        else break;
      }
      if (!dec) return m;
      const rest = words.slice(dec.length).join(' ');
      return '.' + dec + (rest ? ' ' + rest : '');
    });
    if (t === before) break;
  }

  // "twenty three" -> "23", then bare number words -> digits
  for (let i = 0; i < 8; i++) {
    const before = t;
    t = t.replace(
      /\b(twenty|thirty|forty|fifty|sixty|seventy)\s+(one|two|three|four|five|six|seven|eight|nine)\b/g,
      (_, tens, ones) => String(SMALL_NUMBER_WORDS[tens] + SMALL_NUMBER_WORDS[ones])
    );
    t = t.replace(
      /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy)\b/g,
      (m) => String(SMALL_NUMBER_WORDS[m])
    );
    if (t === before) break;
  }

  t = t.replace(/(\d)\s+\.(\d)/g, '$1.$2');
  t = t.replace(/(\d)\s+point\b/g, '$1');
  t = t.replace(/(^|\s)\.(?=\s|$)/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

function detectCommand(utterance) {
  const t = normalize(utterance);
  if (!t) return null;
  // If the utterance contains a number, treat it as a value-bearing utterance
  // even if it incidentally also contains a command word. Operators dictating
  // a value will not normally say "next 6.5" -- they'll just say "6.5".
  if (/-?\d+(?:\.\d+)?/.test(t)) return null;
  for (const { cmd, re } of COMMAND_PATTERNS) {
    if (re.test(t)) return cmd;
  }
  return null;
}

function extractNumber(text) {
  const m = String(text || '').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const v = parseFloat(m[0]);
  return isFinite(v) ? v : null;
}

function canonicalizeJumpCode(text, allowedSet) {
  const cleaned = String(text || '').toLowerCase().trim();
  if (!cleaned) return null;

  // 1. Multi-word phrase lookup (longest first).
  const phrases = Object.keys(JUMP_PHRASE_MAP).sort((a, b) => b.length - a.length);
  for (const p of phrases) {
    const re = new RegExp('\\b' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
    if (re.test(cleaned)) return JUMP_PHRASE_MAP[p];
  }

  // 2. Direct match against allowedSet (case-insensitive). Operators may
  // pronounce codes letter-by-letter ("T S") which Deepgram may return as
  // "ts" or "t s". Normalize.
  if (allowedSet && allowedSet.size > 0) {
    const collapsed = cleaned.replace(/\s+/g, '');
    // Exact-case pass first (v1.26.00): with case-distinct codes (bg vs bG)
    // in the chart, the lowercased transcript must deterministically resolve
    // to the lowercase (basic) code; advanced grabs are reached via the
    // "big grab" / "advanced grab" phrases above.
    if (allowedSet.has(collapsed)) return collapsed;
    if (allowedSet.has(cleaned)) return cleaned;
    for (const code of allowedSet) {
      if (code.toLowerCase() === collapsed) return code;
      if (code.toLowerCase() === cleaned) return code;
    }
  }

  // 3. Fallback: return the first short alphanumeric token. Will be flagged
  // 'invalid' downstream if not in allowedSet.
  const codeMatch = cleaned.match(/\b[a-z0-9]{1,6}\b/);
  if (codeMatch) {
    const tok = codeMatch[0];
    if (!/^(time|jump|tl|air|judge|next|redo|submit|done|carving|absorption|upperbody|deduction|raw)\d*$/i.test(tok)) {
      return tok;
    }
  }
  return null;
}

function rangeStatus(v, min, max) {
  if (v == null || !isFinite(v)) return 'invalid';
  if (v < min || v > max) return 'warn';
  return 'ok';
}

// Decimal recovery: when Deepgram drops the "point" from a spoken decimal
// ("seven point six" -> "76" instead of "7.6"), the resulting integer is
// almost always out of range for the field. Try inserting a decimal at each
// position; among results that fall in range, prefer the one with the
// SHORTEST decimal part (so "114" -> "11.4" beats "1.14" for a deduction
// field). Returns the recovered value or the original if no recovery works.
function recoverDecimal(value, max) {
  if (value == null || !isFinite(value)) return value;
  if (value <= max) return value;
  if (!Number.isInteger(value)) return value; // already has a decimal
  const s = String(Math.trunc(Math.abs(value)));
  if (s.length < 2) return value;
  const sign = value < 0 ? -1 : 1;
  let best = null;
  for (let i = 1; i < s.length; i++) {
    const cand = parseFloat(s.slice(0, i) + '.' + s.slice(i)) * sign;
    if (cand < 0 || cand > max) continue;
    const decLen = s.length - i;
    if (!best || decLen < best.decLen) best = { value: cand, decLen };
  }
  return best ? best.value : value;
}

function fieldMax(fieldType, isAerials) {
  switch (fieldType) {
    case 'time': return 90;
    case 'tl_raw': return 20;
    case 'tl_carving': return 10;
    case 'tl_absExt': return 5;
    case 'tl_upperBody': return 5;
    case 'tl_deduction': return 20;
    case 'air_score': return isAerials ? 2 : 10;
    default: return Infinity;
  }
}

function numericValue(text, fieldType, isAerials) {
  const v = extractNumber(text);
  if (v == null) return { value: null, status: null };
  const max = fieldMax(fieldType, isAerials);
  const recovered = recoverDecimal(v, max);
  return { value: recovered, status: rangeStatus(recovered, 0, max) };
}

// v1.25.00 (F-3) — range-check a typed (not spoken) value on the Review screen,
// using the same limits spoken values get.
export function statusForField(value, fieldType, isAerials) {
  if (value == null || value === '') return null;
  if (fieldType === 'time') return rangeStatus(value, 5, 90);
  return rangeStatus(value, 0, fieldMax(fieldType, isAerials));
}

export function extractValueForField(utterance, fieldType, options = {}) {
  const { allowedJumpCodes, isAerials } = options;
  const t = normalize(utterance);
  if (!t) return { value: null, status: null };

  switch (fieldType) {
    case 'time': {
      const v = extractNumber(t);
      if (v == null) return { value: null, status: null };
      // Time has no decimal recovery -- valid times are 5..90 seconds which
      // doesn't overlap with the typical "dropped point" pattern.
      return { value: v, status: rangeStatus(v, 5, 90) };
    }
    case 'tl_raw':
    case 'tl_carving':
    case 'tl_absExt':
    case 'tl_upperBody':
    case 'tl_deduction':
    case 'air_score':
      return numericValue(t, fieldType, isAerials);
    case 'jump_code': {
      const allowedSet = allowedJumpCodes instanceof Set ? allowedJumpCodes : new Set(allowedJumpCodes || []);
      const code = canonicalizeJumpCode(t, allowedSet);
      if (!code) return { value: null, status: null };
      if (allowedSet.size > 0) {
        if (allowedSet.has(code)) return { value: code, status: 'ok' };
        return { value: code, status: 'invalid' };
      }
      return { value: code, status: 'warn' };
    }
    default:
      return { value: null, status: null };
  }
}

// Tokenize a Deepgram utterance into an ordered list of segments. Each segment
// is { chunk, cmd } where:
//   - chunk : the text preceding the trailing command word (may be empty)
//   - cmd   : the command (next/redo/submit/no_time) or null for the trailing
//             segment after the last command word
//
// Examples:
//   "7.2 next 3.4 next"  -> [{chunk:"7.2", cmd:"next"}, {chunk:"3.4", cmd:"next"}]
//   "7.2 next"           -> [{chunk:"7.2", cmd:"next"}]
//   "next"               -> [{chunk:"",    cmd:"next"}]
//   "twister spread next"-> [{chunk:"twister spread", cmd:"next"}]
//   "redo 7.2"           -> [{chunk:"",    cmd:"redo"}, {chunk:"7.2", cmd:null}]
//
// The modal applies each segment in order: assign the chunk as a value to the
// current active field, then execute the trailing command (which may change
// the active field). This lets the operator say "value next" in one breath
// without pausing.
export function tokenizeUtterance(text) {
  const norm = normalize(text);
  if (!norm) return [];
  const segments = [];
  let lastEnd = 0;
  COMMAND_SCAN_RE.lastIndex = 0;
  let m;
  while ((m = COMMAND_SCAN_RE.exec(norm)) !== null) {
    const word = m[1].toLowerCase().replace(/\s+/g, ' ').trim();
    const cmd = COMMAND_WORD_TO_CMD[word] || null;
    if (!cmd) continue;
    const chunk = norm.slice(lastEnd, m.index).trim();
    segments.push({ chunk, cmd });
    lastEnd = m.index + m[0].length;
  }
  const trailing = norm.slice(lastEnd).trim();
  if (trailing) segments.push({ chunk: trailing, cmd: null });
  return segments;
}

export function validateJumpCode(code, allowedJumpCodes) {
  if (!code) return 'invalid';
  const set = allowedJumpCodes instanceof Set ? allowedJumpCodes : new Set(allowedJumpCodes || []);
  if (set.size === 0) return 'warn';
  return set.has(code) ? 'ok' : 'invalid';
}

export { normalize, detectCommand };

// Test hooks.
export const _internal = {
  normalize,
  detectCommand,
  extractNumber,
  canonicalizeJumpCode,
  JUMP_PHRASE_MAP,
  COMMAND_PATTERNS,
};
