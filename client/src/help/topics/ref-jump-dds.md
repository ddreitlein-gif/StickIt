## Jump codes & DDs

Each freestyle jump has a **code** and a **Degree of Difficulty (DD)** multiplier. The DD is used to multiply the air judges' raw score. Different disciplines (mogul, dual mogul, aerials) use different DD charts; men and women have separate charts too.

### Where to look up DDs

Two places in the app:

1. **Officials sidebar → Information → Jump DDs** — opens a modal listing DDs for the selected discipline + gender (filter dropdowns at the top).
2. **Air Judge tablet** — each picked code shows its DD in the AthleteBar.

### Mogul DD chart (USSS / FIS)

The chart is based on:

- **Base value** by spin family (Single 0.40/0.50, Double 0.53/0.63, Triple 0.66/0.76, Quad 0.79/0.89, Quint 0.92/1.02 — men/women).
- **Modifiers per letter** added to the base:
  - `T` (twist) → -0.02
  - `S` (spread) → -0.02
  - `D` (daffy) → +0.01
  - `X` (X-out) → +0.01
  - `Y` (y-spread) → +0.01
  - `M`, `K` → +0.01 each
  - `Z` → 0

Common codes and their DDs (men / women):

| Code | DD (M / F) | What it is |
|---|---|---|
| `S` | 0.38 / 0.48 | Single spread |
| `T` | 0.38 / 0.48 | Single twist |
| `TS` | 0.49 / 0.59 | Double twist with spread |
| `TT` | 0.49 / 0.59 | Double twist (helicopter, 720) |
| `TD` | 0.52 / 0.62 | Double twist with daffy |
| `TTS` | 0.62 / 0.72 | Triple twist with spread |
| `3` | various | Triple twist (1080) |
| `3p` | various | Triple twist position (varies) |
| `bp` | varies | Back layout position (back family) |
| `bT` | varies | Back twist |
| `bL` | varies | Back layout |
| `bF` | varies | Back full (back tuck flip) |

The full chart is seeded into the `jump_dd_table` database on server boot. v1.16.08 corrected several values; if your server pre-dates that, a startup migration auto-corrects.

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

For mogul:
- Each air judge enters a per-jump raw score (0–10).
- The server computes: `floorToHundredth(raw × DD)` per judge per jump.
- Averaged across air judges per jump.
- Summed across jumps (or doubled for 1-jump events).
- Capped at the 20-point air max per FIS JH 6204.

This matches Winfree's calculation order (v1.16.09).

For aerials (v2):
- Each scoring judge enters Air, Form, Landing per jump.
- Reduction (drop high+low or operator-selected) applied per component per jump.
- `floor((sumKept(Air) + sumKept(Form) + sumKept(Landing)) × DD, 2dp)` per jump.
- Summed across jumps.

### Where DDs come from

The `jump_dd_table` rows are seeded on server boot (`seedDualMogulDDs`, `seedAerialsDDs`, `seedJumpDDs` for moguls). A sentinel check on startup detects stale charts and re-seeds if needed (e.g., the v1.16.08 mogul fix or the v1.18.02 aerials chart correction).

### Calling the API directly

`GET /api/jump-dds?ruleset=uss&discipline=mogul&gender=M` returns the full chart as JSON. Used by the Officials sidebar's Jump DDs modal and by the voice modal's jump code validation.
