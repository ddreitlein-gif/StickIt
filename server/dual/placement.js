// server/dual/placement.js
//
// StickIt v1.6.01 -- Dual moguls bracket placement helper.
//
// Pure functions only.  No database access, no Express, no side effects.
// Both the runtime route (server/routes/dual.js) and the verification
// script (server/scripts/verify_v16.js) import from this file.
//
// Concepts:
//
//   seed-list rank    An athlete's ranking in the seed list (1..N).  Lives
//                     in registrations.dual_seed.  NEVER mutated by
//                     bracketing.  Manual overrides may produce decimals
//                     (e.g. 5.5).
//
//   bracket slot      A position (1..size) in the seeded bracket template.
//                     The template places seed 1 at slot 1, seed 2 at the
//                     opposite end, seeds 3 and 4 in the opposite halves
//                     from seeds 1 and 2, etc.
//
//   band              A group of seeds with shared treatment during
//                     randomization:
//                       Band 1: seeds  1-8   -- fixed, never randomized
//                       Band 2: seeds  9-16  -- shuffled within band
//                       Band 3: seeds 17-32  -- shuffled within band
//                       Band 4: seeds 33-64  -- shuffled within band
//
//   byes              When the seed list has fewer athletes than the
//                     bracket size, byes are distributed band-by-band,
//                     top-down.  Band 1 always gets byes first (all 8 if
//                     there are that many to give).  Band 2 gets the next
//                     batch, randomly selected within band.  Etc.
//
// Determinism:
//
//   All randomization uses mulberry32 seeded from events.dual_random_seed
//   (a stored string).  Same stored seed + same input = identical output,
//   every time.  No Math.random() anywhere in this file.

// ---------------------------------------------------------------------------
// Seedable PRNG
// ---------------------------------------------------------------------------

/**
 * Mulberry32 -- a tiny, fast, high-quality seedable PRNG.
 * Returns a function that yields floats in [0, 1).
 *
 * @param {number} seed  32-bit unsigned integer seed
 * @returns {() => number}
 */
