# Changelog — Older Versions (v1.7.00 – v1.15.02)

For version notes v1.16.00 and later, see CLAUDE.md.

---

## v1.15.02 Feature Notes

### TD Report Improvements (v1.15.02)

**Officials from first event:** TD Report now pulls officials from the first event's per-event officials (ordered by `event_date, created_at`) instead of meet-level officials. If other events have different officials for the same role, both are shown with discipline suffixes: `"Smith, John 12345 [M] / Jones, Bob 67890 [DM]"`. Falls back to meet-level officials for legacy meets.

**Judges field:** Pre-populated multiline field (5 lines) listing all judges from the first event with role, name, and USSS ID. Differences from other events appended automatically.

**Type of Competition auto-fill:** Now lists disciplines present in the meet (e.g., `"Moguls, Dual Moguls"`). Appends `DIC` if any event is a divisional championship. Field remains editable.

**Event codes with discipline suffix:** WOMEN and MEN event code boxes now display codes with discipline labels (`U12345 M`, `U67890 DM`, `U11111 A`). Codes split across two lines within the box to prevent overflow.

### Copy Officials from Other Event (v1.15.02)

New button on the Event Officials panel header: "Copy Officials from Other Event". Shows a dropdown of other events in the same meet. Copies all officials from the selected event, skipping roles already filled in the target event. Auto-propagates Head Judge to judges table.

**New endpoint:** `POST /meets/:meetId/officials/copy-from-event` with `{ sourceEventId, targetEventId }`

**Files modified:** `server/routes/pdf.js`, `server/routes/officials.js`, `client/src/pages/EventDetail.jsx`, `client/src/utils/api.js`, `client/src/components/Layout.jsx`, `server/index.js`

---

## v1.15.01 Feature Notes

### Bib Assignment Improvements (v1.15.01)

**Assign Bibs button restyled:** The "Assign Bibs" button in the Run Order header bar now uses a solid `bg-mountain-600` blue background with bold text, making it visually distinct from the other ghost-styled buttons.

**Exclude numbers:** When "Generate by Run Order" or "Generate Randomly" is selected in the Assign Bib Numbers modal, a new "Exclude numbers" text input appears. Enter comma-separated bib numbers (e.g. `1,11,18,25`) to skip lost or missing bibs during assignment. Excluded numbers are also respected during "Fill In Missing" operations.

**Import/Export bib numbers:** Two new buttons in the Assign Bib Numbers modal footer:
- **Import from Athlete Database** — pulls `athletes.bib` values into the current event's `registrations.bib_number`
- **Export to Athlete Database** — pushes the event's `registrations.bib_number` values into `athletes.bib`

**Auto-sync removed:** Editing an athlete's bib on the Athletes page no longer cascades to registrations in setup-status events. CSV import no longer pulls bibs from `athletes.bib` — only uses the CSV column. Bib sync between events and the athlete database is now fully manual via Import/Export.

**New endpoints:** `POST /events/:eventId/registrations/import-bibs-from-athletes`, `POST /events/:eventId/registrations/export-bibs-to-athletes`

**Conflict dialog fix:** "Fill In Missing" description and button now hidden when all athletes already have bibs (noBibCount = 0).

**Autosave backup fix:** `VACUUM INTO` no longer fails with "output file already exists" when multiple writes occur within the same second. Backup is skipped if the destination file already exists.

**Files modified:** `client/src/components/BibAssignModal.jsx`, `client/src/pages/EventDetail.jsx`, `server/routes/registrations.js`, `server/routes/athletes.js`, `client/src/utils/api.js`, `server/db/autosave.js`

### Shorter Tablet URLs (v1.15.01)

Tablet URLs (judge, head judge, timekeeper, scoreboard, overlay) now use 6-character alphanumeric codes instead of full UUIDs, making them much easier to type manually.

**Before:** `http://192.168.1.5:3001/judge/9adfaabe-77eb-46b8-af2c-b1b6b8e3b27b?judge=c4f987ec-2967-47f9-8d67-87a2f4c1`
**After:** `http://192.168.1.5:3001/judge/a3k9m2?judge=f8n4p1`

**Database:** New `short_code TEXT` column on `meets`, `events`, and `judges` tables. Existing rows backfilled on startup. New records get codes automatically.

