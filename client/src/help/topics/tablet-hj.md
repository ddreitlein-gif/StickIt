## Head Judge tablet

The Head Judge tablet is the oversight surface during live scoring. The HJ doesn't enter scores — they review what the other judges submitted, approve or reject individual submissions, mark run statuses (DNS / DNF / DSQ), and finalize phases and events.

### URL

`/headjudge/<meet-short>/<event-short>` — taken from the event's **Links** tab. Unlike judge tablets, the HJ URL doesn't include a per-judge short code (there's only one HJ per event).

### Layout

- **AthleteBar** (top) — bib, name, run number, jump codes.
- **Status squares** (3-column status bar) — `T&L Judges 3/3`, `Air Judges 2/2`, `Time ✓`. Green when complete, gray when pending.
- **Per-judge review rows** — each row shows the judge's role, their submitted score, and a small **Reject** button.
- **Calculated score panel** (right) — Turns, Air, Speed/Time Points, Total. Computed live as judges submit.
- **Run Status grid** (bottom) — DNS / DNF / DSQ buttons.
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

Three big buttons: **DNS**, **DNF**, **DSQ**. Each opens a confirm dialog:

> Mark [Athlete Name] as DNS?

before submitting. See [Run statuses](./scoring-statuses) for what each does.

### Approve & Submit

Once all judges (and timekeeper) have submitted, the big green button appears. Tap it:

- Finalizes the run (`runs.status='complete'`).
- Computes ranking.
- Broadcasts `score_update` to all viewers.
- Advances to the next athlete in run order.

**The score set must be complete before a run can be published.** The **Finalize and Publish Score** fallback button stays disabled — with a "Waiting for scores: T&L 2/3 · Time pending" breakdown — until every required judge score (and time, when the event is timed) is in. On approval the server recomputes the total from the stored judge scores, so a rejected-then-resubmitted score always lands in the published number. Use DNS/DNF/DSQ for an athlete who did not complete the run.

### Starting runs from this tablet

The **Start Run** button (with its DNS companion) on the next-up card appears only when the meet's Advanced settings allow the Head Judge to start runs (on by default). When pressed, the tablet re-checks the server's next-up athlete first — so a card that went stale while the iPad was asleep can never start the wrong athlete — and the server refuses duplicate or concurrent starts outright.

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

**Set Match Status (Blue/Red DNS · DNF · DSQ).** Each button opens a confirmation first — "Record Blue DNF for [Name]? Red advances." When judge points already exist on the match, the confirmation escalates and shows the points state (e.g. "5 judges have scored this match (Red leads 18–7)"), with the strongest red warning when the ruling contradicts the points winner. The Head Judge's ruling has final say and stays possible even with all five judges scored; every manual ruling is audit-logged with the points state at the time. Once a match is complete and the bracket has advanced, the tablet can no longer change it — post-completion changes go through the operator's **Edit Scores** path on the Scoring tab.

For the FS-18 landing zone (chop) rule (only when the meet's Advanced settings enable it — off by default), the dual HJ view adds:

- an **NJ (Past Chop)** panel with per-athlete Set/Clear toggles (with confirmation) — the Air Judge normally makes the call, but the HJ can set it on close calls or clear a mistaken one;
- a **persistent amber banner** while a call is active, describing the speed override (e.g. "Speed override active: Blue 0 / Red 5" or "Speed tied at 3 / 3");
- **raw vs effective values** in the judge grid — the Time Judge's recorded entry is shown with the overridden value beside it (e.g. `4 / 1 → 0 / 5 (NJ)`; a time-tied entry shows `Time Tied → 3 / 3`; an air-tied entry shows `Air Tied (0 / 0 — votes withheld)`).

Approving the match certifies the NJ finding along with the scores; the call locks at approval. Clearing a finding needs no score restoration — the Time Judge's untouched entry simply governs again. Rejecting the Time Judge's entry (or an air-tied Air Judge entry) also clears the Overall Judge, since their point scale depends on the tie state.

### High-contrast mode

HC Mode button top-right. See [High-contrast (HC) mode](./tablet-hc).
