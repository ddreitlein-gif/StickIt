## Importing registrations (SkiReg, RMF / Winfree, XLSX)

One importer reads every registration file StickIt sees: the entry list SkiReg exports (CSV or XLSX), the RMF "Data" spreadsheets built for Winfree, and any other sheet that has a *Last Name* column. It registers athletes into the right events of the meet, recovers missing USSS numbers from the USSS People File, and shows you exactly what it will write before it writes anything.

### Where to start it

- **Meet page → Import Registrations** — one file registers athletes into *every* event of the meet. This is the normal way: export once from SkiReg, import once.
- **Event → Registration tab → Import Registrations…** — the same dialog, but only rows that belong to *this* event are registered. Rows for other events are listed under *Not in This Event* and left alone. A file with no entry information at all (a Devo Data file) registers all of its matching-gender rows into this event.

Both need the meet's events to exist first, with the right gender, discipline, and (for same-discipline events) an **event date**.

### The files it reads

**SkiReg export (2026 layout).** Columns as SkiReg sends them:

```
Bib, Category Entered [/ Merchandise Ordered], City, First Name, Last Name,
Notes, Fundraising Pageviews, Custom Tax, Gender, State, Team[, Quantity, MerchSummary]
```

There is **no USSS Member # and no birth year** in this export. One row per category per athlete, so a skier entered in Saturday moguls, Sunday moguls and duals appears three times; banquet tickets, coaches / officials / judges and registration-fee rows are in the same file. The importer merges the rows of one person, ignores the non-event rows, and looks each athlete up in the USSS People File to get the number and birth year (see below). The XLSX SkiReg offers is the same data and imports identically.

**RMF / Winfree Data file.** The spreadsheet the registrar builds for Winfree:

```
Last Name, First Name, Gender, Born, ID, Club[, Bib][, Events | M, M2, D][, FIS]
```

Column order does not matter. Who is entered in what comes from either an **Events** column holding concatenated codes (`M`, `MD`, `MM2`, `MDM2`) or one **tick column per event** headed with the event's import code (`M`, `M2`, `D`) where any non-blank cell (`X`, `x`, `1`, `Y`) means entered. A Devo Data file usually has neither, which means "everyone in the file is in the event".

**Anything else.** The header row is the first row that contains a *Last Name* column, so rows above it are skipped (Winfree's rule). Column names are matched case-insensitively, ignoring spaces and punctuation, with all of Winfree's synonyms plus the SkiReg spellings:

| Field | Accepted headers |
|---|---|
| Last name | Last Name, Last, Name, Surname, Family Name, Nom, Nom de Famille |
| First name | First Name, First, Given Name, Prénom |
| Gender | Gender, Sex, Sexe, Group, Gp, Grp, M/F — only the first letter counts (`Male`, `F17`, `M3` all work) |
| Birth year | Born, Birth Year, Year of Birth, YOB, Birthday, Date of Birth, DOB, Année de Naissance — `1990`, `1990-03-07` and `3/7/1990` all give 1990 |
| USSS # | ID, ID#, USSA ID, USSA#, USSS #, USSS ID, USSS Member #, Member ID — must be 5–8 digits |
| FIS id | FIS, FIS#, FIS ID, FIS Code |
| Club | Club, Team, Club Name, Mountain, Rep, Representing, From |
| Bib | Bib, Bib#, Bib Number, Dossard |
| Category | Category Entered, Category Entered / Merchandise Ordered, Category, Event |
| Events codes | Events, Épreuves |

A *Last Name* cell holding `Stone, Dick` with a blank first name is split. Files saved as Windows-1252 (an accented name from an older Excel) are read correctly. Unknown columns are ignored and listed in the dialog's **Columns** step, where any column can be re-assigned — for example a file whose *Club* column actually holds the gender and whose *Team* column holds the club.

### Import codes

Every event has an **import code**, its Winfree short registration name: `M` for moguls, `M2` for a second moguls event of the same gender (the Copper Saturday / Sunday pair), `M3`…, `D` for duals, `A` for aerials. It is assigned automatically when the event is created — in event-date order for events of the same gender and discipline — and can be changed on the event form ("Import code (Winfree short name)"); it must be unique per gender within the meet. It is shown on the event's Details tab and as a chip on the Registration tab. The Events column and the tick columns of an RMF Data file resolve against it: with codes `M`, `M2`, `D` the string `MDM2` reads as `M`, `D`, `M2` (longest code first, left to right).

### How rows are matched to events

Each row yields one or more **entry markers**: its category string, each code from its Events cell, or each ticked column. Every distinct marker is resolved to exactly one event — or to "Not an event" — by these rules, in order:

1. Banquet, ticket, coach, official, judge, volunteer, fee, merchandise, donation, parent and spectator categories are **not an event**.
2. **Gender** comes from the row; if the row has none, from a gender word in the category ("Men's", "Women's", "Boys", "Girls").
3. **Discipline** from the category word: *dual* → dual moguls, *aerial* → aerials, *moguls* / *singles* → moguls. A code or tick column already names its event.
4. The candidates are the meet's events of that gender and discipline.
5. If more than one fits, a **date or day** in the category — `(Feb 21)`, `(March 7th)`, `(3/1)`, `Saturday` — is matched against the events' dates. A date that matches no event is reported rather than guessed.
6. If still more than one, a **series word** — Devo, RQS, Comp, FIS, Invitational, Championship — is matched against the event names.
7. Exactly one candidate left → resolved. Otherwise the marker is **unresolved** and you are asked.

A file with no entry information resolves to the one event of the row's gender when the meet has exactly one; if the gender has several events, you are asked (unless you started from an event's own Registration tab).

