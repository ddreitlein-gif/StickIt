import { useState, useEffect } from 'react'
import api from '../utils/api'
import StatusConfirmDialog from './StatusConfirmDialog'

// v1.25.00 (C-7) — manual entry / edit for aerials v2 events.
// One row per scoring judge; Air (0.0–2.0) / Form (0.0–5.0) / Landing (0.0–3.0)
// per jump, mirroring the HJ tablet's v2 grid. Submits the aerials_v2 payload to
// the same manual-entry / manual-score endpoints; math runs through
// calcAerialsScoreV2 server-side, identical to the live tablet path.
const COMPONENTS = [
  { key: 'air',     label: 'Air',  max: 2.0 },
  { key: 'form',    label: 'Form', max: 5.0 },
  { key: 'landing', label: 'Land', max: 3.0 },
]

export default function AerialsV2ManualModal({ event, mode, run, registration, runNumber = 1, onClose, onSuccess }) {
  const panelSize = parseInt(event.aerials_panel_size) || 5
  const numJumps = event.num_jumps || 2
  const jumps = numJumps >= 2 ? [1, 2] : [1]

  const athleteName = mode === 'edit'
    ? `${run.first_name} ${run.last_name}`
    : `${registration.first_name} ${registration.last_name}`
  const athleteBib = mode === 'edit' ? run.bib_number : registration.bib_number

  // grid[judge_number][jump] = { air: '', form: '', landing: '' }
  const mkGrid = () => {
    const g = {}
    for (let jn = 1; jn <= panelSize; jn++) {
      g[jn] = {}
      for (const jp of jumps) g[jn][jp] = { air: '', form: '', landing: '' }
    }
    return g
  }
  const [grid, setGrid] = useState(mkGrid)
  const [jump1Code, setJump1Code] = useState('')
  const [jump2Code, setJump2Code] = useState('')
  const [jumpCodes, setJumpCodes] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [statusConfirm, setStatusConfirm] = useState(null)

  useEffect(() => {
    fetch(`/api/jump-dds?discipline=aerials&gender=${event.gender || 'M'}&ruleset=uss`)
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        if (Array.isArray(data)) {
          const seen = new Set()
          setJumpCodes(data.filter(d => { if (seen.has(d.jump_code)) return false; seen.add(d.jump_code); return true }))
        }
      })
      .catch(() => {})

    if (mode !== 'edit') return
    if (run.jump1_code) setJump1Code(run.jump1_code)
    if (run.jump2_code) setJump2Code(run.jump2_code)
    api.getRunScores(event.id, run.id).then(scores => {
      setGrid(g => {
        const next = JSON.parse(JSON.stringify(g))
        for (const s of scores) {
          if (!/^ae_/.test(s.score_type) || !s.judge_number) continue
          const jp = /_j1$/.test(s.score_type) ? 1 : 2
          if (!next[s.judge_number] || !next[s.judge_number][jp]) continue
          if (/^ae_air_/.test(s.score_type)) next[s.judge_number][jp].air = String(s.raw_score)
          if (/^ae_form_/.test(s.score_type)) next[s.judge_number][jp].form = String(s.raw_score)
          if (/^ae_land_/.test(s.score_type)) next[s.judge_number][jp].landing = String(s.raw_score)
        }
        return next
      })
    }).catch(() => {})
  }, [])

  const setCell = (jn, jp, comp, val) => {
    setGrid(g => ({ ...g, [jn]: { ...g[jn], [jp]: { ...g[jn][jp], [comp]: val } } }))
  }

  const cellInvalid = (val, max) => {
    if (val === '') return false
    const n = parseFloat(val)
    return isNaN(n) || n < 0 || n > max
  }

  const submitStatus = async (status) => {
    setSaving(true); setError('')
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
    } catch (err) { setError(err.message); setSaving(false); setStatusConfirm(null) }
  }

  const handleSubmit = async () => {
    setError('')
    // Validate
    if (!jump1Code.trim()) { setError('Jump 1 code is required.'); return }
    if (numJumps >= 2 && !jump2Code.trim()) { setError('Jump 2 code is required.'); return }
    const judge_scores = []
    for (let jn = 1; jn <= panelSize; jn++) {
      for (const jp of jumps) {
        const c = grid[jn][jp]
        for (const comp of COMPONENTS) {
          if (c[comp.key] === '') { setError(`Judge ${jn} jump ${jp}: ${comp.label} is required.`); return }
          if (cellInvalid(c[comp.key], comp.max)) { setError(`Judge ${jn} jump ${jp}: ${comp.label} must be 0.0–${comp.max.toFixed(1)}.`); return }
        }
        judge_scores.push({
          judge_number: jn, jump: jp,
          air: parseFloat(c.air), form: parseFloat(c.form), landing: parseFloat(c.landing),
        })
      }
    }
    const body = {
      aerials_v2: true,
      judge_scores,
      jump1_code: jump1Code.trim(),
      jump2_code: numJumps >= 2 ? jump2Code.trim() : null,
    }
    setSaving(true)
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
    } catch (err) { setError(err.message); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 space-y-5">

          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-display font-bold text-white">
                {mode === 'edit' ? 'Edit Score (Aerials Panel)' : 'Manual Score Entry (Aerials Panel)'}
              </h2>
              <div className="text-slate-400 text-sm mt-0.5">
                <span className="font-mono text-slate-300">Bib #{athleteBib}</span>
                <span className="mx-2 text-slate-600">·</span>
                <span className="text-white font-semibold">{athleteName}</span>
                <span className="mx-2 text-slate-600">·</span>
                <span>{panelSize}-judge panel · {event.aerials_reduction_method || 'sum_all'}</span>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl leading-none">×</button>
          </div>

          {/* Jump codes */}
          <div className={`grid ${numJumps >= 2 ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
            {[{ id: 'ae-jump1', label: 'Jump 1 Code', value: jump1Code, set: setJump1Code },
              ...(numJumps >= 2 ? [{ id: 'ae-jump2', label: 'Jump 2 Code', value: jump2Code, set: setJump2Code }] : [])
            ].map(jc => (
              <div key={jc.id}>
                <label className="label">{jc.label}</label>
                <input list={`${jc.id}-list`} className="input font-mono" placeholder="type or select..."
                  value={jc.value} onChange={e => jc.set(e.target.value)} />
                <datalist id={`${jc.id}-list`}>
                  {jumpCodes.map(d => <option key={d.jump_code} value={d.jump_code}>{d.jump_code} (DD {d.dd_value})</option>)}
                </datalist>
              </div>
            ))}
          </div>

          {/* Per-judge grid */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-400 uppercase tracking-wide">
                  <th className="text-left py-1 pr-2">Judge</th>
                  {jumps.map(jp => COMPONENTS.map(c => (
                    <th key={`${jp}-${c.key}`} className="px-1 py-1 text-center">
                      J{jp} {c.label}
                      <div className="text-slate-600 normal-case font-normal">0–{c.max.toFixed(1)}</div>
                    </th>
                  )))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: panelSize }, (_, i) => i + 1).map(jn => (
                  <tr key={jn} className="border-t border-slate-800">
                    <td className="py-2 pr-2 text-slate-300 font-semibold whitespace-nowrap">Judge {jn}</td>
                    {jumps.map(jp => COMPONENTS.map(c => (
                      <td key={`${jp}-${c.key}`} className="px-1 py-2">
                        <input type="number" min="0" max={c.max} step="0.1"
                          className={`input font-mono text-center text-sm px-1 w-16 ${cellInvalid(grid[jn][jp][c.key], c.max) ? 'border-red-500' : ''}`}
                          placeholder="–"
                          value={grid[jn][jp][c.key]}
                          onChange={e => setCell(jn, jp, c.key, e.target.value)} />
                      </td>
                    )))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Error */}
          {error && <p className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">{error}</p>}

          {/* Footer */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-800">
            <div className="flex gap-2">
              {['DNS', 'DNF', 'DSQ'].map(s => (
                <button key={s} onClick={() => setStatusConfirm(s)} disabled={saving}
                  className="text-sm font-semibold px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  {s}
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={onClose} disabled={saving} className="btn-ghost text-sm disabled:opacity-40">Cancel</button>
              <button onClick={handleSubmit} disabled={saving}
                className="btn-primary text-sm disabled:opacity-40 disabled:cursor-not-allowed">
                {saving ? 'Saving...' : 'Submit Score'}
              </button>
            </div>
          </div>
        </div>
      </div>
      {statusConfirm && (
        <StatusConfirmDialog
          status={statusConfirm}
          athleteName={athleteName}
          submitting={saving}
          onConfirm={() => submitStatus(statusConfirm)}
          onCancel={() => setStatusConfirm(null)}
        />
      )}
    </div>
  )
}
