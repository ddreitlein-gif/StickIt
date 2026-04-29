# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**StickIt** is a full-stack freestyle mogul scoring application for managing ski/snowboard competitions (moguls, dual moguls, aerials) for US Ski & Snowboard (USSS) events.

**Current version:** v1.16.20

## Commands

### Development

```bash
# Start server (port 3001, auto-reload)
cd server && npm install && npm run dev

# Start client (port 3000, with proxy to server)
cd client && npm install && npm run dev
```

Both must run simultaneously. Client proxies `/api` and `/ws` to `http://localhost:3001`.

### Production

```bash
cd client && npm run build   # outputs to client/dist/
cd server && npm start
```

### Build & Package (Release Zip)

After building, copy client assets to server:

```bash
cd client && npm run build
cp client/dist/index.html server/public/index.html
rm -f server/public/assets/index-*   # clear stale hashed bundles from prior builds
cp client/dist/assets/* server/public/assets/
# Note: logo.png in server/public/ is read-only — use targeted copy, not cp -r dist/* server/public/
```

Then create the zip directly from the `StickIt/` parent (never use a staging folder):

```bash
cd /Users/daviddreitlein/Desktop/StickIt
zip -r "/tmp/StickIt_X_X_XX.zip" server/ client/ CLAUDE.md --exclude "*/node_modules/*"

# Verify root contents — must ONLY show server, client, CLAUDE.md
unzip -l /tmp/StickIt_X_X_XX.zip | awk '{print $4}' | awk -F'/' '{print $1}' | sort -u

# Deliver
cp "/tmp/StickIt_X_X_XX.zip" "/Users/daviddreitlein/Desktop/Scoring Server/Scoring Zip Files/"
rm /tmp/StickIt_X_X_XX.zip
```

**Zip naming:** `StickIt_X_X_XX.zip` — version number only, no date suffix (e.g. `StickIt_1_7_00.zip`).

Zip destination: `/Users/daviddreitlein/Desktop/Scoring Server/Scoring Zip Files/`

### Version String

The version string lives in `server/index.js` (~line 97):
```js
console.log(`StickIt v1.7.01 ready on port ${PORT}`)
```
Also displayed in `client/src/components/Layout.jsx` sidebar. Bump both on every release.

### Verification

```bash
node server/scripts/verify_v16.js   # validates dual mogul placement spec
```

No linting or test framework is configured.

### Environment Variables (Server)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | Server port |
| `LIBSQL_URL` | `file:./data/scoring.db` | Database file path or remote URL |
| `LIBSQL_AUTH_TOKEN` | — | Auth token for remote LibSQL |

## Architecture

### Stack

- **Client:** React 18, React Router 6, Vite 5, TailwindCSS 3
- **Server:** Express 4, Node.js, WebSocket (`ws` lib)
- **Database:** LibSQL (SQLite-compatible) via `@libsql/client`

### Data Flow

```
Client (port 3000)
  ↕ REST API + WebSocket
Server (port 3001)
  ↕ SQL
LibSQL database (data/scoring.db)
```

### Real-Time Updates

WebSocket endpoint `/ws` handles live scoring. Clients subscribe to a specific `eventId`; the server broadcasts `{ type, data, eventId }` on any scoring change via `app.broadcast()`. The `app.broadcast` function is attached in `server/index.js` and available across routes.

### Scoring Engine (`server/scoring/engine.js`)

Scoring weights (configurable per event, default: 60% turns / 20% air / 20% speed):
- **Turns:** Drop high/low from 3+ judges, average the rest
- **Air:** Per-jump score × DD (difficulty degree) from `jump_dd_table`, capped at 20 pts
- **Speed:** `pace_time / run_time × pace_factor`, capped at 15 pts

Aerials use a separate scoring path. Dual mogul uses numbered judge 5-point split scoring (defined in `dual/placement.js`).

### Key Server Route Files

| File | Responsibility |
|---|---|
| `server/routes/dual.js` | Dual mogul bracket logic (~54KB, most complex route) |
| `server/routes/runs.js` | Run scoring, manual entry, edit score, auto-finalization |
| `server/routes/results.js` | Results calculation and ranking |
| `server/routes/phases.js` | Multi-phase workflow (Best of 2, Qualifier/Finals) |
| `server/routes/export.js` | CSV/Excel/ZIP export (per-judge TL columns as of v1.7) |
| `server/routes/pdf.js` | PDF generation via pdfkit |
| `server/routes/usss.js` | USSS athlete database endpoints |
| `server/routes/registrations.js` | Athlete registration + SkiReg/USSS CSV import |
| `server/dual/placement.js` | Bracket seeding with band-based randomization |
| `server/usss/sync.js` | USSS People File CSV parser and sync |
| `server/routes/admin.js` | Admin panel API (users CRUD, event lock/unlock, system info) |
| `server/middleware/auth.js` | Auth placeholder middleware (pass-through, activate later) |
| `server/middleware/lockCheck.js` | Event lock enforcement middleware |

### Key Client Files

| File | Responsibility |
|---|---|
| `client/src/utils/api.js` | Centralized API client (~150 functions); all server calls go here |
| `client/src/pages/EventDetail.jsx` | Core scoring UI (~3276 lines); contains `ManualScoreModal` |
| `client/src/pages/JudgeTablet.jsx` | Tablet-optimized judge scoring UI |
| `client/src/pages/HeadJudgeTablet.jsx` | Head judge oversight, approvals, per-judge TL component display |
| `client/src/pages/Scoreboard.jsx` | Live audience-facing results display |
| `client/src/pages/Overlay.jsx` | OBS/YoloBox transparent lower-thirds overlay |
| `client/src/components/Layout.jsx` | App shell; contains version number display in sidebar |
| `client/src/pages/Home.jsx` | Public home page (landing page at `/`) |
| `client/src/pages/LiveScores.jsx` | Public live scores event listing |
| `client/src/pages/Admin.jsx` | Admin panel router shell |
| `client/src/components/AdminLayout.jsx` | Admin panel sidebar/layout |

### Database

Schema is initialized and migrated in `server/db/schema.js`. Core tables: `meets`, `events`, `athletes`, `registrations`, `judges`, `runs`, `judge_scores`, `dual_bracket`, `heats`, `jump_dd_table`, `officials`, `course_specs`, `usss_people`, `audit_log`, `run_round_status`, `event_phases`, `phase_run_order`, `users`.

Auto-backup runs every 5 DB write operations, keeping a maximum of 10 timestamped backups in `data/backups/` (`server/db/autosave.js`).

### Custom TailwindCSS Theme

Custom color tokens: `mountain` (blue), `ice` (cyan), `snow`, `slope`. Custom fonts: Bebas Neue (headings), DM Sans (body), JetBrains Mono (scores/numbers). Defined in `client/tailwind.config.js`.

---

## v1.16.20 Feature Notes

### Admin → USSS People Viewer + CSV Download (v1.16.20)

New admin sub-page at `/admin/usss-people` for viewing and downloading the imported USSS People File (master USSS roster of competitors, coaches/comp, and officials). Read-only — sync/upload controls remain on the Athletes page.

**Status card:** Last imported timestamp + source, list year + identifier + filename, total record count, breakdown by type (Competitors / Coach/Comp / Officials). Sourced from existing `GET /api/usss/status`.

**Search + filter:** Debounced search (300ms) matches `last_name`, `first_name`, `ussa_id`, or `club_name` (LIKE prefix). Type filter dropdown: All / Competitors (C) / Coach/Comp (CO) / Officials (O). Resets to page 1 on change.

