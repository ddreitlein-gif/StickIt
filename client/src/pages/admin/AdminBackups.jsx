import { useState, useEffect } from 'react'

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
    fetch('/api/admin/backups')
      .then(r => r.ok ? r.json() : { backups: [], stats: {} })
      .then(setData)
      .catch(() => setData({ backups: [], stats: {} }))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleCreate = async () => {
    setCreating(true); setMsg('')
    try {
      const r = await fetch('/api/admin/backups/create', { method: 'POST' })
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
          On Railway, restoring requires write access to the persistent volume — typically a redeploy with the file in place, or a Railway shell session.
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
                  <td className="px-3 py-2 text-right">
                    <a
                      href={`/api/admin/backups/${encodeURIComponent(b.filename)}/download`}
                      className="inline-block px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-500 transition-colors"
                    >
                      Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
