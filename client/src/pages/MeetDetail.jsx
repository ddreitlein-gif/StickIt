import { useState, useEffect, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import api from '../utils/api'

const DISCIPLINE_LABEL = { mogul: 'Mogul', dual_mogul: 'Dual Mogul', aerials: 'Aerials' }
const DIVISION_LABEL = { comp_series: 'Comp Series', devo: 'Devo', rqs_eqs: 'RQS/EQS', fis: 'FIS', open: 'Open', devo_junior: 'Devo/Junior' }
const GENDER_LABEL = { M: 'Male', F: 'Female' }

// v1.18.00 — Event Type sanction categories. Drives aerials panel-size and HJ-scoring rules.
const EVENT_TYPE_LABEL = {
  fis_major:    'FIS OWG/WSC/WC',
  fis_nac:      'FIS NAC/NorAm',
  fis_other:    'FIS Other',
  usa_national: 'USA National',
  usa_regional: 'USA Regional',
}
const REDUCTION_LABEL = {
  sum_all:   'Sum all (no drops)',
  drop_high: 'Drop highest, sum rest',
  drop_low:  'Drop lowest, sum rest',
  average:   'Average all judges',
}
function aerialsRulesFor(et) {
  switch (et) {
    case 'fis_major':
    case 'fis_nac':      return { panelMin: 5, panelMax: 7, hjMayScore: false }
    case 'fis_other':    return { panelMin: 5, panelMax: 5, hjMayScore: false }
    case 'usa_national': return { panelMin: 2, panelMax: 5, hjMayScore: false }
    default:             return { panelMin: 2, panelMax: 5, hjMayScore: true }  // usa_regional
  }
}
const STATUS_COLOR = {
  setup: 'text-slate-400',
  active: 'text-green-400',
  complete: 'text-mountain-400'
}

const OFFICIAL_ROLES = [
  'Chief of Competition',
  'Chief of Score',
  'Technical Delegate',
  'Chief of Start',
  'Head Judge',
  'Competition Secretary',
]

function EventCard({ event, meetId, onDelete }) {
  return (
    <div className="card-sm hover:border-slate-600 hover:bg-slate-800/50 transition-all group relative">
      <Link
        to={`/dashboard/meets/${meetId}/events/${event.id}`}
        className="block"
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="font-semibold text-white group-hover:text-mountain-400 transition-colors">
              {event.name}
            </p>
            <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500">
              <span className="bg-slate-800 px-2 py-0.5 rounded">
                {DISCIPLINE_LABEL[event.discipline]}
              </span>
              <span>{DIVISION_LABEL[event.division]}</span>
              <span>{GENDER_LABEL[event.gender]}</span>
              <span className={STATUS_COLOR[event.status]}>● {event.status}</span>
            </div>
          </div>
          <div className="text-right text-xs text-slate-500 pr-16">
            <p>{event.athlete_count || 0} athletes</p>
            <p>{event.judge_count || 0} judges</p>
          </div>
        </div>
        <div className="mt-3 flex gap-4 text-xs text-slate-600">
          {event.discipline === 'aerials' ? (
            <>
              <span>Judges: {event.aerials_panel_size || event.num_air_judges || '?'}</span>
              <span>Jumps: {event.num_jumps || 2}</span>
              {event.event_type && <span>{EVENT_TYPE_LABEL[event.event_type] || event.event_type}</span>}
            </>
          ) : (
            <>
              <span>T&amp;L: {event.num_tl_judges}</span>
              <span>Air: {event.num_air_judges}</span>
              <span>Jumps: {event.num_jumps || 2}</span>
              {event.pace_time && <span>Pace: {event.pace_time}s</span>}
            </>
          )}
        </div>
      </Link>
      <button
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (confirm('WARNING: All data for this event will be permanently deleted. This action cannot be undone. Continue?')) {
            onDelete(event.id)
          }
        }}
        className="absolute top-3 right-3 text-xs px-2 py-1 rounded border border-red-800 text-red-500 active:bg-red-900/30 active:text-red-400 transition-colors"
      >
        Delete
      </button>
    </div>
  )
}