**Paginated table (100 per page):** Columns — USSA ID, Last, First, Type, Div, Gen, YOB, Club, AE Pts, DM Pts, MO Pts, FIS ID. Numeric columns right-aligned, points to 2 decimals.

**Type label clarification:** USSS type code `CO` is labeled "Coach/Comp" (not "Coach") because the USSS People File assigns CO to U15+ athletes who hold dual coach/competitor credentials — most are still primarily competitors. Plain `C` is "Competitor", `O` is "Official".

**Download CSV:** Anchor link to `GET /api/admin/usss/people/download` streams the full table (no pagination) as CSV. Filename uses `list_year_list_identifier` (e.g. `usss_people_2026_Fall.csv`), falling back to `usss_people.csv`. Disabled when total = 0.

**New endpoints:**
- `GET /api/admin/usss/people?q=&type=&page=&limit=` — paginated/filtered JSON (default page=1, limit=100, max 500)
- `GET /api/admin/usss/people/download` — full CSV stream

**Sidebar:** New "USSS People" entry in Admin sidebar between "Events" and "Audit Log".

**Files modified:** `server/routes/admin.js`, `client/src/pages/Admin.jsx`, `client/src/components/AdminLayout.jsx`
**Files created:** `client/src/pages/admin/AdminUSSSPeople.jsx`

---

## v1.16.19 Feature Notes

### Dual Mogul Scoreboard — Bracket / Place Tabs + FFSP Points (v1.16.19)

The public dual mogul scoreboard at `/scoreboard/<short>` now has two tabs at the top of the bracket card: **Bracket** (existing tree view) and **Place** (new ranked placement table). The "Final Place List" PDF (`POST /api/pdf/dual-results`) gets a matching **Points** column.

**FFSP (USSS Freestyle Points) — dual mogul only this release.** Computed automatically when `event.status === 'complete'`. Pre-completion the Points column shows `—`.

**Tier selection (auto, no new UI):**
- `events.is_divisional = 1` → Divisional Championships: 1000 / 970 / 950
- else CC ≥ 15 → Divisional Events: 900 / 875 / 855
- else → Divisional Events sub-15: 800 / 775 / 760

4th place onward: `tier[2] − (rank − 3) × (tier[2] / CC)`, floored at 0.

**Counting Competitors (CC):** all placements minus DNS / DSQ / scratched. DNFs count toward CC.

**DNS / DSQ / scratched:** 0 FFSP, excluded from CC.
**First-round DNF:** athlete who DNFs in the literal largest-numbered bracket round (e.g., Round of 32) gets 0 FFSP. An athlete who advanced via a bye and DNFs in their first played match still receives formula-based FFSP.

**New helper — `server/dual/ffsp.js`:** Pure function `computeDualFfsp({ event, bracket, placements })`. No DB calls. Used by both `results.js` and `pdf.js` to keep logic identical. Returns `Map<registration_id, { ffsp, excluded, reason? }>`.

**Server placement augmentation — `server/routes/results.js`:** The dual placements array now includes `registration_id`, `run_status`, and `reg_status` on every entry (additive — existing fields unchanged). Bracket SQL query expanded to pull `rb.status as blue_reg_status, rr.status as red_reg_status`. When `event.status === 'complete'`, `ffsp` is merged into each placement.

**PDF — `server/routes/pdf.js` `dual-results`:** Adds Points column (`width: 0.7`). Representing column reduced from 2.5 to 2.0 to make room. Shows `—` until event completed.

**Scoreboard tab UI — `client/src/pages/Scoreboard.jsx`:** Tab strip styled to match the EventDetail.jsx phase tabs (blue-500 active underline, gray-400 inactive). Place table columns: Place, Bib, Gp, Name, Club, Points. Status indicators: red `DSQ` / `DNS` / `SCR` text in Place column for excluded athletes; small amber `DNF` tag next to rank for non-first-round DNFs. Points column: `r.ffsp.toFixed(2)` when present, `—` otherwise.

**WebSocket integration:** `loadPlacements()` is wired into the same handlers that already trigger `loadBracket()` (`dual_match_started`, `score_update` + `isDual`, `run_updated` + `dualComplete`, `dual_match_cleared`, `dual_bracket_review`, `dual_bracket_sent_back`, `event_finalized`), so the Place tab auto-refreshes alongside the bracket and gains its Points values immediately when the event is finalized.

**Out of scope:** standard mogul / aerials FFSP (explicitly excluded by user request); persisting FFSP to DB (computed on-demand so score edits trigger automatic recompute).

**Files modified:** `server/dual/ffsp.js` (new), `server/routes/results.js`, `server/routes/pdf.js`, `client/src/pages/Scoreboard.jsx`

---

## v1.16.18 Feature Notes

### FIS Truncation Compliance Fixes (v1.16.18)

Brought all scoring paths into compliance with the FIS rule: *"All published scores are to be rounded down or truncated to two (2) decimal places and used in further calculations only in the truncated form. These results and scores include total results and tie-breaking formulae. The Degree of Difficulty (DD) are always presented in their original form."*

v1.16.09 already converted air score and speed score to floor (truncate). DD values were always preserved in original form. This release fixes the remaining four violations where `roundToHundredth` (Math.round, half-up) was used for values that are either published or fed into further calculations.

**Mogul total (`server/scoring/engine.js` line 226):** Final mogul total `turnsContrib + airContrib + speedContrib` now floors to 2dp instead of rounding. This is the score stored in `runs.total_score` and used by tiebreakers, scoreboard, exports, and rankings.

**Turns score (`server/scoring/engine.js` lines 61, 195, 197):** `calcTurnsScore` and both `calcMogulScore` paths (standard 3-judge and non-standard panel) now floor instead of round. The stored `runs.turns_score` value was previously rounded; it is the second tiebreaker after total, so this affects tied finishes.

**Aerials full path (`server/scoring/engine.js` lines 572–579):** Six `roundToHundredth` → `floorToHundredth` swaps in `calcAerialsScore`: per-jump air (`jump1Air`, `jump2Air`), `airTotal`, `formScore`, `landingScore`, and the final `total`. Aerials results are now FIS-compliant end-to-end.

**Pace time (`server/scoring/engine.js` line 137, `server/routes/coursespecs.js` line 16):** `calcPaceTime` and the parallel coursespecs helper now floor `courseLength / paceSpeed`. Pace time is used in the speed score formula, so per FIS it must be truncated.

**Course length recompute (`server/routes/coursespecs.js` line 60):** When course length changes, `recalcSpeedScores` recomputes `total_score = turns + air + newSpeed` for every completed run. This was using `Math.round` on the recomputed total; now uses `Math.floor` so the recomputed published total is FIS-compliant.

**Note on existing data:** Historical runs in the `runs` table retain their previously-rounded `turns_score` / `total_score` values. New runs (and any rescored via the existing edit-score path) use truncated values. A future migration could backfill historical rows by recomputing from `judge_scores` source rows; not done here to avoid altering manually-edited scores.

**Legacy left untouched:** `calcDualMogulResult` (engine.js lines 460–539) is uncalled and retained for reference; its two `roundToHundredth` calls were not changed.

**Files modified:** `server/scoring/engine.js`, `server/routes/coursespecs.js`

---

## v1.16.17 Feature Notes

### Dual Mogul Bracket Complete — HJ Approval Flow (v1.16.17)

Adds a parallel completion flow for dual mogul events, mirroring the standard mogul finalize flow added in v1.16.13. Previously, after the final dual match was approved, the HJ tablet showed "Match approved and finalized" → "Waiting for next match…" indefinitely with no path to event completion. Now, when every bracket match is complete, the HJ tablet shows the completed bracket tree with **Approve & Finalize Event** and **Send Back to Scoring** options.

