import { useState, useEffect, useRef } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import useHighContrast from '../hooks/useHighContrast'
import useResolveIds from '../hooks/useResolveIds'

const API = '/api'

// Large-button numeric keypad for touch entry
function ScorePad({ value, onChange, min, max, step = 0.5, label, quickValues }) {
  const [input, setInput] = useState(value !== null ? String(value) : '')
  const [rangeError, setRangeError] = useState('')
  const inputRef = useRef(null)

  const fmtVal = (v) => v !== null && v !== undefined ? Number(v).toFixed(1) : ''

  // Sync input when value changes externally (e.g., after rejection clears a field)
  useEffect(() => {
    setInput(value !== null ? fmtVal(value) : '')
  }, [value])

  const commit = () => {
    const n = parseFloat(input)
    if (isNaN(n)) {
      setInput(value !== null ? fmtVal(value) : '')
      setRangeError('')
      return
    }
    if (n < min || n > max) {
      setRangeError(`Value must be ${min}--${max}`)
      setInput(value !== null ? fmtVal(value) : '')
      return
    }
    setRangeError('')
    onChange(n)
  }

  // Force commit before external reads (called before submit)
  const forceCommit = () => {
    if (inputRef.current) inputRef.current.blur()
  }

  const quick = (v) => { setInput(fmtVal(v)); setRangeError(''); onChange(v) }

  const quickVals = quickValues || (() => {
    const vals = []
    for (let v = min; v <= max + 0.0001; v = Math.round((v + step) * 1000) / 1000) {
      vals.push(Math.round(v * 1000) / 1000)
    }
    return vals
  })()

  return (
    <div className="space-y-3">
      <div className="text-slate-400 text-sm font-semibold uppercase tracking-wide">{label}</div>
      <div className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="number" min={min} max={max} step={step}
          value={input}
          onChange={e => setInput(e.target.value)}
          onBlur={commit}
          className={`w-28 text-3xl font-bold text-center bg-slate-800 border-2 focus:border-blue-500 rounded-xl p-3 text-white outline-none ${rangeError ? 'border-red-500' : 'border-slate-600'}`}
          inputMode="decimal"
        />
        <div className="text-slate-500 text-sm">{min}--{max}</div>
      </div>
      {rangeError && (
        <div className="text-red-400 text-xs font-semibold">{rangeError}</div>
      )}
      <div className="flex flex-wrap gap-2">
        {quickVals.map(v => (
          <button
            key={v}
            onClick={() => quick(v)}
            className={`px-3 py-2 rounded-lg text-sm font-bold transition-all ${
              value === v
                ? 'bg-blue-600 text-white ring-2 ring-blue-400'
                : 'bg-slate-700 text-slate-200 hover:bg-slate-600 active:bg-slate-500'
            }`}
          >
            {Number(v).toFixed(1)}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Cumulative Deduction Pad ─────────────────────────────────────────────────
const DEDUCTION_BUTTONS = [
  { value: 0.1, label: '0.1' },
  { value: 0.5, label: '0.5' },
  { value: 1.0, label: '1.0' },
  { value: 1.6, label: '1.6' },
  { value: 6.0, label: '6.0' },
]

function DeductionPad({ value, onChange }) {
  const [manualInput, setManualInput] = useState('')
  const [manualMode, setManualMode] = useState(false)

  useEffect(() => {
    if (value === 0) setManualInput('')
  }, [value])

  const addDeduction = (amt) => {
    const next = Math.min(20, Math.round(((value || 0) + amt) * 10) / 10)
    onChange(next)
    setManualMode(false)
  }

  const clear = () => { onChange(0); setManualInput(''); setManualMode(false) }

  const commitManual = () => {
    const n = parseFloat(manualInput)
    if (!isNaN(n) && n >= 0 && n <= 20) {
      onChange(Math.round(n * 10) / 10)
    }
    setManualMode(false)
  }

  return (
    <div className="space-y-3">
      <div className="text-slate-400 text-sm font-semibold uppercase tracking-wide">Deduction</div>
      <div className="flex items-center gap-3">
        <div className={`w-28 text-3xl font-bold text-center bg-slate-800 border-2 rounded-xl p-3 text-white ${(value || 0) > 0 ? 'border-red-500' : 'border-slate-600'}`}>
          {(value || 0).toFixed(1)}
        </div>
        <button onClick={clear} className="px-3 py-2 rounded-lg text-sm font-bold bg-slate-700 text-slate-200 hover:bg-slate-600 active:bg-slate-500">
          Clear
        </button>
        <button onClick={() => setManualMode(!manualMode)} className="px-3 py-2 rounded-lg text-sm font-bold bg-slate-700 text-slate-200 hover:bg-slate-600 active:bg-slate-500">
          Manual
        </button>
      </div>
      {manualMode && (
        <div className="flex items-center gap-2">
          <input
            type="number" min={0} max={20} step={0.1}
            value={manualInput}
            onChange={e => setManualInput(e.target.value)}
            onBlur={commitManual}
            onKeyDown={e => e.key === 'Enter' && commitManual()}
            placeholder="0.0"
            className="w-28 text-lg font-bold text-center bg-slate-800 border-2 border-slate-600 focus:border-blue-500 rounded-xl p-2 text-white outline-none"
            inputMode="decimal"
            autoFocus
          />
          <span className="text-slate-500 text-sm">0–20</span>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {DEDUCTION_BUTTONS.map(b => (
          <button
            key={b.value}
            onClick={() => addDeduction(b.value)}
            className="px-4 py-3 rounded-lg text-sm font-bold bg-slate-700 text-slate-200 hover:bg-slate-600 active:bg-slate-500 transition-all"
          >
            +{b.label}
          </button>
        ))}
      </div>
      <div className="text-xs text-slate-500">Tap to accumulate. 0.1 minor &middot; 0.5 stumble &middot; 1.6 lane change &middot; 6.0 stop/fall</div>
    </div>
  )
}

// ── Dual Mogul Judge Scoring ─────────────────────────────────────────────────
const DUAL_ROLE_TO_NUM = {
  DualTurns1: 1, DualTurns2: 2, DualAir: 3, DualTime: 4, DualOverall: 5,
}
const DUAL_ROLE_LABEL = {
  DualTurns1: 'Turns Judge 1', DualTurns2: 'Turns Judge 2',
  DualAir: 'Air Judge', DualTime: 'Time Judge', DualOverall: 'Overall Judge',
}
const SPLITS = [[5,0],[0,5],[4,1],[1,4],[3,2],[2,3]]
const SPLITS_4PT = [[4,0],[0,4],[3,1],[1,3],[2,2]]

// ── FIS Score Card Reference Data ───────────────────────────────────────────
const TL_COMPONENT_REF = [
  { label: 'Carving (50%)', ranges: [
    { level: 'Excellent', range: '8.1 – 10.0' },
    { level: 'Good', range: '6.1 – 8.0' },
    { level: 'Adequate', range: '4.1 – 6.0' },
    { level: 'Managing', range: '2.1 – 4.0' },
    { level: 'Poor', range: '0.1 – 2.0' },
  ]},
  { label: 'Ab/Ext (25%)', ranges: [
    { level: 'Excellent', range: '4.1 – 5.0' },
    { level: 'Good', range: '3.1 – 4.0' },
    { level: 'Adequate', range: '2.1 – 3.0' },
    { level: 'Managing', range: '1.1 – 2.0' },
    { level: 'Poor', range: '0.1 – 1.0' },
  ]},
  { label: 'UB (25%)', ranges: [
    { level: 'Excellent', range: '4.1 – 5.0' },
    { level: 'Good', range: '3.1 – 4.0' },
    { level: 'Adequate', range: '2.1 – 3.0' },
    { level: 'Managing', range: '1.1 – 2.0' },
    { level: 'Poor', range: '0.1 – 1.0' },
  ]},
]

const TL_NONCOMPONENT_REF = [
  { label: 'T&L Total', ranges: [
    { level: 'Excellent', range: '16.1 – 20.0' },
    { level: 'Good', range: '12.1 – 16.0' },
    { level: 'Adequate', range: '8.1 – 12.0' },
    { level: 'Managing', range: '4.1 – 8.0' },
    { level: 'Poor', range: '0.1 – 4.0' },
  ]},
]

const DEDUCTION_REF = [
  { range: '0.1 – 2.0', desc: 'Lt. touch, small stumble, fall line dev, speed check, dbl pole, Shooting' },
  { range: '2.1 – 2.8', desc: 'Medium touch, no stop' },
  { range: '2.9 – 4.0', desc: 'Hard touch / Sig sliding/front roll / no stop' },
  { range: '4.1 – 5.9', desc: 'Complete fall w/o stop, Slide to near stop' },
  { range: '6.0', desc: 'ANY Complete Stop' },
]

const AIR_REF = {
  scores: [
    { level: 'Excellent', range: '8.1 – 10.0' },
    { level: 'Good', range: '6.1 – 8.0' },
    { level: 'Average', range: '4.1 – 6.0' },
    { level: 'Poor', range: '2.1 – 4.0' },
    { level: 'Very Poor', range: '0.1 – 2.0' },
  ],
  criteria: ['Athleticism displayed', 'Control', 'Balance', 'Landing continuity of motion'],
}

function ScoreReference({ isTurns, isAir, componentScoring }) {
  if (isTurns) {
    const sections = componentScoring ? TL_COMPONENT_REF : TL_NONCOMPONENT_REF
    return (
      <div className="bg-slate-900 rounded-2xl p-4 border border-slate-700 space-y-3">
        <div className="text-slate-400 text-xs font-semibold uppercase tracking-wide">Scoring Reference</div>
        {sections.map(sec => (
          <div key={sec.label}>
            <div className="text-blue-400 font-semibold text-xs mb-1">{sec.label}</div>
            {sec.ranges.map(r => (
              <div key={r.level} className="flex justify-between text-xs py-0.5">
                <span className="text-slate-400">{r.level}</span>
                <span className="text-white font-mono text-xs">{r.range}</span>
              </div>
            ))}
          </div>
        ))}
        <div className="border-t border-slate-700 pt-2">
          <div className="text-blue-400 font-semibold text-xs mb-1">Deductions</div>
          {DEDUCTION_REF.map(d => (
            <div key={d.range} className="py-0.5">
              <span className="text-white font-mono text-xs">{d.range}</span>
              <div className="text-slate-500 text-[10px] leading-tight">{d.desc}</div>
            </div>
          ))}
        </div>
        <a href="/docs/TL%20Scorecard.pdf" download
           className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 mt-2">
          &#128196; Download FIS T&L Card
        </a>
      </div>
    )
  }
  if (isAir) {
    return (
      <div className="bg-slate-900 rounded-2xl p-4 border border-slate-700 space-y-3">
        <div className="text-slate-400 text-xs font-semibold uppercase tracking-wide">Scoring Reference</div>
        <div>
          <div className="text-blue-400 font-semibold text-xs mb-1">Jump Quality</div>
          {AIR_REF.scores.map(r => (
            <div key={r.level} className="flex justify-between text-xs py-0.5">
              <span className="text-slate-400">{r.level}</span>
              <span className="text-white font-mono text-xs">{r.range}</span>
            </div>
          ))}
        </div>
        <div className="border-t border-slate-700 pt-2">
          <div className="text-blue-400 font-semibold text-xs mb-1">Quality Criteria</div>
          <ul className="text-xs text-slate-400 space-y-0.5">
            {AIR_REF.criteria.map(c => <li key={c}>&#8226; {c}</li>)}
          </ul>
        </div>
        <div className="text-xs text-slate-400">
          <span className="text-blue-400 font-semibold">Air:</span> Height and Distance
        </div>
        <div className="text-xs text-slate-400">
          <span className="text-blue-400 font-semibold">Fluidity</span>
        </div>
        <a href="/docs/Air%20Score%20Card.pdf" download
           className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 mt-2">
          &#128196; Download FIS Air Card
        </a>
      </div>
    )
  }
  return null
}

function DualJudgeView({ eventId, judge, hc, toggleHc }) {
  const [activeMatch, setActiveMatch] = useState(null)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [scoreRejected, setScoreRejected] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('Waiting for match...')
  // v1.16.17 -- event completed full-screen message
  const [eventCompleted, setEventCompleted] = useState(false)
  // v1.16.30 -- manual score entry lockout
  const [manualEntryActive, setManualEntryActive] = useState(false)
  const pollRef = useRef(null)
  const lastMatchIdRef = useRef(null)
  const submittedRef = useRef(false)

  useEffect(() => { submittedRef.current = submitted }, [submitted])

  const judgeNum = DUAL_ROLE_TO_NUM[judge.role] || 1

  const fetchMatchRef = useRef(null)
  fetchMatchRef.current = async () => {
    try {
      const r = await fetch(`${API}/events/${eventId}/dual/active-match`)
      const data = await r.json()
      const match = data?.id ? data : null
      setManualEntryActive(!!(match && data?.manual_entry))
      if (match?.id !== lastMatchIdRef.current) {
        lastMatchIdRef.current = match?.id || null
        setActiveMatch(match)
        if (match?.judgePoints) {
          setSubmitted(match.judgePoints.some(p => p.judge_number === judgeNum))
        } else {
          setSubmitted(false)
        }
        setScoreRejected(false)
        setError('')
      } else if (match) {
        setActiveMatch(prev => prev ? { ...prev, judgePoints: match.judgePoints, pointResult: match.pointResult } : prev)
        const hasMyPoints = match.judgePoints?.some(p => p.judge_number === judgeNum)
        if (hasMyPoints && !submittedRef.current) setSubmitted(true)
        if (!hasMyPoints && submittedRef.current) {
          setSubmitted(false)
          setScoreRejected(true)
        }
      } else {
        setActiveMatch(null)
        setSubmitted(false)
      }
    } catch {}
  }

  useEffect(() => {
    const poll = () => fetchMatchRef.current()
    poll()
    pollRef.current = setInterval(poll, 3000)
    return () => clearInterval(pollRef.current)
  }, [eventId, judgeNum])

  useEffect(() => {
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${wsProto}//${location.host}`)
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.eventId === eventId && (
          msg.type === 'event_finalized' ||
          (msg.type === 'run_round_status' && msg.data?.event_completed)
        )) {
          setEventCompleted(true)
          return
        }
        if (msg.eventId === eventId && msg.type === 'dual_manual_entry_started') {
          setManualEntryActive(true)
        } else if (msg.eventId === eventId && msg.type === 'dual_manual_entry_cleared') {
          setManualEntryActive(false)
        }
      } catch {}
      fetchMatchRef.current()
    }
    return () => ws.close()
  }, [eventId, judgeNum])

  // v1.16.17 -- poll for event completion via review-state endpoint
  useEffect(() => {
    let cancelled = false
    const checkCompletion = async () => {
      try {
        const r = await fetch(`${API}/events/${eventId}/dual/review-state`)
        if (!r.ok) return
        const data = await r.json()
        if (!cancelled && data.eventCompleted) setEventCompleted(true)
      } catch {}
    }
    checkCompletion()
    const id = setInterval(checkCompletion, 5000)
    return () => { cancelled = true; clearInterval(id) }
  }, [eventId])

  const submitSplit = async (blue, red, timeTied = false) => {
    if (!activeMatch) return
    setSubmitting(true)
    setError('')
    setScoreRejected(false)
    try {
      const payload = { judge_number: judgeNum, blue_points: blue, red_points: red }
      if (timeTied) payload.time_tied = true
      const res = await fetch(`${API}/events/${eventId}/dual/${activeMatch.id}/judge-points`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) { setError(body.error || 'Error'); return }
      setSubmitted(true)
      setStatus('Score submitted')
      setActiveMatch(prev => prev ? { ...prev, judgePoints: body.rows, pointResult: body.result } : prev)
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const mySubmission = activeMatch?.judgePoints?.find(p => p.judge_number === judgeNum)
  const isTimeTied = activeMatch?.judgePoints?.some(p => p.judge_number === 4 && p.time_tied === 1)

  // v1.16.17 -- event completed full-screen message
  if (eventCompleted) return (
    <div className={`min-h-screen ${hc ? 'hc bg-black' : 'bg-slate-950'} text-white flex items-center justify-center`}>
      <div className="text-center">
        <div className="text-4xl font-display text-emerald-400 mb-4">Event Completed</div>
        <div className="text-xl text-slate-300">Thank You for Your Work</div>
      </div>
    </div>
  )

  // v1.16.30 -- manual score entry lockout overlay (TD entering scores manually)
  if (manualEntryActive && activeMatch) return (
    <div className={`min-h-screen ${hc ? 'hc bg-black' : 'bg-slate-950'} text-white flex items-center justify-center px-6`}>
      <div className="text-center">
        <div className="text-4xl font-display text-amber-400 mb-4">Manual Score Entry for This Round</div>
        <div className="text-lg text-slate-300">Scores are being entered by the Technical Delegate.</div>
      </div>
    </div>
  )

  return (
    <div className={`min-h-screen ${hc ? 'hc bg-black' : 'bg-slate-950'} text-white`}>
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <div>
          <div className="font-bold text-white">{judge.name}</div>
          <div className="text-xs text-slate-400">{DUAL_ROLE_LABEL[judge.role] || judge.role}</div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleHc} className={`px-3 py-1 rounded-full text-xs font-bold border-2 transition-colors ${hc ? 'bg-yellow-400 text-black border-yellow-400' : 'bg-slate-700 text-slate-300 border-slate-600'}`}>{hc ? 'Normal' : 'Hi-Contrast'}</button>
          <div className={`text-xs px-2 py-1 rounded-full ${
            submitted ? 'bg-green-900/50 text-green-400' : 'bg-blue-900/50 text-blue-400'
          }`}>
            {submitted ? 'Score submitted' : status}
          </div>
        </div>
      </div>

      <div className="p-4 space-y-6 max-w-lg mx-auto">
        {activeMatch ? (
          <>
            <div className="bg-slate-800 rounded-2xl p-5 border border-slate-700">
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-3">Current Match</div>
              <div className="grid grid-cols-5 gap-2 items-center">
                <div className="col-span-2 p-3 rounded-lg bg-blue-900/30 border border-blue-700">
                  <div className="text-xs text-blue-400 font-semibold mb-0.5">Blue</div>
                  <div className="text-lg font-bold text-white">
                    {activeMatch.blue_first ? `${activeMatch.blue_last}, ${activeMatch.blue_first}` : 'TBD'}
                  </div>
                  {activeMatch.blue_bib && <div className="text-xs text-slate-400 mt-0.5">Bib {activeMatch.blue_bib}</div>}
                </div>
                <div className="text-center text-slate-500 font-bold">vs</div>
                <div className="col-span-2 p-3 rounded-lg bg-red-900/30 border border-red-700">
                  <div className="text-xs text-red-400 font-semibold mb-0.5">Red</div>
                  <div className="text-lg font-bold text-white">
                    {activeMatch.red_first ? `${activeMatch.red_last}, ${activeMatch.red_first}` : 'TBD'}
                  </div>
                  {activeMatch.red_bib && <div className="text-xs text-slate-400 mt-0.5">Bib {activeMatch.red_bib}</div>}
                </div>
              </div>
              {activeMatch.pairing_label && (
                <div className="text-center text-sm font-bold text-slate-300 mt-2">
                  Pairing {activeMatch.pairing_label}
                </div>
              )}
              {activeMatch.pointResult && activeMatch.pointResult.judgeCount > 0 && (
                <div className="flex items-center justify-center gap-4 mt-3 pt-3 border-t border-slate-700">
                  <span className="text-sm font-bold text-blue-300">Blue {activeMatch.pointResult.blueTotal}</span>
                  <span className="text-slate-600 text-xs">pts</span>
                  <span className="text-sm font-bold text-red-300">{activeMatch.pointResult.redTotal} Red</span>
                  <span className="text-slate-600 text-xs">({activeMatch.pointResult.judgeCount}/5 judges{activeMatch.pointResult.timeTied ? ' \u00b7 Time Tied' : ''})</span>
                </div>
              )}
            </div>

            {scoreRejected && !submitted && (
              <div className="bg-red-900/30 border-2 border-red-600 rounded-2xl p-4 text-center animate-pulse">
                <div className="text-red-300 font-bold text-base">Your score was rejected</div>
                <div className="text-red-400 text-sm">The Head Judge has rejected your previous score. Please enter and submit a new score below.</div>
              </div>
            )}

            {!submitted ? (
              <div className="bg-slate-900 rounded-2xl p-5 border border-slate-700 space-y-4">
                <div className="text-sm font-semibold text-white uppercase tracking-wide">
                  Award {judgeNum === 5 && isTimeTied ? '4' : '5'} Points
                  {judgeNum === 5 && isTimeTied && (
                    <span className="ml-2 text-amber-400 text-xs normal-case font-normal">(Time Tied)</span>
                  )}
                </div>
                <div className="text-xs text-slate-400 mb-2">
                  Tap a split to submit.  Blue + Red must equal {judgeNum === 5 && isTimeTied ? 4 : 5}.
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {(judgeNum === 5 && isTimeTied ? SPLITS_4PT : SPLITS).map(([b, r]) => (
                    <button
                      key={`${b}-${r}`}
                      onClick={() => submitSplit(b, r)}
                      disabled={submitting}
                      className="flex items-center justify-center gap-3 px-4 py-5 rounded-2xl border-2 text-lg font-bold transition-all
                        bg-slate-800 border-slate-600 hover:border-slate-400 active:bg-slate-700
                        disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <span className="text-blue-400">{b}</span>
                      <span className="text-slate-600">/</span>
                      <span className="text-red-400">{r}</span>
                    </button>
                  ))}
                </div>
                {judgeNum === 4 && (
                  <button
                    onClick={() => submitSplit(0, 0, true)}
                    disabled={submitting}
                    className="w-full px-4 py-5 rounded-2xl border-2 text-lg font-bold transition-all
                      bg-amber-900/30 border-amber-600 hover:border-amber-400 active:bg-amber-800/50
                      disabled:opacity-40 disabled:cursor-not-allowed text-amber-300"
                  >
                    Time Tied
                  </button>
                )}
                {error && <div className="bg-red-900/30 text-red-400 rounded-lg px-4 py-3 text-sm">{error}</div>}
              </div>
            ) : (
              <div className="bg-green-900/20 border border-green-800 rounded-2xl p-8 text-center">
                <div className="text-5xl mb-3">&#10003;</div>
                <div className="text-green-400 text-xl font-bold">Score Submitted</div>
                {mySubmission && mySubmission.time_tied === 1 ? (
                  <div className="mt-3 text-lg text-amber-400 font-bold">Time Tied</div>
                ) : mySubmission && (
                  <div className="mt-3 flex items-center justify-center gap-4 text-lg">
                    <span className="text-blue-400 font-bold">Blue {mySubmission.blue_points}</span>
                    <span className="text-slate-500">/</span>
                    <span className="text-red-400 font-bold">{mySubmission.red_points} Red</span>
                  </div>
                )}
                <div className="text-slate-400 text-sm mt-4">Waiting for next match...</div>
              </div>
            )}
          </>
        ) : (
          <div className="bg-slate-800 rounded-2xl p-8 text-center border border-slate-700">
            <div className="text-5xl mb-3">&#9203;</div>
            <div className="text-slate-400">Waiting for next match...</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main JudgeTablet ─────────────────────────────────────────────────────────
export default function JudgeTablet() {
  const { eventId: rawEventId } = useParams()
  const [searchParams] = useSearchParams()
  const rawJudgeId = searchParams.get('judge')
  const pin = searchParams.get('pin')
  const { eventId: resolvedEventId, judgeId: resolvedJudgeId, loading: resolving } = useResolveIds({ event: rawEventId, judge: rawJudgeId })
  const eventId = resolvedEventId || rawEventId
  const judgeId = resolvedJudgeId || rawJudgeId

  const [hc, toggleHc] = useHighContrast()
  const [judge, setJudge] = useState(null)
  const [activeRun, setActiveRun] = useState(null)
  const [carving,    setCarving]    = useState(null)
  const [absExt,     setAbsExt]     = useState(null)
  const [upperBody,  setUpperBody]  = useState(null)
  const [deduction,  setDeduction]  = useState(0)
  const [airJ1, setAirJ1] = useState(null)
  const [airJ2, setAirJ2] = useState(null)
  const [code1, setCode1] = useState('')
  const [code2, setCode2] = useState('')
  const [jumpDDs, setJumpDDs] = useState([])
  const [codesSubmitted, setCodesSubmitted] = useState(false)
  const [codesError, setCodesError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [scoreRejected, setScoreRejected] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('Connecting...')
  const wsRef = useRef(null)
  const pollRef = useRef(null)
  const submittedRef = useRef(false)
  const isTurnsRef = useRef(false)
  const isAirRef = useRef(false)

  const isDual  = judge?.role?.startsWith('Dual')
  const isAir   = judge?.role?.startsWith('Air')
  const isTurns = judge?.role?.startsWith('TL')

  useEffect(() => { submittedRef.current = submitted }, [submitted])
  useEffect(() => { isTurnsRef.current = isTurns }, [isTurns])
  useEffect(() => { isAirRef.current = isAir }, [isAir])

  const [ageGroupTransition, setAgeGroupTransition] = useState(null)
  const [eventCompleted, setEventCompleted] = useState(false)

  const [eventGender, setEventGender] = useState('M')
  const [componentScoring, setComponentScoring] = useState(true)
  const [numJumps, setNumJumps] = useState(2)
  const [eventDivision, setEventDivision] = useState('')

  useEffect(() => {
    if (!judgeId || resolving) return
    fetch(`${API}/events/${eventId}/judges`)
      .then(r => r.json())
      .then(judges => {
        const j = judges.find(jj => jj.id === judgeId)
        setJudge(j || null)
        setStatus(j ? `Logged in as ${j.role} -- ${j.name}` : 'Judge not found')
      })
  }, [judgeId, eventId, resolving])

  useEffect(() => {
    if (isDual || resolving) return
    fetch(`${API}/jump-dds?ruleset=uss&discipline=mogul&gender=${eventGender}`)
      .then(r => r.json())
      .then(rows => setJumpDDs(rows || []))
      .catch(() => {})
  }, [eventId, eventGender, isDual, resolving])

  useEffect(() => {
    if (isDual || resolving) return
    const fetchInfo = async () => {
      try {
        const r = await fetch(`${API}/events/${eventId}/runs/info`)
        const data = await r.json()
        if (data?.gender) setEventGender(data.gender)
        if (data?.component_scoring !== undefined) setComponentScoring(!!data.component_scoring)
        if (data?.num_jumps != null) setNumJumps(data.num_jumps)
        if (data?.division) setEventDivision(data.division)
      } catch {}
    }
    fetchInfo()
  }, [eventId, isDual, resolving])

  useEffect(() => {
    if (isDual || resolving) return
    const poll = async () => {
      try {
        const r = await fetch(`${API}/events/${eventId}/runs/active`)
        const data = await r.json()
        if (data?.event_completed) { setEventCompleted(true); setActiveRun(null); return }
        const run = data?.id ? data : null
        if (run?.id !== activeRun?.id) {
          setActiveRun(run)
          setScoreRejected(false)
          setCarving(null)
          setAbsExt(null)
          setUpperBody(null)
          setDeduction(0)
          setAirJ1(null)
          setAirJ2(null)
          setCode1('')
          setCode2('')
          setCodesSubmitted(false)
          setCodesError('')
          setError('')
          // Check if this judge already submitted a score for this run
          if (run && run.submitted && judgeId) {
            const alreadySubmitted = run.submitted.some(s => s.judge_id === judgeId)
            setSubmitted(alreadySubmitted)
          } else {
            setSubmitted(false)
          }
        } else if (run && run.submitted && judgeId) {
          // Same run — polling fallback for rejection detection.
          // If we think we submitted but our score is no longer in the array,
          // the HJ must have rejected it.
          const stillSubmitted = run.submitted.some(s => s.judge_id === judgeId)
          if (!stillSubmitted && submittedRef.current) {
            setScoreRejected(true)
            setSubmitted(false)
            setError('')
            if (isTurnsRef.current) {
              setCarving(null); setAbsExt(null); setUpperBody(null); setDeduction(0)
            } else if (isAirRef.current) {
              setAirJ1(null); setAirJ2(null)
              setCodesSubmitted(false)
              setCode1(''); setCode2('')
            }
            setStatus('Score rejected -- please resubmit')
          }
        }
      } catch {}
    }
    poll()
    pollRef.current = setInterval(poll, 3000)
    return () => clearInterval(pollRef.current)
  }, [eventId, activeRun?.id, isDual, resolving])

  useEffect(() => {
    if (isDual) return
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${wsProto}//${location.host}`)
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.eventId === eventId && msg.type === 'score_update') {
          if (msg.data?.rejected && msg.data?.rejectedJudgeId === judgeId) {
            setScoreRejected(true)
            setSubmitted(false)
            setError('')
            // Clear only the specific rejected score type
            const rt = msg.data?.rejectedScoreType
            if (rt === 'turns') {
              setCarving(null)
              setAbsExt(null)
              setUpperBody(null)
              setDeduction(0)
            } else if (rt === 'air_jump1') {
              setAirJ1(null)
            } else if (rt === 'air_jump2') {
              setAirJ2(null)
            } else {
              // Fallback: clear everything if score type unknown
              setCarving(null); setAbsExt(null); setUpperBody(null); setDeduction(0)
              setAirJ1(null); setAirJ2(null)
            }
            setStatus('Score rejected -- please resubmit')
          } else {
            setStatus('Score recorded')
          }
          // Age group transition
          if (msg.data?.age_group_transition) {
            setAgeGroupTransition(msg.data.age_group_transition)
            setTimeout(() => setAgeGroupTransition(null), 15000)
          }
        }
        if (msg.eventId === eventId && msg.type === 'run_updated' && msg.data?.age_group_transition) {
          setAgeGroupTransition(msg.data.age_group_transition)
          setTimeout(() => setAgeGroupTransition(null), 15000)
        }
        if (msg.eventId === eventId && msg.type === 'run_round_status' && msg.data?.event_completed) {
          setEventCompleted(true)
        }
      } catch {}
    }
    wsRef.current = ws
    return () => ws.close()
  }, [eventId, judgeId, isDual])

  // If this is a dual mogul judge, render the dual-specific view
  if (isDual && judge) {
    return <DualJudgeView eventId={eventId} judge={judge} hc={hc} toggleHc={toggleHc} />
  }

  const submitCodes = async () => {
    if (!activeRun || !code1 || (numJumps >= 2 && !code2)) { setCodesError(numJumps >= 2 ? 'Both jump codes are required' : 'Jump code is required'); return }
    setCodesError('')
    try {
      const codeBody = { jump1_code: code1.trim() }
      if (numJumps >= 2) codeBody.jump2_code = code2.trim()
      const res = await fetch(`${API}/events/${eventId}/runs/${activeRun.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(codeBody)
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to submit codes')
      }
      const updated = await res.json()
      setActiveRun(prev => ({ ...prev, ...updated }))
      setCodesSubmitted(true)
    } catch (e) {
      setCodesError(e.message)
    }
  }

  const turnsTotal = isTurns
    ? (componentScoring
        ? Math.max(0.1, Math.min(20, (carving || 0) + (absExt || 0) + (upperBody || 0) - (deduction || 0)))
        : Math.max(0.1, Math.min(20, (carving || 0) - (deduction || 0))))
    : null

  const submitScore = async () => {
    if (!activeRun || !judgeId) return
    setError('')

    const submissions = []
    if (isTurns) {
      if (componentScoring) {
        if (carving === null || absExt === null || upperBody === null) {
          setError('Please enter all three T&L component scores before submitting')
          return
        }
        submissions.push({ score_type: 'turns', raw_score: turnsTotal, carving, abext: absExt, upper_body: upperBody, deduction })
      } else {
        if (carving === null) {
          setError('Please enter a T&L total before submitting')
          return
        }
        submissions.push({ score_type: 'turns', raw_score: turnsTotal, deduction })
      }
    }
    if (isAir) {
      if (airJ1 === null) {
        setError('Jump 1 score is required')
        return
      }
      if (numJumps >= 2 && airJ2 === null) {
        setError('Jump 2 score is required')
        return
      }
      submissions.push({ score_type: 'air_jump1', raw_score: airJ1 })
      if (numJumps >= 2) submissions.push({ score_type: 'air_jump2', raw_score: airJ2 })
    }

    if (!submissions.length) { setError('Please enter a score before submitting'); return }

    try {
      for (const sub of submissions) {
        const res = await fetch(`${API}/events/${eventId}/runs/${activeRun.id}/scores`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ judge_id: judgeId, pin, ...sub })
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error)
        }
      }
      setSubmitted(true)
      setScoreRejected(false)
      setStatus('Score submitted')
    } catch (e) {
      setError(e.message)
    }
  }

  if (eventCompleted) return (
    <div className={`min-h-screen ${hc ? 'hc bg-black' : 'bg-slate-950'} text-white flex items-center justify-center`}>
      <div className="text-center">
        <div className="text-4xl font-display text-emerald-400 mb-4">Event Completed</div>
        <div className="text-xl text-slate-300">Thank You for Your Work</div>
      </div>
    </div>
  )

  if (!judgeId) return (
    <div className={`min-h-screen ${hc ? 'hc bg-black' : 'bg-slate-950'} flex items-center justify-center p-6`}>
      <div className="text-center space-y-4">
        <div className="text-4xl">&#9975;</div>
        <div className="text-xl font-bold"><span className="text-white">Stick</span><span style={{ color: '#EF4444' }}>It</span></div>
        <div className="text-slate-400">No judge ID provided. Use the link from the admin console.</div>
      </div>
    </div>
  )

  return (
    <div className={`min-h-screen ${hc ? 'hc bg-black' : 'bg-slate-950'} text-white`}>
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <div>
          <div className="font-bold text-white">{judge?.name || 'Loading...'}</div>
          <div className="text-xs text-slate-400">{judge?.role || ''} Judge</div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleHc} className={`px-3 py-1 rounded-full text-xs font-bold border-2 transition-colors ${hc ? 'bg-yellow-400 text-black border-yellow-400' : 'bg-slate-700 text-slate-300 border-slate-600'}`}>{hc ? 'Normal' : 'Hi-Contrast'}</button>
          <div className={`text-xs px-2 py-1 rounded-full ${
            submitted ? 'bg-green-900/50 text-green-400' : 'bg-blue-900/50 text-blue-400'
          }`}>
            {status}
          </div>
        </div>
      </div>

      <div className="p-4 max-w-5xl mx-auto">
        {ageGroupTransition && (
          <div
            onClick={() => setAgeGroupTransition(null)}
            className="mb-4 bg-amber-600 text-black font-bold text-center text-lg py-4 px-6 rounded-2xl cursor-pointer animate-pulse"
          >
            {ageGroupTransition.completed} group complete {ageGroupTransition.next ? `\u2014 ${ageGroupTransition.next} up next` : '\u2014 All groups complete'}
          </div>
        )}
        {activeRun ? (
          <div className="bg-slate-800 rounded-2xl p-5 border border-slate-700">
            <div className={`text-xs uppercase tracking-wide mb-1 ${activeRun.is_forerunner ? 'text-orange-400' : 'text-slate-400'}`}>
              {activeRun.is_forerunner ? 'Forerunner (Judge Test)' : 'Now Scoring'}
            </div>
            <div className="text-3xl font-bold text-white">
              {activeRun.is_forerunner ? 'Forerunner' : `${activeRun.first_name} ${activeRun.last_name}`}
            </div>
            <div className="flex gap-4 mt-2 text-sm text-slate-400 flex-wrap">
              {!activeRun.is_forerunner && <span>Bib #{activeRun.bib_number}</span>}
              {activeRun.run_position != null && activeRun.total_runners != null && (
                <span className="text-slate-200 font-medium">Athlete {activeRun.run_position} of {activeRun.total_runners}</span>
              )}
              {activeRun.jump1_code && <span>Jump 1: <strong className="text-white">{activeRun.jump1_code}</strong></span>}
              {activeRun.jump2_code && <span>Jump 2: <strong className="text-white">{activeRun.jump2_code}</strong></span>}
            </div>
            {activeRun.jump1_code && activeRun.jump2_code &&
             activeRun.jump1_code.trim().toLowerCase().replace(/r/g,'') === activeRun.jump2_code.trim().toLowerCase().replace(/r/g,'') && (
              <div className="mt-2 text-xs text-amber-400 bg-amber-900/20 border border-amber-800 rounded px-3 py-1.5">
                Duplicate jump codes -- Jump 2 receives DD 0.00 (no credit for repeated jump).
              </div>
            )}
          </div>
        ) : (
          <div className="bg-slate-800 rounded-2xl p-8 text-center border border-slate-700">
            <div className="text-5xl mb-3">&#9203;</div>
            <div className="text-slate-400">Waiting for next athlete...</div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4 mt-4">
        <div className="space-y-6">

        {activeRun && !submitted && isAir && (
          <div className={`rounded-2xl p-5 border ${codesSubmitted ? 'border-green-800 bg-green-900/10' : 'border-amber-700 bg-amber-900/10'} space-y-4`}>
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-white uppercase tracking-wide">Jump Codes</div>
              {codesSubmitted && <span className="text-xs text-green-400 font-semibold">Confirmed</span>}
            </div>
            {!codesSubmitted ? (
              <>
                {/* Quick-select buttons for frequent codes */}
                {(() => {
                  const COMP_FREQ_CODES = ['N','S','T','K','TS','3','bT','bp','bL','bG','bF','7op','7oG']
                  const DEVO_FREQ_CODES = ['S','T','D','X','K','TS','TT','TD','TTS','3','3p']
                  const isRestricted = eventDivision === 'devo' || eventDivision === 'rqs_eqs'
                  const FREQ_CODES = isRestricted ? DEVO_FREQ_CODES : COMP_FREQ_CODES
                  return (
                    <div className="space-y-2">
                      <div className="text-xs text-slate-500 uppercase tracking-wide">Quick Select</div>
                      <div className={`grid ${numJumps >= 2 ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
                        <div>
                          <div className="text-xs text-slate-500 mb-1">Jump 1</div>
                          <div className="flex flex-wrap gap-1.5">
                            {FREQ_CODES.map(c => (
                              <button key={c} onClick={() => setCode1(c)}
                                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold font-mono transition-all ${code1 === c ? 'bg-blue-600 text-white ring-2 ring-blue-400' : 'bg-slate-700 text-slate-200 hover:bg-slate-600 active:bg-slate-500'}`}
                              >{c}</button>
                            ))}
                          </div>
                          <button onClick={() => { setCode1('NJ'); setAirJ1(0) }}
                            className={`mt-1.5 px-3 py-1.5 rounded-lg text-xs font-bold font-mono transition-all ${code1 === 'NJ' ? 'bg-red-700 text-white ring-2 ring-red-400' : 'bg-red-900/60 text-red-300 hover:bg-red-800 active:bg-red-700 border border-red-700'}`}
                          >No Jump</button>
                        </div>
                        {numJumps >= 2 && (
                          <div>
                            <div className="text-xs text-slate-500 mb-1">Jump 2</div>
                            <div className="flex flex-wrap gap-1.5">
                              {FREQ_CODES.map(c => (
                                <button key={c} onClick={() => setCode2(c)}
                                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold font-mono transition-all ${code2 === c ? 'bg-blue-600 text-white ring-2 ring-blue-400' : 'bg-slate-700 text-slate-200 hover:bg-slate-600 active:bg-slate-500'}`}
                                >{c}</button>
                              ))}
                            </div>
                            <button onClick={() => { setCode2('NJ'); setAirJ2(0) }}
                              className={`mt-1.5 px-3 py-1.5 rounded-lg text-xs font-bold font-mono transition-all ${code2 === 'NJ' ? 'bg-red-700 text-white ring-2 ring-red-400' : 'bg-red-900/60 text-red-300 hover:bg-red-800 active:bg-red-700 border border-red-700'}`}
                            >No Jump</button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })()}
                <div className={`grid ${numJumps >= 2 ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
                  <div>
                    <label className="text-xs text-slate-400 uppercase tracking-wide mb-1 block">Jump 1</label>
                    <select className="w-full bg-slate-800 border-2 border-slate-600 focus:border-blue-500 rounded-xl px-3 py-3 text-white font-mono text-lg outline-none" value={code1} onChange={e => setCode1(e.target.value)}>
                      <option value="">-- Select --</option>
                      {(() => { const isR = eventDivision === 'devo' || eventDivision === 'rqs_eqs'; const dds = isR ? jumpDDs.filter(d => !/^[bfl]|o/.test(d.jump_code)) : jumpDDs; return dds.map(d => <option key={d.jump_code} value={d.jump_code}>{d.jump_code === 'bP' ? `⚠ ${d.jump_code} (DD ${d.dd_value}) — rarely used` : `${d.jump_code} (DD ${d.dd_value})`}</option>) })()}
                    </select>
                  </div>
                  {numJumps >= 2 && (
                    <div>
                      <label className="text-xs text-slate-400 uppercase tracking-wide mb-1 block">Jump 2</label>
                      <select className="w-full bg-slate-800 border-2 border-slate-600 focus:border-blue-500 rounded-xl px-3 py-3 text-white font-mono text-lg outline-none" value={code2} onChange={e => setCode2(e.target.value)}>
                        <option value="">-- Select --</option>
                        {(() => { const isR = eventDivision === 'devo' || eventDivision === 'rqs_eqs'; const dds = isR ? jumpDDs.filter(d => !/^[bfl]|o/.test(d.jump_code)) : jumpDDs; return dds.map(d => <option key={d.jump_code} value={d.jump_code}>{d.jump_code === 'bP' ? `⚠ ${d.jump_code} (DD ${d.dd_value}) — rarely used` : `${d.jump_code} (DD ${d.dd_value})`}</option>) })()}
                      </select>
                    </div>
                  )}
                </div>
                {numJumps >= 2 && code1 && code2 && code1.trim().toLowerCase().replace(/r/g,'') === code2.trim().toLowerCase().replace(/r/g,'') && (
                  <div className="text-xs text-amber-400 bg-amber-900/20 border border-amber-800 rounded px-3 py-1.5">
                    Duplicate codes -- Jump 2 will receive DD 0.00 (no credit for repeated jump).
                  </div>
                )}
                {codesError && <div className="text-red-400 text-sm">{codesError}</div>}
                <button onClick={submitCodes} disabled={!code1 || (numJumps >= 2 && !code2)} className="w-full bg-amber-600 hover:bg-amber-500 active:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-lg py-4 rounded-2xl transition-colors">
                  Confirm Jump Codes
                </button>
              </>
            ) : (
              <div className="text-sm text-slate-300 space-y-1">
                <div>Jump 1: <strong className="text-white font-mono">{activeRun.jump1_code || code1}</strong>
                  {activeRun.jump1_dd && <span className="text-slate-500 ml-2">(DD {activeRun.jump1_dd})</span>}
                </div>
                {numJumps >= 2 && (
                  <div>Jump 2: <strong className="text-white font-mono">{activeRun.jump2_code || code2}</strong>
                    {activeRun.jump2_dd && <span className="text-slate-500 ml-2">(DD {activeRun.jump2_dd})</span>}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {scoreRejected && activeRun && !submitted && (
          <div className="bg-red-900/30 border border-red-700 rounded-2xl px-5 py-4 space-y-1">
            <div className="text-red-300 font-bold text-base">Your score was rejected</div>
            <div className="text-red-400 text-sm">The Head Judge has rejected your previous score.  Please enter and submit a new score below.</div>
          </div>
        )}

        {activeRun && !submitted && (isAir ? codesSubmitted : true) && (
          <div className="bg-slate-900 rounded-2xl p-5 border border-slate-700 space-y-6">
            {isTurns && componentScoring && (
              <div className="space-y-5">
                <ScorePad label="Carving"               value={carving}   onChange={setCarving}   min={0} max={10} step={0.5} />
                <ScorePad label="Absorption / Extension" value={absExt}    onChange={setAbsExt}    min={0} max={5}  step={0.5} />
                <ScorePad label="Upper Body"             value={upperBody} onChange={setUpperBody} min={0} max={5}  step={0.5} />
                <DeductionPad value={deduction} onChange={setDeduction} />
                <div className="bg-slate-800 border border-slate-600 rounded-xl px-5 py-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-sm font-semibold uppercase tracking-wide">T&amp;L Total</span>
                    <span className={`text-3xl font-bold font-mono ${carving !== null && absExt !== null && upperBody !== null ? 'text-white hc-score' : 'text-slate-600'}`}>
                      {carving !== null && absExt !== null && upperBody !== null
                        ? Math.max(0.1, Math.min(20, turnsTotal)).toFixed(1)
                        : '--'}
                    </span>
                  </div>
                  {carving !== null && absExt !== null && upperBody !== null && (
                    <div className="text-xs text-slate-400 font-mono text-right">
                      {(carving || 0).toFixed(1)} + {(absExt || 0).toFixed(1)} + {(upperBody || 0).toFixed(1)} - {(deduction || 0).toFixed(1)} = {Math.max(0.1, Math.min(20, turnsTotal)).toFixed(1)}
                    </div>
                  )}
                </div>
              </div>
            )}
            {isTurns && !componentScoring && (
              <div className="space-y-5">
                <ScorePad label="T&L Total"             value={carving}   onChange={setCarving}   min={0} max={20} step={0.5} />
                <DeductionPad value={deduction} onChange={setDeduction} />
                <div className="bg-slate-800 border border-slate-600 rounded-xl px-5 py-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-sm font-semibold uppercase tracking-wide">Final T&amp;L Score</span>
                    <span className={`text-3xl font-bold font-mono ${carving !== null ? 'text-white hc-score' : 'text-slate-600'}`}>
                      {carving !== null
                        ? Math.max(0.1, Math.min(20, turnsTotal)).toFixed(1)
                        : '--'}
                    </span>
                  </div>
                  {carving !== null && (
                    <div className="text-xs text-slate-400 font-mono text-right">
                      {(carving || 0).toFixed(1)} - {(deduction || 0).toFixed(1)} = {Math.max(0.1, Math.min(20, turnsTotal)).toFixed(1)}
                    </div>
                  )}
                </div>
              </div>
            )}
            {isAir && (
              <>
                <ScorePad label={`Jump 1 Score${activeRun.jump1_code ? ` (${activeRun.jump1_code} - DD: ${activeRun.jump1_dd})` : ''}`} value={airJ1} onChange={setAirJ1} min={0} max={10} step={0.5} />
                {numJumps >= 2 && <ScorePad label={`Jump 2 Score${activeRun.jump2_code ? ` (${activeRun.jump2_code} - DD: ${activeRun.jump2_dd})` : ''}`} value={airJ2} onChange={setAirJ2} min={0} max={10} step={0.5} />}
              </>
            )}
            {error && <div className="bg-red-900/30 text-red-400 rounded-lg px-4 py-3 text-sm">{error}</div>}
            <button onClick={submitScore} className="w-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold text-xl py-5 rounded-2xl transition-colors">
              Submit Score
            </button>
          </div>
        )}

        {submitted && activeRun && (
          <div className="bg-green-900/20 border border-green-800 rounded-2xl p-8 text-center">
            <div className="text-5xl mb-3">&#10003;</div>
            <div className="text-green-400 text-xl font-bold">Score Submitted</div>
            {isTurns && turnsTotal !== null && (
              <div className="text-white text-lg mt-2 space-y-1">
                <div className="text-2xl font-bold hc-score">T&amp;L Total: {Math.max(0.1, Math.min(20, turnsTotal)).toFixed(1)}</div>
                <div className="text-slate-400 text-sm font-mono">
                  {componentScoring
                    ? `${(carving || 0).toFixed(1)} + ${(absExt || 0).toFixed(1)} + ${(upperBody || 0).toFixed(1)} - ${(deduction || 0).toFixed(1)} = ${Math.max(0.1, Math.min(20, turnsTotal)).toFixed(1)}`
                    : `${(carving || 0).toFixed(1)} - ${(deduction || 0).toFixed(1)} = ${Math.max(0.1, Math.min(20, turnsTotal)).toFixed(1)}`
                  }
                </div>
              </div>
            )}
            {isAir && (
              <div className="text-white text-lg mt-2">
                {airJ1 !== null && <div>Jump 1: {Number(airJ1).toFixed(1)}</div>}
                {airJ2 !== null && <div>Jump 2: {Number(airJ2).toFixed(1)}</div>}
              </div>
            )}
            <div className="text-slate-400 text-sm mt-4">Waiting for next athlete...</div>
          </div>
        )}
        </div>
        <div className="lg:sticky lg:top-4 lg:self-start">
          <ScoreReference isTurns={isTurns} isAir={isAir} componentScoring={componentScoring} />
        </div>
        </div>
      </div>
    </div>
  )
}