function CreateEventModal({ meetId, events = [], onClose, onCreate }) {
  const anyDivisional = events.some(e => e.is_divisional)
  const [form, setForm] = useState({
    discipline: 'mogul',
    division: 'comp_series',
    gender: 'M',
    name: '',
    num_tl_judges: 3,
    num_air_judges: 2,
    num_jumps: 2,
    has_speed: 1,
    turns_weight: 0.60,
    air_weight: 0.20,
    speed_weight: 0.20,
    has_small_final: 1,
    runoff_option: 'runoff_to_8th',
    component_scoring: 1,
    score_entry_mode: 'tablet',
    is_divisional: anyDivisional ? 1 : 0,
    // v1.18.00 — sanction + aerials config
    event_type: 'usa_regional',
    aerials_panel_size: 5,
    aerials_hj_scores: 0,
    aerials_reduction_method: 'sum_all',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Auto-generate event name
  useEffect(() => {
    const parts = [
      DIVISION_LABEL[form.division],
      GENDER_LABEL[form.gender],
      DISCIPLINE_LABEL[form.discipline],
    ]
    setForm(f => ({ ...f, name: parts.join(' ') }))
  }, [form.discipline, form.division, form.gender])

  // Auto-set category defaults based on division
  useEffect(() => {
    if (form.division === 'devo') {
      setForm(f => ({ ...f, num_tl_judges: 2, num_air_judges: 1, num_jumps: 1, has_speed: 0, component_scoring: 0 }))
    } else if (form.division === 'rqs_eqs') {
      setForm(f => ({ ...f, num_tl_judges: 2, num_air_judges: 1, num_jumps: 2, has_speed: 1, component_scoring: 0 }))
    } else if (form.division === 'comp_series') {
      setForm(f => ({ ...f, num_tl_judges: 3, num_air_judges: 2, num_jumps: 2, has_speed: 1, component_scoring: 1 }))
    }
  }, [form.discipline, form.division])

  // Auto-reset category to comp_series when switching to dual_mogul with unsupported category
  useEffect(() => {
    if (form.discipline === 'dual_mogul' && (form.division === 'devo' || form.division === 'rqs_eqs')) {
      setForm(f => ({ ...f, division: 'comp_series' }))
    }
  }, [form.discipline])

  // v1.18.00 — clamp aerials_panel_size to event-type bounds + clear hj_scores when not allowed.
  // When the discipline switches AWAY from aerials, reset aerials fields to defaults so a
  // later switch back doesn't carry stale values from the previous selection.
  useEffect(() => {
    if (form.discipline !== 'aerials') {
      setForm(f => (
        f.aerials_panel_size === 5 && f.aerials_hj_scores === 0 && f.aerials_reduction_method === 'sum_all'
          ? f  // already at defaults — no update (avoid render loop)
          : { ...f, aerials_panel_size: 5, aerials_hj_scores: 0, aerials_reduction_method: 'sum_all' }
      ))
      return
    }
    const rules = aerialsRulesFor(form.event_type)
    let n = parseInt(form.aerials_panel_size) || rules.panelMin
    if (n < rules.panelMin) n = rules.panelMin
    if (n > rules.panelMax) n = rules.panelMax
    setForm(f => ({
      ...f,
      aerials_panel_size: n,
      aerials_hj_scores: rules.hjMayScore ? f.aerials_hj_scores : 0,
      aerials_reduction_method: n <= 4 ? (f.aerials_reduction_method || 'sum_all') : null,
    }))
  }, [form.discipline, form.event_type])

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required'); return }
    setLoading(true)
    try {
      const event = await api.createEvent(meetId, {
        ...form,
        num_tl_judges: parseInt(form.num_tl_judges),
        num_air_judges: parseInt(form.num_air_judges),
        num_jumps: parseInt(form.num_jumps),
      })
      onCreate(event)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-lg my-4">
        <h2 className="font-display text-2xl text-white mb-6">Add Event</h2>
        <form onSubmit={submit} className="space-y-4">

          {/* v1.18.00 — Event Type (sanction). Top-level classifier; drives aerials rules. */}
          <div>
            <label className="label">Event Type</label>
            <select className="input" value={form.event_type} onChange={e => set('event_type', e.target.value)}>
              <option value="usa_regional">USA Regional</option>
              <option value="usa_national">USA National</option>
              <option value="fis_other">FIS Other</option>
              <option value="fis_nac">FIS NAC/NorAm</option>
              <option value="fis_major">FIS OWG/WSC/WC</option>
            </select>
          </div>

          {/* Discipline / Division / Gender */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Discipline</label>
              <select className="input" value={form.discipline} onChange={e => set('discipline', e.target.value)}>
                <option value="mogul">Mogul</option>
                <option value="dual_mogul">Dual Mogul</option>
                <option value="aerials">Aerials</option>
              </select>
            </div>
            <div>
              <label className="label">Category</label>
              <select className="input" value={form.division} onChange={e => set('division', e.target.value)}>
                <option value="comp_series">Comp Series</option>
                <option value="devo" disabled={form.discipline === 'dual_mogul'}>Devo</option>
                <option value="rqs_eqs" disabled={form.discipline === 'dual_mogul'}>RQS/EQS</option>
                <option value="fis" disabled>FIS (coming soon)</option>
              </select>
            </div>
            <div>
              <label className="label">Gender</label>
              <select className="input" value={form.gender} onChange={e => set('gender', e.target.value)}>
                <option value="M">Male</option>
                <option value="F">Female</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label">Event Name</label>
            <input
              className="input"
              value={form.name}
              onChange={e => set('name', e.target.value)}
            />
          </div>

          {/* Judge config (mogul/dual mogul only) */}
          {form.discipline !== 'aerials' && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="label">{'T&L Judges'}</label>
                <select className="input" value={form.num_tl_judges} onChange={e => set('num_tl_judges', e.target.value)}>
                  {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Air Judges</label>
                <select className="input" value={form.num_air_judges} onChange={e => set('num_air_judges', e.target.value)}>
                  {[1,2,3].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Jumps</label>
                <select className="input" value={form.num_jumps} onChange={e => set('num_jumps', parseInt(e.target.value))}>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                </select>
              </div>
              <div>
                <label className="label">Speed Scored?</label>
                <select className="input" value={form.has_speed} onChange={e => set('has_speed', parseInt(e.target.value))}>
                  <option value={1}>Yes</option>
                  <option value={0}>No</option>
                </select>
              </div>
            </div>
          )}

          {/* v1.18.00 — Aerials judge config replaces per-component pickers */}
          {form.discipline === 'aerials' && (() => {
            const rules = aerialsRulesFor(form.event_type)
            const sizes = []
            for (let n = rules.panelMin; n <= rules.panelMax; n++) sizes.push(n)
            const showReduction = form.aerials_panel_size <= 4
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Scoring Judges</label>
                    <select className="input" value={form.aerials_panel_size} onChange={e => set('aerials_panel_size', parseInt(e.target.value))}>
                      {sizes.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Jumps</label>
                    <select className="input" value={form.num_jumps} onChange={e => set('num_jumps', parseInt(e.target.value))}>
                      <option value={1}>1</option>
                      <option value={2}>2</option>
                    </select>
                  </div>
                </div>
                {showReduction && (
                  <div>
                    <label className="label">Reduction Method</label>
                    <select className="input" value={form.aerials_reduction_method || 'sum_all'} onChange={e => set('aerials_reduction_method', e.target.value)}>
                      <option value="sum_all">Sum all (no drops)</option>
                      <option value="drop_high">Drop highest, sum rest</option>
                      <option value="drop_low">Drop lowest, sum rest</option>
                      <option value="average">Average all judges</option>
                    </select>
                    <p className="text-xs text-slate-500 mt-1">Required for panels of 4 or fewer scoring judges. Choice prints on the calculation report.</p>
                  </div>
                )}
                {rules.hjMayScore && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-ice-500 focus:ring-ice-500"
                      checked={!!form.aerials_hj_scores}
                      onChange={e => set('aerials_hj_scores', e.target.checked ? 1 : 0)}
                    />
                    <span className="text-sm text-slate-400">Head Judge also scores (assign HJ to a numbered slot — USA Regional only)</span>
                  </label>
                )}
              </div>
            )
          })()}

          {form.discipline === 'mogul' && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">Component Scoring?</label>
                <select className="input" value={form.component_scoring} onChange={e => set('component_scoring', parseInt(e.target.value))}>
                  <option value={1}>Yes</option>
                  <option value={0}>No</option>
                </select>
              </div>
            </div>
          )}

          {form.discipline === 'aerials' && (
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-xs text-slate-400">
              Standard aerials: each scoring judge enters Air (0.0&ndash;2.0), Form (0.0&ndash;5.0), and Landing (0.0&ndash;3.0) for each jump.
              Per jump, total = (sum of kept Air + Form + Landing) &times; DD, truncated to two decimals.
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Score Entry</label>
              <select className="input" value={form.score_entry_mode} onChange={e => set('score_entry_mode', e.target.value)}>
                <option value="tablet">Tablet (Default)</option>
                <option value="paper">Paper Entry</option>
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-ice-500 focus:ring-ice-500"
              checked={!!form.is_divisional}
              onChange={e => set('is_divisional', e.target.checked ? 1 : 0)}
            />
            <span className="text-sm text-slate-400">Divisional Championship</span>
          </label>

          {/* Dual mogul options */}
          {form.discipline === 'dual_mogul' && (
            <div>
              <label className="label">Run Off to</label>
              <select className="input" value={form.runoff_option || 'runoff_to_8th'} onChange={e => set('runoff_option', e.target.value)}>
                <option value="runoff_to_4th">4th Place</option>
                <option value="runoff_to_8th">8th Place</option>
              </select>
            </div>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? 'Adding...' : 'Add Event'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Meet Status Panel ────────────────────────────────────────────────────────
function StatusPanel({ meetId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    api.getMeetStatus(meetId)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [meetId])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="card text-slate-500 text-sm">Loading status...</div>
  if (!data || data.events.length === 0) return null

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl text-white">Event Status</h2>
        <button onClick={load} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">Refresh</button>
      </div>
      <div className="overflow-x-auto">
        <table className="data-table text-xs">
          <thead>
            <tr>
              <th>Event</th>
              <th>Round</th>
              <th className="text-center">Registered</th>
              <th className="text-center">Scored</th>
              <th className="text-center">Remaining</th>
              <th>Leader</th>
            </tr>
          </thead>
          <tbody>
            {data.events.map(ev => {
              const regTotal = ev.reg_male + ev.reg_female
              const scoredTotal = ev.scored_male + ev.scored_female
              const remainingTotal = ev.remaining_male + ev.remaining_female
              const allDone = remainingTotal === 0 && regTotal > 0
              return (
                <tr key={ev.event_id}>
                  <td>
                    <div className="font-medium text-white">{ev.name}</div>
                    <div className="text-slate-500 mt-0.5">{ev.status}</div>
                  </td>
                  <td className="text-slate-400 font-mono">{ev.round}</td>
                  <td className="text-center font-mono text-slate-300">
                    {regTotal}
                  </td>
                  <td className="text-center font-mono text-green-400">
                    {scoredTotal}
                  </td>
                  <td className="text-center font-mono">
                    <span className={allDone ? 'text-mountain-400' : 'text-amber-400'}>
                      {remainingTotal}
                    </span>
                  </td>
                  <td className="text-slate-300">
                    {ev.leader_name
                      ? <span>{ev.leader_name} <span className="text-mountain-400 font-mono ml-1">{Number(ev.leader_score).toFixed(2)}</span></span>
                      : <span className="text-slate-600">--</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Clone Meet Modal ─────────────────────────────────────────────────────────
function CloneMeetModal({ meetId, sourceName, onClose, onCloned }) {
  const [form, setForm] = useState({
    name: `${sourceName} (Copy)`,
    date: '',
    location: '',
    includeAthletes: false,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim() || !form.date || !form.location.trim()) {
      setError('Name, date, and location are required.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const newMeet = await api.cloneMeet(meetId, form)
      onCloned(newMeet)
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
        <h2 className="font-display text-2xl text-white mb-1">Clone Meet</h2>
        <p className="text-slate-500 text-sm mb-6">
          Copies all events and configuration from <span className="text-slate-300">{sourceName}</span>.
          Scores and run history are not copied.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">New Meet Name</label>
            <input className="input" value={form.name} onChange={e => set('name', e.target.value)} />
          </div>
          <div>
            <label className="label">Start Date</label>
            <input type="date" className="input" value={form.date} onChange={e => set('date', e.target.value)} />
          </div>
          <div>
            <label className="label">Location</label>
            <input className="input" value={form.location} placeholder="Venue / mountain name"
              onChange={e => set('location', e.target.value)} />
          </div>
          <div className="flex items-center gap-3">
            <input
              id="includeAthletes"
              type="checkbox"
              className="w-4 h-4 accent-mountain-500"
              checked={form.includeAthletes}
              onChange={e => set('includeAthletes', e.target.checked)}
            />
            <label htmlFor="includeAthletes" className="text-sm text-slate-300 cursor-pointer">
              Copy athlete registrations (without scores or run order)
            </label>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? 'Cloning...' : 'Clone Meet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Officials Panel ──────────────────────────────────────────────────────────
function OfficialsPanel({ meetId }) {
  const [officials, setOfficials] = useState([])
  const [form, setForm] = useState({ role: OFFICIAL_ROLES[0], name: '' })
  const [editId, setEditId] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [error, setError] = useState('')

  const load = () => api.getOfficials(meetId).then(setOfficials).catch(() => {})

  useEffect(() => { load() }, [meetId])

  const add = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required'); return }
    setError('')
    try { await api.addOfficial(meetId, form); setForm(f => ({ ...f, name: '' })); load() }
    catch (err) { setError(err.message) }
  }

  const saveEdit = async (id) => {
    try { await api.updateOfficial(meetId, id, editForm); setEditId(null); load() }
    catch (err) { setError(err.message) }
  }

  const remove = async (id) => {
    if (!confirm('Remove this official?')) return
    await api.removeOfficial(meetId, id); load()
  }

  return (
    <div className="card space-y-4">
      <h2 className="font-display text-xl text-white">Meet Officials</h2>
      {officials.length > 0 ? (
        <table className="data-table">
          <thead><tr><th>Role</th><th>Name</th><th></th></tr></thead>
          <tbody>
            {officials.map(o => (
              <tr key={o.id}>
                {editId === o.id ? (
                  <>
                    <td>
                      <select className="input input-sm" value={editForm.role}
                        onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}>
                        {OFFICIAL_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td>
                      <input className="input input-sm" value={editForm.name}
                        onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
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
                    <td className="flex gap-3">
                      <button onClick={() => { setEditId(o.id); setEditForm({ role: o.role, name: o.name }) }}
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
        <p className="text-slate-500 text-sm">No officials assigned yet.</p>
      )}
      <form onSubmit={add} className="grid grid-cols-3 gap-3 items-end pt-2 border-t border-slate-800">
        <div>
          <label className="label">Role</label>
          <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
            {OFFICIAL_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Name</label>
          <input className="input" value={form.name} placeholder="Full name"
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>
        <div>
          <button type="submit" className="btn-primary w-full">Add Official</button>
        </div>
      </form>
      {error && <p className="text-red-400 text-sm">{error}</p>}
    </div>
  )
}

// ── Course Specifications Panel ───────────────────────────────────────────────
// ── Division dropdown ─────────────────────────────────────────────────────────
const DIVISION_OPTIONS = ['Alaska', 'Northwest', 'Far West', 'Intermountain', 'Rocky', 'Central', 'Eastern', 'National Event', 'Other']

function MeetRankingField({ meetId, value, onSave }) {
  const [saving, setSaving] = useState(false)

  const save = async (newVal) => {
    setSaving(true)
    try { await api.updateMeet(meetId, { meet_ranking: newVal || null }); onSave() }
    catch {} finally { setSaving(false) }
  }

  const isLegacy = value && !DIVISION_OPTIONS.includes(value)

  return (
    <select
      className="bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-xs text-white font-mono outline-none focus:border-blue-500"
      value={value || ''}
      disabled={saving}
      onChange={e => save(e.target.value)}
    >
      <option value="">— select —</option>
      {isLegacy && <option value={value} disabled>{value}</option>}
      {DIVISION_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
    </select>
  )
}

function CourseSpecsPanel({ meetId }) {
  const [spec, setSpec] = useState(null)
  const [form, setForm] = useState({ course_name: '', width_m: '', length_m: '', pitch_deg: '' })
  const [overrideM, setOverrideM] = useState(false)
  const [overrideF, setOverrideF] = useState(false)
  const [overrideValM, setOverrideValM] = useState('')
  const [overrideValF, setOverrideValF] = useState('')
  const [paceStandard, setPaceStandard] = useState('usss')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const PACE_SPEEDS = {
    usss: { M: 9.70, F: 8.20 },
    fis:  { M: 10.30, F: 9.00 },
  }

  const calcPace = (len, gender) => {
    const l = parseFloat(len)
    if (!l || l <= 0) return null
    const speeds = PACE_SPEEDS[paceStandard] || PACE_SPEEDS.usss
    const speed = gender === 'F' ? speeds.F : speeds.M
    return (l / speed).toFixed(2)
  }

  const load = async () => {
    try {
      const data = await api.getCourseSpec(meetId)
      setSpec(data)
      if (data) {
        setForm({ course_name: data.course_name || '', width_m: data.width_m || '', length_m: data.length_m || '', pitch_deg: data.pitch_deg || '' })
        if (data.pace_standard) setPaceStandard(data.pace_standard)
        if (data.pace_time_override_m != null) {
          setOverrideM(true)
          setOverrideValM(data.pace_time_override_m)
        }
        if (data.pace_time_override_f != null) {
          setOverrideF(true)
          setOverrideValF(data.pace_time_override_f)
        }
      }
    } catch {}
  }

  useEffect(() => { load() }, [meetId])

  const save = async () => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await api.saveCourseSpec(meetId, {
        course_name: form.course_name || null,
        width_m:  form.width_m  ? parseFloat(form.width_m)  : null,
        length_m: form.length_m ? parseFloat(form.length_m) : null,
        pitch_deg: form.pitch_deg ? parseFloat(form.pitch_deg) : null,
        pace_time_override_m: overrideM && overrideValM ? parseFloat(overrideValM) : null,
        pace_time_override_f: overrideF && overrideValF ? parseFloat(overrideValF) : null,
        pace_standard: paceStandard,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      load()
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  const paceM = calcPace(form.length_m, 'M')
  const paceF = calcPace(form.length_m, 'F')

  return (
    <div className="card space-y-4">
      <h2 className="font-display text-xl text-white">Course Specifications</h2>
      <div>
        <label className="label">Course Name</label>
        <input className="input" value={form.course_name} placeholder="e.g. Outhouse"
          onChange={e => setForm(f => ({ ...f, course_name: e.target.value }))} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="label">Width (m)</label>
          <input type="number" step="0.1" className="input" value={form.width_m} placeholder="e.g. 20"
            onChange={e => setForm(f => ({ ...f, width_m: e.target.value }))} />
        </div>
        <div>
          <label className="label">Length (m)</label>
          <input type="number" step="0.1" className="input" value={form.length_m} placeholder="e.g. 235"
            onChange={e => setForm(f => ({ ...f, length_m: e.target.value }))} />
        </div>
        <div>
          <label className="label">Pitch (deg)</label>
          <input type="number" step="0.1" className="input" value={form.pitch_deg} placeholder="e.g. 28"
            onChange={e => setForm(f => ({ ...f, pitch_deg: e.target.value }))} />
        </div>
      </div>

      {/* Pace time display / overrides */}
      <div className="border-t border-slate-800 pt-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm text-slate-400">Pace Time (Length / Speed)</div>
          <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-0.5">
            <button
              onClick={() => setPaceStandard('usss')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${paceStandard === 'usss' ? 'bg-mountain-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >USSS</button>
            <button
              onClick={() => setPaceStandard('fis')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${paceStandard === 'fis' ? 'bg-mountain-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >FIS</button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {/* Men */}
          <div className="bg-slate-900 rounded-lg p-3 border border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-300">Men ({(PACE_SPEEDS[paceStandard] || PACE_SPEEDS.usss).M.toFixed(2)} m/s)</span>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-xs text-slate-500">Override</span>
                <input type="checkbox" checked={overrideM}
                  onChange={e => { setOverrideM(e.target.checked); if (!e.target.checked) setOverrideValM('') }}
                  className="accent-emerald-500" />
              </label>
            </div>
            {overrideM ? (
              <input type="number" step="0.01" className="input text-lg font-mono"
                value={overrideValM} placeholder={paceM || '--'}
                onChange={e => setOverrideValM(e.target.value)} />
            ) : (
              <div className="text-2xl font-mono font-bold text-emerald-400">
                {paceM ? `${paceM}s` : '--'}
              </div>
            )}
          </div>
          {/* Women */}
          <div className="bg-slate-900 rounded-lg p-3 border border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-300">Women ({(PACE_SPEEDS[paceStandard] || PACE_SPEEDS.usss).F.toFixed(2)} m/s)</span>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-xs text-slate-500">Override</span>
                <input type="checkbox" checked={overrideF}
                  onChange={e => { setOverrideF(e.target.checked); if (!e.target.checked) setOverrideValF('') }}
                  className="accent-emerald-500" />
              </label>
            </div>
            {overrideF ? (
              <input type="number" step="0.01" className="input text-lg font-mono"
                value={overrideValF} placeholder={paceF || '--'}
                onChange={e => setOverrideValF(e.target.value)} />
            ) : (
              <div className="text-2xl font-mono font-bold text-emerald-400">
                {paceF ? `${paceF}s` : '--'}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? 'Saving...' : 'Save Course'}
        </button>
        {saved && <span className="text-green-400 text-sm">Saved -- pace times updated on all events</span>}
        {error && <span className="text-red-400 text-sm">{error}</span>}
      </div>
    </div>
  )
}

function CloseExportModal({ meetId, onClose, onClosed }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [problems, setProblems] = useState(null)
  const [busy, setBusy] = useState(false)

  const doExport = async (force) => {
    setBusy(true)
    try {
      const r = await fetch(`/api/meets/${meetId}/close${force ? '?force=true' : ''}`, { method: 'POST' })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        if (err.problems) { setProblems(err.problems); setBusy(false); return }
        throw new Error(err.error || 'Close failed')
      }
      const blob = await r.blob()
      const cd = r.headers.get('Content-Disposition') || ''
      const m = cd.match(/filename="([^"]+)"/)
      const name = m ? m[1] : 'export.zip'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = name; a.click()
      URL.revokeObjectURL(url)
      onClosed && onClosed()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`/api/meets/${meetId}/close-validation`)
        const data = await r.json()
        if (cancelled) return
        if (!r.ok || data.error) {
          setError(data.error || 'Validation failed')
          setLoading(false)
          return
        }
        if (!data.problems || data.problems.length === 0) {
          setLoading(false)
          doExport(false)
        } else {
          setProblems(data.problems)
          setLoading(false)
        }
      } catch (e) {
        if (!cancelled) { setError(e.message); setLoading(false) }
      }
    })()
    return () => { cancelled = true }
  }, [meetId])

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="font-display text-2xl text-white mb-4">Close Meet and Export to USSS</h2>

          {loading && <p className="text-slate-400">Validating meet...</p>}

          {error && (
            <>
              <div className="bg-red-900/30 border border-red-800 rounded p-4 text-red-300 text-sm whitespace-pre-wrap">{error}</div>
              <div className="mt-6 flex justify-end">
                <button onClick={onClose} className="btn-secondary">Cancel</button>
              </div>
            </>
          )}

          {!loading && !error && problems && (
            <>
              <p className="text-slate-300 mb-4">The following issues were found.  You may continue and export anyway, or cancel and fix them first.</p>
              <div className="space-y-4">
                {problems.map((ev, i) => (
                  <div key={i} className="bg-slate-800/50 border border-slate-700 rounded p-3">
                    <div className="text-white font-semibold text-sm mb-2">{ev.eventName}</div>
                    <ul className="text-orange-300 text-xs list-disc ml-5 space-y-1">
                      {ev.problems.map((p, j) => <li key={j}>{p}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button onClick={onClose} disabled={busy} className="btn-secondary">Cancel</button>
                <button onClick={() => doExport(true)} disabled={busy} className="btn-primary">
                  {busy ? 'Exporting...' : 'Continue Export Anyway'}
                </button>
              </div>
            </>
          )}

          {!loading && !error && !problems && (
            <p className="text-slate-400">Generating export...</p>
          )}
        </div>
      </div>
    </div>
  )
}

function EditMeetModal({ meet, onClose, onSave }) {
  const [form, setForm] = useState({ name: meet.name || '', location: meet.location || '', date: meet.date || '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim() || !form.location.trim() || !form.date) { setError('All fields are required.'); return }
    setLoading(true)
    try {
      await api.updateMeet(meet.id, form)
      onSave()
      onClose()
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md">
        <h2 className="font-display text-2xl text-white mb-6">Edit Meet Settings</h2>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Meet Name</label>
            <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Location / Venue</label>
            <input className="input" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} />
          </div>
          <div>
            <label className="label">Start Date</label>
            <input type="date" className="input" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">{loading ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function MeetDetail() {
  const { meetId } = useParams()
  const navigate = useNavigate()
  const [meet, setMeet] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editingStatus, setEditingStatus] = useState(false)
  const [showClone, setShowClone] = useState(false)
  const [showCloseExport, setShowCloseExport] = useState(false)
  const [showEditMeet, setShowEditMeet] = useState(false)
  const [writeCount, setWriteCount] = useState(null)

  const reopenMeet = async () => {
    if (!window.confirm('Reopen this meet?  All events in this meet will return to active status.')) return
    try {
      const r = await fetch(`/api/meets/${meetId}/reopen`, { method: 'POST' })
      if (!r.ok) throw new Error('Reopen failed')
      await refreshMeet()
    } catch (e) { alert(e.message) }
  }

  useEffect(() => {
    api.getMeet(meetId, { excludeLocked: true })
      .then(setMeet)
      .catch(() => navigate('/dashboard'))
      .finally(() => setLoading(false))
  }, [meetId])

  // Poll write counter every 10 seconds for autosave indicator
  useEffect(() => {
    const poll = () => api.health().then(h => setWriteCount(h.writes)).catch(() => {})
    poll()
    const id = setInterval(poll, 10000)
    return () => clearInterval(id)
  }, [])

  const refreshMeet = () => api.getMeet(meetId, { excludeLocked: true }).then(setMeet).catch(() => {})

  const downloadTdReport = async () => {
    try {
      const res = await fetch('/api/pdf/td-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meetId }) })
      if (!res.ok) throw new Error('Failed to generate TD Report')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `TD_Report_${(meet?.name || meetId).replace(/[^a-zA-Z0-9]/g, '_')}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('TD Report generation failed: ' + err.message)
    }
  }

  const handleEventCreate = (event) => {
    setMeet(m => ({ ...m, events: [...(m.events || []), event] }))
  }

  const handleCloned = (newMeet) => {
    navigate(`/dashboard/meets/${newMeet.id}`)
  }

  const handleEventDelete = async (eventId) => {
    await api.deleteEvent(meetId, eventId)
    setMeet(m => ({ ...m, events: m.events.filter(e => e.id !== eventId) }))
  }

  const setMeetStatus = async (status) => {
    const updated = await api.updateMeet(meetId, { status })
    setMeet(m => ({ ...m, status: updated.status }))
    setEditingStatus(false)
  }

  if (loading) return <div className="p-8 text-slate-500">Loading...</div>
  if (!meet) return null

  const events = meet.events || []
  const mogulEvents   = events.filter(e => e.discipline === 'mogul')
  const dualEvents    = events.filter(e => e.discipline === 'dual_mogul')
  const aerialsEvents = events.filter(e => e.discipline === 'aerials')

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-6">
        <Link to="/dashboard" className="hover:text-white transition-colors">Meets</Link>
        <span>/</span>
        <span className="text-slate-300">{meet.name}</span>
      </div>

      {/* Meet header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-display text-4xl text-white tracking-wide">{meet.name}</h1>
          <div className="flex items-center gap-4 mt-2 text-slate-500 text-sm">
            <span>📍 {meet.location}</span>
            <span>📅 {new Date(meet.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>
          </div>
          <button onClick={() => setShowEditMeet(true)} className="text-xs text-slate-500 hover:text-mountain-400 mt-1 transition-colors">Edit Meet Settings</button>
          <div className="mt-3 flex items-center gap-3">
            <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold uppercase tracking-wide border
              ${meet.status === 'active' ? 'bg-green-900/50 text-green-400 border-green-800' :
                meet.status === 'complete' ? 'bg-mountain-900/50 text-mountain-400 border-mountain-800' :
                'bg-slate-800 text-slate-400 border-slate-700'}`}>
              {meet.status}
            </span>
            <select
              className="bg-transparent text-xs text-slate-600 hover:text-slate-400 cursor-pointer"
              value={meet.status}
              onChange={e => setMeetStatus(e.target.value)}
            >
              <option value="setup">Setup</option>
              <option value="active">Active</option>
              <option value="complete">Complete</option>
            </select>
            {writeCount !== null && (
              <span className="text-xs text-slate-600" title="Write operations since server start">
                autosave: {writeCount} writes
              </span>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
            <span>Division:</span>
            <MeetRankingField meetId={meetId} value={meet.meet_ranking} onSave={refreshMeet} />
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={downloadTdReport} className="btn-secondary text-sm">
            TD Report
          </button>
          {meet.status === 'active' && (
            <button onClick={() => setShowCloseExport(true)} className="btn-ghost text-sm text-orange-400 border-orange-800 hover:bg-orange-900/30">
              Close Meet and Export to USSS
            </button>
          )}
          {meet.status === 'complete' && (
            <button onClick={reopenMeet} className="btn-ghost text-sm">
              Reopen Meet
            </button>
          )}
          <button
            onClick={() => window.open(`/api/meets/${meet.id}/export`, '_blank')}
            className="btn-secondary text-sm"
          >
            Export Meet
          </button>
          <button onClick={() => setShowClone(true)} className="btn-secondary text-sm">
            Clone Meet
          </button>
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            + Add Event
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Events',      value: events.length },
          { label: 'Mogul Events',      value: mogulEvents.length },
          { label: 'Dual Mogul Events', value: dualEvents.length },
          { label: 'Aerials Events',    value: aerialsEvents.length },
        ].map(s => (
          <div key={s.label} className="stat-box">
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Events */}
      {events.length === 0 ? (
        <div className="card text-center py-16">
          <p className="text-4xl mb-4">🏁</p>
          <p className="text-slate-400">No events yet.</p>
          <p className="text-slate-600 text-sm mt-1">Add a mogul, dual mogul, or aerials event to get started.</p>
          <button onClick={() => setShowCreate(true)} className="btn-primary mt-6">Add First Event</button>
        </div>
      ) : (
        <div className="space-y-6">
          {mogulEvents.length > 0 && (
            <div>
              <h2 className="font-display text-xl text-slate-400 tracking-wide mb-3">MOGUL EVENTS</h2>
              <div className="grid gap-3">
                {mogulEvents.map(e => (
                  <EventCard key={e.id} event={e} meetId={meetId} onDelete={handleEventDelete} />
                ))}
              </div>
            </div>
          )}
          {dualEvents.length > 0 && (
            <div>
              <h2 className="font-display text-xl text-slate-400 tracking-wide mb-3">DUAL MOGUL EVENTS</h2>
              <div className="grid gap-3">
                {dualEvents.map(e => (
                  <EventCard key={e.id} event={e} meetId={meetId} onDelete={handleEventDelete} />
                ))}
              </div>
            </div>
          )}
          {aerialsEvents.length > 0 && (
            <div>
              <h2 className="font-display text-xl text-slate-400 tracking-wide mb-3">AERIALS EVENTS</h2>
              <div className="grid gap-3">
                {aerialsEvents.map(e => (
                  <EventCard key={e.id} event={e} meetId={meetId} onDelete={handleEventDelete} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {showCreate && (
        <CreateEventModal
          meetId={meetId}
          events={meet.events || []}
          onClose={() => setShowCreate(false)}
          onCreate={handleEventCreate}
        />
      )}

      {showClone && (
        <CloneMeetModal
          meetId={meetId}
          sourceName={meet.name}
          onClose={() => setShowClone(false)}
          onCloned={handleCloned}
        />
      )}

      {showCloseExport && (
        <CloseExportModal
          meetId={meetId}
          onClose={() => setShowCloseExport(false)}
          onClosed={async () => { setShowCloseExport(false); await refreshMeet() }}
        />
      )}

      {showEditMeet && (
        <EditMeetModal
          meet={meet}
          onClose={() => setShowEditMeet(false)}
          onSave={refreshMeet}
        />
      )}

      {/* Meet Status Dashboard */}
      <div className="mt-8">
        <StatusPanel meetId={meetId} />
      </div>

      {/* Course Specifications */}
      <div className="mt-8">
        <CourseSpecsPanel meetId={meetId} />
      </div>
    </div>
  )
}
