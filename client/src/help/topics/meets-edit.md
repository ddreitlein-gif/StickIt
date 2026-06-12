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

### The More ▾ menu

The meet header groups its less-frequent actions — **TD Report**, **Export Meet**, **Clone Meet** — under a **More ▾** button to keep the header compact.

### Status changes

The meet and event **Status** dropdowns ask for confirmation when changing to or from **Complete**, since manually completing an event bypasses the Head Judge finalize flow.

### Visibility

Edits to a meet's name or date are immediate. Officials viewing the dashboard at the same moment will see the change on their next page-refresh. Public scoreboards refresh automatically — anyone watching `/scoreboard/<short>` sees the new title within a few seconds via the live polling cycle.
