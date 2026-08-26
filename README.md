# StickIt — Freestyle Scoring System

**v2.0.00** — Web-based replacement for Winfree, built for US Ski & Snowboard mogul, dual mogul, and aerials events.

---

StickIt is licensed under the Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License. Commercial use requires explicit written permission from Rocky Mountain Freestyle. See the LICENSE file for full terms or visit https://creativecommons.org/licenses/by-nc-sa/4.0/

---

## Features

- Admin console for meet setup, athlete registration, event configuration
- Judge tablet interface (blind entry, one tablet per judge)
- Head judge tablet (oversight, approvals, per-judge component display)
- Live scoreboard (public URL for display screens)
- OBS/YoloBox lower-thirds overlay
- US Ski & Snowboard scoring: Turns 60%, Air 20%, Speed 20% (configurable per event)
- Jump code validation and DD lookup
- Dual mogul bracket management (up to 32 competitors)
- Aerials scoring path
- Manual score entry and score editing
- Voice manual score entry (Deepgram-powered wizard for chief-of-score)
- PDF results, CSV/Excel export
- SkiReg and USSS People File CSV import
- Per-meet Training Days with opt-out participant list and printable roster PDF
- Auto-backup every 5 minutes (when writes have occurred)
- Comprehensive in-app user guide at `/help` (61 topics across Officials, Judges, Admins, and Public surfaces)
- Local venue server (v2): a Raspberry Pi at the hill runs the whole meet through internet outages, with one-way sync back to the cloud

---

## Setup

