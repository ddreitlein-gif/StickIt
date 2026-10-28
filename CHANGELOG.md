# Changelog — Version Notes (v1.7.00 – v2.8.00)

Full feature notes for every release. The newest release is first. `CLAUDE.md` carries the
project guide plus a one-line index of these releases; when a new version ships, its full
`## vX.Y.ZZ Feature Notes` section is added at the top of this file (above the previous
release) and one index line is added to `CLAUDE.md`.

**v2.7.01 (2026-09-26) — Query indexes (Turso rows-read fix).** Twelve plain indexes on the `event_id` / `meet_id` / `registration_id` / `athlete_id` / `timestamp` columns the tablets poll every 2–3 s (`runs`, `registrations`, `judges`, `events`, `dual_bracket`, `event_phases`, `heats`, `audit_log`), created at boot with `CREATE INDEX IF NOT EXISTS` in `server/db/schema.js`. No query text, polling, scoring, bracket, tablet, venue or sync change; `SYNC_PROTOCOL_VERSION` stays 3. Golden compare of 757 read responses on one database served by v2.7.00 and v2.7.01: byte-identical except same-second audit rows now listing newest-first. Full notes below.

**v2.7.00 (2026-09-19) — Unified registration import.** One pipeline (`server/import/registrationImport.js`) reads SkiReg exports (CSV / XLSX, no USSS # — recovered by name from the USSS People File), RMF / Winfree Data files (Events codes and M / M2 / D tick columns resolved against the new `events.import_code`) and any Last-Name sheet; meet-level `POST /api/meets/:id/registrations/import` with preview → columns → events mapping (saved per meet in `meet_import_map`) → needs-attention; the per-event `import-csv` route is removed. No scoring, bracket, tablet or venue change; `SYNC_PROTOCOL_VERSION` stays 3 (`import_code` is NON_SYNC). Full notes below.

**v2.6.02 (2026-09-15) — Bracket Keeper as a plain Winfree-style line tree** (replaces the v2.6.01
box design, withdrawn the same day as overcrowded). **v2.6.01 (2026-09-15) — Bracket Keeper redesign.** The only changes outside the keeper: the one-line
`buildBracketPositions` anchor fix that also repairs the second semifinal on the `/dual-bracket`
PDF's finals page for 32 and 64 shells, and the additive export of `advancementSlot` /
`consolationSlot` from `dual.js`. Full notes below.

---

## v2.8.00 Feature Notes

### Skip Athlete — move down the run order for this run (v2.8.00)

Per David's 10-28-26 request: every surface that can start the next run now has a **Skip**
button beside Start Run / DNS — the Head Judge tablet, the Timekeeper tablet, the Scoring
Computer's Up Next row, and both dual-mogul surfaces (dual HJ tablet, dual Scoring tab).
It is for an athlete who is still competing but is not ready when called (binding, late to
the top, coach talk). Pressing it opens a small dialog — "Move *name* down how many spots?",
default 1, with −/+ 56 px targets — and re-inserts the athlete that far down the remaining
order for **this run only**. Rulings settled that day:

| Question | Ruling |
|---|---|
| Dual moguls | Included: a skip moves the whole **pairing** down within its own round/block; the server refuses to start a later-block match while a skipped pairing is still pending (409 naming the pairing and round). |
| Past the end | Clamp to last, no error. |
| Still not ready | Skip again (unlimited) or DNS; no special state. |
| Run scope | Current run number only. A Run 1 skip never changes Run 2, start lists, PDFs or later-phase order building. |
| Undo | **Restore spot** on skipped rows of the Scoring tab (singles and dual). Tablets only skip. |
| Pi sync | Venue-local, not synced; `SYNC_PROTOCOL_VERSION` stays 3. Skips are audit-logged (the audit rows sync). During a Pi meet the cloud's upcoming lists show the stored order until the next run starts. |

**No scoring, results, placement, run_position, export, PDF or sync-protocol change.**

#### How it works

- **The stored order is never edited.** Next-up has always been computed on the fly ("lowest
  `run_order` among registered athletes with no `runs` row for this run number"), and flat
  events reuse `registrations.run_order` for Run 2, the start-list / run-order PDFs print it,
  and later phases build from it. So skips live in a new table **`run_order_skips`** (one row
  per event / run number / athlete, or per dual match): `base_order` = the run_order (pairing
  number) the athlete had when skipped, `sort_order` = the effective key. Effective key =
  `CASE WHEN s.base_order = base THEN s.sort_order ELSE base END`, so a row is live only while
  the base number is unchanged — a reorder, random order, rebuild-order or locked-order scratch
  makes it inert on its own, with no cleanup at the ~9 base-order write sites. Responses keep
  `run_order` = the printed start number and add `skipped: true/false`.
- **Skip by k:** R = remaining list in effective order (same filter as `/runs/upcoming`),
  t = min(i + k, len − 1); t == i → `moved:false` (200, "already last"). The new key goes
  strictly between R[t]'s key and the next-higher key anywhere in the list (or +1 at the end),
  so keys stay distinct through repeat skips and never tie with the next dual block. UPSERT the
  athlete's row only; **Restore** deletes it and the base key returns.
- **One module, `server/runs/skips.js`**, owns the SQL (the `/next-up`, `/upcoming`,
  `getAgeGroupTransition`, viewer `/status` and phases `/eligible` literals), the key placement,
  `skipAthlete` / `restoreAthlete`, and the dual equivalents (`skipMatch` / `restoreMatch` /
  `earlierBlockSkipPending` over `roundBlocks()`).
- **Dual:** GET `/dual`, GET `/active-match` and the viewer bracket rows gain `run_sequence`
  (= pairing number unless skipped) + `skipped`; the HJ tablet, Scoring tab and Broadcast Board
  sort by `run_sequence ?? pairing_number`. `pairing_number` / `pairing_label` / `round_*` never
  change (printed on the bracket and keeper PDFs). A skip clamps to the last pending playable
  match of its own block. The Scoring tab's dual grouping is by `bracket_round`, so a
  consolation semi skipped past the main semis reappears when its group is next — the server
  guard allows it (same block).

#### Endpoints (existing routers, so event lock 403 + adoption lock 423 apply by prefix)

- `POST /api/events/:eventId/runs/skip` `{registration_id, run_number=1, spots=1}` — **public**
  (tablet rule, modelled on `/status-only`: allowed-fields check, registration-belongs-to-event,
  409 when the athlete already has a run for that number, 400 when not on the start list).
  Audit `run_order_skip`; broadcast `run_updated` (every next-up consumer already reloads on it).
- `DELETE /api/events/:eventId/runs/skip/:registrationId?run_number=N` — `requireAuth`
  (Scoring Computer only); 404 when no row; audit `run_order_skip_restored`.
- `POST /api/events/:eventId/dual/skip` `{match_id, spots=1}` — **public**; 409 for a complete /
  started / unfilled match, 400 for a bye. Audit `dual_match_skip`; broadcast the **new type
  `run_order_changed`** (`dual_match_cleared` would blank the Scoreboard's live panel and
  `dual_match_started` takes the venue spotlight / fires the Overlay animation). Listeners added:
  dual HJ tablet, dual Scoring tab, Scoreboard.
- `DELETE /api/events/:eventId/dual/skip/:matchId` — `requireAuth`; audit `dual_match_skip_restored`.
- `PUT /dual/active-match` — new 409 guard for a pending skipped pairing in an earlier block.
- Rows are deleted with the event, the meet, `buildBracketShell` and dual `/reset`; never cloned.

#### Client

- New `client/src/components/SkipDialog.jsx` (tablet and officials class sets).
- HJ tablet: Skip between Start and DNS (singles card, inside the `start_run_head_judge` gate;
  re-fetches `/next-up` first like Start Run and refreshes a stale card instead of skipping);
  dual Next Pairing card gets Skip beside Start Run.
- Timekeeper tablet: Skip between Start and DNS (inside the `start_run_timekeeper` gate).
- Scoring tab (`ScoringPanel`): the remaining list follows the server queue (`/runs/upcoming`
  for the current run, re-fetched after every reload); Skip on the first Up Next row, a
  **SKIPPED** chip + **Restore spot** on any skipped row (Up Next and Remaining, phased and
  flat), an amber notice line for the server's message. `DualScoringPanel`: Skip beside Start
  Match on the Up Next pairing, pairing label + SKIPPED chip in the "vs" cell, Restore spot on
  skipped pending rows; the Start Match 409 shows in the existing error line.

#### Ultra review (10-28-26) — six findings, all fixed before release

- **Double skip from two tablets** (normal): `POST /runs/skip` and `POST /dual/skip` take an
  optional `expected_position` (the 1-based position the caller saw); the server refuses with
  409 when the target has moved ("no longer at position 1 (now 2 of 8) — another tablet may
  have skipped them already"). Every surface sends 1, and the Timekeeper and dual HJ tablets
  now re-fetch the next-up card before skipping, as the singles HJ path already did.
- **Phase delete left skip rows behind** (normal): `DELETE /phases/:id` also removes that run
  number's rows, so a re-added phase with the same order cannot revive a skip.
- Venue replace-import (`clearMeetLocalStatements`) clears the meet's skip rows.
- The live dual match (its `dual_bracket.status` stays `pending`) can no longer be skipped and
  never blocks a later round (`waiting()` excludes `events.active_dual_match_id`).
- `parseSpots` / `parseExpectedPosition` live in `server/runs/skips.js` for both routes.
- The dual `byRunOrder` comparator is imported from `broadcastDual.js` in the Scoring tab and
  the HJ tablet instead of being copied.

#### Harness / verification

- New `harness/tests/v280.test.js` — 114 checks: flat skip by 1 / k / clamp / last; repeat
  (one UPSERTed row) / restore / 404; DNS of a skipped athlete, skip mid-run, stale-card 409,
  `run_position` unchanged; phased (a Run 1 skip never reaches Run 2 "same" order; a Run 2 skip
  leaves Run 1 and the stored order alone; rebuild-order makes a changed-number row inert);
  no-effect byte compare of results / judge scores / viewer results / CSV / start-list +
  run-order PDFs across a skip; dual (run_sequence 3.5 between pairings, labels + bracket /
  keeper PDFs identical, block clamp, only-pending → moved:false, later-block 409 then 200,
  restore, `/reset` clears rows); access (adopted meet 423, locked event 403, protection ON →
  public skip 200 / anonymous restore 401 / token 200).
- `v2701` TOP_QUERIES carry the new literals; `canonBody` strips the additive `skipped` /
  `run_sequence` keys; `zz-gates` V2_ONLY_KEYS gained `skipped`, `run_sequence`.
- Help: `tablet-hj`, `tablet-time`, `scoring-live`, `reg-runorder`; guides and venue cards
  regenerated. `docs/SYNC_PROTOCOL.md` records the venue-local table (no bump).

## v2.7.02 Feature Notes

### Two Login Roles — Judge / Official and System Admin (v2.7.02)

Per David's 10-28-26 request: the three login roles (Judge, Official, System Admin) are
compressed to **two** — **Judge / Official** (full access to everything in the Officials section)
and **System Admin** (everything, including the Admin panel) — so the test users set up as
System Admin can be moved to Judge / Official **without deleting anyone or changing a password**.
Cloud auth only (venue mode never renders Login and `users` is not a sync-manifest table);
**no schema change, no sync-protocol change (still v3), no scoring / tablet / venue change.**

**Model.** `server/auth/roles.js`: `VALID_ROLES = ['official', 'system_admin']`;
`ROLE_RANK = { judge: 2, official: 2, event_admin: 3, system_admin: 3 }` — the stored value for
Judge / Official stays `official` (no data rewrite for the common case), and `judge` /
`event_admin` remain as legacy aliases so an un-migrated row still resolves. Mirrored in
`client/src/auth/RequireAuth.jsx`. **Boot migration** (`schema.js`, beside the v1.25.00
event_admin one): `UPDATE users SET role='official' WHERE role='judge'` — idempotent, logs
`[v2.7.02 migration] N judge-role user(s) migrated to official` only when N > 0, touches no
other column. The judge-only UI limits went with the role: the Meets-only sidebar
(`NAV_JUDGE`, `Layout.jsx`) and the Links-only event page (`isJudge`, `EventDetail.jsx`) are
removed; every login sees the full Officials UI. Admin → Users: `ROLES` is the two values,
labels **Judge / Official** / **System Admin** (legacy rows, if ever seen pre-migration, show
"(legacy)" labels); creating or editing a user to `judge` is refused 400 by the existing
`VALID_ROLES` check. The last-active-admin deactivation guard and the "set an admin password
before enabling protection" check already counted only system_admin / event_admin — unchanged.

**Why a role change is safe for existing accounts.** `PUT /api/admin/users/:id` updates `role`
through `COALESCE` and touches `password_hash` / `must_change_password` only when a new
`password` is sent; sessions carry the user id, not the role, and `requireAuth` re-reads the
row per request — so a demoted user's existing session loses `/api/admin` immediately (403)
and keeps working for the Officials section, and their next login with the unchanged password
returns `role: official`. **The demotions themselves are data, not code** — David does them in
Admin → Users (Edit → Role → Save) after the deploy; a boot rule "everyone but admin and
ddreitlein" was rejected because it would also demote any admin created later.

**Docs.** Help `admin-users.md` (two-role table, role change leaves the password alone,
username editable since v2.0.01 — the topic still said it could not be) and
`admin-security.md` (role table); guide PDFs regenerated; venue PDFs regenerated (footer).
CLAUDE.md Access Model roles paragraph rewritten.

**Verification.** Scratch-server test (21 checks): a planted `judge` row + official + two
system_admins → boot migrates exactly the judge row, every `password_hash` byte-identical, no
`must_change_password` set, log line with the count; the migrated user logs in with the old
password as official, reaches GET/POST Officials endpoints, 403 at `/api/admin`; POST / PUT
with role `judge` → 400 naming the two roles; demotion PUT (role only) → 200, hash + flag
untouched, existing session 403 at admin / 200 at Officials, re-login as official; promotion
back works; second boot silent and healthy. Playwright (6 checks, built bundle): users table
shows **Judge / Official**, no bare "Judge" label, the Edit drop-down offers exactly the two
roles, a UI demotion changes only the role column, the migrated judge-role login gets the full
sidebar (Athletes, USSS Database) and is bounced from `/admin`. `verify_v16.js` 123/123.

**Files modified:** `server/auth/roles.js`, `server/db/schema.js`,
`client/src/auth/RequireAuth.jsx`, `client/src/pages/admin/AdminUsers.jsx`,
`client/src/components/Layout.jsx`, `client/src/pages/EventDetail.jsx`,
`client/src/help/topics/{admin-users,admin-security}.md`, `server/public/docs/guides/*.pdf` +
`server/public/docs/venue/*.pdf` (regenerated), `CHANGELOG.md`, `server/version.js`,
`client/src/components/Layout.jsx`, `client/package.json`, `server/package.json`,
`server/public/*` (rebuilt), `CLAUDE.md`

---

## v2.7.01 Feature Notes

### Query Indexes — Turso Rows-Read Fix (v2.7.01)

Implements `Claude Output/StickIt_Turso_Rows_Read_Index_Implementation_Prompt_09-26-26.md`
(Turso alert 09-26-26: 410.9 M of the 500 M monthly rows-read quota used, 264.9 M on the 26th
alone against 2,095 rows written). Cause: the schema had exactly one index (the FR-11 unique
index on `judge_scores`) plus two table-level UNIQUEs, so every `WHERE event_id = ?` on
`runs` / `registrations` / `dual_bracket` / `judges` / `event_phases` / `heats` and every
`WHERE meet_id = ?` on `events` was a full table scan, and the judge / HJ / Timekeeper
tablets issue three or four of those every 2–3 s. Turso bills every row a scan touches.
**Indexes only**: no query text, polling interval, scoring, run-order, seeding, phase, bracket,
tablet, venue-server or sync change; nothing under `server/routes/`, `server/scoring/`,
`server/dual/`, `server/venue/`, `server/sync/` or `client/src/` except the Layout.jsx version
default. **`SYNC_PROTOCOL_VERSION` stays 3** — indexes are not rows; the manifest, adoption
package, outbox and check-in checksums are untouched (step0 drift test green as is).

**The twelve** (`QUERY_INDEXES` in `server/db/schema.js`, right after the FR-11 block, raw
client `c.execute` so the venue write-capture hook — which wraps the module's `execute()`,
never the client — cannot see the DDL; one `CREATE INDEX IF NOT EXISTS` per name, each in its
own try/catch, loud and non-fatal, then one log line `[v2.7.01 index migration] N of 12 query
indexes present`): `idx_runs_event_status` (event_id, status), `idx_runs_event_run_number`
(event_id, run_number), `idx_runs_event_round_status` (event_id, round, status),
`idx_runs_registration` (registration_id), `idx_registrations_event_status` (event_id, status),
`idx_registrations_athlete` (athlete_id), `idx_judges_event`, `idx_events_meet`,
`idx_dual_bracket_event`, `idx_event_phases_event` (event_id, run_number), `idx_heats_event`,
`idx_audit_log_timestamp`. All plain (never UNIQUE — production holds a historical duplicate
`runs` row), additive (the v1.30.03 rollback gate still passes), idempotent. A box already
holding one of the names boots clean. `EXPLAIN QUERY PLAN` on every Turso Top Query: before
`SCAN runs` / `SCAN registrations` / `SCAN djp` / `SCAN pro` / `SCAN e`, after
`SEARCH … USING INDEX idx_…` on every one (the two join queries that used to scan the
OTHER table — `dual_judge_points`, `phase_run_order` — now enter through the bracket / phase
index and hit the existing UNIQUE autoindexes). Every static SELECT explained; none with an
event / meet equality still scans an indexed table. The boot line counts indexes by
DEFINITION (a name already taken by an index with other columns is kept by IF NOT EXISTS,
logged as a WARNING, and not counted).

**The one real risk — row order — audited and measured.** An index can only change the order
of rows that tie on the ORDER BY (or have none), because SQLite's incidental order follows the
access path. Rule used throughout: an index whose every column is pinned by equality yields the
matching rows in rowid order, exactly like the old table scan, so most sites are provably
unchanged. All 462 SELECTs reading the eight tables were classified (handoff note
`Claude Output/StickIt_Turso_Index_Release_Notes_09-26-26.md`): (a) 399 order-determined or
order-free, (b) 39 re-ranked in JS (`rankResults` / `pickBestRun` / `assembleTieredResults`,
per-match / per-athlete maps, shuffles), (c) 24 where the incidental order of tied rows can
differ. **Observed (2):** audit lists (`/api/audit`, Admin dashboard) — the timestamp index
satisfies `ORDER BY timestamp DESC` walked in reverse, so rows sharing one timestamp SECOND
now list newest-first where the sorter listed them oldest-first (and a LIMIT-20 window inside
one busy second holds its newest rows); the set of rows, filters and cross-second order are
unchanged — arguably the intended order for a newest-first list. TD report: judges tying
completely on (event_date, created_at, role) — only imported meets, whose events share one
creation second — list per event instead of per insertion (two HJs of the RMF mock meet swapped
on one line). **Theoretical (5):** training-day / registration-listing "first bib seen" for an
athlete carrying DIFFERENT bibs in two events of one meet now comes from the earliest-created
event rather than the earliest-created registration (follow-up: a deterministic rule would be a
query change); the Registration tab and meet-export row order among athletes with no run
order, no bib and the same last name (dns before registered); the meet status card's "current
round" word when runs of two different run numbers complete in the same second (paper mode);
the run-order / check / timer sheets' athlete order among athletes with neither run order nor bib
(dns first); Import Bibs from Event's by-NAME fallback with two same-name athletes in the source
event; the venue auto-follow DB fallback after a mid-day reboot with two events holding scoring
runs updated in the same second; and the row order inside the meet export zip / adoption package
(grouped per event — checksums are order-independent; only these same tie cases can differ
between a cloud meet and its venue copy). **Closed, no action (David's ruling 09-26-26):** none is
a real issue; the same-second audit order is the better order for a newest-first list, the rest
are invisible or cosmetic. No secondary ORDER BY is planned.

**Verification.** `harness/tests/step0.test.js` §E grew 17 checks (fresh cloud + venue DB hold
the twelve, plain, on their tables; boot logs say 12 of 12 with no FAILED line; a
v1.30.03-shaped legacy DB with duplicate `runs` rows AND one index pre-created under its name
boots clean with exactly one copy; a name taken by an index with OTHER columns is kept,
warned about and not counted — 11 of 12; second boot byte-identical in `sqlite_master`, no
error lines) — **106**. New `harness/tests/v2701.test.js` — **43 checks green**: **A golden compare**
— one database file built through the REAL v2.7.00 server (git tag, worktree
`harness/.v270baseline`, gitignored): 24-athlete Best-of-2 with a rejection and a DNF (Run 1 +
Run 2 finalized), 12-athlete qualifier / finals with a DNS, aerials v2 (3-judge panel, manual
entry), 16-athlete dual runoff to 8th played to completion, the real
`RMF_Mock_Comp_08-30-26.zip` import; 757 responses captured on v2.7.00 and again on this tree
serving the same file (every tablet / Scoreboard / Overlay / Broadcast Board / Viewer API /
Officials GET, per-run scores, per-match judge points, CSV / USSA / XLSX sheet XML / HTML /
print exports, 19 PDF kinds through `pdftotext`), request-time stamps and the version string
normalized: **byte-identical except the two recorded (c) instances above**, asserted as the
only tolerated classes (the "before" server is rebooted once before its capture so v2.7.00's
own boot-time import-code backfill on the imported events cannot masquerade as a diff).
**B EXPLAIN QUERY PLAN** before / after for the nine Top Queries and all 286 static SELECTs
(listing in `harness/.scratch/v2701/plans.txt`). **C venue mode**: adopt → cloud stopped →
venue rebooted on the adopted DB (12 of 12, nothing DDL-shaped in `sync_outbox`) → two runs
scored offline (50 outbox rows, all manifest-table `upsert` / `delete` records) → cloud back
→ drained → check-in 200 with equal cloud / venue checksums. `verify_v16.js` 123/123. Full
harness **1,265 green** (review-ui 6, review 56, step0 106, step1 52, step2 58, step3 55, step4
52, step5 40, step6 34, v240 124, v250 140, v2506 42, v2507 62, v260 89, v2601 72, v270 203,
v2701 43, release-gates 31; the review suite crashed once in an all-suites run on its venue
check-in's "cloud unreachable" 502 — the v2.1.00 timing flake — and passed clean alone).
**Cloud ultra review (09-26-26) — passed, ZERO findings** on the source-only diff (4 files /
768 lines, branch `review/v2.7.01-source`, docs / build assets / version bumps stashed). A local
high-effort review beforehand raised ten items — the vacuous outbox-op assertion, the too-broad
"no error lines" regex, dead code in the new suite, the name-only boot count, the untracked new
bundle at commit time, and the tie-order sites listed above — all fixed here or recorded as
follow-ups. Gotcha: running the v270 suite rewrites the bytes of
`harness/fixtures/registration/skireg_copper.xlsx` — `git checkout` it before committing.

**Release.** Version bump, client rebuilt (Layout default), venue PDFs regenerated (footer),
zip `StickIt_2_7_01.zip`, GitHub Release with the v2.5.06 Pi image re-attached (nothing
venue-side changed). No manual `CREATE INDEX` on Turso — the first Render boot does it; check
the Render log for the "12 of 12" line, then the Turso Top Queries per-execution rows read the
next day (should fall from thousands to tens).

**Files created:** `harness/tests/v2701.test.js`
**Files modified:** `server/db/schema.js`, `harness/tests/step0.test.js`, `harness/.gitignore`,
`CHANGELOG.md`, `server/version.js`, `client/src/components/Layout.jsx`, `client/package.json`,
`server/package.json`, `server/public/*` (rebuilt), `server/public/docs/venue/*.pdf`
(regenerated footer), `CLAUDE.md`

---

## v2.7.00 Feature Notes

### Unified Registration Import — SkiReg, RMF / Winfree Data files, XLSX (v2.7.00)

Implements `Claude Output/Registration Import Handoff 09-19-26/StickIt_Registration_Import_Implementation_Prompt_09-19-26.md`
(Cowork compatibility assessment + David's 09-19-26 rulings). Measured before: **0 athletes
registered from all 55 sample files** — the event importer read fixed SkiReg column names and
refused every row without a USSS Member # (the 2026 SkiReg export has none), the RMF Data
files had no category column, and neither importer could tell Copper's Saturday and Sunday
moguls apart. **No scoring math, no run-order, seeding, phase, bracket, tablet, or
venue-server change**; nothing under `server/scoring/`, `server/dual/`, `server/venue/`
touched, `server/sync/` only the two `protocol.js` lines below. **`SYNC_PROTOCOL_VERSION`
stays 3**: `events.import_code` is a cloud-side registration aid excluded from the manifest
(`NON_SYNC_COLUMNS.events`; NULL on a venue box, preserved on the cloud through check-in
because the upsert writes manifest columns only) and `meet_import_map` is a cloud-only table
outside the manifest (never packaged, never captured by the outbox) — no canonicalisation
change, so a v2.5.06 Pi and a v2.7.00 cloud agree on every row hash. `registrations` and
`athletes` gained no columns: imported rows are ordinary rows. **Ruling recorded (David,
09-19-26):** from an event's own Registration tab, a file with no entry information at all
(the Devo Data files) registers its matching-gender rows straight into that event (Winfree's
"default event"); from the Meet-page button the rule-8 prompt still applies. **The 09-19-26
Claude Output folder note** ("Registration Import Notes" at the bottom of this file) replaces
the wrong pre-v2.7.00 SkiReg column list.

**Pipeline** — new `server/import/registrationImport.js` (pure stages 1–3, unit-tested
without a server): `parseFile` (CSV / XLSX, UTF-8 else windows-1252, header = first row
within 20 holding a Last Name synonym, duplicate / empty headers tolerated), `mapColumns`
(Winfree synonym table + SkiReg / Winfree-export spellings after NFD-strip + lower + a-z0-9;
ignore list; entry columns = header equal to an event's import_code / name / usss_code;
duplicates warned), value rules (`Last, First` split, gender first letter, birth year = first
1900–now four-digit group — `3/7/1990` is 1990 not 3, USSS # 5–8 digits with `bad_ussa_num`
for the literal `ID`), markers (`category` string, Events codes tokenised longest-first
against the meet's import codes — `MDM2` → M, D, M2, `MQ` → M + `bad_events_code`, ticked
entry columns, else `(no entry information)`), `resolveMarker` (rules 1–8: not-an-event
keywords, gender from the row else the text, discipline word, candidates, date / day cue
against `event_date` — only when a candidate carries a date, `date_mismatch` never falls
through — series word, exactly one; saved mapping overrides all), identity
(`resolveIdentity`: athletes by USSS # → FIS → **USSS People File by normalised name** with
gender then a shared 4+-letter club word as tie-breakers, `ambiguous_usss` with the candidates
listed → athletes by name incl. soft-deleted → new, `no_usss_match`), `previewImport` /
`commitImport` (people grouped by USSS # else name; the same number on two names → both
`duplicate_ussa_num`; flagged people written only when ticked; existing athletes get blank
fields filled, adoption-locked athletes never updated but still registered; commit re-runs the
preview and refuses 409 `preview_changed` on a token mismatch, 400 `mapping_required` while a
marker is unresolved; one `import` audit row per commit; confirmed table saved to
`meet_import_map`).

**Server.** `POST /api/meets/:id/registrations/import?mode=preview|commit` (`requireAuth`,
multer memory 10 MB, form fields `event_id`, `column_overrides`, `mapping`,
`include_flagged`, `preview_token`; adoption lock + venue freeze through the mount — 423 on an
adopted meet). `POST /api/events/:id/registrations/import-csv` **removed** (404) with
`processCsvRows` / `matchesDiscipline`. `events.import_code` (auto-assigned on POST: M / D / A
suffixed 2, 3… per meet + gender + discipline; PUT validated `^[A-Z][A-Z0-9]{0,3}$`, unique per
meet + gender → 409; on every GET; clone copies; export / import / merge round-trip; boot-time
backfill `backfillImportCodes` in `event_date, created_at` order, marker
`migration_v27_import_code_done`, idempotent on NULLs, skips adopted meets, no-op in venue
mode). `meet_import_map` (`UNIQUE (meet_id, marker_norm, gender)`) deleted with the meet and
with the event it points at; not cloned. Athlete-only paths `POST /api/import/athletes/csv` and
`POST /api/athletes/reconcile` read bytes (CSV or XLSX via `X-File-Name`) through the new
parser with the People File lookup added; `reconcileHelpers.js` keeps `parseCSV` /
`normalizeRow` / `SYNONYMS` as thin wrappers. Test hook `STICKIT_DISABLE_USSS_SYNC=1`
(never set in production) keeps the boot-time People File sync off a harness instance.

**Client.** New `RegistrationImportDialog.jsx` (replaces the deleted `CsvImportModal.jsx`):
File → Columns (only when a header is unknown or two map to one field; drop-down per column,
re-runs the preview) → Events (only when a marker is unresolved; every marker listed with count,
reason and an event drop-down + Not an event; the whole confirmed table is saved) → Preview
(per-event cards, To Register with a source badge, Needs Attention with tick boxes, Already
Registered, Not in This Event, People-File-not-synced notice; Confirm disabled until nothing is
unresolved) → Result. Meet page **Import Registrations** button (disabled without events or
while adopted); event Registration tab button renamed **Import Registrations…** and passes
`event_id`; event form gains **Import code (Winfree short name)** (blank = server assigns),
Details tab shows / edits it, Registration tab shows a chip. Athletes page Import + Reconcile
panels accept `.xlsx`, send the file as bytes, and the help text names the accepted headers.
`api.importRegistrations(meetId, formData, mode)`.

**Docs.** `reg-skireg.md` rewritten as *Importing registrations (SkiReg, RMF / Winfree,
XLSX)*; `reg-register.md`, `meets-edit.md`, `athletes-db.md`, `ref-glossary.md` (import code,
entry marker, People File lookup) updated; guide PDFs regenerated (67 topics, 164 pages); venue
PDFs regenerated (footer); `docs/SYNC_PROTOCOL.md` §6 NON_SYNC sentence.

**Verification.** New `harness/tests/v270.test.js` — **203 checks green** (synthetic
fixtures in `harness/fixtures/registration/`, generated by `build_fixtures.js` with invented
people — the real sample files hold minors' names and are never committed): pure functions
(junk rows above the header, every synonym incl. `Prénom` / `Année de Naissance` / `ID#` /
`Bib#` / `USSS Member #` / `Year of Birth` / `Representing` / `From`, name split, gender
rule, the three date forms, windows-1252, XLSX ≡ CSV, duplicate headers), tokeniser,
resolution (the six Copper categories with `*** FULL **I` noise, banquet / coaches / fee,
ambiguous, date_mismatch, weekday, series word, no-info files meet-level vs per-event, saved
mapping), identity (People File by name, twins by gender / club word, local athlete gains its
number, locked athlete registered but not updated, unknown flagged and written only when
ticked, same number on two names, three SkiReg rows → one athlete / three registrations with
the mogul bib), endpoint (preview writes nothing, commit + audit + map, 400 / 409 / 423, filter,
idempotent re-import, saved mapping prompts only for a new category, `import-csv` 404),
import codes (auto, 409, backfill in date order across a restart, clone, export → import,
event / meet delete cleanup, venue NULL after adoption, no outbox rows for
`meet_import_map`, cloud codes survive check-in, protocol 3), athlete-only endpoints
(regression counts, People File fill, XLSX, paste, reconcile shape), Playwright (meet page →
dialog → six cards → confirm → Registration tab; Events step with one unresolved row → pick →
confirm; per-event button registers only that event). **Env-gated real-sample pass**
(`STICKIT_REG_SAMPLES=<folder>`, the app's own USSS sync loads the current People File) —
**165 checks green on all 63 sample files** (People 2026 List 7, 2,821 records): every RMF Data
file 0 unmapped headers, every marker resolved (the Devo / RQS / DM Reg files with no entry
information prompt on a multi-event meet by design), USSS numbers 100 % except Vail Comp 2026
(90/91 — 10 rows lacked an ID, the lookup filled 9); every SkiReg file (CSV and XLSX) with no
prompt on a meet built from its own categories, banquet / coach / fee rows not events, USSS
match 95.7–98.6 % except REG_8515 (38/41, 92.7 %) and REG_9008 (30/32, 93.8 %) against the
September list — the harness threshold is 90 %; REG_7722 duplicate-club warning; Winfree
results and start-list files parse. Chrome walkthrough of the Copper SkiReg import on a
scratch server reviewed by eye. Regression: `verify_v16.js`, step0 (drift test with the
NON_SYNC entry), step1 (route gate: new route in scope, `import-csv` gone), step2, step4,
step5, review, release-gates (`V2_ONLY_KEYS` + `import_code`), v240, v250, v2506, v2507,
v260, v2601 — **full harness 1,203 green** (review-ui 6, review 56, step0 87, step1 52, step2 58,
step3 55, step4 52, step5 40, step6 34, v240 124, v250 140, v2506 42, v2507 62, v260 89, v2601 72,
v270 203, release-gates 31); `verify_v16.js` 123/123.

**Files created:** `server/import/registrationImport.js`,
`client/src/components/RegistrationImportDialog.jsx`, `harness/tests/v270.test.js`,
`harness/fixtures/registration/*`
**Files deleted:** `client/src/components/CsvImportModal.jsx`
**Files modified:** `server/routes/{meets,events,registrations,import,athletes,reconcileHelpers}.js`,
`server/db/schema.js`, `server/sync/protocol.js`, `server/usss/sync.js`,
`client/src/pages/{MeetDetail,EventDetail,Athletes}.jsx`, `client/src/utils/api.js`,
`client/src/help/topics/{reg-skireg,reg-register,meets-edit,athletes-db,ref-glossary}.md`,
`client/src/help/topicsIndex.js`, `docs/SYNC_PROTOCOL.md`, `harness/tests/zz-gates.test.js`,
`CHANGELOG.md`, `server/public/docs/guides/*.pdf` + `server/public/docs/venue/*.pdf`
(regenerated), `server/version.js`, `client/src/components/Layout.jsx`,
`client/package.json`, `server/package.json`, `server/public/*` (rebuilt), `CLAUDE.md`

---

## v2.6.03 Feature Notes

### Bracket Keeper — Open-Line Labels Below the Line (v2.6.03)

David's 09-15-26 review of v2.6.02 ("mostly good"): the "Won M-01" / "Lost M-06" label on a
line still to be filled sat ABOVE the line, in the space the volunteer writes the name into. Now
it prints below the line, small, at the left, beside the course word — the space above every
open line is clear for a handwritten name — and the line pitch grew from 30 to 32 pt for the
same reason. Consequence: a 64 shell's 7th/8th section moves to a 6th page and an 8 shell with runoff to
8th takes 2 pages (16 shell still 2, 32 shell 3). Keeper only; harness v2601 expectations updated (72 checks).

**Files modified:** `server/routes/pdf.js`, `harness/tests/v2601.test.js`, `server/version.js`,
`client/src/components/Layout.jsx`, `client/package.json`, `server/package.json`,
`server/public/*` (rebuilt), `server/public/docs/venue/*.pdf` (regenerated footer), `CLAUDE.md`

---

## v2.6.02 Feature Notes

### Bracket Keeper — Plain Line Tree (v2.6.02; replaces the v2.6.01 design)

**What happened.** v2.6.01 (same day, 09-15-26) shipped the Claude Design box layout from
`Claude Output/StickIt_Bracket_Keeper_Implementation_Prompt_09-15-26.md`. David rejected it on
sight: overcrowded, too much redundant text, unusable next to the Winfree keeper officials know.
Root causes recorded so they are not repeated: (1) the prompt copied the mockups' CSS-pixel
measurements as points, so type was a third too large for the boxes; (2) the design itself carried
far more text than the job needs (two-line pointers in every header, stub labels, badges, a
run-order strip, an instruction line, a how-to block, a start list, a result panel); (3) the
64-shell "compact" variant was unreadable; (4) the pages were reviewed as 60 dpi thumbnails, which
hid every collision. **Ruling (David, 09-15-26): disregard the Claude Design suggestions; functional
not beautiful; keep it simple and informative like Winfree's, without the redundancy.**

**The keeper now** (`POST /api/pdf/bracket-keeper`, still `requireAuth`, same request body and
filename; **portrait** Letter). A bare line tree: one line per skier, `bib  LAST, First  (seed)`
printed above the line when known, `Won W-03` / `Lost W-06` (+ `(p.n)` when that match is on
another page) on a line still to be filled, the course word (Blue / Red) under the right end of
every line, the pairing label in a small oval at each junction (Winfree's circled number), the
placing at the end of each deciding line (`1st` + `(loser 2nd)`, `3rd`, `5th`, `7th`), a boxed
section title. Byes leave their first-round space blank; the athlete is already printed where they
enter. A quarter/eighth section ends with `to W-28 (p.3)` + course. No scores, boxes, badges,
tick boxes, strips, instructions, start list or result panel. Sections (`planKeeperSections`):
≤16 shell one tree (*Round of 16 to Final*), 32 shell four *Round of 32 to Quarter-Finals —
Section q of 4* + *Semi-Finals and Final*, 64 shell eight sections to the Round of 16 +
*Quarter-Finals to Final*; then *3rd / 4th Place*, *5th – 8th Place* (cons semis → 5/6), *7th / 8th
Place* (legacy pre-F-2: 5th/6th and 7th/8th directly). Sections flow down the page (30 pt per
line) and start a new page when they do not fit; a main section wider than a page splits by
first-round positions. Pages: 16 shell 2 (1 without runoff to 8th), 28/32 athletes 3, 8 shell 1,
64 shell 5 (6 from v2.6.03) — independent of byes. The routing (`keeperRoutes` / `keeperOrigins`, courses from
`dual.js advancementSlot / consolationSlot`) and the one-line `buildBracketPositions` fix from
v2.6.01 are unchanged and remain the only code outside the keeper's own route.

**Verification.** `harness/tests/v2601.test.js` rewritten for the line tree — 72 checks: routing
vs `advanceWinner` on 16 / 28 / 6-athlete brackets played through; every label printed, two
digits; page plans 2 / 1 / 1 / 2 / 3 / 3 / 1 / 1 / 5 / 5 / legacy; entrants pre-printed with bib,
name, seed; bye athletes on the line they enter; exactly one Won/Lost label per empty slot (and
none once complete); section outputs `to W-nn (p.3)`; placings; no strips/instructions/pointers;
nothing below 7 pt; mid-day print with identical line geometry and winners on the next lines;
`/dual-bracket` 32-shell finals page + `buildBracketPositions` old/new equality; `requireAuth`.
Every shape reviewed at 100 dpi full-page renders (not thumbnails). Regression: v2507, step1,
`verify_v16.js`.

**Files modified:** `server/routes/pdf.js` (keeper route + planner rewritten; exports
`keeperRoutes`, `keeperOrigins`, `planKeeperSections`, `buildBracketPositions`),
`harness/tests/v2601.test.js`, `client/src/help/topics/reports-pdf.md`,
`server/public/docs/guides/*.pdf` + `server/public/docs/venue/*.pdf` (regenerated), `CHANGELOG.md`,
`server/version.js`, `client/src/components/Layout.jsx`, `client/package.json`,
`server/package.json`, `server/public/*` (rebuilt), `CLAUDE.md`

---

## v2.6.01 Feature Notes

### Bracket Keeper Redesign (v2.6.01 — WITHDRAWN the same day, see v2.6.02)

Shipped the Claude Design box layout (pointers, stubs, badges, run-order strip, how-to, start
list, result panel; `Claude Output/StickIt_Bracket_Keeper_Implementation_Prompt_09-15-26.md`).
Rejected by David as overcrowded and unusable; replaced by the v2.6.02 line tree. Two things from
this release survive: the one-line `buildBracketPositions` anchor fix (`roundOffset = rounds[0] -
round`) that repairs the missing second semifinal on the `/dual-bracket` PDF's `[3, 2, 1]` page for
32 and 64 shells (16- and 8-shell output provably unchanged), and the additive
`module.exports` of `advancementSlot` / `consolationSlot` from `server/routes/dual.js`. Everything
else from v2.6.01 is gone.

---

## v2.6.00 Feature Notes

### Broadcast Board (v2.6.00)

Implements `Scoring Server/StickIt_Broadcast_Board_Implementation_Plan_09-12-26.md` (Cowork
session + Claude Design Direction A), per David's 09-14-26 request, reconciled with the v2.5.07
dual bracket work: the board only READS the bracket the server has built (blue/red slots per
4310.3.1, mirrored 5–8 consolation, `round_name` labels, `pairing_number` run order) and never
predicts, re-ranks, or re-seeds anything. **No scoring math, no schema change, no sync-protocol
change (still v3), no change to scoring / score entry / the dual bracket.** Two rulings recorded
from the chat: **(1)** a dual pairing whose side the server has not filled yet shows the feeder
placeholder ("Winner of 11" / "Loser of 12", from the feeder's pairing number) on NO course; the
athlete appears on blue or red only once the bracket has written them into a slot — a second
copy of the 4310.3.1 rule on the client was rejected; when one side is already filled the
placeholder takes the only remaining slot (no prediction involved). **(2)** Final Placings
(Frame 5) show as soon as every run of the last phase / the championship final is complete,
badged **UNOFFICIAL**, and flip to **OFFICIAL** when the Head Judge finalizes the event (the
plan's table only had the OFFICIAL case).

**What it is.** A new public, read-only, non-interactive 1920x1080 results board at
**`/broadcast/:eventId`** (short code or UUID via `useResolveIds`) for the stream crew's
YoloBox / OBS browser source, cut to between athletes. Opaque light ground, navy header band
(148 px + 10 px red stripe: meet name / event name / phase or round label / OFFICIAL badge) and
footer band (70 px: caption, blue/red legend on duals, one rotation bar per page in the cycle).
The stage is scaled to the viewport with `transform: scale()` and letterboxed. Root sets
`pointer-events:none` + `user-select:none`, no buttons / links / inputs / handlers, no
scrollbars, **no LIVE badge** (replays). Pages rotate every 12 s (`?page=4..30`); a data
refresh never resets the timer (the index is reset only when the board STATE changes).
300 ms opacity fade between pages, disabled under `prefers-reduced-motion`. Fonts: Barlow
Condensed + Inter Tight (already bundled, FR-18) — the Playwright suite asserts no request
leaves the origin. WebSocket (`/ws`, subscribe by eventId) + a 3 s poll fallback; a
sequence counter drops a stale poll response that lands after a newer load.

**Board state** (derived from data only): `waiting` (no scored result → Frame 1 headed START
LIST from `/runs/upcoming`, time/total blank), `moguls_live` (mogul / aerials; Frame 1 pages of
8 with a Frame 2 Latest Result inserted after each once a published score exists in the current
round), `dual_round` (Frame 3, the current block's pairings, 8 per page), `dual_finals` (Frame
4), `placings` (Frame 5 UNOFFICIAL), `complete` (Frame 5 OFFICIAL). Frames: **1** leader rows
with exactly five fields (rank chip — medal colour for 1–3 only — bib, name at 50 px, time,
total; DNF/DNS/DSQ rows never on a leader page) + Still To Come (next three of `/runs/upcoming`,
team from the public meet-scoped event GET's registrations since `/upcoming` carries no club) +
the meet logo panel (event logo never upscaled; bottom logo beneath at ≤ half the panel; panel
omitted with no logo). **2** hero (bib, name 92 px, TIME, TOTAL, "NOW 2ND" from the combined
`/results` rank) over ranks 1–5 with the athlete's row outlined (1–4 + the athlete when outside
the top five); footer "LATEST RESULT · UNOFFICIAL · RANKS 1–5 OF n". The latest run is
identified by the `score_update` runId on the socket, by diffing the completed-run ids of the
active round between polls, and on first load by the newest `updated_at` among that round's
`/results` rows (no per-run timestamp is exposed publicly and the server was not changed for
it). **3** pairings numbered from `pairing_number` (two digits), blue left / red right with
course bars, completed rows with the split chips (engine `blue_total` / `red_total` from
`GET /dual` — the same values the Scoreboard sums from `judge-points`; a DNF/DNS/DSQ loser
shows the status), NEXT = the active match if open else the first playable open match in run
order (navy outline + tab), later rows TO RUN; qualifying rounds with > 4 pairings use 80 px
rows so 8 + the Coming Up strip fit; the semis block lists both 5–8 semis and both 1–4 semis
with `round_name` chips; header "Female Round of 16" / "Male Semifinals"; Coming Up strip =
the next block with feeder placeholders (ruling 1). **4** finals championship first → 7/8 last
(display order only; `runOrder.js` untouched), each with its pairing number + `round_name`
chip, gold rule on the championship, NEXT on the pairing about to run (the 7/8 first). **5**
podium 2/1/3 at 248/340/206 px with medal top rules, place numeral + total inside, name /
bib / team above; places 4–10 (then 11–17 …) in a rank/bib/name/total table; dual events show
rank/bib/name only (no totals anywhere); flagged athletes at the bottom with the status;
footer "PLACES 1–10 OF 24 · TWO RUNS, BEST COUNTS | SINGLE RUN | QUALIFIER + FINALS | DUAL
BRACKET". Aerials = moguls with the time column blank. No break card (plan 7.6).

**The one server change.** `server/routes/pdf.js`: public `GET /api/pdf/logo/:meetId/image`
and `GET /api/pdf/bottom-logo/:meetId/image` stream the logo file (PNG/JPEG by extension,
`Cache-Control: no-cache`, 404 `{error:'No logo'}` when absent; the meet id must match
`^[A-Za-z0-9_-]+$` before the disk is touched) beside the existing status routes; policy
comment updated. Nothing else on the server changed (no endpoint, schema, manifest, engine, or
Viewer API change; iOS unaffected).

**Client.** New `client/src/pages/BroadcastBoard.jsx` + `client/src/components/broadcast/`
(`BroadcastFrame.jsx`, `LeaderRows.jsx`, `StillToCome.jsx`, `MeetLogoPanel.jsx`,
`LatestResult.jsx`, `DualPairingRows.jsx`, `Podium.jsx`, `broadcastDual.js` — block / feeder
helpers mirroring `runOrder.js roundBlocks()` for display, `broadcast.css` scoped under
`.sk-broadcast`). `App.jsx` route beside `/scoreboard` and `/overlay`. **Links panel** Display
card: the Scoreboard row is now **Broadcast Board** → `/broadcast/<code>` with note "1920x1080
browser source · between athletes" (QR / Copy / Open unchanged; the public Scoreboard still
opens from Live Scores). `Scoreboard.jsx`, `Overlay.jsx`, `LiveScores.jsx`, `Home.jsx`,
`EventRow.jsx`, `Overlay*.jsx` and `OverlayStandings.jsx` are byte-identical.

**Docs.** New help topic `broadcast-board.md` (Public Surfaces group, after the Overlay topic);
`judges-urls.md` Display rows updated; guide PDFs regenerated (67 topics); venue PDFs
regenerated (footer). The Live Stream quick-start PDF still describes the Scoreboard + Overlay
pair (unchanged; the board is additive).

**Verification.** New `harness/tests/v260.test.js` — **89 checks green**: route by short code
/ UUID / unknown; 24-athlete Best of 2 with one DNF (five fields per row, pages 1–8 / 9–16 /
17–23 on the timer, Still To Come = `/runs/upcoming` with team names, "Run 2 of 2", DNF never on
a leader row, pointer-events none, zero interactive elements, no scroll, no LIVE text, stage
scale at 1280x720); Latest Result over the socket AND with `WebSocket` stubbed (poll path) —
athlete, time, total, ordinal, outlined row; logo endpoints (404 → upload → 200 with the exact
bytes, PNG type, no-cache, traversal-shaped id refused, panel absent / event only / both,
never upscaled); moguls placings UNOFFICIAL → OFFICIAL after finalize, caption + paging; 16-
athlete dual runoff-to-8th (rows from `pairing_number`, one NEXT = first playable open, split
chips equal the engine totals with the winner solid, "Winner of N" placeholders, legend, finals
block championship-first / 7/8 NEXT with the v2.5.07 labels, podium = bracket placements 1–3,
no score column, UNOFFICIAL → OFFICIAL); every request on-origin; Scoreboard + Overlay smoke;
password protection ON → image endpoints still public. Screenshots of every frame at 1920x1080
and 1280x720 reviewed by eye (scratch demo + harness). Regression: `verify_v16.js` 123/123,
step0, step1 (route gate — the new GETs are not mutations), review-ui, v2507, release-gates.

**Files created:** `client/src/pages/BroadcastBoard.jsx`, `client/src/components/broadcast/*`
(9 files), `client/src/help/topics/broadcast-board.md`, `harness/tests/v260.test.js`
**Files modified:** `server/routes/pdf.js`, `client/src/App.jsx`,
`client/src/pages/EventDetail.jsx` (Links row), `client/src/help/topicsIndex.js`,
`client/src/help/topics/judges-urls.md`, `server/public/docs/guides/*.pdf` +
`server/public/docs/venue/*.pdf` (regenerated), `server/version.js`,
`client/src/components/Layout.jsx`, `client/package.json`, `server/package.json`,
`server/public/*` (rebuilt), `CLAUDE.md`

---

## v2.5.07 Feature Notes

### Dual Bracket — Courses per USSS/FIS 4310.3.1, Mirrored 5–8 Consolation, Correct Labels (v2.5.07)

Per David's 09-14-26 request, from *StickIt Dual Bracket: Identified Errors* (Scoring Server,
09-13-26, written after the 09-13 test meet). Every finding was re-verified here against the
Telluride RMF Divisional Champs sheet (Mar 8 2026, men's 64 shell + women's 32 shell): the
document's rule reproduces every occupant and side from the quarterfinals down on both. **No
scoring math, no schema change, no sync-protocol change (still v3)**; the run order, pairing
numbers, `placement_ranking.js`, and the v2.5.06 round labels / End-of-Round notices are
untouched (re-tested). Rulings from the chat: **(1)** the first round of an odd shell (Round of
8 / 32 / 128) follows the rule too — the top slot of each pairing skis red; **(2)** the broadcast
overlay uses the tablets' wording without the gender word; **(3)** the v2.5.06 Pi image is
re-uploaded on the v2.5.07 Release (boxes reach v2.5.07 through the Update button).

**The rule** (USSS 2026 / FIS 2027 4310.3.1): the *top competitor in pairing* is red in the
Round of 128, 32, 8 and the Finals, blue in the Round of 64, 16, 4 — "defined by position in the
bracket, not by seed". In StickIt's numbering (`bracket_round` 1 = final): **odd round → top
competitor RED, even round → BLUE**; the top competitor of (R−1, ⌈p/2⌉) is the winner of (R, p)
with p odd. Consolation matches are outside the rule's single ladder; the eight RMF 2025-26 sheets
fill them one way without exception: **a loser dropping into a consolation match takes the
opposite slot from the one the winner of that match takes.**

**Server (`server/routes/dual.js`).**
- `advancementSlot(pos, round)` (the `totalRound` parameter is gone — the rule never used it):
  red when `(pos odd) === (round even)`. The old `(totalRound − round) % 2` anchor agreed with
  the rule only on a 4/16/64 shell and inverted EVERY slot on an 8/32/128 shell. New
  `consolationSlot()` = the opposite. `advanceWinner` uses them everywhere: main advancement,
  semi loser → 3/4 final, QF loser → 5–8 semi, cons-semi winner → 5/6 final / loser → 7/8 final
  (all four consolation drops were "first empty slot" before, so the 3/4 and 7/8 sides depended
  on which feeder the HJ decided first — now deterministic).
- **5–8 pairing (the one result-changing fix):** QF loser at position q → consolation semi
  `2 + ⌈q/2⌉` (QF 1+2 losers meet, QF 3+4 losers meet — the mirror of the main draw, seeding
  of places 5–8 preserved). Was `q odd → 3, even → 4`, i.e. {QF1, QF3} / {QF2, QF4}. Brackets
  already advanced keep what was written (advancement is recorded when it happens).
- `populateFirstRoundFromPlacement` (FIS bracketing + Random Seed): when the first round is odd
  the placement's upper slot (`pair.blueSeed`, the better standard slot) is written to RED,
  seeds swapped alongside; **bye rows are never swapped** (no course is skied; every bye
  renderer draws the athlete in blue, and `is_bye` consumers were audited). `placement.js` and
  `verify_v16.js` (123 checks) are untouched. Manual Bracketing keeps the operator's explicit
  sides; bye auto-advance on every seeding path uses the rule.
- `GET /dual` rows and `GET /active-match` gain **`round_name`** — the v2.5.06 label without the
  gender word ("Round of 32", "7th / 8th Place") for surfaces that already name the event.
  `round_label` unchanged. Added to the release gate's `V2_ONLY_KEYS` (with the v2.5.04/06
  fields, which had been missing).
- `buildBracketShell` comment + `CHANGELOG.md` F-2 note: 4310.2.3.3 / 4310.3.2 *authorize*
  ranking to 8th by dualing off; they do not describe the bracket (the review's citation fix).

**Display — red on top in odd rounds, everywhere.** The visual formula was also anchored on
`totalRound` (`redOnTop = (totalRound − round) % 2 === 1`, consolation never), so it matched
the data on every shell and inverted with it. Now `redOnTop = bracket_round % 2 === 1` for
main AND consolation matches — the convention the Winfree sheets use — in the Scoring-tab
`MatchRow`, the Results-tab tree `MatchCard`, the Dual Bracket tab `SimpleBracketCard` (bye
rows list the athlete first), the Scoreboard `BracketMatchCard`, and both PDFs (`drawMatch`,
`drawBKMatch`). Judge / HJ tablets unchanged (blue left, red right). *Note:* a bracket built
before v2.5.07 on an odd shell has its data inverted, so those historical trees now draw with
crossed feeder lines (display only; no such bracket exists outside test meets).

**Labels.** Results-tab tree: the finals column (headed **Finals** when consolation exists)
reads 1st / 2nd, 3rd / 4th, 5th / 6th, 7th / 8th Place downward (was: 3/4 labelled "Small
Final", the 5–8 semis labelled "5th / 6th Runoff" / "7th / 8th Runoff", the real 5/6 and 7/8
finals "Consolation", sorted finals-above-feeders); the 5–8 consolation semis now sit under the
1–4 semifinals in the Semifinals column, each card labelled from `round_name` (local fallback
for an older server). Dual Bracket tab: consolation section headers by what they decide
("Small Finals (3rd / 4th · 5th / 6th · 7th / 8th)", "5th – 8th Place Semifinals"; legacy
"5th / 6th & 7th / 8th Place") + a per-card `round_name` chip on finals / consolation cards.
Scoring tab: the `--` dash normalized to an en dash. HJ tablet bracket-review panel: same
headers + per-card label (was "Small Final" / "Consol R2"). **Overlay:** the lower third
captions from `round_name` uppercased ("ROUND OF 8", "SEMIFINAL", "5TH – 8TH PLACE SEMIFINAL",
"7TH / 8TH PLACE", "3RD / 4TH PLACE", "1ST / 2ND PLACE"; fallback map by position for an older
server — was "SMALL FINAL" for all three consolation finals and "SEMIFINAL" for the 5–8 semis),
and the post-match place chips are 5TH/6TH and 7TH/8TH on those finals (were 3RD/4TH).

**Docs.** Help `events-dual.md`: new **Blue and red courses** section (rule text, top
competitor, consolation convention, manual bracketing, tablets unaffected), Runoff-to-8th
bullet corrected (citation + mirrored pairing), the orphaned "Random seed" bullet moved back
under Optional fields; guide PDFs regenerated (66 topics, 160 pages); venue PDFs regenerated
(footer).

**Verification.** New `harness/tests/v2507.test.js` — **62 checks green**, with the rule
restated independently of the implementation: A 16-athlete runoff-to-8th (even first round:
upper slot blue; full day walked in pairing order with alternating winners — every advancement
and consolation drop checked; cons semis = QF1+QF2 / QF3+QF4 losers with the rule's sides; the
v2.5.06 End-of-Round notices fire at pairings 8 / 12 / 16 only; places 1–8 from the finals);
B 28 athletes (shell 32, odd first round: better seed on red in all 12 pairings, 4 byes kept in
blue, bye winners in the rule's slot, all 32 matches walked clean, "End of Round of 32 / Semi-
Finals for Males"); C 6 athletes (shell 8; unfillable 5–8 semis; notices intact); **D Telluride
replay, both genders** — quarterfinals laid out by Manual Bracketing exactly as printed, the
recorded winners applied: every semifinal, consolation-semifinal and final occupant AND side,
then places 1–8, match the sheet; E HJ order independence (semi 1 decided before semi 2 → 3/4
sides per rule); F `round_name`; G Playwright overlay captions. Regression: v2506 42/42, v240
124/124, step2 58/58, step4 52/52, review 56 + review-ui 6, release-gates 31/31,
`verify_v16.js` 123/123. Rendered the dual-bracket + bracket-keeper PDFs (28-athlete bracket
played to the semis) and screenshotted the Results / Dual Bracket / Scoring tabs, Scoreboard
and overlay from the built bundle — all reviewed.

**Files created:** `harness/tests/v2507.test.js`
**Files modified:** `server/routes/dual.js`, `server/routes/pdf.js`,
`client/src/pages/{EventDetail,Scoreboard,Overlay,HeadJudgeTablet}.jsx`,
`client/src/help/topics/events-dual.md`, `CHANGELOG.md`, `harness/tests/zz-gates.test.js`,
`server/public/docs/guides/*.pdf` + `server/public/docs/venue/*.pdf` (regenerated),
`server/version.js`, `client/src/components/Layout.jsx`, `client/package.json`,
`server/package.json`, `server/public/*` (rebuilt), `CLAUDE.md`

---

## v2.5.06 Feature Notes

### Dual Round Notation + End-of-Round Notice; 2026-27 Rules Compliance Doc Fixes (v2.5.06)

Per David's 09-08-26 request, from the *StickIt Rules Compliance Review for the 2026-27
Season* (Claude Output, 09-08-26). **No scoring math, no schema change, no sync-protocol change
(still v3), no change to the run order, placement, or bracket logic** — the feature is display
only and the review's action items were documentation.

**Dual mogul round notation (judge tablets + Head Judge tablet).** Rulings from the chat:
both tablets (not the Scoring tab); wording `Female` / `Male` + `Round of 64` … `Round of 8`,
`Semifinal`, `5th – 8th Place Semifinal` (Runoff to 8th), `7th / 8th Place`, `5th / 6th Place`,
`3rd / 4th Place`, `1st / 2nd Place`; the end-of-round notice shows **until the next run
starts** (David: the next run is usually the OTHER gender's event — on the venue box the
tablets auto-follow it, so the notice gives way naturally and every label carries the gender).

- **`server/dual/runOrder.js`** gained `genderWord()`, `roundLabel(match, matches)` (bare
  label; legacy pre-F-2 round-2 small finals keep their terminal 5/6 and 7/8 meaning),
  `roundBlocks()` (the day's blocks in run order: each qualifying round, the semifinal block =
  both 5–8 consolation semis + both 1–4 semis, the finals block) and `endedBlock(matches,
  runoffOption, activeMatchId)` — the block whose PLAYABLE matches (both sides known, not a
  bye) are all complete while nothing in a later block has started and no open match is
  active. Unfillable 5–8 semis (byes in a 6-athlete bracket) cannot hold the semifinal block
  open; the finals block never "ends a round" (the Event Completed screen covers the day).
- **`dual.js`**: `GET /dual` rows and `GET /active-match` carry **`round_label`** ("Female
  Round of 32"); new **public** (tablet rule, read-only) **`GET /dual/round-state`** →
  `{ gender_word, active_round_label, ended_round, ended_round_label }` with
  `ended_round_label` = "End of Round of 16 for Females" / "End of Semi-Finals for Females" /
  null. `computePairingNumbers` now also returns `genderWord`, `runoffOption`, `allMatches`.
- **Client** — new `client/src/components/tablet/DualRoundNotice.jsx` (`DualRoundLabel` strip,
  `DualRoundEndedPanel` large amber notice, tablet CSS vars so both tablets + HC mode match).
  **Judge tablet** `DualJudgeView`: label at the top of the Current Match card; the panel on the
  Score Submitted / waiting card AND the no-match waiting card; `/round-state` rides the
  existing 3 s poll + WS refresh. **HJ tablet** `DualHeadJudgeView`: label above the athlete
  bar and (small) on the Next Pairing card; the panel above Next Pairing / the waiting card
  whenever the HJ is between matches (never during bracket review). `data-testid`s
  `dual-round-label` / `dual-round-ended`.

**Rules-compliance documentation fixes (review items 2–5).** Item 1 (confirm the provisional
Big G / Little G DD values through Admin → Jump DDs when USSS publishes them) and item 6
(two wording points in the RMF draft guide) are David's, outside the code.
- `ref-jump-dds.md`: FIS-chart base values corrected (Triple 0.65/0.75, Quad 0.76/0.86, Quint
  0.86/0.96 — the seeded DB was always right, only the help text was wrong); the grab section
  now cites the MSC 08-20-26 Big G / Little G decision, marks the +0.05 / +0.12 modifiers
  **provisional**, and says how to update them. The wrong "FIS JH 6204.3.7" citation was
  corrected in `schema.js` comments and `CHANGELOG.md` (v1.26.00 FS-13) too.
- `scoring-statuses.md`: gate fault stays a DNF; re-entering and continuing is **not a DSQ**
  domestically (USSS 4210.4.3 + the ROSC exception to FIS 4210.3.4); CHANGELOG FS-10 note
  annotated.
- `events-dual.md` + `ref-glossary.md`: landing-zone wording aligned with the ROSC draft
  (gates at 20 m, boots landing past the zone, FIS rule not adopted domestically, off by
  default).
- Help: `events-dual.md` (run-order section), `tablet-dual.md`, `tablet-hj.md` describe the new
  notation; guide PDFs regenerated (66 topics, 159 pages); `server/public/docs/venue/*.pdf`
  regenerated (footer).

**Verification.** New `harness/tests/v2506.test.js` — **42 checks green**: 16-athlete
runoff-to-8th Female bracket (every row labelled; all 20 matches walked in pairing order —
active label matches the row on every match, no notice while a match is open or awaiting the
HJ, notice exactly after pairings 8 / 12 / 16 = "End of Round of 16 / Round of 8 /
Semi-Finals for Females", none between the 5–8 and 1–4 semis, none after any final);
6-athlete Male bracket with byes ("End of Semi-Finals for Males" despite unfillable 5–8
semis); runoff_to_4th / no_runoff labels; 404. Playwright: judge + HJ tablets headed "Female
Round of 8", no panel while open / awaiting approval, panel on both after approval (HJ Next
Pairing names "Female Semifinal"), panel stays on the plain waiting screen, gone on both the
moment the semifinal starts with the label now "Female Semifinal". v240 124/124 (dual HJ
Playwright regressions), `verify_v16.js` 123/123. Screenshots of both tablets reviewed.

**Pi image rebuilt + published at v2.5.06** (`~/Desktop/Scoring Server/StickIt Pi Image/
image_2026-09-08-stickit-venue-lite-v2.5.06.img.xz`, 579,728,276 B, sha256 235ae0d9…967c;
uncompressed 3,221,225,472 B sha256 c9c0853a…41b7; CHECKSUM.txt + .info alongside; the v2.5.02
files moved to `Old 2026-09-06 v2.5.02/`). Release v2.5.06 carries `stickit-venue.img.xz`,
`os_list_stickit.json` (sizes + sha filled, committed) and `CHECKSUM.txt`. **Found while
publishing: the stable Imager URL `releases/latest/download/stickit-venue.img.xz` had returned
404 since v2.5.03** — the release skill creates a source-only Release per version, and "latest"
moved off v2.5.02 (the last Release with an image). Rule from now on: every Release must carry
the image asset — rebuild it, or re-upload the current image if nothing venue-side changed. The
fielded test Pi does not need the image; its Update button takes it to v2.5.06. Full harness
this release: **777 green** (review 56 + review-ui 6 + step0 87 + step1 52 + step2 58 + step3
55 + step4 52 + step5 40 + step6 34 + v240 124 + v250 140 + v2506 42 + release-gates 31).

**Files created:** `client/src/components/tablet/DualRoundNotice.jsx`,
`harness/tests/v2506.test.js`
**Files modified:** `server/routes/dual.js`, `server/dual/runOrder.js`, `server/db/schema.js` (comments),
`server/scripts/build_pi_image/os_list_stickit.json`,
`client/src/pages/{JudgeTablet,HeadJudgeTablet}.jsx`,
`client/src/help/topics/{ref-jump-dds,scoring-statuses,events-dual,ref-glossary,tablet-dual,tablet-hj}.md`,
`CHANGELOG.md`, `server/public/docs/guides/*.pdf` + `server/public/docs/venue/*.pdf` (regenerated),
`server/version.js`, `client/src/components/Layout.jsx`, `client/package.json`,
`server/package.json`, `server/public/*` (rebuilt), `CLAUDE.md`

---

## v2.5.05 Feature Notes

### Update Check Gets a Deadline (v2.5.05, hotfix)

Found during the 09-07-26 test review, fixed at David's request: the venue home screen's
`GET /api/venue/update-check` called the GitHub releases API with a plain `fetch()` and no
deadline. Node's fetch has none by default (undici waits up to 300 s for response headers), so
on a flaky venue uplink every home-screen load could leave one request hanging for minutes and
pile up idle connections on the Pi. Never visible — the menu renders before the check answers
(the Update card just appears late or not at all) and nothing in scoring or sync touches this
path. Now `signal: AbortSignal.timeout(8000)`: a slow link reports `internet:false` after 8 s,
exactly the existing offline outcome. Server-only; no schema, scoring, or sync-protocol change.
Verified on a scratch venue server with `STICKIT_UPDATE_URL` pointed at a local endpoint that
never answers: the check returned in ~8 s with `internet:false`, `update_available:false`, and
the server stayed responsive; harness step6 (the update-check/update tests) green.

**Files modified:** `server/routes/venue.js`, `server/version.js`,
`client/src/components/Layout.jsx`, `client/package.json`, `server/package.json`,
`server/public/*` (rebuilt), `server/public/docs/venue/*.pdf` (regenerated footer), `CLAUDE.md`

---

## v2.5.04 Feature Notes

### Dual Run Order Follows the Pairing Numbers; Venue PINs Last One Day (v2.5.04)

Two items from David's first full test event on the Pi (09-07-26, "REMOTE SERVER TEST",
Telluride — meet adopted, scored, and checked in cleanly; the Pi's service journal for the
whole window had zero errors). No scoring math, no schema change, no sync-protocol change.

**Dual run order — the bug.** The pairing numbers were already right: the server numbered a
runoff-to-8th finals block QF → both 5–8 consolation semis → both 1–4 semis → 7/8 → 5/6 →
3/4 → 1/2, and the bracket PDF used the same numbering. But the two "what runs next" pickers
ignored them: the HJ tablet's *Next Pairing* sorted ready matches by `bracket_round DESC,
bracket_position`, which offers the championship final (round 1 pos 1) BEFORE the 3/4, 5/6
and 7/8 finals, and the Scoring tab's dual panel played every main-bracket round to the end
before touching any consolation match. The Pi's database shows today's men's dual ran exactly
that wrong order (semis 1–4, then 5–8 semis, then the final, then 3/4, 5/6, 7/8).

**The rule (Winfree "Championship Duals Run-order", confirmed against the RMF Divisional
Champs at Telluride result sheets David supplied):** rounds before the semifinals run top to
bottom; the **semifinal round runs last to first** (5.4, 5.3, 5.2, 5.1 — both 5–8 semis before
both 1–4 semis, each pair bottom-up); the **finals run lowest places first** — 7/8, 5/6, 3/4,
then the 1/2 championship with the highest pairing number, ending the day. Men and women are
numbered separately (Winfree interleaves genders; StickIt does not).

- **`server/dual/runOrder.js` (new)** — single source of truth: `runOrder(matches,
  runoffOption)` → non-bye matches in run order; `pairingNumbers()` → Map id→n;
  `formatPairingLabel()`. `dual.js` `computePairingNumbers` delegates to it (the only
  numbering CHANGE vs v2.5.03 is the semifinal round: pos 2 before pos 1, cons semi pos 4
  before pos 3); `pdf.js` `buildBracketPairings` delegates to it (signature unchanged, both
  bracket PDFs); `viewer.js` `/results` dual rows gain `is_small_final`, `pairing_number`,
  `pairing_label` (additive — the iOS app ignores unknown keys and can adopt the order later).
- **`GET /dual` and `/active-match`** carry a numeric **`pairing_number`** beside
  `pairing_label`.
- **HJ tablet** `loadNextMatch` sorts ready matches by `pairing_number` (round/position kept
  only as the fallback for a server without the field). **Scoring tab** dual panel: the
  current block is the round (main or consolation) of the first PLAYABLE open match in run
  order — anchored on playable so a 5–8 semi that can never fill (byes in a 6-athlete bracket)
  cannot pin the console on an empty block; the block's matches list in run order; the active
  match is looked up in the whole bracket. Labels: "Small Finals (7/8 · 5/6 · 3/4)" when the
  round-1 consolation block has more than the 3/4, "5th -- 8th Place Semifinals".

**Venue PINs last one calendar day** (David's ruling: set PINs every competition day so a box
that quietly keeps last weekend's PINs never confuses the crew; the 09-07-26 test box still
carried the 09-03 PINs). `venue.js`: `venue_pins_set_date` (box-local date; the Pi image runs
in the venue zone) stored beside the hashes; `pinsExpired()` = hashes present and date ≠ today
(a pre-v2.5.04 box with PINs but no date expires once, on upgrade). `GET /pins/status` adds
`expired`, `set_date`, `today` (`control_set`/`crew_set` keep meaning "hashes exist" — harness
step3 assertion loosened accordingly). `POST /verify-pin` → 400 `pins_expired` for either PIN.
`POST /pins` needs no Control token while expired (first-set rules; journal line "PINs set for
a new day"), rotates the Control session token as always (which logs yesterday's Scoring
Computer out — it just asks for the new PIN). The Control token is NOT rejected by expiry
alone (remembered HJ / judge / timekeeper tablets keep working; only picking a role asks a
PIN). `VenueHome.jsx`: the set-PINs card reappears as "New day — set today's two PINs"
(`data-testid="pin-setup-card"`), PIN-gated tiles / Hand Back / Check In / return-file /
abandon show "Set today's PINs first" and scroll to the card instead of opening (the pre-PIN
pass-through `fn(null)` stays only for a never-set box).

**Also found, not changed:** deleting a NON-adopted meet on the Pi while a meet is adopted is
unsafe — the capture hook stamps every captured row with the adopted meet id and the cloud's
`changeInMeetScope` refuses out-of-scope rows (worker `stuck`). Previous meets are never
removed from the Pi (cleanup at adoption is a candidate for a later release). The iPads'
minutes-long page loads at the test were iOS mDNS resolution of `stickit.local` over Wi-Fi
(the numeric `http://192.168.2.93:3001/` opened instantly; the Pi answered every request in
<60 ms); later in the day the name resolved normally. **David's ruling: `stickit.local` stays
the primary address everywhere — the numeric address is only the documented BACKUP** for a
slow first load (help `venue-tablets.md` + tablets run sheet step 1; he will cover it in the
training video). The `/api/venue/update-check` GitHub fetch had no timeout — fixed in v2.5.05.

**Docs.** Help `events-dual.md` new "Run order and pairing numbers" section; `venue-server.md`
"PINs last one calendar day" paragraph; `venue-tablets.md` "If a tablet's first load is slow"
(numeric address as the backup); guide PDFs regenerated (66 topics, 159 pages); adoption run
sheet step 3 notes the daily PINs, tablets run sheet step 1 the numeric fallback;
`server/public/docs/venue/*.pdf` regenerated.

**Verification.** Scratch two-server test (48 checks): 8/16/6/4-athlete brackets × runoff to
8th / to 4th / none — pairing numbers gapless and in the Winfree order, byes unnumbered, a
tablet-style "first ready match by pairing_number" play-through walks every bracket in that
order with the championship final last (6 athletes: the unfillable 5–8 semis are skipped and
3/4 still runs between the semis and the final), `/active-match` carries the number, viewer rows
carry `pairing_number` in the same order with existing fields intact, dual-bracket /
bracket-keeper / dual-results PDFs render; PIN expiry: current → rolled date → both PINs 400
`pins_expired` → new PINs without a token → old token 401, new token works → no-date upgrade
box expires once; no server-side errors. `verify_v16.js` passed. Harness: see chat.

**Files created:** `server/dual/runOrder.js`
**Files modified:** `server/routes/{dual,pdf,viewer,venue}.js`,
`client/src/pages/{HeadJudgeTablet,EventDetail}.jsx`, `client/src/pages/venue/VenueHome.jsx`,
`client/src/help/topics/{events-dual,venue-server,venue-tablets}.md`,
`server/scripts/venue_cards/build_venue_docs.js`, `harness/tests/step3.test.js`,
`server/public/docs/guides/*.pdf` + `server/public/docs/venue/*.pdf` (regenerated),
`server/version.js`, `client/src/components/Layout.jsx`, `client/package.json`,
`server/package.json`, `server/public/*` (rebuilt), `CLAUDE.md`

---

## v2.5.03 Feature Notes

### Head Judge Who Also Scores — Two In-App Tabs on the Venue HJ Tablet (v2.5.03)

Per David's 09-06-26 request. On the cloud there is no tablet login, so a Head Judge who is
also a scoring judge simply opened two Safari tabs. On the venue Pi every tablet is ONE
remembered role (a single localStorage slot) and any tab landing on `/` is bounced to that
role's page, so once the Head Judge tile was chosen a second tab could never reach the Judge
tile — the "can no longer log in as a scoring judge" report. The v2.4.00 ruling had deferred
this ("Change role covers the double-duty case"), which means a PIN on every switch.
Rulings recorded from the chat: any seat (J3 was only an example); the same seat for the whole
day (moguls AND duals — seats are positional, the amber switch notice covers a singles ↔ duals
change); entry is from the Head Judge tile only (the double-duty person is always the HJ).

**Client only** — no server, schema, scoring, or sync-protocol change; no tablet role page
(JudgeTablet / HeadJudgeTablet / Timekeeper) was touched; cloud mode is byte-identical.

- **`VenueRole.jsx`.** On the Head Judge page the bar offers **Also score as a judge** →
  the Judge tile's own seat picker (no second PIN: the Control PIN that opened the HJ
  outranks the Crew PIN) claims a seat exactly as the Judge tile does. The page then becomes
  two in-app tabs, **⚖️ Head Judge** and **🎿 Judge Jn · name (role)**, with BOTH embedded
  role pages kept mounted in a stacked container — the inactive one is hidden with
  `visibility:hidden` + `pointer-events:none` (full size kept, so the embedded page never
  sees a 0×0 viewport; a `display:none` iframe would), never unmounted — so switching is one
  tap, no PIN, no reload, and a half-entered score survives a hop to approve the previous run.
  The seat's target is polled in the same pass as the HJ target (`/api/venue/role-target
  ?role=judge&seat=`), so it auto-follows interleaved events and the amber discipline notice
  names what the seat means now (from the judge target). **Leave seat** (judge tab only) frees
  only the seat and keeps the Head Judge (memory → `{role:'hj'}`, URL → `/venue/role/hj`);
  **Change role** frees the seat too. The HJ page always uses the stacked container (with or
  without a seat) so adding/removing the judge pane never remounts the HJ iframe. Plain
  judge / timekeeper / scoreboard paths render the original markup unchanged.
- **Memory shape.** ONE role: `{ role:'hj', seat:'Jn' }` ↔ URL `/venue/role/hj?seat=Jn`
  (`roleUrl`, `describeMemory` → "Head Judge + Judge, seat Jn" in `venueShared.js`), so
  a reboot / reload / home-address visit brings both tabs back (FR-15). The HJ tile in
  `VenueHome.openRole` preserves an existing hj+seat memory (the seat is still claimed by this
  device on the server; dropping it would strand the claim and silently lose the tab).
- **`venueWidgets.jsx` (new).** `PinModal` + `SeatPicker` moved VERBATIM out of
  `VenueHome.jsx` (which imports them back) so the role page can open the same picker.

**Docs.** Help `venue-tablets.md` new section "Head Judge who also scores" (+ the Change-role
bullet no longer points the double-duty HJ at it); guide PDFs regenerated (66 topics, 158
pages). Tablets run sheet step 5 gained the one-line procedure; `server/public/docs/venue/*.pdf`
regenerated.

**Verification.** `harness/tests/v240.test.js` HJ block grew 21 checks (button present; picker
without a PIN; memory = one role; seat claimed on the server; judge tab names seat + role; two
iframes with the judge pane visible / HJ pane hidden-not-unmounted after the pick and the
reverse after a tab tap with nothing unmounted; Leave seat only on the judge tab; "Also score"
hidden while a seat is held; reload from `/` returns to hj+seat; Leave seat keeps the HJ,
frees the seat on the server, drops the tabs, one iframe left, "Also score" offered again).
First run against the stale bundle caught that the harness serves `server/public` — rebuilt +
copied. **v240 suite green (124)** incl. every pre-existing judge / HJ / scoreboard bar
regression; step3 (seat registry) green; `verify_v16.js` 123/123 (engine untouched).

**Files created:** `client/src/pages/venue/venueWidgets.jsx`
**Files modified:** `client/src/pages/venue/{VenueRole,VenueHome}.jsx`,
`client/src/pages/venue/venueShared.js`, `client/src/help/topics/venue-tablets.md`,
`server/scripts/venue_cards/build_venue_docs.js`, `harness/tests/v240.test.js`,
`server/public/docs/guides/*.pdf` + `server/public/docs/venue/*.pdf` (regenerated),
`server/version.js`, `client/src/components/Layout.jsx`, `client/package.json`,
`server/package.json`, `server/public/*` (rebuilt), `CLAUDE.md`

---

## v2.5.02 Feature Notes

### Release Tag Parse Broke on Compact JSON (v2.5.02, hotfix)

Caught minutes after v2.5.01 by the new update-status reporting, on the first real button-path
run from the Mac (`POST /api/venue/update`, no PIN): *failed | fetch | Could not determine the
latest release*, in one second, with both `curl`s returning 200/302. The debug run showed why:
the GitHub API answers `releases/latest` with **compact one-line JSON** (2,539 bytes, no
newlines) as often as pretty-printed, and the script's `grep -m1 '"tag_name"' | cut -d'"' -f4`
then yields the 4th quoted field of the whole document — the release **URL**. The v2.5.01
script's tag validation refused it cleanly; **the pre-v2.5.01 script had the same parse and no
validation**, took the URL as the tag, got a 404 on the tarball, and died silently — which is
exactly David's "first press did nothing" on 09-06-26 (and the 09-03-26 SSH updates only ever
worked because those responses happened to be pretty-printed). Fix: `grep -o
'"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed …` — shape-independent, no new
dependency; verified on compact, pretty, and the live response (compact from the Mac too). The
v2.5.01 image build was stopped before it could bake the bad parse in; the published Pi image is
v2.5.02. Test Pi: fixed script installed by hand, then the button path from the Mac took it
v2.5.01 → v2.5.02 (detached unit, progress polled: fetch → download → install → restart → done),
and a second button run reinstalled v2.5.02 with the tree's own script.

**Files modified:** `server/scripts/build_pi_image/update-stickit.sh`, `server/version.js`,
`client/src/components/Layout.jsx`, `client/package.json`, `server/package.json`,
`server/public/*` (rebuilt), `server/public/docs/venue/*.pdf` (regenerated footer), `CLAUDE.md`

---

## v2.5.01 Feature Notes

### Update Button Killed Its Own Script; Update Needs No PIN; Live Update Progress (v2.5.01, hotfix)

Reported by David 09-06-26 after pressing **Update StickIt** on the test Pi for v2.5.00: (1) the
box never came back; (2) the first press appeared to do nothing — the card still offered the
update, so he pressed again; (3) the update should not ask for the Control PIN. Diagnosed over SSH:
`stickit-venue.service` was `inactive (dead)` since 07:34, a fully built `server.new` beside the
untouched old `server`, and the journal showing the script's `systemctl stop` as the last act.

**Root cause (1).** `POST /api/venue/update` spawns `sudo update-stickit.sh` as a child of the
node process — i.e. INSIDE the service's control group (`detached`/`unref` only change the
process group). `systemctl stop stickit-venue.service` kills the whole cgroup, the script
included, before the swap; whether the box comes back is then luck (bash's EXIT trap may or may
not get its `systemctl start` in before systemd finishes the stop — it did not this morning, it
did in the reproduction). Every SSH update had worked because an SSH session is outside the
cgroup; the button path was never exercised on a real Pi before v2.5.00. **Fix:** the script
detects `stickit-venue.service` in `/proc/self/cgroup` and re-launches itself with
`systemd-run --unit=stickit-update-<timestamp> --collect` (root already, via the existing
sudoers entry — unchanged), then returns. Verified on the test Pi by moving a shell into the
service cgroup and running the script: the old script died at the stop; the new one completes.

**Root cause (2) — silent first failure.** The script ran with `stdio: 'ignore'` and wrote
nothing anywhere; the first press exited within a second (sudo session closed at 07:29:52).
The v2.5.01 status reporting caught it on the very first button run after release — see the
v2.5.02 notes (the GitHub API's compact JSON defeated the `grep | cut` tag parse). Now the script writes
`/opt/stickit/data/update-status.json` (`state: running|done|failed`, `step`, `message`, `tag`,
`at`) at every step and a per-run `/opt/stickit/data/update.log`; new public LAN endpoint
`GET /api/venue/update-status` returns it (+ the last 40 log lines on failure; a `launched`
older than 3 min or `running` older than 20 min is reported as failed). `POST /update` resets the
file to `launched` before spawning (a stale result can never pass for this run), refuses 409
`update_running` while one is in flight, and marks `failed` if the child exits non-zero before the
script ever reported. The release lookup writes the API JSON to a file (no `grep -m1` SIGPIPE
under `pipefail`) and falls back to the release page's redirect when the API fails. After the
swap the script polls `/api/venue/status` for up to 3 min and **rolls back to `server.old`**
(kept as `server.failed`) if the new server never answers. The home screen's card shows each
step, "Restarting the box…" while it is down, then reloads on the new version — or a red
*Update failed* box with the reason, a *Show details* log tail, and the SSH fallback; a failed
earlier attempt stays visible when the card next loads.

**(3) No PIN.** David's ruling: the meet-state guard (refused while adopted / checking_in /
handed_back) is the protection; the script only reinstalls the published release, so a LAN
device can at worst restart an idle box. `requireControlToken` removed from `/update`; the
VenueHome PIN modal path removed. M-10's PIN throttle / token rotation elsewhere unchanged.

**Fielded devices.** The script refreshes itself only at the END of a successful update, so a
box still on the v2.4.02/v2.5.00 script dies the same way when the button is used once more —
**update those once over SSH** (`ssh stickit@stickit.local 'sudo /opt/stickit/update-stickit.sh'`);
the test Pi was recovered that way (twice: the second time the reproduction) and then updated
to v2.5.01. Devices flashed from the v2.5.01 image are fine. No schema, scoring, or sync-protocol
change (still v3).

**Verification.** Harness step6 34/34 (fake script now writes the status file; no-PIN update
with PINs set; `/update-status` idle → done + tag + current), review 62/62 (M-10 assertion
inverted), step1 52/52 (route gate), release-gates 31/31; `verify_v16.js` passed. Test Pi:
old-script cgroup reproduction, new-script SSH run (`done` status, script self-refresh), and
after this release the real button path (see chat) — no PIN, progress polled from the Mac.

**Files modified:** `server/scripts/build_pi_image/update-stickit.sh`, `server/routes/venue.js`,
`client/src/pages/venue/VenueHome.jsx`, `client/src/utils/api.js`,
`client/src/help/topics/venue-server.md`, `docs/VENUE_OPS.md`,
`server/scripts/build_pi_image/README.md`, `harness/tests/{step6,review}.test.js`,
`server/public/docs/guides/*.pdf` + `server/public/docs/venue/*.pdf` (regenerated),
`server/version.js`, `client/src/components/Layout.jsx`, `client/package.json`,
`server/package.json`, `server/public/*` (rebuilt), `CLAUDE.md`

---

## v2.5.00 Feature Notes

### Offline Adoption Backup File + Offline Return via the Scoring Laptop (v2.5.00)

Per David's 09-06-26 request: when a venue has no internet (or loses it), both handing a meet
to the venue AND returning it at end of day must work by file, carried on a USB drive that is
plugged into the **scoring laptop — never the Pi** (sidesteps Pi drive formatting/recognition
issues). Every transfer is a browser download/upload on the laptop: cloud → laptop → Pi
(adoption), Pi → laptop → cloud (return). This USB drive is a different stick from the
STICKITSNAP backup stick. Three rulings recorded from the chat: **(1) the backup adoption file
locks the cloud copy immediately** (today's export semantics) and the release code keeps
working — *first to talk to the cloud wins*; **(2) writing the return file on the Pi is final**
(freeze + archive exactly like a successful online return; the Pi later reports whether the
cloud has the file); **(3) the cloud import shows the mode the venue chose (Check In / Hand
Back) and lets the importer change it.** No scoring math, no manifest column, no
canonicalization change → **`SYNC_PROTOCOL_VERSION` stays 3** (additive messages only; a bump
would strand the fielded v2.4.02 Pi image — a v2.4.02 Pi still adopts by code/file from a
v2.5.00 cloud, it just lacks the return-file buttons until it updates). One additive NON_SYNC
column: `meets.adopted_via TEXT` ('code' | 'file').

**Cloud, release side (`server/sync/adoptionFile.js`, new).** `exportAdoptionFile(meetId,
{remint})` is the shared body of the legacy `POST /api/meets/:id/export-for-adoption` and the
new `POST /api/adoption/:meetId/export-file`: lock-drain-snapshot as before, but the release
code is **kept** and `adopted_via='file'` recorded; `{again:true}` re-mints the token of a
never-synced file lock (409 `already_synced` once the venue synced). `undoFileLock` backs both
unrelease routes: a never-synced file lock is fully undone (status, token, code); refused (423)
once synced. `POST /api/sync/adopt` now succeeds on a never-synced file lock (re-mints the
token, `adopted_via='code'`, M-1 revert restores the FILE's token) and answers 409 with a
file-specific message once the file's venue synced. **`last_sync_at` is reset to NULL whenever a
new adoption starts** (file export, remint, code) — found by the harness: a re-exported
`checked_in` meet inherited the previous adoption's timestamp and wrongly blocked undo.

**New router `/api/adoption` (`server/routes/adoption.js`, cloud only, requireAuth).** The
adoption-lock middleware 423s every mutation under `/api/meets/:meetId`, so anything that must
run on an ADOPTED meet lives here (like `/api/admin/adoption`): `export-file`, `unrelease`,
`import-return`. Added to the FR-20 gate's `EXEMPT_PREFIXES` (step1) and the 64 MB JSON limit
list in `index.js`. `GET /api/meets/:id/adoption` + the admin adoption list carry
`adopted_via`; force-unlock clears it.

**Return package (`buildReturnPackage`, `server/sync/package.js`).** `{ format:
'stickit-return-package', protocol_version, meet_id, meet_name, mode, exported_at, sync_token,
checksums, tables, logo, bottom_logo }` — every CHECKSUM table's full meet-scoped row set
(repush-shaped) + `audit_log` (venue_all scope, upsert-only on the cloud), with **checksums
computed from the very rows in the file** so the cloud can prove the file intact before writing.
`buildAdoptionPackage` was factored into `snapshotTables()` + `readLogos()` (byte-identical
output). `hashesEqual`/`upsertSql`/`clearUniqueKeyConflicts`/`cloudChecksums`/`compareChecksums`
moved verbatim from `routes/sync.js` into `server/sync/cloudApply.js` (+ `replaceTableStatements`,
the repush algorithm as batchable statements); `writeLogo` + `IMPORT_ORDER` exported from
`adoptionImport.js`.

**Cloud import (`server/sync/returnImport.js`, new — `applyReturnPackage`).** Shared by
`POST /api/adoption/:meetId/import-return { package, mode? }` (official upload) and
`POST /api/sync/meets/:meetId/return` (the venue's own "Send to cloud now", bearer token).
Pre-write checks in order: format (400 `bad_package`) → protocol (409) → meet identity (400
`wrong_meet`) → mode → state/token: `checked_in`+no token → 410 `already_returned` (idempotent
second import), not adopted → 409 `not_adopted`, token ≠ hash → 401 `stale_return_file` (a file
from an OLDER adoption can never overwrite) → self-consistency (every table present, no null PKs,
meet-keyed rows name this meet, file checksums reproduce → else 400 `file_corrupt {tables}`).
Then ONE atomic batch (M-5) replacing every checksum table with repush semantics (master tables
upsert-only, H-3) + audit_log upserts, logos through the L-4 guard, independent
`cloudChecksums()` verify (409 `checksum_mismatch`, meet stays adopted, re-import idempotent),
unlock guarded by the token hash read at the start (409 `state_changed` on a race), audit
`meet_checked_in`/`meet_handed_back` with `via: official_upload | venue_direct`,
`recorded_mode`, `applied_mode`; FR-19 `sync_applied` nudge per event.

**Venue (`server/routes/venue.js`).** `POST /return-file {mode}` (Control PIN): freeze
(`checking_in`) → write barrier (rebuild the package until `MAX(seq)` of the outbox is unchanged
across the read; 3 tries → `writes_during_checkin`) → atomic write to
`server/data/return/<meet_id>.json` (+ best-effort copy on the STICKITSNAP stick via new
`snapshot.getSnapshotDirIfAvailable()`) → outbox cleared → archive (`checked_in`/`handed_back`,
Control token rotated on check-in) → one L-3 journal line. Any failure before the archive reverts
to `adopted`. `GET /return-file` (Control PIN; available while archived, **never auto-deleted**),
`GET /return-status` (public LAN; probes the cloud's public adoption endpoint — the H-1 probe —
→ `received | pending | unlocked | unknown`; 5 s cache, 'unknown' never cached; a cloud
re-adopted AFTER our export counts as received), `POST /return-file/send` (Control PIN; 410/409
→ re-probe → `already_received`; 401 → `stale_return_file`). `GET /api/venue/status` gains
`return_file: {available, mode, exported_at}`; `clearOutboxForNewAdoption` clears the
`venue_return_*` settings (not the files).

**Client.** `api.js`: `saveFile(fileName, getBlob)` opens the File System Access picker FIRST
(so the USB drive can be chosen directly on https and a cancel never triggers the side effect —
e.g. locking the meet), else a plain download (the venue is http → Downloads folder);
`fetchAuthedBlob` (optional explicit bearer). **MeetDetail:** `ReleaseDialog` with the
recommended, default-on "Also save a backup adoption file" checkbox (release → code → file →
note in the code modal, incl. the "skipped/failed — NOT locked" outcomes); three-way banner
(amber `adoption-banner-file` "adoption file created, waiting for the venue" with *Download
adoption file again* / *Undo & unlock* / *Import venue return file…*; the existing adopted banner
+ import link; released); More ▾ (now w-64) gains *Download adoption file*, *Download adoption
file again*, *Import venue return file…*; Undo Release calls `/api/adoption/:id/unrelease`.
**`ReturnImportDialog.jsx`** (new, shared): meet/time/recorded-mode/contents, "Apply as" radio
preset from the file with an amber note when changed, wrong-meet block, per-code error copy.
**AdminAdoption:** header *Import venue return file…* (routes by the file's meet), "Locked —
file, waiting for venue" badge, per-row import shortcut. **VenueHome:** Check In / Hand Back
first try online; on `flush_failed/offline` or `cloud_unreachable` an amber box offers **Return
via file instead** (`return-file-offer`, same Control token — nothing rotated yet); a small "No
internet? Return via file instead…" link opens the two-button chooser any time; archived state
shows a **Return file** card (`return-file-card`): mode + time, cloud line from `/return-status`
(30 s poll), **Download return file** (PIN → `saveFile`) and **Send to cloud now**.

**Docs.** `docs/SYNC_PROTOCOL.md` §3 (file lock, first-to-talk-wins, `adopted_via`,
`last_sync_at` reset), §4 endpoint table + new §4.4 Return package (shape, venue order, the
pre-write check table), §6/§9 (no-bump rationale for additive messages). `docs/VENUE_OPS.md`
new "Offline adoption file + offline return" section (the lossy export/import/force-unlock
procedure is now last resort). Help `venue-server.md` (adoption checkbox / stale file / end-of-day
file path) + `meets-edit.md` More-menu line; guide PDFs regenerated (66 topics, 157 pages). Printed
material: adoption sheet plan-B callout (drive into the SCORING LAPTOP), end-of-day sheet steps
5–7 "No internet? Return via file", pre-event checklist item; `server/public/docs/venue/*.pdf`
regenerated.

**Verification.** New `harness/tests/v250.test.js` (cloud + two venues; sections A–I HTTP:
file lock keeps the code + locks + `adopted_via`; code over a never-synced file lock re-mints
and the stale file's venue goes terminal on its first push; undo of a file lock; code/undo/
re-issue refused once synced; legacy export path + re-mint; offline return end-to-end with the
cloud STOPPED (online check-in 502 offline → return file → freeze 423 → stick copy → download →
status unknown/pending → wrong-meet/tampered/protocol/adoption-file/bad-mode refusals leave
cloud checksums unchanged → import → cloud == venue incl. the offline run → checked_in +
editable → audit → second import 410 → status received → send harmless); handback delivered by
the venue's own send + mode override on upload; stale return file 401 pre-write; force-unlock
while pending → 409 both ways, file kept. Playwright J/K: release dialog checkbox → lock → code
modal file note → amber banner → More menu items; venue archived card + received line; offline
Check In → "Return via file instead" → archived. **140 checks green.** `verify_v16.js` 123/123.
`step1` `EXEMPT_PREFIXES` + `zz-gates` `V2_ONLY_KEYS` updated. **Full harness: 711 green** (review 56 +
review-ui 6 + step0 87 + step1 52 + step2 58 + step3 55 + step4 52 + step5 40 + step6 30 + v240 104 +
v250 140 + release-gates 31; step4 crashed once in the all-suites run when its cloud instance
restarted under load — the known timing flake from v2.1.00 — and passed clean alone).
**Cloud ultra review (09-06-26) — passed, ZERO findings** on the source-only diff (19 files /
1,737 insertions; run from the temporary branch `review/v2.5.00-source` with docs, PDFs, build
assets, harness, and version bumps parked in a git stash — the same source-only recipe as prior
releases).
Harness gotcha: 127.0.0.1 is a secure context, so headless Chromium opens the native save
dialog and hangs — the suite stubs `showSaveFilePicker` in its browser context.

**Files created:** `server/sync/cloudApply.js`, `server/sync/adoptionFile.js`,
`server/sync/returnImport.js`, `server/routes/adoption.js`,
`client/src/components/ReturnImportDialog.jsx`, `harness/tests/v250.test.js`
**Files modified:** `server/sync/{package,adoptionImport,protocol}.js`,
`server/routes/{sync,meets,venue,admin}.js`, `server/venue/snapshot.js`, `server/db/schema.js`,
`server/index.js`, `client/src/utils/api.js`,
`client/src/pages/{MeetDetail.jsx,admin/AdminAdoption.jsx,venue/VenueHome.jsx}`,
`client/src/help/topics/{venue-server,meets-edit}.md`, `docs/{SYNC_PROTOCOL,VENUE_OPS}.md`,
`server/scripts/venue_cards/build_venue_docs.js`, `harness/tests/{step1,zz-gates}.test.js`,
`server/public/docs/guides/*.pdf` + `server/public/docs/venue/*.pdf` (regenerated),
`server/version.js`, `client/src/components/Layout.jsx`, `client/package.json`,
`server/package.json`, `server/public/*` (rebuilt), `CLAUDE.md`

---

## v2.4.02 Feature Notes

### Update Script Refreshes Itself (v2.4.02, hotfix)

Found while updating the test Pi to v2.4.01 over SSH: its journal timezone stayed
Europe/London because the v2.4.01 timezone step lives in `update-stickit.sh`, and that script
is copied to `/opt/stickit/update-stickit.sh` ONCE by `provision.sh` at image build — a
fielded Pi ran its original script forever, so no fix to the update path could ever reach it.
`update-stickit.sh` now ends by replacing itself from the tree it just installed
(`server/scripts/build_pi_image/update-stickit.sh`, atomic rename so the running copy finishes
on its old inode; same path keeps the sudoers entry valid). Devices flashed from the 09-03
image need one hand fix over SSH (done on the test Pi 09-03-26: copy the v2.4.02 script into
place + `timedatectl set-timezone America/Denver`); every later image and every device updated
from v2.4.02 on gets script fixes automatically. The v2.4.01 image build was stopped and
rebuilt at v2.4.02; the published image is v2.4.02.

**Files modified:** `server/scripts/build_pi_image/update-stickit.sh`,
`server/scripts/build_pi_image/README.md`, `docs/VENUE_OPS.md`, `server/version.js`,
`client/src/components/Layout.jsx`, `client/package.json`, `server/package.json`,
`server/public/*` (rebuilt), `server/public/docs/venue/*.pdf` (regenerated footer), `CLAUDE.md`

---

## v2.4.01 Feature Notes

### Venue Update Card After Check-In (v2.4.01, hotfix)

Found the moment v2.4.00 became the first update a fielded Pi could see: the test Pi's home
screen (meet state `checked_in`) showed NO "Update StickIt" card even though
`/api/venue/update-check` reported `update_available: true`. `VenueHome.jsx` gated the card on
`status.adopted_meet` being null, but `/api/venue/status` keeps reporting the remembered meet
after Check In (and after Hand Back), so the card only ever appeared on a never-adopted box.
The server's `POST /api/venue/update` already refuses only `adopted` / `checking_in` /
`handed_back`. Fix: the card is gated on the meet STATE (`updateBlocked` = one of those three),
so a checked-in box offers the update. Client-only; the test Pi was updated once over SSH
(`sudo /opt/stickit/update-stickit.sh`) to get past the hidden button, and the v2.4.01 image
carries the fix. The in-progress v2.4.00 image build was stopped and rebuilt at v2.4.01.

**Files modified:** `client/src/pages/venue/VenueHome.jsx`, `server/version.js`,
`client/src/components/Layout.jsx`, `client/package.json`, `server/package.json`,
`server/public/*` (rebuilt), `server/public/docs/venue/*.pdf` (regenerated footer), `CLAUDE.md`

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
showing a judge seat side-by-side is DEFERRED (Change role covers the double-duty case) — **built in v2.5.03** as two in-app tabs on the HJ role page.

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

> **Versions v1.7.00 – v1.30.03 follow.** These were moved here from CLAUDE.md at v2.3.00; the
> v2.0.00 – v2.7.01 notes above were moved here on 2026-10-28.

---

## v1.30.03 Feature Notes

### Public Support Page (v1.30.03)

Static support page at `/support.html` for the iOS "Live Score" App Store listing, mirroring
the v1.30.01 privacy-policy pattern exactly. Content supplied by David verbatim (from the
StickIt Live Score Xcode project's `support.html`).

**Source of truth is `client/public/support.html`** (Vite's publicDir copies it to `dist/` root
on build); the build-copied `server/public/support.html` is committed like the rest of
`server/public`. Served by the existing `express.static` mount (`server/index.js:215`) — no
route changes, public with password protection ON, `Cache-Control: no-cache`. The Build &
Package steps above gained a `cp client/dist/support.html server/public/support.html` line.

**Files created:** `client/public/support.html`, `server/public/support.html` (build-copied)
**Files modified:** `server/version.js`, `client/src/components/Layout.jsx`,
`client/package.json`, `server/package.json`, `CLAUDE.md`

---

## v1.30.02 Feature Notes

### Deployment Docs Updated to Render + Railway Dual-Host (v1.30.02)

Docs/copy-only release recording the July 2026 hosting reality: **Render is the primary
production host** (https://stickit-tga4.onrender.com) with the legacy Railway deployment
(https://mogul-scoring-production.up.railway.app) kept in sync for now. Both auto-deploy from
every push to `main` via their GitHub integrations — verified live: both hosts picked up
v1.30.01 from a single push with no manual steps. New "Deployment" section added near the top
of this file; historical feature notes below intentionally still say "Railway" (accurate at the
time they were written).

Forward-looking references updated to be dual-host/host-neutral: README Cloud Deployment
section; help topics `meets-import`, `meets-export`, `admin-backups` ("Pre-deploy" backup
advice + persistent-disk restore note), `admin-dashboard` (guide PDFs regenerated); the
AdminBackups recovery-instructions callout (`AdminBackups.jsx`); and `server/scripts/
seed-demo.js` default BASE URL (now Render).

**Files modified:** `CLAUDE.md`, `README.md`, `client/src/help/topics/{meets-import,
meets-export,admin-backups,admin-dashboard}.md`, `server/public/docs/guides/*.pdf`
(regenerated), `client/src/pages/admin/AdminBackups.jsx`, `server/scripts/seed-demo.js`,
`server/version.js`, `client/src/components/Layout.jsx`, `client/package.json`,
`server/package.json`

---

## v1.30.01 Feature Notes

### Public Privacy Policy Page (v1.30.01)

Static privacy policy at `/privacy.html` for the iOS "Live Score" App Store review — Apple's
reviewer fetches it anonymously, so it must load with no login. Content supplied by David
verbatim (StickIt Live Score policy, contact david@dreitlein.net).

**Source of truth is `client/public/privacy.html`** (Vite's default `publicDir` copies it to
`dist/` root on build), NOT `server/public/` directly — that's build output. The Build & Package
steps above gained a `cp client/dist/privacy.html server/public/privacy.html` line; the copied
file is committed like the rest of `server/public`.

**No auth changes needed.** `express.static` (`server/index.js:215`) is mounted before the SPA
catch-all and entirely outside the `/api` auth surface, so `/privacy.html` is served as a real
file with `Cache-Control: no-cache` and stays public even with password protection ON — verified
on a scratch server with protection enabled via the real admin flow.

The public Home page footer (`client/src/pages/Home.jsx`) gained a small "Privacy Policy" link
under the © line — a plain `<a href="/privacy.html">` (not a react-router `Link`, since the
target is a static file outside the SPA).

**Files created:** `client/public/privacy.html`, `server/public/privacy.html` (build-copied)
**Files modified:** `client/src/pages/Home.jsx`, `server/version.js`,
`client/src/components/Layout.jsx`, `client/package.json`, `server/package.json`, `CLAUDE.md`

---

## v1.30.00 Feature Notes

### Viewer API — Dual Placements Endpoint, Singles registration_id, Dual winner_side (v1.30.00)

Three additive viewer-API changes requested by the iOS "Live Score" app (spec:
`StickIt_Server_Changes_for_iOS_v1.30.md`). Server-only — all code changes in
`server/routes/viewer.js`; no schema changes; no existing response fields altered.

**New endpoint `GET /api/viewer/events/:eventId/placements`** — full-field ICR-4312 final
standings for a dual_mogul event, matching the web PLACE tab. Reuses the exact bracket query
shape and `rankDualPlacements({ bracket, meetDate, isSeededGroups: true })` call from
`routes/results.js` so the app never re-implements the placement rules. Response
`{ discipline: 'dual_mogul', placements: [{ rank, registration_id, bib_number, gp, first_name,
last_name, club, run_status, reg_status }] }`. `rank` is `null` for unclassified entries
(first-round DNS in seeded groups, elimination-round DSQ — a small-final DSQ loser still takes a
place); `bib_number` is normalized `''` → `null`, else `Number()`. Non-dual events → 400
`Placements are only available for dual_mogul events`. **Deliberately omits ffsp** (the web
`/results` merges it on complete events) — the iOS response shape is spec-defined without it.

**Singles `/results` rows now carry `registration_id`** (already selected, just emitted) so the
app joins per-judge detail from `/results/scores` (`runs[]`/`scores[]`) by id instead of fragile
order-based matching — fixes its "Score detail unavailable" fallback.

**Dual bracket rows now carry `winner_side`** (`'blue'`/`'red'`/`null`) computed from
`winner_registration_id` vs the two registration ids — authoritative even for NJ-override and
tie-break decisions where score comparison misleads, and for status-decided matches where
`blue_score`/`red_score` are null. `registration_id_blue`/`registration_id_red` ride along on
each bracket row (added to the SELECT) so the app can map placements to matches by id.

**Verification.** 45-check scratch-server integration test: seeded a 4-athlete dual bracket via
seed-manual + paper-score (note: `seed-manual` slots use **1-based** `matchIndex` matching
`bracket_position`; index 0 is silently skipped) covering an NJ-decided match (raw J-points
favored red 9/16, NJ on red → effective 13/12 blue, `winner_side='blue'`), a Path-A DSQ small
final (`winner_side` set with null scores), placements 1–4 matching the internal `/results`
PLACE data exactly, a second bracket producing null-rank entries (elimination-round DSQ +
first-round DNS) also matching internal, the 400/404 guards, singles `registration_id` joining
to `/results/scores`, and regressions on `/events`, `/resolve`, `/status`, `/rounds`,
`/results/scores`, and `/dual-matches/:id/judge-points`. `verify_v16.js` 123/123. README Viewer
API Reference + `ref-viewer-api.md` help topic updated; guide PDFs regenerated.

**Files modified:** `server/routes/viewer.js`, `README.md`,
`client/src/help/topics/ref-viewer-api.md`, `server/public/docs/guides/*.pdf` (regenerated),
`server/version.js`, `client/src/components/Layout.jsx`, `client/package.json`,
`server/package.json`, `CLAUDE.md`

---

## v1.29.00 Feature Notes

### Dual Moguls Landing Zone (Chop) NJ + Tied-Time 3/3 Credit + Air Tied Declaration (v1.29.00)

Implements FS-18 (FIS, approved 6 June 2026) per David's spec
(`StickIt_1_29_00_DM_Landing_Zone_Spec_07-03-26.md`), resolving the workflow question that caused
the v1.26.01 rollback: **the Air Judge (J3) makes the NJ call** (HJ can set/clear; operator/paper
paths too), and — unlike the rolled-back record-keeping-only v1.26.00 version — the finding now
**changes scoring** via effective judge-point overrides. Rulings confirmed this session: the paper
modal also gets an Air Tied checkbox, and the NJ endpoint is public (tablet rule, accepted
trade-off class).

**Engine — one shared helper, effective values everywhere.** New
`effectiveJudgePoints(judgeScores, njCall)` in `server/scoring/engine.js` (constants defined once;
comment notes the FS-18 chop wording awaits the 2026/27 ICR). Precedence: NJ 'blue' → J4 effective
0/5 (raw ignored, incl. a raw time-tied); 'red' → 5/0; 'both' → speed tied 3/3; no NJ + J4
time_tied → speed tied **3/3** (ruling 4 — replaces the old 0/0 presentation); J3 air_tied → air
votes withheld 0/0 (deliberate handbook asymmetry, JH 6304.3.5.1); overallScale = 5/4/3 (5 minus 1
per tied comparison). `calcDualMogulPointSplit(judgeScores, njCall)` computes totals + winner from
**effective** values and returns `breakdown` (raw) + `effectiveBreakdown` + `njCall/speedTied/
airTied/overallScale`. Distributed totals 25/25/19/19 — always odd, tie impossible (ICR
4307.2.2.1). `validateDualPointSplit` gains `airTied` (must be 0/0) and `overallScale` params
(replacing `isOverallWithTimeTied`). The 3/3 and 0/0 are FIVE-judge panel values — the 2.5 in the
FIS text is the seven-judge figure.

**Tied-time display change (ruling 4, retroactive).** Every consumer now computes totals through
the engine instead of raw SQL SUMs (dual.js bracket GET via one grouped djp query, viewer.js
bracket, pdf.js dual-results + dual-bracket split strings) — so historical time-tied matches
(stored 0/0 rows, untouched) display 3/3 and 25-point totals everywhere. Winners unchanged. No DB
migration of stored rows.

**Database.** `dual_bracket.nj_call TEXT` (NULL|'blue'|'red'|'both'; supersedes the v1.26.00
orphan nj_blue/nj_red booleans) and `dual_judge_points.air_tied INTEGER NOT NULL DEFAULT 0` (J3
row stored 0/0 with air_tied=1, mirroring the J4 time_tied convention). Standard idempotent
migrations.

**API (`server/routes/dual.js`).** New **public** `POST /:matchId/nj` body
`{ athlete:'blue'|'red', value:bool }` — server derives the stored nj_call; 400 on approved
matches ("use the edit path"); **recomputes winner/hj_pending** (a single NJ can flip the
effective winner after all five submitted); **deletes J5's row whenever the computed overallScale
changes** (both↔single/none transitions), same as the tie flows; audit-logs
`dual_nj_set`/`dual_nj_cleared`; broadcasts `dual_nj_update {matchId,njCall}` + a fresh
`dual_points_update` (which now carries `njCall/speedTied/airTied/overallScale`). Judge-points
POST accepts `air_tied` (J3 only, 0/0 enforced) and generalizes the J5-clear to ANY scale change
from a J3/J4 submission; J5 validated against the computed scale (SPLITS 5/4/3). Paper-score
accepts `nj_blue/nj_red/air_tied` on both paths (Path A stores nj_call too). All match-detail
responses (active-match, judge-points GET incl. new top-level `nj_call`, bracket GET) carry the
new fields; every engine call site passes nj_call via a shared `mapDjpRows()` helper so the flags
can't drop on one path.

**Air Judge tablet (`JudgeTablet.jsx` DualJudgeView, J3).** NJ (Past Chop) panel below the split
card: two independent team-colored toggles driven by SERVER state (active-match + dual_nj_update),
confirm on set AND clear (second-toggle confirm notes the 3/3 speed tie), immediate POST,
independent of the air split, editable until approval. New **Air Tied** button mirroring Time Tied
(submits 0/0 + air_tied). NJ badges on the blue/red athlete cards (all dual judges see them).

**Time Judge (J4).** Persistent amber `tablet-warn-banner` whenever nj_call is set ("Speed
override active: Blue 0 / Red 5" / "Speed tied at 3 / 3"), non-dismissable; entry flow unchanged;
header/hint relabeled "(Recorded — Overridden by NJ)" while overridden, including post-submit.

**Overall Judge (J5).** Scale comes from the server (`pointResult.overallScale`) — new
`SPLITS_3PT`; header "Award 5/4/3 Points" with the reason. A scale change deletes J5's row
server-side → the existing rejected-score flow prompts the rescore.

**HJ tablet (`HeadJudgeTablet.jsx` DualHeadJudgeView).** Same persistent banner + per-athlete
Set/Clear NJ toggles with confirmation (HJ can opine on close calls); judge grid shows **raw →
effective** ("4 / 1 → 0 / 5 (NJ)", "Time Tied → 3 / 3", "Air Tied (0 / 0 — votes withheld)") from
`effectiveBreakdown`; result panel labels Speed Tied 3/3 / Air Tied 0/0 + current scale (stale
"max 19 pts" copy fixed); approval certifies the finding; send-back needs no restoration.
`executeReject` extends the J4→J5 clear coupling to an air-tied J3 and now **preserves
time_tied/air_tied flags on the re-POST of kept rows** (previously dropped them — latent bug).

**Paper/manual entry (`EventDetail.jsx`).** DualPaperScoreModal: NJ Blue/Red checkboxes with
advisory, **Air Tied checkbox** (J3 forced 0/0), scale-aware `maxPts`/clamp/J5 max, and the
running-totals box now shows **effective** totals (raw entered shown beneath when an override is
active) since a raw comparison could disagree with the actual winner. DualScoringPanel: live NJ
checkboxes on the active-match card (POST /nj), NJ badges on match rows + DualBracketResults,
Speed/Air Tied notes, `dual_nj_update` WS refetch. **Bonus fix:** the v1.16.17 "Edit Scores"
button passed a nonexistent `ptData.judgeScores` key, so editing a completed match never
pre-populated — now uses `result.breakdown` (also carries the tie flags).

**Public surfaces.** Scoreboard `judgePointsByMatch` now stores `{rows, result}`; DualMatchTab and
the BracketMatchCard expanded splits render `effectiveBreakdown` values (time-tied "TT"/0 cells →
3/3), NJ badges via DualMatchCard/`Row` props (v1.26.00 styling), tie notes, and
`dual_nj_update`/`dual_points_update` WS handling. DualMatchCard + OverlayDualVS gained
`njBlue/njRed` gold-pill badges; Overlay tracks `njCall` from active-match + a new
`dual_nj_update` handler (totals were already effective via `dual_points_update`).

**PDFs.** dual-bracket split strings now use effective values — always 5 terms (time-tied J4
renders as a 3+…, air-tied J3 as 0) — plus the `[NJ]` name tag (drawAthleteRow `nj` param,
redOnTop-aware). dual-results totals computed through the engine.

**Viewer API.** Bracket rows gain `nj_call`; `blue_score`/`red_score` are effective totals.
`/dual-matches/:matchId/judge-points` returns `nj_call, speed_tied, air_tied, overall_scale,
judges` (raw, now incl. air_tied) **and `effective_judges`** (with `overridden` flag) so the iOS
app never recomputes rules. README + ref-viewer-api.md updated with the new shapes.

**Import/export round-trip** (the recurring v1.16.05 trap): `nj_call` threaded through the
dual_bracket INSERT/UPDATE sites and `air_tied` through the dual_judge_points sites in
`executeImport`/`executeMerge`, with `?? null`/`?? 0` legacy tolerance. Export needs nothing
(`SELECT *`).

**Verification.** `verify_v16.js` extended 100 → 123 checks (all 7 precedence rules, scales,
distributed totals 25/25/19/19 odd, winner-flip-by-NJ, validation modes). A 54-check scratch-server
integration test walked the spec §11 edge cases end-to-end against the real server: NJ before/after
J4 submits (raw preserved, effective 0/5, winner + hj_pending recompute), HJ clear → raw governs,
NJ-after-five-submitted updates totals without clearing J5, both-NJ → J5 cleared → 4-pt rescore
enforced, both→single → J5 cleared again, air-tied validation (J3-only, 0/0), both-tied scale 3
totals 19, air-tied cleared → J5 rescored, approve locks NJ (400), paper path with both-NJ +
air-tied and Path A + NJ, **historical time-tied match reads 3/3 → 25 in bracket GET and viewer**,
viewer effective_judges/nj_call/scale, dual-bracket + dual-results PDFs render, audit rows logged,
and with protection ON the NJ + judge-points endpoints stay public while paper-score still 401s.
Double-boot migration idempotence confirmed. Help topics updated (events-dual chop section
rewritten for the real workflow, tablet-dual NJ/Air-Tied/J5-scale sections, tablet-hj dual raw-vs-
effective, ref-glossary NJ + tie entries, ref-viewer-api) and guide PDFs regenerated.

**Files created:** none (all additive edits)
**Files modified:** `server/scoring/engine.js`, `server/db/schema.js`, `server/routes/dual.js`,
`server/routes/viewer.js`, `server/routes/pdf.js`, `server/routes/meets.js`,
`server/scripts/verify_v16.js`, `client/src/pages/JudgeTablet.jsx`,
`client/src/pages/HeadJudgeTablet.jsx`, `client/src/pages/EventDetail.jsx`,
`client/src/pages/Scoreboard.jsx`, `client/src/pages/Overlay.jsx`,
`client/src/components/public/DualMatchCard.jsx`, `client/src/components/public/OverlayDualVS.jsx`,
`client/src/help/topics/{events-dual,tablet-dual,tablet-hj,ref-glossary,ref-viewer-api}.md`,
`server/public/docs/guides/*.pdf` (regenerated), `README.md`, `server/version.js`,
`client/src/components/Layout.jsx`, `client/package.json`, `server/package.json`, `CLAUDE.md`

---

## v1.28.00 Feature Notes

### Viewer API — Actual Run Times + Jump Codes/DD (v1.28.00)

Additive fields on two read-only Viewer API endpoints, requested by the iOS app (Vail athlete/coach
feedback): expose each athlete's **actual finish time in seconds** and the **jump codes + exact DD
applied**, so the app can show real times alongside the derived time score and let coaches interpret
per-judge air scores. Server-only change — `server/routes/viewer.js` plus README docs. No new data
collection: every field is already persisted on the `runs` row (`run_time`, `jump1_code`,
`jump1_dd`, `jump2_code`, `jump2_dd`) — using the stored per-run DD is more correct than a
`jump_dd_table` lookup because it reflects the repeat-jump rule (a dropped jump carries DD 0).

**`GET /events/:eventId/results`** (mogul/aerials branch) — each ranked result gains `run_time`,
`jump1_code`, `jump1_dd`, `jump2_code`, `jump2_dd`. `run_time` is mapped `< 0 → null` so the NT
sentinel (-1) and no-timed-component events (e.g. Devo) both read as `null`; `time_score`
(speed_score) is unchanged. Second-jump fields are `null` for single-jump events. Dual mogul branch
untouched.

**`GET /events/:eventId/results/scores`** — response gains a `runs` array (keyed by `run_id`, also
carrying `registration_id`) with `run_time` + the four jump code/DD fields for every completed run in
the active round, so the per-judge `scores` array can be joined to jump context. Existing `scores`
shape unchanged.

**Verification.** Booted the real Express router on a scratch DB with one complete mogul run (bib 14,
time 23.45, jumps bp/0.78 + 7oG/1.02, one TL + one air judge score); both endpoints returned the new
fields with correct values and the NT/`null` mapping. README Viewer API Reference updated (new fields
documented on both endpoints; also corrected the stale `score_type` example — turns are stored as
`score_type:"turns"`, not `tl_carving`).

**Files modified:** `server/routes/viewer.js`, `README.md`, `server/version.js`,
`client/src/components/Layout.jsx`, `client/package.json`, `server/package.json`, `CLAUDE.md`

---

## v1.27.00 Feature Notes

### USSS Transmit Restored — Fully Automatic All-Events Zip from the Meet Page (v1.27.00)

The USSS transmit UI had been orphaned since before git history began (v1.16.19): the server endpoint
(`POST /api/export/usss-transmit/:meetId`) and the `UsssTransmitModal` component both existed, but no
button anywhere rendered the modal. Restored per David's rulings as a **fully automatic** flow: **Meet
page → More ▾ → USSS Transmit** generates one zip containing a results XML for **every event in the
meet** (mogul, dual mogul, **and aerials** — new), with no operator-typed category/IDs/TD fields.

**Automatic derivation (replaces the old request-body fields):**
- **NAT_code per event** = the stored `events.usss_code` (the editable "USSS Code" field on each
  event page). The old flow ignored this column and made the operator re-type codes.
- **Category per event** = `DIVISION_TO_CATEGORY[event.division]` (comp_series/open→DIV,
  rqs_eqs/rqs→EQS, devo/devo_junior→ROC; map moved server-side into `transmit.js`). Note `fis`
  division intentionally has no mapping → blocks with an error.
- **TD block (DIV/DIC only)** = the meet's `Technical Delegate` official (meet-level rows preferred
  over event-level), name split last-token-as-lastname via `parseFullName`, `ussa_id` → `NAT_tdnum`.

**Block-everything validation (David's ruling).** Shared helper `validateMeetForTransmit(meetId)`
feeds both the POST and the check endpoint. ANY problem → 400 with ALL problems listed, nothing
generated: event not `status='complete'`, missing `usss_code`, unmapped division, missing turns
judges (mogul/dual) or any judges (aerials), TD missing/no-USSS# when a DIV/DIC event exists, meet
with zero events. **Athletes missing USSS# remain a warning** with the existing
`needsAcknowledgment` → re-POST `{ acknowledgeWarnings: true }` flow. The old silent `excluded`
list is gone (an unfinalized event is now an error).

**Aerials XML (new, no sample available — mirrors mogul).** `generateSingleMogulXml` gained a
`disciplineCode` param ('MO' default, 'AE' for aerials); `processMogulEvent` was generalized to
`processRunsEvent` handling both disciplines (same runs query/classified/notClassified/rank flow —
`rankResults` already dispatches on discipline). `buildJuryElements` gained a discipline param: for
aerials the jury lists `AeJudgeN` (v2) / legacy component judges instead of TL/DualTurns. Filenames:
`SF<code>_<gender>_MO.xml` / `_DM.xml` / `_AE.xml`; zip = `SF<lowest code>.ZIP`.

**Safari auto-extract fix:** the zip is served `Content-Type: application/octet-stream` (was
`application/zip`) — same fix as the v1.16.25 meet exports — so Safari's "Open safe files" doesn't
unpack it.

**Client.** New `client/src/components/UsssTransmitModal.jsx` (the orphaned modal was deleted from
`EventDetail.jsx`): on open it fetches the rewritten `GET /usss-transmit-check/:meetId` (now returns
per-event readiness `{ events: [{..., ready, problems }], td: {...}, ready }`) and renders a ✓/✗
checklist incl. a TD row; Generate → errors in a red box / warnings with "Proceed with Warnings" /
success panel with the downloaded filename and the required message **"Please email file to
results@ussa.org"**. Endpoint stays behind `requireAuth` (`/api/export` mount); modal sends
`authHeaders()`.

**Verification.** Scratch server + seeded DB (complete mogul M + aerials F + one-match dual M, TD
"Mary Jo Smith"): check endpoint all-ready; POST without ack → warning for a no-USSS# athlete; with
ack → `SFU0589.ZIP` (octet-stream) containing all 3 XMLs — AE discipline + AeJudge jury verified, TD
split "Mary Jo"/"SMITH", DNS athlete in `FS_notclassified`; breaking code/status/TD simultaneously →
single 400 listing all three errors; restore → 200. `verify_v16.js` 100/100.

**Files created:** `client/src/components/UsssTransmitModal.jsx`
**Files modified:** `server/routes/transmit.js`, `client/src/pages/MeetDetail.jsx`,
`client/src/pages/EventDetail.jsx` (orphan modal removed), `client/src/help/topics/reports-transmit.md`
(rewritten for the new flow), `server/public/docs/guides/*.pdf` (regenerated), `server/version.js`,
`client/src/components/Layout.jsx`, `client/package.json`, `server/package.json`, `CLAUDE.md`

---

## v1.26.03 Feature Notes

### Tablet Auth Gap — `phases/results` Made Public (v1.26.03)

Comprehensive review turned up one more instance of the v1.25.00 "public/tablet surface
wired to a `requireAuth` endpoint" bug class that the v1.26.02 audit missed. The whole phases
router was mounted behind `requireAuth` at the app level (`server/index.js`), but
`GET /api/events/:eventId/phases/results` is called with a plain, token-less `fetch` by two
surfaces that must never require a login:

- the **public Scoreboard** (`client/src/pages/Scoreboard.jsx` `loadResults`), and
- the **Head Judge tablet** final-review screen (`client/src/pages/HeadJudgeTablet.jsx`).

With password protection ON, both got 401. The Scoreboard swallowed it (`.catch(() => null)`)
and silently fell back to the single-run `StandardLayout` — so any multi-phase mogul event
(Best of 2, Qualifier/Finals) lost its per-phase column breakdown for spectators. The HJ
final-review table hung on "Loading results…" (the **Finalize Event** button still worked, since
`/finalize` is already public, so the event wasn't bricked — the HJ just finalized without seeing
the results table). This fails *closed* (denies access), so it is not an exploitable hole like the
original v1.25.00 scoring-lockout bug, but it is the same untracked coupling.

**Fix.** Auth is now applied *inside* `server/routes/phases.js` (per-route) instead of at the
mount, mirroring the pattern `runs.js` / `dual.js` already use. A router-level guard lets
`GET /results` through and calls `requireAuth` for every other method/path; the existing
lockCheck middleware still runs after it. The mount in `server/index.js` no longer wraps the
phases router in `requireAuth`. Net effect: `GET /phases/results` is public (matching the already-
public `/results` and `/results/judge-scores`); phase create/delete/finalize/approve/return/reopen
and `GET /status` / `GET /:phaseId/eligible` stay login-only exactly as before.

**Rule reinforced:** any endpoint a tablet or public page hits with a plain fetch must be public —
never `requireAuth`.

**Verification.** Scratch server booted with protection enabled via the real admin flow: `GET
/phases/results` → 200 (was 401), `POST /phases` → 401 (still protected), `GET /phases/status` →
401 (still protected — posture unchanged). Also ran a full non-security correctness review of the
scoring engine, finalization paths, results/tier assembly, dual bracket advancement, and meet
import/export round-trip; `verify_v16.js` passes 100/100. No other defects found (see session
notes: voice WS cost exposure and the logo-path boolean leak were reviewed and judged
non-actionable/pre-existing).

**Files modified:** `server/routes/phases.js`, `server/index.js`, `server/version.js`,
`client/src/components/Layout.jsx`, `client/package.json`, `server/package.json`, `CLAUDE.md`

---

## v1.26.02 Feature Notes

### Tablet Auth Gap Fixed — HJ/Timekeeper Endpoints Public Again + Status-Only DNS Endpoint (v1.26.02)

Fixes the latent v1.25.00 bug where the HJ and Timekeeper tablets called `requireAuth` endpoints
with plain fetches (no login token), so those buttons failed with 401 whenever password protection
was ON. Worst case was core scoring: `PUT /runs/:runId` — the endpoint Air Judges use to submit
jump codes and the Timekeeper uses to submit times — had been made requireAuth, so scoring itself
would have been dead with protection enabled. Harmless while protection stayed off (requireAuth is
a pass-through); A-5 made the Enable Protection button live, so this had to be fixed before first
use. Approach per David's ruling: the **simple fix** (make tablet-reachable endpoints public per
the access model) **plus one carve-out** — full manual score entry stays protected and the tablets'
DNS buttons get a narrow status-only endpoint instead.

**requireAuth removed** (each site carries a v1.26.02 policy comment naming the tablet caller):
- `server/index.js`: `POST /api/events/:eventId/finalize` (HJ Finalize Event — both mogul final
  review and dual bracket review), `POST /api/events/:eventId/return-to-scoring` (HJ final-review
  screen; the A-2 protection of this one was the mistake).
- `server/routes/runs.js`: `PUT /:runId` (air-judge jump codes, timekeeper time, HJ Clear Codes),
  `POST /:runId/scores/:judgeScoreId/reject` (HJ reject score), `DELETE /:runId/time` (HJ reject time).
- `server/routes/dual.js`: `PUT /:matchId/winner` (HJ Blue/Red DNS/DNF), `PUT /active-match`
  (HJ Start Run), `DELETE /active-match`, `DELETE /:matchId/judge-points` (HJ reject/re-enter),
  `POST /send-back-to-scoring` (bracket review).

**Still protected (unchanged):** `POST /runs/manual`, `/:runId/manual-score`, `/forerunner`,
`DELETE /:runId`, `/reopen`, `DELETE /scores/last`, all dual seeding/paper-score/manual-entry/reset,
and everything else in the v1.25.00 protected list. Verified no tablet calls any of these (the
aerials tablet only uses the public `POST /:runId/scores`).

**New public endpoint — `POST /api/events/:eventId/runs/status-only`.** Records a DNS/DNF/DSQ run
with NO scores. Strict whitelist body `{ registration_id, run_number, round, run_status }` — any
extra field (e.g. smuggled `tl_scores`) → 400; RNS → 400; registration must belong to the event;
auto-activates a setup event like `/runs/manual`. The status-run insert/broadcast/audit block was
extracted from `/runs/manual` into a shared `createStatusRun()` helper so the two paths can't
diverge (`/manual`'s DNS path now calls it too — audit action stays `manual_run_status`). The HJ
tablet's next-up DNS button (`HeadJudgeTablet.jsx`) and the Timekeeper's DNS button
(`TimekeeperTablet.jsx`) now POST here instead of `/runs/manual`. The Officials-UI DNS paths keep
using `/runs/manual` with their login token.

**Accepted trade-off (David's ruling, "not a high security issue"):** with protection ON, run/match
status changes, score rejection, match start/end, and event finalization are callable without login
by anyone who can reach the server (event IDs are publicly discoverable via the Viewer API). Score
*writing* stays login-only. Recovery path for vandalism: 5-min auto-backups + audit log. The
credential-per-tablet design was considered and declined (complexity, second auth system).

**Rule going forward:** any new tablet-facing button must call a public endpoint — never
`requireAuth`. lockCheck (event lock) still applies to all these routes via the router-level guard.

**Verification.** Scratch server + fresh DB, protection enabled via the real admin flow (password
set + `PUT /auth-settings`): all 10 unlocked endpoints return domain responses (200/400/404), never
401, with tablet-verbatim bodies; `/runs/manual` and `/admin/*` still 401 without a token;
`/status-only` 201 on the exact tablet payload, 400 on RNS / extra fields / foreign registration;
`/runs/manual` with token still works on both the DNS path (shared helper) and the full scored path
(turns 42 / air 11.36 / total 53.36 on a synthetic run).

**Files modified:** `server/index.js`, `server/routes/runs.js`, `server/routes/dual.js`,
`client/src/pages/HeadJudgeTablet.jsx`, `client/src/pages/TimekeeperTablet.jsx`,
`server/version.js`, `client/src/components/Layout.jsx`, `client/package.json`,
`server/package.json`, `CLAUDE.md`

---

## v1.26.01 Feature Notes

### FS-18 Chop (Landing Zone) NJ Flags — Rolled Back (v1.26.01)

David requested removal of the v1.26.00 FS-18 chop/NJ-flag feature until the entry workflow is
clarified — planning for judge-tablet NJ entry raised open questions (who records the call: HJ, J4,
or operator) and surfaced a latent HJ-tablet auth gap (the dual HJ tablet's DNS/DNF buttons call
`requireAuth` endpoints with plain fetches, so they fail whenever password protection is ON — still
unfixed, tracked in memory). Surgical removal, NOT a revert to v1.25.04: everything else in v1.26.00
(Part A status ordering + RNS removal, FS-13 grabs, FS-4/7 q2_field_limit, FS-10 docs, viewer
`db.id` + judge-points endpoint) is untouched.

**Removed:** the `nj_blue`/`nj_red` schema migrations (databases that booted v1.26.00 — including
production — retain the orphan nullable columns; harmless, intentionally not dropped); paper-score
NJ handling + the `PUT /:matchId/nj` endpoint in `dual.js`; the nj columns from the meet
import/merge INSERT/UPDATEs; the `[NJ]` tag from the dual bracket PDF; `nj_blue`/`nj_red` from the
viewer bracket SELECT and judge-points response (endpoint + `db.id` kept, response back to
`{ match_id, judges }` per the companion doc's original shape); all NJ checkboxes/advisory
text/badges from EventDetail (paper modal, active-match card, match rows, bracket cards),
DualMatchCard, and the Scoreboard bracket tab. Help topics: events-dual chop section rewritten as
rule guidance only (J4 awards 0/5; both past = Time Tied 2.5/2.5); ref-glossary NJ entry removed;
ref-viewer-api + README nj fields removed. Guide PDFs regenerated.

**Explicitly verified intact:** the pre-existing mogul `NJ` (No Jump) jump code (DD 0.00) and the
air-judge tablet's No-Jump button — v1.26.00 never touched them (zero tablet-file changes in that
release) and neither does this rollback. Legacy meet exports containing `nj_*` keys import cleanly
(INSERTs enumerate columns, extra keys ignored).

**Reintroduction path:** the complete feature is in the v1.26.00 commit `78bbcd3` diff; re-apply
from there once David rules on the entry workflow (HJ tablet vs J4 tablet vs operator-only), and
fix the HJ-tablet auth gap alongside.

**Files modified:** `server/db/schema.js`, `server/routes/dual.js`, `server/routes/meets.js`,
`server/routes/pdf.js`, `server/routes/viewer.js`, `client/src/pages/EventDetail.jsx`,
`client/src/pages/Scoreboard.jsx`, `client/src/components/public/DualMatchCard.jsx`,
`client/src/help/topics/events-dual.md`, `client/src/help/topics/ref-glossary.md`,
`client/src/help/topics/ref-viewer-api.md`, `server/public/docs/guides/*.pdf`, `README.md`,
`server/version.js`, `client/src/components/Layout.jsx`, `client/package.json`,
`server/package.json`, `CLAUDE.md`

---

## v1.26.00 Feature Notes

### Results Status Ordering + RNS Soft Removal (v1.26.00, Part A)

Implements David's ruling on statused-athlete placement (spec:
`StickIt_1_26_00_Implementation_Spec_07-01-26.md`). Previously any DNS/DNF/DSQ/RNS run was appended
to the bottom of results unordered with `rank: null`. Now, per USSS 4012.3: **DNF/RNS/DNS are
phase-scoped** — bottom of the tier the status occurred in, ahead of all lower tiers, in-tier order
scored → DNF → RNS → DNS; **DSQ is event-scoped** — absolute bottom of the event. Statused athletes
**consume numeric places** (competition ranking) so lower tiers continue numbering after them (F1-of-8
with 6 scored + DNF + DNS → places 1-6, DNF 7th, DNS 8th, qualification starts at 9th); the status
code still prints in Place columns. Same-status ties share a place, listed bib-ascending, next place
skips. Multi-run statuses resolve by precedence DSQ > DNF > RNS > DNS; a scored run in the status's
own tier ranks normally. Qualifier/finals tier claims go to the HIGHEST phase the athlete appeared in
(scored-Q-then-DNS-F1 sits at F1 bottom, excluded from the qual tier). Dual moguls unchanged.

**Shared engine helpers** (`server/scoring/engine.js`): `STATUS_PRECEDENCE`, `resolveEffectiveStatus`,
`orderFlaggedForTier`, `assembleTieredResults` (the query-free composite every consumer feeds its own
SELECTs into, so surfaces can't diverge), `makeTierKeyForRun`. Consumers rewired: `results.js` (legacy,
best_of_2, qualifier_finals, and single-phase paths), `phases.js` GET results (public scoreboard now
matches `/results` exactly; DSQ group gets `tier:'flagged'` / `tier_label:'DSQ'`), `pdf.js`
`buildResultsData` (**flagged athletes now appear on phase-format PDFs — previously omitted
entirely**; group variants sort by the new global rank; per-run report ordered), `transmit.js`
(effective-status resolution replaces highest-run_number pick; FS_notranked ordered DNF → DNS → DSQ).

**RNS soft removal.** RNS is a legacy Winfree convention absent from the 2026 USSS Comp Guide and FIS
ICR. Entry paths closed: HJ tablet `RunStatusGrid` is now a 3-button DNS/DNF/DSQ grid; the EventDetail
Flag dropdown renders RNS only when the stored value is RNS (clear/change allowed, re-select not);
`PUT /:runId/status` refuses RNS server-side. Full read-side support retained — historical RNS renders
everywhere, orders between DNF and DNS, and **transmits to USSS as DNF** (`xmlStatus()` in
transmit.js, output-only; stored data untouched). No DB migration. Scoreboard's event-bottom tier
group is now labeled "DSQ" (only DSQs land there).

### Spring 2026 FIS Rule Changes (v1.26.00, Part B)

**FS-13 — basic vs advanced grabs.** Per the Big G / Little G rule (values PROVISIONAL — taken from an
early draft; the FIS JH 6204.3.7 citation originally given here does not define them, see the 09-08-26
rules compliance review / v2.5.06 notes), lowercase `g` = basic grab (+0.05),
uppercase `G` = advanced grab (+0.12, was +0.14). All 12 existing G codes re-valued −0.02 (3G
0.82→0.80/0.90 M/F etc.) and 12 lowercase-g siblings added at newG−0.07 (bg 0.73/0.83, 7og 0.92/1.02 —
David ruled the uniform rule over the spec's inconsistent 0.94 example); dual mogul ×1.25. Fresh seed
updated + FS-13 sentinel migration in `schema.js` (UPDATE gated on 3G=0.82, INSERT OR IGNORE gated on
`bg` missing — idempotent, hand-edits not stomped). **DD lookup is now case-EXACT for mogul/dual_mogul**:
the v1.24.00 COLLATE NOCASE fallback is removed there (kept for aerials — no grab split, Tk/Pk
tolerance, David's ruling) and replaced by `canonicalizeJumpCode()` (engine export) which runs only on
an exact-case miss and never folds meaning-bearing letters (g/G, p/P — bp Back Position vs bP Back
Pike): BG→bG, Bg→bg, 7OG→7oG, BTF→btF, ss→SS. `parseJumpCode` keeps g/G distinct in repeat keys
(spin + new stand-alone `grab_g`/`grab_G` branch), and `areJumpsRepeats` canonicalizes first — so
**bg vs bG are NOT repeats, bG vs bG ARE** (USSS 4210.2.1 identical-codes rule). Voice: "grab" = basic
g, "big grab"/"advanced grab" = G ('back grab'→bg re-pointed, advanced phrase variants added for
back/front/loop/3/7/10/o-families); exact-case pass added before the case-insensitive allowed-set scan
so letter-dictation deterministically resolves lowercase; grab phrases added to Deepgram
STATIC_KEYTERMS. Known cosmetic consequence: lowercase codes stored pre-1.26 (scored via NOCASE at the
G value) now read as basic grabs; stored DDs/scores untouched. MAG will conduct a full DD chart review
at the start of the quad — values editable via Admin → Jump DDs.

**FS-18 — dual moguls chop (landing zone) NJ flags. (ROLLED BACK in v1.26.01 — see below.)**
New nullable `dual_bracket.nj_blue`/`nj_red`
columns. Record-keeping only: NJ checkboxes on the live active-match card (new
`PUT /api/events/:eventId/dual/:matchId/nj`, requireAuth, broadcasts `run_updated`) and in the
paper-score/manual-entry modal (flags ride the existing `POST /:matchId/paper-score` body on both
paths). Advisory text — one checked: "Chop violation: J4 awards 0 to [color], 5 to opponent."; both:
"Both past chop: use Time Tied (2.5 / 2.5)." — values never auto-forced; the existing time_tied
mechanism produces 2.5/2.5. NJ badges on EventDetail match rows + bracket tree, the public scoreboard
match view + bracket tab, and the dual bracket PDF (`[NJ]` name tag). Judge tablets untouched. Meet
export/import round-trip carries the flags (executeImport + executeMerge INSERT/UPDATE sites — the
recurring v1.16.05 trap).

**FS-4/FS-7 — Phased Finals Q2 field cap.** New nullable `event_phases.q2_field_limit` (NULL = no cap,
current behavior). When set on a Qualifier 2 phase, only athletes ranked pass_through+1 through the
limit after Q1 get Q2 run-order slots (`takeUpToRank` band — ties at the limit expand per ICR
4207.3.4, David's ruling); athletes below the limit take no Q2 run and rank on Q1 in the qualification
tier (existing best-score logic, no results change needed). Optional "Q2 field limit" input in the
add-phase modal with WC preset hints; phase summary shows "Q2 limit: N"; export/import round-trip
carries the column. Format presets documented in the events-phases help topic (WC Phased Moguls pass 8
/ limit 32 / F1 16 / F2 6; Championship Moguls pass 10 / no limit / F1 20 / F2 8; WC Phased Aerials
pass 6 / limit 18 / F1 12 / F2 6).

**FS-10 — gate fault:** documentation only (gate fault = DNF; intentional re-entry after any DNF =
DSQ) — one line in scoring-statuses. *(Corrected in v2.5.06: the DSQ-on-re-entry rule is FIS-only and
not adopted domestically — USSS 4210.4.3 keeps re-entry a DNF.)* **Verified no-change:** FS-1 (Chief of Course already in role
list), FS-3 (Major Competitions only), FS-8 (course_specs stores no bump distances), FS-9 (USA repeat
exemption — existing USSS first-counts / RQS higher-counts logic unchanged), FS-14/15/16/20
(administrative).

### Viewer API — Dual Score Breakdown (v1.26.00, Part C)

Per `StickIt_Viewer_API_Changes.md`: the viewer dual bracket SELECT now returns `db.id AS id` (the
match primary key the iOS app needs) plus `nj_blue`/`nj_red`. New public endpoint
`GET /api/viewer/events/:eventId/dual-matches/:matchId/judge-points` → `{ match_id, nj_blue, nj_red,
judges: [{ judge_number, blue_points, red_points, time_tied }] }` ordered by judge_number; 404
`Match not found` when the match doesn't belong to the event. Keeps the iOS app off the internal
/dual API. README Viewer API Reference updated.

**Verification.** `verify_v16.js` extended 60 → 100 checks: resolveEffectiveStatus precedence,
orderFlaggedForTier ordering/tie/skip semantics, assembleTieredResults walks of spec edge cases
1/2/3/4/5/8, areJumpsRepeats grab cases, canonicalizeJumpCode 16 cases. Scratch-DB test: FS-13 seed
values (mogul + dual ×1.25), double-boot idempotence, legacy-DB upgrade path (3G 0.82→0.80, g codes
seeded), case-exact lookup with canonicalization fallback. Help topics updated (scoring-statuses
rewritten, tablet-hj/scoring-hj-review 3-button grid, reports-transmit RNS→DNF, ref-glossary,
ref-jump-dds grabs + v1.24 air-order accuracy fix, scoring-voice grab vocabulary, events-dual chop
section, events-phases Q2 limit + presets, ref-viewer-api) and guide PDFs regenerated.

**Files modified:** `server/scoring/engine.js`, `server/routes/results.js`, `server/routes/phases.js`,
`server/routes/pdf.js`, `server/routes/transmit.js`, `server/routes/runs.js`, `server/routes/dual.js`,
`server/routes/meets.js`, `server/routes/viewer.js`, `server/db/schema.js`, `server/voice/deepgram.js`,
`server/scripts/verify_v16.js`, `server/scripts/guides/qs_chief_of_score.js`, `server/version.js`,
`client/src/components/tablet/RunStatusGrid.jsx`, `client/src/pages/EventDetail.jsx`,
`client/src/pages/Scoreboard.jsx`, `client/src/components/public/DualMatchCard.jsx`,
`client/src/voice/parser.js`, `client/src/components/Layout.jsx`, `client/src/help/topicsIndex.js`,
10 help topic `.md` files, `server/public/docs/guides/*.pdf`, `README.md`, `client/package.json`,
`server/package.json`, `CLAUDE.md`

---

## v1.25.04 Feature Notes

### Printable PDF Guides — Role Quick Starts + Complete User Guide (v1.25.04)

Six downloadable/viewable PDFs surfaced at the new **/help/printable-guides** page (sidebar group
"Printable Guides", custom card-grid page — the only non-markdown help topic). Each card has View
(opens inline in a new tab) and Download buttons. All PDFs live as static files in
`server/public/docs/guides/` served by the existing `express.static` — public, no auth, like /help.

**The six PDFs.** Five role Quick Starts in plain non-technical language (cover + 2–4 content
pages, big type, drawn diagrams — flow charts, simplified tablet mockups, numbered steps, color
callouts; all three disciplines covered): **Judges** (connection, mogul T&L/Air, dual 5-point
split, aerials Air/Form/Landing, rejection flow), **Chief of Score** (day-at-a-glance flow, manual
entry/edits/statuses/event-day registration fixes, **printing reports during the event** per
David's explicit requirement, end-of-day), **Event Secretary** (before-meet setup from home, USSS
sync + registration + bibs + run order, training days, after-meet transmit/export — role framing:
secretary = before/after, chief = during), **Timekeeper** (annotated tablet mockup, NT, manual
top/bottom calc, paper-mode start, DNS), **Live Stream Crew** (scoreboard vs overlay, OBS/YoloBox
setup, Hide/Show control, Sun Mode, troubleshooting). Plus the **Complete User Guide**: all 64 help
topics (145 pages) with cover, two-pass TOC with real page numbers + dotted leaders, per-group
divider pages, PDF outline bookmarks, and clickable internal cross-topic links (named destinations
+ goTo).

**Build-time generation (key architecture).** Railway deploys only `server/`, so the server can't
read `client/src/help/topics/*.md` at runtime. All six PDFs are generated locally by
`node server/scripts/build_guide_pdfs.js` (also `npm run build:guides` in server/) and committed.
The script fails loudly (and exits non-zero) on unresolved internal links or if `client/` is
missing. Modules in `server/scripts/guides/`: `style.js` (palette/cover/two-pass footers — note the
switchToPage bottom-margin=0 trick to avoid phantom page adds), `draw.js` (flowRow/flowColumn,
step, callout, tabletFrame, chip, urlBar, numpadSketch, vector `check` — built-in fonts are
WinAnsi-only so NO unicode symbols like ✓→⌫ in quick-start strings), `markdown.js` (md→pdfkit
renderer mirroring MarkdownRenderer.jsx's exact dialect, with a GLYPH_MAP sanitizer for non-WinAnsi
chars in topic text), `topics_loader.js` (regex-extracts GROUPS/RAW_TOPICS from topicsIndex.js
source; skips `custom: true` topics), `complete_guide.js`, and one `qs_*.js` per role guide.

**Help UI.** `topicsIndex.js` gains the `printable` group + `printable-guides` topic with
`custom: true`; `HelpContent.jsx` renders `<PrintableGuides/>` for custom topics;
`client/src/help/topics/printable-guides.md` exists only to feed sidebar search. New
`.help-guide-*` styles in help.css. `client/vite.config.js` proxies `/docs` to :3001 for dev.

**Verification.** Script runs twice cleanly, zero unresolved links, page counts stable; every page
of all five quick starts visually inspected (drawn diagrams, footers "Page N of M"); complete-guide
TOC page numbers match actual topic pages; widest table (ref-jump-dds) breaks sanely; scratch
server serves all six at `/docs/guides/*.pdf` with application/pdf and `/help/printable-guides`
200; verify_v16.js still passes.

**Files created:** `server/scripts/build_guide_pdfs.js`, `server/scripts/guides/{style,draw,markdown,topics_loader,complete_guide,qs_judges,qs_chief_of_score,qs_event_secretary,qs_timekeeper,qs_live_stream}.js`,
`server/public/docs/guides/*.pdf` (6), `client/src/help/PrintableGuides.jsx`, `client/src/help/topics/printable-guides.md`
**Files modified:** `client/src/help/topicsIndex.js`, `client/src/help/HelpContent.jsx`, `client/src/help/help.css`,
`client/src/help/topics/ref-jump-dds.md` (stale "Information" sidebar path), `client/vite.config.js`, `server/package.json`,
`server/version.js`, `client/src/components/Layout.jsx`, `client/package.json`, `CLAUDE.md`

---

## v1.25.03 Feature Notes

### User Guide Refresh — v1.22.01 → v1.25.02 Catch-Up (v1.25.03)

The in-app User Guide (`/help`, last touched at v1.22.00) was brought current through v1.25.02.
Docs/content only — no server code, no scoring paths, no UI components changed (topic-title tweaks in
`topicsIndex.js` aside). Now 64 topics.

**Two new topics:**
- `admin-security` — "Password protection & login" (Admin group, after Dashboard): what's always
  public vs. protected, the judge/official/system_admin role ladder, how to enable/disable
  protection (admin password prerequisite), 12h sessions surviving restarts, login throttling,
  `STICKIT_AUTH=off` lockout escape hatch.
- `ref-viewer-api` — "Viewer API (third-party apps)" (Reference group): the six `/api/viewer`
  endpoints, hidden-event listing exclusion, active-round fallback, 404 shape, pointer to README.

**Voice topic rewritten** (`scoring-voice` — per David's explicit request): adds the F1–F4 hardware
keys with macOS Ctrl-alias table (v1.22.01/02), SpeechMike Device Control Center setup, Next =
next-*blank*-field semantics, the overwrite-warning flow for re-entering athletes who already ran,
typed Review corrections range-checked, cancel confirm, voice hidden on ALL aerials, Deepgram env
indicator on Admin Dashboard.

**Updated topics (accuracy fixes + new features):** `admin-users` (real auth replaces "placeholder"
copy; Password Set column; self/last-admin guards), `admin-events` (retitled "Event Management:
locking, hiding, re-opening" — search box, Re-open, full hide-from-Live-Scores section),
`admin-backups` (in-app Restore with typed-filename confirm + safety backup), `admin-audit` (live
filter dropdowns, From/To dates, real table columns; removed never-built CSV-export and User-column
claims), `admin-athletes` ("Delete ALL Athletes" rename, Show deleted → Restore Selected),
`admin-dashboard` (env indicators replace auth placeholder), `admin-usss-people` (on-page Sync
Now/Upload File), `scoring-manual` (aerials v2 manual entry modal replaces the "refused" section),
`events-dual` (runoff-to-8th true 5–8 mini-bracket + finals order), `events-lock` (locking vs.
hiding section), `public-livescores` (45s auto-refresh, hidden events), `public-overlay`
(Scoring-tab Hide/Show control), `public-home` (conditional LOGIN REQUIRED divider, dead Help-link
removed), `overview` (sidebar names, no judge "PIN", admin duties), `ref-formulas` (v1.24.00: air
avg-then-DD order + 10.0 cap, 7-judge separate turns/deduction drops, repeated-jumps section),
`reports-transmit` (FS_notclassified for DNS/DNF/DSQ/RNS), `reports-csv-xlsx` (UTF-8 BOM),
`meets-export` + `meets-training-days` (training days round-trip — removed "known limitation"),
`meets-edit` (More ▾ menu, status-change confirms), `meets-delete` (two-step modal with event
count), `judges-add` (inline name/USSS-ID edit; removed fictional PIN), `reg-usss` (USSS Database
page at /dashboard/usss replaces removed Information sidebar group), `athletes-db` (100/page).

**Verification:** all internal `(./slug)` links resolve across all 64 topics (scripted check);
scratch-server boot serves `/help/admin-security` 200 and the built bundle contains the new topic
titles; `/api/version` v1.25.03.

**Files created:** `client/src/help/topics/admin-security.md`, `client/src/help/topics/ref-viewer-api.md`
**Files modified:** `client/src/help/topicsIndex.js`, 24 topic `.md` files, `server/version.js`,
`client/src/components/Layout.jsx`, `client/package.json`, `server/package.json`, `CLAUDE.md`

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
matches with a proper 5-8 mini-bracket (USSS 4310.2.3.3 / 4310.3.2 authorize ranking to 8th by
dualing off; they do not describe the bracket — the pairing was corrected in v2.5.07 to mirror the
main draw, per the published RMF result sheets). `buildBracketShell`
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
