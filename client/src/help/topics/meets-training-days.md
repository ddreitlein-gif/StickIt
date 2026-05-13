## Training days

A **training day** is a participant roster for a pre-comp on-hill training session. Most meets have one or more training days (e.g. Thursday before a Saturday/Sunday comp). StickIt lets you build one or more named training days per meet, print attendance rosters as PDFs, and refine each day's list without touching event registrations.

### Opening Training Days

From a meet's detail page (Dashboard → Meets → *meet name*), click the **Training Days** button in the action row at the top. You land on the standalone Training Days page for that meet.

### Creating a training day

Click **+ New** in the left panel. Enter:

- **Name** — free text, e.g. "Thursday Training" or "Training Day 1".
- **Date** *(optional)* — used for sorting and printed on the PDF header.

Click **Create**. The new day appears in the left list and is auto-selected.

### Default participant list

When you select a training day, the right panel shows every athlete registered across every event in this meet — deduplicated by athlete, with the first non-empty bib number shown. The list starts with every athlete **included** (✓ in the leftmost column). Athletes whose event registration is set to **Scratched** are excluded by default and don't appear at all.

| Column   | Source |
|----------|--------|
| ✓        | Inclusion toggle (saved per training day) |
| Bib      | First non-empty bib across the athlete's event registrations |
| Athlete  | `Last, First` from the master athletes record |
| USSA #   | USSS membership number |
| Club     | Athlete's club |

### Opting athletes out

Uncheck the box on any row to exclude that athlete from this specific training day. The change saves immediately. Exclusions are scoped to one training day only — checking the same athlete back in works the same way. Exclusions are stored per `(training_day_id, athlete_id)` pair.

Use the header master checkbox to **include all** or **exclude all** at once. The **Reset (Include All)** link clears every exclusion on the current day.

### Live syncing with registrations

The list is computed live from event registrations every time you open the page. New athletes registered to any event under this meet AFTER the training day was created **automatically appear** in the list (checked). Athletes removed from event registrations automatically disappear. Scratching an athlete in an event also removes them.

This means you don't need to manually maintain training day lists across registration changes — just open the day and the list is current.

### Printing the PDF

Click **Print PDF** in the right-panel header. The PDF lists only included athletes, sorted by bib (blanks last), then by last name. Columns: Bib · Last · First · USSA # · Club. The header shows the meet name plus `Training Day Participants — <day name> — <formatted date>`. Filename: `Training_Day_<MeetSlug>_<DaySlug>.pdf`.

Pin the printout at the training day check-in table — coaches mark who showed up.

### Multiple training days

Create as many days as you need on the same meet. Each has its own independent inclusion/exclusion state. Switching between days in the left list does not affect the others. Days are sorted by date ascending (blanks last), then by creation time.

### Editing or deleting a day

Hover any day in the left list — the ✎ button opens an edit modal for name/date; the ✕ button deletes the day after confirmation. Deleting a training day removes its exclusion records but does not affect any event registrations.

### When the meet is deleted

Training days and their exclusion lists are removed along with the meet. There's nothing to clean up manually.

### Not in meet export/import yet

Currently, exporting a meet ZIP does not include its training days. Re-importing the same meet on another machine will not bring training days along. This is a known limitation tracked for a future release.
