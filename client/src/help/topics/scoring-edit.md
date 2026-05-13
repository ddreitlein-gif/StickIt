## Editing a finalized score

Sometimes a finalized run needs to be corrected — a judge transposed a digit, the wrong jump code was recorded, the time was misread. StickIt supports score editing through the same Manual Score Entry modal pre-populated with the existing values.

### Steps

1. Open the event → **Results** tab (or the **Scoring** tab's score history).
2. Find the run you want to edit.
3. Click the **Manual Entry** / **Edit** button on that row.
4. The Manual Score Entry modal opens with every existing value pre-filled.
5. Change the fields you need.
6. Click **Submit**.

The server replaces all `judge_scores` for that run with the new values, recomputes `total_score` / `turns_score` / `air_score` / `speed_score` / `air_score_no_dd`, and broadcasts `score_update` to every viewer.

### Best-run selection

For Best of 2 events, editing one run may change which run is the athlete's best. The server re-runs `pickBestRun` (with the FIS-compliant tie-break) after the edit — so rankings update automatically. The Best Score column on the Results tab reflects the new best.

### Tie-break re-application

If the edit pushes the athlete's score across a tie with another athlete, ranks shift accordingly. The `tieBreakMogul` / `tieBreakAerials` comparator runs at every results-read site, so the new rank is computed correctly. There's nothing to manually re-run.

### Dual mogul edit

For dual mogul, completed matches show an **Edit Scores** button regardless of `score_entry_mode` (as of v1.16.17). Clicking it opens the paper-score modal pre-populated with the existing 5 judge points. Editing a non-leaf match's winner does **not** auto-recompute downstream matches — if the change inverts who advanced, you'll need to manually re-do later rounds.

### When editing is allowed

- **Any time** before the event is finalized — no restriction.
- **After Best of 2 / qualifier finalization** but before event-level finalization — still allowed; the affected phase is automatically updated.
- **After event finalization (`events.status='complete'`)** — the **Edit Scores** button is **hidden** for dual mogul (v1.19.01); for standard mogul it's still available but be careful. A future "re-open finalized event" admin action will provide a cleaner path.

### Audit trail

Every edit is logged in `audit_log` with the user, timestamp, run ID, old values, and new values. View on the [Audit log](./admin-audit) page.

### What the public sees

Public scoreboards refresh within 5 seconds of the edit (via the WebSocket `score_update` broadcast). The athlete's new score appears immediately. There's no "edited" badge — the new score replaces the old one cleanly.

### Voice-edit shortcut

In v1.20.00+, the Manual Score Entry modal's header has a 🎙 **Voice Entry** button. Clicking it closes the keyboard modal and opens the voice modal in tablet-edit mode with the athlete pre-selected. See [Voice manual score entry](./scoring-voice). Voice edit follows the same wizard model as voice paper-entry.

### If only the time is wrong

For a fix limited to the run time, the keyboard modal is the fastest — just open it, change the Time field, and submit. No need to touch any of the per-judge fields. The server only updates what changed.
