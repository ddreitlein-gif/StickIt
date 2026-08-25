# StickIt v2.0.00 Independent Review Findings (08-23-26)

Purpose: an independent, adversarial double check of the v2 Local Venue Server work (branch `v2` vs tag `v1.30.03`) before the physical confirmation run.  Every finding below was verified directly against the code on the `v2` branch; file and line references are from the current v2 HEAD.  This document is written for use with Claude Code: work the findings in order (Critical, then High, then Medium, then Low), re-run the harness after each group, and update `docs/V2_PROGRESS.md` and `CLAUDE.md` as fixes land.

Context for prioritization: the existing 398-test harness suite is genuinely green and the architecture's backstops (post-image reads, check-in checksums, repush, never-unlock-on-mismatch) are sound.  What the suite missed falls into four families: process death and lost-response windows, state that survives longer than the code expects (persisted meet state, the outbox, the in-memory revoked flag), SQL shapes the capture parser cannot parse, and operator-facing dead ends.  Nearly all of the Critical/High items sit on the exact paths a volunteer will run alone at a venue.

---

## CRITICAL

### C-1. Crash or power loss during check-in permanently bricks the venue server

Files: `server/routes/venue.js:470-560`, `server/venue/state.js`, `server/venue/freeze.js:20-30`, `server/index.js` (boot, ~343-401)

`POST /api/venue/checkin` persists `venue_meet_state='checking_in'` to `app_settings` (durable), then relies exclusively on in-process `revert()` closures and the outer catch to set it back to `'adopted'`.  If the process dies inside the window (SIGKILL, power cut, kernel panic; the window includes a flush of up to 45 seconds plus two checksum passes and up to three cloud round trips), then on restart:

1. `venueFreezeGuard` returns 423 for every mutation (`meet_state !== 'adopted'`), so scoring is dead.
2. Every role tablet sits on the FR-10 freeze screen forever ("this screen will update when it finishes").
3. Retrying check-in is refused: the guard at venue.js:471 requires `meet_state === 'adopted'` and returns 409 `not_adopted`.
4. Nothing at boot resets the state (verified: the only `setMeetState` callers are venue.js and state.js), and the shipped Pi image has no SSH (see H-11), so there is no recovery path at all.

The Step 5 crash test covered SIGKILL mid-scoring, not mid-check-in.

Fix: at venue boot (in the venue branch of `initSchema().then(...)` or inside `getVenueState`), treat a persisted `'checking_in'` as an interrupted check-in and reset it to `'adopted'`; the cloud never unlocked, so this is always safe.  Additionally, allow `POST /checkin` to proceed when the current state is `'checking_in'` (it is idempotent up to the cloud call).  Add a harness test: SIGKILL mid-check-in, restart, verify scoring resumes and a check-in retry succeeds.

---

## HIGH

### H-1. Lost check-in/handback response causes split brain, and the retry path makes it worse

Files: `server/routes/sync.js:333-360` (cloud commits then responds), `server/routes/venue.js:507-513` (venue reverts on transport error), `server/routes/sync.js:143-146` (410 when token hash is NULL), `server/sync/worker.js:105-110`

The cloud `/checkin` endpoint commits `adoption_status` and clears `sync_token_hash`, then sends the response.  If the connection drops before the venue reads it, the venue calls `revert()` back to `'adopted'` and tells the operator "Scoring stays available; try again."  Now the cloud is unlocked (both sides writable, split brain).  The retry does not self-heal: the next worker push or check-in hits `authSyncRequest`, sees `sync_token_hash` NULL, gets 410 `adoption_revoked`, the worker sets its permanent `revoked` flag, and `flushNow` fails with reason `'revoked'`, so the venue shows "This adoption was revoked on the cloud.  Call the office", which is false and has no path forward.  Scores entered after the first revert never reach the cloud.

Fix: when a check-in retry (or the worker) receives 410 and the local outbox is empty and a check-in was just attempted, verify via the public `GET /api/meets/:id/adoption` that the cloud's state matches the requested mode; if it does, finish locally with `setMeetState('checked_in'|'handed_back')` instead of reverting.  Consider a short-lived idempotency record on the cloud so a repeated `/checkin` with the same body returns ok instead of 410.

### H-2. A checked-in meet is a one-way dead end with misleading errors

