## Building run order

The **Run Order** section of the Registration tab determines the order athletes ski in for Run 1 (and Q1 for qualifier/finals events). Run 2 always reverses the standings of Run 1, so building Run 1's order well is the only operator decision.

### Four build modes

1. **Random Order** — shuffles all non-scratched athletes randomly.
2. **By Age Groups** — orders athletes by USSS age class (youngest first: U7 → U9 → U11 → U13 → U15 → U17 → U19 → Sr → Vet), randomized within each age group.
3. **Manual reorder** — click the **▲**/**▼** arrows on each athlete row to move them up or down one position.
4. **Save Order** — persists the current order to the database. Until you save, drags / shuffles are local only.

### Required-field gate

Run Order buttons are disabled until every non-scratched athlete has: first name, last name, USSS#, birth year. An amber warning above the section shows the count of incomplete athletes. (Bibs are *not* required — you can build the run order first and assign bibs by run-order order afterward.)

### Confirmations

- **Random Order** / **By Age Groups** — confirmation modal appears only if a saved order already exists. First-time builds skip the confirmation.
- **Save Order** — no confirmation; saves immediately.

### Hidden by default

The Run Order table is **hidden** until you've clicked a build button or until a saved order is loaded from the database. The header bar with the buttons stays visible — only the table inside is collapsed.

### Age Class column

Once you've used **By Age Groups**, an extra **Age Class** column appears showing each athlete's computed USSS age class. The age class is derived from `birth_year` and the meet's `event_date` per USSS season rules (July 1 start). This column is informational; bib assignment and other operations don't depend on it.

### How Run 2 order is determined

You don't build Run 2 order manually — the server reverses Run 1 standings automatically per FIS ICR 4205. Lowest-scoring athlete from Run 1 starts Run 2; highest-scoring athlete goes last. DNS / DNF / DSQ athletes from Run 1 are placed at the bottom in the order they appeared in Run 1.

For qualifier-finals events, the Final phase's run order similarly reverses qualifier standings, but only for the athletes that made the cut.

### Locking the order

Once the order is finalized, click **Lock Order** ([Locking run order](./reg-runorder-lock)). This:

- Disables all order-changing buttons.
- Adds a placement dialog whenever you add a new athlete or un-scratch a previously-scratched one.

Unlocking restores normal editability.

### Visual feedback

Saved run order rows show their position in the **Order** column. Unsaved local changes show position with an asterisk (`*`) until you click **Save Order**.
