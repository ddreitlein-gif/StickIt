import { useEffect, useState } from 'react'

const DEDUCTION_PRESETS = [
  { value: 0.1, label: '+0.1', sub: 'minor' },
  { value: 0.5, label: '+0.5', sub: 'stumble' },
  { value: 1.0, label: '+1.0', sub: '' },
  { value: 1.6, label: '+1.6', sub: 'lane chg' },
  { value: 6.0, label: '+6.0', sub: 'stop/fall', isFall: true },
]

// IMPORTANT: This component is presentational. It owns local state for the
// "manual" entry mode toggle, but the canonical deduction value flows in via
// `value` and out via `onChange` — same contract as the legacy DeductionPad
// in JudgeTablet.jsx. Replacing the legacy component does not change the
// scoring math; the formula `clamp(0.1, 20, raw - deduction)` is computed by
// the caller (JudgeTablet) and is unchanged.
export default function DeductionPad({ value, onChange }) {
  const [manualInput, setManualInput] = useState('')
  const [manualMode, setManualMode] = useState(false)

  useEffect(() => {
    if (value === 0) setManualInput('')
  }, [value])

  const round1 = (n) => Math.round(n * 10) / 10
  const addDed = (amt) => {
    onChange(Math.min(20, round1((value || 0) + amt)))
    setManualMode(false)
  }
  const clear = () => {
    onChange(0)
    setManualInput('')
    setManualMode(false)
  }
  const commitManual = () => {
    const n = parseFloat(manualInput)
    if (!isNaN(n) && n >= 0 && n <= 20) onChange(round1(n))
    setManualMode(false)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div
          className={`tablet-ded-display ${(value || 0) > 0 ? 'has-ded' : ''}`}
          style={{ width: 116, height: 84, fontSize: 44 }}
        >
          {(value || 0).toFixed(1)}
        </div>
        <div className="flex flex-col gap-2">
          <button type="button" onClick={clear} className="tablet-btn-neutral" style={{ height: 38 }}>
            Clear
          </button>
          <button type="button" onClick={() => setManualMode(!manualMode)} className="tablet-btn-neutral" style={{ height: 38 }}>
            Manual
          </button>
        </div>
        <div className="flex flex-1 gap-2">
          {DEDUCTION_PRESETS.map((p) => (
            <button
              type="button"
              key={p.value}
              onClick={() => addDed(p.value)}
              className={`tablet-ded-btn ${p.isFall ? 'is-fall' : ''}`}
            >
              <span>{p.label}</span>
              {p.sub && <span className="tablet-ded-sub">{p.sub}</span>}
            </button>
          ))}
        </div>
      </div>
      {manualMode && (
        <div className="flex items-center gap-2">
          <input
            type="number" min={0} max={20} step={0.1}
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            onBlur={commitManual}
            onKeyDown={(e) => e.key === 'Enter' && commitManual()}
            placeholder="0.0"
            className="w-28 text-lg font-bold text-center bg-slate-800 border-2 border-slate-600 focus:border-blue-500 rounded-xl p-2 text-white outline-none"
            inputMode="decimal"
            autoFocus
          />
          <span className="text-slate-500 text-sm">0–20</span>
        </div>
      )}
      <div className="text-xs" style={{ color: 'var(--tablet-muted)' }}>
        Tap to accumulate · 0.1 minor · 0.5 stumble · 1.6 lane change · 6.0 stop/fall
      </div>
    </div>
  )
}
