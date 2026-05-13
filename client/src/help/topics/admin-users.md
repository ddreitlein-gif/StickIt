## User management

The User Management page at `/admin/users` is full CRUD for StickIt user accounts. As of the current release, authentication is a **placeholder** — the middleware passes through without verifying credentials, so the password field on the user form is **disabled**. User accounts are pre-staged for when authentication ships.

### Schema

The `users` table holds:

- `id` — auto-generated UUID
- `username` — unique login name
- `display_name` — shown in UI
- `role` — `official` / `event_admin` / `system_admin`
- `is_active` — `1` (default) or `0` (deactivated)
- `password_hash` — currently always blank; will be populated once auth is enabled

### Adding a user

1. Click **+ New User** on the Users page.
2. Fill in:
   - Username
   - Display name
   - Role
3. Password field shows "Authentication coming in a future build" and is disabled.
4. Click **Create**. The user appears in the table.

### Editing

Click the **Edit** pencil on any row:
- Change display name, role, or active status.
- Username cannot be changed (it's the de facto key).

### Deactivating

Click the **Deactivate** button. Sets `is_active=0`. The user doesn't show in the active list anymore; they remain in the DB so any audit log references still work.

### Roles (forward-looking)

When authentication ships:

- **system_admin** — full access to everything including this Admin panel.
- **event_admin** — full access to event setup and scoring; cannot manage users or change system settings.
- **official** — scoring-only access; can run meets but cannot create events from scratch.

The roles are stored now so the future auth rollout can apply them without a separate migration.

### Activating authentication (future)

To enable real authentication:

1. Install `bcrypt` and `jsonwebtoken` packages.
2. Implement `POST /api/auth/login` to verify the password hash and issue a JWT.
3. Update `server/middleware/auth.js`: `requireAuth` should verify JWT; `requireRole` should check role.
4. Update `AuthGuard.jsx` on the client to redirect to `/login` if not authenticated.
5. Create a Login page at `/login`.
6. Enable the password hash field on this Users page.

The "Login Required" divider on the home page is already in place for that future state.

### Audit log

Every user create/edit/deactivate is logged in `audit_log`. View on the [Audit log](./admin-audit) page.

### Bulk user import

There's no bulk import yet. For an organization onboarding many users, you'll need to add them one at a time via the form. A CSV import is on the future roadmap.