**Database:** New `events.dual_bracket_review_status TEXT` column. Values: `NULL` (default), `'pending'` (bracket complete, awaiting HJ), `'sent_back'` (HJ kicked back to scoring), `'approved'` (HJ approved → event marked complete).

**Server detection:** New helper `isBracketFullyComplete(eventId)` in `server/routes/dual.js` checks that all `dual_bracket` rows are `status='complete'` or `is_bye=1`. Hooked into the `POST /:matchId/approve` endpoint and both `POST /:matchId/paper-score` paths after `advanceWinner`. When the bracket transitions to fully complete and current review status is NULL, sets to `'pending'` and broadcasts `dual_bracket_review`.

**New endpoints:**
- `GET /api/events/:eventId/dual/review-state` — returns `{ status, bracketComplete }` for HJ/Scoring polling.
- `POST /api/events/:eventId/dual/send-back-to-scoring` — sets status to `'sent_back'`, broadcasts `dual_bracket_sent_back`, audit log entry.
- `POST /api/events/:eventId/dual/resend-to-hj` — sets status back to `'pending'`, broadcasts `dual_bracket_review`.

**Stale review state cleanup:** When the bracket re-opens (a new match starts via `PUT /:matchId/active-match` or judge points are deleted via `DELETE /:matchId/judge-points`), `dual_bracket_review_status` is reset to NULL.

**`/finalize` extension:** `POST /api/events/:eventId/finalize` now refuses dual mogul events whose `dual_bracket_review_status !== 'pending'` (race protection), sets the column to `'approved'` alongside `events.status='complete'`, and broadcasts both `event_finalized` and `run_round_status { event_completed: true }` so dual judge tablets pick it up via the same listener pattern as standard mogul.

**HJ tablet (`HeadJudgeTablet.jsx`):** New `BracketReviewPanel` component renders a compact bracket tree grouped by main vs. consolation side and bracket round. Each match shows blue (bib + lastname) and red (bib + lastname) with the winner highlighted. Two large buttons:
- **Approve & Finalize Event** (green) → calls `/finalize` → shows full-screen "Event Complete — Thank You for Your Work".
- **Send Back to Scoring** (amber) → returns the HJ tablet to an "Awaiting scoring edits…" placeholder.

`DualHeadJudgeView` polls `/dual/review-state` and listens for new WS messages (`dual_bracket_review`, `dual_bracket_sent_back`, `event_finalized`). Render is branched: `eventCompleted` > `reviewStatus='pending' && !activeMatch` (BracketReviewPanel) > `reviewStatus='sent_back' && !activeMatch` (placeholder) > existing active/next match render > "Waiting for next match…" fallback.

**Scoring tab (`EventDetail.jsx` `DualScoringPanel`):** Two new banners above the bracket display:
- Amber "Head Judge requested score edits — edit any match below, then resend." with **Resend to HJ for Approval** button when status is `'sent_back'`.
- Blue "Bracket complete — sent to Head Judge for final approval." notification when status is `'pending'`.

**Edit Scores generalization:** Previously, the "Edit Scores" button on completed matches was gated by `{isPaper && ...}`. Now, completed matches show the **Edit Scores** button regardless of `score_entry_mode`, opening the existing `paper-score` modal pre-populated with the existing 5 judge points. The endpoint already deletes & re-inserts `dual_judge_points`, so it correctly overwrites tablet-entered scores. The original "Enter Scores" button for incomplete matches remains paper-mode only.

**Note:** When an edit changes the winner of a non-leaf match, downstream completed matches do NOT auto-recompute (existing behavior).

**Judge tablet (`JudgeTablet.jsx` `DualJudgeView`):** Adds `eventCompleted` state, polls `/dual/review-state` and listens for `event_finalized` / `run_round_status { event_completed: true }` WS messages. When triggered, renders a full-screen "Event Completed — Thank You for Your Work" message matching the standard mogul JudgeTablet behavior.

**Files modified:** `server/db/schema.js`, `server/routes/dual.js`, `server/index.js`, `client/src/pages/HeadJudgeTablet.jsx`, `client/src/pages/EventDetail.jsx`, `client/src/pages/JudgeTablet.jsx`

---

## v1.16.16 Feature Notes

### No Time (NT) Button on Timekeeper Tablet (v1.16.16)

Added a red "No Time" button on the Timekeeper tablet between "Manual Time Calculation" and "Submit Time". Used when no valid time can be recorded for a run. Shows a confirmation dialog ("Mark [Name] as No Time?") before submitting.

**Scoring:** NT produces a speed score of 0. Internally stored as `run_time = -1` (sentinel value). The scoring engine's `calcSpeedScore` returns 0 for non-positive times. Finalization proceeds normally — the run is not blocked waiting for time.

**Display:** Time column shows "NT" across all surfaces:
- Timekeeper tablet: red "NT" confirmation panel (instead of green checkmark), red "No Time (NT)" on active run banner
- Head Judge tablet: "NT" in time display, "0.00" for time points, "NT" in review table
- Scoreboard: "NT" in time column
- EventDetail: "NT" in run history and results tables
- PDF reports: "NT" in all time columns (via updated `fmtTime` helper)
- CSV/XLSX exports: "NT" in run time column

**Manual Score Modal:** Editing an NT run does not pre-populate -1 into the time field.

**Files modified:** `client/src/pages/TimekeeperTablet.jsx`, `client/src/pages/Scoreboard.jsx`, `client/src/pages/EventDetail.jsx`, `client/src/pages/HeadJudgeTablet.jsx`, `server/routes/pdf.js`, `server/routes/export.js`

### HJ Tablet — Confirmation Dialog for Run Status Buttons (v1.16.16)

DNS, DNF, RNS, and DSQ buttons on the standard mogul Head Judge tablet now show a confirmation dialog ("Mark [Name] as [Status]?") before submitting. Prevents accidental status changes. Does not apply to the dual mogul match status buttons or the green approve/submit score button.

**Files modified:** `client/src/pages/HeadJudgeTablet.jsx`

---

## v1.16.15 Feature Notes

### Registration Workflow Improvements (v1.16.15)

**Required fields validation:** Run Order buttons (Random Order, By Age Groups, Lock Order, Save Order) and Dual Mogul seeding buttons are disabled until all non-scratched athletes have: first name, last name, USSS#, birth year, and bib number. Amber warning shows the count of incomplete athletes.

**Red background for incomplete athletes:** Registration table rows with missing required fields show a subtle red background (`bg-red-900/20`).

**Assign Bibs button moved to Registration section:** Moved from the Run Order card header to the Registered Athletes card header, making it accessible for all event types including dual mogul.

**Auto-prompt USSS sync after CSV import:** After CSV import completes, a blue banner asks "Sync with USSS Database to fill in missing athlete data?" with Yes/No buttons.

**CSV import name-based fallback matching:** `processCsvRows` now falls back to case-insensitive name matching (with birth_year disambiguation) when `ussa_num` lookup fails. Updates missing fields (ussa_num, birth_year, gender, club) on existing athlete records. Prevents duplicate athlete records when athletes were previously entered without USSS#.

**CSV import deduplication for dual mogul:** SkiReg CSVs have separate mogul and dual mogul rows per athlete. For dual mogul events, both rows matched `matchesDiscipline`. Now deduplicates by USSS# within the import loop, merging bib numbers from whichever row has them. Fixes both the duplicate preview count and missing bibs.

**Run Order / Seed List hidden until built:** The Run Order table (mogul/aerials) and Seed List table (dual mogul) are hidden until the user clicks a build/seed function or data was previously saved. Header with action buttons remains visible.