### Requirements
- Node.js 18 or newer (https://nodejs.org)
- A laptop to run the server at the venue
- WiFi router so tablets can connect (no internet required)

### Install

```bash
cd server && npm install
cd ../client && npm install && npm run build
```

### Run at a venue

```bash
cd server
node index.js
```

The server starts on port 3001. Open `http://localhost:3001` in your browser for the admin console.

### Tablets (judges)

1. Connect all tablets to the same WiFi network as the laptop running the server.
2. Find the laptop's local IP address (e.g. `192.168.1.100`).
3. In the admin console, go to the event > Judges tab > copy the judge's tablet URL.
4. Open that URL on the judge's tablet:
   `http://192.168.1.100:3001/judge/EVENT_ID?judge=JUDGE_ID&pin=1234`

### Scoreboard

Open on any screen on the same network:
`http://192.168.1.100:3001/scoreboard/EVENT_ID`

### OBS/YoloBox Overlay

Use a browser source pointed at:
`http://192.168.1.100:3001/overlay/EVENT_ID`

---

## Workflow

### Before the event
1. **Create a meet** — name, location, date
2. **Add athletes** — name, bib, USSS member #, division, gender (or import via SkiReg/USSS CSV)
3. **Create events** — mogul, dual mogul, or aerials; gender, division, judge count, pace time
4. **Register athletes** in each event
5. **Add judges** — assign role (TL1, TL2, TL3, Air1, Air2) and optional PIN
6. **Send tablet URLs** to each judge
7. **(Optional) Training days** — open Training Days from the meet page to create one or more pre-comp roster lists and print attendance PDFs

### During the event (moguls)
1. Admin selects the next athlete and starts their run
2. Judges enter scores on their tablets and hit Submit
3. Once all judges have submitted and time is entered, total score is automatically calculated
4. Live scoreboard updates in real time
5. Head judge can review per-judge component breakdowns, reject individual scores, and finalize

### During the event (dual moguls)
1. Seed the bracket from mogul results (or enter seeds manually)
2. For each matchup: admin starts the run, judges score each skier
3. Admin records the winner — bracket advances automatically

### After the event
- Export PDF results from the event page
- Export CSV or Excel for records
- Use **Edit Score** or **Manual Entry** to correct any run as needed

---

## Scoring Reference (US Ski & Snowboard)

**Total = Turns + Air + Speed**

| Component | Default Weight | Judge Input | Notes |
|-----------|---------------|-------------|-------|
| Turns | 60% | 0.1 – 20.0 per T&L judge | Drop high/low with 3+ judges |
| Air | 20% | 0 – 10 per jump per air judge, × DD | Capped at 20 pts |
| Speed | 20% | Finish time vs pace time | Capped at 15 pts |

Weights are configurable per event.

**Turns:** Drop high and low if 3+ judges, average the rest.

**Air:** Average air judges per jump, multiply by DD from jump DD table, sum both jumps.

**Speed:** `pace_time / finish_time × pace_factor`, capped at 15 pts.

**Tie-breaking order:** Total score → Turns score → Air score → Speed score

---

## Jump Codes (US Ski & Snowboard)

| Code | Description | DD (Mogul) |
|------|-------------|------------|
| S | Straight | 1.26 |
| Sp | Spread Eagle | 1.50 |
| 3 | 180 | 1.75 |
| 5 | 360 | 2.25 |
| 7 | 540 | 2.75 |
| 9 | 720 | 3.25 |
| bL | Back Layout | 2.75 |
| bT | Back Tuck | 3.25 |
| bP | Back Pike | 3.25 |
| bF | Back Full | 3.00 |
| fL | Front Layout | 2.50 |
| fT | Front Tuck | 3.00 |
| fP | Front Pike | 3.00 |
| bX | Back Cross | 3.50 |

Add **G** to any invert for grab (e.g. `bTG`). Dual mogul DDs are ×1.25. Jump codes are case-sensitive.

---

## Cloud Deployment (optional)

To run in the cloud for remote access, deploy to any Node.js host. Production runs on
**Render** (primary, https://stickit-tga4.onrender.com) with a legacy **Railway** deployment
kept in sync — both auto-deploy from every push to `main` via their GitHub integrations.
Set environment variable `LIBSQL_URL` to a hosted Turso database URL and `LIBSQL_AUTH_TOKEN` for auth.

---

## Local Venue Server (v2)

For hills with unreliable internet, a Raspberry Pi on the venue LAN runs StickIt in **venue
mode** (`STICKIT_MODE=venue`). A meet is *adopted* from the cloud with a one-time release code:
the cloud copy locks read-only, tablets score against the Pi (`http://stickit.local:3001`), and
every change streams one-way back to the cloud whenever internet is available — an outage
changes nothing at the hill. At day's end the meet is verified (per-table checksums on both
sides) and either handed back overnight (two-day meets) or checked in permanently. Cloud mode
is byte-for-byte unchanged when the flag is absent.

- Operations guide: `docs/VENUE_OPS.md` · Sync design: `docs/SYNC_PROTOCOL.md`
- Pi image build: `server/scripts/build_pi_image/README.md` · Mac fallback: `docs/VENUE_MAC_FALLBACK.md`
- Printed volunteer run sheets: `server/public/docs/venue/`

---

## Viewer API Reference

Read-only public API for iOS and third-party clients. No authentication required. All endpoints return JSON and include permissive CORS headers (`Access-Control-Allow-Origin: *`).

Base URL: `http://<server-host>:3001/api/viewer`

---

### GET `/events`

Returns a list of all events. Pass `?status=in_progress` to filter to live events only.

**Query params:** `status` (optional) — any `events.status` value, e.g. `in_progress`, `complete`

**Example response:**
```json
[
  {
    "id": "uuid",
    "name": "Men's Moguls",
    "discipline": "mogul",
    "meet_name": "Rocky Mountain Championships",
    "venue": "Steamboat Springs, CO",
    "date": "2026-01-15",
    "status": "in_progress"
  }
]
```

**`discipline` values:** `mogul`, `dual_mogul`, `aerials`

---

### GET `/resolve/:shortCode`

Looks up an event by its short code (the same identifier used in `/scoreboard/:shortCode` URLs). Use this to resolve a shared scoreboard link to a full event ID.

**Example:** `GET /api/viewer/resolve/abc123`

**Response:** Event object (same shape as one item from `/events`) plus `short_code` field. Returns 404 if the short code is not found.

---

### GET `/events/:eventId/status`

Returns the live state of an event: who is on course, who is up next, and what round is active.

**Example response:**
```json
{
  "event_id": "uuid",
  "status": "in_progress",
  "current_round": "Final 1",
  "current_run_number": 2,
  "athlete_on_course": {
    "bib_number": 14,
    "first_name": "Jane",
    "last_name": "Smith"
  },
  "upcoming_athletes": [
    { "run_order": 5, "bib_number": 22, "first_name": "Alex", "last_name": "Jones" },
    { "run_order": 6, "bib_number": 7,  "first_name": "Ryan", "last_name": "Lee" }
  ]
}
```

- `athlete_on_course` is `null` when no run is active.
- `upcoming_athletes` lists the next 10 athletes in run order who have not yet competed in the current round.
- `current_round` / `current_run_number` are `null` for events in `setup` state.

---

### GET `/events/:eventId/results`

Returns scored results for the current active round. For dual mogul events, returns the full bracket instead.

**Mogul / aerials response:**
```json
{
  "discipline": "mogul",
  "results": [
    {
      "rank": 1,
      "registration_id": "uuid",
      "bib_number": 14,
      "first_name": "Jane",
      "last_name": "Smith",
      "turns_score": 38.40,
      "air_score": 14.22,
      "time_score": 18.11,
      "total_score": 70.73,
      "run_time": 23.45,
      "jump1_code": "bp",
      "jump1_dd": 0.78,
      "jump2_code": "7oG",
      "jump2_dd": 1.02,
      "run_status": null
    }
  ]
}
```

- `run_status` is `null` for a normal scored run; `"DNS"`, `"DNF"`, `"DSQ"`, or `"RNS"` otherwise.
- Results are ranked by `total_score` descending. DNS/DNF/DSQ athletes sort last.
- `run_time` (v1.28.00) is the actual finish time in **seconds** for the athlete's best run. `null` = No Time (NT) or an event with no timed component (e.g. Devo). `time_score` remains the derived speed score.
- `jump1_code` / `jump2_code` (v1.28.00) are the jumps as scored; `jump1_dd` / `jump2_dd` are the exact Degree of Difficulty applied. A DD of `0` means that jump was dropped by the repeat-jump rule. Second-jump fields are `null` for single-jump events.
- `registration_id` (v1.30.00) joins the row to the `runs[]` / `scores[]` arrays from `/results/scores` — use it instead of order-based matching.

**Dual mogul response:**
```json
{
  "discipline": "dual_mogul",
  "bracket": [
    {
      "id": "match-uuid",
      "bracket_round": 4,
      "bracket_position": 1,
      "match_status": "complete",
      "blue_bib": 1,  "blue_first": "Jane", "blue_last": "Smith", "blue_score": 22,
      "red_bib": 8,   "red_first": "Alex",  "red_last": "Jones",  "red_score": 19,
      "winner_registration_id": "uuid",
      "registration_id_blue": "uuid",
      "registration_id_red": "uuid",
      "winner_side": "blue",
      "nj_call": null,
      "is_bye": 0
    }
  ]
}
```

- `id` (v1.26.00) is the match's primary key — use it with the judge-points endpoint below.
- `bracket_round` is the power-of-2 round size (e.g. 16 = Round of 16, 2 = Final).
- `is_bye`: 1 when one side is a bye (no opponent).
- `nj_call` (v1.29.00): FS-18 landing zone (chop) No Jump call — `null`, `"blue"`, `"red"`, or `"both"`. Badge the flagged athlete(s).
- `blue_score` / `red_score` (v1.29.00) are **effective** totals with the NJ speed override and tie credits applied (a tied-time match totals 25: the speed row pays 3/3), matching the web scoreboard.
- `winner_side` (v1.30.00) is the authoritative winner — `"blue"`, `"red"`, or `null` while undecided — derived from the stored winner id. Use it instead of comparing scores, which is wrong for NJ-decided and tie-break matches. `registration_id_blue` / `registration_id_red` (v1.30.00) let you map bracket rows to placements by registration id.

---

### GET `/events/:eventId/placements`

Full-field final standings for a **dual mogul** event (v1.30.00), ranked per ICR 4312 — the same data behind the web scoreboard's PLACE tab, so clients never re-implement the placement rules. Non-dual events return `400 { "error": "Placements are only available for dual_mogul events" }`.

**Example response:**
```json
{
  "discipline": "dual_mogul",
  "placements": [
    {
      "rank": 1,
      "registration_id": "reg-uuid",
      "bib_number": 8,
      "gp": "F15",
      "first_name": "Jaelyn",
      "last_name": "Spraker",
      "club": "Winter Park",
      "run_status": null,
      "reg_status": null
    }
  ]
}
```

- `rank` may be `null` for unclassified entries (first-round DNS in seeded groups, DSQ) — intentional per ICR 4312.
- `bib_number` is a number or `null`.
- `gp` is the gender + age group (e.g. `F15`, `M17`).
- `run_status` carries the eliminating status (`"DNS"`, `"DNF"`, `"DSQ"`) when relevant; `reg_status` is the registration status.

---

### GET `/events/:eventId/dual-matches/:matchId/judge-points`

Per-judge blue/red point splits for one dual mogul match (v1.26.00) — the data behind a tap-to-expand match breakdown. The match must belong to the event; otherwise `404 { "error": "Match not found" }`.

**Example response** (v1.29.00 shape — a match where the Time Judge entered 4/1 but blue was called NJ past the chop):
```json
{
  "match_id": "match-uuid",
  "nj_call": "blue",
  "speed_tied": false,
  "air_tied": false,
  "overall_scale": 5,
  "judges": [
    { "judge_number": 1, "blue_points": 3, "red_points": 2, "time_tied": 0, "air_tied": 0 },
    { "judge_number": 2, "blue_points": 3, "red_points": 2, "time_tied": 0, "air_tied": 0 },
    { "judge_number": 3, "blue_points": 3, "red_points": 2, "time_tied": 0, "air_tied": 0 },
    { "judge_number": 4, "blue_points": 4, "red_points": 1, "time_tied": 0, "air_tied": 0 },
    { "judge_number": 5, "blue_points": 2, "red_points": 3, "time_tied": 0, "air_tied": 0 }
  ],
  "effective_judges": [
    { "judge_number": 1, "blue_points": 3, "red_points": 2, "time_tied": 0, "air_tied": 0, "overridden": 0 },
    { "judge_number": 2, "blue_points": 3, "red_points": 2, "time_tied": 0, "air_tied": 0, "overridden": 0 },
    { "judge_number": 3, "blue_points": 3, "red_points": 2, "time_tied": 0, "air_tied": 0, "overridden": 0 },
    { "judge_number": 4, "blue_points": 0, "red_points": 5, "time_tied": 0, "air_tied": 0, "overridden": 1 },
    { "judge_number": 5, "blue_points": 2, "red_points": 3, "time_tied": 0, "air_tied": 0, "overridden": 0 }
  ]
}
```

- `judges` are the raw entries as submitted (the Time Judge's real split is always recorded, even when overridden).
- `effective_judges` (v1.29.00) are the values that actually pay: the FS-18 NJ speed override (0/5, 5/0, or 3/3), the 3/3 tied-time credit, and the 0/0 air-tie. Display these — the app never has to recompute rules.
- `speed_tied` / `air_tied` are the match-level tie states; `overall_scale` is the Overall Judge's split (5, 4, or 3).

---

### GET `/events/:eventId/results/scores`

Returns per-judge, per-score-type raw scores for all completed runs in the current active round. Use this to build an expanded score detail view.

**Example response:**
```json
{
  "run_number": 2,
  "scores": [
    {
      "run_id": "uuid",
      "judge_number": 1,
      "judge_name": "Judge 1",
      "role": "TL1",
      "score_type": "turns",
      "raw_score": 5.5
    },
    {
      "run_id": "uuid",
      "judge_number": 1,
      "judge_name": "Judge 4",
      "role": "AirJudge1",
      "score_type": "air_jump1",
      "raw_score": 3.4
    }
  ],
  "runs": [
    {
      "run_id": "uuid",
      "registration_id": "uuid",
      "run_time": 23.45,
      "jump1_code": "bp",
      "jump1_dd": 0.78,
      "jump2_code": "7oG",
      "jump2_dd": 1.02
    }
  ]
}
```

Group the `scores` array by `run_id` to display a per-athlete breakdown. Each row is one judge's raw entry: `score_type` `"turns"` is one T&L judge's net turns score (role `TL1`/`TL2`/`TL3`); `air_jump1` / `air_jump2` are one air judge's score for that jump. Aerials v2 events use `ae_air_j1`, `ae_form_j1`, `ae_land_j1`, `ae_air_j2`, `ae_form_j2`, `ae_land_j2`.

The `runs` array (v1.28.00) gives per-run context keyed by `run_id` (also carries `registration_id`): the actual finish time (`run_time`, seconds; `null` = NT) and the jump codes + exact DDs applied. Join it to the grouped `scores` so an air judge's raw score can be shown next to its jump code and DD.

---

### GET `/events/:eventId/rounds`

Returns the list of rounds (phases) for an event with their status.

**Example response:**
```json
[
  { "id": "uuid", "round_name": "Qualifier 1", "run_number": 1, "status": "complete" },
  { "id": "uuid", "round_name": "Final 1",     "run_number": 2, "status": "in_progress" }
]
```

**`status` values:** `not_started`, `in_progress`, `complete`

---

### Error responses

All endpoints return `404` with `{ "error": "Event not found" }` for an unknown ID or short code, and `500` with `{ "error": "<message>" }` on a database failure. `/placements` returns `400` for non-dual-mogul events.

---

## Support / Development

This system was built as a modern replacement for the Winfree (HFTI) scoring program.
Questions: contact your system administrator.
