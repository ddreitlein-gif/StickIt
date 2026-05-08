// Right-side panel on the HJ tablet. Caller passes pre-formatted values
// (turns / air / speed / total) — this component does NO scoring math.
export default function CalculatedScorePanel({
  turns,         // string|null — pre-formatted; pass null to render "—"
  air,           // string|null
  speed,         // string|null  (can be null when has_speed=0 — speed cell hidden)
  total,         // string|null
  spreadWarning = null,   // string|null — show amber banner with this message
  hasSpeed = true,
  onApprove,
  approveDisabled = false,
  approveLabel = '✓ Approve Score',
  children = null,        // optional extra content (e.g., RunStatusGrid)
  className = '',
}) {
  const Cell = ({ label, value }) => (
    <div className="tablet-calc-cell">
      <span className="lbl">{label}</span>
      <span className="val">{value == null || value === '' ? '—' : value}</span>
    </div>
  )
  return (
    <div className={`tablet-card ${className}`} style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: hasSpeed ? 'repeat(3, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))',
        }}
      >
        <Cell label="Turns" value={turns} />
        <Cell label="Air" value={air} />
        {hasSpeed && <Cell label="Speed" value={speed} />}
      </div>
      <div>
        <div
          className="text-xs uppercase tracking-widest text-center"
          style={{ color: 'var(--tablet-dim)', letterSpacing: 2 }}
        >
          Total
        </div>
        <div className="tablet-calc-total">{total == null || total === '' ? '—' : total}</div>
      </div>
      {spreadWarning && (
        <div className="tablet-warn-banner">
          <span style={{ fontWeight: 700, letterSpacing: 1 }}>SCORE SPREAD</span>
          <span style={{ fontSize: 14 }}>{spreadWarning}</span>
        </div>
      )}
      {onApprove && (
        <button
          type="button"
          onClick={onApprove}
          className="tablet-btn-submit"
          style={{ height: 64, fontSize: 22 }}
          disabled={approveDisabled}
        >
          {approveLabel}
        </button>
      )}
      {children}
    </div>
  )
}
