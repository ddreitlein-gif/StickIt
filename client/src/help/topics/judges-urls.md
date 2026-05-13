## Judge tablet URLs

Each judge gets a **unique URL** to open on their tablet. The URL encodes the event and the judge — there's no login screen; opening the URL on a fresh tablet pre-binds it to that role.

### Where to find them

Open the event detail page → **Links** tab. You'll see a table with one row per configured role:

| Role | URL | Copy |
|---|---|---|
| TL1 | `/judge/<event-short>/<judge-short>` | 📋 |
| TL2 | `/judge/<event-short>/<judge-short>` | 📋 |
| Air1 | `/judge/<event-short>/<judge-short>` | 📋 |
| Head Judge | `/headjudge/<meet-short>/<event-short>` | 📋 |
| Timekeeper | `/timekeeper/<event-short>` | 📋 |
| Scoreboard (public) | `/scoreboard/<event-short>` | 📋 |
| Overlay (broadcast) | `/overlay/<event-short>` | 📋 |

### Per-judge short codes

The judge URL contains a per-judge `short_code` — a small random string the server generates when the judge is added. This means:

- Two T&L1 judges in different events have **different** URLs.
- If you delete and re-add a judge, the new short code is different — the old URL stops working.
- The short code can't be guessed, so a judge tablet URL is effectively a credential. Keep them out of public-facing channels.

### Aerials per-judge URLs

For aerials v2 events, each `AeJudge<N>` row has its own short code:

```
/aerials-judge/<event-short>/<judgeN-short>
```

This is different from the legacy aerials URL `/aerials-judge/<event-short>` (which still works as a fallback for pre-v1.18.00 events). The per-judge URL is what new events use.

### Copy / open

- Click the **📋 Copy** button to copy the URL to your clipboard. Paste into Slack, AirDrop, or email to the judge.
- Click the URL itself to open it in a new browser tab — useful for testing.

### Tablet hardware

The tablets need to support a modern browser (iPad with Safari is the typical setup). Bookmark the URL on the home screen so the judge can re-open with a tap. Tablets should be set to "Guided Access" or kiosk mode to prevent accidental navigation.

### What if a URL stops working

Three causes:

1. **Event is locked** — the URL returns "Event is locked" and refuses to load. Unlock the event from [Admin events](./admin-events).
2. **Judge was deleted** — the short code is no longer valid. Re-add the judge from the Setup tab to generate a new URL.
3. **Server-side short code was rotated** — rare, but possible if the database was restored from a backup. Open the **Links** tab and copy the new URL.

### Print all URLs

There is no PDF "judge sheet" yet. To distribute the URLs, copy each one and paste into your shared Slack channel, AirDrop them to each iPad individually, or use the QR-code feature (if implemented in your version). A printable URL sheet is on the future roadmap.
