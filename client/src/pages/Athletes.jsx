import { useState, useEffect, useRef } from 'react'
import api, { authHeaders } from '../utils/api'
import UsssAthleteSearchPanel from '../components/UsssAthleteSearchPanel'

// ── Roster Reconciliation Panel ───────────────────────────────────────────────
function ReconcilePanel({ onDone }) {
  const [file,     setFile]     = useState(null)
  const [csvText,  setCsvText]  = useState('')
  const [mode,     setMode]     = useState('file')
  const [diff,     setDiff]     = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [applying, setApplying] = useState(false)
  const [result,   setResult]   = useState(null)
  const [error,    setError]    = useState('')
  const fileRef = useRef()

  // Selections for apply
  const [selectedAdd, setSelectedAdd]       = useState({})   // index -> true
  const [acceptedFields, setAcceptedFields] = useState({})   // `${id}:${field}` -> true

  const runDiff = async () => {
    let text = csvText
    if (mode === 'file' && file) text = await file.text()
    if (!text.trim()) { setError('No CSV data provided'); return }
    setLoading(true); setError(''); setDiff(null); setResult(null)
    try {
      const r = await fetch('/api/athletes/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', ...authHeaders() },
        body: text,
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)
      setDiff(data)
      // Pre-select all additions
      const sel = {}
      ;(data.toAdd || []).forEach((_, i) => { sel[i] = true })
      setSelectedAdd(sel)
      setAcceptedFields({})
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const applyChanges = async () => {
    if (!diff) return
    setApplying(true); setError('')
    try {
      const add = (diff.toAdd || []).filter((_, i) => selectedAdd[i])
      const update = (diff.toUpdate || [])
        .map(item => {
          const fields = {}
          for (const d of item.diffs) {
            if (acceptedFields[`${item.id}:${d.field}`]) fields[d.field] = d.incoming
          }
          return Object.keys(fields).length ? { id: item.id, fields } : null
        })
        .filter(Boolean)

      const r = await fetch('/api/athletes/reconcile/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ add, update }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)
      setResult(data)
      onDone()
    } catch (e) { setError(e.message) }
    finally { setApplying(false) }
  }

  const toggleAdd = (i) => setSelectedAdd(p => ({ ...p, [i]: !p[i] }))
  const toggleField = (id, field) => {
    const key = `${id}:${field}`
    setAcceptedFields(p => ({ ...p, [key]: !p[key] }))
  }
  const selectAllAdd = () => {
    const sel = {}
    ;(diff?.toAdd || []).forEach((_, i) => { sel[i] = true })
    setSelectedAdd(sel)
  }

  return (
    <div className="card space-y-4">
      <div>
        <h3 className="font-display text-lg text-white mb-1">Roster Reconciliation</h3>
        <p className="text-slate-500 text-sm">
          Upload a CSV roster file to compare against the current athlete database.
          Review differences before applying any changes.  Athletes in the database
          but not in the file are flagged for review and are never deleted.
        </p>
      </div>

      {!diff && (
        <>
          <div className="flex gap-2">
            <button onClick={() => setMode('file')}
              className={`px-3 py-1.5 text-sm rounded-lg ${mode==='file'?'bg-blue-600 text-white':'bg-slate-800 text-slate-400'}`}>
              Upload File
            </button>
            <button onClick={() => setMode('paste')}
              className={`px-3 py-1.5 text-sm rounded-lg ${mode==='paste'?'bg-blue-600 text-white':'bg-slate-800 text-slate-400'}`}>
              Paste CSV
            </button>
          </div>
          {mode === 'file' ? (
            <div>
              <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden"
                onChange={e => setFile(e.target.files[0])} />
              <div onClick={() => fileRef.current.click()}
                className="border-2 border-dashed border-slate-700 rounded-xl p-8 text-center cursor-pointer hover:border-blue-600 transition-colors">
                {file
                  ? <div className="text-white">{file.name}</div>
                  : <div className="text-slate-500">Click to select a CSV file</div>}
              </div>
            </div>
          ) : (
            <textarea className="input h-32 font-mono text-xs resize-y"
              placeholder="Last Name,First Name,USSA#,Gender,Born,Club"
              value={csvText} onChange={e => setCsvText(e.target.value)} />
          )}
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button onClick={runDiff} disabled={loading || (!file && !csvText.trim())}
            className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed">
            {loading ? 'Comparing...' : 'Compare Roster'}
          </button>
        </>
      )}

      {diff && (
        <div className="space-y-5">
          {/* Summary bar */}
          <div className="flex gap-4 text-sm">
            <span className="text-green-400 font-semibold">{diff.toAdd?.length || 0} to add</span>
            <span className="text-yellow-400 font-semibold">{diff.toUpdate?.length || 0} with differences</span>
            <span className="text-slate-500">{diff.notInFile?.length || 0} not in file</span>
            <button onClick={() => { setDiff(null); setResult(null) }} className="ml-auto text-slate-500 hover:text-white text-xs">
              &larr; Start over
            </button>
          </div>

          {/* Athletes to add */}
          {diff.toAdd?.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-white font-semibold text-sm">In file, not in database ({diff.toAdd.length})</h4>
                <button onClick={selectAllAdd} className="text-xs text-blue-400 hover:text-blue-300">Select all</button>
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {diff.toAdd.map((a, i) => (
                  <label key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-800/60 cursor-pointer hover:bg-slate-800">
                    <input type="checkbox" checked={!!selectedAdd[i]} onChange={() => toggleAdd(i)} className="accent-blue-500" />
                    <span className="text-white text-sm">{a.last_name}, {a.first_name}</span>
                    <span className="text-slate-500 text-xs ml-auto">{a.ussa_num || a.fis_id || a.club || ''}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Athletes with field differences */}
          {diff.toUpdate?.length > 0 && (
            <div>
              <h4 className="text-white font-semibold text-sm mb-2">In database with differences ({diff.toUpdate.length})</h4>
              <div className="space-y-3 max-h-72 overflow-y-auto">
                {diff.toUpdate.map(item => (
                  <div key={item.id} className="bg-slate-800/60 rounded-xl p-3">
                    <p className="text-white font-medium text-sm mb-2">{item.last_name}, {item.first_name}</p>
                    <div className="space-y-1">
                      {item.diffs.map(d => {
                        const key = `${item.id}:${d.field}`
                        return (
                          <label key={d.field} className="flex items-start gap-3 cursor-pointer group">
                            <input type="checkbox" checked={!!acceptedFields[key]}
                              onChange={() => toggleField(item.id, d.field)} className="accent-blue-500 mt-0.5" />
                            <div className="text-xs">
                              <span className="text-slate-400 font-mono">{d.field}:</span>
                              <span className="text-red-400 line-through mx-2">{d.current || '(blank)'}</span>
                              <span className="text-green-400">{d.incoming}</span>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Athletes not in file */}
          {diff.notInFile?.length > 0 && (
            <div>
              <h4 className="text-yellow-400 font-semibold text-sm mb-2">In database, not in file -- review only ({diff.notInFile.length})</h4>
              <div className="max-h-36 overflow-y-auto space-y-1">
                {diff.notInFile.map(a => (
                  <div key={a.id} className="flex items-center justify-between px-3 py-1.5 rounded bg-slate-800/40 text-xs">
                    <span className="text-slate-300">{a.last_name}, {a.first_name}</span>
                    <span className="text-slate-500">{a.ussa_num || '--'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result && (
            <div className="bg-green-900/20 border border-green-800 rounded-xl p-4 text-sm">
              <div className="text-green-400 font-semibold">Changes applied</div>
              <div className="text-slate-300 mt-1">Added: <strong>{result.added}</strong> &nbsp; Updated: <strong>{result.updated}</strong></div>
            </div>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}

          {!result && (
            <button onClick={applyChanges} disabled={applying}
              className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed">
              {applying ? 'Applying...' : 'Apply Selected Changes'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}


function ImportPanel({ onImported }) {
  const [mode, setMode] = useState('file')
  const [csvText, setCsvText] = useState('')
  const [file, setFile] = useState(null)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef()

  const submit = async () => {
    let text = csvText
    if (mode === 'file' && file) text = await file.text()
    if (!text.trim()) { setError('No CSV data provided'); return }
    setLoading(true); setError(''); setResult(null)
    try {
      const res = await fetch('/api/import/athletes/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', ...authHeaders() },
        body: text,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult(data)
      onImported()
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="card space-y-4">
      <div>
        <h3 className="font-display text-lg text-white mb-1">Import Athletes from CSV</h3>
        <p className="text-slate-500 text-sm">
          Accepts Winfree-format and standard CSV files.  Recognized column names include:
          Last Name, First Name, Gender, Born, USSA#, FIS#, Club, Bib -- and
          French equivalents.  Column order does not matter.  Existing athletes are matched
          by USSA number, FIS ID, or full name and updated.  Athletes not in the file are
          never deleted.  Blank fields in the import preserve existing values.
        </p>
      </div>
      <div className="flex gap-2">
        <button onClick={() => setMode('file')}
          className={`px-3 py-1.5 text-sm rounded-lg ${mode==='file'?'bg-blue-600 text-white':'bg-slate-800 text-slate-400'}`}>
          Upload File
        </button>
        <button onClick={() => setMode('paste')}
          className={`px-3 py-1.5 text-sm rounded-lg ${mode==='paste'?'bg-blue-600 text-white':'bg-slate-800 text-slate-400'}`}>
          Paste CSV
        </button>
      </div>
      {mode === 'file' ? (
        <div>
          <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden"
            onChange={e => setFile(e.target.files[0])} />
          <div onClick={() => fileRef.current.click()}
            className="border-2 border-dashed border-slate-700 rounded-xl p-8 text-center cursor-pointer hover:border-blue-600 transition-colors">
            {file
              ? <div className="text-white">{file.name} <span className="text-slate-500 text-sm">({(file.size/1024).toFixed(1)} KB)</span></div>
              : <div className="text-slate-500">Click to select a CSV file</div>
            }
          </div>
        </div>
      ) : (
        <textarea
          className="input h-40 font-mono text-xs resize-y"
          placeholder={"Last Name,First Name,USSA#,Gender,Born,Club\nSmith,Jake,1234567,M,2006,RMF"}
          value={csvText}
          onChange={e => setCsvText(e.target.value)}
        />
      )}
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {result && (
        <div className="bg-green-900/20 border border-green-800 rounded-xl p-4 text-sm space-y-1">
          <div className="text-green-400 font-semibold">Import complete -- {result.total} rows processed</div>
          <div className="text-slate-300">Added: <strong>{result.added}</strong></div>
          <div className="text-slate-300">Updated: <strong>{result.updated}</strong></div>
          <div className="text-slate-400">Skipped: {result.skipped}</div>
          {result.errors?.length > 0 && (
            <div className="text-red-400 mt-2">
              <div className="font-semibold mb-1">Errors / skipped details ({result.errors.length}):</div>
              <ul className="list-disc list-inside space-y-0.5">
                {result.errors.map((e, i) => (
                  <li key={i} className="text-xs">{e.name}: {e.reason}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <button onClick={submit} disabled={loading || (!file && !csvText.trim())}
        className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed">
        {loading ? 'Importing...' : 'Import Athletes'}
      </button>
    </div>
  )
}

// ── Inline Edit Row ───────────────────────────────────────────────────────────
function EditRow({ athlete, onSave, onCancel }) {
  const [form, setForm] = useState({
    first_name:  athlete.first_name  || '',
    last_name:   athlete.last_name   || '',
    ussa_num:    athlete.ussa_num    || '',
    fis_id:      athlete.fis_id      || '',
    club:        athlete.club        || '',
    division:    athlete.division    || '',
    birth_year:  athlete.birth_year  || '',
    gender:      athlete.gender      || '',
    bib:         athlete.bib         || '',
  })
  const [error,   setError]   = useState('')
  const [warning, setWarning] = useState('')
  const [saving,  setSaving]  = useState(false)

  const save = async (confirm = false) => {
    if (!form.first_name || !form.last_name) { setError('First and last name required'); return }
    setSaving(true); setError(''); setWarning('')
    try {
      const payload = {
        ...form,
        birth_year: form.birth_year ? parseInt(form.birth_year) : null,
        bib: form.bib === '' || form.bib == null ? null : parseInt(form.bib, 10),
      }
      if (confirm) payload.confirm = true
      const result = await api.updateAthlete(athlete.id, payload)
      onSave(result)
    } catch (err) {
      if (err.message && err.message.startsWith('{"warning"')) {
        const parsed = JSON.parse(err.message)
        setWarning(parsed.warning)
      } else if (err.message && err.message.includes('warning')) {
        setWarning(err.message)
      } else {
        setError(err.message)
      }
    } finally { setSaving(false) }
  }

  const f = (key) => ({ value: form[key], onChange: e => setForm({ ...form, [key]: e.target.value }) })

  return (
    <>
      <tr className="bg-slate-800/60">
        <td><input className="input text-sm py-1 w-28" placeholder="First" {...f('first_name')} /></td>
        <td><input className="input text-sm py-1 w-28" placeholder="Last"  {...f('last_name')} /></td>
        <td><input type="number" min="1" className="input text-sm py-1 font-mono w-16" placeholder="Bib" {...f('bib')} /></td>
        <td><input className="input text-sm py-1 font-mono w-24" placeholder="USSA #" {...f('ussa_num')} /></td>
        <td><input className="input text-sm py-1 font-mono w-24" placeholder="FIS ID" {...f('fis_id')} /></td>
        <td><input className="input text-sm py-1 w-24" placeholder="Club" {...f('club')} /></td>
        <td><input className="input text-sm py-1 w-16 uppercase" placeholder="Div" maxLength={4} {...f('division')} /></td>
        <td><input type="number" className="input text-sm py-1 w-20" placeholder="2008" {...f('birth_year')} /></td>
        <td>
          <select className="input text-sm py-1" value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })}>
            <option value="">--</option>
            <option value="M">M</option>
            <option value="F">F</option>
          </select>
        </td>
        <td>
          <div className="flex gap-2">
            <button onClick={() => save(false)} disabled={saving} className="btn-primary text-xs py-1 px-3">Save</button>
            <button onClick={onCancel} className="btn-ghost text-xs py-1 px-2">Cancel</button>
          </div>
        </td>
      </tr>
      {(error || warning) && (
        <tr className="bg-slate-900">
          <td colSpan={10} className="px-3 py-2">
            {error   && <p className="text-red-400 text-sm">{error}</p>}
            {warning && (
              <div className="flex items-center gap-3">
                <p className="text-yellow-400 text-sm">{warning}</p>
                <button onClick={() => save(true)} className="btn-ghost text-xs py-0.5 px-2 border border-yellow-600 text-yellow-400">
                  Save Anyway
                </button>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

// ── Main Athletes Page ────────────────────────────────────────────────────────
export default function Athletes() {
  const [athletes,   setAthletes]   = useState([])
  const [search,     setSearch]     = useState('')
  const [showForm,   setShowForm]   = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showReconcile, setShowReconcile] = useState(false)
  const [editId,     setEditId]     = useState(null)
  const [form, setForm] = useState({ first_name:'', last_name:'', ussa_num:'', fis_id:'', club:'', division:'', birth_year:'', gender:'' })
  const [error,      setError]      = useState('')
  const [warning,    setWarning]    = useState('')
  const [loading,    setLoading]    = useState(true)
  const [usssSyncing, setUsssSyncing] = useState(false)
  const [usssSyncResult, setUsssSyncResult] = useState(null)
  const [showUsssAdd, setShowUsssAdd] = useState(false)
  const [usssAddMsg, setUsssAddMsg] = useState('')

  const load = () => {
    setLoading(true)
    api.getAthletes(search).then(setAthletes).finally(() => setLoading(false))
  }

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0)
    return () => clearTimeout(t)
  }, [search])

  const handleUsssSync = async () => {
    setUsssSyncing(true); setUsssSyncResult(null)
    try {
      const result = await api.syncAthletesWithUsss()
      setUsssSyncResult(result)
      load()
    } catch (e) { setUsssSyncResult({ error: e.message }) }
    finally { setUsssSyncing(false) }
  }

  const handleUsssAddConfirm = async (picks) => {
    setUsssAddMsg('')
    try {
      const ussa_ids = picks.map(p => p.ussa_id)
      const { athletes } = await api.createAthletesFromUsss(ussa_ids)
      const created = athletes.filter(a => a.created).length
      const reused = athletes.filter(a => a.athlete_id && !a.created).length
      const errs = athletes.filter(a => a.error).length
      setUsssAddMsg(`Added ${created} new athlete${created !== 1 ? 's' : ''}, ${reused} already in registry${errs ? `, ${errs} not found` : ''}.`)
      setShowUsssAdd(false)
      load()
    } catch (e) {
      setUsssAddMsg('Error: ' + e.message)
    }
  }

  const create = async (e, confirm = false) => {
    if (e) e.preventDefault()
    if (!form.first_name || !form.last_name) { setError('First and last name required'); return }
    setError(''); setWarning('')
    try {
      const payload = { ...form, birth_year: form.birth_year ? parseInt(form.birth_year) : null }
      if (confirm) payload.confirm = true
      const a = await api.createAthlete(payload)
      setAthletes([a, ...athletes])
      setForm({ first_name:'', last_name:'', ussa_num:'', fis_id:'', club:'', division:'', birth_year:'', gender:'' })
      setShowForm(false)
    } catch (err) {
      // Check for name-duplicate warning response (HTTP 409 with warning key)
      if (err.message && err.message.toLowerCase().includes('already exists')) {
        setWarning(err.message)
      } else {
        setError(err.message)
      }
    }
  }

  const handleEditSave = (updated) => {
    setAthletes(athletes.map(a => a.id === updated.id ? updated : a))
    setEditId(null)
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-display text-4xl text-white">Athletes</h1>
          <p className="text-slate-500 mt-1">Global registry -- athletes are reused across meets</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleUsssSync} disabled={usssSyncing}
            className="btn-ghost text-sm disabled:opacity-50">
            {usssSyncing ? 'Syncing...' : 'Sync with USSS'}
          </button>
          <button onClick={() => { setShowImport(!showImport); setShowForm(false); setShowReconcile(false); setShowUsssAdd(false) }}
            className="btn-ghost text-sm">
            {showImport ? 'Hide Import' : 'Import CSV'}
          </button>
          <button onClick={() => { setShowReconcile(!showReconcile); setShowForm(false); setShowImport(false); setShowUsssAdd(false) }}
            className="btn-ghost text-sm">
            {showReconcile ? 'Hide Reconcile' : 'Reconcile Roster'}
          </button>
          <button onClick={() => { setShowUsssAdd(!showUsssAdd); setShowForm(false); setShowImport(false); setShowReconcile(false); setUsssAddMsg('') }}
            className="btn-ghost text-sm">
            {showUsssAdd ? 'Hide USSS Add' : 'Add from USSS Database'}
          </button>
          <button onClick={() => { setShowForm(!showForm); setShowImport(false); setShowReconcile(false); setShowUsssAdd(false) }}
            className="btn-primary">
            Manual Entry
          </button>
        </div>
      </div>

      {/* USSS Sync Result */}
      {usssSyncResult && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${usssSyncResult.error ? 'bg-red-900/20 border border-red-800 text-red-400' : 'bg-green-900/20 border border-green-800 text-green-400'}`}>
          {usssSyncResult.error
            ? `Sync failed: ${usssSyncResult.error}`
            : `Sync complete -- ${usssSyncResult.matched} matched, ${usssSyncResult.updated} updated, ${usssSyncResult.not_found} not found in USSS database`}
          <button onClick={() => setUsssSyncResult(null)} className="ml-3 text-slate-500 hover:text-white text-xs">Dismiss</button>
        </div>
      )}

      {showImport && <div className="mb-6"><ImportPanel onImported={load} /></div>}
      {showReconcile && <div className="mb-6"><ReconcilePanel onDone={() => { load(); setShowReconcile(false) }} /></div>}

      {usssAddMsg && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-green-900/20 border border-green-800 text-green-400 text-sm">
          {usssAddMsg}
          <button onClick={() => setUsssAddMsg('')} className="ml-3 text-slate-500 hover:text-white text-xs">Dismiss</button>
        </div>
      )}

      {showUsssAdd && (
        <div className="mb-6">
          <UsssAthleteSearchPanel
            onConfirm={handleUsssAddConfirm}
            onClose={() => setShowUsssAdd(false)}
            confirmLabel="Add to Registry"
          />
        </div>
      )}

      {showForm && (
        <div className="card mb-6">
          <h3 className="font-display text-lg text-white mb-4">Add Athlete</h3>

          <form onSubmit={create} className="grid grid-cols-4 gap-3">
            <div><label className="label">First Name *</label>
              <input className="input" value={form.first_name} onChange={e => setForm({...form,first_name:e.target.value})} /></div>
            <div><label className="label">Last Name *</label>
              <input className="input" value={form.last_name} onChange={e => setForm({...form,last_name:e.target.value})} /></div>
            <div><label className="label">USSA Number</label>
              <input className="input font-mono" value={form.ussa_num} onChange={e => setForm({...form,ussa_num:e.target.value})} /></div>
            <div><label className="label">FIS ID</label>
              <input className="input font-mono" value={form.fis_id} onChange={e => setForm({...form,fis_id:e.target.value})} /></div>
            <div><label className="label">Club / Team</label>
              <input className="input" value={form.club} onChange={e => setForm({...form,club:e.target.value})} /></div>
            <div><label className="label">Division</label>
              <input className="input uppercase" maxLength={4} placeholder="RM" value={form.division}
                onChange={e => setForm({...form,division:e.target.value})} /></div>
            <div><label className="label">Birth Year</label>
              <input type="number" className="input" placeholder="e.g. 2008" value={form.birth_year}
                onChange={e => setForm({...form,birth_year:e.target.value})} /></div>
            <div><label className="label">Gender</label>
              <select className="input" value={form.gender} onChange={e => setForm({...form,gender:e.target.value})}>
                <option value="">--</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
              </select></div>
            <div className="col-span-4 flex gap-3 items-center">
              <button type="submit" className="btn-primary">Save Athlete</button>
              <button type="button" onClick={() => { setShowForm(false); setError(''); setWarning('') }} className="btn-ghost">Cancel</button>
              {error   && <p className="text-red-400 text-sm">{error}</p>}
              {warning && (
                <div className="flex items-center gap-3">
                  <p className="text-yellow-400 text-sm">{warning}</p>
                  <button type="button" onClick={() => create(null, true)} className="btn-ghost text-xs border border-yellow-600 text-yellow-400 py-0.5 px-2">
                    Save Anyway
                  </button>
                </div>
              )}
            </div>
          </form>
        </div>
      )}

      <div className="mb-4">
        <input className="input max-w-sm" placeholder="Search by name, USSA number, or FIS ID..."
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="card p-0 overflow-hidden overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>First</th><th>Last</th><th>Bib</th><th>USSA #</th><th>FIS ID</th>
              <th>Club</th><th>Div</th><th>Birth Year</th><th>Gender</th><th></th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? <tr><td colSpan={10} className="text-center text-slate-500 py-8">Loading...</td></tr>
              : !athletes.length
                ? <tr><td colSpan={10} className="text-center text-slate-500 py-8">No athletes found.</td></tr>
                : athletes.map(a => editId === a.id
                    ? <EditRow key={a.id} athlete={a} onSave={handleEditSave} onCancel={() => setEditId(null)} />
                    : (
                      <tr key={a.id} className="cursor-pointer active:bg-slate-800/40" onClick={() => setEditId(a.id)} onTouchEnd={(e) => { e.preventDefault(); setEditId(a.id) }}>
                        <td className="text-white">{a.first_name}</td>
                        <td className="text-white font-medium">{a.last_name}</td>
                        <td className="font-mono text-slate-300 text-xs">{a.bib || '--'}</td>
                        <td className="font-mono text-slate-400 text-xs">{a.ussa_num || '--'}</td>
                        <td className="font-mono text-slate-400 text-xs">{a.fis_id   || '--'}</td>
                        <td className="text-slate-500 text-sm">{a.club      || '--'}</td>
                        <td className="text-slate-400 text-xs font-mono">{a.division || '--'}</td>
                        <td className="text-slate-500 text-sm">{a.birth_year|| '--'}</td>
                        <td className="text-slate-500 text-sm">{a.gender === 'M' ? 'Male' : a.gender === 'F' ? 'Female' : '--'}</td>
                        <td className="text-slate-600 text-xs">Edit</td>
                      </tr>
                    )
                  )
            }
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-slate-600 text-xs text-right">{athletes.length} athletes shown -- click a row to edit</div>
    </div>
  )
}
