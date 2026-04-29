import { useState } from 'react'

function fmtDate(dateStr) {
  if (!dateStr) return 'Unknown'
  try {
    const d = new Date(dateStr)
    if (isNaN(d)) return dateStr
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return dateStr }
}

export default function ImportConflictModal({ conflictData, onResolve, onClose }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirmOverwrite, setConfirmOverwrite] = useState(false)

  const { existing_meet, import_meet } = conflictData

  const handleAction = async (action) => {
    setLoading(true)
    setError('')
    try {
      await onResolve(action)
    } catch (err) {
      setError(err.message || 'Action failed')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="text-3xl text-amber-400">&#9888;</div>
          <div>
            <h2 className="text-xl font-bold text-white">Warning — Meet Already Exists</h2>
            <p className="text-slate-400 text-sm mt-1">
              A meet named <span className="font-semibold text-white">{existing_meet.name}</span> already exists.
            </p>
          </div>
        </div>

        {/* Date comparison */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">On Server</div>
            <div className="text-sm text-slate-300">Last modified</div>
            <div className="text-white font-semibold">{fmtDate(existing_meet.updated_at)}</div>
          </div>
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Import File</div>
            <div className="text-sm text-slate-300">Last modified</div>
            <div className="text-white font-semibold">{fmtDate(import_meet.updated_at || import_meet.export_date)}</div>
          </div>
        </div>

        {error && <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg p-3">{error}</div>}

        {/* Action buttons */}
        <div className="space-y-2">
          <button
            onClick={() => handleAction('merge')}
            disabled={loading}
            className="w-full py-3 rounded-xl font-semibold text-white bg-mountain-600 hover:bg-mountain-500 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Processing...' : 'Merge'}
          </button>
          <p className="text-xs text-slate-500 ml-1 -mt-1 mb-2">Add new data and update older data in the existing meet</p>

          <button
            onClick={() => handleAction('duplicate')}
            disabled={loading}
            className="w-full py-3 rounded-xl font-semibold text-white bg-slate-700 hover:bg-slate-600 disabled:opacity-50 transition-colors"
          >
            Import as Duplicate
          </button>
          <p className="text-xs text-slate-500 ml-1 -mt-1 mb-2">Create a separate copy with "(Duplicate)" in the name</p>

          {!confirmOverwrite ? (
            <button
              onClick={() => setConfirmOverwrite(true)}
              disabled={loading}
              className="w-full py-3 rounded-xl font-semibold text-white bg-red-800 hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              Overwrite
            </button>
          ) : (
            <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 space-y-3">
              <p className="text-red-300 text-sm font-semibold">
                This will permanently delete all existing data for this meet. Are you sure?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmOverwrite(false)}
                  disabled={loading}
                  className="flex-1 py-2 rounded-lg font-semibold text-slate-300 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={() => handleAction('overwrite')}
                  disabled={loading}
                  className="flex-1 py-2 rounded-lg font-semibold text-white bg-red-700 hover:bg-red-600 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Deleting...' : 'Confirm Overwrite'}
                </button>
              </div>
            </div>
          )}

          <button
            onClick={onClose}
            disabled={loading}
            className="w-full py-3 rounded-xl font-semibold text-slate-400 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 transition-colors mt-2"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
