## Athletes database management

The Admin → Athletes page at `/admin/athletes` is for bulk-cleaning up the master Athletes database. Over time, retired athletes, manually-entered names, and one-off CSV imports accumulate; this page provides four bulk-cleanup operations.

### Soft-delete model

Deletes from this page are **soft-deletes**. The athlete row is not removed from the database — only the `athletes.deleted_at` column is set. Effects:

- Soft-deleted athletes disappear from the master list, search, registration pickers, and CSV reconcile flows.
- **Past events are never affected** — existing registrations and runs still display the athlete name and any historical scores.

### Auto-restore

If a soft-deleted athlete is re-added via **Add from USSS Database** or re-imported via SkiReg CSV, the existing row is restored (`UPDATE athletes SET deleted_at=NULL`) instead of creating a duplicate. This is why a CSV import after a bulk delete just brings the right athletes back automatically.

### Four bulk operations

1. **Reset Athlete List** (red) — soft-delete every active athlete. Use after a full season to start fresh.
2. **Delete Selected Athletes** (red) — checkbox table; bulk soft-delete the chosen rows.
3. **Delete by Division** (dark) — dropdown of distinct divisions; soft-delete all in the picked division (or the "(No Division)" bucket).
4. **Delete Non-USSS Athletes** (dark) — soft-delete every athlete whose `ussa_num` is NULL/blank OR whose USSA# is not in the `usss_people` master file.

All four operations show a confirmation modal with the count and a sample of athletes before executing.

### Page layout

- **Status card** — active total, division count, selected count.
- **Bulk action toolbar** — the four buttons.
- **Search + division filter**.
- **Checkbox table** — Last, First, USSA #, FIS ID, Club, Division, YOB, Gen, USSS column showing ✓ when found in `usss_people`.
- **Pagination** — 100 per page.

### Endpoints

All require admin auth:

- `GET /api/admin/athletes?q=&division=&page=&limit=` — paginated list with `is_in_usss` flag.
- `GET /api/admin/athletes/divisions` — distinct divisions + count for "(No Division)" bucket.
- `POST /api/admin/athletes/preview-delete` — `{ mode, ids?, division? }` returns `{ count, sample }` for the confirmation modal.
- `POST /api/admin/athletes/delete` — same body, performs the soft-delete. Returns `{ deleted }` count. Audit-logged as `athletes_bulk_deleted`.

### When to use each operation

- **Reset Athlete List** — end of season, full reset.
- **Delete Selected** — small batch of obvious duplicates or test data.
- **Delete by Division** — when a division spun off or merged and you're consolidating.
- **Delete Non-USSS Athletes** — pre-season cleanup; any athlete who isn't licensed isn't going to compete.

### Don't fear the delete

Soft-delete is reversible — re-adding via USSS picker or SkiReg CSV restores the row. Past events are unaffected. The only thing you lose by deleting is the visibility in the master list; the data is still there if you need it back.

### Hard-delete (real removal)

There's no hard-delete UI. To genuinely remove an athlete row from the database, hand-edit the SQL — not recommended in any normal workflow.
