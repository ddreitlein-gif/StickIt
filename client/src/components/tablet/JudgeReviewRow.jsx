// Single row in the HJ tablet judge list.
// Generic — caller supplies cells (left, center, right) and an optional
// onReject handler for the right-side reject button.
export default function JudgeReviewRow({
  label,        // string|node — left side (judge name + role)
  middle = null, // node — middle (score breakdown)
  right = null,  // node — right (raw values, total)
  outlier = false,
  onReject = null,
  rejectLabel = 'Reject',
  rejectVariant = 'red', // 'red'|'amber'
  className = '',
}) {
  return (
    <div className={`tablet-hj-row ${outlier ? 'is-outlier' : ''} ${className}`}>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {typeof label === 'string'
          ? <span className="font-semibold truncate" style={{ color: 'var(--tablet-text)' }}>{label}</span>
          : label}
      </div>
      {middle && <div className="flex items-center gap-3 flex-shrink-0">{middle}</div>}
      {right && <div className="flex items-center gap-3 flex-shrink-0">{right}</div>}
      {onReject && (
        <button
          type="button"
          onClick={onReject}
          className={rejectVariant === 'amber' ? 'tablet-btn-amber' : 'tablet-btn-danger'}
        >
          {rejectLabel}
        </button>
      )}
    </div>
  )
}
