#!/usr/bin/env bash
#
# StickIt Venue Server — routine update (v2 Step 6, Section 7).
# Run by the home-screen Update button, or manually over SSH:
#   ssh stickit@stickit.local 'sudo /opt/stickit/update-stickit.sh'
# Downloads the latest GitHub release source, swaps the app, restarts the
# service. Never run while a meet is adopted (the Update button hides then).
set -euo pipefail

REPO="${STICKIT_UPDATE_REPO:-ddreitlein-gif/StickIt}"
APP_DIR=/opt/stickit
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "== StickIt update from $REPO =="
TAG=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep -m1 '"tag_name"' | cut -d'"' -f4)
[ -n "$TAG" ] || { echo "Could not determine the latest release"; exit 1; }
echo "Latest release: $TAG"

curl -fsSL "https://github.com/$REPO/archive/refs/tags/$TAG.tar.gz" -o "$TMP/src.tar.gz"
mkdir -p "$TMP/src"
tar -C "$TMP/src" --strip-components=1 -xzf "$TMP/src.tar.gz"

# Keep the live database + logos; swap the code.
rm -rf "$APP_DIR/server.new"
cp -r "$TMP/src/server" "$APP_DIR/server.new"
rm -rf "$APP_DIR/server.new/data"
cd "$APP_DIR/server.new" && npm install --omit=dev
[ -d "$APP_DIR/server/data" ] && cp -r "$APP_DIR/server/data" "$APP_DIR/server.new/data"
rm -rf "$APP_DIR/server.old"
mv "$APP_DIR/server" "$APP_DIR/server.old"
mv "$APP_DIR/server.new" "$APP_DIR/server"
chown -R stickit:stickit "$APP_DIR/server"

systemctl restart stickit-venue.service
echo "== Updated to $TAG and restarted =="
