## Head Judge tablet

The Head Judge tablet is the oversight surface during live scoring. The HJ doesn't enter scores — they review what the other judges submitted, approve or reject individual submissions, mark run statuses (DNS / DNF / DSQ / RNS), and finalize phases and events.

### URL

`/headjudge/<meet-short>/<event-short>` — taken from the event's **Links** tab. Unlike judge tablets, the HJ URL doesn't include a per-judge short code (there's only one HJ per event).

### Layout

- **AthleteBar** (top) — bib, name, run number, jump codes.
- **Status squares** (3-column status bar) — `T&L Judges 3/3`, `Air Judges 2/2`, `Time ✓`. Green when complete, gray when pending.
- **Per-judge review rows** — each row shows the judge's role, their submitted score, and a small **Reject** button.
- **Calculated score panel** (right) — Turns, Air, Speed/Time Points, Total. Computed live as judges submit.
- **Run Status grid** (bottom) — DNS / DNF / RNS / DSQ buttons.
- **Approve & Submit button** (large green, bottom) — appears only when every required judge has submitted.

### Per-judge review rows

For each judge, the row shows:

- **T&L judges** — component breakdown (`Crv 5.5 / UB 1.0 / A&E 4.5 / Ded 1.5`).
- **Air judges** — per-jump scores with jump codes (`J1: TS 0.49 → 3.4 / J2: bp 0.62 → 4.5`).
- **Timekeeper** — entered time, computed time points.

A red **Reject** button at the right of each row opens a confirm dialog before clearing that judge's submission.

### Aerials v2

For aerials v2 events, the HJ tablet shows a panel grid: rows = scoring judges, columns = (J1 Air/Form/Land, J2 Air/Form/Land). Each cell shows that judge's entered value. Computed totals appear at the bottom.

### Run Status

Four big buttons: **DNS**, **DNF**, **RNS**, **DSQ**. Each opens a confirm dialog:

> Mark [Athlete Name] as DNS?

before submitting. See [Run statuses](./scoring-statuses) for what each does.

### Approve & Submit

Once all judges (and timekeeper) have submitted, the big green button appears. Tap it:

- Finalizes the run (`runs.status='complete'`).
- Computes ranking.
- Broadcasts `score_update` to all viewers.
- Advances to the next athlete in run order.

### Send Back to Scoring

Amber button. Opens the whole run back to specific-judge editing — useful when multiple things need to be corrected.

### Phase summary

After every athlete in the current phase has been approved, the HJ tablet shows a **Phase Summary** card with:

- Combined per-athlete list (Run 1 / Run 2 columns for Best of 2).
- **Approve Phase** button — locks the phase, advances to next phase.
- **Send Back to Scoring** button — re-opens any run for editing.

### Final Review

After every phase is finalized, the **Final Review** screen appears: a combined table of all athletes with their per-phase scores, plus:

- **Approve & Finalize Event** (green) — sets `events.status='complete'`. The full-screen "Event Complete — Thank You for Your Work" appears.
- **Send Back to Scoring** (amber).

### Dual mogul HJ

Dual mogul HJ tablet manages match-by-match approval. After all bracket matches are complete, the bracket-review panel appears with the full bracket tree and the same two buttons.

### High-contrast mode

HC Mode button top-right. See [High-contrast (HC) mode](./tablet-hc).