Files: `server/routes/meets.js:200-202` (release refuses only `'adopted'`), `server/routes/sync.js:96-100` (adopt requires `adoption_status IS NULL`), `server/routes/meets.js:255-261` (USB export requires NULL), `server/routes/admin.js:650-652` (force-unlock requires `'adopted'`)

`adoption_status='checked_in'` is permanent, and nothing anywhere resets it to NULL (verified: writers are adopt, export-for-adoption, checkin/handback, force-unlock only).  Release-for-adoption happily issues a code for a checked-in meet; `/peek` validates it; redemption then fails the `IS NULL` condition and returns the false message "Another venue server redeemed this code first."  USB export returns 409.  Force-unlock returns 400 "Meet is not adopted."  Scenario: on night 1 of a two-day meet the volunteer taps Check In instead of Hand Back (adjacent buttons).  Day 2 is unrecoverable without hand-written SQL on production.

Fix: (a) allow adoption of a `checked_in` meet: change the `/adopt` and `export-for-adoption` conditions to `(adoption_status IS NULL OR adoption_status='checked_in')`; (b) extend force-unlock to accept `checked_in`; (c) when the conditional UPDATE affects zero rows for a reason other than a raced code, return an accurate error (distinguish `checked_in` from a genuine race by re-reading the row).

### H-3. Check-in repush can hard-delete shared master athlete rows from the cloud

Files: `server/routes/sync.js:306-326` (repush delete-prune), `server/sync/protocol.js` (TABLES insertion order: athletes at position 3, registrations at 4; `registered_athletes` scope), `server/routes/venue.js:516-539`

Repush deletes cloud rows absent from the venue's push for every mismatched table, including `athletes`, whose scope is "athletes referenced by this meet's registrations."  `athletes` is the shared master roster, not meet-owned.  If the cloud's registered-athlete scope contains an athlete the venue's does not (any lost capture or drain-window write causes this), the athlete's master row is deleted cloud-wide, orphaning that athlete's registrations in every other meet.  The table ordering guarantees the bad interleaving: `mismatched` is built in TABLES order, athletes before registrations, so the athletes prune runs against the stale registration scope.

Fix: never DELETE from `athletes` (or any `registered_athletes`-scoped table) during repush; make master-table repush upsert-only, mirroring `UPSERT_TABLES` in `adoptionImport.js`.  If pruning is ever wanted, process `registrations` first and re-derive the scope, but upsert-only is the safe contract.

### H-4. Stale outbox rows survive forever and the cloud applies pushed rows with no meet-scope validation

Files: `server/sync/worker.js:65` (unfiltered `SELECT * FROM sync_outbox`), `server/routes/sync.js:216-227` (`/changes` applies by pk with no scope check), `server/routes/sync.js:306-326` (repush upserts unscoped), `server/routes/venue.js` adopt/import (no outbox clear), `server/sync/adoptionImport.js` (no outbox clear)

Verified: the only `DELETE FROM sync_outbox` in the codebase is the worker's delete-after-ACK.  Rows stranded by a revoked adoption, an aborted check-in, or a poison row are replayed under the next adoption's token to the next meet's `/changes` URL, and the cloud upserts or deletes those rows blindly; nothing constrains `ch.row` or the delete pk to the token's meet.  `last_applied_seq` is reset to 0 at adoption, so old low seqs are not even skipped.  A malformed change (`op:'upsert'`, `row:null`) yields an all-NULL row that SQLite will insert (TEXT primary keys accept NULL).

Fix: (a) clear `sync_outbox` inside both venue adoption paths (`/adopt`, `/import-package`) before `setVenueState`; (b) make the worker select `WHERE meet_id=?` for the adopted meet; (c) on the cloud, resolve each change's parent meet (the scope logic behind `selectForMeet` and `eventIdForChange` already exists) and reject with 422 any row or delete pk that resolves outside `:meetId`; reject upserts whose pk values are null.

### H-5. `worker.status.revoked` is never reset, so a re-adoption after force-unlock silently syncs nothing

Files: `server/sync/worker.js:33-36, 105-110`, `server/venue/state.js` (notifySync), `server/routes/venue.js` (adopt paths)

`status.revoked` is set on a 410 and nothing ever clears it; `wake()` returns immediately while it is set.  The design's own prescribed recovery (force-unlock, re-release, re-adopt) goes through `setVenueState -> notifySync -> wake`, which no-ops.  The venue then scores an entire meet with zero upsync while the operator believes re-adoption fixed things; the problem surfaces only at end-of-day check-in.  A process restart happens to fix it, which is exactly why no harness test caught it.  Related: `clearVenueState()` is exported and never called, and after a revoke the venue can never adopt another meet (`already_hosting`) without manual DB surgery.

