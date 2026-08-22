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

## Step 1 — Remote judging flag + cloud lock machinery — NOT STARTED
## Step 2 — Adoption package + ID-preserving import — NOT STARTED
## Step 3 — Venue mode + home screen — NOT STARTED
## Step 4 — Upsync — NOT STARTED
## Step 5 — Check-in, handback, snapshots — NOT STARTED
## Step 6 — Packaging + docs — NOT STARTED
## Step 7 (optional) — Tablet submission buffering — NOT STARTED (may defer per plan)

---

## Full-suite status (Section 11)

Not yet runnable — items 1–9 accumulate as Steps 1–6 land. Item 10 (physical
confirmation run) is David's, after everything else passes.
