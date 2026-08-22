/**
 * server/venue/freeze.js — venue-side read-only enforcement (v2 Step 5, FR-10).
 *
 * From the instant check-in starts, the venue refuses every meet-data mutation
 * server-side (not just in the UI), so a tablet write during check-in is
 * cleanly refused rather than stranded — and after check-in/handback the meet
 * is archival read-only so a volunteer cannot keep scoring into a dead end.
 * Mounted (venue mode only) on the same meet-scoped prefixes as the cloud's
 * adoption lock. /api/venue/* is not under these prefixes, so the check-in
 * flow itself and the home screen keep working.
 */

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function venueFreezeGuard() {
  return async (req, res, next) => {
    try {
      if (!MUTATION_METHODS.has(req.method)) return next();
      const { getVenueState } = require('./state');
      const state = await getVenueState();
      if (!state || state.meet_state === 'adopted') return next();
      const done = state.meet_state !== 'checking_in';
      return res.status(423).json({
        error: 'venue_frozen',
        meet_state: state.meet_state,
        message: done
          ? 'This meet has been checked in — scoring is closed on this server.'
          : 'The meet is checking in to the cloud — please stop scoring. This takes under a minute.',
      });
    } catch (e) {
      return next(e);
    }
  };
}

module.exports = { venueFreezeGuard };
