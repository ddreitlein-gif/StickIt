// Quick-select 7×2 grid + "All codes" dropdown + No-Jump button.
// Driven by event-specific data (jumpDDs[] from the existing /api/jump-dds call).
// No DD lookup logic, no jump-code constants are owned here — caller passes them in.
export default function JumpCodeGrid({
  freqCodes,        // string[] — quick-select codes (1.5 rows of 7)
  allCodes,         // [{ jump_code, dd_value, notes }] — full dropdown list
  selected,         // string|null — currently selected code
  onSelect,         // (code:string) => void
  hasNoJump = true, // show ✕ No Jump button
  rowHeight = 58,
}) {
  const rows = []
  // First row: 7 codes
  rows.push(freqCodes.slice(0, 7))
  // Second row: 6 codes + (No Jump spans 2 cols)
  if (hasNoJump) {
    rows.push(freqCodes.slice(7, 13))
  } else {
    rows.push(freqCodes.slice(7, 14))
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, ri) => (
        <div key={ri} className="grid gap-2" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
          {row.map((code) => (
            <button
              type="button"
              key={code}
              onClick={() => onSelect(code)}
              className={`tablet-jcode-btn ${selected === code ? 'is-selected' : ''}`}
              style={{ height: rowHeight }}
            >
              {code}
            </button>
          ))}
          {ri === 1 && hasNoJump && (
            <button
              type="button"
              onClick={() => onSelect('NJ')}
              className={`tablet-jcode-btn is-nojump ${selected === 'NJ' ? 'is-selected' : ''}`}
              style={{ gridColumn: 'span 2', height: rowHeight }}
            >
              ✕ No Jump
            </button>
          )}
        </div>
      ))}
      <select
        value={selected || ''}
        onChange={(e) => e.target.value && onSelect(e.target.value)}
        className="tablet-jcode-allcodes"
      >
        <option value="">All codes — scroll to find ▾</option>
        {allCodes.map((d) => (
          <option key={d.jump_code} value={d.jump_code}>
            {d.jump_code === 'bP'
              ? `⚠ ${d.jump_code} (DD ${d.dd_value}) — rarely used`
              : `${d.jump_code} (DD ${d.dd_value})`}
          </option>
        ))}
      </select>
    </div>
  )
}
