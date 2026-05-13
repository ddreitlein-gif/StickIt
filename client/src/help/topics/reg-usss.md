## Importing from USSS People database

The **USSS People file** (a master roster of every USSS-licensed athlete, coach, and official) is the canonical source of truth for athlete data. Syncing it makes athlete entry instant and accurate — names, USSS#s, birth years, clubs, divisions, and FIS IDs all come from the file.

### Syncing the USSS People file

The Officials sidebar's **Information** section has a **USSS Database** subsection with two buttons:

- **Sync Now** — fetches the current USSS People file from USSS servers and replaces the local copy.
- **Upload File** — manual upload of a `people.txt` file you downloaded yourself. Useful when the auto-sync URL changes or you have access to a pre-release file.

After sync, the panel displays:
- Last sync timestamp
- List year + identifier (e.g. `2026 Fall`)
- Total record count + athletes count
- Source (`auto-sync` or `manual-upload`)

The sync is throttled — if the file hasn't changed since your last sync, the server returns `skipped: true` and shows "Already current" in the panel.

### Add an athlete from the USSS database

Once synced, on the Registration tab of any event:

1. Click **+ Add Athlete → From USSS Database**.
2. A search modal opens. Type a name or USSS#.
3. Results filter live. Click an athlete to add them.
4. The athlete is created in your master Athletes table (if not already there) and registered for the event.

If the athlete was previously **soft-deleted** ([Athletes database](./athletes-db)), this flow auto-restores them — no duplicate is created.

### USSS People file structure

The file contains three record types:
- **C** — Competitor (licensed competing athlete)
- **CO** — Coach/Competitor (typically U15+ athletes with dual credentials — most are still primarily competitors)
- **O** — Official (judge, TD, course official)

The Admin → USSS People viewer ([USSS People database (Admin viewer)](./admin-usss-people)) lets you browse the whole file, search by name / USSS# / club, and download as CSV.

### When sync fails

If **Sync Now** fails with an error message:

1. Check the server's internet connection (can it reach the USSS server?).
2. Use **Upload File** as a fallback. Download the file from USSS's website directly and upload it via the modal.
3. Check the server's audit log for the underlying error message.

### Automatic scheduled sync

A scheduled-sync job (`startScheduledSync` in `server/index.js`) runs nightly. It hits the same code path as the manual button, so any check-and-skip logic applies. Disable via `STICKIT_DISABLE_SCHEDULED_SYNC=1` if needed.

### What gets synced into the master Athletes table

The USSS People file is read-only — it's a **lookup source**. Athletes are only created in your master Athletes table when you actually use them (via the registration **Add from USSS Database** flow, or via CSV import with name-fallback matching). This keeps the master Athletes table focused on athletes that are actually competing in your meets.
