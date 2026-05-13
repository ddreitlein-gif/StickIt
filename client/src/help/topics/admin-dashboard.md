## Admin Dashboard

The Admin Dashboard is the system administrator's landing page at `/admin/dashboard`. It surfaces server health, database stats, recent activity, and the in-memory error log at a glance. Auto-refreshes every 30 seconds.

### Sections

**Key metrics**
- Server uptime (since process start)
- App version
- WebSocket connection count (live)
- System IP + port

**Run statistics**
- Active runs (blue pulse) — currently being scored
- Pending runs (yellow) — waiting on HJ approval
- Complete runs (green) — finalized

**Database**
- Counts: meets, events, athletes, registrations, users
- DB file size
- Last backup timestamp
- Backup count

**Disk space**
- Progress bar showing used / total / percentage of the data partition

**Error log**
- Collapsible table of in-memory server errors since startup (max 100 entries, ring buffer)
- Each entry shows timestamp, tag (e.g., `BACKUP / auto`, `HTTP 500 /api/runs`), and message
- Errors are pushed by the error-capturing Express middleware and the auto-backup error callback

**Recent activity**
- Collapsible table of the last 20 audit log entries
- Shows what was changed, by whom, when

**Auth status**
- Placeholder indicator. Will show authenticated user info once authentication is enabled.

### Server endpoint

`GET /api/admin/dashboard` returns all the data in a single call. The page polls every 30s; manual refresh is also available via the **Refresh** button.

### What's not yet here

- Per-event drilldown (planned)
- Detailed query traces (out of scope; consider Railway / Grafana)
- Email alerts on errors (out of scope)

### Sidebar entry

The Admin sidebar's first entry is **Dashboard** (`/admin/dashboard`). The route `/admin/system` (legacy `System Info`) now redirects to the dashboard.

### When to check

- **Beginning of meet day** — verify server uptime, free disk, no pending errors, backup recent.
- **Mid-day during a meet** — quick sanity check after a connectivity event ("did the WebSocket count drop?").
- **End of meet** — review error log for anything that warrants follow-up.
- **Before a big release** — full review of activity, errors, DB stats.

### Setup tracking

The dashboard captures `app.startedAt`, `app.errorLog`, and `app.wss` references registered in `server/index.js` at boot. If you're running a custom server fork, ensure those are wired or the dashboard fields will be blank.
