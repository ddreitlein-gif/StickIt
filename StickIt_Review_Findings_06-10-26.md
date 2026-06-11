# StickIt Comprehensive Scoring Review.  Findings Report

**Date:** 06-10-26
**Code reviewed:** StickIt v1.23.01, repository `Desktop/StickIt` (main branch, commit 054a39d).
The `stickit-railway-deploy` copy named in the review prompt was last committed in April at v1.5;
this repository is the live codebase, so the review ran here.
**Companion documents:** `review/StickIt_Scoring_Specification_06-10-26.md` (the Phase 1 rule
specification with David's seven rulings), plus the validation scripts under `review/`.

---

## 1.  Executive Summary

The verification recomputed every run of the 2026 season from the Winfree `.fre` source data,
three ways:  independently from the rule books, through StickIt's actual scoring engine, and
through a reconstruction of Winfree's own conventions.  The results were compared against the
official FIS XML exports (Vail Comp MO and DM, Aspen RQS, Aspen Devo) and the text-readable
official result PDFs (Steamboat MO, Copper Saturday and Sunday MO, RMF Invitational).

**The headline result is good:**  StickIt's scoring model is structurally correct across all four
formats.  Turns summation and the 1.5x two-judge scaling, air DD application, the speed formula
and pace times, best-of-two selection, the FIS tie-break order, dual moguls vote scoring, bracket
seeding bands, bye distribution, and the USSS 4312 eliminated-athlete ranking all reproduce the
official 2026 results.  Where official machine-readable output exists, my rule-derived values and
the Winfree reconstruction matched the published score of every athlete to the cent (228 of 228
athlete results across six event-gender fields, after accounting for the items below).

**One pervasive bug was found and confirmed:**  StickIt's two-decimal truncation helper
(`floorToHundredth`) is subject to binary floating point error and truncates one cent low on
roughly 45 percent of all runs.  Against the official Vail XML, StickIt's engine output was 0.01
to 0.02 low for about half the field at every event in the season.  This is a one-line fix.

**One structural gap was found in dual moguls:**  with the `runoff_to_8th` option, StickIt builds
only two consolation matches for places 5 through 8, while the governing format (and every 2026
dual event scored with a runoff to 8th) uses a 5-8 bracket of two semifinals followed by 5/6 and
7/8 finals.  StickIt's current shape decides 5th versus 7th place by an arbitrary pairing.

Three previously open rule questions were ruled on during the review (per-jump air cap, air
averaging order, RQS repeat rule) and are written up as patch suggestions.  None of the three had
any effect on 2026 season data (zero exposures found in the full-season scan).

No code was modified.  All proposed fixes appear in Section 5 as patch suggestions.

---

## 2.  Methods Note

**Reference documents used** (in `Claude Uploads/Reference/`):  USSS 2026 Freestyle-Freeski
Competition Guide (authoritative);  Mogul Degree of Difficulty Chart, Nov 2023 (authoritative
for air values);  FIS ICR Freestyle, Spring 2025 (4206 to 4208 and duals sections);  FIS
Freestyle Judging Handbook, Oct 2025 (6203, 6204, 6304, 6305);  RMF Competition Guide 2025-2026
(DEVO and RQS formats);  Dual Moguls Judge Protocol Sheet;  GSS Manual (operational reference).

**Data used:**  all 18 Winfree `.fre` input files for the 2026 season;  the FIS XML transmit
packages (SFU0585-0588 Vail, SFN0378-0381 Aspen RQS and Devo);  the 16 readable official result
PDFs.  Season CSVs were held in reserve;  the `.fre` files contain the complete judge-level
inputs and were the primary source.

**Tooling written for this review** (all new, in `review/`, no application code touched):

| File | Purpose |
|---|---|
| `review/lib/parseFre.js` | Winfree `.fre` parser (entrants, mogul runs with per-judge air detail, component expressions, dual vote lines, ladder trails, seeds) |
| `review/lib/spec.js` | Independent implementation of the rules from the Phase 1 specification, written without reference to StickIt code |
| `review/lib/parsePdfResults.js` | Parser for Winfree "By Score" result sheets (pdftotext output) |
| `review/verify_mogul.js` | Recomputes every mogul run three ways and compares to official XML / PDFs;  includes pace calibration |
| `review/verify_duals.js` | Validates dual vote complements, winner advancement, and derives final standings per USSS 4312 for comparison to official ranks |

**Run them with**, for example:

```
node review/verify_mogul.js "<path>/Vail Comp 2026.fre" \
  --xml F=<path>/SFU0586_F_MO.xml --xml M=<path>/SFU0585_M_MO.xml
node review/verify_duals.js "<path>/Vail Comp 2026.fre" \
  --xml F=<path>/SFU0588_F_DM.xml --xml M=<path>/SFU0587_M_DM.xml --standings
```

---

## 3.  Per-Format Compliance Results

### 3.1  Single Moguls, Comp Series (60/20/20, 3 turn judges, 2 air judges, 2 jumps)

Worked example, SALTHOUSE bib 94, Vail run 1 (female, course 220 m):

- Turns:  15.80 + 13.80 + 12.00 = **41.60**  (sum of 3 judges, JH 6203.2.1)
- Air:  judge totals from the .fre are floor(score x DD) per jump, summed per judge:
  J1 = floor(6.3 x .78) + floor(5.6 x .81) = 4.91 + 4.53 = 9.44;
  J2 = 4.91 + floor(5.8 x .81) = 4.91 + 4.69 = 9.60;  average = **9.52**
- Pace:  220 / 8.20 = 26.829 -> truncated **26.82**  (USSS 4207.2, 4008)
- Speed:  48 - 32 x (29.69 / 26.82) = 48 - 35.42 = **12.57**  (ICR 4206.3)
- Total:  41.60 + 9.52 + 12.57 = **63.69** = published value.

Cross-check results (official value vs Winfree-convention reconstruction):

| Event | Field | Exact to the cent | Notes |
|---|---|---|---|
| Vail Comp MO (XML) | F 36, M 49 | 84 / 85 | the 1 remaining athlete had every run statused (DNS), published with 0 points |
| Steamboat MO (PDF) | F 40, M 54 | 94 / 94 | component-expression entry format;  validates carving + A&E + upper body - deduction |
| Copper Saturday MO (PDF) | F 33, M 45 | 76 / 76 comparable | 2 athletes appear in PDF but not in the .fre (data variance);  2 apparent misses were PDF text-extraction artifacts, hand-checked exact |
| Copper Sunday MO (PDF) | F 25, M 43 | 66 / 66 comparable | same two caveats |
| RMF Invitational (PDF) | run sheets | spot-checked exact | per-run sheets;  KEENAN qualifier 78.14 reproduced to the cent |

Aspen Comp, Winter Park Comp, SW Open, and Telluride MO have no readable official output in the
folder (see Section 7);  their `.fre` data was still run through both pipelines and shows only the
truncation-bug differences described in finding F-1.

### 3.2  RQS (60/20/20, 2 turn judges x1.5, 1 air judge, 2 jumps)

Worked example, SCAHILL bib 27, Aspen run 2 (female):

- Turns:  (14.30 + 13.30) x 1.5 = **41.40**  (2-judge panel scaled to the 60-point standard;
  ruling A)
- Air:  floor(7.6 x .78) + floor(8.4 x .59) = 5.92 + 4.95 = **10.87**  (single air judge)
- Speed:  48 - 32 x (23.37 / 19.76) = **10.15**
- Total:  41.40 + 10.87 + 10.15 = **62.42** = official XML value, rank 1.

Aspen RQS vs official XML:  **F 29/29 and M field exact to the cent.**

Important data finding:  RQS and Devo events do NOT derive pace time from course length.  The
operators set pace times manually (Aspen RQS used F 19.76 / M 18.01 against a 142.5 m course
that would imply 17.37 / 14.69).  The verification harness solves the published pace from the
data;  for StickIt operation this is supported by the existing manual pace-time override and
just needs to be operator knowledge.  Comp events used exactly course length / USSS speeds,
truncated (Steamboat printed pace 24.94 / 29.51 = floor(242/9.70) / floor(242/8.20)).

### 3.3  Devo (turns + air only, 2 turn judges x1.5, 1 air judge, 1 jump doubled)

Worked example, BLOOM (2025 Steamboat sheet that shipped in the folder, see Section 7):

- Turns:  (14.5 + 14.0) x 1.5 = **42.75**
- Air:  floor(6.8 x .48) = 3.26, doubled = **6.52**  (ruling B confirmed by the published sheet)
- Total:  42.75 + 6.52 = **49.27** = published value.

Aspen Devo vs official XML:  **F 42/42 and M 33/33 exact to the cent.**  This confirms both
rulings A and B empirically:  Winfree scales 2-judge turns by 1.5 and doubles the single jump.

### 3.4  Dual Moguls (Classic 5-judge, 25-vote split)

All eight 2026 dual events (16 brackets, 626 contested matches) were decoded and checked:

- **Vote integrity:**  every opposing pair of judge lines sums to 5 votes per judge (or 0/0 for
  DNF / walkover rounds).  Zero violations in 626 matches.
- **Winner advancement:**  the majority-vote winner took the next-round ladder slot in every
  single match.  Zero violations.
- **Seeding:**  Winfree places seeds 1-8 in fixed template pairs (1, 32, 17, 16, 9, 24, 25, 8 on
  a 64 ladder), draws seeds 9-16 randomly within their eight pair-slots, and 17-32 within
  theirs, exactly per USSS 4310.1.2.  StickIt's `standardSeedOrder` template is slot-numbered
  differently but produces the identical competitive structure (QFs 1v8 4v5 3v6 2v7, SFs 1v4
  2v3, final 1v2), and its band randomization matches the rule.
- **Byes:**  observed byes go to the top seeds top-down (Telluride F:  28 athletes in 32, byes
  to seeds 1-4;  Vail F:  35 in 64, byes to bands 1 and 2 plus 13 of band 3).  StickIt's
  `buildPlacement` reproduces this exactly (verified for 28/32, 35/64, 49/64).
- **Final standings:**  my USSS 4312 derivation (places from the four placement duals, then per
  round:  scored by votes descending then seed, DNF by seed, DNS by seed, first-round DNS and
  walkover no-shows unclassified) reproduces the official Vail XML placements
  **77 of 77 exactly** (F 32/32, M 45/45).
- **StickIt's `placement_ranking.js`** implements the same hierarchy and is rule-faithful,
  with the runoff-to-8th structural exception in finding F-2.

Worked example, Vail F final:  SALTHOUSE votes 2+2+3+4+2 = 13, SOARD 3+3+2+1+3 = 12, total 25,
SALTHOUSE wins the championship 13-12;  PEAKE (semifinal DNF) wins the 3/4 dual 17-8 over
THRUSH.  Official:  1 SALTHOUSE, 2 SOARD, 3 PEAKE, 4 THRUSH.  Reproduced.

---

## 4.  Season-Wide Scans

- **Per-jump DD cap exposure (ruling C):**  zero 2026 runs had a jump where score x DD exceeded
  10.0.  The missing cap is latent, not active.
- **Repeated jump codes (rulings on repeats):**  zero 2026 runs carried two repeat-equivalent
  codes.  The repeat-rule divergence (F-5) is latent, not active.
- **Jump codes used in 2026 but missing from StickIt's DD table:**  STS (18 uses), DD (15),
  TTT (8), ST (1).  Winfree scored them per the base + modifier formula (STS 0.59/0.69,
  DD 0.55/0.65, TTT 0.59, ST 0.49).  Also, the stand-alone grab jump G (2 uses, plus 6 as
  lowercase g and 34 as 3g / lg) was scored by Winfree at 0.54/0.64 (Single 0.40 + grab 0.14);
  StickIt's table stores G as the bare 0.14 multiplier row, and its DD lookup is case
  sensitive, so g / 3g / lg would not resolve.  See F-6.

---

## 5.  Findings.  Severity-Ranked, With Proposed Fixes

Proposed fixes are patch suggestions only;  nothing has been applied.

### F-1.  HIGH.  Floating point error in two-decimal truncation

- **File:**  `server/scoring/engine.js:865-867` (`floorToHundredth`), used by every truncation
  site in the engine.
- **Root cause:**  `Math.floor(n * 100) / 100` truncates one cent low whenever the binary float
  representation of `n * 100` lands fractionally below the true value.  Example from Vail:
  `49.1 + 8.23 + 8.93 = 66.25999999999999`, floored to 66.25;  the official published total is
  66.26.  Sums of one-decimal judge scores hit this constantly:  across the 2026 season the
  engine's totals differed from the official results on roughly 45 percent of runs (0.01 to
  0.02 low), with corresponding risk of rank flips between athletes 0.01 apart.
