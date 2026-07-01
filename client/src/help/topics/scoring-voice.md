## Voice manual score entry

A hands-free, voice-driven workflow for the chief-of-score role. Built on Deepgram Nova-3 streaming speech recognition. Voice is purely *additive* to the existing scoring paths — all formulas and routes are unchanged, and everything voice can do can also be done with the keyboard.

### When to use it

- You're scoring paper-mode all day and want to keep your hands on the paper sheets while your voice drives the modal.
- You have a Philips SpeechMike or Nuance PowerMic whose buttons are mapped to the hotkeys below.
- The keyboard manual entry is too slow for the run cadence.

### Where to access it

- **Scoring tab → 🎙 Voice Manual Entry button** — batch (paper) mode. Bib confirmation → guided dictation → review → submit → next-bib prompt → repeat. A styled **Close** button on the bib screen exits at any natural break.
- **Manual Score Modal → 🎙 Voice Entry header button** — tablet-edit mode. Skips the bib screen with the athlete pre-selected.

Voice is hidden on **dual mogul** (bracket scoring is fundamentally different) and on **all aerials events** (aerials uses its own per-judge entry paths).

### The wizard model

The dictation screen is a **guided wizard**, not free-form. A blue-glow cursor highlights one field at a time. The operator speaks only the value for that field. Voice commands:

| Command | Action |
|---|---|
| **"Next"** | Advance the cursor to the next *blank* field |
| **"Redo"** | Clear the value of the active field; cursor stays |
| **"Submit"** / **"Done"** | Stop the mic and jump to the Review screen |
| **"No Time"** / **"NT"** | Only on the Time field — marks the run No Time |

### The stay-put rule

Saying "six point five" while the cursor is on Carving lands `6.5` in Carving — and the cursor **stays on Carving**. Saying another number replaces the value (self-correct by simply re-speaking). You must explicitly say "Next" (or press a Next key) to move on. This eliminates false advances on partial speech-recognition returns.

### Hardware keys (SpeechMike / PowerMic / keyboard)

All field navigation can be driven from hardware buttons instead of voice. macOS intercepts the bare F-keys at the OS level, so each action also has a **Ctrl+key alias** that always works:

| Action | Key | macOS-safe alias |
|---|---|---|
| Previous field (Dictation) / Re-record (Review) | `F1` | `Ctrl+[` |
| Start / stop the microphone | `F2` | `Ctrl+,` |
| Next field; on last field → Review. On Review → Submit | `F3` | `Ctrl+]` |
| Next *blank* field; on last field → Review | `F4` | `Ctrl+\` |

The mic toggle (`F2` / `Ctrl+,`) also works on the **bib screen**, so a hardware Record button drives the whole batch flow.

**SpeechMike setup:** in Philips Device Control Center, open your Custom profile and assign the device buttons to the Ctrl+key combos above using the Hotkey option. Suggested mapping: Rewind ◄◄ → F1 action, Record ● → F2 action, Forward ▶▶ → F3 action, EOL → F4 action, Play → disabled. PowerMic users configure the same hotkeys in the Nuance driver utility. AirPods / USB headsets work with the on-screen Start/Stop button.

### Click-to-edit-target

Tap any field in the script during recording to set it as a temporary edit target (dashed amber ring). The next spoken value lands in the clicked field — not the wizard cursor's position. After the value lands, the edit target clears and the wizard cursor resumes where it was. Two-cursor model: wizard position is sequential; click is random-access.

### Re-entering an athlete who already ran

On the bib screen, speaking or typing a bib that already has a run in the current round shows a warning: *"Bib X has already run in this round. Re-entering will OVERWRITE their existing scores. Continue?"* Confirm to proceed — the wizard runs normally and submits through the score-edit path against the existing run. Decline and the bib is rejected with a pointer to **Edit Score** on the Scoring tab. Status overrides (DNS/DNF/DSQ) on an already-run athlete route the same way.

### Status overrides — buttons only

Three buttons in the modal header — **DNS / DNF / DSQ** — each open a confirm dialog and submit the run with that status, overriding any partial scores. **Voice intentionally does NOT recognize DNS/DNF/DSQ as commands** — the toolbar is the only path, so a chance mishearing can never zero out an athlete's scores.

### Jump code validation

When the modal opens it fetches the actual jump-code list for the event's discipline + gender. Every parsed jump code is validated against that set. Codes not in the table flash red (`✗`) with the recognized text shown so you can immediately click + re-record. Submit is blocked while any jump code is invalid.

### Speaking grabs — basic vs advanced (v1.26.00)

Since the FS-13 rule change, basic (`g`) and advanced (`G`) grabs are different jumps, and the voice vocabulary distinguishes them:

- Saying **"grab"** always means the **basic** grab: "back grab" → `bg`, "three grab" → `3g`, "seven o grab" → `7og`.
- Say **"big grab"** or **"advanced grab"** for the **advanced** grab: "back big grab" → `bG`, "three advanced grab" → `3G`.
- Letter-by-letter dictation ("b g") resolves to the basic (lowercase) code; use the "big grab" phrases to get the advanced code.

Case is preserved through parsing, validation, and the Review screen — a typed correction of `bg` to `bG` on the Review screen changes the jump.

### Confirmation Review

After "Submit" / "Done", a two-column Review screen shows the raw transcript on the left and parsed values on the right as editable inputs. Each row has a status glyph: green ✓ (ok), amber `!` (out-of-range), red ✗ (invalid jump code), or gray `·` (empty). **Typed corrections get the same range checks as spoken values** — an out-of-range typo flags amber just like a mishearing. Submit is gated on every required field being filled AND every jump code being valid. Re-record (`F1`) discards everything and re-enters the wizard.

### Cancelling

Closing the dictation screen with values already entered asks *"Discard everything entered for this athlete?"* first, so a stray tap can't lose a half-dictated run.

### Failure modes

- **Voice service unavailable / network outage** → modal shows "Voice service unavailable. Use keyboard manual entry." Close and use the keyboard path; no partial data is written.
- **Microphone permission denied** → clear error message in the modal.
- **Bad parse / invalid jump code** → field shows red. Click the field to retarget and re-record, or type-correct on the Review screen.

### Server requirement

`DEEPGRAM_API_KEY` must be set in the server's environment. Without it, the voice modal renders the "Voice service unavailable" error (the Admin Dashboard shows whether the key is configured). Audio is never persisted — only the resulting transcript text is stored with the run for post-event audit.
