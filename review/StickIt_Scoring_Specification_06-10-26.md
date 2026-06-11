# StickIt Scoring Review.  Phase 1 Specification

Extracted 06-10-26 from the reference documents in `Scoring Server/Claude Uploads/Reference/`.
This document states the governing rules as written, with a citation for every item.  It is the
yardstick for the Phase 2 verification.  It does not describe what StickIt currently does, except
in the Open Questions section, where the code and the rules appear to diverge and a ruling is
needed before comparison begins.

Sources cited below:

- **USSS** = USSS 2026 Freestyle-Freeski Competition Guide.pdf
- **ICR** = FIS ICR Freestyle (Spring 2025).pdf
- **JH** = FIS Freestyle Skiing Judging Handbook.pdf (October 2025)
- **DD Chart** = Mogul Degree of Difficulty Chart (2023, updated Nov 2023).pdf
- **RMF** = RMF Competition Guide 2025-2026.docx

Where USSS and FIS differ, the USSS guide governs domestic scoring (per the review instructions),
and the USA: paragraphs inside the USSS guide override the base FIS text.

---

## 1.  Single Moguls.  Score Composition

| Component | Weight | Maximum | Source |
|---|---|---|---|
| Turns | 60% | 60.0 | USSS 4206.1; ICR 4206.1 |
| Air | 20% | 20.0 | USSS 4206.2; ICR 4206.2 |
| Speed | 20% | 20.0 | USSS 4206.3; ICR 4206.3 |
| **Total** | | **100.0** | |

## 2.  Turns

- **5-judge format (3 turn judges).**  Each of three judges scores 0.1 to 20.0.  The three scores
  are added together.  Maximum 60.0.  (JH 6203.2.1)
- **7-judge format (5 turn judges).**  Five judges score independently.  The high and low Turns
  scores AND the high and low Deductions scores are discarded separately; the remaining six
  values (3 turns + 3 deductions) are added.  Deductions scores are always negative.  (JH 6203.1.1)
- **Turn base score composition.**  Carving 50%, Absorption/Extension 25%, Upper Body 25%.
  On the 20-point judge scale that is 10.0 / 5.0 / 5.0.  (JH 6204.1)
- **Range.**  Min 0.1 / Max 20.0 per judge.  (JH 6204.1 heading)
- **Deduction scale.**  (JH 6204.2)
  - 6.0  any complete stop
  - 4.1 to 5.9  complete fall without stop, or significant slide to near stop
  - 2.9 to 4.0  hard touchdown or front roll without stop
  - 2.1 to 2.8  medium touchdown without stop
  - 0.1 to 2.0  light touchdown, small stumble, fall line deviation, speed check, double pole
    plant, shooting
  - Double pole plants:  0.4 each, up to 4 (max 1.6); beyond 4 the judge reduces the base score.
  - Shooting / significant sliding:  2.0 per control gate not skied.
  - Fall line deviation:  1.6 per complete line change; immediate return earns no second
    deduction.  (JH 6204.2.1)
- **Deduction sign.**  Deductions reduce the turn score and are represented as negative values.
  (JH 6203.1.1)

## 3.  Air

- **Judging.**  Two air judges each score every jump 0.0 to 10.0 on form (quality, air, fluidity).
  (JH 6203.2.2, 6204.3.2)
- **Calculation as written in the handbook.**  The judges' scores "will be averaged for a total
  air score and truncated to two decimal places" (JH 6203.2.2).  The manoeuvre is "evaluated for
  form out of 10.0 with a degree of difficulty multiplier" (JH 6204.3).  Read literally:
  per jump, average the air judges' raw scores, multiply by the jump DD, truncate to 2 decimals.
  Air total = jump 1 + jump 2, maximum 20.0.
- **Per-jump cap.**  "Maximum raw point allotment: 10.0 for form, with DD max. 10.0 / jump."
  (JH 6204.3.2)  The with-DD score of a single jump cannot exceed 10.0.
