## Editing an event

The **Edit** button appears on every event card on the meet detail page. Click it to re-open the same modal you used to create the event, pre-filled with current values.

### When Edit is enabled

The Edit button is **disabled once the first run for the event has been recorded**. "First run" means any row exists in the `runs` table for the event — which happens when scoring starts (tablet flow) or when a manual entry is submitted.

When disabled, the button shows the tooltip:

> Cannot edit after scoring has started

This is to prevent operators accidentally changing structural fields (number of judges, jump count, component-scoring on/off) mid-meet, which would invalidate runs already in the database. If you absolutely must change something after scoring has started, you have a few options:

1. **Server-side guard fields** — even if you bypass the UI, the server's `PUT /events/:id` endpoint refuses changes to `component_scoring`, `score_entry_mode`, `event_type`, and `aerials_panel_size` once a complete run exists.
2. **Delete and re-create** — delete the event (cascades to all its runs) and re-create from scratch.
3. **Re-score the affected runs manually** after the structural change. Out of scope for the standard flow — use only with TD approval.

### What you can safely edit pre-scoring

- Event name
- Date
- Category / division (within the same discipline)
- Number of T&L judges, Air judges, jumps
- Component-scoring on/off
- Has-speed on/off
- Aerials panel size, reduction method, HJ-may-score
- Pace time override

### What you can never edit after creation

- **Discipline** — switching mogul ↔ dual mogul ↔ aerials would invalidate the entire event's data model. To change discipline, delete and re-create.

### Saving

Click **Save Changes**. The event card updates immediately. No event-level data is reset; only the fields you changed are persisted.

### Visibility

Other officials viewing the meet detail page see the change on next refresh. Public scoreboards show updated event names within a few seconds via the live polling cycle.
