## Categories & divisions explained

The Category dropdown in the Add Event modal does two things: it sets sane judging defaults and (for aerials) it picks the sanction tier that controls panel rules. Pick wrong and you'll spend the morning fighting the defaults.

### Mogul / Dual Mogul categories

| Category | Default config | Use for |
|---|---|---|
| **Comp Series** | 3 T&L + 2 Air judges, 2 jumps, time on, component scoring on | All standard USSS competitions; most divisional / regional events |
| **Devo** | 2 T&L + 1 Air judges, 1 jump, **no time** | Development events, U7–U13 grassroots; faster scoring, fewer fields |
| **RQS-EQS** | 2 T&L + 1 Air judges, 2 jumps, time on, component scoring **off** | RQS / EQS series — single raw T&L score per judge instead of carving / absorption / upper-body breakdown |
| **FIS** | 3 T&L + 2 Air judges, 2 jumps, time on, component scoring on | FIS-sanctioned (NorAm, World Cup) |

The defaults are just starting points — you can override any field in the Add Event modal or via [Editing an event](./events-edit) before scoring begins.

### Component vs. non-component T&L

When **component scoring is on**, each T&L judge enters four values per run:
- **Carving** (0–10)
- **Absorption / Extension** (0–5)
- **Upper Body** (0–5)
- **Deduction** (0–6, common values: 0.1 / 0.5 / 1.0 / 1.6 / 6.0)

Total per judge = `Carving + Absorption + Upper Body − Deduction`, clamped to 0.1–20.

When **component scoring is off** (RQS-EQS), each T&L judge enters two values:
- **Raw score** (0–20)
- **Deduction** (0–6)

Total per judge = `Raw − Deduction`, clamped to 0.1–20.

The Turns score (max 60) sums the three counting judge totals (5-judge format) or drops the high+low and sums the middle three (7-judge format), per FIS JH 6203.

### Aerials event types (sanction tier)

| Event Type | Panel Size | HJ may score? |
|---|---:|:---|
| **FIS OWG/WSC/WC** | 5–7 | No |
| **FIS NAC/NorAm** | 5–7 | No |
| **FIS Other** | 5 (locked) | No |
| **USA National** | 2–5 | No |
| **USA Regional (default)** | 2–5 | Yes (HJ counts as a scoring judge) |

These come from FIS Judging Handbook 6004 / USSS 4110. Picking the right event type unlocks the right panel-size range and reduction-method dropdown. See [Aerials event setup](./events-aerials).

### Why this matters for results

Categories don't change the scoring math itself — but they change which fields the judges enter and how many judges score per run. Changing category mid-meet would invalidate any runs already submitted, which is why [Editing an event](./events-edit) refuses structural changes once scoring begins.
