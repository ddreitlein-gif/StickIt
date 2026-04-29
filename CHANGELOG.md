# Changelog — Older Versions (v1.7.00 – v1.9.16)

For version notes v1.10.00 and later, see CLAUDE.md.

---

## v1.9.16 Feature Notes

### Alternating Blue/Red Course Assignment (v1.9.16)

Dual mogul bracket rounds now alternate which course athletes are assigned to. Top seed starts on blue in round 1, switches to red in round 2, back to blue in round 3, etc. This applies at the data level (which DB slot a winner advances into) and the visual level (which color box renders on top).

**Data-level alternation (`server/routes/dual.js`):** New `advancementSlot()` helper computes the correct `registration_id_blue`/`registration_id_red` column for winner advancement based on bracket position, bracket round, and total rounds. Used by both `advanceWinner()` and bye auto-advancement in `populateFirstRoundFromPlacement()`. Formula: `shouldFlip = (totalRound - bracketRound) % 2 === 0`.

**Visual alternation:** All bracket displays compute `redOnTop = (totalRound - bracket_round) % 2 === 1` to determine render order. Applied to:
- Bracket tab (`SimpleBracketCard`) in `EventDetail.jsx`
- Scoring tab (`MatchRow`) in `EventDetail.jsx`
- Results tab (`MatchCard` in `DualBracketResults`) in `EventDetail.jsx`
- Dual bracket PDF (`drawMatch()`) in `pdf.js`
- Bracket keeper PDF (`drawBKMatch()`) in `pdf.js`

**Judge tablets unchanged:** Blue always remains on left, red on right regardless of round.

**Consolation matches:** Never alternate — consolation has no seed-path concept, uses first-available-slot assignment.

### Consolation Layout & Naming (v1.9.16)

**Finals column consolidation:** Small Final moved from a separate "Consolation" section at the bottom into the finals column directly below Big Final. For `runoff_to_8th` events, "5th / 6th Runoff" and "7th / 8th Runoff" also appear in the finals column. Applied to Results tab bracket tree, Scoreboard bracket tree, and bracket PDFs.

**Renamed labels:** "Final"/"Championship Final" → "Big Final", "3rd / 4th Place" → "Small Final" across all three `roundLabel` functions (Scoring tab, Bracket tab, Results tab) and PDF bracket views.

### Scoreboard Bracket Tree (v1.9.16)

Replaced the simple completed-matches table on the dual mogul live scoreboard (`Scoreboard.jsx`) with a bracket tree visualization matching the Results tab's `DualBracketResults` layout.

**New components:** `SbMatchCard` with `athleteRow` helper renders compact match cards with color dots, athlete names, scores, and winner highlighting. `sbRoundLabel()` provides round column headers.

**Layout:** Horizontal scrollable flex container with columns per round (left = earliest, right = finals). Finals column includes Big Final + consolation matches below. Blue/red alternation matches the Results tab. Dark scoreboard theme (`bg-gray-900`, `bg-gray-800`).

**"Now Competing" section unchanged** — remains at top of scoreboard above the bracket tree.

**Live updates:** Bracket tree refreshes via existing WebSocket subscription and polling, same as before.

**Files modified:** `server/routes/dual.js`, `server/routes/pdf.js`, `client/src/pages/EventDetail.jsx`, `client/src/pages/Scoreboard.jsx`, `client/src/components/Layout.jsx`, `server/index.js`

---

## v1.9.15 Feature Notes

### Results Tab Bracket — Score Display Fix (v1.9.15)

Fixed match scores not appearing on the Results tab bracket view (`MatchCard` in `DualBracketResults`). Scores (e.g., "21", "4") now display correctly on completed matches.

**Root cause:** `MatchCard` computed totals from individually fetched judge point rows (`getScoreInfo`), which returned null totals when judge points weren't available. The bracket API already returns `blue_total`/`red_total` via SQL subqueries — switched to using those directly, matching the Bracket tab's `SimpleBracketCard` approach.

**Text sizing:** Score totals and DNS/DNF/DSQ status text changed from `text-base` to inherit the card's `text-xs` size, matching athlete name text. Both remain bold and vertically centered in their respective boxes.

**Files modified:** `client/src/pages/EventDetail.jsx`, `client/src/components/Layout.jsx`, `server/index.js`

---

## v1.9.14 Feature Notes

### Bracket & Results Tab — Score Position Fix (v1.9.14)

Moved match score totals from the left side to the right side of athlete boxes on both the Dual Bracket tab and the Results tab bracket view, for a consistent layout across all bracket displays.

**Bracket tab (`SimpleBracketCard`):** Score totals (e.g., "21", "4") moved from left of athlete name to right side with `ml-auto`. DNS/DNF/DSQ status already displayed on the right — now both elements use the same positioning pattern.

**Results tab (`MatchCard` in `DualBracketResults`):** Score totals enlarged from small inline text to `text-base` bold white text on the right side. DNS/DNF/DSQ moved from a tiny `text-[10px]` badge inline with the athlete name to `text-base` bold white text on the right side, matching the Bracket tab style. Box sizes unchanged.

**Files modified:** `client/src/pages/EventDetail.jsx`, `client/src/components/Layout.jsx`, `server/index.js`

---

## v1.9.13 Feature Notes

### Bracket Keeper PDF — Remove Write-In Lines (v1.9.13)

Removed the horizontal write-in line from empty/TBD slots in the Bracket Keeper PDF. The box itself serves as the write-in area, so the line was redundant. Empty slots now show only the "Blue"/"Red" course label inside a clean empty box.

### Bracket Tab — DNS/DNF/DSQ Display Update (v1.9.13)

Changed DNS/DNF/DSQ status display on completed matches in the Dual Bracket tab. Previously shown as a small shaded badge inline with the athlete name. Now displays as large (`text-2xl`) bold white text on the right side of the athlete's box, visually matching the score totals on the left. Only appears on the losing athlete's row — nothing added to the advancing athlete.

**Files modified:** `server/routes/pdf.js`, `client/src/pages/EventDetail.jsx`, `client/src/components/Layout.jsx`, `server/index.js`

---

## v1.9.12 Feature Notes

### Bracket Keeper PDF (v1.9.12)

New "Bracket Keeper" PDF report for dual mogul events. Black-and-white bracket designed for spectators to follow along and record results by hand during the event.

**Features:**
- Seeded athletes show bib + name in their match slot
- Future/unplayed slots have a write-in line for hand-recording names
- Small "Blue" / "Red" labels below each athlete line (since printout is B&W, no color bars)
- Pairing numbers (e.g., W-01) in upper-right of each match box
- Same bracket layout structure as the full bracket PDF (qualifying pages, finals page, consolation section)

**New endpoint:** `POST /api/pdf/bracket-keeper` — accessible from PDF Reports tab under "Dual Mogul" section.

### Bracket PDF & UI Fixes (v1.9.12)

