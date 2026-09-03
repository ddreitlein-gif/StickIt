# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**StickIt** is a full-stack freestyle mogul scoring application for managing ski/snowboard competitions (moguls, dual moguls, aerials) for US Ski & Snowboard (USSS) events.

**Current version:** v2.4.00

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
  --exclude "*/node_modules/*" "*/.claude/*" "*/data/*" "client/dist/*" "harness/*" "* [0-9].*"

# Why each exclusion:
#   */node_modules/*  → installed deps (~100MB)
#   */.claude/*       → Claude Code worktrees + chat artifacts (can balloon zip to 15M+)
#   */data/*          → runtime DB + uploaded logos + backups (production has its own)
#   client/dist/*     → Vite build intermediate (final assets already in server/public/assets)
#   harness/*         → v2 simulation test harness (R16) — dev-Mac only, never deployed
#   "* [0-9].*"       → macOS/iCloud duplicate copies ("index-abc 3.css", "foo 2.woff2") that
#                       appear untracked in server/public/assets + client/dist (gitignored via
#                       the same pattern, but zip would sweep them in — v2.3.00 hit 9.2MB)

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
- PDF endpoints reachable from the public Scoreboard: `event-results-detailed`, `dual-bracket`, `dual-results`, plus `GET /api/pdf/logo/:meetId`. Every other PDF endpoint requires auth (policy comment at the top of `server/routes/pdf.js`).
- `/api/jump-dds`, `/api/resolve`, `/api/version`, `/api/auth/status` and login.

**Protected when auth is enabled:** all Officials mutations (meets, events, registrations, runs manual entry, dual seeding/paper score, phases, exports, USSS transmit, imports, audit, training days, PDFs not listed above) and the entire `/api/admin` panel (system_admin role). Client downloads can't carry an Authorization header in a plain anchor — use `downloadAuthed()` from `client/src/utils/api.js`.

**Roles (single source of truth `server/auth/roles.js`, mirrored in `client/src/auth/RequireAuth.jsx`):** judge (1, login-only; Officials dashboard restricted to Links) < official (2, full Officials section) < system_admin (3, everything). `event_admin` is a legacy alias ranked with system_admin; existing rows are migrated to system_admin at boot.

---

## v2.4.00 Feature Notes

### Post-Physical-Test Fix Release (v2.4.00)

Everything in `StickIt_v2_Physical_Test_Findings_09-03-26.md` (the first physical venue run,
09-03-26, PASSED on the v2.3.01 image) worked in the prescribed order of
`StickIt_v2_Post_Test_Fix_Prompt_09-03-26.md`: two image defects (F-1/F-2), three log-review
items (L-1..L-3), the tablet/console items (T-1, T-2+T-3, T-4..T-7), and one enhancement (E-1).
**No scoring math, no schema change, no sync-protocol change** (still v3; no new columns).
Rulings recorded from the 09-03-26 chat: the role bar + Venue Menu + More-menu placement
(approved as proposed); the amber discipline-switch notice (approved); a Head Judge tablet
showing a judge seat side-by-side is DEFERRED (Change role covers the double-duty case).

**L-1 — boot-time backfills on the venue (root cause + fix).** The 19:50 boot after the power
pull logged `athletes.bib backfilled for 6` and `air_score_no_dd backfilled for 6 runs` on the
adopted meet. Findings: (a) every FR-9 guard keys on `meets.adoption_status='adopted'`, a
cloud-side column the adoption package deliberately strips (NON_SYNC_COLUMNS) — on a venue
the guards are pass-throughs BY DESIGN (the venue is the authority), on condition that its boot
writes are captured; (b) the v1.6 bib migration's data gate ("no athlete has a bib yet")
reopened on the venue because FR-8 leaves only the adopted meet's athletes in the table and
cloud athletes created after v1.6 carry NULL `athletes.bib` — it copied registration bibs into
rows the cloud never had; the air_score_no_dd "backfill" was the 5 DNF + 1 DNS rows
(status=complete, no scores) being written NULL over NULL and counted, on EVERY boot, cloud
included; (c) both use the hooked `execute`, and the capture hook was installed at module
load three statements ahead of the migrations, so the writes were captured and upsynced (Pi
outbox seq 257, empty) — but only by winning a race. Fixes: `index.js` now AWAITS
`installCaptureHook()` before `initSchema()` in venue mode (worker woken after init; a fresh DB
has no app_settings yet); the bib migration is a true one-time migration behind an
`app_settings.migration_v16_bib_done` marker (set at every server's first boot, so a venue never
reopens it post-adoption); the air_score_no_dd backfill skips rows whose computed value is
null. The other schema.js migrations (gender/short-code/usss_code) use the raw client and are
uncaptured on a venue — no-ops there because the cloud normalized those rows before adoption.

**L-2 — Pi timezone.** The Pi was on pi-gen's default **Europe/London** (the journal read in
BST, not UTC as assumed); autosave/snapshot filenames and every DB timestamp are UTC. The
image now sets `TIMEZONE_DEFAULT=America/Denver` (override `STICKIT_PI_TIMEZONE`),
`en_US.UTF-8`, US keymap; `update-stickit.sh` moves a device still on Europe/London to the
venue zone once. Stored timestamps stay UTC by design (documented in VENUE_OPS).

**L-3 — journal lines.** Snapshot worker: one line per result (`[snapshot] written …` /
`FAILED: …`, identical failures collapsed until the message changes or the stick recovers).
Sync worker: state changes only — `cloud unreachable … queuing`, `cloud reachable again —
pushed N change(s), M still queued`, `queue drained`, plus the existing revoked/stuck lines.

**F-1/F-2 — backup stick.** Label **`STICKITSNAP`** (11 chars, the ExFAT/FAT32 limit) in
`provision.sh`, README, run sheets, VENUE_OPS, MAC_FALLBACK, help; fstab gains
`uid=1000,gid=1000` so the `stickit` service user owns the mount (was root → SQLITE_CANTOPEN).
Decision: **ExFAT is the only supported format** (FAT32 also mounts; ext4 is refused by the
FAT-only options and stays absent via nofail) — the Mac fallback must read the snapshots
natively. The pre-event checklist carries the exact Disk Utility steps (Name STICKITSNAP,
ExFAT, Master Boot Record). The test Pi's hand-edited fstab already matches.

