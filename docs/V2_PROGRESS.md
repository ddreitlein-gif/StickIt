# StickIt v2.0 — Build Progress

Governing plan: `~/Desktop/Scoring Server/StickIt_v2.0_Local_Venue_Server_Design_Plan_08-21-26.md` (Revision 4).
All work on branch `v2`. Baseline `main` tagged `v1.30.03` (local tag — push at release).
**On session start: read this file first.** If earlier steps are committed, re-run their
harness suites (`cd harness && node run.js <stepN>`) plus `node server/scripts/verify_v16.js`,
then resume at the first incomplete step.

Harness setup (one-time): `cd harness && npm install && npx playwright install chromium`.
Run: `node run.js` (all suites) or `node run.js step0` (filtered by filename).

---

## Step 0 — Foundations ✅ COMPLETE

**Built:**
- Branch `v2` created from `main` (be70b9d); tag `v1.30.03` set locally on that commit
  as the rollback point (deliberately not pushed — only `main` pushes deploy; David
  pushes the tag at release).
- `server/sync/protocol.js` — `SYNC_PROTOCOL_VERSION = 1`; version-pinned per-table
  column manifest (FR-6) for 19 tables (17 meet-scoped + audit_log [FR-12, sync-only,
  no checksum/snapshot] + usss_people [R5, snapshot-only]); `selectForMeet()` meet-scoped
  row selection per table (incl. FR-8 registered-athletes scope for `athletes`);
  canonical value serialization + row/table SHA-256 checksums computed in pure JS.
  Column lists generated from a freshly-migrated scratch DB, then pinned as literals.
- `server/venue/mode.js` — `isVenueMode()` (`STICKIT_MODE=venue`).
- `GET /api/venue/status` (new endpoint in `server/index.js`) returning
  `{ mode, protocol_version, version }`.
- FR-11 in `server/db/schema.js`: dedup of duplicate `judge_scores`
  (run_id, judge_id, score_type) rows keeping the most recent (`submitted_at` DESC,
  rowid DESC), then `CREATE UNIQUE INDEX idx_judge_scores_run_judge_type` — both
  OUTSIDE the error-swallowing migration loop, loud console.error on failure, non-fatal.
  `server/routes/runs.js` POST `/:runId/scores` INSERT wrapped in constraint-violation →
  re-query → UPDATE retry, so a racing judge tablet never sees an error.
- `docs/SYNC_PROTOCOL.md` — full protocol spec: versioning/handshake, endpoints + message
  shapes (adopt / changes / checksums / checkin / repush), lock-first adoption order,
  canonicalization rules, manifest table + exclusions, outbox DDL + capture rules (FR-5),
  FR-23 regression normalization spec (per-corpus UUID/short-code aliasing, timestamp
  collapse).
- `harness/` (R16): `lib/instance.js` (spawn real server child processes on scratch file
  DBs, cloud/venue modes, stop/kill/restart for crash tests), `lib/client.js` (HTTP
  driver), `lib/db.js` (direct scratch-DB assertions), `lib/browser.js` (Playwright
  layer, FR-21: `withPage` + `newTablet` persistent-context = one physical tablet),
  `lib/checks.js` (verify_v16-style check counting), `run.js` (suite runner, fresh
  `.scratch/` per run, non-zero exit on failure). `harness/.gitignore` excludes
  node_modules + .scratch.

**Tested (harness/tests/step0.test.js — 84/84 passed):**
- Two-instance boot (cloud :3101 + venue :3102, scratch DBs), health on both.
- `/api/venue/status` mode per instance; protocol version; `/api/version` response
  shape unchanged (single `version` key).
- Manifest drift: pinned manifest === PRAGMA table_info on freshly-migrated DB for all
  19 tables; pk ⊆ columns; sync/checksum/snapshot set membership; `selectForMeet`
  executes for every snapshot table.
- Checksum determinism: row-order independence; non-manifest (orphan) columns ignored;
  value-change detection; NULL vs empty-string distinction; -0/int/float canonical forms;
  composite pkOf.
- FR-11: index exists on fresh DB; legacy DB with pre-index duplicates deduped on boot
  (most recent kept) + index created; 8 concurrent same-key score submits → all 200,
  exactly 1 row.
