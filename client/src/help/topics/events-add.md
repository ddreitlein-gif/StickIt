## Adding an event

An **event** is one competition within a meet — a single discipline + gender combination, often run as one or more phases on a given day.

### Steps

1. Open the meet detail page.
2. Click **+ Add Event**.
3. The event form modal opens. Fill in:
   - **Discipline** — `Mogul`, `Dual Mogul`, or `Aerials`.
   - **Category** — varies by discipline:
     - **Mogul / Dual Mogul:** Comp Series (default), Devo, RQS-EQS, FIS.
     - **Aerials:** USA Regional (default), USA National, FIS Other, FIS NAC/NorAm, FIS OWG/WSC/WC.
     See [Categories & divisions explained](./events-divisions) for what each one means and which judging configuration it implies.
   - **Gender** — `Male`, `Female`, or `Mixed`.
   - **Event name** — auto-fills from the discipline + category + gender (e.g. `Comp Series Male Mogul`). You can override.
   - **Date** — defaults to the meet's start date. Set explicitly for multi-day meets.
4. Click **Create Event**. The event appears as a card on the meet detail page.

### What's set automatically

- For aerials, picking a **Category** sets the panel-size range, the HJ-may-score flag, and the reduction method options. See [Aerials event setup](./events-aerials).
- For mogul / dual mogul, picking a **Category** sets the default judging configuration:
  - **Comp Series:** 3 T&L + 2 Air judges, 2 jumps, time on, component scoring on.
  - **RQS-EQS:** 2 T&L + 1 Air, 2 jumps, time on, component scoring **off** (single raw T&L score).
  - **Devo:** 2 T&L + 1 Air, 1 jump, **no time**.
- The event inherits the meet's [Course specifications](./meets-course-specs) automatically.
- The event gets a unique short code for public URLs (e.g. `/scoreboard/abc12`).

### Auto-naming

The auto-naming follows simple rules:

| Discipline | Category | Format |
|---|---|---|
| Mogul / Dual Mogul | Any | `<Category> <Gender> <Discipline>` — e.g. `Comp Series Female Mogul` |
| Aerials | Any | `<Event Type Label> <Gender> Aerials` — e.g. `USA Regional Male Aerials` |

You can edit the name to whatever you like (`Day 1 — Mens Comp`, `Saturday Mogul Final`, etc.). The auto-name only applies on first edit before you've changed it.

### After creating

- Add judges on the **Setup** tab — see [Adding & assigning judges](./judges-add).
- Register athletes on the **Registration** tab — see [Registering athletes for an event](./reg-register).
- Configure phases if needed — see [Multi-phase events](./events-phases).
- Generate tablet URLs from the **Links** tab — see [Judge tablet URLs](./judges-urls).