**Resolve endpoint:** `GET /api/resolve?event=abc123&judge=def456&meet=ghi789` returns `{ eventId, judgeId, meetId }` with full UUIDs. Used by tablet components on mount.

**Client hook:** `useResolveIds()` in `client/src/hooks/useResolveIds.js` — shared hook used by all 6 tablet components to resolve short codes before making API calls.

**Files modified:** `server/db/schema.js`, `server/index.js`, `server/routes/meets.js`, `server/routes/events.js`, `server/routes/judges.js`, `client/src/pages/EventDetail.jsx`, `client/src/pages/JudgeTablet.jsx`, `client/src/pages/HeadJudgeTablet.jsx`, `client/src/pages/TimekeeperTablet.jsx`, `client/src/pages/Scoreboard.jsx`, `client/src/pages/Overlay.jsx`, `client/src/pages/AerialsJudgeTablet.jsx`, `client/src/hooks/useResolveIds.js` (new)

### UI Cleanup (v1.15.01)

**16 Down button removed:** Removed from the Run Order header bar. This functionality is now handled in the Phases menu.

**Files modified:** `client/src/pages/EventDetail.jsx`

---

## v1.15.00 Feature Notes

### Component Scoring PDF Redesign (v1.15.00)

Complete visual redesign of the "Detailed Results with Component Scoring" PDF report (`POST /api/pdf/event-results-component`) for improved readability.

**Color-coded row families:** TL rows use a blue color family (header `#1B3A5C`, sub-header `#2a5a8a`, data `#e4edf7`/`#edf3fb`). Air rows use a warm sand color family (header `#5C4A1B`, sub-header `#7a6530`, data `#f5edda`/`#faf3e4`). Identity columns use neutral `#f5f7fa`/`#ffffff`.

**Aligned column grid:** Air row columns (Jump Code, DD, Air Score) now match TL judge group widths exactly (`jumpGroupW = tlJudgeW = 126pt`). Pre-computed `tlSeps[]` array used for ALL vertical separator lines across headers, TL data rows, and Air data rows — eliminates prior misalignment.

**Final Score column:** New column at the far right edge (`mL + usable - 48pt`) showing the event total score. Run Tot column preserved in its original position on the air row.

**Header gap fix:** TL header background now extends from identity area to Final Score column using `finalScoreX - (mL + idW)`, eliminating the 63pt white gap that existed between T&L sum and Final Score.

**Club name wrapping fix:** Identity background painted once for both TL and Air rows (height = `rowH * 2`) from Row 1. Air row background only covers the scoring area (`mL + idW` to `finalScoreX`), preventing it from painting over wrapped club name text.

**Layout constants:** `colPlace=22, colBib=24, colGp=22, colName=95, colClub=60, idW=223, tlJudgeW=126, colComp=24, colTot=30, colTLSum=32, colFinalScore=48, rowH=16, headerH=30, fontSize=8`.

**Files modified:** `server/routes/pdf.js`

---

## v1.14.00 Feature Notes

### Age Class Computation Fix (v1.14.00)

Fixed USSS age class derivation across all code paths. Previous logic used end-of-season year (June) instead of start-of-season year (July 1). Fixed `computeAgeGroup()` in `results.js`, `pdf.js`, and `seed_telluride.js` to use `seasonStartYear = d.getMonth() < 6 ? d.getFullYear() - 1 : d.getFullYear()`. Added U7/U9 thresholds and Veteran class (age > 20).

**Files modified:** `server/routes/results.js`, `server/routes/pdf.js`, `server/scripts/seed_telluride.js`

### Dual Mogul Placement by Judge Points (v1.14.00)

Eliminated athletes (outside top 4/8 consolation places) now ranked by losing-match judge points instead of seed only. Within each bracket round, losers sorted by: (1) judge points descending (higher = better place), (2) DNS/DNF/DSQ athletes rank below scored losers, (3) seed as tiebreaker. Applied to both `results.js` and `pdf.js` dual placement logic. Added `blue_total`/`red_total` subqueries to bracket SQL.

**Files modified:** `server/routes/results.js`, `server/routes/pdf.js`

### Detailed Results with Component Scoring PDF (v1.14.00)

New PDF report for events with component scoring enabled. Landscape layout with multi-row per run showing per-TL-judge component breakdown (Carving, Upper Body, Ab/Ext, Deduction, Total). Includes air judge scores, jump codes, DDs, time, speed points. Phase-aware (Best of 2, Qualifier/Finals). Available from PDF Reports tab when `event.component_scoring` is ON.

