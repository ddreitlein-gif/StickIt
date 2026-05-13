## FFSP points (dual mogul)

FFSP (Freestyle Skiing Points) is the USSS point system that determines national / divisional rankings across the season. StickIt computes FFSP automatically for **dual mogul events only** as of v1.16.19 — standard mogul and aerials FFSP are not in scope this release.

### When points are computed

- Only after the event is finalized (`events.status='complete'`).
- Pre-completion the Points column on the dual scoreboard's **Place** tab shows `—`.

### Tier selection (auto, no UI config)

The tier is picked automatically based on the event's flags and the number of Counting Competitors (CC):

| Tier | 1st | 2nd | 3rd | Condition |
|---|---:|---:|---:|---|
| **Divisional Championships** | 1000 | 970 | 950 | `events.is_divisional = 1` |
| **Divisional Events** (CC ≥ 15) | 900 | 875 | 855 | `is_divisional = 0` and CC ≥ 15 |
| **Divisional Events** (sub-15) | 800 | 775 | 760 | `is_divisional = 0` and CC < 15 |

### Counting Competitors (CC)

CC = total placements **minus** DNS / DSQ / scratched athletes.

- **DNFs count toward CC** — they participated, even though they didn't finish.
- DNS, DSQ, and scratched athletes do not count.

### Formula for 4th place onward

```
ffsp(rank) = max(0, tier3rd − (rank − 3) × (tier3rd / CC))
```

So at a Divisional Events (sub-15) event with CC = 12 and `tier3rd = 760`:

- 4th place: `760 − 1 × (760 / 12)` = `760 − 63.33` = **696.67**
- 5th place: `760 − 2 × 63.33` = **633.33**
- ... linear decay down to 0 at rank `CC + 3`.

### Special cases

- **DNS / DSQ / scratched** → 0 FFSP, excluded from CC.
- **First-round DNF** — an athlete who DNFs in the literal largest-numbered bracket round (e.g., Round of 32) gets **0 FFSP**.
- **Advancing-via-bye DNF** — an athlete who advanced via a bye and then DNFs in their first played match still receives formula-based FFSP.

### Where it shows

- **Public Scoreboard → Place tab** — Points column.
- **Final Place List PDF** (`POST /api/pdf/dual-results`) — Points column.
- **CSV / Excel exports** — Points column for dual mogul events.

### Helper function

The pure helper `computeDualFfsp({ event, bracket, placements })` in `server/dual/ffsp.js` does all the math. Both the results endpoint and the PDF route call it, so the values are guaranteed identical. No DB writes — FFSP is recomputed on demand so score edits trigger automatic recompute.

### Why dual mogul only

Standard mogul and aerials FFSP tables aren't yet built into StickIt. They use a different ladder (FIS race points, with course difficulty multipliers and field penalties). For now, those scores must be computed externally — typically by hand-typing the rank list into the USSS FFSP calculator spreadsheet.
