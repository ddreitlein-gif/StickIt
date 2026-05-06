import { useState, useEffect, useRef, useMemo } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import useResolveIds from '../hooks/useResolveIds'

// Quick-select buttons for a value range with a configurable step.
function QuickButtons({ value, onChange, max, step = 0.1 }) {
  const steps = useMemo(() => {
    const out = []
    const inv = Math.round(1 / step)
    for (let i = 0; i <= Math.round(max * inv); i++) out.push(i / inv)
    return out
  }, [max, step])
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

function ScoreField({ label, max, value, onChange }) {
  return (
    <div className="mb-2">
      <label className="block text-slate-300 text-xs font-medium mb-1">{label}</label>
      <div className="flex items-center gap-3 mb-1">
        <input
          type="number" min="0" max={max} step="0.1"
          className="w-24 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-lg font-mono text-center focus:outline-none focus:border-blue-500"
          value={value}
          onChange={e => onChange(e.target.value)}
        />
        <span className="text-slate-500 text-sm">/ {max.toFixed(1)}</span>
      </div>
      <QuickButtons value={value} onChange={onChange} max={max} step={0.1} />
    </div>
  )
}

// ── Legacy v1 score screen (per-component-judge model) ─────────────────────
function LegacyScoreScreen({ eventId, judge, run, dds, jump1Code, jump2Code, setJump1Code, setJump2Code, signOut, pin }) {
  const [airJ1, setAirJ1] = useState('0.0')
  const [airJ2, setAirJ2] = useState('0.0')
  const [form,  setForm]  = useState('0.0')
  const [land,  setLand]  = useState('0.0')
  const [submitting, setSubmitting] = useState(false)
  const [submitMsg, setSubmitMsg] = useState('')
  const [submitErr, setSubmitErr] = useState('')

  const isAirJudge  = /air/i.test(judge.role)
  const isFormJudge = /form/i.test(judge.role) || /tl/i.test(judge.role)
  const isLandJudge = /land/i.test(judge.role)
  const showAll = !isAirJudge && !isFormJudge && !isLandJudge

  const submitAll = async () => {
    if (!run) { setSubmitErr('No active run'); return }
    setSubmitting(true); setSubmitErr(''); setSubmitMsg('')
    const entries = []
    if (showAll || isAirJudge)  { entries.push({ type: 'air_jump1', val: airJ1 }); entries.push({ type: 'air_jump2', val: airJ2 }) }
    if (showAll || isFormJudge) { entries.push({ type: 'form',      val: form  }) }
    if (showAll || isLandJudge) { entries.push({ type: 'landing',   val: land  }) }
    try {
      for (const { type, val } of entries) {
        const r = await fetch(`/api/events/${eventId}/runs/${run.id}/scores`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ judge_id: judge.id, score_type: type, raw_score: parseFloat(val), pin }),
        })
        if (!r.ok) { const d = await r.json(); throw new Error(`${type}: ${d.error}`) }
      }
      setSubmitMsg('All scores submitted')
    } catch (e) { setSubmitErr(e.message) }
    finally { setSubmitting(false) }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-white font-bold text-lg">Aerials Judge (Legacy)</h1>
          <p className="text-slate-400 text-sm">{judge.name} — {judge.role}</p>
        </div>
        <button onClick={signOut} className="text-slate-500 text-xs hover:text-white">Sign out</button>
      </div>

      {run ? (
        <div className="bg-slate-800 rounded-xl p-4 mb-5 border border-slate-700">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 text-white text-2xl font-bold w-14 h-14 rounded-xl flex items-center justify-center">
              {run.bib_number}
            </div>
            <div>
              <div className="text-white font-semibold text-lg">{run.first_name} {run.last_name}</div>
              <div className="text-slate-400 text-sm">Run {run.run_number} — {run.round}</div>
            </div>
          </div>
          <div className="mt-3 flex gap-3">
            <div className="flex-1">
              <label className="text-slate-500 text-xs">Jump 1 Code</label>
              <select className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-sm mt-0.5"
                value={jump1Code} onChange={e => setJump1Code(e.target.value)}>
                <option value="">—</option>
                {dds.map(d => (
                  <option key={d.id || d.jump_code} value={d.jump_code}>{d.jump_code} (DD {d.dd_value})</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-slate-500 text-xs">Jump 2 Code</label>
              <select className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-sm mt-0.5"
                value={jump2Code} onChange={e => setJump2Code(e.target.value)}>
                <option value="">—</option>
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

      <div className="space-y-2">
        {(showAll || isAirJudge) && (
          <>
            <ScoreField label="Air Score — Jump 1 (0–10)" max={10} value={airJ1} onChange={setAirJ1} />
            <ScoreField label="Air Score — Jump 2 (0–10)" max={10} value={airJ2} onChange={setAirJ2} />
          </>
        )}
        {(showAll || isFormJudge) && (
          <ScoreField label="Form Score (0–10)" max={10} value={form} onChange={setForm} />
        )}
        {(showAll || isLandJudge) && (
          <ScoreField label="Landing Score (0–10)" max={10} value={land} onChange={setLand} />
        )}
      </div>

      <button onClick={submitAll} disabled={submitting || !run}
        className="w-full mt-6 bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-lg rounded-xl py-4 transition-colors">
        {submitting ? 'Submitting...' : 'Submit All Scores'}
      </button>
      {submitMsg && <p className="text-green-400 text-sm text-center mt-3">{submitMsg}</p>}
      {submitErr && <p className="text-red-400  text-sm text-center mt-3">{submitErr}</p>}
    </div>
  )
}

// ── v2 score screen (every judge enters Air/Form/Landing per jump) ─────────
function V2ScoreScreen({ eventId, event, judge, run, dds, jump1Code, jump2Code, setJump1Code, setJump2Code, signOut, pin }) {
  const numJumps = event.num_jumps || 2

  const [j1Air,  setJ1Air]  = useState('0.0')
  const [j1Form, setJ1Form] = useState('0.0')
  const [j1Land, setJ1Land] = useState('0.0')
  const [j2Air,  setJ2Air]  = useState('0.0')
  const [j2Form, setJ2Form] = useState('0.0')
  const [j2Land, setJ2Land] = useState('0.0')

  const [submitting, setSubmitting] = useState(false)
  const [msg1, setMsg1] = useState('')
  const [msg2, setMsg2] = useState('')
  const [err, setErr] = useState('')

  // Reset on new run
  const lastRunId = useRef(null)
  useEffect(() => {
    if (run && run.id !== lastRunId.current) {
      lastRunId.current = run.id
      setJ1Air('0.0'); setJ1Form('0.0'); setJ1Land('0.0')
      setJ2Air('0.0'); setJ2Form('0.0'); setJ2Land('0.0')
      setMsg1(''); setMsg2(''); setErr('')
    }
  }, [run])

  const post = async (score_type, raw) => {
    const r = await fetch(`/api/events/${eventId}/runs/${run.id}/scores`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ judge_id: judge.id, score_type, raw_score: parseFloat(raw), pin }),
    })
    if (!r.ok) { const d = await r.json(); throw new Error(`${score_type}: ${d.error}`) }
  }

  const submitJump = async (jump) => {
    if (!run) { setErr('No active run'); return }
    setSubmitting(true); setErr('')
    try {
      if (jump === 1) {
        await post('ae_air_j1',  j1Air)
        await post('ae_form_j1', j1Form)
        await post('ae_land_j1', j1Land)
        setMsg1('Jump 1 submitted')
      } else {
        await post('ae_air_j2',  j2Air)
        await post('ae_form_j2', j2Form)
        await post('ae_land_j2', j2Land)
        setMsg2('Jump 2 submitted')
      }
    } catch (e) { setErr(e.message) }
    finally { setSubmitting(false) }
  }

  const JumpPanel = ({ n, code, setCode, air, setAir, form, setForm, land, setLand, msg, onSubmit }) => (
    <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-bold">Jump {n}</h3>
        <select className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-sm"
          value={code || ''} onChange={e => setCode(e.target.value)}>
          <option value="">— Code —</option>
          {dds.map(d => (
            <option key={d.id || d.jump_code} value={d.jump_code}>{d.jump_code} (DD {d.dd_value})</option>
          ))}
        </select>
      </div>
      <ScoreField label="Air (0–2.0)"     max={2.0} value={air}  onChange={setAir} />
      <ScoreField label="Form (0–5.0)"    max={5.0} value={form} onChange={setForm} />
      <ScoreField label="Landing (0–3.0)" max={3.0} value={land} onChange={setLand} />
      <button onClick={onSubmit} disabled={submitting || !run}
        className="w-full mt-3 bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl py-3 transition-colors">
        {submitting ? 'Submitting...' : `Submit Jump ${n}`}
      </button>
      {msg && <p className="text-green-400 text-sm text-center mt-2">{msg}</p>}
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-white font-bold text-lg">Aerials Judge {judge.judge_number || ''}</h1>
          <p className="text-slate-400 text-sm">{judge.name}</p>
        </div>
        <button onClick={signOut} className="text-slate-500 text-xs hover:text-white">Sign out</button>
      </div>

      {run ? (
        <div className="bg-slate-800 rounded-xl p-3 mb-4 border border-slate-700">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 text-white text-2xl font-bold w-14 h-14 rounded-xl flex items-center justify-center">
              {run.bib_number}
            </div>
            <div>
              <div className="text-white font-semibold text-lg">{run.first_name} {run.last_name}</div>
              <div className="text-slate-400 text-sm">Run {run.run_number} — {run.round}</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-slate-900 rounded-xl p-6 mb-4 text-center border border-slate-800">
          <p className="text-slate-500">Waiting for active run...</p>
        </div>
      )}

      <JumpPanel
        n={1}
        code={jump1Code} setCode={setJump1Code}
        air={j1Air}  setAir={setJ1Air}
        form={j1Form} setForm={setJ1Form}
        land={j1Land} setLand={setJ1Land}
        msg={msg1}
        onSubmit={() => submitJump(1)}
      />

      {numJumps >= 2 && (
        <JumpPanel
          n={2}
          code={jump2Code} setCode={setJump2Code}
          air={j2Air}  setAir={setJ2Air}
          form={j2Form} setForm={setJ2Form}
          land={j2Land} setLand={setJ2Land}
          msg={msg2}
          onSubmit={() => submitJump(2)}
        />
      )}

      {err && <p className="text-red-400 text-sm text-center mt-3">{err}</p>}
    </div>
  )
}

