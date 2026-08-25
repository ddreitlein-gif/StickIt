# v2 Review Fixes — progress notes (08-23-26)

Working the findings from `StickIt_v2_Review_Findings_08-23-26.md` in strict order
(C-1 → H-1..H-11 → M-1..M-16 → L-1..L-10). Each finding was VERIFIED against the
current code before fixing; disputed findings are recorded below with the trace.

Status legend: ✅ fixed · ❌ disputed (not fixed) · ⏭ pending

## Critical
- **C-1** ✅ Verified real (only `setMeetState` callers are venue.js + state.js; nothing
  resets a persisted `'checking_in'` at boot; `/checkin` required exactly `'adopted'`).
  Fixed: venue boot resets `'checking_in'` → `'adopted'` (index.js, before the FR-9
  boot mutations); `/checkin` accepts retry from `'checking_in'`. Harness: `review.test.js`
  simulates process death mid-check-in (persisted `checking_in`, restart) → scoring
  resumes, retry succeeds; plus retry-while-`checking_in` without a reboot.

## High
- **H-1** ✅ Verified real. Fixed in `venue.js /checkin`: `cloudCompletedMode()` probes
  the public `GET /api/meets/:id/adoption`; reconcile runs on (a) flush-failed-revoked,
  (b) transport error on the checkin call, (c) 410 from the checkin call. When the cloud
  already committed the requested mode AND the meet's outbox is empty → finish locally
  (`reconciled: true`). When committed but local changes are pending → accurate
  `completed_with_pending_changes` error (never the false "revoked — call the office").
  The cloud-side idempotency record suggested as an option was not needed — the probe
  covers the scenario without new cloud state. Harness: lost-response simulation.
- **H-2** ✅ Verified real (`checked_in` had no writer back to NULL; adopt/export
  required `IS NULL`; force-unlock required `'adopted'`). Fixed: `/api/sync/adopt` and
  `export-for-adoption` accept `(adoption_status IS NULL OR 'checked_in')`; force-unlock
  accepts `checked_in`; zero-row redemption re-reads the row and reports a genuine race
  (`already_adopted`) vs `adopt_conflict` accurately. Harness: full checked_in →
  re-release → re-adopt cycle + force-unlock of checked_in.
- **H-3** ✅ Verified real (repush pruned `athletes` in TABLES order before
  registrations). Fixed: repush is upsert-only for master-scoped tables
  (`registered_athletes`/`global` scopes) — mirrors `UPSERT_TABLES` in adoptionImport.
  Checksum convergence is preserved: the athletes scope itself is corrected by the
  registrations repush, and every in-scope row is upserted with venue values.
- **H-4** ✅ Verified real. Fixed: (a) both venue adoption paths clear `sync_outbox`
  before `setVenueState` (`clearOutboxForNewAdoption`); (b) worker SELECT/DELETE are
  `WHERE meet_id=?` and `getSyncStatus` counts only the adopted meet; (c) cloud
  `/changes` validates every change with `changeInMeetScope()` (per-scope parent-chain
  resolution; master tables upsert-allowed / delete-refused — no venue path hard-deletes
  athletes or usss_people, verified by grep; deletes of absent rows are allowed as
  no-ops) and rejects null-pk upserts/deletes (`null_pk` / `out_of_scope` 422 failures).
- **H-5** ✅ Verified real. Fixed: `worker.reset()` clears revoked/offline/backoff and
  both adoption paths call it; new Control-PIN `POST /api/venue/abandon` clears venue
  state + outbox + worker state (audit-logged). Harness: force-unlock → revoked →
  abandon → re-adopt in the same process → run reaches the cloud.
- **H-6** ✅ Verified real (old `parseInsert` required all-placeholder VALUES; ~20 hot
  INSERTs mix literals: Start Run, status-only DNS, manual entry, forerunner,
  run_round_status finalize family, dual bracket shell, phases). **Deviation from the
  fix guidance:** instead of rewriting the ~12 offending INSERTs (option a), the parser
  was extended to tolerate literal tokens (option c, listed as optional): a real tuple
  tokenizer maps `?` placeholders to args and parses number/string/NULL literals;
  function tokens (`datetime('now')`) become UNKNOWN, which is harmless in non-key
  positions (the post-image read supplies the landed value) and forces the fallback if
  it ever lands in a pk/unique-key position. This fixes every current site AND future
  statements without touching live scoring code (constraint 1). Also fixed: the
  fallback now logs loudly and increments a counter; new `GET /api/venue/capture-stats`;
  harness gate asserts zero fallbacks across a full simulated meet (82 captured
  statements, 0 fallbacks). Option (d) (meet-scoping fullTablePre) was skipped — the
  fallback should now never fire, and the loud log + gate would catch a regression.
