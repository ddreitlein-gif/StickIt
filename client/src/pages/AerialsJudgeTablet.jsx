import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import useResolveIds from '../hooks/useResolveIds'

// Quick-select score buttons: 0.0 through 10.0 in 0.5 steps
function ScoreButtons({ value, onChange }) {
  const steps = []
  for (let v = 0; v <= 10; v += 0.5) steps.push(v)
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {steps.map(v => (
        <button
          key={v}
          onClick={() => onChange(v.toFixed(1))}
          className={`w-12 h-9 rounded text-sm font-mono font-semibold transition-colors
            ${parseFloat(value) === v
              ? 'bg-blue-600 text-white'
              : 'bg-slate-700 text-slate-200 hover:bg-slate-600'}`}
        >
          {v.toFixed(1)}
        </button>
      ))}
    </div>
  )
}

function ScoreField({ label, value, onChange }) {
  return (
    <div className="mb-4">
      <label className="block text-slate-300 text-sm font-medium mb-1">{label}</label>
      <div className="flex items-center gap-3 mb-1">
        <input
          type="number" min="0" max="10" step="0.1"
          className="w-24 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-lg font-mono text-center focus:outline-none focus:border-blue-500"
          value={value}
          onChange={e => onChange(e.target.value)}
        />
        <span className="text-slate-500 text-sm">/ 10.0</span>
      </div>
      <ScoreButtons value={value} onChange={onChange} />
    </div>
  )
}