**Bracket PDF score position:** Score strings (`#+#+#+#=##`) moved from vertically centered to the bottom of each athlete's colored box for better readability.

**Bracket PDF round label overlap:** Fixed overlapping text where "Round of 32" / "Round of 16" labels collided with the "Road to Semi-Finals" subtitle. Added 14pt spacing reserve below the subtitle.

**Web Bracket Tab scores:** Completed matches on the Dual Bracket tab now display match totals (e.g., "21", "4") as large white text on the left side of each athlete's box. Data was already returned by the server — only the UI was missing the display.

### Pace Time Gender Fix (v1.9.12)

**Event Results Summary PDF:** Pace time now filtered by event gender. Female events show only "Pace Time — Female: Xs", male events show only "Pace Time — Male: Xs". Previously always showed both genders regardless of event.

**Run Results PDF:** Added gender-specific label to pace time display: "Pace Time (Female): Xs" or "Pace Time (Male): Xs". Previously showed generic "Pace Time" without gender.

### Code Refactoring (v1.9.12)

**Bracket PDF shared helpers:** Extracted ~200 lines of duplicated bracket logic into shared module-level helpers used by both `dual-bracket` and `bracket-keeper` endpoints: `BRACKET_SQL`, `parseBracketData()`, `buildBracketPairings()`, `buildBracketPositions()`, `drawBracketConnectors()`, `drawBracketSection()`, `renderBracketPages()`. Adding future bracket PDF variants is now trivial.

**Files modified:** `server/routes/pdf.js`, `client/src/pages/EventDetail.jsx`, `client/src/components/Layout.jsx`, `server/index.js`

---

## v1.9.11 Feature Notes

### Meet Export/Import (v1.9.11)

Full meet data transfer between StickIt instances via ZIP export/import.

**Export Meet** (`GET /api/meets/:id/export`): Downloads a ZIP containing `meet_export.json` with all meet data plus optional meet logo image. Accessible via "Export Meet" button on the meet detail page.

**Import Meet** (`POST /api/meets/import`): Uploads a ZIP file and creates a new meet with all data. Accessible via "Import Meet" button on the dashboard (meets list page). Shows summary of imported items on completion.

**Data included in export:** meet, events, athletes, registrations (with bib/seed/run order), judges, officials, course specs, runs with all scores, judge scores with TL components, dual bracket matches, dual judge points, heats, event phases, phase run order, run round status, and meet logo.

**NOT exported:** audit_log, usss_people, usss_sync_status, jump_dd_table (static reference data).

**ID remapping on import:** All UUIDs are regenerated to prevent collisions. Athletes are deduplicated by matching on USSA number, then FIS ID, then exact name+birth_year. Cross-event references (qualifier_event_id, finals_event_id) are remapped within the event map.

**New dependency:** `adm-zip` npm package for ZIP creation and extraction.

**Files modified:** `server/routes/meets.js`, `client/src/pages/Dashboard.jsx`, `client/src/pages/MeetDetail.jsx`, `client/src/components/Layout.jsx`, `server/index.js`

---

## v1.9.10 Feature Notes

### Dual Mogul Results & Bracket Improvements (v1.9.10)

**Bracket Tree on Results Tab:** Dual mogul events now show an interactive bracket tree visualization on the Results tab instead of the standard scoring table. Columns display each round (Round of 32 → Quarterfinals → Semifinals → Final) with match cards showing blue/red athletes, scores, and judge point splits. Consolation matches shown separately. Live WebSocket updates refresh the bracket as matches complete. Server-side `results.js` also returns bracket placements for export compatibility.

**Bracket PDF Scores:** Completed matches on the dual bracket PDF now display judge point splits in `#++#+#+#=##` format (e.g., `4+4+5+4+4=21`). Time-tied matches omit J4's 0. Winner backgrounds darkened for stronger contrast while remaining readable.

**Dual Results PDF Officials:** The Final Place List PDF now includes the officials/judges/course specs footer block. Previously missing the `drawOfficialsCourseFooter()` call.

**Dual Mogul Overlay Fix:** Fixed blank overlay after dual match scoring. Root cause: `PUT /:matchId/winner` endpoint broadcast only sent `winner` data, missing `blueTotal`, `redTotal`, `blue`, `red`, `bracketRound`, `isSmallFinal`. Now sends the full payload matching the `approve` endpoint format.

**Link Events Tab Hidden:** Removed from the tab bar per user request. Component code preserved for potential future use.

### Timekeeper Tablet Improvements (v1.9.10)

**Refresh Persistence Fix:** Timekeeper tablet now checks `run.run_time != null` on polling to restore "Time Submitted" state after page refresh, matching the judge tablet fix from v1.9.01.

**Manual Time Calculation:** New "Manual Time Calculation" button on the timekeeper tablet. Opens a modal with Top Timer and Bottom Timer fields accepting `hh:mm:ss.ss` format. Calculates run time via base-60 subtraction (bottom − top). Result auto-populates the time entry field; timekeeper must still press Submit. Supports `hh:mm:ss.ss`, `mm:ss.ss`, and `ss.ss` input formats.

### PDF Report Fixes (v1.9.10)

**Pace Time Gender Display:** Officials/course footer now shows "Pace: Female" for female events and "Pace: Male" for male events instead of always showing "Pace: Male" first. Score calculations were already correct (event.pace_time stores the gender-appropriate value at creation).

**3-Column Officials Layout:** Redesigned `drawOfficialsCourseFooter()` from 2-column to 3-column layout: Judges (left), Officials (middle), Course specs including pace time (right). Applied to all PDF reports that include this block (Run Results, Event Results Detailed, Group Detailed, Dual Results).

**Sub-Header Centering & Report Created:** `drawWinfreeSubHeader()` now uses equal-third column widths for proper centering. Added "Report Created" label above the date/time. Fixed discipline label for dual mogul events (`Dual Moguls` instead of `Dual_moguls`).

**Files modified:** `server/routes/dual.js`, `server/routes/results.js`, `server/routes/pdf.js`, `client/src/pages/EventDetail.jsx`, `client/src/pages/TimekeeperTablet.jsx`, `client/src/pages/Overlay.jsx` (no changes needed — fix was server-side), `client/src/components/Layout.jsx`, `server/index.js`

---

## v1.9.09 Feature Notes

### High Contrast Mode for Tablets (v1.9.09)

Per-device toggle for tablet use in bright sunlight. Adds a "Hi-Contrast" button to the header of Judge, Head Judge, and Timekeeper tablets. Setting persists in `localStorage` across page refreshes and runs until toggled back to "Normal".

**Visual changes when active:**
- All backgrounds (slate-950/900/800) → pure black
- All muted text (slate-300/400/500/600) → white
- All borders → white, thickened to 2px
- Quick-select buttons → black with white border
- Selected button rings → yellow
- Key score totals → yellow via `hc-score` CSS class
- Translucent badge backgrounds → solid colors

