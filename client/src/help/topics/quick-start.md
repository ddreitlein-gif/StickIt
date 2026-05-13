## Quick start: Run your first meet

This is the smallest end-to-end flow — create a meet, add an event, register a few athletes, score them, and publish results. About 20 minutes from start to finish.

### 1. Create a meet

1. From the home page click **Officials** to enter the dashboard.
2. Click **+ New Meet**.
3. Enter a name, location, and date. Save.

You're now on the meet detail page.

### 2. Add an event

1. Click **+ Add Event**.
2. Choose **Mogul** discipline, **Comp Series** category, **Male** gender. The event auto-names itself "Comp Series Male Mogul".
3. Save. The event card appears.

### 3. Set course specifications

Scroll down on the meet page to **Course Specifications**. Enter a course length (e.g. `220` meters) and confirm the pace standard. **USSS** is the default (9.70 m/s men, 8.20 m/s women). Pace times calculate automatically. See [Course specifications](./meets-course-specs) for details.

### 4. Click into the event

Click the event card to open the event detail page. You'll see tabs at the top: **Setup**, **Registration**, **Scoring**, **Results**, **Phases**, **Links**, etc.

### 5. Register athletes

Go to the **Registration** tab. The fastest path:

1. Click **+ Add Athlete** and use the **From USSS Database** picker if you've synced the USSS People file (see [USSS sync](./reg-usss)). Otherwise click **Manual Entry**.
2. Add at least 2 athletes. Each needs a first name, last name, USSS#, birth year, and bib number.
3. The Run Order section appears once registrations exist. Click **Random Order** to shuffle, or **By Age Groups** to group U-class first.
4. Click **Save Order**.

### 6. Add judges

Go to the **Setup** tab.

1. Click **+ Add Judge** and add 3 T&L judges (TL1/TL2/TL3) and 2 Air judges (Air1/Air2). Give each a name and a PIN.
2. Click **Links**. Each judge has a unique tablet URL. Open the T&L1 URL in a separate browser tab to simulate a judge tablet.

### 7. Score one run

1. Back on the **Scoring** tab, click **Start Run** for the first athlete.
2. On each judge tablet, enter scores for the run. Submit.
3. Once all judges have submitted (and the timekeeper has entered a time), the Head Judge tablet shows the full score for review.
4. On the HJ tablet, click **Approve & Submit**.
5. The run is finalized — the score appears on the **Results** tab and on the public scoreboard.

### 8. Publish results

Click **Reports** (or the PDF icons in the **Results** tab) to generate the **Event Results Summary** PDF. That's the document you hand to the TD.

### Where to go next

- [Reading the results table](./results-table) explains what every column means.
- [Live scoring flow](./scoring-live) covers the full live-scoring loop in more detail.
- [Importing from SkiReg CSV](./reg-skireg) is the production workflow for registering 30+ athletes at once.
