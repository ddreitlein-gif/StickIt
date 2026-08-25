/**
 * server/utils/inflight.js — in-flight mutation tracking (v2, M-2).
 *
 * The adoption lock-drain-snapshot sequence used a fixed 300 ms sleep to let
 * requests already past the lock finish their writes. A tablet score submit
 * that triggers tryFinalize is a long statement sequence, and against remote
 * Turso 300 ms is not generous — a write landing mid-snapshot tears the
 * package and is silently discarded at check-in (it feeds H-3's scope
 * divergence). This module counts mutating HTTP requests actually in flight
 * so the drain can wait for a real zero instead of a guess.
 */

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

let inFlight = 0;

/** Express middleware — mount once, before the routers. */
function trackMutations() {
  return (req, res, next) => {
    if (!MUTATION_METHODS.has(req.method)) return next();
    inFlight++;
    let done = false;
    const dec = () => { if (!done) { done = true; inFlight--; } };
    res.on('finish', dec);
    res.on('close', dec);
    next();
  };
}

function mutationCount() {
  return inFlight;
}

/**
 * Wait until no mutating request is in flight (the caller's own request is
 * excluded by `floor` = 1, since it is itself a mutation). Times out rather
 * than hanging: a stuck request should not block adoption forever — after the
 * timeout the caller proceeds, which is no worse than the old fixed sleep.
 */
async function waitForMutationIdle({ floor = 1, timeoutMs, settleMs = 50 } = {}) {
  const remote = !(process.env.LIBSQL_URL || 'file:').startsWith('file:');
  const deadline = Date.now() + (timeoutMs ?? (remote ? 10000 : 3000));
  // Minimum settle window (matches the old drain's purpose: statements between
  // awaits inside a handler are invisible to the HTTP counter for a moment).
  await new Promise(r => setTimeout(r, remote ? 300 : 100));
  while (inFlight > floor && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, settleMs));
  }
}

module.exports = { trackMutations, mutationCount, waitForMutationIdle };
