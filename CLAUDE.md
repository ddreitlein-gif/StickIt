# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**StickIt** is a full-stack freestyle mogul scoring application for managing ski/snowboard competitions (moguls, dual moguls, aerials) for US Ski & Snowboard (USSS) events.

**Current version:** v2.8.04

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

### Deployment (as of v1.30.01, 2026-07-19)

Two cloud hosts, **both auto-deploy from every push to `main`** on `ddreitlein-gif/StickIt`
(GitHub integration on each platform — no manual deploy commands):

| Host | URL | Role |
|---|---|---|
| **Render** | https://stickit-tga4.onrender.com | **Primary** (persistent disk; ~60s deploy) |
| Railway | https://mogul-scoring-production.up.railway.app | Legacy, kept in sync for now |

Both build against `server/` only (service root directory = `/server`), so the client must be
built locally and its output committed into `server/public/` (see Build & Package below).
Historical feature notes below reference "Railway" as the host — that was accurate at the time;
Render became primary in July 2026. After pushing, verify with
`curl -s <host>/api/version` on both hosts.

### Build & Package (Release Zip)

If any help topic (`client/src/help/topics/*.md`), `topicsIndex.js`, or guide script changed,
regenerate the printable PDF guides first (requires `client/` — run locally, never on the deploy
hosts) and commit the regenerated PDFs in `server/public/docs/guides/`:

```bash
node server/scripts/build_guide_pdfs.js
```

After building, copy client assets to server:

```bash
cd client && npm run build
cp client/dist/index.html server/public/index.html
# v2: clear ALL stale hashed assets (index bundles AND the self-hosted font
# files added by FR-18 — an index-* rm alone strands superseded font hashes)
rm -f server/public/assets/*
cp client/dist/assets/* server/public/assets/
cp client/dist/privacy.html server/public/privacy.html   # static privacy policy (from client/public/, v1.30.01)
cp client/dist/support.html server/public/support.html   # static support page (from client/public/, v1.30.03)
# Note: logo.png in server/public/ is read-only — use targeted copy, not cp -r dist/* server/public/
# If cp/rm hit "Operation not permitted" (macOS), do the same copies via node fs (copyFileSync) — that works.
```

Then create the zip directly from the `StickIt/` parent (never use a staging folder):

```bash
cd /Users/daviddreitlein/Desktop/StickIt
zip -r "/tmp/StickIt_X_X_XX.zip" server/ client/ CLAUDE.md \
  --exclude "*/node_modules/*" "*/.claude/*" "*/data/*" "client/dist/*" "harness/*" "* [0-9].*" "*/.work/*"

# Why each exclusion:
#   */node_modules/*  → installed deps (~100MB)
#   */.claude/*       → Claude Code worktrees + chat artifacts (can balloon zip to 15M+)
#   */data/*          → runtime DB + uploaded logos + backups (production has its own)
#   client/dist/*     → Vite build intermediate (final assets already in server/public/assets)
#   harness/*         → v2 simulation test harness (R16) — dev-Mac only, never deployed
#   "* [0-9].*"       → macOS/iCloud duplicate copies ("index-abc 3.css", "foo 2.woff2") that
#                       appear untracked in server/public/assets + client/dist (gitignored via
#                       the same pattern, but zip would sweep them in — v2.3.00 hit 9.2MB)
#   */.work/*         → the Pi image build's scratch tree (server/scripts/build_pi_image/.work:
#                       pi-gen checkout + the ~560MB .img.xz). Gitignored, but zip swept it in —
#                       v2.5.00's first zip came out at 550MB before this exclusion was added

# Verify root contents — must ONLY show server, client, CLAUDE.md
unzip -l /tmp/StickIt_X_X_XX.zip | awk '{print $4}' | awk -F'/' '{print $1}' | sort -u
# Verify size — ~5.5MB as of v2.3.00 (~4MB self-hosted fonts [FR-18] + ~0.6MB guide
# PDFs). If it's >7MB, an exclusion is missing (first suspect: the "* [0-9].*" dupes). (Pre-v2 builds were ~3MB.)
ls -lh /tmp/StickIt_X_X_XX.zip

# Deliver
cp "/tmp/StickIt_X_X_XX.zip" "/Users/daviddreitlein/Desktop/Scoring Server/Scoring Zip Files/"
rm /tmp/StickIt_X_X_XX.zip
```