**Implementation:** CSS-based approach using `.hc` class on page root element. CSS overrides in `index.css` target Tailwind utility classes under `.hc` scope. No database or server changes — purely client-side via `localStorage`.

**Shared hook:** `useHighContrast()` in `client/src/hooks/useHighContrast.js` — returns `[hc, toggle]`. Used by all three tablet components.

**Toggle button:** Yellow pill in header when active, muted when inactive. Present in all tablet headers including dual mogul judge/HJ views and HJ review mode.

**Files modified:** `client/src/index.css`, `client/src/hooks/useHighContrast.js` (new), `client/src/pages/JudgeTablet.jsx`, `client/src/pages/HeadJudgeTablet.jsx`, `client/src/pages/TimekeeperTablet.jsx`, `client/src/components/Layout.jsx`, `server/index.js`

---

## v1.9.08 Feature Notes

### Dual Mogul Seed List USSS Rank Fix (v1.9.08)

Fixed USSS Rank column in the dual mogul seed list PDF showing rounded USSS point values (916, 912, 894...) instead of actual rank positions (1, 2, 3...).

**Root cause:** The `seed-usss` endpoint stored raw `dm_points` in `dual_seed_source_value` (e.g., `"USSS 916.25"`) instead of the computed rank position. The PDF regex then extracted "916" as the rank. The `seed-event-plus-usss` endpoint already computed rank correctly.

**Fix:** Changed `source_value` in `seed-usss` to store the rank position (`"USSS 1"`) derived from the sorted array index, matching the pattern used by `seed-event-plus-usss`.

**Seeding order unaffected:** The actual seed assignment was always correct (sorted by dm_points descending, seeds assigned sequentially). Only the display metadata was wrong.

**Note:** Existing events seeded via USSS Points mode must be re-seeded to regenerate the corrected source_value strings.

**Files modified:** `server/routes/dual.js`, `client/src/components/Layout.jsx`, `server/index.js`

---

## v1.9.07 Feature Notes

### Dual Mogul PDF Reports & PDF Fixes (v1.9.07)

**Dual Mogul PDF Reports:** Three new reports accessible from the PDF Reports tab when viewing a dual mogul event. Standard mogul-only sections (Run Order & Scoring Sheets, Run Results, Event Results) are hidden for dual events; Registration remains visible.

- **Seeding List** (`POST /api/pdf/dual-seed-list`): Shows seed number, bib, age group, name, club, MO place, USSS points, USSS rank, and seed source. Data parsed from `dual_seed_source_value` format strings. Portrait layout with `pdfHeader` + `drawWinfreeSubHeader` + `drawTable` + `stampFooter`.
- **Dual Bracket** (`POST /api/pdf/dual-bracket`): Existing bracket tree PDF upgraded with `pdfHeader()` for USSS logo (upper left), optional event logo (upper right), and `stampFooter()` for StickIt logo. Dynamic `BKTOP`/`BKH` to account for header height. Also accessible from PDF Reports tab (previously only on Dual Bracket tab).
- **Final Place List** (`POST /api/pdf/dual-results`): Placements derived from bracket outcomes — championship final winner=1st, loser=2nd, consolation matches for 3rd–8th, remaining athletes ordered by round proximity to final then by seed. Columns: Place, Bib, Gp, Name, Representing.

**Client (PdfReportsPanel):** Conditional rendering based on `event.discipline === 'dual_mogul'`. Dual events show Registration + Dual Mogul sections only. Run Number dropdown hidden for dual events. 

**PDF Fixes (all reports):**
- **Footer on blank page eliminated:** `stampFooter()` temporarily sets `doc.page.margins.bottom = 0` to prevent PDFKit auto-pagination when rendering footer near page bottom.
- **Manual Time Sheet grid lines fixed:** Grid line drawing refactored to per-page segments — `drawGridSegment()` called on each page break and after final row, instead of once at end with stale coordinates.
- **RUN/MALE/FEMALE box removed** from Manual Time Sheet header.
- **Representing column widened** on Event Results Summary and Group Summary (Name weight 2.5→1.8, Representing 1.8→2.5). Long club names truncate via `lineBreak: false`.
- **Registration moved to top** of PDF Reports panel, renamed to "Registration Listing - All Events".
- **StickIt logo optimized:** Resized from 1536×1024 (2.2MB) to 200px wide (18KB) — reduces zip file size by ~2MB.

**Files modified:** `server/routes/pdf.js`, `client/src/pages/EventDetail.jsx`, `client/src/components/Layout.jsx`, `server/index.js`, `server/public/logos/stickit.png`

---

## v1.9.06 Feature Notes

### PDF Reports Overhaul — Logos, Layout & Column Fixes (v1.9.06)

Comprehensive overhaul of all PDF reports with logo support, layout improvements, and column standardization.

**Logo Support:**
- **USSS logo** (upper left header) on all PDF reports. Static file at `server/public/logos/usss.png`.
- **Event/meet logo** (upper right header) — optional, uploaded per meet via PDF Reports tab. Accepts PNG/JPEG up to 5MB. Stored in `server/data/logos/meet_<id>.<ext>`. Upload/remove UI on PDF Reports panel.
- **StickIt logo** (lower right footer) on all reports except Manual Time Sheet. Static file at `server/public/logos/stickit.png`.

**New server endpoints:**
- `POST /api/pdf/upload-logo/:meetId` — upload meet logo (multer, PNG/JPEG)
- `DELETE /api/pdf/logo/:meetId` — remove uploaded meet logo
- `GET /api/pdf/logo/:meetId` — check if meet logo exists

**Global PDF fixes (all reports):**
- **Extra blank page eliminated:** `stampFooter(doc)` + `addPageWithFooter(doc)` pattern ensures footer renders on content page, not a separate page. All 8 `doc.addPage()` sites and 13 `pdfFooter()` sites replaced.
- **Navy blue header rows:** Default `#1B3A5C` for table headers (except timer sheet = `#1a1a1a` for B&W printing).
- **Gp column after Bib:** Standardized across all reports — run order, check sheets, event results (summary, detailed, group summary, group detailed), registration, legacy results, phase run order.
- **Sort label styling:** Rendered bold without parentheses in Winfree sub-header.
- **Dynamic run label:** `drawWinfreeSubHeader` accepts `runNumber` parameter; no longer hardcoded "Run 1".

**`drawTable` enhancements:**
- `opts.headerColor` — custom header background (default navy blue)
- `opts.gridLines` — draws horizontal/vertical grid lines instead of alternating row shading
- `opts.verticalCenter` — centers text vertically in tall rows
- `opts.footerOpts` — passed through to `stampFooter` on page breaks (used by timer sheet to skip logo)

