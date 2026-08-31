## Timekeeper tablet

The Timekeeper tablet enters run time after each athlete finishes. URL pattern: `/timekeeper/<event-short>`. One tablet per event (not per judge — only one timekeeper).

### Layout

- **AthleteBar** (top) — bib, name, run number for the currently-scoring athlete.
- **Finish time display** (88px tall, Bebas Neue) — shows the entered time as you type.
- **Custom numpad** — 3×4 calculator-order grid:
  ```
  7 8 9
  4 5 6
  1 2 3
  · 0 ·
  ```
  with **Backspace** inline to the right of the time display (80px wide, red-tint border).
- **Action buttons** below the numpad:
  - **NT** (No Time) — red, left.
  - **Submit Time** — green, flex 2.5, right. ✓ checkmark prefix.
  - **Manual Time Calculation (Top / Bottom Timer)** — amber/orange, below.
- **Right sidebar**:
  - **Next Up** card with athlete + Start Run button (when no athlete is in scoring state).
  - **Previous Times** — list of recent times, color-coded (green for under pace, amber for slower).
  - **Pace Time** box — the meet's pace time, for sanity check.

### Entering time

1. Tap digits on the numpad to build the time as a decimal (e.g., `27.34`).
2. Tap backspace if you mistype.
3. Tap **Submit Time** to send.

The time is associated with the currently-scoring athlete. The server records it on the run row; the HJ tablet shows time complete.

### NT (No Time)

Tap the red **NT** button if no valid time could be recorded but the athlete did finish. A confirmation modal appears:

> Mark [Athlete Name] as No Time?

Confirm to submit. The run gets `run_time = -1` (sentinel); the speed score is set to 0. The Time column on every surface shows "NT". See [Run statuses](./scoring-statuses).

### Manual Time Calculation

For events using a top timer + bottom timer setup (each measuring a portion of the course), tap **Manual Time Calculation (Top / Bottom Timer)** to open a modal:

- Enter the **Top time** (start gate to mid-course)
- Enter the **Bottom time** (mid-course to finish)
- The modal computes total time = top + bottom
- Confirm to submit

Useful when no single full-course timer is available.

### Start Run

When no athlete is currently scoring, the **Next Up** card on the right side shows the next athlete with a blue **Start Run** button + yellow **DNS** button. Tap Start Run to begin scoring that athlete (`runs.status='scoring'` is set, all tablets see the new athlete).

If `score_entry_mode='paper'`, the Start Run button stays visible even mid-scoring (so the timekeeper can start subsequent runs as the operator).

The Start Run and DNS buttons appear only when the meet's Advanced settings allow the Timekeeper to start runs (on by default). Pressing Start Run first re-checks the server's next-up athlete — a card that went stale while the iPad was asleep can never start the wrong athlete — and the server refuses duplicate starts and (in tablet mode) starts while another run is still scoring.

### Age group transition banner

When the next athlete is in a different age group from the just-finished one, an amber banner appears at the top:

> U11 group complete — U13 up next

Auto-dismisses after 15 seconds or on tap. Devo events only.

### Devo events — no time

Devo events have `has_speed=0`, so the timekeeper tablet is **not used**. The event has no Timekeeper role.

### Dual mogul — no timekeeper

Dual mogul has its own dual judge role (`DualTime`) that uses the dual judge tablet, not the timekeeper tablet. The standalone timekeeper tablet is for standard mogul / aerials only.

### Event complete

After all phases are finalized, the tablet shows the full-screen "Event Completed — Thank You for Your Work" message.

### High-contrast mode

HC Mode button top-right. See [High-contrast (HC) mode](./tablet-hc).
