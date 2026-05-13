## Multi-phase events

A **phase** is a distinct round of scoring within an event. The simplest event has one phase (one run, one set of scores). The more complex layouts:

- **Best of 2** — every athlete gets two runs. Final ranking uses the better of the two.
- **Qualifier / Finals** — Run 1 is a qualifier; the top N advance to Run 2 (the final). Optionally a third "Final 2" runoff.
- **Best of 2 with multi-finals** — combinations of the above.

### Configuring phases

1. On the event detail page, click the **Phases** tab.
2. Click **Configure Phases**.
3. Pick a phase template:
   - **Single Run** (default — no phases configured)
   - **Best of 2** — Run 1 + Run 2, both score, take the better
   - **Qualifier / Finals** — Q1 + F1, with a configurable cut size (e.g. top 16 to F1)
   - **Qualifier / Two Finals** — Q1 + F1 + F2, with two cuts
4. For each cut, set the **Final size** (e.g. `16`).
5. Click **Save Phases**.

Phases generate a `phase_run_order` for each phase. Run 1 always uses the registration run order. Subsequent phases use the previous phase's results to determine who advances.

### Cut-line tie expansion

Per FIS ICR 4207.3.4, when athletes tie at the unbreakable level (Total → Turns → Air-no-DD → Speed all equal) and the shared rank straddles a cut line, **all** of them advance. So a 16-athlete final can become a 17-athlete final if there's a two-way tie at rank 16. This is rules-correct behavior and happens silently — the cut just expands to include the tied athletes.

### Undersized field warning

If you set a cut to 16 but only 8 athletes qualified (heavy DNS, last-minute withdrawals), the phase is created with whatever athletes are available — but a yellow notice appears on the Phases tab:

> Final 1 was configured for 16 athletes, but only 8 qualified.

Non-blocking; the meet continues normally. The notice is informational so the operator can confirm with the TD whether to re-open registration or proceed.

### Run order across phases

- Run 1 / Q1 → registration run order (the order you saved in [Building run order](./reg-runorder)).
- Run 2 (Best of 2) → reverse order of Run 1 results (lowest scoring first, highest scoring last) per FIS ICR 4205.
- F1 / F2 → reverse order of the qualifier results, restricted to the cut.

### Editing phases mid-event

Once a phase has been finalized you cannot reconfigure it from the UI. To re-open a phase:

1. The Head Judge taps **Send Back to Scoring** on their tablet (see [Head Judge review & approval](./scoring-hj-review)).
2. Edit individual scores via [Editing a finalized score](./scoring-edit).
3. Re-finalize via the HJ tablet's Approve & Submit flow.

For non-Best-of-2 single-run events, no phase configuration is needed at all.