**Zip naming:** `StickIt_X_X_XX.zip` — version number only, no date suffix (e.g. `StickIt_1_7_00.zip`).

Zip destination: `/Users/daviddreitlein/Desktop/Scoring Server/Scoring Zip Files/`

### Version String

Single source of truth: `server/version.js` (exports `{ VERSION }`, since v1.22.00). Every server-side reference (`/api/version`, startup log, admin endpoints, export version strings) reads from it. The Officials sidebar (`client/src/components/Layout.jsx`, ~line 85) fetches `/api/version` on mount; its `useState('v1.XX.XX')` default is cosmetic-only but is bumped on release for tidiness. The About modal reads from `/api/version` automatically.

Bump procedure per release: `server/version.js`, the Layout.jsx useState default, and both `package.json` versions (`client/` + `server/`, kept in sync with the app version).

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
- Judge / Head Judge / Timekeeper / Aerials judge tablets and all their scoring endpoints — secured only by unguessable short-code URLs. Auth work must never lock these out mid-meet. **Enforced end-to-end as of v1.26.02** — every endpoint a tablet calls with a plain fetch is public (see v1.26.02 notes for the full list, incl. `finalize`, `return-to-scoring`, `PUT /runs/:runId`, HJ reject paths, and the dual HJ match flow). **When adding a tablet button, never wire it to a `requireAuth` endpoint** — that bug shipped in v1.25.00 and was fixed in v1.26.02.
- Public pages: Home (`/`), Live Scores, Scoreboard, Overlay, Help, and the read-only Viewer API (`/api/viewer`).
- PDF endpoints reachable from the public Scoreboard: `event-results-detailed`, `dual-bracket`, `dual-results`, plus `GET /api/pdf/logo/:meetId`, `GET /api/pdf/bottom-logo/:meetId` (status flags) and, since v2.6.00, the logo files themselves for the public Broadcast Board: `GET /api/pdf/logo/:meetId/image` and `GET /api/pdf/bottom-logo/:meetId/image`.
- The Broadcast Board (`/broadcast/:eventId`, v2.6.00) is a public page like the Scoreboard and Overlay: plain fetches of the public event / results / runs / dual / phases endpoints and the public `GET /api/meets/:id` + `GET /api/meets/:meetId/events/:id` reads; it never writes. Every other PDF endpoint requires auth (policy comment at the top of `server/routes/pdf.js`).
- `/api/jump-dds`, `/api/resolve`, `/api/version`, `/api/auth/status` and login.

**Protected when auth is enabled:** all Officials mutations (meets, events, registrations, runs manual entry, dual seeding/paper score, phases, exports, USSS transmit, imports, audit, training days, PDFs not listed above) and the entire `/api/admin` panel (system_admin role). Client downloads can't carry an Authorization header in a plain anchor — use `downloadAuthed()` from `client/src/utils/api.js`.

**Roles (single source of truth `server/auth/roles.js`, mirrored in `client/src/auth/RequireAuth.jsx`; two roles since v2.7.02):** official (2, labelled **Judge / Official** — the full Officials section, no `/admin`) < system_admin (3, everything). Legacy values are aliases in `ROLE_RANK` only and are migrated at boot: `judge` (the pre-v2.7.02 login-only role restricted to the Links area) → official; `event_admin` → system_admin. Neither is creatable (`VALID_ROLES`). Changing a role is a one-column edit: password hash, `must_change_password` and sessions (JWT `sub` = user id) are untouched; the server re-reads the role per request, so a demoted session loses `/admin` at once.

---

## Version Notes

**Full per-release feature notes live in [CHANGELOG.md](CHANGELOG.md)** (newest first, v2.8.04 back
to v1.7.00). The v2.0.00 – v2.7.01 notes were moved there verbatim on 2026-10-28 to keep this file
under the CLAUDE.md size limit; nothing was dropped or condensed. **When a release ships, add its
full `## vX.Y.ZZ Feature Notes` section at the TOP of CHANGELOG.md** (above the previous release)
and one line to the index below — do not add feature-note sections to this file.

### Release index (v2)