**New endpoint:** `POST /api/pdf/event-results-component`

**Files modified:** `server/routes/pdf.js`, `client/src/pages/EventDetail.jsx`

### Bug Fixes (v1.14.00)

**A1. HJ Tablet Running Score T&L Multiplier:** For 2-judge Devo/RQS panels, the Head Judge tablet running score now applies the `(3/numTlJudges)` multiplier (1.5× for 2 judges), matching the server's final score calculation. Previously showed max ~40 instead of ~60.

**A2. Event Deletion Orphaned Data:** DELETE endpoint now cleans up `phase_run_order`, `event_phases`, and `run_round_status` tables (in FK order).

**A3. Transmit Version String:** Updated from `v1.6` to `v1.13`.

**A4. About Panel Version:** Updated from `Version 1.12.00` to current version.

**A5. Scoreboard Podium Rank-Based Highlighting:** Podium highlighting now uses `r.rank` instead of array index (`i`). With ties, correct athletes get gold/silver/bronze styling.

**A6. Deduction Pad Manual Label:** Changed `0–10` to `0–20` in manual override mode label.

**Transmit Phase-Aware Export:** Removed `AND r.round='qualification'` filter from transmit mogul query so phase-based events (Best of 2, Qualifier/Finals) export correctly.

**Transmit Gender-Conditional Validation:** Mogul/Dual ID fields only required for genders that actually have events in the meet. Female-only meets no longer require Male Mogul ID.

**Safe Atomic Backups:** Replaced `fs.copyFileSync` with SQLite `VACUUM INTO` in `autosave.js` for consistent snapshots during active writes.

**Parallel Dual Judge Points Fetch:** DualScoringPanel now fetches all match judge points concurrently via `Promise.all` instead of sequential `for...of` loop.

**Export Column Headers:** Renamed `Avg Air J1`/`Avg Air J2` to `Avg Jump 1`/`Avg Jump 2` in CSV/XLSX exports.

**Files modified:** `client/src/pages/HeadJudgeTablet.jsx`, `server/routes/events.js`, `server/routes/transmit.js`, `client/src/components/Layout.jsx`, `client/src/pages/Scoreboard.jsx`, `client/src/pages/JudgeTablet.jsx`, `server/db/autosave.js`, `client/src/pages/EventDetail.jsx`, `server/routes/export.js`

---

## v1.13.00 Feature Notes

### TD Report Fillable PDF (v1.13.00)

New "TD Report" button on the meet detail page (next to "Close Meet and Export to USSS") generates a 2-page fillable PDF based on the USSA Freestyle Technical Delegate Report form.

**Page 1:** Competition info (name, type, date, USSS event codes, ski area), officials block, events schedule table with fillable start/finish times, competitor counts pre-filled, comments section, attachment checkboxes (Accident, Jury Decision, Protest, Discipline).

**Page 2:** Course specifications for Moguls and Dual Moguls (trail name, length, width, inclination pre-filled from course_specs). Air site fields (landing pad length/steepness, take-off angle/height) are fillable. Safety issues text area at bottom.

**TYPE OF COMPETITION** pre-fills "DIC" if any event in the meet has `is_divisional=1`.

**Dependency:** `pdf-lib` added for AcroForm fillable field support (PDFKit does not support fillable fields).

**Files modified:** `server/routes/pdf.js`, `client/src/pages/MeetDetail.jsx`, `server/package.json`

### Divisional Championship Checkbox (v1.13.00)

Per-event boolean toggle indicating whether this is a Divisional Championship event. Affects TD Report TYPE OF COMPETITION field and future USSS XML point values.

**Database:** `events.is_divisional INTEGER NOT NULL DEFAULT 0`

**UI:** Checkbox on Event Setup tab (next to USSS Code field) and on Add Event modal. When any existing event in the meet is divisional, new events default to checked.

**Files modified:** `server/db/schema.js`, `server/routes/events.js`, `client/src/pages/EventDetail.jsx`, `client/src/pages/MeetDetail.jsx`

### Forerunner (Judge Test Run) (v1.13.00)

Pre-competition practice run for judge calibration. Goes through the full scoring flow (judges score on tablets, HJ approves) but is auto-deleted afterward — no trace in results, exports, or run history.