- **Rule violated:**  USSS 4008 (truncate the true decimal value, not its float artifact).
- **Proposed fix:**

```js
function floorToHundredth(n) {
  return Math.floor(n * 100 + 1e-9) / 100;
}
```

  The epsilon is far below the 0.01 resolution of any judge input and removes the artifact for
  all score magnitudes used here.  `roundToHundredth` does not need the guard (round is not
  directionally biased), but adding `+ 1e-9` there too is harmless.

### F-2.  HIGH (duals format).  `runoff_to_8th` lacks the 5-8 bracket

- **Files:**  `server/routes/dual.js:386-397` (`buildBracketShell`), `dual.js:216-226`
  (`advanceWinner`), `server/dual/placement_ranking.js:161-175` (consolation place assignment).
- **What happens now:**  with runoff to 8th, the shell creates exactly two consolation matches
  (round 2, positions 3 and 4).  Quarterfinal losers from QF 1/2 go to one match and QF 3/4
  losers to the other;  the first match's winner and loser are placed 5th and 6th, the second
  match's 7th and 8th.
- **What the rule and 2026 practice require:**  USSS 4310.3.2 USA (dual off for ranks 5-8).
  Every 2026 event that ran a runoff to 8th used a 5-8 bracket:  two consolation semifinals,
  whose winners dual for 5/6 and whose losers dual for 7/8 (visible in the Vail ladder trails,
  e.g. KIRSCHNER QF loss -> 5-8 semi -> 7/8 dual -> 8th).
