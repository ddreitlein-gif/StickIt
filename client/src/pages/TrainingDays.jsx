import { useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import api from '../utils/api'

function formatDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    })
  } catch {
    return iso
  }
}

function CreateOrEditModal({ initial = null, onClose, onSave }) {
  const [name, setName] = useState(initial?.name || '')
  const [date, setDate] = useState(initial?.date || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError(null)
    try {
      await onSave({ name: name.trim(), date: date || null })
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="card max-w-md w-full">
        <h2 className="font-display text-xl text-white mb-4">
          {initial ? 'Edit Training Day' : 'New Training Day'}
        </h2>
        <div className="space-y-4">
          <div>
            <label className="label">Name</label>
            <input
              className="input"
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Thursday Training"
            />
          </div>
          <div>
            <label className="label">Date (optional)</label>
            <input
              className="input"
              type="date"
              value={date || ''}
              onChange={e => setDate(e.target.value)}
            />
          </div>
          {error && <div className="text-red-400 text-sm">{error}</div>}
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button type="button" className="btn-ghost text-sm" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn-primary text-sm" disabled={saving}>
            {saving ? 'Saving…' : (initial ? 'Save Changes' : 'Create')}
          </button>
        </div>
      </form>
    </div>
  )
}

function ConfirmModal({ title, message, onConfirm, onClose, danger = false }) {
  const [working, setWorking] = useState(false)
  const go = async () => {
    setWorking(true)
    try { await onConfirm(); onClose() }
    finally { setWorking(false) }
  }
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="card max-w-sm w-full">
        <h2 className="font-display text-lg text-white mb-2">{title}</h2>
        <p className="text-sm text-slate-300 mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button className="btn-ghost text-sm" onClick={onClose} disabled={working}>Cancel</button>
          <button className={(danger ? 'btn-danger' : 'btn-primary') + ' text-sm'} onClick={go} disabled={working}>
            {working ? 'Working…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TrainingDays() {
  const { meetId } = useParams()
  const navigate = useNavigate()

  const [meet, setMeet] = useState(null)
  const [days, setDays] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [participants, setParticipants] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingParticipants, setLoadingParticipants] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [editingDay, setEditingDay] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [pageError, setPageError] = useState(null)

  // Load meet + training days
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      api.getMeet(meetId),
      api.listTrainingDays(meetId),
    ])
      .then(([m, list]) => {
        if (cancelled) return
        setMeet(m)
        setDays(list)
        if (list.length > 0 && !selectedId) setSelectedId(list[0].id)
      })
      .catch(err => { if (!cancelled) setPageError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetId])

  // Load participants for the selected day
  const refreshParticipants = async (idOverride) => {
    const id = idOverride || selectedId
    if (!id) { setParticipants([]); return }
    setLoadingParticipants(true)
    try {
      const data = await api.getTrainingParticipants(id)
      setParticipants(data.participants || [])
    } catch (err) {
      setPageError(err.message)
    } finally {
      setLoadingParticipants(false)
    }
  }

  useEffect(() => {
    refreshParticipants()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const selectedDay = days.find(d => d.id === selectedId) || null
  const includedCount = participants.filter(p => p.included).length

  const createDay = async (data) => {
    const created = await api.createTrainingDay(meetId, data)
    setDays(prev => [...prev, created].sort((a, b) => {
      const ad = a.date || ''
      const bd = b.date || ''
      if (ad && bd && ad !== bd) return ad.localeCompare(bd)
      if (ad && !bd) return -1
      if (!ad && bd) return 1
      return (a.created_at || '').localeCompare(b.created_at || '')
    }))
    setSelectedId(created.id)
  }

  const updateDay = async (data) => {
    const updated = await api.updateTrainingDay(meetId, editingDay.id, data)
    setDays(prev => prev.map(d => d.id === updated.id ? updated : d))
  }

  const deleteDay = async () => {
    const id = confirmDelete.id
    await api.deleteTrainingDay(meetId, id)
    setDays(prev => prev.filter(d => d.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  const toggleAthlete = async (athleteId, currentlyIncluded) => {
    // Optimistic update
    setParticipants(prev => prev.map(p =>
      p.athlete_id === athleteId ? { ...p, included: !currentlyIncluded } : p
    ))
    try {
      await api.toggleTrainingExclusion(selectedId, athleteId, currentlyIncluded /* exclude when currently included */)
    } catch (err) {
      // Revert on failure
      setParticipants(prev => prev.map(p =>
        p.athlete_id === athleteId ? { ...p, included: currentlyIncluded } : p
      ))
      setPageError(err.message)
    }
  }

  const toggleAll = async (includeAll) => {
    // Optimistic
    const previous = participants
    setParticipants(prev => prev.map(p => ({ ...p, included: includeAll })))
    try {
      if (includeAll) {
        await api.resetTrainingExclusions(selectedId)
      } else {
        // v1.25.00 (C-17) — one bulk request instead of one per athlete
        const ids = previous.filter(x => x.included).map(x => x.athlete_id)
        if (ids.length) await api.toggleTrainingExclusionBulk(selectedId, ids, true)
      }
    } catch (err) {
      setParticipants(previous)
      setPageError(err.message)
    }
  }

  const resetExclusions = async () => {
    await api.resetTrainingExclusions(selectedId)
    refreshParticipants()
  }

  const downloadPdf = async () => {
    if (!selectedDay) return
    setDownloading(true)
    try {
      const meetSlug = (meet?.name || 'meet').replace(/\s+/g, '_')
      const daySlug = (selectedDay.name || 'roster').replace(/\s+/g, '_')
      await api.downloadTrainingDayPdf(selectedDay.id, `Training_Day_${meetSlug}_${daySlug}`)
    } catch (err) {
      alert('PDF generation failed: ' + err.message)
    } finally {
      setDownloading(false)
    }
  }

  if (loading) return <div className="p-8 text-slate-500">Loading…</div>
  if (!meet) return <div className="p-8 text-slate-400">Meet not found.</div>

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-6">
        <Link to="/dashboard" className="hover:text-white transition-colors">Meets</Link>
        <span>/</span>
        <Link to={`/dashboard/meets/${meetId}`} className="hover:text-white transition-colors">{meet.name}</Link>
        <span>/</span>
        <span className="text-slate-300">Training Days</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-display text-4xl text-white tracking-wide">Training Days</h1>
          <div className="flex items-center gap-4 mt-2 text-slate-500 text-sm">
            <span>📅 {meet.name}</span>
          </div>
        </div>
        <button onClick={() => navigate(`/dashboard/meets/${meetId}`)} className="btn-ghost text-sm">
          ← Back to Meet
        </button>
      </div>

      {pageError && (
        <div className="mb-4 bg-red-900/30 border border-red-800 text-red-300 text-sm rounded-lg px-4 py-2 flex items-center justify-between">
          <span>{pageError}</span>
          <button onClick={() => setPageError(null)} className="text-red-400 hover:text-red-200 text-xs">dismiss</button>
        </div>
      )}

      <div className="grid grid-cols-12 gap-6">
        {/* Left column: training day list */}
        <aside className="col-span-12 md:col-span-4">
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-lg text-white">Training Days</h2>
              <button onClick={() => setShowCreate(true)} className="btn-primary text-sm">
                + New
              </button>
            </div>

            {days.length === 0 ? (
              <p className="text-slate-500 text-sm">No training days yet. Click <span className="text-slate-300">+ New</span> to create one.</p>
            ) : (
              <ul className="space-y-2">
                {days.map(d => (
                  <li
                    key={d.id}
                    onClick={() => setSelectedId(d.id)}
                    className={`rounded-lg p-3 cursor-pointer border transition-colors ${
                      d.id === selectedId
                        ? 'bg-mountain-900/40 border-mountain-700'
                        : 'bg-slate-800/40 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-white font-semibold text-sm truncate">{d.name}</div>
                        {d.date && <div className="text-slate-400 text-xs mt-0.5">{formatDate(d.date)}</div>}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingDay(d) }}
                          className="text-xs text-slate-400 hover:text-mountain-400 px-2 py-1"
                          title="Edit"
                        >
                          ✎
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDelete(d) }}
                          className="text-xs text-slate-400 hover:text-red-400 px-2 py-1"
                          title="Delete"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Right column: participants */}
        <section className="col-span-12 md:col-span-8">
          {!selectedDay ? (
            <div className="card text-center py-16">
              <p className="text-4xl mb-4">🎿</p>
              <p className="text-slate-400">Select or create a training day.</p>
            </div>
          ) : (
            <div className="card">
              <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
                <div>
                  <h2 className="font-display text-xl text-white">{selectedDay.name}</h2>
                  {selectedDay.date && <div className="text-slate-400 text-sm mt-0.5">{formatDate(selectedDay.date)}</div>}
                  <div className="text-slate-500 text-xs mt-1">
                    {includedCount} of {participants.length} athlete{participants.length === 1 ? '' : 's'} included
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setConfirmReset(true)}
                    className="btn-ghost text-sm"
                    disabled={loadingParticipants || participants.length === 0}
                  >
                    Reset (Include All)
                  </button>
                  <button
                    onClick={downloadPdf}
                    className="btn-primary text-sm"
                    disabled={downloading || includedCount === 0}
                  >
                    {downloading ? 'Generating…' : 'Print PDF'}
                  </button>
                </div>
              </div>

              {loadingParticipants ? (
                <p className="text-slate-500 text-sm">Loading participants…</p>
              ) : participants.length === 0 ? (
                <p className="text-slate-500 text-sm">
                  No registered athletes on this meet yet. Add registrations to any event, then return here.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="w-10">
                          <input
                            type="checkbox"
                            checked={participants.length > 0 && includedCount === participants.length}
                            ref={el => { if (el) el.indeterminate = includedCount > 0 && includedCount < participants.length }}
                            onChange={(e) => toggleAll(e.target.checked)}
                          />
                        </th>
                        <th>Bib</th>
                        <th>Athlete</th>
                        <th>USSA #</th>
                        <th>Club</th>
                      </tr>
                    </thead>
                    <tbody>
                      {participants.map(p => (
                        <tr
                          key={p.athlete_id}
                          className={p.included ? '' : 'opacity-50'}
                        >
                          <td>
                            <input
                              type="checkbox"
                              checked={p.included}
                              onChange={() => toggleAthlete(p.athlete_id, p.included)}
                            />
                          </td>
                          <td className="font-mono">{p.bib_number ?? ''}</td>
                          <td className="text-slate-100">{p.last_name}, {p.first_name}</td>
                          <td className="text-slate-400">{p.ussa_num || ''}</td>
                          <td className="text-slate-400">{p.club || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {showCreate && (
        <CreateOrEditModal
          onClose={() => setShowCreate(false)}
          onSave={createDay}
        />
      )}

      {editingDay && (
        <CreateOrEditModal
          initial={editingDay}
          onClose={() => setEditingDay(null)}
          onSave={updateDay}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete Training Day"
          message={`Delete "${confirmDelete.name}"? This removes the day and its participant exclusions, but does not change any event registrations.`}
          danger
          onClose={() => setConfirmDelete(null)}
          onConfirm={deleteDay}
        />
      )}

      {confirmReset && (
        <ConfirmModal
          title="Reset Participant List"
          message="Include every registered athlete again? Any unchecked athletes will be re-included."
          onClose={() => setConfirmReset(false)}
          onConfirm={resetExclusions}
        />
      )}
    </div>
  )
}