**Button:** Orange "Forerunner" button on the "Up Next" header row in the Scoring tab. Visible only when no real runs have been completed and no active run exists.

**Display:** Judge tablets and HJ tablet show "Forerunner (Judge Test)" with orange styling. Overlay shows "Forerunner" as athlete name (no bib, no club). After HJ approval, overlay clears to blank (no score/place shown).

**Server flow:** `POST /runs/forerunner` creates a run with `registration_id='__forerunner__'`. On HJ approval, run and judge_scores are auto-deleted. Forerunner runs can always be cancelled (Cancel Run button stays enabled even with submitted scores).

**Guard:** Blocked after any real run has been completed. Can be repeated any number of times before the first real run.

**Files modified:** `server/routes/runs.js`, `client/src/utils/api.js`, `client/src/pages/EventDetail.jsx`, `client/src/pages/Overlay.jsx`, `client/src/pages/JudgeTablet.jsx`, `client/src/pages/HeadJudgeTablet.jsx`

### UI Cleanup (v1.13.00)

**Score Weights removed from Add Event modal:** The Turns/Air/Speed weight inputs were removed from the modal. Weights are fixed at 0.60/0.20/0.20 by default and defined by category — not user-editable at event creation.

**Event Status table simplified:** "Reg M / F", "Scored M / F", "Remaining M / F" columns on the meet page replaced with single "Registered", "Scored", "Remaining" totals since events are gender-specific.

**Files modified:** `client/src/pages/MeetDetail.jsx`

---

## v1.12.00 Feature Notes

### USSS Transmit Export Fixes (v1.12.00)

Six fixes to align StickIt USSS transmit XML output with Winfree-produced USSS submission files.

**DM Pointsdescend formula:** Changed from linear `30 - ((rank-1) * 0.55)` to exponential decay `30 * 0.98^(rank-1)` matching Winfree/USSS. The linear formula diverged at higher ranks and went negative around rank 55.

**DM Run_N values:** Changed from opponent bib number to athlete's own match score (sum of judge points). Bye rounds are omitted (no `<Run_N>` element). Required querying `dual_judge_points` and passing a `judgePointsMap` to `computeDualStandings`.

**Jury NAT_num populated:** All `<NAT_num>` elements in Jury entries now contain the judge's or official's USSS member number (`ussa_id` field) instead of empty tags.

**NumberJudges count:** Changed from counting only TL/DualTurns judges to counting all scoring judges (excluding HJ). Comp Series single mogul now emits 5, RQS emits 3, dual mogul emits 5.

**Auto-default USSS category:** The transmit modal auto-selects the USSS category based on event division (`comp_series`/`open` -> DIV, `rqs_eqs` -> EQS, `devo` -> ROC). Server returns `divisions` array from the check endpoint. User can still override.

**Close Meet codex letter fix:** The "Close Meet and Export to USSS" flow now derives the codex letter from the event's USSS code field (e.g., "U" from "U23458") instead of the meet name's first character. Previously failed on meet names not starting with N/U/A/C.

**Shared helper:** Extracted `buildJudgePointsMap(bracket)` helper in `transmit.js`, used by both `transmit.js` and `meets.js` to eliminate duplicated judge points query/map code.

**Files modified:** `server/routes/transmit.js`, `server/routes/meets.js`, `client/src/pages/EventDetail.jsx`, `client/src/components/Layout.jsx`, `server/index.js`

---

## v1.11.03 Feature Notes

### Devo/RQS Quick Select Jump Codes (v1.11.03)

Replaced the generic filtered quick-select buttons on the Air Judge tablet for Devo/RQS events with a dedicated list of common Devo/RQS codes: `S, T, D, X, K, TS, TT, TD, TTS, 3, 3p`. Comp Series quick-select unchanged. Dropdown filter still removes inverted/off-axis codes for Devo/RQS.

**Files modified:** `client/src/pages/JudgeTablet.jsx`

### Devo Timekeeper — No Time Entry (v1.11.03)

Devo events (`division === 'devo'`) no longer show time entry UI on the Timekeeper tablet. Displays "No Time for Devo Events" message. Start Run / Next Up functionality preserved so the timekeeper can still advance athletes. RQS events (which have speed scoring) are unaffected.

**Files modified:** `client/src/pages/TimekeeperTablet.jsx`

