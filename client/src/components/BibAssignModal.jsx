// ── BibAssignModal ────────────────────────────────────────────────────────────
// v1.6 Feature 4: Assign bib numbers to all registrations in an event.
// Three modes:
//   1. Generate by Run Order  -- bib_number = run_order (skip nulls)
//   2. Generate Randomly      -- shuffle the active registrations and assign
//                                bib_number = 1..N
//   3. Copy from Another Event -- pull bib_number from another event in this
//                                meet, matched by athlete_id
//
// Writes only to registrations.bib_number via PUT /events/:eventId/registrations/:id.
// Import/Export buttons sync between registrations.bib_number and athletes.bib.
// Refuses if any run for this event has
// started, unless the user explicitly confirms the destructive override.
//
// If existing bib numbers are detected, prompts whether to replace all or
// only fill in athletes who don't yet have a bib.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import api, { authHeaders } from '../utils/api'

export default function BibAssignModal({ event, registrations, onClose, onRefresh }) {
  const [mode,        setMode]        = useState('run_order')
  const [meetEvents,  setMeetEvents]  = useState([])
  const [sourceId,    setSourceId]    = useState('')
  const [busy,        setBusy]        = useState(false)
  const [error,       setError]       = useState('')
  const [msg,         setMsg]         = useState('')
  const [runStarted,  setRunStarted]  = useState(false)
  const [override,    setOverride]    = useState(false)
  const [excludeInput, setExcludeInput] = useState('')
  const [importExportMsg, setImportExportMsg] = useState('')

  // Conflict-resolution state
  const [showConflict,       setShowConflict]       = useState(false)
  const [conflictCount,      setConflictCount]      = useState(0)
  const [noBibCount,         setNoBibCount]         = useState(0)
  const [pendingAssignments, setPendingAssignments] = useState(null)
  const [skipError,          setSkipError]          = useState('')

  // Load other events in the meet for "Copy from Another Event"
  useEffect(() => {
    let cancelled = false
    fetch(`/api/meets/${event.meet_id}/events`)
      .then(r => r.ok ? r.json() : [])
      .then(j => {
        if (cancelled) return
        const others = Array.isArray(j) ? j.filter(e => e.id !== event.id) : []
        setMeetEvents(others)
        if (others.length) setSourceId(others[0].id)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [event.id, event.meet_id])

  // Detect started runs (any run with status other than pending)
  useEffect(() => {
    let cancelled = false
    fetch(`/api/events/${event.id}/runs`)
      .then(r => r.ok ? r.json() : [])
      .then(j => {
        if (cancelled) return
        const started = Array.isArray(j) && j.some(run => {
          const s = (run.status || '').toLowerCase()
          return s && s !== 'pending'
        })
        setRunStarted(!!started)
      })
      .catch(() => setRunStarted(false))
    return () => { cancelled = true }
  }, [event.id])

  const active = registrations.filter(r => r.status !== 'scratched')

  const excludedNumbers = new Set(
    excludeInput.split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n))
  )

  const persistBibs = async (assignments) => {
    // assignments: Map<registrationId, bibNumber|null>
    let count = 0
    for (const [regId, bib] of assignments.entries()) {
      await api.updateRegistration(event.id, regId, { bib_number: bib })
      count++
    }
    return count
  }

  const handleImportFromAthletes = async () => {
    setBusy(true); setError(''); setMsg(''); setImportExportMsg('')
    try {
      const result = await api.importBibsFromAthletes(event.id)
      setImportExportMsg(`Imported bibs for ${result.updated} of ${result.total} athletes.`)
      onRefresh && onRefresh()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const handleExportToAthletes = async () => {
    setBusy(true); setError(''); setMsg(''); setImportExportMsg('')
    try {
      const result = await api.exportBibsToAthletes(event.id)
      setImportExportMsg(`Exported bibs for ${result.updated} athletes to the database.`)
      onRefresh && onRefresh()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const runByRunOrder = () => {
    const ordered = active
      .filter(r => r.run_order != null)
      .sort((a, b) => a.run_order - b.run_order)
    if (!ordered.length) {
      throw new Error('No registrations have a run order set.  Set the run order first.')
    }
    const map = new Map()
    let nextBib = 1
    ordered.forEach(r => {
      while (excludedNumbers.has(nextBib)) nextBib++
      map.set(r.id, nextBib)
      nextBib++
    })
    // Active registrations without run_order get null
    active.filter(r => r.run_order == null).forEach(r => map.set(r.id, null))
    return map
  }

  const runRandomly = () => {
    if (!active.length) throw new Error('No active registrations to assign.')
    const shuffled = active.slice()
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    const map = new Map()
    let nextBib = 1
    shuffled.forEach(r => {
      while (excludedNumbers.has(nextBib)) nextBib++
      map.set(r.id, nextBib)
      nextBib++
    })
    return map
  }

  const runCopyFromEvent = async () => {
    if (!sourceId) throw new Error('Select a source event.')
    const res = await fetch(`/api/events/${sourceId}/registrations`, { headers: authHeaders() })
    if (!res.ok) throw new Error('Could not load source event registrations.')
    const srcRegs = await res.json()
    const byAthlete = new Map()
    for (const r of srcRegs) {
      if (r.bib_number != null) byAthlete.set(r.athlete_id, r.bib_number)
    }
    if (!byAthlete.size) throw new Error('Source event has no bib numbers assigned.')
    const map = new Map()
    let matched = 0
    for (const r of active) {
      if (byAthlete.has(r.athlete_id)) {
        map.set(r.id, byAthlete.get(r.athlete_id))
        matched++
      } else {
        map.set(r.id, null)
      }
    }
    if (!matched) throw new Error('No athletes in this event matched the source event.')
    return map
  }

  const apply = async () => {
    setError(''); setMsg(''); setSkipError('')
    if (runStarted && !override) {
      setError('This event has started runs.  Reassigning bibs may cause confusion.  Check the override box to proceed.')
      return
    }
    setBusy(true)
    try {
      let assignments
      if (mode === 'run_order')      assignments = runByRunOrder()
      else if (mode === 'random')    assignments = runRandomly()
      else if (mode === 'copy')      assignments = await runCopyFromEvent()
      else throw new Error('Unknown mode')

      // Check how many active registrations already have a bib
      const withBibs  = active.filter(r => r.bib_number != null)
      const withoutBibs = active.filter(r => r.bib_number == null)

      if (withBibs.length > 0) {
        setConflictCount(withBibs.length)
        setNoBibCount(withoutBibs.length)
        setPendingAssignments(assignments)
        setShowConflict(true)
        setBusy(false)
        return
      }

      const count = await persistBibs(assignments)
      setMsg(`Assigned bibs to ${count} registration${count === 1 ? '' : 's'}.`)
      onRefresh && onRefresh()
      setTimeout(() => { onClose && onClose() }, 900)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const replaceAll = async () => {
    setBusy(true); setSkipError('')
    try {
      const count = await persistBibs(pendingAssignments)
      setMsg(`Assigned bibs to ${count} registration${count === 1 ? '' : 's'}.`)
      onRefresh && onRefresh()
      setTimeout(() => { onClose && onClose() }, 900)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const fillInMissing = async () => {
    setSkipError('')

    if (mode === 'run_order') {
      setSkipError('Unable to fill in by run order when bib numbers are already assigned — bib positions may conflict.  Choose Replace All or switch to a different method.')
      return
    }

    setBusy(true)
    try {
      const takenBibs  = new Set(active.filter(r => r.bib_number != null).map(r => r.bib_number))
      const needsBib   = active.filter(r => r.bib_number == null)

      if (!needsBib.length) {
        setSkipError('All athletes already have bib numbers — nothing to fill in.')
        setBusy(false)
        return
      }

      let fillMap = new Map()

      if (mode === 'random') {
        // Build a list of available bib numbers not already taken
        const available = []
        let n = 1
        while (available.length < needsBib.length) {
          if (!takenBibs.has(n) && !excludedNumbers.has(n)) available.push(n)
          n++
        }
        // Shuffle the available numbers
        for (let i = available.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[available[i], available[j]] = [available[j], available[i]]
        }
        needsBib.forEach((r, i) => fillMap.set(r.id, available[i]))

      } else if (mode === 'copy') {
        // Apply copied bibs only to athletes without a current bib,
        // and only if the copied bib isn't already taken in this event.
        const needsBibIds = new Set(needsBib.map(r => r.id))
        for (const [regId, bib] of pendingAssignments.entries()) {
          if (needsBibIds.has(regId) && bib != null && !takenBibs.has(bib)) {
            fillMap.set(regId, bib)
          }
        }
        if (!fillMap.size) {
          setSkipError('No available bibs from the source event could be assigned (all are already taken or athletes have no source-event match).')
          setBusy(false)
          return
        }
      }

      const count = await persistBibs(fillMap)
      setMsg(`Assigned bibs to ${count} athlete${count === 1 ? '' : 's'} without existing numbers.`)
      onRefresh && onRefresh()
      setTimeout(() => { onClose && onClose() }, 900)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  // ── Conflict resolution view ────────────────────────────────────────────────
  if (showConflict) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md space-y-4">
          <h4 className="font-display text-lg text-white">Bib Numbers Already Exist</h4>
          <p className="text-slate-300 text-sm">
            <span className="font-semibold text-white">{conflictCount}</span> athlete{conflictCount !== 1 ? 's' : ''} in this event already{' '}
            {conflictCount === 1 ? 'has a' : 'have'} bib number{conflictCount !== 1 ? 's' : ''} assigned.
            {noBibCount > 0 && (
              <> There {noBibCount === 1 ? 'is' : 'are'} <span className="font-semibold text-white">{noBibCount}</span> athlete{noBibCount !== 1 ? 's' : ''} without a bib.</>
            )}
          </p>
          <p className="text-slate-400 text-xs">
            <strong className="text-slate-300">Replace All</strong> — overwrite every bib using the selected method.
            {noBibCount > 0 && (
              <><br /><strong className="text-slate-300">Fill In Missing</strong> — keep existing bibs; assign available numbers to the {noBibCount} athlete{noBibCount !== 1 ? 's' : ''} without one.</>
            )}
          </p>

          {skipError && (
            <div className="bg-amber-900/30 border border-amber-800 rounded-lg px-3 py-2 text-amber-300 text-xs">
              {skipError}
            </div>
          )}
          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button onClick={() => { setShowConflict(false); setSkipError('') }} className="btn-ghost text-sm">
              Cancel
            </button>
            {noBibCount > 0 && (
              <button onClick={fillInMissing} disabled={busy} className="btn-ghost text-sm border border-blue-700 text-blue-300 hover:bg-blue-900/30 disabled:opacity-40">
                {busy ? 'Assigning...' : `Fill In Missing (${noBibCount})`}
              </button>
            )}
            <button onClick={replaceAll} disabled={busy} className="btn-primary text-sm disabled:opacity-40">
              {busy ? 'Assigning...' : 'Replace All'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Normal view ─────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md space-y-4">
        <h4 className="font-display text-lg text-white">Assign Bib Numbers</h4>
        <p className="text-slate-400 text-xs">
          Generates bib numbers for this event's registrations.  Use Import/Export below to sync with the athlete database.
        </p>

        <div className="space-y-2">
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="radio" name="bibmode" value="run_order"
              checked={mode === 'run_order'} onChange={e => setMode(e.target.value)}
              className="mt-1" />
            <span className="text-sm text-slate-200">
              <span className="font-semibold">Generate by Run Order</span>
              <span className="block text-xs text-slate-500">Bib equals run order position (1, 2, 3, ...)</span>
            </span>
          </label>

          <label className="flex items-start gap-2 cursor-pointer">
            <input type="radio" name="bibmode" value="random"
              checked={mode === 'random'} onChange={e => setMode(e.target.value)}
              className="mt-1" />
            <span className="text-sm text-slate-200">
              <span className="font-semibold">Generate Randomly</span>
              <span className="block text-xs text-slate-500">Shuffle active registrations and assign 1..N</span>
            </span>
          </label>

          <label className="flex items-start gap-2 cursor-pointer">
            <input type="radio" name="bibmode" value="copy"
              checked={mode === 'copy'} onChange={e => setMode(e.target.value)}
              className="mt-1" />
            <span className="text-sm text-slate-200">
              <span className="font-semibold">Copy from Another Event</span>
              <span className="block text-xs text-slate-500">Match athletes by record and copy their bib</span>
            </span>
          </label>
        </div>

        {(mode === 'run_order' || mode === 'random') && (
          <div>
            <label className="text-xs text-slate-400 block mb-1">Exclude numbers</label>
            <input
              type="text"
              className="input w-full text-sm"
              placeholder="1,11,18,25"
              value={excludeInput}
              onChange={e => setExcludeInput(e.target.value)}
            />
            <p className="text-xs text-slate-500 mt-1">
              Comma-separated bib numbers to skip (e.g. lost or missing bibs).
            </p>
          </div>
        )}

        {mode === 'copy' && (
          <div>
            <label className="text-xs text-slate-400 block mb-1">Source event</label>
            <select className="input w-full text-sm" value={sourceId} onChange={e => setSourceId(e.target.value)}>
              {!meetEvents.length && <option value="">-- no other events in this meet --</option>}
              {meetEvents.map(e => (
                <option key={e.id} value={e.id}>{e.name} ({e.discipline})</option>
              ))}
            </select>
          </div>
        )}

        {runStarted && (
          <label className="flex items-start gap-2 bg-red-950/40 border border-red-900 rounded-lg p-2">
            <input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} className="mt-1" />
            <span className="text-xs text-red-300">
              <span className="font-semibold">Destructive override:</span>{' '}
              this event has started runs.  Reassigning bibs may cause confusion.  Check this box to proceed anyway.
            </span>
          </label>
        )}

        {error && <p className="text-red-400 text-sm">{error}</p>}
        {msg   && <p className="text-green-400 text-sm">{msg}</p>}
        {importExportMsg && <p className="text-blue-300 text-sm">{importExportMsg}</p>}

        <div className="flex gap-2 pt-2 border-t border-slate-700">
          <button onClick={handleImportFromAthletes} disabled={busy} className="btn-ghost text-xs flex-1 disabled:opacity-40">
            Import from Athlete Database
          </button>
          <button onClick={handleExportToAthletes} disabled={busy} className="btn-ghost text-xs flex-1 disabled:opacity-40">
            Export to Athlete Database
          </button>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
          <button onClick={apply} disabled={busy} className="btn-primary text-sm disabled:opacity-40">
            {busy ? 'Assigning...' : 'Assign Bibs'}
          </button>
        </div>
      </div>
    </div>
  )
}
