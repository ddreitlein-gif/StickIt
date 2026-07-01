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

### Bottom air landing zone — the "chop" rule (v1.26.00)

Per the Spring 2026 FIS rule (FS-18), each competitor must land the **bottom air within the Landing Zone** (maximum 20 meters from the takeoff). A competitor whose boots land past the zone receives **0 speed points and No Jump (NJ) on the bottom air**. If **both** competitors land past the zone, they are tied for speed (2.5 points each) and both receive NJ.

How to record it in StickIt:

1. On the Scoring tab's active match card (or in the paper-score / manual-entry modal), check the **NJ (chop)** box for the affected competitor (Blue or Red).
2. An advisory line appears near the judge rows: *"Chop violation: J4 awards 0 to [color], 5 to opponent."* — or, when both are checked, *"Both past chop: use Time Tied (2.5 / 2.5)."*
3. StickIt does **not** auto-force the point values — the Time Judge / operator enters them through the normal 5-point split (the existing **Time Tied** checkbox produces the 2.5 / 2.5 outcome).

The affected competitor shows an **NJ** badge on the bracket cards, the public scoreboard match view, and the dual bracket PDF.
