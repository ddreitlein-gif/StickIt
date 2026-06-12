## Password protection & login

StickIt ships with password protection **off** so a brand-new install works immediately. When you're ready to put the server on an open network (or the internet), turn protection on from **Admin → Security**. With protection on, every Officials and Admin page requires a login; the public and judging surfaces keep working without one.

### What stays public — always

These are never behind the login, by design:

- **Judge / Head Judge / Timekeeper / Aerials tablets** and all their scoring endpoints — secured only by their unguessable short-code URLs. Enabling protection mid-meet can never lock judges out.
- **Public pages** — Home, Live Scores, Scoreboard, the broadcast Overlay, and this Help guide.
- The PDF downloads reachable from the public Scoreboard (detailed results, dual bracket, dual place list).

### What the login protects

- The entire **Officials** section — meets, events, registration, scoring, exports, training days, USSS transmit.
- The entire **Admin** panel (System Admin role required).

### Roles

| Role | Can do |
|---|---|
| **Judge** | Log in; Officials dashboard restricted to the Links area |
| **Official** | Full Officials section — run meets end-to-end |
| **System Admin** | Everything, including the Admin panel |

Roles are managed on the [User management](./admin-users) page.

### Enabling protection

1. Go to **Admin → Users** and set a password on at least one **System Admin** account. The Security page will refuse to enable protection until an admin password exists — otherwise you'd lock yourself out.
2. Go to **Admin → Security** and click **ENABLE PASSWORD PROTECTION**.
3. The Home page divider switches to **LOGIN REQUIRED**, and the Officials / Admin buttons route through the login page.

Disabling works the same way — the **DISABLE PASSWORD PROTECTION** button on the same page.

### Sessions & login behavior

- Login sessions last **12 hours**, and survive server restarts and redeploys.
- Repeated failed logins are throttled: 10 failures for the same username or address within 15 minutes blocks further attempts temporarily.

### Tips

- Check the Users table's **Password** column ([User management](./admin-users)) to see who has a password set before enabling protection.
- The Admin Dashboard shows whether a fixed JWT secret is configured via environment variable; without one, StickIt generates and persists its own automatically.
- If you ever lock yourself out, protection can be disabled at the server (environment `STICKIT_AUTH=off`) while you fix accounts.
