import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import api, { createWebSocket, authHeaders, downloadAuthed } from '../utils/api'
import { useAuth } from '../auth/AuthContext'
import UsssAutocomplete from '../components/UsssAutocomplete'
import UsssAthleteSearchPanel from '../components/UsssAthleteSearchPanel'
import CsvImportModal from '../components/CsvImportModal'
import BibAssignModal from '../components/BibAssignModal'
import VoiceManualEntryModal from '../components/VoiceManualEntryModal'
import StatusConfirmDialog from '../components/StatusConfirmDialog'
import AerialsV2ManualModal from '../components/AerialsV2ManualModal'
import { QRCodeSVG } from 'qrcode.react'

const ROLE_LABELS = {
  TL1:'T&L 1', TL2:'T&L 2', TL3:'T&L 3',
  Air1:'Air 1', Air2:'Air 2',
  HJ:'Head Judge',
  // Aerials v2 (v1.18.00) — single-role panel, numbered
  AeJudge1:'Judge 1', AeJudge2:'Judge 2', AeJudge3:'Judge 3', AeJudge4:'Judge 4',
  AeJudge5:'Judge 5', AeJudge6:'Judge 6', AeJudge7:'Judge 7',
  // Aerials legacy roles
  AirJudge1:'Air Judge 1', AirJudge2:'Air Judge 2', AirJudge3:'Air Judge 3',
  FormJudge1:'Form Judge 1', FormJudge2:'Form Judge 2', FormJudge3:'Form Judge 3',
  LandingJudge1:'Landing Judge 1', LandingJudge2:'Landing Judge 2', LandingJudge3:'Landing Judge 3',
  // Dual mogul roles
  DualTurns1:'Turns Judge 1', DualTurns2:'Turns Judge 2', DualAir:'Air Judge',
  DualTime:'Time Judge', DualOverall:'Overall Judge',
}
const ROLE_COLOR = {
  TL1:'text-sky-400', TL2:'text-sky-400', TL3:'text-sky-400',
  Air1:'text-amber-400', Air2:'text-amber-400',
  HJ:'text-emerald-400',
  // Aerials v2 (v1.18.00)
  AeJudge1:'text-cyan-400', AeJudge2:'text-cyan-400', AeJudge3:'text-cyan-400',
  AeJudge4:'text-cyan-400', AeJudge5:'text-cyan-400', AeJudge6:'text-cyan-400', AeJudge7:'text-cyan-400',
  // Aerials legacy
  AirJudge1:'text-amber-400', AirJudge2:'text-amber-400', AirJudge3:'text-amber-400',
  FormJudge1:'text-sky-400',  FormJudge2:'text-sky-400',  FormJudge3:'text-sky-400',
  LandingJudge1:'text-purple-400', LandingJudge2:'text-purple-400', LandingJudge3:'text-purple-400',
  // Dual mogul roles
  DualTurns1:'text-sky-400', DualTurns2:'text-sky-400', DualAir:'text-amber-400',
  DualTime:'text-green-400', DualOverall:'text-purple-400',
}
const TABS = ['Registrations','Event Setup','Links','Phases','Scoring','Results','Dual Bracket','PDF Reports']

const fmt     = (n) => n != null ? Number(n).toFixed(2) : '--'
const fmt1    = (n) => n != null ? Number(n).toFixed(1) : '--'
const appHost = () => window.location.host
function copyText(t) { navigator.clipboard.writeText(t).catch(() => {}) }