**Per-report changes:**
- **Run Order:** Accepts `sort` param from client; when alphabetical, removes Ord column and gives Name extra width.
- **Manual Time Sheet:** Removed Gp column. Grid lines mode with 32px rows, centered text, black header, no StickIt logo.
- **Check Sheets (by Bib + by Run Order):** Switched to landscape. Removed Club column, added Gp. Added per-judge score columns (TL1-3, Air1-2, Jump Code, Speed, Total) via `fetchRunJudgeScores`.
- **Run Results:** Title shows "Run 1"/"Run 2"/"Final Results" dynamically. `runNumber='final'` aggregates all runs using `buildResultsData`.
- **Event Results Summary:** Column order: No, Bib#, Gp, Name, Representing, Score. Pace time display fixed from `Male = 23.56` to `Pace Time — Male: 23.56s` in gray.
- **Event Results Group Summary:** Same column reorder as Summary.
- **Event Results Detailed + Group Detailed:** `drawDetailedResultsTable` columns reordered: No, Bib, Gp, Name, Rep.
- **Registration:** Changed to meet-wide scope (all events in meet, deduped by athlete). Removed Nation column. Added Gp column. Event abbreviations: M for mogul, DM for dual_mogul, numbered (M1, M2, DM1, DM2) when multiple events of same discipline.
- **Legacy Results (`generateResultsPdf`):** Added Gp column with `computeAgeGroup` enrichment.
- **Phase Run Order:** Added Gp column with `computeAgeGroup` enrichment.

**Client changes (EventDetail.jsx — PdfReportsPanel):**
- **Phase-aware dropdown:** Fetches phases via `api.getPhases()`. When phases exist, shows phase labels; otherwise shows Run 1, Run 2. Always includes "Final Results" option.
- **Sort pass-through:** Run order opts now sends `{ runNumber, sort }`.
- **Event logo upload:** File input (PNG/JPEG) with upload/remove buttons, status indicator.

**Files modified:** `server/routes/pdf.js`, `client/src/pages/EventDetail.jsx`, `client/src/components/Layout.jsx`, `server/index.js`, `server/public/logos/` (new: usss.png, stickit.png)

---

## v1.9.05 Feature Notes

### PDF Reports Tab Redesign — Winfree-Style Reports (v1.9.05)

Redesigned the PDF Reports tab to mirror Winfree's print functionality with a cleaner UI. Replaced 3 existing reports, added 5 new report types, and reorganized the tab into 4 sections.

**New UI Layout:** PDF Reports tab now organized into sections: "Run Order & Scoring Sheets", "Run Results", "Event Results", and "Registration". Run Number dropdown (Run 1/2/3) replaces the old Round dropdown for run-specific reports.

**New report types:**
- **Run Results** — Winfree-style detailed per-run results with per-judge T&L scores (J.1, J.2, J.3), per-jump air scores (J.4, J.5) with jump codes and DDs, DofD, Airs total, Judge total, Time, Speed Pts, Run total. 2 lines per athlete, landscape layout.
- **Event Results (Summary)** — Simple place/bib/name/group/club/score listing. Phase-aware (auto-detects Qualifier/Finals).
- **Event Results (Detailed)** — All runs per athlete with full scoring breakdown + Event total column. Landscape layout.
- **Event Results (Group Summary)** — Results grouped by USSS age category (F15, M17, etc.) with separate ranking per group.
- **Event Results (Group Detailed)** — Detailed scoring grouped by age category.

**Replaced reports:**
- "Start List" → **Run Order (Single Space)** — Compact 3-column entrants list (Ord, Bib, Name, Gp, Rep) fitting all athletes on fewer pages.
- "Hand Timing Sheet" → **Manual Time Sheet** — Triple-spaced with Start#, Bib#, Name, Gp, Top Time, Bottom Time columns plus RUN/MALE/FEMALE header box.
- "Results" — Replaced by the new Run Results and Event Results variants (old endpoint kept for backward compat).

**Officials + Course Specs footer:** Detailed reports (Run Results, Event Results Detailed, Group Detailed) include an officials and course specs block at the END of the document showing Head Judge, Chief of Comp, TD, Chief of Scoring, each judge with role label, plus course name, length, width, pitch, and pace times.

**Age group derivation:** `computeAgeGroup()` helper derives USSS age group codes (11, 13, 15, 17, 19, Sr) from birth year relative to competition season year.

**Winfree-style sub-header:** All reports include a metadata sub-header showing discipline, run number, gender, location, event name, sort order, date, and time.

**Check sheets updated:** Check Sheet by Bib and Check Sheet by Run Order now accept `runNumber` (integer) instead of `round` (string) for run selection.

**Files modified:** `server/routes/pdf.js`, `client/src/pages/EventDetail.jsx`, `client/src/components/Layout.jsx`, `server/index.js`

---

## v1.9.04 Feature Notes

### Ranking / Place Bug Fix (v1.9.04)

Fixed bug where every athlete showed as rank 1 on the Scoreboard, Overlay, and all results endpoints. Root cause: `tieBreak()` in `server/scoring/engine.js` referenced `.total`, `.airRaw`, `.turnsRaw`, `.speedRaw` but database rows use `.total_score`, `.air_score`, `.turns_score`, `.speed_score`. All comparisons evaluated to `NaN`, so every pair appeared tied. Fixed by supporting both naming conventions via nullish coalescing (`??`).

**Affected areas:** Scoreboard rankings, Overlay place display, Results API, PDF results, CSV/XLSX exports — all flow through `rankResults()` which calls `tieBreak()`.

### USSS Code Consolidation (v1.9.04)

Replaced separate "USSS Code (Men)" and "USSS Code (Women)" fields with a single "USSS Code" field per event. Events are gender-specific so only one code is needed.

**Database:** New `events.usss_code` TEXT column. One-time migration copies the gender-appropriate value from the old `usss_code_men`/`usss_code_women` columns.

**Files modified:** `server/scoring/engine.js`, `server/db/schema.js`, `server/routes/events.js`, `server/routes/meets.js`, `client/src/pages/EventDetail.jsx`, `client/src/components/Layout.jsx`, `server/index.js`

---

## v1.9.03 Feature Notes

### Overlay Text Readability Fix (v1.9.03)

Fixed white-on-white readability issue in broadcast overlays where gradient backgrounds faded to fully transparent, making text invisible against light backgrounds.

**Changes:**
- **Gradient endpoints:** All overlay gradients (name bar, score bar, dual blue/red bars) now maintain 75% minimum opacity at the trailing edge instead of fading to 0%. The fade effect is preserved but text always has sufficient contrast.
- **Text shadow:** Added `0 2px 6px rgba(0,0,0,0.6)` dark text shadow to all overlay text elements (bib, name, club, score, place, dual labels, dual totals) for broadcast-quality definition.

**Applies to:** Single mogul name bar, single mogul score bar, dual mogul blue and red bars (including score totals and WINNER/placement labels).

**Files modified:** `client/src/pages/Overlay.jsx`, `client/src/components/Layout.jsx`, `server/index.js`

---

## v1.9.02 Feature Notes

### Dual Mogul Head Judge Tablet Landscape Redesign (v1.9.02)

