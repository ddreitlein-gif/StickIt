## Importing from SkiReg CSV

SkiReg is the standard registration platform for USSS meets. After registration closes, the event director downloads an "Entry List" CSV from SkiReg. StickIt imports that file directly — no manual data entry, no Excel reformatting.

### Steps

1. Download the entry list CSV from SkiReg.
2. On the event's **Registration** tab, click **+ Add Athlete → Import from SkiReg CSV**.
3. Pick the file.
4. A preview appears showing the count of athletes that will be added or updated. Bib conflicts (if any) are flagged.
5. Click **Confirm Import**. Athletes are added in bulk.
6. A blue banner appears asking **"Sync with USSS Database to fill in missing athlete data?"** — click **Yes** to enrich any partial records from the master USSS People file.

### Expected CSV columns

SkiReg exports include these columns:

```
Last Name, First Name, Gender, Birth Year, USSS Member #,
Team, Bib, Category Entered, Quantity, Transaction Type,
Date of Birth, MerchSummary
```

Two known column-name variations are accepted: `Category Entered` and `Category Entered / Merchandise Ordered`. Both work.

### How athletes are matched to your master Athletes table

Two-step matching:

1. **By USSS Member # first** (primary key).
2. **Fall back to case-insensitive name match** with birth year disambiguation. This prevents creating duplicate rows when an athlete was previously entered without their USSS#.

When a fallback match succeeds, the existing master record is updated with the SkiReg row's USSS#, birth year, gender, and club (filling in missing fields without overwriting existing ones).

### Discipline matching

SkiReg's `Category Entered` field is loose ("Moguls", "Mens Mogul", "Mogul", "Dual Mogul", "Aerials"). The import logic:

- **Mogul event** — matches rows where Category contains `'mogul'` AND NOT `'dual'`
- **Dual Mogul event** — matches rows where Category contains `'mogul'` (any mogul row, since SkiReg often uses plain "Moguls" for dual entrants)
- **Aerials event** — matches rows where Category contains `'aerial'`

### Dual mogul deduplication

For dual mogul events, SkiReg often emits two rows per athlete — one for "Moguls" and one for "Dual Moguls". Both rows match `Mogul` and `Dual Mogul` event imports. To prevent double-registration, the importer **dedupes by USSS#** within the import loop and merges bib numbers (whichever row has a bib wins).

### Bib conflicts

SkiReg's bib field is sparse — only the mogul (single) row typically carries a bib; dual and banquet rows have empty `Bib`. The importer handles three modes:

- **Random** — assigns fresh bibs to anyone missing one, starting from 1, skipping taken bibs.
- **Run Order** — refuses to assign bibs (positional bibs would conflict). Build the run order first, then assign bibs via [Bib assignment](./reg-bibs).
- **Copy from Event** — fills missing bibs only from athletes that also exist in the source event.

### What if an athlete isn't in the master Athletes table?

If the SkiReg row carries a USSS# that doesn't match any existing athletes row and the name doesn't match either, a new athletes row is created from the SkiReg data. After import, run the **Sync with USSS Database** prompt to back-fill missing fields (birth year, club, FIS ID, division) from the master USSS People file.