### Head Judge Can Start Next Run (v1.11.03)

Added "Next Up" athlete display and "Start Run" button to the standard mogul Head Judge tablet. After approving a score, the HJ now sees the next athlete's name/bib and can start their run directly — matching the existing dual mogul HJ behavior. Applies to all event categories (Comp Series, Devo, RQS). Uses existing `GET /runs/next-up` and `POST /runs` endpoints.

**Files modified:** `client/src/pages/HeadJudgeTablet.jsx`

### Dual Mogul Score Pad Layout (v1.11.03)

Reordered dual mogul judge split buttons so blue-winning scores are on the left column and red-winning scores are on the right column: `5/0 | 0/5`, `4/1 | 1/4`, `3/2 | 2/3`. Same layout for 4-point time-tied splits: `4/0 | 0/4`, `3/1 | 1/3`, `2/2`. Colors unchanged (blue number always blue, red always red).

**Files modified:** `client/src/pages/JudgeTablet.jsx`

### Dual Mogul HJ Rejection Message (v1.11.03)

Added "Your score was rejected" banner on the dual mogul judge tablet when the Head Judge rejects a score. Previously the judge's tablet silently returned to score entry with no explanation. Now matches single mogul rejection behavior with a red pulsing banner explaining the HJ rejected the score.

**Files modified:** `client/src/pages/JudgeTablet.jsx`

### PDF Club Name Column Widened (v1.11.03)

Widened the Representing/Club column on PDF reports where club names were overly truncated. Width shifted from Name to Rep column (zero-sum). Affected reports: Run Order (Entrants), Detailed Results (both Devo/RQS and Comp Series layouts).

**Files modified:** `server/routes/pdf.js`

---

## v1.11.02 Feature Notes

### Devo/RQS Score Entry UI (v1.11.02)

Updated ManualScoreModal, JudgeTablet, and HeadJudgeTablet to respect `event.num_jumps` for single-jump Devo events and filter restricted jump codes for Devo/RQS categories.

**ManualScoreModal (`EventDetail.jsx`):** Jump 2 code input, air score inputs, and validation hidden when `num_jumps === 1`. Jump code datalist filters out off-axis/inverted codes (codes starting with `b`, `f`, `l`, or containing `o`) for Devo/RQS events.

**JudgeTablet (`JudgeTablet.jsx`):** Air judge view hides Jump 2 column (quick-select, dropdown, ScorePad) when `num_jumps === 1`. Quick-select buttons and dropdown filter restricted codes for Devo/RQS. Submit validation and `submitCodes` handle single-jump correctly. Fetches `num_jumps` and `division` from updated `/runs/info` endpoint.

**HeadJudgeTablet (`HeadJudgeTablet.jsx`):** Running score computation uses `avg1 × DD1 × 2` (capped at 20) for single-jump events instead of requiring Jump 2 data. Score status only requires `air_jump1` count for single-jump events.

**Server (`runs.js`):** `/runs/info` now returns `num_jumps` and `division`. `POST /:runId/manual-score` forces `code2=null`, `dd2=null` when `num_jumps === 1` to prevent stale jump2 data on edit.

### Devo/RQS PDF Reports and Exports (v1.11.02)

**PDF (`pdf.js`):** `drawDetailedResultsTable` now accepts `opts.event` to detect panel configuration. When `num_tl_judges < 3` (Devo/RQS), uses a 14-column layout: J.1 (TL1), J.2 (TL2), J.3 (Air), Jumps, DofD, Judge, Time, Pts, Run. No T&L summary, no Airs summary, no J.4/J.5 columns. Devo single-jump events use single-line rows. RQS two-jump events use 2-line rows with Jump 2 on line 2. Comp Series layout (3+ TL judges) completely unchanged. All 3 call sites (run-results, event-results-detailed, group-detailed) pass event.

**Exports (`export.js`):** CSV and XLSX column headers now dynamic based on panel. Air average headers: 1 air judge = `Avg Air J1` only. Jump columns: `num_jumps === 1` omits Jump 2 Code/DD. Speed columns: `has_speed === 0` omits S Score and Run Time. Comp Series output identical to v1.10.04.

**Files modified:** `server/routes/runs.js`, `server/routes/pdf.js`, `server/routes/export.js`, `client/src/pages/EventDetail.jsx`, `client/src/pages/JudgeTablet.jsx`, `client/src/pages/HeadJudgeTablet.jsx`, `client/src/components/Layout.jsx`, `server/index.js`

