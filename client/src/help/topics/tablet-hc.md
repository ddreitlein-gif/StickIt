## High-contrast (HC) mode

Every tablet (Judge, Air Judge, Aerials Judge, Dual Mogul Judge, Timekeeper, Head Judge) has a **HC Mode** toggle in the top-right corner. Tapping it switches the tablet into a high-contrast palette — black background, white text, amber accents — designed for outdoor visibility in bright sunlight, on snow, or with reflective glare.

### What changes

- **Background** → solid black
- **Text** → white, with thicker stroke
- **Accents** → bright amber (`#f5c518`) instead of navy/blue
- **Status squares / glow effects** → switched from green-on-dark to amber outline
- **Score buttons** → outlined white-on-black with amber selection
- **Component zones (Excellent/Good/Adequate/Poor)** → still color-coded but with HC-safe contrast ratios

The HC palette is **functionally identical** to normal mode — all the same buttons, same layout, same workflow. Only the visual tokens change.

### Toggle button

A small button labeled `← Normal Mode` (when HC is on) or `HC MODE ON` (badge state) — appears in the same place on every tablet. Tapping it flips the mode and persists the choice in `localStorage.stickit-high-contrast`.

### Persistence

The choice is local to that tablet. Each judge's tablet has its own HC preference. If you toggle on one tablet, it doesn't affect any other tablet.

### When to use

- **Bright sunny day on snow** — sunlight + glare make the normal navy palette hard to read.
- **Old or low-brightness iPad** — older display backlights wash out in daylight.
- **Aging eyes** — the higher contrast is easier on the eyes for long scoring sessions.
- **High-contrast accessibility need** — for judges with visual impairments.

### When NOT to use

- **Indoor / dark conditions** — the HC palette is harsh in dim light. Normal mode is gentler.
- **For broadcast / video review** — HC mode looks unfamiliar on camera; reserve for actual judging.

### Status squares

Status squares are slightly larger in HC mode (14×14 px vs. 12×12 in normal mode) so they stay visible at HC's increased thickness.

### Reference panel pills

The Excellent / Good / Adequate / Poor reference pills use HC-friendly colors (deeper saturation, white text borders) that maintain readability while still color-coding the score zones.

### Devices that need HC

The standard scoring setup uses iPads at 100% brightness. Even at full brightness, a bright sunny Colorado morning can wash out the normal navy palette. Testing has shown that HC mode is reliably readable in conditions where normal mode struggles.

### Not in the legacy aerials view

The pre-v1.18.00 legacy aerials judge tablet doesn't have HC mode. All other tablets do.

### Underlying mechanism

HC mode is implemented as a `data-hc="1"` attribute on the tablet's root container. Every `tablet-*` CSS class has a corresponding `[data-hc="1"]` override. A legacy `.hc` class also still applies to inner Tailwind classes that haven't been migrated to the token system — belt-and-suspenders.
