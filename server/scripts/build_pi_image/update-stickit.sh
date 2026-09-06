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
#
# v2.5.01 (test Pi, 09-06-26): the home-screen button launches this script as
# a CHILD of stickit-venue.service, so `systemctl stop` below killed the whole
# control group — this script included — the instant the server stopped:
# server.new fully built, service stopped, swap never ran, box dead until an
# SSH update. Now the script re-launches itself as a transient systemd unit
# (outside the service's cgroup) whenever it finds itself inside it. It also
# writes a progress/result file the home screen polls
# (/opt/stickit/data/update-status.json), keeps a per-run log
# (/opt/stickit/data/update.log — also in `journalctl -u 'stickit-update-*'`
# when launched from the button), falls back to the release page's redirect
# when the unauthenticated GitHub API is rate-limited, and rolls back to the
# previous tree if the new server does not come up within 3 minutes.
set -euo pipefail

REPO="${STICKIT_UPDATE_REPO:-ddreitlein-gif/StickIt}"
APP_DIR=/opt/stickit
DATA_DIR="$APP_DIR/data"
STATUS_FILE="$DATA_DIR/update-status.json"
LOG_FILE="$DATA_DIR/update.log"
TAG=""
PHASE=start
STOPPED=0
LAST_ERR=""

json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n\r'; }

# write_status <state> <step> <message> — the file the home screen polls.
# state: running | done | failed. Owned by the service user so the server can
# reset it to "launched" before the next run.
write_status() {
  mkdir -p "$DATA_DIR"
  printf '{"state":"%s","step":"%s","message":"%s","tag":"%s","at":"%s"}\n' \
    "$1" "$2" "$(json_escape "$3")" "$TAG" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$STATUS_FILE.tmp" \
    && mv -f "$STATUS_FILE.tmp" "$STATUS_FILE"
  chown stickit:stickit "$STATUS_FILE" 2>/dev/null || true
}

fail() { LAST_ERR="$1"; echo "ERROR: $1"; exit 1; }

# --- Detach from the venue service's control group (v2.5.01) -----------------
if [ -z "${STICKIT_UPDATE_DETACHED:-}" ] && [ -r /proc/self/cgroup ] \
   && grep -q 'stickit-venue.service' /proc/self/cgroup 2>/dev/null \
   && command -v systemd-run >/dev/null 2>&1; then
  UNIT="stickit-update-$(date +%Y%m%d-%H%M%S)"
  if systemd-run --unit="$UNIT" --collect --quiet \
       --setenv=STICKIT_UPDATE_DETACHED=1 \
       --setenv=STICKIT_UPDATE_REPO="$REPO" \
       --setenv=STICKIT_PI_TIMEZONE="${STICKIT_PI_TIMEZONE:-America/Denver}" \
       "$0" "$@"; then
    echo "== Update handed to transient unit $UNIT (journalctl -u $UNIT) =="
    exit 0
  fi
  write_status failed start "Could not start the update outside the server's service (systemd-run failed)"
  exit 1
fi

# --- Per-run log (fresh each run; the status endpoint shows its tail) -------
mkdir -p "$DATA_DIR"
: > "$LOG_FILE"
chown stickit:stickit "$LOG_FILE" 2>/dev/null || true
exec > >(tee -a "$LOG_FILE") 2>&1
echo "== StickIt update from $REPO — $(date) =="

TMP=$(mktemp -d)

# One trap for every failure: restore the old tree if the swap had begun,
# restart the service if we stopped it, record the failure for the home screen.
on_exit() {
  local rc=$?
  trap - EXIT
  if [ "$rc" -ne 0 ]; then
    if [ "$PHASE" = swap ] && [ ! -d "$APP_DIR/server" ] && [ -d "$APP_DIR/server.old" ]; then
      mv "$APP_DIR/server.old" "$APP_DIR/server" || true
      echo "Restored the previous tree"
    fi
    if [ "$STOPPED" = 1 ]; then systemctl start stickit-venue.service || true; fi
    write_status failed "$PHASE" "${LAST_ERR:-Update failed during '$PHASE' (exit $rc) — see $LOG_FILE}"
    echo "== Update FAILED during '$PHASE' (exit $rc) =="
  fi
  rm -rf "$TMP"
}
trap on_exit EXIT
trap 'LAST_ERR="${LAST_ERR:-Command failed during $PHASE: $BASH_COMMAND}"' ERR

