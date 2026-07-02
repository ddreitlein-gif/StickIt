## USSS transmit XML

For USSS-sanctioned events, the official results must be submitted to USSS in their **TransmitFreestyleResultsXML** format. StickIt generates one XML file per event and bundles the whole meet into a single zip.

### When to transmit

Per the USSS rule book, sanctioned events must transmit results within a defined window (typically 72 hours of event completion). The Race Administrator / TD is responsible for the final transmission.

### How to generate

1. Open the meet detail page.
2. Click **More ▾** → **USSS Transmit**.
3. The popup lists every event in the meet with a readiness check (✓ or ✗) and shows the derived category and USSS code for each.
4. Click **Generate Transmit File**. The browser downloads `SF<code>.ZIP` containing one XML per event (`SF<code>_<gender>_MO.xml`, `_DM.xml`, or `_AE.xml`).
5. **Email the downloaded file to results@ussa.org.** StickIt does not upload anything itself.

Everything is derived automatically — no category dropdown, no typed event IDs:

| Value | Source |
|---|---|
| USSS code (`NAT_code`) per event | The **USSS Code** field on each event's page |
| Category (DIV / EQS / ROC) | The event's division (Comp Series → DIV, RQS-EQS → EQS, Devo → ROC) |
| Technical Delegate (DIV/DIC only) | The **Technical Delegate** in the meet's Officials list (name + USSS #) |

### Requirements — the transmit blocks until everything is ready

If **any** event in the meet has a problem, nothing is generated and the popup lists every issue:

- Every event must have status **Complete**.
- Every event must have its **USSS code** set (on the event page).
- Every event's division must map to a USSS category.
- Mogul / dual events need turns judges assigned; aerials events need judges assigned.
- When any event's category is DIV/DIC, a **Technical Delegate** with a USSS number must be assigned in the meet's Officials section.

Athletes missing a USSS member number are a **warning**, not a block — the popup lists them by name and bib and lets you proceed anyway.

### What's in each XML

- **Race header** — season, USSS code, category, discipline (MO / DM / AE), race date, event name, place, and the TD block for DIV/DIC.
- **Results** — every athlete in rank order with USSS member number, name, birth year, nation (defaults to `USA`), bib, run scores, and total.
- **Judges panel** — scoring judges and Head Judge with USSS official numbers, plus meet officials (Chief of Competition, Chief of Score, etc.).
- **Not-classified block** — DNS / DNF / DSQ athletes (see below).

### Athletes with no valid result (DNS / DNF / DSQ)

Athletes whose **every** run carried a status are not silently dropped — they appear in the XML's not-classified block (`<FS_notclassified>`) with their bib, competitor info, and a single resolved status (precedence: DSQ, then DNF, then DNS across the athlete's runs). Entries are ordered DNF, then DNS, then DSQ. A legacy `RNS` status is emitted as `DNF` — the stored data is untouched; only the XML output maps it. For dual mogul, an athlete who never won a match and was eliminated by status appears not-classified; an athlete who won at least one match before losing by status keeps their bracket placement in the classified list. All emitted status codes (`DNS`, `DNF`, `DSQ`) are FIS-standard.

### Tie-break in the XML

Ranks in the XML use the FIS-compliant tie-break (see [Tie-break rules](./results-tiebreak)), so the order matches the PDF Event Results Summary.

### Nation field

Defaults to `USA` when `athletes.nation` is blank. This is preserved in the DB column even though the UI has dropped the Nation column from athletes editing. To set a non-USA nation for a foreign athlete, edit the athlete via direct API or use the Admin Athletes management.

### Transmit failures

If USSS rejects the XML:

1. Open it in a text editor and look for obvious errors (missing USSS#, malformed date, wrong USSS code).
2. Fix in StickIt and re-generate.
3. Re-email the new file to results@ussa.org.

### Verification

After generating, unzip and eyeball the XML files in a text editor:

- Is there one file per event, named with the right USSS code?
- Are all athletes present?
- Is the rank order correct?
- Are DNS / DNF / DSQ statuses encoded?
- Is the panel of judges complete?

Cross-check against the Event Results Summary PDF — both come from the same `rankResults` call, so they should match exactly.
