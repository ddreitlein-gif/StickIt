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

### Restoring from a backup (in-app)

Each row in the backups table has a **Restore** action:

1. Click **Restore** on the backup you want.
2. Type the backup's **filename** exactly into the confirmation box — this is deliberate friction, since restore replaces the live database.
3. Before copying anything, the server takes a **pre-restore safety backup** of the current database, so even a mistaken restore is recoverable.
4. The backup is copied over `data/scoring.db`. **Restart the server** to load the restored data — the page warns you of this.

All connected tablets and scoreboards will refetch from the restored database after the restart.

### Restoring manually (alternative)

The file-swap path still works if you prefer it: stop the server, replace `data/scoring.db` with the downloaded backup file, restart. On a cloud host (Render/Railway) this requires access to the persistent disk; the in-app Restore button avoids that need.

### Recovery instructions on-page

The Admin → Backups page shows an amber static callout documenting the restore procedure.

### Auto-backup failure handling

If an auto-backup fails (disk full, file system error), the error is captured in the `app.errorLog` in-memory ring buffer with the tag `BACKUP / auto`. It appears on the [Admin Dashboard](./admin-dashboard) error log with the message "Auto-backup failed (covered N writes)."

### Endpoints

- `GET /api/admin/backups` — returns `{ backups, stats }`.
- `POST /api/admin/backups/create` — manual backup trigger.
- `GET /api/admin/backups/:filename/download` — streams the `.db` file.
- `POST /api/admin/backups/:filename/restore` — in-app restore (takes a safety backup first).

### Best practice

- **Before any risky operation** (re-seed, force-finalize, manual SQL): trigger a manual backup.
- **End of meet day**: download a backup for off-site storage.
- **Pre-deploy**: ensure a recent backup exists locally before pushing changes (pushes auto-deploy to the cloud hosts).

### Manual exports separate from backups

Auto-backups are full DB snapshots — every meet, every athlete, every score. For individual-meet exports (the kind you'd share with another organization), use the per-meet [Exporting a meet](./meets-export) flow instead. Backups are server-state snapshots; exports are portable meet bundles.