- Playwright smoke: SPA loads in Chromium, #root mounts.
- `node server/scripts/verify_v16.js`: 123/123 PASSED.

**Implementation choices (per plan closing instruction):**
- `/api/venue/status` as a NEW endpoint (not a `/api/version` field) — keeps the
  v1.30.03 `/api/version` response byte-identical for the regression gate (FR-13
  explicitly allows either).
- audit_log: synced (FR-12) but excluded from checksum (cloud holds pre-adoption rows
  for the same meet) and from the adoption snapshot (venue starts its own trail).
- Cloud-only adoption-state columns on `meets` (arriving in Step 1) will be excluded
  from the manifest — transport state, not meet data; the drift test will carry the
  documented exclusion list from Step 1 on.
- FR-11 index failure is loud but non-fatal (a failed index must never block a
  production boot; the app-level upsert still functions).

## Step 1 — Remote judging flag + cloud lock machinery ✅ COMPLETE

**Built:**
- `meets` columns (additive, in NON_SYNC_COLUMNS exclusion list): `adoption_status`,
  `adopted_at`, `sync_token_hash`, `last_sync_at`, `last_applied_seq`, `remote_judging`
  (default 0), `release_code_hash`, `release_code_expires_at`, `released_at`, `released_by`.
- `server/sync/adoption.js` — adoption-state helpers: `isMeetAdopted`, `meetIdForEvent`,
  `meetIdForTrainingDay`, `adoptedMeetForAthlete` / `isAthleteAdoptionLocked` /
  `athleteIdsLockedByAdoption` (FR-8), `generateReleaseCode` (8 chars, A-Z2-9 minus
  0/O/1/I), `hashToken` (SHA-256; codes and tokens stored hash-only).
- `server/middleware/adoptionLock.js` — ONE `requireNotAdopted(resolver)` middleware
  (HTTP 423 `meet_adopted`; GET/HEAD/OPTIONS always pass). Mounted in `index.js` on the
  path prefixes `/api/meets/:meetId`, `/api/events/:eventId`, `/api/athletes/:athleteId`,
  `/api/training-days/:trainingDayId`, `/api/admin/events/:eventId`,
  `/api/admin/meets/:meetId` — BEFORE all routers, so every mutation (including public
  tablet endpoints and the three inline index.js routes) is guarded before any handler.
- In-route guards where prefix mounting can't reach: meet import merge/overwrite onto an
  adopted target (423); `/api/import/athletes[/csv]` eventId targeting an adopted meet
  (423) + locked-athlete update skip inside `importRow`; athletes `reconcile/apply` +
  `usss-sync` skip locked athletes (`skipped_locked` in response); admin bulk athlete
  delete filter always excludes locked athletes.
- Release for Adoption (R13): `POST /api/meets/:id/release-for-adoption` (requireAuth;
  refuses remote-judging meets 409; returns `{code, expires_at}`; re-release replaces the
  code; TTL `STICKIT_RELEASE_CODE_TTL_HOURS` default 24h), `POST /:id/unrelease`,
  public `GET /:id/adoption` state endpoint. Audit actions `meet_released_for_adoption`,
  `meet_release_undone`.
- Remote-judging flag (6.7): `PUT /api/meets/:id` accepts `remote_judging`; checkbox in
  the Edit Meet Settings modal; locked once adopted (via the general lock).
- Admin force-unlock (R8): `GET /api/admin/adoption` list +
  `POST /api/admin/adoption/:meetId/force-unlock` (typed exact meet-name confirm,
  audit `meet_force_unlocked`, clears adoption_status + sync_token_hash). Deliberately
  outside the guarded `/api/admin/meets/:meetId` prefix. New client page
  `AdminAdoption.jsx` (+ route `admin/adoption`, sidebar "Venue Adoption").
- FR-9 boot-mutation guards: dual_manual_entry clear (index.js), gender normalization
  (events + athletes), short-code backfills (meets/events/judges), bib backfill,
  usss_code migration, and `backfillAirScoreNoDd` all exclude adopted meets' rows /
  locked athletes.
- FR-20 enumeration: `server/utils/routeList.js` walks the Express stack;
  `GET /api/_debug/routes` exists only when `STICKIT_DEBUG_ROUTES=1` (harness sets it).
