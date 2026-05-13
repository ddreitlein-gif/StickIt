## Run statuses: DNS, DNF, DSQ, RNS, NT

Beyond a numeric score, every run can have a **status** indicating something didn't go to plan. Statuses are stored on the `runs` row and trigger specific display and ranking behavior.

### The five statuses

| Code | Means | Counted in CC? | FFSP | Tie-break placement |
|---|---|:---:|:---:|---|
| **DNS** | Did Not Start | No | 0 | Excluded from rank |
| **DNF** | Did Not Finish | Yes | Formula or 0 (1st round) | Ranked at bottom of finishers |
| **DSQ** | Disqualified | No | 0 | Excluded from rank |
| **RNS** | Refused to be Scored | Yes | Treated as DNF for points | Ranked at bottom |
| **NT** | No Time (mogul only) | N/A | N/A | Speed score = 0 |

**CC** = Counting Competitors (used for FFSP — see [FFSP points (dual mogul)](./results-ffsp)).

### Where to set each

- **DNS** — yellow "DNS" button on the Up Next athlete row (Scoring tab, HJ tablet, Timekeeper tablet). Confirmation modal appears. Or the Manual Entry modal's "Status Override" picker.
- **DNF** — HJ tablet has a DNF button. Used when the athlete started but didn't finish (fell, missed gate, equipment failure). Confirmation required.
- **DSQ** — HJ tablet has a DSQ button. Used when the athlete is disqualified per TD ruling.
- **RNS** — HJ tablet has an RNS button. Less commonly used; for when the athlete refuses to be scored.
- **NT** — Timekeeper tablet has a red **No Time** button. Confirmation modal appears. Used when no valid time could be recorded but the athlete did finish.

### NT specifics

NT produces a speed score of `0`. Internally stored as `run_time = -1` (sentinel). The scoring engine's `calcSpeedScore` returns 0 for non-positive times. **Finalization proceeds normally** — the run is not blocked waiting for time.

The Time column shows "NT" across all surfaces (Timekeeper, HJ, Scoreboard, EventDetail, PDFs, exports) — never `-1`.

### DNS / DNF / DSQ display

The score column on every surface shows the status text instead of `–` for pending runs. Examples:

- Scoreboard: Total column shows `DNS` / `DNF` / `DSQ` instead of blank.
- Results tab: Total column shows status text.
- PDF reports: Total column shows status text.
- Individual phase columns: Show status text for that run only.

### Component-level display

For DNS / DNF / DSQ athletes, only the **Total** column changes. Component breakdowns (Turns, Air, Speed, Time) stay blank or `–`. This keeps the row visually distinct without spurious zeros polluting the breakdown columns.

### Ranking

- **DNS / DSQ** — excluded from the ranked list entirely (no rank number assigned).
- **DNF** — listed below all finishers, ordered by the original run order.
- **RNS** — same as DNF.

### Re-opening a DNS / DNF / DSQ run

If an athlete was marked DNS but then actually starts (showed up after the bib draw), you can clear the status from the Scoring tab's run history:

1. Open the run's Manual Entry modal.
2. The Status Override picker shows `None` / `DNS` / `DNF` / `DSQ`. Pick `None`.
3. Enter the actual scores.
4. Submit.

Re-opening removes the status, replaces with a numeric score, and re-runs the standings.
