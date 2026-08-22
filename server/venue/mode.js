/**
 * server/venue/mode.js — STICKIT_MODE plumbing (v2, D4).
 *
 * `STICKIT_MODE=venue` selects venue mode (set in the Pi image's systemd
 * unit). Anything else — unset, empty, or any other value — is cloud mode,
 * the default. Venue-mode code is gated behind isVenueMode() so cloud-only
 * behavior is byte-for-byte unchanged when the flag is off.
 */

function isVenueMode() {
  return process.env.STICKIT_MODE === 'venue';
}

module.exports = { isVenueMode };
