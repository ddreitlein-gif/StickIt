## Air Judge tablet

The Air judge tablet handles jump codes and per-jump air scores. Open via the URL on the event's **Links** tab (`/judge/<event-short>/<judge-short>` — same path as T&L; the role on the judge record determines the UI shown).

### Layout (single-screen, two-column)

- **AthleteBar** (top) — bib, name, run number; small multi-line jump chips on the right.
- **Left column** — Jump 1 code grid + Jump 1 score grid.
- **Right column** — Jump 2 code grid + Jump 2 score grid.
- **Reference sidebar** (260px) — score range reference.

Both jumps render side-by-side so the judge can fill code/score in any order, then submit both together. Devo events (1 jump) render only the left column full-width.

### Jump code grid

A quick-pick grid of frequently-used codes (three rows for Comp Series, 7×2 for Devo/RQS) plus an "All codes" dropdown for the long tail.

- **Comp Series defaults (three rows of six, v2.3.00):** `N, S, T, K, TS, 3` · `bT, bp, bL, bG, bg, bF` · `7op, 7oG, 7og` + No Jump. `bg` and `7og` are the basic-grab codes (lowercase g).
- **Devo / RQS defaults:** `S, T, D, X, K, TS, TT, TD, TTS, 3, 3p`
- **No-Jump button** — for jumps where the athlete didn't attempt one (rare; usually a fall after takeoff).

Dropdown lets you pick any code from the full chart. Filters work — type `b` to show all back-family codes.

### Score grid

Mixed-step grid for air scores: `0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0, 9.5, 10.0`. The 1.0-increment chunk is for low scores; the 0.5-increment chunk for higher scores where precision matters more.

Selection anchor: when fine-tuning drifts the value off-grid (e.g., 7.3), the nearest anchor on the grid is highlighted so the UI stays comprehensible.

### Fine tune

Same `−0.1 / value / +0.1` row as the T&L tablet. Drift one tenth at a time.

### Submitting

Tap **Submit Score** at the bottom. The submit handler first sends the codes (`PUT /runs/:id` with `jump1_code`/`jump2_code`), then posts the scores. The first Air judge to submit sets the run's official codes.

### Jump code mismatch (v2.3.00)

If your codes differ from the other Air judge's (compared **exactly**, including case — `bG` and `bg` are different jumps with different DDs), your scores are still recorded. The run keeps the first judge's codes for the moment, and the **Score Submitted** screen on **both** Air judge tablets shows a prominent red warning:

> WARNING — JUMP CODES DO NOT MATCH. Please see the Head Judge to reconcile.

Nothing is lost and nothing needs re-entering yet. The Head Judge's tablet shows a **Jump Code Mismatch** box listing each Air judge's codes, and resolves it one of two ways:

| HJ action | What you see |
|---|---|
| **Accept These Codes** (one judge's pair) | The warning is replaced by **Air Codes Reconciled by Head Judge** with the accepted codes. Both judges' scores stand and are scored against the accepted codes' DDs. |
| **Reject Both Codes** | Both Air judges' codes and scores are cleared; your tablet returns to code entry (the usual rejected-score flow). Agree on the codes and resubmit. |

The run cannot be finalized while a mismatch stands, so there is no risk of the wrong DD being published.

### Per-judge codes

Each Air judge picks codes from scratch — no pre-select. If both Air judges agree, the codes match server-side and the run proceeds. If they disagree, the mismatch goes to the Head Judge as described above.

### DD reference

Each picked code shows its DD next to the chip in the AthleteBar (`Jump 1: TS · 0.49`). For unfamiliar codes, refer to [Jump codes & DDs](./ref-jump-dds) on a separate device, or use the Officials sidebar's Jump DDs panel.

### High-contrast mode

HC Mode button top-right. See [High-contrast (HC) mode](./tablet-hc).
