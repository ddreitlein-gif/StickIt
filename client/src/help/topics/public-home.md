## Home page

The Home page at `/` is the public landing page — the first thing anyone sees when they visit StickIt. It's intentionally minimal: branding, one primary call-to-action, and a few secondary entry points for officials and admins.

### Layout

- **Translucent mountain background image** at 0.18 opacity, mix-blend-mode screen.
- **Big StickIt logo** with drop shadow.
- **"FREESTYLE SCORING" tagline** in tracking-widened Bebas Neue.
- **Primary CTA — Live Scores** — large red-gradient button. Click takes you to `/livescores`.
- **"LOGIN REQUIRED" divider** — separates public from authenticated entry points.
- **Two secondary buttons** — Officials (`/dashboard`) and Admin (`/admin`).
- **Help & User Guide button** below — opens this guide.
- **Footer** — `© Rocky Mountain Freestyle` + current version (fetched from `/api/version`).

### Why the Live Scores CTA is so prominent

Most visitors to a StickIt instance are spectators looking for live results. The home page funnels them straight to `/livescores` with one tap. The Officials and Admin buttons are visually de-emphasized — they're for the small group of operators.

### No login required

The home page itself has no authentication. The Live Scores button leads to public surfaces (also no login). The Officials / Admin buttons take you to surfaces that will gain authentication in a future build — they're already wired with a placeholder.

### Sun Mode toggle

A small floating sun/moon icon (top-right) lets the visitor switch between **dark mode** (default) and **Sun Mode** (high-contrast for bright outdoor viewing). The choice is saved in `localStorage.stickit.sunMode` and propagates to `/livescores` and `/scoreboard/<short>` automatically.

A small inline `<script>` in `client/index.html` runs before React mounts and paints the `<html>` background to the right color, eliminating the brief flash-of-unstyled-content when Sun Mode is on.

### Version display

The footer fetches `/api/version` and shows the current version below the copyright. Updates automatically on deploy.

### Branding

- **Font:** Inter Tight / Barlow Condensed / JetBrains Mono (loaded via Google Fonts CDN).
- **Logo:** `client/public/images/stickit-logo-home.png` and `client/public/logo.png`.
- **Background image:** `server/public/images/homepage-bg.jpg`.

### When to bookmark

- **Operators** — bookmark `/dashboard` instead so you skip the home page entirely on opening.
- **Spectators** — bookmark `/livescores` to skip the home page.
- **Broadcasters** — bookmark the specific `/overlay/<event-short>` URL you're feeding into OBS.

The home page exists for first-time visitors and people who land on the bare domain.