Fix: reset `status.revoked`, `offline_since`, `last_error`, and the backoff whenever a new adoption is stored (an exported `worker.reset()` called from both adoption endpoints, or inside `notifySync` when the state is newly `'adopted'`).  Add a Control-PIN "Abandon adoption" action on the venue home screen that calls `clearVenueState()` and clears `sync_outbox`.

### H-6. Write-capture full-table-diff fallback fires on the hottest live-scoring writes, silently

Files: `server/sync/outbox.js:111-127, 174-175, 204-207, 225-235`; triggering SQL in `server/routes/runs.js:470, 536, 681, 929, 1019, 2025`, `server/routes/phases.js:562-653`, `server/routes/dual.js:420-456`

`parseInsert` requires every VALUES token to be a `?` placeholder (`totalQ !== args.length` fails otherwise), and the parse-miss path falls back to a full-table diff with no log (the file's header claims the fallback "logs loudly"; only the exception path does).  But the hottest INSERTs mix literals into VALUES: tablet Start Run (`runs.js:1019`, literal `'scoring'`), the DNS/status helper (`:536`), manual entry (`:681`), aerials v2 manual (`:470`), forerunner (`:929`), and every `INSERT OR REPLACE INTO run_round_status ... 'finalized', datetime('now')` in the finalize/HJ flow.  Each such statement triggers: SELECT all pks, write, SELECT all pks again, then one `selectByPk` plus one outbox INSERT per row in the table, and the worker then pushes an upsert for every row.  With 300 runs in the DB, every single Start Run performs roughly 600 extra queries and 300 outbox appends on a Raspberry Pi SD card on the request the timekeeper is waiting on, and this grows through the day.  Results are correct (why FR-7 passed); the defect is severe write amplification on the live path.

Fix: (a) rewrite the ~12 offending INSERTs to bind every value (trivial and safe); (b) log the parse-miss fallback loudly so any future literal INSERT is visible; (c) optionally extend `parseInsert` to tolerate literal tokens; (d) consider scoping `fullTablePre` to the adopted meet via `protocol.selectForMeet` instead of the whole table.  Add a harness assertion that a full meet simulation produces zero fallback captures.

### H-7. Venue freeze guard does not cover `/api/admin`

Files: `server/index.js:136-142` (prefix list: meets, events, athletes, training-days, import only), `server/routes/admin.js` (reopen, lock/hide, athletes delete/restore, backups restore), `server/middleware/auth.js` (venue Control token satisfies system_admin)

After check-in or handback, admin endpoints remain mutable on the venue: event reopen, lock/hide flags (manifest columns), athlete soft-delete/restore (checksummed under FR-8 scope), and backup restore.  Capture is inactive once `meet_state` leaves `'adopted'/'checking_in'`, so any such write silently diverges the venue from the just-verified cloud copy.  During the check-in window itself these endpoints bypass FR-10.

Fix: add `/api/admin` (and `/api/usss` for completeness) to the freeze-guard prefix list, or mount `venueFreezeGuard()` on `/api` with an allowlist for `/api/venue` and `/api/auth`.  The guard already passes GET/HEAD/OPTIONS.

### H-8. Admin backup restore ignores adoption state entirely

Files: `server/routes/admin.js:599-620`

`POST /api/admin/backups/:filename/restore` copies an old DB over `data/scoring.db` with no adoption awareness, and the harness exempts the whole prefix, so the FR-20 gate is blind here.  Cloud side: restoring a backup taken before an adoption erases `adoption_status` and `sync_token_hash`; the cloud mirror becomes editable mid-meet and the venue's next push gets 410, permanently stopping upsync (H-5) with a misleading "call the office" banner.  Venue side: a restore replaces `app_settings` (venue state, token) and `sync_outbox` wholesale.

Fix: before restoring, check `SELECT ... FROM meets WHERE adoption_status='adopted'` in the CURRENT database; refuse with a clear message naming the adopted meets (or require an explicit `acknowledge_adoptions: true`).  In venue mode, additionally refuse while `venue_meet_state` is `'adopted'` or `'checking_in'`.

### H-9. Day-2 re-adoption is unreachable from the venue UI

Files: `client/src/utils/api.js:67-69`, `client/src/pages/venue/VenueHome.jsx:215, 233`, `server/routes/venue.js:322-327`

The server returns `{ error: 'meet_exists', offer_replace: true, message: 'A local copy of "X" already exists...' }`, but `apiFetch` throws `new Error(err.error || ...)`, so `e.message` is the literal string `meet_exists`.  VenueHome's replace-offer detection is `/already exists|Replace/i.test(e.message)`, which can never match.  Result: on day-2 re-adoption (and the USB import equivalent at line 233) the volunteer sees the bare error "meet_exists" and the replace confirm dialog never appears; there is no other UI path that passes `replace: true`.  The harness only asserted the HTTP response shape, never the client regex.

Fix: test the machine code (`e.code === 'meet_exists'` or `e.message === 'meet_exists'`).  Better, fix `apiFetch` to attach the parsed body: `const error = new Error(err.message || err.error || ...); error.code = err.error; error.body = err; throw error`, then update VenueHome to use `e.code` and display `e.message`.  This also fixes the systemic problem in M-13.

### H-10. Snapshot worker reports healthy while writing "USB snapshots" to the Pi's own SD card

Files: `server/venue/snapshot.js:36-63`, `server/scripts/build_pi_image/provision.sh:61-63`

The image bakes in `mkdir -p /media/stickit-snapshot` and an fstab entry with `nofail`, so the mountpoint directory always exists.  `doSnapshot` checks only `fs.existsSync(dir)`; with no stick present (or one that fell out mid-day) the copies land on the SD card, `status.available` reports true, and the home screen shows no warning.  R11's entire purpose (surviving total Pi loss) is silently defeated.  Secondary issues in the same function: `fs.copyFileSync` of a multi-MB DB blocks the Node event loop (all judge submits stall) and the db+WAL pair is copied non-atomically, so the recovery artifact can be internally inconsistent; `status.count` also overcounts by one (`files.length + 1` where `files` already includes the new snapshot).

Fix: verify the directory is a real mount (`fs.statSync(dir).dev !== fs.statSync(path.dirname(dir)).dev`, or parse `/proc/mounts`).  Produce the snapshot with `VACUUM INTO` a temp file, then move it to the stick with async fs calls.  Fix the count.

### H-11. Pi image has no SSH and no user password: every documented recovery path is impossible

Files: `server/scripts/build_pi_image/build.sh:64-72` (pi-gen config), `README.md`, `server/routes/venue.js:598` (tells the operator to "Use SSH"), `docs/VENUE_MAC_FALLBACK.md`

The pi-gen config sets `FIRST_USER_NAME` and `DISABLE_FIRST_BOOT_USER_RENAME=1` but neither `ENABLE_SSH=1` nor `FIRST_USER_PASS`.  pi-gen's default leaves SSH disabled, and on Bookworm a user without a configured password may be locked entirely (or the build may refuse).  Yet the update flow, the README, and recovery from C-1/M-11 all assume `ssh stickit@stickit.local`.  The os_list entry also lacks `init_format`, so Raspberry Pi Imager will not offer its customization screen for this catalog image.

Fix: add `ENABLE_SSH=1` and `FIRST_USER_PASS` (or bake an authorized SSH key) to the pi-gen config, document the credential on the venue run sheet, and consider `init_format` in `os_list_stickit.json`.

---

## MEDIUM

### M-1. Adoption lock commits before the snapshot with no revert on failure

Files: `server/routes/sync.js:91-124` (`/adopt`), `server/routes/meets.js:254-266` (`export-for-adoption`)

Lock-first ordering is correct by design, but if `buildAdoptionPackage` throws (18 sequential reads; transient Turso errors are plausible), or the multi-MB response is lost in transit, the code is already burned and the meet is locked with a token nobody holds.  Recovery requires a system_admin force-unlock on competition morning.  Fix: wrap the post-lock section; on package-build failure, revert `adoption_status`/`sync_token_hash` and restore `release_code_hash` (the pre-read row still holds it), then return the error.

### M-2. Fixed 300 ms drain plus non-transactional snapshot can lose or tear in-flight writes

Files: `server/routes/sync.js:104-108`, `server/sync/package.js:34-39`

Requests already past `requireNotAdopted` keep running; a tablet score submit that triggers `tryFinalize` is a long statement sequence, and against remote Turso 300 ms is not generous.  The snapshot itself is 18 sequential reads with no transaction, so a slow write can land between table reads (torn snapshot).  A write present on the cloud but missing from the venue is silently discarded at check-in when repush makes the venue version win, and it feeds H-3.  Fix: make the drain adaptive (track in-flight mutation count, wait for zero with a timeout; lengthen when `LIBSQL_URL` is remote) and read the snapshot inside a transaction where the driver supports it.

### M-3. Deleting the adopted meet on the venue destroys the cloud copy too

Files: `server/venue/freeze.js:21` (passes everything while `'adopted'`), `server/routes/meets.js` (deleteMeetCascade), `server/routes/sync.js:219-223` (applies `op:'delete'` on `meets`)

On the venue the local meets row has no adoption state (those columns deliberately do not travel), so `DELETE /api/meets/:id` is unguarded while adopted.  The cascade's deletes are captured to the outbox and the cloud applies them, erasing the meet on both servers from one confirmed click in the venue officials UI.  Fix: refuse deletion (and overwrite-style imports) of the currently adopted meet in venue mode, and refuse `op:'delete'` where `tbl === 'meets'` in `/changes`.

### M-4. `jump_dd_table` is not in the adoption snapshot: venue scores with the stock DD chart

Files: `server/sync/protocol.js` (table absent from TABLES), `docs/SYNC_PROTOCOL.md` ("ships with the code")

The exclusion rationale is false for edited values: Admin > Jump DDs is a supported live-editing feature and CLAUDE.md anticipates a MAG DD chart review.  A venue Pi seeds the stock chart; cloud-side corrections never arrive; every venue-scored run bakes the stale DD into `jump1_dd`/`jump2_dd` permanently, and no checksum flags it.  This is a scoring-accuracy defect.  Fix: include `jump_dd_table` in the snapshot and import it replace-all on adoption (no upsync, no checksum needed).

### M-5. Adoption import is not transactional and destroys the previous local copy first

Files: `server/sync/adoptionImport.js:102-128`, `server/routes/venue.js:339-368`

On a replace re-adoption, `clearMeetLocal` runs before the import; a mid-import failure clears again, leaving the venue with no copy at all while the cloud is locked and the code burned (redeem happens before import).  Row-by-row `execute` with no transaction; a double-tap of `/import-package` can interleave two imports, and the loser's cleanup deletes the winner's rows.  The `athletes`/`usss_people` upserts are not reverted by cleanup.  Fix: run the import inside a transaction (libsql `batch` or BEGIN/COMMIT), which also fixes the double-tap race; only clear the old copy after the package has been parsed and validated.  Clear `sync_outbox` here as well (H-4a).

### M-6. Check-in has no post-checksum write barrier

Files: `server/routes/venue.js:485-553`

A request already past the freeze guard when `'checking_in'` lands can commit after `venueChecksums` ran; both sides then verify the pre-write state, check-in succeeds, and the venue DB plus a stranded outbox row hold a change the cloud never received (feeds H-4).  Fix: after the cloud's ok and before `setMeetState('checked_in'|'handed_back')`, assert the outbox is empty (any late write necessarily appended to it, since capture stays active during `'checking_in'`); if not empty, loop back to flush and re-verify.

### M-7. Capture is not atomic with the write: ghost-row race, crash window, silent failure

Files: `server/sync/outbox.js:271-296` (hook), `:158-207` (capturePre), `:209-267` (capturePost)

Three related weaknesses.  (a) Ghost row: an HJ reject's non-PK `DELETE FROM judge_scores WHERE run_id=?` pre-images existing pks; a racing judge submit inserts a row and queues its upsert; the DELETE removes it; the delete capture covers only pre-imaged pks, so the cloud keeps the rejected score live for the rest of the day (check-in repairs it, but the live mirror is wrong).  (b) A power cut between the committed write and `capturePost` loses the change silently.  (c) `capturePost` failures are console-only; the operator never learns capture is failing.  Fix: at minimum re-run the delete predicate after the write for non-PK deletes; surface a `capture_failures` counter in `getSyncStatus` and the home-screen banner; longer term, append outbox rows in the same `rawBatch` as the write.

### M-8. A poison outbox row wedges upsync permanently and the worker ignores partial progress on 422

Files: `server/sync/worker.js:112-119`, `server/routes/sync.js:230-249`

Cloud apply stops at the first failing change and returns 422 with `applied_through_seq`; the worker treats any non-ok as generic failure, never deletes the acknowledged prefix, and retries the same batch forever on 30 s backoff.  Realistic trigger: a `judge_scores` upsert whose new id collides with a different-id row on the cloud under the FR-11 UNIQUE index (`upsertSql` conflicts only on `id`).  Check-in then fails with "Could not push the last changes... Try again", which never succeeds.  Fix: on 422, delete `seq <= applied_through_seq`; add conflict handling for `judge_scores` (delete-by-unique-key before insert, or a second ON CONFLICT target); surface "sync stuck at seq N, table T" in `getSyncStatus`; consider a Control-gated quarantine action.

### M-9. `verify-pin` is an unthrottled 4-digit oracle that yields a non-expiring Control token

Files: `server/routes/venue.js:73-88`, `server/sync/adoption.js` (unsalted SHA-256)

The PIN space is 10,000 and there is no rate limiting (cloud login got a throttle in v1.25.00 A-7).  Any device on venue Wi-Fi can iterate all PINs in under a minute and receive the Control token, which never expires until a PIN change and satisfies system_admin everywhere in venue mode.  Fix: per-IP failure counter with 429 (reuse the login-throttle pattern), a small constant failure delay, and rotate the Control token at check-in.

### M-10. `/update` needs no Control token, is allowed overnight, and offers downgrades

Files: `server/routes/venue.js:590-613`, `:585`

`POST /api/venue/update` refuses only `'adopted'`/`'checking_in'`; any LAN device can trigger a sudo-spawned update and restart before adoption or in the `'handed_back'` overnight state of a two-day meet, risking a version/protocol mismatch at morning re-adoption.  `update_available` is a plain inequality, so a yanked or lagging GitHub release is offered as an "update" that downgrades.  Fix: gate `/update` behind `requireControlToken`, also refuse `'handed_back'`, and semver-compare instead of `!==`.

### M-11. `update-stickit.sh` copies the live DB and has a non-atomic swap window

Files: `server/scripts/build_pi_image/update-stickit.sh:26-35`, `server/scripts/build_pi_image/provision.sh:30`

The data directory (SQLite plus WAL) is copied while the service is still running (torn copy risk), and power loss between the two `mv` commands leaves no `/opt/stickit/server` at all; `Restart=always` then loops forever, and without H-11 fixed there is no SSH to repair it.  Note provision.sh already creates `/opt/stickit/data`, which nothing uses.  Fix: stop the service before copying; better, move the data directory outside the swapped tree (e.g. `/opt/stickit/data`, pointed at via `LIBSQL_URL` in the systemd unit) so code swaps never touch the DB; make the swap `mv server server.old && mv server.new server` without the separate `rm` first, and restart in a trap so a failure still brings the old tree back.

### M-12. `provision.sh` runs without errexit, so a half-provisioned image builds green

Files: `server/scripts/build_pi_image/build.sh:47-50`, `server/scripts/build_pi_image/provision.sh:1`

The wrapper invokes `/bin/bash /tmp/stage-files/provision.sh`, which ignores the script's `#!/bin/bash -e` shebang, and the file contains no `set -e` (verified).  Its last line is an echo, so the wrapper's own `-e` always sees success; a failed `npm install` or NodeSource fetch still produces a "good" image that boots to nothing.  Fix: add `set -euo pipefail` as the first executable line of provision.sh.

### M-13. Client: the FR-13 root gate blanks the whole app until `/api/venue/status` resolves, and `apiFetch` hides every human-readable error

Files: `client/src/App.jsx:34-48`, `client/src/pages/venue/venueShared.js:14-19`, `client/src/utils/api.js:67-69`

Three related client defects.  (a) `if (venue === null) return null` gates first paint of every surface, cloud production included, on the status fetch; a failed fetch falls back to cloud, but a hung request has no timeout, leaving a blank page where v1.30.03 painted immediately; and on a venue Pi a failed fetch caches `mode:'cloud'` for the session, unregistering the venue routes until manual reload.  (b) `fetchVenueStatus`'s catch-to-cloud fallback also feeds VenueHome's 10-second poll, so one transient failure mid-meet re-renders the operator console as the "Adopt Meet" screen until the next successful poll.  (c) `apiFetch` throws `err.error`, so every carefully written v2 message (LOCKED_MESSAGE, cloud_unreachable text, flush_failed guidance, adoption banners) reaches operators as a bare machine code; this also caused H-9.  Fix: add a short timeout with a default-to-cloud interim render (or default to the v1 route tree and swap when status arrives); in VenueHome keep the previous status on refresh failure; change `apiFetch` to prefer `err.message` and attach `code`/body.

### M-14. Auto-follow tracker can pin every surface to a finished event

Files: `server/venue/active.js:16-27, 34-40`

A `score_update` for event B never takes the spotlight from event A (only `run_started`/`dual_match_started` switch, and paper/manual scoring emits neither), `lastActive.at` is written but never read (no staleness expiry), the tracker is not cleared on `event_finalized`, and the DB fallback is unreachable while the stale event still belongs to the meet.  Morning tablet-scored event A plus afternoon paper-scored event B leaves the scoreboard, overlay, HJ, and judge seats following event A all afternoon.  Fix: allow a `score_update` for a different event to take over when the holder's `at` is older than a few minutes, and clear the tracker when the tracked event finalizes.

### M-15. Venue client dead ends: Scoring Computer reboot-return, and role memory for it

Files: `client/src/pages/venue/venueShared.js:38-42`, `client/src/pages/venue/VenueHome.jsx` (openRole and the reboot-return effect), `server/routes/venue.js:229`

`roleUrl` has no `dashboard` case, so the reboot-return effect navigates the Scoring Computer to `/venue/role/dashboard`; `resolveTarget` returns `bad_role` and the device lands on a permanent "Waiting..." screen mid-meet (recoverable only via the small menu link plus re-entering the Control PIN).  The click-time path special-cases dashboard, which is why it works the first time.  Fix: return `/dashboard` from `roleUrl` for `role === 'dashboard'` (or do not store role memory for dashboard).

### M-16. FR-8 athlete-lock gaps: four cloud paths still mutate adoption-locked athlete rows

Files: `server/routes/athletes.js:175-179` (from-usss restore), `server/routes/admin.js:468-478` (restore), `server/routes/registrations.js:594-603` (CSV import field updates), `server/routes/registrations.js` (`export-bibs-to-athletes`)

`athletes` is checksummed under the registered-athletes scope, and `bib`, `deleted_at`, `division`, `ussa_num` are manifest columns.  These four paths update athlete rows with no `athleteIdsLockedByAdoption()` guard (the reconcile and usss-sync paths in the same files have it), so a cloud-side edit to an athlete who is also registered in an adopted meet causes a check-in mismatch, after which repush silently reverts the cloud edit, and it feeds H-3's scope divergence.  Fix: apply the existing locked-ids skip-and-report pattern at all four sites.

---

## LOW

L-1.  Seats: `venue_seats` is never bulk-cleared, so the next meet starts with every seat "in use" (clear on successful adoption); the claim path is SELECT-then-INSERT, so a simultaneous claim surfaces a raw UNIQUE-constraint 500 to a volunteer (use `INSERT OR IGNORE` and check `rowsAffected`); `POST /seats/release` takes any seat name with no token, making force-release decorative.  Files: `server/routes/venue.js:148-183`.

L-2.  PIN first-set race: until PINs are set, `POST /pins` accepts any LAN device and `requireControlToken` passes everything, so a hostile or confused device can claim Control during setup.  Consider requiring physical confirmation (console) or binding first-set to the first device that adopted.  File: `server/routes/venue.js:50-70`.

L-3.  Worker hardening: no fetch timeout (a black-holed connection stalls the worker for minutes and can time out a concurrent check-in flush; add a 10-15 s AbortController); a lost-wakeup edge when `onAppend` fires during the final empty SELECT (set a pendingWake flag); after re-adoption by a different venue the old venue's pushes get 401 and retry forever labeled "Offline" (treat `invalid_sync_token` as terminal, or have the cloud return 410 when adopted under a different token).  File: `server/sync/worker.js`.

L-4.  Import hygiene: `IMPORT_ORDER` is a hand-maintained duplicate of `SNAPSHOT_TABLES` with no drift assertion (assert set equality at module load); the logo import writes any basename (require `meet_<meetId>.<ext>`) and a replace does not remove a stale logo with a different extension (delete `meet_<meetId>.*` first).  Files: `server/sync/adoptionImport.js:33-38, 131-141`, `server/sync/package.js:21`.

L-5.  `connection-info` prints `addrs[0]`; on a Pi with eth0 and wlan0 both up, the QR/overlay URL may name the wrong interface.  Prefer the default-route interface or list all addresses prominently.  File: `server/routes/venue.js:275`.

L-6.  Freeze-screen copy: the `handed_back` state shows "Meet checked in ... you can power tablets down", which is wrong on night 1 of a two-day meet.  Give handback its own text ("handed back for tonight; re-adopt in the morning").  File: `client/src/pages/venue/VenueRole.jsx`.

L-7.  FR-11 `judge_scores` dedup at boot has no adopted-meet exclusion, contradicting the FR-9 comment; if it ever fires, the `rowid` tiebreak can keep different rows on cloud vs venue.  Scope it, or run it only when the UNIQUE index does not yet exist.  File: `server/db/schema.js:341-373`.

L-8.  Sync endpoint hardening: no rate limit on `/api/sync/peek` and `/adopt` (cheap per-IP limiter to match the auth posture); `GET /:id/adoption` publicly discloses `released_by` (a username); token comparison could use `crypto.timingSafeEqual`.  Files: `server/routes/sync.js`, `server/routes/meets.js:280-297`.

L-9.  Venue `/adopt` and `/import-package` refuse only `meet_state === 'adopted'`; extend the `already_hosting` check to `'checking_in'` so an adopt racing an in-progress check-in cannot overwrite venue state mid-flow.  File: `server/routes/venue.js:298, 402`.

L-10.  Docs and packaging drift: the main CLAUDE.md Build and Package section still says the zip should be ~3 MB and flags >5 MB as an error (v2 fonts make ~7 MB correct); the `rm -f server/public/assets/index-*` cleanup line will not remove superseded hashed font files, so the assets directory will accumulate orphans across releases; `docs/VENUE_OPS.md` should note that the adoption lock is per-database, so with the Render+Railway dual-host setup anything still pointed at Railway is not locked by an adoption made on Render.

---

## Verified sound (no action needed)

These were checked explicitly and found correct: the FR-6 manifest matches the schema for all 19 tables including every ALTER (the v2 meets columns are exactly NON_SYNC_COLUMNS); `selectForMeet` scoping chains, including scratched registrations and soft-deleted athletes; canonical serialization (NULL vs empty string distinct, numeric collapse in the safe direction) with checksums computed by shared code on both sides; single-winner atomic code redemption and lock-then-snapshot ordering; `/peek` is read-only; `clearMeetLocal` covers every import table children-first; ID/short-code/timestamp preservation on import; manifest-columns-only upserts leaving cloud lock state untouched (including the `updated_at=updated_at` trick); the check-in happy path ordering (flush ok only when the outbox is empty and the worker idle, so the cloud has applied everything before either side checksums); cloud never unlocks on mismatch and all in-process check-in failures revert to `'adopted'`; D4 cloud invariance (the write hook is a null check in cloud mode, path-scoped 64 MB parsers, `/api/version` untouched); adoption-lock middleware fails closed, mounts before every mutating router including the inline routes, and the FR-9 boot mutations are scoped (except L-7); FR-11 dedup keeps the newest row and the tablet retry-as-UPDATE sets the same columns; FR-18 fonts (zero external-origin references in client source, built bundle, and static pages; the committed build in `server/public` matches `client/dist` and contains the venue code); iframe role wrappers use same-origin relative URLs so WS and short codes work; FR-17 (no wall-clock dependency in ordering; NTP and fake-hwclock in the image); systemd unit basics and the Avahi record.

## Suggested additions to the physical test plan

1. Pull power on the Pi mid-check-in (during the flush), power back on, verify scoring resumes and a check-in retry succeeds (C-1).
2. Kill the network between the cloud's checkin commit and the venue's receipt (e.g. drop the uplink right as check-in is submitted), then retry; verify no split brain and an accurate operator message (H-1).
3. Tap Check In instead of Hand Back on day 1 of a simulated two-day meet, then attempt day-2 re-adoption end to end through the venue UI, including the replace confirmation dialog (H-2, H-9).
4. Force-unlock from the cloud admin page, re-release, re-adopt on the same venue process without restarting it, score a run, and verify it reaches the cloud (H-5).
5. Run a meet with 200+ pre-seeded runs and measure Start Run latency on the Pi before and after the H-6 fix.
6. Boot the Pi with no snapshot stick inserted and verify the home screen warns; yank the stick mid-day and verify the warning appears within one cycle (H-10).
7. Verify SSH access to the flashed image with the documented credentials (H-11).
