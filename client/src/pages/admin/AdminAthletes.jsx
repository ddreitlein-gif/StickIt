import { useState, useEffect, useRef, useCallback } from 'react'
import { authHeaders, checkApiResponse } from '../../utils/api'

const PAGE_SIZE = 100

export default function AdminAthletes() {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [divisionFilter, setDivisionFilter] = useState('')
  const [divisions, setDivisions] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(new Set())
  const [confirm, setConfirm] = useState(null) // { mode, ids?, division?, label, count, sample }
  const [byDivisionPick, setByDivisionPick] = useState(false)
  const [byDivisionChoice, setByDivisionChoice] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState('')
  const debounceRef = useRef(null)

  const fetchDivisions = () => {
    fetch('/api/admin/athletes/divisions', { headers: authHeaders() })
      .then(checkApiResponse)
      .then(d => setDivisions(d.divisions || []))
      .catch(() => setDivisions([]))
  }

  const fetchRows = useCallback((qVal, divVal, pageVal) => {
    setLoading(true)
    const params = new URLSearchParams()
    if (qVal) params.set('q', qVal)
    if (divVal) params.set('division', divVal)
    params.set('page', String(pageVal))
    params.set('limit', String(PAGE_SIZE))
    fetch(`/api/admin/athletes?${params.toString()}`, { headers: authHeaders() })
      .then(checkApiResponse)
      .then(data => {
        setRows(data.rows || [])
        setTotal(data.total || 0)
      })
      .catch(() => { setRows([]); setTotal(0) })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchDivisions() }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchRows(q, divisionFilter, page), 300)
    return () => clearTimeout(debounceRef.current)
  }, [q, divisionFilter, page, fetchRows])

  const onSearch = (val) => { setQ(val); setPage(1) }
  const onDiv = (val) => { setDivisionFilter(val); setPage(1) }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const showingFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const showingTo = Math.min(page * PAGE_SIZE, total)

  const toggleOne = (id) => {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }
  const toggleAllOnPage = () => {
    setSelected(prev => {
      const allSelected = rows.every(r => prev.has(r.id))
      const n = new Set(prev)
      if (allSelected) {
        rows.forEach(r => n.delete(r.id))
      } else {
        rows.forEach(r => n.add(r.id))
      }
      return n
    })
  }

  const previewDelete = async (body, label) => {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/athletes/preview-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setFlash(`Error: ${data.error || 'preview failed'}`)
        setBusy(false)
        return
      }
      setConfirm({ ...body, label, count: data.count, sample: data.sample || [] })
    } catch (e) {
      setFlash(`Error: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  const executeDelete = async () => {
    if (!confirm) return
    setBusy(true)
    try {
      const { label, count, sample, ...body } = confirm
      const res = await fetch('/api/admin/athletes/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setFlash(`Error: ${data.error || 'delete failed'}`)
      } else {
        setFlash(`Removed ${data.deleted} athlete${data.deleted === 1 ? '' : 's'} from master database. Past events are unaffected.`)
        setSelected(new Set())
        fetchDivisions()
        fetchRows(q, divisionFilter, page)
      }
    } catch (e) {
      setFlash(`Error: ${e.message}`)
    } finally {
      setConfirm(null)
      setBusy(false)
    }
  }

  const handleResetAll = () => previewDelete({ mode: 'reset' }, 'Reset Athlete List')
  const handleDeleteSelected = () => {
    if (!selected.size) return
    previewDelete({ mode: 'selected', ids: Array.from(selected) }, 'Delete Selected Athletes')
  }
  const handleDeleteByDivision = () => {
    if (!byDivisionChoice) return
    previewDelete({ mode: 'by-division', division: byDivisionChoice }, `Delete Division: ${byDivisionChoice === '__none__' ? '(No Division)' : byDivisionChoice}`)
    setByDivisionPick(false)
    setByDivisionChoice('')
  }
  const handleDeleteNonUsss = () => previewDelete({ mode: 'non-usss' }, 'Delete Non-USSS Athletes')

  const allOnPageSelected = rows.length > 0 && rows.every(r => selected.has(r.id))

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 style={{ fontFamily: "'Oswald', sans-serif" }} className="text-2xl font-bold tracking-wide uppercase text-white">
          Athletes
        </h2>
        <div className="text-xs text-slate-400">
          Master roster used for event setup. Deletes are <span className="text-white font-medium">soft</span> — past events keep their athlete data.
        </div>
      </div>

      {/* Status card */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Active Athletes</div>
            <div className="text-lg text-white font-mono">{total}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Divisions</div>
            <div className="text-sm text-white">{divisions.length}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Selected</div>
            <div className="text-sm text-white font-mono">{selected.size}</div>
          </div>
        </div>
      </div>

      {/* Bulk action toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          onClick={handleResetAll}
          disabled={busy || total === 0}
          className="px-3 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Reset Athlete List
        </button>
        <button
          onClick={handleDeleteSelected}
          disabled={busy || !selected.size}
          className="px-3 py-2 rounded-lg text-sm font-medium bg-red-600/80 text-white hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Delete Selected ({selected.size})
        </button>
        <div className="relative">
          <button
            onClick={() => setByDivisionPick(v => !v)}
            disabled={busy}
            className="px-3 py-2 rounded-lg text-sm font-medium bg-slate-700 text-white hover:bg-slate-600 disabled:opacity-40"
          >
            Delete by Division ▾
          </button>
          {byDivisionPick && (
            <div className="absolute top-full left-0 mt-1 z-10 bg-slate-900 border border-slate-700 rounded-lg p-3 min-w-64 shadow-xl">
              <div className="text-xs text-slate-400 mb-2">Pick a division to soft-delete:</div>
              <select
                value={byDivisionChoice}
                onChange={e => setByDivisionChoice(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white outline-none focus:border-blue-500 mb-2"
              >
                <option value="">— select division —</option>
                {divisions.map(d => (
                  <option key={d.division} value={d.division}>
                    {d.division === '__none__' ? '(No Division)' : d.division} ({d.cnt})
                  </option>
                ))}
              </select>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setByDivisionPick(false); setByDivisionChoice('') }}
                  className="px-3 py-1 rounded text-xs bg-slate-700 hover:bg-slate-600 text-white"
                >Cancel</button>
                <button
                  onClick={handleDeleteByDivision}
                  disabled={!byDivisionChoice}
                  className="px-3 py-1 rounded text-xs bg-red-600 hover:bg-red-500 text-white disabled:opacity-40"
                >Continue</button>
              </div>
            </div>
          )}
        </div>
        <button
          onClick={handleDeleteNonUsss}
          disabled={busy}
          className="px-3 py-2 rounded-lg text-sm font-medium bg-slate-700 text-white hover:bg-slate-600 disabled:opacity-40"
        >
          Delete Non-USSS Athletes
        </button>
      </div>

      {flash && (
        <div className="rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2 mb-4 text-sm text-blue-200 flex items-center justify-between">
          <span>{flash}</span>
          <button onClick={() => setFlash('')} className="text-blue-300 hover:text-white text-xs ml-3">dismiss</button>
        </div>
      )}

      {/* Search + filter */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Search by name, USSA #, FIS ID, or club…"
          value={q}
          onChange={e => onSearch(e.target.value)}
          className="flex-1 min-w-64 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
        />
        <select
          value={divisionFilter}
          onChange={e => onDiv(e.target.value)}
          className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
        >
          <option value="">All Divisions</option>
          {divisions.map(d => (
            <option key={d.division} value={d.division}>
              {d.division === '__none__' ? '(No Division)' : d.division} ({d.cnt})
            </option>
          ))}
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
          {total === 0 && !q && !divisionFilter
            ? 'No athletes in master database.'
            : 'No athletes match your filters.'}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-700/50 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/80 text-left">
                <th className="px-3 py-2.5 w-8">
                  <input type="checkbox" checked={allOnPageSelected} onChange={toggleAllOnPage} />
                </th>
                <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider font-medium">Last</th>
                <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider font-medium">First</th>
                <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider font-medium">USSA #</th>
                <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider font-medium">FIS ID</th>
                <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider font-medium">Club</th>
                <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider font-medium">Division</th>
                <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider font-medium text-right">YOB</th>
                <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider font-medium">Gen</th>
                <th className="px-3 py-2.5 text-xs text-slate-400 uppercase tracking-wider font-medium">USSS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} />
                  </td>
                  <td className="px-3 py-2 text-slate-200">{r.last_name}</td>
                  <td className="px-3 py-2 text-slate-200">{r.first_name}</td>
                  <td className="px-3 py-2 text-white font-mono text-xs">{r.ussa_num || ''}</td>
                  <td className="px-3 py-2 text-slate-400 font-mono text-xs">{r.fis_id || ''}</td>
                  <td className="px-3 py-2 text-slate-300">{r.club || ''}</td>
                  <td className="px-3 py-2 text-slate-300">{r.division || ''}</td>
                  <td className="px-3 py-2 text-slate-300 text-right font-mono">{r.birth_year || ''}</td>
                  <td className="px-3 py-2 text-slate-300">{r.gender || ''}</td>
                  <td className="px-3 py-2">
                    {r.is_in_usss
                      ? <span className="text-emerald-400 text-xs">✓</span>
                      : <span className="text-slate-500 text-xs">—</span>}
                  </td>
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

      {/* Confirmation modal */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-2" style={{ fontFamily: "'Oswald', sans-serif" }}>
              {confirm.label}
            </h3>
            <p className="text-sm text-slate-300 mb-3">
              This will soft-delete <span className="font-mono text-white">{confirm.count}</span> athlete{confirm.count === 1 ? '' : 's'} from the master database.
            </p>
            <p className="text-xs text-slate-400 mb-4">
              Past events keep their athlete data — registrations, runs, and results display normally.
            </p>
            {confirm.sample.length > 0 && (
              <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 mb-4 max-h-48 overflow-auto">
                <div className="text-xs text-slate-400 mb-1">Sample (first {confirm.sample.length}):</div>
                <ul className="text-xs text-slate-300 space-y-0.5">
                  {confirm.sample.map(s => (
                    <li key={s.id}>{s.last_name}, {s.first_name} {s.ussa_num ? <span className="text-slate-500 font-mono">#{s.ussa_num}</span> : null}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirm(null)}
                disabled={busy}
                className="px-4 py-2 rounded-lg text-sm bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-40"
              >Cancel</button>
              <button
                onClick={executeDelete}
                disabled={busy || confirm.count === 0}
                className="px-4 py-2 rounded-lg text-sm bg-red-600 hover:bg-red-500 text-white disabled:opacity-40"
              >{busy ? 'Working…' : `Delete ${confirm.count}`}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
