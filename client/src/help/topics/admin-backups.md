## Backups

The Admin → Backups page at `/admin/backups` displays the automatic rolling SQLite backups created by `server/db/autosave.js`. Backups are read-only here — actual restore is a server-side file swap.

### Auto-backup mechanism

Since v1.19.01, auto-backup is **time-based**:

- Every **5 minutes**, the auto-backup job fires.
- If at least one DB write occurred since the previous backup, a new backup file is created.
- If no writes occurred, the job skips silently.
- The system keeps the **last 10** backup files, deleting the oldest when a new one would exceed.

Backup files are timestamped `.db` files in `data/backups/` (e.g., `scoring_20260513_142318.db`).

### Status card

The page displays:

- Backup count (current / max)
- Total disk used by backups
- Newest / oldest timestamps with relative-ago labels (e.g., "3 minutes ago")
- Write counter (total writes since server start)
- Backup interval ("Every 5 min if writes occurred")

### Manual backup trigger

Click **Create Backup Now** to invoke `doBackup()` directly, outside the every-5-minute cycle. Useful before risky operations — e.g., before re-seeding a dual bracket, before a meet import overwrite.

### Backups table

| Column | Description |
|---|---|
| Filename | Monospace, full filename |
| Created | Timestamp + relative ago |
| Size | KB or MB |
| Download | Streams the `.db` file |

Newest first. Each Download link streams the SQLite file with `Content-Disposition: attachment`. The filename regex is validated server-side (`^scoring_[\w-]+\.db$`) to prevent path traversal.

### Restoring from a backup

There is no UI restore button. To restore:

1. **Stop the server** (`Ctrl+C` if running locally; Railway: restart the service after the swap).
2. Replace `data/scoring.db` with the downloaded backup file.
3. **Restart the server**.

The server will pick up the restored data on next boot. All connected tablets and scoreboards will refetch from the new database.

**On Railway:** restore requires shell access to the persistent volume. If you don't have that, contact the StickIt operator team for a manual restore.

### Recovery instructions on-page

The Admin → Backups page shows an amber static callout documenting the restore procedure, with a note about the Railway caveat.

### Auto-backup failure handling

If an auto-backup fails (disk full, file system error), the error is captured in the `app.errorLog` in-memory ring buffer with the tag `BACKUP / auto`. It appears on the [Admin Dashboard](./admin-dashboard) error log with the message "Auto-backup failed (covered N writes)."

### Endpoints

- `GET /api/admin/backups` — returns `{ backups, stats }`.
- `POST /api/admin/backups/create` — manual backup trigger.
- `GET /api/admin/backups/:filename/download` — streams the `.db` file.

### Best practice

- **Before any risky operation** (re-seed, force-finalize, manual SQL): trigger a manual backup.
- **End of meet day**: download a backup for off-site storage.
- **Pre-Railway-deploy**: ensure recent backup exists locally before pushing changes.

### Manual exports separate from backups

Auto-backups are full DB snapshots — every meet, every athlete, every score. For individual-meet exports (the kind you'd share with another organization), use the per-meet [Exporting a meet](./meets-export) flow instead. Backups are server-state snapshots; exports are portable meet bundles.
