## Manual athlete entry

When an athlete isn't in the USSS People file (a coach competing, an international guest, a last-minute addition with no USSS# yet), enter them manually.

### Steps

1. On the event's **Registration** tab, click **+ Add Athlete → Manual Entry**.
2. An inline form appears with these fields:
   - **First name** *(required)*
   - **Last name** *(required)*
   - **USSS #** *(required for USSS-sanctioned events)*
   - **Birth year** *(required)*
   - **Gender** *(required)*
   - **Club** *(optional)*
   - **FIS ID** *(optional)*
   - **Bib** *(optional — can be assigned later via [Bib assignment](./reg-bibs))*
3. Click **Add**. The athlete is created in your master Athletes table and registered for the event in one step.

### When to use manual entry

- The athlete is competing under a temporary USSS# that hasn't synced to the People file yet.
- The athlete is a guest from another federation (foreign juniors, IFSA / FIS-only athletes, etc.).
- You're scoring a non-sanctioned scrimmage and don't want to bother with USSS# at all.
- You're testing the system and need a test record fast.

### Required-field validation

The form refuses to save if a required field is missing. The Run Order buttons in the parent Registration section are gated on every non-scratched athlete having all required fields — so an incomplete manual entry will block run-order generation until you finish it.

### USSS# placeholders

If the athlete genuinely has no USSS# (e.g., a foreign athlete), you can use a placeholder like `0` or `FOREIGN-1`. Just be consistent within the meet. The TD will want this flagged in the report — use the **Notes** field on the registration row (if visible) to add context.

### ALL CAPS auto-correct

The same name normalization that applies to USSS sync and CSV import applies here — `SMITH` is saved as `Smith`. See [Athletes database](./athletes-db) for the full rules.

### What if the athlete name already exists?

If the entered USSS# matches an existing master Athletes row, that row is reused — no duplicate is created. If the name matches an existing row (by last+first+birth year), the existing row is updated with any new fields you've entered.

If you genuinely want a separate athlete record for someone with the same name (e.g., a junior and senior with identical names), differentiate by birth year — the master Athletes table treats `Smith, John (2005)` and `Smith, John (1985)` as distinct rows.