- Client: MeetDetail — adoption fetch + 15s poll while adopted, read-only mirror banner,
  released-state strip with Undo, Release for Adoption + New Release Code in More ▾,
  one-time code modal, key mutation buttons disabled when adopted; EventDetail — mirror
  banner. api.js helpers. Client rebuilt → `server/public/` (node-fs copy per CLAUDE.md).

**Tested (harness/tests/step1.test.js — 52/52; full harness 136/136; verify_v16 123/123):**
- Release lifecycle: code alphabet/format, hash-only storage, re-release, undo,
  double-undo 400, remote-judging refusal 409.
- FR-20 generated gate: 245 routes enumerated, 160 mutation routes, ALL classified
  (unclassified ⇒ suite fails), 111 in-scope routes each driven with adopted-meet params
  → all 423.
- Targeted: tablet score submit / HJ finalize / DNS status-only / meet rename → 423;
  reads still 200; control meet fully functional.
- FR-8: locked athlete PUT 423, unlocked 200; usss-sync skips; bulk-delete excludes;
  import guards; unrelease-while-adopted 423.
- Force-unlock: wrong name 400, exact name unlocks + clears token + audit row; mutations
  restored.
- FR-9: restart with adopted meet → adopted rows untouched (dual_manual_entry, gender,
  short_code, athlete gender), control meet normalized.

**Implementation choices:**
- Guard mounted at path-prefix level (not per-route): lock check runs before route
  matching/validation, and new routes under those prefixes are guarded automatically.
- Force-unlock path placed under `/api/admin/adoption/` so it can never be caught by the
  meets-prefix guard.
- Reads of adopted meets stay open everywhere (mirror is live by design).
- Adoption in step1 tests is set by direct DB update — redemption endpoint is Step 2.
## Step 2 — Adoption package + ID-preserving import ✅ COMPLETE

**Built:**
- `server/sync/package.js` — `buildAdoptionPackage(meetId)`: manifest-driven (FR-6)
  export of every SNAPSHOT table via `selectForMeet` + `manifestRow` (never SELECT *),
  plus usss_people snapshot (R5) and meet logo file as base64.
- `server/routes/sync.js` (cloud mode only, mounted at /api/sync):
  `POST /adopt` — protocol handshake (R12) → code hash lookup → expiry check →
  ATOMIC redemption (conditional UPDATE, single winner, FR-4; burns the code, sets
  `adoption_status='adopted'` + `sync_token_hash` + `last_applied_seq=0`) → 300ms
  drain → snapshot → returns `{sync_token, package}`. `POST /peek` — validates a code
  WITHOUT redeeming, so the venue can detect an existing local copy and offer the
  one-tap replace BEFORE the one-time code is burned.
- `server/sync/adoptionImport.js` — `executeAdoptionImport(pkg, {replace})`: generic
  all-columns row copier from the FR-6 manifest; refuses `meet_exists` for meet-keyed
  tables unless replace; UPSERTs athletes + usss_people (master rows survive);
  `clearMeetLocal(meetId)` (children-first manifest-driven delete) used by replace and
  by revert-on-error; logo file written; protocol-mismatch refusal.
- `server/routes/venue.js` (venue mode only, /api/venue): `POST /adopt` (peek →
  meet_exists check → redeem → import → store venue state), `POST /import-package`
  (USB plan B, token from the file). `server/venue/state.js` — venue-local adoption
  state in app_settings (venue_meet_id/sync_token/cloud_url/meet_state).
- USB plan B cloud side: `POST /api/meets/:id/export-for-adoption` (requireAuth) —
  lock set ATOMICALLY at export (no lock-later variant), package + sync_token as a
  downloadable JSON file.
- `/api/venue/status` enriched in venue mode: `adopted_meet`, `meet_state`, `cloud_url`.

**Tested (harness/tests/step2.test.js — 57/57; cumulative 193/193; verify_v16 123/123):**
- Full adopt cycle via real endpoints; cloud locked; code burned; venue status.
- Byte-for-byte parity: protocol checksums identical cloud↔venue for all 19 snapshot
  tables (populated: meets/events/athletes/registrations/judges/officials/course_specs/
  runs/judge_scores/training_days/exclusions/usss_people); short_code + created_at
  literal preservation; venue meets row carries NO lock state; logo round-trip.
