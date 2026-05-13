## Course specifications

The **Course Specifications** panel on the meet page sets the course length and pace standard. These two values drive every speed-score calculation for every mogul run at the meet.

### What gets stored

Each meet has one course spec record:

- **Course length** — in meters. Measured from the start gate to the finish line.
- **Pace standard** — `USSS` (default) or `FIS`. Determines the pace speeds used to calculate pace time:
  - **USSS** — Men 9.70 m/s, Women 8.20 m/s
  - **FIS** — Men 10.30 m/s, Women 9.00 m/s
- **Pace time (men)** and **pace time (women)** — computed automatically as `course length / pace speed`, truncated to two decimals per FIS rule.

### Setting it up

1. On the meet detail page, scroll to **Course Specifications**.
2. Enter the course length.
3. Click **USSS** or **FIS** to pick the standard. The pace times update live as you toggle.
4. Click **Save**.

The values then propagate down to every existing event under the meet via `propagatePaceToEvents`. New events created later inherit the meet's spec automatically (`inheritCourseSpec`).

### Per-event overrides

In rare cases an event needs a different pace time — usually because the course was shortened mid-day for weather. Set a per-event `pace_time_override` from the event's Setup tab; that value will be used in the speed-score formula for that event only, ignoring the meet-level pace.

### How speed score uses these values

The mogul speed score formula is:

```
speedScore = max(0, 48 − 32 × (run_time / pace_time))
```

then clamped to the 20-point cap and floored to two decimals. So pace time directly determines the curve. A longer course → larger pace time → easier to hit the 20-point ceiling. A shorter course → smaller pace time → tougher curve.

### When to enter zero-length

If you don't yet know the course length on Day 1 morning, leave the field blank and enter `0`. Speed scores will all calculate to `0.00` until you fill in a real length and click **Save** — at which point every completed run is recomputed via `recalcSpeedScores`. (This rewrites `runs.total_score` for every finalized run, then broadcasts updated standings.)

### Pace standard choice

Use **USSS** for any USSS-sanctioned event. Switch to **FIS** only for FIS-sanctioned competitions (NorAm, World Cup, etc.). The choice is preserved per meet and printed on the calculation report so the TD can verify.