- **Effect:**  under StickIt, an athlete who would win through to 5th can be eliminated into
  the 7/8 pair by the luck of which quarterfinal they lost;  and ranking the QF1/2-loser match
  above the QF3/4-loser match is arbitrary.
- **Proposed fix (design sketch, needs UI/PDF work):**  shell adds two `is_small_final` rounds:
  round 2 positions 3/4 = consolation semis (QF losers seeded as now), round 1 positions 3/4 =
  the 5/6 and 7/8 finals.  `advanceWinner` gains a small-final branch:  round-2 consolation
  winners -> round 1 position 3, losers -> round 1 position 4.  `placement_ranking` assigns
  places only from round-1 consolation matches (positions 2, 3, 4 -> places 3/4, 5/6, 7/8) and
  ignores consolation semis for placement.  `runoff_to_4th` is unaffected and correct today.

### F-3.  MEDIUM (ruling C).  Missing per-jump with-DD cap of 10.0

- **File:**  `server/scoring/engine.js:85-89` (`calcJumpScore`), `calcMogulScore` air section.
- **Rule:**  JH 6204.3.2:  "Maximum raw point allotment: 10.0 for form, with DD max. 10.0 /
  jump."  StickIt caps the air total at 20.0 but not the single jump;  with DDs above 1.0
  (7oG, 10G, 10oG, 14op, 14oG) a high-scored jump can exceed 10.0.
