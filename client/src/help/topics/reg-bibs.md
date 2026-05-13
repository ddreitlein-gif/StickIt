## Bib assignment

Each registered athlete needs a bib number per event. The **Assign Bibs** button in the **Registered Athletes** section header opens the bib-assignment modal with four modes.

### The four modes

1. **Random** — shuffles bib numbers 1..N (where N = registration count) randomly across athletes.
2. **By Run Order** — assigns positional bibs by current run order (bib 1 = first run, bib 2 = second run, etc.). Run order must exist for this to work.
3. **Copy from Event** — copies bib numbers from another event in the same meet (matched by USSS#). Useful when you want bib 7 to be the same athlete in both the mogul and aerials events of the same weekend. **Dual mogul events have a separate "Import Bibs from Event" button** in the Registered Athletes header — same mechanics.
4. **Fill In Missing** — keeps existing bibs and only assigns to athletes who don't have one yet.

### Conflict handling

If you pick a mode that would overwrite existing bibs (Random, By Run Order), a confirmation modal shows:
- The count of bibs that will be overwritten.
- A button **Confirm Overwrite** or **Cancel**.

If no overwrites are needed, the modal applies immediately.

### "Fill In Missing" rules

This mode behaves differently per parent mode:

| Parent mode | Fill In Missing behavior |
|---|---|
| **Random** | Assigns sequential bibs 1..N to anyone without a bib, skipping bibs already taken. |
| **Run Order** | **Errors** — positional bibs would conflict with the existing assignment. Cancel and pick another mode. |
| **Copy from Event** | Assigns bibs only from athletes that also exist in the source event by USSS#. |

### When to assign

- **Before the run order** is built — random or copy-from-event are fine. The run order then sorts by bib if you choose `By Bib` order.
- **After the run order** is built — By Run Order is the typical choice, so bib 1 = first competitor.
- **From the master Athletes default bib** — some clubs assign a season-wide default bib. The Athletes table has a default bib column; CSV imports respect it.

### Dual mogul bib import

For dual mogul events specifically, the **Registered Athletes** card header shows an **Import Bibs from Event** button (in addition to **Assign Bibs**). This opens an inline dropdown of same-meet, same-gender events; the import preview shows how many bibs will be copied, how many athletes have no match (skipped), and how many existing bibs will be overwritten. Confirm to apply.

This exists for dual mogul because dual mogul athletes are typically a subset of the mogul athletes from the same meet, and you want the bib numbers to align.

### Validation

Bibs must be **unique within an event** but can repeat across events. The server enforces uniqueness via a database constraint. If you try to manually set a duplicate bib via the inline-edit form, the save will fail with an error.
