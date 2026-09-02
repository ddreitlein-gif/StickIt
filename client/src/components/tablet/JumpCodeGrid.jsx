// Quick-select grid + "All codes" dropdown + No-Jump button.
// Driven by event-specific data (jumpDDs[] from the existing /api/jump-dds call).
// No DD lookup logic, no jump-code constants are owned here — caller passes them in.
//
// freqCodes is either
//   • a flat string[] — legacy 7-column layout: 7 codes on row 1, up to 6 on
//     row 2 with No Jump spanning the last 2 columns (Devo / RQS lists), or
//   • string[][] (v2.3.00) — explicit rows; columns = the longest row, and
//     No Jump fills the spare columns at the end of the LAST row (min span 2).
//     Comp Series uses 3 rows × 6: uprights / back flips / off-axis 720s.
export default function JumpCodeGrid({
  freqCodes,        // string[] | string[][] — see above
  allCodes,         // [{ jump_code, dd_value, notes }] — full dropdown list
  selected,         // string|null — currently selected code
  onSelect,         // (code:string) => void
  hasNoJump = true, // show ✕ No Jump button
  rowHeight = 58,
}) {
  const explicitRows = Array.isArray(freqCodes[0])
  let rows, columns
  if (explicitRows) {
    rows = freqCodes.map(r => [...r])
    columns = Math.max(...rows.map(r => r.length))
  } else {
    columns = 7
    rows = [freqCodes.slice(0, 7), hasNoJump ? freqCodes.slice(7, 13) : freqCodes.slice(7, 14)]
  }
  const lastRow = rows.length - 1
  // Legacy flat lists keep their exact pre-v2.3.00 shape (span 2, spare column
  // blank on an 11-code Devo/RQS list); explicit rows fill the spare columns.
  const noJumpSpan = explicitRows ? Math.max(2, columns - rows[lastRow].length) : 2

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, ri) => (
        <div key={ri} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
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
          {ri === lastRow && hasNoJump && (
            <button
              type="button"
              onClick={() => onSelect('NJ')}
              className={`tablet-jcode-btn is-nojump ${selected === 'NJ' ? 'is-selected' : ''}`}
              style={{ gridColumn: `span ${noJumpSpan}`, height: rowHeight }}
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
