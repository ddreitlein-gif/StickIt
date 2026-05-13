## Locking & unlocking events

Locking an event makes it **read-only** to officials and judges but leaves it fully visible on public scoreboards. Use this when an event is finalized and you want to prevent any accidental edits.

### Effects of locking

When an event is locked:

- Every API endpoint that mutates the event data (score submissions, status changes, registration changes, judge assignments) returns HTTP 403.
- The event is **completely hidden** from the Officials Dashboard (and from the meet detail page if all events under it are locked — see [Hide locked events](./events-lock)).
- Judge tablets that try to score on a locked event get a "Locked" error.
- Public scoreboards and the broadcast overlay continue to display the final state.

### Where to lock / unlock

Locks live on the event row (`events.locked` boolean column). Two places control them:

1. **Admin → Events** ([Locking events from the Admin panel](./admin-events)) — the canonical place. Per-event toggle plus Lock All / Unlock All per meet.
2. **Per-event** — via direct API in scripts or via the Admin panel.

There is no Lock button in the regular Officials interface — that's intentional. Locking is a privileged action.

### What locking does *not* do

- It doesn't delete data — all rows stay in the database.
- It doesn't end the event for public viewers — they continue to see live scores and final results.
- It doesn't affect other events under the same meet — only the event you locked.
- It doesn't affect exports / PDFs / CSV — those still work normally.

### Locking the whole meet

If every event under a meet is locked, the meet itself disappears from the Officials Dashboard list (which respects `excludeLocked=1`). Public surfaces still show the meet on `/livescores`. To bulk-lock all events of a meet, use **Lock All** in the Admin → Events page.

### Unlocking

The same toggle. Unlocking is immediate — the event reappears in the Officials Dashboard and edit endpoints accept changes again.

### Pre-v1.16.00 events

Lock support was added in v1.16.00. Events created before that version default to `locked=0` and behave as expected.

### Why lock at end-of-meet

1. **Prevents accidental edits** during cleanup, archive, or post-meet review.
2. **Locks the audit trail** — no more rows are added to the audit log for that event.
3. **Keeps public surfaces clean** — the event continues to display its final state to spectators without risk of mid-screen flickers from a stray edit.
4. **Required for sanction archive** — the locked state can be exported and treated as the immutable record of the event.
