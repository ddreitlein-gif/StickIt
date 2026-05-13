## Voice manual score entry

A hands-free, voice-driven workflow for the chief-of-score role, added in v1.20.00. Built on Deepgram Nova-3 streaming speech recognition. Voice is purely *additive* to the existing scoring paths — all formulas and routes are unchanged.

### When to use it

- You're scoring paper-mode all day and want to keep your hands on the paper sheets while your voice drives the modal.
- You have a Nuance PowerMic II/III or Philips SpeechMike Premium 3500 (configured to send `F2`).
- The keyboard manual entry is too slow for the run cadence.

### Where to access it

- **Scoring tab → 🎙 Voice Manual Entry button** — `'paper'` mode. Bib confirmation → guided dictation → review → submit → next-bib prompt → repeat.
- **Manual Score Modal → 🎙 Voice Entry header button** — `'tablet'` mode. Skips the bib screen with the athlete pre-selected.

Hidden on dual mogul and aerials v2 events (bracket scoring is fundamentally different; v2 aerials needs per-judge tablets).

### The wizard model

The dictation screen is a **guided wizard**, not free-form. A blue-glow cursor highlights one field at a time. The operator speaks only the value for that field. Four voice commands control navigation:

- **"Next"** — advance the cursor by one field.
- **"Redo"** — clear the value of the currently active field; cursor stays.
- **"Submit"** or **"Done"** — stop the mic and jump to the Review screen.
- **"No Time"** / **"NT"** — only on the Time field; sets value to `-1` (NT).

### The stay-put rule

Saying "six point five" while the cursor is on Carving lands `6.5` in Carving — and the cursor **stays on Carving**. Saying another number replaces the value (self-correction by simply re-speaking). The operator must explicitly say "Next" to move on. This eliminates false advances on partial Deepgram returns.

### Click-to-edit-target

Tap any field in the script during recording to set it as a temporary edit target (dashed amber ring). The next spoken value lands in the clicked field — not the wizard cursor's current position. After the value lands, the edit target clears and the wizard cursor visually resumes. Two-cursor model: wizard position is sequential; click is random-access.

### Status overrides — buttons only

Three buttons in the modal header — **DNS / DNF / DSQ** — each open a confirm dialog ("Mark bib X as DNS — confirm?") and submit the run with that status, overriding any partial scores entered. **Voice intentionally does NOT recognize DNS/DNF/DSQ as commands** — the toolbar is the only path so a chance mishearing can never zero out an athlete's scores.

### Jump code validation

When the modal opens it fetches the actual jump-code list for the event's discipline + gender. Every parsed jump code is validated against that set. Codes not in the table flash red (`✗`) with the recognized text shown so the operator can immediately click + re-record. Submit is blocked while any jump code is invalid.

### Confirmation Review

After "Submit" / "Done", a two-column Review screen shows the raw transcript on the left and parsed values on the right as editable inputs. Each row has a status glyph: green ✓ (ok), amber `!` (out-of-range), red ✗ (invalid jump code), or gray `·` (empty). Submit is gated on every required field being filled AND every jump code being valid. Re-record discards everything and re-enters the wizard.

### Hardware

- **F2** toggles record/stop while the voice modal is open.
- **Nuance PowerMic II/III** — configure in driver utility to send F2 on press.
- **Philips SpeechMike Premium 3500** — configure in SpeechControl utility to send F2.
- **AirPods or USB headsets** — use the on-screen Start/Stop button or F2 directly.

### Failure modes

- **Deepgram unavailable / API key missing / network outage** → modal shows "Voice service unavailable. Use keyboard manual entry." Operator closes and uses the keyboard path.
- **Microphone permission denied** → clear error message in the modal.
- **Bad parse / invalid jump code** → field shows red. Operator clicks the field to retarget and re-records, or type-corrects in the Review screen.

### Server requirement

`DEEPGRAM_API_KEY` must be set in the server's environment. Without it, the voice modal renders the "Voice service unavailable" error. Audio is never persisted — only the resulting transcript text is stored in `runs.voice_transcript` for post-event audit.