- **H-7** ✅ Verified real. Fixed: freeze-guard prefix list now includes `/api/admin`
  and `/api/usss`. `/api/venue` deliberately stays outside (check-in flow, abandon,
  home screen).
- **H-8** ✅ Verified real. Fixed: backup restore in venue mode refuses while
  `venue_meet_state` is `adopted`/`checking_in`; in cloud mode it refuses when adopted
  meets exist unless `acknowledge_adoptions: true`, naming the meets.
- **H-9** ✅ Verified real (`apiFetch` threw `err.error` as the message; the VenueHome
  regex could never match). Fixed: `apiFetch` prefers `err.message`, attaches
  `code`/`body`/`status`; VenueHome branches on `e.code === 'meet_exists'` (both adopt
  and USB import) and `e.code === 'pin_incorrect'`. Playwright: `review-ui.test.js`
  drives the real day-2 re-adoption through the built UI and asserts the replace
  confirm dialog appears and completes.
- **H-10** ✅ Verified real. Fixed: snapshot.js verifies the target is a real
  mountpoint (`st_dev` differs from parent) when `STICKIT_SNAPSHOT_REQUIRE_MOUNT=1`
  (set in the Pi systemd unit; the harness/Mac-fallback use plain directories and leave
  it unset); snapshots are produced with `VACUUM INTO` a temp file on the stick then
  renamed (consistent point-in-time copy, no torn db+WAL pair, no event-loop-blocking
  copyFileSync); pruning is async; overlap guard added; `status.count` off-by-one fixed.
- **H-11** ✅ Verified real (no ENABLE_SSH/FIRST_USER_PASS in the pi-gen config).
  Fixed: `ENABLE_SSH=1` + `FIRST_USER_PASS` (default `stickitvenue`, overridable via
  `STICKIT_PI_PASSWORD` at build time) in build.sh; `init_format: "systemd"` added to
  os_list_stickit.json; README documents the credential and the run-sheet note.

## Medium
- **M-1** ✅ Verified real. Fixed in both adopt paths (`/api/sync/adopt`,
  `export-for-adoption`): package-build failure reverts the lock and restores the
  release code/expiry (conditional on our own token hash, so a concurrent adoption is
  never clobbered) with a clear "try again" error.
- **M-2** ✅ Verified real. Fixed: new `server/utils/inflight.js` counts mutating HTTP
  requests in flight (middleware is response-invisible, D4-safe); both drains use
  `waitForMutationIdle()` (bounded, longer allowance for remote Turso) instead of the
  fixed 300 ms sleep; `buildAdoptionPackage` reads all snapshot tables in ONE libsql
  read-transaction batch (sequential fallback if the driver refuses).
- **M-3** ✅ Verified real. Fixed: `deleteMeetCascade` refuses (423) the venue's
  currently adopted meet at the chokepoint (covers DELETE + overwrite imports); cloud
  `/changes` refuses `op:'delete'` on `meets` (`meet_delete_refused`).
- **M-4** ✅ Verified real (scoring-accuracy). Fixed: `jump_dd_table` added to the
  manifest as snapshot-only (`sync:false, checksum:false, scope:'global'`), imported
  REPLACE-ALL on adoption — guarded so an older package without the key never wipes
  the local seed. Protocol version stays 1 (additive; old venue ignores the extra key,
  new venue tolerates its absence). Harness: cloud-edited DD value verified on the
  venue after adoption.
