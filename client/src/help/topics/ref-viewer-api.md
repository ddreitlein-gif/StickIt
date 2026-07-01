## Viewer API (third-party apps)

StickIt exposes a read-only public API at `/api/viewer` for iOS apps and other third-party clients that want to display live competition results. No authentication is required — it stays open even when password protection is on — and it never exposes anything a spectator couldn't already see on the public Scoreboard.

### Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/viewer/events` | Event list across all meets; `?status=in_progress` filters to live-only |
| `GET /api/viewer/resolve/:shortCode` | Look up an event from its short code (the same code used in `/scoreboard/<short>` URLs) |
| `GET /api/viewer/events/:id/status` | Live state: current round, athlete on course, next 10 upcoming athletes |
| `GET /api/viewer/events/:id/results` | Ranked results for the active round (mogul / aerials) or full bracket state (dual mogul) |
| `GET /api/viewer/events/:id/results/scores` | Per-judge raw scores for the active round — for expanded detail views |
| `GET /api/viewer/events/:id/rounds` | Round / phase list with status (not started / in progress / complete) |
| `GET /api/viewer/events/:id/dual-matches/:matchId/judge-points` | Per-judge blue/red point splits for one dual match (v1.26.00) |

Full request/response examples live in the project README's **Viewer API Reference** section.

### Behavior notes

- **Hidden events are excluded from the event list.** Events hidden via [Admin → Events](./admin-events) don't appear in `GET /api/viewer/events`, but the per-event endpoints (resolve, status, results, rounds) still work for anyone who has the short code — same listings-only rule as the Live Scores page.
- **Results follow the active round.** Between rounds, the most-recently-completed round's results are returned, so a client always has something to show.
- **Dual mogul** results return the full bracket with blue/red athletes, per-side scores, winner, and bye flags — enough to render a bracket tree. As of v1.26.00 each match also carries its `id` (use it with the judge-points endpoint) plus `nj_blue` / `nj_red` chop-rule flags.
- **Judge points** (`.../dual-matches/:matchId/judge-points`) returns `{ match_id, nj_blue, nj_red, judges: [{ judge_number, blue_points, red_points, time_tied }] }` ordered by judge number — the per-judge breakdown behind a tapped bracket match. A match id that doesn't belong to the event returns `404 { "error": "Match not found" }`.
- Unknown event IDs or short codes return `404 { "error": "Event not found" }`.

### Sharing with a developer

Give an app developer two things: your server's base URL and an event short code (visible in any scoreboard link). Everything else is discoverable from the endpoints above.