function mulberry32(seed) {
  let state = seed >>> 0;
  return function () {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic string-to-uint32 hash.  Used to convert a stored
 * events.dual_random_seed (which may be a UUID, a timestamp string, or any
 * other text) into a numeric seed for mulberry32.
 *
 * Implementation: FNV-1a 32-bit.  Stable, zero-dependency, no collisions
 * for the inputs we care about.
 *
 * @param {string} str
 * @returns {number}  unsigned 32-bit integer
 */
function hashStringToSeed(str) {
  const s = String(str == null ? '' : str);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Fisher-Yates shuffle using a seeded PRNG.  Pure: returns a new array.
 *
 * @param {Array} arr
 * @param {() => number} rng  PRNG from mulberry32
 * @returns {Array}
 */
function shuffleWith(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

// ---------------------------------------------------------------------------
// Standard seeded knockout placement
// ---------------------------------------------------------------------------

// Verified reference patterns from the FIS / IBU / USTA seeding convention.
// These place seed 1 at slot 1, seed 2 at the last slot, and ensure the
// top two seeds meet only in the final.
const BRACKET_8  = [1, 8, 4, 5, 3, 6, 2, 7];
const BRACKET_16 = [1, 16, 8, 9, 5, 12, 4, 13, 3, 14, 6, 11, 7, 10, 2, 15];

/**
 * Expand a size-N bracket pattern to size 2N.
 *
 * Rule: for each position p in the size-N pattern, produce the pair
 * (p, 2N + 1 - p) in the size-2N pattern.  This preserves the property
 * that the top seed in each half plays the bottom seed in that half in
 * the first round.
 *
 * @param {number[]} pattern
 * @returns {number[]}
 */
function doublePattern(pattern) {
  const size2N = pattern.length * 2;
  const out = [];
  for (const p of pattern) {
    out.push(p);
    out.push(size2N + 1 - p);
  }
  return out;
}

/**
 * Return the standard seeded bracket order for the given size.
 * Valid sizes: 2, 4, 8, 16, 32, 64.
 *
 * The returned array has length === size.  Element at index i is the
 * seed number (1-based) placed at slot (i+1) in the first round.
 *
 * @param {number} size  power of 2 in [2, 64]
 * @returns {number[]}
 */
function standardSeedOrder(size) {
  if (size === 2)   return [1, 2];
  if (size === 4)   return [1, 4, 2, 3];
  if (size === 8)   return BRACKET_8.slice();
  if (size === 16)  return BRACKET_16.slice();
  if (size === 32)  return doublePattern(BRACKET_16);
  if (size === 64)  return doublePattern(doublePattern(BRACKET_16));
  if (size === 128) return doublePattern(doublePattern(doublePattern(BRACKET_16)));
  throw new Error('standardSeedOrder: unsupported bracket size ' + size);
}

/**
 * Return the smallest power of 2 >= n, within [2, 128].
 *
 * @param {number} n  participant count
 * @returns {number}
 */
function effectiveBracketSize(n) {
  if (n <= 2) return 2;
  let size = 2;
  while (size < n && size < 128) size *= 2;
  return size;
}

// ---------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------

/**
 * Return an array of band definitions { band, min, max, cap } for the
 * given bracket size, trimmed so no band exceeds the bracket.
 *
 * Band 1: 1-8     (fixed, never randomized)
 * Band 2: 9-16    (randomized within band)
 * Band 3: 17-32   (randomized within band)
 * Band 4: 33+     (randomized as a single group, no upper cap)
 *
 * @param {number} bracketSize
 * @returns {Array<{band:number,min:number,max:number,cap:number}>}
 */
function bandsForSize(bracketSize) {
  const all = [
    { band: 1, min: 1,  max: 8,    cap: 8    },
    { band: 2, min: 9,  max: 16,   cap: 8    },
    { band: 3, min: 17, max: 32,   cap: 16   },
    { band: 4, min: 33, max: 9999, cap: 9999 },
  ];
  return all.filter(b => b.min <= bracketSize).map(b => ({
    ...b,
    max: Math.min(b.max, bracketSize),
    cap: Math.min(b.cap, bracketSize - b.min + 1),
  }));
}

// ---------------------------------------------------------------------------
// Band randomization
// ---------------------------------------------------------------------------

/**
 * Apply band randomization to the standard seed order.
 *
 * For each band 2, 3, 4:
 *   - Identify the slot indices in the standard order where the band's
 *     seeds currently sit.
 *   - Separate those slot indices into "real positions" (slot holds a
 *     seed <= R, i.e. a real participating athlete) and "ghost positions"
 *     (slot holds a seed > R, i.e. an empty slot).
 *   - Shuffle ONLY the real seeds among the real positions.  Ghost
 *     positions and the ghost seed numbers that sit in them are left
 *     untouched.
 *
 * Band 1 (seeds 1-8) is never shuffled -- seeds 1-8 keep their standard
 * slot positions.
 *
 * The preservation of ghost positions is what makes the band-by-band
 * bye distribution match the spec.  The standard recursive pattern
 * naturally pairs the highest band-4 seeds with band-1 (for deep
 * brackets), then band-2, then band-3, and only pairs within band 4
 * itself at the deepest level.  Since ghost seed numbers are always
 * the highest in the pool (R+1..B), leaving them in their standard
 * positions ensures band-1 seeds always get byes first when the number
 * of byes allows it, then band-2, then band-3, then band-4, matching
 * the spec's "top-down" distribution rule.
 *
 * Within each band, the CHOICE of which real seeds end up paired with
 * ghost-partner slots (and therefore receive byes) IS randomized,
 * because the real seeds are shuffled among all real positions in the
 * band, some of which happen to be paired with ghost partners.  For
 * 50/64, band 2 has 8 real slot positions of which 6 have ghost
 * partners, and shuffling seeds 9-16 among those 8 slots produces 6
 * random bye recipients and 2 random first-round players.
 *
 * @param {number[]} standardOrder  output of standardSeedOrder(size)
 * @param {number} R                number of real athletes (seeds 1..R
 *                                  are real, seeds R+1..size are ghosts)
 * @param {() => number} rng        PRNG from mulberry32
 * @returns {number[]}
 */
function applyBandRandomization(standardOrder, R, rng) {
  const bracketSize = standardOrder.length;
  const out = standardOrder.slice();
  const bands = bandsForSize(bracketSize);

  for (const band of bands) {
    if (band.band === 1) continue; // band 1 is fixed

    // Slot indices where this band's seeds currently sit (pre-shuffle).
    const slotIndices = [];
    for (let i = 0; i < out.length; i++) {
      if (out[i] >= band.min && out[i] <= band.max) slotIndices.push(i);
    }
    if (slotIndices.length < 2) continue;

    // Partition into real positions vs ghost positions based on whether
    // the seed currently at that slot is real (<= R) or a ghost (> R).
    const realSlotIndices = [];
    const realSeedsInBand = [];
    for (const i of slotIndices) {
      if (out[i] <= R) {
        realSlotIndices.push(i);
        realSeedsInBand.push(out[i]);
      }
    }
    if (realSeedsInBand.length < 2) continue;

    // Shuffle only the real seeds and write them back to the real slot
    // positions.  Ghost positions are untouched.
    const shuffled = shuffleWith(realSeedsInBand, rng);
    for (let k = 0; k < realSlotIndices.length; k++) {
      out[realSlotIndices[k]] = shuffled[k];
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Full bracket build
// ---------------------------------------------------------------------------

/**
 * Build a full first-round bracket placement.
 *
 * Input:
 *   R:           number of athletes in the seed list (participating seeds
 *                are 1..R)
 *   bracketSize: chosen bracket size (2, 4, 8, 16, 32, 64)
 *   storedSeed:  events.dual_random_seed (string)
 *
 * Algorithm (simple and robust):
 *   1. Start from standardSeedOrder(bracketSize).
 *   2. Apply band randomization (shuffle seeds within band-2, band-3,
 *      band-4 slot-index sets, using the deterministic PRNG).  Band 1
 *      is left untouched.
 *   3. Walk the final order in pairs of (slot 2k, slot 2k+1).  For each
 *      pair, classify:
 *        - Both seeds <= R: real match.
 *        - Exactly one seed > R: bye match.  The <= R seed advances.
 *        - Both seeds > R: empty match (omitted from output).
 *   4. The "bye set" returned is the set of seeds that receive byes
 *      after placement (i.e. seeds whose partner slot holds a ghost).
 *      This is the operationally correct set for downstream consumers
 *      (auto-advance logic, scoreboard display, etc.).
 *
 * Output: { size, byes, order, pairs, ghostSeeds }
 *   size:       bracketSize
 *   order:      Array of length bracketSize, element i is the seed at
 *               slot (i+1) after randomization.
 *   byes:       Set<number> of seeds receiving byes.
 *   ghostSeeds: Set<number> of seed numbers > R (the "empty slots" in
 *               the bracket).
 *   pairs:      Array of first-round match descriptors:
 *                 {
 *                   matchIndex:  1-based,
 *                   blueSeed:    number|null,
 *                   redSeed:     number|null,
 *                   blueIsBye:   boolean,
 *                   redIsBye:    boolean,
 *                   isByeMatch:  boolean,
 *                 }
 *               Empty matches (both sides ghost) are omitted.
 *
 * @param {number} R
 * @param {number} bracketSize
 * @param {string} storedSeed
 * @returns {{size:number, byes:Set<number>, ghostSeeds:Set<number>, order:number[], pairs:Array}}
 */
function buildPlacement(R, bracketSize, storedSeed) {
  if (R < 1) throw new Error('buildPlacement: need at least 1 athlete');
  if (bracketSize < 2) throw new Error('buildPlacement: bracket size must be >= 2');

  const rng = mulberry32(hashStringToSeed(storedSeed));
  const standard = standardSeedOrder(bracketSize);
  const order = applyBandRandomization(standard, R, rng);

  // Ghost seeds: any seed number > R.
  const ghostSeeds = new Set();
  for (let s = R + 1; s <= bracketSize; s++) ghostSeeds.add(s);

  // Compute pairs and bye set.
  const byes = new Set();
  const pairs = [];
  for (let k = 0; k < bracketSize; k += 2) {
    const blueSeed = order[k];
    const redSeed = order[k + 1];
    const blueIsGhost = ghostSeeds.has(blueSeed);
    const redIsGhost = ghostSeeds.has(redSeed);

    if (blueIsGhost && redIsGhost) continue; // skip empty

    const blueIsBye = !blueIsGhost && redIsGhost;
    const redIsBye = !redIsGhost && blueIsGhost;
    if (blueIsBye) byes.add(blueSeed);
    if (redIsBye) byes.add(redSeed);

    pairs.push({
      matchIndex: (k / 2) + 1,
      blueSeed: blueIsGhost ? null : blueSeed,
      redSeed: redIsGhost ? null : redSeed,
      blueIsBye,
      redIsBye,
      isByeMatch: blueIsBye || redIsBye,
    });
  }

  // Defensive: every real seed (1..R) must appear exactly once in the order.
  const seen = new Set();
  for (const s of order) {
    if (s <= R) {
      if (seen.has(s)) throw new Error(`buildPlacement: duplicate real seed ${s}`);
      seen.add(s);
    }
  }
  if (seen.size !== R) {
    throw new Error(`buildPlacement: missing real seeds (saw ${seen.size}/${R})`);
  }

  return { size: bracketSize, byes, ghostSeeds, order, pairs };
}

module.exports = {
  mulberry32,
  hashStringToSeed,
  shuffleWith,
  standardSeedOrder,
  doublePattern,
  effectiveBracketSize,
  bandsForSize,
  applyBandRandomization,
  buildPlacement,
};
