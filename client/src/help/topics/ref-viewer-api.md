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
| `GET /api/viewer/events/:id/placements` | Full-field ranked final standings for a dual mogul event, per ICR 4312 — matches the web PLACE tab (v1.30.00) |

Full request/response examples live in the project README's **Viewer API Reference** section.

### Behavior notes

- **Hidden events are excluded from the event list.** Events hidden via [Admin → Events](./admin-events) don't appear in `GET /api/viewer/events`, but the per-event endpoints (resolve, status, results, rounds) still work for anyone who has the short code — same listings-only rule as the Live Scores page.
- **Results follow the active round.** Between rounds, the most-recently-completed round's results are returned, so a client always has something to show. As of v1.30.00 each mogul/aerials result row carries its `registration_id`, so per-judge detail from `/results/scores` can be joined by id instead of by list position.
- **Dual mogul** results return the full bracket with blue/red athletes, per-side scores, winner, and bye flags — enough to render a bracket tree. As of v1.26.00 each match also carries its `id` (use it with the judge-points endpoint). As of v1.29.00 each match carries `nj_call` (`null` / `"blue"` / `"red"` / `"both"` — FS-18 landing zone No Jump call) and `blue_score` / `red_score` are **effective** totals (NJ override + tie credits applied — a tied-time match totals 25, matching the web scoreboard). As of v1.30.00 each match also carries `winner_side` (`"blue"` / `"red"` / `null`) — the authoritative winner from the stored winner id, correct even for NJ-decided and tie-break matches where the point totals alone would mislead — plus `registration_id_blue` / `registration_id_red`.
- **Dual placements** (`.../placements`, v1.30.00) return the entire field ranked per ICR 4312 — `{ discipline: "dual_mogul", placements: [{ rank, registration_id, bib_number, gp, first_name, last_name, club, run_status, reg_status }] }`. `rank` is `null` for unclassified entries (first-round DNS in seeded groups, DSQ); `bib_number` is a number or `null`. Non-dual events get `400`.
- **Judge points** (`.../dual-matches/:matchId/judge-points`) returns, as of v1.29.00, `{ match_id, nj_call, speed_tied, air_tied, overall_scale, judges: [...], effective_judges: [...] }`. `judges` are the raw entries (`judge_number, blue_points, red_points, time_tied, air_tied`); `effective_judges` are the values that actually pay (NJ-overridden Time Judge row, 3/3 speed-tie credit, 0/0 air-tie, `overridden` flag) — display these so the app never has to recompute rules. A match id that doesn't belong to the event returns `404 { "error": "Match not found" }`.
- Unknown event IDs or short codes return `404 { "error": "Event not found" }`.

### Sharing with a developer

Give an app developer two things: your server's base URL and an event short code (visible in any scoreboard link). Everything else is discoverable from the endpoints above.