- **Exposure:**  none in 2026 data (scan in Section 4).  Latent correctness issue.
- **Proposed fix:**  cap inside the jump computation (see combined patch under F-4).

### F-4.  MEDIUM (ruling D).  Air averaging order differs from the handbook

- **File:**  `server/scoring/engine.js:85-89` (`calcJumpScore`).
- **Rule:**  JH 6203.2.2 / 6204.3:  average the air judges' raw scores per jump, truncate to two
  decimals, multiply by DD.  StickIt (since v1.16.09, deliberately matching Winfree) floors each
  judge's score x DD individually and then averages.  The two orders differ by up to 0.01 per
  jump.  David ruled the handbook order governs going forward.
- **Note:**  this will make StickIt differ from Winfree-era historical totals by one cent on
  some runs (e.g. Vail SOARD:  handbook order 66.27, Winfree/published 66.26).  That is the
  accepted consequence of the ruling.
- **Proposed combined patch for F-3 + F-4:**

```js
function calcJumpScore(airJudgeScores, dd) {
  if (!airJudgeScores || airJudgeScores.length === 0 || !dd) return 0;
  const avg = floorToHundredth(
    airJudgeScores.reduce((a, b) => a + b, 0) / airJudgeScores.length
  );
  if (avg < 0.1) return 0;             // JH 6204.3.2: no DD without 0.1 form points
  return Math.min(floorToHundredth(avg * dd), 10.0);  // JH 6204.3.2 per-jump cap
}
```

  `calcMogulScore` then sums the two (already truncated, already capped) jump scores and keeps
  the existing 20.0 total cap and the USSS 4210.2.2 single-jump 10.0 cap.

