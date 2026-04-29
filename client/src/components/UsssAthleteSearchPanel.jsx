import { useState } from 'react'
import api from '../utils/api'

// Reusable panel: search USSS database for competitors, select multiple, and
// invoke onConfirm with the selected USSS records.  The parent decides what to
// do with the selections (create athletes, register them, both, etc.).
export default function UsssAthleteSearchPanel({ onConfirm, onClose, confirmLabel, genderFilter }) {
  const [last, setLast] = useState('')
  const [first, setFirst] = useState('')
  const [ussaId, setUssaId] = useState('')
  const [results, setResults] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)

  const doSearch = async (e) => {
    if (e) e.preventDefault()
    setError('')
    if (!last.trim() && !ussaId.trim()) {
      setError('Last name or USSS ID is required')
      return
    }
    setSearching(true); setSearched(true)
    try {
      let data = await api.searchUsssAthletesAdvanced({
        last: last.trim(),
        first: first.trim(),
        ussa_id: ussaId.trim(),
      })
      if (genderFilter) {
        data = data.filter(p => !p.gender || p.gender === genderFilter)
      }
      setResults(data)
      setSelected(new Set())
    } catch (err) {
      setError(err.message || 'Search failed')
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  const toggle = (ussa_id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(ussa_id) ? next.delete(ussa_id) : next.add(ussa_id)
      return next
    })
  }

  const selectAll = () => setSelected(new Set(results.map(r => r.ussa_id)))
  const clearAll = () => setSelected(new Set())

  const handleConfirm = () => {
    const picks = results.filter(r => selected.has(r.ussa_id))
    if (!picks.length) return
    onConfirm(picks)
  }

  return (
    <div className="border border-slate-700 rounded-xl overflow-hidden bg-slate-900/40">
      <div className="bg-slate-800 px-4 py-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-white">Register from USSS Database</span>
        {onClose && <button onClick={onClose} className="text-slate-400 hover:text-white text-sm">Close</button>}
      </div>

      <form onSubmit={doSearch} className="p-4 grid grid-cols-4 gap-3 items-end border-b border-slate-800">
        <div>
          <label className="label">Last Name</label>
          <input className="input" placeholder="Required (or USSS ID)" value={last}
            onChange={e => setLast(e.target.value)} />
        </div>
        <div>
          <label className="label">First Name (optional)</label>
          <input className="input" placeholder="Narrow results" value={first}
            onChange={e => setFirst(e.target.value)} />
        </div>
        <div>
          <label className="label">USSS ID</label>
          <input className="input font-mono" placeholder="Required (or last name)" value={ussaId}
            onChange={e => setUssaId(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary" disabled={searching}>
          {searching ? 'Searching...' : 'Search'}
        </button>
      </form>

      {error && <p className="px-4 py-2 text-red-400 text-sm">{error}</p>}

      {searched && !searching && (
        <div>
          {results.length === 0 ? (
            <p className="px-4 py-6 text-slate-500 text-sm text-center">No matching competitors found.</p>
          ) : (
            <>
              <div className="px-4 py-2 bg-slate-800/50 flex items-center justify-between text-xs">
                <span className="text-slate-400">{results.length} result{results.length !== 1 ? 's' : ''} -- {selected.size} selected</span>
                <div className="flex gap-3">
                  <button type="button" onClick={selectAll} className="text-slate-400 hover:text-white">Select All</button>
                  <button type="button" onClick={clearAll} className="text-slate-400 hover:text-white">Clear</button>
                </div>
              </div>
              <div className="max-h-80 overflow-y-auto">
                <table className="data-table w-full">
                  <thead>
                    <tr>
                      <th className="w-8"></th>
                      <th>Last</th>
                      <th>First</th>
                      <th>USSS ID</th>
                      <th>Div</th>
                      <th>G</th>
                      <th>YOB</th>
                      <th>Club</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map(p => (
                      <tr key={p.ussa_id}
                        onClick={() => toggle(p.ussa_id)}
                        className={`cursor-pointer ${selected.has(p.ussa_id) ? 'bg-blue-900/30' : 'hover:bg-slate-800/40'}`}>
                        <td>
                          <input type="checkbox" readOnly checked={selected.has(p.ussa_id)} />
                        </td>
                        <td className="text-white font-medium">{p.last_name}</td>
                        <td className="text-white">{p.first_name}</td>
                        <td className="font-mono text-slate-400 text-xs">{p.ussa_id}</td>
                        <td className="text-slate-400 text-xs">{p.division || '--'}</td>
                        <td className="text-slate-400 text-xs">{p.gender || '--'}</td>
                        <td className="text-slate-400 text-xs">{p.yob || '--'}</td>
                        <td className="text-slate-500 text-xs">{p.club_name || '--'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-3 border-t border-slate-800 flex items-center justify-end gap-3">
                <button type="button" onClick={handleConfirm} disabled={!selected.size}
                  className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed">
                  {confirmLabel || 'Confirm'} ({selected.size})
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
