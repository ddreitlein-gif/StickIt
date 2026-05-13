## Manual score entry

The standard scoring path is tablet-based: judges enter scores on their tablets, the HJ approves, the server finalizes. But sometimes the tablet flow can't be used — a tablet is offline, scores are coming in over the radio from a remote judge, or you're recording a paper-scored event after the fact. **Manual Score Entry** is the fallback.

### When to use it

- A judge tablet is offline or broken.
- Scores are being relayed by radio and you're typing them in centrally.
- You're recording a historical event from a paper score sheet.
- A score was missed by the tablet flow and you need to add it after the fact.

### Where to access it

Several entry points:

- **Scoring tab → top of page → 🎙 Voice Manual Entry** — opens the voice modal in paper-entry batch mode (mogul + legacy aerials only). See [Voice manual score entry](./scoring-voice).
- **Scoring tab → "Currently Scoring" panel → Manual Entry button** — opens the keyboard modal for the currently-scoring athlete.
- **Scoring tab → "Up Next" row → Manual Entry button** — opens the keyboard modal for the first up-next athlete.
- **Results tab → per-row Manual Entry button** — opens the keyboard modal pre-populated with the existing scores for editing (this is also accessible via [Editing a finalized score](./scoring-edit)).

### Standard mogul modal walkthrough

The modal lays out one section per scoring component:

1. **Time** — enter the run time in seconds (e.g. `27.34`). If the event has no speed (Devo), this section is hidden.
2. **Jump codes** — pick from the quick-select grid or the full dropdown for each jump.
3. **Per-judge T&L scores** — for each TL judge (TL1/TL2/TL3):
   - If component scoring is on: Carving, Absorption, Upper Body, Deduction.
   - If component scoring is off (RQS-EQS): Raw, Deduction.
4. **Per-judge Air scores** — for each Air judge (Air1/Air2):
   - Jump 1 score, Jump 2 score.

Each input has +/- buttons for fine tune. The running calculated total updates live at the bottom.

A **Submit** button persists the run. A **Cancel** button discards. A **Status Override** lets you submit DNS / DNF / DSQ instead of a numeric score.

### Aerials v2 — refused

Manual Score Entry's legacy-shape modal **does not work** for aerials v2 events (panel size set, per-judge-per-jump data). The server returns an error directing the operator to use the per-judge tablets instead. There's no way to encode per-judge-per-jump Air/Form/Landing scores into the simple flat modal — and forcing it would silently corrupt the v2 data model. This refusal was added in v1.18.02.

To enter aerials v2 scores manually, open each per-judge tablet URL on the scoring laptop and use the tablet UI directly — the URLs are listed on the event's Links tab.

### Dual mogul

Dual mogul has its own manual entry path — see [Dual mogul setup](./events-dual). The **Manual Score Entry** button on the dual scoring tab opens a 5-judge entry modal for the current match.

### Partial scores

The modal supports partial submissions. Leave a judge's score blank and the run is recorded as "incomplete" — the score appears with `—` placeholders. This is useful for capturing what you have so far when an event was running on paper and you're back-filling.

### Voice option

In v1.20.00+ a **🎙 Voice Entry** button appears in the manual entry modal header. Clicking it closes the keyboard modal and opens the voice modal in tablet-edit mode with the athlete pre-selected, skipping the bib screen. See [Voice manual score entry](./scoring-voice).
