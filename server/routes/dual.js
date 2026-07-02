const router = require('express').Router({ mergeParams: true });
const { queryAll, queryOne, execute, uuidv4 } = require('../db/schema');
const { logAudit } = require('./audit');
const { rankResults, calcDualMogulPointSplit, pickBestRun } = require('../scoring/engine');
const { requireAuth } = require('../middleware/auth');
const {
  buildPlacement,
  effectiveBracketSize,
  hashStringToSeed,
  mulberry32,
} = require('../dual/placement');
const { normalizeGender } = require('../utils/gender');
const { requireUnlocked } = require('../middleware/lockCheck');
router.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return requireUnlocked()(req, res, next);
  next();
});

// ---------------------------------------------------------------------------
// v1.6 Helpers
// ---------------------------------------------------------------------------

/**
 * Ensure the event has a stored dual_random_seed.  Returns the seed
 * string (generating and persisting one if needed).  The seed is used
 * for all deterministic randomization (band shuffles, bye distribution,
 * tiebreakers).
 */
async function ensureDualRandomSeed(eventId) {
  const ev = await queryOne('SELECT dual_random_seed FROM events WHERE id=?', [eventId]);
  if (ev && ev.dual_random_seed) return ev.dual_random_seed;
  // Bootstrap: generate a one-time random seed string.  We use Node's
  // crypto module instead of Math.random() so that no Math.random() call
  // site exists anywhere in the seeding/bracketing code path.
  const crypto = require('crypto');
  const entropy = crypto.randomBytes(8).toString('hex');
  const seed = `${eventId}-${Date.now()}-${entropy}`;
  await execute('UPDATE events SET dual_random_seed=? WHERE id=?', [seed, eventId]);
  return seed;
}

/**
 * Load all registrations for a dual event, joined with athlete info and
 * USSS dm_points (via athletes.ussa_num -> usss_people.ussa_id).
 * Excludes scratched/dns registrations.
 */
async function loadDualRegistrationsWithUsss(eventId) {
  return queryAll(
    `SELECT reg.id         AS registration_id,
            reg.athlete_id,
            reg.bib_number,
            reg.dual_seed,
            a.first_name,
            a.last_name,
            a.gender,
            a.ussa_num,
            a.club,
            up.dm_points
       FROM registrations reg
       JOIN athletes a ON a.id = reg.athlete_id
       LEFT JOIN usss_people up ON up.ussa_id = a.ussa_num
      WHERE reg.event_id = ?
        AND reg.status NOT IN ('scratched','dns')
      ORDER BY a.last_name, a.first_name`,
    [eventId]
  );
}

/**
 * Compute official placings for a source mogul event using the same
 * logic as the Results tab: best complete qualification run per
 * athlete, ranked via rankResults from the scoring engine.
 *
 * Returns a Map keyed by athlete_id with value { rank, total_score }.
 * Flagged runs (run_status non-null) are NOT given a rank -- they are
 * omitted from the map, matching the behavior of the Results tab.
 */
async function computeOfficialPlacings(sourceEventId) {
  const runs = await queryAll(
    `SELECT r.*, reg.athlete_id
       FROM runs r
       JOIN registrations reg ON reg.id = r.registration_id
      WHERE r.event_id = ? AND r.round = 'qualification' AND r.status = 'complete'`,
    [sourceEventId]
  );

  // Scored = runs without run_status flag.  Best run per athlete.
  const scoredRuns = runs.filter(r => !r.run_status);
  const best = pickBestRun(scoredRuns, 'mogul', r => r.athlete_id);

  const ranked = rankResults(Object.values(best), 'mogul');
  const out = new Map();
  for (const r of ranked) {
    out.set(r.athlete_id, { rank: r.rank, total_score: r.total_score });
  }
  return out;
}

/**
 * True if any match in the event's dual bracket has status in a started
 * state (hj_pending or complete) or has any runs recorded.
 */
async function bracketHasStartedMatches(eventId) {
  const statusHit = await queryOne(
    `SELECT COUNT(*) AS cnt FROM dual_bracket
      WHERE event_id = ? AND status IN ('hj_pending','complete') AND is_bye = 0`,
    [eventId]
  );
  if (statusHit && parseInt(statusHit.cnt) > 0) return true;

  const runHit = await queryOne(
    `SELECT COUNT(*) AS cnt FROM runs
      WHERE event_id = ? AND round = 'dual'`,
    [eventId]
  );
  return runHit && parseInt(runHit.cnt) > 0;
}

/**
 * Pick the default source mogul event for a dual event's seed-list
 * creation.  Preference order:
 *   1. The dual event's qualifier_event_id, if it points to a mogul
 *      event in the same meet with matching gender.
 *   2. The most recent mogul event in the same meet with matching
 *      gender, ordered by event_date DESC then created_at DESC.
 *   3. null if none available.
 */
async function pickDefaultSourceMogulEvent(dualEvent) {
  if (!dualEvent) return null;

  if (dualEvent.qualifier_event_id) {
    const q = await queryOne(
      `SELECT * FROM events
        WHERE id = ? AND meet_id = ? AND discipline = 'mogul' AND gender = ?`,
      [dualEvent.qualifier_event_id, dualEvent.meet_id, dualEvent.gender]
    );
    if (q) return q;
  }

  const recent = await queryOne(
    `SELECT * FROM events
      WHERE meet_id = ? AND discipline = 'mogul' AND gender = ? AND id != ?
      ORDER BY event_date DESC, created_at DESC
      LIMIT 1`,
    [dualEvent.meet_id, dualEvent.gender, dualEvent.id]
  );
  return recent || null;
}

/**
 * Candidate source mogul events: all mogul events in the same meet with
 * matching gender, ordered by event_date DESC then created_at DESC.
 */
async function loadCandidateSourceEvents(dualEvent) {
  if (!dualEvent) return [];
  return queryAll(
    `SELECT id, name, event_date, created_at FROM events
      WHERE meet_id = ? AND discipline = 'mogul' AND gender = ? AND id != ?
      ORDER BY event_date DESC, created_at DESC`,
    [dualEvent.meet_id, dualEvent.gender, dualEvent.id]
  );
}

// ---------------------------------------------------------------------------
// advancementSlot — determine blue/red slot for winner advancing to next round
// Alternates courses each round: top seed is blue in first round, red next, etc.
// ---------------------------------------------------------------------------
function advancementSlot(bracketPosition, bracketRound, totalRound) {
  const shouldFlip = (totalRound - bracketRound) % 2 === 0;
  if (shouldFlip) {
    return bracketPosition % 2 === 1 ? 'registration_id_red' : 'registration_id_blue';
  }
  return bracketPosition % 2 === 1 ? 'registration_id_blue' : 'registration_id_red';
}

