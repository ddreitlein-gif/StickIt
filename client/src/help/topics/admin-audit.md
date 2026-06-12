## Audit log

The Admin → Audit Log page at `/admin/audit` displays every system mutation captured in the `audit_log` table. Reads are not logged — only changes. Use this to investigate "who did what when" questions.

### What's logged

- **Run scoring** — score submissions, edits, rejections, manual entries, status overrides.
- **Registration** — athletes added / removed / scratched / edited.
- **Run order** — random builds, age-group builds, manual reorders, lock toggles.
- **Bib assignment** — every bib update, including bulk operations.
- **Judge management** — add / edit / delete.
- **Event config** — phase changes, course spec updates, panel size changes, lock toggles.
- **Meet operations** — create / edit / import / export / delete.
- **User management** (Admin) — create / edit / deactivate.
- **Security** — password changes and enabling / disabling password protection.
- **Admin event actions** — re-opening finalized events, hiding / showing events on Live Scores.
- **USSS sync** — sync runs, upload events.
- **Athletes bulk operations** — bulk soft-deletes and restores.
- **Backups** — manual backup triggers, auto-backup failures.

### Columns

Each row shows:

- **Timestamp** — UTC, displayed in local time
- **Action** — short identifier (e.g., `run_finalized`, `athletes_bulk_deleted`, `event_reopened`)
- **Entity** — the kind of thing changed (event, run, athlete, meet…)
- **ID** — the specific record's identifier
- **Detail** — JSON payload with old / new values

### Filtering

Filters at the top of the page:

- **Entity** and **Action** — dropdowns populated live from the values actually present in your log, so they always match your data.
- **From / To dates** — limit the result to a date range.
- **Row limit** — how many entries to load.

Combine filters with AND logic.

### Inspecting a row

Click any row to expand the **Detail** JSON. For score edits, you'll see the before/after values for every changed field. For bulk operations, you'll see the count + a sample of affected rows.

### Touch / mouse support

As of v1.16.13, rows are touch-responsive on iPad. Tap to expand; tap again to collapse.

### Where it moved

In v1.16.15, Audit Log was moved from `/dashboard/audit` (Officials) to `/admin/audit` (Admin). The old URL redirects to the new one.

### Retention

There's no automatic retention policy. The `audit_log` table grows indefinitely. Periodically check the [Admin Dashboard](./admin-dashboard) for DB size; if it grows unwieldy, an admin can hand-prune rows older than a season via SQL. A retention UI is on the future roadmap.

### What's NOT logged

- Read access — viewing pages, opening modals, viewing PDFs.
- Individual sign-ins — login attempts aren't logged (repeated failures are rate-limited at the server instead).
- Backup file creations (success path) — only failures are logged.
- WebSocket connection events.
- Server boot / shutdown events.

### When to consult

- **Score dispute** — "this athlete's score was 76 last night but it's 74 now — who changed it?"
- **Missing data** — "we had 18 athletes registered but now I only see 16"
- **System investigation** — "the database changed sometime around 3pm yesterday; what happened?"
- **Pre-release verification** — auditing your own changes after a setup session.
