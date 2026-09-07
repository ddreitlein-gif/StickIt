## Venue tablets: roles, seats, changing role

At a venue every tablet opens the same address, `http://stickit.local:3001`, and picks a role from the **venue menu**. Nobody types a per-judge URL, and every role screen follows the competition by itself: when a run starts in the other event, every tablet, the Scoreboard and the livestream overlay switch on their own.

**If a tablet's first load is slow.** Once in a while a tablet's very first visit to `stickit.local` takes a few minutes: the name is resolved over Wi-Fi multicast (Bonjour), and some Wi-Fi setups deliver those answers slowly the first time. The box is not the problem — after that first load the name works normally. Rather than wait, type the box's **numeric address** from **Connection Info** on the venue menu (for example `http://192.168.2.93:3001`); it opens at once and everything works the same. `stickit.local` stays the normal address to teach and print — the numeric one is the backup.

### Picking a role

| Tile | PIN | What it opens |
|---|---|---|
| **Scoring Computer** | Control | The full officials console (run orders, manual entry, results, reports) |
| **Head Judge** | Control | The Head Judge tablet for whichever event is live |
| **Judge** | Crew | The seat picker, then that seat's judge tablet |
| **Timekeeper** | Crew | The Timekeeper tablet |
| **Scoreboard** | none | The live results display for a TV |

A tablet remembers its role. After a reboot, a Safari reload, or opening the home-screen shortcut, it lands straight back on its page with no re-setup. Only the explicit actions below change a tablet's role.

### Judge seats

Seats are numbered J1, J2, … and stand for the *position* in the judging panel, not a person: in a 5-judge mogul event J1–J3 are the T&L judges and J4–J5 the Air judges; in a 7-judge event J1–J5 are T&L and J6–J7 Air; in dual moguls J1–J2 are the Turns judges, J3 Air, J4 Time, J5 Overall; in aerials J1…Jn match the panel size. The seat picker shows **only the seats the live event uses**, with the role and the assigned judge's name under each seat, and it re-reads every few seconds so the list is always for the event that is live right now.

A seat can be held by one tablet at a time. A seat shown **in use** belongs to another tablet — see *Taking over from a dead tablet* below.

### The role bar

Judge, Head Judge and Timekeeper tablets carry a slim bar across the top, above the scoring screen (nothing on the scoring screen is covered). It names the tablet's role, seat, the judge assigned to that seat, and the event it is following, and carries the two actions:

- **Leave seat** (judge tablets) — frees the seat on the server and returns straight to the seat picker so the judge can pick the right one. No PIN is asked again. Use it when a judge picked the wrong seat, or when the panel changes between events.
- **Change role** — forgets the tablet's role (and frees its seat, if any) and returns to the venue menu, where each tile asks its own PIN. Use it when one iPad has to serve as a different official: an Air judge who becomes a T&L judge in the next event, and so on. (A Head Judge who also scores as a judge does **not** need this — see *Head Judge who also scores* below.)
- **Also score as a judge** (Head Judge tablet only) — see the next section.

Both ask "Are you sure?" first, so a stray tap mid-run cannot kick anyone out. The Scoreboard TV has no bar, only a small **Change role** button in the bottom-left corner.

### Head Judge who also scores

At most events the Head Judge is also one of the scoring judges — Head Judge plus, say, T&L 2 or Air 1 — and stays that same judge for the whole day. One tablet does both jobs:

1. Open **Head Judge** from the venue menu (Control PIN) as usual.
2. Tap **Also score as a judge** in the bar at the top. The same seat picker the Judge tile uses opens — no second PIN — showing only the seats the live event uses, with the role and assigned judge's name under each. Tap **Take** on the seat that holds your own judge assignment.

The bar now carries two tabs, **⚖️ Head Judge** and **🎿 Judge Jn** (with your name and role), and you switch between them with one tap between runs — no PIN, no re-login, nothing reloads. Both screens stay live behind the tabs: a score half entered on the judge tab is still there after a hop to the Head Judge tab to approve the previous run. The seat follows the competition exactly like a plain judge tablet — as events alternate, both tabs switch on their own — and the device remembers *Head Judge + seat Jn* as one role, so a reboot or a Safari reload brings both tabs back.

Dual moguls work the same way: the Head Judge tab shows the dual Head Judge screen and the judge tab whatever the seat means in the dual panel (J1–J2 Turns, J3 Air, J4 Time, J5 Overall). When the day switches between singles and duals, the amber notice in the bar says what your seat means now — keep going if it is right, or tap **Leave seat** on the judge tab and take the seat that matches your dual role.

- **Leave seat** (on the judge tab) frees only the seat. The tablet stays the Head Judge, and *Also score as a judge* is offered again.
- **Change role** frees the seat too and returns to the menu, as on any tablet.

### Taking over from a dead tablet

A tablet that breaks, runs out of battery, or wanders off keeps nothing the server needs — every submitted score is already on the venue server. To carry on with a backup tablet:

- **Judge seat:** on the backup tablet tap Judge, enter the Crew PIN, find the seat marked *in use*, tap **Force release…** under it and enter the Control PIN. The seat frees up and the backup tablet takes it. The Scoring Computer can do the same from its own copy of the seat picker.
- **Head Judge or Timekeeper:** there is no seat to release. Open the role on the backup tablet with its PIN and it is live at once (two Head Judge tablets open at the same time is allowed).

### Singles and duals on the same day

Seats are positional, so when the live event changes from single moguls to dual moguls (or back), a tablet in seat J3 silently changes from *T&L 3* to the *Air judge*, J4 from *Air 1* to the *Time judge*, and so on. That is only right when the same person sits in the same numbered seat in both panels. When the followed event's discipline changes, the role bar turns **amber** and says what this seat means in the new event ("Now following … (Dual Moguls). You are Air Judge in seat J3 here."). Each judge checks the bar: keep scoring if it is right, or press **Leave seat** and pick the seat that matches their role in the dual panel. The Timekeeper tablet reads *Disabled* during duals, where the Time judge scores time. Tap the amber bar to dismiss it.

### Who starts the first run of the day

Before any run has started, no event is "live" yet, so the Head Judge tablet follows a best guess (the meet's first event) and may not show the athlete the Chief of Scoring expects. This is by design: **the first run of an event is started by the Chief of Scoring from the Scoring Computer**, after everything has been checked — run order, judge panel, course specs. That first Start Run puts the event in the spotlight; from then on the Head Judge can start runs from the tablet as usual (when the meet's Advanced settings allow it).

### The Scoring Computer and the venue menu

The officials console on a venue server shows a **Venue Menu** link at the top of its left sidebar (in place of *Home*). It always reaches the menu — this is where the end-of-day actions live — and the computer keeps its role, so a reload still returns to the console. The meet page's **More ▾** menu on a venue server hides the cloud-only items (Release for Adoption, Clone Meet) and offers **Venue Menu (end of day)** instead.

### After Finalize

When the Head Judge finalizes an event and later reloads the tablet, it shows **Event Completed** rather than the Finalize page again. (Pressing Finalize twice was always harmless; the screen simply did not say so.)