| Version | Date | Headline |
|---|---|---|
| v2.8.04 | 2026-11-23 | DD table to the FIS chart As of 07.11.26 (Release B of the 11-23-26 plan) — boot migration in `seedJumpDDs()`: bF / fF 0.90 / 1.00, bdF 1.09 / 1.19, btF 1.28 / 1.38, new fdF and ftF (mogul + dual x 1.25; aerials untouched; gated on bF = 0.88 and a missing fdF); grab values g +0.05 / G +0.12 confirmed, no longer provisional; voice phrases for the twisting flips; there is NO DD editor (Jump DDs is read-only); stored run DDs unchanged; protocol stays 3 |
| v2.8.03 | 2026-11-23 | Pre-season tablet changes (Release A of the 11-23-26 plan) — dual judge tablet: select a split, then **Confirm** (two steps; stale selections dropped on match / scale change), running Blue / Red totals hidden from judges, Time Judge time differential card (JH 6304.3.4), two-column landscape layout with no scrolling on an iPad Air 3; HJ tablet (moguls) lists T&L 1–3 / Air 1–2 in judge order; client only (`JudgeTablet.jsx`, `HeadJudgeTablet.jsx`, `index.css`) |
| v2.8.02 | 2026-11-21 | Judge tablet shows the rejected score — the red "Your score was rejected" box on the mogul T&L / Air judge tablet lists the score the HJ rejected (T&L total + breakdown; Air jump code + score) until resubmit; client only (`JudgeTablet.jsx`), dual and aerials untouched |
| v2.8.01 | 2026-11-16 | PDF Reports tab fixes — Run Order report prints in run order by default (own Order control; Registration sort only affects the Registration Listing); Run Order / Time Sheet / check sheets print the order of the run SELECTED (`resolvePrintOrder` in `pdf.js`: Run 1 and Run 2 both printable at any time); Time Sheet labels the selected run; "Final Results" prints no run number on list reports |
| v2.8.00 | 2026-10-28 | Skip athlete — Skip button beside Start Run / DNS on every start surface (HJ + Timekeeper tablets, Scoring tab, dual); N spots down for THIS run only via the venue-local `run_order_skips` table (stored order never edited, protocol still 3); dual pairings stay in their round (later-block start 409); Restore spot on the Scoring tab |
| v2.7.02 | 2026-10-28 | Two login roles — Judge / Official (= `official`) and System Admin; legacy `judge` rows migrated to official at boot; judge-only sidebar / Links-tab limits removed |
| v2.7.01 | 2026-09-26 | Query indexes — Turso rows-read fix (12 plain indexes; row-order audit; golden compare vs v2.7.00) |
| v2.7.00 | 2026-09-19 | Unified registration import — SkiReg / RMF-Winfree / XLSX, `events.import_code`, `meet_import_map`, People File lookup |
| v2.6.03 | 2026-09-15 | Bracket Keeper — Won/Lost labels below the open line, 32 pt pitch |
| v2.6.02 | 2026-09-15 | Bracket Keeper as a plain Winfree-style line tree (replaces v2.6.01) |
| v2.6.01 | 2026-09-15 | Bracket Keeper box redesign — WITHDRAWN same day; `buildBracketPositions` fix + `advancementSlot`/`consolationSlot` exports survive |
| v2.6.00 | 2026-09-14 | Broadcast Board `/broadcast/:eventId` (public 1920x1080 results board); public logo-image endpoints |
| v2.5.07 | 2026-09-14 | Dual bracket courses per 4310.3.1, mirrored 5–8 consolation, `round_name`, finals/consolation labels everywhere |
| v2.5.06 | 2026-09-08 | Dual round notation + End-of-Round notice on judge/HJ tablets; 2026-27 rules-compliance doc fixes; Pi image v2.5.06 published |
| v2.5.05 | 2026-09-07 | Hotfix: 8 s deadline on the venue update-check GitHub fetch |
| v2.5.04 | 2026-09-07 | Dual run order follows pairing numbers (`server/dual/runOrder.js`); venue PINs last one calendar day |
| v2.5.03 | 2026-09-06 | Venue Head Judge who also scores — two in-app tabs on the HJ role page (client only) |
| v2.5.02 | 2026-09-06 | Hotfix: update script's release-tag parse broke on compact JSON |
| v2.5.01 | 2026-09-06 | Hotfix: update script detaches from the service cgroup (systemd-run); update needs no PIN; live update progress + status endpoint |
| v2.5.00 | 2026-09-06 | Offline adoption backup file + offline return via the scoring laptop; `/api/adoption` router; return package |
| v2.4.02 | 2026-09-03 | Hotfix: update script refreshes itself |
| v2.4.01 | 2026-09-03 | Hotfix: venue Update card after check-in |
| v2.4.00 | 2026-09-03 | Post-physical-test fix release (L-1 boot capture order, timezone, STICKITSNAP, role bar / Leave seat / Change role, seats by format, copy judges) |
| v2.3.01 | 2026-09-02 | Bottom (sponsor) logo on PDF reports, first page only; rides export/import/adoption |
| v2.3.00 | 2026-09-02 | Air judge jump-code mismatch reconciliation (HJ Accept / Reject Both, exact-case compare); Comp Series air quick-select 3 rows; **sync protocol v3** |
| v2.2.01 | 2026-09-01 | HJ tablet polish — dual judge names, Reject Codes button, J1/J2 review column |
| v2.2.00 | 2026-09-01 | Viewer API parity — `/results/phases`, rule-correct ranking, `?run_number=`, `upcoming_limit` |
| v2.1.01 | 2026-08-31 | Ultra-review nit — `AdvancedCheck` hoisted |
| v2.1.00 | 2026-08-31 | RMF Mock Comp fix release (approve gate, finalize counts, Abandon Run, D-1/D-2, Advanced meet settings); **sync protocol v2** |
| v2.0.03 | 2026-08-30 | Hotfix: Set Run Order button on phase cards (`rebuild-order`) |
| v2.0.02 | 2026-08-30 | Hotfix: per-judge PIN enforcement removed |
| v2.0.01 | 2026-08-29 | Case-insensitive login + password UX (forced first-login change, show-password, editable username) |
| v2.0.00 | 2026-08-26 | Local venue server (Raspberry Pi) + one-way cloud sync — steps 0–6, review fixes, release gates |

