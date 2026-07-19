## Importing a meet from file

Meet files (`.zip` exports from another StickIt installation) can be imported back into any StickIt server. This is the standard way to:

- Move a meet from a practice server to the production server
- Restore a meet from a hand-saved backup
- Bring a partner organization's meet into your system

### Steps (single meet)

1. From the dashboard, click **Import Meet**.
2. Select a `.zip` or `.json` file from your computer.
3. The server reads it and inspects for naming conflicts.
4. **No conflict** — the meet imports immediately. You're returned to the dashboard with the new meet at the top.
5. **Conflict** — a meet with the same name already exists. A modal appears with side-by-side comparison cards (server version vs. import file) and four options:
   - **Cancel** — abort. Nothing changes.
   - **Import as Duplicate** — creates a new meet with `(Duplicate)` appended to the name. If that name also exists, uses `(Duplicate 2)`, etc.
   - **Merge** — adds new data and updates older data on the existing meet. See merge rules below.
   - **Overwrite** — requires a second confirmation. Deletes all existing data for the meet and replaces it with the import file's content.

### Merge rules (when you choose Merge)

- Events match by `discipline + gender` (with name as a fallback).
- Athletes deduplicate by USSA#, FIS ID, or name+birth_year.
- Registrations match by event + athlete.
- Judges match by event + role.
- Runs match by event + athlete + run number + round.
- Judge scores match by run + judge + score type.
- For every match, the **newer** record (`updated_at` / `submitted_at`) wins. Older import data is ignored.

Merge is non-destructive — you can run it any number of times.

### Multi-meet import (ZIP-of-zips)

If the file you uploaded was created via **Export All** (see [Exporting a meet](./meets-export)), it contains a `manifest.json` listing all bundled meets. The import flow then becomes:

1. A modal lists every meet in the bundle with checkboxes.
2. Conflict-flagged meets show an amber **Already exists** badge.
3. Pick which meets to import. Click **Import N meets**.
4. The flow runs them sequentially — for each conflict-flagged meet, the standard conflict modal appears so you can pick Merge / Duplicate / Overwrite per meet.
5. A summary at the end lists each meet's outcome.

### Raw JSON files

The importer also accepts a bare `meet_export.json` file (no zip wrapping). This is mostly useful for hand-editing edge cases — the standard workflow uses zips.

### What gets imported

Everything in the meet's scope: meet metadata, course specs, events with full configuration (event type, panel size, reduction method, phases, dual mogul random seed, lock state), athletes, registrations, judges, runs, judge scores, dual bracket matches, dual judge points, phase run order, run-round status. Audit log entries are *not* imported (those are server-local).
