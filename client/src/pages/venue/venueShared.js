/**
 * v2.0.00 (Step 3) — shared venue-mode client helpers.
 *
 * Venue detection (FR-13): the client asks /api/venue/status once and caches
 * the answer for the session. Device role memory (6.2): a tablet remembers its
 * venue role in localStorage and returns straight to its role page after a
 * reboot instead of the menu.
 */

import { useState, useEffect } from 'react';
import api from '../../utils/api';

let _statusPromise = null;

export function fetchVenueStatus(force = false) {
  if (!_statusPromise || force) {
    // M-13: never cache a failure — a transient error must not lock a venue
    // Pi's client into cloud mode (unregistering the venue routes) for the
    // whole session, and callers need to distinguish failure from "cloud".
    const p = api.venueStatus().catch((e) => {
      if (_statusPromise === p) _statusPromise = null;
      throw e;
    });
    _statusPromise = p;
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

// v2.4.00 (physical test T-2/T-4): human labels for the venue role bar and
// the seat picker. Judge roles mirror EventDetail's ROLE_LABELS.
const ROLE_LABELS = {
  TL1: 'T&L 1', TL2: 'T&L 2', TL3: 'T&L 3', TL4: 'T&L 4', TL5: 'T&L 5',
  Air1: 'Air 1', Air2: 'Air 2', HJ: 'Head Judge',
  AeJudge1: 'Judge 1', AeJudge2: 'Judge 2', AeJudge3: 'Judge 3', AeJudge4: 'Judge 4',
  AeJudge5: 'Judge 5', AeJudge6: 'Judge 6', AeJudge7: 'Judge 7',
  AirJudge1: 'Air Judge 1', AirJudge2: 'Air Judge 2', AirJudge3: 'Air Judge 3',
  FormJudge1: 'Form Judge 1', FormJudge2: 'Form Judge 2', FormJudge3: 'Form Judge 3',
  LandingJudge1: 'Landing Judge 1', LandingJudge2: 'Landing Judge 2', LandingJudge3: 'Landing Judge 3',
  DualTurns1: 'Turns Judge 1', DualTurns2: 'Turns Judge 2', DualAir: 'Air Judge',
  DualTime: 'Time Judge', DualOverall: 'Overall Judge',
};
const VENUE_ROLE_LABELS = { judge: 'Judge', hj: 'Head Judge', timekeeper: 'Timekeeper', scoreboard: 'Scoreboard', dashboard: 'Scoring Computer' };
const DISCIPLINE_LABELS = { mogul: 'Moguls', dual_mogul: 'Dual Moguls', aerials: 'Aerials' };

export function judgeRoleLabel(role) { return ROLE_LABELS[role] || role || ''; }
export function venueRoleLabel(role) { return VENUE_ROLE_LABELS[role] || role || ''; }
export function disciplineLabel(d) { return DISCIPLINE_LABELS[d] || d || ''; }
export function describeMemory(mem) {
  if (!mem || !mem.role) return '';
  return mem.role === 'judge' ? `Judge, seat ${mem.seat || '?'}` : venueRoleLabel(mem.role);
}

/**
 * v2.4.00 — venue-mode detection for pages shared with the cloud (the
 * officials Layout sidebar, MeetDetail). Same cached /api/venue/status answer
 * App.jsx roots on; null until known, then true/false. A failed probe reads
 * as cloud (the safe default: nothing venue-specific is shown).
 */
export function useVenueMode() {
  const [venue, setVenue] = useState(null);
  useEffect(() => {
    let dead = false;
    fetchVenueStatus().then(s => { if (!dead) setVenue(s.mode === 'venue'); }).catch(() => { if (!dead) setVenue(false); });
    return () => { dead = true; };
  }, []);
  return venue;
}

export function roleUrl(mem) {
  if (!mem || !mem.role) return null;
  if (mem.role === 'judge') return `/venue/role/judge?seat=${encodeURIComponent(mem.seat || 'J1')}`;
  // M-15: the Scoring Computer is the officials console, not an iframe role
  // page — /venue/role/dashboard resolves to bad_role and strands the device
  // on a permanent "Waiting..." screen after a reboot.
  if (mem.role === 'dashboard') return '/dashboard';
  return `/venue/role/${mem.role}`;
}