### Standing rules distilled from the v2 release notes

Each rule is explained in full in its CHANGELOG.md section; this list exists so no session misses them.

- **Sync protocol.** `SYNC_PROTOCOL_VERSION = 3` in `server/sync/protocol.js`. Any migration touching
  a manifest table must update the manifest (the harness drift test fails otherwise) and consider a
  bump; a bump strands every fielded Pi image (v2.5.06 is fielded), so additive messages / cloud-only
  or transport columns go in `NON_SYNC_COLUMNS` or non-manifest tables instead (v2.5.00, v2.7.00 pattern).
  Indexes are not rows — they never need a bump (v2.7.01). Contract: `docs/SYNC_PROTOCOL.md`.
- **Venue mode** is `STICKIT_MODE=venue`; cloud mode is the default. Boot-time mutations must exclude
  adopted meets (FR-9) and venue boot writes must be captured (`installCaptureHook()` is awaited before
  `initSchema()` — v2.4.00 L-1). Ops: `docs/VENUE_OPS.md`, `docs/V2_PROGRESS.md`,
  `docs/V2_REVIEW_FIXES_08-23-26.md`, `docs/VENUE_MAC_FALLBACK.md`. Pi image + update script:
  `server/scripts/build_pi_image/`; printed volunteer material: `server/scripts/venue_cards/build_venue_docs.js`
  → `server/public/docs/venue/*.pdf` (regenerate every release for the version footer).
- **Harness** (`harness/`, dev-Mac only, never deployed, excluded from zips): suites review-ui, review,
  step0–step6, v240, v250, v2506, v2507, v260, v2601, v270, v2701, release-gates (`zz-gates`) — 1,265
  checks green at v2.7.01 — plus `node server/scripts/verify_v16.js` (123). Gotchas: the v270 suite
  rewrites `harness/fixtures/registration/skireg_copper.xlsx` (`git checkout` it before committing);
  an all-suites run can hit the v2.1.00 timing flake (a cloud instance restarting under load) — rerun
  the suite alone. New release = new `harness/tests/vXYZ.test.js` + `V2_ONLY_KEYS` in `zz-gates` for
  new response fields + `EXEMPT_PREFIXES` in step1 for new non-meet-scoped routers.