- Handshake refusals (cloud adopt, venue import), expired code, wrong code,
  already_hosting, double redemption (code burned).
- Replace re-adoption (D8): meet_exists refusal WITHOUT burning the code (peek),
  replace discards local divergence, checksums match after replace.
- USB: export-for-adoption locks at export; import on fresh venue; checksum parity.

**Implementation choices:**
- Added `POST /api/sync/peek` (not in plan text, consistent with D8's one-tap
  re-adoption): without it, the meet_exists refusal would burn the one-time code.
- 300ms post-lock drain before snapshot (single-process Express; writes are short);
  post-lock writes are 423 and pre-lock writes are inside the snapshot either way.
- Venue keeps the raw sync token in local app_settings (local disk trusted, R3).
## Step 3 — Venue mode + home screen ✅ COMPLETE

**Built (server):**
- `server/routes/venue.js` additions: PINs (R3 — `GET /pins/status`, `POST /pins`
  [4-digit validation; change requires current Control token; token rotates],
  `POST /verify-pin` → Control session token / crew ok), seat registry (R1 —
  `venue_seats` venue-local table, `GET /seats` with per-seat judge mapping for the
  active event, claim/409-on-taken/release/force-release[Control token]),
  auto-follow role targets (FR-15 — `GET /role-target?role=judge|hj|timekeeper|
  scoreboard&seat=Jn` resolving the ACTIVE event + per-event judge by canonical
  seat→role order per discipline), permanent overlay target (R4 —
  `GET /overlay-target` honoring the operator pin, `POST /overlay-pin` [Control]),
  `GET /connection-info` (IPv4s, mDNS URL, complete numeric overlay URL for the
  YoloBox).
- `server/venue/active.js` — auto-follow tracker fed by a venue-mode hook in
  `app.broadcast` (run_started / dual_match_started take the spotlight) with DB
  fallback after restart (scoring run → active dual match → recent event).
- `server/middleware/auth.js` — venue variant (FR-14): in venue mode, requireAuth
  becomes venueRequireControl (pass-through until PINs set; then Bearer must equal
  the Control session token; attaches a local system_admin-equivalent identity);
  requireRole passes in venue mode. Cloud path byte-identical.
- FR-16: `judges.pin` check in runs.js score submit bypassed in venue mode.

**Built (client):**
- FR-18 self-hosted fonts: `client/src/fonts.js` imports all 7 families/weights via
  @fontsource; Google Fonts links removed from index.html, PublicLayout.jsx,
  Overlay.jsx. Zero external requests verified in Playwright. (Release-zip size note:
  bundled fonts add ~4MB to server/public/assets.)
- Venue pages: `VenueHome.jsx` (role menu, both states, adopt-by-code + USB file
  import + replace confirm, PIN setup card, PIN modals, seat picker with
  force-release, device-role-memory redirect), `VenueRole.jsx` (FR-15 iframe wrapper
  polling /role-target 3s — role pages themselves untouched; FR-10 freeze screens
  for checking_in/checked_in/handed_back; exit-to-menu affordance),
  `VenueOverlay.jsx` (permanent /overlay path — transparent iframe wrapper,
  auto-follow + pin, silent on errors), `VenueConnectionInfo.jsx` (QR via `qrcode`
  package + numeric overlay URL).
- `App.jsx` — FR-13 detection: root route swaps to VenueHome in venue mode; venue
  routes + bare /overlay registered only in venue mode.
- EventDetail Scoring tab: venue-only overlay pin control (R4). Voice modal (6.6):
  venue-mode plain-language offline notice appended to the unavailable screen.
- api.js venue helpers.

**Tested (harness/tests/step3.test.js — 54/54; cumulative 247/247; verify_v16 123/123):**
- PIN lifecycle; FR-14 401-without/200-with token; tablet endpoints public;
  FR-16 bypass; seat claim/conflict/force-release; role targets for all four roles;
  FR-15 auto-follow across an interleaved M/F day (every role); overlay pin
  override independent of role auto-follow; connection info; mode gating of
  /api/sync vs /api/venue.
