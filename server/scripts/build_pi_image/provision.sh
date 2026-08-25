#!/bin/bash -e
#
# StickIt Venue Server — in-chroot provisioning (run by pi-gen stage-stickit).
# Installs Node LTS + the StickIt server, enables the systemd service, Avahi
# mDNS (stickit.local), NTP + fake-hwclock (FR-17: Pi 4 has no battery clock —
# an offline boot starts with the last saved time; sequence numbers, not
# clocks, order the sync), and the USB snapshot mount point (R11).

# M-12: the wrapper invokes this as `/bin/bash provision.sh`, which ignores
# the shebang's -e — without an explicit errexit a failed npm install or
# NodeSource fetch still produced a "green" image that boots to nothing.
set -euo pipefail

FILES=/tmp/stage-files
APP_DIR=/opt/stickit

echo "== StickIt provisioning =="

# 1. Node.js LTS (NodeSource) ------------------------------------------------
apt-get update
apt-get install -y ca-certificates curl gnupg avahi-daemon fake-hwclock
mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
  > /etc/apt/sources.list.d/nodesource.list
apt-get update
apt-get install -y nodejs

# 2. StickIt app -------------------------------------------------------------
mkdir -p "$APP_DIR"
tar -C "$APP_DIR" -xzf "$FILES/stickit.tar.gz"
cd "$APP_DIR/server"
npm install --omit=dev
mkdir -p "$APP_DIR/data"
cp "$FILES/update-stickit.sh" "$APP_DIR/update-stickit.sh"
chmod +x "$APP_DIR/update-stickit.sh"
chown -R stickit:stickit "$APP_DIR"

# 2b. Allow the home-screen Update button to run the update script.
echo 'stickit ALL=(root) NOPASSWD: /opt/stickit/update-stickit.sh' > /etc/sudoers.d/stickit-update
chmod 440 /etc/sudoers.d/stickit-update

# 3. systemd service (auto-boot ~1 min, auto-restart) ------------------------
cp "$FILES/stickit-venue.service" /etc/systemd/system/stickit-venue.service
systemctl enable stickit-venue.service

# 4. mDNS: hostname is already "stickit" (pi-gen config), so avahi-daemon
#    advertises stickit.local out of the box; the service record makes the
#    HTTP port discoverable too.
mkdir -p /etc/avahi/services
cp "$FILES/stickit.avahi.xml" /etc/avahi/services/stickit.service
systemctl enable avahi-daemon

# 5. Time (FR-17): systemd-timesyncd syncs whenever WAN time is reachable;
#    fake-hwclock restores the last known time on offline boots so timestamps
#    are merely stale, never 1970. Venue record timestamps are advisory —
#    outbox sequence numbers order the sync; nothing venue-side enforces
#    wall-clock token expiry.
systemctl enable systemd-timesyncd
systemctl enable fake-hwclock

# 6. USB snapshot stick (R11): a stick labeled STICKIT-SNAP auto-mounts at
#    /media/stickit-snapshot; the venue server snapshots there every 5 min and
#    degrades gracefully when absent.
mkdir -p /media/stickit-snapshot
grep -q STICKIT-SNAP /etc/fstab || \
  echo 'LABEL=STICKIT-SNAP /media/stickit-snapshot auto defaults,nofail,noatime,x-systemd.device-timeout=5 0 0' >> /etc/fstab

echo "== StickIt provisioning complete =="
