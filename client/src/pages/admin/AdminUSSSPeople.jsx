import { useState, useEffect, useRef } from 'react'
import { authHeaders } from '../../utils/api'

const TYPE_LABELS = { C: 'Competitor', CO: 'Coach/Comp', O: 'Official' }
const TYPE_FILTERS = [
  { value: '', label: 'All Types' },
  { value: 'C', label: 'Competitors (C)' },
  { value: 'CO', label: 'Coach/Comp (CO)' },
  { value: 'O', label: 'Officials (O)' },
]
const PAGE_SIZE = 100

const fmtPts = v => (v == null || v === '' ? '' : Number(v).toFixed(2))

const fmtTimestamp = ts => {
  if (!ts) return '—'
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ts
  return d.toLocaleString()
}

export default function AdminUSSSPeople() {
  const [status, setStatus] = useState(null)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const debounceRef = useRef(null)

  useEffect(() => {
    fetch('/api/usss/status', { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [])

  const fetchRows = (qVal, typeVal, pageVal) => {
    setLoading(true)
    const params = new URLSearchParams()
    if (qVal) params.set('q', qVal)
    if (typeVal) params.set('type', typeVal)
    params.set('page', String(pageVal))
    params.set('limit', String(PAGE_SIZE))
    fetch(`/api/admin/usss/people?${params.toString()}`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : { rows: [], total: 0 })
      .then(data => {
        setRows(data.rows || [])
        setTotal(data.total || 0)
      })
      .catch(() => { setRows([]); setTotal(0) })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchRows(q, typeFilter, page), 300)
    return () => clearTimeout(debounceRef.current)
  }, [q, typeFilter, page])

  const onSearch = (val) => { setQ(val); setPage(1) }
  const onType = (val) => { setTypeFilter(val); setPage(1) }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const downloadDisabled = (status?.counts?.total || 0) === 0
  const showingFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const showingTo = Math.min(page * PAGE_SIZE, total)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 style={{ fontFamily: "'Oswald', sans-serif" }} className="text-2xl font-bold tracking-wide uppercase text-white">
          USSS People
        </h2>
        <a
          href="/api/admin/usss/people/download"
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            downloadDisabled
              ? 'bg-slate-700/50 text-slate-500 pointer-events-none'
              : 'bg-blue-600 text-white hover:bg-blue-500'
          }`}
        >
          Download CSV
        </a>
      </div>

      {/* Status card */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Last Imported</div>
            <div className="text-sm text-white">{fmtTimestamp(status?.status?.last_sync_at)}</div>
            {status?.status?.source && (
              <div className="text-xs text-slate-500 mt-0.5">via {status.status.source}</div>
            )}
          </div>
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">List</div>
            <div className="text-sm text-white">
              {[status?.status?.list_year, status?.status?.list_identifier].filter(Boolean).join(' ') || '—'}
            </div>
            {status?.status?.file_name && (
              <div className="text-xs text-slate-500 mt-0.5 truncate" title={status.status.file_name}>
                {status.status.file_name}
              </div>
            )}
          </div>
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Total Records</div>
            <div className="text-sm text-white font-mono">{status?.counts?.total ?? 0}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Breakdown</div>
            <div className="text-xs text-slate-300 space-y-0.5">
              <div>Competitors: <span className="font-mono text-white">{status?.counts?.competitors ?? 0}</span></div>
              <div>Coach/Comp: <span className="font-mono text-white">{status?.counts?.coaches ?? 0}</span></div>
              <div>Officials: <span className="font-mono text-white">{status?.counts?.officials ?? 0}</span></div>
            </div>
          </div>
        </div>
      </div>

      {/* Search + filter */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Search by last name, first name, USSA ID, or club…"
          value={q}
          onChange={e => onSearch(e.target.value)}
          className="flex-1 min-w-64 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
        />
        <select
          value={typeFilter}
          onChange={e => onType(e.target.value)}
          className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
        >
          {TYPE_FILTERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <div className="text-xs text-slate-400 ml-auto">
          {total === 0 ? 'No results' : `${showingFrom}–${showingTo} of ${total}`}
        </div>
      </div>

      {/* Table */}
      {loading && rows.length === 0 ? (
        <div className="text-slate-500 py-8 text-center">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="text-slate-500 py-8 text-center">
          {total === 0 && !q && !typeFilter
            ? 'No USSS people imported yet. Sync from the Athletes page.'
            : 'No records match your filters.'}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-700/50 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/80 text-left">
                <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider font-medium">USSA ID</th>
                <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider font-medium">Last</th>
                <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider font-medium">First</th>
                <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider font-medium">Type</th>
                <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider font-medium">Div</th>
                <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider font-medium">Gen</th>
                <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider font-medium text-right">YOB</th>
                <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider font-medium">Club</th>
                <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider font-medium text-right">AE</th>
                <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider font-medium text-right">DM</th>
                <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider font-medium text-right">MO</th>
                <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider font-medium">FIS ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {rows.map(r => (
                <tr key={r.ussa_id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-3 py-2 text-white font-mono">{r.ussa_id}</td>
                  <td className="px-3 py-2 text-slate-200">{r.last_name}</td>
                  <td className="px-3 py-2 text-slate-200">{r.first_name}</td>
                  <td className="px-3 py-2">
                    <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-slate-700/50 text-slate-300">
                      {TYPE_LABELS[r.type] || r.type}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-300">{r.division || ''}</td>
                  <td className="px-3 py-2 text-slate-300">{r.gender || ''}</td>
                  <td className="px-3 py-2 text-slate-300 text-right font-mono">{r.yob || ''}</td>
                  <td className="px-3 py-2 text-slate-300">{r.club_name || ''}</td>
                  <td className="px-3 py-2 text-slate-300 text-right font-mono">{fmtPts(r.ae_points)}</td>
                  <td className="px-3 py-2 text-slate-300 text-right font-mono">{fmtPts(r.dm_points)}</td>
                  <td className="px-3 py-2 text-slate-300 text-right font-mono">{fmtPts(r.mo_points)}</td>
                  <td className="px-3 py-2 text-slate-400 font-mono text-xs">{r.fis_id || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ← Prev
          </button>
          <div className="text-slate-400">
            Page <span className="text-white font-mono">{page}</span> of <span className="text-white font-mono">{totalPages}</span>
          </div>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