---

## v1.11.01 Feature Notes

### CSV Registration: "Singles" Category Recognition (v1.11.01)

`matchesDiscipline` in `server/routes/registrations.js` now recognizes "singles" as a mogul synonym. SkiReg CSVs with categories like `"Mens Devo Singles (March 14)"` now correctly match mogul events instead of being rejected as "Wrong Event".

### CSV Registration: Wrong Event Override (v1.11.01)

Added ability to override "Wrong Event" rejections during CSV registration import. Gender mismatch remains non-overridable.

**Client (`CsvImportModal.jsx`):** New `WrongEventOverrideSection` component replaces the plain "Wrong Event" collapsible. When expanded, each athlete row has a checkbox. "Select All — Register Anyway" / "Deselect All" toggle at top. Stat badges and Confirm Import button dynamically update counts to include overridden athletes.

**Server (`registrations.js`):** `processCsvRows()` accepts `overrideEventCheck` array of USSS IDs. Athletes in this list bypass the discipline check but still must pass gender matching. The override list is sent as a JSON-encoded form field alongside the CSV file on commit.

**Files modified:** `server/routes/registrations.js`, `client/src/components/CsvImportModal.jsx`, `client/src/components/Layout.jsx`, `server/index.js`

---

## v1.11.00 Feature Notes

### Devo & RQS/EQS Single Mogul Scoring (v1.11.00)

Added support for Devo and RQS/EQS category single mogul scoring with non-standard judge panels and jump counts. All changes are additive — Comp Series scoring is unchanged.

**Scoring Formulas:**

| Category | T&L | Air | Speed | Event Score |
|---|---|---|---|---|
| Comp Series | Sum of 3 TL judges (max 60) | (air1 × DD1) + (air2 × DD2), max 20 | 48 - 32 × (time/pace), max 20 | Higher of Run 1 and Run 2 |
| Devo | 1.5 × (TL1 + TL2) | air × DD × 2, max 20 | None | Higher of Run 1 and Run 2 |
| RQS/EQS | 1.5 × (TL1 + TL2) | (air1 × DD1) + (air2 × DD2), max 20 | 48 - 32 × (time/pace), max 20 | Higher of Run 1 and Run 2 |

**T&L multiplier logic:** `turnsContrib = (3 / numTlJudges) × sum(tlScores)`. For 2 judges = 1.5×. For 3 judges = 1.0× (existing `calcTurnsSumScore` path, no change).

**Air doubling logic:** When `numJumps === 1`, air score = `jump1Score × 2` (capped at 20). Compensates for single jump. When `numJumps >= 2`, existing two-jump sum path unchanged.

**Database:** New `events.num_jumps` INTEGER column (default 2). Existing events unaffected.

**Default values by category:**

| Category | TL Judges | Air Judges | Jumps | Speed | Comp Scoring |
|---|---|---|---|---|---|
| Comp Series | 3 | 2 | 2 | Yes | ON |
| Devo | 2 | 1 | 1 | No | OFF |
| RQS/EQS | 2 | 1 | 2 | Yes | OFF |

All defaults are user-overridable after the preset.

**Category restrictions:** Devo and RQS/EQS are disabled for dual mogul events (only Comp Series available). Auto-resets to Comp Series if switching discipline to dual_mogul.

**Add Event modal:** New "Jumps" dropdown (1 or 2) in the judge config row. Category selection auto-presets all judge/speed/component scoring defaults. Event card now shows Jumps count.

**Score finalization (`runs.js`):** Jump 2 air score requirement is skipped when `num_jumps === 1`. All 4 `calcMogulScore` call sites pass `numTlJudges` and `numJumps` from the event record.

**Comp Series regression:** Default parameters (`numTlJudges=3`, `numJumps=2`) take existing code paths unchanged. Verified identical output.

**Files modified:** `server/db/schema.js`, `server/scoring/engine.js`, `server/routes/events.js`, `server/routes/runs.js`, `client/src/pages/MeetDetail.jsx`, `client/src/components/Layout.jsx`, `server/index.js`

---

## v1.10.04 Feature Notes

### Division Renamed to Category with New Options (v1.10.04)

