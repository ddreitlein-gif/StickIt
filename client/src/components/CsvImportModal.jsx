import { useState } from 'react'
import { authHeaders } from '../utils/api'

// StickIt v1.5 Feature 1: CSV registration import modal.
// Two-step flow: upload -> preview (server mode=preview) -> confirm -> commit.

export default function CsvImportModal({ meetId, eventId, event, onClose, onImported }) {
  const [file, setFile]         = useState(null)
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview]   = useState(null)
  const [committing, setCommitting] = useState(false)
  const [error, setError]       = useState('')
  const [open, setOpen]         = useState({ other: false, gender: false, already: false, unrec: false })
  const [wrongEventOverrides, setWrongEventOverrides] = useState(new Set())

  const doUpload = async (mode) => {
    if (!file) return
    setError('')
    const setter = mode === 'commit' ? setCommitting : setUploading
    setter(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (mode === 'commit' && wrongEventOverrides.size > 0) {
        fd.append('overrideEventCheck', JSON.stringify([...wrongEventOverrides]))
      }
      const res = await fetch(`/api/events/${eventId}/registrations/import-csv?mode=${mode}`, {
        method: 'POST',
        headers: authHeaders(),
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
      if (mode === 'commit') {
        if (onImported) onImported(data)
        onClose()
      } else {
        setPreview(data)
        setWrongEventOverrides(new Set())
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setter(false)
    }
  }

  const toggle = (k) => setOpen(o => ({ ...o, [k]: !o[k] }))

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h3 className="font-display text-lg text-white">Upload Registration CSV</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="bg-red-900/30 border border-red-800 text-red-400 rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}

          {!preview && (
            <div className="space-y-4">
              <div className="text-sm text-slate-400">
                Upload a USSS registration CSV. Rows are matched to this event by discipline and gender.
                Event: <span className="text-white font-semibold">{event?.name || ''}</span>
                {' '}({event?.discipline}, {event?.gender})
              </div>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={e => { setFile(e.target.files?.[0] || null); setError('') }}
                className="block w-full text-sm text-slate-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-slate-700 file:text-white hover:file:bg-slate-600"
              />
              <button
                onClick={() => doUpload('preview')}
                disabled={!file || uploading}
                className="btn-primary disabled:opacity-50"
              >
                {uploading ? 'Analyzing...' : 'Analyze CSV'}
              </button>
            </div>
          )}

          {preview && (() => {
            const overrideCount = wrongEventOverrides.size
            const effectiveRegisterCount = preview.toRegister.length + overrideCount
            return (
            <div className="space-y-4">
              <div className="grid grid-cols-5 gap-2 text-center text-xs">
                <Stat n={effectiveRegisterCount} label="To Register" color="green" />
                <Stat n={preview.skippedOtherEvent.length - overrideCount} label="Wrong Event" color="slate" />
                <Stat n={preview.skippedGenderMismatch.length} label="Gender Mismatch" color="amber" />
                <Stat n={preview.skippedAlreadyRegistered.length} label="Already Registered" color="slate" />
                <Stat n={preview.skippedUnrecognized.length} label="Unrecognized" color="red" />
              </div>

              {/* To Register table */}
              <div>
                <div className="text-sm font-semibold text-white mb-2">To Register ({preview.toRegister.length})</div>
                {preview.toRegister.length === 0 ? (
                  <div className="text-sm text-slate-500 italic">No matching athletes.</div>
                ) : (
                  <div className="border border-slate-800 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-800 text-slate-400 uppercase">
                        <tr>
                          <th className="px-3 py-2 text-left">Name</th>
                          <th className="px-3 py-2 text-left">USSS#</th>
                          <th className="px-3 py-2 text-left">Birth Yr</th>
                          <th className="px-3 py-2 text-left">Bib</th>
                          <th className="px-3 py-2 text-left">Bib Source</th>
                          <th className="px-3 py-2 text-left">Athlete</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {preview.toRegister.map((r, i) => (
                          <tr key={i} className="text-slate-300">
                            <td className="px-3 py-2">{r.lastName}, {r.firstName}</td>
                            <td className="px-3 py-2 text-slate-500">{r.usssId}</td>
                            <td className="px-3 py-2 text-slate-500">{r.birthYear || ''}</td>
                            <td className="px-3 py-2">{r.bib ?? <span className="text-slate-600">—</span>}</td>
                            <td className="px-3 py-2 text-slate-500">
                              {r.bibSource === 'athletes_tab' ? 'Athletes tab' : r.bibSource === 'csv' ? 'CSV' : 'none'}
                            </td>
                            <td className="px-3 py-2 text-slate-500">
                              {r.athleteExists ? 'Existing' : <span className="text-green-500">New</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Skipped collapsibles */}
              <WrongEventOverrideSection
                rows={preview.skippedOtherEvent}
                open={open.other} onToggle={() => toggle('other')}
                selected={wrongEventOverrides}
                onSelectionChange={setWrongEventOverrides} />
              <SkipSection title="Gender Mismatch" rows={preview.skippedGenderMismatch}
                open={open.gender} onToggle={() => toggle('gender')}
                render={r => `${r.name} (#${r.usssId}) -- ${r.gender} / ${r.category}`} />
              <SkipSection title="Already Registered" rows={preview.skippedAlreadyRegistered}
                open={open.already} onToggle={() => toggle('already')}
                render={r => `${r.name} (#${r.usssId})`} />
              <SkipSection title="Unrecognized" rows={preview.skippedUnrecognized}
                open={open.unrec} onToggle={() => toggle('unrec')}
                render={r => `${r.name} (#${r.usssId || '—'}) -- ${r.reason || ''}`} />
            </div>
            )
          })()}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-800 flex justify-end gap-3">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          {preview && (
            <button
              onClick={() => doUpload('commit')}
              disabled={committing || (preview.toRegister.length + wrongEventOverrides.size) === 0}
              className="btn-primary disabled:opacity-50"
            >
              {committing ? 'Importing...' : `Confirm Import (${preview.toRegister.length + wrongEventOverrides.size} athletes)`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ n, label, color }) {
  const colors = {
    green:  'bg-green-900/30 border-green-800 text-green-400',
    red:    'bg-red-900/30 border-red-800 text-red-400',
    amber:  'bg-amber-900/30 border-amber-800 text-amber-400',
    slate:  'bg-slate-800 border-slate-700 text-slate-400',
  }
  return (
    <div className={`rounded-lg border px-2 py-2 ${colors[color] || colors.slate}`}>
      <div className="text-2xl font-bold">{n}</div>
      <div className="uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  )
}

function WrongEventOverrideSection({ rows, open, onToggle, selected, onSelectionChange }) {
  if (!rows || rows.length === 0) return null
  const selectableRows = rows.filter(r => r.usssId)
  const allSelected = selectableRows.length > 0 && selectableRows.every(r => selected.has(r.usssId))

  const toggleAll = () => {
    if (allSelected) {
      onSelectionChange(new Set())
    } else {
      onSelectionChange(new Set(selectableRows.map(r => r.usssId)))
    }
  }

  const toggleOne = (usssId) => {
    const next = new Set(selected)
    next.has(usssId) ? next.delete(usssId) : next.add(usssId)
    onSelectionChange(next)
  }

  return (
    <div className="border border-slate-800 rounded-lg">
      <button onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">
        <span>Wrong Event ({rows.length}){selected.size > 0 && <span className="text-blue-400"> — {selected.size} selected to override</span>}</span>
        <span className="text-slate-500">{open ? '▼' : '▶'}</span>
      </button>
      {open && (
        <div className="px-3 py-2 border-t border-slate-800 text-xs text-slate-400 space-y-1 max-h-48 overflow-y-auto">
          {selectableRows.length > 0 && (
            <button onClick={toggleAll}
              className="text-xs text-blue-400 hover:text-blue-300 mb-1 font-semibold">
              {allSelected ? 'Deselect All' : 'Select All — Register Anyway'}
            </button>
          )}
          {rows.map((r, i) => (
            r.usssId ? (
              <label key={i} className="flex items-center gap-2 cursor-pointer hover:text-slate-300">
                <input type="checkbox" checked={selected.has(r.usssId)}
                  onChange={() => toggleOne(r.usssId)}
                  className="rounded border-slate-600" />
                {r.name} (#{r.usssId}) — {r.category}
              </label>
            ) : (
              <div key={i}>{r.name} — {r.category}</div>
            )
          ))}
        </div>
      )}
    </div>
  )
}

function SkipSection({ title, rows, open, onToggle, render }) {
  if (!rows || rows.length === 0) return null
  return (
    <div className="border border-slate-800 rounded-lg">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
      >
        <span>{title} ({rows.length})</span>
        <span className="text-slate-500">{open ? '▼' : '▶'}</span>
      </button>
      {open && (
        <div className="px-3 py-2 border-t border-slate-800 text-xs text-slate-400 space-y-1 max-h-48 overflow-y-auto">
          {rows.map((r, i) => <div key={i}>{render(r)}</div>)}
        </div>
      )}
    </div>
  )
}