**Run order confirmation only when saved order exists:** "Random Order" and "By Age Groups" confirmation dialogs only appear when a saved run order already exists (`hasRunOrders`), not on first use.

**Random Seed for dual mogul:** New "Random Seed" button on the DualSeedingPanel shuffles all registered athletes randomly. Shows a preview requiring Save, same workflow as other seeding methods.

**Audit Log moved to Admin panel:** Audit Log removed from Officials sidebar, added to Admin panel at `/admin/audit`. Old `/dashboard/audit` URL redirects.

**Files modified:** `server/routes/registrations.js`, `client/src/pages/EventDetail.jsx`, `client/src/components/Layout.jsx`, `client/src/pages/Admin.jsx`, `client/src/components/AdminLayout.jsx`, `client/src/App.jsx`

---

## v1.16.14 Feature Notes

### Import Bibs from Event — Dual Mogul Registration (v1.16.14)

Added "Import Bibs from Event" button to the Registered Athletes section on the Registration tab for dual mogul events. Copies bib numbers from another event's registrations into the dual mogul event, matched by athlete.

**Button:** Appears in the Registered Athletes card header for dual mogul events only. Styled `bg-mountain-600` to match the "Assign Bibs" button on standard mogul events.

**Inline panel:** Clicking the button opens an inline section (not a modal) with a dropdown of same-meet, same-gender events and an "Import" button.

**Confirmation flow:** Clicking Import first runs a preview. If existing bibs will be overwritten, shows an amber warning with counts ("X existing bibs will be overwritten") and requires a second "Confirm Import" click. If no overwrites, imports directly.

**Summary:** After import, shows "Imported X bibs — Y athletes had no match — Z overwritten". Unmatched athletes (present in dual but not in source event) are skipped with their bib unchanged.

**New server endpoints:**
- `POST /events/:eventId/registrations/preview-import-bibs-from-event` — dry-run returning `{ matched, overwritten, skipped }`
- `POST /events/:eventId/registrations/import-bibs-from-event` — executes import, returns `{ updated, overwritten, skipped }`

**Files modified:** `server/routes/registrations.js`, `client/src/utils/api.js`, `client/src/pages/EventDetail.jsx`

### CLAUDE.md Consolidation (v1.16.14)

Moved older version notes (v1.7.00–v1.9.16) from CLAUDE.md to a separate `CHANGELOG.md` file to reduce CLAUDE.md size. CLAUDE.md now retains v1.10.00+ feature notes with a one-line pointer to CHANGELOG.md for older history.

**Files created:** `CHANGELOG.md`
**Files modified:** `CLAUDE.md`

---

## v1.16.13 Feature Notes

### Event Completion Flow Fix (v1.16.13)

Fixed Best of 2 mogul events getting stuck after the Head Judge finalizes Run 2. Previously the HJ tablet showed "Waiting for next athlete...", the Scoreboard showed an empty "NOW COMPETING Bib #", and the Scoring tab showed a phantom "CURRENTLY SCORING" panel.

**Root causes fixed:**
1. **HeadJudgeTablet:** The `eventCompleted` render check was inside the `if (reviewMode)` block. After HJ approval set `reviewMode` to null, the completion screen was unreachable.
2. **Scoreboard & Scoring tab:** `GET /runs/active` returns `{ event_completed: true }` when all phases are finalized. Both components set this as `activeRun` (truthy), causing "Now Competing" / "Currently Scoring" to render with undefined athlete data.
3. **phases.js approve endpoint:** Did not check if all phases were finalized or broadcast `event_completed`, unlike the equivalent `runs.js` endpoint.

**New HJ Final Review screen:** After all phases are finalized, the HJ tablet now shows a combined results table (Place, Bib, Athlete, Run 1, Run 2, Best Score) with a green "Finalize Event" button. Clicking it marks the event as complete and shows the "Event Completed — Thank You" message.

**New server endpoint:** `POST /api/events/:eventId/finalize` — sets event status to 'complete', ensures all phases are finalized, broadcasts event completion.

**Files modified:** `client/src/pages/HeadJudgeTablet.jsx`, `client/src/pages/Scoreboard.jsx`, `client/src/pages/EventDetail.jsx`, `server/routes/phases.js`, `server/routes/events.js`

### Air & Speed Score Display Rounding (v1.16.13)

Changed calculated air scores (after DD multiplication) and speed scores from 1 decimal place (`.toFixed(1)`) to 2 decimal places (`.toFixed(2)`) across all UI surfaces. Raw judge-entered values (TL raw score, air raw score) remain at 1 decimal place.

**Applied to:** HeadJudgeTablet (running score display, review table), Scoreboard (results tables, expanded score detail), EventDetail (run history, results tab).

**Files modified:** `client/src/pages/HeadJudgeTablet.jsx`, `client/src/pages/Scoreboard.jsx`, `client/src/pages/EventDetail.jsx`

### Meet Import — Raw JSON Support (v1.16.13)

The meet import endpoint now accepts both ZIP files and raw JSON files. Previously only ZIP files containing `meet_export.json` were accepted. The endpoint tries ZIP parsing first, then falls back to reading the file as raw JSON. File picker on Dashboard also accepts `.json` files.

**Files modified:** `server/routes/meets.js`, `client/src/pages/Dashboard.jsx`

### iPad/iOS Touch Fixes (v1.16.13)

Fixed non-button elements (`<tr>`, `<div>`) that used `onClick` not responding to touch on iOS Safari. Added `onTouchEnd` handlers and changed `hover:` to `active:` to prevent double-tap-to-hover behavior.

**Fixed elements:** Scoreboard athlete rows (expand score detail), Athletes table rows (inline edit), Audit Log rows (detail view), MeetDetail delete event button.

**Files modified:** `client/src/pages/Scoreboard.jsx`, `client/src/pages/Athletes.jsx`, `client/src/pages/AuditLog.jsx`, `client/src/pages/MeetDetail.jsx`

---

## v1.16.12 Feature Notes

### Athletes Table — Nation Column Removed, Division Added (v1.16.12)

Removed the Nation column from the Athletes page (table display, inline edit form, and manual entry form) because the USSS People File (people.txt) has no nation field — the column was always blank. Replaced with a Division column sourced from the USSS People File's `D` field.

**Database:** New `athletes.division TEXT` column. Populated automatically during USSS sync, Add from USSS Database, and CSV reconcile flows.

**Athletes table column order:** First, Last, Bib, USSA #, FIS ID, Club, Div, Birth Year, Gender, Edit

**Also removed from:** EventDetail.jsx inline "Create New Athlete" form on the Registration tab.

**Note:** The `nation` DB column is preserved for backward compatibility with meet export/import and USSS transmit XML (which defaults to `'USA'` when nation is empty). It is simply no longer displayed or editable.

**Files modified:** `server/db/schema.js`, `server/routes/athletes.js`, `client/src/pages/Athletes.jsx`, `client/src/pages/EventDetail.jsx`

### Auto-Correct ALL CAPS Names (v1.16.12)

When an athlete name is entered in ALL CAPS (e.g., "ANDERSON"), it is automatically converted to standard name case ("Anderson") on save. Applied server-side to all athlete create and update paths.

**Rules:**
- Only transforms if the entire name string is ALL UPPERCASE
- Mixed-case names like "McDonald" or "de la Cruz" are preserved as-is
- Handles multi-word names: "DE LA CRUZ" → "De La Cruz"
- Handles hyphenated names: "SMITH-JONES" → "Smith-Jones"
- Handles apostrophes: "O'BRIEN" → "O'Brien"

**Applied to:** POST `/athletes` (create), PUT `/athletes/:id` (update), POST `/athletes/from-usss`, POST `/athletes/reconcile/apply`, POST `/athletes/usss-sync`

