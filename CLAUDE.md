# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**StickIt** is a full-stack freestyle mogul scoring application for managing ski/snowboard competitions (moguls, dual moguls, aerials) for US Ski & Snowboard (USSS) events.

**Current version:** v1.25.02

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
zip -r "/tmp/StickIt_X_X_XX.zip" server/ client/ CLAUDE.md \
  --exclude "*/node_modules/*" "*/.claude/*" "*/data/*" "client/dist/*"

# Why each exclusion:
#   */node_modules/*  → installed deps (~100MB)
#   */.claude/*       → Claude Code worktrees + chat artifacts (can balloon zip to 15M+)
#   */data/*          → runtime DB + uploaded logos + backups (production has its own)
#   client/dist/*     → Vite build intermediate (final assets already in server/public/assets)

# Verify root contents — must ONLY show server, client, CLAUDE.md
unzip -l /tmp/StickIt_X_X_XX.zip | awk '{print $4}' | awk -F'/' '{print $1}' | sort -u
# Verify size — should be ~2MB. If it's >5MB, an exclusion is missing.
ls -lh /tmp/StickIt_X_X_XX.zip

# Deliver
cp "/tmp/StickIt_X_X_XX.zip" "/Users/daviddreitlein/Desktop/Scoring Server/Scoring Zip Files/"
rm /tmp/StickIt_X_X_XX.zip
```

**Zip naming:** `StickIt_X_X_XX.zip` — version number only, no date suffix (e.g. `StickIt_1_7_00.zip`).

Zip destination: `/Users/daviddreitlein/Desktop/Scoring Server/Scoring Zip Files/`

### Version String

The version string lives in **two** places in `server/index.js` (~line 111 and ~line 194):
```js
app.get('/api/version', (req, res) => res.json({ version: 'v1.18.00' }));
// ...
server.listen(PORT, () => console.log(`StickIt v1.18.00 ready on port ${PORT}`));
```
Also displayed in `client/src/components/Layout.jsx` sidebar (~line 185). The About modal reads from `/api/version` automatically. Bump all three on every release.

`package.json` versions in `client/` and `server/` are kept in sync with the app version too (set to `1.18.00` as of v1.18.00).

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

**Mogul** — Total = Turns + Air + Speed (max 100.0):
- **Turns (max 60):** Sum the 3 counting T&L judge scores (5-judge format) or drop-high/drop-low and sum the 3 counting scores (7-judge format), per FIS JH 6203
- **Air (max 20):** Per-jump average of `(judge_score × DD)` summed across jumps, capped at 20 pts (FIS JH 6204). Single-jump-in-2-jump-event capped at 10 per USSS 4210.2.2
- **Speed (max 20):** `max(0, 48 − 32 × (run_time / pace_time))` capped at 20, per USSS / FIS ICR 4206.3. `pace_time` derives from course length and pace standard (USSS 9.70 / 8.20 m/s; FIS 10.30 / 9.00 m/s)

Mogul tie-break per FIS ICR 4207.3: Total → Turns → Air-no-DD (raw execution, stored in `runs.air_score_no_dd`) → Speed.

**Aerials v2 (default for events created at or after v1.18.00)** — Per FIS Judging Handbook 6004 / USSS 4110, every scoring judge submits Air (0.0–2.0), Form (0.0–5.0), Landing (0.0–3.0) for each jump. Per jump:
```
total_judges_score  =  sumKept(Air) + sumKept(Form) + sumKept(Landing)
jump_score          =  floor(total_judges_score × DD, 2dp)
event_total         =  sum across jumps
```
Reduction rule: panels of 5+ drop high+low per component automatically; panels of 2–4 use an operator-selected `aerials_reduction_method` (`sum_all` default, `drop_high`, `drop_low`, `average`). v2 events are detected by `events.aerials_panel_size IS NOT NULL`; runs carry `aerials_model='v2'`. Engine entry point: `calcAerialsScoreV2`. Tie-break per USSS 4110.4.3: Total → Air-no-DD → Form → Landing.

**Aerials legacy (pre-v1.18.00 events)** — `events.aerials_panel_size IS NULL`; runs carry `aerials_model=NULL`. Component-specific judge roles (`AirJudgeN`/`FormJudgeN`/`LandingJudgeN`), single Form/Landing per run, Air-only DD multiplication. Engine entry point: `calcAerialsScore`. Read-only for historical results — new aerials events all use v2.

**Dual mogul** uses numbered judge 5-point split scoring (defined in `server/scoring/engine.js` `calcDualMogulPointSplit` and `dual/placement.js` for bracket seeding).

All published values are truncated (floor) to 2 decimals per FIS rules; DDs preserved at full precision.

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

### Access Model (v1.25.00, A-2/A-10)

Which surfaces are public vs. protected when password protection is enabled:

**Public by design (no login, ever):**
- Judge / Head Judge / Timekeeper / Aerials judge tablets and all their scoring endpoints — secured only by unguessable short-code URLs. Auth work must never lock these out mid-meet.
- Public pages: Home (`/`), Live Scores, Scoreboard, Overlay, Help, and the read-only Viewer API (`/api/viewer`).
- PDF endpoints reachable from the public Scoreboard: `event-results-detailed`, `dual-bracket`, `dual-results`, plus `GET /api/pdf/logo/:meetId`. Every other PDF endpoint requires auth (policy comment at the top of `server/routes/pdf.js`).
- `/api/jump-dds`, `/api/resolve`, `/api/version`, `/api/auth/status` and login.

**Protected when auth is enabled:** all Officials mutations (meets, events, registrations, runs manual entry, dual seeding/paper score, phases, exports, USSS transmit, imports, audit, training days, PDFs not listed above) and the entire `/api/admin` panel (system_admin role). Client downloads can't carry an Authorization header in a plain anchor — use `downloadAuthed()` from `client/src/utils/api.js`.

**Roles (single source of truth `server/auth/roles.js`, mirrored in `client/src/auth/RequireAuth.jsx`):** judge (1, login-only; Officials dashboard restricted to Links) < official (2, full Officials section) < system_admin (3, everything). `event_admin` is a legacy alias ranked with system_admin; existing rows are migrated to system_admin at boot.

---

## v1.25.02 Feature Notes

### Hide Event from Live Scores (v1.25.02)

New per-event **Live Scores visibility** flag, toggled from Admin → Event Management, so test events
can be excluded from the public Live Scores page. Fully independent of `events.locked` — an event can
be locked, hidden, both, or neither (locking governs the Officials dashboard + mutations; hiding
governs public listings only).

**Hide scope — listings only (David's ruling).** A hidden event disappears from `GET
/api/meets/livescores` (so both the meet cards and the LIVE NOW strip on `/livescores` — the strip is
client-filtered from the same payload, no LiveScores.jsx change) and from the Viewer API event list
`GET /api/viewer/events` (with and without `?status=`). Direct access stays open everywhere else:
`/scoreboard/:shortCode`, `/overlay`, `GET /api/resolve`, viewer `resolve`/`status`/`results`/`rounds`,
and all tablets. If **every** event in a meet is hidden, the meet itself drops off `/livescores`
(visibility clause added to both the count and page queries so pagination totals stay consistent);
zero-event meets keep their existing behavior and still appear.

**Database.** `events.hide_livescores INTEGER NOT NULL DEFAULT 0` via the standard try/catch
migration in `server/db/schema.js`. Default 0 = visible; new events are always visible.

**Admin endpoints** (inherit system_admin auth from the `/api/admin` mount): `PUT
/api/admin/events/:eventId/hide` / `show` and bulk `PUT /api/admin/meets/:meetId/hide-all` /
`show-all`, mirroring lock/unlock. All four write audit rows (`event_hidden_livescores`,
`event_shown_livescores`, `meet_events_hidden_livescores`, `meet_events_shown_livescores`) via the
`logAudit` nested-try/catch pattern — note lock/unlock still don't audit. `GET /api/admin/events`
now returns `hide_livescores`.

**Admin UI (AdminEvents.jsx).** New "Live Scores" column (purple "Hidden" / gray "Visible"), a
Hide/Show button next to Lock/Unlock on each row, a "Hide All / Show All" bulk button in each meet
header (with confirm, like Lock All), a collapsed-state "Hidden from Live Scores / Partially hidden"
badge, and updated explainer text clarifying that locking and hiding are independent.

**Export/import round-trip.** Export needs nothing (`SELECT *`); the column was added to the three
event insert/update sites in `server/routes/meets.js` (`executeImport` INSERT, `executeMerge` UPDATE
+ INSERT) with `?? 0` legacy tolerance — the recurring v1.16.05 missing-column trap. **Clone
deliberately does NOT copy the flag** (clone already resets `locked`; a cloned meet defaults visible).

**Verification.** 31-check integration test against a scratch server: seed 3 meets → hide one event
(absent from livescores, sibling still present) → hide-all (meet drops off, totals consistent,
zero-event meet unaffected) → lock × hide independence → viewer list filtered while
resolve/status/results stay 200 → `/api/resolve` + short-code access intact → show/show-all restore
→ all four audit actions logged → export carries the flag, delete + fresh import preserves it.
Double-boot confirms the migration is idempotent. `verify_v16.js` still passes (no scoring paths
touched).

**Files modified:** `server/db/schema.js`, `server/routes/meets.js`, `server/routes/viewer.js`,
`server/routes/admin.js`, `client/src/pages/admin/AdminEvents.jsx`, `server/version.js`,
`client/src/components/Layout.jsx`, `client/package.json`, `server/package.json`, `CLAUDE.md`

---

## v1.25.01 Feature Notes

### Training Days in Meet Export/Import Round-Trip (v1.25.01)

Closed the last known data-loss gap in meet export/import: training days (v1.22.00) were not included
in the export, so exporting a meet and importing it on another server silently dropped every training
day and its participant exclusion list. All changes are in `server/routes/meets.js`; no client changes.

**Export.** `buildMeetExportZip` now SELECTs `training_days` (by meet_id) and `training_day_exclusions`
(by the collected training-day IDs) and adds both arrays to `meet_export.json`. The multi-meet Export
All bundle inherits this automatically since it reuses `buildMeetExportZip`.

**Fresh import.** `executeImport` gains a `trainingDayMap` (old id → new uuid). Training days insert
after course specs; exclusion rows are remapped through `trainingDayMap` + `athleteMap` with
`INSERT OR IGNORE` (composite PK) and orphaned rows skipped — same orphan-protection pattern as
v1.16.05. Old exports without the new keys import cleanly via the standard `|| []` tolerance.

**Merge.** `executeMerge` matches training days by `meet_id + name` (source IDs don't exist on the
destination). On match, the date updates only when the import row is newer (`isNewer` on
`updated_at`); otherwise a new row is inserted. Exclusions are additive-only and idempotent —
re-merging the same export changes nothing. Merge never deletes exclusions.

**Export version string fixed.** Both `stickit_version` sites (the per-meet `meet_export.json` and the
multi-meet `manifest.json`) had been hardcoded at `'1.16.22'`; they now derive from
`server/version.js` (`EXPORT_VERSION`, leading `v` stripped) so they can never drift again.

**Verification.** 27-check integration test against a scratch server: seed → export (arrays + version
present) → delete → fresh import (IDs remapped, included/excluded flags identical) → tampered merge
(newer date applied, new day added, exclusions not duplicated, orphan rows skipped, second identical
merge is a no-op) → legacy export without the new keys imports with zero training days.
`verify_v16.js` still 60/60 (no scoring paths touched).

**Files modified:** `server/routes/meets.js`, `server/version.js`, `client/src/components/Layout.jsx`,
`client/package.json`, `server/package.json`, `CLAUDE.md`

---

## v1.25.00 Feature Notes

### UI Usability & Access Review Fixes (v1.25.00)

Implements the decisions from the 06-10-26 UI usability + access review (`StickIt_UI_Usability_Review_06-10-26.docx`, decisions recorded in `StickIt_UI_Review_Decisions_06-11-26.md`). David approved all 46 findings except B-9c (admin event links) and D-4 (scoreboard phase label). **No scoring math changes.** Tablet pages untouched.

**A — Password protection unblocked end-to-end.**
- **A-1** Every UI call now carries the login token. New `downloadAuthed()` helper in `client/src/utils/api.js` converts all anchor/window.open downloads (Export All, Export Meet, results CSV/XLSX/HTML, admin backups, USSS People CSV, training-day PDF) to fetch-blob-save; ~20 raw `fetch()` sites (all PDF posts, logo upload/delete, USSS transmit, dual manual-entry/paper-score/seeding/reset, import conflict resolution) gained `authHeaders()`.
- **A-2** `POST /api/events/:eventId/return-to-scoring` now requires auth. `server/routes/pdf.js` has an explicit documented policy: Scoreboard-reachable PDFs stay public, everything else (`/results` GET+POST added) requires auth.
- **A-3** Role model unified in new `server/auth/roles.js`: judge(1) < official(2) < system_admin(3); `event_admin` is a legacy alias ranked with system_admin and existing rows are migrated at startup. Client RequireAuth mirrors it; `/admin/*` route guard moved to system_admin; AdminUsers offers Judge/Official/System Admin (Judge creation now works), legacy roles render as a disabled option.
- **A-4** Server refuses self-deactivation and last-active-admin deactivation; AdminUsers confirms Deactivate and surfaces guard errors (also B-3).
- **A-5** `AUTH_TOGGLE_ENABLED = true` — the Enable Protection button on Admin → Security is live.
- **A-6** JWT secret persisted in `app_settings.jwt_secret` via `initJwtSecret()` at boot (env var still wins) — restarts/deploys no longer log everyone out. Token life 8h → 12h.
- **A-7** Login throttle: 10 failures per username or IP per 15 minutes → 429.
- **A-8** Users table shows a Password Set/Not-set column (`has_password` in GET /users).
- **A-9** Voice WS validates the eventId against the events table before opening the paid Deepgram leg.
- **A-10** Access model documented (section above).

**B — Admin panel.**
- **B-4** USSS People page gained Sync Now / Upload File buttons (status card header) and a corrected empty-state that links to `/dashboard/usss`.
- **B-5** Event Management explains what locking does, confirms Lock All/Unlock All, and has a meet/event search box.
- **B-6** Audit log filter dropdowns populate from `GET /api/audit/filters` (SELECT DISTINCT), added From/To date filters (`from`/`to` query params), header restyled to the admin look.
- **B-7** "Reset Athlete List" renamed "Delete ALL Athletes". New "Show deleted" toggle lists soft-deleted athletes (`GET /api/admin/athletes?deleted=1`) with Restore Selected (`POST /api/admin/athletes/restore`, audit-logged `athletes_restored`).
- **B-8** Dashboard: Recent Activity links to the full audit log; new env indicators for `DEEPGRAM_API_KEY` and `STICKIT_JWT_SECRET` (`env` block in GET /dashboard).
- **B-9a** In-app backup restore: `POST /api/admin/backups/:filename/restore` takes a pre-restore safety backup then copies over `data/scoring.db`; UI requires typing the filename and warns a server restart is required.
- **B-9b** Re-open finalized event: `POST /api/admin/events/:eventId/reopen` sets status back to in_progress (clears `dual_bracket_review_status` for duals), audit-logged `event_reopened`; Re-open button on complete events in AdminEvents. Resolves the EventDetail TODO.
- **B-10** Admin sidebar emoji icons replaced with inline SVGs; sidebar collapses to icon-only below 900px.

**C — Officials.**
- **C-1** Dead `LinkEventsPanel` deleted (superseded by Phases) along with the `seedFromQualifier` api helper. Server endpoints left in place.
- **C-2** Bib input is a local-state `BibInput` that saves once on blur/Enter (red ring on failure) — no more per-keystroke writes/refreshes.
- **C-3** Registration Remove and judge Remove confirm first.
- **C-4** `JumpCodeInput` hoisted to module scope (codes passed as a prop) — no more remount/focus-loss per keystroke in ManualScoreModal.
- **C-5** ManualScoreModal DNS/DNF/DSQ go through the shared `StatusConfirmDialog` (extracted to `client/src/components/StatusConfirmDialog.jsx`, also used by the voice modal).
- **C-6** Run-history Flag dropdown confirms before applying (and before clearing) a status.
- **C-7 (built, not hidden — David's ruling)** Aerials v2 manual entry: new `AerialsV2ManualModal` (per-judge × per-jump Air/Form/Landing grid mirroring the HJ tablet, jump-code datalists, range validation, DNS/DNF/DSQ with confirm). Server: `POST /runs/manual` and `POST /:runId/manual-score` accept `{ aerials_v2: true, judge_scores: [{judge_number, jump, air, form, landing}], jump1_code, jump2_code }` via new `handleAerialsV2Manual` — validates ranges/completeness, persists `ae_*` judge_scores rows keyed by judge_number, scores through `calcAerialsScoreV2` (engine untouched), sets `aerials_model='v2'`. Edit pre-populates from existing rows (`/scores` now returns `judge_number`). The legacy flat payload is still refused. Voice stays hidden on ALL aerials events (also F-2).
- **C-8** Event/meet status dropdowns are labeled "Status" and confirm changes to/from Complete (manual Complete bypasses the HJ finalize flow).
- **C-9** Dashboard meet-row Open/Delete buttons always visible (no hover-gating — iPad).
- **C-10** Meet delete uses a modal showing the event count with a two-step arm/confirm pattern.
- **C-11** MeetDetail header: TD Report / Export Meet / Clone Meet grouped under "More ▾"; container wraps.
- **C-12** USSS/FIS pace toggle saves immediately when a course spec exists; hint shown when none saved yet.
- **C-13** Aerials v2 event header shows "Scoring Judges: N (panel)" instead of legacy per-component judge counts.
- **C-14** Officials Athletes page paginated 100/page (`GET /api/athletes?page=` returns `{rows,total}`; legacy array shape preserved without `page`).
- **C-15** Inline judge edit (name + USSS ID) in the Assigned Judges table; "or use the API" help text removed.
- **C-16** Dead code: unused AuditLog import removed from App.jsx; LinkEventsPanel removal per C-1. (The reported duplicate DIVISION_OPTIONS no longer exists — one declaration per file.)
- **C-17** Training-day bulk uncheck sends one request: exclusions endpoint accepts `{ athlete_ids: [...], exclude }`.

**D — Public pages.** **D-1** Live Scores silently re-fetches every 45s. **D-2** sticky header uses new `--bg-header` theme var (follows Sun Mode). **D-3** Home divider reads LOGIN REQUIRED only when `/api/auth/status` says protection is on; otherwise "OFFICIALS & STAFF". D-4 deferred.

**E-1 — Overlay hide/show.** New `POST /api/events/:eventId/overlay/{hide,show}` (requireAuth) broadcast `OVERLAY_HIDE`/`OVERLAY_SHOW`. Overlay keeps a `hiddenRef` that suppresses the 3-second polling fallback while hidden (previously the poll would re-show the score within 3s); hide clears on OVERLAY_SHOW / run_started / score_update / dual_match_started. Compact "Broadcast Overlay: Hide / Show" control on the Scoring tab (both single and dual panels).

**F — Voice entry.** **F-1** Hardware-key (F2 / Ctrl+,) stop on the bib screen fixed via `toggleRecordingRef` reassigned every render — the once-bound keydown listener no longer calls first-render closures, so the accumulated transcript and athlete list are current. Key assignments unchanged. **F-3** Typed Review-screen corrections get the same range check as spoken values (new `statusForField` export in `client/src/voice/parser.js`). **F-4** Dictation Cancel confirms when any field has a value. **F-5** Bib screen "Done" link → styled "Close" button. **F-6 (allow with warning — David's ruling)** Speaking a bib that already ran offers "will OVERWRITE their existing scores — Continue?"; on confirm the wizard proceeds and submits through the manual-score edit path against the existing run. Status overrides route the same way.

**Files created:** `server/auth/roles.js`, `client/src/components/StatusConfirmDialog.jsx`, `client/src/components/AerialsV2ManualModal.jsx`.
**Files modified:** `server/middleware/auth.js`, `server/routes/auth.js`, `server/routes/admin.js`, `server/routes/audit.js`, `server/routes/athletes.js`, `server/routes/pdf.js`, `server/routes/runs.js`, `server/routes/training.js`, `server/db/schema.js`, `server/index.js`, `server/voice/deepgram.js`, `server/version.js`, `client/src/utils/api.js`, `client/src/auth/RequireAuth.jsx`, `client/src/App.jsx`, `client/src/pages/Dashboard.jsx`, `client/src/pages/MeetDetail.jsx`, `client/src/pages/EventDetail.jsx`, `client/src/pages/Athletes.jsx`, `client/src/pages/AuditLog.jsx`, `client/src/pages/TrainingDays.jsx`, `client/src/pages/LiveScores.jsx`, `client/src/pages/Home.jsx`, `client/src/pages/Overlay.jsx`, `client/src/pages/admin/AdminUsers.jsx`, `client/src/pages/admin/AdminSecurity.jsx`, `client/src/pages/admin/AdminEvents.jsx`, `client/src/pages/admin/AdminAthletes.jsx`, `client/src/pages/admin/AdminBackups.jsx`, `client/src/pages/admin/AdminUSSSPeople.jsx`, `client/src/pages/admin/AdminDashboard.jsx`, `client/src/components/AdminLayout.jsx`, `client/src/components/VoiceManualEntryModal.jsx`, `client/src/components/public/PublicLayout.jsx`, `client/src/voice/parser.js`, `client/src/components/Layout.jsx`, `client/package.json`, `server/package.json`, `CLAUDE.md`.

---

## v1.24.00 Feature Notes

### Scoring Review Fixes — Full-Season Correctness Pass (v1.24.00)

Implements the confirmed findings from the 06-10-26 comprehensive scoring review
(`StickIt_Review_Findings_06-10-26.md`), which recomputed every 2026 run three ways against the
official FIS XML and result PDFs. Scope: findings F-1 through F-8 plus the F-11 CSV BOM. Findings
F-9 (seed-tail ordering), F-10 (single-mogul FFSP feature), F-11a (XML all-statused ranking), and
F-12 (walkover docs) were reviewed and deliberately deferred. The review's rulings on F-4 (air
averaging order) and F-5 (RQS repeat) were pre-decided by David and are treated as confirmed.

**F-1 — Float error in two-decimal truncation (HIGH).** `floorToHundredth` (`server/scoring/engine.js`)
used `Math.floor(n*100)/100`, which truncated a cent low whenever the binary float of `n*100`
landed just under the true value (e.g. `49.1 + 8.23 + 8.93 = 66.25999999999999` → 66.25, should be
66.26). Roughly 45% of season totals were affected. Fixed with a `+1e-9` epsilon, far below the
0.01 judge-input resolution. This single change corrects every truncation site in the engine.

**F-3 / F-4 — Air averaging order + per-jump 10.0 cap (MEDIUM, ruled).** `calcJumpScore` now follows
FIS JH 6203.2.2 / 6204.3: average the air judges' raw scores per jump, truncate to 2dp, then
multiply by DD — replacing the prior Winfree-matching "floor each judge's score×DD then average".
Each jump is capped at 10.0 (JH 6204.3.2) and a jump whose averaged form is below 0.1 earns no
points. **Accepted consequence:** re-scored 2026 events differ from Winfree-era published PDFs by
one cent on some runs (e.g. SOARD 66.27 vs 66.26) — David ruled the handbook order governs. The
`air_score_no_dd` tiebreaker (raw average, no DD) is unchanged. Aerials paths are untouched.

**F-5 — RQS repeat rule keeps the higher-SCORED jump (MEDIUM, ruled).** The repeat-jump decision
moved out of the pre-scoring DD adjustment (`applyRepeatJumpRule`, which zeroed the lower-DD jump)
and into `calcMogulScore`, which now decides AFTER both jump scores are computed. RQS zeros the
lower-SCORING jump (tie → keep jump 1); all other divisions keep jump 1 (USSS 4210.2.1
first-counts). `calcMogulScore` takes new `isRepeat` + `division` params and returns
`repeatDroppedJump` (0/1/2). Callers in `server/routes/runs.js` (manual, edit, live finalize,
reject paths) detect the repeat via `areJumpsRepeats`, pass it through, and persist DD=0 on the
dropped jump for display/back-compat. The live path stores both real DDs at run-start (the decision
needs the air scores) and `tryFinalize` resolves it. The dropped jump is also excluded from
`air_score_no_dd`. No 2026 exposure (latent), but ruled. `applyRepeatJumpRule` is no longer used.

**F-6 — DD table gaps, stand-alone grab, case-insensitive lookup (LOW).** Added four missing upright
combination codes to the mogul DD seed (`server/db/schema.js`): `ST` 0.49/0.59, `STS` 0.59/0.69,
`TTT` 0.59/0.69, `DD` 0.55/0.65 (base + per-letter modifier). Re-valued stand-alone `G` from the
0.14 grab multiplier to a real jump value 0.54/0.64 (Single + grab). A startup migration (sentinel:
`G` mogul-M = 0.14 or `STS` absent) seeds/updates these for both `mogul` and `dual_mogul` (×1.25),
idempotent. `resolveJumpDD` (`server/routes/runs.js`) gained a `COLLATE NOCASE` fallback that runs
ONLY when the exact-case lookup misses, so season-data lower-case codes (`g`, `3g`, `lg`) resolve to
`G`/`3G`/`lG` while case-distinct codes (`bp` vs `bP`) stay correct. The bare `p` 0.03 multiplier row
remains (harmless — never entered as a stand-alone jump).

**F-7 — 7-judge format drops high/low of turns and deductions separately (LOW → full fix).** Per FIS
JH 6203.1.1, the 5-TL ("7-judge") format must drop the high+low TURNS and the high+low DEDUCTIONS
independently, then sum — StickIt previously dropped high/low of the NET per judge. New
`calcTurnsSumScoreSeparate(grossArr, dedArr)` in `engine.js` does the separate drop for ≥4 judges;
≤3 judges keep the net-sum behavior. No schema change: each `judge_scores` turns row already stores
net `raw_score` and `tl_deduction`, so per-judge gross = `raw_score + tl_deduction`. The assembly
sites in `runs.js` thread a `tlDeductions[]` array parallel to `tlScores[]` into `calcMogulScore`.

**F-2 — `runoff_to_8th` real 5-8 bracket (HIGH, structural).** Replaced the two terminal consolation
matches with a proper 5-8 mini-bracket per USSS 4310.3.2. `buildBracketShell`
(`server/routes/dual.js`) now creates, for runoff_to_8th: round-2 small finals pos 3/4 =
**consolation semis** (QF losers), and round-1 small finals pos 3/4 = the **5/6 and 7/8 finals**
(pos 2 stays the 3/4 final). `advanceWinner` gained a branch: a completed consolation semi (round-2
small final) routes its winner → 5/6 final and loser → 7/8 final (blue slot first, then red).
`placement_ranking.js` assigns 5-8 places only from the round-1 finals (pos 2→3/4, 3→5/6, 4→7/8) and
ignores the semis; it falls back to the legacy round-2-terminal structure when no round-1 5/6 final
exists, so already-scored events keep their placements. `computePairingNumbers` (and the PDF
`buildBracketPairings`) order the consolation block so the **finals run 7/8 → 5/6 → 3/4 →
championship** at the end of the event. The bracket PDF (`server/routes/pdf.js`), the Scoreboard
Bracket tab (`client/src/pages/Scoreboard.jsx`), and the USSS transmit standings
(`server/routes/transmit.js`, which now reads the terminal small-final's position for placement) all
handle the new structure with legacy fallback. The HJ tablet review panel groups by round and needed
no change. `runoff_to_4th` is unchanged.

**F-8 — Dead code removed (LOW).** Deleted the unused `distributeByes` from `server/dual/placement.js`
(and its export). It implemented a "byes only in batches of 8" rule contradicting the live
ghost-partner derivation in `buildPlacement`; risk was future misuse.

**F-11 — CSV BOM (INFO).** Both CSV exports in `server/routes/export.js` now prepend a UTF-8 BOM
(`﻿`) and send `text/csv; charset=utf-8` so Excel on Windows renders accented athlete names.
The XLSX exports and the XML all-statused behavior are unchanged.

**Verification.** `server/scripts/verify_v16.js` extended from 50 to 60 checks — synthetic cases for
the F-1 epsilon, F-3/F-4 averaging + cap, F-5 lower-scored-jump drop, F-7 separate high/low drop, and
an F-2 placement walk (new + legacy structures rank 1-8). A temp-DB integration test confirmed
`buildBracketShell` creates the 5 small finals (r2p3, r2p4, r1p2, r1p3, r1p4), `advanceWinner` routes
semi winners → 5/6 and losers → 7/8, and the finals run order ends M-17 7/8 → M-18 5/6 → M-19 3/4 →
M-20 championship. `buildBracketShell`, `advanceWinner`, and `computePairingNumbers` are now exported
from `dual.js` for tooling/tests.

**Files modified:** `server/scoring/engine.js`, `server/routes/runs.js`, `server/db/schema.js`,
`server/routes/dual.js`, `server/dual/placement.js`, `server/dual/placement_ranking.js`,
`server/routes/pdf.js`, `server/routes/transmit.js`, `server/routes/export.js`,
`client/src/pages/Scoreboard.jsx`, `server/scripts/verify_v16.js`, `server/version.js`,
`client/package.json`, `server/package.json`, `client/src/components/Layout.jsx`, `CLAUDE.md`.

---

## v1.23.01 Feature Notes

### Viewer API — Dual Mogul Results Fix (v1.23.01)

Fixed `GET /api/viewer/events/:id/results` returning HTTP 500 for all dual mogul events.

**Root cause.** The dual mogul branch of the results handler referenced `db.blue_score` and `db.red_score` in the `dual_bracket` SELECT. Those columns do not exist on the table — scores live as individual judge points in `dual_judge_points` (`blue_points` / `red_points`, one row per judge per match) and must be aggregated with SUM.

**Fix.** Replaced the two bare column references with correlated subqueries that mirror the pattern already used in `server/routes/dual.js:575`:
```sql
(SELECT SUM(djp.blue_points) FROM dual_judge_points djp WHERE djp.match_id = db.id) AS blue_score,
(SELECT SUM(djp.red_points)  FROM dual_judge_points djp WHERE djp.match_id = db.id) AS red_score,
```

SUM returns NULL when no judge points exist yet (unscored match), which is correct for the iOS client's `Double?` optional fields. The JSON response shape (`blue_score`, `red_score`) is unchanged.

**Files modified:** `server/routes/viewer.js`

---

## v1.23.00 Feature Notes

### Read-Only Viewer API for iOS and Third-Party Clients (v1.23.00)

New additive read-only public API at `/api/viewer` consumed by iOS apps and other third-party clients to display live competition results. No authentication required; permissive CORS headers applied to the viewer router only. Zero changes to any existing route, scoring logic, schema, or frontend file — one registration line added to `server/index.js`.

**Six endpoints:**

| Endpoint | Purpose |
|---|---|
| `GET /api/viewer/events?status=` | Event list across all meets; optional `?status=in_progress` filter for live-only |
| `GET /api/viewer/resolve/:shortCode` | Look up event ID from a short code (same identifier used in `/scoreboard/:shortCode` URLs) |
| `GET /api/viewer/events/:eventId/status` | Live event state: current round, athlete on course, next 10 upcoming athletes in run order |
| `GET /api/viewer/events/:eventId/results` | Ranked results for the active round (mogul/aerials) or full bracket state (dual mogul) |
| `GET /api/viewer/events/:eventId/results/scores` | Per-judge, per-score-type raw scores for the active round — enables expanded detail view |
| `GET /api/viewer/events/:eventId/rounds` | Round/phase list with status (`not_started` / `in_progress` / `complete`) |

**Upcoming athletes logic.** Phase-based events (qualifier/finals) query `phase_run_order` joined to the in-progress `event_phases` row, excluding registrations that already have a `runs` row with `status IN ('scoring', 'complete')` for the current run_number. Non-phase events use `registrations.run_order` with the same exclusion filter against `run_round_status`.

**Active round resolution.** A shared `getActiveRound(eventId)` helper prioritises `in_progress` phases, falls back to the most-recently-completed phase, then falls back to `run_round_status` rows. This ensures results are always returned even between rounds.

**Per-judge scores** reuse the existing SQL pattern from `server/routes/results.js`: join `judge_scores` → `judges` and return `score_type`, `raw_score`, `role`, `judge_number` per row. Client groups by `run_id`.

**Dual mogul results** return the full `dual_bracket` table with blue/red athlete info, per-side scores, winner, and bye flag — sufficient to render a bracket tree.

**Error handling.** All handlers are wrapped in try/catch. Unknown event ID or short code returns 404 `{ error: 'Event not found' }`. Database failures return 500 `{ error: message }`.

**README updated.** A new "Viewer API Reference" section documents all six endpoints with example JSON response shapes, suitable for an iOS developer unfamiliar with StickIt.

**Files created:** `server/routes/viewer.js`
**Files modified:** `server/index.js` (one registration line), `README.md` (Viewer API Reference section + version bump)

---

## v1.22.02 Feature Notes

### SpeechMike — Ctrl+Key Aliases for macOS F-Key Conflicts (v1.22.02)

macOS intercepts all four bare function keys (F1 = brightness down, F2 = brightness up,
F3 = Mission Control, F4 = Launchpad) at the OS level before the browser receives them.
`e.preventDefault()` cannot stop OS-level key grabs, so the v1.22.01 F-key navigation in the
voice wizard was non-functional on Mac.

**Fix.** The `VoiceManualEntryModal.jsx` keydown handler now recognises Ctrl+key combos as
aliases for the four function keys:

| Logical action | Original key | macOS-safe alias |
|---|---|---|
| Previous field / Re-record | F1 | `Ctrl+[` |
| Toggle microphone | F2 | `Ctrl+,` |
| Next field / Enter Review / Submit | F3 | `Ctrl+]` |
| Next blank field / Enter Review | F4 | `Ctrl+\` |

The original F-key bindings are preserved for Windows machines or Macs where system shortcuts
have been disabled in System Settings → Keyboard → Keyboard Shortcuts.

**SpeechMike reconfiguration required.** In Philips Device Control Center, open the Custom
profile and reassign Function keys 1–4 to the Ctrl+key combos above using the Hotkey option.
Reference: `Scoring Server/Claude Output/SpeechMike_Hotkey_Setup.md`.

**Files modified:** `client/src/components/VoiceManualEntryModal.jsx`

---

## v1.22.01 Feature Notes

### SpeechMike F1–F4 Hardware Key Navigation — Voice Manual Entry (v1.22.01)

Extends the voice manual entry wizard with F1–F4 hardware key navigation so the operator can drive all field traversal from the Philips SpeechMike Premium buttons (or keyboard) without relying on voice commands for navigation.

**Button mapping (SpeechMike Event mode).** Multiple physical buttons are configured to emit the same key event, giving ergonomic alternatives:
- Rewind (◄◄) + Function key 1 → F1 (prior field)
- Record (●) + Function key 2 → F2 (start/stop mic — existing)
- Forward (▶▶) + Rear button 1 + Function key 3 → F3 (next field)
- EOL + Insert/Overwrite + Function key 4 → F4 (next open field)
- Play → Disabled (no accidental events)

**Dictation screen key actions:**
- **F1** — move wizard cursor back one field; no-op on field 0 (no wrap)
- **F2** — toggle record/stop (existing, unchanged)
- **F3** — advance cursor exactly one field forward; on last field → stop mic + enter Review
- **F4** — advance cursor to next blank/unfilled field (uses existing `findNextBlank` logic); on last field → stop mic + enter Review

**Review screen key actions:**
- **F1** — re-record: discard all values, return to Dictation screen
- **F2** — no-op (mic already stopped on Review)
- **F3** — submit the run if all fields are valid and jump codes pass DB validation

**Voice commands preserved.** Saying "Next", "Redo", "Submit"/"Done" continues to work alongside the F-keys — operators can mix hardware buttons and voice in the same run.

**Implementation pattern.** A `fKeyHandlerRef` (useRef) is re-assigned on every render to an arrow function that captures fresh component closures for all state setters and functions. The static keydown `useEffect` dispatches F1/F3/F4 through `fKeyHandlerRef.current?.(key)`, eliminating stale-closure risk without adding new effect dependencies. A new component-level `goToReviewFromKey()` mirrors the inner `flushAndGoToReview()` in `handleUtterance` but operates on already-current state (no local utterance variables to commit).

**Files modified:** `client/src/components/VoiceManualEntryModal.jsx`

---

## v1.22.00 Feature Notes

### Training Days (v1.22.00)

New per-meet training-day workflow with multiple named days, an opt-out participant checklist, and a roster PDF. Operators can pre-stage athlete lists for one or more pre-comp training sessions.

**Scope.** Per-meet (multiple training days each). Each training day has a name (free-text) plus an optional date. The participant list defaults to every registered athlete across every event in the meet, deduplicated by athlete with the first non-empty bib retained; scratched athletes are excluded by default. The operator unchecks anyone who shouldn't attend; the resulting "excluded" set is persisted per training day. New event registrations made AFTER the training day exists auto-appear (checked); removing an event registration auto-removes them. Soft-deleted athletes (`athletes.deleted_at IS NOT NULL`) are filtered out.

**UI.** Standalone page at `/dashboard/meets/:meetId/training`, reached from a new **Training Days** button in the action row on the meet detail page ([MeetDetail.jsx](client/src/pages/MeetDetail.jsx)). Two-column layout — left panel lists training days for the meet with edit/delete affordances and a **+ New** button (modal: name + date); right panel shows the selected day's participants as a checkbox table (✓ · Bib · Last, First · USSA # · Club) with a header **Reset (Include All)** action and a **Print PDF** button.

**Database.** Two new tables added via the existing try/catch migration pattern in [server/db/schema.js](server/db/schema.js):
- `training_days(id TEXT PRIMARY KEY, meet_id TEXT NOT NULL, name TEXT NOT NULL, date TEXT, created_at, updated_at)`
- `training_day_exclusions(training_day_id TEXT NOT NULL, athlete_id TEXT NOT NULL, PRIMARY KEY (training_day_id, athlete_id))`

`deleteMeetCascade` in [server/routes/meets.js](server/routes/meets.js) now clears both tables when a meet is deleted.

**Server route.** New [server/routes/training.js](server/routes/training.js) mounted at `/api`. Endpoints:
- `GET    /meets/:meetId/training-days` — list
- `POST   /meets/:meetId/training-days` — create (body: name, date)
- `PUT    /meets/:meetId/training-days/:id` — update name/date
- `DELETE /meets/:meetId/training-days/:id` — delete (cascades exclusions)
- `GET    /training-days/:id/participants` — computed roster with `included` flag per athlete
- `POST   /training-days/:id/exclusions` — body `{ athlete_id, exclude: bool }` — inserts or deletes the exclusion row
- `POST   /training-days/:id/reset` — clears all exclusions

The participants query mirrors the dedup pattern at [server/routes/pdf.js](server/routes/pdf.js) (the `/api/pdf/registration` endpoint). Sort: bib ASC (blanks last), then last name.

**PDF.** New `POST /api/pdf/training-day/:id` endpoint emits the participant roster as a one-page LETTER PDF using the existing pdfkit helpers (`pdfHeader`, `drawTable`, `streamPdf`). Header: meet name + "Training Day Participants — `<training day name>` — `<formatted date>`". Columns: Bib (0.6w) · Last (1.8w) · First (1.8w) · USSA # (1.0w) · Club (2.0w). Only included athletes (i.e., not in the exclusion set) appear. Filename: `Training_Day_<MeetSlug>_<DaySlug>.pdf`.

**API helpers.** Seven new entries in [client/src/utils/api.js](client/src/utils/api.js): `listTrainingDays`, `createTrainingDay`, `updateTrainingDay`, `deleteTrainingDay`, `getTrainingParticipants`, `toggleTrainingExclusion`, `resetTrainingExclusions`, `downloadTrainingDayPdf`.

**Export/import round-trip:** added in v1.25.01 — training days and exclusions now survive meet export → import (see v1.25.01 Feature Notes).

**Files created:** `server/routes/training.js`, `client/src/pages/TrainingDays.jsx`
**Files modified:** `server/db/schema.js`, `server/routes/meets.js`, `server/routes/pdf.js`, `server/index.js`, `client/src/App.jsx`, `client/src/pages/MeetDetail.jsx`, `client/src/utils/api.js`

### Officials Sidebar Flattened + USSS Database Page (v1.22.00)

Two related UX changes that promote the previously-nested Information submenu and the inline USSS Database card into top-level sidebar entries.

**Before (v1.21.x):** Officials sidebar had Meets, Athletes, and a collapsible "Information" group containing Jump DDs (modal), User Guide (page), About (modal), and a multi-line USSS Database status card with Sync Now / Upload File buttons.

**After (v1.22.00):** Flat top-level nav — Meets, Athletes, **USSS Database** (new) — with a separator and three reference action rows below: Jump DDs (modal, unchanged), User Guide (modal navigation to `/help`), About (modal, unchanged). The collapsible "Information" group is removed. The USSS Database sidebar card is removed in favor of the new page.

**New page.** [client/src/pages/UsssDatabase.jsx](client/src/pages/UsssDatabase.jsx) at route `/dashboard/usss`. Two-section layout: a Sync Status card showing Last sync (formatted local time), List (year + identifier), Records (total + breakdown by competitor/coach/official), Source, and File name; plus an Update card with **Sync Now** and **Upload File** buttons. Both buttons reuse the existing `/api/usss/sync` and `/api/usss/upload` endpoints — no server changes. Returns to the live sync flow that was already in production, just relocated to a full page with more breathing room.

**Home page.** The "Help & User Guide" link on the public Home page is removed (it was redundant with the now-top-level User Guide sidebar entry on Officials and the Help entry on Admin).

**Files modified:** [client/src/components/Layout.jsx](client/src/components/Layout.jsx), [client/src/pages/Home.jsx](client/src/pages/Home.jsx), [client/src/App.jsx](client/src/App.jsx)
**Files created:** [client/src/pages/UsssDatabase.jsx](client/src/pages/UsssDatabase.jsx)

### USSS XML Transmit — DNS / DNF / DSQ / RNS Included in `FS_notclassified` (v1.22.00)

The USSS XML transmit (`POST /api/export/usss-transmit/:meetId`, [server/routes/transmit.js](server/routes/transmit.js)) previously silently dropped athletes whose every run was status'd — they appeared nowhere in the resulting XML. They now appear in the standard FIS `<FS_notclassified>` block as `<FS_notranked Status="...">` entries with their bib + Competitor block.

**Single mogul events.** `processMogulEvent` no longer skips status'd runs entirely. It builds two athlete buckets:
- `classified` — athletes with at least one successful (status=NULL) run; ranked normally with their best score across runs.
- `notClassified` — athletes whose every run was DNS / DNF / DSQ / RNS; tagged with the status of their LATEST (highest run_number) status'd run.

`generateSingleMogulXml` now accepts a `notClassified` array and emits an `<FS_notranked>` element per athlete inside `<FS_notclassified>`. The `Status` attribute carries the literal DNS/DNF/DSQ/RNS value.

**Dual mogul events.** `computeDualStandings` now reads `dual_bracket.loser_status` (added in v1.6.01) and tags any athlete who **never won a match** AND whose elimination match has a `loser_status` set with `runStatus`. `generateDualMogulXml` splits the standings into classified (no `runStatus`) and notClassified (has `runStatus`). Ranks are assigned only to classified athletes — 1..N without gaps. NotClassified athletes appear in `<FS_notclassified>` with no `<Rank>` element. Athletes who lost a match by status BUT had previously won at least one match remain in `<FS_classified>` with their bracket-derived placement (the status applied to only one match they lost; they advanced fairly through prior rounds).

**Status value.** Emitted verbatim — `DNS`, `DNF`, `DSQ`, `RNS`. The first three are FIS standard; `RNS` is USSS-specific. If a downstream USSS parser rejects RNS specifically, a future change can map RNS → DNF before emission.

**No schema changes.** Both `runs.run_status` and `dual_bracket.loser_status` columns existed; the transmit code just stopped ignoring them.

**Files modified:** [server/routes/transmit.js](server/routes/transmit.js)

### Help Page — Back Button to Prior Page (v1.22.00)

Help system now has a clear way out. Added a **← Back** button at the very top of the help sidebar (above the Getting Started group) in [HelpSidebar.jsx](client/src/help/HelpSidebar.jsx). Clicking it returns the user to whichever page they were on when they opened the User Guide.

**Mechanism.** The two entry points that navigate to `/help` — the **User Guide** button in the Officials sidebar ([Layout.jsx](client/src/components/Layout.jsx)) and the **Help** entry in the Admin sidebar ([AdminLayout.jsx](client/src/components/AdminLayout.jsx)) — now write the current `pathname + search` to `sessionStorage` under key `stickit.help.referrer` immediately before calling `navigate('/help')`. The HelpSidebar reads this on mount and uses it as the back button's target. Topic-to-topic navigation inside `/help` does NOT overwrite the referrer, so back always returns to the original entry point regardless of how deep the user clicked into the guide.

**`sessionStorage` semantics.** Per-tab and survives in-tab refresh, so reloading the help page keeps the back target. New tabs / bookmarks / shared deep-links arrive with no stored referrer.

**Cold-arrival fallback.** When `sessionStorage` is empty (bookmark, fresh tab, external link), the back button falls back to `/` (Home).

**Loop safety.** If the stored referrer happens to begin with `/help`, it's ignored and the fallback applies — the button can never loop back into the guide.

**Styling.** New `.help-sidebar-back` class in [help.css](client/src/help/help.css) — uppercase Barlow Condensed, panel-tinted background with a 1px border, hover transitions to the link color. Sits visually distinct from the topic-tree group headers.

**Files modified:** `client/src/help/HelpSidebar.jsx`, `client/src/help/help.css`, `client/src/components/Layout.jsx`, `client/src/components/AdminLayout.jsx`

### Version String — Single Source of Truth (v1.22.00)

The version literal previously lived in five places (two in `server/index.js`, two in `server/routes/admin.js`, and one hard-coded in the Officials sidebar) and drifted between them. The Admin Dashboard kept reporting `v1.16.31` while the rest of the app reported `v1.21.00` (and earlier `v1.16.10` per the v1.16.12 fix). This recurring drift is now structurally prevented.

**New file** [server/version.js](server/version.js) — exports `{ VERSION }`. Single source of truth.

**Server consumers** — [server/index.js](server/index.js) (`/api/version` endpoint + startup log) and [server/routes/admin.js](server/routes/admin.js) (`GET /system` and `GET /dashboard` endpoints) both `require('../version')` and emit `VERSION`. Bumping `server/version.js` updates all four sites at once.

**Client consumer** — the sidebar version label in [Layout.jsx](client/src/components/Layout.jsx) now fetches `/api/version` on mount (was hard-coded). Pre-existing behavior in AboutPanel — which already fetched `/api/version` — is unchanged. A small `useState('v1.22.00')` default still seeds before fetch resolves; it's intentionally not load-bearing.

**Bump procedure going forward.** Edit `server/version.js`. Optionally edit the two `package.json` versions (still independent per project convention). The remaining string in `client/src/components/Layout.jsx`'s useState default is cosmetic only (visible only on a brief flash before /api/version resolves) and can be bumped or left alone.

**Files created:** `server/version.js`
**Files modified:** `server/index.js`, `server/routes/admin.js`, `client/src/components/Layout.jsx`

---

## v1.21.00 Feature Notes

### Comprehensive In-App User Guide (v1.21.00)

Adds a self-contained, public help system at `/help` covering every user-facing feature across all four StickIt audiences (Officials, Judges, Admins, Public). Replaces the v1.20.00 "User Guide" placeholder modal in the officials sidebar.

**Scope.** 61 topics totaling ~25,000 words, organized into 11 sidebar groups: Getting Started (3), Officials — Meets (6), Officials — Events (7), Officials — Athletes & Registration (9), Officials — Judges (3), Officials — Scoring (6), Officials — Results & Reports (6), Judges (Tablets) (7), Admin Panel (7), Public Surfaces (4), Reference (3). Every workflow that exists in StickIt v1.20.x is documented end-to-end.

**Architecture.**
- New route `/help` and `/help/:topicSlug` registered in `client/src/App.jsx` (public, accessible without login). Slug = topic filename without `.md`.
- New page component `client/src/pages/HelpPage.jsx` reads the route param, looks up the topic in `TOPICS_BY_SLUG`, and renders via the `HelpLayout` shell.
- `client/src/help/HelpLayout.jsx` — top bar (logo + search + version + Officials/Live-Scores nav) + two-pane shell (left sidebar 300px + right content area, max-width 880px reading column).
- `client/src/help/HelpSidebar.jsx` — collapsible groups with NavLink topics. Search-filtered (matches title, group label, body text). Auto-expands the group containing the active topic.
- `client/src/help/HelpContent.jsx` — breadcrumb + article body + Previous/Next nav. Falls back to a "Topic not found" banner + landing grid for unknown slugs.
- `client/src/help/MarkdownRenderer.jsx` — ~280-line custom renderer. Supports h1–h4, paragraphs, ordered/unordered lists, bold, italic, inline code, fenced code blocks, blockquotes, horizontal rules, pipe tables, and inline links (internal `./slug` and `/help/slug` rewrite to React-Router Links; external links open in new tab). **No new npm dependency.**
- `client/src/help/topicsIndex.js` — single source of truth. Loads every `topics/*.md` file at build time via `import.meta.glob('./topics/*.md', { query: '?raw', import: 'default', eager: true })`. Exports `GROUPS`, `TOPICS`, `TOPICS_BY_SLUG`, `topicsInGroup`, `neighbors`, `searchTopics`.
- `client/src/help/help.css` — self-contained styles. Scoped under `.help-root` so they can't bleed into Officials/Admin pages. Includes responsive breakpoint at 720px (sidebar collapses to a toggle button, prev/next stacks vertically).
- `client/src/help/topics/*.md` — 61 plain-text markdown files. Each starts with an H2 title, opens with a short context paragraph, then walks the feature with numbered procedures and pipe tables. Cross-references use `[Label](./other-slug)` syntax that the renderer rewrites to React-Router links.

**Entry points.**
- **Officials sidebar:** The User Guide button in the Information section ([Layout.jsx:243-249](client/src/components/Layout.jsx)) now calls `navigate('/help')` instead of opening the placeholder modal. The `UserGuidePanel` component is removed from `Layout.jsx` (along with the `showGuide` state).
- **Admin sidebar:** New `{ to: '/help', label: 'Help', icon: '📖' }` entry appended to `ADMIN_NAV` in [AdminLayout.jsx](client/src/components/AdminLayout.jsx).
- **Public Home page:** New "Help & User Guide" link added below the Officials/Admin secondary-button grid in [Home.jsx](client/src/pages/Home.jsx).

**Topic content style.** Operator-focused, direct, no marketing copy. Procedures as numbered lists; UI elements bolded; button labels and file paths in `` `code` ``. Each topic ~300–500 words, designed to be self-contained — a teammate can deep-link directly to any slug and pick up the workflow cold.

**Search.** Client-side, runs against title + group label + full body. Filters the sidebar live. Forces all matching groups open. Clears on navigation.

**Sun Mode / HC mode.** Help page does not inherit the public Sun Mode toggle. Its own palette (dark navy with sky-blue accents, JetBrains Mono for code, Barlow Condensed for headings) is fixed. Future enhancement could add a high-contrast toggle if outdoor reading is needed.

**Version bumps.** `server/index.js` lines 121 + 212, `client/src/components/Layout.jsx` line 189 (sidebar version display) and AboutPanel default state, `client/package.json`, `server/package.json` — all bumped to `v1.21.00` / `1.21.00`.

**Files created:** `client/src/pages/HelpPage.jsx`, `client/src/help/HelpLayout.jsx`, `client/src/help/HelpSidebar.jsx`, `client/src/help/HelpContent.jsx`, `client/src/help/MarkdownRenderer.jsx`, `client/src/help/topicsIndex.js`, `client/src/help/help.css`, `client/src/help/topics/*.md` (61 files).

**Files modified:** `client/src/App.jsx` (route registration + import), `client/src/components/Layout.jsx` (User Guide button → navigate + placeholder modal removed + version bump), `client/src/components/AdminLayout.jsx` (Help entry), `client/src/pages/Home.jsx` (Help link), `server/index.js` (version strings), `client/package.json`, `server/package.json`, `CLAUDE.md`, `README.md`.

**Verification.** Run `cd client && npm run dev` and visit `http://localhost:3000/help`. Confirm sidebar groups expand/collapse, search filters live, every topic loads without 404, Previous/Next walks the full sequence, browser back/forward updates the visible topic, `/help/does-not-exist` shows the not-found banner. From `/dashboard`, clicking **Information → User Guide** navigates to `/help` (no modal). From `/` (home), the new **HELP & USER GUIDE** link navigates. From `/admin/dashboard`, the Help sidebar entry navigates.

**Out of scope.**
- No screenshots or video embeds (text only — image syntax already supported by the renderer for a future authoring pass).
- No "Was this helpful?" feedback widget.
- No localization (English only).
- No `?` icon on individual tablet pages (full-screen scoring surfaces; tap collision risk).
- No server-side rendering — fully client-side bundle.

---

## v1.20.00 Feature Notes

### Voice Manual Score Entry — Wizard Model (v1.20.00)

New optional voice-driven workflow for the chief-of-score role. All existing scoring paths are byte-identical to v1.19.02 behavior — voice is purely additive. **No scoring math changes.** All formulas, DD lookup, judge roles, server routes, and API contracts are unchanged.

**Speech engine.** Deepgram Nova-3 streaming. `DEEPGRAM_API_KEY` must be set in the server's environment (`~/.zshrc` for local dev, Railway service variables for production). Without it, the voice modal renders a clean "Voice service unavailable" error and the operator falls back to keyboard manual entry. Audio is never persisted — only the resulting transcript text lands in the database (new `runs.voice_transcript` column).

**Two operator contexts:**
- **Paper-entry batch flow.** A new "🎙 Voice Manual Entry" button at the top of every Scoring tab (mogul + aerials legacy; hidden on dual mogul and aerials v2) opens `VoiceManualEntryModal` in `'paper'` mode. The modal walks: bib confirmation → guided dictation → confirmation review → submit → next-bib prompt → repeat. Done button closes at any natural break.
- **Tablet edit flow.** The existing `ManualScoreModal` (opened from per-row "Manual Entry" buttons) gains a "🎙 Voice Entry" header button. Clicking it closes the keyboard modal and opens `VoiceManualEntryModal` in `'tablet'` mode with the athlete pre-selected, skipping the bib screen.

**Wizard dictation model.** The dictation screen is a guided wizard, NOT free-form. A blue-glow cursor highlights ONE field at a time. The operator speaks only the value for that field (no section keywords). Four voice commands control navigation:
- **"Next"** — advance the wizard cursor by one field
- **"Redo"** — clear the value of the currently active field (cursor stays)
- **"Submit"** or **"Done"** — stop the mic and jump to the Review screen
- **"No Time"** / **"NT"** — only meaningful when the cursor is on the Time field; sets value to -1

**Speaking a value does NOT auto-advance the cursor.** This is the "stay-put" rule. Saying "six point five" while the cursor is on Carving lands 6.5 in Carving; the cursor stays on Carving. Saying another number replaces the value (self-correction by simply re-speaking). The operator must explicitly say "Next" to move on. This eliminates false advances on partial Deepgram returns.

**Field sequence (auto-built from event config):** Time (when `has_speed`) · for each T&L judge: Carving / Absorption / Upper body / Deduction (component scoring on) OR Raw / Deduction (component scoring off) · Jump 1 code / Jump 2 code (per `num_jumps`) · for each Air judge: Jump 1 / Jump 2 scores. Devo, RQS-EQS, and 1-jump events skip irrelevant fields automatically.

**Click-to-edit-target.** Tap any field in the script during recording to set it as a temporary "edit target" (dashed amber ring). The next spoken value lands in the clicked field — NOT in the wizard cursor's current position. After the value lands, the edit target clears and the wizard cursor visually resumes its previous position. Saying "Next" advances from the wizard cursor (its preserved position), not the clicked one. Two-cursor model: wizard position is sequential; click is random-access.

**Status overrides via toolbar (not voice).** Three buttons in the modal header — DNS / DNF / DSQ — each open a confirm dialog ("Mark bib X as DNS — confirm?") and submit the run with that status, overriding any partial scores entered. Voice intentionally does NOT recognize DNS/DNF/DSQ as commands — the toolbar is the only path so a chance mishearing can never zero out an athlete's scores.

**Jump code DB validation.** When the modal opens it fetches the actual jump-code list for the event's discipline + gender from `/api/jump-dds`. Every parsed jump code is validated against that set after spoken-phrase mapping. Codes not in the table flash red (`✗`) with the recognized text shown so the operator can immediately click + re-record the correct code, or type-correct on the Review screen. Submit is blocked while any jump code is invalid. The "Code" mishearing that triggered this feature ("Code" is not in any DD table) now fails closed instead of silently storing a bad value.

**Spoken phrase → canonical jump code.** The same `JUMP_PHRASE_MAP` from the earlier voice build handles common mogul phrasings ("twister spread" → TS, "back full" → bF, "back position" → bp, "back pike" → bP, "back layout" → bL, etc.). Letter-by-letter pronunciations ("T S") collapse to `TS` if the canonical code exists. After mapping, the result must still appear in the DB list to validate.

**Number handling.** Deepgram's `smart_format=true` converts most spoken numerics to digits ("twenty-three point two three" → "23.23"). The parser additionally handles: "point N" / "point N M" sequences (e.g., "point two three" → 0.23), bare English words ("seven" → 7), and compound tens-units ("forty five" → 45). Per-field range checks surface obvious mis-hears as amber on the live script and on the Review screen.

**Confirmation Review.** After "Submit" / "Done" (voice or button), a two-column Review screen shows the raw transcript on the left and the parsed values on the right as editable inputs. Each row has a status glyph: green ✓ (ok), amber `!` (out-of-range), red ✗ (invalid jump code), or gray `·` (empty). Submit button is gated on every required field being filled AND every jump code being valid. Re-record discards everything and re-enters the wizard.

**Hardware trigger.** F2 toggles record/stop while the voice modal is open. The Nuance PowerMic II/III and Philips SpeechMike Premium 3500 can be configured in their respective driver utilities to send F2 on press. AirPods or USB headsets work with the on-screen Start/Stop button or F2 directly.

**Server architecture.** The browser opens `ws://server/ws/voice/<eventId>` (new path, dispatched off the existing `/ws` server by URL inspection). The server's `server/voice/deepgram.js` module opens an upstream WebSocket to `wss://api.deepgram.com/v1/listen` with the `DEEPGRAM_API_KEY` in the Authorization header, then proxies binary PCM frames (linear16, 16 kHz mono, ~250 ms chunks) from the client to Deepgram, and JSON transcript messages back. `client/src/voice/audioCapture.js` uses `AudioContext` + `AudioWorklet` (modern path) or `ScriptProcessorNode` (fallback) to capture raw PCM and downsample in JS. `client/src/voice/parser.js` runs entirely client-side and is a pure function — no server-side parsing.

**Each Deepgram `is_final` chunk is processed independently** by `handleUtterance`: first as a command (`detectCommand`), and if no command matches, as a value for the active field via `extractValueForField(utterance, fieldType, { allowedJumpCodes, isAerials })`. Interim transcripts display as a live caption but don't mutate state. The transcript that gets persisted to `runs.voice_transcript` is the concatenated final-only string.

**Failure modes.**
- **Deepgram unavailable / API key missing / network outage:** voice modal shows "Voice service unavailable. Use keyboard manual entry." Operator closes the modal and uses the existing keyboard path. No partial data is written.
- **Microphone permission denied:** clear error message in the modal.
- **Bad parse / invalid jump code:** field shows red on the live script and on the Review screen. Operator clicks the field to retarget and re-records, or type-corrects in the Review screen.

**Submit path.** On confirm, the modal calls the existing `POST /api/events/:eventId/runs/manual` (paper) or `POST /api/events/:eventId/runs/:runId/manual-score` (tablet edit) with the parsed values plus an optional `voice_transcript` field. Both endpoints store the transcript in the new `runs.voice_transcript` column for post-event audit; all other behavior is unchanged. Aerials v2 events (those with `events.aerials_panel_size IS NOT NULL`) already refuse the legacy manual-entry shape per v1.18.02; the voice toolbar buttons are hidden on those events.

**Files added:** `server/voice/deepgram.js`, `client/src/voice/parser.js`, `client/src/voice/audioCapture.js`, `client/src/components/VoiceManualEntryModal.jsx`

**Files modified:** `server/db/schema.js` (`voice_transcript` migration), `server/index.js` (WS path dispatch, version strings), `server/routes/runs.js` (both manual entry endpoints accept `voice_transcript`), `client/src/pages/EventDetail.jsx` (top-level Voice Manual Entry button + ManualScoreModal header Voice Entry button + modal render), `client/src/components/Layout.jsx`, `client/package.json`, `server/package.json`, `CLAUDE.md`

**Known limitations of v1.20.00:** No aerials v2 support (uses per-judge-per-jump tablets). No dual mogul support (bracket scoring is fundamentally different). No text-to-speech readback (visual confirmation only). Audio is not retained — only the final transcript text is stored. Voice cannot trigger DNS / DNF / DSQ — operator must click the toolbar buttons.

---

## v1.19.02 Feature Notes

### LIVE NOW — Grouped by Meet (v1.19.02)

The red "LIVE NOW" strip at the top of `/livescores` previously flattened every active event across every visible meet into its own card. With three concurrent meets each running multiple events, the section ballooned to 15+ cards with the same meet name repeating five or six times — visually noisy. Now `LiveStrip` (`client/src/pages/LiveScores.jsx`) groups by meet: one red gradient card per meet, meet name in `sk-display` as the card header, and one small white-tinted pill per active event inside (showing `Men · Moguls` etc.). Each pill is the `<Link>` to `/scoreboard/<short_code>` — same target as before, so navigation is unchanged. Single-event meets render with the same meet-card chrome (uniform style, no separate fallback layout). Grid `minmax` widened from 260px to 300px to keep three columns comfortable at desktop widths now that cards have two stacked rows. No server changes — the `/api/meets/livescores` payload already nests events under meets, so client-side `meets.map(m => ({ meet: m, events: m.events.filter(active) }))` is all that's needed.

**Files modified:** `client/src/pages/LiveScores.jsx`, `client/src/components/Layout.jsx`, `server/index.js`, `client/package.json`, `server/package.json`, `CLAUDE.md`

---

## v1.19.01 Feature Notes

### Pre-USSS Demo Bug-Hunt Pass (v1.19.01)

Comprehensive multi-agent code review ahead of presenting at US Ski & Snowboard. Eleven bug fixes across the live-scoring path, public surfaces, dual mogul state machine, autosave subsystem, and exports. **No scoring math changes.** All formulas, DD lookup, judge roles, server routes, and API contracts are unchanged.

**Live scoring path:**
- **Air judge code reset on per-jump rejection** — `client/src/pages/JudgeTablet.jsx:573-580`. The WebSocket reject handler cleared `airJ1`/`airJ2` but left `code1`/`code2`/`codesSubmitted` set when the HJ rejected only one of two air-judge submissions. Judge would see a blank score but a still-selected jump code chip, risking re-entry against the wrong code. Now mirrors the polling-path behavior (`code1`, `code2`, `codesSubmitted` reset). The "Clear Codes" path was already correct via v1.16.08.

**Dual mogul state:**
- **Manual-entry lock cleared on server boot** — `server/index.js`. If an operator clicked Manual Score Entry and the browser crashed (or the server restarted) before they could click Cancel, `events.dual_manual_entry=1` persisted indefinitely and judges' tablets stayed locked out. Boot now runs `UPDATE events SET dual_manual_entry=0 WHERE dual_manual_entry=1` once before listening. Live-session timeout (mid-process expiry) deferred to a future build.
- **Edit Scores hidden on finalized dual events** — `client/src/pages/EventDetail.jsx`. v1.16.17 made Edit Scores available on completed matches regardless of paper-mode. After event finalization, editing a match silently desynced `events.dual_bracket_review_status` (locked at `'approved'`) from underlying scores because `clearDualBracketReviewStatus` early-returns on approved. Edit Scores now hidden once `event.status === 'complete'`. A future admin-panel "re-open finalized event" action is documented in the plan/notes for proper post-finalization edits.

**Phase creation:**
- **Cut-line undersized field notice** — `server/routes/phases.js` + `client/src/pages/EventDetail.jsx`. When `final_size=16` but only 8 athletes qualified (e.g., heavy DNS), the cut silently created an 8-athlete final with no operator warning. POST /phases now returns an `undersized_notice` string when the actual eligible count is less than configured for `final_1`/`final_2`/`qualifier_2`; the Phases tab surfaces it as an alert immediately after creation. Phase still creates with whatever athletes are available — non-blocking. Tied-rank cut expansion (v1.16.32) is unchanged; this only flags the opposite case.

**Autosave / backups:**
- **Time-based auto-backup** — `server/db/autosave.js`. Replaced the every-5-writes counter with a 5-minute `setInterval` that fires `doBackup()` only when at least one write has occurred since the previous backup. The old approach reset its counter on every restart, so rapid restart cycles could starve backups; time-based survives restarts naturally. AdminBackups page now shows "Every 5 min if writes occurred" with pending-write count and total-write counter side-by-side.
- **Auto-backup failures piped into AdminDashboard error log** — `server/db/autosave.js` + `server/index.js`. `startAutoBackup(onError)` now accepts an error callback; the boot wiring pushes failures onto `app.errorLog` with a `BACKUP / auto` tag and "Auto-backup failed (covered N writes)" message so operators see them on the AdminDashboard alongside HTTP errors.

**Public surfaces:**
- **Overlay polling vs WebSocket dedup** — `client/src/pages/Overlay.jsx`. The 3-second hardware-encoder fallback poll could overwrite a fresh WebSocket score update if its in-flight fetch landed after the WS message — visible flicker on broadcast canvases. Each poll now captures a `pollStartedAt` timestamp and skips its state mutation if `lastWsAtRef.current > pollStartedAt`. WebSocket-dead environments (YoloBox/OBS without persistent WS) are unaffected because `lastWsAtRef` stays at 0.
- **Scoreboard polling vs WebSocket dedup** — `client/src/pages/Scoreboard.jsx`. Same pattern, simpler implementation: the 5-second poll skips one cycle if a WS message landed in the last 4 seconds. Reduces unnecessary refetches and the rare race where a stale poll overwrites a fresh WS-triggered load.
- **Sun Mode FOUC eliminated** — `client/index.html`. A tiny inline `<script>` runs before React mounts; reads `localStorage.stickit.sunMode` and paints `<html>` background to the appropriate theme color on public routes (`/`, `/livescores`, `/scoreboard/...`). Officials/admin/tablet routes and the Overlay's transparent canvas are unaffected — the script returns early on those paths. PublicLayout's `useEffect` continues to handle runtime toggling.
- **Scoreboard "Event not found" page** — `client/src/hooks/useResolveIds.js` + `client/src/pages/Scoreboard.jsx`. The hook now returns `resolveError: true` when `/api/resolve` fails or returns null IDs for a requested short code. Scoreboard renders a clear "Event not found" card with the bad short code echoed back and a "View live scores" link, instead of silently using the bad ID and showing a blank page. Overlay intentionally remains silent (no error text on broadcast canvases).

**Exports:**
- **Nation column removed** — `server/routes/export.js`. The CSV, Excel, and HTML print exports always emitted an empty `Nation` column because v1.16.12 removed Nation from the Athletes UI but left it wedged between First Name and Club in the output. Removed from headers, data rows, and the HTML print CSS. The underlying `athletes.nation` DB column is preserved for USSS transmit XML and meet import/export round-trip per CLAUDE.md.

**Skipped / deferred:** Aerials legacy formula (procedural mitigation per existing CLAUDE.md), advanceWinner null-match logging, confirm-dialog backdrop edge-tap, manual-entry stale partial scores (by design), admin auth (Railway-level mitigation), and a five-of-eight verification pass on rules-compliance audit items — all documented in `Claude Output/StickIt_Outstanding_Upgrades.docx` for a future cleanup pass.

**Files modified:** `server/index.js`, `server/db/autosave.js`, `server/routes/admin.js`, `server/routes/dual.js`, `server/routes/export.js`, `server/routes/phases.js`, `client/index.html`, `client/src/hooks/useResolveIds.js`, `client/src/pages/EventDetail.jsx`, `client/src/pages/JudgeTablet.jsx`, `client/src/pages/Overlay.jsx`, `client/src/pages/Scoreboard.jsx`, `client/src/pages/admin/AdminBackups.jsx`, `client/src/components/Layout.jsx`, `client/package.json`, `server/package.json`, `CLAUDE.md`

---

## v1.19.00 Feature Notes

### Judge Tablet Prototype Audit + Post-Audit Polish (v1.19.00)

Major UI release. Comprehensive audit of the v1.18.05 redesign against the high-fidelity Slide 01–05 PDF prototype with **19 discrepancies addressed**, plus four post-audit follow-up fixes after iPad testing, plus a full migration of the HJ tablet inner judge-list rows from legacy Tailwind to the new tablet-* token system. The minor version bump from v1.18 → v1.19 reflects the scope. **No scoring math changes.** All formulas, DD lookup, judge roles, server routes, and API contracts are unchanged.

**Slide 01 — Air Judge:**
- **Two-step → single-screen flow.** The redesigned `AirJudgePanel` now renders both jump-code grids and both score grids simultaneously in two side-by-side columns plus a 260px right-side reference sidebar. Judge can fill code/score in any order. New combined `submitAirAll()` handler PUTs codes first, then POSTs scores; on 409 mismatch from the other Air Judge, the server's exact error text (`"Jump codes differ from the other Air Judge.  Contact the Head Judge to resolve."`) is surfaced in a red banner and score POSTs are NOT fired. Local state preserved on error for retry. Each judge picks codes from scratch — no pre-select. Mismatch protection at `server/routes/runs.js:911-921` is unchanged.
- **Mixed-step score grid.** New `VALUES_AIR_15 = [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0, 9.5, 10.0]` matches the prototype's 6×3 layout: 1.0 increments 0–5, then 0.5 increments 6–10. `ScoreButtonGrid` extended with optional `values` prop; when provided, renders those exact buttons. Selection anchor via `nearestAnchor()` keeps the highlight stable when fine-tune (±0.1) drifts the value off-grid.
- **Multi-line jump chips** in the athlete bar replace the inline `ScoreSummaryChip`. Each chip shows `JUMP 1` label, big green Bebas Neue score (or `—`), and small mono `code · DD value` (or `pending`).
- **JUMP CODE / SCORE subheadings** added above each grid, plus inline `Fine tune:` label.
- **260px right-side reference sidebar** restored (was dropped to full-width below in v1.18.05).

**Slide 02 — TL non-component:**
- **Friendly judge-role display** via new `ROLE_DISPLAY` map: `T&L Judge 1`, `T&L Judge 2`, `T&L Judge 3` instead of `TL1/TL2/TL3`. Internal `judge.role` value unchanged.
- **TL athlete-bar meta line** now shows `Jump 1: <code> · Jump 2: <code>` from `activeRun.jump1_code` / `jump2_code`. Judge identity moves to the right cluster (matching the prototype).

**Slide 03 — Component scoring:**
- **Reference pills as colored badges.** New `RefPillRow` component + `tablet-ref-pill` CSS class. Each component column ends with a horizontal row of 4 small badges: `[Excellent 8.1–10] [Good 6.1–8] [Adequate 4.1–6] [Poor 0.1–4]` (Carving) or 0–5 ranges for Ab/Ext + Upper Body. Replaces the previous `tablet-ref-row` stack.
- **Subtitle copy** updated per prototype: `0–10 · Good range: 6.1–8` (Carving), `0–5 · Good range: 3.1–4` (Ab/Ext + Upper Body), `0–5 · Not yet entered` before pick.
- Score display moved from below-the-title to inline-with-title, using green Bebas Neue when picked.

**Slide 04 — Timekeeper:**
- **Numpad flipped to calculator order** (matches stopwatch entry conventions): 7-8-9 / 4-5-6 / 1-2-3 / `[empty] 0 .` bottom row. Was phone-style in v1.18.05.
- **Backspace inline with the time display** (right edge, 80px wide, red-tint border) instead of in the numpad.
- **Submit Time** label gets ✓ checkmark prefix.
- **Manual Time Calculation** button gets the ⏱ stopwatch glyph and longer label `(Top / Bottom Timer)`.
- **No Time** uses the danger (red) variant instead of neutral.

**Slide 05 — Head Judge:**
- **3-column status bar at top** with `StatusSquare` (12×12 normal, 14×14 HC) and friendly labels — `T&L JUDGES 3/3`, `AIR JUDGES 2/2`, `TIME IN ✓`. Driven by existing `event.num_tl_judges` / `num_air_judges` / `num_jumps` / `has_speed`. Replaces the right-column "Score Status" box from v1.18.05.
- **AthleteBar** at top with friendly "Head Judge" role label and HC mode button.
- **`RunStatusGrid` component** wired in for DNS/DNF/RNS/DSQ. Built-in confirm dialog preserves the v1.16.16 confirmation pattern. The pre-existing `setRunStatus` `window.confirm` was removed to avoid double-confirmation.
- Inner judge-list rows (T&L, Air, Time) intentionally **kept on legacy Tailwind** for this release — the v1.16.16 reject confirm dialogs are inline-rendered with complex state, and rebuilding them would risk the critical reject/approve flow. The legacy `.hc` cascade keeps HC mode working visually.

**HC variants (Slides 06–10):** Inherit automatically via `[data-hc="1"]` overrides on every new `tablet-*` class. The legacy `.hc` cascade in `index.css` stays in place as defense-in-depth for any inline Tailwind that hasn't migrated yet.

**Component-layer additions:**
- `client/src/components/tablet/ScoreButtonGrid.jsx` — new `values?: number[]` prop, `nearestAnchor()` helper, exported `VALUES_AIR_15` constant.
- `client/src/components/tablet/ReferencePanel.jsx` — new exported `RefPillRow` component.
- `client/src/index.css` — new `tablet-ref-pill` class with q-ex/gd/av/mg/po color variants and HC override.

**Files modified:** `client/src/components/tablet/ScoreButtonGrid.jsx`, `ReferencePanel.jsx`, `client/src/pages/JudgeTablet.jsx`, `TimekeeperTablet.jsx`, `HeadJudgeTablet.jsx`, `client/src/index.css`, `client/src/components/Layout.jsx`, `client/package.json`, `server/index.js`, `server/package.json`, `CLAUDE.md`

### Post-Audit Follow-Up Fixes (v1.19.00)

After iPad testing, four small bug fixes were applied:

1. **HJ tablet — DNS/DNF/RNS/DSQ button labels removed.** The `RunStatusGrid` component rendered descriptive sub-labels under each code (`Did Not Start`, `Did Not Finish`, `Refused Score`, `Disqualified`) that didn't appear in the prototype. Removed; codes render solo at 26px in `tablet-display`.
2. **Timekeeper — stale Next Up bug.** When a run started in tablet mode, the timekeeper's "Next Up" sidebar continued to show the just-started athlete with a Start Run button (because the poll loop only refetched Next Up when `!run || isPaper`, leaving the previously-fetched value in state). Render condition now gated on `(!activeRun || isPaper)` and stale state explicitly cleared in the poll loop. Paper mode behavior is unchanged — paper-mode timekeepers continue to see Next Up alongside an active run because they're the operator who starts subsequent runs.
3. **Live Scoreboard — "NOW COMPETING" banner alignment.** Banner inline style had `margin: '0 auto 20px'` overridden by explicit `marginLeft: 16` / `marginRight: 16`, forcing the banner to sit 16px from the left edge with a 760px max-width — leaving the right side empty. Fixed by wrapping the gradient panel in a centered 760px container with `padding: '0 16px'` for narrow-screen safety. Now lines up with the rank cards below it.
4. **HJ tablet — inner judge-list row migration.** The v1.18.06 release intentionally left the inner T&L / Air / Timekeeper rows on legacy Tailwind classes (slate/gray) because the inline reject confirm dialogs have complex state. v1.19.00 completes the migration via a CSS-only restyle — Tailwind class swaps to the new `tablet-*` token system. Zero JSX structure changes, zero logic changes, all data displays preserved verbatim:
   - Component breakdown text (`Crv 5.5 / UB 1.0 / A&E 4.5 / Ded 1.5`) — same conditional, same fields.
   - Inline reject confirm dialogs for T&L / Air / Time — same `executeReject` / `cancelReject` / `executeTimeReject` handlers; styled with `tablet-card`, `tablet-btn-danger`, `tablet-btn-neutral`.
   - Clear Codes link, Reject Time button, Time Points calculation (`48 - 32 * (run_time / pace_time)`), aerials v2 grid — all untouched.
   - Score values use `tablet-mono` (JetBrains Mono); air jump codes accent in `--tablet-blue2`; section headers in Bebas Neue `tablet-display` matching the v1.18.06 outer chrome.

**Disposition:** Released. Build delivered as `StickIt_1_19_00.zip` to `~/Desktop/Scoring Server/Scoring Zip Files/`. Git push triggers Railway auto-deploy.

---

## v1.18.05 Feature Notes

### Judge Tablet UI Redesign — Mogul / Dual Mogul / RQS / Devo (v1.18.05)

Visual redesign of the four judge-facing tablet pages (`JudgeTablet.jsx`, `HeadJudgeTablet.jsx`, `TimekeeperTablet.jsx`) based on a high-fidelity design package (`Judge Tablets.zip`). New navy/blue palette, color-zoned score buttons (Excellent / Good / Average / Managing / Poor), Bebas Neue / DM Sans / JetBrains Mono typography, 260–280px sidebar reference panels, and a unified High Contrast (HC) mode mirror of every screen in black/white/amber.

**Zero scoring math changes.** All formulas are bit-for-bit identical: T&L total (`carving + absExt + upperBody − deduction`, clamped 0.1–20), single T&L (`raw − deduction`), air score (`raw × DD`), speed score (`max(0, 48 − 32 × t/pace_time)`), DD lookup, deduction presets (`0.1, 0.5, 1.0, 1.6, 6.0`), tie-break order, and judge-role structure are all unchanged. Only the UI layer is touched.

**Per-division behavior preserved.** The redesigned UI is driven by the existing `event.num_tl_judges` / `event.num_air_judges` / `event.num_jumps` / `event.has_speed` flags and the existing `eventDivision === 'devo' || eventDivision === 'rqs_eqs'` restricted-division check. Division defaults stay at:
- **Comp Series:** 3 TL + 2 Air, 2 jumps, time, component scoring on
- **RQS-EQS:** 2 TL + 1 Air, 2 jumps, time, component scoring off (uses non-component TL view)
- **Devo:** 2 TL + 1 Air, 1 jump (Air judge column renders full-width), no time entry
- **Dual Mogul:** 5-judge bracket layout (DualTurns1/2, DualAir, DualTime, DualOverall) with split-point judge view

**Jump-code lists.** RQS uses the same `DEVO_FREQ_CODES` quick-select as Devo (`S, T, D, X, K, TS, TT, TD, TTS, 3, 3p`) and the same dropdown filter (`/^[bfl]|o/`). Comp Series uses `COMP_FREQ_CODES` (`N, S, T, K, TS, 3, bT, bp, bL, bG, bF, 7op, 7oG`). DDs come from the existing `jump_dd_table` rows seeded with `ruleset='uss'` — unchanged.

**HC mode.** The existing `useHighContrast` hook (localStorage `stickit-high-contrast`) is the toggle source of truth for both the legacy `.hc` cascade and the new `[data-hc="1"]` selector system. Toggling HC flips a `data-hc` attribute on the page root container — no React state, no scoring values, no in-progress entries are reset. Available in all divisions on all four tablets. README discrepancy note (component weights stated as `0.5/0.25/0.25` weighted formula vs. codebase's additive `10+5+5` formula): mathematically identical, codebase formula is preserved.

**Implementation.** New CSS variable block + `tablet-*` utility classes added to `client/src/index.css` (lines 233+); new `[data-hc="1"]` overrides for HC mode. Eleven shared presentational components added in `client/src/components/tablet/`:
- `AthleteBar.jsx` — top bar with bib + name + meta + right slot
- `HCModeButton.jsx` — amber HC toggle with normal/HC variants (← Normal Mode / HC MODE ON badge pair)
- `ScoreButtonGrid.jsx` — color-zoned score grid with `ZONES_AIR` / `ZONES_TL` / `ZONES_COMP_5` exports
- `JumpCodeGrid.jsx` — 7×2 quick-select + "All codes" dropdown + No-Jump button
- `DeductionPad.jsx` — 5 presets + Clear + Manual entry, replaces inline DeductionPad
- `FineTuneRow.jsx` — −0.1 / score / +0.1 row with disabled-when-empty state
- `ReferencePanel.jsx` — sidebar reference with Excellent/Good/Adequate/Managing/Poor color rows
- `CalculatedScorePanel.jsx` — HJ tablet right panel (Turns/Air/Speed grid + Total)
- `JudgeReviewRow.jsx` — generic HJ judge-list row with reject button
- `StatusSquare.jsx` — 12×12 (or 14×14 in HC) green-glow square (square not circle, per design spec)
- `RunStatusGrid.jsx` — DNS/DNF/RNS/DSQ 4-button grid with confirm dialog (preserves v1.16.16 confirmation pattern)

**JudgeTablet refactor.** The Air judge view, TL non-component view, TL component view, and dual mogul judge view all migrate to the new design. The legacy `ScorePad` and `DeductionPad` inline components are removed. New panels: `AirJudgePanel` (two-step flow — jump codes → scoring), `TLComponentPanel` (3-column Carving/Ab-Ext/Upper Body grid), `TLNonComponentPanel` (4×11 score grid + sidebar). `submitCodes()`, `submitScore()`, `turnsTotal` calculation, and all WebSocket / polling logic preserved verbatim.

**TimekeeperTablet refactor.** New 88px Bebas Neue finish-time display, custom 3×4 numpad (replacing `<input type="number">`), amber Manual Time Calculation button, NT (neutral, left) + Submit Time (green, flex 2.5, right). New right sidebar with Next Up card, Previous Times list (green for sub-pace times, amber for slower), and Pace Time box. Devo no-time, dual mogul disabled, paper-mode start-only, age-group banner, NT confirm dialog, and Manual Time Calc modal all preserved.

**HeadJudgeTablet refactor.** Targeted refactor — outer wrappers migrated to `tablet-root data-hc=...` (with belt-and-suspenders `.hc` class for legacy inline-Tailwind in the inner judge-list rows), HC toggle replaced with `HCModeButton` (3 sites), `BracketReviewPanel` restyled with new tokens, event-completed full-screens use new tokens. Inner judge-row layout in the standard mogul HJ view kept on legacy Tailwind for now — the v1.16.16 reject confirm dialogs, run-status confirm dialogs, age-group transition banner, dual mogul bracket review, and final review screen all retain existing logic. The `.hc` cascade in `index.css` (lines 147–232) still applies to the inner Tailwind classes so HC mode visually works end-to-end.

**Out of scope this release.** `AerialsJudgeTablet.jsx` (per-judge-per-jump v2 model) is not touched — separate redesign track. Public surfaces (Home, LiveScores, Scoreboard, Overlay) remain on the v1.17.00 redesign. Officials and Admin pages unchanged.

**Files created:** `client/src/components/tablet/AthleteBar.jsx`, `HCModeButton.jsx`, `ScoreButtonGrid.jsx`, `JumpCodeGrid.jsx`, `DeductionPad.jsx`, `FineTuneRow.jsx`, `ReferencePanel.jsx`, `CalculatedScorePanel.jsx`, `JudgeReviewRow.jsx`, `StatusSquare.jsx`, `RunStatusGrid.jsx`
**Files modified:** `client/src/index.css`, `client/src/pages/JudgeTablet.jsx`, `client/src/pages/HeadJudgeTablet.jsx`, `client/src/pages/TimekeeperTablet.jsx`, `client/src/components/Layout.jsx`, `client/package.json`, `server/index.js`, `server/package.json`, `CLAUDE.md`

---

## v1.18.04 Feature Notes

### Live Scores LIVE NOW Card — Meet Name Promoted (v1.18.04)

Swapped the two text lines on the red LIVE NOW cards at the top of `/livescores`. Previously the larger primary line (`sk-display`, fontSize 13, weight 700) showed `MEN · MOGULS` etc. and the smaller dim line (fontSize 11, opacity 0.85) showed the meet name. The meet name carries more identifying weight than the discipline/gender label, so the lines are now flipped: meet name renders as the primary heading, discipline/gender sits beneath it as the secondary line. Styling on each line is unchanged — only the content order swaps.

**Files modified:** `client/src/pages/LiveScores.jsx`

---

## v1.18.03 Feature Notes

### Add Event Modal Redesign + Edit Event Button (v1.18.03)

Two coupled changes to event configuration UX on the meet detail page (`/dashboard/meets/:id`).

**Add Event modal cleanup.** The standalone top "Event Type" sanction selector that appeared for every discipline (mogul, dual mogul, aerials) is removed. Event Type is conceptually aerials-specific — it drives panel size, HJ-may-score, and reduction-method rules per FIS/USSS sanction tiers — so showing it for mogul/dual mogul events was misleading. The middle dropdown (label still "Category") is now discipline-aware:

- **Mogul / Dual Mogul:** existing options — Comp Series / Devo / RQS-EQS / FIS — bound to `form.division`. Devo and RQS-EQS still disabled when discipline is dual mogul.
- **Aerials:** USA Regional / USA National / FIS Other / FIS NAC/NorAm / FIS OWG/WSC/WC, bound to `form.event_type`. The label intentionally stays "Category" for visual consistency with mogul (per design choice, not a rule).

The verbose aerials info box ("Standard aerials: each scoring judge enters Air (0.0–2.0), Form (0.0–5.0), Landing (0.0–3.0)…") is removed — officials know the rule. Auto-name for aerials events now uses Event Type label (`"USA Regional Male Aerials"`) instead of the previous Category-based pattern; mogul/dual mogul events keep `"Comp Series Male Mogul"`.

Behind the scenes both `events.event_type` and `events.division` columns continue to be persisted: mogul/dual mogul events silently default `event_type='usa_regional'` (no scoring effect per v1.18.00 rules); aerials events silently default `division='comp_series'` (form's default — harmless for aerials, which doesn't read it).

**Edit Event button (new).** Each `EventCard` on the meet detail page now shows a mountain-blue **Edit** button next to the existing red Delete button. Clicking opens the same modal in edit mode, seeded from the event's current values, with title "Edit Event" and submit button "Save Changes". Submit calls the existing `PUT /api/meets/:meetId/events/:id` endpoint via `api.updateEvent(meetId, id, data)`.

The button is **disabled once the first run starts** — defined as any row existing in the `runs` table for that event (`EXISTS(SELECT 1 FROM runs WHERE event_id=?)`). In StickIt, run rows are created when scoring begins or via manual entry, so this is the natural cutoff. When disabled the button shows tooltip "Cannot edit after scoring has started" with reduced opacity. Existing server-side guards in `PUT /:id` (post-complete-run blocks on `component_scoring`, `score_entry_mode`, `event_type`, `aerials_panel_size`) remain as defense-in-depth.

**`has_runs` flag added to `GET /api/meets/:id`.** The events SQL gains a `has_runs` integer column via `CASE WHEN EXISTS (SELECT 1 FROM runs WHERE event_id = e.id) THEN 1 ELSE 0 END`. Used client-side to disable the Edit button.

**Modal refactor.** The previous `CreateEventModal` is renamed `EventFormModal` and accepts `mode='create'|'edit'`, `initialEvent`, and a single `onSave` callback (replacing the old `onCreate`). Edit mode skips the auto-name `useEffect` on first render via a `didMount` ref so a user-customized event name (e.g. `"Day 1 — Mens Comp"`) isn't clobbered when the edit modal opens. Subsequent discipline/category/gender/event_type changes inside the open modal do still re-trigger the auto-name (intentional — same as create mode). Edit mode also skips the division → judge-config defaults `useEffect` so editing an event whose judge counts diverge from category defaults doesn't reset them on mount.

**Card layout.** EventCard's right-side button cluster moved from a single absolute Delete button to a `flex gap-2` group containing Edit + Delete; reservation padding bumped from `pr-16` to `pr-28`. The aerials event_type label that previously appeared on the bottom row is removed (now reflected in the top badge row via the discipline-aware Category badge).

**Files modified:** `server/routes/meets.js`, `client/src/pages/MeetDetail.jsx`, `client/src/components/Layout.jsx`, `client/package.json`, `server/package.json`, `server/index.js`, `CLAUDE.md`

---

## v1.18.00 Feature Notes

### Aerials Judging Redesign — Per-Judge-Per-Jump Scoring + Event Type Sanction (v1.18.00)

Major rewrite of the aerials scoring path. **Mogul and dual mogul are completely unchanged** — every modification is gated on `events.discipline === 'aerials'` or fires only on new aerials columns. Sourced from FIS ICR Book VI (Sept 2025), FIS Freestyle Judging Handbook (Oct 2025), FIS Solution Manual v1.5, and the 2026 USSS Freestyle Competition Guide.

**Core change: judging model.** Aerials previously had separate per-component judge roles (`AirJudge1-3`, `FormJudge1-3`, `LandingJudge1-3`) where each judge entered only one component. The reviewed rule books are explicit that in standard aerials, **every scoring judge independently evaluates Air, Form, and Landing for each jump.** Component-specific roles were inconsistent with the rules. v1.18.00 introduces a single role `AeJudgeN` (numbered 1..N where N = panel size). Each judge submits Air (0.0–2.0), Form (0.0–5.0), Landing (0.0–3.0) for each jump.

**Event Type sanction field.** New `events.event_type` column (default `usa_regional`) classifies the event by sanction. Each value drives the allowed aerials panel sizes and HJ-scoring rule:

| Event Type            | Panel Size | HJ may score? |
|-----------------------|-----------:|:--------------|
| FIS OWG/WSC/WC        | 5–7        | No            |
| FIS NAC/NorAm         | 5–7        | No            |
| FIS Other             | 5 (locked) | No            |
| USA National          | 2–5        | No            |
| USA Regional (default)| 2–5        | Yes           |

Mogul and dual mogul events also get an event_type field but it does not affect their scoring logic in this release. Default for all new events is `usa_regional`.

**Reduction rule.** Per FIS Judging Handbook 6003.1 for the standard 5-judge format, drop the highest and lowest score per component independently, then sum the kept three. v1.18.00 extends this naturally for 6– and 7–judge FIS panels (drop 1 high + 1 low, keep the middle 4 or 5 — selected automatically by panel size, no operator config). For USA reduced panels (2/3/4 scoring judges), the operator must pick a `aerials_reduction_method` — default `sum_all` (no drops), with `drop_high`, `drop_low`, and `average` available. The selection prints on the calculation report.

**Scoring formula.** Per jump:
```
total_judges_score  =  sumKept(Air) + sumKept(Form) + sumKept(Landing)
jump_score          =  floor(total_judges_score × DD, 2dp)
event_total         =  sum across jumps
```

**Compliance — USSS 4110 / FIS JH 6004 (Form & Landing per-jump, DD-multiplied).** The v2 formula above multiplies the per-jump sum of Air + Form + Landing by per-jump DD, exactly as the rule books specify. This satisfies Fix 5 of the rules-compliance audit (`Claude Output/StickIt_Rules_Compliance_Fixes.md`) for every aerials event created at or after v1.18.00. Pre-v1.18.00 ("legacy") aerials events with `aerials_model IS NULL` still read through `calcAerialsScore`, which computes a single Form/Landing per run and does not DD-multiply them — those events render historical results unchanged but cannot be retroactively recomputed (per-jump Form/Landing was never collected). New aerials events all use the rule-correct v2 path.

**Database (additive migrations only):**
- `events.event_type TEXT NOT NULL DEFAULT 'usa_regional'`
- `events.aerials_panel_size INTEGER` — # of scoring judges (set on aerials only)
- `events.aerials_hj_scores INTEGER NOT NULL DEFAULT 0` — USA Regional flag
- `events.aerials_reduction_method TEXT` — `'sum_all' | 'drop_high' | 'drop_low' | 'average'`
- `judges.judge_number INTEGER` — 1..N matching the `AeJudgeN` slot
- `runs.aerials_model TEXT` — `'v2'` for new model, `NULL` for legacy. Tells the engine which path to use.

**Engine.** New `calcAerialsScoreV2(params)` in `server/scoring/engine.js` accepts a `judgeScores: [{ judge_number, jump, air, form, landing }]` array, applies the reduction rule, multiplies by per-jump DD, sums jumps, and floors to 2dp. The legacy `calcAerialsScore` is left untouched — runs with `aerials_model IS NULL` continue to use it, so historical events read identically.

**Score types.** New `judge_scores.score_type` values: `ae_air_j1`, `ae_air_j2`, `ae_form_j1`, `ae_form_j2`, `ae_land_j1`, `ae_land_j2`. Score-submit endpoint validates ranges per the FIS handbook. Legacy `air_jump1` / `air_jump2` / `form` / `landing` types continue to work for legacy events.

**Per-judge tablet URLs.** The aerials tablet now mirrors moguls: each judge gets their own short-code URL `/aerials-judge/<eventCode>/<judgeShortCode>`. The legacy shared URL `/aerials-judge/<eventCode>` still works as a fallback for legacy events (and renders the legacy single-component-per-judge UI). The new tablet shows two jump panels (Air/Form/Landing per jump) with quick-tap buttons, and a separate Submit Jump 1 / Submit Jump 2 button.

**Seeding.** New `POST /events/:id/judges/seed-aerials` endpoint wipes existing aerials judges and creates `aerials_panel_size` rows with role `AeJudge1..N`, fresh `short_code`s, and `judge_number = 1..N`. The Event Setup tab gets a "Seed N-Judge Aerials Panel" button.

**HJ tablet.** A new aerials grid panel renders above the existing 3-column layout when `event.aerials_panel_size IS NOT NULL`. Rows = scoring judges, columns = (J1 Air/Form/Land, J2 Air/Form/Land). Computed Form/Air/Landing totals appear at the bottom once `hj_pending` or `complete`. Approve/Send-back buttons unchanged.

**Public scoreboard.** Click-to-expand judge breakdown reads from a new `aeRows` field on the `/results/judge-scores` response and renders a per-judge-per-jump table for v2 events. Falls through to the legacy TL/A1/A2 columns for older events.

**PDF.** `event-results` PDF now prints a v2 calculation header for aerials events: event type, panel size, reduction method, and "truncated to 2dp" notation.

**Out of scope (deferred):** PDF/CSV exports do NOT yet include per-judge-per-jump columns for v2 aerials — only the aggregate Air/Form/Landing totals appear, mapped to existing `runs.air_score / turns_score / speed_score` columns. The Calculation Report can still be reconstructed from the live HJ grid + the new aerials header block. Aerials team events are out of scope for this release.

**Files modified:** `server/db/schema.js`, `server/scoring/engine.js`, `server/routes/events.js`, `server/routes/meets.js`, `server/routes/judges.js`, `server/routes/runs.js`, `server/routes/results.js`, `server/routes/pdf.js`, `server/index.js`, `client/src/pages/MeetDetail.jsx`, `client/src/pages/EventDetail.jsx`, `client/src/pages/AerialsJudgeTablet.jsx`, `client/src/pages/HeadJudgeTablet.jsx`, `client/src/components/public/AthleteCard.jsx`, `client/src/utils/api.js`, `client/src/App.jsx`, `client/src/components/Layout.jsx`, `CLAUDE.md`

### Aerials Tie-Break — USSS 4110.4.3 Compliance (v1.18.01)

Brought aerials tie-breaking into compliance with USSS 4110.4.3. Previous order was Total → Air **post-DD** → Turns → Speed; the rule requires Total → Air **without DD** → Form → Landing. The post-DD comparison can produce a different winner from the rule-correct order, so tied finishes were being decided incorrectly.

**Engine — `tieBreakAerials` rewrite (`server/scoring/engine.js`):** Now compares Total → `air_score_no_dd` → Form (`turns_score` column for aerials) → Landing (`speed_score` column for aerials), each with 0.001 epsilon. Manually-entered or pre-v1.18.01 runs missing `air_score_no_dd` fall back to `air_score` (post-DD) for the comparison only.

**Engine — `airNoDd` added to aerials returns:** Both `calcAerialsScore` (legacy) and `calcAerialsScoreV2` now return an `airNoDd` field — simple mean per jump (no drop H/L, no DD, no cap), 1-jump events double the single jump's mean. Mirrors the v1.16.23 mogul backfill formula. For v2 events, this is `avg(per-judge air per jump 1) + avg(per-judge air per jump 2)`.

**Schema backfill — `backfillAirScoreNoDd` extended (`server/db/schema.js`):** The existing v1.16.23 backfill already populated `air_score_no_dd` for legacy `air_jump1`/`air_jump2` score types (moguls + legacy aerials). v1.18.01 extends it to also try v2 score types (`ae_air_j1`/`ae_air_j2`) for any aerials v2 run with NULL `air_score_no_dd`.

**Routes — `air_score_no_dd` persisted on every aerials write path (`server/routes/runs.js`):** `tryFinalizeAerials` (legacy), `tryFinalizeAerialsV2`, manual-entry POST, and edit-score POST all now write `air_score_no_dd` for aerials runs (previously forced to NULL for aerials).

**Files modified:** `server/scoring/engine.js`, `server/db/schema.js`, `server/routes/runs.js`

### USSS Appendix C 2026 Aerials DD Chart (v1.18.02)

Replaced the placeholder aerials DD chart in `seedAerialsDDs` with the full USSS Appendix C chart from page 99 of the 2026 USSS Freestyle Competition Guide. Pre-v1.18.02 the seed had a "representative" set with several wrong values (`S=1.700` should be `1.48`, `bL=2.090` should be `2.05`, `bF=2.090` should be `2.30`, `bFF=2.360` should be `3.15`) and was missing many codes (`Tk`, `Pk`, `D`, `T`, `X`, `G`, `dG`, `bP`, `bX`, `bTT`, `bLT`, `bLL`, `bFT`, `bLF`, `bdFF`, plus the spin family).

**`buildAerialsDDChart` helper (`server/db/schema.js`):** Transcribes the chart's 29 base entries verbatim. The spin family is expanded programmatically: `Spin DD + 0.02` for each `Spin × Upright` combination (3/7/10 × {S, D, T, X, G, Tk, Pk}), `Spin DD + 0.02 + 0.10` for each `Spin × Upright × Grab` combination. 71 rows total (29 base + 42 spin-family). `bdFF` and its alias `bFdF` both seeded at 3.525.

**Startup migration (mirrors v1.16.08 mogul DD pattern):** Sentinel detects stale (`S` row not at 1.48) or incomplete (`Tk` row absent) charts; on either, deletes all `discipline='aerials'` rows and re-seeds. Idempotent: subsequent boots are no-ops.

**Files modified:** `server/db/schema.js`

### Aerials Form & Landing Per-Jump (Fix 5 satisfied by v1.18.00) (v1.18.02)

USSS 4110 / FIS JH 6004 require Form and Landing to be per-jump and DD-multiplied (same as Air). The v1.18.00 v2 redesign already implements this — `calcAerialsScoreV2` collects per-jump Form/Landing and applies per-jump DD via `(sumKept(Air) + sumKept(Form) + sumKept(Landing)) × DD` per jump. Therefore Fix 5 is satisfied for every aerials event created at or after v1.18.00. Pre-v1.18.00 ("legacy") aerials events with `aerials_model IS NULL` continue to use `calcAerialsScore`, which computes a single Form/Landing per run without DD multiplication. They render historical results unchanged but cannot be retroactively recomputed (per-jump Form/Landing was never collected on those runs). New aerials events all use the rule-correct v2 path. **No code changes** for this fix — documentation only.

### Cleanup Pass (v1.18.02)

Comprehensive code review surfaced 14 distinct findings across server, client, and docs. Net result of the approved cleanup pass:

- **Meet import/merge** (`server/routes/meets.js`): added the v1.18.00 columns (`event_type`, `aerials_panel_size`, `aerials_hj_scores`, `aerials_reduction_method`) to event INSERTs, `judge_number` to judge INSERTs, and `aerials_model` + `air_score_no_dd` to run INSERTs. Round-tripping a v1.18.00 meet through export → import now preserves all v2 aerials configuration. (Same bug pattern as v1.16.05.)
- **Manual / edit / reject paths** (`server/routes/runs.js`): the legacy-shape POST `/runs/manual` and POST `/:runId/manual-score` now refuse v2 aerials events with a clear error directing the operator to the per-judge tablets — the flat `form_scores`/`landing_scores` payload can't carry per-judge-per-jump data. The reject-score path (POST `/:runId/scores/:judgeScoreId/reject`) now correctly recomputes partial scores via `calcAerialsScoreV2` on v2 events.
- **About modal version** (`client/src/components/Layout.jsx`): the About panel now fetches version dynamically from `/api/version` instead of hardcoding the wrong value.
- **README.md, package.json**: bumped to v1.18.00 to match the app.
- **MeetDetail event-create modal** (`client/src/pages/MeetDetail.jsx`): switching discipline away from aerials now resets `aerials_panel_size`/`aerials_hj_scores`/`aerials_reduction_method` to defaults so a later switch back doesn't carry stale state.
- **`verify_v16.js`**: header updated to reflect coverage through v1.18.00; added 18 new checks (5 for `calcAerialsScoreV2` correctness with various panel sizes and reduction methods, 4 for the new `tieBreakAerials` USSS 4110.4.3 order including legacy fallback, 9 for the USSS Appendix C chart sentinel values + spin-family formula). Total now 50/50 passing.

**Files modified:** `server/routes/meets.js`, `server/routes/runs.js`, `client/src/components/Layout.jsx`, `client/src/pages/MeetDetail.jsx`, `README.md`, `client/package.json`, `server/package.json`, `server/scripts/verify_v16.js`, `CLAUDE.md`

---

## v1.17.02 Feature Notes

### Dual Mogul Overlay — Symmetric Result Layout + Winner Highlight (v1.17.02)

Three follow-ups to the v1.17.01 dual mogul broadcast Overlay (`OverlayDualVS`), plus a HJ tablet button-order swap and a server broadcast addition.

**Symmetric layout flip on `matchHasResult`.** Previously each `<Side>` decided its own `showResult` from `total != null || !!status`. When a match ended via DNF — the loser had a `status` set, the winner had neither score nor status — the loser's side flipped its layout (text inward, chip on outer edge) but the winner's side stayed in pre-result layout (text outward, chip near VS). Both sides now share a match-level `matchHasResult` derived from `(blueTotal != null || redTotal != null || !!blueStatus || !!redStatus || !!winnerSide)` and flip together. The winner side (which has neither score nor status) renders an invisible chip (`visibility: hidden`) so the gold-glow border and the inner-edge padding stay symmetric across both panels.

**Winner highlight + status chip resize.** The winning side now gets a gold inset border + glow shadow (`inset 0 0 0 6px #f5c518, 0 0 40px rgba(245, 197, 24, 0.7)`) when `winnerSide` matches. To make this visible, the wrapper's `overflow: hidden` was removed; per-side rounded corners (`14px 0 0 14px` on blue, `0 14px 14px 0` on red) replace the wrapper's mask. Status chip font size bumped from 24 → 38 to match the visual weight of the score chip on the opposite side. Inner-edge padding increases to 60px on result rows so the athlete name no longer crowds the VS circle.

**`/winner` broadcast carries per-side status.** The `PUT /:matchId/winner` endpoint in `server/routes/dual.js` now sets `blue.status` / `red.status` on the loser's side of the broadcast payload (winner side stays null). This mirrors the v1.17.01 paper-score path so the Overlay's `score_update` handler sees the loser's DNF/DNS/DSQ regardless of which path the match was finalized through. `Overlay.jsx` threads `dualState.winnerSide` into `OverlayDualVS` only when `scored`, so pre-score frames never falsely highlight a winner.

**HJ tablet — DNS/DNF button order swapped to Blue first.** `DualHeadJudgeView`'s 2×2 grid of status buttons reorders from `[Red DNS, Blue DNS, Red DNF, Blue DNF]` to `[Blue DNS, Red DNS, Blue DNF, Red DNF]`. Each button's `winnerId`, color theme, status message, and label move together so the underlying logic stays coherent — only the visual ordering changes (blue-side actions are now the left column, matching the bracket convention of blue on top/left).

**Files modified:** `client/src/components/public/OverlayDualVS.jsx`, `client/src/pages/Overlay.jsx`, `client/src/pages/HeadJudgeTablet.jsx`, `server/routes/dual.js`, `server/index.js`, `client/src/components/Layout.jsx`, `CLAUDE.md`

---

## v1.17.01 Feature Notes

### Dual Mogul Public Surface Polish (v1.17.01)

Three follow-up fixes to the v1.17.00 dual mogul surfaces (broadcast Overlay + live Scoreboard).

**Broadcast Overlay (`OverlayDualVS`) — bib chip, club line, score-on-outer-edge, DNF status.** Pre-result the central chip on each side now shows `#bib_number` (replacing the prior `–` score-placeholder dash). Club name moved to its own line below the athlete last name (no longer combined into a `#bib · club` line). When a result lands, the side panel layout flips so the score chip sits on the **outer** edge of each side panel (away from the VS button) and the text moves toward the VS center; small `#bib` text appears under the name to keep athlete identification visible. Scores render as whole numbers via `Math.round` (no `.0` decimal). When the loser's status is set (DNF/DNS/DSQ from Path A of paper-score), that side's chip displays the status text instead of the bib/score.

**Server (`server/routes/dual.js`) — full payload on every dual `score_update`.** The Path A (DNS/DNF/DSQ) broadcast previously sent only `{ winner }` — no blue/red blocks, no totals, no winner side. It now mirrors the scored-path payload: full blue+red blocks (with `name`, `bib`, `club`, `registrationId`, and per-side `status` for the loser) plus `blueTotal: null`, `redTotal: null`, `winnerSide`, `bracketRound`, `isSmallFinal`. All four dual `score_update` broadcast sites also gained an explicit `winnerSide: 'blue'|'red'` field, fixing a latent bug where `(d.blueTotal > d.redTotal) ? 'blue' : 'red'` returned `'red'` for any DNF (since `null > null` is false) and would incorrectly label red as winner when red DNF'd. The `GET /active-match` query and all 4 `score_update` JOINs now include `a.club` so club data flows end-to-end.

**Overlay client — winnerSide preference + per-side status threading.** `Overlay.jsx`'s `score_update` handler now prefers `d.winnerSide` from the server, with fallbacks via `d.winner.registrationId` match against blue/red, then total comparison. Captures `status` per side and threads `blueStatus` / `redStatus` props into `OverlayDualVS`.

**Live Scoreboard Match tab — most-recent-completed sort, DNF status, no decimals.** `recentCompleted` in `Scoreboard.jsx` now sorts by `updated_at` DESC (then bracket round/position as tie-break), so the Match tab actually shows the most recently scored match instead of the first one in bracket order. `DualMatchTab` derives `winnerSide` from `winner_registration_id` and computes `blueStatus`/`redStatus` from `loser_status`, then passes all three into `DualMatchCard`. `DualMatchCard` now: (a) prefers `winnerSide` over total comparison so DNF wins land the WINNER label on the right side; (b) renders judge cells and Total via a new `fmt0` (whole numbers); (c) when a side has `status` set, replaces the judge boxes + Total with a centered large `DNF`/`DNS`/`DSQ` block.

**Live Scoreboard Place tab — gated until event finalized.** `DualPlaceTab` now accepts an `isComplete` prop (`event.status === 'complete' || reviewStatus === 'approved'`) and renders a centered `PENDING EVENT RESULTS` placeholder card until the Head Judge finalizes the event. Existing rendering (with FFSP points, DSQ/DNS/SCR markers, and DNF tags) is unchanged once the event is final.

**Files modified:** `server/routes/dual.js`, `client/src/pages/Overlay.jsx`, `client/src/components/public/OverlayDualVS.jsx`, `client/src/components/public/DualMatchCard.jsx`, `client/src/pages/Scoreboard.jsx`, `server/index.js`, `client/src/components/Layout.jsx`, `CLAUDE.md`

---

## v1.17.00 Feature Notes

### Public Surfaces Redesign (v1.17.00)

Complete visual redesign of the four public-facing surfaces — Home, Live Scores, Scoreboard (mogul + dual), and Broadcast Overlay — to a modern athlete-card layout with a dark navy palette and red accent. Officials, admin, and tablet pages are visually unchanged. **Zero changes to scoring logic, server routes, database schema, WebSocket events, or API contracts.** The motivation is spectator UX: the prior `/scoreboard/<short>` was unreadable on iPhone portrait (8-column wide table), the broadcast overlay was dated, and public surfaces did not convey "live action" prominently.

**New token system (additive, public-only):** New CSS variables on a `[data-stickit-public="1"][data-theme="dark"|"sun"]` wrapper provide the new palette (`--bg #070d1a`, `--bg-panel #0e1628`, `--red #e63946`, `--blue #3b7dd8`, `--gold #f5c518`, etc.). Selectors are scoped — Officials/Admin/Tablet pages are not wrapped and inherit the existing Tailwind theme unchanged. New fonts (Inter Tight, Barlow Condensed, JetBrains Mono) load via Google Fonts CDN injected at runtime by `PublicLayout`. `tailwind.config.js` adds `font-inter-tight` and `font-barlow-condensed` family aliases (additive — `mountain`, `ice`, `display`, `body`, `mono` keys untouched).

**Sun Mode (high-contrast theme):** A toggleable `sun` theme provides high-contrast tokens for outdoor / bright-light viewing. State persisted in `localStorage.stickit.sunMode` and threaded via `PublicThemeContext`. Toggle button is a fixed-position sun/moon icon visible on every public page (Home, LiveScores, Scoreboard).

**New component library — `client/src/components/public/`:**
`PublicLayout.jsx` (theme wrapper + font/style injection + Sun Mode context + toggle), `LiveDot.jsx`, `StatusPill.jsx`, `RankChip.jsx` (gold/silver/bronze for top-3, neutral for others), `BibChip.jsx`, `DivisionFilter.jsx` (horizontal scroll pill row), `MeetPanel.jsx` (collapsible meet card), `EventRow.jsx`, `AthleteCard.jsx` (collapsed/expanded states), `DualMatchCard.jsx`, `OverlayRibbon.jsx`, `OverlayAthleteCard.jsx`, `OverlayScoreReveal.jsx`, `OverlayDualVS.jsx`, `OverlayStandings.jsx`.

**Home (`client/src/pages/Home.jsx`):** Atmospheric mountain background image at 0.18 opacity with mix-blend-mode screen, large logo with drop-shadow, "FREESTYLE SCORING" tagline at 0.3em letter-spacing, primary "Live Scores" CTA with `LiveDot` and red gradient + lift-on-hover, "LOGIN REQUIRED" divider, Officials/Admin SecondaryButton grid with original SVG icons, RMF footer + version. `fetch('/api/version')` behavior preserved.

**LiveScores (`client/src/pages/LiveScores.jsx`):** Sticky header with back-to-Home, title, and `<DivisionFilter>`. New `LiveStrip` component renders red-gradient cards for events with `status==='active'` across visible meets. Meets list uses `<MeetPanel>` cards. Same API: `GET /api/meets/livescores?page=&limit=10&division=`. Same DIVISIONS list.

**Scoreboard (`client/src/pages/Scoreboard.jsx`):** Full presentation rewrite, all data flows preserved verbatim. **All 11 API calls preserved** (`/events/:id`, `/results`, `/runs/active`, `/phases/results`, `/results/judge-scores`, `/runs/upcoming`, `/dual/active-match`, `/dual`, `/dual/{matchId}/judge-points`, `/dual/review-state`, PDF endpoints). **All WebSocket handlers preserved** (`dual_match_started`, `score_update` + isDual, `run_updated` + dualComplete, `dual_match_cleared`, `dual_bracket_review`, `dual_bracket_sent_back`, `event_finalized`, `run_started`). **5-second polling preserved**. `useResolveIds` short-code resolution preserved.

Mogul layout: athlete-card list. Collapsed card shows rank chip + bib + name + best total + 4-up component grid (Turns/Air/Time/Speed). Tap to expand → per-phase sections with per-judge breakdowns (TL, A1, A2 arrays from existing `/results/judge-scores` response shape). Multi-phase events (Best of 2, Qualifier/Finals) surface every phase in the expanded view with the winning run starred.

Dual mogul layout: three-tab strip **MATCH | BRACKET | PLACE** with **Match as the default**. When `dualState.activeMatch` is null, Match tab falls back to the most-recently-completed match (sorted by `bracket_round` then `bracket_position`) with a "MOST RECENT COMPLETED MATCH" label; if zero matches completed, shows a "WAITING FOR FIRST MATCH" placeholder pointing to the Bracket tab. Bracket tab is a tree view with consolation matches in the final column. Place tab is a ranked list with FFSP points (preserved from v1.16.19) and DNS/DSQ/SCR/DNF status indicators.

`UpcomingAthletes` re-skinned (v1.16.29 functionality preserved). DNS/DNF/DSQ status text in score column preserved (v1.16.11). Click-to-expand judge breakdown preserved. PDF download buttons preserved.

**Overlay (`client/src/pages/Overlay.jsx`):** Full visual rewrite using `OverlayRibbon`, `OverlayAthleteCard`, `OverlayScoreReveal`, `OverlayDualVS`. **Transparent canvas preserved** for OBS/YoloBox browser source — body/html background forced to transparent via `useLayoutEffect setProperty('background', 'transparent', 'important')`. **1920×1080 fixed canvas + viewport scaling preserved**. **All WebSocket event listeners preserved** (`run_started`, `score_update` single + dual, `dual_match_started`, `OVERLAY_HIDE`). **3-second polling fallback preserved** for hardware encoders.

Score reveal animation uses `cubic-bezier(0.34, 1.56, 0.64, 1)` overshoot per spec (480ms duration, 380ms delay after stat-block fade-ins). `OverlayScoreReveal` now exposes Turns/Air/Time/Speed components staggered (50/130/210/290ms fade-ins) — when those values are present in the `score_update` payload they render; otherwise the reveal degrades gracefully to total-only. Dual VS frame shows blue/red gradient sides with 5-judge points only revealed after scoring; a winner label (1ST/2ND for finals, 3RD/4TH for small final, WINNER for non-finals) appears after `scored=true`.

Hydration-on-mount preserves the existing single-mogul + dual rehydration flow (skip manually-entered runs; show most recent updated_at for last score).

The Overlay does NOT mount `PublicLayout` (which would set `body.background`, breaking transparency). Instead it injects only the CSS variables, fonts, and keyframes onto a scoped `.stickit-overlay-root` class, leaving body transparent.

**App routes & version strings:**
- `client/src/App.jsx` — public routes (`/`, `/livescores`, `/scoreboard/:eventId`, `/overlay/:eventId`) wrap themselves in `<PublicLayout>` (Overlay opts out of body-background mutation).
- `server/index.js` line 111 + line 194: `v1.16.32` → `v1.17.00`.
- `client/src/components/Layout.jsx` line 185: officials sidebar version bump.
- `tailwind.config.js`: added `inter-tight` + `barlow-condensed` font families.

**Out of scope (deferred to v1.17.01+):** iPad and laptop split-pane layouts, reveal animations beyond the score-reveal beat, PDF report restyling. Aerials scoreboard uses the same `AthleteCard` component as mogul (single-run; no per-phase expansion needed).

**Files created:** `client/src/components/public/PublicLayout.jsx`, `LiveDot.jsx`, `StatusPill.jsx`, `RankChip.jsx`, `BibChip.jsx`, `DivisionFilter.jsx`, `MeetPanel.jsx`, `EventRow.jsx`, `AthleteCard.jsx`, `DualMatchCard.jsx`, `OverlayRibbon.jsx`, `OverlayAthleteCard.jsx`, `OverlayScoreReveal.jsx`, `OverlayDualVS.jsx`, `OverlayStandings.jsx`
**Files modified:** `client/src/pages/Home.jsx`, `client/src/pages/LiveScores.jsx`, `client/src/pages/Scoreboard.jsx`, `client/src/pages/Overlay.jsx`, `client/src/App.jsx`, `client/tailwind.config.js`, `client/src/components/Layout.jsx`, `server/index.js`, `CLAUDE.md`

---

## v1.16.32 Feature Notes

### Cut-Line Tie Expansion — ICR 4207.3.4 Compliance (v1.16.32)

Brought the qualifier→finals cut application in `server/routes/phases.js` into compliance with FIS/USSS ICR 4207.3.4. v1.16.24 fixed the rank-assignment side (tied athletes now share an Olympic-style skip rank), but the phase-creation flow still applied each cut with positional `Array.slice(0, N)`, which arbitrarily dropped a tied athlete sitting on the boundary. Per the rule, when athletes tie at the unbreakable level (Total → Turns → Air-no-DD → Speed all equal), all tied athletes share a rank — and when that shared rank straddles a cut line, **all** of them must advance.

**Fix:** New helper `takeUpToRank(ranked, n)` in `server/scoring/engine.js` returns every athlete with `rank ≤ rank-of-Nth-athlete`. Five cut sites in `phases.js` (Q1→Q2 pass-through ID set, F1 pass-through, F1 fill from Q2, F1 from Q1-only, F2 from F1) now call this helper instead of slicing positionally. Each cut applies independently with its configured target size.

**Field-size implication:** When ties expand a cut, the resulting field can exceed the configured `final_size`. For example, a 16-athlete final with a two-way tie at rank 16 becomes a 17-athlete final. This is the rules-correct behavior. The phase-creation response's `eligible_count` reflects the expanded size naturally; no operator-visible banner is shown (silent expansion).

**No runtime changes needed.** The cut is materialized into `phase_run_order` at phase-creation time, and `/runs/next-up` strictly draws from it — fixing the slice sites is sufficient.

**Files modified:** `server/scoring/engine.js` (helper + export), `server/routes/phases.js` (5 cut sites, require), `server/scripts/verify_v16.js` (synthetic tests), `CLAUDE.md`

---

## v1.16.31 Feature Notes

### Bib Not Required for Run-Order / Seeding Build (v1.16.31)

The Run Order buttons (Random Order, By Age Groups, Lock Order, Save Order) and Dual Mogul seeding buttons are no longer gated on every athlete having a bib. This unblocks the workflow of generating a run order *first*, then assigning bibs by run order via the existing Assign Bibs modal.

**New row coloring:** athletes still missing other required fields (first name, last name, USSS#, birth year) keep their **red** row background (`bg-red-900/20`). Athletes complete except for a missing bib get a softer **yellow** row background (`bg-yellow-900/20`). Red wins when both bib and another field are missing.

**Warning copy:** the amber "missing required fields" warning above the run-order / seed-list section drops "or bib" from the field list — it now reads "(name, USSS#, or birth year)". The warning only appears when an athlete is incomplete on a non-bib required field.

**Files modified:** `client/src/pages/EventDetail.jsx` (mogul registration `isRegistrationIncomplete` line ~1175 + DualSeedingPanel `isRegIncomplete` line ~1882; row class at line ~1725)

### Admin → Athletes Database Management (v1.16.31)

New admin sub-page at `/admin/athletes` for managing the master athlete roster used during event setup. The Officials → Athletes table accumulates retired athletes, manually entered names, and CSV-imported one-offs over time; this page provides four bulk-cleanup operations.

**Soft-delete model.** Deletes from this page are *soft* — the athlete row is not removed from the database, only flagged via a new `athletes.deleted_at TEXT` column. Soft-deleted athletes are filtered out of the master list, search, registration pickers, and CSV reconcile/USSS-sync flows, but the row stays in place so existing registrations in past or current events continue to display the athlete name and any prior runs/scores. **Past events are never affected by a delete on this page.**

**Auto-restore.** If an athlete is soft-deleted and later re-added via *Add from USSS Database* (`POST /athletes/from-usss`) or re-imported via SkiReg CSV (`processCsvRows` in `registrations.js`), the existing row is restored (`UPDATE athletes SET deleted_at=NULL`) instead of creating a duplicate.

**Four bulk operations:**
1. **Reset Athlete List** — soft-delete every active athlete in the master database.
2. **Delete Selected Athletes** — checkbox table; bulk soft-delete the chosen rows.
3. **Delete by Division** — dropdown of distinct divisions present (with "(No Division)" bucket for NULL/blank); soft-delete all in the picked bucket.
4. **Delete Non-USSS Athletes** — soft-delete every athlete whose `ussa_num` is NULL/blank OR whose `ussa_num` does not appear as a `ussa_id` in `usss_people` (the imported USSS People File).

All four show a confirmation modal with the count and a sample of athletes before executing.

**Page layout:** status card (active total, division count, selected count) → bulk action toolbar (red Reset / red Delete Selected / dark Delete by Division / dark Delete Non-USSS) → search + division filter → checkbox table (Last, First, USSA #, FIS ID, Club, Division, YOB, Gen, USSS column showing ✓ when found in `usss_people`) → 100-per-page pagination. Built from the `AdminUSSSPeople.jsx` pattern.

**New endpoints (all under `/api/admin`, requires admin auth):**
- `GET /admin/athletes?q=&division=&page=&limit=` — paginated active-athlete list with `is_in_usss` flag.
- `GET /admin/athletes/divisions` — distinct non-null divisions + count for "(No Division)" bucket.
- `POST /admin/athletes/preview-delete` — body `{ mode, ids?, division? }` where mode ∈ `{reset, selected, by-division, non-usss}`. Returns `{ count, sample }` for the confirmation modal without writing.
- `POST /admin/athletes/delete` — same body; performs the soft-delete (`UPDATE athletes SET deleted_at=datetime('now')`). Returns `{ deleted }` count. Audit-logged as `athletes_bulk_deleted`.

**Existing routes filtered:** `server/routes/athletes.js` adds `WHERE deleted_at IS NULL` to the master listing/search query, the reconcile diff source list, and the USSS-sync source list. `GET /athletes/:id` is intentionally not filtered so registration JOINs still work.

**Sidebar:** new "Athletes" entry in Admin sidebar between "USSS People" and "Backups".

**Files modified:** `server/db/schema.js`, `server/routes/athletes.js`, `server/routes/admin.js`, `server/routes/registrations.js`, `client/src/pages/Admin.jsx`, `client/src/components/AdminLayout.jsx`
**Files created:** `client/src/pages/admin/AdminAthletes.jsx`

---

## v1.16.30 Feature Notes

### Dual Mogul — Manual Score Entry on Active Match (v1.16.30)

Adds a **Manual Score Entry** button to the "Currently Scoring" card on the dual mogul Scoring tab, alongside a restyled **End Match** button. Lets the scoring operator override an in-progress tablet-scored match and enter all 5 judges' scores manually (e.g., when a tablet is offline or scores are coming in over the radio).

**Layout:** Active match footer now renders the action buttons in a flex row on the right: red **End Match** (`bg-red-600`) on the left, blue **Manual Score Entry** (`bg-mountain-600`) on its right. Status text on the left side is unchanged.

**Click flow:**
1. Operator clicks Manual Score Entry → `POST /dual/manual-entry-start`. Server sets `events.dual_manual_entry=1` and broadcasts `dual_manual_entry_started`.
2. Server returns the match's existing partial `judgeScores` (whatever some tablets may have already submitted) so the modal pre-populates those rows.
3. Existing `DualPaperScoreModal` opens with the pre-populated values — operator can keep, edit, or replace.
4. **Submit** → existing `POST /:matchId/paper-score` endpoint finalizes the match and advances the bracket. Server clears `dual_manual_entry=0` and broadcasts `dual_manual_entry_cleared` at the end of paper-score success (both Path A status and Path B scored).
5. **Close (X)** → client calls `POST /dual/manual-entry-cancel`. Server clears flag and broadcasts cleared. Judges' tablets resume normal score entry.

**Judge tablet lockout:** New full-screen overlay on `JudgeTablet.jsx` `DualJudgeView` showing **"Manual Score Entry for This Round"** in amber when `manual_entry=1` and there's an active match. Render is gated identically to `eventCompleted` — replaces the score entry UI entirely so judges cannot submit. State is populated both via the existing 3s `/dual/active-match` poll (now returns `manual_entry: 0|1`) and via two new WS messages: `dual_manual_entry_started` / `dual_manual_entry_cleared`.

**Auto-cleanup:** `DELETE /active-match` (End Match) also clears `dual_manual_entry` and broadcasts cleared, so clicking End Match while the modal happens to be open doesn't strand the lock state. The `paper-score` success path clears the flag whether the match finalized through scored-path or DNS/DNF/DSQ-path.

**Database:** New `events.dual_manual_entry INTEGER NOT NULL DEFAULT 0` column. Standard mogul, aerials, and bracket-keeper PDF flow are unchanged — dual-mogul-only.

**Files modified:** `server/db/schema.js`, `server/routes/dual.js`, `client/src/pages/EventDetail.jsx`, `client/src/pages/JudgeTablet.jsx`

---

## v1.16.29 Feature Notes

### Live Scoreboard — Upcoming Athletes Box (v1.16.29)

The live scoreboard at `/scoreboard/<short>` now shows an **Upcoming Athletes** card directly below the rank table for individual mogul and aerials events. The card lists the remaining queue for the current run/phase, ordered by run order. As soon as an athlete's run starts (status flips to `'scoring'`) they leave the upcoming card and appear in the **Now Competing** banner; once finalized they appear in the rank table.

**Header text** reflects the active phase: `Run 1 — Up Next`, `Run 2 — Up Next`, `Qualifier 1 — Up Next`, `Qualifier 2 — Up Next`, `Final 1 — Up Next`, `Final 2 — Up Next`. For single-run events without phases, the header reads `Run 1 — Up Next`.

**Columns:** Order | Bib | Name (e.g., `Doe, John`). The visual treatment is intentionally muted vs. the rank table — `bg-gray-900/50` card, `bg-gray-800/40`/`/60` headers, `opacity-70` body rows, dimmer gray text — so it reads as secondary information.

**Scope:** standard mogul, best-of-2 mogul, qualifier/finals mogul, and aerials. Dual mogul (bracket-driven, no run order) is unchanged.

**New endpoint — `GET /api/events/:eventId/runs/upcoming?run_number=N`:** returns `{ run_number, phase_label, athletes: [{ id, bib_number, run_order, first_name, last_name }, ...] }` ordered by `run_order ASC`. Mirrors the phase-resolution logic of `/runs/next-up` (active phase → first not-started → fall-through to legacy `registrations.run_order`) but drops the `LIMIT 1`. Returns `{ run_number: null, phase_label: null, athletes: [] }` when the event is complete (all phases finalized or `events.status='complete'`). The existing `NOT IN (SELECT registration_id FROM runs WHERE run_number = ?)` filter naturally excludes the currently-scoring athlete (their run row exists with `status='scoring'`).

**Reactivity:** the upcoming fetch is added to the existing `Promise.all` in `loadResults()`. All existing WebSocket handlers (`score_update`, `run_started`, `run_updated`) and the 5-second polling already call `loadResults()`, so the card refreshes automatically with no new listener wiring.

**Files modified:** `server/routes/runs.js`, `client/src/utils/api.js`, `client/src/pages/Scoreboard.jsx`

---

## v1.16.28 Feature Notes

### Compact Bracket — Vertical-Aligned Bold Place Labels (v1.16.28)

Refinement to the v1.16.27 final-place medal annotations on the compact dual mogul bracket PDF. Previously the place text (`1st`, `2nd`, etc.) was centered in the visual gap between the rendered athlete name and the score column, so its x-position varied row-by-row depending on name length — producing a ragged appearance when both rows of the same match had different name lengths.

**Fix:** Place text now renders at a fixed offset from the right edge of the match box, right-aligned, so all final-place labels in the same column line up vertically regardless of name length. Font also bumped from 6pt to 7pt and remains bold (Helvetica-Bold) for readability.

Implementation in `drawAthleteRow` (`server/routes/pdf.js`):
- New row reservations when `place` is provided: `placeW = 22`, `placeGap = 8`, `scoreRsv = 45` (locked to the wide score reserve regardless of DNF/DNS narrow status width).
- Name column width reduced by `placeGap + placeW` so the place label has guaranteed clear space.
- Place label x = `x + w - 45 - placeGap - placeW` (≈ `x + w - 75`), drawn with `align: 'right'`, `lineBreak: false`, `fontSize: 7`, bold.

DNF/DNS rows (which use `scoreW = 22`) now share the same place-label x as scored rows, since `scoreRsv` is forced to the maximum (45) when a place label is present. Non-finals matches receive no `place` argument and are unaffected — `placeW`/`placeGap` default to 0 so name width and rendering are identical to pre-v1.16.27.

**Files modified:** `server/routes/pdf.js`

---

## v1.16.27 Feature Notes

### Compact Bracket — Right-Column Consolation + Final Place Medals (v1.16.27)

Two refinements to the compact dual mogul bracket PDF (`POST /api/pdf/dual-bracket`, helper `renderCompactBracketPages` in `server/routes/pdf.js`).

**1. Consolation moved into the right column.** Consolation matches no longer span the full page width below the main tree. They now stack tight directly below the Championship Final box, matching the Final's x and width (`colW - 16`), in order Final → 3rd/4th → 5/6 → 7/8 (when `runoff_to_8th`). The horizontal rule and the standalone "Consolation" header are dropped; per-match place labels ("3rd / 4th Place" etc.) remain centered above each consolation box.

Implementation: `mainH` no longer reserves 35% for full-width consolation (uses full `BKH`). After `drawBracketSection`, `pos[finalRound]?.[1]` gives the Championship Final position; consolation x/y/width are derived from it. Stack constants: `firstGap=14`, `interGap=8`, `labelH=10`. Split-halves pages are unaffected (`hasConsol: false` on those).

**2. Final-place medal annotations on finals matches.** The compact bracket now renders ordinal place labels (`1st`, `2nd`, `3rd`, `4th`, and `5th`–`8th` when `runoff_to_8th`) on the athlete rows of finals-stage matches, centered in the visual gap between the rendered athlete name and the score breakdown.

- **Scope:** Championship Final (1st/2nd) and the 3rd/4th match always. With `runoff_to_8th` only, also 5/6 and 7/8.
- **Visibility:** Only when the match is `status='complete'` and has a winner. Pending/incomplete matches show no place text.
- **Colors:** Gold `#d4af37` (1st), silver `#a8a8a8` (2nd), bronze `#b8732e` (3rd), gray `#64748b` (4th–8th). Bold Helvetica, fontSize 6.
- **Position:** Centered in the gap between `nameX + widthOfString(name)` and `scoreStartX = x + w - scoreW - 3`. Width 26pt. Falls through correctly for DNF/DNS/DSQ losers (where `scoreW=22`).

Implementation:
- `drawAthleteRow(...)` accepts a new trailing `place` param and renders the medal text after the score/loserStatus.
- `drawMatch(m, x, y, w, opts={})` accepts `{ bluePlace, redPlace }` and threads them through the redOnTop swap before passing to each row.
- `drawBracketSection` passes `m._places || {}` as the new opts arg to `drawMatchFn`.
- `renderCompactBracketPages` annotates the Championship Final via `finalMatch._places` (so `drawBracketSection` picks it up) and computes per-side opts inside the existing `consolMatches.forEach`. `runoffOption` is threaded through the `layout` parameter.

Quarterfinal, semifinal, and qualifier rounds receive no opts and render exactly as before. The `bracket-keeper` PDF route is unchanged (different code path; ignores the harmless extra arg passed by the shared `drawBracketSection` helper).

**Files modified:** `server/routes/pdf.js`

---

## v1.16.26 Feature Notes

### Compact Dual Mogul Bracket PDF (v1.16.26)

Redesigned the dual mogul bracket PDF (`POST /api/pdf/dual-bracket`) to fit horizontally as a tree, like the Scoreboard's live Bracket tab, instead of stacking matches in a single column with empty white space. Page count now scales by bracket size:

- **16 athletes** → 1 page (R16 → QF → SF → Final, plus consolation block)
- **32 athletes** → 2 pages (R32 → R16 / QF → SF → Final + consolation)
- **64 athletes** → 3 pages (R64 split into two side-by-side halves / R32 → R16 / QF → SF → Final + consolation)

Component-score split (`2+5+0+4+0=11`) still rendered per row. Consolation matches (3rd/4th, optional 5/6 + 7/8 with `runoff_to_8th`) live on the finals page below the main tree.

**New helper — `renderCompactBracketPages(doc, bk, drawHeaderFn, drawMatchFn, colors, layout)`** in `server/routes/pdf.js`. Reuses the existing `parseBracketData`, `buildBracketPositions`, `drawBracketSection`, and `BRACKET_SQL` helpers — only the page-level layout changes. The `bracket-keeper` route still uses the original `renderBracketPages` (untouched).

**Compact match dimensions:** ROW_H 19→11, BAR_W 5→4, font sizes 8/6.5/7 → 7/5.5/6, bibW 22→18, scoreW 55→45. Pairing label moved from inside the top-right of the box to just above the box (no longer collides with the per-row score). The 64-athlete page-1 split places 16 R64 matches in each of two side-by-side columns with no inter-half connectors.

**Subtitles** are derived from the rounds shown on each page: `Complete Bracket` (single-page case), `Round of 32 → Round of 16`, `Quarterfinals → Final`, `Round of 64`, etc.

**Files modified:** `server/routes/pdf.js`

---

## v1.16.25 Feature Notes

### Meet Export Content-Type Fix — Safari Auto-Extract (v1.16.25)

Fixed Safari auto-extracting downloaded meet export ZIP files on macOS. Symptom: downloads from the Railway-hosted server in Safari arrived as either an extracted folder (`StickIt_AllMeets_YYYYMMDD/` containing `manifest.json` + child meet zips) or a bare `meet_export.json` file (single-meet export's inner contents), instead of the intended `.zip`. Local Chrome/Firefox downloads were unaffected.

**Root cause:** Safari's "Open 'safe' files after downloading" preference (enabled by default on macOS) runs Archive Utility on any download whose `Content-Type` is `application/zip`. The single-meet zip contains exactly one entry (`meet_export.json`), so post-extraction the user sees only that JSON file. The multi-meet zip extracts to a folder containing `manifest.json` + child zips. The actual response on the wire was always a valid ZIP — Safari was unpacking it client-side before the user saw it.

**Fix:** Both export endpoints now send `Content-Type: application/octet-stream` instead of `application/zip`. Safari treats octet-stream as a generic binary blob and skips the auto-extract heuristic. The `Content-Disposition` filename retains the `.zip` extension, so the file saves correctly and double-clicking still extracts it normally via Archive Utility.

**Files modified:** `server/routes/meets.js` (`GET /:id/export`, `GET /export-all`)

## v1.16.24 Feature Notes

### Tied-Rank Compliance (ICR 4207.3.4) + FIS-Compliant Best-Run Selection (v1.16.24)

Two correctness fixes in result-assembly paths.

**#7 — Tied athletes now share a rank (Olympic-style skip).** Previously, in qualifier/finals tiered events, after `rankResults()` correctly produced tied ranks, every assembly path overwrote them with `globalRank++`, splitting tied athletes into sequential ranks (e.g., 4, 5 instead of 4, 4). Per ICR 4207.3.4, when athletes tie at the unbreakable level (Total → Turns → Air-no-DD → Speed all equal), they share a rank and the next rank skips by the size of the tied group.

**#8 — Best-run selection now applies the FIS tie-break.** Previously, when an athlete's two runs had equal total scores, the inline `r.total_score > best[id].total_score` loops kept whichever run was iterated first (arbitrary). The selected run could place the athlete worse against the field. Now uses `tieBreakMogul()`/`tieBreakAerials()` to pick the FIS-stronger run.

**New helpers — `server/scoring/engine.js`:**
- `pickBestRun(runs, discipline, keyFn = r => r.registration_id)` — picks the best run per key using the discipline's FIS-compliant comparator. The `keyFn` parameter handles `dual.js`'s `computeOfficialPlacings` which keys by `athlete_id`.
- `applyTierRanks(athletes, discipline, startRank)` — applies Olympic-style skip ranking to a tier already ordered by tie-break, starting from `startRank`. Returns `startRank + athletes.length` so callers can chain tiers (Final 2 → Final 1 → Qualifiers).

**Defensive assertion — `server/dual/placement.js`:** End of `buildPlacement()` now asserts that every real seed (1..R) appears exactly once in the order array. Belt-and-suspenders against a future regression in `applyBandRandomization`.

**Replaced inline best-run loops:** `server/routes/results.js` (qualifier_finals + bestScoreResults + legacy non-phased), `server/routes/phases.js` (best-of-2 + qualifier_finals tiers), `server/routes/export.js` (~7 sites + 3 tier sites), `server/routes/pdf.js` (~4 sites + 3 tier sites), `server/routes/print.js`, `server/routes/dual.js` (`computeOfficialPlacings`).

**Verification:** `node server/scripts/verify_v16.js` continues to pass 24/24. Defensive assertion verified against synthetic corrupt orders (duplicate seed and missing seed both throw; valid order passes through).

**Files modified:** `server/scoring/engine.js`, `server/dual/placement.js`, `server/routes/results.js`, `server/routes/phases.js`, `server/routes/export.js`, `server/routes/pdf.js`, `server/routes/print.js`, `server/routes/dual.js`

---

## v1.16.23 Feature Notes

### Mogul Tie-Break Compliance — FIS ICR 4207.3 (v1.16.23)

Brought the mogul tie-break procedure into compliance with FIS ICR 4207.3 (also the rule USSS follows). Previous order was Total → Air (post-DD) → Turns → Speed; the FIS rule is Total → Turns → Air WITHOUT Degree of Difficulty (raw execution) → Speed. Two problems with the old code: Turns and Air were swapped, and the air comparison used the post-DD value instead of the pre-DD raw execution score.

**New column — `runs.air_score_no_dd REAL`:** Stores the pre-DD raw air execution score, defined as `avg(judges per jump 1) + avg(judges per jump 2)`, floored to 2 decimal places. No 20-point cap (the FIS rule isolates execution quality). Existing `runs.air_score` (post-DD) is unchanged. Single-jump events double the one jump's average so the value is comparable to two-jump runs.

**Backfill on startup:** `server/db/schema.js` calls `backfillAirScoreNoDd()` after `seedAerialsDDs()`. For every completed mogul run with `air_score_no_dd IS NULL`, computes the value from `judge_scores` (rows where `score_type IN ('air_jump1','air_jump2')`). Runs with no per-judge data (manually entered legacy runs) get `air_score_no_dd = air_score` as a non-strict fallback so they still rank sensibly.

**Engine — `server/scoring/engine.js`:**
- `calcMogulScore()` now returns a new `airNoDd` field alongside the existing `airContrib` (post-DD).
- New `tieBreakMogul(a, b)` implements the FIS order with `Math.abs(... - ...) > 0.001` epsilon comparison.
- New `tieBreakAerials(a, b)` retains the legacy order (Total → Air post-DD → Turns → Speed) — aerials is explicitly out of scope this release.
- `rankResults(results, discipline)` now accepts a discipline parameter and dispatches: `'aerials'` → `tieBreakAerials`, anything else (including no arg) → `tieBreakMogul`. Default = mogul so all existing call sites get the corrected order.
- `tieBreak` kept as a backwards-compatible alias for `tieBreakMogul`.

**Persisted in every write path — `server/routes/runs.js`:** Finalize (tablet path), manual entry, edit-score, paper-score, and re-finalize after code-clear all write `air_score_no_dd` for mogul runs. Aerials runs leave the column NULL by design — aerials uses its own tie-break that doesn't reference it.

**Discipline passed to all `rankResults` call sites:** `server/routes/results.js`, `server/routes/phases.js`, `server/routes/pdf.js`, `server/routes/export.js`, `server/routes/print.js`, `server/routes/meets.js` (close-and-export), `server/routes/transmit.js` (USSS XML). `server/routes/dual.js` `computeOfficialPlacings()` explicitly passes `'mogul'` since it ranks the source mogul event used for dual seeding.

**Manual Score Modal:** No new UI field. The existing modal already collects per-judge raw air arrays (`a1Arr`, `a2Arr`); the engine now derives `airNoDd` from those arrays automatically, so the modal needs no change to opt into FIS-strict tie-breaking.

**Out of scope (explicit):** Aerials tie-break order is unchanged this release. Dual moguls use a separate placement algorithm (`server/dual/placement.js`) and are not affected. Historical totals (`runs.total_score`) are not recomputed — only the new column is backfilled.

**Files modified:** `server/scoring/engine.js`, `server/db/schema.js`, `server/routes/runs.js`, `server/routes/results.js`, `server/routes/phases.js`, `server/routes/pdf.js`, `server/routes/export.js`, `server/routes/print.js`, `server/routes/meets.js`, `server/routes/transmit.js`, `server/routes/dual.js`

---

## v1.16.22 Feature Notes

### Backups Admin Page (v1.16.22)

New admin sub-page at `/admin/backups` for viewing and downloading the rolling SQLite backups created automatically by `server/db/autosave.js` (every 5 writes, last 10 kept). Read-only — restore is a manual file-swap on the server.

**Status card:** Backup count (current / max), total disk used, newest/oldest timestamps with relative ago labels, write counter, backup interval.

**Manual backup trigger:** "Create Backup Now" button calls `POST /api/admin/backups/create` to invoke `doBackup()` directly outside the every-5-writes cycle. Useful before risky operations.

**Backups table:** Filename (monospace), Created (timestamp + relative ago), Size, Download. Newest first. Each Download link streams the `.db` file with `Content-Disposition: attachment`.

**Recovery instructions:** Static amber callout on the page documents the restore procedure (stop server → replace `data/scoring.db` → restart) and notes the Railway caveat (volume access required).

**New endpoints:**
- `GET  /api/admin/backups` — `{ backups, stats }` reusing `listBackups()`
- `POST /api/admin/backups/create` — manual backup trigger
- `GET  /api/admin/backups/:filename/download` — streams the `.db` file. Filename is regex-validated (`^scoring_[\w-]+\.db$`) to prevent path traversal.

**autosave.js changes:** `doBackup`, `BACKUP_DIR`, `BACKUP_INTERVAL`, `MAX_BACKUPS` are now exported.

**Sidebar:** New "Backups" entry in Admin sidebar between "USSS People" and "Audit Log".

**Files modified:** `server/db/autosave.js`, `server/routes/admin.js`, `client/src/pages/Admin.jsx`, `client/src/components/AdminLayout.jsx`
**Files created:** `client/src/pages/admin/AdminBackups.jsx`

### Multi-Meet Export / Selective Import (v1.16.22)

New "Export All" button on the Dashboard exports every currently-visible meet (matches Dashboard's `excludeLocked=1` rule — fully-locked meets are excluded). The output is a **zip-of-zips** with a top-level `manifest.json` listing the meets. Each child zip is byte-identical to the existing per-meet export, so the same export logic is reused.

**Bundle format:**
```
StickIt_AllMeets_YYYYMMDD.zip
├── manifest.json   { stickit_version, export_date, meet_count, meets: [{ filename, meet_id, name, location, date, meet_ranking }] }
├── meet_<uuid>.zip   (existing per-meet export)
└── ...
```

**New endpoint:** `GET /api/meets/export-all` — registered before `/:id` so Express doesn't treat "export-all" as a meet ID. Iterates visible meets and calls the new shared helper `buildMeetExportZip(meetId)` (extracted from the existing `GET /:id/export` body).

**Import detection:** `POST /api/meets/import` now checks for `manifest.json` at the root of an uploaded ZIP. If present and well-formed, the server splits each child zip into its own pending-import cache entry, pre-computes conflict status per child, and returns `{ multi_meet: true, meet_count, meets: [...] }` instead of the single-meet conflict response.

**New conflict_action `import`:** Used for non-conflict pending entries created by the multi-meet flow. Runs `executeImport()` with no rename/merge/delete — same as the no-conflict step-1 path.

**Client modal — `MultiMeetImportModal.jsx`:** Three phases:
1. **Selecting:** Checkbox list with Select All / Deselect All. Conflict rows tagged with an amber "Already exists" badge. Shows location and date.
2. **Importing:** Progress bar ("X of N complete · Now: <name>"). When a conflict is reached, the existing `ImportConflictModal` is overlaid for that single meet. User picks Merge / Duplicate / Overwrite / Cancel; the loop resumes after the choice. Sequential — one meet at a time per user's request.
3. **Done:** Summary table listing each meet's outcome (action label or error). "Done" button refreshes the Dashboard meet list.

**Cancellation cleanup:** Cancel button (and modal unmount during selection) calls `conflict_action=cancel` on every pending entry to free server-side cached zips. Unselected meets are also cancelled before the import loop starts.

**Existing single-meet import flow unchanged.** The legacy `meet_export.json`-only ZIP and raw JSON paths continue to work.

**Files modified:** `server/routes/meets.js` (extracted `buildMeetExportZip`, added `GET /export-all`, extended `POST /import` with manifest detection + `conflict_action='import'`), `client/src/pages/Dashboard.jsx`
**Files created:** `client/src/components/MultiMeetImportModal.jsx`

---

## v1.16.21 Feature Notes

### Static Asset Cache-Control Headers (v1.16.21)

Fixed iPad/iOS Safari serving stale builds after a deploy. Symptom: iPad showed an old version (e.g. v1.16.07) while a laptop on the same URL showed the current version, because Safari was holding onto the previously-fetched `index.html` and re-using its old hashed bundle reference.

**Root cause:** `server/index.js` mounted `express.static()` and the SPA fallback `app.get('*', ...)` with no `Cache-Control` headers. iOS Safari aggressively caches HTML in the absence of explicit cache directives, so it never refetched `index.html` to learn the new bundle hash.

**Fix:** `server/index.js` now sends:
- `Cache-Control: no-cache, no-store, must-revalidate` for `index.html` (both via the static middleware and the SPA fallback)
- `Cache-Control: public, max-age=31536000, immutable` for files under `/assets/` (Vite content-hashed bundles — safe to cache forever since the hash changes on every code change)

After this release, deploys propagate to iPads automatically without needing to clear Safari website data.

**Note:** The currently-affected iPad still needs a one-time cache clear (Settings → Safari → Clear History and Website Data) to pick up v1.16.21, since it's still holding the pre-fix `index.html`. From v1.16.21 onward, this won't recur.

**Files modified:** `server/index.js`

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

> **Older version notes (v1.7.00 – v1.15.02):** See [CHANGELOG.md](CHANGELOG.md)

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
