## The venue server (StickIt box)

The venue server is a small computer (a Raspberry Pi in the kit, or a Mac in an emergency) that runs StickIt at the hill. Tablets score against it over the venue's own network, so scoring never depends on the internet. Every score is queued locally and sent up to stickitski.com the moment a connection exists, and the public Live Scores page and the iOS app follow along. The printed run sheets (Kit Setup, Adopt the Meet, Tablets, Livestream, End of Day) are the volunteer script; this topic is the reference behind them.

### How a meet gets to the venue

1. The meet is built on stickitski.com as usual: events, registrations, judges, run orders, course specs.
2. An official opens the meet page → **More ▾ → Release for Adoption…**. The dialog shows the one-time 8-character code and offers **Also save a backup adoption file** (recommended, ticked by default) — save it onto the USB drive that travels with the scoring laptop.
3. On any tablet at the venue, open `http://stickit.local:3001`, type the code into **Adopt Meet**, and set the two PINs when asked. From that moment the cloud copy is a read-only mirror ("running at the venue" banner) and the venue server is the authority.
4. Every tablet then picks a role from the venue menu — see [Venue tablets: roles, seats, changing role](./venue-tablets).

**No internet at the venue?** Plug the USB drive into the scoring laptop, open the venue menu, and use **Import from file** with the backup adoption file — the meet loads exactly as it would by code. Two things to know about the file:

- The cloud copy **locks the moment the file is saved** (a venue could import it at any time), and the code keeps working — whichever reaches the cloud first wins. The meet page shows an amber "adoption file created, waiting for the venue" banner until then, with **Undo & unlock** and **Download adoption file again** (the earlier file stops working) available until the venue has synced.
- If the code was used after the file was made, the file is stale: a venue that imports it shows the red "adoption revoked" banner as soon as it tries to sync. Abandon that adoption and use the current code or a fresh file.

### The two PINs

| PIN | Opens |
|---|---|
| **Control PIN** | Scoring Computer (the full officials console), Head Judge, force-releasing a seat, Hand Back / Check In |
| **Crew PIN** | Judge seats, Timekeeper |

The Scoreboard needs no PIN. Write both PINs on the adoption run sheet.

**PINs last one calendar day.** They are good only on the day they were set (the box's local date). The next morning the venue menu shows the *New day — set today's two PINs* card, and the Head Judge, Scoring Computer, Judge and Timekeeper tiles wait until it is filled in; yesterday's PINs are refused. Setting the new day's PINs needs no old PIN, and it logs out yesterday's Scoring Computer session (it simply asks for the new Control PIN). Tablets that remembered a judge seat, the Head Judge or the Timekeeper keep working — they only ask a PIN when a role is picked.

### End of day

Both actions live on the venue menu, reached from the Scoring Computer's sidebar link **Venue Menu** (or by pressing **Change role** on any tablet). Both need the Control PIN and verify every score against stickitski.com before anything unlocks.

- **Hand Back to Cloud** — for a multi-day meet. Scoring stops on the venue for the night; the cloud becomes editable again so brackets and run orders can be built there. In the morning the official releases the meet again with a NEW code and the venue adopts it, replacing its local copy when offered.
- **Check In Meet** — the meet is finished. The results become the permanent cloud record and scoring on the venue closes for good. Judge, Head Judge and Timekeeper tablets show a "checked in — you can stop" screen; the Scoreboard TV and the overlay keep showing results for awards.

**No internet at the end of the day?** When the cloud is unreachable, the same dialog offers **Return via file instead** (it is also available any time from the small "No internet?" link under the two buttons). Scoring stops on the venue exactly as with a normal Hand Back or Check In — this is final — and the box writes a *return file*: a complete, self-checking copy of the meet. The home screen then shows a **Return file** card:

1. Press **Download return file** (Control PIN) on the scoring laptop and put the file on the USB drive (the venue box is `http`, so browsers save it to Downloads first — copy it across).
2. From any computer with internet, open the meet on stickitski.com → **More ▾ → Import venue return file…** (or Admin → Venue Adoption). The dialog shows whether the venue chose Hand Back or Check In and lets you change it, then imports and verifies every score.
3. The card's cloud line tells you when stickitski.com has received the meet. If the box itself gets internet back first, **Send to cloud now** delivers the file directly.

For a two-day meet returned by file, import the file on the cloud **before** releasing the meet again in the morning — the cloud stays locked until the file is in. A copy of every return file also lands on the backup stick when it is plugged in.

### The backup stick

The kit's USB backup stick receives a full copy of the scoring database every 5 minutes (the home screen warns when it is missing — scoring still works without it). Format it once on a Mac: Disk Utility → select the stick → Erase → Name **`STICKITSNAP`** (exactly 11 characters, no hyphen), Format **ExFAT**, Scheme **Master Boot Record**. ExFAT is the only supported format; the Mac can read the snapshots directly if they are ever needed.

### Software updates

With no meet adopted and the internet reachable, the venue menu shows **Update StickIt** when a newer release exists. Press it at home the week before a meet — no PIN is needed; the box refuses only while a meet is on it. The card then shows each step (looking up the release, downloading, installing, restarting), the box restarts itself in a minute or two, and the page reloads on the new version.

If anything goes wrong the card says so in red — *Update failed* with the reason and a **Show details** log — and the box stays on the version it had (an update whose server never comes back is rolled back automatically). Press **Update StickIt** again once the cause (usually the internet) is fixed. Over SSH the same job is `sudo /opt/stickit/update-stickit.sh`; the last run's log is `/opt/stickit/data/update.log`.

### If something looks wrong

The home screen's **Sync** line is the first thing to read: *Up to date*, *N queued* (changes waiting for the internet), *Offline since HH:MM*, or a red *adoption revoked* banner (call the office). Nothing on the venue is ever discarded; the box keeps everything locally and the backup stick holds the last 20 snapshots. For diagnosis after the fact, the box's own journal records every snapshot result and every sync state change (offline, back online, drained).
