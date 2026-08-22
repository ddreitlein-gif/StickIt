# StickIt v2 Sync Protocol — Specification

**Protocol version:** 1 (`SYNC_PROTOCOL_VERSION` in `server/sync/protocol.js`)
**Governing plan:** `StickIt_v2.0_Local_Venue_Server_Design_Plan_08-21-26.md` (Revision 4)

This document is the written contract between the **cloud** (Render + Turso,
stickitski.com) and a **venue** local server (Raspberry Pi, `STICKIT_MODE=venue`)
for one-way local → cloud replication of an adopted meet. The executable
counterpart — the version-pinned column manifest and the canonical hashing
code — lives in `server/sync/protocol.js`, which both sides load from the same
codebase (D4: single codebase, no fork).

## 1. Versioning (R12)

- `SYNC_PROTOCOL_VERSION` is an integer shipped in `server/sync/protocol.js`.
- Every sync request carries the sender's protocol version (in the JSON body
  as `protocol_version`). The receiver refuses mismatches with HTTP 409 and
  `{ error: 'protocol_mismatch', expected, received }` and a human-readable
  message. Adoption is the first refusal point, so a mismatched pair can never
  get past step one.
- The v2.x app major version is the protocol compatibility boundary: a 2.x
  venue server adopts from a 2.x cloud. Any change to the manifest (column
  add/remove/reorder), the canonicalization rules, or the message shapes below
  requires bumping `SYNC_PROTOCOL_VERSION`.

## 2. Roles and single-writer rule

- A meet is either **cloud-authoritative** (`meets.adoption_status` NULL or
  `'checked_in'`) or **venue-authoritative** (`'adopted'`). Never both.
- While adopted, the cloud rejects every mutation touching the meet (including
  public tablet endpoints) with HTTP 423 `{ error: 'meet_adopted', ... }`
  (FR-20 `requireNotAdopted`), and only applies rows arriving through the sync
  endpoints below, authenticated by the per-adoption sync token.
- There is no merge machinery anywhere; conflicts are structurally prevented.

## 3. Authentication

- **Release code** (R13): short one-time code generated cloud-side by
  "Release for Adoption" (official+ login). Redeemed exactly once (atomic
  conditional UPDATE); expiry window configurable; un-releasable until
  redeemed.
- **Sync token**: issued at adoption, returned to the venue in the adopt
  response, stored locally; only its hash (`meets.sync_token_hash`, SHA-256)
  is stored on the cloud. Sent as `Authorization: Bearer <token>` on every
  subsequent sync call for that meet. Force-unlock (R8) invalidates it;
  subsequent calls get HTTP 410 `{ error: 'adoption_revoked' }` and the venue
  worker stops (local data intact).
- No cloud username/password is ever used at the venue (constraint 8).

## 4. Endpoints (all cloud-side, JSON)

| Endpoint | Purpose |
|---|---|
| `POST /api/sync/adopt` | Redeem a release code → lock-drain-snapshot → package + sync token |
| `POST /api/sync/meets/:meetId/changes` | Ordered outbox batch apply (upsync) |
| `POST /api/sync/meets/:meetId/checksums` | Compare per-table checksums (diagnostic) |
| `POST /api/sync/meets/:meetId/checkin` | Final verify + unlock (`mode: 'checkin'` or `'handback'`) |
| `POST /api/sync/meets/:meetId/repush` | Full re-push of named tables after a checksum mismatch |

### 4.1 Adopt

Request: `{ code, protocol_version }` (no auth — the code is the credential).

Cloud order is **lock-first** (tested invariant): validate code + protocol
version → atomically mark redeemed + set `adoption_status='adopted'`,
`adopted_at` → drain in-flight requests → build the snapshot → issue token.
A write landing during a lock-before-snapshot window would be silently
overwritten by upsync and invisible to the checksum, so snapshot strictly
follows lock.

Response:

```json
{
  "protocol_version": 1,
  "meet_id": "<uuid>",
  "sync_token": "<opaque>",
  "package": {
    "format": "stickit-adoption-package",
    "protocol_version": 1,
    "meet_id": "<uuid>",
    "exported_at": "<iso>",
    "tables": { "<table>": [ { "<col>": v, ... } ] },
    "logo": { "filename": "meet_<id>.<ext>", "base64": "..." } | null
  }
}
```