export default function AerialsJudgeTablet() {
  const { eventId: rawEventId } = useParams()
  const { eventId: rEvt, loading: resolving } = useResolveIds({ event: rawEventId })
  const eventId = rEvt || rawEventId

  const [judge,   setJudge]   = useState(null)
  const [judgeId, setJudgeId] = useState('')
  const [pin,     setPin]     = useState('')
  const [pinError,setPinError]= useState('')
  const [judges,  setJudges]  = useState([])
  const [run,     setRun]     = useState(null)
  const [dds,     setDds]     = useState([])

  // Score fields
  const [airJ1, setAirJ1] = useState('0.0')
  const [airJ2, setAirJ2] = useState('0.0')
  const [form,  setForm]  = useState('0.0')
  const [land,  setLand]  = useState('0.0')
  const [jump1Code, setJump1Code] = useState('')
  const [jump2Code, setJump2Code] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [submitMsg,  setSubmitMsg]  = useState('')
  const [submitErr,  setSubmitErr]  = useState('')

  const ws = useRef(null)

  // Load judges and DD table
  useEffect(() => {
    if (resolving) return
    fetch(`/api/events/${eventId}/judges`).then(r => r.json()).then(setJudges).catch(() => {})
    fetch(`/api/jump-dds?discipline=aerials`).then(r => r.json()).then(data => {
      setDds(Array.isArray(data) ? data : [])
    }).catch(() => {})
  }, [eventId, resolving])

  // Poll for active run
  useEffect(() => {
    const load = () =>
      fetch(`/api/events/${eventId}/runs/active`)
        .then(r => r.json())
        .then(data => {
          setRun(data)
          if (data && data.jump1_code) setJump1Code(data.jump1_code)
          if (data && data.jump2_code) setJump2Code(data.jump2_code)
        })
        .catch(() => {})
    load()
    const t = setInterval(load, 4000)

    // WebSocket for instant updates
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    ws.current = new WebSocket(`${proto}//${window.location.host}`)
    ws.current.onmessage = e => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.eventId !== eventId) return
        if (msg.type === 'run_started') {
          load()
          setSubmitMsg('')
          setSubmitErr('')
          setAirJ1('0.0'); setAirJ2('0.0'); setForm('0.0'); setLand('0.0')
        } else if (msg.type === 'run_updated') {
          load()
        }
      } catch (_) {}
    }

    return () => { clearInterval(t); ws.current && ws.current.close() }
  }, [eventId])

  const login = () => {
    const j = judges.find(j => j.id === judgeId)
    if (!j) { setPinError('Select a judge'); return }
    if (j.pin && j.pin !== pin) { setPinError('Incorrect PIN'); return }
    setJudge(j)
    setPinError('')
  }

  const submitScore = async (scoreType, rawScore) => {
    if (!run) { setSubmitErr('No active run'); return }
    setSubmitting(true); setSubmitErr(''); setSubmitMsg('')
    try {
      const r = await fetch(`/api/events/${eventId}/runs/${run.id}/scores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ judge_id: judge.id, score_type: scoreType, raw_score: parseFloat(rawScore), pin }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)
      setSubmitMsg(`${scoreType} score submitted: ${rawScore}`)
    } catch (e) { setSubmitErr(e.message) }
    finally { setSubmitting(false) }
  }

  const submitAll = async () => {
    if (!run) { setSubmitErr('No active run'); return }
    setSubmitting(true); setSubmitErr(''); setSubmitMsg('')
    const entries = []
    if (showAll || isAirJudge) {
      entries.push({ type: 'air_jump1', val: airJ1 })
      entries.push({ type: 'air_jump2', val: airJ2 })
    }
    if (showAll || isFormJudge) {
      entries.push({ type: 'form', val: form })
    }
    if (showAll || isLandJudge) {
      entries.push({ type: 'landing', val: land })
    }
    try {
      for (const { type, val } of entries) {
        const r = await fetch(`/api/events/${eventId}/runs/${run.id}/scores`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ judge_id: judge.id, score_type: type, raw_score: parseFloat(val), pin }),
        })
        if (!r.ok) { const d = await r.json(); throw new Error(`${type}: ${d.error}`) }
      }
      setSubmitMsg('All scores submitted')
    } catch (e) { setSubmitErr(e.message) }
    finally { setSubmitting(false) }
  }

  // --- Login screen ---
  if (!judge) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="bg-slate-900 rounded-2xl p-8 w-full max-w-sm space-y-5 border border-slate-800">
          <div className="text-center">
            <p className="text-3xl mb-1">🏔</p>
            <h1 className="text-white font-bold text-xl">Aerials Judge Tablet</h1>
            <p className="text-slate-500 text-sm mt-1">Select your position to begin</p>
          </div>
          <div>
            <label className="block text-slate-400 text-sm mb-1">Judge</label>
            <select className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
              value={judgeId} onChange={e => setJudgeId(e.target.value)}>
              <option value="">-- Select --</option>
              {judges.map(j => (
                <option key={j.id} value={j.id}>{j.name} ({j.role})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-slate-400 text-sm mb-1">PIN (if required)</label>
            <input type="password" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
              value={pin} onChange={e => setPin(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && login()} />
          </div>
          {pinError && <p className="text-red-400 text-sm">{pinError}</p>}
          <button onClick={login} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl py-3 transition-colors">
            Sign In
          </button>
        </div>
      </div>
    )
  }

  // --- Scoring screen ---
  const roleLabel = judge.role.replace('_', ' ').toUpperCase()
  const isAirJudge    = /air/i.test(judge.role)
  const isFormJudge   = /form/i.test(judge.role)   || /tl/i.test(judge.role)
  const isLandJudge   = /land/i.test(judge.role)
  const showAll = !isAirJudge && !isFormJudge && !isLandJudge

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-white font-bold text-lg">Aerials Judge</h1>
          <p className="text-slate-400 text-sm">{judge.name} &mdash; {roleLabel}</p>
        </div>
        <button onClick={() => setJudge(null)} className="text-slate-500 text-xs hover:text-white">Sign out</button>
      </div>

      {/* Active run info */}
      {run ? (
        <div className="bg-slate-800 rounded-xl p-4 mb-5 border border-slate-700">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 text-white text-2xl font-bold w-14 h-14 rounded-xl flex items-center justify-center">
              {run.bib_number}
            </div>
            <div>
              <div className="text-white font-semibold text-lg">{run.first_name} {run.last_name}</div>
              <div className="text-slate-400 text-sm">Run {run.run_number} &mdash; {run.round}</div>
            </div>
          </div>
          {/* Jump codes */}
          <div className="mt-3 flex gap-3">
            <div className="flex-1">
              <label className="text-slate-500 text-xs">Jump 1 Code</label>
              <select className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-sm mt-0.5"
                value={jump1Code} onChange={e => setJump1Code(e.target.value)}>
                <option value="">--</option>
                {dds.map(d => (
                  <option key={d.id || d.jump_code} value={d.jump_code}>{d.jump_code} (DD {d.dd_value})</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-slate-500 text-xs">Jump 2 Code</label>
              <select className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-sm mt-0.5"
                value={jump2Code} onChange={e => setJump2Code(e.target.value)}>
                <option value="">--</option>
                {dds.map(d => (
                  <option key={d.id || d.jump_code} value={d.jump_code}>{d.jump_code} (DD {d.dd_value})</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-slate-900 rounded-xl p-6 mb-5 text-center border border-slate-800">
          <p className="text-slate-500">Waiting for active run...</p>
        </div>
      )}

      {/* Score fields -- show based on role, or all if unspecified */}
      <div className="space-y-2">
        {(showAll || isAirJudge) && (
          <>
            <ScoreField label="Air Score -- Jump 1 (0-10)"  value={airJ1} onChange={setAirJ1} />
            <ScoreField label="Air Score -- Jump 2 (0-10)"  value={airJ2} onChange={setAirJ2} />
          </>
        )}
        {(showAll || isFormJudge) && (
          <ScoreField label="Form Score (0-10)"   value={form}  onChange={setForm} />
        )}
        {(showAll || isLandJudge) && (
          <ScoreField label="Landing Score (0-10)" value={land} onChange={setLand} />
        )}
      </div>

      {/* Submit */}
      <button
        onClick={submitAll}
        disabled={submitting || !run}
        className="w-full mt-6 bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-lg rounded-xl py-4 transition-colors"
      >
        {submitting ? 'Submitting...' : 'Submit All Scores'}
      </button>

      {submitMsg && <p className="text-green-400 text-sm text-center mt-3">{submitMsg}</p>}
      {submitErr && <p className="text-red-400  text-sm text-center mt-3">{submitErr}</p>}
    </div>
  )
}
