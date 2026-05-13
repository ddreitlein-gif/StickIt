## Run order with age groups

The **By Age Groups** run-order builder groups athletes by USSS age class, youngest first, randomized within each group. This is the standard build mode for Devo events and any other event where the TD wants U7s to ski before U9s before U11s, etc.

### USSS age class rules

USSS defines age class by the athlete's birth year vs. the **competition season**. A season starts July 1 — so for the 2025-26 season (any event held July 1, 2025 through June 30, 2026), athletes born in 2020 are computed as 5 years old and fall into U7.

The classes:

| Class | Age range |
|---|---|
| **U7** | 6 and under |
| **U9** | 7–8 |
| **U11** | 9–10 |
| **U13** | 11–12 |
| **U15** | 13–14 |
| **U17** | 15–16 |
| **U19** | 17–18 |
| **Sr** | 19–34 |
| **Vet** | 35 and above |

### Build order

`By Age Groups` orders youngest age class first:
1. All U7 athletes (randomized within the group)
2. All U9 athletes (randomized within the group)
3. ... and so on up to Vet

### Age Class column

After clicking **By Age Groups**, an extra **Age Class** column appears in the run order table showing each athlete's computed class. The column persists for the rest of the session even if you re-shuffle to **Random Order**.

### Age group transition banner on tablets

When a run completes and the *next* athlete is in a different age group, an amber pulsing banner appears on Judge, Head Judge, and Timekeeper tablets:

> U11 group complete — U13 up next

It auto-dismisses after 15 seconds or on tap. **Devo events only** show this banner — Comp Series, RQS-EQS, and FIS events suppress it (those events are typically single-class or single-day formats).

The banner is purely informational — it doesn't pause scoring or block anything. It exists so judges can re-set their mental model (e.g., U7s vs. U17s look very different at the same score).

### What if `birth_year` is wrong?

The age class is recomputed every time the run-order builder runs. If you fix an athlete's birth year on the Registration tab and re-click **By Age Groups**, the new class is used. The transition banner on tablets also uses the live-server compute, so corrections take effect immediately on the next run.

### Manual override

If the TD insists on a custom order across age groups (e.g., bib draw, FIS world cup style), use **Random Order** or hand-reorder via the **▲**/**▼** arrows. The Age Class column still appears for reference, but order is whatever you save.
