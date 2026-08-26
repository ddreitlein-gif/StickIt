#!/usr/bin/env bash
#
# StickIt Venue Server — reproducible Raspberry Pi image build (v2 Step 6).
#
# Runs on a Linux machine (or Docker on macOS via pi-gen's build-docker.sh).
# Produces stickit-venue-<version>.img.xz, flashable with Raspberry Pi Imager.
# Publish the .img.xz as a GitHub Releases asset and update
# os_list_stickit.json so "StickIt Venue Server" appears inside Imager
# (Section 7; provisioning card: docs/venue run sheets).
#
# Usage:  ./build.sh [stickit-git-ref]     (default: the v2/main HEAD)
#
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
STICKIT_REF="${1:-main}"
# Pinned to the frozen bookworm branch: pi-gen's rolling arm64/master branches
# track the current Debian (trixie+) and their stage0 references packages that
# don't exist in the bookworm archives (rpi-loop-utils, rpi-usb-gadget).
PIGEN_REF="bookworm-arm64"
WORK="${STICKIT_IMG_WORK:-$HERE/.work}"

echo "== StickIt Pi image build (ref: $STICKIT_REF) =="

command -v git >/dev/null || { echo "git required"; exit 1; }

mkdir -p "$WORK"
cd "$WORK"

# 1. pi-gen (official Raspberry Pi OS image builder), 64-bit Lite branch.
if [ ! -d pi-gen ]; then
  git clone --depth 1 --branch "$PIGEN_REF" https://github.com/RPi-Distro/pi-gen.git
fi

# 1b. The bootstrap's debian-archive-keyring predates the Debian signing keys
# in use since trixie went stable — without this, stage0's apt-get update dies
# with NO_PUBKEY on deb.debian.org. Install the current keyring (committed
# alongside this script, from debian-archive-keyring 2025.1) into the rootfs
# before that apt-get update runs. Idempotent (guarded by marker filename).
cp "$HERE/debian-archive-keyring.gpg" pi-gen/stage0/00-configure-apt/files/
if ! grep -q "updated-debian-archive-keyring" pi-gen/stage0/00-configure-apt/00-run.sh; then
  perl -i -pe 's{^(on_chroot <<.*)$}{install -m 644 files/debian-archive-keyring.gpg "\${ROOTFS_DIR}/etc/apt/trusted.gpg.d/updated-debian-archive-keyring.gpg"\n$1} unless $done; $done ||= /on_chroot <</' \
    pi-gen/stage0/00-configure-apt/00-run.sh
fi

# 2. Drop in the StickIt stage: runs after stage2 (the Lite base).
STAGE="pi-gen/stage-stickit"
rm -rf "$STAGE"
mkdir -p "$STAGE/00-stickit/files"
cp "$HERE/provision.sh"          "$STAGE/00-stickit/files/"
cp "$HERE/stickit-venue.service" "$STAGE/00-stickit/files/"
cp "$HERE/stickit.avahi.xml"     "$STAGE/00-stickit/files/"
cp "$HERE/update-stickit.sh"     "$STAGE/00-stickit/files/"

# Fetch the StickIt tree to bake in (server/ only — same rule as the cloud hosts).
rm -rf stickit-src
git clone --depth 1 --branch "$STICKIT_REF" https://github.com/ddreitlein-gif/StickIt.git stickit-src
rm -rf stickit-src/.git stickit-src/client stickit-src/harness stickit-src/server/node_modules stickit-src/server/data
tar -C stickit-src -czf "$STAGE/00-stickit/files/stickit.tar.gz" server CLAUDE.md

# Stage files live under /opt, NOT /tmp: pi-gen's on_chroot mounts a tmpfs
# over ${ROOTFS_DIR}/tmp, so anything prerun copies into rootfs /tmp is
# invisible inside the chroot. provision.sh removes /opt/stage-files at the end.
cat > "$STAGE/00-stickit/00-run-chroot.sh" <<'EOS'
#!/bin/bash -e
/bin/bash /opt/stage-files/provision.sh
EOS
chmod +x "$STAGE/00-stickit/00-run-chroot.sh"

cat > "$STAGE/prerun.sh" <<'EOS'
#!/bin/bash -e
copy_previous
mkdir -p "${ROOTFS_DIR}/opt/stage-files"
cp -r "${STAGE_DIR}/00-stickit/files/." "${ROOTFS_DIR}/opt/stage-files/"
EOS
chmod +x "$STAGE/prerun.sh"
touch "$STAGE/EXPORT_IMAGE"

# 3. pi-gen config: 64-bit Lite + our stage; hostname "stickit" so tablets
#    reach http://stickit.local:3001 with zero DNS setup (D3).
#    H-11: SSH enabled + a user password baked in — every documented recovery
#    path (update fallback, C-1/M-11 repair, VENUE_MAC_FALLBACK) assumes
#    `ssh stickit@stickit.local`, and Bookworm may lock a passwordless user
#    entirely. Override the default credential with STICKIT_PI_PASSWORD; the
#    credential in use is printed on the venue run sheet (venue_cards).
STICKIT_PI_PASSWORD="${STICKIT_PI_PASSWORD:-stickitvenue}"
cat > pi-gen/config <<EOS
IMG_NAME=stickit-venue
RELEASE=bookworm
DEPLOY_COMPRESSION=xz
TARGET_HOSTNAME=stickit
FIRST_USER_NAME=stickit
FIRST_USER_PASS=${STICKIT_PI_PASSWORD}
DISABLE_FIRST_BOOT_USER_RENAME=1
ENABLE_SSH=1
STAGE_LIST="stage0 stage1 stage2 stage-stickit"
EOS

echo "== Handing off to pi-gen (this takes a while) =="
cd pi-gen
if [ "$(uname)" = "Darwin" ] || [ "${STICKIT_IMG_DOCKER:-}" = "1" ]; then
  ./build-docker.sh
else
  sudo ./build.sh
fi

echo "== Done. Image in pi-gen/deploy/ — publish the .img.xz to GitHub Releases"
echo "   and update os_list_stickit.json's url/extract_size/image_download_size/sha256."
