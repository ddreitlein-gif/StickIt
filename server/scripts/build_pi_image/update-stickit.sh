#!/usr/bin/env bash
#
# StickIt Venue Server — routine update (v2 Step 6, Section 7).
# Run by the home-screen Update button, or manually over SSH:
#   ssh stickit@stickit.local 'sudo /opt/stickit/update-stickit.sh'
# Downloads the latest GitHub release source, swaps the app, restarts the
# service. Never run while a meet is adopted (the Update button hides then).
#
# M-11 hardening: the live database lives OUTSIDE the swapped tree
# (/opt/stickit/data — schema.js's default relative to /opt/stickit/server,
# pinned explicitly via LIBSQL_URL in the systemd unit), the service is
# stopped before the swap, the swap has no rm-first window, and a trap
# restores the old tree and restarts the service if anything fails partway.
set -euo pipefail

REPO="${STICKIT_UPDATE_REPO:-ddreitlein-gif/StickIt}"
APP_DIR=/opt/stickit
TMP=$(mktemp -d)

echo "== StickIt update from $REPO =="
TAG=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep -m1 '"tag_name"' | cut -d'"' -f4)
[ -n "$TAG" ] || { echo "Could not determine the latest release"; rm -rf "$TMP"; exit 1; }
echo "Latest release: $TAG"

curl -fsSL "https://github.com/$REPO/archive/refs/tags/$TAG.tar.gz" -o "$TMP/src.tar.gz"
mkdir -p "$TMP/src"
tar -C "$TMP/src" --strip-components=1 -xzf "$TMP/src.tar.gz"

# Build the new tree completely BEFORE touching the live one.
rm -rf "$APP_DIR/server.new"
cp -r "$TMP/src/server" "$APP_DIR/server.new"
rm -rf "$APP_DIR/server.new/data"
cd "$APP_DIR/server.new" && npm install --omit=dev
chown -R stickit:stickit "$APP_DIR/server.new"

# From here on, any failure restores the old tree and restarts the service.
restore_on_exit() {
  if [ ! -d "$APP_DIR/server" ] && [ -d "$APP_DIR/server.old" ]; then
    mv "$APP_DIR/server.old" "$APP_DIR/server" || true
  fi
  systemctl start stickit-venue.service || true
  rm -rf "$TMP"
}
trap restore_on_exit EXIT

# Stop the service before swapping — never swap code under a running server,
# and Restart=always must not boot a half-swapped tree.
systemctl stop stickit-venue.service

rm -rf "$APP_DIR/server.old"
mv "$APP_DIR/server" "$APP_DIR/server.old"
mv "$APP_DIR/server.new" "$APP_DIR/server"

# Carry over server-tree-local assets (meet logos in server/data/logos). The
# live database is NOT here — it lives in /opt/stickit/data (LIBSQL_URL).
if [ -d "$APP_DIR/server.old/data" ]; then
  cp -a "$APP_DIR/server.old/data" "$APP_DIR/server/data"
  chown -R stickit:stickit "$APP_DIR/server/data"
fi

systemctl start stickit-venue.service
echo "== Updated to $TAG and restarted =="

# v2.4.00 (physical test L-2): devices flashed from the first image carry
# pi-gen's Europe/London default, which nobody chose. Move them to the venue
# timezone once (only when still on that default) so the journal reads in
# local time. Best-effort — never fails the update.
if command -v timedatectl >/dev/null 2>&1; then
  if [ "$(timedatectl show -p Timezone --value 2>/dev/null || true)" = "Europe/London" ]; then
    timedatectl set-timezone "${STICKIT_PI_TIMEZONE:-America/Denver}" 2>/dev/null \
      && echo "Timezone set to ${STICKIT_PI_TIMEZONE:-America/Denver} (was the image default Europe/London)" || true
  fi
fi

# v2.4.02: refresh THIS script from the tree just installed, so fixes to the
# update path itself reach fielded devices on the next update (provision.sh
# copies it once at image build; before this, a Pi kept its original script
# forever — the v2.4.01 timezone step above never ran on the test Pi). Atomic
# rename so the running copy (old inode) finishes cleanly; same path keeps the
# sudoers entry valid. Last step on purpose — nothing below depends on it.
NEW_SELF="$APP_DIR/server/scripts/build_pi_image/update-stickit.sh"
if [ -f "$NEW_SELF" ] && ! cmp -s "$NEW_SELF" "$APP_DIR/update-stickit.sh"; then
  cp "$NEW_SELF" "$APP_DIR/update-stickit.sh.new" \
    && chmod 755 "$APP_DIR/update-stickit.sh.new" \
    && chown root:root "$APP_DIR/update-stickit.sh.new" 2>/dev/null \
    && mv -f "$APP_DIR/update-stickit.sh.new" "$APP_DIR/update-stickit.sh" \
    && echo "Update script refreshed for next time" || true
fi