**Files modified:** `server/routes/athletes.js`

### Admin Dashboard Version Fix (v1.16.12)

Fixed stale version strings in `server/routes/admin.js` — system info and dashboard endpoints were reporting `v1.16.10` instead of the current version.

**Files modified:** `server/routes/admin.js`

---

## v1.16.11 Feature Notes

### DNS/DNF/DSQ Status as Score Text (v1.16.11)

When an athlete's run results in DNS, DNF, DSQ, or RNS, the score/total column now displays the status text instead of "–" or blank. Pending/not-yet-scored runs still show "–".

**Applied to:**
- **Scoreboard** (all 3 layouts: Best of 2, Qualifier/Finals, Standard): Total/Score column and per-run phase columns show status text
- **Results tab** (`EventDetail.jsx`): Total column shows status text
- **PDF reports**: Event Results Summary, Check Sheet by Bib, Check Sheet by Run Order — Total column shows status text

Component breakdown columns (Turns, Air, Speed, Time) remain "–"/blank for DNS/DNF/DSQ athletes — only the Total/Score column changes.

**Files modified:** `client/src/pages/EventDetail.jsx`, `client/src/pages/Scoreboard.jsx`, `server/routes/pdf.js`

### Scoreboard Click-to-Expand Score Detail (v1.16.11)

Clicking an athlete row on the live scoreboard reveals a per-run detail row showing per-judge score breakdowns. Client-side only — does not affect other users viewing the same scoreboard.

**Detail row format (one line per run):**
`Run 1: TL1 5.5 TL2 4.5 TL3 1.2 S/bp A1 3.4 A2 4.5 T: 23.23 TPt: 16.3 Total: 56.23`

- Clicking the same athlete collapses the detail row
- Clicking a different athlete switches the detail to the new athlete
- Refreshing the page clears the expanded state
- DNS/DNF/DSQ runs show `Run N: DNS` etc.
- Multi-phase events show one line per run/phase
- Not applied to dual mogul bracket view

**New server endpoint:** `GET /api/events/:eventId/results/judge-scores` — returns bulk per-judge scores and all completed runs for the event in a single call. Pre-fetched on scoreboard load.

**Files modified:** `server/routes/results.js`, `server/routes/phases.js`, `client/src/pages/Scoreboard.jsx`

### Best-of-2 Flagged Athletes Run Data Fix (v1.16.11)

Fixed DNS/DNF/DSQ-only athletes in best-of-2 events showing "–" in per-run columns instead of their status. Root cause: flagged athletes (those with only DNS/DNF/DSQ runs) were added to results without the `runs` sub-object attached. Now `runs` data is included for flagged athletes.

**Files modified:** `server/routes/phases.js`

---

## v1.16.10 Feature Notes

### Meet Import Duplicate Detection (v1.16.10)

When importing a meet ZIP file, if a meet with the same name already exists on the server, a warning modal appears with four options:

**Warning modal displays:**
- Meet name and last-modified dates for both the server version and import file
- Side-by-side comparison cards

**Four action options:**
- **Cancel** — abort the import
- **Import as Duplicate** — creates a new meet with "(Duplicate)" appended to the name. If that name also exists, uses "(Duplicate 2)", etc.
- **Merge** — adds new data to the existing meet and updates older data. Matches events by discipline + gender. Adds new events, registrations, runs, judges, etc. that don't exist. Updates existing records only when the import data is newer (by `updated_at` timestamp comparison).
- **Overwrite** — requires a second confirmation click. Deletes all existing data for the meet and imports fresh.

**Two-step API flow:** The server caches parsed import data (30-minute expiry) after the first upload so the ZIP doesn't need to be re-uploaded when the user picks an action. Pending imports are automatically cleaned up.

**Merge algorithm details:**
- Events matched by `discipline + gender` (falls back to name comparison if multiple matches)
- Athletes deduplicated by USSA#, FIS ID, or name+birth_year (reuses existing logic)
- Registrations matched by `event_id + athlete_id`
- Judges matched by `event_id + role`
- Runs matched by `event_id + registration_id + run_number + round`
- Judge scores matched by `run_id + judge_id + score_type`
- All updates respect `updated_at`/`submitted_at` timestamps — only newer data overwrites

**Delete cascade bug fix:** The meet delete cascade was missing `event_phases`, `phase_run_order`, and `run_round_status` tables. Fixed by extracting the cascade into a shared `deleteMeetCascade()` helper used by both `DELETE /meets/:id` and the overwrite path.

**Files created:** `client/src/components/ImportConflictModal.jsx`
**Files modified:** `server/routes/meets.js`, `client/src/pages/Dashboard.jsx`

---

## v1.16.09 Feature Notes

### Air Score Rounding — Winfree Compatibility (v1.16.09)

Fixed 0.01-point air score discrepancies between StickIt and Winfree. StickIt previously computed `avg(judges) × DD` then floored. Winfree floors each judge's `score × DD` individually, averages those (keeping full precision), sums both jumps (keeping full precision), then floors the final total.

**`calcJumpScore` (engine.js):** Now floors each judge's `score × DD` individually before averaging:
```javascript
const perJudge = airJudgeScores.map(s => floorToHundredth(s * dd));
return perJudge.reduce((a, b) => a + b, 0) / perJudge.length;
```

**`calcMogulScore` air combination (engine.js):** Changed `roundToHundredth` to `floorToHundredth` when combining jumps (both single-jump doubling and two-jump sum paths).

**Files modified:** `server/scoring/engine.js`

### HJ Review Screen Flashing Fix (v1.16.09)

Fixed "Loading review data…" flashing on the Head Judge tablet every 3 seconds when a phase is sent for HJ review.

**Root cause:** `checkReviewStatus()` was defined in component scope and captured `reviewMode` state via closure. The polling interval called this function every 3 seconds, but always saw the initial `reviewMode` (null) due to stale closure, causing it to re-fetch and flash `reviewLoading` on every poll cycle.

**Fix:** Added `reviewModeRef` ref to track the current reviewMode value. `checkReviewStatus()` now reads from `reviewModeRef.current` instead of the closed-over state variable.

**Files modified:** `client/src/pages/HeadJudgeTablet.jsx`

### Age Group Transition — Devo Only (v1.16.09)

Age group transition messages on Judge, Head Judge, and Timekeeper tablets now only appear for Devo events. Previously fired for all divisions including Comp Series and RQS.

**Fix:** `getAgeGroupTransition()` in `runs.js` queries the event's `division` column and returns `null` early if not `'devo'`.

**Files modified:** `server/routes/runs.js`

### Live Score Rankings — Overall Place (v1.16.09)

During Run 2 of best-of-2 events, rankings now show overall place (best score across all runs) instead of run-specific place.

**Fix:** New `computeOverallRank()` helper detects phase-based events and ranks by `MAX(total_score)` per athlete across all runs. Used at all 3 score broadcast sites (auto-finalize no-HJ, auto-finalize after time submit, HJ approval).

**Files modified:** `server/routes/runs.js`

### Phase Status Sync After HJ Approval (v1.16.09)

Fixed Phases tab showing "Sent to Head Judge" after HJ approval. The HJ tablet called `POST /runs/round-status/:runNumber/approve` which only updated `run_round_status` but not `event_phases`.

**Fix:** All four round-status endpoints (approve, send-review, return, reopen) now also update the corresponding `event_phases` row to keep both tables in sync.

**Files modified:** `server/routes/runs.js`

### Event Completed Message on Tablets (v1.16.09)

After all phases are finalized in a multi-phase event, all tablets show a full-screen "Event Completed — Thank You for Your Work" message.

