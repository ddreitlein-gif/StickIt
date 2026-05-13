## Tie-break rules

When two athletes have the same total score, StickIt applies a strict tie-break ordering per the FIS / USSS rule books. The tie-break is applied at every read site (Results tab, Scoreboard, PDFs, CSV exports, USSS transmit XML) so all surfaces stay consistent.

### Mogul — FIS ICR 4207.3

1. **Total** — higher total wins.
2. **Turns** — higher turns score wins.
3. **Air-no-DD** — higher raw air execution score wins. (This is the per-judge air mean per jump, summed, with no DD multiplication — stored on `runs.air_score_no_dd`.)
4. **Speed** — higher speed score wins.

All comparisons use 0.001 epsilon to handle floating-point drift.

### Aerials — USSS 4110.4.3

1. **Total**
2. **Air-no-DD**
3. **Form**
4. **Landing**

Form and Landing are summed across jumps. For events created at or after v1.18.00 (v2 model), per-jump Form/Landing are available; for legacy events, the single Form/Landing per run is used.

### Dual mogul

Dual mogul uses head-to-head match wins, not score totals. Ties within a 5-judge match are resolved by individual judge components (Turns, Air, Time, Overall) per FIS dual mogul rules. There's no "total" tie to break at the event level.

### Olympic-style skip rank

Per FIS ICR 4207.3.4: when athletes tie at the unbreakable level (every step of the tie-break sequence is equal), they **share a rank**. The next rank then skips by the size of the tied group:

| Place | Athlete | Total | Turns | Air-no-DD | Speed |
|---:|---|---:|---:|---:|---:|
| 1 | Alice | 78.45 | 55.0 | 12.5 | 11.0 |
| 2 | Bob | 76.20 | 52.0 | 12.0 | 12.20 |
| 3 | Carol | 75.10 | 50.0 | 13.0 | 12.10 |
| 3 | Daniel | 75.10 | 50.0 | 13.0 | 12.10 |
| 5 | Edward | 74.00 | 49.0 | 12.5 | 12.50 |

Carol and Daniel tie at every level. Both get rank 3. Edward is rank **5**, not rank 4 — the rank skips to account for the two-way tie.

### Cut-line tie expansion

When a tied rank straddles a cut line (e.g., qualifier → finals cut at 16 athletes, but ranks 16 and 17 are tied), **all** tied athletes advance. The field expands as needed. See [Multi-phase events](./events-phases) for details on how this affects phase creation.

### Best-run selection (Best of 2)

For Best of 2, if both runs total to the same score, StickIt picks the FIS-stronger run via the same tie-break sequence (Total → Turns → Air-no-DD → Speed). This affects which run is starred as the athlete's best in the Results tab and which run's component scores are used for the athlete's ranking.

### Persisting `air_score_no_dd`

The pre-DD raw air execution score is computed automatically when each run is finalized:

```
air_score_no_dd = avg(per-judge air for jump 1) + avg(per-judge air for jump 2)
```

floored to 2dp. Single-jump events double the one jump's average.

A startup backfill (`backfillAirScoreNoDd`) populates the column for any pre-v1.16.23 runs that don't have it. Manually-entered runs missing per-judge data fall back to `air_score` (post-DD) for the comparison only.

### Why this matters

A poorly-implemented tie-break can swap places at the top of a podium. StickIt's tie-break runs at every results read site, not just the final PDF generation — so live scoreboards and broadcast overlays show the same order the TD will see in the official results.
