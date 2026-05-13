## Reading a Scoreboard

The Scoreboard at `/scoreboard/<short>` is the spectator-facing live results page for a single event. It updates in real time as runs are finalized.

### Mogul scoreboard

The layout is an athlete-card list. Each card shows:

**Collapsed**
- **Rank chip** (gold for 1st, silver 2nd, bronze 3rd, neutral for others)
- **Bib chip**
- **Athlete name**
- **Best total** (big, JetBrains Mono)
- **4-up component grid** — Turns / Air / Time / Speed

Tap a card to expand:

**Expanded**
- **Per-phase sections** for multi-phase events (Run 1, Run 2, Q1, F1, F2)
- **Per-judge breakdowns** for each phase:
  - TL judges: each judge's component scores
  - A1, A2: each Air judge's jump scores and codes
  - Time judge: run time
  - Winning run starred

Tap the same card to collapse. Tap a different card to switch.

### Dual mogul scoreboard

Dual mogul has a **3-tab strip** at the top:

1. **MATCH** (default) — current or most-recently-completed match, with full per-judge 5-point split scores.
2. **BRACKET** — tree view of every match with winner highlighted at each step.
3. **PLACE** — ranked placement table with FFSP points (after event completion).

If no match is active, the **Match** tab falls back to the most-recently-completed match (sorted by bracket_round then bracket_position) with a "MOST RECENT COMPLETED MATCH" label. If zero matches are complete, shows a "WAITING FOR FIRST MATCH" placeholder.

The **Place** tab shows DNS / DSQ / SCR markers and DNF tags. FFSP points appear only after event finalization. See [FFSP points (dual mogul)](./results-ffsp).

### NOW COMPETING banner

When a run is in progress, a gradient banner shows above the standings:

> NOW COMPETING — Bib #7 — Smith, John

It updates live via WebSocket `run_started`. The athlete moves into the standings once their score is finalized.

### Upcoming Athletes box

Below the rank table, an **Upcoming Athletes** card lists the remaining queue for the current run / phase, ordered by run order. Columns: Order, Bib, Name. Header text reflects the active phase ("Run 1 — Up Next", "Final 1 — Up Next", etc.). For single-run events, the header is "Run 1 — Up Next".

The card is muted visually (gray-on-dark) so it reads as secondary information vs. the rank table above.

### Live updates

The scoreboard listens for WebSocket events:
- `score_update` → re-fetch results
- `run_started` → update NOW COMPETING banner
- `dual_match_started` / `dual_bracket_review` / `event_finalized` → re-fetch bracket / standings / status

Plus 5-second polling as a fallback. The polling skips its update if a WebSocket message arrived in the last 4 seconds (prevents stale-poll-overwrites-fresh-WS races).

### Sun Mode

Toggle in the top-right (sun/moon icon). High-contrast palette for outdoor viewing.

### URL & sharing

`/scoreboard/<short>` — the short code is permanent for the life of the event. Share the link via Slack, AirDrop, email — it works on any device with a browser.

### PDF downloads

Buttons at the top right of the scoreboard offer the same PDF downloads as the Officials Results tab: Event Results Summary, Check Sheet by Bib, etc. See [PDF reports](./reports-pdf).

### Event not found

If you visit `/scoreboard/<bad-short>`, the page shows a "Event not found" card with the bad short code echoed back and a "View live scores" link. Doesn't silently fail.

### Mobile readability

Athlete cards stack to full width on iPhone. Component grids re-flow. Expanded per-judge breakdowns scroll within the card. Tested in portrait and landscape.
