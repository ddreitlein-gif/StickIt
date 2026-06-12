## Broadcast Overlay (OBS/YoloBox)

The Overlay at `/overlay/<short>` is a **1920×1080 transparent-background** broadcast surface designed for OBS, YoloBox, or any other live-streaming setup. It's the same data as the public Scoreboard but in a video-friendly layout.

### How to use it

1. In OBS, add a new **Browser Source**.
2. Set the URL to `https://<your-stickit-server>/overlay/<event-short>`.
3. Set width 1920, height 1080.
4. ✅ Check **"Custom CSS"** is unset (no extra styling needed).
5. ✅ Check **"Use custom frame rate"** if your stream is non-60fps.

The body / html background is forced to `transparent !important` via `useLayoutEffect`, so OBS can composite the overlay on top of your live video feed.

For YoloBox, use its "URL" source type with the same overlay URL.

### Reveal animations

Each scored run triggers a reveal animation:

1. **Run start** — the OverlayRibbon shows the new athlete's bib and name.
2. **Score finalize** — the OverlayScoreReveal animates the total in with a `cubic-bezier(0.34, 1.56, 0.64, 1)` overshoot (480ms duration, 380ms delay after stat-block fade-ins).
3. **Components** — Turns/Air/Time/Speed components fade in staggered (50ms / 130ms / 210ms / 290ms).
4. **Hide** — after a few seconds, the reveal fades back to a minimal ribbon, ready for the next athlete.

### Dual mogul overlay

For dual mogul events, the OverlayDualVS shows:

- **Blue side** (left) — athlete bib + name + club.
- **VS button** (center) — circular.
- **Red side** (right) — same.

Pre-result: chips show `#<bib>` on each side.

Post-result:
- Score chip on the **outer edge** of each side panel (away from VS center).
- Athletes' bibs shown in small text under their names.
- Loser's status (DNF / DNS / DSQ) replaces score chip on that side.
- Winner side gets a **gold inset border + glow shadow**.
- Winner label appears: "1ST" / "2ND" (finals), "3RD" / "4TH" (small final), "WINNER" (non-finals).

### Transparent canvas

Critical for broadcast: the overlay does NOT mount `PublicLayout` (which would set a body background). Instead it injects only CSS variables, fonts, and keyframes onto a scoped `.stickit-overlay-root` class. Body stays transparent so the underlying video feed shows through.

### Hardware-encoder fallback poll

When OBS / YoloBox runs in a long-lived headless browser environment without a persistent WebSocket connection, the overlay uses a **3-second polling fallback** for score updates. The dedup logic (v1.19.01) prevents the poll from overwriting fresh WebSocket data — each poll captures a `pollStartedAt` timestamp and skips its update if a WebSocket message landed after that timestamp.

### Hydration on mount

When the overlay loads (e.g., OBS just started the browser source), it hydrates from the server's current state: any in-progress run shows, the most-recently-completed run's reveal animation may play (skipping manually-entered runs).

### Hiding the overlay

The Scoring tab has a compact **Broadcast Overlay: Hide / Show** control (on both the single-mogul and dual panels). **Hide** blanks the overlay's content — useful between events or during a delay — and the overlay stays blank until you click **Show** or the next run starts (a new run, score, or dual match automatically un-hides it). While hidden, the overlay's fallback polling is suppressed so a score can't flicker back on screen.

### Tablet / mobile

The overlay is designed for 1920×1080. Viewing on smaller screens scales it via viewport scaling, but the layout is broadcast-first, not mobile-first.

### Sun Mode

Sun Mode is **not** applied to the overlay (broadcast graphics should be consistent regardless of any operator UI choice).

### Multiple events on the same broadcast

For a meet with multiple events running concurrently, use separate OBS scenes — each with its own Browser Source pointing at the relevant event's overlay URL. Switch scenes to switch events on stream.
