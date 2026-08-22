/**
 * v2.0.00 (Step 3) — shared venue-mode client helpers.
 *
 * Venue detection (FR-13): the client asks /api/venue/status once and caches
 * the answer for the session. Device role memory (6.2): a tablet remembers its
 * venue role in localStorage and returns straight to its role page after a
 * reboot instead of the menu.
 */

import api from '../../utils/api';

let _statusPromise = null;

export function fetchVenueStatus(force = false) {
  if (!_statusPromise || force) {
    _statusPromise = api.venueStatus().catch(() => ({ mode: 'cloud' }));
  }
  return _statusPromise;
}

const ROLE_KEY = 'stickit_venue_role';

export function getRoleMemory() {
  try {
    const raw = localStorage.getItem(ROLE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

export function setRoleMemory(mem) {
  try { localStorage.setItem(ROLE_KEY, JSON.stringify(mem)); } catch (_) {}
}

export function clearRoleMemory() {
  try { localStorage.removeItem(ROLE_KEY); } catch (_) {}
}

export function roleUrl(mem) {
  if (!mem || !mem.role) return null;
  if (mem.role === 'judge') return `/venue/role/judge?seat=${encodeURIComponent(mem.seat || 'J1')}`;
  return `/venue/role/${mem.role}`;
}