// ── Tablet entry point ─────────────────────────────────────────────────────
export default function AerialsJudgeTablet() {
  const { eventId: rawEventId, judgeId: rawJudgeId } = useParams()
  const [searchParams] = useSearchParams()
  const judgeFromQuery = searchParams.get('judge')
  const pinFromQuery   = searchParams.get('pin') || ''

  const { eventId: rEvt, judgeId: rJudge, loading: resolving } = useResolveIds({
    event: rawEventId,
    judge: rawJudgeId || judgeFromQuery,
  })
  const eventId = rEvt || rawEventId
  const presetJudgeId = rJudge || rawJudgeId || judgeFromQuery

  const [event, setEvent] = useState(null)
  const [judges, setJudges] = useState([])
  const [judge,  setJudge]  = useState(null)
  const [judgeIdSel, setJudgeIdSel] = useState('')
  const [pin, setPin] = useState(pinFromQuery)
  const [pinError, setPinError] = useState('')

  const [run, setRun] = useState(null)
  const [dds, setDds] = useState([])
  const [jump1Code, setJump1Code] = useState('')
  const [jump2Code, setJump2Code] = useState('')

  const ws = useRef(null)

  // Load event meta + judges + DD table
  useEffect(() => {
    if (resolving || !eventId) return
    fetch(`/api/events/${eventId}`).then(r => r.json()).then(setEvent).catch(() => {})
    fetch(`/api/events/${eventId}/judges`).then(r => r.json()).then(setJudges).catch(() => {})
    fetch(`/api/jump-dds?discipline=aerials`).then(r => r.json()).then(data => {
      setDds(Array.isArray(data) ? data : [])
    }).catch(() => {})
  }, [eventId, resolving])

  // Auto-login when a judge is preset via URL
  useEffect(() => {
    if (judge || !judges.length || !presetJudgeId) return
    const j = judges.find(x => x.id === presetJudgeId || x.short_code === presetJudgeId)
    if (!j) return
    if (j.pin && pinFromQuery && pinFromQuery !== j.pin) { setPinError('Incorrect PIN in URL'); return }
    if (j.pin && !pinFromQuery) return  // wait for manual PIN entry
    setJudge(j)
  }, [judges, presetJudgeId, judge, pinFromQuery])

  // Active-run polling + WS
  useEffect(() => {
    if (!eventId) return
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

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    ws.current = new WebSocket(`${proto}//${window.location.host}`)
    ws.current.onmessage = e => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.eventId !== eventId) return
        if (msg.type === 'run_started' || msg.type === 'run_updated') load()
      } catch (_) {}
    }
    return () => { clearInterval(t); ws.current && ws.current.close() }
  }, [eventId])

  const login = () => {
    const j = judges.find(x => x.id === judgeIdSel)
    if (!j) { setPinError('Select a judge'); return }
    if (j.pin && j.pin !== pin) { setPinError('Incorrect PIN'); return }
    setJudge(j)
    setPinError('')
  }

  if (resolving || !event) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-500">
        Loading...
      </div>
    )
  }

  // Login screen — only when no preset judge OR preset judge needs a PIN
  if (!judge) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="bg-slate-900 rounded-2xl p-8 w-full max-w-sm space-y-5 border border-slate-800">
          <div className="text-center">
            <p className="text-3xl mb-1">🏔</p>
            <h1 className="text-white font-bold text-xl">Aerials Judge Tablet</h1>
            <p className="text-slate-500 text-sm mt-1">Select your position to begin</p>
          </div>
          {!presetJudgeId && (
            <div>
              <label className="block text-slate-400 text-sm mb-1">Judge</label>
              <select className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
                value={judgeIdSel} onChange={e => setJudgeIdSel(e.target.value)}>
                <option value="">— Select —</option>
                {judges.filter(j => j.role !== 'HJ').map(j => (
                  <option key={j.id} value={j.id}>{j.name} ({j.role})</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-slate-400 text-sm mb-1">PIN (if required)</label>
            <input type="password" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
              value={pin} onChange={e => setPin(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && login()} />
          </div>
          {pinError && <p className="text-red-400 text-sm">{pinError}</p>}
          <button onClick={() => {
            if (presetJudgeId) {
              const j = judges.find(x => x.id === presetJudgeId || x.short_code === presetJudgeId)
              if (j && j.pin && j.pin !== pin) { setPinError('Incorrect PIN'); return }
              if (j) { setJudge(j); setPinError('') }
            } else {
              login()
            }
          }} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl py-3 transition-colors">
            Sign In
          </button>
        </div>
      </div>
    )
  }

  // v2 events have aerials_panel_size set. Legacy events fall back to the old UI.
  const isV2 = event.aerials_panel_size != null && /^AeJudge/.test(judge.role)

  const signOut = () => setJudge(null)

  if (isV2) {
    return (
      <V2ScoreScreen
        eventId={eventId}
        event={event}
        judge={judge}
        run={run}
        dds={dds}
        jump1Code={jump1Code}
        jump2Code={jump2Code}
        setJump1Code={setJump1Code}
        setJump2Code={setJump2Code}
        signOut={signOut}
        pin={pin}
      />
    )
  }

  return (
    <LegacyScoreScreen
      eventId={eventId}
      judge={judge}
      run={run}
      dds={dds}
      jump1Code={jump1Code}
      jump2Code={jump2Code}
      setJump1Code={setJump1Code}
      setJump2Code={setJump2Code}
      signOut={signOut}
      pin={pin}
    />
  )
}
