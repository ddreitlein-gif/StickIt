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
- **USSS sync** — sync runs, upload events.
- **Athletes bulk operations** — bulk soft-deletes.
- **Backups** — manual backup triggers, auto-backup failures.

### Columns

Each row shows:

- **Timestamp** — UTC, displayed in local time
- **User** — the username who performed the action (or `system` for auto-triggered events)
- **Action** — short identifier (e.g., `run_finalized`, `athletes_bulk_deleted`, `event_locked`)
- **Target** — what was changed (e.g., `event:abc123`, `run:def456`)
- **Detail** — JSON payload with old / new values

### Filtering

Filters at the top of the page:

- **Action** — pick from a dropdown of known action types.
- **User** — filter by who.
- **Timestamp range** — start / end dates.
- **Target** — search by target ID.

Combine filters with AND logic.

### Inspecting a row

Click any row to expand the **Detail** JSON. For score edits, you'll see the before/after values for every changed field. For bulk operations, you'll see the count + a sample of affected rows.

### Export

There's a CSV export button at the top of the page — downloads the filtered set as `audit_log_<timestamp>.csv`. Useful for sharing with TDs or for off-site archive.

### Touch / mouse support

As of v1.16.13, rows are touch-responsive on iPad. Tap to expand; tap again to collapse.

### Where it moved

In v1.16.15, Audit Log was moved from `/dashboard/audit` (Officials) to `/admin/audit` (Admin). The old URL redirects to the new one.

### Retention

There's no automatic retention policy. The `audit_log` table grows indefinitely. Periodically check the [Admin Dashboard](./admin-dashboard) for DB size; if it grows unwieldy, an admin can hand-prune rows older than a season via SQL. A retention UI is on the future roadmap.

### What's NOT logged

- Read access — viewing pages, opening modals, viewing PDFs.
- Authentication events — there's no login yet, so no failed/successful auth events.
- Backup file creations (success path) — only failures are logged.
- WebSocket connection events.
- Server boot / shutdown events.

### When to consult

- **Score dispute** — "this athlete's score was 76 last night but it's 74 now — who changed it?"
- **Missing data** — "we had 18 athletes registered but now I only see 16"
- **System investigation** — "the database changed sometime around 3pm yesterday; what happened?"
- **Pre-release verification** — auditing your own changes after a setup session.
