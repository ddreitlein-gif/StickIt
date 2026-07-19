import { useState, useEffect } from 'react'
import { authHeaders, checkApiResponse, downloadAuthed } from '../../utils/api'

const fmtBytes = b => {
  if (b == null) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const fmtTimestamp = ts => {
  if (!ts) return '—'
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ts
  return d.toLocaleString()
}

const fmtRelative = ts => {
  if (!ts) return ''
  const then = new Date(ts).getTime()
  if (isNaN(then)) return ''
  const diffSec = Math.floor((Date.now() - then) / 1000)
  if (diffSec < 60) return 'just now'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} hr ago`
  return `${Math.floor(diffSec / 86400)} d ago`
}

export default function AdminBackups() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [msg, setMsg] = useState('')

  const load = () => {
    setLoading(true)
    fetch('/api/admin/backups', { headers: authHeaders() })
      .then(checkApiResponse)
      .then(setData)
      .catch(() => setData({ backups: [], stats: {} }))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleCreate = async () => {
    setCreating(true); setMsg('')
    try {
      const r = await fetch('/api/admin/backups/create', { method: 'POST', headers: authHeaders() })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Backup failed')
      setMsg(`Backup created: ${d.latest?.filename || 'ok'}`)
      load()
    } catch (e) {
      setMsg('Backup failed: ' + e.message)
    } finally {
      setCreating(false)
    }
  }

  // v1.25.00 (B-9a) — in-app restore with typed confirmation
  const [restoreTarget, setRestoreTarget] = useState(null) // backup object
  const [restoreTyped, setRestoreTyped] = useState('')
  const [restoring, setRestoring] = useState(false)

  const handleRestore = async () => {
    if (!restoreTarget || restoreTyped !== restoreTarget.filename) return
    setRestoring(true); setMsg('')
    try {
      const r = await fetch(`/api/admin/backups/${encodeURIComponent(restoreTarget.filename)}/restore`, {
        method: 'POST', headers: authHeaders(),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Restore failed')
      setMsg(`Restored ${restoreTarget.filename}. RESTART THE SERVER NOW to load the restored database. A pre-restore safety backup was taken first.`)
      setRestoreTarget(null); setRestoreTyped('')
      load()
    } catch (e) {
      setMsg('Restore failed: ' + e.message)
    } finally {
      setRestoring(false)
    }
  }

  const stats = data?.stats || {}
  const backups = data?.backups || []

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 style={{ fontFamily: "'Oswald', sans-serif" }} className="text-2xl font-bold tracking-wide uppercase text-white">
          Backups
        </h2>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
        >
          {creating ? 'Creating...' : 'Create Backup Now'}
        </button>
      </div>

      {msg && (
        <div className="mb-4 px-4 py-2 rounded-lg bg-blue-900/30 border border-blue-700/50 text-blue-200 text-sm">
          {msg}
        </div>
      )}

      {/* Status card */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Backups</div>
            <div className="text-sm text-white font-mono">{stats.count ?? 0} / {stats.max ?? 10}</div>
            <div className="text-xs text-slate-500 mt-0.5">{fmtBytes(stats.total_size_bytes)} total</div>
          </div>
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Newest</div>
            <div className="text-sm text-white">{fmtRelative(stats.newest) || '—'}</div>
            <div className="text-xs text-slate-500 mt-0.5">{fmtTimestamp(stats.newest)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Oldest</div>
            <div className="text-sm text-white">{fmtRelative(stats.oldest) || '—'}</div>
            <div className="text-xs text-slate-500 mt-0.5">{fmtTimestamp(stats.oldest)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Auto-backup</div>
            <div className="text-sm text-white">Every <span className="font-mono">{stats.interval_minutes ?? 5}</span> min if writes occurred</div>
            <div className="text-xs text-slate-500 mt-0.5">Pending: <span className="font-mono">{stats.pending_writes ?? 0}</span> · Total: <span className="font-mono">{stats.write_counter ?? 0}</span></div>
          </div>
        </div>
      </div>

      {/* Recovery instructions */}
      <div className="rounded-xl border border-amber-700/40 bg-amber-900/20 p-4 mb-6 text-sm">
        <div className="font-semibold text-amber-200 mb-2">How to restore from a backup</div>
        <ol className="list-decimal list-inside space-y-1 text-amber-100/80">
          <li>Stop the StickIt server.</li>
          <li>Download the backup file you want to restore from the table below.</li>
          <li>On the server, replace <code className="px-1 bg-black/30 rounded text-xs">data/scoring.db</code> with the downloaded file (rename it to <code className="px-1 bg-black/30 rounded text-xs">scoring.db</code>).</li>
          <li>Restart the server. The restored database is now live.</li>
        </ol>
        <div className="mt-2 text-xs text-amber-200/60">
          On a cloud host (Render/Railway), restoring this way requires write access to the persistent disk — typically a redeploy with the file in place, or a host shell session. The in-app Restore button above avoids that need.
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-slate-500 py-8 text-center">Loading...</div>
      ) : backups.length === 0 ? (
        <div className="text-slate-500 py-8 text-center">
          No backups yet. Backups are created automatically every {stats.interval_minutes ?? 5} minutes when writes have occurred.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-700/50 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/80 text-left">
                <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider font-medium">Filename</th>
                <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider font-medium">Created</th>
                <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider font-medium text-right">Size</th>
                <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {backups.map(b => (
                <tr key={b.filename} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-3 py-2 text-slate-200 font-mono text-xs">{b.filename}</td>
                  <td className="px-3 py-2 text-slate-300">
                    <div>{fmtTimestamp(b.created_at)}</div>
                    <div className="text-xs text-slate-500">{fmtRelative(b.created_at)}</div>
                  </td>
                  <td className="px-3 py-2 text-slate-300 text-right font-mono">{fmtBytes(b.size_bytes)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      onClick={() => downloadAuthed(`/api/admin/backups/${encodeURIComponent(b.filename)}/download`, { fallbackName: b.filename }).catch(e => setMsg('Download failed: ' + e.message))}
                      className="inline-block px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-500 transition-colors"
                    >
                      Download
                    </button>
                    <button
                      onClick={() => { setRestoreTarget(b); setRestoreTyped(''); setMsg('') }}
                      className="ml-2 inline-block px-3 py-1.5 rounded-lg border border-amber-700 text-amber-400 text-xs font-medium hover:bg-amber-900/30 transition-colors"
                    >
                      Restore
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {restoreTarget && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-amber-700/50 rounded-xl p-6 w-full max-w-lg">
            <h2 style={{ fontFamily: "'Oswald', sans-serif" }} className="text-xl font-bold text-white mb-3 uppercase">Restore Backup</h2>
            <p className="text-slate-300 text-sm mb-2">
              This replaces the LIVE database with <span className="font-mono text-amber-300">{restoreTarget.filename}</span> ({fmtTimestamp(restoreTarget.created_at)}).
              Every change made since that backup will be lost.
            </p>
            <p className="text-slate-400 text-xs mb-2">A safety backup of the current database is taken automatically before restoring.</p>
            <p className="text-amber-300 text-sm font-semibold mb-4">The server must be restarted after the restore for the change to take effect. On Railway, trigger a redeploy/restart from the dashboard.</p>
            <label className="block text-xs text-slate-400 mb-1 uppercase tracking-wider">Type the backup filename to confirm</label>
            <input
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white font-mono outline-none focus:border-amber-500 mb-4"
              value={restoreTyped}
              onChange={e => setRestoreTyped(e.target.value)}
              placeholder={restoreTarget.filename}
            />
            <div className="flex gap-3">
              <button onClick={() => setRestoreTarget(null)} className="flex-1 px-4 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm hover:bg-slate-700 transition-colors">Cancel</button>
              <button
                onClick={handleRestore}
                disabled={restoring || restoreTyped !== restoreTarget.filename}
                className="flex-1 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {restoring ? 'Restoring...' : 'Restore This Backup'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