**Detection:** Server checks if all `event_phases` have `status='finalized'` and includes `event_completed: true` in the HJ approval broadcast and `GET /runs/active` response.

**Client:** Judge, Head Judge, and Timekeeper tablets detect event completion via both polling and WebSocket, displaying a dark overlay with completion message.

**Files modified:** `server/routes/runs.js`, `client/src/pages/JudgeTablet.jsx`, `client/src/pages/HeadJudgeTablet.jsx`, `client/src/pages/TimekeeperTablet.jsx`

### Air Quick Select Button Updates (v1.16.09)

Updated Comp Series air judge quick select buttons: replaced `bP` (Back Pike) with `bp` (Back Position) and added `K` (Kosak). New order: `N, S, T, K, TS, 3, bT, bp, bL, bG, bF, 7op, 7oG`. In the dropdown, `bP` now shows a warning: `⚠ bP (DD ...) — rarely used`.

**Files modified:** `client/src/pages/JudgeTablet.jsx`

### Decimal Formatting Consistency (v1.16.09)

Standardized decimal display across all UI surfaces:
- **Air, TL, and Speed component scores:** Always 1 decimal place (`.toFixed(1)`) — e.g., `6` → `6.0`
- **Time values:** Always 2 decimal places (`.toFixed(2)`) — e.g., `25` → `25.00`
- **Total/final scores:** Always 2 decimal places

Applied to: JudgeTablet (ScorePad buttons, submitted score display), HeadJudgeTablet (per-judge scores, running score, calculated score, review table), EventDetail (run history tables), Scoreboard (all score columns).

**Files modified:** `client/src/pages/JudgeTablet.jsx`, `client/src/pages/HeadJudgeTablet.jsx`, `client/src/pages/EventDetail.jsx`, `client/src/pages/Scoreboard.jsx`

---

## v1.16.08 Feature Notes

### Upright Jump DD Values Corrected (v1.16.08)

Fixed incorrect DD (Degree of Difficulty) values for all upright jump codes. Previously, standalone codes (S, T, D, X, Y, M, K) and combination codes (SS, TS, TT, TD, DTS, TST, TTS, TTSS, TTSSD) stored only the base value (Single/Double/Triple/Quad/Quint) without applying per-letter modifiers from the FIS DD chart.

**Formula:** DD = base (Single=0.40/0.50, Double=0.53/0.63, etc.) + sum of modifiers per letter (T=-0.02, S=-0.02, D=+0.01, X=+0.01, Y=+0.01, M=+0.01, K=+0.01, Z=0).

**Examples of corrected values (Men/Women):**
- `S`: 0.40/0.50 → **0.38/0.48** (Single + Spread -0.02)
- `TS`: 0.53/0.63 → **0.49/0.59** (Double + T -0.02 + S -0.02)
- `TD`: 0.53/0.63 → **0.52/0.62** (Double + T -0.02 + D +0.01)
- `TTSS`: 0.76/0.86 → **0.68/0.78** (Quad + 4 modifiers)

**Migration:** Existing databases are automatically corrected on server startup. Detection checks if `S` female mogul DD = 0.50 (known wrong value) and updates all affected codes across mogul and dual_mogul disciplines.

**Files modified:** `server/db/schema.js`

### Head Judge Clear Codes Fix (v1.16.08)

Fixed air judges being stuck on "Score Submitted" after the Head Judge clicks "Clear Codes" to allow jump code re-entry.

**Root cause:** "Clear Codes" only nulled out `jump1_code`/`jump2_code` on the run record but did not remove air judge scores from `judge_scores`. The air judges' tablets detect rejection by polling for their score in the `submitted` array — since their scores were still present, they never received the rejection signal.

**Server fix:** `PUT /:runId` with `clear_jump_codes: true` now also deletes all air judge score rows (`score_type IN ('air_jump1','air_jump2')`) from `judge_scores` for that run. This triggers the existing rejection detection on air judge tablets.

**Client fix:** When an air judge detects rejection, `codesSubmitted`, `code1`, and `code2` are now also reset (previously only `airJ1`/`airJ2` were cleared). This ensures the air judge returns to the jump code entry step, not just the score entry step.

**Files modified:** `server/routes/runs.js`, `client/src/pages/JudgeTablet.jsx`

---

## v1.16.07 Feature Notes

### Manual Bracket Save Fix (v1.16.07)

Fixed "Converting circular structure to JSON" error when clicking "Save Manual Bracket" in the Manual Bracket Builder for dual mogul events.

**Root cause:** Two issues:
1. `onClick={saveManualBracket}` passed the React MouseEvent as the `force` parameter, which was included in the `JSON.stringify()` payload. MouseEvents contain DOM element references with circular React fiber properties.
2. React state objects can carry internal metadata. The fix explicitly strips `manualSlots` to plain `{ matchIndex, blue, red }` objects before serialization.

**Files modified:** `client/src/pages/EventDetail.jsx`

---

## v1.16.06 Feature Notes

### USSS / FIS Pace Time Standard Toggle (v1.16.06)

Added a USSS/FIS toggle to the Course Specifications panel on the meet detail page. USSS is the default. Previously, only FIS pace speeds were used.

**Pace speeds by standard:**
| Standard | Men | Women |
|---|---|---|
| USSS (default) | 9.70 m/s | 8.20 m/s |
| FIS | 10.30 m/s | 9.00 m/s |

**Database:** New `pace_standard TEXT NOT NULL DEFAULT 'usss'` column on `course_specs` table. Persisted and propagated to all events on save.

**Server:** `calcPaceTime()` in both `server/scoring/engine.js` and `server/routes/coursespecs.js` now accepts a `standard` parameter. All endpoints (GET, PUT, POST, DELETE, legacy PUT) pass the standard through. `propagatePaceToEvents()` and `inheritCourseSpec()` use the stored standard.

**Client:** Pill-style USSS/FIS toggle in the pace time section. Speed labels update dynamically (e.g., "Men (9.70 m/s)" for USSS). Calculated pace times update instantly on toggle.

**Files modified:** `server/db/schema.js`, `server/scoring/engine.js`, `server/routes/coursespecs.js`, `server/routes/events.js`, `server/routes/meets.js`, `client/src/pages/MeetDetail.jsx`

### Order Locked Persistence & Enforcement (v1.16.06)

The "Lock Order" button on the Registration tab now persists to the database and enforces run order integrity.

**Database:** New `events.order_locked INTEGER NOT NULL DEFAULT 0` column.

**When locked:**
- Random Order, By Age Groups, up/down reorder arrows, and Save Order buttons are all disabled
- Scratching an athlete clears their `run_order` (and `phase_run_order` if phases exist)
- Adding an athlete or un-scratching shows a placement dialog: "Start of Run Order", "End of Run Order", or "Random Position"
- Lock state persists across page refreshes via `PUT /api/meets/:meetId/events/:eventId`

**Placement dialog:** Appears on all add paths (search, create, bulk, USSS register) and when changing status from scratched back to registered while order is locked and run orders exist.

**Files modified:** `server/db/schema.js`, `server/routes/events.js`, `server/routes/registrations.js`, `server/routes/meets.js`, `client/src/pages/EventDetail.jsx`

### Registration Status Simplified (v1.16.06)

Removed DNS, DNF, and DSQ options from the registration status dropdown on the Registered Athletes table. Only "Registered" and "Scratched" remain. DNS/DNF/DSQ are handled in the scoring workflow, not on the registration tab.

**Files modified:** `client/src/pages/EventDetail.jsx`

### Manual Bracketing for Dual Moguls (v1.16.06)

