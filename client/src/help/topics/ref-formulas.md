## Scoring formulas

Every score in StickIt comes from a published FIS / USSS formula. This reference lists them in one place. All values are truncated (floored) to 2 decimals per FIS rule; DDs are preserved at full precision.

### Mogul total

```
total = turns + air + speed
```

Capped at 100.0. Truncated to 2dp.

### Turns (max 60)

**5-judge format (3 counting + 2 reference):** sum the 3 counting T&L judge scores.
**7-judge format (5 counting + 2 reference):** drop high and low, sum the middle 3.

Per FIS JH 6203.

Per-judge total:

**Component scoring on (Comp Series, FIS):**
```
judge_total = clamp(carving + absorption + upper_body − deduction, 0.1, 20)
```

**Component scoring off (RQS-EQS):**
```
judge_total = clamp(raw − deduction, 0.1, 20)
```

### Air (max 20)

```
per_jump_air = sum(floorToHundredth(judge_score × DD)) / num_air_judges
air_total = floorToHundredth(jump1_air + jump2_air)
```

If only 1 jump (Devo), double the single-jump value:
```
air_total = floorToHundredth(2 × per_jump_air)
```

Capped at 20.0. Single-jump-in-2-jump-event capped at 10 per USSS 4210.2.2.

Per FIS JH 6204.

### Air-no-DD (tie-break only)

```
air_no_dd = avg(per-judge air raw, jump 1) + avg(per-judge air raw, jump 2)
```

Floored to 2dp. Single-jump events double the one jump's mean. No DD, no cap. Used in mogul and aerials tie-break per FIS ICR 4207.3 and USSS 4110.4.3.

### Speed (max 20)

```
speed = max(0, 48 − 32 × (run_time / pace_time))
```

Floored to 2dp. Capped at 20.0. Per USSS / FIS ICR 4206.3.

If `run_time <= 0` (e.g., NT sentinel `-1`), speed = 0.

### Pace time

```
pace_time = floor(course_length / pace_speed, 2dp)
```

Pace speeds by standard:
- USSS: Men 9.70 m/s, Women 8.20 m/s
- FIS: Men 10.30 m/s, Women 9.00 m/s

Per USSS 9.70 / 8.20 m/s; FIS 10.30 / 9.00 m/s.

### Aerials v2 (per jump)

```
total_judges_score = sumKept(Air) + sumKept(Form) + sumKept(Landing)
jump_score = floor(total_judges_score × DD, 2dp)
event_total = sum across jumps (floored to 2dp)
```

Reduction:
- 5+ judges → drop high + low per component independently
- 2–4 judges → operator's choice: `sum_all` / `drop_high` / `drop_low` / `average`

Per FIS JH 6004 / USSS 4110.

### Aerials legacy (pre-v1.18.00)

Single Form / Landing per run, Air-only DD multiplication. Not used for new events. Historical results render unchanged.

### Dual mogul (5-point split)

Each judge awards 5 points split between blue and red (e.g., `4–1`). Match winner = athlete with majority across the 5 judges.

Tie-break per FIS:
- Components: Turns, Air, Time, Overall (judge role determines weight)
- Then re-ski if still tied

Tournament placement via `server/dual/placement.js` (band-based randomization for seeded brackets).

### Manual time calculation

```
total_time = top_time + bottom_time
```

Used when no full-course timer is available. The bottom/top times are summed and treated as the run time in the speed formula.

### FFSP (dual mogul only)

```
tier = is_divisional → [1000, 970, 950]
     : CC ≥ 15      → [900, 875, 855]
     : CC < 15      → [800, 775, 760]

points(1) = tier[0]
points(2) = tier[1]
points(3) = tier[2]
points(n) = max(0, tier[2] − (n − 3) × (tier[2] / CC))   for n ≥ 4
```

DNS / DSQ / scratched → 0 points, excluded from CC. First-round DNF → 0 points.

### Mogul tie-break (FIS ICR 4207.3)

1. Total
2. Turns
3. Air-no-DD
4. Speed

Each compared with 0.001 epsilon. Ties at all four levels → shared rank with Olympic-style skip.

### Aerials tie-break (USSS 4110.4.3)

1. Total
2. Air-no-DD
3. Form
4. Landing

Same epsilon and skip-rank rule.

### Truncation rule

All published numeric values are **floored** to 2 decimals. This applies to:

- `runs.total_score`
- `runs.turns_score`
- `runs.air_score`, `runs.air_score_no_dd`
- `runs.speed_score`
- per-jump air values
- speed score from a course-length recompute
- pace time

DDs are preserved at full precision.