**When you are asked.** The **Events** step appears only when at least one marker could not be resolved. It lists every marker in the file (the resolved ones too, so you can check and correct them) with its row count, the reason, and a drop-down of the meet's events plus *Not an event*. Confirm Import stays disabled until every marker has an answer. Your answers are **saved with the meet**: the next import of an updated SkiReg file (late entries arrive right up to the meet) applies them silently and only asks about category strings it has not seen before.

### Who the athlete is

The rows of one person are grouped by USSS number, or by name when the file has none. Then, in order:

1. A master athlete with that **USSS number**.
2. A master athlete with that **FIS id**.
3. The **USSS People File** (competitors and coach-competitors) by normalised last and first name — with gender, then a shared club word, as tie-breakers when two people share a name. A unique hit supplies the USSS number, birth year, club, FIS id and division; on the 2026 SkiReg exports 98–100 % of athletes resolve this way. If the People File is not synced, the preview says so; sync it from Admin → USSS People File first.
4. A master athlete with the same **name** (and birth year when known), including soft-deleted rows, which are restored.
5. Otherwise a **new athlete**, flagged when no USSS number could be found.

Existing athletes get only their blank fields filled (USSS number, birth year, gender, club, FIS id, division); nothing is overwritten. An athlete locked by a venue adoption is registered but never updated.

### The preview

Shown on every run, before anything is written:

- **Per-event cards** — to register / already registered / flagged, so you can check the counts against SkiReg's own category totals.
- **To Register** — name, USSS #, birth year, club, bib, the events, and where the identity came from (USSS #, FIS id, People File, name match, New).
- **Needs Attention** — rows that are *not* registered unless you tick them: no USSS People File match, several People File records with the same name (the candidates are listed), the same USSS number on two names in the file, a USSS number or birth year that could not be read, a gender that disagrees with the category text, an unknown code in the Events column. Ticking a row registers it as read; a registration without a USSS number or birth year is legal and shows as the usual red row on the Registration tab, where it can be completed later.
- **Already Registered** and, from an event's tab, **Not in This Event**.

**Confirm Import** writes the athletes and registrations (bib from the file's bib column — the mogul row's bib on a SkiReg file; a blank bib never clears one), records one audit entry, and saves the entry mappings. Re-importing the same file registers nothing new. Afterwards the Registration tab offers **Sync with USSS Database** to fill anything still missing, and bibs are assigned as usual — see [Bib assignment](./reg-bibs).

### Notes

- Registration is done on the cloud ahead of the meet. The importer refuses a meet that is adopted by a venue server.
- Nothing in the import depends on an outside service; the USSS People File is the local synced copy.
- The Athletes page's **Import CSV** panel reads files the same way but updates the master table only — it never registers anyone.