`package.tables` holds one array per **snapshot table** (see §6), each row
reduced to exactly the manifest columns. The USB plan-B export ("Export for
Adoption") writes the same `package` object to a file, with the lock set
atomically at export time; there is no lock-later variant.

Errors: 404 unknown/expired/used code, 409 protocol mismatch, 409 remote-
judging meet, 409 already adopted.

### 4.2 Changes (upsync)

Request:

```json
{
  "protocol_version": 1,
  "changes": [
    {
      "seq": 12345,
      "tbl": "judge_scores",
      "op": "upsert" | "delete",
      "pk": { "id": "<uuid>" },
      "row": { "<manifest columns>": v, ... },
      "idempotency_key": "<uuid>"
    }
  ]
}
```

- `seq` is the venue outbox `AUTOINCREMENT` sequence. **Ordering is by seq,
  never wall-clock** (FR-17: the Pi clock may be wrong offline).
- `row` is the full post-image for upserts (manifest columns only), `null`
  for deletes. Composite-PK tables carry all key columns in `pk`.
- Apply loop (cloud): for each change in ascending seq — skip if
  `seq <= meets.last_applied_seq` (idempotent replay), else upsert by PK /
  delete by PK, then set `last_applied_seq = seq`. Batch is applied in order;
  on an individual failure the cloud stops at that seq and reports it, so the
  venue retries from the failure point (at-least-once + skip = exactly-once
  effect).
- Response: `{ "applied_through_seq": N, "skipped": k }`.
- After a successful batch the cloud emits one generic per-event WS nudge
  `{ type: 'sync_applied', eventId }` for each event whose rows changed
  (FR-19) — no semantic WS payload reconstruction. Public cloud surfaces
  poll; the nudge just makes WS-connected spectators refresh promptly.
- Errors: 401 bad token, 409 protocol mismatch, 409 not adopted, 410 revoked.

### 4.3 Checksums / Check-in / Handback

Checksum request: `{ protocol_version, checksums: { "<table>": { count, hash } } }`
computed venue-side per §5 over the **checksum tables** (§6). Response:
`{ match: bool, mismatched: ["<table>", ...], cloud: { "<table>": { count, hash } } }`.

Check-in (`mode:'checkin'`) / handback (`mode:'handback'`) request is the
same shape plus `mode`. Cloud recomputes its own checksums, and only on a
full match sets `adoption_status = 'checked_in'` (check-in) or `NULL`
(handback — the meet returns to normal cloud editing so brackets can be built
overnight, D8) and clears the token hash. **Never unlocks on a failed
checksum**; the response names exactly which tables differ. The venue then
uses `repush` (full-table re-push of differing tables through the normal
apply path) and re-verifies.

Venue order (FR-10): local meet → read-only ("checking in" state, all role
pages frozen) → final outbox flush → checksums → cloud unlock → local archive
mark. Tablet writes during check-in are cleanly refused.

## 5. Canonicalization and hashing (FR-6)

Computed in JS on both sides by `server/sync/protocol.js` — never `SELECT *`,
never SQL-side hashing.

- Value canonicalization:
  - SQL `NULL` / JS `undefined` → the token `"\u0000"` (single NUL character).
  - number → `JSON.stringify(n)` (shortest round-trip; `-0` → `"0"`).
    Numbers replicate through JSON, which round-trips IEEE-754 doubles
    exactly, so both sides hash identical bit patterns.
  - bigint → decimal string.
  - string → `JSON.stringify(s)` (quoted/escaped; raw control characters are
    always escaped, so the NUL token and separator below cannot collide).
  - BLOB (`Uint8Array`) → `"b64:" + base64`. (No synced table stores blobs;
    defensive.)
- Row canonical form: manifest columns, manifest order, joined with `"\u0001"`. Row hash = SHA-256 hex of that string.
- Table checksum: rows sorted by canonical PK string (byte order), row hashes
  joined with `"\n"`, SHA-256 hex of the whole; reported as `{ count, hash }`.
- Only manifest columns participate. Physical column sets legitimately differ
  (production Turso carries orphan columns such as `dual_bracket.nj_blue/nj_red`
  from the v1.26.01 rollback; a fresh Pi database lacks them).

## 6. Table manifest (protocol version 1)

Source of truth: `TABLES` in `server/sync/protocol.js`. Summary:

| Table | PK | Sync (outbox) | Checksum | Snapshot | Meet scope |
|---|---|---|---|---|---|
| meets | id | ✓ | ✓ | ✓ | id = meet |
| events | id | ✓ | ✓ | ✓ | meet_id |
| athletes | id | ✓ | ✓ | ✓ | via registrations (FR-8) |
| registrations | id | ✓ | ✓ | ✓ | event_id → events |
| judges | id | ✓ | ✓ | ✓ | event_id |
| officials | id | ✓ | ✓ | ✓ | meet_id |
| course_specs | id | ✓ | ✓ | ✓ | meet_id |
| runs | id | ✓ | ✓ | ✓ | event_id |
| judge_scores | id | ✓ | ✓ | ✓ | run_id → runs |
| dual_bracket | id | ✓ | ✓ | ✓ | event_id |
| dual_judge_points | id | ✓ | ✓ | ✓ | match_id → dual_bracket |
| heats | id | ✓ | ✓ | ✓ | event_id |
| event_phases | id | ✓ | ✓ | ✓ | event_id |
| phase_run_order | id | ✓ | ✓ | ✓ | phase_id → event_phases |
| run_round_status | (event_id, run_number) | ✓ | ✓ | ✓ | event_id |
| training_days | id | ✓ | ✓ | ✓ | meet_id |
| training_day_exclusions | (training_day_id, athlete_id) | ✓ | ✓ | ✓ | training_day_id |
| audit_log (FR-12) | id | ✓ | — | — | all venue rows while adopted |
| usss_people (R5) | ussa_id | — | — | ✓ | global snapshot |

Notes:

- **athletes (FR-8):** global master table, scoped to "rows referenced by this
  meet's registrations". While adopted, the cloud blocks edits to those
  specific athlete rows. Adoption import **upserts** athletes and usss_people
  (master rows survive across meets); the already-exists refusal applies to
  meet-keyed tables only. Venue-created athletes may duplicate master entries
  under new IDs; dedup applies at check-in as a post-step (documented
  limitation).
- **audit_log:** synced so the cloud archive is complete, but excluded from
  the checksum (the cloud legitimately holds pre-adoption audit rows for the
  same meet) and from the snapshot (the venue starts its own trail). At the
  venue, every audit row written while a meet is adopted belongs to that meet
  by construction (single adopted meet).
- **Not in the manifest:** `users`, `app_settings`, `jump_dd_table`
  (ships with the code), `usss_sync_status`, and all venue-local tables
  (`sync_outbox`, `venue_seats`). Meet logo files uploaded AT THE VENUE do not
  sync (rows only, no file transport) — documented limitation; the adoption
  package DOES carry the cloud-side logo down.
- Cloud-only adoption-state columns on `meets` (`adoption_status`,
  `adopted_at`, `sync_token_hash`, `last_sync_at`, `last_applied_seq`,
  `release_code*`, `remote_judging`) are **excluded from the manifest** —
  they are transport state, not meet data. The harness drift test enforces
  that every physical column on a fresh v2 database is either in the manifest
  or on the documented exclusion list.

## 7. Outbox (venue-local)

```sql
CREATE TABLE sync_outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,   -- venue-local table; the additive-
  meet_id TEXT NOT NULL,                   -- migration rule applies to shared tables
  tbl TEXT NOT NULL,
  pk TEXT NOT NULL,          -- JSON object of PK cols
  op TEXT NOT NULL,          -- 'upsert' | 'delete'
  row_json TEXT,             -- full post-image (manifest cols) for upserts
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- Capture rules (FR-5): every INSERT/UPDATE/DELETE on a sync table appends
  outbox rows. Non-PK deletes take a **pre-image SELECT** and emit one delete
  record per affected PK (including rows displaced by `INSERT OR REPLACE`
  under a UNIQUE constraint). Upserts take a **post-image SELECT** so the
  recorded row is the value that actually landed.
- Worker (R14): event-driven; each append wakes it; ≤ 500 ms batching window;
  exponential backoff only while the uplink is down, reset on first success.
- Rows are deleted from the outbox only after the cloud acknowledges
  `applied_through_seq >= seq`.

## 8. Regression-comparison normalization (FR-23)

"Identical to v1.30.03" API comparisons in the harness normalize volatile
values before deep-equality:

1. **UUIDs:** any string matching
   `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`
   is replaced by an alias `«uuid-N»`, N assigned in order of first appearance
   **within each corpus being compared** (alias mapping is per-corpus, so two
   runs with different fresh UUIDs compare equal when their reference
   structure is isomorphic).
2. **Short codes:** any string value under a key named `short_code` (or a
   6-char value in a known short-code position) → `«code-N»`, same
   first-appearance aliasing.
3. **Timestamps:** any string matching SQLite `datetime('now')` form
   `YYYY-MM-DD HH:MM:SS` or ISO-8601 → `«ts»` (not aliased — all collapse to
   one token).
4. **Volatile server fields** (uptime, startedAt, writes counters, backup
   listings) are deleted before comparison.
5. Key order is irrelevant (structural comparison); array order is
   significant (run orders, rankings are ordered data).

The same aliasing applies to both corpora independently; comparison is then
strict deep-equality.

## 9. Change control

Any PR that (a) adds/removes/renames a column on a manifest table, (b) adds a
new meet-scoped table, or (c) changes canonicalization must update
`server/sync/protocol.js` (manifest + version bump per §1) and this document
together. The harness drift test (`harness/tests/step0.test.js`) fails the
build when the manifest and the migrated schema disagree.