- Playwright: venue menu renders; scoreboard tile PIN-free; crew PIN wrong/right →
  seat picker → claim → judge iframe; REBOOT-RETURN (new page, same context →
  straight back to the seat page); Control PIN → /dashboard → end-to-end officials
  mutation from the browser via stickit_auth_token; ZERO external-origin requests
  on venue pages (fonts offline); cloud root unchanged.

**Implementation choices:**
- Role auto-follow via full-screen IFRAME wrappers around the EXISTING role pages
  (URLs stay stable per FR-15; role pages untouched per Section 13). Overlay same.
- Seat→role mapping: canonical per-discipline orders (mogul TL1-3/Air1-2; dual
  DualTurns1/2/DualAir/DualTime/DualOverall; aerials AeJudge1-7; legacy aerials
  component order).
- Control token satisfies every role rank locally (LAN trusted, R3); venue never
  uses cloud accounts.
- Crew PIN is client-side page gating only (tablet endpoints stay public, V6).
## Step 4 — Upsync ✅ COMPLETE

**Built:**
- `sync_outbox` venue-local table (seq AUTOINCREMENT, meet_id, tbl, pk JSON, op,
  row_json, idempotency_key).
- `server/sync/outbox.js` — FR-5 write-capture layer implemented as a schema.js
  WRITE HOOK (`setWriteHook`; the only cloud-path change is one null check —
  cloud never installs it). Wraps `execute` AND `batch`. Per statement:
  UPDATE/DELETE (incl. non-PK predicates) take a pre-image SELECT reusing the
  statement's own WHERE (top-level-WHERE finder + trailing-args slicing);
  INSERT/REPLACE/IGNORE/ON-CONFLICT parse the explicit column list, pre-image
  displaced rows under non-PK UNIQUE keys (phase_run_order, dual_judge_points,
  judge_scores) and post-image the row that actually landed; unparseable SQL
  falls back to a loud full-table diff. Active only while venue_meet_state is
  adopted/checking_in (adoption imports are never captured). batch() captures
  pre-images first, runs the real atomic batch, post-images in statement order.
