import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import useHighContrast from '../hooks/useHighContrast'
import useResolveIds from '../hooks/useResolveIds'

const API = '/api'

export default function TimekeeperTablet() {
  const { eventId: rawEventId } = useParams()
  const { eventId: rEvt, loading: resolving } = useResolveIds({ event: rawEventId })
  const eventId = rEvt || rawEventId

  const [hc, toggleHc] = useHighContrast()
  const [activeRun, setActiveRun]   = useState(null)
  const [timeInput, setTimeInput]   = useState('')
  const [submitted, setSubmitted]   = useState(false)
  const [error, setError]           = useState('')
  const [statusMsg, setStatusMsg]   = useState('Waiting for next athlete...')
  const [eventInfo, setEventInfo]   = useState(null)
  const [nextUp, setNextUp]         = useState(null)
  const [starting, setStarting]     = useState(false)
  const [phaseLabel, setPhaseLabel] = useState(null) // v1.9.00: active phase label
  const [showManualCalc, setShowManualCalc] = useState(false)
  const [topTimer, setTopTimer]   = useState('')
  const [botTimer, setBotTimer]   = useState('')
  const [calcError, setCalcError] = useState('')
  const [ageGroupTransition, setAgeGroupTransition] = useState(null)
  const [eventCompleted, setEventCompleted] = useState(false)
  const pollRef = useRef(null)
  const wsRef   = useRef(null)

  // Fetch event info once (and on eventId change)
  useEffect(() => {
    if (resolving) return
    const fetchInfo = async () => {
      try {
        const r = await fetch(`${API}/events/${eventId}/runs/info`)
        const data = await r.json()
        if (data) setEventInfo(data)
      } catch {}
    }
    fetchInfo()
  }, [eventId, resolving])

  // v1.9.00: Fetch next-up athlete (phase-aware — server determines active run_number)
  const fetchNextUp = async () => {
    try {
      const r = await fetch(`${API}/events/${eventId}/runs/next-up`)
      const data = await r.json()
      if (data?.id) {
        setNextUp(data)
        if (data.phase_label) setPhaseLabel(data.phase_label)
      } else {
        setNextUp(null)
      }
    } catch { setNextUp(null) }
  }

  const noPaceTime = eventInfo && !eventInfo.pace_time && !eventInfo.course_length
  const isDualMogul = eventInfo && eventInfo.discipline === 'dual_mogul'
  const isPaper = eventInfo?.score_entry_mode === 'paper'
  const isDevo = eventInfo?.division === 'devo'

  // Poll for active run every 2 seconds
  useEffect(() => {
    if (resolving) return
    const poll = async () => {
      try {
        const r   = await fetch(`${API}/events/${eventId}/runs/active`)
        const data = await r.json()
        if (data?.event_completed) { setEventCompleted(true); setActiveRun(null); return }
        const run = data?.id ? data : null
        if (run?.id !== activeRun?.id) {
          setActiveRun(run)
          // Check if time was already submitted for this run (refresh persistence)
          const alreadySubmitted = run && run.run_time != null
          setSubmitted(alreadySubmitted)
          if (!alreadySubmitted) {
            setTimeInput('')
            setError('')
          }
          setStatusMsg(run ? (alreadySubmitted ? 'Time submitted' : 'Run in progress') : 'Waiting for next athlete...')
        }
        // Always refresh next-up when no active run (or in paper mode, always)
        if (!run || isPaper) fetchNextUp()
      } catch {}
    }
    poll()
    pollRef.current = setInterval(poll, 2000)
    return () => clearInterval(pollRef.current)
  }, [eventId, activeRun?.id, isPaper, resolving])

  // WebSocket for instant score_update notifications
  useEffect(() => {
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${wsProto}//${location.host}`)
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.eventId === eventId && (msg.type === 'score_update' || msg.type === 'run_updated')) {
          if (msg.type === 'score_update') setStatusMsg('Score finalized')
          if (msg.data?.event_completed) setEventCompleted(true)
          if (msg.data?.age_group_transition) {
            setAgeGroupTransition(msg.data.age_group_transition)
            setTimeout(() => setAgeGroupTransition(null), 15000)
          }
        }
      } catch {}
    }
    wsRef.current = ws
    return () => ws.close()
  }, [eventId])

  const submitTime = async () => {
    if (!activeRun) { setError('No active run'); return }
    if (noPaceTime) { setError('Time cannot be entered until course length is set in event settings'); return }
    const t = parseFloat(timeInput)
    if (isNaN(t) || t <= 0) { setError('Enter a valid time in seconds (e.g. 26.54)'); return }
    setError('')
    try {
      const res = await fetch(`${API}/events/${eventId}/runs/${activeRun.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_time: t }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Submit failed')
      }
      setSubmitted(true)
      setStatusMsg('Time submitted')
    } catch (e) { setError(e.message) }
  }

  const handleKey = (e) => { if (e.key === 'Enter') submitTime() }

  // Parse hh:mm:ss.ss to total seconds (base-60)
  const parseTimeToSeconds = (str) => {
    const trimmed = (str || '').trim()
    if (!trimmed) return null
    // Accept hh:mm:ss.ss or mm:ss.ss or ss.ss
    const parts = trimmed.split(':')
    let hours = 0, minutes = 0, seconds = 0
    if (parts.length === 3) {
      hours = parseInt(parts[0], 10) || 0
      minutes = parseInt(parts[1], 10) || 0
      seconds = parseFloat(parts[2]) || 0
    } else if (parts.length === 2) {
      minutes = parseInt(parts[0], 10) || 0
      seconds = parseFloat(parts[1]) || 0
    } else if (parts.length === 1) {
      seconds = parseFloat(parts[0]) || 0
    } else {
      return null
    }
    if (minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60 || hours < 0) return null
    return hours * 3600 + minutes * 60 + seconds
  }

  const calculateManualTime = () => {
    setCalcError('')
    const topSec = parseTimeToSeconds(topTimer)
    const botSec = parseTimeToSeconds(botTimer)
    if (topSec === null) { setCalcError('Invalid Top Timer format. Use hh:mm:ss.ss'); return }
    if (botSec === null) { setCalcError('Invalid Bottom Timer format. Use hh:mm:ss.ss'); return }
    const diff = botSec - topSec
    if (diff <= 0) { setCalcError('Bottom Timer must be later than Top Timer'); return }
    setTimeInput(diff.toFixed(2))
    setShowManualCalc(false)
    setTopTimer('')
    setBotTimer('')
  }

  const startNextRun = async () => {
    if (!nextUp) return
    setStarting(true); setError('')
    try {
      const res = await fetch(`${API}/events/${eventId}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registration_id: nextUp.id, run_number: nextUp.run_number || 1, round: 'qualification' }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to start run')
      }
      setStatusMsg('Run started')
      setNextUp(null)
    } catch (e) { setError(e.message) }
    finally { setStarting(false) }
  }

  if (eventCompleted) return (
    <div className={`min-h-screen ${hc ? 'hc bg-black' : 'bg-slate-950'} text-white flex items-center justify-center`}>
      <div className="text-center">
        <div className="text-4xl font-display text-emerald-400 mb-4">Event Completed</div>
        <div className="text-xl text-slate-300">Thank You for Your Work</div>
      </div>
    </div>
  )

  return (
    <div className={`min-h-screen ${hc ? 'hc bg-black' : 'bg-slate-950'} text-white`}>
      {/* Header */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <div>
          <div className="font-bold text-white text-lg">Timekeeper</div>
          <div className="text-xs text-slate-400"><span className="text-white">Stick</span><span style={{ color: '#EF4444' }}>It</span> System</div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleHc} className={`px-3 py-1 rounded-full text-xs font-bold border-2 transition-colors ${hc ? 'bg-yellow-400 text-black border-yellow-400' : 'bg-slate-700 text-slate-300 border-slate-600'}`}>{hc ? 'Normal' : 'Hi-Contrast'}</button>
          <div className={`text-xs px-3 py-1 rounded-full ${
            isDualMogul  ? 'bg-slate-800    text-slate-400'   :
            isDevo       ? 'bg-slate-800    text-slate-400'   :
            isPaper      ? 'bg-amber-900/50 text-amber-400'  :
            submitted    ? 'bg-green-900/50 text-green-400'  :
            activeRun    ? 'bg-blue-900/50  text-blue-400 animate-pulse' :
                           'bg-slate-800    text-slate-400'
          }`}>
            {isDualMogul ? 'Disabled' : isDevo ? 'No Time — Devo' : isPaper ? 'Paper Entry — Start Only' : statusMsg}
          </div>
        </div>
      </div>

      <div className="p-4 space-y-6 max-w-lg mx-auto">

        {ageGroupTransition && (
          <div
            onClick={() => setAgeGroupTransition(null)}
            className="bg-amber-600 text-black font-bold text-center text-lg py-4 px-6 rounded-2xl cursor-pointer animate-pulse"
          >
            {ageGroupTransition.completed} group complete {ageGroupTransition.next ? `\u2014 ${ageGroupTransition.next} up next` : '\u2014 All groups complete'}
          </div>
        )}

        {/* Dual mogul: timekeeper not used */}
        {isDualMogul && (
          <div className="bg-slate-800 rounded-2xl p-8 text-center border border-slate-700">
            <div className="text-5xl mb-3 text-slate-500">&#9203;</div>
            <div className="text-slate-300 text-lg font-semibold mb-2">Timekeeper Not Required</div>
            <div className="text-slate-500 text-sm">
              Dual Moguls does not use timed scoring.  Time scores are entered by the timing judge on the judge tablet.
            </div>
          </div>
        )}

        {/* Devo: no time scoring */}
        {isDevo && !isDualMogul && !activeRun && (
          <div className="bg-slate-800 rounded-2xl p-8 text-center border border-slate-700">
            <div className="text-5xl mb-3 text-slate-500">&#9203;</div>
            <div className="text-slate-300 text-lg font-semibold mb-2">No Time for Devo Events</div>
            <div className="text-slate-500 text-sm">
              Devo events do not use timed scoring.
            </div>
          </div>
        )}

        {/* Devo active run: show athlete but no time entry, allow starting next */}
        {isDevo && activeRun && !isDualMogul && (
          <div className="bg-slate-800 rounded-2xl p-5 border border-slate-700">
            <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">Now Running</div>
            <div className="text-3xl font-bold text-white">
              {activeRun.first_name} {activeRun.last_name}
            </div>
            <div className="flex flex-wrap gap-4 mt-2 text-sm text-slate-400">
              <span>Bib #{activeRun.bib_number}</span>
              {activeRun.run_position != null && activeRun.total_runners != null && (
                <span className="text-slate-200 font-medium">
                  Athlete {activeRun.run_position} of {activeRun.total_runners}
                </span>
              )}
            </div>
            <div className="mt-3 text-amber-400 text-sm font-semibold">No time required for Devo events.</div>
            {nextUp && (
              <div className="border-t border-slate-700 mt-4 pt-4 space-y-3 text-center">
                <div className="text-xs text-slate-500 uppercase tracking-wide">Next Up{nextUp.phase_label ? ` — ${nextUp.phase_label}` : ''}</div>
                <div className="text-xl font-bold text-white">{nextUp.last_name}, {nextUp.first_name}</div>
                <div className="text-sm text-slate-400">Bib #{nextUp.bib_number} {nextUp.run_order != null && <span className="ml-2">Order: {nextUp.run_order}</span>}</div>
                <div className="flex gap-2">
                  <button
                    onClick={startNextRun}
                    disabled={starting}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-lg py-4 rounded-2xl transition-colors"
                  >
                    {starting ? 'Starting...' : `Start ${nextUp.phase_label || 'Next Run'}`}
                  </button>
                  <button
                    onClick={async () => {
                      if (!window.confirm(`Mark ${nextUp.last_name}, ${nextUp.first_name} as DNS?`)) return;
                      try {
                        const res = await fetch(`${API}/events/${eventId}/runs/manual`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ registration_id: nextUp.id, run_number: nextUp.run_number || 1, round: 'qualification', run_status: 'DNS' }),
                        });
                        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'Failed'); }
                        setNextUp(null);
                      } catch (e) { setError('DNS failed: ' + e.message); }
                    }}
                    className="bg-yellow-500 hover:bg-yellow-600 text-black font-bold text-sm px-4 py-4 rounded-2xl transition-colors"
                  >
                    DNS
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Pace time info banner */}
        {eventInfo && !isDualMogul && !isPaper && !isDevo && (
          <div className="bg-slate-900 rounded-xl p-3 border border-slate-800 text-sm">
            <div className="flex flex-wrap gap-4 text-slate-400">
              {eventInfo.course_length && (
                <span>Course: <strong className="text-white">{eventInfo.course_length}m</strong></span>
              )}
              {eventInfo.pace_time && (
                <span>Pace Time: <strong className="text-emerald-400">{Number(eventInfo.pace_time).toFixed(2)}s</strong></span>
              )}
              {eventInfo.gender && (
                <span>Gender: <strong className="text-white">{eventInfo.gender === 'F' ? 'Women' : 'Men'}</strong></span>
              )}
            </div>
          </div>
        )}

        {/* No pace time warning */}
        {noPaceTime && !isDualMogul && !isPaper && !isDevo && (
          <div className="bg-amber-900/30 border border-amber-700 rounded-xl p-4 text-amber-400 text-sm">
            <strong>Time cannot be entered until course length is completed.</strong>
            <div className="text-amber-500 mt-1">Course length must be set in the event configuration before time scoring is available.</div>
          </div>
        )}

        {/* Current athlete banner */}
        {!isDualMogul && !isDevo && activeRun ? (
          <div className="bg-slate-800 rounded-2xl p-5 border border-slate-700">
            <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">Now Running</div>
            <div className="text-3xl font-bold text-white">
              {activeRun.first_name} {activeRun.last_name}
            </div>
            <div className="flex flex-wrap gap-4 mt-2 text-sm text-slate-400">
              <span>Bib #{activeRun.bib_number}</span>
              {activeRun.run_position != null && activeRun.total_runners != null && (
                <span className="text-slate-200 font-medium">
                  Athlete {activeRun.run_position} of {activeRun.total_runners}
                </span>
              )}
              {activeRun.jump1_code && (
                <span>J1: <strong className="text-white">{activeRun.jump1_code}</strong></span>
              )}
              {activeRun.jump2_code && (
                <span>J2: <strong className="text-white">{activeRun.jump2_code}</strong></span>
              )}
            </div>
            {activeRun.run_time != null && (
              <div className={`mt-2 text-sm font-semibold ${activeRun.run_time == -1 ? 'text-red-400' : 'text-green-400'}`}>
                {activeRun.run_time == -1 ? 'No Time (NT)' : `Time recorded: ${Number(activeRun.run_time).toFixed(2)}s`}
              </div>
            )}
          </div>
        ) : !isDualMogul && !isDevo ? (
          <div className="bg-slate-800 rounded-2xl p-6 text-center border border-slate-700 space-y-4">
            <div className="text-5xl mb-1 text-slate-500">&#9203;</div>
            <div className="text-slate-400 text-lg">Waiting for next athlete...</div>
            <div className="text-xs text-slate-500">The next athlete must be started from the Scoring tab or by tapping Start below.</div>
            {nextUp && (
              <div className="mt-3 border-t border-slate-700 pt-4 space-y-3">
                <div className="text-xs text-slate-500 uppercase tracking-wide">Next Up{nextUp.phase_label ? ` — ${nextUp.phase_label}` : ''}</div>
                <div className="text-xl font-bold text-white">{nextUp.last_name}, {nextUp.first_name}</div>
                <div className="text-sm text-slate-400">Bib #{nextUp.bib_number} {nextUp.run_order != null && <span className="ml-2">Order: {nextUp.run_order}</span>}</div>
                <div className="flex gap-2">
                  <button
                    onClick={startNextRun}
                    disabled={starting}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-lg py-4 rounded-2xl transition-colors"
                  >
                    {starting ? 'Starting...' : `Start ${nextUp.phase_label || 'Run'}`}
                  </button>
                  <button
                    onClick={async () => {
                      if (!window.confirm(`Mark ${nextUp.last_name}, ${nextUp.first_name} as DNS?`)) return;
                      try {
                        const res = await fetch(`${API}/events/${eventId}/runs/manual`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ registration_id: nextUp.id, run_number: nextUp.run_number || 1, round: 'qualification', run_status: 'DNS' }),
                        });
                        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'Failed'); }
                        setNextUp(null);
                      } catch (e) { setError('DNS failed: ' + e.message); }
                    }}
                    className="bg-yellow-500 hover:bg-yellow-600 text-black font-bold text-sm px-4 py-4 rounded-2xl transition-colors"
                  >
                    DNS
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {/* Paper mode: no time entry, show start next run */}
        {isPaper && activeRun && !isDualMogul && (
          <div className="bg-amber-900/20 border border-amber-700 rounded-2xl p-5 text-center space-y-4">
            <div className="text-amber-400 font-semibold mb-1">Paper Entry Mode</div>
            <div className="text-slate-400 text-sm">Time entry disabled. Scores entered via admin console.</div>
            {nextUp && (
              <div className="border-t border-amber-800 pt-4 space-y-3">
                <div className="text-xs text-slate-500 uppercase tracking-wide">Next Up{nextUp.phase_label ? ` — ${nextUp.phase_label}` : ''}</div>
                <div className="text-xl font-bold text-white">{nextUp.last_name}, {nextUp.first_name}</div>
                <div className="text-sm text-slate-400">Bib #{nextUp.bib_number} {nextUp.run_order != null && <span className="ml-2">Order: {nextUp.run_order}</span>}</div>
                <div className="flex gap-2">
                  <button
                    onClick={startNextRun}
                    disabled={starting}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-lg py-4 rounded-2xl transition-colors"
                  >
                    {starting ? 'Starting...' : `Start ${nextUp.phase_label || 'Next Run'}`}
                  </button>
                  <button
                    onClick={async () => {
                      if (!window.confirm(`Mark ${nextUp.last_name}, ${nextUp.first_name} as DNS?`)) return;
                      try {
                        const res = await fetch(`${API}/events/${eventId}/runs/manual`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ registration_id: nextUp.id, run_number: nextUp.run_number || 1, round: 'qualification', run_status: 'DNS' }),
                        });
                        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'Failed'); }
                        setNextUp(null);
                      } catch (e) { setError('DNS failed: ' + e.message); }
                    }}
                    className="bg-yellow-500 hover:bg-yellow-600 text-black font-bold text-sm px-4 py-4 rounded-2xl transition-colors"
                  >
                    DNS
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Time entry */}
        {activeRun && !submitted && !noPaceTime && !isDualMogul && !isPaper && !isDevo && (
          <div className="bg-slate-900 rounded-2xl p-5 border border-slate-700 space-y-4">
            <div className="text-slate-400 text-sm font-semibold uppercase tracking-wide">
              Finish Time (seconds)
            </div>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="e.g. 26.54"
              value={timeInput}
              onChange={e => setTimeInput(e.target.value)}
              onKeyDown={handleKey}
              autoFocus
              className="w-full text-4xl font-bold text-center bg-slate-800 border-2 border-slate-600 focus:border-emerald-500 rounded-xl p-4 text-white outline-none"
              inputMode="decimal"
            />
            {/* Quick-select common times */}
            <div className="flex flex-wrap gap-2">
              {[20, 22, 24, 26, 28, 30, 32, 34].map(v => (
                <button
                  key={v}
                  onClick={() => setTimeInput(v + '.00')}
                  className={`px-3 py-2 rounded-lg text-sm font-bold transition-all ${
                    timeInput === v + '.00'
                      ? 'bg-emerald-600 text-white ring-2 ring-emerald-400'
                      : 'bg-slate-700 text-slate-200 hover:bg-slate-600 active:bg-slate-500'
                  }`}
                >
                  {v}s
                </button>
              ))}
            </div>

            <button
              onClick={() => { setCalcError(''); setShowManualCalc(true) }}
              className="w-full bg-slate-700 hover:bg-slate-600 active:bg-slate-500 text-white font-bold text-sm py-3 rounded-xl transition-colors border border-slate-600"
            >
              Manual Time Calculation
            </button>

            <button
              onClick={async () => {
                if (!activeRun) { setError('No active run'); return }
                if (!window.confirm(`Mark ${activeRun.first_name} ${activeRun.last_name} as No Time?`)) return
                setError('')
                try {
                  const res = await fetch(`${API}/events/${eventId}/runs/${activeRun.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ run_time: -1 }),
                  })
                  if (!res.ok) {
                    const err = await res.json()
                    throw new Error(err.error || 'Submit failed')
                  }
                  setSubmitted(true)
                  setStatusMsg('No Time submitted')
                } catch (e) { setError(e.message) }
              }}
              className="w-full bg-red-700 hover:bg-red-600 active:bg-red-800 text-white font-bold text-lg py-4 rounded-2xl transition-colors"
            >
              No Time
            </button>

            {error && (
              <div className="bg-red-900/30 text-red-400 rounded-lg px-4 py-3 text-sm">{error}</div>
            )}

            <button
              onClick={submitTime}
              disabled={!timeInput}
              className="w-full bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xl py-5 rounded-2xl transition-colors"
            >
              Submit Time
            </button>
          </div>
        )}

        {/* Submitted confirmation */}
        {submitted && activeRun && !isDualMogul && !isPaper && !isDevo && (
          activeRun.run_time == -1 ? (
            <div className="bg-red-900/20 border border-red-800 rounded-2xl p-8 text-center">
              <div className="text-red-400 text-5xl mb-3">NT</div>
              <div className="text-red-400 text-xl font-bold">No Time Submitted</div>
              <div className="text-slate-400 text-sm mt-4">Waiting for next athlete...</div>
            </div>
          ) : (
            <div className="bg-green-900/20 border border-green-800 rounded-2xl p-8 text-center">
              <div className="text-green-400 text-5xl mb-3">&#10003;</div>
              <div className="text-green-400 text-xl font-bold">Time Submitted</div>
              <div className="text-white text-4xl font-bold mt-2 hc-score">{timeInput}s</div>
              <div className="text-slate-400 text-sm mt-4">Waiting for next athlete...</div>
            </div>
          )
        )}

      </div>

      {/* Manual Time Calculation Modal */}
      {showManualCalc && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className={`${hc ? 'bg-black border-white' : 'bg-slate-900 border-slate-700'} border-2 rounded-2xl p-6 w-full max-w-md space-y-5`}>
            <div className="text-center">
              <div className="text-lg font-bold text-white">Manual Time Calculation</div>
              <div className="text-xs text-slate-400 mt-1">Enter synchronized stopwatch times. Run time = Bottom − Top.</div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-sm text-slate-400 font-semibold uppercase tracking-wide">Top Timer</label>
                <input
                  type="text"
                  placeholder="hh:mm:ss.ss"
                  value={topTimer}
                  onChange={e => setTopTimer(e.target.value)}
                  className="w-full text-2xl font-bold text-center bg-slate-800 border-2 border-slate-600 focus:border-blue-500 rounded-xl p-3 text-white outline-none mt-1"
                />
              </div>
              <div>
                <label className="text-sm text-slate-400 font-semibold uppercase tracking-wide">Bottom Timer</label>
                <input
                  type="text"
                  placeholder="hh:mm:ss.ss"
                  value={botTimer}
                  onChange={e => setBotTimer(e.target.value)}
                  className="w-full text-2xl font-bold text-center bg-slate-800 border-2 border-slate-600 focus:border-blue-500 rounded-xl p-3 text-white outline-none mt-1"
                />
              </div>
            </div>

            {calcError && (
              <div className="bg-red-900/30 text-red-400 rounded-lg px-4 py-3 text-sm">{calcError}</div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setShowManualCalc(false); setTopTimer(''); setBotTimer(''); setCalcError('') }}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={calculateManualTime}
                className="flex-1 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold py-3 rounded-xl transition-colors"
              >
                Calculate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
