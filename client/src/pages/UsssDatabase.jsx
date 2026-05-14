import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { authHeaders } from '../utils/api'

export default function UsssDatabase() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState(null)

  const load = () => {
    setLoading(true)
    fetch('/api/usss/status', { headers: authHeaders() })
      .then(r => r.json())
      .then(d => { setStatus(d); setError(null) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleSync = async () => {
    setSyncing(true); setMsg('')
    try {
      const r = await fetch('/api/usss/sync', { method: 'POST', headers: authHeaders() })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)
      setMsg(data.skipped ? 'Already current' : `Synced ${data.recordCount} records`)
      load()
    } catch (e) {
      setMsg('Sync failed: ' + e.message)
    } finally {
      setSyncing(false)
    }
  }

  const handleUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true); setMsg('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch('/api/usss/upload', { method: 'POST', headers: authHeaders(), body: fd })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)
      setMsg(`Uploaded ${data.recordCount} records`)
      load()
    } catch (err) {
      setMsg('Upload failed: ' + err.message)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-6">
        <Link to="/dashboard" className="hover:text-white transition-colors">Meets</Link>
        <span>/</span>
        <span className="text-slate-300">USSS Database</span>
      </div>

      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-display text-4xl text-white tracking-wide">USSS Database</h1>
          <p className="text-slate-500 text-sm mt-2">
            The master USSS People File — used to look up athletes, coaches, and officials when registering for events.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-red-900/30 border border-red-800 text-red-300 text-sm rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      <div className="card mb-4">
        <h2 className="font-display text-lg text-white mb-4">Sync Status</h2>
        {loading ? (
          <p className="text-slate-500 text-sm">Loading…</p>
        ) : status && status.status ? (
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wider text-slate-500">Last sync</dt>
              <dd className="text-slate-100 mt-1">
                {new Date(status.status.last_sync_at + 'Z').toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-slate-500">List</dt>
              <dd className="text-slate-100 mt-1">
                {status.status.list_year} {status.status.list_identifier}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-slate-500">Records</dt>
              <dd className="text-slate-100 mt-1">
                {status.counts?.total ?? 0}{' '}
                <span className="text-slate-500 text-xs">
                  ({status.counts?.competitors ?? 0} competitors
                  {status.counts?.coaches != null ? `, ${status.counts.coaches} coach/comp` : ''}
                  {status.counts?.officials != null ? `, ${status.counts.officials} officials` : ''})
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-slate-500">Source</dt>
              <dd className="text-slate-100 mt-1">{status.status.source || 'auto'}</dd>
            </div>
            {status.status.file_name && (
              <div className="md:col-span-2">
                <dt className="text-xs uppercase tracking-wider text-slate-500">File name</dt>
                <dd className="text-slate-300 mt-1 font-mono text-xs break-all">{status.status.file_name}</dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="text-slate-500 text-sm italic">
            No USSS data — use <span className="text-slate-300">Sync Now</span> or upload a People file.
          </p>
        )}
      </div>

      <div className="card">
        <h2 className="font-display text-lg text-white mb-2">Update</h2>
        <p className="text-slate-500 text-sm mb-4">
          Sync downloads the latest People file from US Ski &amp; Snowboard. Upload imports a People file you have on disk.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="btn-primary text-sm"
          >
            {syncing ? 'Syncing…' : 'Sync Now'}
          </button>
          <label className="btn-secondary text-sm cursor-pointer">
            {uploading ? 'Uploading…' : 'Upload File'}
            <input
              type="file"
              accept=".txt"
              className="hidden"
              onChange={handleUpload}
              disabled={uploading}
            />
          </label>
          {msg && <span className="text-blue-400 text-sm">{msg}</span>}
        </div>
      </div>
    </div>
  )
}
