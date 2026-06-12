## The Athletes database

StickIt keeps a **master Athletes table** that lives independently of any single meet. Every athlete you've ever registered, imported, or manually entered ends up here. Registering an athlete for an event creates a `registrations` row that points back to the master `athletes` row — so the same athlete appears identically across every meet they compete in.

### Where to find it

The **Athletes** entry in the Officials sidebar opens the master list, paginated at 100 athletes per page. Columns:

- **First, Last**
- **Bib** (default bib, can be overridden per event)
- **USSA #** — the USSS membership number
- **FIS ID** (if any)
- **Club**
- **Div** — division code from the USSS People file (`SE`, `RM`, `IM`, etc.)
- **Birth Year**
- **Gender**
- **Edit** — inline-edit button

### Soft-delete

Bulk deletes from the [Admin → Athletes management](./admin-athletes) page are **soft-deletes**. The athlete row is not removed from the database — only the `deleted_at` timestamp is set. Effects:

- Soft-deleted athletes disappear from the master list, search, registration pickers, and CSV reconcile flows.
- Soft-deleted athletes are **not** deleted from past events. If they had registrations or runs in completed meets, those rows still display the athlete name and any historical scores.

### Auto-restore

Re-adding a soft-deleted athlete via **Add from USSS Database** or via a SkiReg CSV import restores the existing row by clearing `deleted_at`. No duplicate is created. This is why a CSV import after a bulk delete just brings the right athletes back.

### ALL CAPS auto-correct

Names entered as `SMITH` are automatically converted to `Smith` on save. This applies to every athlete create / update / sync path. Mixed-case names like `McDonald` or `O'Brien` are preserved as-is. The auto-correct handles:

- All-caps single names → name case (`SMITH` → `Smith`)
- All-caps multi-word names (`DE LA CRUZ` → `De La Cruz`)
- Hyphenated names (`SMITH-JONES` → `Smith-Jones`)
- Apostrophe names (`O'BRIEN` → `O'Brien`)

Mixed-case names are *not* changed. This is intentional — Mc/Mac, de la, von, etc. should be respected exactly as entered.

### Division column

The Division column is sourced from the USSS People file's `D` field (Rocky Mountain, Eastern, Pacific Northwest, Intermountain, etc.). It's populated automatically during USSS sync, **Add from USSS Database**, and CSV reconcile flows. There is no manual override — to set or change a division, ensure the master USSS People file is current and re-sync.

### Inline edit

Click the **Edit** pencil on any row. Editable fields: first name, last name, default bib, USSA#, FIS ID, club, birth year, gender. Save to update the master record. Past events are unaffected — past registrations carry the snapshot of the name and other fields at the time of registration.

### When to use the master list

- Searching across meets for an athlete's history.
- Hand-editing typos that came in via CSV import.
- Manually entering an athlete who isn't in the USSS People file (a coach, an international guest).
- Auditing data quality before a critical meet.
