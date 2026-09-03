## Adding & assigning judges

Each event needs judges configured before scoring can begin. Judges live in the `judges` table, scoped per-event. The same person can be a judge in multiple events — each event has its own judges row for them.

### Adding a judge

1. Open the event detail page → **Setup** tab.
2. Click **+ Add Judge**.
3. Fill in:
   - **Name** — first + last, free text. Shown on the HJ tablet and in PDF reports.
   - **Role** — pick from the dropdown. The list is filtered to roles still needed (e.g. if you've already added TL1, TL1 is removed from the dropdown).
   - **PIN** *(optional)* — 4-6 digits used by the judge when signing in on their tablet.
4. Click **Add**.

### Roles per discipline

**Mogul (Comp Series default):**
- `TL1`, `TL2`, `TL3` — T&L judges (`TL4`, `TL5` too when the event is set to 5 T&L judges — the 7-judge FIS format)
- `Air1`, `Air2` — Air judges
- `HeadJudge` — Head Judge
- `Timekeeper` — Timekeeper

**Mogul (Devo / RQS-EQS default):**
- `TL1`, `TL2` — T&L judges
- `Air1` — Air judge
- `HeadJudge`, `Timekeeper`

**Dual Mogul:**
- `DualTurns1`, `DualTurns2` — Turns judges
- `DualAir` — Air judge
- `DualTime` — Time judge
- `DualOverall` — Overall judge
- `HeadJudge` — Head Judge (no timekeeper for dual; time judge is one of the 5-point split judges)

**Aerials (v2):**
- `AeJudge1` through `AeJudge<N>` where N = `aerials_panel_size`
- `HeadJudge`

### Friendly role display

The tablets display judge roles using a friendlier mapping:
- `TL1` → `T&L Judge 1` (… `TL5` → `T&L Judge 5`)
- `Air1` → `Air Judge 1`
- `AeJudge1` → `Aerials Judge 1`
- `DualTurns1` → `Dual Turns Judge 1`

Internal values remain `TL1` etc. for routing/permissions. Only the display label is friendlier.

### Copying judges from another event

Most meets use the same panel for every event of a discipline. Instead of re-entering it, click **Copy Judges from Other Event** above the Assigned Judges table and pick the source event. The list offers only events of the **same meet and the same discipline** (moguls from moguls, dual moguls from dual moguls, aerials from aerials using the same scoring model), because the roles differ between disciplines.

- Roles already filled on this event are kept — the copy never overwrites a judge you assigned.
- Roles the target format does not have are skipped (for example TL4/TL5 from a 7-judge event into a 5-judge event); the message after the copy says how many were copied and how many were skipped.
- Every copied judge gets a **new tablet link** (short code) — tablet URLs are per event. Generate them from the Links tab as usual.
- The Head Judge is copied too when the target has none.

The copy works the same on the cloud site and on a venue server's Scoring Computer (Control PIN); on the venue the new rows sync to the cloud like any other judge edit.

### Editing a judge

Edit a judge's **name** and **USSS ID** inline, right in the Assigned Judges table — click into the field, type, and save. Roles aren't editable after creation; to change a judge's role, remove and re-add them (changing a role mid-event would orphan partial submissions).

### Removing a judge

Click the trash icon. Delete. If the judge has submitted scores, the rows in `judge_scores` are removed too — confirmation modal warns first.

### After adding judges

Generate tablet URLs from the **Links** tab — see [Judge tablet URLs](./judges-urls). For aerials specifically, see [Seeding an aerials panel](./judges-seed-aerials).

### Number of judges defaults

The Add Event modal sets `num_tl_judges`, `num_air_judges`, `num_jumps`, etc. based on the category. The Setup tab's `+ Add Judge` dropdown then shows only the unfilled roles. To change the judge count after creation, edit the event ([Editing an event](./events-edit)) before scoring begins.
