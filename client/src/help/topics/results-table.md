## Reading the results table

The **Results** tab on the event detail page shows the live, sortable ranking for the event. It updates automatically as runs are finalized. The layout varies by event type (single run, Best of 2, qualifier/finals, dual mogul).

### Standard mogul columns

| Column | Meaning |
|---|---|
| **Place** | Rank (Olympic-style skip rank — see [Tie-break rules](./results-tiebreak)) |
| **Bib** | Athlete's bib for this event |
| **Athlete** | `Last, First` |
| **Club** | Club abbreviation |
| **Turns** | Turns score component (max 60) |
| **Air** | Air score component (max 20, post-DD) |
| **Time** | Run time in seconds (or `NT` / `DNS` / `DNF` / `DSQ`) |
| **Speed** | Speed score component (max 20) |
| **Total** | Sum: Turns + Air + Speed (max 100) |

Click any column header to sort. Default sort is by **Place** ascending.

### Best of 2 columns

For Best of 2 events, an additional column structure:

| Column | Meaning |
|---|---|
| **Run 1** | Total for Run 1 |
| **Run 2** | Total for Run 2 |
| **Best** | The higher of the two (the official score) |
| **Place** | Rank by Best |

The starred run is the athlete's better run. If editing changes which run is better, the star moves automatically (FIS-compliant `pickBestRun` is applied at every read site).

### Qualifier/Finals columns

| Column | Meaning |
|---|---|
| **Q1** | Qualifier 1 total |
| **F1** | Final 1 total |
| **F2** | Final 2 total (if configured) |
| **Place** | Final rank — Olympic-style skip with tiered ranking (F2 > F1 > Q1) |

Athletes who didn't make the cut to F1 are ranked by Q1 standings below those who did.

### Aerials columns

| Column | Meaning |
|---|---|
| **Jump 1** | Jump 1 score (per-judge sum × DD, floored to 2dp) |
| **Jump 2** | Jump 2 score |
| **Air-no-DD** | Raw air execution score (sum of Air component means per jump, no DD) |
| **Form** | Form component total |
| **Landing** | Landing component total |
| **Total** | Sum across jumps |

For v2 aerials events. Legacy aerials events use a different column set.

### Dual mogul

Dual mogul shows a **bracket view** instead of a flat table. See the [Reading a Scoreboard](./public-scoreboard) topic for the spectator-facing version; the Results tab's bracket is essentially the same.

### Status text in score columns

DNS / DNF / DSQ runs show their status text in the **Total** column (and in per-phase columns for multi-phase events). Component columns (Turns, Air, Speed, Time) remain blank for those rows. See [Run statuses](./scoring-statuses).

### Click-to-expand

For mogul events, clicking an athlete row reveals a per-run detail row showing per-judge breakdowns:

```
Run 1: TL1 5.5  TL2 4.5  TL3 1.2  S/bp  A1 3.4  A2 4.5  T: 23.23  TPt: 16.3  Total: 56.23
```

Click another row to switch; click the same row to collapse. (This is the same UX as the public scoreboard's expand.)

### Live updates

The Results tab listens for WebSocket `score_update` messages and re-fetches the standings on every new finalized run. There's no need to refresh the browser.

### Printing

Use the PDF buttons in the Results tab header to generate the Event Results Summary PDF — see [PDF reports](./reports-pdf).