// ── Judges Panel ──────────────────────────────────────────────────────────────
function JudgePanel({ event, judges, onRefresh }) {
  const { meetId } = useParams()
  const [form, setForm]   = useState({ name: '', role: 'TL1', ussa_id: '' })
  const [error, setError] = useState('')
  // v1.25.00 (C-15) — inline edit of judge name + USSS ID
  const [editJudgeId, setEditJudgeId] = useState(null)
  const [editJudgeForm, setEditJudgeForm] = useState({ name: '', ussa_id: '' })
  const saveJudgeEdit = async (judgeId) => {
    try {
      await api.updateJudge(event.id, judgeId, { name: editJudgeForm.name.trim(), ussa_id: editJudgeForm.ussa_id.trim() || null })
      setEditJudgeId(null)
      onRefresh()
    } catch (err) { setError(err.message) }
  }

  const usedRoles = new Set(judges.map(j => j.role))
  const availableRoles = []

  if (event.discipline === 'dual_mogul') {
    // Dual mogul: 5-judge format with named roles
    const dualRoles = ['DualTurns1','DualTurns2','DualAir','DualTime','DualOverall']
    for (const r of dualRoles) { if (!usedRoles.has(r)) availableRoles.push(r) }
    if (!usedRoles.has('HJ')) availableRoles.push('HJ')
  } else if (event.discipline === 'aerials') {
    if (event.aerials_panel_size) {
      // v1.18.00 — Aerials v2: AeJudgeN roles up to panel size. Use the
      // "Seed Aerials Panel" button below to bulk-create with default names,
      // or add them individually via the Add Judge form.
      for (let i = 1; i <= event.aerials_panel_size; i++) {
        const r = `AeJudge${i}`; if (!usedRoles.has(r)) availableRoles.push(r)
      }
    } else {
      // Legacy aerials event: original per-component roles
      for (let i = 1; i <= (event.num_air_judges || 3); i++) {
        const r = `AirJudge${i}`;     if (!usedRoles.has(r)) availableRoles.push(r)
      }
      for (let i = 1; i <= (event.num_tl_judges || 3); i++) {
        const r = `FormJudge${i}`;    if (!usedRoles.has(r)) availableRoles.push(r)
      }
      for (let i = 1; i <= (event.num_air_judges || 3); i++) {
        const r = `LandingJudge${i}`; if (!usedRoles.has(r)) availableRoles.push(r)
      }
    }
  } else {
    for (let i = 1; i <= event.num_tl_judges;  i++) { const r = `TL${i}`;  if (!usedRoles.has(r)) availableRoles.push(r) }
    for (let i = 1; i <= event.num_air_judges; i++) { const r = `Air${i}`; if (!usedRoles.has(r)) availableRoles.push(r) }
  }
  if (event.discipline !== 'dual_mogul' && !usedRoles.has('HJ')) availableRoles.push('HJ')

  const availableRolesKey = availableRoles.join(',')

  useEffect(() => {
    if (availableRoles.length && !availableRoles.includes(form.role))
      setForm(f => ({ ...f, role: availableRoles[0] }))
  }, [availableRolesKey])

  const addJudge = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required'); return }
    // v1.18.00 — derive judge_number from AeJudgeN role so per-judge tablet URLs map correctly
    const m = /^AeJudge(\d+)$/.exec(form.role)
    const payload = m ? { ...form, judge_number: parseInt(m[1]) } : form
    try { await api.addJudge(event.id, payload); setForm(f => ({ ...f, name: '', ussa_id: '' })); setError(''); onRefresh() }
    catch (err) { setError(err.message) }
  }

  const handleJudgeUsssSelect = (person) => {
    setForm(f => ({ ...f, name: `${person.last_name}, ${person.first_name}`, ussa_id: person.ussa_id || '' }))
  }

  // v1.18.00 — Aerials v2: Seed Panel button replaces the per-component role picker.
  const isAerialsV2 = event.discipline === 'aerials' && event.aerials_panel_size != null
  const [seeding, setSeeding] = useState(false)
  const [seedError, setSeedError] = useState('')
  const seedAerials = async () => {
    setSeedError('')
    if (!confirm(`Seed ${event.aerials_panel_size} scoring judges? This replaces any existing aerials judges.`)) return
    setSeeding(true)
    try {
      await api.seedAerialsJudges(event.id, { panel_size: event.aerials_panel_size })
      onRefresh()
    } catch (e) { setSeedError(e.message) }
    finally { setSeeding(false) }
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <h3 className="font-display text-lg text-white mb-4">Assigned Judges</h3>
        {!judges.length ? <p className="text-slate-500 text-sm">No judges assigned yet.</p> : (
          <table className="data-table">
            <thead><tr><th>Role</th><th>Name</th><th>USSS ID</th><th></th></tr></thead>
            <tbody>
              {judges.map(j => (
                <tr key={j.id}>
                  <td><span className={`font-semibold ${ROLE_COLOR[j.role] || 'text-slate-300'}`}>{ROLE_LABELS[j.role] || j.role}</span></td>
                  {editJudgeId === j.id ? (
                    <>
                      <td>
                        <input className="input py-1 text-sm" value={editJudgeForm.name}
                          onChange={e => setEditJudgeForm(f => ({ ...f, name: e.target.value }))} />
                      </td>
                      <td>
                        <input className="input py-1 text-xs font-mono w-28" value={editJudgeForm.ussa_id}
                          onChange={e => setEditJudgeForm(f => ({ ...f, ussa_id: e.target.value }))} />
                      </td>
                      <td className="whitespace-nowrap">
                        <button onClick={() => saveJudgeEdit(j.id)} className="text-green-500 hover:text-green-400 text-xs mr-3">Save</button>
                        <button onClick={() => setEditJudgeId(null)} className="text-slate-500 hover:text-slate-400 text-xs">Cancel</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="text-white">{j.name}</td>
                      <td className="font-mono text-slate-400 text-xs">{j.ussa_id || '--'}</td>
                      <td className="whitespace-nowrap">
                        <button onClick={() => { setEditJudgeId(j.id); setEditJudgeForm({ name: j.name || '', ussa_id: j.ussa_id || '' }) }} className="text-mountain-400 hover:text-mountain-300 text-xs mr-3">Edit</button>
                        <button onClick={async () => { if (!window.confirm(`Remove judge ${j.name} (${ROLE_LABELS[j.role] || j.role})? Their tablet link stops working.`)) return; await api.removeJudge(event.id, j.id); onRefresh() }} className="text-red-500 hover:text-red-400 text-xs">Remove</button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-slate-500 mt-3">Tablet URLs are available on the Links tab.</p>
      </div>

      {isAerialsV2 && (
        <div className="card">
          <h3 className="font-display text-lg text-white mb-2">Aerials Scoring Panel</h3>
          <p className="text-sm text-slate-400 mb-3">
            Aerials v2: every scoring judge enters Air, Form, and Landing for each jump.
            Click below to seed {event.aerials_panel_size} numbered judge slots, each with their own tablet URL.
          </p>
          <button onClick={seedAerials} disabled={seeding} className="btn-primary disabled:opacity-40">
            {seeding ? 'Seeding...' : `Seed ${event.aerials_panel_size}-Judge Aerials Panel`}
          </button>
          {seedError && <p className="text-red-400 text-sm mt-2">{seedError}</p>}
          <p className="text-xs text-slate-500 mt-3">
            After seeding, edit each judge&apos;s name with the Edit button in the Assigned Judges table above.
            The Head Judge is added separately below.
          </p>
        </div>
      )}

      {availableRoles.length > 0 && (
        <div className="card">
          <h3 className="font-display text-lg text-white mb-4">Add Judge</h3>
          <form onSubmit={addJudge} className="grid grid-cols-4 gap-3 items-end">
            <div>
              <label className="label">Role</label>
              <select className="input" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                {availableRoles.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Name</label>
              <UsssAutocomplete
                endpoint="officials"
                placeholder="Judge name"
                value={form.name}
                onChange={val => setForm(f => ({ ...f, name: val }))}
                onSelect={handleJudgeUsssSelect}
                className="input"
              />
            </div>
            <div>
              <label className="label">USSS ID</label>
              <input className="input font-mono" placeholder="USSS ID" value={form.ussa_id} onChange={e => setForm({ ...form, ussa_id: e.target.value })} />
            </div>
            <button type="submit" className="btn-primary">Add</button>
          </form>
          {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
        </div>
      )}
    </div>
  )
}

// ── Event Officials Panel (per-event) ─────────────────────────────────────────
const OFFICIAL_ROLES = [
  'Chief of Competition',
  'Chief of Course',
  'Chief of Score',
  'Technical Delegate',
  'Chief of Start',
  'Head Judge',
  'Competition Secretary',
]

function EventOfficialsPanel({ meetId, eventId, onJudgesChanged }) {
  const [officials, setOfficials] = useState([])
  const [form, setForm] = useState({ role: '', name: '', ussa_id: '' })
  const [editId, setEditId] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [error, setError] = useState('')
  const [otherEvents, setOtherEvents] = useState([])
  const [showCopyDropdown, setShowCopyDropdown] = useState(false)
  const [copying, setCopying] = useState(false)

  const load = () => api.getEventOfficials(meetId, eventId).then(setOfficials).catch(() => {})
  useEffect(() => { load() }, [meetId, eventId])
  useEffect(() => {
    api.getEvents(meetId).then(evts => setOtherEvents(evts.filter(e => e.id !== eventId))).catch(() => {})
  }, [meetId, eventId])

  const copyFrom = async (sourceEventId) => {
    setCopying(true)
    try {
      const result = await api.copyOfficialsFromEvent(meetId, sourceEventId, eventId)
      await load()
      setShowCopyDropdown(false)
      // Auto-propagate Head Judge if one was copied
      for (const off of (result.officials || [])) {
        if (off.role === 'Head Judge' && onJudgesChanged) {
          try {
            const judges = await api.getJudges(eventId)
            if (!judges.find(j => j.role === 'HJ')) {
              await api.addJudge(eventId, { name: off.name, role: 'HJ', ussa_id: off.ussa_id || null })
              onJudgesChanged()
            }
          } catch (_) {}
          break
        }
      }
    } catch (err) { setError(err.message) }
    setCopying(false)
  }

  // Available roles = full list minus already-filled roles (excluding the one
  // currently being edited so the user can see it in their own dropdown).
  const availableRoles = (excludeRole) => {
    const used = new Set(officials.map(o => o.role))
    if (excludeRole) used.delete(excludeRole)
    return OFFICIAL_ROLES.filter(r => !used.has(r))
  }

  const addRoles = availableRoles()
  // Keep form.role in sync with what's available
  useEffect(() => {
    if (addRoles.length === 0) {
      if (form.role !== '') setForm(f => ({ ...f, role: '' }))
      return
    }
    if (!addRoles.includes(form.role)) {
      setForm(f => ({ ...f, role: addRoles[0] }))
    }
  }, [addRoles.join(',')])

  // When a Head Judge official is added, auto-create the HJ judge entry so it
  // does not need to be entered twice.  Existing HJ judge is left untouched.
  const propagateHeadJudge = async (official) => {
    if (official.role !== 'Head Judge') return
    try {
      const judges = await api.getJudges(eventId)
      const existing = judges.find(j => j.role === 'HJ')
      if (existing) return // do not overwrite an existing HJ
      await api.addJudge(eventId, { name: official.name, role: 'HJ', ussa_id: official.ussa_id || null })
      if (onJudgesChanged) onJudgesChanged()
    } catch (_) { /* non-fatal */ }
  }

  const add = async (e) => {
    e.preventDefault()
    if (!form.role) { setError('No roles remaining'); return }
    if (!form.name.trim()) { setError('Name is required'); return }
    setError('')
    try {
      const created = await api.addOfficial(meetId, { ...form, event_id: eventId })
      setForm(f => ({ ...f, name: '', ussa_id: '' }))
      await load()
      await propagateHeadJudge(created)
    } catch (err) { setError(err.message) }
  }

  const saveEdit = async (id) => {
    try {
      const updated = await api.updateOfficial(meetId, id, editForm)
      setEditId(null)
      await load()
      await propagateHeadJudge(updated)
    } catch (err) { setError(err.message) }
  }

  const remove = async (id) => {
    if (!confirm('Remove this official?')) return
    await api.removeOfficial(meetId, id); load()
  }

  const handleOfficialUsssSelect = (person) => {
    setForm(f => ({ ...f, name: `${person.last_name}, ${person.first_name}`, ussa_id: person.ussa_id || '' }))
  }

  const handleEditUsssSelect = (person) => {
    setEditForm(f => ({ ...f, name: `${person.last_name}, ${person.first_name}`, ussa_id: person.ussa_id || '' }))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-display text-lg text-white">Event Officials</h3>
        {otherEvents.length > 0 && (
          showCopyDropdown ? (
            <div className="flex items-center gap-2">
              <select className="input input-sm" disabled={copying}
                onChange={e => { if (e.target.value) copyFrom(e.target.value) }} defaultValue="">
                <option value="" disabled>Select event...</option>
                {otherEvents.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
              </select>
              <button onClick={() => setShowCopyDropdown(false)} className="text-slate-500 hover:text-slate-300 text-xs">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setShowCopyDropdown(true)} className="btn-secondary text-xs">
              Copy Officials from Other Event
            </button>
          )
        )}
      </div>
      {officials.length > 0 ? (
        <table className="data-table">
          <thead><tr><th>Role</th><th>Name</th><th>USSS ID</th><th></th></tr></thead>
          <tbody>
            {officials.map(o => (
              <tr key={o.id}>
                {editId === o.id ? (
                  <>
                    <td>
                      <select className="input input-sm" value={editForm.role}
                        onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}>
                        {availableRoles(o.role).map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td>
                      <UsssAutocomplete
                        endpoint="officials"
                        placeholder="Official name"
                        value={editForm.name}
                        onChange={val => setEditForm(f => ({ ...f, name: val }))}
                        onSelect={handleEditUsssSelect}
                        className="input input-sm"
                      />
                    </td>
                    <td>
                      <input className="input input-sm font-mono" value={editForm.ussa_id || ''}
                        onChange={e => setEditForm(f => ({ ...f, ussa_id: e.target.value }))} />
                    </td>
                    <td className="flex gap-2">
                      <button onClick={() => saveEdit(o.id)} className="text-green-400 hover:text-green-300 text-xs">Save</button>
                      <button onClick={() => setEditId(null)} className="text-slate-500 hover:text-slate-300 text-xs">Cancel</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="text-slate-300">{o.role}</td>
                    <td className="text-white font-medium">{o.name}</td>
                    <td className="font-mono text-slate-400 text-xs">{o.ussa_id || '--'}</td>
                    <td className="flex gap-3">
                      <button onClick={() => { setEditId(o.id); setEditForm({ role: o.role, name: o.name, ussa_id: o.ussa_id || '' }) }}
                        className="text-slate-400 hover:text-white text-xs">Edit</button>
                      <button onClick={() => remove(o.id)} className="text-red-500 hover:text-red-400 text-xs">Remove</button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-slate-500 text-sm">No officials assigned for this event.</p>
      )}
      {addRoles.length === 0 ? (
        <p className="text-slate-500 text-xs italic pt-2 border-t border-slate-800">All official roles are filled.</p>
      ) : (
        <form onSubmit={add} className="grid grid-cols-4 gap-3 items-end pt-2 border-t border-slate-800">
          <div>
            <label className="label">Role</label>
            <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              {addRoles.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Name</label>
            <UsssAutocomplete
              endpoint="officials"
              placeholder="Official name"
              value={form.name}
              onChange={val => setForm(f => ({ ...f, name: val }))}
              onSelect={handleOfficialUsssSelect}
              className="input"
            />
          </div>
          <div>
            <label className="label">USSS ID</label>
            <input className="input font-mono" value={form.ussa_id} placeholder="USSS ID"
              onChange={e => setForm(f => ({ ...f, ussa_id: e.target.value }))} />
          </div>
          <div>
            <button type="submit" className="btn-primary w-full">Add Official</button>
          </div>
        </form>
      )}
      {error && <p className="text-red-400 text-sm mt-1">{error}</p>}
    </div>
  )
}

// ── Event Setup Panel ─────────────────────────────────────────────────────────
function EventSetupPanel({ event, judges, onRefresh }) {
  const { meetId, eventId } = useParams()
  const [hasScoring, setHasScoring] = useState(false)

  useEffect(() => {
    Promise.all([
      api.getRuns(eventId),
      event.discipline === 'dual_mogul'
        ? fetch(`/api/meets/${meetId}/events/${eventId}/dual`).then(r => r.json()).then(matches =>
            matches.some(m => m.status === 'complete')
          ).catch(() => false)
        : Promise.resolve(false)
    ]).then(([runs, hasDualScores]) => {
      setHasScoring(runs.length > 0 || hasDualScores)
    }).catch(() => {})
  }, [meetId, eventId, event.discipline])

  const updateComponentScoring = async (val) => {
    try {
      await api.updateEvent(meetId, eventId, { component_scoring: parseInt(val) })
      onRefresh()
    } catch (err) {
      alert(err.message)
    }
  }

  const updateScoreEntryMode = async (val) => {
    try {
      await api.updateEvent(meetId, eventId, { score_entry_mode: val })
      onRefresh()
    } catch (err) {
      alert(err.message)
    }
  }

  return (
    <div className="space-y-8">
      {/* Section A: Event Details */}
      <div className="card">
        <h3 className="font-display text-lg text-white mb-4">Event Details</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400 whitespace-nowrap">Event Date:</span>
            <UsssCodeField meetId={meetId} eventId={eventId} field="event_date" value={event.event_date} onSave={onRefresh} type="date" />
          </div>
          {event.discipline === 'mogul' && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-400 whitespace-nowrap">Component Scoring:</span>
              <select
                className="input w-20"
                value={event.component_scoring ?? 1}
                onChange={e => updateComponentScoring(e.target.value)}
                disabled={hasScoring}
                title={hasScoring ? 'Cannot change after scoring has started' : ''}
              >
                <option value={1}>Yes</option>
                <option value={0}>No</option>
              </select>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400 whitespace-nowrap">Score Entry:</span>
            <select
              className="input w-28"
              value={event.score_entry_mode || 'tablet'}
              onChange={e => updateScoreEntryMode(e.target.value)}
              disabled={hasScoring}
              title={hasScoring ? 'Cannot change after scoring has started' : ''}
            >
              <option value="tablet">Tablet</option>
              <option value="paper">Paper</option>
            </select>
          </div>
        </div>
        {event.discipline !== 'aerials' && (
          <div className="mt-3 flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-400 whitespace-nowrap">USSS Code:</span>
              <UsssCodeField meetId={meetId} eventId={eventId} field="usss_code" value={event.usss_code} onSave={onRefresh} />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-ice-500 focus:ring-ice-500"
                checked={!!event.is_divisional}
                onChange={async (e) => {
                  try {
                    await api.updateEvent(meetId, eventId, { is_divisional: e.target.checked ? 1 : 0 })
                    onRefresh()
                  } catch (err) { alert(err.message) }
                }}
              />
              <span className="text-sm text-slate-400">Divisional Championship</span>
            </label>
          </div>
        )}
      </div>

      {/* Section B: Event Officials */}
      <div className="card">
        <EventOfficialsPanel meetId={meetId} eventId={eventId} onJudgesChanged={onRefresh} />
      </div>

      {/* Section C: Judges */}
      <JudgePanel event={event} judges={judges} onRefresh={onRefresh} />
    </div>
  )
}

// ── QR Modal ─────────────────────────────────────────────────────────────────
function QRModal({ url, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 flex flex-col items-center gap-4" onClick={e => e.stopPropagation()}>
        <div className="text-sm text-slate-400 text-center max-w-xs truncate">{url}</div>
        <QRCodeSVG value={url} size={240} bgColor="#0f172a" fgColor="#ffffff" />
        <button onClick={onClose} className="btn-ghost text-xs">Close</button>
      </div>
    </div>
  )
}

// ── Links Panel ───────────────────────────────────────────────────────────────
function LinksPanel({ event, judges }) {
  const { meetId } = useParams()
  const isAerials     = event.discipline === 'aerials'
  const isPaper       = event.score_entry_mode === 'paper'
  const ec = event.short_code || event.id
  const mc = event.meet_short_code || meetId
  const tabletUrl     = (j) => `http://${appHost()}/judge/${ec}?judge=${j.short_code || j.id}`
  const aerialsUrl    = `http://${appHost()}/aerials-judge/${ec}`
  // v1.18.00 — per-judge aerials tablet URL (v2 events with seeded AeJudgeN panel)
  const aerialsJudgeUrl = (j) => `http://${appHost()}/aerials-judge/${ec}/${j.short_code || j.id}`
  const timekeeperUrl = `http://${appHost()}/timekeeper/${ec}`
  const hjUrl         = `http://${appHost()}/headjudge/${mc}/${ec}`
  const scoreboardUrl = `http://${appHost()}/scoreboard/${ec}`
  const overlayUrl    = `http://${appHost()}/overlay/${ec}`
  const hjJudge       = judges.find(j => j.role === 'HJ')
  const [qrUrl, setQrUrl] = useState(null)

  const LinkRow = ({ label, url, path, note }) => (
    <div className="flex items-center gap-3 py-3 border-b border-slate-800 last:border-0">
      <div className="w-32 shrink-0">
        <div className="text-sm font-semibold text-white">{label}</div>
        {note && <div className="text-xs text-slate-500">{note}</div>}
      </div>
      <code className="text-xs text-slate-400 bg-slate-800 px-2 py-1.5 rounded flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{url}</code>
      <button onClick={() => setQrUrl(url)} className="btn-ghost text-xs shrink-0">QR</button>
      <button onClick={() => copyText(url)} className="btn-ghost text-xs shrink-0">Copy</button>
      <a href={path || url} target="_blank" rel="noreferrer" className="btn-primary text-xs shrink-0">Open</a>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Judge tablets */}
      <div className="card">
        <h3 className="font-display text-lg text-white mb-4">Judge Tablets</h3>

        {isPaper ? (
          <p className="text-amber-400 text-sm">Paper entry mode — judge tablets not used</p>
        ) : event.discipline === 'dual_mogul' ? (
          // Dual mogul: show judge tablets for each assigned dual judge
          !judges.filter(j => j.role !== 'HJ').length
            ? <p className="text-slate-500 text-sm">No judges assigned yet.  Add judges on the Event Setup tab.</p>
            : (
              <div className="space-y-1">
                <p className="text-slate-500 text-xs mb-2">
                  Each dual mogul judge has a tablet for entering their 5-point split per match.
                </p>
                {judges.filter(j => j.role !== 'HJ').map(j => (
                  <LinkRow
                    key={j.id}
                    label={`${ROLE_LABELS[j.role] || j.role} -- ${j.name}`}
                    url={`http://${appHost()}/judge/${event.id}?judge=${j.id}`}
                    path={`/judge/${event.id}?judge=${j.id}`}
                  />
                ))}
              </div>
            )
        ) : isAerials ? (
          // v1.18.00 — Aerials: per-judge tablet URLs (mirrors moguls).
          //   v2 panels with AeJudgeN roles → one row per judge, each with their own short-code URL.
          //   Legacy panels (AirJudge*/FormJudge*/LandingJudge*) → fall back to the shared URL.
          (() => {
            const scoring = judges.filter(j => j.role !== 'HJ')
            const isV2 = event.aerials_panel_size != null && scoring.some(j => /^AeJudge/.test(j.role))
            if (!scoring.length) {
              return <p className="text-slate-500 text-sm">No aerials judges seeded.  Use &quot;Seed Aerials Panel&quot; on the Event Setup tab.</p>
            }
            if (isV2) {
              return (
                <div className="space-y-1">
                  <p className="text-slate-500 text-xs mb-2">
                    Each scoring judge enters Air, Form, and Landing for every jump on their own tablet.
                  </p>
                  {scoring.sort((a,b) => (a.judge_number||0) - (b.judge_number||0)).map(j => (
                    <LinkRow
                      key={j.id}
                      label={`Judge ${j.judge_number || ''} -- ${j.name}`}
                      url={aerialsJudgeUrl(j)}
                      path={`/aerials-judge/${ec}/${j.short_code || j.id}`}
                    />
                  ))}
                </div>
              )
            }
            // Legacy aerials event — keep the shared-URL behavior
            return (
              <div className="space-y-1">
                <LinkRow
                  label="Aerials Tablet"
                  url={aerialsUrl}
                  path={`/aerials-judge/${event.id}`}
                  note="Shared by all aerials judges (legacy event)"
                />
                {scoring.map(j => (
                  <div key={j.id} className="px-3 py-1.5 text-xs text-slate-500 border-b border-slate-800 last:border-0">
                    {ROLE_LABELS[j.role] || j.role} -- {j.name}
                  </div>
                ))}
              </div>
            )
          })()
        ) : (
          !judges.filter(j => j.role !== 'HJ').length
            ? <p className="text-slate-500 text-sm">No scoring judges assigned.  Add judges on the Event Setup tab.</p>
            : judges.filter(j => j.role !== 'HJ').map(j => (
                <LinkRow
                  key={j.id}
                  label={`${ROLE_LABELS[j.role] || j.role} -- ${j.name}`}
                  url={tabletUrl(j)}
                  path={`/judge/${event.id}?judge=${j.id}`}
                />
              ))
        )}
      </div>

      {/* Operations */}
      <div className="card">
        <h3 className="font-display text-lg text-white mb-4">Operations</h3>
        <LinkRow label="Timekeeper" url={timekeeperUrl} path={`/timekeeper/${event.id}`} note={isPaper ? 'Start runs only — no time entry' : undefined} />
        {!isPaper && (
          <LinkRow
            label="Head Judge"
            url={hjUrl}
            path={`/headjudge/${meetId}/${event.id}`}
            note={hjJudge ? `Assigned: ${hjJudge.name}` : 'No HJ assigned'}
          />
        )}
      </div>

      {/* Display */}
      <div className="card">
        <h3 className="font-display text-lg text-white mb-4">Display</h3>
        <LinkRow label="Scoreboard"      url={scoreboardUrl} path={`/scoreboard/${event.id}`} />
        <LinkRow label="Overlay (YoloBox)" url={overlayUrl}  path={`/overlay/${event.id}`} note="1920x1080 browser source" />
      </div>
      {qrUrl && <QRModal url={qrUrl} onClose={() => setQrUrl(null)} />}
    </div>
  )
}

// ── Runs Panel (Phase Management) ─────────────────────────────────────────────
function HeatsPanel({ event, registrations, onRefresh }) {
  const [phases,        setPhases]        = useState([])
  const [phaseStatuses, setPhaseStatuses] = useState([])
  const [roundStatuses, setRoundStatuses] = useState([])
  const [loading,       setLoading]       = useState(true)
  const [action,        setAction]        = useState('')
  const [error,         setError]         = useState('')

  // Add Phase modal state
  const [showAddPhase,  setShowAddPhase]  = useState(false)
  const [newPhaseType,  setNewPhaseType]  = useState('')
  const [runOrderMethod, setRunOrderMethod] = useState('')
  const [passThrough,   setPassThrough]   = useState(4)
  const [q2Limit,       setQ2Limit]       = useState('')
  const [finalSize,     setFinalSize]     = useState(16)

  // Set Run Order (rebuild a not-started phase's order) state — v2.0.03
  const [orderPhaseId,  setOrderPhaseId]  = useState(null)
  const [orderMethod,   setOrderMethod]   = useState('16_down')

  const loadData = async () => {
    try {
      const [p, ps, rs] = await Promise.all([
        api.getPhases(event.id),
        api.getPhaseStatus(event.id).catch(() => []),
        api.getRunRoundStatus(event.id),
      ])
      setPhases(p)
      setPhaseStatuses(ps)
      setRoundStatuses(rs)
    } catch (e) { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => {
    loadData()
    const ws = createWebSocket(event.id, msg => {
      if (['score_update','run_updated','phase_created','phase_deleted','run_round_status'].includes(msg.type)) loadData()
    })
    return () => ws.close()
  }, [event.id])

  const hasPhases = phases.length > 0
  const format = (() => {
    if (!hasPhases) return 'none'
    const types = phases.map(p => p.phase_type)
    if (types.includes('final_1') || types.includes('final_2') || types.includes('qualifier_2')) return 'qualifier_finals'
    if (types.includes('best_of_2')) return 'best_of_2'
    return 'single'
  })()

  // Determine available next phase options
  const getAvailablePhaseTypes = () => {
    const types = phases.map(p => p.phase_type)
    const options = []

    if (!types.includes('best_of_2') && !types.includes('qualifier_2') && !types.includes('final_1') && !types.includes('final_2')) {
      options.push({ value: 'best_of_2', label: 'Best of 2 (adds Run 2)' })
    }
    if (!types.includes('best_of_2') && !types.includes('qualifier_2') && !types.includes('final_1')) {
      options.push({ value: 'qualifier_2', label: 'Qualifier 2' })
    }
    if (!types.includes('best_of_2') && !types.includes('final_1')) {
      options.push({ value: 'final_1', label: 'Final 1' })
    }
    if (types.includes('final_1') && !types.includes('final_2')) {
      const f1Status = phaseStatuses.find(p => p.phase_type === 'final_1')
      if (f1Status && f1Status.status === 'finalized') {
        options.push({ value: 'final_2', label: 'Final 2' })
      }
    }
    return options
  }

  // Check if "Add Next Phase" should be enabled
  const canAddPhase = () => {
    if (!hasPhases) {
      // Need Run 1 finalized via roundStatuses
      const r1 = roundStatuses.find(r => r.run_number === 1)
      return r1 && r1.status === 'finalized'
    }
    const lastPhase = phaseStatuses[phaseStatuses.length - 1]
    return lastPhase && lastPhase.status === 'finalized'
  }

  const doAddPhase = async () => {
    setAction('adding'); setError('')
    try {
      const body = {
        phase_type: newPhaseType,
        run_order_method: runOrderMethod || undefined,
        pass_through_count: (newPhaseType === 'qualifier_2') ? passThrough : undefined,
        final_size: (['final_1', 'final_2'].includes(newPhaseType)) ? finalSize : undefined,
        q2_field_limit: (newPhaseType === 'qualifier_2' && q2Limit !== '') ? Number(q2Limit) : undefined,
      }
      const resp = await api.createPhase(event.id, body)
      setShowAddPhase(false)
      setNewPhaseType('')
      setRunOrderMethod('')
      await loadData()
      if (resp && resp.undersized_notice) {
        alert(resp.undersized_notice)
      }
    } catch (e) { setError(e.message) }
    setAction('')
  }

  const doRebuildOrder = async (phaseId, label) => {
    setAction('ordering')
    try {
      const resp = await api.rebuildPhaseOrder(event.id, phaseId, orderMethod)
      setOrderPhaseId(null)
      await loadData()
      alert(`${label} run order set — ${resp.count} athletes.`)
    } catch (e) { alert(e.message) }
    setAction('')
  }

  const doDeletePhase = async (phaseId, label) => {
    if (!confirm(`Delete "${label}"? All scores for this phase will be permanently deleted. Use this for weather interruptions or format changes.`)) return
    setAction('deleting')
    try {
      await api.deletePhase(event.id, phaseId)
      await loadData()
    } catch (e) { alert(e.message) }
    setAction('')
  }

  // Phase status actions
  const doFinalize = async (phaseId, label) => {
    if (!confirm(`Finalize ${label}? This will lock all scores.`)) return
    setAction('finalizing')
    try {
      await api.finalizePhase(event.id, phaseId)
      await loadData()
    } catch (e) { alert(e.message) }
    setAction('')
  }

  const doSendReview = async (phaseId) => {
    setAction('sending')
    try {
      await api.sendPhaseReview(event.id, phaseId)
      await loadData()
    } catch (e) { alert(e.message) }
    setAction('')
  }

  const doReopen = async (phaseId, label) => {
    if (!confirm(`Reopen ${label}? This will allow score edits again.`)) return
    setAction('reopening')
    try {
      await api.reopenPhase(event.id, phaseId)
      await loadData()
    } catch (e) { alert(e.message) }
    setAction('')
  }

  // Legacy round status actions (for events without phases)
  const doFinalizeRound = async (runNumber) => {
    if (!confirm(`Finalize Run ${runNumber}? This will lock all scores for this run.`)) return
    setAction('finalizing')
    try {
      await api.finalizeRunRound(event.id, runNumber)
      await loadData()
    } catch (e) { alert(e.message) }
    setAction('')
  }

  const doSendReviewRound = async (runNumber) => {
    setAction('sending')
    try {
      await api.sendRunRoundReview(event.id, runNumber)
      await loadData()
    } catch (e) { alert(e.message) }
    setAction('')
  }

  const doReopenRound = async (runNumber) => {
    if (!confirm(`Reopen Run ${runNumber}? This will allow score edits again.`)) return
    setAction('reopening')
    try {
      await api.reopenRunRound(event.id, runNumber)
      await loadData()
    } catch (e) { alert(e.message) }
    setAction('')
  }

  if (loading) return <div className="text-slate-500 text-sm">Loading...</div>

  const STATUS_COLORS = {
    not_started: 'bg-slate-700 text-slate-300',
    in_progress: 'bg-blue-900/50 text-blue-400 border border-blue-700',
    complete:    'bg-emerald-900/50 text-emerald-400 border border-emerald-700',
    hj_review:   'bg-amber-900/50 text-amber-400 border border-amber-700',
    finalized:   'bg-purple-900/50 text-purple-400 border border-purple-700',
  }
  const STATUS_LABELS = {
    not_started: 'Not Started',
    in_progress: 'In Progress',
    complete:    'Complete',
    hj_review:   'Sent to Head Judge',
    finalized:   'Finalized',
  }

  const ORDER_LABELS = {
    same: 'Same order',
    random: 'Random',
    last_to_first: 'Last to first',
    '16_down': '16 down',
  }

  const defaultRunOrderForType = (type) => {
    if (type === 'best_of_2') return '16_down'
    if (type === 'final_1' || type === 'final_2') return 'last_to_first'
    if (type === 'qualifier_2') return 'last_to_first'
    return 'same'
  }

  return (
    <div className="space-y-6">

      {/* Phase status cards */}
      {hasPhases ? (
        phaseStatuses.map(ps => (
          <div key={ps.id} className="card border-slate-700">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <h3 className="font-display text-lg text-white">{ps.label}</h3>
                <span className="text-xs text-slate-500">{ORDER_LABELS[ps.run_order_method] || ps.run_order_method}</span>
                {ps.phase_type === 'qualifier_2' && ps.pass_through_count > 0 && (
                  <span className="text-xs text-slate-500">Pass-through: {ps.pass_through_count}</span>
                )}
                {ps.phase_type === 'qualifier_2' && ps.q2_field_limit > 0 && (
                  <span className="text-xs text-slate-500">Q2 limit: {ps.q2_field_limit}</span>
                )}
                {(ps.phase_type === 'final_1' || ps.phase_type === 'final_2') && ps.final_size > 0 && (
                  <span className="text-xs text-slate-500">Max: {ps.final_size} athletes</span>
                )}
              </div>
              <span className={`text-xs px-3 py-1 rounded-full font-semibold ${STATUS_COLORS[ps.status] || STATUS_COLORS.not_started}`}>
                {STATUS_LABELS[ps.status] || ps.status}
              </span>
            </div>
            <div className="flex items-center gap-6 text-sm mb-3">
              <span className="text-slate-300">
                <span className="font-mono text-white">{ps.completed}</span>/{ps.total} complete
              </span>
              <span className="text-slate-400">
                Remaining <span className="font-mono text-white">{ps.remaining}</span>
              </span>
              {ps.scoring > 0 && (
                <span className="text-blue-400">
                  <span className="font-mono">{ps.scoring}</span> scoring now
                </span>
              )}
            </div>

            {ps.review_message && ps.status === 'complete' && (
              <div className="bg-amber-900/20 border border-amber-800 rounded-lg px-3 py-2 text-sm text-amber-400 mb-3">
                {ps.review_message}
              </div>
            )}

            {ps.status === 'not_started' && ps.sequence_order > 1 && ps.total === 0 && (
              <div className="bg-amber-900/20 border border-amber-800 rounded-lg px-3 py-2 text-sm text-amber-400 mb-3">
                No run order set for {ps.label} — use the Set Run Order button below.
              </div>
            )}

            <div className="flex gap-3 flex-wrap items-center">
              {ps.status === 'complete' && (
                <>
                  <button onClick={() => doFinalize(ps.id, ps.label)} disabled={!!action}
                    className="px-4 py-2 text-sm font-medium rounded bg-purple-700 hover:bg-purple-600 text-white disabled:opacity-50">
                    {action === 'finalizing' ? 'Finalizing...' : `Finalize ${ps.label}`}
                  </button>
                  <button onClick={() => doSendReview(ps.id)} disabled={!!action}
                    className="px-4 py-2 text-sm font-medium rounded bg-amber-700 hover:bg-amber-600 text-white disabled:opacity-50">
                    {action === 'sending' ? 'Sending...' : 'Send to Head Judge for Review'}
                  </button>
                </>
              )}
              {ps.status === 'finalized' && ps.sequence_order > 1 && (
                <button onClick={() => doReopen(ps.id, ps.label)} disabled={!!action}
                  className="px-4 py-2 text-sm font-medium rounded bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-50">
                  {action === 'reopening' ? 'Reopening...' : `Reopen ${ps.label}`}
                </button>
              )}
              {ps.status === 'not_started' && ps.sequence_order > 1 && (
                orderPhaseId === ps.id ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <select className="input text-sm py-2 w-auto" value={orderMethod}
                      onChange={e => setOrderMethod(e.target.value)}>
                      <option value="16_down">16 down (16th first, then 15th...1st, then 17th+)</option>
                      <option value="last_to_first">Last to first (worst goes first)</option>
                      <option value="random">Random</option>
                      <option value="same">Same as prior phase</option>
                    </select>
                    <button onClick={() => doRebuildOrder(ps.id, ps.label)} disabled={!!action}
                      className="px-4 py-2 text-sm font-medium rounded bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50">
                      {action === 'ordering' ? 'Setting...' : 'Apply Order'}
                    </button>
                    <button onClick={() => setOrderPhaseId(null)} className="btn-ghost text-sm">Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => {
                    setOrderPhaseId(ps.id)
                    setOrderMethod(ps.run_order_method && ps.run_order_method !== 'same' ? ps.run_order_method : '16_down')
                  }} disabled={!!action}
                    className="px-4 py-2 text-sm font-medium rounded bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50">
                    Set Run Order
                  </button>
                )
              )}
              {ps.sequence_order > 1 && (ps.status === 'not_started' || ps.status === 'finalized') && (
                <button onClick={() => doDeletePhase(ps.id, ps.label)} disabled={!!action}
                  className="px-4 py-2 text-sm font-medium rounded bg-red-900/50 hover:bg-red-800/50 text-red-400 disabled:opacity-50">
                  Cancel Phase
                </button>
              )}
              <button
                onClick={async () => {
                  try {
                    const resp = await fetch('/api/pdf/phase-run-order', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', ...authHeaders() },
                      body: JSON.stringify({ eventId: event.id, phaseId: ps.id }),
                    })
                    if (!resp.ok) throw new Error((await resp.json()).error || 'PDF failed')
                    const blob = await resp.blob()
                    const url = URL.createObjectURL(blob)
                    window.open(url, '_blank')
                  } catch (e) { alert('Print failed: ' + e.message) }
                }}
                className="px-4 py-2 text-sm font-medium rounded bg-slate-700 hover:bg-slate-600 text-slate-300 disabled:opacity-50"
              >
                Print Run Order
              </button>
            </div>
          </div>
        ))
      ) : (
        /* Legacy: no phases - show run round status */
        roundStatuses.map(rs => (
          <div key={rs.run_number} className="card border-slate-700">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display text-lg text-white">{rs.name}</h3>
              <span className={`text-xs px-3 py-1 rounded-full font-semibold ${STATUS_COLORS[rs.status] || STATUS_COLORS.not_started}`}>
                {STATUS_LABELS[rs.status] || rs.status}
              </span>
            </div>
            <div className="flex items-center gap-6 text-sm mb-3">
              <span className="text-slate-300">
                <span className="font-mono text-white">{rs.completed}</span>/{rs.total} complete
              </span>
              <span className="text-slate-400">
                Remaining <span className="font-mono text-white">{rs.remaining}</span>
              </span>
              {rs.scoring > 0 && (
                <span className="text-blue-400"><span className="font-mono">{rs.scoring}</span> scoring now</span>
              )}
            </div>

            {rs.review_message && rs.status === 'complete' && (
              <div className="bg-amber-900/20 border border-amber-800 rounded-lg px-3 py-2 text-sm text-amber-400 mb-3">
                {rs.review_message}
              </div>
            )}

            <div className="flex gap-3 flex-wrap">
              {rs.status === 'complete' && (
                <>
                  <button onClick={() => doFinalizeRound(rs.run_number)} disabled={!!action}
                    className="px-4 py-2 text-sm font-medium rounded bg-purple-700 hover:bg-purple-600 text-white disabled:opacity-50">
                    Finalize Run
                  </button>
                  <button onClick={() => doSendReviewRound(rs.run_number)} disabled={!!action}
                    className="px-4 py-2 text-sm font-medium rounded bg-amber-700 hover:bg-amber-600 text-white disabled:opacity-50">
                    Send to Head Judge for Review
                  </button>
                </>
              )}
              {rs.status === 'finalized' && (
                <button onClick={() => doReopenRound(rs.run_number)} disabled={!!action}
                  className="px-4 py-2 text-sm font-medium rounded bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-50">
                  Reopen Run
                </button>
              )}
            </div>
          </div>
        ))
      )}

      {/* Add Next Phase */}
      {canAddPhase() && !showAddPhase && (
        <div className="flex justify-center">
          <button onClick={() => {
            setShowAddPhase(true)
            const avail = getAvailablePhaseTypes()
            if (avail.length > 0) {
              setNewPhaseType(avail[0].value)
              setRunOrderMethod(defaultRunOrderForType(avail[0].value))
            }
          }} className="px-6 py-3 text-sm font-medium rounded-lg bg-blue-700 hover:bg-blue-600 text-white">
            + Add Next Phase
          </button>
        </div>
      )}

      {showAddPhase && (
        <div className="card border-blue-800">
          <h3 className="font-display text-lg text-white mb-4">Add Next Phase</h3>
          <div className="space-y-4">
            <div>
              <label className="label">Phase Type</label>
              <select className="input" value={newPhaseType} onChange={e => {
                setNewPhaseType(e.target.value)
                setRunOrderMethod(defaultRunOrderForType(e.target.value))
              }}>
                {getAvailablePhaseTypes().map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Run Order Method</label>
              <select className="input" value={runOrderMethod} onChange={e => setRunOrderMethod(e.target.value)}>
                <option value="same">Same as prior phase</option>
                <option value="random">Random</option>
                <option value="last_to_first">Last to first (worst goes first)</option>
                <option value="16_down">16 down (16th first, then 15th...1st, then 17th+)</option>
              </select>
            </div>

            {newPhaseType === 'qualifier_2' && (
              <div>
                <label className="label">Pass-Through Count (top athletes from Qualifier 1 who skip Qualifier 2 and go straight to Final 1)</label>
                <input type="number" min={0} max={50} className="input w-24"
                  value={passThrough} onChange={e => setPassThrough(Number(e.target.value))} />
              </div>
            )}

            {newPhaseType === 'qualifier_2' && (
              <div>
                <label className="label">Q2 field limit (last rank eligible for Q2)</label>
                <input type="number" min={1} max={128} className="input w-24" placeholder="—"
                  value={q2Limit} onChange={e => setQ2Limit(e.target.value)} />
                <p className="text-xs text-slate-500 mt-1">
                  Blank = no cap (all non-pass-through athletes run Q2). WC Phased Finals: 32 moguls / 18 aerials.
                  Athletes below the limit rank on their Qualifier 1 score.
                </p>
              </div>
            )}

            {(newPhaseType === 'final_1' || newPhaseType === 'final_2') && (
              <div>
                <label className="label">Maximum Athletes in {newPhaseType === 'final_1' ? 'Final 1' : 'Final 2'}</label>
                <input type="number" min={1} max={128} className="input w-24"
                  value={finalSize} onChange={e => setFinalSize(Number(e.target.value))} />
                {newPhaseType === 'final_1' && phases.some(p => p.phase_type === 'qualifier_2') && (
                  <p className="text-xs text-slate-500 mt-1">
                    Includes {passThrough || phases.find(p => p.phase_type === 'qualifier_2')?.pass_through_count || 0} pass-through athletes from Qualifier 1
                  </p>
                )}
              </div>
            )}

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <div className="flex gap-3">
              <button onClick={doAddPhase} disabled={!!action || !newPhaseType}
                className="px-4 py-2 text-sm font-medium rounded bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50">
                {action === 'adding' ? 'Adding...' : 'Add Phase'}
              </button>
              <button onClick={() => { setShowAddPhase(false); setError('') }}
                className="btn-ghost text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Registration + Run Order Panel ────────────────────────────────────────────
function computeAgeClass(birthYear, eventDate) {
  if (!birthYear) return '--';
  const d = eventDate ? new Date(eventDate) : new Date();
  const seasonStartYear = d.getMonth() < 6 ? d.getFullYear() - 1 : d.getFullYear();
  const age = seasonStartYear - parseInt(birthYear);
  if (age <= 6) return 'U7';
  if (age <= 8) return 'U9';
  if (age <= 10) return 'U11';
  if (age <= 12) return 'U13';
  if (age <= 14) return 'U15';
  if (age <= 16) return 'U17';
  if (age <= 18) return 'U19';
  if (age <= 20) return 'Sr';
  return 'Vet';
}

// v1.25.00 (C-2) — bib edits hold local state and save once on blur/Enter,
// instead of writing (and refreshing the whole page) on every keystroke.
function BibInput({ eventId, registration, onRefresh }) {
  const [val, setVal] = useState(registration.bib_number != null ? String(registration.bib_number) : '')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setVal(registration.bib_number != null ? String(registration.bib_number) : '')
  }, [registration.bib_number])
  const commit = async () => {
    const newBib = val.trim() === '' ? null : parseInt(val)
    const oldBib = registration.bib_number != null ? registration.bib_number : null
    if (newBib === oldBib) return
    try {
      setFailed(false)
      await api.updateRegistration(eventId, registration.id, { bib_number: newBib })
      onRefresh()
    } catch {
      setFailed(true)
    }
  }
  return (
    <input
      type="number"
      className={`w-16 bg-slate-800 rounded px-2 py-1 text-sm text-center font-mono text-white border focus:outline-none ${failed ? 'border-red-500' : 'border-transparent focus:border-blue-500'}`}
      value={val}
      placeholder="--"
      onChange={e => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
    />
  )
}

function RegistrationPanel({ event, registrations, onRefresh }) {
  const [searchQ,       setSearchQ]       = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching,     setSearching]     = useState(false)
  const [newAth,        setNewAth]        = useState({ first_name:'', last_name:'', ussa_num:'', fis_id:'', club:'', division:'', gender: event.gender||'M', birth_year:'' })
  const [showNew,       setShowNew]       = useState(false)
  const [addError,      setAddError]      = useState('')
  const [showUsssRegister, setShowUsssRegister] = useState(false)
  const [usssRegMsg, setUsssRegMsg] = useState('')

  // v1.5 Feature 1: CSV registration import
  const [showCsvImport, setShowCsvImport] = useState(false)

  // USSS sync state
  const [usssSyncing, setUsssSyncing] = useState(false)
  const [usssSyncResult, setUsssSyncResult] = useState(null)

  // v1.6 Feature 4: Bib assignment modal
  const [showBibAssign, setShowBibAssign] = useState(false)

  // USSS sync prompt after CSV import
  const [showUsssSyncPrompt, setShowUsssSyncPrompt] = useState(false)

  // Import bibs from another event (dual mogul)
  const [showBibImport, setShowBibImport] = useState(false)
  const [bibImportEvents, setBibImportEvents] = useState([])
  const [bibImportSourceId, setBibImportSourceId] = useState('')
  const [bibImportBusy, setBibImportBusy] = useState(false)
  const [bibImportMsg, setBibImportMsg] = useState('')
  const [bibImportError, setBibImportError] = useState('')
  const [bibImportPreview, setBibImportPreview] = useState(null)

  // Registration completeness check
  // v1.16.31 -- bib NOT required for run-order build; missing-bib athletes get yellow rows.
  const isRegistrationIncomplete = (r) =>
    !r.first_name || !r.last_name || !r.ussa_num || !r.birth_year
  const isMissingBibOnly = (r) =>
    !isRegistrationIncomplete(r) && r.bib_number == null
  const incompleteCount = registrations.filter(r => r.status !== 'scratched').filter(isRegistrationIncomplete).length
  const allAthletesComplete = incompleteCount === 0

  // Collapsible sections
  const [regExpanded, setRegExpanded] = useState(false)
  const [runOrderExpanded, setRunOrderExpanded] = useState(false)

  // Bulk registration state
  const [showBrowse,    setShowBrowse]    = useState(false)
  const [browseList,    setBrowseList]    = useState([])
  const [browseLoading, setBrowseLoading] = useState(false)
  const [selected,      setSelected]      = useState(new Set())
  const [bulkMsg,       setBulkMsg]       = useState('')
  const [bulkError,     setBulkError]     = useState('')

  // Run order state
  const [orderList,   setOrderList]   = useState([])
  const [orderDirty,  setOrderDirty]  = useState(false)
  const [orderMsg,    setOrderMsg]    = useState('')
  const [orderLocked, setOrderLocked] = useState(!!event.order_locked)
  const [hasResults,  setHasResults]  = useState(false)
  const [placementDialog, setPlacementDialog] = useState(null)

  useEffect(() => {
    const active = registrations.filter(r => r.status !== 'scratched')
    setOrderList(active)
    setOrderDirty(false)
  }, [registrations])

  useEffect(() => {
    api.getResults(event.id, 'qualification')
      .then(r => setHasResults(Array.isArray(r) && r.length > 0))
      .catch(() => setHasResults(false))
  }, [event.id])

  useEffect(() => {
    if (!searchQ.trim() || searchQ.length < 2) { setSearchResults([]); return }
    setSearching(true)
    const t = setTimeout(async () => {
      const results = await api.getAthletes(searchQ)
      const regIds  = new Set(registrations.map(r => r.athlete_id))
      setSearchResults(results.filter(a => !regIds.has(a.id)))
      setSearching(false)
    }, 300)
    return () => clearTimeout(t)
  }, [searchQ, registrations])

  const handleUsssSync = async () => {
    setUsssSyncing(true); setUsssSyncResult(null)
    try {
      const result = await api.syncAthletesWithUsss()
      setUsssSyncResult(result)
      onRefresh()
    } catch (e) { setUsssSyncResult({ error: e.message }) }
    finally { setUsssSyncing(false) }
  }

  // Import bibs from another event (dual mogul)
  const openBibImport = async () => {
    setBibImportMsg(''); setBibImportError(''); setBibImportPreview(null)
    setShowBibImport(true)
    try {
      const res = await fetch(`/api/meets/${event.meet_id}/events`)
      const allEvents = await res.json()
      const eligible = (Array.isArray(allEvents) ? allEvents : [])
        .filter(e => e.id !== event.id && e.gender === event.gender)
      setBibImportEvents(eligible)
      if (eligible.length) setBibImportSourceId(eligible[0].id)
    } catch { setBibImportEvents([]) }
  }

  const handleBibImportPreview = async () => {
    if (!bibImportSourceId) return
    setBibImportBusy(true); setBibImportError(''); setBibImportMsg(''); setBibImportPreview(null)
    try {
      const preview = await api.previewImportBibsFromEvent(event.id, bibImportSourceId)
      if (!preview.matched) {
        setBibImportError('No matching athletes found in the source event.')
      } else if (preview.overwritten > 0) {
        setBibImportPreview(preview)
      } else {
        await executeBibImport()
      }
    } catch (e) { setBibImportError(e.message) }
    finally { setBibImportBusy(false) }
  }

  const executeBibImport = async () => {
    setBibImportBusy(true); setBibImportError('')
    try {
      const result = await api.importBibsFromEvent(event.id, bibImportSourceId)
      const parts = [`Imported ${result.updated} bib${result.updated !== 1 ? 's' : ''}`]
      if (result.skipped) parts.push(`${result.skipped} athlete${result.skipped !== 1 ? 's' : ''} had no match`)
      if (result.overwritten) parts.push(`${result.overwritten} overwritten`)
      setBibImportMsg(parts.join(' — '))
      setBibImportPreview(null)
      onRefresh()
    } catch (e) { setBibImportError(e.message) }
    finally { setBibImportBusy(false) }
  }

  const register = async (athleteId) => {
    try {
      await api.register(event.id, { athlete_id: athleteId })
      setSearchQ(''); setSearchResults([]); setRegExpanded(true)
      if (orderLocked && hasRunOrders) {
        onRefresh()
        setPlacementDialog(true)
      } else { onRefresh() }
    } catch (err) { setAddError(err.message) }
  }

  const openBrowse = async () => {
    setBulkMsg(''); setBulkError(''); setSelected(new Set())
    setShowBrowse(true)
    if (browseList.length === 0) {
      setBrowseLoading(true)
      try {
        const all    = await api.getAthletes('')
        const regIds = new Set(registrations.map(r => r.athlete_id))
        // Filter to matching gender and not already registered
        const filtered = all.filter(a =>
          (!a.gender || !event.gender || a.gender === event.gender) && !regIds.has(a.id)
        )
        setBrowseList(filtered)
      } catch (e) { setBulkError('Could not load athlete list: ' + e.message) }
      setBrowseLoading(false)
    }
  }

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectAll = () => setSelected(new Set(browseList.map(a => a.id)))
  const clearAll  = () => setSelected(new Set())

  const registerSelected = async () => {
    if (!selected.size) return
    setBulkMsg(''); setBulkError('')
    try {
      const res = await api.bulkRegister(event.id, [...selected])
      setBulkMsg(`Registered ${res.registered} athlete${res.registered !== 1 ? 's' : ''}.${res.skipped.length ? ` Skipped ${res.skipped.length} (already registered or gender mismatch).` : ''}`)
      setSelected(new Set())
      const regIds = new Set(registrations.map(r => r.athlete_id))
      selected.forEach(id => regIds.add(id))
      setBrowseList(prev => prev.filter(a => !regIds.has(a.id)))
      setRegExpanded(true)
      onRefresh()
      if (orderLocked && hasRunOrders && res.registered > 0) setPlacementDialog(true)
    } catch (e) { setBulkError('Registration failed: ' + e.message) }
  }

  const createAndRegister = async (e) => {
    e.preventDefault()
    if (!newAth.first_name || !newAth.last_name) { setAddError('First and last name required'); return }
    try {
      const athlete = await api.createAthlete({ ...newAth, birth_year: newAth.birth_year || null })
      await api.register(event.id, { athlete_id: athlete.id })
      setNewAth({ first_name:'', last_name:'', ussa_num:'', fis_id:'', club:'', division:'', gender: event.gender||'M', birth_year:'' })
      setShowNew(false); setAddError(''); setRegExpanded(true); onRefresh()
      if (orderLocked && hasRunOrders) setPlacementDialog(true)
    } catch (err) { setAddError(err.message) }
  }

  const handleUsssRegisterConfirm = async (picks) => {
    setUsssRegMsg(''); setAddError('')
    try {
      const ussa_ids = picks.map(p => p.ussa_id)
      // Step 1: create-or-find athletes
      const { athletes } = await api.createAthletesFromUsss(ussa_ids)
      const valid = athletes.filter(a => a.athlete_id)
      if (!valid.length) {
        setUsssRegMsg('No athletes were created.')
        return
      }
      // Step 2: bulk register
      const ids = valid.map(a => a.athlete_id)
      const res = await api.bulkRegister(event.id, ids)
      const created = valid.filter(a => a.created).length
      const reused = valid.length - created
      setUsssRegMsg(`Registered ${res.registered} athlete${res.registered !== 1 ? 's' : ''} (${created} new, ${reused} already in registry)${res.skipped?.length ? `, skipped ${res.skipped.length}` : ''}.`)
      setShowUsssRegister(false)
      setRegExpanded(true)
      onRefresh()
      if (orderLocked && hasRunOrders && res.registered > 0) setPlacementDialog(true)
    } catch (err) {
      setAddError(err.message || 'Failed to register from USSS')
    }
  }

  // Up/Down reorder
  const move = (idx, dir) => {
    const list = [...orderList]
    const swap = idx + dir
    if (swap < 0 || swap >= list.length) return
    ;[list[idx], list[swap]] = [list[swap], list[idx]]
    setOrderList(list)
    setOrderDirty(true)
    setOrderMsg('')
  }

  const saveOrder = async () => {
    try {
      await api.reorderRegistrations(event.id, orderList.map((r, i) => ({ id: r.id, run_order: i + 1 })))
      setOrderMsg('Order saved.')
      setOrderDirty(false)
      setRunOrderExpanded(true)
      onRefresh()
    } catch (e) { setOrderMsg('Error: ' + e.message) }
  }

  const doRandomOrder = () => {
    if (!orderList.length) return
    if (hasRunOrders && !confirm('Are you sure you want to randomize the run order?  This will replace the current order.')) return
    const shuffle = (arr) => {
      const a = [...arr]
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]]
      }
      return a
    }
    const female  = orderList.filter(r => r.gender === 'F')
    const male    = orderList.filter(r => r.gender !== 'F')
    setOrderList([...shuffle(female), ...shuffle(male)])
    setOrderDirty(true)
    setRunOrderExpanded(true)
    setOrderMsg('Random order assigned -- press Save Order to confirm.')
  }

  const doSeedFromResults = async () => {
    try {
      const res = await api.seedFromResults(event.id)
      await onRefresh()
      setRunOrderExpanded(true)
      setOrderMsg(`Seeded from qualification results (${res.count} athletes).`)
    } catch (e) { setOrderMsg('Error: ' + e.message) }
  }

  const doOrderByAgeGroups = async () => {
    if (!orderList.length) return
    if (hasRunOrders && !confirm('Set run order by age groups? This will replace the current order.')) return
    try {
      const res = await api.orderByAgeGroups(event.id)
      await onRefresh()
      setRunOrderExpanded(true)
      setOrderMsg(`Run order set by age groups (${res.count} athletes).`)
    } catch (e) { setOrderMsg('Error: ' + e.message) }
  }

  // Placement logic for adding athletes when order is locked
  const hasRunOrders = orderList.some(r => r.run_order != null)

  const applyPlacement = async (position) => {
    const freshRegs = await api.getRegistrations(event.id)
    const active = freshRegs.filter(r => r.status !== 'scratched')
    const withOrder = active.filter(r => r.run_order != null).sort((a, b) => a.run_order - b.run_order)
    const withoutOrder = active.filter(r => r.run_order == null)
    if (!withoutOrder.length) { setPlacementDialog(null); onRefresh(); return }

    let newList
    if (position === 'start') {
      newList = [...withoutOrder, ...withOrder]
    } else if (position === 'end') {
      newList = [...withOrder, ...withoutOrder]
    } else {
      newList = [...withOrder]
      for (const r of withoutOrder) {
        const idx = Math.floor(Math.random() * (newList.length + 1))
        newList.splice(idx, 0, r)
      }
    }
    await api.reorderRegistrations(event.id, newList.map((r, i) => ({ id: r.id, run_order: i + 1 })))
    setPlacementDialog(null)
    setRunOrderExpanded(true)
    onRefresh()
  }

  // "16 Down": top 16 reversed, the rest before them unchanged
  const sixteenDown = () => {
    if (!orderList.length) return
    const rest   = orderList.slice(16)        // positions 17+ -- stay in order
    const top16  = orderList.slice(0, 16).reverse()  // 1st becomes last
    setOrderList([...rest, ...top16])
    setOrderDirty(true)
    setOrderMsg('"16 Down" applied -- press Save Order to confirm.')
  }

  // Per-round scratch helpers
  const getRunScratched = (reg) => {
    try { return JSON.parse(reg.round_scratched || '[]') } catch { return [] }
  }
  const toggleRoundScratch = async (reg, runNum) => {
    const current = getRunScratched(reg)
    const updated = current.includes(runNum)
      ? current.filter(n => n !== runNum)
      : [...current, runNum]
    await api.updateRegistration(event.id, reg.id, { round_scratched: updated })
    onRefresh()
  }
  const numRuns = 3

  return (
    <div className="space-y-6">
      {showCsvImport && (
        <CsvImportModal
          meetId={event.meet_id}
          eventId={event.id}
          event={event}
          onClose={() => setShowCsvImport(false)}
          onImported={() => { setShowCsvImport(false); setRegExpanded(true); onRefresh(); setShowUsssSyncPrompt(true) }}
        />
      )}
      {/* Placement dialog for adding athletes when order is locked */}
      {placementDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 max-w-sm w-full mx-4 border border-slate-700">
            <h3 className="font-display text-lg text-white mb-2">Run Order Placement</h3>
            <p className="text-slate-300 text-sm mb-4">Where should this athlete be placed in the run order?</p>
            <div className="flex flex-col gap-2">
              <button onClick={() => applyPlacement('start')} className="btn-primary text-sm">Start of Run Order</button>
              <button onClick={() => applyPlacement('end')} className="btn-primary text-sm">End of Run Order</button>
              <button onClick={() => applyPlacement('random')} className="btn-ghost text-sm">Random Position</button>
              <button onClick={() => { setPlacementDialog(null); onRefresh() }} className="btn-ghost text-sm text-slate-500">Cancel</button>
            </div>
          </div>
        </div>
      )}
      {/* Search / add athlete */}
      <div className="card">
        <h3 className="font-display text-lg text-white mb-4">Add Athlete</h3>
        <div className="relative mb-3">
          <input className="input" placeholder="Search by name or USSA number..." value={searchQ} onChange={e => setSearchQ(e.target.value)} />
          {searching && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">...</span>}
        </div>
        {searchResults.length > 0 && (
          <div className="border border-slate-700 rounded-lg overflow-hidden mb-3">
            {searchResults.slice(0,8).map(a => (
              <div key={a.id} className="flex items-center justify-between px-3 py-2.5 hover:bg-slate-800 border-b border-slate-800 last:border-0">
                <div>
                  <span className="text-white text-sm">{a.last_name}, {a.first_name}</span>
                  {a.ussa_num && <span className="ml-2 text-xs text-slate-500">#{a.ussa_num}</span>}
                  {a.club     && <span className="ml-2 text-xs text-slate-600">{a.club}</span>}
                </div>
                <button onClick={() => register(a.id)} className="btn-primary text-xs py-1 px-3">Add</button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-3 flex-wrap">
          <button onClick={() => { setShowNew(!showNew); setShowUsssRegister(false) }} className="btn-ghost text-sm">Manual Entry</button>
          <button onClick={() => { setShowUsssRegister(!showUsssRegister); setShowNew(false); setUsssRegMsg('') }} className="btn-ghost text-sm">Register from USSS Database</button>
          <button onClick={openBrowse} className="btn-ghost text-sm">Browse &amp; Register All</button>
          <button onClick={() => setShowCsvImport(true)} className="btn-ghost text-sm">Upload Registration CSV</button>
          <button onClick={handleUsssSync} disabled={usssSyncing} className="btn-ghost text-sm disabled:opacity-50">
            {usssSyncing ? 'Syncing...' : 'Sync with USSS Database'}
          </button>
        </div>

        {showUsssSyncPrompt && (
          <div className="mt-3 px-4 py-3 rounded-lg bg-blue-900/20 border border-blue-800 text-blue-300 text-sm flex items-center justify-between">
            <span>CSV import complete. Sync with USSS Database to fill in missing athlete data?</span>
            <div className="flex gap-2 ml-4">
              <button onClick={() => { setShowUsssSyncPrompt(false); handleUsssSync() }} className="btn-primary text-xs py-1 px-3">Yes, Sync</button>
              <button onClick={() => setShowUsssSyncPrompt(false)} className="btn-ghost text-xs py-1 px-3">No Thanks</button>
            </div>
          </div>
        )}

        {usssSyncResult && (
          <div className={`mt-3 px-4 py-2 rounded-lg text-sm ${usssSyncResult.error ? 'bg-red-900/20 border border-red-800 text-red-400' : 'bg-green-900/20 border border-green-800 text-green-400'}`}>
            {usssSyncResult.error
              ? `Sync failed: ${usssSyncResult.error}`
              : `Sync complete -- ${usssSyncResult.matched} matched, ${usssSyncResult.updated} updated, ${usssSyncResult.not_found} not found in USSS database`}
            <button onClick={() => setUsssSyncResult(null)} className="ml-3 text-slate-500 hover:text-white text-xs">Dismiss</button>
          </div>
        )}

        {usssRegMsg && (
          <div className="mt-3 px-4 py-2 rounded-lg bg-green-900/20 border border-green-800 text-green-400 text-sm">
            {usssRegMsg}
            <button onClick={() => setUsssRegMsg('')} className="ml-3 text-slate-500 hover:text-white text-xs">Dismiss</button>
          </div>
        )}

        {showUsssRegister && (
          <div className="mt-4">
            <UsssAthleteSearchPanel
              onConfirm={handleUsssRegisterConfirm}
              onClose={() => setShowUsssRegister(false)}
              confirmLabel="Create &amp; Register"
              genderFilter={event.gender}
            />
          </div>
        )}

        {/* Browse & Register panel */}
        {showBrowse && (
          <div className="mt-4 border border-slate-700 rounded-xl overflow-hidden">
            <div className="bg-slate-800 px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-white">
                {event.gender === 'M' ? 'Male' : event.gender === 'F' ? 'Female' : 'All'} athletes not yet registered
              </span>
              <button onClick={() => setShowBrowse(false)} className="text-slate-400 hover:text-white text-sm">Close</button>
            </div>
            {browseLoading && <div className="px-4 py-6 text-slate-500 text-sm text-center">Loading...</div>}
            {!browseLoading && browseList.length === 0 && (
              <div className="px-4 py-6 text-slate-500 text-sm text-center">No eligible athletes found.</div>
            )}
            {!browseLoading && browseList.length > 0 && (
              <>
                <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-700 bg-slate-900/40">
                  <button onClick={selectAll}  className="text-xs text-blue-400 hover:text-blue-300">Select All</button>
                  <button onClick={clearAll}   className="text-xs text-slate-400 hover:text-slate-300">Clear</button>
                  <span className="text-xs text-slate-500 ml-auto">{selected.size} selected</span>
                </div>
                <div className="max-h-64 overflow-y-auto divide-y divide-slate-800">
                  {browseList.map(a => (
                    <label key={a.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selected.has(a.id)}
                        onChange={() => toggleSelect(a.id)}
                        className="accent-blue-500 w-4 h-4"
                      />
                      <span className="text-white text-sm flex-1">{a.last_name}, {a.first_name}</span>
                      {a.ussa_num && <span className="text-xs text-slate-500 font-mono">#{a.ussa_num}</span>}
                      {a.club     && <span className="text-xs text-slate-600">{a.club}</span>}
                    </label>
                  ))}
                </div>
                {bulkMsg   && <div className="px-4 py-2 text-sm text-green-400 bg-green-900/20 border-t border-green-800">{bulkMsg}</div>}
                {bulkError && <div className="px-4 py-2 text-sm text-red-400 bg-red-900/20 border-t border-red-800">{bulkError}</div>}
                <div className="px-4 py-3 border-t border-slate-700 bg-slate-900/40">
                  <button
                    onClick={registerSelected}
                    disabled={!selected.size}
                    className="btn-primary w-full disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Register Selected ({selected.size})
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {showNew && (
          <form onSubmit={createAndRegister} className="mt-4 grid grid-cols-2 gap-3">
            <div><label className="label">First Name</label><input className="input" value={newAth.first_name} onChange={e => setNewAth({...newAth,first_name:e.target.value})} /></div>
            <div><label className="label">Last Name</label><input className="input" value={newAth.last_name} onChange={e => setNewAth({...newAth,last_name:e.target.value})} /></div>
            <div><label className="label">USSA Number</label><input className="input font-mono" value={newAth.ussa_num} onChange={e => setNewAth({...newAth,ussa_num:e.target.value})} /></div>
            <div><label className="label">FIS ID</label><input className="input font-mono" value={newAth.fis_id} onChange={e => setNewAth({...newAth,fis_id:e.target.value})} /></div>
            <div><label className="label">Club</label><input className="input" value={newAth.club} onChange={e => setNewAth({...newAth,club:e.target.value})} /></div>
            <div><label className="label">Division</label><input className="input uppercase" maxLength={4} placeholder="RM" value={newAth.division} onChange={e => setNewAth({...newAth,division:e.target.value})} /></div>
            <div><label className="label">Birth Year</label><input className="input" type="number" placeholder="e.g. 2008" value={newAth.birth_year} onChange={e => setNewAth({...newAth,birth_year:e.target.value})} /></div>
            <div><label className="label">Gender</label>
              <select className="input" value={newAth.gender} onChange={e => setNewAth({...newAth,gender:e.target.value})}>
                <option value="M">Male</option><option value="F">Female</option>
              </select>
            </div>
            <div className="col-span-2"><button type="submit" className="btn-primary w-full">Create &amp; Register</button></div>
          </form>
        )}
        {addError && <p className="text-red-400 text-sm mt-2">{addError}</p>}
      </div>

      {/* Bib + status table */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3
            className="font-display text-lg text-white cursor-pointer flex items-center gap-2 select-none"
            onClick={() => setRegExpanded(v => !v)}
          >
            <span className={`transition-transform text-slate-400 text-xs ${regExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
            Registered Athletes <span className="text-slate-500 font-normal text-base">({registrations.filter(r=>r.status!=='scratched').length})</span>
          </h3>
          <div className="flex gap-2">
            <button onClick={() => setShowBibAssign(true)} className="bg-mountain-600 hover:bg-mountain-500 text-white text-xs px-3 py-1.5 rounded font-semibold">Assign Bibs</button>
            {event.discipline === 'dual_mogul' && (
              <button
                onClick={showBibImport ? () => { setShowBibImport(false); setBibImportPreview(null); setBibImportMsg(''); setBibImportError('') } : openBibImport}
                className="bg-mountain-600 hover:bg-mountain-500 text-white text-xs px-3 py-1.5 rounded font-semibold"
              >
                {showBibImport ? 'Cancel' : 'Import Bibs from Event'}
              </button>
            )}
          </div>
        </div>
        {showBibImport && event.discipline === 'dual_mogul' && (
          <div className="mb-4 p-3 bg-slate-800/60 rounded-lg border border-slate-700 space-y-3">
            {bibImportEvents.length === 0 ? (
              <p className="text-slate-400 text-sm">No other events with the same gender in this meet.</p>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <label className="text-sm text-slate-300">Source event:</label>
                  <select
                    className="input text-sm flex-1"
                    value={bibImportSourceId}
                    onChange={e => { setBibImportSourceId(e.target.value); setBibImportPreview(null); setBibImportMsg(''); setBibImportError('') }}
                  >
                    {bibImportEvents.map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleBibImportPreview}
                    disabled={bibImportBusy || !bibImportSourceId}
                    className="btn-primary text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {bibImportBusy ? 'Working...' : 'Import'}
                  </button>
                </div>
                {bibImportPreview && (
                  <div className="p-2 bg-amber-900/30 border border-amber-700 rounded text-sm">
                    <p className="text-amber-300 font-semibold">
                      {bibImportPreview.overwritten} existing bib{bibImportPreview.overwritten !== 1 ? 's' : ''} will be overwritten.
                    </p>
                    <p className="text-slate-300 text-xs mt-1">
                      {bibImportPreview.matched} matched, {bibImportPreview.skipped} unmatched (will be skipped)
                    </p>
                    <button
                      onClick={executeBibImport}
                      disabled={bibImportBusy}
                      className="mt-2 bg-amber-600 hover:bg-amber-500 text-white text-xs px-3 py-1.5 rounded font-semibold disabled:opacity-40"
                    >
                      {bibImportBusy ? 'Working...' : 'Confirm Import'}
                    </button>
                  </div>
                )}
                {bibImportMsg && <p className="text-green-400 text-sm">{bibImportMsg}</p>}
                {bibImportError && <p className="text-red-400 text-sm">{bibImportError}</p>}
              </>
            )}
          </div>
        )}
        {!registrations.length ? <p className="text-slate-500 text-sm">No athletes registered.</p> : regExpanded && (
          <table className="data-table">
            <thead><tr><th>Bib</th><th>Name</th><th>Age Class</th><th>USSA #</th><th>FIS ID</th><th>Club</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {registrations.map(r => (
                <tr key={r.id} className={isRegistrationIncomplete(r) ? 'bg-red-900/20' : (isMissingBibOnly(r) ? 'bg-yellow-900/20' : '')}>
                  <td>
                    <BibInput eventId={event.id} registration={r} onRefresh={onRefresh} />
                  </td>
                  <td className="text-white font-medium">{r.last_name}, {r.first_name}</td>
                  <td className="font-mono text-slate-400 text-xs">{computeAgeClass(r.birth_year, event.event_date)}</td>
                  <td className="font-mono text-slate-400 text-xs">{r.ussa_num||'--'}</td>
                  <td className="font-mono text-slate-400 text-xs">{r.fis_id||'--'}</td>
                  <td className="text-slate-500 text-xs">{r.club||'--'}</td>
                  <td>
                    <select className="bg-slate-800 text-xs text-slate-400 rounded px-1.5 py-1 border border-slate-700"
                      value={r.status} onChange={async e => {
                        const newStatus = e.target.value
                        const wasScratched = r.status === 'scratched'
                        await api.updateRegistration(event.id, r.id, { status: newStatus })
                        onRefresh()
                        if (wasScratched && newStatus === 'registered' && orderLocked && hasRunOrders) {
                          setPlacementDialog(true)
                        }
                      }}>
                      <option value="registered">Registered</option>
                      <option value="scratched">Scratched</option>
                    </select>
                  </td>
                  <td><button onClick={async()=>{if(!window.confirm(`Remove ${r.last_name}, ${r.first_name} from this event? Their run order slot will be removed.`))return;await api.removeRegistration(event.id,r.id);onRefresh()}} className="text-red-500 hover:text-red-400 text-xs">Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Seeding List (dual mogul) or Run Order (mogul/aerials) */}
      {event.discipline === 'dual_mogul' ? (
        orderList.length > 0 && (
          <DualSeedingPanel event={event} registrations={registrations} orderList={orderList} onRefresh={onRefresh} />
        )
      ) : (
      orderList.length > 0 && (
        <div className="card">
          <div className="flex items-start justify-between mb-4 gap-4">
            <div>
              <h3
                className="font-display text-lg text-white cursor-pointer flex items-center gap-2 select-none"
                onClick={() => setRunOrderExpanded(v => !v)}
              >
                <span className={`transition-transform text-slate-400 text-xs ${runOrderExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
                Run Order
              </h3>
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <button onClick={doRandomOrder} disabled={orderLocked || !allAthletesComplete} title={!allAthletesComplete ? 'All athletes must have complete data before building run order' : undefined} className="btn-ghost text-xs disabled:opacity-30 disabled:cursor-not-allowed">Random Order</button>
              <button
                onClick={doOrderByAgeGroups}
                disabled={orderLocked || !allAthletesComplete}
                title={!allAthletesComplete ? 'All athletes must have complete data before building run order' : undefined}
                className="btn-ghost text-xs disabled:opacity-40 disabled:cursor-not-allowed"
              >
                By Age Groups
              </button>

              <button
                onClick={async () => {
                  const newVal = orderLocked ? 0 : 1
                  try {
                    await api.updateEvent(event.meet_id, event.id, { order_locked: newVal })
                    setOrderLocked(!orderLocked)
                    onRefresh()
                  } catch (err) { setOrderMsg('Error: ' + err.message) }
                }}
                disabled={!orderLocked && !allAthletesComplete}
                className={`btn-ghost text-xs ${orderLocked ? 'bg-green-900/30 text-green-400 border-green-700' : 'text-slate-400'} disabled:opacity-30 disabled:cursor-not-allowed`}
              >
                {orderLocked ? 'Order Locked' : 'Lock Order'}
              </button>
              <button
                onClick={saveOrder}
                disabled={orderLocked || !orderDirty || !orderList.length || !allAthletesComplete}
                className="btn-primary text-xs disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Save Order
              </button>
            </div>
          </div>
          {!allAthletesComplete && (
            <p className="text-amber-400 text-xs mb-3">
              {incompleteCount} athlete{incompleteCount !== 1 ? 's' : ''} missing required fields (name, USSS#, or birth year). Complete all fields before building run order.
            </p>
          )}
          {orderMsg && <p className="text-sm text-blue-300 mb-3">{orderMsg}</p>}
          {(hasRunOrders || orderDirty) && runOrderExpanded && (
          <table className="data-table">
            <thead><tr>
              <th className="w-12 text-center">Pos</th>
              <th className="w-12 text-center">Bib</th>
              <th>Name</th>
              <th className="w-16 text-center">Age</th>
              <th className="w-16"></th>
            </tr></thead>
            <tbody>
              {orderList.map((r, idx) => {
                return (
                  <tr key={r.id}>
                    <td className="font-mono text-slate-400 text-center">{idx + 1}</td>
                    <td className="font-mono text-slate-400 text-center">{r.bib_number || '--'}</td>
                    <td className="text-white">{r.last_name}, {r.first_name}</td>
                    <td className="font-mono text-slate-400 text-xs text-center">{computeAgeClass(r.birth_year, event.event_date)}</td>
                    <td>
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => move(idx, -1)}
                          disabled={orderLocked || idx === 0}
                          className="text-slate-400 hover:text-white disabled:opacity-20 px-1 text-lg leading-none select-none"
                          title="Move up"
                        >&#9650;</button>
                        <button
                          onClick={() => move(idx, 1)}
                          disabled={orderLocked || idx === orderList.length - 1}
                          className="text-slate-400 hover:text-white disabled:opacity-20 px-1 text-lg leading-none select-none"
                          title="Move down"
                        >&#9660;</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          )}
        </div>
      )
      )}

      {showBibAssign && (
        <BibAssignModal
          event={event}
          registrations={registrations}
          onClose={() => setShowBibAssign(false)}
          onRefresh={onRefresh}
        />
      )}
    </div>
  )
}

// ── Dual Mogul Seeding Panel ──────────────────────────────────────────────────
function DualSeedingPanel({ event, registrations, orderList, onRefresh }) {
  const [seedMethod, setSeedMethod] = useState('random')
  const [seedMsg,    setSeedMsg]    = useState('')
  const [seeding,    setSeeding]    = useState(false)
  const [seedList,   setSeedList]   = useState([])
  const [seedDirty,  setSeedDirty]  = useState(false)
  const [pendingEntries, setPendingEntries] = useState(null)

  // Registration completeness check (same as mogul run order)
  // v1.16.31 -- bib NOT required for seed-list build; missing-bib athletes get yellow rows.
  const isRegIncomplete = (r) =>
    !r.first_name || !r.last_name || !r.ussa_num || !r.birth_year
  const isRegMissingBibOnly = (r) =>
    !isRegIncomplete(r) && r.bib_number == null
  const incompleteCount = registrations.filter(r => r.status !== 'scratched').filter(isRegIncomplete).length
  const allAthletesComplete = incompleteCount === 0

  // v1.6: source mogul event picker
  const [sourceEvents,  setSourceEvents]  = useState([])
  const [sourceEventId, setSourceEventId] = useState('')

  useEffect(() => {
    // Sort by dual_seed if set, otherwise by bib
    const sorted = [...orderList].sort((a, b) => {
      if (a.dual_seed != null && b.dual_seed != null) return a.dual_seed - b.dual_seed
      if (a.dual_seed != null) return -1
      if (b.dual_seed != null) return 1
      return (a.bib_number || 999) - (b.bib_number || 999)
    })
    setSeedList(sorted)
    setSeedDirty(false)
  }, [orderList])

  // v1.6: load candidate source mogul events for the picker
  useEffect(() => {
    let cancelled = false
    fetch(`/api/events/${event.id}/dual/candidate-source-events`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : { events: [], default_event_id: null })
      .then(j => {
        if (cancelled) return
        const evts = Array.isArray(j.events) ? j.events : []
        setSourceEvents(evts)
        if (j.default_event_id) setSourceEventId(j.default_event_id)
        else if (evts.length) setSourceEventId(evts[0].id)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [event.id])

  const reloadSeedListFromServer = async () => {
    onRefresh()
  }

  const applyPreview = (entries) => {
    const regMap = new Map(orderList.map(r => [r.id, r]))
    const sorted = entries
      .map(e => regMap.get(e.registration_id))
      .filter(Boolean)
    setSeedList(sorted)
    setPendingEntries(entries)
    setSeedDirty(true)
  }

  const seedRandom = () => {
    if (hasSavedSeeds && !window.confirm('A seeding list already exists. This will overwrite the existing list. Continue?')) return
    const shuffled = [...orderList]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    setSeedList(shuffled)
    setPendingEntries(shuffled.map((r, i) => ({ registration_id: r.id, seed: i + 1 })))
    setSeedDirty(true)
    setSeedMsg(`Preview: ${shuffled.length} athletes randomly seeded. Click Save to apply.`)
  }

  const seedFromMogulEvent = async () => {
    if (!sourceEventId) { setSeedMsg('Select a source mogul event first.'); return }
    if (hasSavedSeeds && !window.confirm('A seeding list already exists. This will overwrite the existing list. Continue?')) return
    setSeeding(true); setSeedMsg('')
    try {
      const res = await fetch(`/api/events/${event.id}/dual/seed-mogul-event`, {
        method: 'POST', headers: {'Content-Type':'application/json', ...authHeaders()},
        body: JSON.stringify({ source_event_id: sourceEventId, preview: true })
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || `Server error ${res.status}`)
      applyPreview(j.entries)
      setSeedMsg(`Preview: ${j.count} athletes seeded from mogul event. Click Save to apply.`)
    } catch (e) { setSeedMsg('Error: ' + e.message) }
    finally { setSeeding(false) }
  }

  const seedFromUsss = async () => {
    if (hasSavedSeeds && !window.confirm('A seeding list already exists. This will overwrite the existing list. Continue?')) return
    setSeeding(true); setSeedMsg('')
    try {
      const res = await fetch(`/api/events/${event.id}/dual/seed-usss`, {
        method: 'POST', headers: {'Content-Type':'application/json', ...authHeaders()},
        body: JSON.stringify({ preview: true })
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || `Server error ${res.status}`)
      applyPreview(j.entries)
      setSeedMsg(`Preview: ${j.count} athletes seeded from USSS points (${j.ranked} ranked, ${j.unranked} unranked). Click Save to apply.`)
    } catch (e) { setSeedMsg('Error: ' + e.message) }
    finally { setSeeding(false) }
  }

  const seedFromEventPlusUsss = async () => {
    if (!sourceEventId) { setSeedMsg('Select a source mogul event first.'); return }
    if (hasSavedSeeds && !window.confirm('A seeding list already exists. This will overwrite the existing list. Continue?')) return
    setSeeding(true); setSeedMsg('')
    try {
      const res = await fetch(`/api/events/${event.id}/dual/seed-event-plus-usss`, {
        method: 'POST', headers: {'Content-Type':'application/json', ...authHeaders()},
        body: JSON.stringify({ source_event_id: sourceEventId, preview: true })
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || `Server error ${res.status}`)
      applyPreview(j.entries)
      setSeedMsg(`Preview: ${j.count} athletes seeded from Best of Mogul Event / USSS. Click Save to apply.`)
    } catch (e) { setSeedMsg('Error: ' + e.message) }
    finally { setSeeding(false) }
  }

  const move = (idx, dir) => {
    const list = [...seedList]
    const swap = idx + dir
    if (swap < 0 || swap >= list.length) return
    ;[list[idx], list[swap]] = [list[swap], list[idx]]
    setSeedList(list)
    setPendingEntries(null)
    setSeedDirty(true)
    setSeedMsg('')
  }

  const saveSeedOrder = async () => {
    try {
      if (pendingEntries) {
        // Save the computed seed list via batch endpoint
        const res = await fetch(`/api/events/${event.id}/dual/save-seed-list`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ entries: pendingEntries }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `Server error ${res.status}`)
        }
      } else {
        // Save manually reordered list
        for (let i = 0; i < seedList.length; i++) {
          const res = await fetch(`/api/events/${event.id}/dual/seeds/${seedList[i].id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ seed: i + 1 }),
          })
          if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            throw new Error(body.error || `Server error ${res.status}`)
          }
        }
      }
      setPendingEntries(null)
      setSeedMsg('Seeding order saved.')
      setSeedDirty(false)
      onRefresh()
    } catch (e) { setSeedMsg('Error: ' + e.message) }
  }

  const hasSavedSeeds = orderList.some(r => r.dual_seed != null)
  const hasSource    = !!sourceEventId

  return (
    <div className="card">
      <div className="mb-4">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h3 className="font-display text-lg text-white">Seeding List</h3>
            <p className="text-slate-500 text-xs mt-1">Build the seed list, then run FIS Bracketing on the Dual Bracket tab.  Seeds 1-8 keep position; 9-16, 17-32, and 33+ are randomized per FIS rules.</p>
          </div>
          <button
            onClick={saveSeedOrder}
            disabled={!seedDirty || !seedList.length || !allAthletesComplete}
            className="btn-primary text-xs whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save Seed List
          </button>
        </div>
        {!allAthletesComplete && (
          <p className="text-amber-400 text-xs mb-2">
            {incompleteCount} athlete{incompleteCount !== 1 ? 's' : ''} missing required fields (name, USSS#, or birth year). Complete all fields before building seed list.
          </p>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs text-slate-400 mr-1">Source event:</label>
          <select
            className="input text-xs py-1 w-48"
            value={sourceEventId}
            onChange={e => setSourceEventId(e.target.value)}
            disabled={!sourceEvents.length}
          >
            {!sourceEvents.length && <option value="">-- none available --</option>}
            {sourceEvents.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <span className="text-slate-600 mx-1">|</span>
          <button
            onClick={seedRandom}
            disabled={seeding || !allAthletesComplete}
            title={!allAthletesComplete ? 'All athletes must have complete data before seeding' : 'Randomly seed all athletes'}
            className="btn-ghost text-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Random Seed
          </button>
          <button
            onClick={seedFromMogulEvent}
            disabled={seeding || !hasSource || !allAthletesComplete}
            title={!allAthletesComplete ? 'All athletes must have complete data before seeding' : hasSource ? 'Seed from this meet\'s mogul event official placings' : 'No source mogul event available'}
            className="btn-ghost text-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Seed from Mogul Event
          </button>
          <button
            onClick={seedFromUsss}
            disabled={seeding || !allAthletesComplete}
            title={!allAthletesComplete ? 'All athletes must have complete data before seeding' : 'Seed from USSS dual mogul points (higher is better)'}
            className="btn-ghost text-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Seed from USSS Points
          </button>
          <button
            onClick={seedFromEventPlusUsss}
            disabled={seeding || !hasSource || !allAthletesComplete}
            title={!allAthletesComplete ? 'All athletes must have complete data before seeding' : hasSource ? 'Best of mogul event placing or USSS rank' : 'No source mogul event available'}
            className="btn-ghost text-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Mogul Event + USSS
          </button>
        </div>
      </div>
      {seedMsg && <p className="text-sm text-blue-300 mb-3">{seedMsg}</p>}
      {(hasSavedSeeds || seedDirty) && <table className="data-table">
        <thead><tr>
          <th className="w-12 text-center">Seed</th>
          <th className="w-12 text-center">Bib</th>
          <th>Name</th>
          <th className="w-20 text-center">FIS Tier</th>
          <th className="w-16"></th>
        </tr></thead>
        <tbody>
          {seedList.map((r, idx) => {
            const seedNum = idx + 1
            const tier = seedNum <= 8 ? '1-8' : seedNum <= 16 ? '9-16' : seedNum <= 32 ? '17-32' : '33+'
            const tierColor = seedNum <= 8 ? 'text-green-400' : seedNum <= 16 ? 'text-blue-400' : seedNum <= 32 ? 'text-amber-400' : 'text-slate-500'
            return (
              <tr key={r.id}>
                <td className="font-mono text-slate-400 text-center">{seedNum}</td>
                <td className="font-mono text-slate-400 text-center">{r.bib_number || '--'}</td>
                <td className="text-white">{r.last_name}, {r.first_name}</td>
                <td className={`text-center text-xs font-semibold ${tierColor}`}>{tier}</td>
                <td>
                  <div className="flex gap-1 justify-end">
                    <button
                      onClick={() => move(idx, -1)}
                      disabled={idx === 0}
                      className="text-slate-400 hover:text-white disabled:opacity-20 px-1 text-lg leading-none select-none"
                      title="Move up"
                    >&#9650;</button>
                    <button
                      onClick={() => move(idx, 1)}
                      disabled={idx === seedList.length - 1}
                      className="text-slate-400 hover:text-white disabled:opacity-20 px-1 text-lg leading-none select-none"
                      title="Move down"
                    >&#9660;</button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>}
    </div>
  )
}

// ── Dual Mogul Scoring Panel ─────────────────────────────────────────────────
// v1.25.00 (E-1) — operator control to hide/show the broadcast overlay graphics.
// Hide persists on the overlay until the next run starts (or Show is clicked).
function OverlayControl({ eventId }) {
  const [busy, setBusy] = useState(false)
  const send = async (action) => {
    setBusy(true)
    try {
      await fetch(`/api/events/${eventId}/overlay/${action}`, { method: 'POST', headers: authHeaders() })
    } catch (_) {}
    finally { setBusy(false) }
  }
  return (
    <div className="flex items-center gap-1 text-xs text-slate-500">
      <span>Broadcast Overlay:</span>
      <button onClick={() => send('hide')} disabled={busy} className="btn-ghost text-xs px-2 py-1 disabled:opacity-40">Hide</button>
      <button onClick={() => send('show')} disabled={busy} className="btn-ghost text-xs px-2 py-1 disabled:opacity-40">Show</button>
    </div>
  )
}

function DualScoringPanel({ event, registrations }) {
  const [bracket, setBracket] = useState([])
  const [activeMatchId, setActiveMatchId] = useState(null)
  const [matchPoints, setMatchPoints] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [paperModal, setPaperModal] = useState(null)  // { match, existingPoints }
  // v1.16.17 -- bracket complete -> HJ review state
  const [reviewStatus, setReviewStatus] = useState(null)
  const [resending, setResending] = useState(false)
  const wsRef = useRef(null)
  const isPaper = event.score_entry_mode === 'paper'

  const load = async () => {
    try {
      const b = await fetch(`/api/events/${event.id}/dual`).then(r => r.json()).catch(() => [])
      const arr = Array.isArray(b) ? b : []
      setBracket(arr)

      // Load active match
      const am = await fetch(`/api/events/${event.id}/dual/active-match`).then(r => r.json()).catch(() => null)
      setActiveMatchId(am?.id || null)

      // v1.16.17 -- review state
      try {
        const rs = await fetch(`/api/events/${event.id}/dual/review-state`).then(r => r.ok ? r.json() : null)
        setReviewStatus(rs?.status || null)
      } catch {}

      // Load judge points for all matches in the current round (parallel)
      const eligibleMatches = arr.filter(m => m.registration_id_blue && m.registration_id_red)
      const pointResults = await Promise.all(
        eligibleMatches.map(m =>
          fetch(`/api/events/${event.id}/dual/${m.id}/judge-points`)
            .then(pr => pr.ok ? pr.json().then(data => [m.id, data]) : null)
            .catch(() => null)
        )
      )
      const pointMap = {}
      for (const result of pointResults) {
        if (result) pointMap[result[0]] = result[1]
      }
      setMatchPoints(pointMap)
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  useEffect(() => { load() }, [event.id])

  // WebSocket for live updates
  useEffect(() => {
    const ws = createWebSocket(event.id, msg => {
      if (['dual_points_update', 'dual_nj_update', 'dual_match_started', 'dual_match_cleared', 'score_update', 'dual_bracket_review', 'dual_bracket_sent_back', 'event_finalized'].includes(msg.type)) {
        load()
      }
    })
    wsRef.current = ws
    return () => ws.close()
  }, [event.id])

  const resendToHj = async () => {
    setResending(true); setError(''); setMsg('')
    try {
      const r = await fetch(`/api/events/${event.id}/dual/resend-to-hj`, { method: 'POST', headers: authHeaders() })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error || `Server error ${r.status}`)
      }
      setMsg('Bracket resent to Head Judge for approval.')
      await load()
    } catch (e) { setError('Resend failed: ' + e.message) }
    finally { setResending(false) }
  }

  if (loading) return <div className="text-slate-500 text-sm">Loading bracket...</div>
  if (!bracket.length) return (
    <div className="card text-center py-10 text-slate-500">
      No bracket yet.  Create the bracket on the Dual Bracket tab first.
    </div>
  )

  // Group matches by round
  const mainRounds = {}
  const consolRounds = {}
  for (const m of bracket) {
    if (m.is_small_final) {
      if (!consolRounds[m.bracket_round]) consolRounds[m.bracket_round] = []
      consolRounds[m.bracket_round].push(m)
    } else {
      if (!mainRounds[m.bracket_round]) mainRounds[m.bracket_round] = []
      mainRounds[m.bracket_round].push(m)
    }
  }
  const roundNums = Object.keys(mainRounds).map(Number).sort((a, b) => b - a)
  const consolRoundNums = Object.keys(consolRounds).map(Number).sort((a, b) => b - a)
  const totalRound = roundNums.length > 0 ? roundNums[0] : 1

  const roundLabel = (n, isConsol = false) => {
    if (isConsol) {
      if (n === 1) return 'Small Final'
      if (n === 2) return '5th -- 8th Place'
      return `Consolation Round ${n}`
    }
    if (n === 1) return 'Big Final'
    if (n === 2) return 'Semifinals'
    if (n === 3) return 'Quarterfinals'
    return `Round of ${Math.pow(2, n)}`
  }

  // Determine the current active round: the highest round number that still has pending matches
  const allMainRoundNums = roundNums
  let currentRound = null
  for (const rn of allMainRoundNums) {
    const matches = mainRounds[rn] || []
    if (matches.some(m => m.status !== 'complete' && !m.is_bye)) {
      currentRound = rn
      break
    }
  }

  // If all main rounds done, check consolation
  let currentConsolRound = null
  if (!currentRound) {
    for (const rn of consolRoundNums) {
      const matches = consolRounds[rn] || []
      if (matches.some(m => m.status !== 'complete' && !m.is_bye)) {
        currentConsolRound = rn
        break
      }
    }
  }

  const isConsol = !currentRound && currentConsolRound !== null
  const activeRoundNum = currentRound || currentConsolRound
  const activeRoundMatches = isConsol
    ? (consolRounds[activeRoundNum] || []).sort((a, b) => a.bracket_position - b.bracket_position)
    : (mainRounds[activeRoundNum] || []).sort((a, b) => a.bracket_position - b.bracket_position)

  // Filter to playable matches (both athletes present, not bye, not complete)
  const pendingMatches = activeRoundMatches.filter(m =>
    m.registration_id_blue && m.registration_id_red && !m.is_bye && m.status !== 'complete'
  )
  const completedMatches = activeRoundMatches.filter(m => m.status === 'complete' || m.is_bye)

  // Active match (currently scoring)
  const activeMatch = activeMatchId ? activeRoundMatches.find(m => m.id === activeMatchId) : null

  // Up next (excluding active match)
  const upNextMatches = pendingMatches.filter(m => m.id !== activeMatchId)
  const nextMatch = upNextMatches[0] || null
  const onDeckMatches = upNextMatches.slice(1, 3)
  const remainingMatches = upNextMatches.slice(3)

  const startMatch = async (matchId) => {
    setError('')
    setMsg('')
    try {
      const res = await fetch(`/api/events/${event.id}/dual/active-match`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ match_id: matchId }),
      })
      if (!res.ok) { const j = await res.json(); throw new Error(j.error) }
      setActiveMatchId(matchId)
      setMsg('Match started.  Judges may now enter scores on their tablets.')
    } catch (e) { setError(e.message) }
  }

  const clearActiveMatch = async () => {
    try {
      await fetch(`/api/events/${event.id}/dual/active-match`, { method: 'DELETE', headers: authHeaders() })
      setActiveMatchId(null)
      await load()
    } catch (e) { setError(e.message) }
  }

  const openManualEntry = async (m) => {
    setError('')
    try {
      const res = await fetch(`/api/events/${event.id}/dual/manual-entry-start`, { method: 'POST', headers: authHeaders() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to start manual entry')
      setPaperModal({ match: m, existingPoints: data.judgeScores || null, manualEntry: true })
    } catch (e) { setError(e.message) }
  }

  const cancelManualEntry = async () => {
    try {
      await fetch(`/api/events/${event.id}/dual/manual-entry-cancel`, { method: 'POST', headers: authHeaders() })
    } catch (_) {}
  }

  // v1.29.00 (FS-18) -- set/clear the NJ (past chop) call for one athlete
  const setMatchNJ = async (m, side, checked) => {
    setError('')
    try {
      const res = await fetch(`/api/events/${event.id}/dual/${m.id}/nj`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ athlete: side, value: checked }),
      })
      if (!res.ok) { const j = await res.json(); throw new Error(j.error || 'Failed to set NJ call') }
      await load()
    } catch (e) { setError(e.message) }
  }

  const allDone = !activeRoundNum
  const roundAllComplete = pendingMatches.length === 0 && !activeMatch

  const MatchRow = ({ m, highlight, showStart }) => {
    const ptData = matchPoints[m.id] || null
    const ptResult = ptData?.result || null
    const isDone = m.status === 'complete'
    const isHjPending = m.status === 'hj_pending'
    const isActive = m.id === activeMatchId
    const redOnTop = !m.is_small_final && (totalRound - m.bracket_round) % 2 === 1

    const blueBox = (
      <div className={`col-span-2 p-2.5 rounded-lg ${isDone && m.winner_registration_id === m.registration_id_blue ? 'bg-blue-800/40 ring-1 ring-blue-500' : 'bg-slate-800'}`}>
        <div className="text-xs text-blue-400 mb-0.5 font-semibold">Blue</div>
        <div className={`font-semibold text-sm flex items-center gap-1.5 ${isDone && m.winner_registration_id === m.registration_id_blue ? 'text-white' : 'text-slate-300'}`}>
          {m.blue_first ? `${m.blue_last}, ${m.blue_first}` : <span className="text-slate-600">TBD</span>}
          {isDone && m.winner_registration_id === m.registration_id_red && m.loser_status && (
            <span className="text-xs font-bold px-1 py-0.5 rounded bg-slate-700 text-slate-400">{m.loser_status}</span>
          )}
          {(m.nj_call === 'blue' || m.nj_call === 'both') && (
            <span className="text-xs font-bold px-1 py-0.5 rounded bg-amber-900/60 text-amber-400" title="Landed past the chop (landing zone) — No Jump on bottom air">NJ</span>
          )}
        </div>
        {m.blue_bib && <div className="text-xs text-slate-500 mt-0.5">Bib {m.blue_bib}</div>}
      </div>
    )
    const redBox = (
      <div className={`col-span-2 p-2.5 rounded-lg ${isDone && m.winner_registration_id === m.registration_id_red ? 'bg-red-900/40 ring-1 ring-red-500' : 'bg-slate-800'}`}>
        <div className="text-xs text-red-400 mb-0.5 font-semibold">Red</div>
        <div className={`font-semibold text-sm flex items-center gap-1.5 ${isDone && m.winner_registration_id === m.registration_id_red ? 'text-white' : 'text-slate-300'}`}>
          {m.red_first ? `${m.red_last}, ${m.red_first}` : <span className="text-slate-600">TBD</span>}
          {isDone && m.winner_registration_id === m.registration_id_blue && m.loser_status && (
            <span className="text-xs font-bold px-1 py-0.5 rounded bg-slate-700 text-slate-400">{m.loser_status}</span>
          )}
          {(m.nj_call === 'red' || m.nj_call === 'both') && (
            <span className="text-xs font-bold px-1 py-0.5 rounded bg-amber-900/60 text-amber-400" title="Landed past the chop (landing zone) — No Jump on bottom air">NJ</span>
          )}
        </div>
        {m.red_bib && <div className="text-xs text-slate-500 mt-0.5">Bib {m.red_bib}</div>}
      </div>
    )

    return (
      <div className={`rounded-xl border p-4 ${
        isActive && isHjPending ? 'border-amber-500 bg-amber-900/20 ring-1 ring-amber-500' :
        isActive ? 'border-blue-500 bg-blue-900/20 ring-1 ring-blue-500' :
        highlight ? 'border-blue-700 bg-blue-900/10' :
        isDone ? 'border-slate-700 bg-slate-800/20' :
        'border-slate-700 bg-slate-800/30'
      }`}>
        <div className="grid grid-cols-5 gap-2 items-center">
          {redOnTop ? redBox : blueBox}

          <div className="text-center text-slate-600 font-bold text-sm">
            {isDone ? <span className="text-xs text-green-400">Done</span> : isHjPending ? <span className="text-xs text-amber-400 animate-pulse">HJ</span> : isActive ? <span className="text-xs text-blue-400 animate-pulse">LIVE</span> : 'vs'}
          </div>

          {redOnTop ? blueBox : redBox}
        </div>

        {/* Running point totals */}
        {ptResult && ptResult.judgeCount > 0 && (
          <div className="flex items-center justify-center gap-4 mt-2 pt-2 border-t border-slate-700">
            <span className={`text-sm font-bold ${ptResult.winner === 'blue' ? 'text-blue-300' : 'text-slate-400'}`}>Blue {ptResult.blueTotal}</span>
            <span className="text-slate-600 text-xs">pts</span>
            <span className={`text-sm font-bold ${ptResult.winner === 'red' ? 'text-red-300' : 'text-slate-400'}`}>{ptResult.redTotal} Red</span>
            <span className="text-slate-600 text-xs">({ptResult.judgeCount}/5{ptResult.speedTied ? ' · Speed Tied' : ''}{ptResult.airTied ? ' · Air Tied' : ''})</span>
          </div>
        )}

        {/* Winner announcement */}
        {isDone && m.winner_first && (
          <div className="text-center mt-2 text-xs text-green-400 font-semibold">
            Winner: {m.winner_last}, {m.winner_first}
          </div>
        )}

        {/* Start / Clear buttons (tablet mode) */}
        {!isPaper && showStart && !isDone && !isActive && m.registration_id_blue && m.registration_id_red && (
          <div className="mt-3 pt-2 border-t border-slate-700">
            <button
              onClick={() => startMatch(m.id)}
              disabled={!!activeMatchId}
              className="btn-primary w-full text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {activeMatchId ? 'Finish current match first' : 'Start Match'}
            </button>
          </div>
        )}

        {!isPaper && isActive && (
          <>
            <div className="mt-3 pt-2 border-t border-slate-700 flex items-center justify-between gap-3">
              <span className={`text-xs animate-pulse font-semibold ${isHjPending ? 'text-amber-400' : 'text-blue-400'}`}>
                {isHjPending ? 'Awaiting Head Judge approval' : 'Scoring in progress -- judges entering scores on tablets'}
              </span>
              <div className="flex items-center gap-2">
                <button onClick={clearActiveMatch} className="text-xs px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 text-white font-semibold">End Match</button>
                <button onClick={() => openManualEntry(m)} className="text-xs px-3 py-1.5 rounded bg-mountain-600 hover:bg-mountain-700 text-white font-semibold">Manual Score Entry</button>
              </div>
            </div>
            {/* v1.29.00 (FS-18) -- NJ (past chop) flags; normally set by the Air Judge / HJ, editable here too */}
            <div className="mt-2 flex items-center gap-4">
              <label className="flex items-center gap-1.5 cursor-pointer text-xs text-blue-400 font-semibold">
                <input type="checkbox" checked={m.nj_call === 'blue' || m.nj_call === 'both'} onChange={e => setMatchNJ(m, 'blue', e.target.checked)} className="rounded border-slate-600" />
                NJ (chop) — Blue
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer text-xs text-red-400 font-semibold">
                <input type="checkbox" checked={m.nj_call === 'red' || m.nj_call === 'both'} onChange={e => setMatchNJ(m, 'red', e.target.checked)} className="rounded border-slate-600" />
                NJ (chop) — Red
              </label>
            </div>
            {!!m.nj_call && (
              <p className="mt-1 text-xs text-amber-400">
                {m.nj_call === 'both'
                  ? 'Both past chop: speed tied — credited 3 / 3, Overall Judge splits 4.'
                  : `Chop violation: speed override active — ${m.nj_call === 'blue' ? 'Blue 0 / Red 5' : 'Blue 5 / Red 0'} (Time Judge's entry recorded as evidence).`}
              </p>
            )}
          </>
        )}

        {/* Paper mode: Enter / Edit Scores. v1.16.17 -- Edit Scores also available for completed tablet-mode matches.
            Disabled once the event is finalized (status='complete') because editing past finalization would
            silently desync events.dual_bracket_review_status (locked at 'approved') from underlying scores.
            TODO: Add a deliberate "edit finalized event" path in the Admin panel that re-opens the event
            (status -> 'in_progress', review_status -> NULL) under an audit-logged admin action. */}
        {m.registration_id_blue && m.registration_id_red && isDone && event.status !== 'complete' && (
          <div className="mt-3 pt-2 border-t border-slate-700">
            <button
              onClick={() => setPaperModal({ match: m, existingPoints: ptData?.result?.breakdown?.length === 5 ? ptData.result.breakdown : null })}
              className="btn-ghost text-sm text-blue-400 border-blue-800 hover:bg-blue-900/20 w-full"
            >
              Edit Scores
            </button>
          </div>
        )}
        {isPaper && m.registration_id_blue && m.registration_id_red && !isDone && (
          <div className="mt-3 pt-2 border-t border-slate-700">
            <button
              onClick={() => setPaperModal({ match: m, existingPoints: null })}
              className="btn-primary w-full text-sm"
            >
              Enter Scores
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* v1.25.00 (E-1) -- broadcast overlay hide/show */}
      <div className="flex justify-start">
        <OverlayControl eventId={event.id} />
      </div>
      {/* v1.16.17 -- Bracket review status banners */}
      {reviewStatus === 'sent_back' && (
        <div className="card border-amber-700 bg-amber-900/10 flex items-center justify-between gap-4">
          <div>
            <div className="text-amber-400 font-bold text-sm">Head Judge requested score edits</div>
            <div className="text-slate-300 text-xs mt-0.5">
              Edit any match scores below using the "Edit Scores" buttons, then resend to Head Judge for approval.
            </div>
          </div>
          <button
            onClick={resendToHj}
            disabled={resending}
            className="btn-primary text-sm whitespace-nowrap disabled:opacity-50"
          >
            {resending ? 'Resending...' : 'Resend to HJ for Approval'}
          </button>
        </div>
      )}
      {reviewStatus === 'pending' && (
        <div className="card border-blue-700 bg-blue-900/10">
          <div className="text-blue-400 font-bold text-sm">Bracket complete -- sent to Head Judge</div>
          <div className="text-slate-300 text-xs mt-0.5">
            Awaiting Head Judge final approval. The Head Judge can approve to finalize the event or send the bracket back here for score edits.
          </div>
        </div>
      )}

      {/* Round header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg text-white">
            {allDone ? 'Event Complete' : (isConsol ? roundLabel(activeRoundNum, true) : roundLabel(activeRoundNum))}
          </h3>
          {!allDone && <p className="text-slate-500 text-sm mt-0.5">
            {pendingMatches.length} match{pendingMatches.length !== 1 ? 'es' : ''} remaining in this round
          </p>}
        </div>
        <button onClick={load} className="btn-ghost text-sm">Refresh</button>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {msg && <p className="text-green-400 text-sm">{msg}</p>}

      {allDone && (
        <div className="card text-center py-8 text-green-400 font-semibold">
          All rounds complete.  View final standings on the Results tab.
        </div>
      )}

      {/* Active match (tablet mode only) */}
      {!isPaper && activeMatch && (
        <div className="space-y-2">
          <div className="text-xs text-blue-400 uppercase tracking-wide font-semibold">Currently Scoring</div>
          <MatchRow m={activeMatch} highlight={false} showStart={false} />
        </div>
      )}

      {/* Up Next */}
      {nextMatch && (!activeMatch || isPaper) && (
        <div className="space-y-2">
          <div className="text-xs text-white uppercase tracking-wide font-semibold">Up Next</div>
          <MatchRow m={nextMatch} highlight={true} showStart={!isPaper} />
        </div>
      )}
      {nextMatch && activeMatch && !isPaper && (
        <div className="space-y-2">
          <div className="text-xs text-white uppercase tracking-wide font-semibold">Up Next</div>
          <MatchRow m={nextMatch} highlight={true} showStart={false} />
        </div>
      )}

      {/* On Deck (2 more) */}
      {onDeckMatches.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-slate-400 uppercase tracking-wide font-semibold">On Deck</div>
          {onDeckMatches.map(m => <MatchRow key={m.id} m={m} highlight={false} showStart={false} />)}
        </div>
      )}

      {/* Remaining */}
      {remainingMatches.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-slate-500 uppercase tracking-wide font-semibold">
            Remaining <span className="ml-1 bg-slate-800 text-slate-500 rounded-full px-2 py-0.5">{remainingMatches.length}</span>
          </div>
          <div className="space-y-2">
            {remainingMatches.map(m => <MatchRow key={m.id} m={m} highlight={false} showStart={false} />)}
          </div>
        </div>
      )}

      {/* Completed in this round */}
      {completedMatches.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-slate-500 uppercase tracking-wide font-semibold">
            Completed <span className="ml-1 bg-slate-800 text-slate-500 rounded-full px-2 py-0.5">{completedMatches.length}</span>
          </div>
          <div className="space-y-2">
            {completedMatches.map(m => <MatchRow key={m.id} m={m} highlight={false} showStart={false} />)}
          </div>
        </div>
      )}

      {/* Round complete prompt */}
      {roundAllComplete && !allDone && (
        <div className="card text-center py-6 border border-green-800 bg-green-900/10">
          <div className="text-green-400 font-semibold mb-2">Round Complete</div>
          <p className="text-slate-400 text-sm">All matches in this round are finished.  Refresh to advance to the next round.</p>
          <button onClick={load} className="btn-primary mt-3">Advance to Next Round</button>
        </div>
      )}

      {/* Paper Score Modal */}
      {paperModal && (
        <DualPaperScoreModal
          event={event}
          match={paperModal.match}
          existingPoints={paperModal.existingPoints}
          onClose={() => {
            if (paperModal.manualEntry) cancelManualEntry()
            setPaperModal(null)
          }}
          onSuccess={() => { setPaperModal(null); load() }}
        />
      )}
    </div>
  )
}

// ── Dual Paper Score Modal ───────────────────────────────────────────────────
function DualPaperScoreModal({ event, match, existingPoints, onClose, onSuccess }) {
  const JUDGE_LABELS = ['J1 Turns', 'J2 Turns', 'J3 Air', 'J4 Time', 'J5 Overall']

  const initScores = () => {
    if (existingPoints && existingPoints.length === 5) {
      const sorted = [...existingPoints].sort((a, b) => a.judgeNumber - b.judgeNumber)
      return sorted.map(j => ({
        blue: j.bluePoints != null ? String(j.bluePoints) : '',
        red: j.redPoints != null ? String(j.redPoints) : '',
      }))
    }
    return Array.from({ length: 5 }, () => ({ blue: '', red: '' }))
  }

  const [scores, setScores] = useState(initScores)
  const [timeTied, setTimeTied] = useState(
    existingPoints ? existingPoints.some(j => j.timeTied) : false
  )
  // v1.29.00 (FS-18 / JH 6304.3.5.1) -- NJ (past chop) flags + Air Tied
  const [njBlue, setNjBlue] = useState(match.nj_call === 'blue' || match.nj_call === 'both')
  const [njRed, setNjRed] = useState(match.nj_call === 'red' || match.nj_call === 'both')
  const [airTied, setAirTied] = useState(
    existingPoints ? existingPoints.some(j => j.airTied) : false
  )
  const [error, setError] = useState('')
  const [saving, setSaving] = useState('')

  const njCall = njBlue && njRed ? 'both' : njBlue ? 'blue' : njRed ? 'red' : null
  // A single NJ overrides a time-tied entry (match is NOT speed tied)
  const speedTied = njCall === 'both' || (timeTied && !njCall)
  const overallScale = 5 - (speedTied ? 1 : 0) - (airTied ? 1 : 0)

  // Auto-complement: entering one side fills the other.
  // J4 (idx 3) is 0/0 when time tied; J3 (idx 2) is 0/0 when air tied;
  // J5 (idx 4) splits the computed overall scale (5 / 4 / 3).
  const maxPts = (idx) =>
    (timeTied && idx === 3) ? 0
    : (airTied && idx === 2) ? 0
    : (idx === 4) ? overallScale
    : 5

  const updateScore = (idx, side, val) => {
    setScores(prev => {
      const next = prev.map((s, i) => i === idx ? { ...s } : { ...s })
      const max = maxPts(idx)
      const num = val === '' ? '' : parseInt(val, 10)

      if (num === '' || isNaN(num)) {
        next[idx][side] = val
      } else {
        const clamped = Math.max(0, Math.min(max, num))
        next[idx][side] = String(clamped)
        const other = side === 'blue' ? 'red' : 'blue'
        next[idx][other] = String(max - clamped)
      }
      return next
    })
  }

  // When a tie state changes, reset the tied judge's row and re-clamp J5 to
  // the new overall scale
  useEffect(() => {
    setScores(prev => {
      const next = prev.map(s => ({ ...s }))
      if (timeTied) next[3] = { blue: '0', red: '0' }
      else if (prev[3].blue === '0' && prev[3].red === '0') next[3] = { blue: '', red: '' }
      if (airTied) next[2] = { blue: '0', red: '0' }
      else if (prev[2].blue === '0' && prev[2].red === '0') next[2] = { blue: '', red: '' }
      const b5 = parseInt(next[4].blue, 10)
      if (!isNaN(b5)) {
        const clamped = Math.max(0, Math.min(overallScale, b5))
        next[4] = { blue: String(clamped), red: String(overallScale - clamped) }
      }
      return next
    })
  }, [timeTied, airTied, overallScale])

  // Raw entered totals (what the judges wrote down)
  const blueTotal = scores.reduce((sum, s) => sum + (parseInt(s.blue, 10) || 0), 0)
  const redTotal = scores.reduce((sum, s) => sum + (parseInt(s.red, 10) || 0), 0)
  // Effective totals after the NJ override + tie credits (decides the winner):
  // J4 pays 0/5, 5/0 or 3/3 under NJ / speed tie; J3 pays 0/0 when air tied.
  const effSide = (side) => scores.reduce((sum, s, i) => {
    let v = parseInt(s[side], 10) || 0
    if (i === 3) {
      if (njCall === 'blue') v = side === 'blue' ? 0 : 5
      else if (njCall === 'red') v = side === 'red' ? 0 : 5
      else if (speedTied) v = 3
    }
    if (i === 2 && airTied) v = 0
    return sum + v
  }, 0)
  const effBlueTotal = effSide('blue')
  const effRedTotal = effSide('red')
  const overrideActive = !!njCall || speedTied || airTied
  // Effective distributed total: 25 normally, 25 speed-tied (3/3 pays 6),
  // 19 when air is tied (6 votes withheld) -- always odd, tie impossible
  const maxTotal = airTied ? 19 : 25

  const submitScores = async () => {
    setError('')
    // Validate all 5 judges filled
    for (let i = 0; i < 5; i++) {
      if (scores[i].blue === '' || scores[i].red === '') {
        setError(`${JUDGE_LABELS[i]}: both scores required`)
        return
      }
    }
    setSaving('score')
    try {
      const body = {
        judges: scores.map((s, i) => ({
          judge_number: i + 1,
          blue_points: parseInt(s.blue, 10),
          red_points: parseInt(s.red, 10),
        })),
        time_tied: timeTied,
        air_tied: airTied,
        nj_blue: njBlue,
        nj_red: njRed,
      }
      const res = await fetch(`/api/events/${event.id}/dual/${match.id}/paper-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to submit scores')
      onSuccess()
    } catch (e) { setError(e.message) }
    finally { setSaving('') }
  }

  const submitStatus = async (winnerId, status) => {
    setError('')
    setSaving(status)
    try {
      const res = await fetch(`/api/events/${event.id}/dual/${match.id}/paper-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ winner_registration_id: winnerId, loser_status: status, nj_blue: njBlue, nj_red: njRed }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      onSuccess()
    } catch (e) { setError(e.message) }
    finally { setSaving('') }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-lg shadow-xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-display text-lg text-white">{existingPoints ? 'Edit Match Scores' : 'Enter Match Scores'}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl leading-none">&times;</button>
        </div>

        {/* Athlete names */}
        <div className="grid grid-cols-5 gap-2 mb-4">
          <div className="col-span-2 p-3 rounded-lg bg-blue-900/30 border border-blue-800 text-center">
            <div className="text-xs text-blue-400 font-semibold mb-1">Blue</div>
            <div className="text-sm text-white font-semibold">{match.blue_last}, {match.blue_first}</div>
            {match.blue_bib && <div className="text-xs text-slate-500">Bib {match.blue_bib}</div>}
          </div>
          <div className="flex items-center justify-center text-slate-600 font-bold">vs</div>
          <div className="col-span-2 p-3 rounded-lg bg-red-900/30 border border-red-800 text-center">
            <div className="text-xs text-red-400 font-semibold mb-1">Red</div>
            <div className="text-sm text-white font-semibold">{match.red_last}, {match.red_first}</div>
            {match.red_bib && <div className="text-xs text-slate-500">Bib {match.red_bib}</div>}
          </div>
        </div>

        {/* Judge score rows */}
        <div className="space-y-2 mb-4">
          <div className="grid grid-cols-[1fr_60px_60px] gap-2 text-xs text-slate-500 font-semibold px-1">
            <div>Judge</div>
            <div className="text-center text-blue-400">Blue</div>
            <div className="text-center text-red-400">Red</div>
          </div>
          {JUDGE_LABELS.map((label, idx) => {
            const disabled = (idx === 3 && timeTied) || (idx === 2 && airTied)
            return (
              <div key={idx} className={`grid grid-cols-[1fr_60px_60px] gap-2 items-center px-1 py-1.5 rounded ${
                disabled ? 'opacity-40' : ''
              }`}>
                <div className="text-sm text-slate-300">{label}</div>
                <input
                  type="number"
                  min="0"
                  max={maxPts(idx)}
                  className="input text-center font-mono text-sm py-1"
                  value={scores[idx].blue}
                  onChange={e => updateScore(idx, 'blue', e.target.value)}
                  disabled={disabled || !!saving}
                />
                <input
                  type="number"
                  min="0"
                  max={maxPts(idx)}
                  className="input text-center font-mono text-sm py-1"
                  value={scores[idx].red}
                  onChange={e => updateScore(idx, 'red', e.target.value)}
                  disabled={disabled || !!saving}
                />
              </div>
            )
          })}
        </div>

        {/* Time Tied / Air Tied checkboxes */}
        <div className="flex items-center gap-6 mb-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={timeTied}
              onChange={e => setTimeTied(e.target.checked)}
              disabled={!!saving}
              className="rounded border-slate-600"
            />
            <span className="text-sm text-amber-400 font-semibold">Time Tied</span>
            <span className="text-xs text-slate-500">(J4 records 0/0, credited 3/3)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={airTied}
              onChange={e => setAirTied(e.target.checked)}
              disabled={!!saving}
              className="rounded border-slate-600"
            />
            <span className="text-sm text-amber-400 font-semibold">Air Tied</span>
            <span className="text-xs text-slate-500">(J3 = 0/0, votes withheld)</span>
          </label>
        </div>

        {/* v1.29.00 (FS-18) -- NJ (past chop) checkboxes */}
        <div className="flex items-center gap-6 mb-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={njBlue}
              onChange={e => setNjBlue(e.target.checked)}
              disabled={!!saving}
              className="rounded border-slate-600"
            />
            <span className="text-sm text-blue-400 font-semibold">NJ (chop) — Blue</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={njRed}
              onChange={e => setNjRed(e.target.checked)}
              disabled={!!saving}
              className="rounded border-slate-600"
            />
            <span className="text-sm text-red-400 font-semibold">NJ (chop) — Red</span>
          </label>
        </div>
        {njCall && (
          <p className="text-xs text-amber-400 mb-2">
            {njCall === 'both'
              ? 'Both past chop: speed tied — J4 credited 3 / 3, J5 splits ' + overallScale + '.'
              : `Chop violation: J4's recorded entry is kept but overridden to ${njCall === 'blue' ? 'Blue 0 / Red 5' : 'Blue 5 / Red 0'}.`}
          </p>
        )}
        <div className="mb-4 text-xs text-slate-500">J5 Overall splits {overallScale} point{overallScale !== 1 ? 's' : ''}.</div>

        {/* Running totals (effective — decides the winner) */}
        <div className="flex items-center justify-center gap-6 mb-1 py-3 rounded-lg bg-slate-800 border border-slate-700">
          <span className={`text-lg font-bold font-mono ${effBlueTotal > effRedTotal ? 'text-blue-300' : 'text-slate-400'}`}>
            {effBlueTotal}
          </span>
          <span className="text-slate-600 text-sm">/ {maxTotal}</span>
          <span className={`text-lg font-bold font-mono ${effRedTotal > effBlueTotal ? 'text-red-300' : 'text-slate-400'}`}>
            {effRedTotal}
          </span>
        </div>
        {overrideActive && (
          <div className="text-center text-xs text-slate-500 mb-3">
            Effective totals (NJ / tie credits applied). Entered: {blueTotal} / {redTotal}.
          </div>
        )}
        {!overrideActive && <div className="mb-3" />}

        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

        {/* Submit */}
        <button
          onClick={submitScores}
          disabled={!!saving}
          className="btn-primary w-full mb-4 disabled:opacity-40"
        >
          {saving === 'score' ? 'Saving...' : existingPoints ? 'Update Scores' : 'Submit Scores'}
        </button>

        {/* DNS/DNF/DSQ */}
        <div className="border-t border-slate-700 pt-3">
          <div className="text-xs text-slate-500 mb-2">Mark athlete status (wins match for the other athlete):</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="text-xs text-blue-400 font-semibold text-center mb-1">{match.blue_first} {match.blue_last}</div>
              {['DNS', 'DNF', 'DSQ'].map(st => (
                <button
                  key={`blue-${st}`}
                  onClick={() => submitStatus(match.registration_id_red, st)}
                  disabled={!!saving}
                  className="w-full text-xs py-1.5 rounded border border-slate-700 text-slate-400 hover:text-red-400 hover:border-red-800 disabled:opacity-40"
                >
                  {saving === st ? '...' : `${st}`}
                </button>
              ))}
            </div>
            <div className="space-y-1">
              <div className="text-xs text-red-400 font-semibold text-center mb-1">{match.red_first} {match.red_last}</div>
              {['DNS', 'DNF', 'DSQ'].map(st => (
                <button
                  key={`red-${st}`}
                  onClick={() => submitStatus(match.registration_id_blue, st)}
                  disabled={!!saving}
                  className="w-full text-xs py-1.5 rounded border border-slate-700 text-slate-400 hover:text-red-400 hover:border-red-800 disabled:opacity-40"
                >
                  {saving === st ? '...' : `${st}`}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Scoring Panel ─────────────────────────────────────────────────────────────
function ScoringPanel({ event, registrations }) {
  const [activeRun, setActiveRun]               = useState(null)
  const [runs,      setRuns]                    = useState([])
  const [dupWarn,   setDupWarn]                 = useState(false)
  const [form,      setForm]                    = useState({ registration_id:'', run_number:1, run_time:'' })
  const [error,     setError]                   = useState('')
  const [saving,    setSaving]                  = useState(false)
  const [undoing,   setUndoing]                 = useState(false)
  const [reopening, setReopening]               = useState(false)
  const [canceling, setCanceling]               = useState(false)
  const [alreadyExpanded, setAlreadyExpanded]   = useState(false)
  const [manualModal, setManualModal]           = useState(null)
  const [voiceModal,  setVoiceModal]            = useState(null) // v1.20.00 -- { mode:'paper'|'tablet', registration?, run?, runNumber }
  const [phases,    setPhases]                  = useState([])
  const [phaseEligible, setPhaseEligible]       = useState(null)
  const [activePhase, setActivePhase]           = useState(null)
  const [expandedPhases, setExpandedPhases]     = useState({}) // { phaseId: true/false }
  const [phaseEligibleMap, setPhaseEligibleMap] = useState({}) // { phaseId: [...athletes] }
  const wsRef = useRef(null)

  const isPaper  = event.score_entry_mode === 'paper'
  const active   = registrations.filter(r => r.status === 'registered')

  const loadAll = async () => {
    const [r, a, p] = await Promise.all([
      api.getRuns(event.id),
      api.getActiveRun(event.id),
      api.getPhaseStatus(event.id).catch(() => []),
    ])
    setRuns(r)
    setActiveRun(a && !a.event_completed ? a : null)
    setPhases(p)

    // Find the active phase (first non-finalized, or last finalized if all done)
    if (p.length > 0) {
      const activeP = p.find(ph => ph.status !== 'finalized') || p[p.length - 1]
      setActivePhase(activeP)
      // Load eligible athletes for the active phase
      try {
        const eligible = await api.getPhaseEligible(event.id, activeP.id)
        setPhaseEligible(eligible)
      } catch { setPhaseEligible(null) }
      // Set form run_number to active phase's run_number
      setForm(f => ({ ...f, run_number: activeP.run_number }))

      // Load eligible athletes for all phases (for collapsible view)
      const eligMap = {}
      for (const ph of p) {
        try {
          const elig = await api.getPhaseEligible(event.id, ph.id)
          eligMap[ph.id] = elig
        } catch { eligMap[ph.id] = [] }
      }
      setPhaseEligibleMap(eligMap)
      // Auto-expand the active phase
      setExpandedPhases(prev => {
        const next = {}
        for (const ph of p) next[ph.id] = (ph.id === activeP.id)
        // Preserve any manually toggled states
        for (const id of Object.keys(prev)) {
          if (prev[id] !== undefined && p.find(ph => ph.id === id)) next[id] = prev[id]
        }
        // But always ensure the active phase is expanded on first load
        if (prev[activeP.id] === undefined) next[activeP.id] = true
        return next
      })
    } else {
      setActivePhase(null)
      setPhaseEligible(null)
      setPhaseEligibleMap({})
    }
  }

  // Determine which athletes to show and their order
  const hasPhases = phases.length > 0
  const eligibleAthletes = hasPhases && phaseEligible
    ? phaseEligible.map(pe => {
        const reg = active.find(r => r.id === pe.registration_id)
        return reg ? { ...reg, run_order: pe.run_order } : null
      }).filter(Boolean)
    : active

  const hasOrder = eligibleAthletes.some(r => r.run_order != null)

  const currentRunNumber = activePhase ? activePhase.run_number : (parseInt(form.run_number) || 1)
  const currentLabel = activePhase ? activePhase.label : `Run ${currentRunNumber}`

  useEffect(() => {
    loadAll()
    const ws = createWebSocket(event.id, msg => { if (['score_update','run_updated','phase_created','phase_deleted','run_round_status'].includes(msg.type)) loadAll() })
    wsRef.current = ws
    return () => ws.close()
  }, [event.id])

  const startForerunner = async () => {
    setSaving(true); setError('')
    try {
      await api.startForerunner(event.id)
      await loadAll()
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  const startRun = async (regId) => {
    const rid = regId || form.registration_id
    if (!rid) { setError('Select an athlete'); return }

    // Check if athlete already has a completed run for this run_number
    const existingCompleted = runs.find(r => r.registration_id === rid && r.run_number === currentRunNumber && r.status === 'complete')
    if (existingCompleted) {
      if (!confirm(`This athlete already has a completed run for ${currentLabel}.  Start another run?`)) return
    }

    setSaving(true); setError(''); setDupWarn(false)
    try {
      const result = await api.createRun(event.id, {
        registration_id: rid,
        run_number: currentRunNumber,
        round: 'qualification',
      })
      if (result.duplicate_jumps) setDupWarn(true)
      setForm(f => ({ ...f, run_time:'' }))
      await loadAll()
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  const submitTime = async () => {
    if (!activeRun || !form.run_time) return
    try { await api.updateRun(event.id, activeRun.id, { run_time: parseFloat(form.run_time) }); await loadAll() }
    catch (err) { setError(err.message) }
  }

  const undoLastScore = async () => {
    if (!activeRun) return
    setUndoing(true); setError('')
    try { await api.undoLastScore(event.id, activeRun.id); await loadAll() }
    catch (err) { setError(err.message) }
    finally { setUndoing(false) }
  }

  const reopenRun = async (runId) => {
    if (!confirm('Reopen this completed run for rescoring?  Existing scores will be preserved.')) return
    setReopening(true); setError('')
    try { await api.reopenRun(event.id, runId); await loadAll() }
    catch (err) { setError(err.message) }
    finally { setReopening(false) }
  }

  const cancelRun = async () => {
    if (!activeRun) return
    if (!confirm('Cancel this run?  This will delete the run entirely.  This cannot be undone.')) return
    setCanceling(true); setError('')
    try { await api.deleteRun(event.id, activeRun.id); await loadAll() }
    catch (err) { setError(err.message) }
    finally { setCanceling(false) }
  }

  // Compute run order sections - filter by current run_number for phase-aware display
  const runsForPhase = runs.filter(r => r.run_number === currentRunNumber)
  const completedIds = new Set(runsForPhase.filter(r => r.status === 'complete').map(r => r.registration_id))
  const scoringIds   = new Set(runsForPhase.filter(r => r.status === 'scoring').map(r => r.registration_id))

  const sortedEligible = [...eligibleAthletes].sort((a, b) => (a.run_order || 999) - (b.run_order || 999))
  const alreadyRun = hasOrder ? sortedEligible.filter(r => completedIds.has(r.id) && !scoringIds.has(r.id)) : []
  const remaining  = hasOrder ? sortedEligible.filter(r => !completedIds.has(r.id) && !scoringIds.has(r.id)) : []
  const upNext     = remaining.slice(0, 3)
  const afterNext  = remaining.slice(3)

  return (
    <div className="space-y-6">

      {/* v1.20.00 -- Voice Manual Entry batch trigger (paper-mode-friendly bib confirmation flow) */}
      {/* v1.25.00 (C-7/F-2) -- voice hidden on aerials: voice does not support aerials scoring */}
      <div className="flex justify-between items-center">
        <OverlayControl eventId={event.id} />
        {event.discipline !== 'dual_mogul' && event.discipline !== 'aerials' ? (
          <button
            onClick={() => setVoiceModal({ mode: 'paper', runNumber: currentRunNumber })}
            className="text-xs px-3 py-1.5 rounded-lg bg-mountain-600 hover:bg-mountain-500 text-white font-semibold shadow"
            title="Open voice-driven manual entry with bib confirmation"
          >
            🎙 Voice Manual Entry
          </button>
        ) : <span />}
      </div>

      {/* Active run */}
      {activeRun && (
        <div className={`card border ${activeRun.is_forerunner ? 'border-orange-700 bg-orange-900/10' : 'border-blue-800 bg-blue-900/10'}`}>
          <div className="flex items-start justify-between">
            <div>
              <div className={`text-xs uppercase tracking-wide mb-1 ${activeRun.is_forerunner ? 'text-orange-400' : 'text-blue-400'}`}>
                {activeRun.is_forerunner ? 'Forerunner (Judge Test)' : 'Currently Scoring'}
              </div>
              <div className="text-2xl font-bold text-white">{activeRun.first_name} {activeRun.last_name}</div>
              <div className="text-sm text-slate-400 mt-1 flex flex-wrap gap-3">
                {!activeRun.is_forerunner && <span>Bib #{activeRun.bib_number}</span>}
                {activeRun.run_position != null && activeRun.total_runners != null && (
                  <span className="text-slate-200">Athlete {activeRun.run_position} of {activeRun.total_runners}</span>
                )}
                {activeRun.jump1_code && <span>J1: <strong className="text-white">{activeRun.jump1_code}</strong> (DD {activeRun.jump1_dd})</span>}
                {activeRun.jump2_code && <span>J2: <strong className="text-white">{activeRun.jump2_code}</strong> (DD {activeRun.jump2_dd})</span>}
              </div>
              {dupWarn && (
                <div className="mt-2 text-xs text-amber-400 bg-amber-900/20 border border-amber-800 rounded px-3 py-1.5">
                  Duplicate jump codes detected -- Jump 2 receives DD 0.00 (no credit for repeated jump).
                </div>
              )}
            </div>
            {!isPaper && (
              <div className="text-right">
                <div className="text-xs text-slate-500 mb-2">Scores received</div>
                <div className="flex gap-1 flex-wrap justify-end">
                  {(activeRun.submitted || []).map(s => (
                    <span key={s.role+s.score_type} className="text-xs bg-green-900/40 text-green-400 border border-green-800 rounded px-2 py-0.5">
                      {s.role}
                    </span>
                  ))}
                  {!(activeRun.submitted || []).length && <span className="text-xs text-slate-600">Waiting for judges...</span>}
                </div>
              </div>
            )}
            {isPaper && (
              <div className="text-right">
                <span className="text-xs text-amber-400 bg-amber-900/20 border border-amber-800 rounded px-2 py-1">Paper Entry</span>
              </div>
            )}
          </div>
          {/* Undo Last Score / Cancel Run */}
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={cancelRun}
              disabled={canceling || (!activeRun.is_forerunner && activeRun.submitted && activeRun.submitted.length > 0)}
              title={!activeRun.is_forerunner && activeRun.submitted && activeRun.submitted.length > 0 ? 'Cannot cancel: scores already submitted' : 'Cancel this run (no scores submitted)'}
              className="btn-ghost text-xs text-red-400 border-red-800 hover:bg-red-900/20 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {canceling ? 'Canceling...' : 'Cancel Run'}
            </button>
            <button
              onClick={undoLastScore}
              disabled={undoing || !(activeRun.submitted && activeRun.submitted.length > 0)}
              className="btn-ghost text-xs text-amber-400 border-amber-800 hover:bg-amber-900/20 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {undoing ? 'Undoing...' : 'Undo Last Score'}
            </button>
            {event.discipline !== 'dual_mogul' && (
              <button
                onClick={() => setManualModal({ mode: 'edit', run: activeRun, runNumber: currentRunNumber })}
                className="btn-ghost text-xs text-blue-400 border-blue-800 hover:bg-blue-900/20"
              >
                Manual Entry
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Phase sections (collapsible per phase) ── */}
      {hasPhases && phases.length > 1 ? (
        <div className="space-y-3">
          {phases.map(ph => {
            const isActive = activePhase && ph.id === activePhase.id
            const isExpanded = expandedPhases[ph.id] || false
            const phEligible = phaseEligibleMap[ph.id] || []
            const phAthletes = phEligible.map(pe => {
              const reg = active.find(r => r.id === pe.registration_id)
              return reg ? { ...reg, run_order: pe.run_order } : null
            }).filter(Boolean)
            const phRuns = runs.filter(r => r.run_number === ph.run_number)
            const phCompletedIds = new Set(phRuns.filter(r => r.status === 'complete').map(r => r.registration_id))
            const phScoringIds = new Set(phRuns.filter(r => r.status === 'scoring').map(r => r.registration_id))
            const phSorted = [...phAthletes].sort((a, b) => (a.run_order || 999) - (b.run_order || 999))
            const phDone = phSorted.filter(r => phCompletedIds.has(r.id) && !phScoringIds.has(r.id))
            const phRemaining = phSorted.filter(r => !phCompletedIds.has(r.id) && !phScoringIds.has(r.id))

            const statusColor = ph.status === 'finalized' ? 'text-purple-400' :
                                ph.status === 'complete' ? 'text-emerald-400' :
                                ph.status === 'in_progress' ? 'text-blue-400' : 'text-slate-500'

            return (
              <div key={ph.id} className={`card ${isActive ? 'border-blue-700' : 'border-slate-800'}`}>
                <button
                  onClick={() => setExpandedPhases(prev => ({ ...prev, [ph.id]: !prev[ph.id] }))}
                  className="w-full flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <span className={`text-lg transition-transform ${isExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
                    <span className="font-display text-lg text-white">{ph.label}</span>
                    <span className={`text-xs font-semibold ${statusColor}`}>{ph.status === 'finalized' ? 'Finalized' : ph.status === 'complete' ? 'Complete' : ph.status === 'in_progress' ? 'In Progress' : 'Not Started'}</span>
                    <span className="text-xs text-slate-500">{phDone.length}/{phSorted.length} complete</span>
                  </div>
                  <span className="text-slate-500 text-sm">{isExpanded ? '▼' : '▶'}</span>
                </button>

                {isExpanded && (
                  <div className="mt-3 space-y-4">
                    {/* Active phase: show Up Next / Remaining / Already Run */}
                    {isActive && phRemaining.length > 0 && (
                      <div>
                        <div className="font-semibold text-white mb-2 text-sm">Up Next</div>
                        <div className="space-y-2">
                          {phRemaining.slice(0, 3).map((r, idx) => (
                            <div key={r.id}
                              className={`flex items-center gap-3 px-3 py-3 rounded-xl border ${
                                idx === 0 ? 'border-blue-600 bg-blue-900/20' : 'border-slate-700 bg-slate-800/40'
                              }`}
                            >
                              <span className={`font-mono text-sm w-6 text-center ${idx===0 ? 'text-blue-400' : 'text-slate-600'}`}>{r.run_order}</span>
                              <span className="font-mono text-slate-400 text-sm w-8">#{r.bib_number}</span>
                              <span className={`font-semibold flex-1 ${idx===0 ? 'text-white text-lg' : 'text-slate-300'}`}>
                                {r.last_name}, {r.first_name}
                              </span>
                              <div className="flex gap-2 items-center">
                                {idx === 0 && (
                                  <button
                                    onClick={() => startRun(r.id)}
                                    disabled={saving || (!isPaper && !!activeRun)}
                                    className="btn-primary text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                                  >
                                    {saving ? 'Starting...' : (!isPaper && activeRun) ? 'Run in progress' : 'Start Run'}
                                  </button>
                                )}
                                {idx === 0 && event.discipline !== 'dual_mogul' && (
                                  <button
                                    onClick={async () => {
                                      if (!window.confirm(`Mark ${r.last_name}, ${r.first_name} as DNS?`)) return;
                                      try {
                                        await api.manualEntry(event.id, { registration_id: r.id, run_number: ph.run_number, round: 'qualification', run_status: 'DNS' });
                                        loadAll();
                                      } catch (err) { alert('DNS failed: ' + err.message); }
                                    }}
                                    className="text-xs px-3 py-1.5 rounded-lg bg-yellow-500 hover:bg-yellow-600 text-black font-semibold transition-colors"
                                  >
                                    DNS
                                  </button>
                                )}
                                {event.discipline !== 'dual_mogul' && (
                                  <button
                                    onClick={() => setManualModal({ mode: 'entry', registration: r, runNumber: ph.run_number })}
                                    className="text-xs px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors"
                                  >
                                    Manual Entry
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                        {phRemaining.length > 3 && (
                          <div className="mt-2 space-y-0.5">
                            <div className="font-semibold text-slate-400 text-sm mb-1">
                              Remaining <span className="text-xs bg-slate-800 text-slate-500 rounded-full px-2 py-0.5">{phRemaining.length - 3}</span>
                            </div>
                            {phRemaining.slice(3).map(r => (
                              <div key={r.id} className="flex items-center gap-3 px-2 py-1.5 text-sm">
                                <span className="font-mono text-slate-700 w-6 text-right">{r.run_order}</span>
                                <span className="font-mono text-slate-600 w-8">#{r.bib_number}</span>
                                <span className="text-slate-500 flex-1">{r.last_name}, {r.first_name}</span>
                                {event.discipline !== 'dual_mogul' && (
                                  <button
                                    onClick={() => setManualModal({ mode: 'entry', registration: r, runNumber: ph.run_number })}
                                    className="text-xs px-2 py-1 rounded border border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600 transition-colors"
                                  >
                                    Manual Entry
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Completed athletes for this phase */}
                    {phDone.length > 0 && (
                      <div>
                        <div className="font-semibold text-slate-400 text-sm mb-1">
                          {isActive ? 'Already Run' : 'Athletes'}
                          <span className="ml-2 text-xs bg-slate-700 text-slate-400 rounded-full px-2 py-0.5">{phDone.length}</span>
                        </div>
                        <div className="space-y-0.5">
                          {phDone.map(r => {
                            const phRun = phRuns.find(run => run.registration_id === r.id && run.status === 'complete')
                            return (
                              <div key={r.id} className="flex items-center gap-3 px-2 py-1.5 rounded bg-slate-800/40 text-sm">
                                <span className="font-mono text-slate-600 w-6 text-right">{r.run_order}</span>
                                <span className="font-mono text-slate-500 w-8">#{r.bib_number}</span>
                                <span className="text-slate-400 flex-1">{r.last_name}, {r.first_name}</span>
                                {phRun && phRun.total_score != null && (
                                  <span className="font-mono text-slate-300 text-xs">{Number(phRun.total_score).toFixed(2)}</span>
                                )}
                                {phRun && phRun.run_status && (
                                  <span className="text-xs text-red-400">{phRun.run_status}</span>
                                )}
                                {!phRun?.run_status && <span className="text-green-500 text-xs">Done</span>}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {phRemaining.length === 0 && phDone.length > 0 && isActive && (
                      <div className="text-center py-3 text-green-400 font-semibold text-sm">All athletes have completed {ph.label}.</div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        /* Single phase or no phases: show flat run-order sections */
        hasOrder && (
          <div className="space-y-4">
            {/* Already Run */}
            {alreadyRun.length > 0 && (
              <div className="card border border-slate-700">
                <button
                  onClick={() => setAlreadyExpanded(v => !v)}
                  className="w-full flex items-center justify-between"
                >
                  <span className="font-semibold text-slate-400">
                    Already Run
                    <span className="ml-2 text-xs bg-slate-700 text-slate-400 rounded-full px-2 py-0.5">{alreadyRun.length}</span>
                  </span>
                  <span className="text-slate-500 text-sm">{alreadyExpanded ? 'Hide' : 'Show'}</span>
                </button>
                {alreadyExpanded && (
                  <div className="mt-3 space-y-1">
                    {alreadyRun.map(r => (
                      <div key={r.id} className="flex items-center gap-3 px-2 py-1.5 rounded bg-slate-800/40 text-sm">
                        <span className="font-mono text-slate-600 w-6 text-right">{r.run_order}</span>
                        <span className="font-mono text-slate-500 w-8">#{r.bib_number}</span>
                        <span className="text-slate-400">{r.last_name}, {r.first_name}</span>
                        <span className="ml-auto text-green-500 text-xs">Done</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Up Next */}
            {upNext.length > 0 && (
              <div className="card border border-slate-600">
                <div className="flex items-center justify-between mb-3">
                  <div className="font-semibold text-white">Up Next</div>
                  {!runs.some(r => r.status === 'complete') && !activeRun && (
                    <button
                      onClick={startForerunner}
                      disabled={saving}
                      className="text-sm px-4 py-1.5 rounded-lg font-semibold bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Forerunner
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {upNext.map((r, idx) => (
                    <div key={r.id}
                      className={`flex items-center gap-3 px-3 py-3 rounded-xl border ${
                        idx === 0 ? 'border-blue-600 bg-blue-900/20' : 'border-slate-700 bg-slate-800/40'
                      }`}
                    >
                      <span className={`font-mono text-sm w-6 text-center ${idx===0 ? 'text-blue-400' : 'text-slate-600'}`}>{r.run_order}</span>
                      <span className="font-mono text-slate-400 text-sm w-8">#{r.bib_number}</span>
                      <span className={`font-semibold flex-1 ${idx===0 ? 'text-white text-lg' : 'text-slate-300'}`}>
                        {r.last_name}, {r.first_name}
                      </span>
                      <div className="flex gap-2 items-center">
                        {idx === 0 && (
                          <button
                            onClick={() => startRun(r.id)}
                            disabled={saving || (!isPaper && !!activeRun)}
                            className="btn-primary text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {saving ? 'Starting...' : (!isPaper && activeRun) ? 'Run in progress' : 'Start Run'}
                          </button>
                        )}
                        {idx === 0 && event.discipline !== 'dual_mogul' && (
                          <button
                            onClick={async () => {
                              if (!window.confirm(`Mark ${r.last_name}, ${r.first_name} as DNS?`)) return;
                              try {
                                await api.manualEntry(event.id, { registration_id: r.id, run_number: currentRunNumber, round: 'qualification', run_status: 'DNS' });
                                loadAll();
                              } catch (err) { alert('DNS failed: ' + err.message); }
                            }}
                            className="text-xs px-3 py-1.5 rounded-lg bg-yellow-500 hover:bg-yellow-600 text-black font-semibold transition-colors"
                          >
                            DNS
                          </button>
                        )}
                        {event.discipline !== 'dual_mogul' && (
                          <button
                            onClick={() => setManualModal({ mode: 'entry', registration: r, runNumber: currentRunNumber })}
                            className="text-xs px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors"
                          >
                            Manual Entry
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Remaining */}
            {afterNext.length > 0 && (
              <div className="card border border-slate-800">
                <div className="font-semibold text-slate-400 mb-2">
                  Remaining
                  <span className="ml-2 text-xs bg-slate-800 text-slate-500 rounded-full px-2 py-0.5">{afterNext.length}</span>
                </div>
                <div className="space-y-0.5">
                  {afterNext.map(r => (
                    <div key={r.id} className="flex items-center gap-3 px-2 py-1.5 text-sm">
                      <span className="font-mono text-slate-700 w-6 text-right">{r.run_order}</span>
                      <span className="font-mono text-slate-600 w-8">#{r.bib_number}</span>
                      <span className="text-slate-500 flex-1">{r.last_name}, {r.first_name}</span>
                      {event.discipline !== 'dual_mogul' && (
                        <button
                          onClick={() => setManualModal({ mode: 'entry', registration: r, runNumber: currentRunNumber })}
                          className="text-xs px-2 py-1 rounded border border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600 transition-colors"
                        >
                          Manual Entry
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {upNext.length === 0 && afterNext.length === 0 && alreadyRun.length > 0 && (
              <div className="card text-center py-6 text-green-400 font-semibold">All athletes have completed their run.</div>
            )}
          </div>
        )
      )}

      {/* Manual / override start form */}
      <div className="card">
        <h3 className="font-display text-lg text-white mb-4">
          {hasPhases ? `Manual Start — ${currentLabel}` : hasOrder ? 'Manual Start / Override' : 'Start New Run'}
        </h3>
        <form onSubmit={e => { e.preventDefault(); startRun() }} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Athlete</label>
              <select className="input" value={form.registration_id} onChange={e => setForm(f=>({...f,registration_id:e.target.value}))}>
                <option value="">-- Select athlete --</option>
                {(hasPhases ? eligibleAthletes : active).map(r => <option key={r.id} value={r.id}>#{r.bib_number||'?'} {r.last_name}, {r.first_name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Run #</label>
              {hasPhases ? (
                <div className="input bg-slate-800 cursor-not-allowed text-slate-400">
                  {currentLabel} (Run {currentRunNumber})
                </div>
              ) : (
                <select className="input" value={form.run_number} onChange={e => setForm(f=>({...f,run_number:e.target.value}))}>
                  <option value={1}>Run 1</option>
                  <option value={2}>Run 2</option>
                  <option value={3}>Run 3 (Super Final)</option>
                </select>
              )}
            </div>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button type="submit" disabled={saving || (!isPaper && !!activeRun)}
            className="btn-primary w-full disabled:opacity-40 disabled:cursor-not-allowed">
            {saving ? 'Starting...' : (!isPaper && activeRun) ? 'Waiting -- finish current run first' : 'Start Run'}
          </button>
        </form>
      </div>

      {/* Run history */}
      {runs.length > 0 && (
        <div className="card">
          <h3 className="font-display text-lg text-white mb-4">Run History</h3>
          <table className="data-table">
            <thead><tr>
              <th>Bib</th><th>Athlete</th><th>Run</th><th>J1</th><th>J2</th>
              <th>{event.discipline === 'aerials' ? 'Form' : 'Turns'}</th>
              <th>{event.discipline === 'aerials' ? 'Air' : 'Air'}</th>
              {event.discipline !== 'aerials' && <th>Time</th>}
              <th>{event.discipline === 'aerials' ? 'Landing' : 'Speed'}</th>
              <th className="text-right">Total</th><th>Flag</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              {runs.map(r => (
                <tr key={r.id}>
                  <td className="font-mono text-slate-400">{r.bib_number}</td>
                  <td className="text-white">{r.last_name}, {r.first_name}</td>
                  <td className="text-slate-500">{r.run_number}</td>
                  <td className="font-mono text-xs">{r.jump1_code||'--'}</td>
                  <td className="font-mono text-xs">{r.jump2_code||'--'}</td>
                  <td>{fmt1(r.turns_score)}</td>
                  <td>{fmt(r.air_score)}</td>
                  {event.discipline !== 'aerials' && <td className="font-mono text-slate-400">{r.run_time != null ? (r.run_time == -1 ? 'NT' : Number(r.run_time).toFixed(2)) : '--'}</td>}
                  <td>{fmt(r.speed_score)}</td>
                  <td className="text-right font-bold text-white">
                    {r.run_status
                      ? <span className={`text-sm font-bold px-2 py-0.5 rounded ${
                          r.run_status==='DNS' ? 'bg-slate-700 text-slate-300' :
                          r.run_status==='RNS' ? 'bg-yellow-900/60 text-yellow-400' :
                          r.run_status==='DNF' ? 'bg-amber-900/60 text-amber-400' :
                                                 'bg-red-900/60 text-red-400'
                        }`}>{r.run_status}</span>
                      : fmt(r.total_score)
                    }
                  </td>
                  <td>
                    <select
                      className="bg-slate-800 text-xs text-slate-400 rounded px-1 py-0.5 border border-slate-700 w-20"
                      value={r.run_status || ''}
                      onChange={async e => {
                        // v1.25.00 (C-6) — confirm before applying; results recompute live
                        const newVal = e.target.value || null
                        const name = `${r.first_name || ''} ${r.last_name || ''}`.trim() || `Bib ${r.bib_number}`
                        const msg = newVal
                          ? `Mark ${name} as ${newVal}? Results recompute immediately.`
                          : `Clear the ${r.run_status} status for ${name}? Their scores become live again.`
                        if (!window.confirm(msg)) { e.target.value = r.run_status || ''; return }
                        await api.setRunStatus(event.id, r.id, newVal); loadAll()
                      }}
                    >
                      <option value="">--</option>
                      <option value="DNS">DNS</option>
                      <option value="DNF">DNF</option>
                      {/* RNS soft-removed v1.26.00 — legacy stored values still
                          render and can be cleared, but can't be re-selected */}
                      {r.run_status === 'RNS' && <option value="RNS">RNS</option>}
                      <option value="DSQ">DSQ</option>
                    </select>
                  </td>
                  <td>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      r.status==='complete' && !r.hj_pending ? 'bg-green-900/40 text-green-400' :
                      r.hj_pending                           ? 'bg-amber-900/40 text-amber-400' :
                      r.status==='scoring'                   ? 'bg-blue-900/40 text-blue-400 animate-pulse' :
                                                               'bg-slate-800 text-slate-500'
                    }`}>{r.hj_pending ? 'HJ pending' : r.status}</span>
                  </td>
                  <td>
                    <div className="flex gap-2 items-center">
                      {r.status === 'complete' && !r.run_status && (
                        <button
                          onClick={() => reopenRun(r.id)}
                          disabled={reopening}
                          className="text-xs text-amber-400 hover:text-amber-300 disabled:opacity-40"
                        >
                          Reopen
                        </button>
                      )}
                      {r.status === 'complete' && event.discipline !== 'dual_mogul' && (
                        <button
                          onClick={() => setManualModal({ mode: 'edit', run: r, runNumber: r.run_number || currentRunNumber })}
                          className="text-xs text-blue-400 hover:text-blue-300"
                        >
                          Edit Score
                        </button>
                      )}
                      {isPaper && r.status === 'scoring' && event.discipline !== 'dual_mogul' && (
                        <button
                          onClick={() => setManualModal({ mode: 'edit', run: r, runNumber: r.run_number || currentRunNumber })}
                          className="text-xs text-blue-400 hover:text-blue-300"
                        >
                          Enter Score
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* v1.25.00 (C-7) -- aerials v2 events open the per-judge grid modal */}
      {manualModal && event.discipline === 'aerials' && event.aerials_panel_size != null ? (
        <AerialsV2ManualModal
          event={event}
          mode={manualModal.mode}
          run={manualModal.run || null}
          registration={manualModal.registration || null}
          runNumber={manualModal.runNumber || 1}
          onClose={() => setManualModal(null)}
          onSuccess={() => { setManualModal(null); loadAll() }}
        />
      ) : manualModal && (
        <ManualScoreModal
          event={event}
          mode={manualModal.mode}
          run={manualModal.run || null}
          registration={manualModal.registration || null}
          runNumber={manualModal.runNumber || 1}
          onClose={() => setManualModal(null)}
          onSuccess={() => { setManualModal(null); loadAll() }}
          onSwitchToVoice={(spec) => {
            // v1.20.00 -- hand off from keyboard modal to voice modal in tablet mode.
            setManualModal(null);
            setVoiceModal({ mode: 'tablet', ...spec });
          }}
        />
      )}
      {voiceModal && (
        <VoiceManualEntryModal
          event={event}
          mode={voiceModal.mode}
          registration={voiceModal.registration || null}
          run={voiceModal.run || null}
          runNumber={voiceModal.runNumber || 1}
          onClose={() => setVoiceModal(null)}
          onSuccess={() => { loadAll() }}
        />
      )}
    </div>
  )
}

// ── Print Dropdown (Results tab) ───────────────────────────────────────────────
function PrintDropdown({ event, round }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const openPdf = async (endpoint, options) => {
    setOpen(false)
    try {
      const res = await fetch(`/api/pdf/${endpoint}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body:    JSON.stringify({ eventId: event.id, options }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(`PDF error: ${err.error || res.statusText}`)
        return
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      window.open(url, '_blank')
    } catch (e) {
      alert(`PDF error: ${e.message}`)
    }
  }

  const items = [
    { label: 'Start List',         fn: () => openPdf('start-list',  {}) },
    { label: 'Check by Bib',       fn: () => openPdf('check-bib',   { round }) },
    { label: 'Check by Run Order', fn: () => openPdf('check-order', { round }) },
    { label: 'Results',            fn: () => openPdf('results',      { round }) },
    { label: 'Registration',       fn: () => openPdf('registration', {}) },
    { label: 'Timer Sheet',        fn: () => openPdf('timer-sheet',  {}) },
  ]

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="btn-ghost text-sm flex items-center gap-1">
        Print
        <svg className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-slate-800 border border-slate-700 rounded-lg shadow-xl min-w-[210px] py-1">
          {items.map(item => (
            <button
              key={item.label}
              onClick={item.fn}
              className="w-full text-left px-4 py-2 text-sm text-slate-200 hover:bg-slate-700 transition-colors">
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Group Awards Builder ───────────────────────────────────────────────────────
function GroupAwardsBuilder({ event }) {
  const BLANK_GROUP = () => ({ label: '', divisionContains: '', genderCode: '', birthYearMin: '', birthYearMax: '' })
  const [groups,   setGroups]   = useState([BLANK_GROUP()])
  const [printing, setPrinting] = useState(false)
  const [error,    setError]    = useState('')

  const updateGroup = (i, field, val) => {
    setGroups(gs => gs.map((g, idx) => idx === i ? { ...g, [field]: val } : g))
  }
  const addGroup    = () => { if (groups.length < 8) setGroups(gs => [...gs, BLANK_GROUP()]) }
  const removeGroup = i  => setGroups(gs => gs.filter((_, idx) => idx !== i))

  const printPdf = async () => {
    const validGroups = groups.filter(g => g.label.trim())
    if (!validGroups.length) { setError('Add at least one group with a label.'); return }
    setPrinting(true); setError('')
    try {
      const payload = {
        eventId: event.id,
        groups: validGroups.map(g => ({
          label: g.label,
          filter: {
            ...(g.divisionContains ? { divisionContains: g.divisionContains } : {}),
            ...(g.genderCode       ? { genderCode:       g.genderCode }       : {}),
            ...(g.birthYearMin     ? { birthYearMin:     parseInt(g.birthYearMin) } : {}),
            ...(g.birthYearMax     ? { birthYearMax:     parseInt(g.birthYearMax) } : {}),
          }
        }))
      }
      const res = await fetch('/api/pdf/group-awards', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload)
      })
      if (!res.ok) { const j = await res.json(); throw new Error(j.error) }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = `${event.name.replace(/\s+/g,'_')}_group_awards.pdf`
      a.click(); URL.revokeObjectURL(url)
    } catch (e) { setError(e.message) }
    finally { setPrinting(false) }
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-white">Group Awards</h4>
        <div className="flex gap-2">
          {groups.length < 8 && (
            <button onClick={addGroup} className="btn-ghost text-xs">+ Add Group</button>
          )}
          <button onClick={printPdf} disabled={printing} className="btn-primary text-sm">
            {printing ? 'Generating...' : 'Group Awards PDF'}
          </button>
        </div>
      </div>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <p className="text-slate-500 text-xs">Define up to 8 award groups.  Each group filters the main results and lists the top 3 finishers.  All filter fields are optional.</p>
      <div className="space-y-3">
        {groups.map((g, i) => (
          <div key={i} className="bg-slate-800/60 rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-xs font-semibold w-5">{i+1}.</span>
              <input
                className="input flex-1 text-sm" placeholder="Group label (e.g. J1 Boys 2010-2012)"
                value={g.label} onChange={e => updateGroup(i, 'label', e.target.value)} />
              {groups.length > 1 && (
                <button onClick={() => removeGroup(i)} className="text-red-500 hover:text-red-400 text-xs px-2">Remove</button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pl-7">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Division contains</label>
                <input className="input text-xs w-full" placeholder="e.g. J1, Open, Masters"
                  value={g.divisionContains} onChange={e => updateGroup(i, 'divisionContains', e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Gender</label>
                <select className="input text-xs w-full" value={g.genderCode}
                  onChange={e => updateGroup(i, 'genderCode', e.target.value)}>
                  <option value="">Any</option>
                  <option value="M">Male (M)</option>
                  <option value="F">Female (F)</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Birth year min</label>
                <input className="input text-xs w-full" placeholder="e.g. 2010"
                  value={g.birthYearMin} onChange={e => updateGroup(i, 'birthYearMin', e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Birth year max</label>
                <input className="input text-xs w-full" placeholder="e.g. 2012"
                  value={g.birthYearMax} onChange={e => updateGroup(i, 'birthYearMax', e.target.value)} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Dual Bracket Results (tree visualization for Results tab) ─────────────────
function DualBracketResults({ event }) {
  const [bracket, setBracket] = useState([])
  const [judgePoints, setJudgePoints] = useState({})
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const b = await fetch(`/api/events/${event.id}/dual`).then(r => r.json()).catch(() => [])
      setBracket(Array.isArray(b) ? b : [])
      // Fetch judge points for completed matches
      const completed = (Array.isArray(b) ? b : []).filter(m => m.status === 'complete' && !m.is_bye)
      const jpMap = {}
      await Promise.all(completed.map(async m => {
        try {
          const pts = await fetch(`/api/events/${event.id}/dual/${m.id}/judge-points`).then(r => r.json())
          if (Array.isArray(pts)) jpMap[m.id] = pts
        } catch {}
      }))
      setJudgePoints(jpMap)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [event.id])

  // Listen for live updates
  useEffect(() => {
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${wsProto}//${location.host}`)
    ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', eventId: event.id }))
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.eventId === event.id && (msg.type === 'run_updated' || msg.type === 'score_update')) {
          load()
        }
      } catch {}
    }
    return () => { try { ws.close() } catch {} }
  }, [event.id])

  if (loading && !bracket.length) {
    return <div className="card text-center py-10 text-slate-500">Loading bracket...</div>
  }
  if (!bracket.length) {
    return <div className="card text-center py-10 text-slate-500">No bracket created yet.</div>
  }

  const mainMatches = bracket.filter(m => !m.is_small_final)
  const consolMatches = bracket.filter(m => m.is_small_final).sort((a, b) => a.bracket_position - b.bracket_position)
  const totalRound = Math.max(...mainMatches.map(m => m.bracket_round))

  // Organize matches by round
  const roundMatches = {}
  for (const m of mainMatches) {
    if (!roundMatches[m.bracket_round]) roundMatches[m.bracket_round] = []
    roundMatches[m.bracket_round].push(m)
  }
  for (const r in roundMatches) roundMatches[r].sort((a, b) => a.bracket_position - b.bracket_position)

  // Round labels
  const roundLabel = (r) => {
    if (r === 1) return 'Big Final'
    if (r === 2) return 'Semifinals'
    if (r === 3) return 'Quarterfinals'
    const count = Math.pow(2, r)
    return `Round of ${count}`
  }

  // Build score display string for a match
  const getScoreInfo = (m) => {
    if (m.status !== 'complete' || m.is_bye) return null
    const pts = judgePoints[m.id]
    if (!pts || !pts.length) {
      // DNF/DNS match — no scores
      return { blueTotal: null, redTotal: null, splitStr: null }
    }
    let blueTotal = 0, redTotal = 0
    const blueParts = [], redParts = []
    for (const p of pts) {
      if (p.time_tied) continue
      blueParts.push(p.blue_points || 0)
      redParts.push(p.red_points || 0)
      blueTotal += (p.blue_points || 0)
      redTotal += (p.red_points || 0)
    }
    // Add time tied judge's 0/0 to totals (they're already 0)
    for (const p of pts) {
      if (p.time_tied) {
        blueTotal += 0
        redTotal += 0
      }
    }
    return {
      blueTotal, redTotal,
      blueSplit: blueParts.join('+') + '=' + blueTotal,
      redSplit: redParts.join('+') + '=' + redTotal,
    }
  }

  // Match card component for bracket tree
  const MatchCard = ({ m, compact }) => {
    const blueWon = m.status === 'complete' && m.winner_registration_id === m.registration_id_blue
    const redWon = m.status === 'complete' && m.winner_registration_id === m.registration_id_red
    const isDone = m.status === 'complete'
    const isHjPending = m.status === 'hj_pending'
    const blueLost = isDone && redWon
    const redLost = isDone && blueWon
    const scores = getScoreInfo(m)
    const redOnTop = !m.is_small_final && (totalRound - m.bracket_round) % 2 === 1

    if (m.is_bye) {
      // Bye athlete is always in blue slot — show them on top regardless
      return (
        <div className="bg-slate-800/30 border border-slate-700 rounded text-xs" style={{ minWidth: compact ? 140 : 180 }}>
          <div className="border-b border-slate-700 px-2 py-1 flex justify-between items-center">
            <span className="text-blue-400 font-medium">{m.blue_first ? `${m.blue_last}, ${m.blue_first}` : 'TBD'}</span>
            <span className="text-slate-600 text-[10px]">BYE</span>
          </div>
          <div className="px-2 py-1 text-slate-600">—</div>
        </div>
      )
    }

    const blueRow = (isTop) => (
      <div className={`${isTop ? 'border-b border-slate-700' : ''} px-2 py-1 flex justify-between items-center gap-1 ${blueWon ? 'bg-blue-900/40' : 'bg-slate-800/50'}`}>
        <div className="flex items-center gap-1 min-w-0 flex-1">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0"></span>
          <span className={`truncate ${blueWon ? 'text-white font-semibold' : 'text-slate-300'}`}>
            {m.blue_first ? `${m.blue_last}, ${m.blue_first}` : <span className="text-slate-600">TBD</span>}
          </span>
          {(m.nj_call === 'blue' || m.nj_call === 'both') && (
            <span className="text-[10px] font-bold text-amber-400 flex-shrink-0" title="Chop violation — No Jump on bottom air">NJ</span>
          )}
        </div>
        {isDone && m.blue_total != null && (
          <span className={`font-bold flex-shrink-0 ml-1 ${blueWon ? 'text-white' : 'text-slate-500'}`}>{m.blue_total}</span>
        )}
        {blueLost && m.loser_status && (
          <span className="font-bold flex-shrink-0 ml-1 text-white">{m.loser_status}</span>
        )}
      </div>
    )
    const redRow = (isTop) => (
      <div className={`${isTop ? 'border-b border-slate-700' : ''} px-2 py-1 flex justify-between items-center gap-1 ${redWon ? 'bg-red-900/40' : 'bg-slate-800/50'}`}>
        <div className="flex items-center gap-1 min-w-0 flex-1">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0"></span>
          <span className={`truncate ${redWon ? 'text-white font-semibold' : 'text-slate-300'}`}>
            {m.red_first ? `${m.red_last}, ${m.red_first}` : <span className="text-slate-600">TBD</span>}
          </span>
          {(m.nj_call === 'red' || m.nj_call === 'both') && (
            <span className="text-[10px] font-bold text-amber-400 flex-shrink-0" title="Chop violation — No Jump on bottom air">NJ</span>
          )}
        </div>
        {isDone && m.red_total != null && (
          <span className={`font-bold flex-shrink-0 ml-1 ${redWon ? 'text-white' : 'text-slate-500'}`}>{m.red_total}</span>
        )}
        {redLost && m.loser_status && (
          <span className="font-bold flex-shrink-0 ml-1 text-white">{m.loser_status}</span>
        )}
      </div>
    )

    return (
      <div className={`border rounded text-xs ${isDone ? 'border-slate-600' : isHjPending ? 'border-amber-800/50' : 'border-slate-700'}`}
           style={{ minWidth: compact ? 140 : 180 }}>
        {redOnTop ? redRow(true) : blueRow(true)}
        {redOnTop ? blueRow(false) : redRow(false)}
        {/* Score split */}
        {scores && scores.blueSplit && !compact && (
          <div className="border-t border-slate-700/50 px-2 py-0.5 text-[10px] text-slate-500 flex justify-between">
            {redOnTop ? <span>{scores.redSplit}</span> : <span>{scores.blueSplit}</span>}
            {redOnTop ? <span>{scores.blueSplit}</span> : <span>{scores.redSplit}</span>}
          </div>
        )}
      </div>
    )
  }

  // Columns: from earliest round (left) to final (right)
  const rounds = []
  for (let r = totalRound; r >= 1; r--) rounds.push(r)

  // Card height + spacing for layout calculations
  const CARD_H = 52  // approx height of a match card
  const GAP = 8

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg text-white">Bracket Results</h3>
        <button onClick={load} className="btn-ghost text-sm">Refresh</button>
      </div>

      {/* Main bracket tree */}
      <div className="overflow-x-auto">
        <div className="flex gap-4 items-start" style={{ minWidth: rounds.length * 200 }}>
          {rounds.map((r, colIdx) => {
            const matches = roundMatches[r] || []
            // Each subsequent column gets more vertical spacing to align with parent matches
            const spacingMultiplier = Math.pow(2, colIdx)
            const isFinalCol = r === 1
            // For the finals column with consolation, calculate where to place the Small Final
            // Align it with the bottom of the Round of 16 column (colIdx 1)
            const r16SpacingMult = Math.pow(2, 1) // Round of 16 spacing multiplier
            const r16MatchCount = (roundMatches[totalRound - 1] || []).length
            const r16Height = (r16SpacingMult - 1) * (CARD_H + GAP) / 2 + r16MatchCount * CARD_H + (r16MatchCount - 1) * (r16SpacingMult * (CARD_H + GAP) - CARD_H)
            return (
              <div key={r} className="flex-shrink-0" style={{ width: 200 }}>
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 text-center">
                  {roundLabel(r)}
                </div>
                {isFinalCol && consolMatches.length > 0 ? (
                  /* Finals column: Big Final + consolation matches below, no huge bottom margin */
                  <div>
                    <div style={{ paddingTop: (spacingMultiplier - 1) * (CARD_H + GAP) / 2 }}>
                      {matches.map(m => (
                        <MatchCard key={m.id} m={m} />
                      ))}
                    </div>
                    <div className="space-y-4" style={{ marginTop: 40 }}>
                      {consolMatches.sort((a,b) => {
                        if (a.bracket_round !== b.bracket_round) return a.bracket_round - b.bracket_round
                        return a.bracket_position - b.bracket_position
                      }).map(m => {
                        const label = m.bracket_round === 1 && m.bracket_position === 2 ? 'Small Final'
                          : m.bracket_round === 2 && m.bracket_position === 3 ? '5th / 6th Runoff'
                          : m.bracket_round === 2 && m.bracket_position === 4 ? '7th / 8th Runoff'
                          : 'Consolation'
                        return (
                          <div key={m.id}>
                            <div className="text-xs font-semibold text-amber-400 uppercase tracking-wide mb-1 text-center">{label}</div>
                            <MatchCard m={m} />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2" style={{ paddingTop: (spacingMultiplier - 1) * (CARD_H + GAP) / 2 }}>
                    {matches.map((m, i) => (
                      <div key={m.id} style={{ marginBottom: (spacingMultiplier - 1) * (CARD_H + GAP) }}>
                        <MatchCard m={m} compact={colIdx === 0 && matches.length > 8} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Results Panel ─────────────────────────────────────────────────────────────
function ResultsPanel({ event, meetId }) {
  const [results,      setResults]      = useState([])
  const [round,        setRound]        = useState('qualification')
  const [loading,      setLoading]      = useState(false)
  const [showAwards,   setShowAwards]   = useState(false)
  const [phases,       setPhases]       = useState([])
  const [hasPhases,    setHasPhases]    = useState(false)

  useEffect(() => {
    // Check if event has phases
    api.getPhases(event.id).then(p => {
      const arr = Array.isArray(p) ? p : []
      setPhases(arr)
      setHasPhases(arr.length > 0)
    }).catch(() => {})
  }, [event.id])

  useEffect(() => {
    setLoading(true)
    if (hasPhases) {
      // Phase-aware: use the standard results endpoint (which is now phase-aware on the server)
      api.getResults(event.id).then(setResults).catch(()=>{}).finally(()=>setLoading(false))
    } else {
      api.getResults(event.id, round).then(setResults).catch(()=>{}).finally(()=>setLoading(false))
    }
  }, [event.id, round, hasPhases])

  const placeColor = p => p===1?'text-yellow-400':p===2?'text-slate-300':p===3?'text-amber-600':'text-slate-500'

  // Determine phase format label
  const phaseTypes = phases.map(p => p.phase_type)
  const isBestOf2 = phaseTypes.includes('best_of_2')
  const isQualFinals = phaseTypes.includes('final_1') || phaseTypes.includes('final_2') || phaseTypes.includes('qualifier_2')
  const formatLabel = isBestOf2 ? 'Best of 2' : isQualFinals ? 'Qualifier / Finals' : hasPhases ? 'Results' : null

  const renderResultRow = (r) => (
    <tr key={r.id} className={r.rank<=3 && !r.run_status?'bg-slate-800/30':r.run_status?'opacity-60':''}>
      <td>
        {r.run_status
          ? <span className={`text-xs font-bold px-2 py-0.5 rounded ${
              r.run_status==='DNS' ? 'bg-slate-700 text-slate-300' :
              r.run_status==='RNS' ? 'bg-yellow-900/60 text-yellow-400' :
                                     'bg-red-900/60 text-red-400'
            }`}>{r.run_status}</span>
          : <span className={`text-lg font-bold ${placeColor(r.rank)}`}>{r.rank}</span>
        }
      </td>
      <td className="font-mono text-slate-400">{r.bib_number}</td>
      <td className="text-white font-medium">{r.last_name}, {r.first_name}</td>
      <td className="text-slate-500 text-xs">{r.club||'--'}</td>
      <td className="text-right">{r.run_status ? '--' : fmt1(r.turns_score)}</td>
      <td className="text-right">{r.run_status ? '--' : fmt(r.air_score)}</td>
      {event.discipline !== 'aerials' && <td className="text-right font-mono text-slate-400">{r.run_status ? '--' : r.run_time != null ? (r.run_time == -1 ? 'NT' : Number(r.run_time).toFixed(2)) : '--'}</td>}
      <td className="text-right">{r.run_status ? '--' : fmt(r.speed_score)}</td>
      <td className="text-right font-bold text-white text-base">{r.run_status ? r.run_status : fmt(r.total_score)}</td>
      <td className="font-mono text-xs text-slate-400">{[r.jump1_code,r.jump2_code].filter(Boolean).join(' / ')||'--'}</td>
    </tr>
  )

  const tableHeader = (
    <thead>
      <tr>
        <th className="w-12">Place</th><th className="w-12">Bib</th><th>Athlete</th>
        <th>Club</th>
        <th className="text-right">{event.discipline === 'aerials' ? 'Form' : 'Turns'}</th>
        <th className="text-right">Air</th>
        {event.discipline !== 'aerials' && <th className="text-right">Time</th>}
        <th className="text-right">{event.discipline === 'aerials' ? 'Landing' : 'Speed'}</th>
        <th className="text-right font-bold">Total</th>
        <th>Jumps</th>
      </tr>
    </thead>
  )

  const isDualMogul = event.discipline === 'dual_mogul'

  // Dual mogul: bracket tree visualization
  if (isDualMogul) {
    return <DualBracketResults event={event} />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-2 flex-wrap items-center">
          {hasPhases ? (
            <span className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white">{formatLabel}</span>
          ) : (
            ['qualification','finals','super_finals'].map(r => (
              <button key={r} onClick={()=>setRound(r)}
                className={`px-3 py-1.5 text-sm rounded-lg ${round===r?'bg-blue-600 text-white':'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                {r.replace('_',' ').replace(/\b\w/g,c=>c.toUpperCase())}
              </button>
            ))
          )}
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <button onClick={() => setShowAwards(v => !v)}
            className={`btn-ghost text-sm ${showAwards ? 'text-blue-400 border-blue-700' : ''}`}>
            Group Awards
          </button>
          <PrintDropdown event={event} round={round} />
          {/* v1.25.00 (A-1) — downloads go through downloadAuthed so they carry the auth token */}
          <button onClick={() => downloadAuthed(`/api/export/results-csv/${event.id}?round=${round}`, { fallbackName: 'results.csv' }).catch(e => alert(e.message))}
            className="btn-ghost text-sm">CSV</button>
          <button onClick={() => downloadAuthed(`/api/export/results-xlsx/${event.id}?round=${round}`, { fallbackName: 'results.xlsx' }).catch(e => alert(e.message))}
            className="btn-ghost text-sm">XLSX</button>
          <button onClick={() => downloadAuthed(`/api/export/results-html/${event.id}?round=${round}`, { openInTab: true }).catch(e => alert(e.message))}
            className="btn-ghost text-sm">HTML</button>
        </div>
      </div>

      {showAwards && <GroupAwardsBuilder event={event} />}

      {/* Phase-aware: show tier headers for qualifier/finals format */}
      {hasPhases && isQualFinals ? (
        <div className="space-y-4">
          {(() => {
            const tierOrder = ['final_2', 'final_1', 'qualifier', null]
            const tierLabels = { final_2: 'Final 2', final_1: 'Final 1', qualifier: 'Qualification' }
            const grouped = {}
            for (const r of results) {
              const t = r.tier || 'qualifier'
              if (!grouped[t]) grouped[t] = []
              grouped[t].push(r)
            }
            return tierOrder.filter(t => grouped[t]?.length).map(t => (
              <div key={t}>
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-1">{tierLabels[t] || t}</h3>
                <div className="card overflow-hidden p-0">
                  <table className="data-table">
                    {tableHeader}
                    <tbody>{grouped[t].map(renderResultRow)}</tbody>
                  </table>
                </div>
              </div>
            ))
          })()}
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="data-table">
            {tableHeader}
            <tbody>
              {loading
                ? <tr><td colSpan={10} className="text-center py-8 text-slate-500">Loading...</td></tr>
                : !results.length
                  ? <tr><td colSpan={10} className="text-center py-8 text-slate-600">No results yet.</td></tr>
                  : results.map(renderResultRow)
              }
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Dual Bracket Panel (simplified -- bracket creation and printing only) ─────
function DualBracketPanel({ event, registrations }) {
  const [bracket,       setBracket]       = useState([])
  const [linkedEvents,  setLinkedEvents]  = useState([])
  const [seeding,       setSeeding]       = useState(false)
  const [error,         setError]         = useState('')
  const [msg,           setMsg]           = useState('')

  // Seed-from-event modal state
  const [showSeedModal, setShowSeedModal] = useState(false)
  const [srcEventId,    setSrcEventId]    = useState('')
  const [maleCutoff,    setMaleCutoff]    = useState('')
  const [femaleCutoff,  setFemaleCutoff]  = useState('')

  // Print bracket
  const [printing,      setPrinting]      = useState(false)

  // Manual bracketing state
  const [showManualBracket, setShowManualBracket] = useState(false)
  const [manualSlots, setManualSlots] = useState([])
  const [manualSeedList, setManualSeedList] = useState([])
  const [savingManual, setSavingManual] = useState(false)
  const [manualError, setManualError] = useState('')

  const load = async () => {
    const b = await fetch(`/api/events/${event.id}/dual`).then(r=>r.json()).catch(()=>[])
    setBracket(Array.isArray(b) ? b : [])
  }

  const loadLinkedEvents = async () => {
    try {
      const evts = await fetch(`/api/meets/${event.meet_id}/events`).then(r=>r.json()).catch(()=>[])
      setLinkedEvents(Array.isArray(evts) ? evts.filter(e => e.discipline === 'mogul' && e.id !== event.id) : [])
    } catch (_) {}
  }

  useEffect(() => { load(); loadLinkedEvents() }, [event.id])

  const seedFromQuals = async (force = false) => {
    setSeeding(true); setError(''); setMsg('')
    try {
      const res = await fetch(`/api/events/${event.id}/dual/seed-fis`, {
        method: 'POST', headers: {'Content-Type':'application/json', ...authHeaders()},
        body: JSON.stringify(force ? { force: true } : {})
      })
      if (res.status === 409) {
        const j = await res.json().catch(() => ({}))
        if (j && j.started) {
          if (window.confirm('The bracket already has started matches.  Regenerating will discard those results.  Continue?')) {
            setSeeding(false)
            return seedFromQuals(true)
          }
          throw new Error('Cancelled.')
        }
        if (j && j.exists) {
          if (window.confirm('A bracket has already been created.  Are you sure you want to replace it with a new bracket?')) {
            setSeeding(false)
            return seedFromQuals(true)
          }
          throw new Error('Cancelled.')
        }
        throw new Error(j.error || 'Conflict')
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `Server error ${res.status}`)
      }
      const j = await res.json()
      await load()
      setMsg(`Bracket generated: ${j.seed_count} seeds, bracket size ${j.bracket_size}.`)
    } catch (e) { setError(e.message) }
    finally { setSeeding(false) }
  }

  const seedFromEvent = async () => {
    if (!srcEventId) { setError('Select a source mogul event.'); return }
    setSeeding(true); setError(''); setMsg('')
    try {
      const res = await fetch(`/api/events/${event.id}/dual/seed-from-event`, {
        method: 'POST', headers: {'Content-Type':'application/json', ...authHeaders()},
        body: JSON.stringify({
          sourceEventId: srcEventId,
          maleCutoff:    maleCutoff   ? parseInt(maleCutoff)   : undefined,
          femaleCutoff:  femaleCutoff ? parseInt(femaleCutoff) : undefined,
        })
      })
      if (!res.ok) throw new Error((await res.json()).error)
      const j = await res.json()
      await load()
      setShowSeedModal(false)
      setMsg(`Bracket seeded: ${j.seeds_applied} athletes, bracket size ${j.bracket_size}.`)
    } catch (e) { setError(e.message) }
    finally { setSeeding(false) }
  }

  const resetBracket = async () => {
    if (!window.confirm('Reset bracket? This will clear all match results and seeds.')) return
    await fetch(`/api/events/${event.id}/dual/reset`, { method: 'DELETE', headers: authHeaders() })
    await load(); setMsg('Bracket reset.')
  }

  const startManualBracket = () => {
    setError(''); setMsg(''); setManualError('')
    const seeded = registrations
      .filter(r => r.dual_seed != null && r.status !== 'scratched' && r.status !== 'dns')
      .sort((a, b) => a.dual_seed - b.dual_seed)
    if (seeded.length < 2) {
      setError('Create a seed list first on the Registration tab.')
      return
    }
    // effectiveBracketSize: smallest power of 2 >= count, capped at 128
    let bracketSize = 2
    while (bracketSize < seeded.length && bracketSize < 128) bracketSize *= 2
    const numMatches = bracketSize / 2
    const slots = []
    for (let i = 1; i <= numMatches; i++) slots.push({ matchIndex: i, blue: null, red: null })
    setManualSeedList(seeded)
    setManualSlots(slots)
    setShowManualBracket(true)
  }

  const setManualSlot = (matchIndex, color, value) => {
    setManualSlots(prev => prev.map(s =>
      s.matchIndex === matchIndex ? { ...s, [color]: value || null } : s
    ))
  }

  const saveManualBracket = async (force = false) => {
    setSavingManual(true); setManualError('')
    try {
      const cleanSlots = manualSlots.map(s => ({ matchIndex: s.matchIndex, blue: s.blue, red: s.red }))
      const res = await fetch(`/api/events/${event.id}/dual/seed-manual`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ slots: cleanSlots, force })
      })
      if (res.status === 409) {
        const j = await res.json().catch(() => ({}))
        if (j.started) {
          if (window.confirm('The bracket already has started matches. Regenerating will discard those results. Continue?')) {
            setSavingManual(false)
            return saveManualBracket(true)
          }
          throw new Error('Cancelled.')
        }
        if (j.exists) {
          if (window.confirm('A bracket has already been created. Replace it with a new bracket?')) {
            setSavingManual(false)
            return saveManualBracket(true)
          }
          throw new Error('Cancelled.')
        }
        throw new Error(j.error || 'Conflict')
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `Server error ${res.status}`)
      }
      const j = await res.json()
      setShowManualBracket(false)
      await load()
      setMsg(`Manual bracket saved: ${j.seed_count} seeds, bracket size ${j.bracket_size}.`)
    } catch (e) { setManualError(e.message) }
    finally { setSavingManual(false) }
  }

  const printBracket = async () => {
    setPrinting(true); setError('')
    try {
      const res = await fetch('/api/pdf/dual-bracket', {
        method: 'POST', headers: {'Content-Type':'application/json', ...authHeaders()},
        body: JSON.stringify({ eventId: event.id })
      })
      if (!res.ok) { const j = await res.json(); throw new Error(j.error) }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = `${event.name.replace(/\s+/g,'_')}_dual_bracket.pdf`
      a.click(); URL.revokeObjectURL(url)
    } catch (e) { setError(e.message) }
    finally { setPrinting(false) }
  }

  // Group matches for display
  const mainRounds = {}
  const consolRounds = {}
  for (const m of bracket) {
    if (m.is_small_final) {
      if (!consolRounds[m.bracket_round]) consolRounds[m.bracket_round] = []
      consolRounds[m.bracket_round].push(m)
    } else {
      if (!mainRounds[m.bracket_round]) mainRounds[m.bracket_round] = []
      mainRounds[m.bracket_round].push(m)
    }
  }
  const roundNums  = Object.keys(mainRounds).map(Number).sort((a,b)=>b-a)
  const roundLabel = (n, isConsol=false) => {
    if (isConsol) {
      if (n === 1) return 'Small Final'
      if (n === 2) return '5th -- 8th Place'
      return `Consolation Round ${n}`
    }
    if (n === 1) return 'Big Final'
    if (n === 2) return 'Semifinals'
    if (n === 3) return 'Quarterfinals'
    return `Round of ${Math.pow(2, n)}`
  }

  const totalRound = roundNums.length > 0 ? roundNums[0] : 1

  const SimpleBracketCard = ({ m }) => {
    const blueWon = m.status === 'complete' && m.winner_registration_id === m.registration_id_blue
    const redWon  = m.status === 'complete' && m.winner_registration_id === m.registration_id_red
    const isDone  = m.status === 'complete'
    const isHjPending = m.status === 'hj_pending'
    const blueLost = isDone && redWon
    const redLost  = isDone && blueWon
    const redOnTop = !m.is_small_final && (totalRound - m.bracket_round) % 2 === 1

    const blueBox = (
      <div className={`col-span-2 p-2 rounded-lg flex items-center gap-3 ${blueWon ? 'bg-blue-800/40 ring-1 ring-blue-500' : 'bg-slate-800'}`}>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-blue-400 mb-0.5 font-semibold">Blue</div>
          <div className={`font-semibold text-sm ${blueWon ? 'text-white' : 'text-slate-300'}`}>
            {m.blue_first ? `${m.blue_last}, ${m.blue_first}` : <span className="text-slate-600">TBD</span>}
          </div>
          {m.blue_dual_seed != null && m.blue_dual_seed !== 0 && <div className="text-xs text-slate-500 mt-0.5">Seed #{m.blue_dual_seed}</div>}
        </div>
        {isDone && m.blue_total != null && (
          <div className="text-2xl font-bold text-white leading-none ml-auto">{m.blue_total}</div>
        )}
        {blueLost && m.loser_status && (
          <div className="text-2xl font-bold text-white leading-none ml-auto">{m.loser_status}</div>
        )}
      </div>
    )
    const redBox = (
      <div className={`col-span-2 p-2 rounded-lg flex items-center gap-3 ${redWon ? 'bg-red-900/40 ring-1 ring-red-500' : 'bg-slate-800'}`}>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-red-400 mb-0.5 font-semibold">Red</div>
          <div className={`font-semibold text-sm ${redWon ? 'text-white' : 'text-slate-300'}`}>
            {m.red_first ? `${m.red_last}, ${m.red_first}` : <span className="text-slate-600">TBD</span>}
          </div>
          {m.red_dual_seed != null && m.red_dual_seed !== 0 && <div className="text-xs text-slate-500 mt-0.5">Seed #{m.red_dual_seed}</div>}
        </div>
        {isDone && m.red_total != null && (
          <div className="text-2xl font-bold text-white leading-none ml-auto">{m.red_total}</div>
        )}
        {redLost && m.loser_status && (
          <div className="text-2xl font-bold text-white leading-none ml-auto">{m.loser_status}</div>
        )}
      </div>
    )

    return (
      <div className={`rounded-xl border p-3 ${isDone ? 'border-slate-700 bg-slate-800/20' : isHjPending ? 'border-amber-800/50 bg-amber-900/10' : 'border-slate-700 bg-slate-800/30'}`}>
        <div className="flex items-center gap-2 mb-1">
          {m.pairing_label && <span className="text-xs font-bold text-slate-400 bg-slate-700 px-1.5 py-0.5 rounded">{m.pairing_label}</span>}
          {!!m.is_bye && <span className="bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded text-xs font-semibold">BYE</span>}
        </div>
        <div className="grid grid-cols-5 gap-2 items-center">
          {redOnTop ? redBox : blueBox}
          <div className="text-center text-slate-600 font-bold text-sm">
            {isDone ? <span className="text-xs text-green-400">Done</span> : isHjPending ? <span className="text-xs text-amber-400">HJ</span> : 'vs'}
          </div>
          {redOnTop ? blueBox : redBox}
        </div>
        {isDone && m.winner_first && (
          <div className="text-center mt-2 text-xs text-green-400 font-semibold">Winner: {m.winner_last}, {m.winner_first}</div>
        )}
        {isHjPending && (
          <div className="text-center mt-2 text-xs text-amber-400 font-semibold">Awaiting Head Judge Approval</div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-display text-lg text-white">Dual Mogul Bracket</h3>
          <p className="text-slate-500 text-sm mt-0.5">Create and seed the bracket, then use the Scoring tab to run matches.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={load} className="btn-ghost text-sm">Refresh</button>
          {bracket.length > 0 && (
            <>
              <button onClick={printBracket} disabled={printing} className="btn-ghost text-sm">
                {printing ? 'Generating...' : 'Print Bracket'}
              </button>
              <button onClick={resetBracket} className="btn-ghost text-sm text-red-400 border-red-900 hover:bg-red-900/20">
                Reset
              </button>
            </>
          )}
          {!bracket.length && (
            <>
              <button onClick={() => seedFromQuals(false)} disabled={seeding} className="btn-ghost text-sm">
                {seeding ? 'Bracketing...' : 'FIS Bracketing'}
              </button>
              <button onClick={startManualBracket} disabled={seeding} className="btn-ghost text-sm">
                Manual Bracketing
              </button>
              <button onClick={()=>{setShowSeedModal(true);setError('')}} className="btn-primary text-sm">
                Seed from Mogul Event
              </button>
            </>
          )}
        </div>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {msg   && <p className="text-green-400 text-sm">{msg}</p>}

      {/* Seed-from-event modal */}
      {showSeedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md space-y-4">
            <h4 className="font-display text-lg text-white">Seed from Mogul Event</h4>
            <p className="text-slate-400 text-sm">
              Athletes must already be registered in this dual event.  Seeding is matched by athlete record.
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Source mogul event</label>
                <select className="input w-full" value={srcEventId} onChange={e=>setSrcEventId(e.target.value)}>
                  <option value="">-- Select event --</option>
                  {linkedEvents.map(e => (
                    <option key={e.id} value={e.id}>{e.name} ({e.gender==='M'?'Men':'Women'})</option>
                  ))}
                </select>
                {!linkedEvents.length && (
                  <p className="text-xs text-slate-600 mt-1">No mogul events found in this meet.</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Male cutoff (blank = all)</label>
                  <input className="input w-full" value={maleCutoff} onChange={e=>setMaleCutoff(e.target.value)} placeholder="e.g. 16" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Female cutoff (blank = all)</label>
                  <input className="input w-full" value={femaleCutoff} onChange={e=>setFemaleCutoff(e.target.value)} placeholder="e.g. 16" />
                </div>
              </div>
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={()=>{setShowSeedModal(false);setError('')}} className="btn-ghost text-sm">Cancel</button>
              <button onClick={seedFromEvent} disabled={seeding || !srcEventId} className="btn-primary text-sm">
                {seeding ? 'Seeding...' : 'Seed Bracket'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Bracket Builder modal */}
      {showManualBracket && (() => {
        const placedIds = new Set()
        let byeCount = 0
        for (const s of manualSlots) {
          if (s.blue && s.blue !== 'BYE') placedIds.add(s.blue)
          if (s.red && s.red !== 'BYE') placedIds.add(s.red)
          if (s.blue === 'BYE') byeCount++
          if (s.red === 'BYE') byeCount++
        }
        const totalSlotCount = manualSlots.length * 2
        const filledCount = manualSlots.filter(s => s.blue && s.red).length
        const allFilled = filledCount === manualSlots.length
        const hasBothBye = manualSlots.some(s => s.blue === 'BYE' && s.red === 'BYE')
        const canSave = allFilled && !hasBothBye && placedIds.size === manualSeedList.length

        const availableFor = (matchIndex, color) => {
          const currentSlot = manualSlots.find(s => s.matchIndex === matchIndex)
          const currentVal = currentSlot ? currentSlot[color] : null
          return manualSeedList.filter(a => !placedIds.has(a.id) || a.id === currentVal)
        }

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 overflow-auto">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-6xl max-h-[90vh] overflow-auto m-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="font-display text-lg text-white">Manual Bracket Builder</h4>
                  <p className="text-slate-400 text-sm mt-0.5">
                    {placedIds.size} of {manualSeedList.length} athletes placed &middot; {byeCount} bye{byeCount !== 1 ? 's' : ''} &middot; {filledCount} of {manualSlots.length} matches complete
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => saveManualBracket()}
                    disabled={!canSave || savingManual}
                    className="btn-primary text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {savingManual ? 'Saving...' : 'Save Manual Bracket'}
                  </button>
                  <button onClick={() => setShowManualBracket(false)} className="btn-ghost text-sm">Cancel</button>
                </div>
              </div>

              {manualError && <p className="text-red-400 text-sm mb-3">{manualError}</p>}
              {hasBothBye && <p className="text-red-400 text-sm mb-3">A match cannot have BYE on both sides.</p>}
              {allFilled && placedIds.size !== manualSeedList.length && (
                <p className="text-red-400 text-sm mb-3">All {manualSeedList.length} seeded athletes must be placed.</p>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {manualSlots.map(slot => {
                  const bothBye = slot.blue === 'BYE' && slot.red === 'BYE'
                  const complete = slot.blue && slot.red && !bothBye
                  return (
                    <div key={slot.matchIndex} className={`rounded-lg border p-3 ${bothBye ? 'border-red-700 bg-red-900/10' : complete ? 'border-green-700/50 bg-slate-800' : 'border-slate-700 bg-slate-800'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-slate-400">Match {slot.matchIndex}</span>
                        {complete && <span className="text-green-400 text-xs">&#10003;</span>}
                      </div>
                      {/* Blue slot */}
                      <div className="mb-1.5">
                        <div className="text-[10px] text-blue-400 font-semibold mb-0.5">Blue</div>
                        <select
                          className="w-full bg-slate-700 text-xs text-white rounded px-2 py-1.5 border border-blue-800/50"
                          value={slot.blue || ''}
                          onChange={e => setManualSlot(slot.matchIndex, 'blue', e.target.value)}
                        >
                          <option value="">-- Select --</option>
                          <option value="BYE">BYE</option>
                          {availableFor(slot.matchIndex, 'blue').map(a => (
                            <option key={a.id} value={a.id}>#{a.dual_seed} {a.last_name}, {a.first_name} (Bib {a.bib_number || '?'})</option>
                          ))}
                        </select>
                      </div>
                      {/* Red slot */}
                      <div>
                        <div className="text-[10px] text-red-400 font-semibold mb-0.5">Red</div>
                        <select
                          className="w-full bg-slate-700 text-xs text-white rounded px-2 py-1.5 border border-red-800/50"
                          value={slot.red || ''}
                          onChange={e => setManualSlot(slot.matchIndex, 'red', e.target.value)}
                        >
                          <option value="">-- Select --</option>
                          <option value="BYE">BYE</option>
                          {availableFor(slot.matchIndex, 'red').map(a => (
                            <option key={a.id} value={a.id}>#{a.dual_seed} {a.last_name}, {a.first_name} (Bib {a.bib_number || '?'})</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Bracket display */}
      {!bracket.length
        ? (
          <div className="card text-center py-10 text-slate-500">
            No bracket yet.  Choose a seeding method above to generate the bracket.
          </div>
        )
        : (
          <div className="space-y-4">
            {roundNums.map(rn => (
              <div key={rn} className="card">
                <h4 className="font-semibold text-white mb-3">{roundLabel(rn)}</h4>
                <div className="space-y-3">
                  {mainRounds[rn].sort((a,b)=>a.bracket_position-b.bracket_position).map(m => (
                    <SimpleBracketCard key={m.id} m={m} />
                  ))}
                </div>
              </div>
            ))}
            {Object.keys(consolRounds).map(Number).sort((a,b)=>b-a).map(rn => (
              <div key={`c${rn}`} className="card border border-dashed border-slate-700">
                <h4 className="font-semibold text-amber-400 mb-3">{roundLabel(rn, true)}</h4>
                <div className="space-y-3">
                  {consolRounds[rn].sort((a,b)=>a.bracket_position-b.bracket_position).map(m => (
                    <SimpleBracketCard key={m.id} m={m} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      }
    </div>
  )
}

// ── USSS Competition Code inline edit ─────────────────────────────────────────
function UsssCodeField({ meetId, eventId, field, value, onSave, type = "text" }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value || '')
  const [saving, setSaving] = useState(false)

  useEffect(() => { setVal(value || '') }, [value])

  const save = async () => {
    setSaving(true)
    try { await api.updateEvent(meetId, eventId, { [field]: val.trim() || null }); onSave() }
    catch {} finally { setSaving(false); setEditing(false) }
  }

  if (editing) {
    return (
      <span className="flex items-center gap-1">
        <input
          type={type}
          className="bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-xs text-white font-mono w-32 outline-none focus:border-blue-500"
          value={val}
          autoFocus
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
        />
        <button onClick={save} disabled={saving} className="text-green-400 hover:text-green-300 text-xs">
          {saving ? '...' : 'Save'}
        </button>
        <button onClick={() => setEditing(false)} className="text-slate-500 hover:text-slate-300 text-xs">Cancel</button>
      </span>
    )
  }

  return (
    <button onClick={() => setEditing(true)}
      className="text-xs font-mono text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2 py-0.5 rounded transition-colors">
      {value || <span className="text-slate-600 italic">not set</span>}
    </button>
  )
}

// ── PDF Reports Panel ─────────────────────────────────────────────────────────
function PdfReportsPanel({ event }) {
  const [runNumber, setRunNumber] = useState(1)
  const [sort,  setSort]    = useState('alpha')
  const [busy,  setBusy]    = useState({})
  const [phases, setPhases] = useState([])
  const [hasLogo, setHasLogo] = useState(false)
  const [logoUploading, setLogoUploading] = useState(false)

  useEffect(() => {
    api.getPhases(event.id).then(p => setPhases(p || [])).catch(() => setPhases([]))
    fetch(`/api/pdf/logo/${event.meet_id}`).then(r => r.json()).then(d => setHasLogo(d.hasLogo)).catch(() => {})
  }, [event.id, event.meet_id])

  const uploadLogo = async (file) => {
    if (!file) return
    setLogoUploading(true)
    try {
      const form = new FormData()
      form.append('logo', file)
      const res = await fetch(`/api/pdf/upload-logo/${event.meet_id}`, { method: 'POST', headers: authHeaders(), body: form })
      if (res.ok) setHasLogo(true)
      else alert('Failed to upload logo')
    } catch (e) { alert('Upload error: ' + e.message) }
    finally { setLogoUploading(false) }
  }

  const removeLogo = async () => {
    await fetch(`/api/pdf/logo/${event.meet_id}`, { method: 'DELETE', headers: authHeaders() })
    setHasLogo(false)
  }

  const post = async (endpoint, options, filename) => {
    setBusy(b => ({ ...b, [endpoint]: true }))
    try {
      const res = await fetch(`/api/pdf/${endpoint}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body:    JSON.stringify({ eventId: event.id, options }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(`PDF error: ${err.error || res.statusText}`)
        return
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert(`PDF error: ${e.message}`)
    } finally {
      setBusy(b => ({ ...b, [endpoint]: false }))
    }
  }

  const safe = (event.name || 'event').replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '')
  const today = new Date()
  const ds    = `${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}-${String(today.getFullYear()).slice(-2)}`

  const isDual = event.discipline === 'dual_mogul'

  const sections = isDual ? [
    {
      title: 'Registration',
      reports: [
        {
          key: 'registration', label: 'Registration Listing - All Events',
          desc: 'All registered (non-scratched) athletes with USSA#, FIS#, birth year, and events. Totals by sex at bottom.',
          opts: { sort }, file: `${safe}_registration_${ds}.pdf`,
        },
      ],
    },
    {
      title: 'Dual Mogul',
      reports: [
        {
          key: 'dual-seed-list', label: 'Seeding List',
          desc: 'Seeding list showing seed number, bib, name, club, MO place, USSS points, and seed source.',
          opts: {}, file: `${safe}_dual_seed_list_${ds}.pdf`,
        },
        {
          key: 'dual-bracket', label: 'Dual Bracket',
          desc: 'Bracket tree showing all pairings. Includes scores if matches have been completed.',
          opts: {}, file: `${safe}_dual_bracket_${ds}.pdf`,
        },
        {
          key: 'bracket-keeper', label: 'Bracket Keeper',
          desc: 'Black & white bracket for spectators to follow along and write results by hand.',
          opts: {}, file: `${safe}_bracket_keeper_${ds}.pdf`,
        },
        {
          key: 'dual-results', label: 'Final Place List',
          desc: 'Final placement results derived from bracket outcomes (1st through last).',
          opts: {}, file: `${safe}_dual_results_${ds}.pdf`,
        },
      ],
    },
  ] : [
    {
      title: 'Registration',
      reports: [
        {
          key: 'registration', label: 'Registration Listing - All Events',
          desc: 'All registered (non-scratched) athletes with USSA#, FIS#, birth year, and events. Totals by sex at bottom.',
          opts: { sort }, file: `${safe}_registration_${ds}.pdf`,
        },
      ],
    },
    {
      title: 'Run Order & Scoring Sheets',
      reports: [
        {
          key: 'run-order', label: 'Run Order (Single Space)',
          desc: 'Compact 3-column entrants list in run order with bib, name, group, and club.',
          opts: { runNumber, sort }, file: `${safe}_run_order_${ds}.pdf`,
        },
        {
          key: 'timer-sheet', label: 'Manual Time Sheet',
          desc: 'Triple-spaced timing sheet with blank Top Time and Bottom Time columns for on-hill use.',
          opts: {}, file: `${safe}_timer_sheet_${ds}.pdf`,
        },
        {
          key: 'check-bib', label: 'Check Sheet -- By Bib',
          desc: 'Scoring verification sheet sorted by bib number. Shows entered scores and flags DNS/DNF/DSQ.',
          opts: { runNumber }, file: `${safe}_check_bib_${ds}.pdf`,
        },
        {
          key: 'check-order', label: 'Check Sheet -- By Run Order',
          desc: 'Scoring verification sheet sorted by run order. Shows entered scores and flags DNS/DNF/DSQ.',
          opts: { runNumber }, file: `${safe}_check_order_${ds}.pdf`,
        },
      ],
    },
    {
      title: 'Run Results',
      reports: [
        {
          key: 'run-results', label: 'Run Results',
          desc: 'Detailed per-run results with per-judge T&L scores, air scores, jump codes, DDs, time, and speed points.',
          opts: { runNumber }, file: `${safe}_run_results_${runNumber}_${ds}.pdf`,
        },
      ],
    },
    {
      title: 'Event Results',
      reports: [
        {
          key: 'event-results-summary', label: 'Event Results (Summary)',
          desc: 'Simple results listing with place, bib, name, group, club, and final score. Auto-detects phases.',
          opts: {}, file: `${safe}_event_results_summary_${ds}.pdf`,
        },
        {
          key: 'event-results-detailed', label: 'Event Results (Detailed)',
          desc: 'Full scoring breakdown for all runs per athlete with per-judge scores, jump codes, and event total.',
          opts: {}, file: `${safe}_event_results_detailed_${ds}.pdf`,
        },
        ...(event.component_scoring ? [{
          key: 'event-results-component', label: 'Detailed Results with Component Scoring',
          desc: 'Per-judge T&L component breakdown (Carving, Upper Body, Absorption & Extension, Deductions) plus air and speed for all runs.',
          opts: {}, file: `${safe}_results_component_${ds}.pdf`,
        }] : []),
        {
          key: 'event-results-group-summary', label: 'Event Results (Group Summary)',
          desc: 'Results grouped by age category (F15, M17, etc.) with separate ranking per group.',
          opts: {}, file: `${safe}_event_results_group_summary_${ds}.pdf`,
        },
        {
          key: 'event-results-group-detailed', label: 'Event Results (Group Detailed)',
          desc: 'Detailed scoring breakdown grouped by age category with separate ranking per group.',
          opts: {}, file: `${safe}_event_results_group_detailed_${ds}.pdf`,
        },
      ],
    },
  ]

  return (
    <div className="space-y-4 max-w-2xl">
      <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">PDF Reports</h2>

      {/* Global options */}
      <div className="flex gap-6 mb-5 flex-wrap">
        {!isDual && (
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <span className="text-slate-400">Run Number:</span>
            <select
              value={runNumber}
              onChange={e => { const v = e.target.value; setRunNumber(v === 'final' ? v : parseInt(v)); }}
              className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-white outline-none focus:border-blue-500"
            >
              {phases.length > 0 ? (
                <>
                  {phases.map(p => (
                    <option key={p.id} value={p.run_number}>{p.label}</option>
                  ))}
                  <option value="final">Final Results</option>
                </>
              ) : (
                <>
                  <option value={1}>Run 1</option>
                  <option value={2}>Run 2</option>
                  <option value="final">Final Results</option>
                </>
              )}
            </select>
          </label>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <span className="text-slate-400">Registration sort:</span>
          <select
            value={sort}
            onChange={e => setSort(e.target.value)}
            className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-white outline-none focus:border-blue-500"
          >
            <option value="alpha">Alphabetical</option>
            <option value="bib">By Bib</option>
          </select>
        </label>
        <div className="flex items-center gap-2 text-sm text-slate-300">
          <span className="text-slate-400">Event Logo:</span>
          {hasLogo ? (
            <button onClick={removeLogo} className="px-3 py-1 text-xs rounded bg-red-700 hover:bg-red-600 text-white">Remove Logo</button>
          ) : (
            <label className="px-3 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600 text-white cursor-pointer">
              {logoUploading ? 'Uploading...' : 'Upload PNG/JPEG'}
              <input type="file" accept=".png,.jpg,.jpeg" className="hidden" onChange={e => uploadLogo(e.target.files[0])} />
            </label>
          )}
          {hasLogo && <span className="text-xs text-green-400">Uploaded</span>}
        </div>
      </div>

      {sections.map(section => (
        <div key={section.title} className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mt-4 mb-1 border-b border-slate-700 pb-1">
            {section.title}
          </h3>
          {section.reports.map(r => (
            <div key={r.key}
              className="flex items-center justify-between gap-4 bg-slate-800 border border-slate-700 rounded-lg px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-100">{r.label}</div>
                <div className="text-xs text-slate-400 mt-0.5">{r.desc}</div>
              </div>
              <button
                onClick={() => post(r.key, r.opts, r.file)}
                disabled={!!busy[r.key]}
                className="shrink-0 px-4 py-1.5 text-sm font-medium rounded
                  bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed
                  text-white transition-colors"
              >
                {busy[r.key] ? 'Generating...' : 'Generate PDF'}
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ── ManualScoreModal ──────────────────────────────────────────────────────────
// v1.25.00 (C-4) — module scope so React doesn't remount the input (and drop
// keyboard focus) on every ManualScoreModal render.
function JumpCodeInput({ id, label, value, onChange, codes }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        list={`${id}-list`}
        className="input font-mono"
        placeholder="type or select..."
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      <datalist id={`${id}-list`}>
        {codes.map(d => <option key={d.jump_code} value={d.jump_code}>{d.jump_code} (DD {d.dd_value})</option>)}
      </datalist>
    </div>
  )
}

function ManualScoreModal({ event, mode, run, registration, runNumber = 1, onClose, onSuccess, onSwitchToVoice }) {
  const isMogul   = event.discipline !== 'aerials'
  const numTL     = event.num_tl_judges  || 3
  const numAir    = event.num_air_judges || 2
  const numJumps  = event.num_jumps || 2
  const hasSpeed  = isMogul && !!event.has_speed
  const componentScoring = event.discipline === 'mogul' ? !!(event.component_scoring ?? 1) : true
  const isDevOrRqs = event.division === 'devo' || event.division === 'rqs_eqs'

  // Athlete info depends on mode
  const athleteName = mode === 'edit'
    ? `${run.first_name} ${run.last_name}`
    : `${registration.first_name} ${registration.last_name}`
  const athleteBib = mode === 'edit' ? run.bib_number : registration.bib_number

  const mkArr = (n, val = '') => Array.from({ length: n }, () => val)
  const mkTL  = () => ({ carving: '', upperBody: '', absExt: '', deduction: '', total: '' })

  // Score state — TL judges use per-judge objects for optional component breakdown
  const [tlJudges,      setTlJudges]      = useState(Array.from({ length: numTL }, mkTL))
  const [air1Scores,    setAir1Scores]    = useState(mkArr(numAir))
  const [air2Scores,    setAir2Scores]    = useState(mkArr(numAir))
  const [formScores,    setFormScores]    = useState(mkArr(numTL))
  const [landingScores, setLandingScores] = useState(mkArr(numAir))
  // Jump codes preserve exact case — never toUpperCase() since codes like "bL" are case-sensitive
  const [jump1Code,     setJump1Code]     = useState('')
  const [jump2Code,     setJump2Code]     = useState('')
  const [runTime,       setRunTime]       = useState('')
  const [error,         setError]         = useState('')
  const [saving,        setSaving]        = useState('')  // '' | 'score' | 'dns' | 'dnf' | 'dsq'
  // Known jump codes for autocomplete datalist
  const [jumpCodes,     setJumpCodes]     = useState([])
  // v1.25.00 (C-5) — DNS/DNF/DSQ confirm before submitting
  const [statusConfirm, setStatusConfirm] = useState(null)

  // Fetch available jump codes for autocomplete; pre-populate edit fields
  useEffect(() => {
    const disc = event.discipline === 'aerials' ? 'aerials' : 'mogul'
    const gender = event.gender || 'M'
    fetch(`/api/jump-dds?discipline=${disc}&gender=${gender}&ruleset=uss`)
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        if (Array.isArray(data)) {
          // Deduplicate codes (table may have male/female rows for same code)
          const seen = new Set()
          setJumpCodes(data.filter(d => { if (seen.has(d.jump_code)) return false; seen.add(d.jump_code); return true }))
        }
      })
      .catch(() => {})

    if (mode !== 'edit') return
    // Pre-populate from existing run data (preserve original case from DB)
    if (run.jump1_code) setJump1Code(run.jump1_code)
    if (run.jump2_code) setJump2Code(run.jump2_code)
    if (run.run_time && run.run_time != -1)   setRunTime(String(run.run_time))

    api.getRunScores(event.id, run.id).then(scores => {
      const turns = scores.filter(s => s.score_type === 'turns')
        .sort((a, b) => (a.role || '').localeCompare(b.role || ''))
      if (turns.length) setTlJudges(Array.from({ length: numTL }, (_, i) => {
        const s = turns[i]
        if (!s) return mkTL()
        if (!componentScoring) {
          // Non-component mode: back-compute pre-deduction total from raw_score + deduction
          const ded = s.tl_deduction != null ? s.tl_deduction : 0
          const preDeduction = s.raw_score != null ? (s.raw_score + ded) : null
          return {
            carving: '', upperBody: '', absExt: '',
            deduction: s.tl_deduction != null ? String(s.tl_deduction) : '',
            total:     preDeduction != null ? String(preDeduction) : '',
          }
        }
        return {
          carving:   s.tl_carving    != null ? String(s.tl_carving)    : '',
          upperBody: s.tl_upper_body != null ? String(s.tl_upper_body) : '',
          absExt:    s.tl_abext      != null ? String(s.tl_abext)      : '',
          deduction: s.tl_deduction  != null ? String(s.tl_deduction)  : '',
          total:     s.raw_score     != null ? String(s.raw_score)      : '',
        }
      }))

      const forms = scores.filter(s => s.score_type === 'form')
      if (forms.length) setFormScores(mkArr(numTL).map((_, i) => forms[i] ? String(forms[i].raw_score) : ''))

      const aj1 = scores.filter(s => s.score_type === 'air_jump1')
      if (aj1.length) setAir1Scores(mkArr(numAir).map((_, i) => aj1[i] ? String(aj1[i].raw_score) : ''))

      const aj2 = scores.filter(s => s.score_type === 'air_jump2')
      if (aj2.length) setAir2Scores(mkArr(numAir).map((_, i) => aj2[i] ? String(aj2[i].raw_score) : ''))

      const land = scores.filter(s => s.score_type === 'landing')
      if (land.length) setLandingScores(mkArr(numAir).map((_, i) => land[i] ? String(land[i].raw_score) : ''))
    }).catch(() => {})
  }, [])

  const updateArr = (setter, idx, val) => setter(arr => arr.map((v, i) => i === idx ? val : v))
  const parseScore = v => { const n = parseFloat(v); return isNaN(n) ? null : n }

  // TL judge helpers
  const updateTLComponent = (i, field, val) => {
    setTlJudges(arr => arr.map((j, idx) => {
      if (idx !== i) return j
      const next = { ...j, [field]: val }
      const crv = parseFloat(next.carving)   || 0
      const ub  = parseFloat(next.upperBody) || 0
      const abs = parseFloat(next.absExt)    || 0
      const ded = parseFloat(next.deduction) || 0
      const anyFilled = next.carving !== '' || next.upperBody !== '' || next.absExt !== '' || next.deduction !== ''
      const computed = anyFilled ? Math.max(0.1, Math.min(20, crv + ub + abs - ded)).toFixed(1) : next.total
      return { ...next, total: computed }
    }))
  }
  const updateTLTotal = (i, val) => {
    // Editing total directly clears components
    setTlJudges(arr => arr.map((j, idx) => idx !== i ? j : { ...mkTL(), total: val }))
  }
  // Non-component mode: update total or deduction, auto-compute final
  const updateTLSimple = (i, field, val) => {
    setTlJudges(arr => arr.map((j, idx) => {
      if (idx !== i) return j
      const next = { ...j, [field]: val }
      const tot = parseFloat(next.total)     || 0
      const ded = parseFloat(next.deduction) || 0
      const anyFilled = next.total !== '' || next.deduction !== ''
      return { ...next, _computed: anyFilled ? Math.max(0.1, Math.min(20, tot - ded)).toFixed(1) : '' }
    }))
  }

  const submitStatus = async (status) => {
    setSaving(status.toLowerCase()); setError('')
    try {
      const body = { run_status: status }
      if (mode === 'entry') {
        body.registration_id = registration.id
        body.run_number = runNumber
        body.round = 'qualification'
        await api.manualEntry(event.id, body)
      } else {
        await api.manualScore(event.id, run.id, body)
      }
      setStatusConfirm(null)
      onSuccess()
    } catch (err) { setError(err.message); setSaving(''); setStatusConfirm(null) }
  }
  // C-5 — clicking DNS/DNF/DSQ opens the shared confirm dialog first
  const handleStatusClick = (status) => setStatusConfirm(status)

  const handleSubmit = async () => {
    setError(''); setSaving('score')

    // When component scoring is off, compute final from total - deduction
    const tlArr = isMogul && !componentScoring
      ? tlJudges.map(j => {
          const tot = parseScore(j.total)
          const ded = parseScore(j.deduction) || 0
          return tot !== null ? Math.max(0.1, Math.min(20, tot - ded)) : null
        })
      : tlJudges.map(j => parseScore(j.total))
    const a1Arr = air1Scores.map(parseScore)
    const a2Arr = air2Scores.map(parseScore)
    const fmArr = formScores.map(parseScore)
    const ldArr = landingScores.map(parseScore)

    if (isMogul) {
      if (!componentScoring && tlJudges.some(j => j.total === '' || j.total === null)) { setError('All T&L judge totals are required.'); setSaving(''); return }
      if (componentScoring && tlArr.some(v => v === null)) { setError('All T&L judge scores are required.'); setSaving(''); return }
      if (tlArr.some(v => v !== null && (v < 0.1 || v > 20))) { setError('T&L scores must be between 0.1 and 20.'); setSaving(''); return }
    } else {
      if (fmArr.some(v => v === null)) { setError('All Form judge scores are required.'); setSaving(''); return }
      if (ldArr.some(v => v === null)) { setError('All Landing judge scores are required.'); setSaving(''); return }
    }
    if (a1Arr.some(v => v === null)) {
      setError('All Air judge scores for Jump 1 are required.'); setSaving(''); return
    }
    if (numJumps >= 2 && a2Arr.some(v => v === null)) {
      setError('All Air judge scores for Jump 2 are required.'); setSaving(''); return
    }
    if (!jump1Code.trim()) { setError('Jump 1 code is required.'); setSaving(''); return }
    if (numJumps >= 2 && !jump2Code.trim()) { setError('Jump 2 code is required.'); setSaving(''); return }

    // Send jump codes exactly as entered — the server's jump_dd_table lookup is case-sensitive
    const body = {
      jump1_code:       jump1Code.trim(),
      jump2_code:       numJumps >= 2 ? jump2Code.trim() : null,
      tl_scores:        isMogul ? tlArr : [],
      tl_components:    isMogul ? tlJudges.map(j => ({
        carving:   componentScoring ? (parseScore(j.carving)   ?? null) : null,
        upperBody: componentScoring ? (parseScore(j.upperBody) ?? null) : null,
        absExt:    componentScoring ? (parseScore(j.absExt)    ?? null) : null,
        deduction: parseScore(j.deduction) ?? null,
      })) : [],
      air_jump1_scores: a1Arr,
      air_jump2_scores: numJumps >= 2 ? a2Arr : [],
      form_scores:      !isMogul ? fmArr : [],
      landing_scores:   !isMogul ? ldArr : [],
      run_time:         hasSpeed && runTime ? parseFloat(runTime) : undefined,
    }

    try {
      if (mode === 'entry') {
        body.registration_id = registration.id
        body.run_number = runNumber
        body.round = 'qualification'
        await api.manualEntry(event.id, body)
      } else {
        await api.manualScore(event.id, run.id, body)
      }
      onSuccess()
    } catch (err) { setError(err.message); setSaving('') }
  }

  const isSaving = saving !== ''

  // Jump code list for the module-scope JumpCodeInput (C-4)
  const filteredJumpCodes = isDevOrRqs
    ? jumpCodes.filter(d => !/^[bfl]|o/.test(d.jump_code))
    : jumpCodes

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 space-y-5">

          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-display font-bold text-white">
                {mode === 'edit' ? 'Edit Score' : 'Manual Score Entry'}
              </h2>
              <div className="text-slate-400 text-sm mt-0.5">
                <span className="font-mono text-slate-300">Bib #{athleteBib}</span>
                <span className="mx-2 text-slate-600">·</span>
                <span className="text-white font-semibold">{athleteName}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* v1.20.00 -- switch to voice dictation for this same athlete */}
              {onSwitchToVoice && event.discipline !== 'aerials' && (
                <button
                  onClick={() => onSwitchToVoice({ registration, run, runNumber })}
                  className="text-xs px-3 py-1.5 rounded-lg bg-mountain-600 hover:bg-mountain-500 text-white font-semibold"
                  title="Switch to voice dictation for this athlete"
                >
                  🎙 Voice Entry
                </button>
              )}
              <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl leading-none">×</button>
            </div>
          </div>

          {/* 1. Time — mogul only, at top */}
          {hasSpeed && (
            <div className="w-48">
              <label className="label">Finish Time (seconds)</label>
              <input type="number" step="0.01" className="input font-mono" placeholder="e.g. 26.54"
                value={runTime} onChange={e => setRunTime(e.target.value)} />
            </div>
          )}

          {/* 2. T&L Judges (mogul) — component breakdown or direct total */}
          {isMogul && componentScoring && (
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-1">T&L Judges</div>
              <div className="text-xs text-slate-600 mb-3">Enter components (Crv + UB + A/E − Ded) to auto-compute total, or enter total directly.</div>
              <div className="space-y-3">
                {tlJudges.map((j, i) => {
                  const hasComponents = j.carving !== '' || j.upperBody !== '' || j.absExt !== '' || j.deduction !== ''
                  return (
                    <div key={i} className="bg-slate-800/50 rounded-xl p-3">
                      <div className="text-xs text-slate-400 font-semibold mb-2">TL-{i + 1}</div>
                      <div className="grid grid-cols-5 gap-2 items-end">
                        <div>
                          <label className="label text-xs">Crv <span className="text-slate-600">0–10</span></label>
                          <input type="number" min="0" max="10" step="0.1"
                            className="input font-mono text-center text-sm px-1"
                            placeholder="–"
                            value={j.carving}
                            onChange={e => updateTLComponent(i, 'carving', e.target.value)} />
                        </div>
                        <div>
                          <label className="label text-xs">UB <span className="text-slate-600">0–5</span></label>
                          <input type="number" min="0" max="5" step="0.1"
                            className="input font-mono text-center text-sm px-1"
                            placeholder="–"
                            value={j.upperBody}
                            onChange={e => updateTLComponent(i, 'upperBody', e.target.value)} />
                        </div>
                        <div>
                          <label className="label text-xs">A/E <span className="text-slate-600">0–5</span></label>
                          <input type="number" min="0" max="5" step="0.1"
                            className="input font-mono text-center text-sm px-1"
                            placeholder="–"
                            value={j.absExt}
                            onChange={e => updateTLComponent(i, 'absExt', e.target.value)} />
                        </div>
                        <div>
                          <label className="label text-xs">Ded <span className="text-slate-600">0–20</span></label>
                          <input type="number" min="0" max="20" step="0.1"
                            className="input font-mono text-center text-sm px-1"
                            placeholder="–"
                            value={j.deduction}
                            onChange={e => updateTLComponent(i, 'deduction', e.target.value)} />
                        </div>
                        <div>
                          <label className="label text-xs">
                            Total <span className="text-slate-600">0.1–20</span>
                            {hasComponents && <span className="ml-1 text-blue-400 text-xs">(calc)</span>}
                          </label>
                          <input type="number" min="0.1" max="20" step="0.1"
                            className={`input font-mono text-center text-sm px-1 font-bold ${hasComponents ? 'bg-slate-700/60 text-blue-300' : ''}`}
                            placeholder="0.0"
                            value={j.total}
                            onChange={e => updateTLTotal(i, e.target.value)} />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 2b. T&L Judges (mogul, no component scoring) — Total + Deduction only */}
          {isMogul && !componentScoring && (
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-1">T&L Judges</div>
              <div className="text-xs text-slate-600 mb-3">Enter T&L total and deduction. Final score = Total − Deduction.</div>
              <div className="space-y-3">
                {tlJudges.map((j, i) => {
                  const computed = j.total !== '' ? Math.max(0.1, Math.min(20, (parseFloat(j.total) || 0) - (parseFloat(j.deduction) || 0))).toFixed(1) : ''
                  return (
                    <div key={i} className="bg-slate-800/50 rounded-xl p-3">
                      <div className="text-xs text-slate-400 font-semibold mb-2">TL-{i + 1}</div>
                      <div className="grid grid-cols-3 gap-2 items-end">
                        <div>
                          <label className="label text-xs">T&L Total <span className="text-slate-600">0–20</span></label>
                          <input type="number" min="0" max="20" step="0.1"
                            className="input font-mono text-center text-sm px-1"
                            placeholder="0.0"
                            value={j.total}
                            onChange={e => updateTLSimple(i, 'total', e.target.value)} />
                        </div>
                        <div>
                          <label className="label text-xs">Ded <span className="text-slate-600">0–20</span></label>
                          <input type="number" min="0" max="20" step="0.1"
                            className="input font-mono text-center text-sm px-1"
                            placeholder="0"
                            value={j.deduction}
                            onChange={e => updateTLSimple(i, 'deduction', e.target.value)} />
                        </div>
                        <div>
                          <label className="label text-xs">Final</label>
                          <div className="input font-mono text-center text-sm px-1 font-bold bg-slate-700/60 text-blue-300">
                            {computed || '–'}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 2. Form Judges (aerials) */}
          {!isMogul && (
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-2">Form Judges (0 – 10.0)</div>
              <div className="grid grid-cols-3 gap-3">
                {formScores.map((v, i) => (
                  <div key={i}>
                    <label className="label text-xs">Form-{i + 1}</label>
                    <input type="number" min="0" max="10" step="0.1"
                      className="input font-mono text-center" placeholder="0.0"
                      value={v} onChange={e => updateArr(setFormScores, i, e.target.value)} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 3. Jump Codes with autocomplete */}
          <div className={`grid ${numJumps >= 2 ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
            <JumpCodeInput id="jump1" label="Jump 1 Code" value={jump1Code} onChange={setJump1Code} codes={filteredJumpCodes} />
            {numJumps >= 2 && <JumpCodeInput id="jump2" label="Jump 2 Code" value={jump2Code} onChange={setJump2Code} codes={filteredJumpCodes} />}
          </div>

          {/* 4. Air Judges */}
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-2">Air Judges (0 – 10.0 per jump)</div>
            <div className="space-y-2">
              {air1Scores.map((_, i) => (
                <div key={i} className={`grid ${numJumps >= 2 ? 'grid-cols-3' : 'grid-cols-2'} gap-3 items-center`}>
                  <span className="text-slate-400 text-sm font-semibold">Air-{i + 1}</span>
                  <div>
                    <label className="label text-xs">Jump 1</label>
                    <input type="number" min="0" max="10" step="0.1"
                      className="input font-mono text-center" placeholder="0.0"
                      value={air1Scores[i]} onChange={e => updateArr(setAir1Scores, i, e.target.value)} />
                  </div>
                  {numJumps >= 2 && (
                    <div>
                      <label className="label text-xs">Jump 2</label>
                      <input type="number" min="0" max="10" step="0.1"
                        className="input font-mono text-center" placeholder="0.0"
                        value={air2Scores[i]} onChange={e => updateArr(setAir2Scores, i, e.target.value)} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Landing Judges (aerials only) */}
          {!isMogul && (
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-2">Landing Judges (0 – 10.0)</div>
              <div className="grid grid-cols-3 gap-3">
                {landingScores.map((v, i) => (
                  <div key={i}>
                    <label className="label text-xs">Landing-{i + 1}</label>
                    <input type="number" min="0" max="10" step="0.1"
                      className="input font-mono text-center" placeholder="0.0"
                      value={v} onChange={e => updateArr(setLandingScores, i, e.target.value)} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {error && <p className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">{error}</p>}

          {/* Footer */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-800">
            <div className="flex gap-2">
              {['DNS', 'DNF', 'DSQ'].map(s => (
                <button key={s} onClick={() => handleStatusClick(s)} disabled={isSaving}
                  className="text-sm font-semibold px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  {saving === s.toLowerCase() ? '...' : s}
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={onClose} disabled={isSaving} className="btn-ghost text-sm disabled:opacity-40">
                Cancel
              </button>
              <button onClick={handleSubmit} disabled={isSaving}
                className="btn-primary text-sm disabled:opacity-40 disabled:cursor-not-allowed">
                {saving === 'score' ? 'Saving...' : 'Submit Score'}
              </button>
            </div>
          </div>
        </div>
      </div>
      {statusConfirm && (
        <StatusConfirmDialog
          status={statusConfirm}
          athleteName={athleteName}
          submitting={isSaving}
          onConfirm={() => submitStatus(statusConfirm)}
          onCancel={() => setStatusConfirm(null)}
        />
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
// v2.0.00 (Step 3, R4) — venue-mode-only control: pin the permanent broadcast
// overlay (/overlay) to this event, overriding auto-follow. Renders nothing in
// cloud mode.
function VenueOverlayPinControl({ eventId }) {
  const [venue, setVenue] = useState(false)
  const [pinnedEventId, setPinnedEventId] = useState(null)
  const load = () => api.venueRoleTarget('overlay').then(t => setPinnedEventId(t.pinned_event_id || null)).catch(() => {})
  useEffect(() => {
    api.venueStatus().then(st => {
      if (st.mode === 'venue') { setVenue(true); load() }
    }).catch(() => {})
  }, [])
  if (!venue) return null
  const pinnedHere = pinnedEventId === eventId
  const toggle = async () => {
    try {
      await api.venueOverlayPin(pinnedHere ? null : eventId)
      load()
    } catch (e) { alert('Overlay pin failed: ' + e.message) }
  }
  return (
    <div className="mb-4 p-3 rounded-xl border border-slate-700 bg-slate-800/40 flex items-center justify-between">
      <div className="text-sm text-slate-400">
        Broadcast overlay: {pinnedHere
          ? <span className="text-amber-300">pinned to this event</span>
          : pinnedEventId
            ? <span className="text-slate-500">pinned to another event</span>
            : <span className="text-slate-500">following the action automatically</span>}
      </div>
      <button onClick={toggle} className="btn-secondary text-xs">
        {pinnedHere ? 'Unpin (auto-follow)' : 'Pin overlay to this event'}
      </button>
    </div>
  )
}

export default function EventDetail() {
  const { meetId, eventId } = useParams()
  const { user } = useAuth()
  const isJudge = user?.role === 'judge'
  const [event,         setEvent]         = useState(null)
  const [registrations, setRegistrations] = useState([])
  const [judges,        setJudges]        = useState([])
  const [activeTab,     setActiveTab]     = useState(isJudge ? 'Links' : 'Registrations')
  const [loading,       setLoading]       = useState(true)

  const refresh = async () => {
    const e = await api.getEvent(meetId, eventId)
    setEvent(e); setRegistrations(e.registrations||[]); setJudges(e.judges||[])
  }

  useEffect(() => { refresh().finally(()=>setLoading(false)) }, [eventId])

  // v2.0.00 (Step 1) — read-only mirror banner while the meet runs at the venue.
  // The server refuses every mutation with 423; this banner explains why.
  const [adoption, setAdoption] = useState(null)
  useEffect(() => {
    let alive = true
    const load = () => api.getMeetAdoption(meetId).then(a => { if (alive) setAdoption(a) }).catch(() => {})
    load()
    const id = setInterval(load, 15000)
    return () => { alive = false; clearInterval(id) }
  }, [meetId])

  if (loading) return <div className="p-8 text-slate-500">Loading...</div>
  if (!event)  return null

  const tabsToShow = isJudge
    ? ['Links']
    : event.discipline === 'dual_mogul'
      ? TABS.filter(t => !['Phases'].includes(t))
      : TABS.filter(t => t !== 'Dual Bracket')

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-6">
        <Link to="/dashboard" className="hover:text-white">Meets</Link>
        <span>/</span>
        <Link to={`/dashboard/meets/${meetId}`} className="hover:text-white">Meet</Link>
        <span>/</span>
        <span className="text-slate-300">{event.name}</span>
      </div>
      {adoption?.adopted && (
        <div className="mb-6 p-4 rounded-xl border border-amber-700 bg-amber-900/30 text-amber-200">
          <div className="font-semibold">🏔 This meet is running at the venue — this view is live but read-only.</div>
          <div className="text-sm text-amber-300/80 mt-1">
            All scoring and edits happen on the venue server and sync here automatically. Editing unlocks after the venue hands back or checks in.
          </div>
        </div>
      )}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-display text-4xl text-white">{event.name}</h1>
          <div className="flex items-center gap-3 mt-2 text-sm text-slate-500">
            <span className="bg-slate-800 px-2 py-0.5 rounded text-xs">
              {event.discipline === 'dual_mogul' ? 'Dual Mogul'
               : event.discipline === 'aerials'  ? 'Aerials'
               : 'Mogul'}
            </span>
            <span>{{ comp_series: 'Comp Series', devo: 'Devo', rqs_eqs: 'RQS/EQS', fis: 'FIS', open: 'Open', devo_junior: 'Devo/Junior' }[event.division] || event.division}</span>
            <span>{event.gender==='M'?'Male':'Female'}</span>
            {event.discipline === 'aerials' ? (
              // v1.25.00 (C-13) — v2 panel events show the panel model, not legacy roles
              event.aerials_panel_size != null ? (
                <span>Scoring Judges: {event.aerials_panel_size} (panel)</span>
              ) : (
              <>
                <span>Air Judges: {event.num_air_judges}</span>
                <span>Form Judges: {event.num_tl_judges}</span>
                <span>Landing Judges: {event.num_air_judges}</span>
              </>
              )
            ) : event.discipline === 'dual_mogul' ? (
              // Dual mogul uses 5-judge format
              <span className="text-slate-400 text-xs">5-Judge Format (Turns, Air, Time, Overall)</span>
            ) : (
              <>
                <span>T&L: {event.num_tl_judges}</span>
                <span>Air: {event.num_air_judges}</span>
              </>
            )}
            {event.pace_time && <span>Pace: {Number(event.pace_time).toFixed(2)}s</span>}
            {event.course_length && <span>Course: {event.course_length}m</span>}
          </div>
          {/* Course length / Pace time (read-only, set at meet level) */}
          {event.discipline !== 'aerials' && (event.course_length || event.pace_time) && (
            <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-500">
              <span>Set via Meet &gt; Course Specifications</span>
            </div>
          )}
        </div>
        {/* v1.25.00 (C-8) — labeled + confirmed; manual Complete bypasses the HJ finalize flow */}
        <label className="flex items-center gap-2 text-xs text-slate-500">
          Status
          <select className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300"
            value={event.status}
            onChange={async e => {
              const newStatus = e.target.value
              if (newStatus === event.status) return
              if (newStatus === 'complete' || event.status === 'complete') {
                const msg = newStatus === 'complete'
                  ? 'Mark this event Complete? The Head Judge finalize flow is the normal completion path — marking complete manually bypasses it. Continue?'
                  : `Change event status from Complete back to ${newStatus}? Editing after finalization can desync the review state.`
                if (!window.confirm(msg)) { e.target.value = event.status; return }
              }
              await api.updateEvent(meetId,eventId,{status:newStatus}); refresh()
            }}>
            <option value="setup">Setup</option>
            <option value="active">Active</option>
            <option value="complete">Complete</option>
          </select>
        </label>
      </div>
      <div className="flex gap-1 border-b border-slate-800 mb-6 overflow-x-auto">
        {tabsToShow.map(tab => (
          <button key={tab} onClick={()=>setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px
              ${activeTab===tab?'text-white border-blue-500':'text-slate-500 border-transparent hover:text-slate-300'}`}>
            {tab}
          </button>
        ))}
      </div>
      {activeTab==='Scoring' && <VenueOverlayPinControl eventId={eventId} />}
      {activeTab==='Registrations' && <RegistrationPanel event={event} registrations={registrations} onRefresh={refresh} />}
      {activeTab==='Event Setup'   && <EventSetupPanel event={event} judges={judges} onRefresh={refresh} />}
      {activeTab==='Links'         && <LinksPanel event={event} judges={judges} />}
      {activeTab==='Phases'        && <HeatsPanel event={event} registrations={registrations} onRefresh={refresh} />}
      {activeTab==='Scoring'       && event.discipline === 'dual_mogul' && <DualScoringPanel event={event} registrations={registrations} />}
      {activeTab==='Scoring'       && event.discipline !== 'dual_mogul' && <ScoringPanel event={event} registrations={registrations} />}
      {activeTab==='Results'       && <ResultsPanel event={event} meetId={meetId} />}
      {activeTab==='Dual Bracket'  && <DualBracketPanel event={event} registrations={registrations} />}
      {activeTab==='PDF Reports'   && <PdfReportsPanel event={event} />}
    </div>
  )
}