Redesigned the dual mogul Head Judge tablet (`DualHeadJudgeView` in `HeadJudgeTablet.jsx`) from a narrow single-column portrait layout to a full-width landscape layout matching the standard mogul HJ tablet style.

**Layout:**
- **Full-width athlete bar** across the top: Blue athlete (name + bib) on the left, "vs" with pairing label and round info in the center, Red athlete (name + bib) on the right
- **Two-column grid** below: `grid-cols-[1.5fr_1fr]`
  - **Left column:** All 5 judge point splits (J1 Turns, J2 Turns, J3 Air, J4 Time, J5 Overall) with inline reject confirmations
  - **Right column:** Running totals / Final result box, score status (judges pending count), Accept and Submit Score button, Set Match Status (DNS/DNF) buttons
- **Next Pairing** card spans full width above the two-column layout when no match is active or after match completion
- **Waiting state** shown only when no active match AND no next pairing available

**No logic or state changes** — all existing functionality (reject, approve, DNS/DNF, next pairing/start run, WebSocket updates) preserved as-is. Only the JSX layout was restructured.

**Files modified:** `client/src/pages/HeadJudgeTablet.jsx`, `client/src/components/Layout.jsx`, `server/index.js`

---

## v1.9.01 Feature Notes

### FIS Score Card Quick Reference on Judge Tablet (v1.9.01)

Persistent reference side panel on judge tablets showing FIS scoring criteria. Layout expanded from `max-w-lg` to `max-w-5xl` two-column grid for landscape use.

**TL judges (component scoring ON):** Carving (50%), Ab/Ext (25%), UB (25%) ranges (Poor through Excellent) plus deduction guidelines with descriptions.

**TL judges (component scoring OFF):** T&L Total ranges using doubled carving scale (Poor 0.1–4.0 through Excellent 16.1–20.0) plus deductions.

**Air judges:** Jump quality ranges (Very Poor 0.1–2.0 through Excellent 8.1–10.0) plus quality criteria (Athleticism, Control, Balance, Landing continuity), Air (Height and Distance), and Fluidity.

**Layout:** Two-column grid `grid-cols-1 lg:grid-cols-[1fr_280px]`. Scoring inputs on left, sticky reference panel on right in landscape. Stacks vertically on portrait. "Now Scoring" athlete bar spans full width above both columns.

**PDF download:** FIS score cards (copyright-free) stored in `server/public/docs/`. TL judges see T&L card download link; Air judges see Air card download link.

### Overlay Visual Refresh (v1.9.01)

Modernized lower-third overlays with broadcast-style gradient treatment for YoloBox/OBS.

- **Name bar:** wider (maxWidth 1300px from 1020px), gradient fade from solid navy to transparent (left to right), cyan accent bottom border, asymmetric rounding (8px left, flat right)
- **Score bar:** gradient background, more padding (28px 80px), cyan accent line
- **Dual bars:** wider (840px from 760px), blue/red gradients with fade to transparent, asymmetric rounding (inner corners), lighter shade accent bottom borders
- **General:** reduced border-radius for less boxy appearance, softer box shadows

**Files modified:** `client/src/pages/JudgeTablet.jsx`, `client/src/pages/Overlay.jsx`, `client/src/components/Layout.jsx`, `server/index.js`, `server/public/docs/` (new: FIS score card PDFs)

### Bug Fixes (v1.9.01)

- **DNF/DNS/DSQ with scores entered:** `PUT /:runId/status` now clears `hj_pending=0` and nulls out `turns_score`, `air_score`, `speed_score`, `total_score`. Previously a run in `hj_pending=1` state stayed pending after DNF, and retained stale speed scores.
- **Dual mogul 5-judge requirement:** Match no longer transitions to `hj_pending` until all 5 judges have submitted scores. Previously 4 judges with a lopsided split could trigger premature finalization.
- **Dual HJ tablet judge role labels:** All 5 judges now show role: J1 (Turns), J2 (Turns), J3 (Air), J4 (Time), J5 (Overall). Previously J1-J3 had no label.
- **Duplicate jump code message:** Corrected from "minimum DD (1.00)" to "DD 0.00 (no credit for repeated jump)" — matches actual server behavior where `dd2=0`.
- **Judge tablet refresh persistence:** On page refresh/reopen, judge tablet now checks the `submitted` array from `/runs/active` to restore "Score Submitted" state instead of showing the entry form again.
- **Phases tab auto-refresh:** `HeatsPanel` (Phases tab) now has WebSocket subscription for `score_update`, `run_updated`, `phase_created`, `phase_deleted`, `run_round_status` — previously required manual page refresh after HJ approvals.

**Files modified:** `server/routes/runs.js`, `server/routes/dual.js`, `client/src/pages/HeadJudgeTablet.jsx`, `client/src/pages/JudgeTablet.jsx`, `client/src/pages/EventDetail.jsx`

---

## v1.9.00 Feature Notes

### Multi-Phase Workflow for Moguls (v1.9.00)

Adds a flexible multi-phase system for mogul events supporting Best of 2, Qualifier/Finals, and extended formats used in USSS and FIS competitions. No up-front format lock — format is derived from which phases are added.

**Phase types:**
| Phase | Label | run_number |
|---|---|---|
| Initial run | Run 1 (or Qualifier 1 when Q2 added) | 1 |
| Best of 2 | Run 2 | 2 |
| Qualifier 2 | Qualifier 2 | 2 |
| Final 1 | Final 1 | 2 or 3 |
| Final 2 | Final 2 | N+1 |

**Database:** Two new tables:
- `event_phases`: `id`, `event_id`, `phase_type`, `run_number`, `label`, `run_order_method`, `pass_through_count`, `final_size`, `status`, `review_message`, `sequence_order`, `created_at`, `updated_at`
- `phase_run_order`: `id`, `phase_id`, `registration_id`, `run_order` (UNIQUE on phase_id + registration_id)

**Phase status lifecycle:** `not_started` → `in_progress` → `complete` → `hj_review` → `finalized` (same as run_round_status but per-phase)

**Eligible athletes per phase:**
- Run 1 / Qualifier 1: all registered
- Run 2 (Best of 2): all registered
- Qualifier 2: all EXCEPT top `pass_through_count` from Q1
- Final 1: pass-through from Q1 + top from Q2 (up to `final_size`)
- Final 2: top `final_size` from Final 1

**Run order methods:** Same, Random, Last to first, 16 down

**Phase-based ranking:**
- Best of 2: best score from Run 1 and Run 2 (MAX)
- Qualifier/Finals (tiered): Final 2 > Final 1 > Qualification. Athletes in higher tier always outrank lower tier regardless of raw score.

**Backward compatibility:** Events without phases work exactly as before. All endpoints check for phase existence and fall back to legacy behavior.

