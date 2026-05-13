## Aerials Judge tablet

The Aerials Judge tablet (v2 model, used by every aerials event from v1.18.00 onward) lets one numbered judge enter **Air, Form, and Landing** for **every jump** of every athlete. Each judge has their own tablet URL and their own panel slot.

### Opening

The URL pattern is `/aerials-judge/<event-short>/<judge-short>`, taken from the event's **Links** tab. Each `AeJudge1..N` row has its own short code.

> The legacy URL pattern `/aerials-judge/<event-short>` (no judge short) still loads — that's the legacy aerials judge view for pre-v1.18.00 events. New events all use the per-judge URL.

### Layout

- **AthleteBar** (top) — bib, name.
- **Jump 1 panel** (left half) — three components stacked:
  - **Air** (0.0–2.0)
  - **Form** (0.0–5.0)
  - **Landing** (0.0–3.0)
- **Jump 2 panel** (right half) — same components.
- **Jump code chips** (top of each panel) — show the code the operator entered for that jump. Read-only on the aerials judge tablet (the code comes from the chief of score, not the judges).

### Entering scores

For each component:

1. Tap a value on the quick-pick grid (0.1 increments for Air, 0.5 for Form, 0.2 for Landing — varies by version).
2. Use fine-tune `+/−` for off-grid precision.

You can enter Jump 1 and Jump 2 in either order. The submit button is enabled once every cell has a value.

### Submitting

Two-step:

- **Submit Jump 1** — sends Jump 1's Air / Form / Landing.
- **Submit Jump 2** — sends Jump 2's.

OR a single **Submit Both** button (when both jumps are filled).

After submission, your three values per jump are locked. If the HJ rejects, the tablet returns to entry mode with values cleared.

### Reduction rule (server-side)

After every judge submits, the server applies the reduction:

- **5+ judge FIS panels** — drop high + low per component independently, sum the kept three (or middle four/five for 6/7-judge).
- **2–4 judge USA panels** — operator-selected method (`sum_all`, `drop_high`, `drop_low`, `average`).

The judge tablet shows your raw input, not the reduced total — that's the HJ's view.

### HJ may score

For USA Regional events with HJ-may-score enabled, the HJ tablet shows their own row in the panel grid alongside the AeJudge1..N rows. The HJ enters Air/Form/Landing per jump in addition to approving the whole athlete.

### Why per-judge-per-jump

Pre-v1.18.00 aerials used component-specific judge roles (`AirJudge1` only entered Air, etc.). That was inconsistent with FIS JH 6004 / USSS 4110, which states every scoring judge evaluates all three components. The v2 redesign brings the model into compliance.

### Reference

A small reference panel shows score range hints for each component:
- **Air** — height + distance off the kicker
- **Form** — body position, control, takeoff
- **Landing** — body angle, posture, impact absorption

### High-contrast mode

HC Mode button top-right. See [High-contrast (HC) mode](./tablet-hc).
