## Locking events from the Admin panel

The Admin → Events page at `/admin/events` is where every event in the system can be locked or unlocked. It's also the canonical view of all events across all meets — a useful audit lens.

### Meet-grouped layout

Events are grouped by meet. Each meet appears as a collapsible section:

- **Header row** — meet name + date.
- **Chevron** to expand / collapse (collapsed by default).
- **Lock status summary** when collapsed — "All locked", "Partially locked", or "None locked".
- **Lock All / Unlock All button** — bulk-toggle every event under this meet.

Expand a meet to see its event rows. Each row shows event name, discipline, gender, category, status, and a per-event **Lock / Unlock** toggle.

### Locking an event

Click **Lock** on a row. The event's `events.locked` column is set to `1`. Immediate effects:

- The event becomes read-only — every mutation endpoint returns HTTP 403.
- The event is hidden from the Officials Dashboard (and from the meet detail page if all events under the meet are locked).
- Judge tablets attempting to score on the event get a "Locked" error.
- Public scoreboards and the broadcast overlay continue to display the final state.

### Bulk Lock All / Unlock All

Per meet, the **Lock All** / **Unlock All** button hits:

- `PUT /api/admin/meets/:meetId/lock-all` — locks every event in the meet.
- `PUT /api/admin/meets/:meetId/unlock-all` — unlocks every event in the meet.

Useful at end-of-meet to lock the entire weekend's worth of events in one click.

### When to lock

- End-of-meet, after all PDFs are generated and USSS XML is transmitted.
- Pre-archive — lock + export + delete from active server.
- Mid-meet, to protect a finalized event from accidental edits while later events are still in progress.

### When to unlock

- A correction needs to be made post-finalization (rare; should be TD-approved).
- The event is being re-opened for a re-do (e.g., a protest was upheld).
- You realized a typo in the event name needs fixing.

### Note: locking is not deletion

Locking is **reversible** and **non-destructive**. The event data stays intact. Public scoreboards continue to display the event's final state — locking is invisible to the public.

### Filtering

The Admin → Events page doesn't currently have a filter input. To find a specific event, expand the meet by name. A search field is on the future roadmap.

### Audit log

Every lock / unlock toggle is logged in `audit_log`. View on the [Audit log](./admin-audit) page.

### Compare with the Officials sidebar

The Officials Dashboard respects the `excludeLocked=1` filter automatically — so locked events disappear from the operator's view but stay visible here in Admin. This is intentional: Admin should be able to see and manage locked events; Officials should be focused on what's actively being scored.
