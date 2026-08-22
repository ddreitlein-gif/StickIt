/**
 * server/utils/routeList.js — Express route enumeration (v2 Step 1, FR-20).
 *
 * Walks the Express 4 router stack and returns every registered route with its
 * full path (mount prefixes reconstructed from layer regexps) and methods.
 * Used by the GENERATED lock-coverage test: the harness fetches this listing
 * (via GET /api/_debug/routes, enabled only when STICKIT_DEBUG_ROUTES=1) and
 * asserts that every mutation route is either guarded against adopted meets or
 * on the documented exemption list — so a future route cannot silently escape
 * the lock.
 */

/**
 * Convert an Express mount-layer regexp + keys back to a path string.
 * Handles the fast_slash root mount, literal segments, and named params.
 */
function mountPath(layer) {
  if (layer.regexp && layer.regexp.fast_slash) return '';
  let src = layer.regexp ? layer.regexp.source : '';
  // Trim the anchors Express adds: ^ ... \/?(?=\/|$)
  src = src.replace(/^\^/, '').replace(/\\\/\?\(\?=\\\/\|\$\)$/, '');
  // Named params appear as (?:\/([^\/]+?)) (slash inside the group) or, in
  // some Express versions, \/(?:([^\/]+?)) — substitute keys in order and
  // preserve the path slash.
  const keys = (layer.keys || []).map(k => k.name);
  let i = 0;
  src = src.replace(/\(\?:\\\/\(\[\^\\?\/\]\+\?\)\)/g, () => `/:${keys[i++] ?? `param${i}`}`);
  src = src.replace(/\(\?:\(\[\^\\?\/\]\+\?\)\)/g, () => `:${keys[i++] ?? `param${i}`}`);
  // Unescape literal slashes and dashes/dots.
  src = src.replace(/\\\//g, '/').replace(/\\([.\-])/g, '$1');
  return src;
}

function listRoutes(app) {
  const out = [];
  const walk = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods)
          .filter(m => m !== '_all')
          .map(m => m.toUpperCase());
        out.push({ path: prefix + (layer.route.path === '/' ? '' : layer.route.path), methods });
      } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        walk(layer.handle.stack, prefix + mountPath(layer));
      }
    }
  };
  walk(app._router.stack, '');
  return out;
}

module.exports = { listRoutes };
