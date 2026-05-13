## Creating a meet

A **meet** is the top-level container for everything that happens on a competition weekend. One meet can hold many events — for example, a single weekend might be one meet with six events: men's mogul, women's mogul, men's dual, women's dual, men's aerials, women's aerials.

### Steps

1. Go to the **Officials** dashboard (the home of the Meets list).
2. Click **+ New Meet** in the top-right of the page.
3. Fill in:
   - **Meet name** — the public-facing name. This shows on the scoreboard, on the live-scores page, and on every PDF. Use the official name from the registration site (e.g., `2026 Winter Park Spring Series #3`).
   - **Location** — usually the resort or venue (`Winter Park, CO`).
   - **Start date** — the first day of competition. If the meet runs more than one day, this is day one.
4. Click **Create**. You're taken to the meet detail page.

### What happens behind the scenes

A new row is created in the `meets` table with a generated UUID and a unique short code. The short code is what appears in public URLs like `/scoreboard/abc12` so spectators don't have to type a UUID.

The meet starts empty — no events, no athletes, no course specs. Add those next:

- [Adding an event](./events-add)
- [Course specifications](./meets-course-specs)
- [Registering athletes for an event](./reg-register)

### Field-naming conventions

USSS sanction documents tend to use names like `2026 USSA EC #2 Mogul Championships`. StickIt does no naming validation — type whatever your sanction shows. The meet name is preserved character-for-character in PDFs and exports, which simplifies cross-checking against the sanction.

### Editing later

You can change any meet field after creation — see [Editing meet settings](./meets-edit). The meet name is safe to edit at any time; nothing in the database keys off it.

### Deleting

If you create a meet by mistake, see [Deleting a meet](./meets-delete). Deletion cascades to every event, registration, run, score, judge, bracket match, phase, and run-order entry under that meet — so use it carefully.