New "Manual Bracketing" button on the Dual Bracket tab alongside the existing "FIS Bracketing" button. Allows hand-placing each athlete from the seed list into specific blue/red bracket slots with explicit bye placement.

**Manual Bracket Builder:** Full-screen modal with a responsive grid of first-round match cards. Each card has blue and red dropdowns showing available (unplaced) athletes and a BYE option. Athletes disappear from other dropdowns once placed. Status bar shows athletes placed, bye count, and matches complete. Green checkmarks on complete matches, red border on invalid both-BYE matches.

**Validation:** All seeded athletes must be placed, no duplicates, no both-BYE matches. "Save Manual Bracket" button only enabled when all slots are validly filled.

**Bracket size:** Auto-calculated from seed list count (same as FIS). Byes are manually placed by the user on either blue or red side. Once saved, the bracket is identical in the database to an FIS-generated bracket — all scoring, advancement, PDF, and results logic works unchanged.

**New server endpoint:** `POST /api/events/:eventId/dual/seed-manual` — accepts `{ slots: [{matchIndex, blue, red}...] }`. Reuses existing `buildBracketShell()` and `advancementSlot()`. Same conflict/started-matches guards as `seed-fis`.

**Files modified:** `server/routes/dual.js`, `client/src/pages/EventDetail.jsx`

---

## v1.16.05 Feature Notes

### Meet Export/Import Fix (v1.16.05)

Fixed "undefined cannot be passed as argument to the database" error when importing meet export ZIP files. Three categories of issues:

**`||` replaced with `??` throughout import** — The `||` operator treats `0`, `""`, and `false` as falsy, replacing valid zero scores (e.g., `turns_score: 0`) with `null`. Changed all bind parameters to use `??` (nullish coalescing) which only replaces `null`/`undefined`.

**Missing columns added to import INSERTs** — The export uses `SELECT *` and captures all columns, but the import INSERT statements were missing columns added since the export/import feature was built:
- **events**: `num_jumps`, `is_divisional`, `locked`, `short_code`, `pace_time_override`, `dual_random_seed`
- **runs**: `bracket_round`, `bracket_position`, `course`
- **judges**: `short_code`

**Orphaned record protection** — Map lookups (e.g., `regMap[r.registration_id]`) that return `undefined` when referencing deleted registrations, judges, or matches now use `?? null` fallbacks. Critical inserts (runs, judge_scores, dual_judge_points, phase_run_order) skip orphaned records with `continue` instead of passing `undefined` to the database.

**Files modified:** `server/routes/meets.js`

---

## v1.16.04 Feature Notes

### DNS Button on Up Next Athlete (v1.16.04)

Added a yellow "DNS" button next to the Start Run button for the Up Next athlete on the Scoring tab, Head Judge tablet, and Timekeeper tablet. Mogul and aerials events only (not dual mogul). Shows a confirmation dialog ("Mark [Name] as DNS?") before marking the athlete. Uses existing `POST /runs/manual` endpoint with `run_status: 'DNS'`. Auto-advances to the next athlete after confirmation.

**Scoring tab:** Yellow button between Start Run and Manual Entry, visible only for the first Up Next athlete (`idx === 0`).

**Head Judge & Timekeeper tablets:** Small yellow DNS button to the right of the blue Start Run button in a flex row. Start Run takes most of the width.

**Files modified:** `client/src/pages/EventDetail.jsx`, `client/src/pages/HeadJudgeTablet.jsx`, `client/src/pages/TimekeeperTablet.jsx`

### Admin Dashboard (v1.16.04)

New Admin Dashboard page at `/admin/dashboard`, replacing System Info as the default admin landing page. Displays:

- **Key metrics:** Server uptime, app version, WebSocket connection count, system IP address + port
- **Run statistics:** Active (blue pulse), pending (yellow), complete (green) run counts
- **Database:** Counts for meets, events, athletes, registrations, users; DB file size, last backup time, backup count
- **Disk space:** Progress bar with used/total/percentage
- **Error log:** Collapsible table of in-memory server errors since startup (max 100, ring buffer)
- **Recent activity:** Collapsible table of last 20 audit log entries
- **Auth status:** Placeholder notice

Auto-refreshes every 30 seconds. System Info route (`/admin/system`) redirects to dashboard.

**New server endpoint:** `GET /api/admin/dashboard` — returns all dashboard data in a single call.

**Server setup:** `app.wss`, `app.startedAt`, `app.errorLog` added to `server/index.js`. Error-capturing Express middleware pushes to in-memory ring buffer.

**Files created:** `client/src/pages/admin/AdminDashboard.jsx`
**Files modified:** `server/index.js`, `server/routes/admin.js`, `client/src/pages/Admin.jsx`, `client/src/components/AdminLayout.jsx`

### Run Order by Age Groups (v1.16.04)

New "By Age Groups" button replaces "Seed from Results" in the Run Order section on the Registrations tab. Available for all event categories. Orders athletes by USSS age class (U7, U9, U11, U13, U15, U17, U19, Sr, Vet) with youngest first, randomized within each age group.

**Age Class column:** Added to the Run Order table showing each athlete's computed age class.

**New server endpoint:** `POST /events/:eventId/registrations/order-by-age-groups` — computes age class from `birth_year` and `event_date`, groups and shuffles, updates `run_order`. Syncs to `phase_run_order` if phases exist.

**Files modified:** `server/routes/registrations.js`, `client/src/pages/EventDetail.jsx`, `client/src/utils/api.js`

### Age Group Transition Messages on Tablets (v1.16.04)

When a run completes and the next athlete is in a different age group, an amber pulsing banner appears on Judge, Head Judge, and Timekeeper tablets: "[Age Group] group complete — [Next Age Group] up next". Auto-dismisses after 15 seconds or on tap. Not shown on Scoreboard or Overlay.

**Server:** `computeAgeClass()` and `getAgeGroupTransition()` helpers added to `server/routes/runs.js`. Transition data included in `score_update` and `run_updated` broadcasts when age group changes (HJ approve, auto-finalize, and DNS paths).

**Files modified:** `server/routes/runs.js`, `client/src/pages/JudgeTablet.jsx`, `client/src/pages/HeadJudgeTablet.jsx`, `client/src/pages/TimekeeperTablet.jsx`

---

## v1.16.03 Feature Notes

### Hide Locked Events from Officials Interface (v1.16.03)

Locked events are now completely hidden from the Dashboard (officials interface). Meets where ALL events are locked are also hidden from the Dashboard meets list. Locked events remain visible on public pages (LiveScores, Scoreboard, Overlay) and are still accessible via direct URL on tablets.

**Server changes:** `GET /api/meets` and `GET /api/meets/:id` accept `?excludeLocked=1` query parameter. When set, event counts exclude locked events and meets with zero unlocked events are omitted (newly created meets with no events still show).

**Files modified:** `server/routes/meets.js`, `client/src/utils/api.js`, `client/src/pages/Dashboard.jsx`, `client/src/pages/MeetDetail.jsx`

### Meet Officials Notice Removed (v1.16.03)

Removed the "Officials are now assigned per event" notice from the meet detail page. Course Specifications panel moved up into its position.

**Files modified:** `client/src/pages/MeetDetail.jsx`

### Registration Table — Age Class Column (v1.16.03)

Replaced the "Nation" column with "Age Class" on the Registered Athletes table. Age class (U7, U9, U11, U13, U15, U17, U19, Sr, Vet) is computed client-side from `birth_year` and `event_date` using USSS season rules (July 1 start).

**Files modified:** `client/src/pages/EventDetail.jsx`

### Run Order — DNS Columns Removed (v1.16.03)

Removed R1/R2/R3 DNS checkbox columns from the Run Order table. DNS functionality remains available elsewhere in the scoring workflow.

