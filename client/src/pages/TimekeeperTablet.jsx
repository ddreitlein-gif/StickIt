import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import useHighContrast from '../hooks/useHighContrast'
import useResolveIds from '../hooks/useResolveIds'
import AthleteBar from '../components/tablet/AthleteBar'
import HCModeButton from '../components/tablet/HCModeButton'

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
  const [phaseLabel, setPhaseLabel] = useState(null)
  const [showManualCalc, setShowManualCalc] = useState(false)
  const [topTimer, setTopTimer]   = useState('')
  const [botTimer, setBotTimer]   = useState('')
  const [calcError, setCalcError] = useState('')
  const [ageGroupTransition, setAgeGroupTransition] = useState(null)
  const [eventCompleted, setEventCompleted] = useState(false)
  const [recentTimes, setRecentTimes] = useState([])
  const [confirmNT, setConfirmNT]   = useState(false)
  const [confirmDNS, setConfirmDNS] = useState(false)
  const pollRef = useRef(null)
  const wsRef   = useRef(null)

  // Fetch event info + recent runs once on load
  useEffect(() => {
    if (resolving) return
    const fetchInfo = async () => {
      try {
        const r = await fetch(`${API}/events/${eventId}/runs/info`)
        const data = await r.json()
        if (data) setEventInfo(data)
      } catch {}
    }
    const fetchRecent = async () => {
      try {
        const r = await fetch(`${API}/events/${eventId}/runs`)
        const all = await r.json()
        if (Array.isArray(all)) {
          const completed = all
            .filter(x => x.run_time != null && x.run_time !== -1 && x.first_name)
            .slice(-8)
            .reverse()
          setRecentTimes(completed.map(x => ({
            bib: x.bib_number,
            name: `${x.last_name?.toUpperCase() || ''}${x.first_name ? `, ${x.first_name}` : ''}`,
            time: x.run_time,
          })))
        }
      } catch {}
    }
    fetchInfo()
    fetchRecent()
  }, [eventId, resolving])

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

  // Poll for active run
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
          const alreadySubmitted = run && run.run_time != null
          setSubmitted(alreadySubmitted)
          if (!alreadySubmitted) {
            setTimeInput('')
            setError('')
          }
          setStatusMsg(run ? (alreadySubmitted ? 'Time submitted' : 'Run in progress') : 'Waiting for next athlete...')
        }
        // In tablet mode, only fetch / show Next Up when there is no active
        // run — prevents a stale next-up athlete from lingering in the sidebar
        // while a run is in progress (which led to a duplicate-Start-Run UX
        // bug). Paper mode is unchanged: it shows Next Up alongside an active
        // run because the timekeeper is the one who starts paper-mode runs.
        if (!run || isPaper) fetchNextUp()
        else setNextUp(null)
      } catch {}
    }
    poll()
    pollRef.current = setInterval(poll, 2000)
    return () => clearInterval(pollRef.current)
  }, [eventId, activeRun?.id, isPaper, resolving])

  // WebSocket
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
      setRecentTimes(prev => [{
        bib: activeRun.bib_number,
        name: `${activeRun.last_name?.toUpperCase() || ''}${activeRun.first_name ? `, ${activeRun.first_name}` : ''}`,
        time: t,
      }, ...prev].slice(0, 8))
    } catch (e) { setError(e.message) }
  }

  const submitNoTime = async () => {
    if (!activeRun) { setError('No active run'); return }
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
  }

  // Numpad input handlers
  const pressKey = (k) => {
    if (k === '⌫') {
      setTimeInput(s => s.slice(0, -1))
      return
    }
    if (k === '.') {
      if (timeInput.includes('.')) return
      setTimeInput(s => (s.length === 0 ? '0.' : s + '.'))
      return
    }
    // digit
    setTimeInput(s => {
      if (s.includes('.')) {
        // allow up to 2 decimal places
        const [, dec] = s.split('.')
        if (dec && dec.length >= 2) return s
      }
      // limit to 6 chars (e.g., "999.99")
      if (s.length >= 6) return s
      return s + k
    })
  }

  const parseTimeToSeconds = (str) => {
    const trimmed = (str || '').trim()
    if (!trimmed) return null
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

  const dnsNextUp = async () => {
    if (!nextUp) return
    try {
      const res = await fetch(`${API}/events/${eventId}/runs/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registration_id: nextUp.id, run_number: nextUp.run_number || 1, round: 'qualification', run_status: 'DNS' }),
      })
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'Failed') }
      setNextUp(null)
    } catch (e) { setError('DNS failed: ' + e.message) }
  }

  // ── Full-screen states ───────────────────────────────────────────────────
  if (eventCompleted) return (
    <div className={`tablet-root min-h-screen flex items-center justify-center ${hc ? 'hc' : ''}`} data-hc={hc ? '1' : '0'}>
      <div className="text-center">
        <div className="tablet-display" style={{ fontSize: 56, color: 'var(--tablet-green2)', marginBottom: 12 }}>Event Completed</div>
        <div className="text-xl" style={{ color: 'var(--tablet-dim)' }}>Thank You for Your Work</div>
      </div>
    </div>
  )

  // ── Right cluster: athlete bar shows pace info + status pill + HC button ──
  const statusPill = (() => {
    if (isDualMogul) return { text: 'Disabled', bg: 'rgba(100,116,139,0.2)', color: 'var(--tablet-dim)' }
    if (isDevo)      return { text: 'No Time — Devo', bg: 'rgba(100,116,139,0.2)', color: 'var(--tablet-dim)' }
    if (isPaper)     return { text: 'Paper Entry — Start Only', bg: 'rgba(245,158,11,0.18)', color: 'var(--tablet-amber2)' }
    if (submitted)   return { text: 'Time submitted', bg: 'rgba(34,197,94,0.15)', color: 'var(--tablet-green2)' }
    if (activeRun)   return { text: '⏱ RUN IN PROGRESS', bg: 'rgba(245,158,11,0.18)', color: 'var(--tablet-amber2)' }
    return { text: statusMsg, bg: 'rgba(100,116,139,0.2)', color: 'var(--tablet-dim)' }
  })()

  const headerBar = (
    <div className="tablet-card flex items-center justify-between" style={{ padding: '14px 24px', borderRadius: 18 }}>
      <div className="flex items-center gap-6 flex-wrap text-sm">
        <span className="tablet-display" style={{ fontSize: 22, letterSpacing: 1 }}>TIMEKEEPER</span>
        {eventInfo?.course_length != null && (
          <span style={{ color: 'var(--tablet-dim)' }}>Course: <strong style={{ color: '#fff' }}>{eventInfo.course_length}m</strong></span>
        )}
        {eventInfo?.pace_time != null && (
          <span style={{ color: 'var(--tablet-dim)' }}>Pace: <strong style={{ color: 'var(--tablet-green2)' }}>{Number(eventInfo.pace_time).toFixed(2)}s</strong></span>
        )}
        {eventInfo?.gender && (
          <span style={{ color: 'var(--tablet-dim)' }}>{eventInfo.gender === 'F' ? 'Women' : 'Men'}</span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span
          className="text-xs px-3 py-1 rounded-full font-bold"
          style={{ background: statusPill.bg, color: statusPill.color, letterSpacing: 1 }}
        >
          {statusPill.text}
        </span>
        <HCModeButton hc={hc} onToggle={toggleHc} />
      </div>
    </div>
  )

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className={`tablet-root min-h-screen ${hc ? 'hc' : ''}`} data-hc={hc ? '1' : '0'}>
      <div className="p-4 max-w-7xl mx-auto space-y-4">
        {ageGroupTransition && (
          <div
            onClick={() => setAgeGroupTransition(null)}
            className="tablet-warn-banner cursor-pointer"
            style={{ animation: 'pulse 1.5s ease-in-out infinite' }}
          >
            <span style={{ fontWeight: 800, letterSpacing: 1 }}>AGE GROUP TRANSITION</span>
            <span>{ageGroupTransition.completed} group complete {ageGroupTransition.next ? `— ${ageGroupTransition.next} up next` : '— All groups complete'}</span>
          </div>
        )}

        {headerBar}

        {/* Dual mogul — disabled view, no further panels */}
        {isDualMogul ? (
          <div className="tablet-card text-center" style={{ padding: 64 }}>
            <div className="tablet-display" style={{ fontSize: 64, color: 'var(--tablet-muted)' }}>&#9203;</div>
            <div className="tablet-display mt-3" style={{ fontSize: 28 }}>Timekeeper Not Required</div>
            <div className="text-sm mt-2" style={{ color: 'var(--tablet-dim)' }}>
              Dual Moguls does not use timed scoring. Time scores are entered by the timing judge on the judge tablet.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
            {/* Main left column */}
            <div className="space-y-4">
              {activeRun ? (
                <AthleteBar
                  bib={activeRun.is_forerunner ? '' : activeRun.bib_number}
                  name={activeRun.is_forerunner
                    ? 'FORERUNNER'
                    : `${activeRun.last_name?.toUpperCase() || ''}${activeRun.first_name ? `, ${activeRun.first_name}` : ''}`}
                  meta={[
                    'NOW RUNNING',
                    activeRun.run_position != null && activeRun.total_runners != null
                      ? <>Athlete <strong>{activeRun.run_position}</strong> of <strong>{activeRun.total_runners}</strong></>
                      : null,
                    activeRun.jump1_code ? <>J1: <strong>{activeRun.jump1_code}</strong></> : null,
                    activeRun.jump2_code ? <>J2: <strong>{activeRun.jump2_code}</strong></> : null,
                  ].filter(Boolean)}
                  right={
                    activeRun.run_time != null && (
                      <span className="tablet-display" style={{
                        fontSize: 36,
                        color: activeRun.run_time === -1 ? 'var(--tablet-red2)' : 'var(--tablet-green2)',
                      }}>
                        {activeRun.run_time === -1 ? 'NT' : `${Number(activeRun.run_time).toFixed(2)}s`}
                      </span>
                    )
                  }
                />
              ) : (
                <div className="tablet-card text-center" style={{ padding: 32 }}>
                  <div className="tablet-display" style={{ fontSize: 64, color: 'var(--tablet-muted)' }}>&#9203;</div>
                  <div style={{ color: 'var(--tablet-dim)' }}>Waiting for next athlete...</div>
                </div>
              )}

              {/* Devo no-time message (with active run) */}
              {isDevo && activeRun && (
                <div className="tablet-warn-banner">
                  <span style={{ fontWeight: 800, letterSpacing: 1 }}>NO TIME — DEVO</span>
                  <span>Devo events do not use timed scoring.</span>
                </div>
              )}

              {/* No pace-time configured */}
              {noPaceTime && !isPaper && !isDevo && (
                <div className="tablet-warn-banner">
                  <span style={{ fontWeight: 800, letterSpacing: 1 }}>COURSE LENGTH NOT SET</span>
                  <span>Time cannot be entered until course length is set in event configuration.</span>
                </div>
              )}

              {/* Paper-mode banner */}
              {isPaper && activeRun && (
                <div className="tablet-warn-banner">
                  <span style={{ fontWeight: 800, letterSpacing: 1 }}>PAPER ENTRY MODE</span>
                  <span>Time entry disabled. Scores entered via admin console.</span>
                </div>
              )}

              {/* Time-entry pad — visible only when active run + not paper + not devo + pace-time configured + not yet submitted */}
              {activeRun && !submitted && !noPaceTime && !isPaper && !isDevo && (
                <div className="tablet-card" style={{ padding: 18 }}>
                  <div className="text-xs uppercase tracking-widest mb-2" style={{ color: 'var(--tablet-dim)', letterSpacing: 2 }}>Finish Time (seconds)</div>
                  {/* Display + inline backspace per slide-04 prototype */}
                  <div className="flex items-stretch gap-2">
                    <div
                      className="tablet-display tablet-mono"
                      style={{
                        flex: 1,
                        fontSize: 88,
                        lineHeight: 1,
                        textAlign: 'center',
                        padding: '16px 24px',
                        borderRadius: 16,
                        border: `2px solid ${timeInput ? 'var(--tablet-blue)' : 'var(--tablet-navy4)'}`,
                        background: 'var(--tablet-navy3)',
                        color: timeInput ? '#fff' : 'var(--tablet-muted)',
                        letterSpacing: 2,
                      }}
                    >
                      {timeInput || '0.00'}
                    </div>
                    <button
                      type="button"
                      onClick={() => pressKey('⌫')}
                      className="tablet-numpad-btn tablet-numpad-back"
                      style={{ width: 80, height: 'auto', borderRadius: 16, fontSize: 24 }}
                      aria-label="Backspace"
                    >
                      ⌫
                    </button>
                  </div>

                  {/* Numpad — calculator order: 7-8-9 / 4-5-6 / 1-2-3 / [empty] 0 . */}
                  <div className="grid grid-cols-3 gap-2 mt-4">
                    {['7','8','9','4','5','6','1','2','3'].map(k => (
                      <button key={k} type="button" onClick={() => pressKey(k)} className="tablet-numpad-btn">{k}</button>
                    ))}
                    {/* bottom row: empty · 0 · . */}
                    <div aria-hidden="true" />
                    <button type="button" onClick={() => pressKey('0')} className="tablet-numpad-btn">0</button>
                    <button type="button" onClick={() => pressKey('.')} className="tablet-numpad-btn">.</button>
                  </div>

                  {/* Manual calc */}
                  <button
                    type="button"
                    onClick={() => { setCalcError(''); setShowManualCalc(true) }}
                    className="tablet-btn-amber w-full mt-3"
                    style={{ height: 50, fontSize: 16 }}
                  >
                    ⏱ Manual Time Calculation (Top / Bottom Timer)
                  </button>

                  {error && (
                    <div className="mt-3 px-4 py-3 text-sm rounded-lg" style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--tablet-red2)' }}>{error}</div>
                  )}

                  {/* NT (left) + Submit Time (right, flex 2.5) */}
                  <div className="flex gap-3 mt-4">
                    <button
                      type="button"
                      onClick={() => setConfirmNT(true)}
                      className="tablet-btn-danger"
                      style={{ flex: 1, height: 68, fontSize: 22 }}
                    >
                      No Time
                    </button>
                    <button
                      type="button"
                      onClick={submitTime}
                      disabled={!timeInput}
                      className="tablet-btn-submit"
                      style={{ flex: 2.5, height: 68, fontSize: 24 }}
                    >
                      ✓ Submit Time
                    </button>
                  </div>
                </div>
              )}

              {/* Submitted confirmation */}
              {submitted && activeRun && !isPaper && !isDevo && (
                activeRun.run_time === -1 ? (
                  <div className="tablet-card text-center" style={{ padding: 32, borderColor: 'var(--tablet-red2)', borderWidth: 2 }}>
                    <div className="tablet-display" style={{ fontSize: 96, color: 'var(--tablet-red2)' }}>NT</div>
                    <div className="text-xl font-bold mt-2" style={{ color: 'var(--tablet-red2)' }}>No Time Submitted</div>
                    <div className="text-sm mt-2" style={{ color: 'var(--tablet-dim)' }}>Waiting for next athlete...</div>
                  </div>
                ) : (
                  <div className="tablet-card text-center" style={{ padding: 32, borderColor: 'var(--tablet-green2)', borderWidth: 2 }}>
                    <div className="tablet-display" style={{ fontSize: 64, color: 'var(--tablet-green2)' }}>&#10003;</div>
                    <div className="text-xl font-bold mt-2" style={{ color: 'var(--tablet-green2)' }}>Time Submitted</div>
                    <div className="tablet-display tablet-mono mt-2" style={{ fontSize: 56, color: '#fff' }}>{timeInput || Number(activeRun.run_time).toFixed(2)}s</div>
                    <div className="text-sm mt-2" style={{ color: 'var(--tablet-dim)' }}>Waiting for next athlete...</div>
                  </div>
                )
              )}
            </div>

            {/* Right sidebar */}
            <div className="space-y-4">
              {/* Next Up card — hidden in tablet mode when a run is in progress
                  so the timekeeper can't accidentally start a duplicate run.
                  Paper mode keeps Next Up visible during an active run because
                  paper-mode timekeepers start runs while scores trickle in. */}
              {nextUp && (!activeRun || isPaper) && (
                <div className="tablet-card" style={{ padding: 16 }}>
                  <div className="text-xs uppercase tracking-widest mb-2" style={{ color: 'var(--tablet-dim)', letterSpacing: 2 }}>
                    Next Up{nextUp.phase_label ? ` — ${nextUp.phase_label}` : ''}
                  </div>
                  <div className="tablet-display" style={{ fontSize: 32, lineHeight: 1 }}>
                    <span style={{ color: 'var(--tablet-blue2)' }}>#{nextUp.bib_number}</span> {nextUp.last_name?.toUpperCase()}, {nextUp.first_name}
                  </div>
                  {nextUp.run_order != null && (
                    <div className="text-xs mt-1" style={{ color: 'var(--tablet-dim)' }}>Order: {nextUp.run_order}</div>
                  )}
                  <div className="flex gap-2 mt-3">
                    <button
                      type="button"
                      onClick={startNextRun}
                      disabled={starting}
                      className="tablet-btn-submit"
                      style={{ flex: 1, height: 56, fontSize: 18 }}
                    >
                      {starting ? 'Starting...' : `Start ${nextUp.phase_label || 'Run'}`}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDNS(true)}
                      className="tablet-btn-amber"
                      style={{ height: 56, fontSize: 16 }}
                    >
                      DNS
                    </button>
                  </div>
                </div>
              )}

              {/* Previous Times */}
              {recentTimes.length > 0 && (
                <div className="tablet-card" style={{ padding: 16 }}>
                  <div className="text-xs uppercase tracking-widest mb-3" style={{ color: 'var(--tablet-dim)', letterSpacing: 2 }}>Previous Times</div>
                  <div className="space-y-1.5 text-sm">
                    {recentTimes.map((r, i) => {
                      const fast = eventInfo?.pace_time && r.time < eventInfo.pace_time
                      const color = fast ? 'var(--tablet-green2)' : 'var(--tablet-amber2)'
                      return (
                        <div key={i} className="flex items-center justify-between gap-2">
                          <span className="truncate" style={{ color: 'var(--tablet-dim)' }}>
                            <span style={{ color: 'var(--tablet-blue2)', fontWeight: 700 }}>#{r.bib}</span> {r.name}
                          </span>
                          <span className="tablet-mono font-bold" style={{ color }}>{Number(r.time).toFixed(2)}s</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Pace Time box */}
              {eventInfo?.pace_time && (
                <div className="tablet-card text-center" style={{ padding: 16 }}>
                  <div className="text-xs uppercase tracking-widest" style={{ color: 'var(--tablet-dim)', letterSpacing: 2 }}>Pace Time</div>
                  <div className="tablet-display" style={{ fontSize: 56, color: 'var(--tablet-green2)', lineHeight: 1, marginTop: 4 }}>
                    {Number(eventInfo.pace_time).toFixed(2)}s
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* NT confirm dialog */}
      {confirmNT && activeRun && (
        <ConfirmDialog
          title="Confirm No Time"
          body={<>Mark <strong style={{ color: '#fff' }}>{activeRun.first_name} {activeRun.last_name}</strong> as <strong style={{ color: 'var(--tablet-red2)' }}>No Time</strong>?</>}
          confirmLabel="Mark as NT"
          confirmVariant="red"
          onCancel={() => setConfirmNT(false)}
          onConfirm={() => { setConfirmNT(false); submitNoTime() }}
        />
      )}

      {/* DNS confirm dialog */}
      {confirmDNS && nextUp && (
        <ConfirmDialog
          title="Confirm DNS"
          body={<>Mark <strong style={{ color: '#fff' }}>{nextUp.last_name}, {nextUp.first_name}</strong> as <strong style={{ color: 'var(--tablet-amber2)' }}>DNS</strong>?</>}
          confirmLabel="Mark as DNS"
          confirmVariant="amber"
          onCancel={() => setConfirmDNS(false)}
          onConfirm={() => { setConfirmDNS(false); dnsNextUp() }}
        />
      )}

      {/* Manual Time Calculation modal */}
      {showManualCalc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => { setShowManualCalc(false); setTopTimer(''); setBotTimer(''); setCalcError('') }}
        >
          <div
            className="tablet-card w-full max-w-md"
            style={{ padding: 24 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center">
              <div className="tablet-display" style={{ fontSize: 28, lineHeight: 1 }}>Manual Time Calculation</div>
              <div className="text-xs mt-1" style={{ color: 'var(--tablet-dim)' }}>Enter synchronized stopwatch times. Run time = Bottom − Top.</div>
            </div>
            <div className="space-y-3 mt-4">
              <div>
                <label className="text-xs uppercase tracking-widest" style={{ color: 'var(--tablet-dim)' }}>Top Timer</label>
                <input
                  type="text"
                  placeholder="hh:mm:ss.ss"
                  value={topTimer}
                  onChange={e => setTopTimer(e.target.value)}
                  className="tablet-mono w-full mt-1 outline-none"
                  style={{
                    fontSize: 28, fontWeight: 700, textAlign: 'center',
                    background: 'var(--tablet-navy3)', color: '#fff',
                    border: '2px solid var(--tablet-navy4)', borderRadius: 12, padding: 12,
                  }}
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-widest" style={{ color: 'var(--tablet-dim)' }}>Bottom Timer</label>
                <input
                  type="text"
                  placeholder="hh:mm:ss.ss"
                  value={botTimer}
                  onChange={e => setBotTimer(e.target.value)}
                  className="tablet-mono w-full mt-1 outline-none"
                  style={{
                    fontSize: 28, fontWeight: 700, textAlign: 'center',
                    background: 'var(--tablet-navy3)', color: '#fff',
                    border: '2px solid var(--tablet-navy4)', borderRadius: 12, padding: 12,
                  }}
                />
              </div>
            </div>
            {calcError && (
              <div className="mt-3 px-4 py-3 text-sm rounded-lg" style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--tablet-red2)' }}>{calcError}</div>
            )}
            <div className="flex gap-3 mt-4">
              <button
                type="button"
                onClick={() => { setShowManualCalc(false); setTopTimer(''); setBotTimer(''); setCalcError('') }}
                className="tablet-btn-neutral"
                style={{ flex: 1, height: 50 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={calculateManualTime}
                className="tablet-btn-submit"
                style={{ flex: 1, height: 50, fontSize: 18 }}
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

function ConfirmDialog({ title, body, confirmLabel, confirmVariant = 'submit', onCancel, onConfirm }) {
  const confirmClass =
    confirmVariant === 'red'   ? 'tablet-btn-danger' :
    confirmVariant === 'amber' ? 'tablet-btn-amber'  :
                                 'tablet-btn-submit'
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={onCancel}
    >
      <div
        className="tablet-card w-full max-w-md"
        style={{ padding: 24 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tablet-display" style={{ fontSize: 28, lineHeight: 1, marginBottom: 8 }}>{title}</div>
        <p className="text-sm mb-5" style={{ color: 'var(--tablet-dim)' }}>{body}</p>
        <div className="flex gap-3 justify-end">
          <button type="button" onClick={onCancel} className="tablet-btn-neutral" style={{ height: 44, padding: '0 24px' }}>Cancel</button>
          <button type="button" onClick={onConfirm} className={confirmClass} style={{ height: 44, padding: '0 24px', fontSize: 16 }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
