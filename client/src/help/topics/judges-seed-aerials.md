## Seeding an aerials panel

Aerials v2 events use numbered judge roles (`AeJudge1` through `AeJudge<N>`). Instead of adding judges one by one, **Seed N-Judge Aerials Panel** wipes existing aerials judges and creates the right number of slots in one click.

### When to use

- New aerials event setup — fastest way to create the right panel.
- Changing the panel size mid-setup — wipes and rebuilds. Use before scoring starts.
- Recovering from a botched judge configuration — atomic reset.

### Steps

1. Confirm **Aerials Panel Size** is set correctly on the Setup tab (e.g., `5` for a standard FIS panel, `3` for a USA Regional sub-panel).
2. Click **Seed N-Judge Aerials Panel** in the Setup tab's judge section.
3. A confirmation modal warns that existing aerials judges will be deleted. Click **Confirm**.
4. The server runs `POST /events/:id/judges/seed-aerials`:
   - Deletes all rows in `judges` where `event_id = ?` and role like `AeJudge%` or legacy aerials roles.
   - Inserts N new rows with role `AeJudge1` ... `AeJudge<N>`, fresh short codes, and `judge_number = 1..N`.
5. Names are left blank. Click each judge row to enter the judge's name (and optional PIN).

### What it does *not* do

- Doesn't delete the HeadJudge row (kept).
- Doesn't delete any registrations, runs, scores, or other event data.
- Doesn't notify any tablets — if a judge tablet was open on an old judge's URL, that URL now 404s (or shows "Judge not found"). Re-share the new URLs from the Links tab.

### After seeding

1. Fill in each judge's name on the Setup tab.
2. Generate tablet URLs from the **Links** tab.
3. Distribute the URLs.

### Editing post-seed

Once seeded, you can:

- Edit any judge's name or PIN.
- **Cannot easily change the panel size** without re-seeding. Re-seeding is destructive to existing aerials judges (deletes & recreates), so do it before any scores are submitted.

### HJ may score?

If the event type is **USA Regional** with HJ-may-score enabled, the HJ counts as one of the N panel judges. The panel size already accounts for this — for a USA Regional with panel_size=3 and HJ-may-score, you've got 3 scoring slots, one of which is the HJ. The other two are seeded as `AeJudge1` and `AeJudge2`.

### Legacy aerials events

Pre-v1.18.00 events use component-specific roles (`AirJudge1`, `FormJudge1`, `LandingJudge1`) instead of `AeJudge<N>`. There is no seed button for those events. They render historical results unchanged but should not be used for new aerials competitions.

### Reduction method check

After seeding, double-check that **Aerials Reduction Method** is set if the panel has fewer than 5 judges. For 2–4 judges, the options are: `Sum All` (default), `Drop High`, `Drop Low`, `Average`. Panels of 5+ use the FIS drop-high-and-drop-low rule automatically — no selection needed.