**New server route file: `server/routes/phases.js`**
- `GET /api/events/:eventId/phases` — list all phases
- `POST /api/events/:eventId/phases` — create next phase (with config)
- `DELETE /api/events/:eventId/phases/:phaseId` — cancel/delete phase
- `POST /api/events/:eventId/phases/:phaseId/finalize`
- `POST /api/events/:eventId/phases/:phaseId/send-review`
- `POST /api/events/:eventId/phases/:phaseId/approve`
- `POST /api/events/:eventId/phases/:phaseId/return`
- `POST /api/events/:eventId/phases/:phaseId/reopen`
- `GET /api/events/:eventId/phases/:phaseId/eligible` — eligible athletes + run order
- `GET /api/events/:eventId/phases/results` — phase-based results

**New PDF endpoint:** `POST /api/pdf/phase-run-order` — per-phase run order PDF (Order, Bib, Athlete, Club, YOB columns)

**Phase-aware updates across existing files:**
- `server/routes/runs.js`: Run blocking checks `event_phases` status when phases exist. `next-up` endpoint uses `phase_run_order` for ordering and filters by active phase's `run_number`. `GET /active` returns phase-specific `run_position` and `total_runners`. Round-status includes phase labels.
- `server/routes/results.js`: Tiered ranking for qualifier/finals events, best-of-2 for run events
- `server/routes/export.js`: `getPhaseAwareResults()` helper shared across all 5 export endpoints
- `server/routes/pdf.js`: `buildResultsData()` and `fetchAthletes()` are phase-aware. `pdfFooter()` redesigned with full-width centered positioning at page bottom.
- `server/routes/registrations.js`: Reorder and random-order endpoints sync Phase 1's `phase_run_order`
- `client/src/pages/EventDetail.jsx`: New Phases tab with phase management UI. Scoring tab shows collapsible sections per phase (active phase auto-expanded, completed phases minimized with expand arrow). ManualScoreModal accepts `runNumber` prop. ResultsPanel shows tier section headers for phase events.
- `client/src/pages/TimekeeperTablet.jsx`: Phase-aware next-up with phase labels on buttons
- `client/src/pages/HeadJudgeTablet.jsx`: Review mode shows phase label in title
- `client/src/pages/Scoreboard.jsx`: Phase-aware display
- `client/src/utils/api.js`: Phase API functions added
- `server/index.js`: Phases router mounted

**Files modified:** `server/db/schema.js`, `server/routes/phases.js` (new), `server/routes/runs.js`, `server/routes/results.js`, `server/routes/export.js`, `server/routes/pdf.js`, `server/routes/registrations.js`, `client/src/utils/api.js`, `client/src/pages/EventDetail.jsx`, `client/src/pages/TimekeeperTablet.jsx`, `client/src/pages/HeadJudgeTablet.jsx`, `client/src/pages/Scoreboard.jsx`, `client/src/components/Layout.jsx`, `server/index.js`

---

## v1.8.03 Feature Notes

### Run Round Status & Head Judge Run Review (v1.8.03)

**Run Round Status box in Runs tab:** A status card at the top of the Runs (Heats) tab tracks overall progress per run number (Run 1, Run 2, etc.). Displays:
- Run name (default "Run N")
- Completion count: `X/Y complete`, `Remaining Z`
- Status badge: Not Started, In Progress, Complete, Sent to Head Judge, Finalized
- Action buttons when all athletes are complete: "Finalize Run" and "Send to Head Judge for Review"
- "Reopen Run" button when finalized (reverts to Complete)
- Review message banner when HJ returns run for review

**Run Round Status lifecycle:**
- `not_started` → `in_progress` (auto, when first athlete starts)
- `in_progress` → `complete` (auto, when all athletes finished)
- `complete` → `finalized` (via "Finalize Run" button)
- `complete` → `hj_review` (via "Send to Head Judge for Review")
- `hj_review` → `finalized` (HJ approves)
- `hj_review` → `complete` (HJ returns, with message)
- `finalized` → `complete` (via "Reopen Run")

**Run N+1 blocked until Run N finalized:** Server enforces that Run 2 cannot start until Run 1 is finalized. Individual run reopening is also blocked while the round is finalized.

**Head Judge Run Review mode:** When a run is sent for HJ review, the Head Judge tablet replaces its normal live-scoring view with a review table showing:
- All athletes in place order (by total score descending)
- Columns: Place, Athlete Name, Bib, each TL judge score, each Air judge score, Time Points, Actual Time, Final Score
- DNS/DNF/DSQ athletes listed at bottom with status shown in place column
- "Approve and Finalize Run" button — finalizes the round
- "Return to Scoring for Review" button — returns round to Complete with review message
- Normal live-scoring view resumes automatically after approve/return

**Database:** New `run_round_status` table with `event_id`, `run_number`, `status`, `review_message`, `updated_at`. Primary key is `(event_id, run_number)`.

**New server endpoints (all in `server/routes/runs.js`):**
- `GET /round-status` — computed run round statuses with completion stats
- `POST /round-status/:runNumber/finalize` — finalize a run round
- `POST /round-status/:runNumber/send-review` — send to HJ
- `POST /round-status/:runNumber/approve` — HJ approves and finalizes
- `POST /round-status/:runNumber/return` — HJ returns for review
- `POST /round-status/:runNumber/reopen` — reopen a finalized round
- `GET /round-review/:runNumber` — scores in place order for HJ review

**New client API functions:** `getRunRoundStatus`, `finalizeRunRound`, `sendRunRoundReview`, `approveRunRound`, `returnRunRound`, `reopenRunRound`, `getRunRoundReview`

**Files modified:** `server/db/schema.js`, `server/routes/runs.js`, `client/src/utils/api.js`, `client/src/pages/EventDetail.jsx`, `client/src/pages/HeadJudgeTablet.jsx`, `client/src/components/Layout.jsx`, `server/index.js`

---

## v1.8.02 Feature Notes

### UI Cleanup & Scoring Improvements (v1.8.02)

**"Heats" tab renamed to "Runs":** Tab label changed from "Heats" to "Runs" across the event detail page. Internal component (`HeatsPanel`) unchanged.

**Time entry removed from Scoring tab:** The "Finish Time (seconds)" input and "Submit Time" button have been removed from the Currently Scoring panel. Time is now entered only via the Timekeeper tablet or Manual Entry modal.

**Manual Entry for scoring-status athletes:** In tablet mode, a "Manual Entry" button now appears in the Currently Scoring panel (alongside Cancel Run and Undo Last Score). This allows admins to manually enter scores for an athlete whose run is in progress. The manually entered score is immediately finalized (no Head Judge approval required) and can be edited later via "Edit Score" in Run History.

**Delete Event button:** Each event card on the Meet Detail page now shows a red "Delete" button. Clicking it displays a confirmation warning: "All data for this event will be permanently deleted. This action cannot be undone."

**Files modified:** `client/src/pages/EventDetail.jsx`, `client/src/pages/MeetDetail.jsx`, `client/src/components/Layout.jsx`, `server/index.js`

---

## v1.8.01 Feature Notes