- `server/sync/worker.js` — event-driven (wake on append; 400ms batch window ≤
  R14's 500ms), size-aware batching (≤500 rows AND ≤2MB), exponential backoff
  1s→30s ONLY while the uplink is down (reset on success), ordering by seq,
  rows deleted only after cloud ACK, 410 → permanent stop (revoked, R8),
  `flushNow()` for check-in, `getSyncStatus()` for the home screen.
- Cloud `POST /api/sync/meets/:meetId/changes` — sync-token auth (401 bad token
  / 409 not adopted / 410 revoked-or-closed), protocol handshake, ordered apply
  with last_applied_seq idempotency (skip ≤), upserts via INSERT..ON CONFLICT
  DO UPDATE over MANIFEST columns only (cloud lock state + orphan columns
  never touched), partial-failure stop-and-report, per-event `sync_applied` WS
  nudge (FR-19), last_sync_at bookkeeping.
- Path-scoped `express.json({limit:'64mb'})` for /api/sync + /api/venue ONLY
  (registered before the global parser; every other route keeps the 100kb v1
  default — found via harness: large outbox batches 413'd otherwise).
- Home-screen sync status (`/api/venue/status.sync`): Up to date / N queued /
  Offline since HH:MM / revoked.

**Tested (harness/tests/step4.test.js — 52/52; cumulative 299/299; verify_v16 123/123):**
- FR-7 OUTBOX AUDIT GATE: full meet played against the venue with the cloud DOWN
  (mogul runs, HJ approve + reject/resubmit, DNS, full dual bracket 8 matches,
  best_of_2 phase + reorder → phase_run_order REPLACE displacement,
  run_round_status REPLACE, batch() reorders, athlete/bib/officials/course/meet
  edits, training-day exclusion toggle, scratch-event cascade delete) → 391
  outbox records replayed onto the post-adoption base ≡ live venue DB for ALL
  18 sync tables.
- Outage recovery: cloud restart mid-adoption → queue drains; mirror checksums ≡
  venue for every checksum table; cloud lock state survives meets upserts;
  idempotent replay (skip + no regression). 3 repeated short outages during
  active scoring → zero dupes/losses (checksums equal).
- R14 LATENCY GATE: HJ approval → visible on cloud in ~420ms (max), incl.
  immediately after an outage. FR-19 nudge received by a subscribed WS client.
- Auth: wrong token 401, protocol mismatch 409, post-force-unlock 410.
- VIEWER-API PARITY GATE: same script on venue-adopted (synced) vs directly
  cloud-scored meet → /status, /results, /results/scores, /rounds identical
  after FR-23 normalization (scores/runs arrays canonically sorted — order is
  not part of that endpoint's contract; documented in SYNC_PROTOCOL.md §8).

**Implementation choices:**
- Write capture as an execute/batch wrapper (single choke point) rather than
  per-route calls — the FR-7 audit gate proves coverage; route files untouched.
- Worker backoff max 30s so post-outage catch-up is never worse than 30s even
  without a wake signal; any new append wakes it immediately.
- 413-proofing via path-scoped body limits instead of raising the global limit.
## Step 5 — Check-in, handback, snapshots ✅ COMPLETE

**Built:**
- Cloud (`server/routes/sync.js`): `POST /meets/:id/checksums` (diagnostic
  compare), `POST /meets/:id/checkin` (mode checkin|handback — recomputes cloud
  checksums independently, NEVER unlocks on mismatch [R7], names differing
  tables; checkin → adoption_status='checked_in', handback → NULL [D8]; token
  cleared; audit-logged), `POST /meets/:id/repush` (full-table replace of
  named tables: delete-absent + manifest-only upsert).
- Venue (`server/routes/venue.js` `POST /api/venue/checkin`, Control token):
  FR-10 order — freeze ('checking_in') → final outbox flush (flushNow; offline
  → clean revert to 'adopted' with plain-language error) → checksums → cloud
  checkin → on mismatch AUTO-REPUSH of differing tables + one re-verify →
  local archive mark ('checked_in'/'handed_back'). Every failure path reverts
  to 'adopted' so scoring is never stranded.
- `server/venue/freeze.js` — FR-10 server-side venue freeze guard, mounted
  (venue mode only) on the meet-data prefixes: mutations 423 `venue_frozen`
  during checking_in and permanently after check-in/handback. /api/venue stays
  reachable (home screen + flow itself).
- `server/venue/snapshot.js` — R11 USB snapshot worker: 5-min cadence
  (STICKIT_SNAPSHOT_INTERVAL_MS override), copies db+wal to
  STICKIT_SNAPSHOT_DIR, keeps last 20, graceful degrade + home-screen warning;
  status always in /api/venue/status.snapshot.
- Client (VenueHome): End-of-day section — Hand Back to Cloud / Check In Meet
  (Control PIN + confirm + progress + error surfacing), revoked-adoption red
  banner, snapshot warning, handed-back morning note. Role pages' freeze
  screens (built in Step 3) now driven by the real states.

**Tested (harness/tests/step5.test.js — 39/39; cumulative 338/338; verify_v16 123/123):**
- TWO-DAY MEET CYCLE (Section 11 item 3): adopt → interleaved M/F singles day
  with every role auto-following each boundary + concurrent Scoring Computer
  work on the idle event (reorder + locally-printed results PDF mid-run) →
  handback (checksums verified; cloud archive ≡ venue) → duals bracket seeded
  ON THE CLOUD from synced singles results → re-release → one-tap replace
  re-adopt (bracket arrives; PINs survive) → duals day (4 matches) → final
  check-in ('checked_in'; archive ≡ venue; cloud editable; venue archival
  read-only).
- FR-10: tablet write after handback 423 `venue_frozen`; Playwright freeze
  screen ("checked in — stop").
- R7: direct checkin with bogus checksums → 409 + 17 mismatched tables named +
  cloud stays adopted. Tampered cloud runs table → venue flow auto-repushes
  `runs` and verifies.
- Crash test (item 9): SIGKILL mid-scoring during an outage → restart → run
  intact, outbox continuity (40 rows), drains after reconnect, tablet returns
  to its seat (role memory).
- R11: snapshots on the stick, latest snapshot opens and contains the meet;
  absent stick → home-screen warning.
## Step 6 — Packaging + docs — NOT STARTED
## Step 7 (optional) — Tablet submission buffering — NOT STARTED (may defer per plan)

---

## Full-suite status (Section 11)

Not yet runnable — items 1–9 accumulate as Steps 1–6 land. Item 10 (physical
confirmation run) is David's, after everything else passes.
