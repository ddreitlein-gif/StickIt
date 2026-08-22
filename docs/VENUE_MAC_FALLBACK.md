# Run the Venue Server from a Mac (emergency fallback, R9)

Use this only when **both** Raspberry Pis in the kit are dead. There is no
installer (deliberately, R9/D6) — this is a step-by-step manual procedure.
A one-page printed version ships in the kit
(`server/public/docs/venue/runsheet_mac_fallback.pdf`).

## Steps

1. **Node.js** — install the LTS from nodejs.org if the Mac doesn't have it
   (`node --version` in Terminal to check).
2. **Get StickIt** — either download the repo ZIP from
   github.com/ddreitlein-gif/StickIt (green Code button → Download ZIP) and
   unzip, or copy the source folder from the kit USB stick.
3. **Start the server** — in Terminal:

   ```bash
   cd <the unzipped folder>/server
   npm install
   STICKIT_MODE=venue node index.js
   ```

   Leave this Terminal window open all day. Closing it stops scoring.
4. **Address for tablets** — `stickit.local` points at the Pi, not the Mac.
   Find the Mac's IP (System Settings → Wi-Fi/Ethernet → Details) and have
   every tablet use `http://<that-ip>:3001`. Write it on the stand card.
   The YoloBox overlay URL becomes `http://<that-ip>:3001/overlay`.
5. **Keep it awake** — System Settings → Lock Screen: never sleep on power;
   plug the Mac in.
6. **Adopt the meet** as normal (release code from the official). Everything
   else — PINs, seats, sync, check-in — works identically to the Pi.

## Differences vs the Pi

- No mDNS name (`stickit.local`) — numeric address only.
- No auto-restart on crash: if the Terminal shows a crash, press ↑ and Enter
  to re-run the `STICKIT_MODE=venue node index.js` line. Data is safe on disk.
- USB snapshots: optionally set `STICKIT_SNAPSHOT_DIR=/Volumes/<stick-name>`
  before the start command to snapshot to an attached stick.
- The database lives in `<folder>/data/scoring.db` — copy it off afterwards if
  the meet was checked in from the Mac and you want a keepsake backup.