- **Minimum to earn DD.**  "Jumps must receive at least 0.1 form points to receive difficulty
  multiplier."  (JH 6204.3.2)
- **Two different jumps required.**  Every competitor must perform two different jumps for
  maximum points.  Only identical jumps, **or jumps with the same jump code**, are repeats
  (USA definition).  If jumps are repeated, only the first jump shall count.  USSS also
  recognizes Neutral (N) and stand-alone Grab (G) as acceptable jumps.  (USSS 4210.2.1)
- **RMF RQS override for repeats.**  "If an athlete performs the same trick off both jumps, only
  one (1) of the tricks will be scored.  The judges will use the score of the higher scored
  jump."  (RMF, RQS Judging Procedures)  Note this says higher **scored**, not higher DD.
- **Single jump in a two-jump event.**  A competitor who performs only one manoeuvre can only
  receive a maximum of 50% of the total possible Air score, that is 10.0.  (USSS 4210.2.2)
- **Excess jumps.**  Manoeuvres beyond the recommended number are disregarded in order of lowest
  to highest scoring.  (USSS 4210.2.2)

## 4.  Speed

- **Formula.**  Speed Score = 48 − 32 × (competitor time / pace time).  (USSS 4206.3; ICR 4206.3)
- **Clamps.**  Maximum 20.0 (ICR 4206.3).  Minimum 0.0 (JH 6204.4 heading).
- **Pace time.**  Pace time = course length in meters ÷ pace speed.  (USSS 4207.2)
  - USA pace speeds:  Men 9.70 m/s, Women 8.20 m/s.  (USSS 4207.2)
  - FIS pace speeds:  Men 10.30 m/s, Women 9.00 m/s.  (ICR 4207.2)
  - Pace time is computed separately per gender.  A speed score cannot exist until a course
    length (or a manual pace time) has been entered.

## 5.  Rounding / Truncation

- All published scores are rounded down (truncated) to two decimal places and used in further
  calculations only in the truncated form.  This includes total results and tie-breaking
  formulae.  The Degree of Difficulty is always presented in its original form.  (USSS 4008,
  referenced by USSS 4208 and ICR 4208)

## 6.  Tie Breaking, Single Moguls

Order of comparison (USSS 4207.3, identical in ICR 4207.3):

1. Better Turns score  (4207.3.1)
2. Better Air score **without** Degree of Difficulty  (4207.3.2)
3. Faster time  (4207.3.3)
4. Still tied:  same rank, listed by standings/points list order  (4207.3.4)

Cut-line ties:  if a tie exists for the last place advancing to any Phase after all tie-breaking
is exhausted, ALL tied competitors advance.  (USSS 4207.3.5)

## 7.  Judge Panel Configurations

- Standard formats:  7-judge (5 turns + 2 air) and 5-judge (3 turns + 2 air).  (JH 6203.1, 6203.2)
- Divisional-level FFSP events where five scoring judges are not available (USSS 4207.1.1):
  - 4 judges:  2 Turn + 2 Air;  or 3 Turn + 1 Air;  or 2 Turn + 1 Air + non-scoring Head Judge
  - 3 judges:  2 Turn + 1 Air
- The rules do **not** state how a 2-turn-judge sum maps onto the 60-point turns scale.
  See Open Question A.

## 8.  Run Status Rules, Single Moguls

- **DNF (USA override).**  A competitor who loses a ski or stops 10+ seconds shall NOT receive
  DNF, but will be judged and scored up to the point at which they lost the ski or stopped,
  with 0 Time Points.  (USSS 4210.3.2 USA paragraph)  DNF remains available for skiing out of
  the course boundaries or missing a gate (4210.3.1).
- **Two-run formats.**  The higher of the two runs is used (for FFSP and results).  (USSS FFSP
  Event Scoring rule 4)

## 9.  RQS Format (RMF)

