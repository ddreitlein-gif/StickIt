## Aerials event setup

The aerials judging model added in v1.18.00 (called "v2" internally) is per-judge-per-jump: every scoring judge enters Air, Form, and Landing for every jump. Per FIS Judging Handbook 6004 / USSS 4110.

> Aerials events created **before** v1.18.00 use the legacy "component-specific judge roles" model and are read-only for historical results. New aerials events all use v2.

### Picking the right Event Type

The Add Event modal's Category dropdown for aerials lists five Event Types. Each one drives the panel-size range and the HJ-may-score rule.

| Event Type | Panel Size | HJ may score? |
|---|---:|:---|
| **FIS OWG/WSC/WC** | 5–7 | No |
| **FIS NAC/NorAm** | 5–7 | No |
| **FIS Other** | 5 (locked) | No |
| **USA National** | 2–5 | No |
| **USA Regional (default)** | 2–5 | Yes |

Pick the one matching your sanction document.

### Panel size

After saving the event, set **Aerials Panel Size** on the Setup tab. This is the number of scoring judges (does not include the HJ unless the event type is USA Regional with HJ-may-score enabled).

- **5+ judges (FIS standard):** drop the high and the low per component independently, then sum the kept three (or middle four/five for 6/7-judge panels). Reduction method is fixed.
- **2–4 judges (USA reduced panels):** the **Reduction Method** dropdown becomes available. Pick one:
  - **Sum All** (default) — no drops, sum every judge's score.
  - **Drop High** — drop the highest, sum the rest.
  - **Drop Low** — drop the lowest, sum the rest.
  - **Average** — sum and divide by judge count.

The reduction method prints on the calculation report so the TD can verify.

### Per-jump scoring

Each scoring judge submits per jump:

- **Air** — 0.0 to 2.0
- **Form** — 0.0 to 5.0
- **Landing** — 0.0 to 3.0

Per jump:
```
total_judges_score  =  sumKept(Air) + sumKept(Form) + sumKept(Landing)
jump_score          =  floor(total_judges_score × DD, 2dp)
event_total         =  sum across jumps
```

DD comes from the USSS Appendix C aerials chart (see [Jump codes & DDs](./ref-jump-dds)).

### Seeding the panel

Once the panel size is set, go to the **Setup** tab and click **Seed N-Judge Aerials Panel**. This wipes any existing aerials judges and creates `N` rows with role `AeJudge1..N`, fresh short codes, and `judge_number = 1..N`. Then generate tablet URLs from the **Links** tab — see [Seeding an aerials panel](./judges-seed-aerials).

### Tie-break

Per USSS 4110.4.3: Total → Air-no-DD → Form → Landing.

### Why "v2"

Pre-v1.18.00 events used per-component judge roles (`AirJudge1`, `FormJudge1`, `LandingJudge1`) where each judge entered only one component. The v2 redesign brings the model into compliance with the rule books — every scoring judge evaluates all three components per jump.
