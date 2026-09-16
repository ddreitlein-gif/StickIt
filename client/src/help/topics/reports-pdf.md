## PDF reports

StickIt generates a family of PDF reports server-side via pdfkit. They're available from the **Reports** tab on the event detail page (or via direct API calls from `server/routes/pdf.js`).

### Event Results Summary

The headline deliverable. Lists every athlete in rank order with all component scores. Format adapts by event type:

- **Standard mogul** — Place, Bib, Athlete, Club, Turns, Air, Time, Speed, Total.
- **Best of 2** — adds Run 1 / Run 2 columns; Total = the better run, with the starred run column indicating which one.
- **Qualifier/Finals** — adds Q1 / F1 / F2 columns.
- **Aerials** — Place, Bib, Athlete, Club, Jump 1, Jump 2, Air-no-DD, Form, Landing, Total.
- **Dual mogul** — uses the [Final Place List](#final-place-list) format (see below).

Includes meet header (name, location, date), event header (name, discipline, gender), and tie-break notation.

### Logos on PDF reports

Two optional meet-level images can be uploaded from the **PDF Reports** tab (PNG or JPEG, up to 5 MB each). Both are stored per meet, so every event in the meet shares them, and both travel with the meet through export/import and venue adoption.

- **Event Logo** — printed in the upper-right corner of the header on every page, opposite the USSS logo.
- **Bottom Logo** (v2.3.01) — a sponsor strip printed centered across the bottom of the **first page only**, scaled to at most 1.5 inches high and no wider than the page content area. Page 1's content stops above it; later pages use the full page.

Use **Remove Logo** beside either control to clear it.

### Check Sheet by Bib

Sorted by bib number. Used by judges and the TD during the meet for quick lookup. One row per athlete with each run's score on its own row.

### Check Sheet by Run Order

Same data, sorted by run order. Mirrors how athletes appeared on the start list.

### Start List

Run order, bibs, names, clubs. Used pre-event to confirm the day's lineup.

### TD Report (USSS Freestyle Technical Delegate Report)

The official sign-off document. Lists the meet, every event, results summary, judging panel, and a "Send to" line:

> USSS Freestyle Head TD, ResultPackets@ussa.org, Organizing Committee, Division Head TD

Updated in v1.16.03 — title and instructions reference "USSS" (not "USSA").

### Dual Bracket (compact)

Tree-format bracket PDF. Page count scales by bracket size:

- **16 athletes** → 1 page
- **32 athletes** → 2 pages
- **64 athletes** → 3 pages

Each match shows blue/red athlete names, scores split (`2+5+0+4+0=11`), and the winner. Consolation matches (3rd/4th, optional 5/6 + 7/8) live on the finals page below the main tree. Final-place medals (`1st`, `2nd`, `3rd`, `4th`, etc.) annotate the finals matches in gold / silver / bronze / gray.

### Bracket Keeper (dual mogul)

The hand-kept bracket for the start area, in the plain line-tree form officials know from Winfree (v2.6.02). Portrait Letter; one line per skier. Nothing is written on it but names: the keeper records who won by copying the winner onto the next line.

- Every skier known when the sheet is printed is on their line as **bib  LAST, First  (seed)**. A line still to be filled is left clear for the handwritten name; under it, small, is who fills it: **Won W-03** or **Lost W-06** (with the page number when that match is on another page). A bye leaves its first-round space blank and the athlete is already printed on the line they enter.
- The pairing label (`W-03`, `M-14`, the same numbers as the tablets, the Scoring tab and the Broadcast Board) sits in a small oval at each junction; the course word (Blue / Red) is under the right end of every line, per USSS/FIS 4310.3.1, red on top in odd rounds as on the other bracket views.
- The end of each deciding line carries the placing: **1st** (loser 2nd), **3rd**, **5th**, **7th**.
- Sections: a 16 shell is one tree, *Round of 16 to Final*, followed by *3rd / 4th Place*, *5th – 8th Place* and *7th / 8th Place* (2 pages, 1 without Runoff to 8th; an 8 shell likewise). A 32 shell prints four *Round of 32 to Quarter-Finals* sections (two per page, each ending "to W-nn (p.3)") and a *Semi-Finals and Final* page with the consolation trees (3 pages). A 64 shell prints eight sections to the Round of 16 and a *Quarter-Finals to Final* page with the consolation trees (6 pages).
- Printed mid-day, the same sheet shows the results so far on the lines; the layout never moves.

### Final Place List (dual mogul)

Ranked list of dual mogul athletes with their representation (club) and FFSP points. Status indicators for DSQ / DNS / SCR / DNF athletes.

### Calculation Report

A detailed per-run computation breakdown. Shows the formula used (e.g., `(judge scores: 4.5 + 5.0 + 4.5) × DD 0.49 = 6.61`), so the TD can verify the engine matches the rule book on every run. Especially useful for aerials.

### Calling the PDFs

Each PDF has its own endpoint under `/api/pdf/...`:

- `event-results`
- `check-sheet-bib`
- `check-sheet-runorder`
- `start-list`
- `td-report`
- `dual-bracket`
- `bracket-keeper`
- `dual-results`
- `calc-report`

All return `application/pdf` with `Content-Disposition: attachment`. The browser downloads them automatically.

### Truncation rule

All numeric values in PDFs are **truncated** (floored) to 2 decimals per FIS rule. DD values are preserved at full precision. Pace time is also truncated. This matches the engine's runtime behavior — PDFs and live scores show the same numbers.

### Layout

Letter-size, portrait by default. Most reports use a 10pt body with a 14pt title block. Spaced grids and clean column headers. The compact dual bracket PDF uses a tighter 7pt body to fit the tree.
