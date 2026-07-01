## Run statuses: DNS, DNF, DSQ, NT

Beyond a numeric score, every run can have a **status** indicating something didn't go to plan. Statuses are stored on the `runs` row and trigger specific display and ranking behavior.

### The statuses

| Code | Means | Counted in CC? | FFSP | Results placement |
|---|---|:---:|:---:|---|
| **DNS** | Did Not Start | No | 0 | Bottom of its tier, after DNF |
| **DNF** | Did Not Finish | Yes | Formula or 0 (1st round) | Bottom of its tier, first among statused |
| **DSQ** | Disqualified | No | 0 | Absolute bottom of the entire event |
| **NT** | No Time (mogul only) | N/A | N/A | Speed score = 0 (run ranks normally) |

**CC** = Counting Competitors (used for FFSP — see [FFSP points (dual mogul)](./results-ffsp)).

**RNS (Refused to be Scored) was retired in v1.26.00.** It was a legacy Winfree convention with no equivalent in the USSS Comp Guide or FIS ICR. It can no longer be assigned, but historical events that contain RNS runs still display them everywhere; a legacy RNS orders between DNF and DNS in results and is transmitted to USSS as DNF.

### Where to set each

- **DNS** — yellow "DNS" button on the Up Next athlete row (Scoring tab, HJ tablet, Timekeeper tablet). Confirmation modal appears. Or the Manual Entry modal's "Status Override" picker.
- **DNF** — HJ tablet has a DNF button. Used when the athlete started but didn't finish (fell, missed gate, equipment failure). Confirmation required. **Gate fault is formally a DNF** (Spring 2026 FIS rule), and a competitor who intentionally re-enters the course after any DNF receives a **DSQ**.
- **DSQ** — HJ tablet has a DSQ button. Used when the athlete is disqualified per TD ruling.
- **NT** — Timekeeper tablet has a red **No Time** button. Confirmation modal appears. Used when no valid time could be recorded but the athlete did finish.

### NT specifics

NT produces a speed score of `0`. Internally stored as `run_time = -1` (sentinel). The scoring engine's `calcSpeedScore` returns 0 for non-positive times. **Finalization proceeds normally** — the run is not blocked waiting for time.

The Time column shows "NT" across all surfaces (Timekeeper, HJ, Scoreboard, EventDetail, PDFs, exports) — never `-1`.

### How statused athletes are ordered (v1.26.00)

Statused athletes are no longer dumped unordered at the bottom. Per USSS 4012.3:

- **DNF and DNS are phase-scoped.** Each places the athlete at the **bottom of the tier (phase) in which the status occurred**, ahead of every athlete in lower tiers. Example: a DNS in a Final round of 8 places 8th — ahead of all Final 1 and Qualification athletes.
- **Within a tier** the order is: scored athletes (normal ranking), then DNF, then RNS (legacy data only), then DNS.
- **DSQ is event-scoped.** A DSQ places at the absolute bottom of the entire event, below every tier and every other statused athlete, regardless of which phase it happened in.
- **Statused athletes consume numeric places**, so lower tiers continue numbering after them. In a Final of 8 with 6 scored, 1 DNF, and 1 DNS: scored athletes take places 1–6, the DNF is 7th, the DNS is 8th, and the qualification tier begins at 9th. The status code (not the number) still prints in the Place column.
- **Ties among same-status athletes** in the same tier share the place and list by bib number ascending; the next place skips accordingly.
- **Multiple statused runs** (e.g. Best of 2 with DNF in run 1, DNS in run 2) resolve to a single status by precedence: DSQ, then DNF, then DNS. An athlete with at least one scored run in the tier ranks normally on it and is not flagged.
- **Qualifier/Finals tier assignment:** an athlete who scored in Qualification and then DNSed Final 1 places at the bottom of the Final 1 tier — not in the qualification tier on their qualification score.

This ordering is identical on the Results tab, the public Scoreboard, all results PDFs, and the USSS XML transmit.

### DNS / DNF / DSQ display

The score column on every surface shows the status text instead of `–` for pending runs. Examples:

- Scoreboard: Total column shows `DNS` / `DNF` / `DSQ` instead of blank.
- Results tab: Total column shows status text.
- PDF reports: Total column shows status text.
- Individual phase columns: Show status text for that run only.

### Component-level display

For DNS / DNF / DSQ athletes, only the **Total** column changes. Component breakdowns (Turns, Air, Speed, Time) stay blank or `–`. This keeps the row visually distinct without spurious zeros polluting the breakdown columns.

### Re-opening a DNS / DNF / DSQ run

If an athlete was marked DNS but then actually starts (showed up after the bib draw), you can clear the status from the Scoring tab's run history:

1. Open the run's Manual Entry modal.
2. The Status Override picker shows `None` / `DNS` / `DNF` / `DSQ`. Pick `None`.
3. Enter the actual scores.
4. Submit.

Re-opening removes the status, replaces with a numeric score, and re-runs the standings.