**Files modified:** `client/src/pages/EventDetail.jsx`

### Collapsible Registered Athletes & Run Order (v1.16.03)

Registered Athletes and Run Order sections on the event registration page are now collapsible with a chevron toggle. Both default to collapsed. Header bars with action buttons remain visible when collapsed. Sections auto-expand when athletes are added (search, create, bulk, USSS, CSV import) or run order is modified (random, seed, save).

**Files modified:** `client/src/pages/EventDetail.jsx`

### Edit Meet Settings (v1.16.03)

New "Edit Meet Settings" link below the location/date on the meet detail page. Opens a modal to edit meet name, location, and start date. Uses existing `PUT /api/meets/:id` endpoint.

**Files modified:** `client/src/pages/MeetDetail.jsx`

### TD Report Updates (v1.16.03)

- Title changed from "USSA" to "USSS Freestyle Technical Delegate Report"
- Instruction text updated from "USSA" to "USSS"
- Send-to line changed to generic role titles: "USSS Freestyle Head TD, ResultPackets@ussa.org, Organizing Committee, Division Head TD"

**Files modified:** `server/routes/pdf.js`

---

## v1.16.02 Feature Notes

### Collapsible Events on Live Scores Page (v1.16.02)

Events under each meet on the `/livescores` page are now collapsed by default. Meet headers are clickable with a chevron toggle to expand/collapse the event list. Event count shown when collapsed (e.g., "3 events").

**Files modified:** `client/src/pages/LiveScores.jsx`

### Admin Event Management — Grouped by Meet (v1.16.02)

Replaced the flat event table on the Admin Events page (`/admin/events`) with meet-grouped collapsible sections. Each meet section shows:
- Meet name and date in a header row with expand/collapse chevron (collapsed by default)
- Lock status summary when collapsed ("All locked" / "Partially locked")
- **Lock All / Unlock All** button per meet to bulk-toggle all events in that meet
- Individual per-event lock/unlock preserved inside the expanded table
- "Meet" column removed from event rows since events are already grouped under their meet

**New API endpoints:**
- `PUT /api/admin/meets/:meetId/lock-all` — locks all events in a meet
- `PUT /api/admin/meets/:meetId/unlock-all` — unlocks all events in a meet

**Files modified:** `client/src/pages/admin/AdminEvents.jsx`, `server/routes/admin.js`

---

## v1.16.00 Feature Notes

### Home Page (v1.16.00)

New landing page at `/` replacing the Dashboard as the default route. Full-page translucent background image with centered StickIt logo, "Freestyle Scoring" tagline, and three navigation buttons: Live Scores (public), Officials (existing Dashboard), Admin (new admin panel). Uses Oswald/Barlow fonts. CSS animations for fade-in effects. Footer shows "© Rocky Mountain Freestyle" and app version.

**Routing change:** Dashboard moved from `/` to `/dashboard`. All internal links updated (`/meets/:id` → `/dashboard/meets/:id`, etc.). Layout sidebar has a "Home" link back to `/`.

**Files created:** `client/src/pages/Home.jsx`, `client/src/pages/Home.css`
**Files modified:** `client/src/App.jsx`, `client/src/components/Layout.jsx`, `client/src/pages/Dashboard.jsx`, `client/src/pages/MeetDetail.jsx`, `client/src/pages/EventDetail.jsx`, `client/index.html`
**Static assets:** `server/public/images/homepage-bg.jpg`, `server/public/images/stickit-logo-home.png`

### Live Scores Event Listing (v1.16.00)

Public page at `/livescores` listing all meets grouped by meet, sorted latest date first. Division filter dropdown at top. Pagination at 10 meets per page. Each event links to its scoreboard. Status indicators: green pulse for active events, blue badge for complete, gray for setup. Dark theme consistent with homepage.

**New API endpoint:** `GET /api/meets/livescores?division=&page=&limit=` — returns paginated meets with nested events array.

**Files created:** `client/src/pages/LiveScores.jsx`
**Files modified:** `server/routes/meets.js`

### System Administrator Panel (v1.16.00)

New admin section at `/admin` with its own sidebar layout. Three sections:

**User Management (`/admin/users`):** Full CRUD for user accounts. Users table with: username, display_name, role (official / event_admin / system_admin), is_active status. Create, edit, and deactivate users. Password field present but disabled with "Authentication coming in a future build" note.

**Event Management (`/admin/events`):** Table of all events across all meets. Lock/Unlock toggle per event. Locked events are visible but read-only in the Officials workflow — all mutation endpoints return 403.

**System Info (`/admin/system`):** Displays app version and database statistics (counts of meets, events, athletes, registrations, users). Authentication status indicator.

**Database:** New `users` table. New `events.locked INTEGER DEFAULT 0` column.

**New API endpoints:**
- `GET/POST /api/admin/users`, `GET/PUT/DELETE /api/admin/users/:id`
- `GET /api/admin/events`, `PUT /api/admin/events/:eventId/lock`, `PUT /api/admin/events/:eventId/unlock`
- `GET /api/admin/system`
- `GET /api/version`

**Files created:** `server/routes/admin.js`, `server/middleware/auth.js`, `server/middleware/lockCheck.js`, `client/src/pages/Admin.jsx`, `client/src/components/AdminLayout.jsx`, `client/src/pages/admin/AdminUsers.jsx`, `client/src/pages/admin/AdminEvents.jsx`, `client/src/pages/admin/AdminSystem.jsx`, `client/src/components/AuthGuard.jsx`
**Files modified:** `server/db/schema.js`, `server/index.js`, `server/routes/runs.js`, `server/routes/registrations.js`, `server/routes/judges.js`, `server/routes/dual.js`, `server/routes/phases.js`, `server/routes/heats.js`

### Activating Authentication (Future)

To enable authentication in a future build:
1. Install `bcrypt` and `jsonwebtoken` packages
2. Implement `POST /api/auth/login` endpoint that verifies password hash and issues JWT
3. Update `server/middleware/auth.js`: `requireAuth` should verify JWT from Authorization header, look up user, attach to `req.user`; `requireRole` should check `req.user.role`
4. Update `client/src/components/AuthGuard.jsx` to check auth state (React context or store) and redirect to `/login` if not authenticated
5. Create a Login page component at `/login`
6. Enable the password hash field in users CRUD (server + client)
7. The "Login Required" divider on the home page is already in place

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

> **Older version notes (v1.7.00 – v1.9.16):** See [CHANGELOG.md](CHANGELOG.md)

---

## Registration Import Notes

### SkiReg CSV Format

Columns: `Last Name, First Name, Gender, Birth Year, USSS Member #, Team, Bib, Category Entered, Quantity, Transaction Type, Date of Birth, MerchSummary`

Key quirks:
- Column is `Category Entered` (not `Category Entered / Merchandise Ordered` — both handled)
- One row per category; athletes with mogul + dual have 2+ rows with the same `USSS Member #`
- Bib number is only on the mogul (single) row; dual/banquet rows have empty `Bib`

### `matchesDiscipline` logic (`registrations.js`)

- `mogul`: category contains `'mogul'` AND NOT `'dual'`
- `dual_mogul`: category contains `'mogul'` (any mogul string accepted — USSS often uses plain "Moguls" for dual entrants)
- `aerials`: category contains `'aerial'`

### Bib Assignment Behavior

When the bib conflict dialog appears and user chooses "Fill In Missing":
- **Run Order mode:** Returns an error — do NOT assign any bibs (positional bibs would conflict)
- **Random / Copy mode:** Assigns available bib numbers (starting from 1, skipping taken ones) only to athletes with no bib currently assigned
