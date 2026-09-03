## Live scoring flow

This is the end-to-end loop that runs all day at a live competition. Once the setup is done (event, judges, athletes, run order), the scoring tab is where you spend the day.

### The loop, per athlete

1. **Start Run** — on the Scoring tab, click the blue **Start Run** button next to the athlete listed as `Up Next`. A confirm dialog appears (some versions). On confirm, the server creates a `runs` row with `status='scoring'` and broadcasts `run_started` to every connected tablet and public scoreboard. **The first run of every event is started here, by the Chief of Scoring**, after the run order, judge panel and course specs have been checked; on a venue server that first start is also what puts the event in front of every tablet, after which the Head Judge can start runs from the tablet (see [Venue tablets](./venue-tablets)).
2. **Judge tablets receive the bib** — each judge's tablet shows the new athlete's bib, name, and any prior runs. Judges enter scores and submit.
3. **Timekeeper enters the time** — when the athlete crosses the finish line, the timekeeper enters the run time (or NT for No Time).
4. **HJ tablet shows complete score** — once all judges and the timekeeper have submitted, the Head Judge tablet shows the full computed score with per-judge breakdown.
5. **HJ approves** — clicks **Approve & Submit**. The server finalizes the run, computes the new ranking, and broadcasts `score_update` to every viewer (officials, public scoreboard, overlay).
6. **Scoring tab auto-advances** — the next athlete in the run order becomes `Up Next`.

The loop repeats until every athlete in the phase has been scored.

### Auto-finalize without HJ

If the event has no `HeadJudge` row in the judges table, the server **auto-finalizes** the run as soon as all required judge submissions are in. The HJ review step is skipped. This is the typical setup for a one-person scoring operation (Devo events especially) where the chief of score is both judge and head judge.

### Auto-finalize after time

For events with a HJ but where the time judge submits last, the HJ tablet shows the complete score the moment time is submitted. There's a small delay (300ms) before showing the Approve & Submit button to give the HJ a chance to register what just happened.

### Currently Scoring panel

The Scoring tab shows a **Currently Scoring** panel for any in-progress run:
- Athlete name + bib
- Each judge's submission status (Pending / Submitted)
- Time entry status
- Manual Entry button — see [Manual score entry](./scoring-manual)
- DNS button (yellow) — confirm-and-submit DNS for the current athlete

### Up Next list

Below Currently Scoring is **Up Next** — the next 3–5 athletes in run order. The first row has a **Start Run** button + DNS button + Manual Entry button. Subsequent rows are reference only.

### What can go wrong mid-loop

- **A judge submits a wrong score** — the HJ can reject just that judge's submission. See [Head Judge review & approval](./scoring-hj-review).
- **A judge's tablet loses connection** — the judge can re-submit when it comes back; the polling fallback catches up.
- **The timekeeper enters the wrong time** — the HJ can reject the time submission, prompting a re-entry.
- **The Start Run was for the wrong athlete** — End Run from the HJ tablet or the Scoring tab, then Start Run on the correct athlete.

### Phases and Run 2

For Best of 2 or qualifier/finals events, Run 1 / Q1 is the first pass. Once Run 1 is fully complete:
- Run 2 / F1 starts with a reversed run order (lowest from Run 1 first).
- The Scoring tab automatically detects the new phase and switches to the new run order.

For multi-phase events the **Phases** tab shows progress (which phase is in progress, which are finalized, which are sent for HJ review).

### End of event

Once the last athlete is approved, the HJ tablet shows the **Final Review** screen with a green **Finalize Event** button. Clicking it sets `events.status='complete'` and broadcasts `event_finalized`. Public scoreboards show the final standings; the event disappears from the LIVE NOW strip on `/livescores`.