- **Every GitHub Release must carry the Pi image assets** (`stickit-venue.img.xz`, `os_list_stickit.json`,
  `CHECKSUM.txt`) — rebuild the image when anything venue-side changed, otherwise re-attach the
  current one; the Imager "latest" URL 404'd from v2.5.03 to v2.5.05 for lack of this. The repo is
  public so the Pi's Update button can read `releases/latest`; keep it public.
- **Cloud ultra review recipe:** run it on a temporary source-only branch (`review/vX.Y.ZZ-source`)
  with docs, PDFs, build assets, harness and version bumps stashed — committed build assets push the
  diff past the tool's 8k-line limit.
- **Design rulings that recur:** printed forms are functional, Winfree-plain, minimal text; review
  every PDF page at ≥100 dpi (not thumbnails) before showing David (v2.6.01 → v2.6.02). Tablets never
  call a `requireAuth` endpoint (see Access Model). The Chief of Scoring starts the FIRST run of an
  event from the Scoring Computer; the HJ starts runs from the tablet afterwards (v2.4.00 T-1).
  `stickit.local` is the primary venue address; the numeric IP is only the documented backup (v2.5.04).
- **Dual bracket conventions:** `bracket_round` 1 = final; odd round → top competitor RED, even → BLUE
  (`advancementSlot`); consolation drop takes the opposite slot (`consolationSlot`); run order from
  `server/dual/runOrder.js` (semis last-to-first, finals 7/8 → 5/6 → 3/4 → 1/2). The Broadcast Board
  and every display only READ the bracket the server built — never predict or re-seed on the client.


---

## Registration Import Notes (v2.7.00)

One pipeline, `server/import/registrationImport.js`, reads every registration file: stage 1
`parseFile` (CSV via csv-parse, XLSX via exceljs; UTF-8 else windows-1252; the header is the
first row within 20 that holds a Last Name synonym — Winfree rule), stage 2 `mapColumns` (the
`SYNONYMS` table = Winfree list + SkiReg / Winfree-export spellings, NFD-stripped and
punctuation-free; `IGNORED_HEADERS`; entry columns = a header equal to an event's
`import_code` / name / `usss_code`) + `normalizeValues` (`Last, First` split, gender first
letter, birth year = first 1900–now four-digit group — never `parseInt`, USSS # 5–8 digits),
stage 3 markers (`markersForRow`: SkiReg category, Winfree Events codes tokenised longest-first
against the meet's import codes, ticked entry columns, else the synthetic
`(no entry information)`) resolved by `resolveMarker` (rules 1–8 of the 09-19-26 prompt: not-an-event
keywords → gender → discipline → candidates → date/day cue → series word → exactly one; saved
`meet_import_map` rows override; per-event button = default event for no-info files), stage 4
identity (`resolveIdentity`: athletes by USSS # → FIS → `usss_people` by normalised name with
gender / club-word tie-breakers → athletes by name → new), stage 5 `previewImport` /
`commitImport` (commit re-runs the preview; `preview_token` = sha256 of file + mapping +
overrides + event_id).

**Real SkiReg 2026 export** (REG_85xx / 9008): `Bib, Category Entered [/ Merchandise Ordered],
City, First Name, Last Name, Notes, Fundraising Pageviews, Custom Tax, Gender, State, Team[,
Quantity, MerchSummary]` — **no USSS Member #, no birth year**; one row per category per
athlete plus banquet / coach / fee rows. **RMF Data files**: `Last Name, First Name, Gender,
Born, ID, Club[, Bib][, Events | M, M2, D][, FIS]`. The pre-v2.7.00 notes here described a
synthetic demo layout (with USSS Member # and Date of Birth) that no real export has;
`matchesDiscipline` and `POST /api/events/:id/registrations/import-csv` are gone.

Athlete-only paths (`POST /api/import/athletes/csv`, `POST /api/athletes/reconcile`) read
bytes (CSV text or XLSX, named in `X-File-Name`) through `reconcileHelpers.parseCSV` /
`parseFileAsync` + `normalizeRow` (thin wrappers) and apply the USSS People File lookup
before matching; response shapes unchanged.

### Bib Assignment Behavior

When the bib conflict dialog appears and user chooses "Fill In Missing":
- **Run Order mode:** Returns an error — do NOT assign any bibs (positional bibs would conflict)
- **Random / Copy mode:** Assigns available bib numbers (starting from 1, skipping taken ones) only to athletes with no bib currently assigned