# --- Which release? ---------------------------------------------------------
PHASE=fetch
write_status running fetch "Looking up the latest release"
if curl -fsSL -H 'User-Agent: stickit-venue' \
     "https://api.github.com/repos/$REPO/releases/latest" -o "$TMP/release.json"; then
  TAG=$(grep -m1 '"tag_name"' "$TMP/release.json" | cut -d'"' -f4 || true)
else
  echo "GitHub API lookup failed (offline, or the unauthenticated 60/hour limit) — trying the release page"
fi
if [ -z "$TAG" ]; then
  # The release page's redirect carries the tag without touching the API.
  LOC=$(curl -fsSI -o /dev/null -w '%{redirect_url}' "https://github.com/$REPO/releases/latest" || true)
  TAG="${LOC##*/}"
fi
[[ "$TAG" =~ ^v?[0-9]+\.[0-9]+ ]] || { TAG=""; fail "Could not determine the latest release (no internet, or GitHub unreachable)"; }
CURRENT=$(node -e "console.log(require('$APP_DIR/server/version.js').VERSION)" 2>/dev/null || echo "?")
echo "Installed: $CURRENT — latest release: $TAG"
[ "$CURRENT" = "$TAG" ] && echo "(already on $TAG — reinstalling)"

# --- Download + build the new tree completely BEFORE touching the live one ---
PHASE=download
write_status running download "Downloading $TAG"
curl -fsSL "https://github.com/$REPO/archive/refs/tags/$TAG.tar.gz" -o "$TMP/src.tar.gz" \
  || fail "Download of $TAG failed (internet dropped?)"
mkdir -p "$TMP/src"
tar -C "$TMP/src" --strip-components=1 -xzf "$TMP/src.tar.gz"

PHASE=install
write_status running install "Installing $TAG (packages) — this can take a few minutes"
rm -rf "$APP_DIR/server.new" "$APP_DIR/server.failed"
cp -r "$TMP/src/server" "$APP_DIR/server.new"
rm -rf "$APP_DIR/server.new/data"
( cd "$APP_DIR/server.new" && npm install --omit=dev --no-audit --no-fund ) \
  || fail "npm install failed for $TAG — see $LOG_FILE"
chown -R stickit:stickit "$APP_DIR/server.new"

# --- Swap: stop, move, carry over server-tree-local assets, start ----------
PHASE=swap
write_status running restart "Restarting the server on $TAG"
# Stop the service before swapping — never swap code under a running server,
# and Restart=always must not boot a half-swapped tree.
systemctl stop stickit-venue.service
STOPPED=1

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

# --- Verify the new server answers; roll back if it never comes up --------
PHASE=verify
write_status running verify "Waiting for the server to come back on $TAG"
UP=""
for i in $(seq 1 90); do
  if curl -fsS -m 3 "http://127.0.0.1:${PORT:-3001}/api/venue/status" -o "$TMP/status.json" 2>/dev/null; then UP=1; break; fi
  sleep 2
done
if [ -z "$UP" ]; then
  echo "The server did not answer within 3 minutes on $TAG — rolling back to $CURRENT"
  systemctl stop stickit-venue.service || true
  mv "$APP_DIR/server" "$APP_DIR/server.failed" || true
  mv "$APP_DIR/server.old" "$APP_DIR/server" || true
  systemctl start stickit-venue.service || true
  STOPPED=0
  fail "Update to $TAG failed to start (journalctl -u stickit-venue); the box is back on $CURRENT"
fi
write_status done done "Updated to $TAG"
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