### F-5.  MEDIUM (ruling E).  RQS repeat rule keeps the higher-DD jump, not the higher-scored jump

- **File:**  `server/scoring/engine.js:386-394` (`applyRepeatJumpRule`), callers in
  `server/routes/runs.js` (manual entry, finalize, edit paths).
- **Rule:**  RMF RQS:  "The judges will use the score of the higher scored jump."  StickIt
  zeroes the lower-DD jump;  when the lower-DD jump earned the higher judge score, the wrong
  jump is kept.
- **Exposure:**  none in 2026 data (no repeat-coded pairs all season).  Latent.
- **Proposed fix:**  decide the repeat AFTER computing both jump scores.  Change the rule
  application to compare computed `jump1Score` / `jump2Score` (post-DD, per F-4) instead of raw
  DDs:  for `division === 'rqs'` zero the lower-SCORING jump (ties keep jump 1);  all other
  divisions keep jump 1 (USSS 4210.2.1, first jump counts).  This moves the logic from the
  pre-computation DD adjustment into `calcMogulScore` (or passes the two computed scores into
  `applyRepeatJumpRule`).  The callers' duplicate-detection flow is unchanged.

### F-6.  LOW.  DD table gaps and stand-alone grab value

- **File:**  `server/db/schema.js:475-542` (mogul DD seed), `server/routes/runs.js:344-357`
  (`resolveJumpDD`).
- **Issues:**  (a) upright combination codes used in 2026 are missing:  STS, DD, TTT, ST
  (42 uses across the season;  values per the chart formula:  0.59/0.69, 0.55/0.65, 0.59/0.69,
  0.49/0.59).  (b) The stand-alone grab jump G, recognized by USSS 4210.2.1 and used in 2026,
  resolves to the 0.14 multiplier row instead of a jump value;  Winfree scored it 0.54/0.64
  (Single 0.40/0.50 + 0.14).  The bare `p` row 0.03 has the same shape.  (c) DD lookup is case
  sensitive (SQLite BINARY collation);  the season data contains g, 3g, lg entered in lower
  case, which would not resolve in StickIt.
- **Proposed fix:**  seed the four missing combination codes;  re-value `G` to 0.54/0.64 (and
  either remove the bare `p` row or exclude multiplier rows from athlete-facing pickers);  make
  `resolveJumpDD` case-insensitive (`WHERE jump_code = ? COLLATE NOCASE`, with a tie-break
  preference for exact case so bp / bP stay distinct -- those two differ only by case and BOTH
  are real codes, so the NOCASE fallback must apply only when the exact-case lookup misses).

### F-7.  LOW.  7-judge format drops high/low of the combined score, not separately

- **File:**  `server/scoring/engine.js:60-74` (`calcTurnsSumScore`).
- **Rule:**  JH 6203.1.1 (7-judge format):  drop the high and low TURNS scores and the high and
  low DEDUCTIONS scores separately, then sum.  StickIt stores one net score per judge and drops
  the high/low of the net.  These differ when the discarded judges' deductions are not also the
  extreme deductions.
- **Exposure:**  none.  Domestic divisional events use 5 judges or fewer (USSS 4207.1.1);
  StickIt's event setup supports at most 5 turn judges.  Flagged for completeness;  fixing would
  require storing turns and deductions separately per judge through the 5-TL pipeline.

### F-8.  LOW.  Dead code:  `distributeByes` contradicts the live bye behavior

