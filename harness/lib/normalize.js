/**
 * FR-23 — regression-comparison normalization (spec: docs/SYNC_PROTOCOL.md §8).
 *
 * "Identical" comparisons across runs with fresh UUIDs/short codes/timestamps:
 *   - UUIDs → «uuid-N», N assigned in order of first appearance PER CORPUS.
 *   - short codes (values under short_code-ish keys) → «code-N», same aliasing.
 *   - timestamps (SQLite datetime or ISO-8601) → «ts» (collapsed, not aliased).
 *   - caller-provided volatile keys are deleted.
 * Key order is irrelevant (structural comparison); array order is significant.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TS_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/;
const EMBEDDED_UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const SHORT_CODE_KEY_RE = /(^|_)short_code$/;

function normalizeCorpus(value, { dropKeys = [] } = {}) {
  const uuidAlias = new Map();
  const codeAlias = new Map();
  const drop = new Set(dropKeys);

  const normString = (s, keyName) => {
    if (UUID_RE.test(s)) {
      if (!uuidAlias.has(s)) uuidAlias.set(s, `«uuid-${uuidAlias.size + 1}»`);
      return uuidAlias.get(s);
    }
    if (keyName && SHORT_CODE_KEY_RE.test(keyName) && /^[a-z0-9]{4,8}$/i.test(s)) {
      if (!codeAlias.has(s)) codeAlias.set(s, `«code-${codeAlias.size + 1}»`);
      return codeAlias.get(s);
    }
    if (TS_RE.test(s)) return '«ts»';
    // Embedded UUIDs inside longer strings (e.g. composite ids "<uuid>-1",
    // URLs) alias the same way as bare UUIDs.
    if (EMBEDDED_UUID_RE.test(s)) {
      return s.replace(EMBEDDED_UUID_RE, (m) => {
        if (!uuidAlias.has(m)) uuidAlias.set(m, `«uuid-${uuidAlias.size + 1}»`);
        return uuidAlias.get(m);
      });
    }
    return s;
  };

  const walk = (v, keyName) => {
    if (v === null || v === undefined) return v;
    if (typeof v === 'string') return normString(v, keyName);
    if (Array.isArray(v)) return v.map(x => walk(x, keyName));
    if (typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) {
        if (drop.has(k)) continue;
        out[k] = walk(v[k], k);
      }
      return out;
    }
    return v;
  };

  return walk(value, null);
}

function deepEqualNormalized(a, b, opts) {
  return JSON.stringify(normalizeCorpus(a, opts)) === JSON.stringify(normalizeCorpus(b, opts));
}

module.exports = { normalizeCorpus, deepEqualNormalized };
