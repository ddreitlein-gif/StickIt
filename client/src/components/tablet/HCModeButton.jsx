export default function HCModeButton({ hc, onToggle, className = '' }) {
  if (hc) {
    return (
      <div className={`flex items-center gap-3 ${className}`}>
        <button
          type="button"
          onClick={onToggle}
          className="tablet-hc-back-badge"
          title="Return to normal mode"
        >
          ← NORMAL MODE
        </button>
        <span
          className="tablet-hc-toggle"
          aria-label="High contrast mode is on"
        >
          HC MODE ON
        </span>
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`tablet-hc-toggle ${className}`}
      title="Switch to high contrast mode for outdoor visibility"
    >
      HC MODE
    </button>
  )
}