- **File:**  `server/dual/placement.js:311-347`.
- **Issue:**  `distributeByes` implements a "band 1 absorbs byes only in whole batches of 8"
  rule, under which 4 byes in a 32 bracket would skip the top seeds and land in band 2.  The
  function is exported but unused by the runtime;  the live path (`buildPlacement`) derives byes
  from ghost slot partners and matches observed 2026 practice exactly (byes to seeds 1-4 at
  Telluride F).  Risk is future misuse.
- **Proposed fix:**  delete `distributeByes` (and its verify_v16 checks), or rewrite it to
  delegate to the ghost-partner derivation.

### F-9.  INFO.  Mogul-event seeding source ignores the statused-athlete rank rule

- **File:**  `server/routes/dual.js:78-97` (`computeOfficialPlacings`).
- **Rule:**  USSS 4310.1.1.3:  when seeding duals from mogul results, DNF athletes receive a
  rank equal to the number of competitors in the draw;  DNS / DSQ / unranked receive one worse.
  StickIt excludes statused runs entirely, so DNF and DNS athletes are indistinguishable at the
  bottom of the seed list.  Practical impact is ordering within the tail of the seed list only.

### F-10.  INFO.  Mogul (non-dual) FFSP is not computed

- StickIt computes FFSP for dual moguls only (`server/dual/ffsp.js`, verified against the USSS
  PPR formula including first-round-DNF zero and the CC definition).  Single moguls FFSP
  (proportional:  score / 3rd-place score x 3rd-place points;  DNF = 50 percent of the last
  scored FFSP) is not implemented anywhere.  Feature gap, not a scoring error;  noting because
  the FFSP chapter is in scope of the rule extraction.

### F-11.  INFO.  Export formats

- `server/routes/transmit.js`:  XML declares UTF-8, emits CRLF line endings, and escapes all
  text fields.  Status'd athletes are emitted in `FS_notclassified` per v1.22.00.  Correct.
- One divergence to be aware of:  Winfree's 2026 XML RANKED athletes whose every run was
  statused (Vail M bib 167, all-DNS, published rank 49 with 0.00 points), where StickIt
  transmits them as `FS_notranked`.  StickIt's behavior is the more rule-faithful reading;
  flagged in Section 6 as a Winfree divergence, not a StickIt bug.
- CSV/XLSX exports (`server/routes/export.js`):  plain UTF-8 without a BOM.  Excel on Windows
  may garble accented names.  Cosmetic;  adding `﻿` to the CSV response would resolve it.

### F-12.  INFO.  Walkovers depend on operator status entry

- `placement_ranking.js` classifies a loser with no `loser_status` as "scored," even at zero
  points.  The 2026 official results treat never-scored walkover athletes (no-shows) as
  unclassified.  StickIt produces the same outcome only if the operator marks the no-show DNS.
  This matches the documented operating procedure (ruling G);  noted so the procedure is
  understood to be load-bearing.

---

## 6.  Items Requiring Your Judgment

1. **Winfree ranked all-statused athletes** (e.g. all-DNS bib 167 at Vail, rank 49, 0.00
   points) where StickIt excludes them from ranked results and transmits `FS_notranked`.
   I read FIS/USSS as supporting StickIt;  if USSS expects the Winfree presentation on
   transmitted XML, a toggle would be needed.
2. **Adopting ruling D changes historical comparability.**  After the F-4 patch, a re-scored
   2026 event would differ from the published PDFs by one cent on the affected runs.  If you
   ever re-import Winfree-era events for comparison, expect those deltas.
3. **RQS/Devo pace times are operator-entered.**  Nothing in the data derives them from course
   length.  StickIt's pace override supports this;  consider documenting it in the user guide
   so operators do not assume the course-length calculation applies at RQS/Devo events.
4. **The 800-tier FFSP threshold** ("competitor count per gender of less than 15") is
   implemented as Counting Competitors (CC, excludes DNS/DSQ) under 15.  The guide wording
   could also be read as entered competitors.  Worth a one-line confirmation with USSS.

---

## 7.  Known Problem Areas.  Status of Each

Per your note, this list is dated and several items were fixed in earlier builds.  Status of
each in v1.23.01, with the governing rule:

