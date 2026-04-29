# StickIt — Freestyle Scoring System

**v1.7.01** — Web-based replacement for Winfree, built for US Ski & Snowboard mogul, dual mogul, and aerials events.

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
- PDF results, CSV/Excel export
- SkiReg and USSS People File CSV import
- Auto-backup every 5 write operations

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

To run in the cloud for remote access, deploy to any Node.js host (Railway, Render, Fly.io).
Set environment variable `LIBSQL_URL` to a hosted Turso database URL and `LIBSQL_AUTH_TOKEN` for auth.

---

## Support / Development

This system was built as a modern replacement for the Winfree (HFTI) scoring program.
Questions: contact your system administrator.