Renamed the "Division" dropdown to "Category" on the Add Event modal. Replaced the old two-option menu (Open / Devo/Junior) with four category options:

| Value | Label | Component Scoring Default | Notes |
|---|---|---|---|
| `comp_series` | Comp Series | ON | Same behavior as former "Open". Default selection. |
| `devo` | Devo | OFF | Same behavior as former "Devo/Junior". |
| `rqs_eqs` | RQS/EQS | OFF | Same options as Comp Series, only component scoring default differs. |
| `fis` | FIS (coming soon) | — | Disabled/grayed out in dropdown. Reserved for future use. |

**Default event names** use the Category label (e.g., "Comp Series Male Mogul", "Devo Female Dual Mogul").

**Server (`events.js`):** Component scoring default logic updated — `devo` and `rqs_eqs` default to OFF; `comp_series` defaults to ON. Old `open` and `devo_junior` values retained in label map for backward compatibility with existing events.

**Files modified:** `client/src/pages/MeetDetail.jsx`, `server/routes/events.js`, `client/src/components/Layout.jsx`, `server/index.js`

---

## v1.10.03 Feature Notes

### Deduction Cap Increased to 20.0 (v1.10.03)

Raised the deduction cap from 10.0 to 20.0 across all deduction entry points. FIS rules allow deductions up to 20.0 (the full T&L score range).

**Judge Tablet (`DeductionPad` component):** Tap-to-accumulate buttons now cap at 20.0 instead of 10.0. Manual override input accepts values up to 20.0.

**Manual Score Modal (`EventDetail.jsx`):** Both component-scoring and non-component-scoring deduction inputs updated — label text, `max` attribute, and validation all changed from 10 to 20.

**Files modified:** `client/src/pages/JudgeTablet.jsx`, `client/src/pages/EventDetail.jsx`, `client/src/components/Layout.jsx`, `server/index.js`

---

## v1.10.02 Feature Notes

### Judge Tablet UI Improvements (v1.10.02)

**Reference panels reversed:** FIS scoring reference panels on the judge tablet now list Excellent first, descending to Poor/Very Poor. Applies to T&L component scoring, T&L non-component scoring, and Air scoring references.

**Cumulative deductions:** Replaced the single deduction input field with a tap-to-accumulate UI. Buttons: +0.1 (minor), +0.5 (stumble), +1.0, +1.6 (lane change), +6.0 (stop/fall). Running total displayed with red border when > 0. Clear button resets to 0. Manual override input available via "Manual" button. Total capped at 10.0. `DeductionPad` component defined in `JudgeTablet.jsx`.

**`bP` quick-select button:** Added Back Pike (`bP`) to the air judge quick-select row between `bT` and `bF`.

### Jump Code Updates (v1.10.02)

**New DD table entries:** Added standalone `G` (Grab, DD 0.14/0.14) and `p` (Position, DD 0.03/0.03) to `seedJumpDDs` in `schema.js`. These are FIS "Jump Multipliers" — `G` is used for standalone grabs allowable in USSS events.

### Bug Fixes (v1.10.02)

- **Score rejection not reaching judge tablet (single mogul):** Added polling-based fallback in the 3-second poll cycle. If a judge's previously-submitted score disappears from the server's `submitted` array, the tablet detects this as a rejection and shows the re-entry UI. Uses refs (`submittedRef`, `isTurnsRef`, `isAirRef`) to avoid stale closures in the poll interval.
- **Score rejection not reaching judge tablet (dual mogul):** Fixed `DualJudgeView.fetchMatch()` — previously only set `submitted=true` (never back to `false`) when the match ID hadn't changed. Now checks `submittedRef.current` and resets to re-entry mode when judge's points are removed. Also fixed stale closure bug by using `fetchMatchRef` pattern so the interval always calls the latest function.
- **Air judge can submit with missing Jump 2 score:** Added validation in `submitScore()` requiring both `airJ1` and `airJ2` before submission. Previously either jump alone was accepted.
- **Jump code mismatch message:** Changed from "Jump codes differ from Air Judge 1" to "Jump codes differ from the other Air Judge" in `runs.js`, since the message was misleading when Judge 1 entered second.

### USSS Sync on Registration Panel (v1.10.02)

Added "Sync with USSS Database" button to the Registration panel in `EventDetail.jsx`. Uses the existing `api.syncAthletesWithUsss()` endpoint (same as the Athletes page). Shows syncing state, displays matched/updated/not_found counts on completion, and refreshes the registration list.

