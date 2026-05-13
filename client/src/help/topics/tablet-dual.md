## Dual Mogul Judge tablet

The Dual Mogul Judge tablet handles one judge role in the 5-point split scoring format used for dual mogul brackets. There are five dual judge roles: `DualTurns1`, `DualTurns2`, `DualAir`, `DualTime`, `DualOverall`. Each judge has their own tablet URL.

### 5-point split format

In dual mogul, two athletes ski simultaneously. For each match, each judge awards five points total, split between the two athletes:

- `5–0` — total domination by one side
- `4–1` — clear win
- `3–2` — close win
- `2–3`, `1–4`, `0–5` — same on the other side

The five points are NOT cumulative — each judge picks one split per match. Five judges × one split each = a maximum of 25 points total per match (5 + 4 + 3 + 4 + 5 etc.).

### Layout

- **AthleteBar with two halves** — blue side (athlete 1) on the left, red side (athlete 2) on the right.
- **Score buttons** — six large tap targets, one per split: `5–0`, `4–1`, `3–2`, `2–3`, `1–4`, `0–5`.
- **Submit Score button** at the bottom.

### Entering

1. Watch the match.
2. Decide who won and by how much.
3. Tap the corresponding split (e.g., `4–1` for a clear blue win).
4. Tap **Submit**.

The tablet locks; the score is sent to the server. When all 5 judges have submitted, the HJ tablet shows the full match and asks for approval.

### Match navigation

The tablet shows the **current active match only**. Use the Scoring tab's bracket view to see upcoming matches. Once the current match is approved, the tablet auto-advances to the next match.

### Judge role differences

In dual mogul, the five judge roles are nominally:
- **DualTurns1** / **DualTurns2** — two judges focused on turns quality
- **DualAir** — air quality judge
- **DualTime** — time-down-the-hill judge (eyeballs, no clock)
- **DualOverall** — overall impression

All five use the same 5-point split UI — the role labels are nominal, for FIS reporting structure. In practice each judge weighs their role's component but submits one combined split.

### Manual Score Entry lockout

When the chief of score has opened the **Manual Score Entry** modal for the current match, the judge tablets show a full-screen amber overlay:

> Manual Score Entry for This Round

Judges cannot submit during this lockout. When the operator either submits the manual score or cancels, the lockout clears and tablets resume normal operation.

### Event complete

After every bracket match has been finalized (and the HJ has clicked **Approve & Finalize Event**), the judge tablets show a full-screen "Event Completed — Thank You for Your Work" message.

### High-contrast mode

HC Mode button top-right. See [High-contrast (HC) mode](./tablet-hc).