// ---------------------------------------------------------------------------
// advanceWinner — shared bracket advancement logic
// Used by: PUT /:matchId/winner, POST /:matchId/approve, POST /:matchId/paper-score
// ---------------------------------------------------------------------------
async function advanceWinner(eventId, match, winnerId, loserId) {
  // F-2: consolation semifinals (runoff_to_8th 5-8 bracket). The semi winner
  // advances to the 5/6 final (round 1 pos 3); the loser drops to the 7/8 final
  // (round 1 pos 4). Fill blue slot first, then red, matching the seeding pattern.
  if (match.is_small_final && match.bracket_round === 2) {
    if (winnerId) {
      const final56 = await queryOne(
        'SELECT * FROM dual_bracket WHERE event_id=? AND bracket_round=1 AND bracket_position=3 AND is_small_final=1',
        [eventId]
      );
      if (final56) {
        const slot = !final56.registration_id_blue ? 'registration_id_blue' : 'registration_id_red';
        await execute(`UPDATE dual_bracket SET ${slot}=?, updated_at=datetime('now') WHERE id=?`, [winnerId, final56.id]);
      }
    }
    if (loserId) {
      const final78 = await queryOne(
        'SELECT * FROM dual_bracket WHERE event_id=? AND bracket_round=1 AND bracket_position=4 AND is_small_final=1',
        [eventId]
      );
      if (final78) {
        const slot = !final78.registration_id_blue ? 'registration_id_blue' : 'registration_id_red';
        await execute(`UPDATE dual_bracket SET ${slot}=?, updated_at=datetime('now') WHERE id=?`, [loserId, final78.id]);
      }
    }
    return;
  }

  if (match.bracket_round > 1 && !match.is_small_final) {
    const nextRound = match.bracket_round - 1;
    const nextPos   = Math.ceil(match.bracket_position / 2);
    const nextMatch = await queryOne(
      'SELECT * FROM dual_bracket WHERE event_id=? AND bracket_round=? AND bracket_position=? AND is_small_final=0',
      [eventId, nextRound, nextPos]
    );
    if (nextMatch) {
      const trRow = await queryOne(
        'SELECT MAX(bracket_round) AS total_round FROM dual_bracket WHERE event_id=? AND is_small_final=0',
        [eventId]
      );
      const totalRound = trRow ? trRow.total_round : match.bracket_round;
      const slot = advancementSlot(match.bracket_position, match.bracket_round, totalRound);
      await execute(
        `UPDATE dual_bracket SET ${slot}=?, updated_at=datetime('now') WHERE id=?`,
        [winnerId, nextMatch.id]
      );
    }

    // Seed loser into consolation bracket
    if (loserId) {
      const event     = await queryOne('SELECT runoff_option FROM events WHERE id=?', [eventId]);
      const runoffOpt = (event && event.runoff_option) || 'runoff_to_4th';

      if (nextRound === 1 && (runoffOpt === 'runoff_to_4th' || runoffOpt === 'runoff_to_8th')) {
        const con = await queryOne(
          'SELECT * FROM dual_bracket WHERE event_id=? AND bracket_round=1 AND is_small_final=1 AND bracket_position=2',
          [eventId]
        );
        if (con) {
          const cSlot = !con.registration_id_blue ? 'registration_id_blue' : 'registration_id_red';
          await execute(`UPDATE dual_bracket SET ${cSlot}=?, updated_at=datetime('now') WHERE id=?`, [loserId, con.id]);
        }
      }
      if (nextRound === 2 && runoffOpt === 'runoff_to_8th') {
        const consPos = match.bracket_position % 2 === 1 ? 3 : 4;
        const con = await queryOne(
          'SELECT * FROM dual_bracket WHERE event_id=? AND bracket_round=2 AND bracket_position=? AND is_small_final=1',
          [eventId, consPos]
        );
        if (con) {
          const cSlot = !con.registration_id_blue ? 'registration_id_blue' : 'registration_id_red';
          await execute(`UPDATE dual_bracket SET ${cSlot}=?, updated_at=datetime('now') WHERE id=?`, [loserId, con.id]);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// v1.16.17 — bracket-complete detection for HJ final review flow
// Returns true when every existing bracket match is complete (or a bye).
// Handles edge cases like missing consolation final / 2-athlete runoff.
// ---------------------------------------------------------------------------
async function isBracketFullyComplete(eventId) {
  const rows = await queryAll(
    'SELECT status, is_bye FROM dual_bracket WHERE event_id=?',
    [eventId]
  );
  if (!rows.length) return false;
  return rows.every(r => r.status === 'complete' || r.is_bye === 1);
}

async function maybeMarkBracketReviewPending(eventId, app) {
  const ev = await queryOne(
    'SELECT dual_bracket_review_status, status FROM events WHERE id=?',
    [eventId]
  );
  if (!ev) return false;
  if (ev.status === 'complete') return false;
  if (ev.dual_bracket_review_status && ev.dual_bracket_review_status !== 'sent_back') return false;
  if (!(await isBracketFullyComplete(eventId))) return false;
  await execute(
    `UPDATE events SET dual_bracket_review_status='pending', updated_at=datetime('now') WHERE id=?`,
    [eventId]
  );
  if (app && typeof app.broadcast === 'function') {
    app.broadcast(eventId, 'dual_bracket_review', { status: 'pending' });
  }
  return true;
}

async function clearDualBracketReviewStatus(eventId, app) {
  const ev = await queryOne('SELECT dual_bracket_review_status FROM events WHERE id=?', [eventId]);
  if (!ev || !ev.dual_bracket_review_status) return;
  if (ev.dual_bracket_review_status === 'approved') return;
  await execute(
    `UPDATE events SET dual_bracket_review_status=NULL, updated_at=datetime('now') WHERE id=?`,
    [eventId]
  );
  if (app && typeof app.broadcast === 'function') {
    app.broadcast(eventId, 'dual_bracket_review', { status: null });
  }
}

// ---------------------------------------------------------------------------
// Pairing number helper — global sequential match numbering for run order
// ---------------------------------------------------------------------------
/**
 * Compute a Map of match.id → pairing number for every non-bye match in the
 * event's bracket.  Numbering follows actual run order: qualifying rounds
 * first (top-to-bottom, left-to-right), then finals interleaved with
 * consolation matches per run-order rules.
 *
 * Returns { pairingNums: Map<id, number>, genderPrefix: 'M'|'W' }.
 */
async function computePairingNumbers(eventId) {
  const event = await queryOne('SELECT runoff_option, gender FROM events WHERE id=?', [eventId]);
  const runoffOption = event?.runoff_option || 'runoff_to_4th';
  const genderPrefix = normalizeGender(event?.gender) === 'F' ? 'W' : 'M';

  const allMatches = await queryAll(
    `SELECT id, bracket_round, bracket_position, is_small_final, is_bye
       FROM dual_bracket WHERE event_id = ?
       ORDER BY bracket_round DESC, bracket_position`,
    [eventId]
  );

  const mainMatches  = allMatches.filter(m => !m.is_small_final);
  const consolMatches = allMatches
    .filter(m => m.is_small_final)
    .sort((a, b) => b.bracket_round - a.bracket_round || a.bracket_position - b.bracket_position);

  if (!mainMatches.length) return { pairingNums: new Map(), genderPrefix };

  const totalRound = Math.max(...mainMatches.map(m => m.bracket_round));
  const finalsRound = (runoffOption === 'runoff_to_8th' && totalRound >= 3) ? 3 : 2;

  const qualRounds = [];
  for (let r = totalRound; r > finalsRound; r--) qualRounds.push(r);

  const pairingNums = new Map();
  let num = 0;

  function addMainRound(round) {
    mainMatches
      .filter(m => m.bracket_round === round && !m.is_bye)
      .sort((a, b) => a.bracket_position - b.bracket_position)
      .forEach(m => { num++; pairingNums.set(m.id, num); });
  }

  // Look up a small-final by (round, position) and assign the next pairing number.
  const addSmall = (round, pos) => {
    const m = consolMatches.find(s => s.bracket_round === round && s.bracket_position === pos && !s.is_bye);
    if (m) { num++; pairingNums.set(m.id, num); }
  };

  // Qualifying rounds
  for (const r of qualRounds) addMainRound(r);

  // Finals + consolation interleaved in run order
  if (runoffOption === 'runoff_to_8th' && totalRound >= 3) {
    addMainRound(3);            // QF
    addSmall(2, 3);            // consolation semi A (F-2; legacy: terminal 5/6)
    addSmall(2, 4);            // consolation semi B (F-2; legacy: terminal 7/8)
    addMainRound(2);            // SF
    addSmall(1, 4);            // 7/8 final (F-2 new structure only)
    addSmall(1, 3);            // 5/6 final (F-2 new structure only)
    addSmall(1, 2);            // 3/4 final
    addMainRound(1);            // Championship final
  } else {
    addMainRound(2);            // SF
    addSmall(1, 2);            // 3/4 final
    addMainRound(1);            // Final
  }

  return { pairingNums, genderPrefix };
}

/**
 * Format a pairing label string, e.g. "W-01" or "M-17".
 */
function formatPairingLabel(genderPrefix, num) {
  return `${genderPrefix}-${String(num).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Legacy helpers (kept for backwards compatibility with older callers)
// ---------------------------------------------------------------------------

function nextPowerOf2(n) {
  return Math.pow(2, Math.ceil(Math.log2(Math.max(n, 2))));
}

async function buildBracketShell(eventId, fieldSize, runoffOption) {
  await execute(`DELETE FROM dual_bracket WHERE event_id=?`, [eventId]);

  const size       = nextPowerOf2(fieldSize);
  const totalRound = Math.log2(size);
  const inserts    = [];

  // Main bracket rounds (1 = Championship Final, totalRound = first round played)
  for (let round = 1; round <= totalRound; round++) {
    const matchesInRound = Math.pow(2, round - 1);
    for (let pos = 1; pos <= matchesInRound; pos++) {
      inserts.push(execute(
        `INSERT INTO dual_bracket (id,event_id,bracket_round,bracket_position,is_small_final)
         VALUES (?,?,?,?,0)`,
        [uuidv4(), eventId, round, pos]
      ));
    }
  }

  // Consolation matches
  if (runoffOption === 'runoff_to_4th' || runoffOption === 'runoff_to_8th') {
    inserts.push(execute(
      `INSERT INTO dual_bracket (id,event_id,bracket_round,bracket_position,is_small_final)
       VALUES (?,?,1,2,1)`,
      [uuidv4(), eventId]
    ));
  }

  if (runoffOption === 'runoff_to_8th' && totalRound >= 3) {
    // F-2: real 5-8 mini-bracket. Round 2 small finals are CONSOLATION SEMIS
    // (QF losers land here); round 1 small finals pos 3/4 are the 5/6 and 7/8
    // FINALS (consolation-semi winners/losers land there). Per USSS 4310.3.2.
    inserts.push(execute(
      `INSERT INTO dual_bracket (id,event_id,bracket_round,bracket_position,is_small_final)
       VALUES (?,?,2,3,1)`,
      [uuidv4(), eventId]
    ));
    inserts.push(execute(
      `INSERT INTO dual_bracket (id,event_id,bracket_round,bracket_position,is_small_final)
       VALUES (?,?,2,4,1)`,
      [uuidv4(), eventId]
    ));
    inserts.push(execute(
      `INSERT INTO dual_bracket (id,event_id,bracket_round,bracket_position,is_small_final)
       VALUES (?,?,1,3,1)`,  // 5/6 final
      [uuidv4(), eventId]
    ));
    inserts.push(execute(
      `INSERT INTO dual_bracket (id,event_id,bracket_round,bracket_position,is_small_final)
       VALUES (?,?,1,4,1)`,  // 7/8 final
      [uuidv4(), eventId]
    ));
  }

  await Promise.all(inserts);
  return { size, totalRound };
}

/**
 * Populate the first-round matches of the bracket shell from a placement
 * helper result.  Uses placement.buildPlacement under the hood.
 *
 * Inputs:
 *   eventId       -- dual event id
 *   seedList      -- array of { registration_id, seed } where seed is
 *                    the 1..R seed-list rank (integer, no gaps).  Must
 *                    already be sorted by seed ascending.
 *   totalRound    -- from buildBracketShell (the first round number,
 *                    which is the "round of N" count expressed as a
 *                    bracket-round depth)
 *   bracketSize   -- B (the size the bracket shell was built for)
 *   storedSeed    -- events.dual_random_seed for deterministic placement
 *
 * Populates registration_id_blue/red, seed_blue/red, is_bye, and
 * advances byes to the next round.
 */
async function populateFirstRoundFromPlacement(eventId, seedList, totalRound, bracketSize, storedSeed) {
  const R = seedList.length;
  const placement = buildPlacement(R, bracketSize, storedSeed);

  // Map: seed number -> registration_id (only for real seeds 1..R)
  const seedToReg = new Map();
  for (const s of seedList) seedToReg.set(s.seed, s.registration_id);

  const firstRound = totalRound; // "first round played" == largest round number

  for (const pair of placement.pairs) {
    const match = await queryOne(
      `SELECT id FROM dual_bracket
        WHERE event_id = ? AND bracket_round = ? AND bracket_position = ? AND is_small_final = 0`,
      [eventId, firstRound, pair.matchIndex]
    );
    if (!match) continue;

    const blueRegId = pair.blueSeed != null ? seedToReg.get(pair.blueSeed) || null : null;
    const redRegId  = pair.redSeed  != null ? seedToReg.get(pair.redSeed)  || null : null;

    await execute(
      `UPDATE dual_bracket
          SET registration_id_blue = ?,
              registration_id_red  = ?,
              seed_blue            = ?,
              seed_red             = ?,
              is_bye               = ?,
              updated_at           = datetime('now')
        WHERE id = ?`,
      [
        blueRegId,
        redRegId,
        pair.blueSeed,
        pair.redSeed,
        pair.isByeMatch ? 1 : 0,
        match.id,
      ]
    );

    // Auto-advance bye
    if (pair.isByeMatch) {
      const winnerId = pair.blueIsBye ? blueRegId : redRegId;
      if (winnerId) {
        await execute(
          `UPDATE dual_bracket
              SET winner_registration_id = ?, status = 'complete',
                  updated_at = datetime('now')
            WHERE id = ?`,
          [winnerId, match.id]
        );

        if (firstRound > 1) {
          const nextRound = firstRound - 1;
          const nextPos = Math.ceil(pair.matchIndex / 2);
          const nextMatch = await queryOne(
            `SELECT * FROM dual_bracket
              WHERE event_id = ? AND bracket_round = ? AND bracket_position = ? AND is_small_final = 0`,
            [eventId, nextRound, nextPos]
          );
          if (nextMatch) {
            const slot = advancementSlot(pair.matchIndex, firstRound, totalRound);
            await execute(
              `UPDATE dual_bracket SET ${slot} = ?, updated_at = datetime('now') WHERE id = ?`,
              [winnerId, nextMatch.id]
            );
          }
        }
      }
    }
  }
}

/**
 * Load the current seed list from registrations.dual_seed for an event.
 * Returns an array of { registration_id, seed } sorted by seed ascending.
 * Ranks decimal seeds into sequential 1..R integers (so manual 5.5
 * overrides work).  Only includes registrations with non-null dual_seed
 * and not scratched/dns.
 */
async function loadSeedList(eventId) {
  const rows = await queryAll(
    `SELECT id AS registration_id, dual_seed
       FROM registrations
      WHERE event_id = ?
        AND dual_seed IS NOT NULL
        AND status NOT IN ('scratched','dns')
      ORDER BY dual_seed ASC`,
    [eventId]
  );
  return rows.map((r, i) => ({
    registration_id: r.registration_id,
    seed: i + 1, // re-rank to sequential integers for placement
    original_dual_seed: r.dual_seed,
  }));
}

// ---------------------------------------------------------------------------
// Seed-list persistence helper (used by all three new modes)
// ---------------------------------------------------------------------------

/**
 * Persist a computed seed list to registrations.dual_seed along with
 * dual_seed_source and dual_seed_source_value for audit.  Also clears
 * dual_seed for any registration in the event that is not in the list
 * (so re-running seed-list creation with a smaller pool does not leave
 * stale seeds behind).
 *
 * Input: array of { registration_id, seed, source, source_value }
 */
async function persistSeedList(eventId, entries, overallSource) {
  // Clear existing dual_seed for all registrations in this event.
  await execute(
    `UPDATE registrations
        SET dual_seed = NULL,
            dual_seed_source = NULL,
            dual_seed_source_value = NULL
      WHERE event_id = ?`,
    [eventId]
  );

  for (const e of entries) {
    await execute(
      `UPDATE registrations
          SET dual_seed = ?,
              dual_seed_source = ?,
              dual_seed_source_value = ?
        WHERE id = ?`,
      [e.seed, e.source || overallSource || null, e.source_value || null, e.registration_id]
    );
  }
}

// Standard bracket seeding pairs (1 vs size, 2 vs size-1, ...)
// Kept for any legacy caller; placement.js is the authoritative source now.
function buildSeedPairs(size) {
  const pairs = [];
  for (let i = 0; i < size / 2; i++) {
    pairs.push([i + 1, size - i]);
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// GET bracket
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const bracket = await queryAll(
      `SELECT db.*,
        ab.first_name as blue_first, ab.last_name as blue_last, rb.bib_number as blue_bib,
        ar.first_name as red_first,  ar.last_name as red_last,  rr.bib_number as red_bib,
        aw.first_name as winner_first, aw.last_name as winner_last,
        rb.dual_seed as blue_dual_seed, rr.dual_seed as red_dual_seed,
        (SELECT SUM(djp.blue_points) FROM dual_judge_points djp WHERE djp.match_id = db.id) as blue_total,
        (SELECT SUM(djp.red_points)  FROM dual_judge_points djp WHERE djp.match_id = db.id) as red_total
       FROM dual_bracket db
       LEFT JOIN registrations rb ON rb.id = db.registration_id_blue
       LEFT JOIN athletes ab      ON ab.id = rb.athlete_id
       LEFT JOIN registrations rr ON rr.id = db.registration_id_red
       LEFT JOIN athletes ar      ON ar.id = rr.athlete_id
       LEFT JOIN registrations rw ON rw.id = db.winner_registration_id
       LEFT JOIN athletes aw      ON aw.id = rw.athlete_id
       WHERE db.event_id = ?
       ORDER BY db.bracket_round DESC, db.bracket_position`,
      [req.params.eventId]
    );
    // Attach pairing labels
    const { pairingNums, genderPrefix } = await computePairingNumbers(req.params.eventId);
    const enriched = bracket.map(m => {
      const pNum = pairingNums.get(m.id);
      return { ...m, pairing_label: pNum != null ? formatPairingLabel(genderPrefix, pNum) : null };
    });
    res.json(enriched);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// POST /seed -- seed from explicit seeds array
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// v1.6 -- GET /candidate-source-events
// Returns { default_event_id, events: [...] } for the source mogul event
// picker in DualSeedingPanel.
// ---------------------------------------------------------------------------
router.get('/candidate-source-events', requireAuth, async (req, res) => {
  try {
    const event = await queryOne('SELECT * FROM events WHERE id=?', [req.params.eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const events = await loadCandidateSourceEvents(event);
    const defaultEvent = await pickDefaultSourceMogulEvent(event);
    res.json({
      default_event_id: defaultEvent ? defaultEvent.id : null,
      events,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// POST /seed -- legacy seed endpoint (client provides explicit seeds)
// Preserved for backwards compatibility.  Uses the new placement helper.
// ---------------------------------------------------------------------------
router.post('/seed', requireAuth, async (req, res) => {
  try {
    const event = await queryOne('SELECT * FROM events WHERE id=?', [req.params.eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const { seeds } = req.body;
    if (!seeds || !seeds.length) return res.status(400).json({ error: 'seeds array required' });

    const runoffOption = event.runoff_option || 'runoff_to_4th';
    const sorted = [...seeds].sort((a, b) => a.seed - b.seed)
      .map((s, i) => ({ registration_id: s.registration_id, seed: i + 1 }));

    // Persist the seed list to registrations.dual_seed (no source -- legacy)
    for (const s of sorted) {
      await execute(`UPDATE registrations SET dual_seed=? WHERE id=?`, [s.seed, s.registration_id]);
    }

    const storedSeed = await ensureDualRandomSeed(req.params.eventId);
    const size = effectiveBracketSize(sorted.length);
    const totalRound = Math.log2(size);

    await buildBracketShell(req.params.eventId, size, runoffOption);
    await populateFirstRoundFromPlacement(req.params.eventId, sorted, totalRound, size, storedSeed);

    res.json({ ok: true, bracket_size: size, rounds: totalRound, runoff_option: runoffOption });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// POST /seed-fis -- v1.6: BRACKETING-ONLY step
// Reads the existing seed list from registrations.dual_seed, builds the
// bracket shell, runs the placement helper, and populates the first round.
// Refuses if no seed list exists.  Refuses on started matches without
// force:true in the body.
// ---------------------------------------------------------------------------
router.post('/seed-fis', requireAuth, async (req, res) => {
  try {
    const event = await queryOne('SELECT * FROM events WHERE id=?', [req.params.eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const seedList = await loadSeedList(req.params.eventId);
    if (seedList.length < 2) {
      return res.status(400).json({
        error: 'Create a seed list first on the Registration tab.',
      });
    }

    const force = req.body && req.body.force === true;
    if (!force) {
      const existingBracket = await queryOne(
        'SELECT COUNT(*) AS cnt FROM dual_bracket WHERE event_id = ?',
        [req.params.eventId]
      );
      if (existingBracket && existingBracket.cnt > 0) {
        if (await bracketHasStartedMatches(req.params.eventId)) {
          return res.status(409).json({
            error: 'Bracket already has started matches.  Regenerating will discard those results.',
            started: true,
          });
        }
        return res.status(409).json({
          error: 'A bracket has already been created.  Confirm you want to replace it with a new bracket.',
          exists: true,
        });
      }
    }

    const runoffOption = event.runoff_option || 'runoff_to_4th';
    const size = effectiveBracketSize(seedList.length);
    const totalRound = Math.log2(size);

    const storedSeed = await ensureDualRandomSeed(req.params.eventId);

    await buildBracketShell(req.params.eventId, size, runoffOption);
    await populateFirstRoundFromPlacement(req.params.eventId, seedList, totalRound, size, storedSeed);

    try { await logAudit('dual_bracket_generated', 'event', req.params.eventId, null, { bracket_size: size, seed_count: seedList.length }); } catch (_) {}

    res.json({
      ok: true,
      bracket_size: size,
      rounds: totalRound,
      runoff_option: runoffOption,
      seed_count: seedList.length,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// POST /seed-manual -- manual bracket placement
// User assigns each athlete or BYE to specific blue/red slots.
// ---------------------------------------------------------------------------
router.post('/seed-manual', requireAuth, async (req, res) => {
  try {
    const event = await queryOne('SELECT * FROM events WHERE id=?', [req.params.eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const seedList = await loadSeedList(req.params.eventId);
    if (seedList.length < 2) {
      return res.status(400).json({ error: 'Create a seed list first on the Registration tab.' });
    }

    const force = req.body && req.body.force === true;
    if (!force) {
      const existingBracket = await queryOne(
        'SELECT COUNT(*) AS cnt FROM dual_bracket WHERE event_id = ?',
        [req.params.eventId]
      );
      if (existingBracket && existingBracket.cnt > 0) {
        if (await bracketHasStartedMatches(req.params.eventId)) {
          return res.status(409).json({
            error: 'Bracket already has started matches. Regenerating will discard those results.',
            started: true,
          });
        }
        return res.status(409).json({
          error: 'A bracket has already been created. Confirm you want to replace it with a new bracket.',
          exists: true,
        });
      }
    }

    const { slots } = req.body;
    if (!Array.isArray(slots) || slots.length === 0) {
      return res.status(400).json({ error: 'Slots array is required.' });
    }

    const size = effectiveBracketSize(seedList.length);
    const expectedMatches = size / 2;
    if (slots.length !== expectedMatches) {
      return res.status(400).json({ error: `Expected ${expectedMatches} matches but received ${slots.length}.` });
    }

    // Build lookup: registration_id -> seed number
    const regToSeed = new Map();
    const validRegIds = new Set();
    for (const s of seedList) {
      regToSeed.set(s.registration_id, s.seed);
      validRegIds.add(s.registration_id);
    }

    // Validate slots
    const usedRegIds = new Set();
    for (const slot of slots) {
      if (slot.blue == null || slot.red == null) {
        return res.status(400).json({ error: `Match ${slot.matchIndex}: both blue and red slots must be filled.` });
      }
      if (slot.blue === 'BYE' && slot.red === 'BYE') {
        return res.status(400).json({ error: `Match ${slot.matchIndex}: both sides cannot be BYE.` });
      }
      for (const side of [slot.blue, slot.red]) {
        if (side !== 'BYE') {
          if (!validRegIds.has(side)) {
            return res.status(400).json({ error: `Match ${slot.matchIndex}: registration ID not in seed list.` });
          }
          if (usedRegIds.has(side)) {
            return res.status(400).json({ error: `Match ${slot.matchIndex}: duplicate athlete placement.` });
          }
          usedRegIds.add(side);
        }
      }
    }

    if (usedRegIds.size !== seedList.length) {
      return res.status(400).json({
        error: `All ${seedList.length} seeded athletes must be placed. ${usedRegIds.size} placed.`,
      });
    }

    // Build bracket
    const runoffOption = event.runoff_option || 'runoff_to_4th';
    const totalRound = Math.log2(size);

    await buildBracketShell(req.params.eventId, size, runoffOption);

    const firstRound = totalRound;

    for (const slot of slots) {
      const match = await queryOne(
        `SELECT id FROM dual_bracket
          WHERE event_id = ? AND bracket_round = ? AND bracket_position = ? AND is_small_final = 0`,
        [req.params.eventId, firstRound, slot.matchIndex]
      );
      if (!match) continue;

      const blueRegId = slot.blue !== 'BYE' ? slot.blue : null;
      const redRegId  = slot.red  !== 'BYE' ? slot.red  : null;
      const isBye     = slot.blue === 'BYE' || slot.red === 'BYE';

      await execute(
        `UPDATE dual_bracket
            SET registration_id_blue = ?,
                registration_id_red  = ?,
                seed_blue            = ?,
                seed_red             = ?,
                is_bye               = ?,
                updated_at           = datetime('now')
          WHERE id = ?`,
        [
          blueRegId,
          redRegId,
          blueRegId ? regToSeed.get(blueRegId) : null,
          redRegId  ? regToSeed.get(redRegId)  : null,
          isBye ? 1 : 0,
          match.id,
        ]
      );

      // Auto-advance bye winner
      if (isBye) {
        const winnerId = blueRegId || redRegId;
        if (winnerId) {
          await execute(
            `UPDATE dual_bracket
                SET winner_registration_id = ?, status = 'complete',
                    updated_at = datetime('now')
              WHERE id = ?`,
            [winnerId, match.id]
          );

          if (firstRound > 1) {
            const nextRound = firstRound - 1;
            const nextPos = Math.ceil(slot.matchIndex / 2);
            const nextMatch = await queryOne(
              `SELECT * FROM dual_bracket
                WHERE event_id = ? AND bracket_round = ? AND bracket_position = ? AND is_small_final = 0`,
              [req.params.eventId, nextRound, nextPos]
            );
            if (nextMatch) {
              const advSlot = advancementSlot(slot.matchIndex, firstRound, totalRound);
              await execute(
                `UPDATE dual_bracket SET ${advSlot} = ?, updated_at = datetime('now') WHERE id = ?`,
                [winnerId, nextMatch.id]
              );
            }
          }
        }
      }
    }

    try { await logAudit('dual_bracket_manual', 'event', req.params.eventId, null, { bracket_size: size, seed_count: seedList.length }); } catch (_) {}

    res.json({
      ok: true,
      bracket_size: size,
      rounds: totalRound,
      runoff_option: runoffOption,
      seed_count: seedList.length,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// POST /seed-random -- v1.6: deterministic random seed list
// Uses the stored dual_random_seed so re-running produces identical output.
// ---------------------------------------------------------------------------
router.post('/seed-random', requireAuth, async (req, res) => {
  try {
    const event = await queryOne('SELECT * FROM events WHERE id=?', [req.params.eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const regs = await loadDualRegistrationsWithUsss(req.params.eventId);
    if (!regs.length) return res.status(400).json({ error: 'No active registrations' });

    const storedSeed = await ensureDualRandomSeed(req.params.eventId);
    const rng = mulberry32(hashStringToSeed(storedSeed + ':seed-random'));

    const shuffled = regs.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const entries = shuffled.map((r, i) => ({
      registration_id: r.registration_id,
      seed: i + 1,
      source: 'random_tiebreak',
      source_value: `random rank ${i + 1}`,
    }));

    await persistSeedList(req.params.eventId, entries, 'random_tiebreak');
    res.json({ ok: true, count: entries.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// POST /seed-from-event -- v1.6: seed list from mogul event official placings
// Legacy route name, preserved.  Uses computeOfficialPlacings (same logic
// as the Results tab), NOT raw qualification scores.
// ---------------------------------------------------------------------------
router.post('/seed-from-event', requireAuth, async (req, res) => {
  try {
    const event = await queryOne('SELECT * FROM events WHERE id=?', [req.params.eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const { sourceEventId, source_event_id } = req.body;
    const srcId = sourceEventId || source_event_id;
    if (!srcId) return res.status(400).json({ error: 'sourceEventId required' });

    // Delegate to seed-mogul-event handler logic
    return await seedFromMogulEventImpl(req, res, srcId, event);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// POST /seed-mogul-event -- v1.6: Mode 1
// Body: { source_event_id }
// ---------------------------------------------------------------------------
router.post('/seed-mogul-event', requireAuth, async (req, res) => {
  try {
    const event = await queryOne('SELECT * FROM events WHERE id=?', [req.params.eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const { source_event_id } = req.body;
    if (!source_event_id) return res.status(400).json({ error: 'source_event_id required' });

    return await seedFromMogulEventImpl(req, res, source_event_id, event);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function seedFromMogulEventImpl(req, res, sourceEventId, event) {
  // Validate source event
  const src = await queryOne('SELECT * FROM events WHERE id=?', [sourceEventId]);
  if (!src) return res.status(404).json({ error: 'Source event not found' });
  if (src.meet_id !== event.meet_id) {
    return res.status(400).json({ error: 'Source event must be in the same meet' });
  }
  if (normalizeGender(src.gender) !== normalizeGender(event.gender)) {
    return res.status(400).json({ error: 'Source event gender does not match' });
  }

  const placings = await computeOfficialPlacings(sourceEventId);
  if (placings.size === 0) {
    return res.status(400).json({ error: 'Source event has no ranked results' });
  }

  const dualRegs = await loadDualRegistrationsWithUsss(req.params.eventId);
  if (dualRegs.length === 0) {
    return res.status(400).json({ error: 'No active registrations in this dual event' });
  }

  // Join: for each dual-event registration, find their rank in the source event.
  // Athletes not present in the source event get null rank and sort to the bottom.
  const withRank = dualRegs.map(r => ({
    ...r,
    src_rank: placings.has(r.athlete_id) ? placings.get(r.athlete_id).rank : null,
  }));

  const ranked = withRank
    .filter(r => r.src_rank != null)
    .sort((a, b) => a.src_rank - b.src_rank);

  // Unranked athletes (no source placing) -- append at end in deterministic random order.
  const storedSeed = await ensureDualRandomSeed(req.params.eventId);
  const rng = mulberry32(hashStringToSeed(storedSeed + ':mogul-event'));
  const unranked = withRank.filter(r => r.src_rank == null);
  for (let i = unranked.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [unranked[i], unranked[j]] = [unranked[j], unranked[i]];
  }

  const ordered = [...ranked, ...unranked];
  const entries = ordered.map((r, i) => ({
    registration_id: r.registration_id,
    seed: i + 1,
    source: 'mogul_event',
    source_value: r.src_rank != null ? `MO rank ${r.src_rank}` : 'unranked',
  }));

  const preview = req.body && req.body.preview === true;
  if (!preview) {
    await persistSeedList(req.params.eventId, entries, 'mogul_event');
    try { await logAudit('dual_seed_list_created', 'event', req.params.eventId, null, { mode: 'mogul_event', source_event_id: sourceEventId, count: entries.length }); } catch (_) {}
  }

  return res.json({ ok: true, count: entries.length, source: 'mogul_event', entries: preview ? entries : undefined });
}

// ---------------------------------------------------------------------------
// POST /seed-usss -- v1.6: Mode 2
// Sort by USSS dm_points DESCENDING (higher is better, opposite of FIS).
// ---------------------------------------------------------------------------
router.post('/seed-usss', requireAuth, async (req, res) => {
  try {
    const event = await queryOne('SELECT * FROM events WHERE id=?', [req.params.eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const dualRegs = await loadDualRegistrationsWithUsss(req.params.eventId);
    if (dualRegs.length === 0) {
      return res.status(400).json({ error: 'No active registrations in this dual event' });
    }

    // NOTE: USSS dm_points uses HIGHER = BETTER, which is the opposite of
    // the FIS points convention.  Athletes with higher dm_points get lower
    // (better) seed numbers.
    const ranked = dualRegs.filter(r => r.dm_points != null)
      .sort((a, b) => b.dm_points - a.dm_points);

    const unranked = dualRegs.filter(r => r.dm_points == null);

    // Deterministic shuffle of unranked tail
    const storedSeed = await ensureDualRandomSeed(req.params.eventId);
    const rng = mulberry32(hashStringToSeed(storedSeed + ':usss'));
    for (let i = unranked.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [unranked[i], unranked[j]] = [unranked[j], unranked[i]];
    }

    const ordered = [...ranked, ...unranked];
    const entries = ordered.map((r, i) => ({
      registration_id: r.registration_id,
      seed: i + 1,
      source: 'usss_points',
      source_value: r.dm_points != null ? `USSS ${i + 1}` : 'unranked',
    }));

    const preview = req.body && req.body.preview === true;
    if (!preview) {
      await persistSeedList(req.params.eventId, entries, 'usss_points');
      try { await logAudit('dual_seed_list_created', 'event', req.params.eventId, null, { mode: 'usss_points', count: entries.length }); } catch (_) {}
    }

    res.json({ ok: true, count: entries.length, ranked: ranked.length, unranked: unranked.length, entries: preview ? entries : undefined });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// POST /seed-event-plus-usss -- v1.6: Mode 3 (the most important new mode)
// Body: { source_event_id }
// Implements "Best of MO rank / USSS rank" with FIS-style tiebreakers.
// ---------------------------------------------------------------------------
router.post('/seed-event-plus-usss', requireAuth, async (req, res) => {
  try {
    const event = await queryOne('SELECT * FROM events WHERE id=?', [req.params.eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const { source_event_id } = req.body;
    if (!source_event_id) return res.status(400).json({ error: 'source_event_id required' });

    const src = await queryOne('SELECT * FROM events WHERE id=?', [source_event_id]);
    if (!src) return res.status(404).json({ error: 'Source event not found' });
    if (src.meet_id !== event.meet_id) {
      return res.status(400).json({ error: 'Source event must be in the same meet' });
    }
    if (normalizeGender(src.gender) !== normalizeGender(event.gender)) {
      return res.status(400).json({ error: 'Source event gender does not match' });
    }

    const dualRegs = await loadDualRegistrationsWithUsss(req.params.eventId);
    if (dualRegs.length === 0) {
      return res.status(400).json({ error: 'No active registrations in this dual event' });
    }

    // Step 1: compute each athlete's MO rank from the source event.
    const placings = await computeOfficialPlacings(source_event_id);

    // Step 2: compute USSS rank restricted to athletes registered in this
    // dual event.  Sort by dm_points DESCENDING; rank 1 = highest points.
    const withUsss = dualRegs.filter(r => r.dm_points != null)
      .sort((a, b) => b.dm_points - a.dm_points);
    const usssRank = new Map();
    withUsss.forEach((r, i) => usssRank.set(r.registration_id, i + 1));

    // Step 3: compute best_of_rank per athlete.
    const annotated = dualRegs.map(r => {
      const moRank = placings.has(r.athlete_id) ? placings.get(r.athlete_id).rank : null;
      const ussRank = usssRank.has(r.registration_id) ? usssRank.get(r.registration_id) : null;
      let bestOf = null;
      if (moRank != null && ussRank != null) bestOf = Math.min(moRank, ussRank);
      else if (moRank != null) bestOf = moRank;
      else if (ussRank != null) bestOf = ussRank;
      return { ...r, mo_rank: moRank, usss_rank: ussRank, best_of_rank: bestOf };
    });

    // Step 4: sort.
    // Primary: best_of_rank ascending (nulls sort last).
    // Tiebreaker 1: lower (better) USSS rank wins.
    // Tiebreaker 2: deterministic random.
    const storedSeed = await ensureDualRandomSeed(req.params.eventId);
    const rng = mulberry32(hashStringToSeed(storedSeed + ':event-plus-usss'));

    // Attach a deterministic random key per registration for stable tiebreaking.
    const withRandomKey = annotated.map(r => ({ ...r, _rand: rng() }));

    withRandomKey.sort((a, b) => {
      // Nulls to the bottom
      const aNull = a.best_of_rank == null;
      const bNull = b.best_of_rank == null;
      if (aNull && !bNull) return 1;
      if (!aNull && bNull) return -1;
      if (aNull && bNull) return a._rand - b._rand;

      // Primary: best_of_rank
      if (a.best_of_rank !== b.best_of_rank) return a.best_of_rank - b.best_of_rank;

      // Tiebreaker 1: lower USSS rank wins (nulls lose)
      const aU = a.usss_rank == null ? Infinity : a.usss_rank;
      const bU = b.usss_rank == null ? Infinity : b.usss_rank;
      if (aU !== bU) return aU - bU;

      // Tiebreaker 2: deterministic random
      return a._rand - b._rand;
    });

    const entries = withRandomKey.map((r, i) => {
      const moStr = r.mo_rank != null ? `MO ${r.mo_rank}` : 'MO -';
      const usStr = r.usss_rank != null ? `USSS ${r.usss_rank}` : 'USSS -';
      const bestStr = r.best_of_rank != null ? `= ${r.best_of_rank}` : '';
      return {
        registration_id: r.registration_id,
        seed: i + 1,
        source: 'prior_event_plus_usss',
        source_value: `Best of ${moStr} / ${usStr} ${bestStr}`.trim(),
      };
    });

    const preview = req.body && req.body.preview === true;
    if (!preview) {
      await persistSeedList(req.params.eventId, entries, 'prior_event_plus_usss');
      try { await logAudit('dual_seed_list_created', 'event', req.params.eventId, null, { mode: 'event_plus_usss', source_event_id, count: entries.length }); } catch (_) {}
    }

    res.json({ ok: true, count: entries.length, source: 'prior_event_plus_usss', entries: preview ? entries : undefined });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// PUT /seeds/:registrationId -- update a competitor seed (accepts decimals)
// v1.6: stamps dual_seed_source = 'manual'
// ---------------------------------------------------------------------------
router.put('/seeds/:registrationId', requireAuth, async (req, res) => {
  try {
    const { seed } = req.body;
    if (seed === undefined || seed === null) return res.status(400).json({ error: 'seed required' });
    const seedVal = parseFloat(seed);
    if (isNaN(seedVal) || seedVal <= 0) return res.status(400).json({ error: 'seed must be a positive number' });

    const reg = await queryOne(
      'SELECT * FROM registrations WHERE id=? AND event_id=?',
      [req.params.registrationId, req.params.eventId]
    );
    if (!reg) return res.status(404).json({ error: 'Registration not found' });

    await execute(
      `UPDATE registrations
          SET dual_seed = ?,
              dual_seed_source = 'manual',
              dual_seed_source_value = ?
        WHERE id = ?`,
      [seedVal, `manual ${seedVal}`, req.params.registrationId]
    );
    res.json({ ok: true, seed: seedVal });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// POST /save-seed-list -- batch persist a seed list from preview
// Body: { entries: [{ registration_id, seed, source, source_value }] }
// ---------------------------------------------------------------------------
router.post('/save-seed-list', requireAuth, async (req, res) => {
  try {
    const { entries } = req.body;
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'entries array required' });
    }
    const overallSource = entries[0].source || 'manual';
    await persistSeedList(req.params.eventId, entries, overallSource);
    try { await logAudit('dual_seed_list_created', 'event', req.params.eventId, null, { mode: overallSource, count: entries.length }); } catch (_) {}
    res.json({ ok: true, count: entries.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// PUT /runoff-option -- update runoff setting
// ---------------------------------------------------------------------------
router.put('/runoff-option', requireAuth, async (req, res) => {
  try {
    const { runoff_option } = req.body;
    const valid = ['runoff_to_8th', 'runoff_to_4th', 'no_runoff'];
    if (!valid.includes(runoff_option)) return res.status(400).json({ error: 'Invalid runoff_option' });
    await execute(`UPDATE events SET runoff_option=? WHERE id=?`, [runoff_option, req.params.eventId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// PUT /:matchId/winner -- record match winner and advance
// v1.26.02 -- public: the dual HJ tablet's Blue/Red DNS/DNF buttons call this
// with a plain fetch (no login token). Tablets must work with protection on.
// ---------------------------------------------------------------------------
router.put('/:matchId/winner', async (req, res) => {
  try {
    const { winner_registration_id, loser_status } = req.body;
    if (!winner_registration_id) return res.status(400).json({ error: 'winner_registration_id required' });

    const match = await queryOne(
      'SELECT * FROM dual_bracket WHERE id=? AND event_id=?',
      [req.params.matchId, req.params.eventId]
    );
    if (!match) return res.status(404).json({ error: 'Match not found' });

    await execute(
      `UPDATE dual_bracket SET winner_registration_id=?, loser_status=?, status='complete', updated_at=datetime('now') WHERE id=?`,
      [winner_registration_id, loser_status || null, req.params.matchId]
    );

    // Broadcast dual winner to overlay (full payload for overlay display)
    try {
      const judgePointsRows = await queryAll(
        `SELECT * FROM dual_judge_points WHERE match_id=? ORDER BY judge_number`,
        [req.params.matchId]
      );
      let blueTotal = null, redTotal = null;
      if (judgePointsRows.length > 0) {
        const judgeScoresForCalc = judgePointsRows.map(r => ({
          judgeNumber: r.judge_number,
          bluePoints:  r.blue_points,
          redPoints:   r.red_points,
          timeTied:    !!r.time_tied,
        }));
        const split = calcDualMogulPointSplit(judgeScoresForCalc);
        blueTotal = split.blueTotal;
        redTotal  = split.redTotal;
      }

      const [winReg, blueReg, redReg] = await Promise.all([
        queryOne(`SELECT r.bib_number, a.first_name, a.last_name, a.club FROM registrations r JOIN athletes a ON a.id=r.athlete_id WHERE r.id=?`, [winner_registration_id]),
        match.registration_id_blue ? queryOne(`SELECT r.bib_number, a.first_name, a.last_name, a.club FROM registrations r JOIN athletes a ON a.id=r.athlete_id WHERE r.id=?`, [match.registration_id_blue]) : null,
        match.registration_id_red  ? queryOne(`SELECT r.bib_number, a.first_name, a.last_name, a.club FROM registrations r JOIN athletes a ON a.id=r.athlete_id WHERE r.id=?`, [match.registration_id_red])  : null,
      ]);

      if (req.app.broadcast) {
        const blueIsLoser = winner_registration_id !== match.registration_id_blue;
        const redIsLoser  = winner_registration_id !== match.registration_id_red;
        req.app.broadcast(req.params.eventId, 'score_update', {
          isDual: true,
          matchId: req.params.matchId,
          winner: winReg ? {
            name: `${winReg.first_name} ${winReg.last_name}`,
            bib:  winReg.bib_number,
            club: winReg.club,
            registrationId: winner_registration_id,
          } : null,
          winnerSide: winner_registration_id === match.registration_id_blue ? 'blue' : 'red',
          blueTotal,
          redTotal,
          bracketRound: match.bracket_round,
          isSmallFinal: !!match.is_small_final,
          blue: blueReg ? {
            name: `${blueReg.first_name} ${blueReg.last_name}`,
            bib:  blueReg.bib_number,
            club: blueReg.club,
            registrationId: match.registration_id_blue,
            status: blueIsLoser ? (loser_status || null) : null,
          } : null,
          red: redReg ? {
            name: `${redReg.first_name} ${redReg.last_name}`,
            bib:  redReg.bib_number,
            club: redReg.club,
            registrationId: match.registration_id_red,
            status: redIsLoser ? (loser_status || null) : null,
          } : null,
        });
        req.app.broadcast(req.params.eventId, 'run_updated', { matchId: req.params.matchId, dualComplete: true });
      }
    } catch (_) {}

    const loserId = winner_registration_id === match.registration_id_blue
      ? match.registration_id_red
      : match.registration_id_blue;

    await advanceWinner(req.params.eventId, match, winner_registration_id, loserId);

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// DELETE /reset -- clear bracket and dual seeds
// ---------------------------------------------------------------------------
router.delete('/reset', requireAuth, async (req, res) => {
  try {
    await execute(`DELETE FROM dual_bracket WHERE event_id=?`, [req.params.eventId]);
    await execute(`UPDATE registrations SET dual_seed=NULL WHERE event_id=?`, [req.params.eventId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// Active match management (for judge tablet polling)
// ---------------------------------------------------------------------------

// GET /active-match -- get the currently active dual match for this event
router.get('/active-match', async (req, res) => {
  try {
    const event = await queryOne('SELECT active_dual_match_id, dual_manual_entry FROM events WHERE id=?', [req.params.eventId]);
    if (!event || !event.active_dual_match_id) return res.json(null);

    const match = await queryOne(
      `SELECT db.*,
        ab.first_name as blue_first, ab.last_name as blue_last, ab.club as blue_club, rb.bib_number as blue_bib,
        ar.first_name as red_first,  ar.last_name as red_last,  ar.club as red_club,  rr.bib_number as red_bib,
        rb.dual_seed as blue_dual_seed, rr.dual_seed as red_dual_seed
       FROM dual_bracket db
       LEFT JOIN registrations rb ON rb.id = db.registration_id_blue
       LEFT JOIN athletes ab      ON ab.id = rb.athlete_id
       LEFT JOIN registrations rr ON rr.id = db.registration_id_red
       LEFT JOIN athletes ar      ON ar.id = rr.athlete_id
       WHERE db.id = ? AND db.event_id = ?`,
      [event.active_dual_match_id, req.params.eventId]
    );
    if (!match) return res.json(null);

    // Also return existing judge points for this match
    const rows = await queryAll(
      `SELECT * FROM dual_judge_points WHERE match_id=? ORDER BY judge_number`,
      [match.id]
    );
    const judgeScores = rows.map(r => ({
      judgeNumber: r.judge_number,
      bluePoints:  r.blue_points,
      redPoints:   r.red_points,
      timeTied:    !!r.time_tied,
    }));
    const result = calcDualMogulPointSplit(judgeScores);

    // Attach pairing label
    const { pairingNums, genderPrefix } = await computePairingNumbers(req.params.eventId);
    const pNum = pairingNums.get(match.id);
    const pairing_label = pNum != null ? formatPairingLabel(genderPrefix, pNum) : null;

    res.json({ ...match, judgePoints: rows, judgeScores, pointResult: result, pairing_label, manual_entry: event.dual_manual_entry ? 1 : 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /active-match -- set the active dual match
// v1.26.02 -- public: the dual HJ tablet's Start Run button calls this.
router.put('/active-match', async (req, res) => {
  try {
    const { match_id } = req.body;
    if (!match_id) return res.status(400).json({ error: 'match_id required' });

    const match = await queryOne(
      'SELECT * FROM dual_bracket WHERE id=? AND event_id=?',
      [match_id, req.params.eventId]
    );
    if (!match) return res.status(404).json({ error: 'Match not found' });

    await execute('UPDATE events SET active_dual_match_id=? WHERE id=?', [match_id, req.params.eventId]);

    // v1.16.17 -- starting a new match invalidates a stale bracket-complete review state
    await clearDualBracketReviewStatus(req.params.eventId, req.app);

    // v1.4 Feature 3: Auto-activate event on first dual match
    try {
      const ev = await queryOne('SELECT status FROM events WHERE id=?', [req.params.eventId]);
      if (ev && ev.status === 'setup') {
        await execute(`UPDATE events SET status='active', updated_at=datetime('now') WHERE id=?`, [req.params.eventId]);
        try { await logAudit('event_auto_activated', 'event', req.params.eventId, null, { triggering_match_id: match_id }); } catch (_) {}
        if (req.app.broadcast) {
          req.app.broadcast(req.params.eventId, 'event_status_changed', { eventId: req.params.eventId, status: 'active' });
        }
      }
    } catch (_) {}

    // Broadcast active match change
    if (req.app.broadcast) {
      req.app.broadcast(req.params.eventId, 'dual_match_started', { matchId: match_id });
    }

    res.json({ ok: true, match_id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /active-match -- clear the active dual match
// v1.26.02 -- public: the dual HJ tablet calls this after a DNS/DNF ruling.
router.delete('/active-match', async (req, res) => {
  try {
    await execute('UPDATE events SET active_dual_match_id=NULL, dual_manual_entry=0 WHERE id=?', [req.params.eventId]);
    if (req.app.broadcast) {
      req.app.broadcast(req.params.eventId, 'dual_match_cleared', {});
      req.app.broadcast(req.params.eventId, 'dual_manual_entry_cleared', {});
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// v1.16.30 -- manual score entry override for active dual match
// POST /manual-entry-start -- lock judges' tablets and return existing partial scores
router.post('/manual-entry-start', requireAuth, async (req, res) => {
  try {
    const event = await queryOne(
      'SELECT active_dual_match_id FROM events WHERE id=?',
      [req.params.eventId]
    );
    if (!event || !event.active_dual_match_id) {
      return res.status(400).json({ error: 'No active match' });
    }
    await execute('UPDATE events SET dual_manual_entry=1 WHERE id=?', [req.params.eventId]);

    const rows = await queryAll(
      `SELECT * FROM dual_judge_points WHERE match_id=? ORDER BY judge_number`,
      [event.active_dual_match_id]
    );
    const judgeScores = rows.map(r => ({
      judgeNumber: r.judge_number,
      bluePoints:  r.blue_points,
      redPoints:   r.red_points,
      timeTied:    !!r.time_tied,
    }));

    if (req.app.broadcast) {
      req.app.broadcast(req.params.eventId, 'dual_manual_entry_started', { matchId: event.active_dual_match_id });
    }
    res.json({ ok: true, matchId: event.active_dual_match_id, judgeScores });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /manual-entry-cancel -- release the lock without submitting scores
router.post('/manual-entry-cancel', requireAuth, async (req, res) => {
  try {
    await execute('UPDATE events SET dual_manual_entry=0 WHERE id=?', [req.params.eventId]);
    if (req.app.broadcast) {
      req.app.broadcast(req.params.eventId, 'dual_manual_entry_cleared', {});
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// Dual Moguls numbered-judge 5-point split scoring
//
// Temporary domestic model.  Each judge distributes exactly 5 whole points
// across the two competitors (e.g. 3/2, 4/1, 5/0).  The winner is determined
// by the sum of all judges' points for each competitor.
//
// What is NOT implemented here:
//   - Automatic judging caps
//   - Structured TL turn-deduction rule encoding
//   - Official FIS Classic or Direct Comparison dual scoring logic
//   - Explicit air, turns, speed, or overall judge roles
// ---------------------------------------------------------------------------

const { validateDualPointSplit } = require('../scoring/engine');

// GET /:matchId/judge-points -- retrieve all judge point entries for a match
router.get('/:matchId/judge-points', async (req, res) => {
  try {
    const match = await queryOne(
      'SELECT * FROM dual_bracket WHERE id=? AND event_id=?',
      [req.params.matchId, req.params.eventId]
    );
    if (!match) return res.status(404).json({ error: 'Match not found' });

    const rows = await queryAll(
      `SELECT * FROM dual_judge_points WHERE match_id=? ORDER BY judge_number`,
      [req.params.matchId]
    );

    // Compute running totals using the scoring engine
    const judgeScores = rows.map(r => ({
      judgeNumber: r.judge_number,
      bluePoints:  r.blue_points,
      redPoints:   r.red_points,
      timeTied:    !!r.time_tied,
    }));
    const result = calcDualMogulPointSplit(judgeScores);

    res.json({ rows, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /:matchId/judge-points -- submit or update a judge's point split
//
// Body: { judge_number: <int>, blue_points: <int>, red_points: <int> }
// Constraints:
//   - judge_number must be a positive integer
//   - blue_points and red_points must be non-negative integers summing to exactly 5
//   - A second submission from the same judge_number overwrites the first (upsert)
router.post('/:matchId/judge-points', async (req, res) => {
  try {
    const match = await queryOne(
      'SELECT * FROM dual_bracket WHERE id=? AND event_id=?',
      [req.params.matchId, req.params.eventId]
    );
    if (!match) return res.status(404).json({ error: 'Match not found' });

    const { judge_number, blue_points, red_points, time_tied } = req.body;

    // Validate judge_number
    if (judge_number === undefined || judge_number === null) {
      return res.status(400).json({ error: 'judge_number is required' });
    }
    const judgeNum = parseInt(judge_number, 10);
    if (!Number.isInteger(judgeNum) || judgeNum < 1) {
      return res.status(400).json({ error: 'judge_number must be a positive integer' });
    }

    const bPts = parseInt(blue_points, 10);
    const rPts = parseInt(red_points, 10);
    const isTimeTied = !!time_tied;

    // Only J4 (Time Judge) may submit time_tied
    if (isTimeTied && judgeNum !== 4) {
      return res.status(400).json({ error: 'Only the Time Judge (judge 4) can submit a time tied entry' });
    }

    // Check if J4 already declared time tied (affects J5 validation)
    const existingJ4 = await queryOne(
      'SELECT time_tied FROM dual_judge_points WHERE match_id=? AND judge_number=4',
      [req.params.matchId]
    );
    const matchHasTimeTied = isTimeTied || (existingJ4 && existingJ4.time_tied === 1 && judgeNum !== 4);

    // Validate point split
    const splitError = validateDualPointSplit(bPts, rPts, {
      timeTied: isTimeTied,
      isOverallWithTimeTied: judgeNum === 5 && matchHasTimeTied,
    });
    if (splitError) {
      return res.status(400).json({ error: splitError });
    }

    // Upsert: one row per (match_id, judge_number)
    const existing = await queryOne(
      'SELECT id, time_tied FROM dual_judge_points WHERE match_id=? AND judge_number=?',
      [req.params.matchId, judgeNum]
    );
    if (existing) {
      await execute(
        `UPDATE dual_judge_points
           SET blue_points=?, red_points=?, time_tied=?, updated_at=datetime('now')
         WHERE id=?`,
        [bPts, rPts, isTimeTied ? 1 : 0, existing.id]
      );
    } else {
      await execute(
        `INSERT INTO dual_judge_points (id, match_id, judge_number, blue_points, red_points, time_tied)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [uuidv4(), req.params.matchId, judgeNum, bPts, rPts, isTimeTied ? 1 : 0]
      );
    }

    // When J4 changes time_tied state, clear J5's score (they must rescore)
    if (judgeNum === 4) {
      const wasTimeTied = !!(existing && existing.time_tied === 1);
      if (isTimeTied !== wasTimeTied) {
        await execute('DELETE FROM dual_judge_points WHERE match_id=? AND judge_number=5', [req.params.matchId]);
      }
    }

    // Return updated totals
    const rows = await queryAll(
      `SELECT * FROM dual_judge_points WHERE match_id=? ORDER BY judge_number`,
      [req.params.matchId]
    );
    const judgeScores = rows.map(r => ({
      judgeNumber: r.judge_number,
      bluePoints:  r.blue_points,
      redPoints:   r.red_points,
      timeTied:    !!r.time_tied,
    }));
    const result = calcDualMogulPointSplit(judgeScores);

    // If the totals determine a winner, mark the match as awaiting head judge
    // approval rather than auto-finalizing.  The HJ must explicitly approve via
    // POST /:matchId/approve before the bracket advances.
    // Re-read match status to get the latest (may have been reset by a reject).
    const freshMatch = await queryOne(
      'SELECT status, winner_registration_id FROM dual_bracket WHERE id=?',
      [req.params.matchId]
    );
    const curStatus = freshMatch ? freshMatch.status : match.status;

    if (result.winner && curStatus !== 'complete' && result.judgeCount >= 5) {
      const winnerId = result.winner === 'blue'
        ? match.registration_id_blue
        : match.registration_id_red;

      if (winnerId) {
        await execute(
          `UPDATE dual_bracket SET winner_registration_id=?, status='hj_pending', updated_at=datetime('now') WHERE id=?`,
          [winnerId, req.params.matchId]
        );
      }
    } else if (!result.winner && curStatus === 'hj_pending') {
      // Winner no longer determined (e.g. after a reject removed a decisive judge).
      // Revert back to pending.
      await execute(
        `UPDATE dual_bracket SET winner_registration_id=NULL, status='pending', updated_at=datetime('now') WHERE id=?`,
        [req.params.matchId]
      );
    }

    // Broadcast the updated point totals so overlays can react
    if (req.app.broadcast) {
      req.app.broadcast(req.params.eventId, 'dual_points_update', {
        matchId:    req.params.matchId,
        blueTotal:  result.blueTotal,
        redTotal:   result.redTotal,
        winner:     result.winner,
        judgeCount: result.judgeCount,
        timeTied:   result.timeTied,
      });
    }

    res.json({ ok: true, rows, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /:matchId/judge-points -- clear all judge point entries for a match
// (Useful for resetting a match before re-judging.)
// v1.26.02 -- public: the dual HJ tablet's reject/re-enter flow calls this.
router.delete('/:matchId/judge-points', async (req, res) => {
  try {
    const match = await queryOne(
      'SELECT * FROM dual_bracket WHERE id=? AND event_id=?',
      [req.params.matchId, req.params.eventId]
    );
    if (!match) return res.status(404).json({ error: 'Match not found' });

    // Also reset the match status back to pending if it was hj_pending
    if (match.status === 'hj_pending') {
      await execute(
        `UPDATE dual_bracket SET status='pending', winner_registration_id=NULL, updated_at=datetime('now') WHERE id=?`,
        [req.params.matchId]
      );
    }

    await execute(
      'DELETE FROM dual_judge_points WHERE match_id=?',
      [req.params.matchId]
    );

    // v1.16.17 -- clearing scores invalidates a stale bracket-complete review state
    await clearDualBracketReviewStatus(req.params.eventId, req.app);

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// POST /:matchId/approve -- head judge approves the match result
//
// Transitions the match from 'hj_pending' to 'complete', broadcasts the winner,
// and advances the bracket.  This mirrors the advancement logic in PUT /:matchId/winner.
// ---------------------------------------------------------------------------
router.post('/:matchId/approve', async (req, res) => {
  try {
    const match = await queryOne(
      'SELECT * FROM dual_bracket WHERE id=? AND event_id=?',
      [req.params.matchId, req.params.eventId]
    );
    if (!match) return res.status(404).json({ error: 'Match not found' });

    if (match.status !== 'hj_pending') {
      return res.status(400).json({ error: `Match is not awaiting approval (status: ${match.status})` });
    }

    const winnerId = match.winner_registration_id;
    if (!winnerId) {
      return res.status(400).json({ error: 'No winner determined yet' });
    }

    const loserId = winnerId === match.registration_id_blue
      ? match.registration_id_red
      : match.registration_id_blue;

    // Mark the match as complete
    await execute(
      `UPDATE dual_bracket SET status='complete', updated_at=datetime('now') WHERE id=?`,
      [req.params.matchId]
    );

    // Broadcast dual winner to overlay (v1.4 F7 + F8d extended payload)
    try {
      const judgePointsRows = await queryAll(
        `SELECT * FROM dual_judge_points WHERE match_id=? ORDER BY judge_number`,
        [req.params.matchId]
      );
      const judgeScoresForCalc = judgePointsRows.map(r => ({
        judgeNumber: r.judge_number,
        bluePoints:  r.blue_points,
        redPoints:   r.red_points,
        timeTied:    !!r.time_tied,
      }));
      const split = calcDualMogulPointSplit(judgeScoresForCalc);

      const [winReg, blueReg, redReg] = await Promise.all([
        queryOne(`SELECT r.bib_number, a.first_name, a.last_name, a.club FROM registrations r JOIN athletes a ON a.id=r.athlete_id WHERE r.id=?`, [winnerId]),
        match.registration_id_blue ? queryOne(`SELECT r.bib_number, a.first_name, a.last_name, a.club FROM registrations r JOIN athletes a ON a.id=r.athlete_id WHERE r.id=?`, [match.registration_id_blue]) : null,
        match.registration_id_red  ? queryOne(`SELECT r.bib_number, a.first_name, a.last_name, a.club FROM registrations r JOIN athletes a ON a.id=r.athlete_id WHERE r.id=?`, [match.registration_id_red])  : null,
      ]);

      if (req.app.broadcast) {
        req.app.broadcast(req.params.eventId, 'score_update', {
          isDual: true,
          matchId: req.params.matchId,
          winner: winReg ? {
            name: `${winReg.first_name} ${winReg.last_name}`,
            bib:  winReg.bib_number,
            club: winReg.club,
            registrationId: winnerId,
          } : null,
          winnerSide: winnerId === match.registration_id_blue ? 'blue' : 'red',
          blueTotal: split.blueTotal,
          redTotal:  split.redTotal,
          bracketRound: match.bracket_round,
          isSmallFinal: !!match.is_small_final,
          blue: blueReg ? {
            name: `${blueReg.first_name} ${blueReg.last_name}`,
            bib:  blueReg.bib_number,
            club: blueReg.club,
            registrationId: match.registration_id_blue,
          } : null,
          red: redReg ? {
            name: `${redReg.first_name} ${redReg.last_name}`,
            bib:  redReg.bib_number,
            club: redReg.club,
            registrationId: match.registration_id_red,
          } : null,
        });
        // v1.4 F7: Trigger Results tab refresh on dual completion.
        req.app.broadcast(req.params.eventId, 'run_updated', { matchId: req.params.matchId, dualComplete: true });
      }
    } catch (_) {}

    await advanceWinner(req.params.eventId, match, winnerId, loserId);

    // Clear the active match so the event is ready for the next one
    await execute('UPDATE events SET active_dual_match_id=NULL WHERE id=?', [req.params.eventId]);
    if (req.app.broadcast) {
      req.app.broadcast(req.params.eventId, 'dual_match_cleared', {});
    }

    // v1.16.17 -- detect bracket completion and trigger HJ final review
    await maybeMarkBracketReviewPending(req.params.eventId, req.app);

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// POST /:matchId/paper-score -- paper entry: submit all judge scores at once
// or set DNS/DNF/DSQ.  Auto-finalizes match and advances bracket.
// ---------------------------------------------------------------------------
router.post('/:matchId/paper-score', requireAuth, async (req, res) => {
  try {
    const match = await queryOne(
      'SELECT * FROM dual_bracket WHERE id=? AND event_id=?',
      [req.params.matchId, req.params.eventId]
    );
    if (!match) return res.status(404).json({ error: 'Match not found' });

    const { winner_registration_id, loser_status, judges, time_tied } = req.body;

    // --- Path A: DNS/DNF/DSQ ---
    if (winner_registration_id && loser_status) {
      const loserId = winner_registration_id === match.registration_id_blue
        ? match.registration_id_red
        : match.registration_id_blue;

      await execute(
        `UPDATE dual_bracket SET winner_registration_id=?, loser_status=?, status='complete', updated_at=datetime('now') WHERE id=?`,
        [winner_registration_id, loser_status, req.params.matchId]
      );

      // Delete any existing judge points for this match
      await execute('DELETE FROM dual_judge_points WHERE match_id=?', [req.params.matchId]);

      await advanceWinner(req.params.eventId, match, winner_registration_id, loserId);

      // Broadcast
      try {
        const [winReg, blueReg, redReg] = await Promise.all([
          queryOne(`SELECT r.bib_number, a.first_name, a.last_name, a.club FROM registrations r JOIN athletes a ON a.id=r.athlete_id WHERE r.id=?`, [winner_registration_id]),
          match.registration_id_blue ? queryOne(`SELECT r.bib_number, a.first_name, a.last_name, a.club FROM registrations r JOIN athletes a ON a.id=r.athlete_id WHERE r.id=?`, [match.registration_id_blue]) : null,
          match.registration_id_red  ? queryOne(`SELECT r.bib_number, a.first_name, a.last_name, a.club FROM registrations r JOIN athletes a ON a.id=r.athlete_id WHERE r.id=?`, [match.registration_id_red])  : null,
        ]);
        const blueIsLoser = winner_registration_id !== match.registration_id_blue;
        const redIsLoser  = winner_registration_id !== match.registration_id_red;
        const winnerSide  = winner_registration_id === match.registration_id_blue ? 'blue' : 'red';
        if (winReg && req.app.broadcast) {
          req.app.broadcast(req.params.eventId, 'score_update', {
            isDual: true,
            matchId: req.params.matchId,
            winner: { name: `${winReg.first_name} ${winReg.last_name}`, bib: winReg.bib_number, club: winReg.club, registrationId: winner_registration_id },
            winnerSide,
            blueTotal: null,
            redTotal: null,
            bracketRound: match.bracket_round,
            isSmallFinal: !!match.is_small_final,
            blue: blueReg ? {
              name: `${blueReg.first_name} ${blueReg.last_name}`,
              bib:  blueReg.bib_number,
              club: blueReg.club,
              registrationId: match.registration_id_blue,
              status: blueIsLoser ? loser_status : null,
            } : null,
            red: redReg ? {
              name: `${redReg.first_name} ${redReg.last_name}`,
              bib:  redReg.bib_number,
              club: redReg.club,
              registrationId: match.registration_id_red,
              status: redIsLoser ? loser_status : null,
            } : null,
          });
          req.app.broadcast(req.params.eventId, 'run_updated', { matchId: req.params.matchId, dualComplete: true });
        }
      } catch (_) {}

      // v1.16.17 -- detect bracket completion and trigger HJ final review
      await maybeMarkBracketReviewPending(req.params.eventId, req.app);

      // v1.16.30 -- clear manual-entry lock if it was set for this match
      try {
        await execute('UPDATE events SET dual_manual_entry=0 WHERE id=? AND dual_manual_entry=1', [req.params.eventId]);
        if (req.app.broadcast) {
          req.app.broadcast(req.params.eventId, 'dual_manual_entry_cleared', {});
        }
      } catch (_) {}

      return res.json({ ok: true });
    }

    // --- Path B: Scored match ---
    if (!judges || !Array.isArray(judges) || judges.length !== 5) {
      return res.status(400).json({ error: 'Must provide exactly 5 judge entries' });
    }
    if (!match.registration_id_blue || !match.registration_id_red) {
      return res.status(400).json({ error: 'Match must have both blue and red athletes' });
    }

    const isTimeTied = !!time_tied;

    // Validate all judge splits
    for (const j of judges) {
      const jNum = parseInt(j.judge_number, 10);
      const bPts = parseInt(j.blue_points, 10);
      const rPts = parseInt(j.red_points, 10);
      const splitError = validateDualPointSplit(bPts, rPts, {
        timeTied: isTimeTied && jNum === 4,
        isOverallWithTimeTied: isTimeTied && jNum === 5,
      });
      if (splitError) {
        return res.status(400).json({ error: `Judge ${jNum}: ${splitError}` });
      }
    }

    // Delete existing judge points (clean slate, supports edit)
    await execute('DELETE FROM dual_judge_points WHERE match_id=?', [req.params.matchId]);

    // Insert all 5 judge point rows
    for (const j of judges) {
      const jNum = parseInt(j.judge_number, 10);
      await execute(
        `INSERT INTO dual_judge_points (id, match_id, judge_number, blue_points, red_points, time_tied)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [uuidv4(), req.params.matchId, jNum, parseInt(j.blue_points, 10), parseInt(j.red_points, 10),
         (isTimeTied && jNum === 4) ? 1 : 0]
      );
    }

    // Calculate totals
    const judgeScores = judges.map(j => ({
      judgeNumber: parseInt(j.judge_number, 10),
      bluePoints:  parseInt(j.blue_points, 10),
      redPoints:   parseInt(j.red_points, 10),
      timeTied:    isTimeTied && parseInt(j.judge_number, 10) === 4,
    }));
    const result = calcDualMogulPointSplit(judgeScores);

    if (!result.winner) {
      return res.status(400).json({ error: 'Scores are tied. TD must decide the winner.' });
    }

    const winnerId = result.winner === 'blue'
      ? match.registration_id_blue
      : match.registration_id_red;
    const loserId = result.winner === 'blue'
      ? match.registration_id_red
      : match.registration_id_blue;

    // Mark match complete with winner
    await execute(
      `UPDATE dual_bracket SET winner_registration_id=?, status='complete', updated_at=datetime('now') WHERE id=?`,
      [winnerId, req.params.matchId]
    );

    await advanceWinner(req.params.eventId, match, winnerId, loserId);

    // Clear active match if this was it
    const ev = await queryOne('SELECT active_dual_match_id FROM events WHERE id=?', [req.params.eventId]);
    if (ev && ev.active_dual_match_id === req.params.matchId) {
      await execute('UPDATE events SET active_dual_match_id=NULL WHERE id=?', [req.params.eventId]);
    }

    // Broadcast
    try {
      const [winReg, blueReg, redReg] = await Promise.all([
        queryOne(`SELECT r.bib_number, a.first_name, a.last_name, a.club FROM registrations r JOIN athletes a ON a.id=r.athlete_id WHERE r.id=?`, [winnerId]),
        queryOne(`SELECT r.bib_number, a.first_name, a.last_name, a.club FROM registrations r JOIN athletes a ON a.id=r.athlete_id WHERE r.id=?`, [match.registration_id_blue]),
        queryOne(`SELECT r.bib_number, a.first_name, a.last_name, a.club FROM registrations r JOIN athletes a ON a.id=r.athlete_id WHERE r.id=?`, [match.registration_id_red]),
      ]);
      if (req.app.broadcast) {
        req.app.broadcast(req.params.eventId, 'score_update', {
          isDual: true,
          matchId: req.params.matchId,
          winner: winReg ? { name: `${winReg.first_name} ${winReg.last_name}`, bib: winReg.bib_number, club: winReg.club, registrationId: winnerId } : null,
          winnerSide: winnerId === match.registration_id_blue ? 'blue' : 'red',
          blueTotal: result.blueTotal,
          redTotal: result.redTotal,
          bracketRound: match.bracket_round,
          isSmallFinal: !!match.is_small_final,
          blue: blueReg ? { name: `${blueReg.first_name} ${blueReg.last_name}`, bib: blueReg.bib_number, club: blueReg.club, registrationId: match.registration_id_blue } : null,
          red: redReg ? { name: `${redReg.first_name} ${redReg.last_name}`, bib: redReg.bib_number, club: redReg.club, registrationId: match.registration_id_red } : null,
        });
        req.app.broadcast(req.params.eventId, 'run_updated', { matchId: req.params.matchId, dualComplete: true });
      }
    } catch (_) {}

    // v1.16.17 -- detect bracket completion and trigger HJ final review
    await maybeMarkBracketReviewPending(req.params.eventId, req.app);

    // v1.16.30 -- clear manual-entry lock if it was set for this match
    try {
      await execute('UPDATE events SET dual_manual_entry=0 WHERE id=? AND dual_manual_entry=1', [req.params.eventId]);
      if (req.app.broadcast) {
        req.app.broadcast(req.params.eventId, 'dual_manual_entry_cleared', {});
      }
    } catch (_) {}

    res.json({ ok: true, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// v1.16.17 -- bracket complete -> HJ final review endpoints
// ---------------------------------------------------------------------------
router.get('/review-state', async (req, res) => {
  try {
    const ev = await queryOne(
      'SELECT dual_bracket_review_status, status FROM events WHERE id=?',
      [req.params.eventId]
    );
    if (!ev) return res.status(404).json({ error: 'Event not found' });
    const bracketComplete = await isBracketFullyComplete(req.params.eventId);
    res.json({
      status: ev.dual_bracket_review_status || null,
      bracketComplete,
      eventCompleted: ev.status === 'complete',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// v1.26.02 -- public: the dual HJ tablet's bracket-review Send Back button calls this.
router.post('/send-back-to-scoring', async (req, res) => {
  try {
    const ev = await queryOne(
      'SELECT dual_bracket_review_status FROM events WHERE id=?',
      [req.params.eventId]
    );
    if (!ev) return res.status(404).json({ error: 'Event not found' });
    if (ev.dual_bracket_review_status !== 'pending') {
      return res.status(400).json({ error: `Cannot send back -- review status is ${ev.dual_bracket_review_status || 'null'}` });
    }
    await execute(
      `UPDATE events SET dual_bracket_review_status='sent_back', updated_at=datetime('now') WHERE id=?`,
      [req.params.eventId]
    );
    try { await logAudit('dual_bracket_sent_back', 'event', req.params.eventId, null, {}); } catch (_) {}
    if (req.app.broadcast) {
      req.app.broadcast(req.params.eventId, 'dual_bracket_sent_back', {});
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/resend-to-hj', requireAuth, async (req, res) => {
  try {
    const ev = await queryOne(
      'SELECT dual_bracket_review_status FROM events WHERE id=?',
      [req.params.eventId]
    );
    if (!ev) return res.status(404).json({ error: 'Event not found' });
    if (ev.dual_bracket_review_status !== 'sent_back') {
      return res.status(400).json({ error: `Cannot resend -- review status is ${ev.dual_bracket_review_status || 'null'}` });
    }
    if (!(await isBracketFullyComplete(req.params.eventId))) {
      return res.status(400).json({ error: 'Bracket is no longer complete -- cannot resend' });
    }
    await execute(
      `UPDATE events SET dual_bracket_review_status='pending', updated_at=datetime('now') WHERE id=?`,
      [req.params.eventId]
    );
    try { await logAudit('dual_bracket_resent_to_hj', 'event', req.params.eventId, null, {}); } catch (_) {}
    if (req.app.broadcast) {
      req.app.broadcast(req.params.eventId, 'dual_bracket_review', { status: 'pending' });
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
// Exported for tests / tooling (bracket structure verification).
module.exports.buildBracketShell = buildBracketShell;
module.exports.advanceWinner = advanceWinner;
module.exports.computePairingNumbers = computePairingNumbers;