**Files modified:** `client/src/pages/JudgeTablet.jsx`, `client/src/pages/EventDetail.jsx`, `server/db/schema.js`, `server/routes/runs.js`, `client/src/components/Layout.jsx`, `server/index.js`

---

## v1.10.00 Feature Notes

### Auto-Sizing Dual Mogul Brackets (v1.10.00)

Bracket size is now automatically determined by the number of registered athletes. Previously, `events.bracket_size` defaulted to 32 and acted as a hard cap, truncating brackets when more than 32 athletes were registered (e.g., 48 athletes crammed into a 32-draw bracket with no Round of 64).

**`effectiveBracketSize(n)`** in `server/dual/placement.js` no longer accepts a `cap` parameter. It always returns the smallest power of 2 >= athlete count, hard-capped at 128. The `events.bracket_size` column is retained for backward compatibility but is no longer read by seeding logic.

**Bracket Size UI removed:** The "Bracket Size" dropdown has been removed from the Add Event modal (`MeetDetail.jsx`) and the event card display. The "Run Off to" dropdown remains.

**Tie-at-cutoff block removed:** `seedFromMogulEventImpl` in `dual.js` no longer checks for ties at a bracket_size boundary — the bracket simply expands to include all athletes.

### Seeding Preview & Save Workflow (v1.10.00)

Seeding list creation now requires explicit save. Previously, clicking "Seed from Mogul Event", "Seed from USSS Points", or "Mogul Event + USSS" immediately persisted the seed list to the database.

**Preview mode:** All three seeding endpoints (`seed-mogul-event`, `seed-usss`, `seed-event-plus-usss`) accept `preview: true` in the request body. When set, the server computes and returns the ordered entries without persisting. The client displays the preview in the seed list table.

**Save button:** The "Save Seed List" button (formerly "Save Manual Order") persists the previewed or manually reordered list. Uses new batch endpoint `POST /save-seed-list` for previewed lists, or individual PUTs for manually reordered lists.

**Overwrite warning:** If a saved seeding list already exists (checked against server data, not local preview state), a confirmation dialog appears before computing a new list.

**Bracket creation confirmation:** `seed-fis` endpoint now returns 409 with `exists: true` when any bracket exists (not just started matches). Client shows "A bracket has already been created. Are you sure you want to replace it?" before regenerating. For brackets with started matches, shows the more serious "Regenerating will discard those results" prompt.

### Seeding Panel UI Cleanup (v1.10.00)

Reorganized the DualSeedingPanel layout. Title and Save button on the top row. Source event picker and three seeding method buttons aligned on a single horizontal row below.

### Bug Fixes (v1.10.00)

- **TimekeeperTablet `isPaper` crash:** `isPaper`, `isDualMogul`, and `noPaceTime` variables moved above the polling `useEffect` that references them. Previously defined after the effect, causing a ReferenceError in paper mode. Added `isPaper` to the effect's dependency array.
- **Version mismatch in About panel:** About modal showed "Version 1.6.04" while sidebar showed current version. Both now display v1.10.00.
- **Deduction-only T&L component not saved:** `runs.js` score submission now checks `deduction !== undefined` in the T&L component condition, so deduction-only submissions update the run row's `tl_deduction` field.
- **Dead WebSocket message checks:** Removed uppercase fallback checks (`RUN_STARTED`, `SCORE_POSTED`, `DUAL_MATCH_STARTED`) from `Overlay.jsx` — the server only sends lowercase event types.
- **Seed reorder after preview discarded:** `move()` now clears `pendingEntries` so manual arrow-button reordering after a preview correctly uses the individual PUT save path instead of silently persisting the old preview entries.
- **`pendingEntries` not cleared on manual save path:** `saveSeedOrder()` now clears `pendingEntries` after both the batch and manual PUT save paths.

**Files modified:** `server/dual/placement.js`, `server/routes/dual.js`, `server/routes/events.js`, `server/routes/runs.js`, `server/scripts/verify_v16.js`, `client/src/pages/EventDetail.jsx`, `client/src/pages/MeetDetail.jsx`, `client/src/pages/TimekeeperTablet.jsx`, `client/src/pages/Overlay.jsx`, `client/src/components/Layout.jsx`, `server/index.js`

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
