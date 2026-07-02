## Glossary

A quick reference for the acronyms and terms that show up throughout StickIt.

### Organizations & rule books

**USSS** — US Ski & Snowboard. The national governing body for freestyle skiing in the US. Sanctions Comp Series, RQS-EQS, Divisional Championships, and Devo events.

**FIS** — Fédération Internationale de Ski. The international governing body. Sanctions FIS-rated events including World Cup, Continental Cup, NorAm, and FIS-other.

**ICR** — International Competition Rules. The FIS rule book for freestyle skiing. Section 4207 covers tie-breaks; 4205 covers run order; 4206 covers speed; 4210 covers air.

**JH** — Judging Handbook. The FIS-published companion to ICR with detailed judging procedures. JH 6003 covers aerials reduction; JH 6004 covers per-judge-per-jump scoring; JH 6203 covers mogul turns drop-high/drop-low.

**RMF** — Rocky Mountain Freestyle. The Rocky Mountain Division of USSS.

### Disciplines

**Mogul** — Single athlete down a moguled course, scoring Turns + Air + Speed. The default discipline.

**Dual Mogul** — Head-to-head bracket format. Two athletes ski parallel courses simultaneously; 5-point split scoring.

**Aerials** — Single athlete launching off a kicker. Score Air + Form + Landing per jump.

### Judge roles

**T&L** — Turns & Line. The judges scoring the moguls run for skiing technique. Common roles: TL1, TL2, TL3.

**Air** — Air judges. Score the jumps in a mogul run.

**HJ** — Head Judge. Reviews and approves submissions, finalizes.

**Timekeeper** — Records run time. Mogul / aerials only (dual mogul has its own DualTime judge).

**AeJudge** — Aerials Judge (v2 model). Numbered AeJudge1 through AeJudge<N>.

### Score components

**DD** — Degree of Difficulty. A multiplier applied to air judges' raw scores per jump.

**Turns** — Turns & Line score component (max 60 for mogul).

**Air** — Air score component (max 20 post-DD for mogul; per-jump for aerials).

**Air-no-DD** — Pre-DD raw air execution. Used in tie-break only.

**Speed** — Speed score component (max 20 for mogul).

**Form** — Form score (aerials, 0–5 per judge per jump).

**Landing** — Landing score (aerials, 0–3 per judge per jump).

**Time Points** — Speed score, alternate name used in some UI surfaces.

### Status codes

**DNS** — Did Not Start.

**DNF** — Did Not Finish.

**DSQ** — Disqualified.

**RNS** — Refused to be Scored. Legacy status retired in v1.26.00; historical values still display and transmit to USSS as DNF.

**NT** — No Time. Mogul / aerials only. Speed score = 0.

**SCR** — Scratched. Registration status, not run status.

**Basic / advanced grab** — since v1.26.00, lowercase `g` is a basic grab (DD modifier +0.05) and uppercase `G` an advanced grab (+0.12). `bg` and `bG` are different jumps. See [Jump codes & DDs](./ref-jump-dds).

### Phases

**Run 1 / Run 2** — Best of 2 mogul format.

**Q1 / Q2 / F1 / F2** — Qualifier 1 / 2, Final 1 / 2. Used for qualifier/finals events.

**CC** — Counting Competitors. Used in FFSP formula. Total placements minus DNS / DSQ / scratched.

### Categories / divisions

**Comp Series** — Standard USSS competition tier.

**Devo** — Developmental events for younger athletes. 1 jump, no time, simpler scoring.

**RQS-EQS** — Regional / Eastern Qualifying Series. Uses non-component T&L scoring.

**Divisional** — A divisional-championship-level event (`events.is_divisional=1`); top FFSP tier.

### Aerials tiers

**FIS OWG / WSC / WC** — FIS Olympic Winter Games / World Ski Championships / World Cup.

**FIS NAC/NorAm** — FIS Continental Cup / North American Cup.

**FIS Other** — Other FIS-sanctioned events. Locked at 5-judge panel.

**USA National** — USSS National-level event.

**USA Regional** — USSS Regional-level event. HJ may score (counts as a panel judge).

### Scoring concepts

**FFSP** — Freestyle Skiing Points. USSS point system. StickIt computes for dual mogul only.

**Floor to 2dp** — Truncate to 2 decimal places per FIS rule. e.g., `floorToHundredth(7.4567) = 7.45`.

**Olympic-style skip rank** — When N athletes share a rank, the next rank skips by N. Tied 3rd → next is 5th, not 4th.

**Pace time** — `course_length / pace_speed`, floored to 2dp. Used in the speed score formula.

**Pace standard** — `USSS` (default) or `FIS`. Determines the pace speeds.

### Technical

**Short code** — A short random string used in public URLs (e.g., `/scoreboard/abc12`). Each event and each judge has its own short code.

**Tablet URL** — The unique URL a judge opens on their tablet (e.g., `/judge/<event-short>/<judge-short>`).

**WebSocket** — Server-pushed updates over `/ws`. Scoreboards, tablets, and overlays all subscribe.

**Polling fallback** — A periodic GET request used as a fallback when WebSocket is dropped.

**HC mode** — High-contrast mode on tablets. Black/white/amber palette for outdoor visibility.

**Sun Mode** — High-contrast mode for public surfaces (Home, Live Scores, Scoreboard). Like HC mode but for spectators.
