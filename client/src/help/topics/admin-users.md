## User management

The User Management page at `/admin/users` is full CRUD for StickIt login accounts. Accounts matter once [password protection](./admin-security) is enabled — with protection off, the app doesn't ask anyone to log in, but you can stage accounts and passwords ahead of time.

### Roles

Two roles:

| Role | Access |
|---|---|
| **Judge / Official** | The full Officials section — meets, events, registration, scoring, reports, exports. No Admin panel. |
| **System Admin** | Everything, including this Admin panel |

System Admin can do everything Judge / Official can. Changing a user's role never touches their password or signs them out — it is a one-field edit. (Accounts from older versions are migrated automatically at startup: the former login-only **Judge** role becomes Judge / Official, and the legacy `event_admin` role becomes System Admin.)

### The users table

Each row shows username, display name, role, a **Password** column (Set / Not set), and active status. The Password column is the quick pre-flight check before enabling protection — anyone marked **Not set** cannot log in.

### Adding a user

1. Click **+ New User**.
2. Fill in username, display name, role, and a password.
3. Click **Create**.

### Editing

Click **Edit** on any row to change username, display name, role, active status, or to set / reset the password. To move a user between the two roles, change only the **Role** drop-down and save — the password is left as it is and no password change is forced.

### Deactivating

Click **Deactivate** (a confirmation is required). Sets the account inactive — the user can no longer log in, but the row remains so audit history stays intact. Two guard rails protect you here:

- You cannot deactivate **your own** account.
- You cannot deactivate the **last active System Admin** — there must always be at least one admin who can get back in.

### Audit log

User creates, edits, and deactivations are logged. View on the [Audit log](./admin-audit) page.

### Bulk user import

There's no bulk import. For an organization onboarding many users, add them one at a time via the form.