- 60% turns / 20% air / 20% speed, "the USSA competitive format."  (RMF, RQS Judging Procedures)
- Turn judges:  "a maximum of 20 points from each of the two judges."  Two turn judges.
- Air:  two jumps, max 10 points per jump from the air judge, multiplied by DD.
- Repeats:  the higher scored jump counts (see Section 3 above).
- Inverted and off-axis jumps not permitted; rotations limited to 720 degrees.
- Speed counts; pace time set per event from course length.
- Two runs guaranteed; start order identical for both runs (women random, then men random).

## 10.  DEVO Format (RMF)

- Turns and air only.  Speed is NOT a factor and time is not calculated into the score.
  (RMF, DEVO Judging Procedures)
- "The overall breakout of scoring of a DEVO event is approximately 85% turns and 15% air,
  depending on the athlete's performance."
- One-jump courses.  One aerial manoeuvre, judged out of 10, multiplied by DD.
- Inverted and off-axis jumps not permitted; rotations limited to 720 degrees.
- Two runs guaranteed; start order U7 women first, then U7 men, up through the age groups,
  same order both runs.
- See Open Question B on whether the single jump's air is doubled.

## 11.  Dual Moguls

### 11.1  Score composition

Turns 50%, Air 25%, Speed 25%.  (USSS 4306.1 to 4306.3)

### 11.2  Classic 5-judge vote model

(JH 6304.2.1, 6304.3.1)

| Judge | Role | Votes |
|---|---|---|
| J1 | Turns | 5 |
| J2 | Turns | 5 |
| J3 | Air | 5 |
| J4 | Speed | 5 |
| J5 | Overall Performance | 5 (3 turns + 1 air + 1 speed) |
| **Total** | | **25** |

- Each judge splits exactly 5 whole votes between red and blue:  5-0, 4-1, 3-2, 2-3, 1-4, 0-5.
- Winner = simple majority of the 25 votes.  (JH 6304.3.3)
- **Speed votes by time differential** (JH 6304.3.4):
  - difference ≤ 0.74 s:  3 / 2
  - difference 0.75 to 1.49 s:  4 / 1
  - difference ≥ 1.5 s:  5 / 0
- **Speed tie.**  The 6 speed-related votes (Speed judge 5 + Overall speed vote 1) are split
  evenly, 3-3, keeping the total at 25.  (JH 6304.3.2, 6304.3.5.1)
- **Air tie (or neither competitor jumps).**  The 6 air-related votes are NOT awarded, leaving
  19 votes.  (JH 6304.3.5.1)
- In all cases an odd number of votes remains, so no tie is possible.  (USSS 4307.2.2.1)
- **Repeat jumps in duals (Classic).**  Identical repeat = deduction of 2 votes per Air judge.
  Two different manoeuvres from the same scoring category = deduction of 1 vote per Air judge.
  (JH 6305.1.2)  One jump only = max 50% of possible Air.  (USSS 4311.5)

### 11.3  Seeding

- USA:  seeding by the most recent national dual moguls points list OR the most recent moguls
  event held during the same competition.  (USSS 4310.1.1.4 USA paragraph)
- Ladder placement:  top 8 keep their seeding rank; ranks 9-16 randomly drawn into places 9-16;
  ranks 17-32 randomly drawn into places 17-32; places 33+ filled by random draw.  (USSS 4310.1.2)
- Course color by round, "top competitor" = position in bracket (USSS 4310.3.1):
  R128 red, R64 blue, R32 red, R16 blue, R8 red, R4 blue, Final rounds red.
  Blue is always the left side looking up the hill.

### 11.4  Bracket advancement and final placement

- Winner of each match advances.  Ranking to 4th place determined by dualing off; USA organizer
  option to dual off to 8th.  (USSS 4310.3.2 USA)
- **Ranking of eliminated competitors** (USSS 4312):
  1. Within a round, eliminated competitors are grouped by their judge-points score, highest
     first; within a score group, ranked by seeding; all scored competitors rank above
     unscored.  (4312.1)
  2. DNF:  ranked by seed, below all scored competitors of the round, above all DNS of the
     round.  (4312.2)
  3. DNS (any round except the first):  ranked by seed after all other classified competitors
     of the round.  (4312.3)
  4. DNS in the first round:  not classified, no rank, listed above DSQ.  (4312.4)
  5. Both competitors DNF in the same match:  the first to DNF ranks lower.  (4312.5)
  6. Residual ties:  broken by qualification/seeding rank.  (4312.6)