**T-1 — verified, designed.** Both events were `setup` before any run, so venue auto-follow
fell back to the first-created event (the Men's on the Pi) and the HJ tablet had no next-up
card for the Women's; the Scoring Computer's first Start Run put the Women's event in the
spotlight. Rule documented in tablet-hj, scoring-live, the new venue help topics, the adoption
+ tablets run sheets: **the Chief of Scoring starts the first run of an event from the Scoring
Computer**, after which the HJ starts runs from the tablet.

**T-2/T-7 — leaving a role.** `VenueRole.jsx`: judge/HJ/timekeeper tablets get a 40 px bar
ABOVE the embedded page (the iframe is shorter; nothing covered) — role · seat · judge (role
label) · followed event — with **Leave seat** (judge: releases the seat, clears role memory,
returns to `/?menu=1&pick=judge` which opens the seat picker directly, no Crew PIN re-entry)
and **Change role** (releases the seat if any, clears memory, returns to the menu where each
tile asks its PIN). Both `window.confirm` first. Scoreboard: no bar, a labeled corner "⌂ Change
role" button. FR-15 preserved: a reload/reboot still returns to the remembered role; only these
actions change it. **Singles ↔ duals:** when the followed event's discipline changes, the bar
turns amber — "Now following <event> (Dual Moguls). You are Air Judge in seat J3 here." (or
"…no judge in this event — Leave seat and pick the right one"; timekeeper: "Duals have no
timekeeper"). Officials sidebar (`Layout.jsx`): in venue mode the Home link becomes **Venue
Menu** → `/?menu=1` (memory kept; strip on the menu "This device is set up as Scoring
Computer — Back to Scoring Computer"). Venue detection for cloud-shared pages via a new
`useVenueMode()` hook in `venueShared.js` (cached /api/venue/status; failure reads as cloud).

**T-4 — seats follow the format.** `venue.js` `seatOrderFor(event)`: mogul = `TL1..TLn` +
`Air1..Airm` from the event's judge counts (5-judge J1–J3/J4–J5 unchanged; **7-judge J1–J5
T&L + J6–J7 Air** — TL4/TL5 previously had no seat at all), dual 5 fixed, aerials v2 = panel
size, legacy aerials 7. `GET /seats` returns only in-format seats (each with `role`), plus
claimed out-of-format seats flagged `in_event:false` (still force-releasable), `seat_count`,
and all seven when no event is active yet. The picker shows "Now scoring: <event> (Moguls) —
5 seats", role beside each seat, judge name or "No judge assigned to this role yet", and an
"Also in use, but not part of this event" line; it re-polls every 4 s. Also fixed: `judges.js`
`VALID_ROLES` lacked TL4/TL5 (the event form offers 5 T&L judges; EventDetail listed the roles;
the POST 400'd); TL4/TL5 labels added to EventDetail/JudgeTablet/HeadJudgeTablet maps.

**T-5 — meet page in venue mode.** More ▾ hides Release for Adoption / New Release Code /
Undo Release and Clone Meet; offers **Venue Menu (end of day)** (Hand Back / Check In stay on
the venue menu with their PIN/confirm/progress handling — one implementation). The Advanced
panel hides "Allow venue server adoption" in venue mode. Menu widened (w-56).

**T-6 — finalize on reload.** `GET /runs/active` adds `finalized` (events.status='complete')
to both event_completed branches; the HJ tablet sets `eventFinalized` on it, so a reload after
Finalize shows "Event Completed". A repeat Finalize was verified harmless (no audit row,
zero-row phase update, one extra broadcast).

**E-1 — copy judges.** `POST /api/events/:eventId/judges/copy-from-event { sourceEventId }`
(requireAuth = login on cloud / Control token on venue; adoption-lock + freeze prefixes apply):
same meet + same discipline only (aerials also same v2/legacy model), roles already filled on
the target kept, roles the target format cannot hold skipped, new id + short code per copied
row, plain INSERT so the rows ride the outbox. Response `{copied, skipped_filled,
skipped_role, judges}`. Client: **Copy Judges from Other Event** above Assigned Judges
(same-discipline events only) + `api.copyJudgesFromEvent`.

**PIN modal.** `type="password"` → masked `type="tel"` (`-webkit-text-security: disc`,
`autoComplete=off`, `data-testid="venue-pin"`): a 4-digit venue PIN must not trigger iPad
keychain / password-manager prompts (found because a Chrome password manager blocked the
walkthrough). Harness selectors updated.

**Docs.** New help group **Venue Server (StickIt box)** with `venue-server` (adoption, PINs,
end of day, backup stick, updates, sync line) and `venue-tablets` (roles, seats, role bar,
take-over from a dead tablet, singles/duals switch, first-run rule, Venue Menu, finalize);
tablet-hj / scoring-live / judges-add updated; guide PDFs regenerated (66 topics). Printed
venue material regenerated: adoption sheet step 5 (first run), tablets sheet steps 5–6 +
take-over callout, end-of-day menu route, pre-event checklist stick-format block.
`docs/VENUE_OPS.md` (stick + timezone/journal sections), image README (journal section),
`VENUE_MAC_FALLBACK.md`.

**Harness.** New `harness/tests/v240.test.js` (104 checks: E-1 cloud + venue-synced, T-6,
T-1, T-4 incl. 7-judge + out-of-format claims, T-2 public release, L-1 three-restart sequence
with the marker removed to prove capture ordering + cloud parity, L-3 outage/recovery/snapshot
lines + collapsed FAILED, plus Playwright: judge bar, amber switch, Leave seat, Change role,
HJ bar, scoreboard corner button, Venue Menu link + strip + reload, T-5 More menu on venue vs
cloud). step3 seat count updated (7 → 5). `zz-gates` regression drop-list brought current
(v2.1.00 meets columns, v2.2.00 viewer fields, v2.3.00 jump-code fields; `/api/version`
compared by shape) — it had been failing since the v2.0.00 bump, unnoticed because only
step subsets ran on later releases. step6 asserts the new label + uid/gid. Full suite green:
566 (steps/review) + 31 (gates) + 104 (v240). `verify_v16.js` 123/123. Chrome walkthrough of
the built bundle on scratch cloud+venue servers: all listed items.

**Files created:** `client/src/help/topics/venue-server.md`, `venue-tablets.md`,
`harness/tests/v240.test.js`
**Files modified:** `server/index.js`, `server/db/schema.js`, `server/sync/worker.js`,
`server/venue/snapshot.js`, `server/routes/venue.js`, `server/routes/judges.js`,
`server/routes/runs.js`, `server/scripts/build_pi_image/{provision.sh,build.sh,update-stickit.sh,README.md}`,
`server/scripts/venue_cards/build_venue_docs.js`, `client/src/pages/venue/{VenueRole,VenueHome}.jsx`,
`client/src/pages/venue/venueShared.js`, `client/src/components/Layout.jsx`,
`client/src/pages/{MeetDetail,EventDetail,HeadJudgeTablet,JudgeTablet}.jsx`, `client/src/utils/api.js`,
`client/src/help/topicsIndex.js`, `client/src/help/topics/{tablet-hj,scoring-live,judges-add}.md`,
`docs/{VENUE_OPS,VENUE_MAC_FALLBACK}.md`, `harness/tests/{step3,step6,zz-gates}.test.js`,
`server/public/docs/guides/*.pdf` + `server/public/docs/venue/*.pdf` (regenerated),
`server/version.js`, `client/package.json`, `server/package.json`, `server/public/*` (rebuilt),
`CLAUDE.md`

---

## v2.3.01 Feature Notes

### Bottom (Sponsor) Logo on PDF Reports (v2.3.01)

Per David's 09-02-26 request + two rulings: **(a)** the bottom logo prints on the **first page
only** of a multi-page PDF; **(b)** it follows the meet everywhere the event logo does (export
zip, import, venue adoption package). Clone does not copy either logo — unchanged, pre-existing
behavior. No scoring, schema, or sync-manifest changes; the adoption package gains an optional
field only (no protocol version bump — old importers ignore it, new importers tolerate its
absence).

**Storage.** A second meet-level file `server/data/logos/meet_<id>_bottom.<ext>` beside the
event logo (`meet_<id>.<ext>`), same PNG/JPEG formats and 5 MB multer limit
(`bottomLogoUpload`, `getMeetBottomLogoPath` in `pdf.js`). On Render this is the same
persistent-disk `data/` folder as the DB and event logo — no hosting changes. Endpoints mirror
the event logo's access rules: `POST /api/pdf/upload-bottom-logo/:meetId` and
`DELETE /api/pdf/bottom-logo/:meetId` (requireAuth; the upload also drops a stale copy with a
different extension), public `GET /api/pdf/bottom-logo/:meetId` → `{ hasLogo }`.

**Drawing (`drawBottomLogo`, called at the end of `pdfHeader`).** Scaled to at most
**1.5 in (108 pt) high** and no wider than the content area, centered, bottom edge on the base
bottom margin (above the "Generated …" footer line, which prints inside the margin). A
`doc._bottomLogoDone` flag makes repeat `pdfHeader` calls (Entrants continuation pages,
bracket pages) no-ops, and **page 1's `margins.bottom` is raised by logo height + 8 pt** so
flowing text, `drawTable` pagination, and pdfkit's own auto page-break all stop above it;
pdfkit rebuilds each new page's margins from `doc.options`, so later pages get the normal
margin back automatically. Two consumers had to learn about the raised margin: `stampFooter`
now positions the footer off the recorded base margin (`doc._baseBottomMargin`) instead of
`page.margins.bottom` (otherwise the footer text + StickIt mark landed inside the logo — caught
in the render check), and the two dual bracket layouts compute their tree height budget
`BKH` from `doc.page.margins.bottom` instead of the `MARG` constant so the page-1 bracket
compresses above the logo. Every PDF that calls `pdfHeader` gets it: results, run order,
entrants, check sheets, registration listing, training day, timer sheet, run/event results
(all variants), press, dual seed list, dual results, dual bracket, bracket keeper. The
group-awards and TD-report PDFs don't draw the event logo and are untouched.

**Meet lifecycle (`meets.js`).** `deleteMeetCascade` removes both files; the export zip adds
`meet_bottom_logo.<ext>` beside `meet_logo.<ext>`; `copyLogoFromZip` restores both on
import/merge. **Venue adoption:** `buildAdoptionPackage` adds `bottom_logo: {filename, base64}
| null` (new `findBottomLogoFile`); `executeAdoptionImport`'s L-4 filename/traversal guard
was extracted into a shared `writeLogo(entry, prefix, label)` and applied to both files
(expects exactly `meet_<id>_bottom.<ext>`); the venue adopt/import-package responses carry
`bottom_logo: bool`. `docs/SYNC_PROTOCOL.md` package shape updated.

**Client.** PDF Reports tab: a **Bottom Logo:** control beside Event Logo (same Upload
PNG/JPEG / Remove Logo / Uploaded pattern, tooltip explains placement). Help topic
`reports-pdf` gained a "Logos on PDF reports" section; guide PDFs regenerated.

**Verification.** 37-check scratch-server integration test (cloud + two venue-mode
instances): status/upload/delete endpoints + non-image 400; multi-page portrait registration
listing → bottom logo image XObject on page 1 only, page 1 holds fewer rows (A28 vs A35 last
row) and all 60 athletes still listed; landscape check sheet page-1-only; a 200×800 tall image
capped at exactly 27×108 pt, centered (x=292.5) with its bottom edge on the 36 pt margin (read
from the content stream `cm` operator); extension replace cleanup; 16-athlete dual bracket +
bracket keeper page-1-only; export zip carries both files → import creates both; delete bottom
only leaves event logo; export-for-adoption package carries `bottom_logo` → venue
import-package writes byte-identical file and reports both flags; `../evil.png` filename
refused with import still succeeding; meet delete removes files. Rendered pages (pdftoppm)
eyeballed for portrait, landscape, bracket, and bracket-keeper layouts. `verify_v16.js`
123/123. Harness step2 (adoption package + logo round-trip) green.

**Files modified:** `server/routes/pdf.js`, `server/routes/meets.js`,
`server/routes/venue.js`, `server/sync/package.js`, `server/sync/adoptionImport.js`,
`docs/SYNC_PROTOCOL.md`, `client/src/pages/EventDetail.jsx`,
`client/src/help/topics/reports-pdf.md`, `server/public/docs/guides/*.pdf` (regenerated),
`server/version.js`, `client/src/components/Layout.jsx`, `client/package.json`,
`server/package.json`, `server/public/*` (rebuilt), `CLAUDE.md`

---

## v2.3.00 Feature Notes

### Air Judge Jump-Code Mismatch Reconciliation (v2.3.00)

Single moguls only (the aerials tablet never submits codes through this path; dual has no
codes). Per David's 09-02-26 spec + two rulings: **(a)** mismatch handling lives on the HJ
tablet only — a Head Judge is required at every competition, the legacy no-HJ auto-publish
path is a fallback, not a workflow; **(b)** codes compare **exact-case** (`bG` vs `bg` IS a
mismatch — since v1.26.00 g/G and p/P are meaning-bearing and change the DD). **No scoring
math changed**: the accepted codes' DDs resolve through the identical lookup the tablet PUT
path always used, and finalize still recomputes from the run row's DDs.

**Before:** the first Air judge's PUT set the run's codes; a second judge's differing PUT got
a 409 and that judge's scores were never posted — the run stalled until the HJ cleared codes.
The comparison was also case-insensitive, so `bg` silently scored against the `bG` DD.

**Data.** `judge_scores.jump_code TEXT` — the code THAT judge scored against, stored on
air_jump1/air_jump2 rows by `POST /:runId/scores` (new optional `jump_code` body field; null
on turns/aerials rows and on pre-v2.3.00 rows, which never count). `runs.air_codes_reconciled
INTEGER NOT NULL DEFAULT 0` — set by the HJ Accept. Both additive, both in the sync manifest,
**`SYNC_PROTOCOL_VERSION` bumped 2 → 3** (same reasoning as v2.1.00; no Pi image fielded).
`docs/SYNC_PROTOCOL.md` version line corrected (had still said 1). Import/export round-trip
threaded through `executeImport`/`executeMerge` for both tables (`?? null` / `?? 0`).

**Server (`runs.js`).** New `getAirCodeState(run, submitted?, eventId)` → `{ air_code_mismatch,
air_codes_by_judge: [{ judge_id, role, name, jump1_code, jump2_code }] }` — mismatch when any
air row's recorded code ≠ the run's official code for that jump. Attached to BOTH branches of
`GET /runs/active` (the tablets' shared poll) and the three `submitted` SELECTs now carry
`js.jump_code`. `PUT /:runId` codes branch: the 409 is gone — a differing second submission
leaves the run's codes untouched and answers `200 { ...run, codes_mismatch: true }`; the
"codes already set" test is now `num_jumps`-aware (a 1-jump event previously let the second
judge overwrite). `tryFinalize` returns null while a mismatch stands (gates BOTH the HJ
approve path and the no-HJ auto-publish path, so a first-submitter DD can never publish);
`POST /:runId/approve` names the mismatch in its 400. New **public** (tablet rule)
`POST /:runId/air-codes/accept { judge_id }`: run codes + DDs ← that judge's codes via
`tabletLookupDD` (extracted verbatim from the PUT path — deliberately NOT `resolveJumpDD`,
which canonicalizes/throws for manual entry), every air row's `jump_code` overwritten with the
accepted pair (per spec: "set the air codes of both judges to the codes accepted"), flag set,
audit `air_codes_reconciled` (originals + accepted), then the same tryFinalize + broadcast
sequence as a score POST. `clear_jump_codes` (Reject Codes / Reject Both Codes) also resets
the flag. Single-score reject after reconciliation keeps the flag; a differing re-entry
re-flags the mismatch (warning outranks "reconciled" on the tablets).

**Judge tablet.** Air submissions carry `jump_code`; `submitCodes` treats `codes_mismatch` as
success and sets the local flag so the warning appears immediately; the poll's same-run branch
now merges the mismatch/reconciled/code fields (guarded — previously the first judge's run
object was never refreshed, so they'd never have seen the second judge's mismatch). Score
Submitted screen: red **WARNING — JUMP CODES DO NOT MATCH / Please see the Head Judge to
reconcile** on both Air tablets; replaced by green **Air Codes Reconciled by Head Judge** (+
the accepted codes) after Accept. Each judge's own codes now print beside their scores, and
the athlete-bar jump chips show the judge's OWN pick + its DD (previously the run's official
code won, which read wrong on the differing judge during a mismatch — found in the Chrome
walkthrough).

**HJ tablet.** Red **JUMP CODE MISMATCH** box at the top of the Air Judges card (in place of
the official-codes line while it stands): one line per Air judge — role, name, `bT / bG` —
with a green **Accept These Codes** button, and **Reject Both Codes** (same `clear_jump_codes`
action as Reject Codes, now via a shared `clearCodes` helper) on the bottom row. Per-score rows
show the code that judge scored against (red when it differs from the run's). `scoreSetStatus`
adds "Jump code mismatch — reconcile below" so **Finalize and Publish Score** is disabled
exactly as for missing scores. Running Score recomputes from the accepted DDs automatically.

**Verification.** 43-check scratch-server integration test: second judge 200 + flag with run
codes untouched, scores accepted, `/active` state + by-judge codes + row codes, hold with all
scores in (no hj_pending / no total), approve 400, accept → run codes/DDs from table, rows
rewritten, flag, tryFinalize → hj_pending with total == `calcMogulScore` on the accepted DDs,
approve 200 + published total, audit row; Reject Both path + matching resubmission normal;
exact-case `bG`/`bg` mismatch + DD switch; single reject after reconciliation + differing
re-entry re-flags; no-HJ event held then auto-published on accept; 1-jump event; export →
import round-trip of both columns; double boot + `protocol_version: 3`. `verify_v16.js`
123/123. Harness step0 87/87 (manifest drift test green). **Chrome walkthrough** of the
built bundle on a scratch server (two Air judge tablets + HJ tablet): mismatch warning on
both Air tablets, HJ mismatch box with Accept per judge + Reject Both, Finalize disabled with
the mismatch reason, Accept → reconciled notice on both tablets + HJ codes/DD/running score
updated, Reject Both → both tablets back to code entry via the rejected-score banner. Help topics `tablet-air`,
`tablet-hj`, `scoring-hj-review` rewritten for the new flow; guide PDFs regenerated.

### Comp Series Air Quick-Select — Three Rows + Basic-Grab Codes (v2.3.00)

The single-mogul Air judge quick-select for Comp Series (and FIS) grew from 13 codes in a
7×2 grid to **15 codes in three rows of six**, adding the FS-13 basic-grab codes `bg` and
`7og` (v1.26.00 seed): row 1 uprights `N S T K TS 3`, row 2 back flips
`bT bp bL bG bg bF`, row 3 off-axis `7op 7oG 7og` + No Jump spanning the three spare
columns. `JumpCodeGrid` now accepts `freqCodes` as `string[][]` (explicit rows; columns =
longest row; No Jump fills the last row's spare columns) while a flat `string[]` keeps the
legacy 7-column shape byte-for-byte — **Devo / RQS lists are unchanged** (11 codes, No Jump
span 2). `COMP_FREQ_CODES` in JudgeTablet.jsx is now the nested array. Display only — DD
lookup and scoring untouched. Approved by David from a Chrome walkthrough on 09-02-26.

**Files modified:** `server/routes/runs.js`, `server/routes/meets.js`, `server/db/schema.js`,
`server/sync/protocol.js`, `docs/SYNC_PROTOCOL.md`, `client/src/pages/JudgeTablet.jsx`,
`client/src/components/tablet/JumpCodeGrid.jsx`,
`client/src/pages/HeadJudgeTablet.jsx`,
`client/src/help/topics/{tablet-air,tablet-hj,scoring-hj-review}.md`,
`server/public/docs/guides/*.pdf` (regenerated), `server/version.js`,
`client/src/components/Layout.jsx`, `client/package.json`, `server/package.json`,
`server/public/*` (rebuilt), `CLAUDE.md`

---

## v2.2.01 Feature Notes

### HJ Tablet Polish — Dual Judge Names, Reject Codes Button, J1/J2 Review Column (v2.2.01)

Three display-only Head Judge tablet improvements from David's 09-01-26 live-use screenshots.
No scoring math, no endpoint behavior changes, no tablet workflow changes; one additive server
response field.

**1. Dual moguls — judge names on the Judge Scores panel.** Each "Judge N (Turns/Air/Time/
Overall)" row in `DualHeadJudgeView` now shows the assigned judge's name underneath in small
dim italic text. Purely client-side: `eventCfg.judges` (already returned by the event GET and
passed into the dual view) is mapped role→number via a new `DUAL_ROLE_TO_NUM` constant
(mirrors JudgeTablet.jsx) into a `judgeNameByNumber` useMemo. Rows without an assigned/named
judge render exactly as before.

**2. Single moguls — "Reject Codes" button + "Reject Score" labels.** The hard-to-see yellow
underlined "Clear Codes" link in the Air Judges jump-code strip is now a real
`tablet-btn-danger` button labeled **Reject Codes**, right-aligned via a `justify-between` row
so it sits in the same visual column as the per-score Reject buttons below it. Handler,
confirm dialog, endpoint (`PUT /runs/:id { clear_jump_codes: true }`), and the
not-yet-complete guard are byte-identical — placement/label only. The 4 Air judge "Reject"
buttons are relabeled **Reject Score** (David's ruling: Air buttons only — T&L "Reject" and
"Reject Time" unchanged).

**3. Run review table — combined J1/J2 jump-code column.** The between-phases HJ review table
("Head Judge — Run N Review") gains one column headed **J1/J2** between the TL columns and
Air1, showing the run's jump codes as e.g. `T/S` (David's ruling: one combined column). A
1-jump event shows just the single code; statused rows show `--`. Server:
`GET /runs/round-review/:runNumber` (runs.js) now includes `jump1_code`/`jump2_code` in each
row — additive, already selected by the existing `r.*` query, and the HJ tablet is the
endpoint's only consumer. The final event review table (fed by `/phases/results`) is
deliberately untouched.

**Verification.** 10-check scratch-server test: scored run returns `jump1_code:'T'` /
`jump2_code:'S'` with all pre-existing fields intact; DNS row returns null codes.
`verify_v16.js` 123/123 (no engine paths touched).

**Files modified:** `client/src/pages/HeadJudgeTablet.jsx`, `server/routes/runs.js`,
`server/version.js`, `client/src/components/Layout.jsx`, `client/package.json`,
`server/package.json`, `server/public/*` (rebuilt), `CLAUDE.md`

---

## v2.2.00 Feature Notes

### Viewer API Parity — Per-Round Results, Rule-Correct Ranking, Full Upcoming Queue (v2.2.00)

Implements items 1, 2, and 5 of `Scoring Server/StickIt_Viewer_API_Parity_Plan_08-31-26.md`
(rulings recorded in the plan: auto-select Overall in the app, upcoming cap 100, version
v2.2.00). Server-only source changes on the public Viewer API + one shared-helper refactor —
no schema changes, no sync-manifest/protocol impact, no engine changes, venue mode unaffected.
Companion iOS work shipped in the StickIt Live Score repo (tappable round pills, Overall view,
full upcoming sheet).

**Shared assembly helper.** The `GET /phases/results` handler body in `server/routes/phases.js`
was extracted verbatim into exported `buildPhasesResults(eventId)`; the route is now a thin
wrapper (regression-tested against the old output). The `phases` array now carries `status` on
all three formats (was qualifier_finals only) and the no-phase response gained `phases: []` —
both additive. Reuse pattern: rankDualPlacements/v1.30.00.

**New viewer endpoint `GET /api/viewer/events/:eventId/results/phases`** (registered before
`/results` — Express ordering). Maps `buildPhasesResults` output to a viewer-stable shape:
`{ format, phases[], results[] }` where rows carry `rank` (shared on ties), `registration_id`,
normalized `bib_number`, `best_score` (null for flagged rows), `tier`/`tier_label`,
`effective_status`, and a per-run map keyed by run number string with
`{ total/turns/air/time_score, run_time, run_status, jump codes, counts }`. `counts: true`
marks the run whose score ranks the row (derived from the assembly's representative row — the
web's starred run). dual_mogul → 400; no phases → `format: 'none'`.

**`/results` + `/results/scores` accept `?run_number=`** via new `resolveRequestedRound()`:
absent → active-round resolution unchanged; present → must be an integer round known to the
event (event_phases ∪ run_round_status ∪ runs) else 400 `Unknown run_number`. `/results` now
echoes `run_number` — deliberately doubling as the iOS app's feature-detection signal (old
servers ignore the param and omit the echo, so the app keeps its pills inert).

**`/results` ranking is now rule-correct.** The naive `ORDER BY total_score DESC` +
`rank: i+1` block was replaced with the same construction phases.js uses for one round:
scored runs (`run_status IS NULL`) → `pickBestRun` (FIS-stronger dedup) →
`assembleTieredResults` single tier (FIS tie-breaks, shared ranks with Olympic-style skips,
flagged athletes ordered scored → DNF → RNS → DNS with DSQ at event bottom per USSS 4012.3,
numeric competition ranks throughout). Rows gain `effective_status` (null for scored rows).
**Deliberate output change:** ranks now differ from v2.1.x whenever a tie or statused athlete
exists — a correction; old app builds simply render the corrected order.

**`/status` upcoming queue configurable.** `?upcoming_limit=` — integer 1..100 (clamped),
`all` → 100, absent → 10 (byte-identical for existing callers). Applied to both the
phase_run_order branch and the legacy registrations.run_order branch via `LIMIT ?`.

**Docs.** README Viewer API Reference (new endpoint section, params, echo/effective_status
notes, shared-rank semantics, error table) + `ref-viewer-api.md` help topic updated; guide
PDFs regenerated (150-page complete guide, zero unresolved links).

**Verification.** 43-check scratch-server integration test: rn=2 shared rank + skip
(1,2,2,4), flagged ordering DNF→DNS→DSQ with numeric ranks 5/6/7, per-round vs combined
behavior of a Run-2 DNF with a scored Run 1 (flagged in the round view, ranks on the Run 1
score in the best_of_2 combined view per ruling A1.6), run_number echo + 400 guards (99/abc),
`/results/phases` best_of_2 counts flags + field-by-field row/rank parity with the internal
`/phases/results` (refactor regression), qualifier_finals tier order + rank continuation,
dual 400 / none format / 404, `/results/scores?run_number=` scoping + echo, upcoming_limit
default/all/12/500-clamp/junk fallback on the legacy branch + phase branch, unphased shape
regression, dual and aerials `/results` regressions. `verify_v16.js` 123/123 (engine
untouched). Grew 43 → 47 checks after the ultra review to cover the single-format case below.

**Cloud ultra review (09-01-26) — passed, one real finding fixed.** `/code-review ultra
--fix` ran on the source-only diff (docs, version bumps, and build assets stashed for the
review, then restored — same source-only recipe as prior releases). Two of three findings
were false positives traced to the stash (the "incomplete" version bump and "missing" README
docs were simply in the stashed files). The ONE real finding: the single-format branch of
`buildPhasesResults` (an event with only a "Run 1" phase) never attached the per-run `runs`
map the best_of_2/qualifier_finals branches attach, so the new viewer `/results/phases`
served `runs: {}` on single-phase events — placement and best_score with zero component/
time/jump detail. Fixed by attaching `r.runs = { [run_number]: {…} }` with the same column
subset the other branches use (a cloned object, not the row itself, which would be a
circular JSON structure). Additive on the internal `/phases/results` endpoint; the web
Scoreboard and HJ tablet never read `runs` on single-format events, so they are unaffected.

**iOS companion (StickIt Live Score repo).** `ViewerAPI` gains `runNumber:` params,
`phaseResults()`, and `upcoming_limit=100`; new `Models/PhaseResults.swift`; `EventStore`
gains round/Overall selection state with live-pinned latest-score diffing and feature
detection off the `run_number` echo (404 on `/results/phases` disables the Overall pill);
`RoundSelector` pills became buttons with LIVE + OVERALL pills; `MogulScoreboardView` gains
historical-round and Overall modes (new `PhaseResultsList` view with tier headers + starred
counting runs); `UpcomingAthletesStrip` caps at 10 chips + "+N more" full-queue sheet with
favorites pinned. Overall auto-selects once every round is finished (once per event).

**Files modified:** `server/routes/phases.js`, `server/routes/viewer.js`, `README.md`,
`client/src/help/topics/ref-viewer-api.md`, `server/public/docs/guides/*.pdf` (regenerated),
`server/version.js`, `client/src/components/Layout.jsx`, `client/package.json`,
`server/package.json`, `server/public/*` (rebuilt), `CLAUDE.md`

---

## v2.1.01 Feature Notes

### Ultra-Review Nit — AdvancedCheck Hoisted (v2.1.01)

Cloud ultra review of the full v2.1.00 source diff (24 files / 1,395 changed lines, run from a
temporary source-only branch off `d5f0318` because the committed build assets push the raw diff
past the 8k-line limit — same recipe as the v2.0.00 review in `docs/V2_PROGRESS.md`):
**ZERO functional, data-loss, or security defects; one nit**, fixed here. The `Check` checkbox
helper in `AdvancedSettingsModal` (`MeetDetail.jsx`) was defined inside the modal body, so every
toggle created a new component type and React remounted all six checkbox subtrees (render churn +
keyboard-focus loss) — the same anti-pattern the v1.25.00 C-4 fix hoisted `JumpCodeInput` for.
Now a module-scope `AdvancedCheck` taking `form`/`setForm` as props, referenced directly at all
six call sites (no per-render wrapper, which would have re-introduced the unstable type).
Behavior/markup unchanged. Client-only; help topics and guide PDFs untouched.

**Files modified:** `client/src/pages/MeetDetail.jsx`, `server/version.js`,
`client/src/components/Layout.jsx`, `client/package.json`, `server/package.json`,
`server/public/*` (rebuilt), `CLAUDE.md`

---

## v2.1.00 Feature Notes

### RMF Mock Comp Fix Release (v2.1.00)

Implements every fix from `StickIt_Mock_Comp_Findings_08-31-26.md` (forensics) per
`StickIt_Mock_Comp_Fix_Prompt_08-31-26.md`, in the prescribed order, plus the new Advanced
meet-settings panel. The mock comp will be redone against this build (data cleanup 7d/D-3 is a
separate operational step, deliberately NOT performed here).

**Issue 3 (CRITICAL) — HJ approve published a wrong total after a rejection.** The approve
endpoint (`POST /:runId/approve`, `runs.js`) no longer infers completeness from a non-null
`total_score` (which holds a stale PARTIAL after any rejection). Both paths now call
`tryFinalize` and require a non-null result: tryFinalize is the completeness gate (explicit
counts — `tlCount >= num_tl_judges`, per-jump air counts respecting `num_jumps`, time when
`has_speed`, aerials equivalents) AND the recompute (fresh totals from the CURRENT
`judge_scores` rows are stored before publish), curing the stale-partial-after-resubmit bug.
Incomplete → 400 with the missing-scores breakdown (per-jump-aware; aerials gets a generic
message; forerunners exempt so they can still be dismissed). **Partial totals stay in
`runs.total_score` by design** — consumer audit documented at the reject site: every publishing
consumer (results/phases/export/pdf/print/transmit/viewer/computeOverallRank/round-review)
filters `status='complete'`, and complete is only reachable through recomputing paths.
Client: the HJ tablet's **Finalize and Publish Score** button is disabled until the score set is
complete, showing a "Waiting for scores: T&L 2/3 · Time pending" breakdown (new
`scoreSetStatus` memo mirroring the server counts, incl. aerials legacy/v2).

**Issue 5 — finalize counted run rows, not athletes.** `POST /round-status/:runNumber/finalize`
(runs.js), `POST /:phaseId/finalize` (phases.js), and both computed-status endpoints
(`GET /round-status`, `GET /phases/status`) now use `COUNT(DISTINCT registration_id)`; a
duplicate row can no longer cover for an un-scored athlete. Both finalize endpoints additionally
refuse while ANY non-forerunner run for that run_number is `status='scoring'`.

**Issues 4+6 — run lifecycle guards, Abandon Run, stale-card refresh.**
- `POST /events/:eventId/runs` refuses with **409** when a non-forerunner run already exists for
  `(registration_id, run_number)` ("Bib 9 already has a Run 1 entry (complete). Refresh…"), and
  refuses starting while another run is `status='scoring'` (matching the forerunner rule).
  Scoped to non-dual disciplines (dual stores multiple rows per athlete); **paper mode is exempt
  from the concurrency guard** (operators legitimately start consecutive runs). Enforced in code,
  NOT a partial UNIQUE index: the discipline lives on `events` (SQLite partial indexes can't
  reference another table) and the production DB already holds a historical duplicate that would
  break index creation. `POST /runs/status-only` gets the same duplicate guard.
- New **`POST /:runId/abandon`** (requireAuth, audit `run_abandoned` with score count): deletes
  the run row AND its judge scores regardless of score count — the escape hatch DELETE /:runId
  never was. Refuses complete runs (use Reopen/Edit). Officials UI only; no tablet button.
  Client: the Scoring tab's Cancel Run button is replaced by **Abandon Run** with a two-step
  arm/confirm, and the Currently Scoring card shows **"Run started N minutes ago — no scores
  yet"** after 3 minutes so a stuck run is visible immediately.
- HJ + Timekeeper tablets **re-fetch `/next-up` at Start Run press time** and start the athlete
  the server returns (stale card auto-corrects), and refresh on `visibilitychange` so a
  backgrounded iPad resuming never acts on a frozen card. Intentional re-runs remain
  reopen-and-rescore; the Officials-UI confirm-and-start-another path was removed.

**Issue 7a — float artifacts.** Net raw scores are rounded to 1 dp server-side on score submit
(`POST /:runId/scores`) and in both manual-entry paths — values like `1.4000000000000004` are
never stored.

**Issue 7b — implausible deductions (SOFT stop).** A deduction > 6.0 (full-fall max) triggers a
confirmation on the judge tablet (`submitScore`) and in `ManualScoreModal` — accepted as entered
on confirm, never refused or capped.

**Issue 7c — edits after finalization (WARNING + audit, not a block).** Manual entry/edit stays
open after a round is finalized. `ManualScoreModal` shows an amber finalized-round notice and
requires an explicit confirm on submit; the server writes an `edit_after_finalization` audit row
(new `auditEditAfterFinalization` helper, wired into /manual scored + DNS paths, /manual-score
edit + status paths, and the aerials-v2 handler). No reopen required.

**D-1 — dual HJ DNS/DNF winner action.** Per David's ruling the HJ override stays possible even
with all five judges scored — the fix is confirmation and protection, not refusal. Dual HJ
tablet: the Blue/Red buttons (now a 6-button grid incl. the previously missing **DSQ**) open a
confirm ("Record Blue DNF for [Name]? Red advances."), escalated when judge points exist ("5
judges have scored this match (Red leads 18–7)…") with the strongest red styling/wording when
the ruling CONTRADICTS the points winner. Server (`PUT /:matchId/winner`, dual.js): every manual
winner call is audit-logged (`dual_manual_winner`) with the points state at the time
(judge_count/totals/points_winner/contradicts_points); a match already `complete` (and therefore
advanced — advanceWinner runs at completion) returns **409** unless `force: true` (Officials-UI
escape; the paper-score edit path already handles completed matches, so no client sends force
today).

**D-2 — judge points into a completed match.** `POST /:matchId/judge-points` refuses when
`match.status='complete'` ("Match already decided. Contact the Head Judge."), mirroring the
mogul "Run already complete" guard.

**Dual observability.** New `dual_judge_points.submitted_at` column (additive migration; in the
sync manifest), set on insert AND refreshed on resubmit (mirroring `judge_scores.submitted_at`),
also stamped by the paper-score insert path and round-tripped through meet import/merge.

**Advanced meet settings panel (item 10).** New **Advanced** button next to Edit Meet Settings
on the meet page opens `AdvancedSettingsModal` (`MeetDetail.jsx`). Four settings, all accepted by
`PUT /api/meets/:id`, all copied on clone, all round-tripped through export/import
(`executeImport` meets INSERT + `executeMerge` meets UPDATE with `?? default` legacy tolerance):
- **10a `meets.nj_rule_enabled` (default 0 = OFF).** Gates the v1.29.00 FS-18 chop/NJ rule
  meet-wide. When off: the J3 NJ panel (JudgeTablet), the HJ Set/Clear NJ toggles
  (HeadJudgeTablet), the Scoring-tab NJ checkboxes, and the paper-modal NJ checkboxes are all
  hidden, and the server refuses `POST /:matchId/nj` (clearing an existing call stays allowed).
  Read side untouched: historical `nj_call` data still displays (banners/badges are
  data-driven). The paper-score backstop permits NJ flags on a match that already carries an
  `nj_call` so historical edits don't dead-end. Flags ride `GET /dual/active-match` for tablets.
- **10b `meets.air_tie_allowed` (default 0 = NOT allowed).** When off, the J3 **Air Tied** button
  and the paper-modal checkbox are hidden and the server refuses `air_tied` submissions (both
  judge-points and paper-score; a match with an existing air-tied row may be re-saved). Time
  Tied (J4) unaffected.
- **10c `meets.start_run_timekeeper` / `start_run_head_judge` / `start_run_chief` (default all
  1 = ON).** UI gating only (tablets stay on public endpoints per the access model): each flag
  controls whether Start Run + its DNS companion render on that surface (TK tablet via
  `/runs/info`, which now joins the meet flags; HJ tablet via the event GET's new
  `meet_settings` block, incl. the dual next-pairing Start Run; Officials Scoring tab incl. the
  manual-start form and dual Start Match). **Failsafe:** if all three are off, the Scoring tab
  keeps its button (and the panel warns) so a meet can never be locked out.
- **10d Venue adoption (relocated).** The Remote Judging checkbox moved out of Edit Meet
  Settings into the Advanced panel as **"Allow venue server adoption"** (default ON = checked ⇔
  `remote_judging=0` — inverted label, same column, all v2.0.00 semantics preserved: refused by
  release-for-adoption when disallowed, locked once adopted via the adoption-lock middleware /
  disabled Advanced button). `remote_judging` also now round-trips import/merge/clone.

**Sync protocol v2.** The five new `meets` columns + `dual_judge_points.submitted_at` were added
to the manifest in `server/sync/protocol.js` (they change venue scoring/UI behavior, so they must
ride the adoption package, upsync, and checksums — NOT `NON_SYNC_COLUMNS`), and
**`SYNC_PROTOCOL_VERSION` bumped 1 → 2**: column additions change row canonicalization and table
checksums, so a mixed-version pair would fail check-in mysteriously — the version gate makes an
outdated venue refuse adoption cleanly instead. No Pi image is published yet, so no fielded
device is stranded.

**Other server touches.** `GET /api/meets/:meetId/events/:id` (events.js) now attaches a
`meet_settings` object; `GET /runs/info` carries `start_run_timekeeper`/`start_run_head_judge`.
New api.js helper `abandonRun`.

**Verification.** 59-check scratch-server integration test walking every fix: Issue 3
(reject→no-resubmit→approve 400 with breakdown; reject→resubmit→approve publishes the fresh
recomputation), Issue 5 (finalize blocked while scoring; a hand-injected duplicate complete row
leaves 1/3 distinct athletes → 400; passes at 3/3), Issues 4+6 (409 duplicate incl. status-only
and complete-run wording, 409 concurrency naming the on-course bib, paper-mode exemption +
still-guarded duplicates, abandon deletes scores + audit row + refuses complete runs), 7a
(1.4000000000000004 → 1.4), 7c (`edit_after_finalization` audit row), D-1 (override allowed on
hj_pending with `dual_manual_winner` audit carrying points state + contradiction flag; complete
match → 409; `force` works), D-2 (400 into complete match), NJ/Air-Tied gating end-to-end
(refused by default, allowed after enabling, flags on active-match), `submitted_at` populated +
import round-trip, Advanced settings PUT/clone/export→import round-trip, `/runs/info` +
`meet_settings` flags, double-boot migration idempotence, venue-mode boot with
`protocol_version: 2`. Harness: step0 87/87 (incl. the manifest drift test against the migrated
schema), step2 58/58 (adoption package + cloud↔venue checksum parity), step4 52/52 (upsync; one
timing-flaky latency-gate run under load passed clean on rerun). `verify_v16.js` 123/123. Help
topics updated (meets-edit Advanced-panel table, events-dual NJ/air-tie gating, tablet-dual,
tablet-hj dual confirm + DSQ + finalize gating + start-run behavior, tablet-time, scoring-manual
guard rails + Abandon Run) and guide PDFs regenerated.

**Files created:** none (all additive edits)
**Files modified:** `server/routes/runs.js`, `server/routes/phases.js`, `server/routes/dual.js`,
`server/routes/meets.js`, `server/routes/events.js`, `server/db/schema.js`,
`server/sync/protocol.js`, `client/src/pages/HeadJudgeTablet.jsx`,
`client/src/pages/TimekeeperTablet.jsx`, `client/src/pages/JudgeTablet.jsx`,
`client/src/pages/EventDetail.jsx`, `client/src/pages/MeetDetail.jsx`, `client/src/utils/api.js`,
`client/src/help/topics/{meets-edit,events-dual,tablet-dual,tablet-hj,tablet-time,scoring-manual}.md`,
`server/public/docs/guides/*.pdf` (regenerated), `server/version.js`,
`client/src/components/Layout.jsx`, `client/package.json`, `server/package.json`,
`server/public/*` (rebuilt), `CLAUDE.md`

---

## v2.0.03 Feature Notes

### Set Run Order Button on Phase Cards (v2.0.03, hotfix)

Second RMF Mock live blocker (08-30-26): Run 1 finalized but no way to set Run 2's order.
Root cause: the run order of a later phase is only choosable inside the "+ Add Next Phase"
dialog — but the mock meet's import zip pre-created BOTH phases ("Run 1" + a "Run 2"
best_of_2 phase with an EMPTY `phase_run_order`), so the Add button never appears and there
was literally no button anywhere to (re)build the order. Any imported meet with pre-built
future phases hits this.

**New endpoint `POST /api/events/:eventId/phases/:phaseId/rebuild-order`** (requireAuth +
lockCheck via the router guards) body `{ run_order_method }`. Guards: 404 unknown; 400 for
run 1 / sequence 1 ("managed on the Registration tab"), finalized/hj_review phases, and any
phase whose run_number already has runs rows (started). Recomputes eligibility + prior
ranking exactly like phase creation via the new shared helper `computeEligibleForPhase()`
(the eligibility block was extracted verbatim from POST /phases — creation path
regression-tested), rebuilds via `buildRunOrder`, replaces the phase's `phase_run_order`
rows, updates `run_order_method` if changed, broadcasts `phase_created {rebuilt:true}`.

**Client (Phases tab, `HeatsPanel`):** not-started later phases get a blue **Set Run Order**
button → inline method chooser (16 down / last-to-first / random / same) + **Apply Order**.
An amber "No run order set for {label}" banner shows when a not-started later phase has 0
athletes in `phase_run_order`. New `api.rebuildPhaseOrder`.

**Verification:** scratch server + the actual `RMF_Mock_Comp_08-30-26.zip`: rebuild on the
empty Run 2 → count 10, `/runs/upcoming?run_number=2` populated; rebuild on Run 1 → 400;
refactored "+ Add Next Phase" best_of_2 creation still retro-creates Run 1 (total 10) +
builds Run 2 order (total 10). `verify_v16.js` passes.

**Files modified:** `server/routes/phases.js`, `client/src/pages/EventDetail.jsx`,
`client/src/utils/api.js`, `server/version.js`, `client/src/components/Layout.jsx`,
`client/package.json`, `server/package.json`, `server/public/*` (rebuilt), `CLAUDE.md`

---

## v2.0.02 Feature Notes

### Per-Judge PIN Enforcement Removed (v2.0.02, hotfix)

Live-lockout hotfix during the RMF Mock remote test comp (08-30-26): every judge got
"Invalid PIN" on score submit. The lone enforcement site — `POST /:runId/scores` in
`server/routes/runs.js` — still rejected cloud-mode submits when the judge row carried a
`pin` value and the tablet didn't send a matching `?pin=` query param. The RMF Mock meet's
judge rows had PINs because the meet was built from the Winfree season-import zip, whose
judge rows carry `pin` values through `executeImport`/`executeMerge` (`meets.js`).

**Fix:** the PIN check is deleted outright — per-judge PINs are no longer enforced
anywhere. This matches the documented access model (tablets are public, secured only by
unguessable short-code URLs) and FR-16 (venue mode already bypassed PINs via Crew PIN +
seat claim). The `judges.pin` column, import round-trip, and the tablet's optional `?pin=`
param are all left in place — the value is simply ignored. Server-only change; the client
bundle was NOT rebuilt (the Layout.jsx useState default bump is cosmetic-only).

**Files modified:** `server/routes/runs.js`, `server/version.js`,
`client/src/components/Layout.jsx`, `client/package.json`, `server/package.json`, `CLAUDE.md`

---

## v2.0.01 Feature Notes

### Case-Insensitive Login Fix + Password UX (v2.0.01, cloud auth only)

Fixes the live lockout reported 08-29-26 (`stickit-login-issue-08-29-26.md`): Alex could not
log in because iOS keyboards auto-capitalize the first letter of the username field, and the
login lookup was case-sensitive. Root cause: `admin.js` always STORES usernames
`trim().toLowerCase()`, but `POST /api/auth/login` looked up the raw submitted value with a
case-sensitive SQL `=` (no COLLATE NOCASE on `users.username`), so "Alex" never matched the
stored "alex" — and attempts to store "Alex" reverted to lowercase, closing off the workaround.

**Everything in this release is cloud-only by construction.** Venue mode never renders
`Login.jsx` and never executes `POST /api/auth/login` (`requireAuth` branches to
`venueRequireControl`/PINs first); the one shared artifact — a new `users` column — is inert in
venue mode, and `users` is NOT in the sync manifest, so no protocol impact. Nothing under
`server/venue/`, `server/sync/`, or `server/middleware/auth.js` was touched.

- **Case-insensitive login.** `POST /login` normalizes the submitted username
  (`trim().toLowerCase()`) before both the throttle key and the SQL lookup — case can never
  decide a login. Belt-and-suspenders idempotent migration lowercases any hand-edited stored
  usernames. The Login page username input gains `autoCapitalize="none" autoCorrect="off"
  spellCheck={false}` (same on the AdminUsers username input) so mobile keyboards stop
  capitalizing in the first place.
- **Show-password toggle.** New shared `client/src/components/PasswordInput.jsx` (eye/eye-off
  button, caller-supplied styling) used on the Login password field, the AdminUsers password
  field, and all three ChangePasswordModal fields.
- **Editable username in admin.** `PUT /api/admin/users/:id` accepts `username` (normalized,
  non-empty + uniqueness checks → 400/409, audit `username_changed` with old/new). Existing
  sessions survive a rename (JWT `sub` is the user id). AdminUsers modal username field is no
  longer disabled on edit.
- **Forced password change on first login (David's rulings: mandatory/blocking; fires for new
  accounts + admin resets only).** New `users.must_change_password INTEGER NOT NULL DEFAULT 0`
  column. Set on `POST /users` with a password and on `PUT /users/:id` password resets —
  EXCEPT an admin resetting their own password (`req.user.id === target`; also not set when
  auth is off/req.user absent, protecting the AdminSecurity bootstrap flow). Returned on the
  login response and `GET /me` (queried in the /me handler, not requireAuth, so the venue
  fabricated user resolves 0). `POST /change-password` clears it. Client: `Layout.jsx` +
  `AdminLayout.jsx` render `<ChangePasswordModal forced />` (no cancel/close, explanatory
  copy) whenever `authEnabled && user.must_change_password` — blocking, survives refresh and
  covers mid-session admin resets via `/me`; on success the modal refreshes auth context and
  unmounts.
- **Min 8 characters (raised from 6)** for all user-chosen passwords (`/change-password` +
  modal) and, for consistency, admin-set passwords (POST/PUT /users + AdminUsers client check).

**Verification.** 41-check scratch-server integration test (protection enabled via the real
admin flow): login as `david`/`David`/`DAVID`/` david ` all succeed vs stored lowercase, wrong
password still 401; forced-change lifecycle (7-char refused, 8-char clears flag, reset
re-forces, self-reset doesn't); username rename (normalized, dup 409, empty 400, old name dead,
token survives, audit rows); protected endpoints still 401; double-boot migration idempotence;
venue-mode boot regression (`/api/venue/status` mode=venue). `verify_v16.js` 123/123.

**Files created:** `client/src/components/PasswordInput.jsx`
**Files modified:** `server/routes/auth.js`, `server/routes/admin.js`, `server/db/schema.js`,
`client/src/pages/Login.jsx`, `client/src/components/ChangePasswordModal.jsx`,
`client/src/pages/admin/AdminUsers.jsx`, `client/src/components/Layout.jsx`,
`client/src/components/AdminLayout.jsx`, `server/version.js`, `client/package.json`,
`server/package.json`, `CLAUDE.md`

---

## v2.0.00 Feature Notes (RELEASED 08-26-26)

### Local Venue Server + One-Way Cloud Sync (v2.0.00)

Implements `StickIt_v2.0_Local_Venue_Server_Design_Plan_08-21-26.md` (Revision 4).
Build progress + per-step test results: `docs/V2_PROGRESS.md`. Protocol contract:
`docs/SYNC_PROTOCOL.md`. Test harness: top-level `harness/` (R16 — dev-Mac only,
never deployed, excluded from release zips). Rollback point: tag `v1.30.03` on main.

**Step 0 — Foundations (complete).**
- `server/sync/protocol.js`: `SYNC_PROTOCOL_VERSION = 1` (R12) + the version-pinned
  per-table column manifest (FR-6) for 19 tables + `selectForMeet()` meet-scoping SQL
  (incl. FR-8 registered-athletes scope) + canonical value serialization and
  row/table SHA-256 checksums, computed identically on both sides in pure JS.
  Any future migration touching a manifest table must update the manifest (the
  harness drift test fails otherwise) and consider a protocol version bump.
- `server/venue/mode.js`: `isVenueMode()` — `STICKIT_MODE=venue` selects venue mode;
  cloud mode is the default and byte-for-byte unchanged (D4).
- New `GET /api/venue/status` → `{ mode, protocol_version, version }` (FR-13
  detection endpoint; `/api/version` deliberately untouched so its response stays
  byte-identical to v1.30.03).
- FR-11: `judge_scores` gets `UNIQUE INDEX idx_judge_scores_run_judge_type
  (run_id, judge_id, score_type)` — created OUTSIDE the error-swallowing migration
  loop after a dedup that keeps the most recent duplicate (`submitted_at` DESC,
  rowid DESC), loud non-fatal logging; the tablet score-submit INSERT in
  `server/routes/runs.js` retries as an UPDATE on constraint violation so racing
  judge submits never see an error. Additive — a v1.30.03 build runs cleanly
  against the migrated DB.
- Harness foundations: two-instance driver (real server child processes, scratch
  file DBs, cloud+venue modes, kill/restart for crash tests) + Playwright layer
  (FR-21). Step-0 suite: 84/84; `verify_v16.js` 123/123.

**Step 1 — Remote judging flag + cloud lock machinery (complete).**
- Additive `meets` columns for adoption/lock state (`adoption_status`, `adopted_at`,
  `sync_token_hash`, `last_sync_at`, `last_applied_seq`, `remote_judging`,
  `release_code_hash`, `release_code_expires_at`, `released_at`, `released_by`) —
  excluded from the sync manifest via `NON_SYNC_COLUMNS` (transport state, not meet data).
- `server/middleware/adoptionLock.js` (`requireNotAdopted`, HTTP 423) mounted on the
  meet-scoped path prefixes in `index.js` BEFORE all routers — every mutation of an
  adopted meet, including public tablet endpoints and inline routes, is refused before
  any handler runs; reads stay open (live read-only mirror). In-route guards cover
  import merge/overwrite targets, athlete-import updates, usss-sync, reconcile/apply,
  and admin bulk athlete deletes (FR-8). FR-9: every boot-time mutation now excludes
  adopted meets' rows.
- Release for Adoption (R13): `POST /api/meets/:id/release-for-adoption` (one-time
  8-char code, hash-only storage, TTL default 24h, re-release + undo), public
  `GET /:id/adoption`, remote-judging meets refused (6.7; flag editable in Edit Meet
  Settings, locked once adopted). Admin force-unlock (R8) at
  `POST /api/admin/adoption/:meetId/force-unlock` (typed meet-name confirm,
  audit-logged, token invalidated) + new Admin → Venue Adoption page.
- FR-20: `server/utils/routeList.js` route enumeration behind `STICKIT_DEBUG_ROUTES=1`;
  the harness gate enumerates every mutation route (160), requires each to be in-scope
  or documented-exempt, and drives all in-scope routes (111) to 423 against an adopted
  meet. Cloud UI: read-only mirror banners on MeetDetail/EventDetail.
- Step-1 suite 52/52; cumulative harness 136/136; `verify_v16.js` 123/123.

**Step 2 — Adoption package + ID-preserving import (complete).**
- Cloud `/api/sync` (cloud mode only): `POST /adopt` — R12 handshake, atomic
  single-winner code redemption (burns the code, locks the meet, issues the sync
  token), 300ms drain, then the manifest-driven snapshot (`server/sync/package.js`,
  FR-6 — includes usss_people [R5] + meet logo base64). `POST /peek` validates a code
  without redeeming so re-adoption can offer "replace local copy" before the one-time
  code is burned (D8).
- Venue `/api/venue` (venue mode only): `POST /adopt` (code → cloud redeem → import →
  venue state in app_settings), `POST /import-package` (USB plan B).
  `server/sync/adoptionImport.js` is the ID-preserving importer: generic all-columns
  row copier from the FR-6 manifest (UUIDs/short codes/timestamps byte-for-byte),
  meet-keyed tables refuse if present (replace flag clears first via
  `clearMeetLocal`), athletes + usss_people upsert.
- USB plan B cloud side: `POST /api/meets/:id/export-for-adoption` sets the lock
  atomically at export (no lock-later window) and emits package + sync token as a file.
- Step-2 suite 57/57 incl. per-table checksum parity cloud↔venue for all snapshot
  tables; cumulative harness 193/193.

**Step 3 — Venue mode + home screen (complete).**
- Venue API: two-PIN model (R3; Control session token gates officials mutations via
  a venue variant of requireAuth — FR-14: token lives in `stickit_auth_token` and
  rides `authHeaders()`), seat registry J1–J7 (R1: free claim, taken shown taken,
  Control force-release), FR-15 auto-follow role targets (seats/HJ/timekeeper/
  scoreboard resolve the active event live; tracker fed from `app.broadcast` in
  venue mode + DB fallback), permanent `/overlay` with operator pin override (R4),
  Connection Info with QR + numeric overlay URL (D3). FR-16: per-judge pins
  bypassed in venue mode.
- Client: venue home screen (role menu, adopt-by-code, USB import, PIN setup),
  iframe role wrappers (role pages untouched), FR-10 freeze screens (states wired;
  server sets them in Step 5), device role memory with reboot-return, FR-13 root
  switch, venue overlay-pin control on the Scoring tab, voice-offline notice (6.6).
- FR-18: ALL fonts self-hosted via @fontsource (`client/src/fonts.js`); Google
  Fonts CDN links removed from index.html/PublicLayout/Overlay; venue pages make
  zero external-origin requests (Playwright-verified). NOTE: build+package must
  now copy the font files in `client/dist/assets/` too (~4MB); the release zip
  will exceed the old ~3MB guideline (~7MB expected).
- Step-3 suite 54/54 (HTTP + Playwright); cumulative harness 247/247.

**Step 4 — Upsync (complete).**
- FR-5 write capture as a schema.js write hook (venue-only; cloud's only change
  is a null check): pre-image SELECTs before non-PK deletes/updates, REPLACE
  displacement handling under non-PK UNIQUE keys, post-image reads so recorded
  rows are what actually landed, batch() coverage, loud full-table-diff
  fallback. `sync_outbox` (seq-ordered, FR-17: never wall-clock).
- Event-driven worker (R14): wake-on-append, ≤500ms batching, ≤2MB size-aware
  chunks, backoff only while offline (1s→30s, reset on success), delete-after-ACK,
  410 revoked → permanent stop (R8). Cloud apply endpoint: token auth,
  last_applied_seq idempotency, manifest-columns-only ON CONFLICT upserts (cloud
  lock state untouched), FR-19 per-event `sync_applied` WS nudge. Path-scoped
  64MB JSON body limit for /api/sync + /api/venue only.
- Gates passed: FR-7 outbox audit (replay ≡ venue DB across all 18 sync tables
  after a full simulated meet incl. rejections, dual bracket, phase REPLACE
  displacement, cascade deletes), outage + repeated-short-outage recovery with
  checksum equality, R14 latency ~0.4s, viewer-API parity (FR-23 normalized).
- Step-4 suite 52/52; cumulative harness 299/299.

**Step 5 — Check-in, handback, snapshots (complete).**
- Check-in/handback (R7/D8/FR-10): venue freezes first (server-side 423 guard +
  role-page stop screens), final flush, per-table checksums verified on BOTH
  sides, cloud never unlocks on mismatch (auto-repush of differing tables +
  re-verify), checkin → 'checked_in' permanent record / handback → NULL for
  overnight cloud bracket building; every venue failure path reverts cleanly
  to 'adopted'. R11 USB snapshot worker (5-min, graceful degrade + warning).
  VenueHome end-of-day actions + revoked/snapshot banners.
- Two-day cycle, FR-10 freeze, R7 mismatch, crash test (SIGKILL + outbox
  continuity + role memory), snapshots — all green. Step-5 suite 39/39;
  cumulative harness 338/338.

**Step 6 — Packaging + docs (complete).**
- `server/scripts/build_pi_image/`: pi-gen build script, provisioning (Node 22,
  systemd `stickit-venue.service` with Restart=always, Avahi `stickit.local`,
  NTP + fake-hwclock [FR-17], STICKIT-SNAP snapshot auto-mount [R11], sudoers
  hook), Imager os_list catalog template, README. Routine update: home-screen
  Update button (`/api/venue/update-check` + `/update`, refused while a meet is
  adopted) + `update-stickit.sh` SSH fallback.
- Printed volunteer material generator (`server/scripts/venue_cards/
  build_venue_docs.js`, pdfkit + qrcode → `server/public/docs/venue/`): venue
  card with QR, run sheets 1–5, pre-event checklist (UniFi + Starlink),
  Mac-fallback sheet. `docs/VENUE_MAC_FALLBACK.md` (R9) + `docs/VENUE_OPS.md`
  (Section 10 rollback incl. mid-adoption case). Step-6 suite 29/29.

**Release gates (Section 11) — ALL GREEN, full suite 398/398.**
- Regression gate: v2 vs a real v1.30.03 worktree, identical cloud-only API
  responses after FR-23 normalization; ranked totals numerically identical.
- Rollback gate: v1.30.03 boots + scores against the v2-migrated DB; v2 boots
  again after. Scratch-Turso gate (FR-22): full adopt→outage→replay→check-in
  against local sqld. Plus (earlier steps): FR-7 outbox audit, FR-20 generated
  lock coverage (111 routes), viewer parity, R14 latency ~0.4s, two-day cycle,
  crash tests. `verify_v16.js` 123/123 throughout.

**Independent review fixes (08-23-26) — complete, suite 464/464.** All 38
findings of `StickIt_v2_Review_Findings_08-23-26.md` worked in order
(C-1 → H → M → L); per-finding record, disputes, and deviations in
`docs/V2_REVIEW_FIXES_08-23-26.md`. Key behavior changes: interrupted check-in
self-heals at boot and `/checkin` retries from `checking_in` (C-1);
lost-response check-in reconciles via the public adoption probe (H-1);
`checked_in` meets are re-adoptable/force-unlockable (H-2); repush never
deletes master-table rows (H-3); outbox is meet-scoped + cleared at adoption
and cloud `/changes` validates scope/null-pks and refuses meets deletes
(H-4/M-3); worker resets on re-adoption + new `POST /api/venue/abandon` (H-5);
outbox parser tolerates literal-value INSERTs — zero full-table fallbacks,
`GET /api/venue/capture-stats` (H-6); freeze guard covers `/api/admin` +
`/api/usss` (H-7); backup restore is adoption-aware (H-8); `apiFetch` errors
carry `message`/`code`/`body` — day-2 replace dialog works (H-9/M-13);
snapshots verify a real USB mount + use VACUUM INTO (H-10); Pi image has SSH
(user `stickit` / `stickitvenue` default, `STICKIT_PI_PASSWORD` override)
(H-11); `jump_dd_table` rides the adoption package replace-all (M-4 — manifest
gained a 20th, snapshot-only table); adoption import is one atomic batch
(M-5); check-in has a write barrier (M-6); delete/update capture pre-image is
atomic with the write (M-7); worker deletes 422-acked prefixes and the cloud
resolves unique-key conflicts (M-8); venue PINs throttled + Control token
rotates at final check-in (M-9); `/update` is Control-gated, refuses
handed_back, semver-compared (M-10); systemd unit pins
`LIBSQL_URL=file:/opt/stickit/data/scoring.db` and STICKIT_SNAPSHOT_REQUIRE_MOUNT
(M-11/H-10); auto-follow takes over stale holders + clears on finalize (M-14);
FR-8 covers from-usss restore / admin restore / CSV import / export-bibs
(M-16). New harness suites `review.test.js` + `review-ui.test.js`.

**Step 7 (optional tablet submission buffering): DEFERRED** — touches the live
judge-tablet submit path (constraint 1) for marginal venue benefit; plan
explicitly allows deferral. Revisit post-release.

**Cloud ultra review (08-26-26) — passed, suite 465/465.** Anthropic's
multi-agent cloud review over the full v2 shippable source (54 files / 6,426
lines; run from a temporary source-only branch because committed build assets +
harness push the raw branch diff past the tool's 8k-line limit — recipe in
`docs/V2_PROGRESS.md`). ZERO functional/data-loss/security defects; two nits
fixed in `00a8e7b`: the FR-10 freeze screen now exempts the read-only
`scoreboard` role (broadcast carve-out matching Overlay — a venue results TV
stays live through check-in/handback), and AdminAdoption's force-unlock
mismatch handler checks `e.code` (H-9 shape) instead of `e.message`. step5
gained a scoreboard-stays-live assertion (39 → 40).

**Released 08-26-26** (David's ruling: release BEFORE the physical confirmation
run — the plan's intent; tag `v1.30.03` on origin is the one-click Render
rollback). The physical confirmation run (Section 11 item 10) is now a
post-release validation, scripted in `~/Desktop/Scoring Server/StickIt 2.0
Testing Instructions.docx`. Publishing the Pi image (.img.xz) to GitHub
Releases + the Imager os_list can follow the successful run.

---

> **Older version notes (v1.7.00 – v1.30.03):** See [CHANGELOG.md](CHANGELOG.md)

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
