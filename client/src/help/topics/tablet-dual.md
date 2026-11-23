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

- **Match card** — the round, then the blue competitor on the left and the red competitor on the right with their bibs, and the pairing number.
- **Split buttons** — six large buttons, one per split: `5 / 0`, `0 / 5`, `4 / 1`, `1 / 4`, `3 / 2`, `2 / 3` (blue points first).
- **Confirm panel** — a framed space below the buttons. It shows your selection with **Cancel** and **Confirm** buttons. The space is always there, so no button moves when it fills.

On a tablet held in **landscape** the screen has two columns — the match card on the left, the split buttons and the confirm panel on the right — and everything fits without scrolling. In portrait, and on narrower screens, the same parts are stacked in one column.

A judge sees **only their own split**. The running Blue / Red total and the number of judges who have scored are not shown on judge tablets (v2.8.03); the Head Judge tablet shows them.

### Entering (two steps, v2.8.03)

1. Watch the match and decide who won and by how much.
2. **Tap the split** (for example `4 / 1` for a clear blue win). The button lights up and the confirm panel shows **Blue 4 / Red 1**. Nothing has been sent.
3. Changed your mind? Tap a different split, or tap **Cancel**.
4. Tap **Confirm Blue 4 / Red 1**. The score is sent and the tablet shows **Score Submitted** with your split.

**Time Tied** and **Air Tied** work the same way: tap the button, then **Confirm Time Tied** / **Confirm Air Tied**.

A selection that was not confirmed is dropped when the next match starts, when the Head Judge rejects your score, and (Overall Judge) when the points to award change between 5, 4 and 3. If a score cannot be sent, the panel says **Score not sent** with the reason — select your split and confirm again.

When all 5 judges have submitted, the HJ tablet shows the full match and asks for approval. If the Head Judge rejects your score, a red **Your score was rejected** notice appears — select a new split and press Confirm.

### Match navigation

The tablet shows the **current active match only**. Use the Scoring tab's bracket view to see upcoming matches. Once the current match is approved, the tablet auto-advances to the next match.

**Round notation (v2.5.06).** The top of every match card names the round and gender — *Female Round of 32*, *Male Semifinal*, *Female 7th / 8th Place*, and so on. After the last match of a round is approved, the *Score Submitted* / *Waiting for next match* screen shows a large amber **End of Round of 32 for Females** notice (through the Round of 8, then **End of Semi-Finals for Females**). It disappears when the next match starts — on a venue box that may be the other gender's event, which the tablet follows automatically. No notice follows the finals.

### Judge role differences

In dual mogul, the five judge roles are nominally:
- **DualTurns1** / **DualTurns2** — two judges focused on turns quality
- **DualAir** — air quality judge
- **DualTime** — time-down-the-hill judge (eyeballs, no clock)
- **DualOverall** — overall impression

All five use the same 5-point split UI — the role labels are nominal, for FIS reporting structure. In practice each judge weighs their role's component but submits one combined split. Three roles have extra controls:

- **DualAir (Judge 3)** — an **Air Tied** button (submits 0 / 0 with the air-tied flag when the air comparison is tied or neither competitor jumps; the air votes are withheld) and the **NJ (Past Chop)** panel described below. **Both are gated by the meet's Advanced settings** and are hidden by default — Air Tied appears only when "Air score tie allowed" is on, and the NJ panel only when the "Landing Past the Lower Chop (NJ) rule" is on.
- **DualTime (Judge 4)** — the **Time Tied** button and a **Time Differential** reference card (below). A time-tied entry records 0 / 0 but is credited **3 / 3** in every display and total (v1.29.00, FIS JH 6304.3.2 five-judge value).
- **DualOverall (Judge 5)** — the split grid automatically switches between **5, 4, or 3 points** depending on the tie state: 5 with no ties, 4 when speed OR air is tied, 3 when both are. If a tie declaration or NJ change lands after the Overall Judge already submitted, their entry is cleared and the tablet prompts a rescore on the new scale.

### Time Differential — Time Judge only

The Time Judge's tablet carries this table as a reference card (v2.8.03), from the FIS Judging Handbook (November 2026) 6304.3.4, Time Differential for Speed. It is a reference only — the tablet does not time the run and selects nothing for you.

| Time difference | Votes |
|---|---|
| 0.74 seconds or less | 3 / 2 |
| 0.75 to 1.49 seconds | 4 / 1 |
| 1.5 seconds or more | 5 / 0 |
| Tied | Time Tied (credited 3 / 3) |

### NJ (Past Chop) — Air Judge only

Per FIS JH 6304.4.2.1 (FS-18), the bottom air must land within the Landing Zone (no more than 20 m from the takeoff; control gates at 20.5 m mark its end). **The rule is off by default** — the panel appears only when the meet's Advanced settings enable the NJ rule. When enabled, the Air Judge's tablet has an **NJ (Past Chop)** panel (under the match card in landscape, below the split buttons in portrait) with independent **Blue NJ** / **Red NJ** toggles. Its **Confirm NJ** button is separate from the split's Confirm button, and only one of the two confirmations is open at a time:

1. Tap the violator's toggle. A confirmation appears — "Mark [Name] as NJ, landed past chop? This sets their speed points to zero." (If the other side is already flagged, the confirm notes the result is a speed tie at 3 / 3.)
2. Confirm. The call posts to the server immediately — it does not wait for, and is independent of, your air split.
3. Clearing a toggle also asks for confirmation. Toggles stay editable until the Head Judge approves the match.

A single NJ overrides the Time Judge's entry to **0 / 5** for the violator; both NJ makes speed a true tie at **3 / 3**. The Time Judge still enters their real split as evidence — a persistent amber banner on the Time Judge's tablet shows the active override. The Head Judge can review, set, or clear the call before approving.

### Manual Score Entry lockout

When the chief of score has opened the **Manual Score Entry** modal for the current match, the judge tablets show a full-screen amber overlay:

> Manual Score Entry for This Round

Judges cannot submit during this lockout. When the operator either submits the manual score or cancels, the lockout clears and tablets resume normal operation.

### Event complete

After every bracket match has been finalized (and the HJ has clicked **Approve & Finalize Event**), the judge tablets show a full-screen "Event Completed — Thank You for Your Work" message.

### High-contrast mode

HC Mode button top-right. See [High-contrast (HC) mode](./tablet-hc).
