## Live Scores listing

The Live Scores page at `/livescores` is the directory of every meet and event in the system. It's the spectator's hub — pick a meet, drill into an event's scoreboard.

### Layout

- **Sticky top header** — back-to-home + page title + division filter dropdown.
- **LIVE NOW strip** (red gradient) — currently-active events, grouped by meet. See below.
- **Meets list** — every meet, sorted latest-date-first. Each meet shows as a collapsible panel listing its events.
- **Pagination** at 10 meets per page.

### LIVE NOW strip — grouped by meet (v1.19.02+)

When events are actively being scored, they appear in a red strip at the top of the page. As of v1.19.02 the strip groups by **meet** rather than emitting one card per event:

- **One red gradient card per meet** with active events.
- **Meet name** is the card header (sk-display, large).
- **One small white-tinted pill per active event** inside (showing e.g. `Men · Moguls`).
- Each pill links to that event's `/scoreboard/<short>`.

This keeps the strip compact even when three concurrent meets each have multiple active events. Single-event meets render with the same meet-card chrome for visual consistency.

### Meets list

Each meet shows as a collapsible card:

- **Header row** — meet name (large), location, date.
- **Expand chevron** — collapsed by default. Click to reveal the event list.
- **Event rows** (when expanded) — discipline, gender, status (active / complete / setup), link to scoreboard.

### Status indicators

- **Active** — green pulse dot. Currently being scored.
- **Complete** — blue badge. Finalized.
- **Setup** — gray. Not yet started.

### Division filter

Top-right filter dropdown. Options:

- All divisions
- RM (Rocky Mountain)
- SE (Southeast)
- IM (Intermountain)
- ... etc.

Filter narrows to meets and events with athletes from the selected division.

### Backend

`GET /api/meets/livescores?page=&limit=10&division=` returns a paginated list of meets with nested event arrays. Each event includes status and a link short code.

### Auto-refresh

The Live Scores page silently re-fetches every 45 seconds, so the LIVE NOW strip and event statuses stay current on an unattended display. No manual refresh needed.

### Sun Mode

The Sun Mode toggle inherits from the home page choice (stored in `localStorage.stickit.sunMode`). High-contrast palette for outdoor viewing.

### Backlinks

Footer of each meet card: "View all events" → expands the meet. Footer of each event row: links to `/scoreboard/<short>`.

### Mobile

The page is responsive — meet cards stack vertically on narrow viewports. The LIVE NOW strip wraps. Tested on iPhone portrait.

### What's NOT shown

- **Events hidden by an admin** — the Hide toggle on [Admin → Events](./admin-events) removes an event from this page (and a meet whose every event is hidden disappears entirely). Used to keep test events out of public view. Direct scoreboard links still work.
- Locked events are **visible** here — locking hides events from the Officials dashboard only; public spectators should still see the final state.
- Events with a status of `setup` and no athletes — shown with a gray indicator; spectators can see what's scheduled.

### When to share this URL

- **Pre-meet** — share `/livescores` with your spectator community as the meet's public landing page.
- **Mid-meet** — share with anyone wanting to follow along.
- **Post-meet** — same URL still works; events display as Complete with final standings.
