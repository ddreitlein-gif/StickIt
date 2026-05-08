import { useState } from 'react'

const BUTTONS = [
  { code: 'DNS', label: 'Did Not Start', variant: 'neutral' },
  { code: 'DNF', label: 'Did Not Finish', variant: 'amber' },
  { code: 'RNS', label: 'Refused Score', variant: 'amber' },
  { code: 'DSQ', label: 'Disqualified', variant: 'red' },
]

// 4-button grid for HJ tablet. Each click prompts a confirm dialog before
// firing onSelect — preserves the v1.16.16 confirmation pattern.
export default function RunStatusGrid({ onSelect, athleteName = 'this athlete', disabled = false }) {
  const [pending, setPending] = useState(null)

  const onClick = (code) => {
    if (disabled) return
    setPending(code)
  }
  const confirm = () => {
    if (pending) onSelect(pending)
    setPending(null)
  }

  return (
    <>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        {BUTTONS.map((b) => (
          <button
            type="button"
            key={b.code}
            onClick={() => onClick(b.code)}
            className={`tablet-run-status-btn is-${b.variant}`}
            disabled={disabled}
          >
            <span style={{ fontSize: 26, lineHeight: 1 }}>{b.code}</span>
          </button>
        ))}
      </div>
      {pending && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => setPending(null)}
        >
          <div
            className="tablet-card"
            style={{ padding: 28, maxWidth: 460, width: '90%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tablet-display" style={{ fontSize: 30, marginBottom: 8 }}>
              Confirm {pending}
            </div>
            <p className="text-sm mb-6" style={{ color: 'var(--tablet-dim)' }}>
              Mark <strong style={{ color: '#fff' }}>{athleteName}</strong> as <strong style={{ color: '#fff' }}>{pending}</strong>?
            </p>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setPending(null)} className="tablet-btn-neutral" style={{ height: 44, fontSize: 16 }}>
                Cancel
              </button>
              <button type="button" onClick={confirm} className="tablet-btn-submit" style={{ height: 44, fontSize: 16, padding: '0 24px' }}>
                Confirm {pending}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