- **M-5** ✅ Verified real. Fixed: the whole import — including the replace-path clear
  — runs as ONE atomic `batch()` (mid-import failure rolls back with the old copy
  intact; double-tap loser's batch rolls back whole). `clearMeetLocal` refactored to a
  statements builder + wrapper. Validation still precedes any mutation. The outbox
  clear lives in the venue routes (H-4a) rather than duplicated here.
- **M-6** ✅ Verified real. Fixed: check-in loops flush → checksums until the meet's
  outbox is provably empty immediately before the cloud call (≤4 attempts, then an
  accurate "writes kept arriving" error); after the cloud's ok, a final outbox check
  reports `completed_with_pending_changes` accurately instead of silently archiving.
- **M-7** ✅(a,c) / residual(b). (a) delete/update pre-image SELECT + write now run in
  ONE atomic `rawBatch` transaction — the ghost-row interleave is impossible on the
  hook.execute path; a batch failure retries the write alone with the full-table
  fallback so a capture bug can never block scoring. hook.batch keeps
  pre-image-before-batch (its call sites — seeding, imports — are not racing hot
  paths). (c) `capture_failures` counter in `getCaptureStats()` + `getSyncStatus()`
  + a red home-screen banner. (b) the crash window between a committed write and the
  outbox append is inherent to the two-step design; it is surfaced by (c) when it is a
  failure, and repaired by the check-in checksums/repush when it is a crash —
  documented residual, per the doc's "at minimum" guidance.
- **M-8** ✅ Verified real. Fixed: worker deletes the acknowledged prefix on 422 and
  records `status.stuck {seq, table, error}` (surfaced on the home screen); cloud
  `/changes` clears different-pk rows under non-PK UNIQUE keys before upserting
  (judge_scores/dual_judge_points/phase_run_order — mirrors venue REPLACE
  displacement). The optional Control-gated quarantine action was not built (the
  conflict class that motivated it is fixed; stuck info is now visible).
- **M-9** ✅ Verified real (policy: doc guidance followed). Fixed: per-IP throttle
  (10 fails / 15 min → 429) + 250 ms constant failure delay on verify-pin; Control
  token rotates at final check-in (deliberately NOT at handback — the same meet
  resumes next morning and day-2 would otherwise need re-PIN-entry mid-cycle).
- **M-10** ✅ Verified real (policy: doc guidance followed). Fixed: `/update` requires
  the Control token (when PINs are set), also refuses `handed_back`; `update-check`
  uses a strictly-newer semver comparison (no downgrade offers). Client Update button
  prompts for the Control PIN.
- **M-11** ✅/partially disputed. The swap-window and running-service defects are real
  and fixed: service stopped before the swap, no rm-first window, EXIT trap restores
  the old tree and restarts on any failure. DISPUTED detail: "the data directory
  (SQLite plus WAL) is copied while the service is still running" and "provision.sh
  creates /opt/stickit/data, which nothing uses" — schema.js resolves its default DB
  to `<server>/../data` = `/opt/stickit/data` on the Pi, so the live DB was already
  OUTSIDE the swapped tree and `/opt/stickit/data` was in use all along; the copied
  `server/data` holds only meet logos. `LIBSQL_URL=file:/opt/stickit/data/scoring.db`
  is now pinned explicitly in the systemd unit so this can never silently change.
- **M-12** ✅ Verified real (`/bin/bash provision.sh` ignores the shebang's -e).
  Fixed: `set -euo pipefail` as the first executable line.
- **M-13** ✅ Verified real. Fixed: (a) the root gate paints the cloud tree after a
  1.5 s fallback and swaps when the status arrives; failed fetches retry every 5 s
  (a venue Pi is never stuck as "cloud" for the session); `venueStatus` carries a 4 s
  AbortSignal timeout; `fetchVenueStatus` never caches a failure. (b) VenueHome keeps
  the previous status when a refresh poll fails. (c) `apiFetch` fix shipped with H-9.
  Playwright: aborted-status paint test + recovery-without-reload test.
- **M-14** ✅ Verified real. Fixed: any activity for a different event takes the
  spotlight when the holder is >3 min stale; `event_finalized` releases the tracker.
  (Time-based behavior — verified by code inspection; no harness test, the 3-minute
  window is impractical to wait out and shrinking it just for tests would test a
  different constant.)
- **M-15** ✅ Verified real (`roleUrl` had no dashboard case). Fixed: `roleUrl`
  returns `/dashboard` for `role === 'dashboard'`. Playwright: reboot-return lands on
  /dashboard.
- **M-16** ✅ Verified real (all four sites unguarded). Fixed with the existing
  skip-and-report pattern: from-usss restore (per-athlete `isAthleteAdoptionLocked`),
  admin restore (bulk `athleteIdsLockedByAdoption`, `skipped_locked` reported), CSV
  import field updates, export-bibs-to-athletes. Harness: locked-athlete skip
  verified on restore + export-bibs.

## Low
- **L-1** ✅(2 of 3). Seat registry bulk-cleared on every new adoption (inside
  `clearOutboxForNewAdoption`, so abandon clears it too); claim is atomic
  (`INSERT OR IGNORE` + rowsAffected → clean 409, never a raw UNIQUE 500).
  Plain `/seats/release` deliberately KEPT token-less: VenueRole's exit button
  releases the device's own seat from a Crew-only tablet with no token available —
  requiring the Control token would break the legitimate self-release UX. Accepted
  as-designed (Crew PIN gates are client-side by design, R3); force-release remains
  the Control-PIN path for seats whose tablet died.
- **L-2** — partial/accepted. Full first-set binding (console confirmation or
  first-adopting-device identity) declined: there is no device identity to bind to
  and no console UX on a headless Pi; the run sheet has the volunteer set PINs
  immediately after adoption, so the open window is seconds on a private LAN.
  Added: loud log of the first-set source IP.
- **L-3** ✅ all three: 15 s AbortSignal timeout on the worker fetch; `pendingWake`
  flag closes the lost-wakeup edge (append during the final empty SELECT); 401
  `invalid_sync_token` is terminal (revoked-style stop with an accurate message)
  instead of retrying forever labeled "Offline".
- **L-4** ✅ Module-load assertion: IMPORT_ORDER set-equals `protocol.SNAPSHOT_TABLES`
  (would have caught a missed table when jump_dd_table was added for M-4); logo
  import requires exactly `meet_<meetId>.<ext>` and removes stale same-meet logos
  with a different extension first.
- **L-5** ✅ Deterministic interface preference (eth0/en0/en1 before wlan0/wlp/enp)
  for the primary QR/overlay address; all addresses still listed. (A default-route
  probe was considered but needs sockets/platform parsing; name preference covers the
  actual Pi case: eth0+wlan0 both up.)
- **L-6** ✅ `handed_back` freeze screen has its own copy ("Handed back for tonight —
  you can stop" + morning re-adoption guidance) instead of the wrong "checked in …
  power tablets down".
- **L-7** ✅ FR-11 dedup now runs ONLY when the unique index does not exist yet
  (one-time legacy migration) — it can never re-fire against an adopted meet's rows.
- **L-8** ✅ Per-IP invalid-code throttle on `/peek` + `/adopt` (10/15 min → 429);
  `released_by` removed from the public adoption GET (admin listing keeps it);
  `crypto.timingSafeEqual` for the sync-token hash comparison.
- **L-9** ✅ `already_hosting` guard extended to `'checking_in'` on both venue
  adoption paths.
- **L-10** ✅ CLAUDE.md build section: assets cleanup now clears ALL stale hashed
  files (fonts included) and the zip-size guidance reads ~7 MB (>9 MB = missing
  exclusion); VENUE_OPS.md gained the per-database adoption-lock / Railway caveat and
  a summary of the new recovery actions.

## Disputed findings (partial)
- **M-11 (two sub-claims)**: "the data directory (SQLite plus WAL) is copied while
  the service is still running" and "provision.sh already creates /opt/stickit/data,
  which nothing uses" are both incorrect — `schema.js` resolves its default DB path
  to `<server>/../data` = `/opt/stickit/data` on the Pi, so the live DB was always
  outside the swapped tree and that directory was in use; the copied `server/data`
  holds only meet logos. The finding's real defects (non-atomic swap window,
  swapping under a running service, no failure restore) were fixed, and LIBSQL_URL
  is now pinned in the systemd unit so the layout can never silently change.
- No other finding was disputed — every other one traced to real code.

## Deviations from the document's fix guidance
- H-1: no cloud-side idempotency record — the venue-side public-endpoint probe covers
  the lost-response case without new cloud state.
- H-6: parser tolerance (doc option c) chosen over statement rewrites (option a) — one
  fix site, protects future statements, zero changes to live scoring code paths.
  Option (d) (meet-scoped fullTablePre) skipped: the fallback now cannot fire on any
  shipped path, logs loudly, and the harness gate asserts zero fallbacks.
- M-7(b): crash window between a committed write and its outbox append is a
  documented residual (inherent to the two-step capture); surfaced by the new
  capture-failures counter when it is an error, repaired by check-in checksums/repush
  when it is a crash.
- M-8: the optional Control-gated quarantine action was not built; the conflict class
  that motivated it is fixed cloud-side and stuck-sync state is now visible.
- M-9: Control-token rotation happens at final check-in only, not at handback — the
  same meet resumes next morning and rotating overnight would force a mid-cycle
  re-PIN with no security gain.
- M-14: no harness test (3-minute staleness window is impractical to wait out);
  verified by inspection.

## Harness runs
- After C+H: review 23/23 + review-ui 3/3; **full harness 424/424**; verify_v16 123/123.
- After M: review 49/49 + review-ui 6/6; **full harness 457/457**; verify_v16 123/123.
- After L: review 56/56 + review-ui 6/6; **full harness 464/464**; verify_v16 123/123.
  (Suite growth 398 → 464: +62 review checks, +4 in the step0 manifest drift test
  from the jump_dd_table addition.)
