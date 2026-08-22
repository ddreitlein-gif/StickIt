/**
 * server/middleware/adoptionLock.js — requireNotAdopted (v2 Step 1, FR-20).
 *
 * ONE shared middleware guarding every cloud-side mutation of an adopted meet,
 * including public tablet endpoints. Mounted on path prefixes in
 * server/index.js BEFORE the routers, so the lock check always runs before any
 * route handler or validation:
 *
 *   app.use('/api/meets/:meetId',    requireNotAdopted(byMeetParam('meetId')))
 *   app.use('/api/events/:eventId',  requireNotAdopted(byEvent('eventId')))
 *   ...
 *
 * Reads (GET/HEAD/OPTIONS) always pass — the cloud mirror stays live and
 * viewable. Mutations get HTTP 423 (Locked). Sync-apply endpoints live under
 * /api/sync and are never guarded (they carry the venue's changes).
 *
 * In venue mode this middleware is inert (the venue server IS the authority
 * for its adopted meet; its own meets row carries no cloud lock state).
 */

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const LOCKED_MESSAGE =
  'This meet has been adopted by a venue server and is read-only on the cloud until it is handed back or checked in.';

/**
 * resolver(req) -> meetId | null (async ok). null/undefined = not meet-scoped,
 * pass through.
 */
function requireNotAdopted(resolver) {
  const { isMeetAdopted } = require('../sync/adoption');
  return async (req, res, next) => {
    try {
      if (!MUTATION_METHODS.has(req.method)) return next();
      const meetId = await resolver(req);
      if (!meetId) return next();
      if (await isMeetAdopted(meetId)) {
        return res.status(423).json({ error: 'meet_adopted', message: LOCKED_MESSAGE, meet_id: meetId });
      }
      return next();
    } catch (e) {
      return next(e);
    }
  };
}

// Common resolvers -----------------------------------------------------------

function byMeetParam(param) {
  return (req) => req.params[param] || null;
}

function byEventParam(param) {
  const { meetIdForEvent } = require('../sync/adoption');
  return (req) => meetIdForEvent(req.params[param]);
}

function byTrainingDayParam(param) {
  const { meetIdForTrainingDay } = require('../sync/adoption');
  return (req) => meetIdForTrainingDay(req.params[param]);
}

function byAthleteParam(param) {
  const { adoptedMeetForAthlete } = require('../sync/adoption');
  return (req) => adoptedMeetForAthlete(req.params[param]);
}

module.exports = {
  requireNotAdopted,
  byMeetParam,
  byEventParam,
  byTrainingDayParam,
  byAthleteParam,
  LOCKED_MESSAGE,
};
