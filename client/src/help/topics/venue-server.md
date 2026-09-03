## The venue server (StickIt box)

The venue server is a small computer (a Raspberry Pi in the kit, or a Mac in an emergency) that runs StickIt at the hill. Tablets score against it over the venue's own network, so scoring never depends on the internet. Every score is queued locally and sent up to stickitski.com the moment a connection exists, and the public Live Scores page and the iOS app follow along. The printed run sheets (Kit Setup, Adopt the Meet, Tablets, Livestream, End of Day) are the volunteer script; this topic is the reference behind them.

### How a meet gets to the venue

1. The meet is built on stickitski.com as usual: events, registrations, judges, run orders, course specs.
2. An official opens the meet page → **More ▾ → Release for Adoption** and reads the one-time 8-character code to the venue.
3. On any tablet at the venue, open `http://stickit.local:3001`, type the code into **Adopt Meet**, and set the two PINs when asked. From that moment the cloud copy is a read-only mirror ("running at the venue" banner) and the venue server is the authority.
4. Every tablet then picks a role from the venue menu — see [Venue tablets: roles, seats, changing role](./venue-tablets).

If the internet is down at adoption time, the official can instead export the meet as a file ("Export for Adoption") and the venue imports it from a USB stick.

### The two PINs

| PIN | Opens |
|---|---|
| **Control PIN** | Scoring Computer (the full officials console), Head Judge, force-releasing a seat, Hand Back / Check In, software update |
| **Crew PIN** | Judge seats, Timekeeper |

The Scoreboard needs no PIN. Write both PINs on the adoption run sheet.

### End of day

Both actions live on the venue menu, reached from the Scoring Computer's sidebar link **Venue Menu** (or by pressing **Change role** on any tablet). Both need the Control PIN and verify every score against stickitski.com before anything unlocks; if the cloud is unreachable, nothing is lost — leave the box powered, restore the internet, and press the button again.

- **Hand Back to Cloud** — for a multi-day meet. Scoring stops on the venue for the night; the cloud becomes editable again so brackets and run orders can be built there. In the morning the official releases the meet again with a NEW code and the venue adopts it, replacing its local copy when offered.
- **Check In Meet** — the meet is finished. The results become the permanent cloud record and scoring on the venue closes for good. Judge, Head Judge and Timekeeper tablets show a "checked in — you can stop" screen; the Scoreboard TV and the overlay keep showing results for awards.

### The backup stick

The kit's USB backup stick receives a full copy of the scoring database every 5 minutes (the home screen warns when it is missing — scoring still works without it). Format it once on a Mac: Disk Utility → select the stick → Erase → Name **`STICKITSNAP`** (exactly 11 characters, no hyphen), Format **ExFAT**, Scheme **Master Boot Record**. ExFAT is the only supported format; the Mac can read the snapshots directly if they are ever needed.

### Software updates

With no meet adopted and the internet reachable, the venue menu shows **Update StickIt** when a newer release exists. Press it at home the week before a meet (Control PIN); the box restarts itself in a minute or two.

### If something looks wrong

The home screen's **Sync** line is the first thing to read: *Up to date*, *N queued* (changes waiting for the internet), *Offline since HH:MM*, or a red *adoption revoked* banner (call the office). Nothing on the venue is ever discarded; the box keeps everything locally and the backup stick holds the last 20 snapshots. For diagnosis after the fact, the box's own journal records every snapshot result and every sync state change (offline, back online, drained).
