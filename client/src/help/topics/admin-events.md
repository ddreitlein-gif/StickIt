## Event Management (Admin)

The Admin → Events page at `/admin/events` is where every event in the system can be **locked**, **hidden from Live Scores**, or **re-opened** after finalization. It's also the canonical view of all events across all meets — a useful audit lens.

### Meet-grouped layout

Events are grouped by meet. Each meet appears as a collapsible section:

- **Header row** — meet name + date, with status badges when collapsed ("All locked" / "Partially locked", "Hidden from Live Scores" / "Partially hidden").
- **Lock All / Unlock All** and **Hide All / Show All** bulk buttons (each asks for confirmation).
- A **search box** above the list filters by meet or event name.

Expand a meet to see its event rows: event name, discipline, status, a Lock indicator, a Live Scores indicator (Visible / Hidden), and the action buttons.

### Locking an event

Click **Lock** on a row. Immediate effects:

- The event becomes read-only — every mutation endpoint is refused.
- The event is hidden from the Officials Dashboard (and the whole meet disappears from the Dashboard if every event under it is locked).
- Public scoreboards and the broadcast overlay continue to display the final state — locking is invisible to the public.

Locking is **reversible and non-destructive**; the data stays intact.

**When to lock:** end-of-meet after PDFs and USSS XML are out; pre-archive; or mid-meet to protect a finalized event while later events are still running. **When to unlock:** a TD-approved correction, a re-opened protest, or fixing a typo.

### Hiding an event from Live Scores

Click **Hide** on a row (or **Hide All** on a meet) to remove the event from the public **Live Scores** page and from third-party apps using the public event list. This is the tool for keeping **test events** out of public view.

- Hiding is **completely independent of locking** — an event can be locked, hidden, both, or neither.
- Hiding affects *listings only*. Anyone with the direct scoreboard short-code link can still view the event, the broadcast Overlay keeps working, and judge tablets are unaffected — so you can fully test a hidden event.
- If **every** event in a meet is hidden, the meet itself disappears from the Live Scores page.
- New events are always visible by default. Click **Show** (or **Show All**) to restore visibility.

### Re-opening a finalized event

Events with status **complete** show a **Re-open** button. Click it (and confirm) to set the event back to *in progress* so scores can be corrected — for example after an upheld protest. For dual mogul events this also clears the bracket's Head-Judge approval so the review flow runs again. The event must be finalized again afterward. Every re-open is recorded in the [Audit log](./admin-audit).

### Bulk actions

Per meet, **Lock All / Unlock All** and **Hide All / Show All** toggle every event under the meet in one click — useful at end-of-meet, or to drop a whole test meet off Live Scores.

### Compare with the Officials sidebar

The Officials Dashboard automatically filters out locked events — they disappear from the operator's view but stay visible here in Admin. This is intentional: Admin should be able to see and manage everything; Officials should be focused on what's actively being scored.