### Native PDF Generation (v1.8.01)

Replaced all Python-based PDF generation (`generate_pdf.py` via `execFile`) with native pdfkit. Eliminates errors on Railway and computers without Python installed.

**Converted endpoints (all in `server/routes/pdf.js`):**
- `POST /api/pdf/results` and `GET /api/pdf/results/:eventId` — Results PDF with Time column (non-aerials)
- `POST /api/pdf/start-list` — Start list sorted by run order
- `POST /api/pdf/check-bib` — Check sheet sorted by bib, with Time column
- `POST /api/pdf/check-order` — Check sheet sorted by run order, with Time column
- `POST /api/pdf/registration` — Registration list with Bib, Athlete, Club, USSA#, Nation, YOB, Events
- `POST /api/pdf/timer-sheet` — Timer sheet with blank Run 1/Run 2 Time and Notes columns

**Shared pdfkit helpers added:** `streamPdf()`, `pdfHeader()`, `drawTable()`, `pdfFooter()`, `fmtScore()`, `fmtTime()`
- `drawTable()` handles column width weighting, dark header row, alternating row shading, automatic page breaks with header re-draw

**Removed:** `runPdf()` function, `execFile`/`path`/`fs`/`os` imports, `PYTHON`/`PDF_SCRIPT` constants. No reference to `generate_pdf.py` remains.

**Unchanged:** `POST /api/pdf/dual-bracket` and `POST /api/pdf/group-awards` already used native pdfkit.

**Also fixed:** `fetchAthletes()` helper now maps `run_time` from score data so check sheets can display actual times.

**Files modified:** `server/routes/pdf.js`

---

## v1.8.00 Feature Notes

### Paper Entry Mode (v1.8.00)

Per-event `score_entry_mode` toggle: `'tablet'` (default) or `'paper'`. Paper mode is for events where judges use paper scoring sheets and an admin enters scores afterward.

- **Database:** `events.score_entry_mode` TEXT column (default `'tablet'`), migration in `schema.js`
- **Editable** on Event Setup tab and Add Event modal; locked after first score entered (checks both `runs` and `dual_judge_points` tables)
- **When paper mode is active:**
  - Judge tablet links and Head Judge tablet link are hidden (Links panel shows "Paper entry mode — judge tablets not used")
  - Timekeeper tablet link remains visible with "Start runs only" note; time input hidden on tablet
  - Livescore and Overlay links unchanged
  - **Single moguls/aerials:** Start Run button is non-blocking (multiple athletes can be started without finishing previous). Time input hidden in active run panel. "Waiting for judges" indicators hidden. Manual Entry and Edit Score buttons unchanged.
  - **Dual moguls:** "Start Match" button hidden. "Enter Scores" button on pending matches and "Edit Scores" on completed matches. New `DualPaperScoreModal` for entering all 5 judge splits at once with auto-complement, Time Tied support, DNS/DNF/DSQ per athlete. Matches auto-finalize (no HJ approval step).

**New server endpoint:** `POST /api/events/:eventId/dual/:matchId/paper-score`
- Path A: `{ winner_registration_id, loser_status }` for DNS/DNF/DSQ
- Path B: `{ judges: [{judge_number, blue_points, red_points}...], time_tied }` for scored matches
- Auto-finalizes, determines winner, advances bracket (uses shared `advanceWinner` helper)
- Returns error on tie ("TD must decide winner")

**New client component:** `DualPaperScoreModal` in `EventDetail.jsx`
- 5 judge rows with auto-complementing scores (entering blue auto-fills red)
- Time Tied checkbox (J4=0/0, J5 max 4, total max 19)
- Running totals with winner highlight
- DNS/DNF/DSQ buttons per athlete
- Pre-populates existing scores for edit mode

**Refactored:** `advanceWinner()` helper extracted from duplicated logic in `PUT /:matchId/winner` and `POST /:matchId/approve` in `dual.js`. Used by all three endpoints.

**Files modified:** `server/db/schema.js`, `server/routes/events.js`, `server/routes/runs.js`, `server/routes/dual.js`, `client/src/pages/MeetDetail.jsx`, `client/src/pages/EventDetail.jsx`, `client/src/pages/TimekeeperTablet.jsx`

---

## v1.7.06 Feature Notes

### Dual Mogul Time Tied (v1.7.06)

When athletes' times are identical in a dual mogul run, the Time Judge (J4) declares "Time Tied" and the Overall Judge (J5) distributes 4 points instead of 5. Match total becomes 19 instead of 25.

**Database:** `dual_judge_points.time_tied` INTEGER column (default 0). When J4 submits time tied, row stored with `blue_points=0, red_points=0, time_tied=1`.

**Scoring engine (`server/scoring/engine.js`):**
- `validateDualPointSplit(blue, red, opts)` accepts `{ timeTied, isOverallWithTimeTied }` options
- `calcDualMogulPointSplit` returns `timeTied` boolean in result and breakdown

**Server (`server/routes/dual.js`):**
- POST `/:matchId/judge-points` accepts `time_tied` in body (only for judge_number=4)
- When J4 changes time_tied state, J5's row is automatically deleted (forces rescore)
- GET `/active-match` and GET `/:matchId/judge-points` include `time_tied` field
- Broadcast includes `timeTied` flag

**Judge Tablet (`client/src/pages/JudgeTablet.jsx`):**
- J4 sees amber "Time Tied" button below normal split buttons
- J5 automatically switches to 4-point splits (4/0, 3/1, 2/2, 1/3, 0/4) when J4 declares time tied
- J4 can undo by submitting a normal split (server deletes J5, both rescore)

**Head Judge Tablet (`client/src/pages/HeadJudgeTablet.jsx`):**
- J4 shows "Time Tied" (amber) instead of "0/0"
- Judge role labels added: "(Time)", "(Overall)"
- Rejecting J4 also clears J5 with warning message
- Running totals show "(Time Tied — max 19 pts)"

### Bracket Fixes (v1.7.06)

**Default bracket size:** Changed from 32 to 128 so all registered athletes are included by default. Affects `server/db/schema.js` (column default) and `server/routes/dual.js` (fallback values).

**Pairing labels on bracket cards:** `SimpleBracketCard` in `EventDetail.jsx` now displays `pairing_label` (e.g. "W-01") badge in top-left corner of each match card.

**Stray "0" fix:** Fixed React rendering bug where `{m.is_bye && ...}` rendered literal `0` text for non-bye matches (integer 0 is rendered by React). Changed to `{!!m.is_bye && ...}`.

**Files modified:** `server/db/schema.js`, `server/scoring/engine.js`, `server/routes/dual.js`, `client/src/pages/EventDetail.jsx`, `client/src/pages/JudgeTablet.jsx`, `client/src/pages/HeadJudgeTablet.jsx`, `client/src/components/Layout.jsx`, `server/index.js`

---

## v1.7.05 Feature Notes

### Air Judge Quick Select Enhancements (v1.7.05)

