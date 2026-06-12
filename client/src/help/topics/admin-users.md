## User management

The User Management page at `/admin/users` is full CRUD for StickIt login accounts. Accounts matter once [password protection](./admin-security) is enabled — with protection off, the app doesn't ask anyone to log in, but you can stage accounts and passwords ahead of time.

### Roles

Three roles, lowest to highest:

| Role | Access |
|---|---|
| **Judge** | Login only; the Officials dashboard is restricted to the Links area |
| **Official** | Full Officials section — meets, events, registration, scoring, reports |
| **System Admin** | Everything, including this Admin panel |

A higher role can do everything a lower role can. (Accounts created in older versions with the legacy `event_admin` role are automatically migrated to System Admin.)

### The users table

Each row shows username, display name, role, a **Password** column (Set / Not set), and active status. The Password column is the quick pre-flight check before enabling protection — anyone marked **Not set** cannot log in.

### Adding a user

1. Click **+ New User**.
2. Fill in username, display name, role, and a password.
3. Click **Create**.

### Editing

Click **Edit** on any row to change display name, role, active status, or to set / reset the password. Usernames cannot be changed (they're the de facto key).

### Deactivating

Click **Deactivate** (a confirmation is required). Sets the account inactive — the user can no longer log in, but the row remains so audit history stays intact. Two guard rails protect you here:

- You cannot deactivate **your own** account.
- You cannot deactivate the **last active System Admin** — there must always be at least one admin who can get back in.

### Audit log

User creates, edits, and deactivations are logged. View on the [Audit log](./admin-audit) page.

### Bulk user import

There's no bulk import. For an organization onboarding many users, add them one at a time via the form.
