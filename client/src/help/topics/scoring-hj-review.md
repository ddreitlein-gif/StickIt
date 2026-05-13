## Head Judge review & approval

The Head Judge tablet is the central review point in the live scoring flow. Once every required judge has submitted, the HJ tablet shows the full computed score and waits for explicit approval before finalizing.

### What the HJ sees during a run

Top of screen:
- **AthleteBar** — bib, name, club, current run number / phase.
- **Status squares** — three indicators showing T&L Judges (`3/3`), Air Judges (`2/2`), Time (`✓`). Green when complete, gray when pending.
- **HC Mode toggle** — switch to high-contrast view.

Center of screen, during pending state:
- **Per-judge review rows** — one row per judge with score, jump codes (Air judges), and a small **Reject** button.

Bottom of screen:
- **Run Status grid** — four large buttons: DNS, DNF, RNS, DSQ. Each opens a confirmation dialog before submitting (see [Run statuses](./scoring-statuses)).

### Once all judges have submitted

The center of the screen switches to:
- **Calculated score panel** — Turns, Air, Speed (or Time Points), Total. All values match exactly what will be persisted on approval.
- **Approve & Submit** button — green, large, bottom-of-screen.
- **Send Back to Scoring** button — amber, opens the run back to specific-judge rejection.

### Rejecting a single judge's submission

Click the **Reject** button next to a single judge's row. A confirm dialog appears:

> Reject TL1's submission and ask for re-entry?

Confirm to clear that judge's score from the database. The judge's tablet sees the rejection on its next poll cycle (or via the live WebSocket message) and resets to the score-entry state with their previously-submitted value cleared. The HJ tablet returns to the pending state.

This is the surgical tool — used when one judge entered the wrong score but everyone else is fine.

### Sending the whole run back

Less surgical. Useful when multiple judges need to re-enter, or when a fundamental error (wrong athlete bib showing on tablets) requires a full reset. Clicking **Send Back to Scoring** clears the runs row's HJ-pending status; the Scoring tab gains an "Edit Scores" affordance and the operator can adjust there.

### Clear codes (Air judge mismatch)

If the two Air judges submitted different jump codes for the same jump, the server raises HTTP 409 ("Jump codes differ from the other Air Judge. Contact the Head Judge to resolve."). On the HJ tablet's Air judge row, a **Clear Codes** link appears. Clicking it:

1. Nulls out `jump1_code` / `jump2_code` on the run.
2. Deletes all air judge `judge_scores` rows for the run.
3. Triggers a rejection on both Air judges' tablets so they re-enter codes + scores from scratch.

The Air judges then re-coordinate codes (verbally) and re-submit.

### Approving

Click **Approve & Submit**. The server:

1. Finalizes the run (`runs.status='complete'`).
2. Computes ranking.
3. Broadcasts `score_update` to officials, public scoreboards, and the overlay.
4. Advances the Scoring tab to the next athlete in run order.

### End of phase

Once every athlete in the phase has been approved, the HJ tablet shows a phase summary card with **Approve Phase** / **Send Back to Scoring** buttons. Approving the phase locks it in `event_phases.status='finalized'`. Sending back re-opens any individual run for re-editing.

### End of event

After the final phase is approved, the HJ tablet shows the **Final Review** screen — a combined results table with **Approve & Finalize Event** and **Send Back to Scoring** buttons. Approve to mark `events.status='complete'`; this is the final lock that ends the live scoring loop.

### Dual mogul HJ flow

For dual mogul, the HJ tablet manages match-by-match approval. After every bracket match is complete, the HJ tablet shows the full bracket tree with **Approve & Finalize Event** and **Send Back to Scoring** buttons. See [Dual mogul setup](./events-dual).
