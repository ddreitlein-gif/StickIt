## Jump codes & DDs

Each freestyle jump has a **code** and a **Degree of Difficulty (DD)** multiplier. The DD is used to multiply the air judges' raw score. Different disciplines (mogul, dual mogul, aerials) use different DD charts; men and women have separate charts too.

### Where to look up DDs

Two places in the app:

1. **Officials sidebar → Jump DDs** — opens a modal listing DDs for the selected discipline + gender (filter dropdowns at the top).
2. **Air Judge tablet** — each picked code shows its DD in the AthleteBar.

### Mogul DD chart (USSS / FIS)

The chart is based on:

- **Base value** by spin family (Single 0.40/0.50, Double 0.53/0.63, Triple 0.65/0.75, Quad 0.76/0.86, Quint 0.86/0.96 — men/women), per the FIS *Mogul Basic Degree of Difficulty and Common Combinations* chart, **As of 07.11.26** (adopted for U.S. domestic events November 23, 2026; StickIt v2.8.04). The 2027 Competition Guide, Appendix D, still links the November 2023 chart; the 07.11.26 chart differs from it only in the twisting flips and the grabs (below).
- **Modifiers per letter** added to the base:
  - `T` (twist) → -0.02
  - `S` (spread) → -0.02
  - `D` (daffy) → +0.01
  - `X` (X-out) → +0.01
  - `Y` (y-spread) → +0.01
  - `M`, `K` → +0.01 each
  - `Z` → 0
  - `g` (basic grab) → +0.05
  - `G` (advanced grab) → +0.12

### Basic vs advanced grabs (v1.26.00 — Big G / Little G rule)

The Moguls Sub-Committee adopted the **Big G / Little G** grab-scoring rule for domestic events (August 20, 2026 minutes). StickIt distinguishes a **basic grab** (lowercase `g`) from an **advanced grab** (uppercase `G`). `bg` and `bG` are **different jumps with different DDs**, so jump-code entry is case-exact.

**The modifier values are confirmed.** StickIt carries `g` = +0.05 and `G` = +0.12 (the November 2023 chart had a single grab at +0.14). Both values are published in the FIS chart As of 07.11.26 (basic grab `g` 0.05, advanced grab `G` 0.12), and the FIS Judging Handbook (November 2026), Appendix A item 7, defines basic and advanced grabs and lists the grabs in each class. Examples (men / women):

| Code | DD (M / F) | What it is |
|---|---|---|
| `3g` | 0.73 / 0.83 | 360 with basic grab |
| `3G` | 0.80 / 0.90 | 360 with advanced grab |
| `bg` | 0.73 / 0.83 | Back flip with basic grab |
| `bG` | 0.80 / 0.90 | Back flip with advanced grab |
| `g` | 0.45 / 0.55 | Stand-alone basic grab |
| `G` | 0.52 / 0.62 | Stand-alone advanced grab |

Because only identical codes are repeats under USSS 4210.2.1, `bg` and `bG` are **not** repeats of each other. The FIS Moguls Advisory Group will conduct a full DD chart review at the start of the quad; these values implement the approved FS-13 modifiers. There is no DD editor in StickIt — the Jump DDs window is read-only — so a change to the chart is made in a software release.

Common codes and their DDs (men / women):

| Code | DD (M / F) | What it is |
|---|---|---|
| `S` | 0.38 / 0.48 | Single spread |
| `T` | 0.38 / 0.48 | Single twister |
| `TS` | 0.49 / 0.59 | Twister-spread |
| `TT` | 0.49 / 0.59 | Double twister |
| `TD` | 0.52 / 0.62 | Twister-daffy |
| `TTS` | 0.59 / 0.69 | Triple: twister-twister-spread |
| `3` | 0.68 / 0.78 | 360 |
| `3p` | 0.71 / 0.81 | 360 with position |
| `7op` | 0.88 / 0.98 | Off-axis 720 with position |
| `bT` / `bP` | 0.68 / 0.78 | Back tuck / back pike |
| `bL` | 0.71 / 0.81 | Back layout |
| `bp` | 0.71 / 0.81 | Back flip with position |
| `bF` / `fF` | 0.90 / 1.00 | Back full / front full |
| `bdF` / `fdF` | 1.09 / 1.19 | Back / front double full |
| `btF` / `ftF` | 1.28 / 1.38 | Back / front triple full |

**Twisting flips, v2.8.04.** The 07.11.26 chart raised the full (`bF`, `fF`) from 0.88 / 0.98 to 0.90 / 1.00, the back double full (`bdF`) from 1.05 / 1.15 to 1.09 / 1.19 and the back triple full (`btF`) from 1.22 / 1.32 to 1.28 / 1.38, and added the front double full (`fdF`) and front triple full (`ftF`). Every other code is unchanged. Runs scored before the update keep the DD they were scored with.

The full chart is seeded into the `jump_dd_table` database on server boot, and a startup migration brings an existing database up to the current chart (v1.16.08 upright corrections, v1.26.00 grabs, v2.8.04 twisting flips). A venue server receives the cloud's chart when it adopts a meet.

### Aerials DD chart (USSS Appendix C)

A separate chart for aerials, sourced from the 2026 USSS Freestyle Competition Guide page 99. 29 base entries plus 42 spin-family combinations programmatically expanded.

Key examples:

| Code | DD |
|---|---|
| `S` | 1.48 |
| `D` | varies |
| `T` | varies |
| `bL` | 2.05 |
| `bF` | 2.30 |
| `bFF` | 3.15 |
| `bdFF` | 3.525 |

### Dual mogul DDs

Dual mogul uses the **mogul chart × 1.25**. The modal labels this clearly: "Dual Mogul (x1.25 applied)".

### Per-jump scoring

For mogul (v1.24.00, per FIS JH 6203.2.2 / 6204.3):
- Each air judge enters a per-jump raw score (0–10).
- The judges' raw scores are averaged per jump, truncated to 2 decimals, then multiplied by the DD.
- Each jump is capped at 10.0 points.
- Summed across jumps (or doubled for 1-jump events), capped at the 20-point air max per FIS JH 6204.

For aerials (v2):
- Each scoring judge enters Air, Form, Landing per jump.
- Reduction (drop high+low or operator-selected) applied per component per jump.
- `floor((sumKept(Air) + sumKept(Form) + sumKept(Landing)) × DD, 2dp)` per jump.
- Summed across jumps.

### Where DDs come from

The `jump_dd_table` rows are seeded on server boot (`seedDualMogulDDs`, `seedAerialsDDs`, `seedJumpDDs` for moguls). A sentinel check on startup detects stale charts and re-seeds if needed (e.g., the v1.16.08 mogul fix, the v1.18.02 aerials chart correction or the v2.8.04 FIS 07.11.26 update).

### Calling the API directly

`GET /api/jump-dds?ruleset=uss&discipline=mogul&gender=M` returns the full chart as JSON. Used by the Officials sidebar's Jump DDs modal and by the voice modal's jump code validation.
