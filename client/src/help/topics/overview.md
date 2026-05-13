## App overview & user roles

StickIt is split into four zones, each with its own URL space and visual style. Knowing which zone you're in tells you which sidebar and which permissions apply.

### The four zones

| Zone | URL | Sidebar | Who uses it |
|---|---|---|---|
| **Public** | `/`, `/livescores`, `/scoreboard/...`, `/overlay/...` | None — full-screen | Spectators, broadcasters, anyone with the link |
| **Officials** | `/dashboard/...` | Officials sidebar (Meets, Athletes, Information) | Chief of competition, scoring operators |
| **Tablets** | `/judge/...`, `/aerials-judge/...`, `/headjudge/...`, `/timekeeper/...` | None — full-screen tablet UI | Judges and Timekeepers, one tablet per role |
| **Admin** | `/admin/...` | Admin sidebar (Dashboard, Users, Events, etc.) | System administrators |

A meet director typically lives in the Officials zone all day, only opening Admin to handle a backup or a user account.

### What each role does

**Officials** create meets, add events, register athletes, build the run order, generate tablet URLs for the judges, run the live scoring, finalize results, and produce PDFs / CSV exports for the TD report and USSS submission. The bulk of this guide is for them.

**Judges** open one URL on a tablet at the start of the day, sign in with a PIN, and submit scores run after run. They never see the meet setup or the master databases. Each judge tablet is locked to one event and one role.

**Admins** look after the system: creating user accounts (when authentication ships), locking events to prevent accidental edits, syncing the USSS People database, viewing the audit log, and managing automatic backups.

**The public** doesn't sign in. They open `/livescores` to see what's happening across the system, click through to a `/scoreboard/<short>` for a specific event, or watch the `/overlay/<short>` broadcast view fed into OBS or a YoloBox.

### Roles within scoring

Inside a single event, scoring breaks down further:

- **T&L Judges** (3 for Comp Series, 2 for Devo / RQS-EQS) — score Carving, Absorption / Extension, Upper Body, and Deduction (or a single raw score in non-component mode).
- **Air Judges** (2 for Comp Series, 1 for Devo / RQS-EQS) — score each jump per athlete, also enter the jump codes.
- **Aerials Judges** (panel of 2–7) — score Air, Form, and Landing per jump per judge.
- **Timekeeper** — enters run time after each athlete finishes.
- **Head Judge** — reviews and approves each athlete's full score, can send back individual judge submissions for re-entry, and finalizes the event at the end.

The next topic, [Quick start: Run your first meet](./quick-start), walks the smallest possible end-to-end flow.