- **Centerline.**  Crossing the centre line (both feet completely across) is a DNF.  (JH 6305.1.3;
  USSS 4311.3.2)  RMF:  "it is the skier who crossed first that is disqualified."
- **Tie break, last qualifying spot for finals.**  Two tied:  they dual immediately before the
  first round, winner advances.  More than two:  each skis a single run, winner advances.
  (USSS 4307.2.2.4)

### 11.5  RMF DEVO/RQS duals

- DEVO and RQS athletes are combined into one field on an RQS two-jump course.
- Judging panel chosen by Head Judge and host, with reduced emphasis on speed.
- No losers bracket until 8 athletes remain per gender; those 8 dual off for final placement.
- Bracket may be random or seeded off a previous event at the host club's discretion.
  (RMF, DEVO/RQS Dual Moguls Judging Procedure)

## 12.  Degree of Difficulty (DD Chart, Nov 2023)

Women's values are men's + 0.10 throughout the base manoeuvres.

**Upright bases:**  Single 0.40/0.50, Double 0.53/0.63, Triple 0.65/0.75, Quad 0.76/0.86,
Quint 0.86/0.96  (Men/Women).

**Upright per-letter modifiers:**  T −0.02, S −0.02, D +0.01, X +0.01, Y +0.01, M +0.01,
K +0.01, Z 0.  (A combination code's DD = base for its letter count + sum of letter modifiers.)

**Multipliers:**  position p +0.03, grab G +0.14.

**Rotational:**  3 = 0.68/0.78, 3p = 0.71/0.81, 3G = 0.82/0.92, 7 = 0.85/0.95, 7p = 0.88/0.98,
7G = 1.01/1.11, 10 = 1.02/1.12, 10p = 1.05/1.15, 10G = 1.20/1.30.

**Off axis:**  3op = 0.71/0.81, 3oG = 0.82/0.92, 7op = 0.88/0.98, 7oG = 1.01/1.11,
10op = 1.05/1.15, 10oG = 1.20/1.30, 14op = 1.22/1.32, 14oG = 1.39/1.49.

**Inverted:**  bP/bT = 0.68/0.78, bL = 0.71/0.81, bp = 0.71/0.81, bG = 0.82/0.92,
bF = 0.88/0.98, bdF = 1.05/1.15, btF = 1.22/1.32, fT/fP = 0.68/0.78, fp = 0.71/0.81,
fG = 0.82/0.92, fF = 0.88/0.98.

**Loop:**  l = 0.68/0.78, lp = 0.71/0.81, lG = 0.82/0.92, lF = 0.85/0.95, lpF = 0.88/0.98,
lGF = 1.01/1.11.

**Chart notes:**  each rotation beyond the base manoeuvre +0.17; each additional grab rotation
+0.02; layout position in twisting flips +0.03; additional upright manoeuvres +0.13, +0.12,
+0.11, +0.10.

**Dual moguls DD:**  in principle the single moguls DDs multiplied by 1.25 (JH 6304.4.2.4);
this applies to the Direct Comparison format only and does not affect the Classic vote model.

## 13.  FFSP (Freestyle Points)

(USSS, Event Scoring chapter)

**Event ratings, moguls and dual moguls:**

| Event | 1st | 2nd | 3rd |
|---|---|---|---|
| Divisional Championships | 1000 | 970 | 950 |
| Divisional Events | 900 | 875 | 855 |
| Divisional Events, fewer than 15 competitors per gender | 800 | 775 | 760 |

- Top 3 finishers receive the fixed rating points.
- **Moguls, 4th place and below:**  proportional by score.  FFSP = (athlete score ÷ 3rd place
  score) × 3rd place FFSP.
- **Dual moguls, 4th place and below:**  Place Point Reduction.  CC = total number of final
  ranked competitors per gender.  PPR = 3rd place FFSP ÷ CC.  4th = 3rd FFSP − PPR, 5th = 4th −
  PPR, and so on.
- **DNS / DSQ:**  no event attendance credit, no points.
- **Moguls DNF:**  attendance credited; score = 50% of the last place scored FFSP run; all DNFs
  receive the same points.
- **Dual moguls DNF:**  only DNFs received in the first round receive zero.
- Two-run formats:  the higher of the two runs is used for FFSP.

## 14.  Age Classification and Eligibility

Age class is based on year of birth only (USSS, Age Classification table, 2025-26 season):

| Class | Age | Birth year |
|---|---|---|
| U7 | 6 and younger | 2019+ |
| U9 | 7-8 | 2017-2018 |
| U11 | 9-10 | 2015-2016 |
| U13 | 11-12 | 2013-2014 |
| U15 | 13-14 | 2011-2012 |
| U17 | 15-16 | 2009-2010 |
| U19 | 17-18 | 2007-2008 |
| Senior | 19-20 | 2005-2006 |
| Veteran | 21+ | 2004 and earlier |

- Season runs July 1 to June 30.  (USSS, Points List chapter)
- Results are computed per gender.  (USSS 4009.2 lists per-gender results content; pace times
  and event fields are gender-specific throughout.)
- DEVO:  12 and under as of December 31 of the season (U13 and younger).  RQS:  11 and older,
  not in COMP or DEVO.  (RMF)

---

## Open Questions.  Rulings Received 06-10-26

David ruled on all seven questions before Phase 2 began.  The rulings below are part of the
specification.

**A.  Turns scale for 2-turn-judge panels (RQS, Devo, reduced Comp panels).**
RULING:  StickIt is correct as written.  The 2-judge sum is scaled by 1.5 so the turns maximum
stays 60.  This is the governing domestic convention.

**B.  Devo single-jump air doubling.**
RULING:  StickIt is correct as written.  The single jump's air score is doubled (air maximum
20) in 1-jump events.  The RMF "approximately 85/15" language is descriptive, not a formula.

