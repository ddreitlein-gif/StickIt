# StickIt Venue Server — Pi image build (v2, Section 7)

Reproducible flashable image for the venue Raspberry Pi (4 or 5, 64-bit,
booting from a USB SSD). Built with the official `pi-gen`; each v2.x release
publishes the compressed image as a **GitHub Releases** asset.

## Build (per release)

On a Linux machine (or any Docker host — the script uses pi-gen's
`build-docker.sh` on macOS):

```bash
cd server/scripts/build_pi_image
./build.sh v2.0.00          # git ref to bake in; default main
# → .work/pi-gen/deploy/stickit-venue-*.img.xz
```

What the image contains (see `provision.sh`):
- Raspberry Pi OS Lite (64-bit, bookworm), hostname **stickit** →
  `http://stickit.local:3001` works on iPads with zero setup (D3).
- Node 22 LTS + the StickIt `server/` tree at `/opt/stickit/server`
  (server-only, exactly like the cloud hosts).
- `stickit-venue.service`: `STICKIT_MODE=venue`, auto-start at boot (~1 min),
  `Restart=always` (power-pull safe).
- Avahi mDNS service record; systemd-timesyncd + fake-hwclock (FR-17 — Pi 4
  has no battery clock; sequence numbers, not clocks, order the sync).
- USB snapshot stick auto-mount: label a stick **STICKIT-SNAP** and it mounts
  at `/media/stickit-snapshot` (R11); absent stick = home-screen warning only.
  The service sets `STICKIT_SNAPSHOT_REQUIRE_MOUNT=1`, so snapshots are only
  reported healthy when a real USB stick is mounted (never the SD card, H-10).
- SSH enabled with user `stickit`, default password `stickitvenue` (H-11 —
  every recovery path assumes SSH). Override at build time with
  `STICKIT_PI_PASSWORD=<pass> ./build.sh <ref>` and record the credential on
  the printed venue run sheet.

## Publish

1. Upload `stickit-venue-<ver>.img.xz` to the GitHub release as
   `stickit-venue.img.xz` (stable latest-download URL).
2. Fill in `extract_sha256`, `extract_size`, `image_download_size`,
   `release_date` in `os_list_stickit.json` and publish that JSON at a stable
   URL (GitHub Pages / release asset). Imager opened with
   `rpi-imager --repo <json-url>` then shows **StickIt Venue Server (latest)**
   as a menu choice — the preferred provisioning path for volunteers.

## Flashing (rare — initial setup or drive replacement)

Both paths are on the printed provisioning card (`server/public/docs/venue/`):
- **Preferred:** open Imager via the StickIt shortcut (catalog URL), pick
  *StickIt Venue Server*, pick the drive, Write.
- **Plain:** download the `.img.xz` from the release link, Imager → *Use
  custom* → pick file → pick drive → Write.

## Updating (routine — no flashing)

- Home screen → **Update StickIt** (shown only when no meet is adopted and the
  internet is reachable): downloads the latest release, installs, restarts.
- SSH fallback: `ssh stickit@stickit.local 'sudo /opt/stickit/update-stickit.sh'`.