`client/src/pages/JudgeTablet.jsx` — air judge jump code quick select.

**New quick select buttons:** `7oG` and `N` (Neutral) added to the existing row: `S, T, TS, 3, bL, bT, bF, bG, 7op, 7oG, N`

**New jump codes in `jump_dd_table`:**
- `N` (Neutral): DD 0.360 (men) / 0.460 (women)
- `NJ` (No Jump): DD 0.00 for both genders

**Per-jump "No Jump" buttons:** Red buttons below each jump column's quick select. Clicking sets the jump code to `NJ` and pre-fills the air score to 0.0.

**Database:** `server/db/schema.js` — N and NJ added to seed data. Migration logic ensures codes are inserted into existing databases that already have gendered DD data (bypasses the early-return guard in `seedJumpDDs`).

---

## v1.7.04 Feature Notes

### Component Scoring Toggle (v1.7.04)

Per-event `component_scoring` toggle for mogul events (not dual mogul or aerials).

- **Database:** `events.component_scoring` INTEGER column (1=ON, 0=OFF, default 1)
- **Defaults:** ON for `division='open'`, OFF for `division='devo_junior'`
- **Editable** on Event Setup tab until first run is scored, then locked
- **When OFF:** T&L judges enter only T&L Total (0–20) + Deduction (0–10). Final = Total − Deduction.
- **When ON:** No change to existing behavior (full Crv/UB/A&E/Ded components)
- **Add Event modal:** Component Scoring Yes/No dropdown replaces the pace time info box (mogul only)
- **Exports (CSV/XLSX):** When OFF, only `TL# Total` + `TL# Ded` columns per judge (no Crv/UB/A&E)
- **Head Judge tablet:** When OFF, shows only "Ded X.X" instead of full component breakdown
- **Scoring engine, Scoreboard, Overlay, PDF:** No changes needed (engine uses only `raw_score`)

**Files modified:** `server/db/schema.js`, `server/routes/events.js`, `server/routes/runs.js`, `server/routes/export.js`, `client/src/pages/MeetDetail.jsx`, `client/src/pages/EventDetail.jsx`, `client/src/pages/JudgeTablet.jsx`, `client/src/pages/HeadJudgeTablet.jsx`

---

## v1.7.01 Feature Notes

### Head Judge Tablet Redesign (v1.7.01)

`client/src/pages/HeadJudgeTablet.jsx` — standard mogul/aerials view only (Dual Mogul view unchanged).

**New full-width 3-column layout:**
- **Now Scoring bar** spans full width above the grid: `#BIB  Athlete Name` (same size, side by side) with Athlete N of N / Run # right-aligned
- **Column 1 (left):** T&L Judges — per-judge score, component breakdown (Crv/UB/A&E/Ded), Reject button
- **Column 2 (center):** Air Judges (jump codes + Clear Codes at top, per-judge J1/J2 scores + Reject) + Timekeeper (time, time points, Reject Time)
- **Column 3 (right):** Score Status, Running/Calculated Score, spread warnings, Approve Score, Finalize, DNS/DNF/RNS/DSQ

Grid uses `grid-cols-[1.5fr_1.5fr_1fr]` Tailwind arbitrary value.

---

## v1.7.00 Feature Notes

### Manual Score Entry & Edit Score (v1.6.08)

- **"Manual Entry" button** appears on every Up Next and Remaining athlete in the Scoring tab
- **"Edit Score" button** appears alongside the Reopen button in Run History for completed runs
- **`ManualScoreModal`** component in `EventDetail.jsx` handles both entry and edit modes

**Modal field order (mogul):** Time → T&L Judges → Jump Codes → Air Judges

**TL judge component fields:** Crv (0–10), UB (0–5), A&E (0–5), Ded (0–10)
- Entering components auto-computes total: `max(0.1, min(20, carving + absExt + upperBody - deduction))`
- Editing the total directly clears component fields
- Can enter a total without components

**Jump codes:** NOT uppercased — codes like `bL` must preserve exact case (DD table lookup is case-sensitive). Datalist autocomplete shows available codes with DD values. Both jump codes required for Submit Score (not for DNS/DNF/DSQ).

**DNS/DNF/DSQ buttons:** Bottom-left of modal. Clicking one immediately saves and closes — no score validation required. These are separate from "Submit Score".

**Overlay suppression:** Manual runs have `manually_entered=1` on the `runs` table. The `score_update` broadcast omits `total` — overlay WS gate `if (d.total == null && d.score == null) return` suppresses display. Overlay polling also filters `manually_entered` before showing last score.

**New server endpoints in `server/routes/runs.js`:**
- `GET /:runId/scores` — returns `judge_scores` rows for a run (pre-population for Edit Score)
- `POST /manual` — creates run directly as `status='complete'`; inserts judge_scores; never enters `scoring` state (no overlay "Now Scoring...")
- `POST /:runId/manual-score` — re-scores existing run; deletes + re-inserts judge_scores
- `POST /:runId/reopen` — guarded: returns 400 if any run has `status='scoring'`

### Per-Judge TL Component Score Storage (v1.6.09)

**Database:** 4 new nullable REAL columns on `judge_scores`:
- `tl_carving`, `tl_abext`, `tl_upper_body`, `tl_deduction`

**Server (`runs.js`):**
- `POST /:runId/scores` saves component fields to judge_scores row
- `GET /active` returns component fields in `submitted` array (for HJ tablet live display)
- `GET /:runId/scores` returns component fields (for Edit Score pre-population)
- `POST /manual` accepts `tl_components[]` array; inserts per-judge rows
- `POST /:runId/manual-score` deletes + re-inserts judge_scores with fresh components

**Request body shape for `tl_components`:**
```json
{
  "tl_scores": [14.5, 13.8, 15.0],
  "tl_components": [
    { "carving": 7.5, "upperBody": 5.0, "absExt": 4.5, "deduction": 2.5 },
    { "carving": 7.0, "upperBody": 4.8, "absExt": 4.5, "deduction": 2.5 }
  ]
}
```

**HJ Tablet (`HeadJudgeTablet.jsx`):** After TL judge total, shows `Crv X.X / UB X.X / A&E X.X / Ded X.X` (only when components non-null).

**Export (`server/routes/export.js`):** Both CSV and XLSX output per-judge columns (replacing old single aggregate columns). Dynamic column count based on `event.num_tl_judges`. Columns: `TL1 Total, TL1 Crv, TL1 UB, TL1 A/E, TL1 Ded, TL2 Total, TL2 Crv, ...`

**Backward compat:** `runs.tl_carving/tl_abext/tl_upper_body/tl_deduction` still written (last TL judge's values). Old runs with NULL component fields show blank cells in exports — no errors.

### Deferred Items (not yet built)

- PDF results report: per-judge TL component breakdown (deferred by user decision)
- Head Judge tablet component display on historical runs (only live runs during active scoring session show components via `GET /active`)
