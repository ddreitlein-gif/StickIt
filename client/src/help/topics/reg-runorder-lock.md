## Locking run order

After the run order is finalized — typically the morning of the meet — click **Lock Order** in the Run Order section header. This protects the order from accidental edits and adds explicit placement controls for late additions.

### Effects of locking

When the order is locked:

- **Random Order**, **By Age Groups**, the **▲**/**▼** arrows, and **Save Order** are all disabled.
- A placement dialog appears whenever you add an athlete (search, USSS, CSV, manual, bulk) or change a scratched athlete's status back to **Registered**.
- The lock state persists across page refreshes (`events.order_locked` column).

### Placement dialog

When adding or un-scratching an athlete with a locked run order, you must pick where they go:

- **Start of Run Order** — bib position 1, all other athletes shift down by 1.
- **End of Run Order** — appended at the bottom.
- **Random Position** — placed at a random index in the existing order; existing positions shift around them.

This forces a deliberate choice — no athlete silently lands at the wrong place.

### Scratching with a locked order

When you scratch an athlete (status changes from Registered → Scratched) and the order is locked, the athlete's `run_order` is cleared automatically (and their `phase_run_order` entries if phases exist). The positions of the remaining athletes are *not* compressed — there's a gap where they used to be. This preserves the meaningful order: bib 5 is still in slot 5 even if bib 4 is now scratched.

### Unlocking

Click **Lock Order** again (it toggles). Unlocking restores all the editing buttons; you can shuffle, rebuild, or hand-reorder. After your changes, click **Save Order** and re-lock if you want.

### When to lock

- **End of Day 0 / start of Day 1 morning** — once you've shaken out late drops, locked is the safest state through the event.
- **Just before bib assignment** — locking the order before running **Bib Assignment → By Run Order** guarantees bib positions don't shift mid-process.
- **After a TD-supervised draw** — once the TD has approved the order on paper, lock it so nothing changes inadvertently.

### When to keep it unlocked

- **During open registration** — the order will change as people arrive.
- **During seed building for a dual mogul event** — you may want to rebuild seeds multiple times.

### Server-side enforcement

`events.order_locked` is a database column, so the lock state is honored by every API endpoint, not just the UI. Even if you bypass the UI, the server refuses to change `run_order` on a locked event without the placement dialog's explicit `placement` parameter.