| # | Item | Status in v1.23.01 |
|---|---|---|
| 1 | Score component weighting | **Correct.**  60/20/20 (USSS 4206) verified to the cent against official results;  duals 50/25/25 vote model (JH 6304.3.1) verified across 626 matches |
| 2 | Time to points | **Correct** (ICR 4206.3, USSS 4207.2).  Formula, per-gender pace, USSS/FIS standard toggle, truncation all verified;  no course length -> speed contributes 0 and pace override works.  See judgment item 3 on RQS/Devo manual paces |
| 3 | Air score calculation | **Correct in structure;  two ruled changes pending** (F-3 per-jump cap, F-4 averaging order).  Air values flow from tablets and never default to zero;  finalize blocks until air scores and codes are present |
| 4 | Degree of difficulty | **Chart matches the Nov 2023 DD chart exactly**, both genders, all 55 seeded codes.  Gaps:  4 upright combos, stand-alone G value, lower-case lookups (F-6) |
| 5 | Judge panel and high/low drop | **Correct for all domestic formats** (3 TL sum;  5 TL drop high/low;  reduced panels per USSS 4207.1.1 with the ruled 1.5x scaling).  7-judge separate-drop nuance flagged as F-7, not reachable in the UI |
| 6 | Component (turns) score validation | **Correct.**  Server rejects turns outside 0.1-20.0 and air outside 0-10 (`runs.js:1015-1020`);  tablet UI constrains components to their scales;  manual-entry route relies on the same engine and the modal's validation |
| 7 | Deduction sign | **Correct.**  Deductions are entered positive and subtracted (turns = carving + A&E + upper body - deduction, clamped to 0.1 floor);  verified against Steamboat's published component expressions, e.g. (8.5+4.6+4.2)-1.2 = 16.1 |
| 8 | Gender / event gender assignment | **Correct.**  Events are gendered;  registrations, DD lookups, pace times, results, and transmit are all per-gender;  verified empirically by the per-gender result reconciliation |
| 9 | Tablet score data integrity | **Correct.**  Air and time scores cross over and persist (v1.16.08 / v1.19.01 fixes confirmed in code);  finalization assembles from `judge_scores` rows, not defaults |
| 10 | Head judge finalization | **Correct.**  HJ approval finalizes runs;  best-of-2 final review and dual bracket Approve and Finalize flows exist and mark events complete (v1.16.13 / v1.16.17, confirmed in code) |

---

## 8.  Data and Manifest Issues Found

1. **33 of the 49 PDFs in `Official Results/` are zero-byte Google Drive placeholder stubs**
   that never downloaded.  This includes every file the manifest lists as the canonical Drive
   set:  both Telluride results, both Championship results, Vail RQS/Devo, all Winter Park
   results, Steamboat RQS, Aspen Comp MO/DM, and the Copper Sunday duals.  The 16 real files
   (the "earlier local copies") carried this review.  **Telluride and the RQS/Devo
   Championships therefore could not be checked against published output**;  their `.fre` data
   passed all internal consistency checks and the validated pipeline, and
   `review/verify_duals.js --standings` already produces their derived standings, so the
   comparison takes minutes once real PDFs are in place.
2. **`Steamboar Devo results.pdf` is the January 2025 event** (codex N0243/N0244), not 2026.
   It was still useful (it independently confirmed the Devo 1.5x and air-doubling formula) but
   the 2026 Steamboat Devo official result is missing.
3. Minor entrant variances:  CRUMP (Copper Saturday) and ATHERTON (Copper Sunday) appear in
   the official PDFs but have no runs in the `.fre`;  LEDEZMA appears in the Steamboat PDF but
   not its `.fre`.  These look like late scratches / re-entries handled outside Winfree's saved
   state;  no scoring impact.

---

## 9.  Suggested Order of Fixes

1. F-1 (one line, affects every published score).
2. F-4 + F-3 (one function, ruled).
3. F-5 (small, ruled).
4. F-6 (DD table data + lookup).
5. F-2 (duals 5-8 bracket;  the only item needing design/UI work).
6. F-8 cleanup, then the INFO items as desired.

After F-1/F-3/F-4/F-5 land, re-running `node review/verify_mogul.js` against the season data
should show the engine matching the rule-derived spec column exactly on every run;  that is the
regression gate I would suggest wiring into `server/scripts/verify_v16.js`.
