## Editing meet settings

Meet name, location, and start date can be changed at any time without affecting any scoring data underneath.

### Steps

1. Open the meet from the dashboard.
2. Below the meet's location and date, click **Edit Meet Settings**.
3. The same modal you used to create the meet opens, pre-filled with current values.
4. Change what you need and click **Save**.

### What you can edit

- **Meet name** — safe to edit anytime. The change propagates to the scoreboard, the live-scores listing, every PDF, and every export.
- **Location** — same as above.
- **Start date** — used by `By Age Groups` run-order builds to compute each athlete's USSS age class. Changing the date *after* you've built a run order will not retro-recompute the age classes; rebuild the run order if the date change crosses a USSS season boundary (July 1).

### What you can't edit here

- **Discipline** of an event — that's an event property, not a meet property. See [Editing an event](./events-edit).
- **Course length / pace standard** — those live on the meet's [Course specifications](./meets-course-specs) panel.
- **The meet's short code** — auto-generated, stable for the life of the meet. Sharing the same `/scoreboard/<short>` link before and after an edit always works.

### The Advanced panel

Next to **Edit Meet Settings** is an **Advanced** button, which opens the meet-level rule and permission settings. These apply to every event in the meet:

| Setting | Default | Effect |
|---|---|---|
| Landing Past the Lower Chop (NJ) rule | Off | When off, the FIS FS-18 chop/NJ controls are hidden on the dual judge and Head Judge tablets, in the paper-score modal, and on the Scoring tab — and the server refuses NJ calls. Historical matches that already carry an NJ finding still display it. |
| Air score tie allowed | Off | When off, the dual Air Judge (J3) cannot submit a tied air score — the Air Tied button and checkbox are hidden and the server refuses the submission. Time Tied (J4) is unaffected. |
| Who can start a run | All on | Three independent checkboxes control whether the **Start Run** button (and its DNS companion) appears on the Timekeeper tablet, the Head Judge tablet, and the Scoring tab. If all three are turned off, the Scoring tab keeps its button anyway so the meet can never be locked out. |
| Allow venue server adoption | On | When off, this meet is cloud-only (remote judging) and can never be released to or adopted by a venue server. Locks once the meet is adopted. This control used to live in Edit Meet Settings as "Remote judging meet". |

All four settings survive meet export/import and cloning, and (except the adoption flag) ride along when a venue server adopts the meet.

### The More ▾ menu

The meet header groups its less-frequent actions — **TD Report**, **Export Meet**, **Clone Meet** — under a **More ▾** button to keep the header compact.

### Status changes

The meet and event **Status** dropdowns ask for confirmation when changing to or from **Complete**, since manually completing an event bypasses the Head Judge finalize flow.

### Visibility

Edits to a meet's name or date are immediate. Officials viewing the dashboard at the same moment will see the change on their next page-refresh. Public scoreboards refresh automatically — anyone watching `/scoreboard/<short>` sees the new title within a few seconds via the live polling cycle.
