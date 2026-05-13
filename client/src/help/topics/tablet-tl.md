## T&L Judge tablet

The T&L (Turns & Line) judge tablet is opened by going to the URL on the event's **Links** tab (e.g., `/judge/<event-short>/<judge-short>`). One judge per tablet; the URL is tied to a specific judge role (`TL1`, `TL2`, or `TL3`).

### Layout

- **AthleteBar** (top) — bib, name, run number, jump codes for the current athlete.
- **Score panel** (center) — components or single raw score, depending on event setup.
- **Reference sidebar** (right, 260px wide) — colored badges for "Excellent / Good / Adequate / Poor" with score ranges, so the judge can sanity-check their pick.
- **Run history** (bottom) — your recent submissions for this event, for self-reference.

### Component scoring (Comp Series default)

Three columns of score buttons:

1. **Carving** (0–10) — 0.1 increments, color-zoned. Quick reference: 8.1–10 Excellent, 6.1–8 Good, 4.1–6 Adequate, 0.1–4 Poor.
2. **Absorption / Extension** (0–5) — same color zones, 0–5 scale.
3. **Upper Body** (0–5) — same.

Then a **Deduction** pad with five preset values: `0.1`, `0.5`, `1.0`, `1.6`, `6.0`. Plus a **Manual entry** button for custom deductions.

Computed total = `Carving + Absorption + Upper Body − Deduction`, clamped 0.1–20. Displayed live as you tap.

### Non-component scoring (RQS-EQS)

Two columns:

1. **Raw Score** (0–20) — 4×11 grid of 0.5-increment buttons.
2. **Deduction** — same pad as component mode.

Total = `Raw − Deduction`, clamped 0.1–20.

### Fine tune

Below each score column is a fine-tune row: `−0.1 / current value / +0.1`. Tap to nudge the picked score by a tenth in either direction.

### Submitting

Once you've picked Carving / Absorption / Upper Body / Deduction (or Raw / Deduction in non-component mode), tap **Submit Score** at the bottom. The score is sent to the server. The button greens out as **Score Submitted** until the HJ approves or rejects.

### If rejected

If the HJ rejects your submission, the tablet flips back to the score-entry state with your previous values cleared. Enter new values and re-submit.

### If approved

Once approved by the HJ, your tablet shows **Score Approved** for a few seconds, then advances to the next athlete.

### Self-review

The bottom of the tablet shows your last 5 submissions for the event. Useful for "wait, what did I just score?" moments.

### Pin lock

If a PIN was set when the judge was added ([Adding & assigning judges](./judges-add)), the tablet asks for the PIN on first open. Cached locally for the day.

### What you can't do

- Reject your own submission — only the HJ can reject.
- See other judges' scores — only the HJ tablet sees the full panel.
- Change a previously-finalized score — only the chief of score can, via [Editing a finalized score](./scoring-edit).

### High-contrast mode

Tap the HC Mode button (top-right) to switch to black/white/amber tokens for outdoor / bright-light visibility. See [High-contrast (HC) mode](./tablet-hc).
