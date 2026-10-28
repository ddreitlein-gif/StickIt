// v2.8.00 -- "Skip athlete": the one dialog behind every Skip button (HJ and
// Timekeeper tablets, the Scoring Computer, the dual surfaces). It asks how
// many spots down to move the athlete / pairing (default 1) and nothing else;
// the caller performs the request. `tablet` switches to the tablet class set.
import { useState } from 'react'

export default function SkipDialog({ name, kind = 'athlete', max = null, tablet = false, busy = false, onCancel, onConfirm }) {
  const [spots, setSpots] = useState(1)
  const cap = max != null && max >= 1 ? max : 999
  const clamp = (n) => Math.max(1, Math.min(cap, Math.floor(Number(n) || 1)))
  const commit = () => { if (!busy) onConfirm(clamp(spots)) }
  const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }

  const shell = tablet
    ? { className: 'tablet-card w-full max-w-md', style: { padding: 24 } }
    : { className: 'bg-slate-900 border border-slate-700 rounded-lg shadow-2xl w-full max-w-md p-5' }
  const titleCls = tablet ? 'tablet-display' : 'text-lg font-semibold text-slate-100'
  const dimCls = tablet ? '' : 'text-slate-300'
  const stepBtn = tablet
    ? 'tablet-btn-neutral'
    : 'rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-700 font-bold text-xl'
  const cancelBtn = tablet ? 'tablet-btn-neutral' : 'px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-slate-200'
  const okBtn = tablet ? 'tablet-btn-submit' : 'px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-white font-semibold disabled:opacity-50'

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={() => { if (!busy) onCancel() }}
    >
      <div {...shell} onClick={(e) => e.stopPropagation()}>
        <div className={titleCls} style={tablet ? { fontSize: 28, lineHeight: 1, marginBottom: 8 } : { marginBottom: 8 }}>
          {kind === 'match' ? 'Skip pairing' : 'Skip athlete'}
        </div>
        <p className={`text-sm mb-4 ${dimCls}`} style={tablet ? { color: 'var(--tablet-dim)' } : undefined}>
          Move <strong style={{ color: '#fff' }}>{name}</strong> down how many spots?
        </p>
        <div className="flex items-center justify-center gap-3 mb-2">
          <button type="button" onClick={() => setSpots(s => clamp(s - 1))} disabled={busy || clamp(spots) <= 1}
            className={stepBtn} style={{ width: 56, height: 56, fontSize: 24 }} aria-label="One fewer spot">−</button>
          <input
            type="number" inputMode="numeric" min={1} max={cap} value={spots}
            onChange={(e) => setSpots(e.target.value)}
            onBlur={() => setSpots(clamp(spots))}
            onKeyDown={onKey}
            className="text-center font-mono text-white bg-slate-800 border border-slate-600 rounded-lg"
            style={{ width: 96, height: 56, fontSize: 28 }}
            autoFocus
          />
          <button type="button" onClick={() => setSpots(s => clamp(s + 1))} disabled={busy || clamp(spots) >= cap}
            className={stepBtn} style={{ width: 56, height: 56, fontSize: 24 }} aria-label="One more spot">+</button>
        </div>
        <p className="text-xs text-center mb-5" style={{ color: tablet ? 'var(--tablet-dim)' : '#94a3b8' }}>
          {kind === 'match'
            ? 'The pairing stays in its round. Past the end moves it to the last match of the round.'
            : 'This run only. Past the end moves them to last.'}
        </p>
        <div className="flex gap-3 justify-end">
          <button type="button" onClick={onCancel} disabled={busy} className={cancelBtn} style={tablet ? { height: 44, padding: '0 24px' } : undefined}>Cancel</button>
          <button type="button" onClick={commit} disabled={busy} className={okBtn} style={tablet ? { height: 44, padding: '0 24px', fontSize: 16 } : undefined}>
            {busy ? 'Skipping…' : `Skip ${clamp(spots)} spot${clamp(spots) === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
