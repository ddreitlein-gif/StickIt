## Exporting a meet

Every meet can be exported as a self-contained `.zip` file. The export includes the meet, every event, every registration, every run, every judge score, every dual bracket match, every phase, every [training day](./meets-training-days) (with its participant exclusion list), and the entire audit trail for that meet.

### Single meet

1. Open the meet from the dashboard.
2. Click **Export Meet** in the meet header.
3. The browser downloads `meet_<short-code>.zip` (typically a few hundred KB to a few MB).

### Export All

To bundle every visible meet on the server in one go:

1. From the dashboard, click **Export All**.
2. The server creates a **zip-of-zips**: one parent `.zip` containing a `manifest.json` plus one child `.zip` per meet.
3. The download is named `StickIt_AllMeets_YYYYMMDD.zip`.

`Export All` respects the dashboard's filter — fully-locked meets that are hidden from your dashboard are excluded automatically.

### Bundle contents

```
StickIt_AllMeets_20260513.zip
├── manifest.json
├── meet_abc12.zip
├── meet_def34.zip
└── meet_ghi56.zip
```

The `manifest.json` lists each meet's `meet_id`, `name`, `location`, `date`, `meet_ranking`, and child filename. Each child zip contains a single `meet_export.json` with the full meet payload — byte-identical to a single-meet export.

### Safari note

If you're on macOS Safari and the download arrives extracted (a folder instead of a `.zip`), make sure you're on v1.16.25 or newer. The export endpoints now send `Content-Type: application/octet-stream` so Safari treats the file as opaque binary and skips its auto-extract heuristic. The filename keeps the `.zip` extension so double-clicking still extracts normally via Archive Utility.

### What's *not* in the export

- No images, audio, or PDFs — only the structured JSON.
- No master USSS People database (that's separate; see [Admin → USSS People](./admin-usss-people)).
- No system-level audit log entries from before the meet was created.
- No user accounts.

### Re-importing

Use the [Importing a meet from file](./meets-import) flow. Single-meet exports import as one meet (with the conflict dialog if one already exists). Multi-meet bundles open the multi-meet picker.

### When to export

- **Before risky operations** — for example, before re-seeding a dual bracket on Day 2.
- **End of meet** — keep a permanent local copy of the final state for the season archive.
- **Sharing** — if a partner organization needs the data, an export is the cleanest hand-off.
- **Migrating** — when moving a meet to a different StickIt server (e.g., promoting from a practice instance to the production deploy).
