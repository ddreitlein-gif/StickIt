/**
 * Authentication placeholder middleware.
 *
 * Currently passes all requests through. To activate authentication:
 * 1. Implement JWT or session-based auth (e.g., jsonwebtoken + bcrypt)
 * 2. Create POST /api/auth/login endpoint that issues tokens
 * 3. In requireAuth: extract token from Authorization header or cookie,
 *    verify it, look up the user in the users table, attach user to req
 * 4. In requireRole: check req.user.role against the required role
 * 5. Return 401 for missing/invalid tokens, 403 for insufficient role
 */

function requireAuth(req, res, next) {
  // TODO: verify JWT/session, attach req.user
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    // TODO: check req.user.role against required role
    next();
  };
}

module.exports = { requireAuth, requireRole };