**C.  Per-jump post-DD cap of 10.0.**
JH 6204.3.2 caps the with-DD score of one jump at 10.0.  StickIt caps the air total at 20.0 but
not the individual jump.  RULING:  StickIt should be changed to apply the 10.0 per-jump cap.
Confirmed finding;  patch suggestion to be included in the report.

**D.  Air averaging convention.**
The handbook order is:  average the air judges' raw scores per jump, truncate, multiply by DD.
StickIt (since v1.16.09, to match Winfree) floors each judge's score × DD individually and then
averages.  RULING:  StickIt should be changed to the handbook order.  Confirmed finding;
patch suggestion to be included in the report.  Phase 2 will additionally record where the
Winfree convention visibly differs in the published PDFs so the ±0.01 deltas are explainable.

**E.  RQS repeat-jump rule:  higher scored vs higher DD.**
RMF says the HIGHER SCORED jump counts;  StickIt keeps the higher-DD jump.  RULING:  StickIt
should be changed to keep the higher SCORED jump.  Confirmed finding;  patch suggestion to be
included in the report.

**F.  Dual moguls speed-tie votes.**
JH 6304.3.5.1 splits the 6 speed votes evenly (3-3, total 25);  StickIt's time-tied path has
the Speed judge enter 0/0 and the Overall judge cast 4 votes (total 19).  RULING:  StickIt is
correct.  The domestic practice intentionally departs from the handbook here;  no change.

**G.  Moguls DNF scoring (USA rule).**
USSS 4210.3.2 USA paragraph scores a stopped athlete to the stopping point with 0 time points.
RULING:  StickIt works as is.  Operators enter reduced scores instead of the DNF status when
the rule applies;  the DNF status remains for boundary/gate infractions.  No change.
