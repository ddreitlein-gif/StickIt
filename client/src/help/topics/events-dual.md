## Dual mogul setup

Dual mogul is a head-to-head bracket format. Two athletes ski simultaneously on parallel courses; five judges award points on a 5-point split (e.g., a `4–1` decision means one athlete won 4 points to 1).

### Bracket sizes

Pick from 4, 8, 16, 32, or 64 athletes. The bracket size must be ≥ the number of athletes you've registered.

- **4** — semis + final + 3rd/4th
- **8** — quarters + semis + final + 3rd/4th
- **16, 32, 64** — same pattern, one extra round each

### Optional fields

- **Runoff to 8th** — if checked, the bracket runs a true 5–8 mini-bracket per USSS 4310.3.2: the four quarterfinal losers meet in two **consolation semifinals**, whose winners play the **5/6 final** and losers the **7/8 final** — in addition to the standard 3rd/4th. The finals run in order 7/8 → 5/6 → 3rd/4th → Championship at the end of the event. Useful when FFSP points need to extend down to 8th place.
- **Random seed (optional)** — used by the **Random Seed** seeding button to make seedings reproducible. Leave blank for true randomness; set a value if you want to be able to re-seed identically later.

### Seeding the bracket

Once athletes are registered, go to the **Bracket** tab on the event detail page. Three seeding options:

1. **FIS Bracketing** — uses placement from another mogul event (typically the qualifier mogul event of the same gender from the same meet) to seed the bracket per the FIS dual mogul placement spec. Includes band-based randomization to avoid having seeds 1 and 2 always meet in the final and seeds 9 and 16 always meet in round one. See `server/dual/placement.js` for the algorithm.
2. **Random Seed** — shuffles all registered athletes randomly and lays them into the bracket positionally.
3. **Manual Bracketing** — opens a hand-placement modal with first-round match cards. Each card has Blue and Red dropdowns showing available athletes plus a BYE option. Place each athlete and BYE explicitly. Validation prevents both-BYE matches.

All three produce the same bracket-shell shape — once seeded, the live scoring flow is identical regardless of how the bracket was built.

### Round-robin scoring

For each match:

1. The current match shows on the Scoring tab and on the dual mogul judge tablets.
2. Each of the 5 dual mogul judges (DualTurns1, DualTurns2, DualAir, DualTime, DualOverall) submits a 5-point split.
3. The HJ approves the match.
4. The winner advances to the next round; the loser may go into the consolation bracket.
5. The bracket re-renders with the next match queued.

### End of bracket

Once every match (including consolation) is complete, the HJ tablet shows the final bracket tree with **Approve & Finalize Event** and **Send Back to Scoring** buttons. Approve to mark the event complete and unlock FFSP points (see [FFSP points (dual mogul)](./results-ffsp)).

### Manual score entry

While a tablet-scored match is in progress, the operator can intercept with **Manual Score Entry** from the Scoring tab. This locks the judge tablets, opens a 5-judge entry modal, and lets the operator finalize the match manually (e.g. when a tablet is offline or scores are coming in over the radio). See [Manual score entry](./scoring-manual).

### Bottom air landing zone — the "chop" rule (NJ)

Per the Spring 2026 FIS rule (FS-18), each competitor must land the **bottom air within the Landing Zone** (maximum 20 meters from the takeoff, control gates at 20.5 meters). A competitor whose boots or body land past the mark receives **No Jump (NJ) on the bottom air and zero speed points**. If **both** competitors land past, they are tied for speed and both receive NJ.

**Who makes the call:** the **Air Judge (J3)** — their dual tablet has an **NJ (Past Chop)** panel with independent Blue/Red toggles (each with a confirmation, on set and on clear). The **Head Judge** can also set or clear the call from the HJ tablet, and the flags are editable on the operator's Scoring tab and in the paper-score modal. The finding is locked once the HJ approves the match. The NJ call is independent of the air split — the Air Judge still submits a normal 5-point air comparison.

**What the call does to the score** (applied automatically at calculation time — the Time Judge's real entry is always recorded as evidence and never modified):

- **One competitor NJ** — the speed comparison pays **0 to the violator / 5 to the opponent**, regardless of what the Time Judge entered (including a Time Tied entry). The Overall Judge splits the normal 5 points.
- **Both NJ** — the speed comparison is a true tie: each side is credited **3 / 3** and the Overall Judge drops to a **4-point split**. (The 2.5 figure in the FIS text is the seven-judge panel value; StickIt's five-judge panel uses 3 / 3 per FIS JH 6304.3.2.)

The Time Judge's tablet shows a persistent amber banner while an NJ call is active. The Head Judge's approval view shows the finding, the Time Judge's recorded entry, and the effective (overridden) speed values side by side — approving the match certifies the finding. NJ badges appear on the athlete cards, the match rows, the public scoreboard, the broadcast overlay, and the bracket PDF (`[NJ]` name tag).

### Tied speed and tied air

- **Time Tied** (J4 button/checkbox) — the speed comparison is tied. Since v1.29.00 the tied credit is **3 / 3** (previously displayed 0 / 0), so a tied-time match totals 25 points, not 19 — including historical matches. The Overall Judge splits 4. Winners are unaffected.
- **Air Tied** (new J3 button/checkbox, FIS JH 6304.3.5.1) — the air comparison is tied, or neither competitor jumps. The six air votes are **withheld**: the air row pays **0 / 0** and the Overall Judge drops a point of scale. Note the deliberate handbook asymmetry — a speed tie awards the votes evenly (3 / 3) while an air tie withholds them (0 / 0).
- If **both** speed and air are tied, the Overall Judge splits only **3** (their turns votes).

Every distributed total (25 / 25 / 19 / 19) is odd, so a tied match remains impossible. Whenever a tie declaration or NJ transition changes the Overall Judge's scale, their submitted split is automatically cleared and their tablet prompts a rescore on the new scale.
