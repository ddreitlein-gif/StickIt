import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import api from '../utils/api'
import ImportConflictModal from '../components/ImportConflictModal'
import MultiMeetImportModal from '../components/MultiMeetImportModal'

const STATUS_BADGE = {
  setup:    { cls: 'bg-slate-800 text-slate-400 border-slate-700', label: 'Setup' },
  active:   { cls: 'bg-green-900/50 text-green-400 border-green-800', label: 'Active' },
  complete: { cls: 'bg-mountain-900/50 text-mountain-400 border-mountain-800', label: 'Complete' },
}

function Badge({ status }) {
  const b = STATUS_BADGE[status] || STATUS_BADGE.setup
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide border ${b.cls}`}>
      {b.label}
    </span>
  )
}

const DIVISION_OPTIONS = ['Alaska', 'Northwest', 'Far West', 'Intermountain', 'Rocky', 'Central', 'Eastern', 'National Event', 'Other']

function CreateMeetModal({ onClose, onCreate }) {
  const [form, setForm] = useState({ name: '', location: '', date: new Date().toISOString().split('T')[0], meet_ranking: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim() || !form.location.trim() || !form.date || !form.meet_ranking) {
      setError('All fields are required.')
      return
    }
    setLoading(true)
    try {
      const meet = await api.createMeet(form)
      onCreate(meet)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md">
        <h2 className="font-display text-2xl text-white mb-6">New Meet</h2>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Meet Name</label>
            <input
              className="input"
              placeholder="e.g. Rocky Mountain Freestyle Winter Classic"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Location / Venue</label>
            <input
              className="input"
              placeholder="e.g. Winter Park Resort, CO"
              value={form.location}
              onChange={e => setForm({ ...form, location: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Start Date</label>
            <input
              type="date"
              className="input"
              value={form.date}
              onChange={e => setForm({ ...form, date: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Division</label>
            <select
              className="input"
              value={form.meet_ranking}
              onChange={e => setForm({ ...form, meet_ranking: e.target.value })}
            >
              <option value="">Select Division...</option>
              {DIVISION_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? 'Creating...' : 'Create Meet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [meets, setMeets] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const [conflictData, setConflictData] = useState(null)
  const [multiMeetData, setMultiMeetData] = useState(null)
  const importRef = useRef(null)

  useEffect(() => {
    api.getMeets({ excludeLocked: true })
      .then(setMeets)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const handleCreate = (meet) => {
    setMeets([meet, ...meets])
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this meet and all its data?')) return
    await api.deleteMeet(id)
    setMeets(meets.filter(m => m.id !== id))
  }

  const handleImport = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setImportMsg('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/meets/import', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Import failed')
      if (data.multi_meet) {
        setMultiMeetData(data)
        setImporting(false)
      } else if (data.conflict) {
        setConflictData(data)
        setImporting(false)
      } else {
        setImportMsg(`Imported: ${data.summary.events} events, ${data.summary.athletes} athletes, ${data.summary.runs} runs`)
        const refreshed = await api.getMeets({ excludeLocked: true })
        setMeets(refreshed)
        setImporting(false)
      }
    } catch (err) {
      setImportMsg(`Error: ${err.message}`)
      setImporting(false)
    } finally {
      if (importRef.current) importRef.current.value = ''
    }
  }

  const handleConflictResolve = async (action) => {
    if (!conflictData) return
    setImporting(true)
    setImportMsg('')
    try {
      const res = await fetch(
        `/api/meets/import?pending_import_id=${conflictData.pending_import_id}&conflict_action=${action}`,
        { method: 'POST' }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Import failed')
      if (data.cancelled) {
        setImportMsg('')
      } else {
        const s = data.summary
        if (action === 'merge') {
          const parts = []
          if (s.events_added) parts.push(`${s.events_added} events added`)
          if (s.events_updated) parts.push(`${s.events_updated} events updated`)
          if (s.runs_added) parts.push(`${s.runs_added} runs added`)
          if (s.runs_updated) parts.push(`${s.runs_updated} runs updated`)
          if (s.registrations_added) parts.push(`${s.registrations_added} registrations added`)
          setImportMsg(parts.length ? `Merged: ${parts.join(', ')}` : 'Merge complete (no changes needed)')
        } else {
          setImportMsg(`Imported: ${s.events} events, ${s.athletes} athletes, ${s.runs} runs`)
        }
        const refreshed = await api.getMeets({ excludeLocked: true })
        setMeets(refreshed)
      }
    } catch (err) {
      setImportMsg(`Error: ${err.message}`)
    } finally {
      setImporting(false)
      setConflictData(null)
    }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-display text-4xl text-white tracking-wide">Meets</h1>
          <p className="text-slate-500 mt-1">Manage your freestyle mogul competitions</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="file" accept=".zip,.json" ref={importRef} onChange={handleImport} className="hidden" />
          <a
            href="/api/meets/export-all"
            className="btn-secondary"
            title="Download a ZIP containing all currently-visible meets"
          >
            Export All
          </a>
          <button
            onClick={() => importRef.current?.click()}
            disabled={importing}
            className="btn-secondary"
          >
            {importing ? 'Importing...' : 'Import Meet'}
          </button>
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            + New Meet
          </button>
        </div>
      </div>

      {importMsg && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${importMsg.startsWith('Error') ? 'bg-red-900/30 text-red-400' : 'bg-green-900/30 text-green-400'}`}>
          {importMsg}
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Total Meets', value: meets.length },
          { label: 'Active', value: meets.filter(m => m.status === 'active').length },
          { label: 'Complete', value: meets.filter(m => m.status === 'complete').length },
        ].map(s => (
          <div key={s.label} className="stat-box">
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Meet list */}
      {loading ? (
        <div className="text-center py-16 text-slate-500">Loading...</div>
      ) : meets.length === 0 ? (
        <div className="card text-center py-16">
          <p className="text-5xl mb-4">🎿</p>
          <p className="text-slate-400 text-lg">No meets yet.</p>
          <p className="text-slate-600 text-sm mt-1">Create your first meet to get started.</p>
          <button onClick={() => setShowCreate(true)} className="btn-primary mt-6">
            Create First Meet
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {meets.map(meet => (
            <div key={meet.id} className="card-sm flex items-center gap-4 group hover:border-slate-600 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <Link
                    to={`/dashboard/meets/${meet.id}`}
                    className="font-semibold text-white hover:text-mountain-400 transition-colors truncate"
                  >
                    {meet.name}
                  </Link>
                  <Badge status={meet.status} />
                </div>
                <div className="text-sm text-slate-500 flex items-center gap-3">
                  <span>📍 {meet.location}</span>
                  <span>📅 {new Date(meet.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  {meet.event_count > 0 && <span>🏁 {meet.event_count} event{meet.event_count !== 1 ? 's' : ''}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <Link to={`/dashboard/meets/${meet.id}`} className="btn-secondary text-xs py-1.5 px-3">
                  Open
                </Link>
                <button
                  onClick={() => handleDelete(meet.id)}
                  className="btn-ghost text-xs py-1.5 px-2 text-red-500 hover:text-red-400"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateMeetModal
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}

      {conflictData && (
        <ImportConflictModal
          conflictData={conflictData}
          onResolve={handleConflictResolve}
          onClose={() => {
            handleConflictResolve('cancel')
          }}
        />
      )}

      {multiMeetData && (
        <MultiMeetImportModal
          multiMeetData={multiMeetData}
          onClose={() => setMultiMeetData(null)}
          onComplete={async (results) => {
            const ok = results.filter(r => r.ok && !r.cancelled).length
            const fail = results.filter(r => !r.ok).length
            setImportMsg(`Imported ${ok} meet${ok !== 1 ? 's' : ''}${fail ? ` (${fail} failed)` : ''}`)
            const refreshed = await api.getMeets({ excludeLocked: true })
            setMeets(refreshed)
          }}
        />
      )}
    </div>
  )
}
