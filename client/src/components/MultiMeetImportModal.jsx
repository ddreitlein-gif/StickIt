import { useState, useRef, useEffect } from 'react'
import ImportConflictModal from './ImportConflictModal'

function fmtDate(s) {
  if (!s) return ''
  try {
    const d = new Date(s)
    if (isNaN(d)) return s
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch { return s }
}

async function callImport(pendingId, action) {
  const r = await fetch(`/api/meets/import?pending_import_id=${pendingId}&conflict_action=${action}`, { method: 'POST' })
  const data = await r.json().catch(() => ({}))
  return { ok: r.ok, data }
}

export default function MultiMeetImportModal({ multiMeetData, onClose, onComplete }) {
  const meets = multiMeetData?.meets || []
  const [selections, setSelections] = useState(() => {
    const init = {}
    for (const m of meets) init[m.pending_import_id] = true
    return init
  })
  const [phase, setPhase] = useState('selecting')   // 'selecting' | 'importing' | 'done'
  const [progress, setProgress] = useState({ done: 0, total: 0, current: '' })
  const [conflictMeet, setConflictMeet] = useState(null)
  const conflictResolveRef = useRef(null)
  const [results, setResults] = useState([])

  const selectedCount = Object.values(selections).filter(Boolean).length

  const toggleAll = (val) => {
    const next = {}
    for (const m of meets) next[m.pending_import_id] = val
    setSelections(next)
  }

  const waitForConflictChoice = (meet) => new Promise(resolve => {
    setConflictMeet(meet)
    conflictResolveRef.current = resolve
  })

  const handleConflictResolve = (action) => {
    const cb = conflictResolveRef.current
    conflictResolveRef.current = null
    setConflictMeet(null)
    if (cb) cb(action)
  }

  const runImport = async () => {
    const selected = meets.filter(m => selections[m.pending_import_id])
    const skipped = meets.filter(m => !selections[m.pending_import_id])

    setPhase('importing')
    setProgress({ done: 0, total: selected.length, current: '' })

    // Cancel skipped (frees their cached zips)
    for (const m of skipped) {
      try { await callImport(m.pending_import_id, 'cancel') } catch {}
    }

    const out = []
    for (let i = 0; i < selected.length; i++) {
      const m = selected[i]
      setProgress({ done: i, total: selected.length, current: m.name })
      let action = 'import'
      if (m.conflict) {
        action = await waitForConflictChoice(m)
      }
      try {
        const { ok, data } = await callImport(m.pending_import_id, action)
        out.push({ name: m.name, action, ok, cancelled: data?.cancelled, summary: data?.summary, error: ok ? null : (data?.error || 'Failed') })
      } catch (e) {
        out.push({ name: m.name, action, ok: false, error: e.message })
      }
      setResults([...out])
    }

    setProgress({ done: selected.length, total: selected.length, current: '' })
    setPhase('done')
  }

  const handleCancelAll = async () => {
    // Free all pending entries on the server
    for (const m of meets) {
      try { await callImport(m.pending_import_id, 'cancel') } catch {}
    }
    onClose()
  }

  // If user closes via X / overlay during selection, cancel everything
  useEffect(() => {
    return () => {
      if (phase === 'selecting') {
        // Best-effort cleanup if unmounted mid-selection
        for (const m of meets) {
          try { fetch(`/api/meets/import?pending_import_id=${m.pending_import_id}&conflict_action=cancel`, { method: 'POST' }) } catch {}
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────
  if (phase === 'done') {
    const successCount = results.filter(r => r.ok && !r.cancelled).length
    const failCount = results.filter(r => !r.ok).length
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-6 space-y-4">
          <h2 className="text-xl font-bold text-white">Import Complete</h2>
          <div className="text-sm text-slate-300">
            {successCount} meet{successCount !== 1 ? 's' : ''} imported
            {failCount > 0 && <span className="text-red-400"> &middot; {failCount} failed</span>}
          </div>
          <div className="max-h-64 overflow-y-auto bg-slate-800/40 rounded-lg border border-slate-700/50 divide-y divide-slate-700/30">
            {results.map((r, i) => (
              <div key={i} className="px-3 py-2 text-sm flex items-center justify-between">
                <div className="text-slate-200 truncate">{r.name}</div>
                <div className="text-xs">
                  {r.ok ? (
                    <span className="text-green-400">{r.action}</span>
                  ) : (
                    <span className="text-red-400">{r.error || 'failed'}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={() => { onComplete?.(results); onClose() }}
            className="w-full py-3 rounded-xl font-semibold text-white bg-mountain-600 hover:bg-mountain-500 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'importing') {
    return (
      <>
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-40 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 space-y-4">
            <h2 className="text-xl font-bold text-white">Importing Meets</h2>
            <div className="text-sm text-slate-400">
              {progress.done} of {progress.total} complete
            </div>
            {progress.current && (
              <div className="text-sm text-slate-300 truncate">
                Now: <span className="text-white">{progress.current}</span>
              </div>
            )}
            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-mountain-500 transition-all duration-300"
                style={{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : '0%' }}
              />
            </div>
          </div>
        </div>
        {conflictMeet && (
          <ImportConflictModal
            conflictData={{
              existing_meet: conflictMeet.conflict.existing_meet,
              import_meet: conflictMeet.conflict.import_meet,
            }}
            onResolve={handleConflictResolve}
            onClose={() => handleConflictResolve('cancel')}
          />
        )}
      </>
    )
  }

  // 'selecting'
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full p-6 space-y-4 max-h-[90vh] flex flex-col">
        <div>
          <h2 className="text-xl font-bold text-white">Multi-Meet Import</h2>
          <p className="text-slate-400 text-sm mt-1">
            This bundle contains <span className="text-white font-semibold">{meets.length}</span> meet{meets.length !== 1 ? 's' : ''}. Select which to import.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => toggleAll(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
          >
            Select All
          </button>
          <button
            onClick={() => toggleAll(false)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
          >
            Deselect All
          </button>
          <div className="ml-auto text-xs text-slate-400">
            {selectedCount} of {meets.length} selected
          </div>
        </div>

        <div className="overflow-y-auto rounded-lg border border-slate-700/50 divide-y divide-slate-700/30">
          {meets.map(m => (
            <label
              key={m.pending_import_id}
              className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-800/50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={!!selections[m.pending_import_id]}
                onChange={e => setSelections(s => ({ ...s, [m.pending_import_id]: e.target.checked }))}
                className="w-4 h-4 accent-mountain-500"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-white text-sm font-medium truncate">{m.name}</span>
                  {m.conflict && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-700/40">
                      Already exists
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500 truncate">
                  {[m.location, fmtDate(m.date)].filter(Boolean).join(' \u2022 ')}
                </div>
              </div>
            </label>
          ))}
        </div>

        <div className="flex gap-3 pt-2">
          <button
            onClick={handleCancelAll}
            className="flex-1 py-3 rounded-xl font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={runImport}
            disabled={selectedCount === 0}
            className="flex-1 py-3 rounded-xl font-semibold text-white bg-mountain-600 hover:bg-mountain-500 disabled:opacity-50 transition-colors"
          >
            Import {selectedCount > 0 ? `(${selectedCount})` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
