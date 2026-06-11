import { useState, useEffect } from 'react'
import { authHeaders } from '../utils/api'


function fmtTimestamp(ts) {
  if (!ts) return '--'
  try {
    const d = new Date(ts + (ts.endsWith('Z') ? '' : 'Z'))
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  } catch (_) { return ts }
}

function fmtJSON(raw) {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return JSON.stringify(parsed, null, 2)
  } catch (_) { return raw }
}

function ActionBadge({ action }) {
  const colors = {
    score_submitted: 'bg-blue-900/50 text-blue-300 border-blue-700',
    run_status_set:  'bg-yellow-900/50 text-yellow-300 border-yellow-700',
    hj_approved:     'bg-green-900/50 text-green-300 border-green-700',
    athlete_created: 'bg-purple-900/50 text-purple-300 border-purple-700',
    athlete_updated: 'bg-purple-900/30 text-purple-400 border-purple-800',
    import:          'bg-cyan-900/50 text-cyan-300 border-cyan-700',
    export:          'bg-orange-900/50 text-orange-300 border-orange-700',
  }
  const cls = colors[action] || 'bg-slate-800 text-slate-400 border-slate-700'
  return (
    <span className={`inline-block border rounded px-2 py-0.5 text-xs font-mono whitespace-nowrap ${cls}`}>
      {action}
    </span>
  )
}

function DetailModal({ entry, onClose }) {
  if (!entry) return null
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-white font-bold text-lg">{entry.action}</h2>
            <p className="text-slate-500 text-sm">{fmtTimestamp(entry.timestamp)}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl leading-none">&times;</button>
        </div>
        <div className="space-y-3 text-sm">
          <div><span className="text-slate-500">Entity:</span> <span className="text-slate-200">{entry.entity}</span></div>
          {entry.entity_id && <div><span className="text-slate-500">ID:</span> <span className="font-mono text-slate-300 text-xs">{entry.entity_id}</span></div>}
          {entry.user_note && <div><span className="text-slate-500">Note:</span> <span className="text-slate-200">{entry.user_note}</span></div>}
          {entry.old_value && (
            <div>
              <p className="text-slate-500 mb-1">Previous value:</p>
              <pre className="bg-slate-800 rounded-lg p-3 text-slate-300 text-xs overflow-x-auto whitespace-pre-wrap">{fmtJSON(entry.old_value)}</pre>
            </div>
          )}
          {entry.new_value && (
            <div>
              <p className="text-slate-500 mb-1">New value:</p>
              <pre className="bg-slate-800 rounded-lg p-3 text-slate-300 text-xs overflow-x-auto whitespace-pre-wrap">{fmtJSON(entry.new_value)}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function AuditLog() {
  const [entries, setEntries]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [entity,  setEntity]    = useState('')
  const [action,  setAction]    = useState('')
  const [limit,   setLimit]     = useState(200)
  const [detail,  setDetail]    = useState(null)
  // v1.25.00 (B-6) — filter options come from the log itself, plus a date range
  const [filterOpts, setFilterOpts] = useState({ actions: [], entities: [] })
  const [fromDate, setFromDate] = useState('')
  const [toDate,   setToDate]   = useState('')

  useEffect(() => {
    fetch('/api/audit/filters', { headers: authHeaders() })
      .then(r => r.ok ? r.json() : { actions: [], entities: [] })
      .then(setFilterOpts)
      .catch(() => {})
  }, [])

  const load = () => {
    setLoading(true)
    const params = new URLSearchParams({ limit })
    if (entity) params.set('entity', entity)
    if (action) params.set('action', action)
    if (fromDate) params.set('from', fromDate)
    if (toDate) params.set('to', toDate)
    fetch(`/api/audit?${params}`, { headers: authHeaders() })
      .then(r => r.json())
      .then(data => setEntries(Array.isArray(data) ? data : []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [entity, action, limit, fromDate, toDate])

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {detail && <DetailModal entry={detail} onClose={() => setDetail(null)} />}

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 style={{ fontFamily: "'Oswald', sans-serif" }} className="text-2xl font-bold tracking-wide uppercase text-white">Audit Log</h1>
          <p className="text-slate-500 mt-1 text-sm">System activity history — newest first</p>
        </div>
        <button onClick={load} className="px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 text-sm hover:bg-slate-700 transition-colors">Refresh</button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div>
          <label className="label">Entity type</label>
          <select className="input text-sm" value={entity} onChange={e => setEntity(e.target.value)}>
            <option value="">All</option>
            {filterOpts.entities.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Action</label>
          <select className="input text-sm" value={action} onChange={e => setAction(e.target.value)}>
            <option value="">All</option>
            {filterOpts.actions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className="label">From</label>
          <input type="date" className="input text-sm" value={fromDate} onChange={e => setFromDate(e.target.value)} />
        </div>
        <div>
          <label className="label">To</label>
          <input type="date" className="input text-sm" value={toDate} onChange={e => setToDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Limit</label>
          <select className="input text-sm" value={limit} onChange={e => setLimit(Number(e.target.value))}>
            {[50, 100, 200, 500].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      <div className="card p-0 overflow-hidden overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Action</th>
              <th>Entity</th>
              <th>ID</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center text-slate-500 py-8">Loading...</td></tr>
            ) : !entries.length ? (
              <tr><td colSpan={5} className="text-center text-slate-500 py-8">No log entries found.</td></tr>
            ) : entries.map(e => (
              <tr key={e.id} className="cursor-pointer active:bg-slate-800/40" onClick={() => setDetail(e)} onTouchEnd={(ev) => { ev.preventDefault(); setDetail(e) }}>
                <td className="text-slate-400 text-xs whitespace-nowrap">{fmtTimestamp(e.timestamp)}</td>
                <td><ActionBadge action={e.action} /></td>
                <td className="text-slate-300 text-sm">{e.entity}</td>
                <td className="font-mono text-slate-500 text-xs truncate max-w-[140px]">{e.entity_id || '--'}</td>
                <td className="text-slate-600 text-xs">
                  {(e.new_value || e.old_value) ? 'Click to view' : e.user_note || '--'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 text-slate-600 text-xs text-right">{entries.length} entries -- click a row for detail</div>
    </div>
  )
}
