## Broadcast Board (results board for the stream)

The Broadcast Board at `/broadcast/<short>` is a **1920x1080 full-screen results board** for the live-stream crew.  It is the page to cut to during breaks and delays between athletes: leaders, the latest result, who is still to come, the dual pairings, and the final placings.  It is a second broadcast source beside the [Overlay](./public-overlay); the Overlay stays the lower-thirds graphic while an athlete is on course, and the board fills the screen between athletes.

### Where the link is

Open the event → **Links** tab → **Display** card → **Broadcast Board**.  The row has the usual QR, Copy, and Open buttons.  The address is public: no login, reached only by the event's short code.

The public Scoreboard page is unchanged and still opens from [Live Scores](./public-livescores).

### Adding it as a browser source

1. In OBS, add a **Browser Source** and paste the Broadcast Board address.  Set width 1920, height 1080.
2. On a YoloBox, add a URL / web source with the same address.
3. The background is **opaque** (a light blue ground with navy header and footer bands), so the board is meant to be a full-screen scene, not a layer over video.
4. Any other size scales to fit: the whole 1920x1080 stage shrinks or grows to the window and letterboxes on the ground colour.

### What it shows

The board picks its pages from the event's data.  There is nothing to operate.

**Moguls and aerials**

- **Leaders**: ranks 1 to 8 with rank, bib, name, run time, and total.  A longer field pages 9 to 16, 17 to 24, and so on.  Medal colours mark places 1 to 3 only.  Athletes with a DNF, DNS, or DSQ never appear on the leader pages.
- **Still To Come**: the next three starters from the run order, with bib, name, and team.  When the round is finished it reads "Round complete".
- **Meet logo panel**: the meet's event logo (and the bottom / sponsor logo when one is uploaded on the PDF Reports tab) below Still To Come.  With no logo uploaded the panel is omitted.
- **Latest Result**: once a score has been published in the current round, a hero page alternates with the leader pages: bib, name, time, total, and the athlete's current position ("NOW 2ND") in the combined standings, above the top five with the athlete's row outlined.  The footer says UNOFFICIAL.
- **Start list**: before the first score the leader panel shows the start order instead.
- Aerials events use the same pages with the time column blank.

**Dual moguls**

- **Round board**: the current round's pairings numbered as on the bracket sheet, blue skier left and red skier right.  Completed pairings show the five-judge split as two chips (winner in the course colour, loser grey).  The next pairing carries a navy outline and a NEXT tab; later pairings read TO RUN.  A round with more than eight pairings pages eight at a time.
- **Coming up**: the navy strip below lists the next block's pairings.  A side the bracket has not filled yet reads "Winner of 11" or "Loser of 12" (the feeder pairing's number) and carries no course colour.  The athlete appears on blue or red only once the bracket has placed them there, so the board can never disagree with the bracket.
- **Finals block**: once the semifinal block is complete the four finals are listed championship first, 7th / 8th last, each with its pairing number, so the crew can see the block fills from the bottom up.  The championship row carries a gold rule.
- The semifinal block lists both 5th – 8th place semifinals and both semifinals with a label on each row.

**Final placings**

- A podium (2, 1, 3) plus places 4 to 10 in a table; longer fields page 11 to 17 and so on.
- The badge reads **UNOFFICIAL** as soon as every run (or the championship final) is complete, and switches to **OFFICIAL** when the Head Judge finalizes the event.
- Dual events show rank, bib, and name only: no scores in the table and no totals on the podium.
- The footer names the format: Two runs, best counts · Single run · Qualifier + Finals · Dual bracket.

### Page timing

Pages rotate every **12 seconds**.  Add `?page=` to the address to change it, from 4 to 30 seconds (for example `/broadcast/AB12CD?page=20`).  The small bars at the right of the footer show the position in the cycle.  A data refresh never restarts the timer; a page simply redraws in place when its numbers change.

### Read-only

The board never shows an on-course athlete and never carries a LIVE badge (viewers also watch replays).  It has no buttons, links, or scrollbars, and ignores clicks and keys.  It updates over the same live connection the Scoreboard uses, with a three-second fallback poll for hardware encoders that drop the connection.  It works the same on the cloud and on a venue StickIt box (no internet needed once the page is open).
