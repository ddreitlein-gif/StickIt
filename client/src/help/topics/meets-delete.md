## Deleting a meet

Deleting a meet is permanent and **cascades**. Every event, registration, run, judge score, judge, dual bracket match, dual judge points, phase, phase run-order entry, run-round status entry, and audit log entry under that meet is removed.

### Steps

1. Open the meet from the dashboard.
2. Click **Delete Meet** in the meet header.
3. A confirmation modal appears showing the meet name. Type the meet name to confirm (or, depending on version, click the destructive **Delete** button — never gated on accidental clicks).
4. Click **Delete**. You're returned to the dashboard.

### What you should do *first*

Before deleting:

- **Export the meet** ([Exporting a meet](./meets-export)) so you have a permanent backup. The auto-backup system will also have a snapshot, but a fresh dedicated export is the safest path.
- **Check the audit log** ([Audit log](./admin-audit)) if there's any chance the meet contains scores you need for a TD report.
- **Verify scores have been transmitted** to USSS if applicable — see [USSS transmit XML](./reports-transmit).

### Cannot-undo warning

There is no soft-delete on meets. Once you click confirm, the rows are removed from the database. Recovery requires either:

- Importing your local export back in (see [Importing a meet from file](./meets-import))
- Restoring from an automated backup (see [Backups](./admin-backups))

### When deletion is appropriate

- A meet was created by mistake (wrong date, wrong sanction, wrong year).
- A test meet with synthetic data is no longer needed.
- A meet has been finalized, all PDFs have been generated, USSS XML has been transmitted, and you're cleaning up old data.

### When to use Lock instead

If your goal is "stop people from changing this meet" but you want to keep the data, use **Lock** at the event level (see [Locking & unlocking events](./events-lock)) or in the [Admin events page](./admin-events). Locked events become read-only but the data stays intact and stays visible on public scoreboards.

### Deletion does not affect

- The master Athletes database — athlete rows live independently of any meet.
- The USSS People database — system-wide.
- Backup files — those are separate.
- Other meets — only the meet you confirmed is removed.
