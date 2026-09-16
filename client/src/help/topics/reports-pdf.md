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

The hand-kept bracket for the start area (v2.6.01 redesign). It is filled in by coaches, the starter and volunteers, in pencil, outdoors — nobody writes scores on it; they record who won and copy the winner into the next match. Landscape Letter, and every label on it comes from the bracket StickIt built:

- **Match boxes** — a header strip with a tick box, the pairing label (`W-03`, `M-14` — the same numbers as the tablets, the Scoring tab and the Broadcast Board) and the round, then the two forward pointers in the same place on every box: **WINNER → W-10 · BLUE · PG.2** over **LOSER → W-08 · RED · PG.3** (courses per USSS/FIS 4310.3.1, `PG.n` when the destination is on another page, `LOSER → ELIMINATED` when there is none). Place-deciding matches show the placing instead (**CHAMPIONSHIP FINAL · 1ST / 2ND**, **THIRD / FOURTH**, …).
- **Rows** — a stub cell with the course badge (BLUE is a solid badge, RED an outlined one, so the two survive a monochrome copier) over the origin of that slot (**SEED 5**, **BYE · SEED 1**, **WINNER W-03**, **LOSER W-06**), a ruled **BIB** cell, and the **NAME** field. Red is on top in odd rounds and blue in even ones, exactly as the printed brackets and the tablets. Seeded entrants are pre-printed with bib and name; the volunteer writes only from the second round on.
- **Byes** — a one-line strip (badge, bib, name, **DOES NOT SKI → W-03 · RED**, and **ALREADY ON PAGE 2** when that match is on another page). The athlete is also pre-printed in the slot they enter, labelled **BYE · SEED n**.
- **Winner marking** — circle the winner's bib. A match that is already complete when the keeper is printed shows both names with a printed circle around the winner's bib, so a mid-day print reads the same as a hand-filled one, and the page layout is identical before and after.
- **Connector lines follow winners only.** Losers are named in words — in the header pointer and in the destination stub. Boxes with no incoming line carry the action instead (**COPY BOTH SEMIFINAL LOSERS IN BY HAND**).
- **Page furniture** — a run-order strip across the top of every page (one cell per match in pairing order with its location, `R16 HERE` / `QF PG2`, shaded for the matches on that page; on 32 and 64 shells only the matches on the page plus where their output goes), an instruction line, a **How to keep this bracket** block and a **Start list** (seed, bib, name, first match and course) on page 1 of a 16 shell, and on the last page the **Final result** panel — places 1–8 (1–4 for Runoff to 4th, 1–2 with no runoff), each pre-labelled with its source (**WINNER W-14**, **LOSER W-13**, …) and filled in once the deciding matches are complete.

**Page plans** are driven by the actual mix of matches and byes, not by the shell size alone. A 16 shell prints the Round of 16 in one column on page 1 (with the how-to and start list beside it), the quarterfinals → semifinals → championship final with the 3rd/4th box on page 2, and the 5th–8th runoff with the result panel on page 3 (2 pages for Runoff to 4th or no runoff). 8-, 4- and 2-athlete shells take one page (plus a runoff page). A 32 shell prints one quarter of the draw per page (Round of 32 → Round of 16 → quarterfinal, so the only cross-page carry is the quarterfinal's winner and loser) and the semifinals, 5–8 semifinals, all four finals and the result panel on page 5. A 64 shell uses a compact four-column box. Writing rows are ½ inch high (growing when the page allows) and never shrink below that: a first column that cannot fit on one page — a Round of 16 with no byes, a quarter of a near-full 64 draw — spills onto a second page instead (**ROUND OF 16 · PART 1 OF 2**), with the pointers naming the pages.

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
