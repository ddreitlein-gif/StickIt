## USSS transmit XML

For USSS-sanctioned events, the official results must be submitted to USSS in their **TransmitFreestyleResultsXML** format. StickIt generates this XML on demand.

### When to transmit

Per the USSS rule book, sanctioned events must transmit results within a defined window (typically 72 hours of event completion). The Race Administrator / TD is responsible for the final transmission.

### How to generate

1. Open the event detail page.
2. Click **Reports** → **Transmit XML**.
3. The browser downloads `transmit_<sanction-id>.xml`.

The endpoint is `GET /api/events/:eventId/transmit.xml`. Returns `application/xml`.

### What's in the XML

- **Meet header** — sanction ID, name, location, dates, organizing club, division.
- **Event** — discipline, gender, category, course details.
- **Results** — every athlete in rank order with:
  - USSS member number
  - First / last name
  - Birth year, gender
  - Club (club code per USSS People file)
  - Nation (defaults to `USA` if blank)
  - FIS ID (if present)
  - Place
  - Total score
  - Status code for DNS / DNF / DSQ if applicable
- **Judges panel** — every judge's name, role, and USSS official number (if available from People file lookup).
- **Course specs** — length, pace standard.

### Required fields

For the XML to be accepted by USSS:

- Every athlete must have a USSS member number.
- The meet must have a sanction ID (set on the meet's edit modal).
- Date and location must be present.

Missing data will produce XML with empty fields — USSS will likely reject. Use the [Athletes database](./athletes-db) and [Importing from USSS People database](./reg-usss) flows to ensure data completeness before transmit.

### Athletes with no valid result (DNS / DNF / DSQ)

Athletes whose **every** run carried a status are not silently dropped — they appear in the XML's not-classified block (`<FS_notclassified>`) with their bib, competitor info, and a single resolved status (precedence: DSQ, then DNF, then DNS across the athlete's runs). Entries are ordered DNF, then DNS, then DSQ. A legacy `RNS` status is emitted as `DNF` — the stored data is untouched; only the XML output maps it. For dual mogul, an athlete who never won a match and was eliminated by status appears not-classified; an athlete who won at least one match before losing by status keeps their bracket placement in the classified list. All emitted status codes (`DNS`, `DNF`, `DSQ`) are FIS-standard.

### Tie-break in the XML

Ranks in the XML use the FIS-compliant tie-break (see [Tie-break rules](./results-tiebreak)), so the order matches the PDF Event Results Summary.

### Nation field

Defaults to `USA` when `athletes.nation` is blank. This is preserved in the DB column even though the UI has dropped the Nation column from athletes editing. To set a non-USA nation for a foreign athlete, edit the athlete via direct API or use the Admin Athletes management.

### Transmit failures

If USSS rejects the XML:

1. Open it in a text editor and look for obvious errors (missing USSS#, malformed date, missing sanction ID).
2. Fix in StickIt and re-generate.
3. Re-submit.

There's no in-app "transmit" button that actually POSTs to USSS — StickIt only generates the file. The TD / Race Administrator handles the upload to USSS's transmit endpoint manually.

### Multi-event meets

Each event generates its own XML. For a six-event weekend, you'll transmit six XML files. (USSS's submission portal accepts one event at a time.)

### Verification

After generating, eyeball the XML in a text editor:

- Are all athletes present?
- Is the rank order correct?
- Are DNS / DNF / DSQ statuses encoded?
- Is the panel of judges complete?

Cross-check against the Event Results Summary PDF — both come from the same `rankResults` call, so they should match exactly.
