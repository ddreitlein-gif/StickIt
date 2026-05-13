## Registering athletes for an event

Once an event is created, its **Registration** tab is where you list every athlete competing in that event. Each row links a master athletes record to this event, with a per-event bib number, run order, and status.

### Five ways to add athletes

1. **From USSS Database** (fastest) — search the master USSS People file and add directly. The athlete is auto-created in your master Athletes table if not already there. See [Importing from USSS People database](./reg-usss).
2. **From SkiReg CSV** — bulk import the entire entry list from SkiReg. See [Importing from SkiReg CSV](./reg-skireg).
3. **From Master Athletes Database** — search your local Athletes table.
4. **Manual Entry** — fill in the form by hand. See [Manual athlete entry](./reg-manual).
5. **Import Bibs from Event** (dual mogul only) — for dual events, copy bib numbers from the qualifier mogul event of the same gender (so bib 7 is bib 7 in both events).

### Required fields

Every registered athlete must have:

- First name
- Last name
- USSS #
- Birth year
- Gender

A row missing any of these gets a **red row background** in the Registration table. Athletes with everything except a bib get a **yellow row background**.

> As of v1.16.31, the Run Order buttons and dual mogul seeding buttons are **not** blocked by missing bibs — you can build the run order first, then assign bibs in run-order order. They *are* blocked by missing names / USSS# / birth year.

### Status

Each registration has a status: **Registered** (default) or **Scratched**. Scratched athletes are excluded from the run order and from results — but they remain in the table so you can un-scratch them if they show up.

The DNS / DNF / DSQ statuses you may have seen elsewhere are **run statuses**, not registration statuses. They're applied during scoring, not at the registration step. See [Run statuses](./scoring-statuses).

### Bib numbers

Bibs can be assigned several ways — see [Bib assignment](./reg-bibs). The bib is per-event: an athlete can have bib 7 in the mogul event and bib 14 in the aerials event of the same meet.

### Run order

Once the registration list is built, expand the **Run Order** section to build the order athletes will compete in. See [Building run order](./reg-runorder).

### Collapsible sections

Both **Registered Athletes** and **Run Order** sections are collapsible (chevron toggle, default collapsed). They auto-expand when you add an athlete (any path) or when you modify the run order. The header bar with action buttons stays visible when collapsed.

### Removing an athlete

Click the trash icon on an athlete's row. The registration is deleted; the athlete remains in your master Athletes database. If the athlete already has runs recorded, removing the registration will also remove those runs — confirmation modal appears first.
