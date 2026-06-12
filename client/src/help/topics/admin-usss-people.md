## USSS People database (Admin viewer)

The Admin → USSS People page at `/admin/usss-people` is a viewer for the imported USSS People file (master USSS roster), with **Sync Now** and **Upload File** buttons in the status card header for refreshing the data directly.

### Status card

At the top:

- **Last imported** — timestamp + source (`auto-sync` / `manual-upload`)
- **List year + identifier + filename** (e.g., `2026 Fall — people.txt`)
- **Total record count** — every record across all three types
- **Breakdown by type**:
  - **Competitors (C)** — licensed competing athletes
  - **Coach/Comp (CO)** — typically U15+ athletes with dual coach/competitor credentials
  - **Officials (O)** — judges, TDs, course officials

### Type label clarification

The USSS type code `CO` is labeled **Coach/Comp** here (not "Coach") because the USSS People File assigns CO to U15+ athletes who hold dual coach/competitor credentials — most are still primarily competitors. Pre-v1.16.20 versions used the misleading "Coach" label.

### Search and filter

- **Search input** (debounced 300ms) — matches `last_name`, `first_name`, `ussa_id`, or `club_name` (LIKE prefix).
- **Type filter dropdown** — All / Competitors / Coach/Comp / Officials.

Both filters reset to page 1 on change.

### Paginated table (100 per page)

Columns:

| Column | Notes |
|---|---|
| USSA ID | The membership number |
| Last | |
| First | |
| Type | C / CO / O |
| Div | Division (RM, SE, etc.) |
| Gen | Gender |
| YOB | Year of birth |
| Club | Club name from the People file |
| AE Pts | Aerial points |
| DM Pts | Dual mogul points |
| MO Pts | Mogul points |
| FIS ID | If present |

Numeric columns are right-aligned. Points display to 2 decimals.

### Download CSV

The **Download CSV** link streams the full table (no pagination, all records, current filter applied) as CSV. Filename pattern: `usss_people_<year>_<identifier>.csv`. Disabled when total = 0.

### Endpoints

- `GET /api/admin/usss/people?q=&type=&page=&limit=` — paginated/filtered JSON (default 100 per page, max 500).
- `GET /api/admin/usss/people/download` — full CSV stream.

### When to use this

- **Verify sync worked** — count of competitors should match what you expect for the current season.
- **Look up a specific athlete** — when their info on a registration looks off.
- **Audit divisional data** — filter by division to see how many athletes are registered per division.
- **Pre-meet check** — confirm the People file is current (last sync date should be recent).

### Re-syncing or uploading

Click **Sync Now** (auto-fetch) or **Upload File** (manual upload of a `people.txt` you downloaded) in the status card header. The same controls also live on the Officials side at **USSS Database** (`/dashboard/usss`) — both update the same data.
