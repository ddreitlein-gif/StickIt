import { useState, useEffect, useRef } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import useHighContrast from '../hooks/useHighContrast'
import useResolveIds from '../hooks/useResolveIds'
import AthleteBar from '../components/tablet/AthleteBar'
import HCModeButton from '../components/tablet/HCModeButton'
import ScoreButtonGrid, { ZONES_AIR, ZONES_TL, ZONES_COMP_5, VALUES_AIR_15 } from '../components/tablet/ScoreButtonGrid'
import FineTuneRow from '../components/tablet/FineTuneRow'
import DeductionPad from '../components/tablet/DeductionPad'
import JumpCodeGrid from '../components/tablet/JumpCodeGrid'
import ReferencePanel, { RefPillRow } from '../components/tablet/ReferencePanel'

const API = '/api'

// Frequent-jump-code lists (preserved verbatim from pre-redesign — see CLAUDE.md
// v1.16.09 + v1.16.06 plus user's v1.18.05 confirmations Q1/Q2: RQS uses the
// Devo list).
// v2.3.00 -- Comp Series (and FIS) quick-select is three explicit rows of six:
// uprights / back flips / off-axis 720s. Adds the FS-13 basic-grab codes bg and
// 7og (lowercase g = basic grab, v1.26.00). Devo / RQS keep the flat 7x2 list.
const COMP_FREQ_CODES = [
  ['N', 'S', 'T', 'K', 'TS', '3'],
  ['bT', 'bp', 'bL', 'bG', 'bg', 'bF'],
  ['7op', '7oG', '7og'],
]
const DEVO_FREQ_CODES = ['S','T','D','X','K','TS','TT','TD','TTS','3','3p']

// Friendly judge-role display labels — prototype shows "T&L Judge 3", not "TL3".
// Server-side role state is unchanged; this map is display-only.
const ROLE_DISPLAY = {
  TL1: 'T&L Judge 1', TL2: 'T&L Judge 2', TL3: 'T&L Judge 3',
  Air1: 'Air J1',     Air2: 'Air J2',     HJ:  'Head Judge',
}
const roleDisplay = (role) => ROLE_DISPLAY[role] || role || ''

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
// v1.29.00 -- Overall Judge splits 3 when both speed and air are tied
const SPLITS_3PT = [[3,0],[0,3],[2,1],[1,2]]

// v1.29.00 (FS-18) -- small amber NJ badge shown on an athlete card when that
// side has a landing zone (chop) No Jump call
function NjBadge() {
  return (
    <span
      className="text-xs font-bold px-1.5 py-0.5 rounded"
      title="Landed past the chop (landing zone) — No Jump on bottom air"
      style={{ background: 'rgba(245,158,11,0.25)', color: 'var(--tablet-amber2)', marginLeft: 6 }}
    >NJ</span>
  )
}

function DualJudgeView({ eventId, judge, hc, toggleHc }) {
  const [activeMatch, setActiveMatch] = useState(null)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [scoreRejected, setScoreRejected] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('Waiting for match...')
  const [eventCompleted, setEventCompleted] = useState(false)
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
        setActiveMatch(prev => prev ? { ...prev, judgePoints: match.judgePoints, pointResult: match.pointResult, nj_call: match.nj_call ?? null, status: match.status } : prev)
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

  const submitSplit = async (blue, red, timeTied = false, airTied = false) => {
    if (!activeMatch) return
    setSubmitting(true)
    setError('')
    setScoreRejected(false)
    try {
      const payload = { judge_number: judgeNum, blue_points: blue, red_points: red }
      if (timeTied) payload.time_tied = true
      if (airTied) payload.air_tied = true
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

  // v1.29.00 (FS-18) -- NJ (past chop) toggles. Server state, not local:
  // the toggles read activeMatch.nj_call and every confirmed change POSTs
  // immediately, independent of the air split submission.
  const [njConfirm, setNjConfirm] = useState(null)  // { athlete: 'blue'|'red', value: bool }
  const [njPosting, setNjPosting] = useState(false)
  const njCall = activeMatch?.nj_call || null
  const njBlue = njCall === 'blue' || njCall === 'both'
  const njRed  = njCall === 'red'  || njCall === 'both'

  const postNj = async (athlete, value) => {
    if (!activeMatch) return
    setNjPosting(true)
    setError('')
    try {
      const res = await fetch(`${API}/events/${eventId}/dual/${activeMatch.id}/nj`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athlete, value }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body.error || 'Error'); return }
      setActiveMatch(prev => prev ? { ...prev, nj_call: body.nj_call ?? null, pointResult: body.result || prev.pointResult } : prev)
    } catch (e) {
      setError(e.message)
    } finally {
      setNjPosting(false)
      setNjConfirm(null)
    }
  }

  const mySubmission = activeMatch?.judgePoints?.find(p => p.judge_number === judgeNum)
  // v1.29.00 -- the Overall Judge's scale (5/4/3) comes from the server's
  // engine result so it can never diverge from validation/scoring.
  const overallScale = activeMatch?.pointResult?.overallScale ?? 5
  const speedTied = !!activeMatch?.pointResult?.speedTied
  const airTiedMatch = !!activeMatch?.pointResult?.airTied
  const scaleReason = [speedTied ? 'Time Tied' : null, airTiedMatch ? 'Air Tied' : null].filter(Boolean).join(' + ')
  const j4Overridden = judgeNum === 4 && !!njCall
  const njName = (side) => side === 'blue'
    ? (activeMatch?.blue_first ? `${activeMatch.blue_first} ${activeMatch.blue_last}` : 'Blue')
    : (activeMatch?.red_first ? `${activeMatch.red_first} ${activeMatch.red_last}` : 'Red')

  if (eventCompleted) return (
    <div className={`tablet-root min-h-screen flex items-center justify-center ${hc ? 'hc' : ''}`} data-hc={hc ? '1' : '0'}>
      <div className="text-center">
        <div className="tablet-display" style={{ fontSize: 56, color: 'var(--tablet-green2)', marginBottom: 12 }}>Event Completed</div>
        <div className="text-xl" style={{ color: 'var(--tablet-dim)' }}>Thank You for Your Work</div>
      </div>
    </div>
  )

  if (manualEntryActive && activeMatch) return (
    <div className={`tablet-root min-h-screen flex items-center justify-center px-6 ${hc ? 'hc' : ''}`} data-hc={hc ? '1' : '0'}>
      <div className="text-center">
        <div className="tablet-display" style={{ fontSize: 48, color: 'var(--tablet-amber2)', marginBottom: 12 }}>Manual Score Entry for This Round</div>
        <div className="text-lg" style={{ color: 'var(--tablet-dim)' }}>Scores are being entered by the Technical Delegate.</div>
      </div>
    </div>
  )

  return (
    <div className={`tablet-root min-h-screen ${hc ? 'hc' : ''}`} data-hc={hc ? '1' : '0'}>
      <div className="tablet-card" style={{ borderRadius: 0, padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div className="font-bold" style={{ color: '#fff' }}>{judge.name}</div>
          <div className="text-xs" style={{ color: 'var(--tablet-dim)' }}>{DUAL_ROLE_LABEL[judge.role] || judge.role}</div>
        </div>
        <div className="flex items-center gap-3">
          <HCModeButton hc={hc} onToggle={toggleHc} />
          <div
            className="text-xs px-3 py-1 rounded-full"
            style={{
              background: submitted ? 'rgba(34,197,94,0.15)' : 'rgba(14,144,229,0.15)',
              color: submitted ? 'var(--tablet-green2)' : 'var(--tablet-blue2)',
              fontWeight: 700,
            }}
          >
            {submitted ? 'Score submitted' : status}
          </div>
        </div>
      </div>

      <div className="p-4 space-y-6 max-w-lg mx-auto">
        {activeMatch ? (
          <>
            <div className="tablet-card" style={{ padding: 18 }}>
              <div className="text-xs uppercase tracking-wide mb-3" style={{ color: 'var(--tablet-dim)' }}>Current Match</div>
              <div className="grid grid-cols-5 gap-2 items-center">
                <div className="col-span-2 p-3 rounded-lg" style={{ background: 'rgba(14,144,229,0.18)', border: '1.5px solid #1d4ed8' }}>
                  <div className="text-xs font-semibold mb-0.5" style={{ color: 'var(--tablet-blue2)' }}>Blue{njBlue && <NjBadge />}</div>
                  <div className="text-lg font-bold" style={{ color: '#fff' }}>
                    {activeMatch.blue_first ? `${activeMatch.blue_last}, ${activeMatch.blue_first}` : 'TBD'}
                  </div>
                  {activeMatch.blue_bib && <div className="text-xs mt-0.5" style={{ color: 'var(--tablet-dim)' }}>Bib {activeMatch.blue_bib}</div>}
                </div>
                <div className="text-center font-bold" style={{ color: 'var(--tablet-muted)' }}>vs</div>
                <div className="col-span-2 p-3 rounded-lg" style={{ background: 'rgba(239,68,68,0.18)', border: '1.5px solid #b91c1c' }}>
                  <div className="text-xs font-semibold mb-0.5" style={{ color: 'var(--tablet-red2)' }}>Red{njRed && <NjBadge />}</div>
                  <div className="text-lg font-bold" style={{ color: '#fff' }}>
                    {activeMatch.red_first ? `${activeMatch.red_last}, ${activeMatch.red_first}` : 'TBD'}
                  </div>
                  {activeMatch.red_bib && <div className="text-xs mt-0.5" style={{ color: 'var(--tablet-dim)' }}>Bib {activeMatch.red_bib}</div>}
                </div>
              </div>
              {activeMatch.pairing_label && (
                <div className="text-center text-sm font-bold mt-2" style={{ color: 'var(--tablet-text)' }}>
                  Pairing {activeMatch.pairing_label}
                </div>
              )}
              {activeMatch.pointResult && activeMatch.pointResult.judgeCount > 0 && (
                <div className="flex items-center justify-center gap-4 mt-3 pt-3" style={{ borderTop: '1px solid var(--tablet-navy4)' }}>
                  <span className="text-sm font-bold" style={{ color: 'var(--tablet-blue2)' }}>Blue {activeMatch.pointResult.blueTotal}</span>
                  <span className="text-xs" style={{ color: 'var(--tablet-muted)' }}>pts</span>
                  <span className="text-sm font-bold" style={{ color: 'var(--tablet-red2)' }}>{activeMatch.pointResult.redTotal} Red</span>
                  <span className="text-xs" style={{ color: 'var(--tablet-muted)' }}>({activeMatch.pointResult.judgeCount}/5 judges{activeMatch.pointResult.speedTied ? ' · Speed Tied' : ''}{activeMatch.pointResult.airTied ? ' · Air Tied' : ''})</span>
                </div>
              )}
            </div>

            {/* v1.29.00 (FS-18) -- persistent NJ warning banner for the Time
                Judge (and visible context for every dual judge). Cannot be
                dismissed; clears only when the finding is cleared. */}
            {njCall && (
              <div className="tablet-warn-banner" style={{ padding: 14, borderRadius: 12 }}>
                <div className="font-bold" style={{ color: 'var(--tablet-amber2)' }}>
                  {njCall === 'both'
                    ? 'NJ (Past Chop): BOTH.  Speed tied at 3 / 3.'
                    : `NJ (Past Chop): ${njCall.toUpperCase()}, ${njName(njCall)}.  Speed override active: ${njCall === 'blue' ? 'Blue 0 / Red 5' : 'Blue 5 / Red 0'}.`}
                </div>
                {judgeNum === 4 && (
                  <div className="text-xs mt-1" style={{ color: 'var(--tablet-dim)' }}>
                    Enter and submit your real split as normal — it is recorded as evidence and overridden by the NJ call.
                  </div>
                )}
              </div>
            )}

            {scoreRejected && !submitted && (
              <div className="tablet-card" style={{ padding: 14, borderColor: 'var(--tablet-red2)', borderWidth: 2, animation: 'pulse 1.5s ease-in-out infinite' }}>
                <div className="font-bold" style={{ color: 'var(--tablet-red2)' }}>Your score was rejected</div>
                <div className="text-sm mt-1" style={{ color: 'var(--tablet-dim)' }}>The Head Judge has rejected your previous score. Please enter and submit a new score below.</div>
              </div>
            )}

            {!submitted ? (
              <div className="tablet-card" style={{ padding: 18 }}>
                <div className="text-sm font-semibold uppercase tracking-wide mb-2" style={{ color: '#fff' }}>
                  Award {judgeNum === 5 ? overallScale : 5} Points
                  {judgeNum === 5 && overallScale < 5 && (
                    <span className="ml-2 text-xs normal-case font-normal" style={{ color: 'var(--tablet-amber2)' }}>({scaleReason})</span>
                  )}
                  {j4Overridden && (
                    <span className="ml-2 text-xs normal-case font-normal" style={{ color: 'var(--tablet-amber2)' }}>(Recorded — Overridden by NJ)</span>
                  )}
                </div>
                <div className="text-xs mb-4" style={{ color: 'var(--tablet-dim)' }}>
                  Tap a split to submit{j4Overridden ? ' (recorded, overridden by NJ)' : ''}. Blue + Red must equal {judgeNum === 5 ? overallScale : 5}.
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {(judgeNum === 5 ? (overallScale === 3 ? SPLITS_3PT : overallScale === 4 ? SPLITS_4PT : SPLITS) : SPLITS).map(([b, r]) => (
                    <button
                      key={`${b}-${r}`}
                      type="button"
                      onClick={() => submitSplit(b, r)}
                      disabled={submitting}
                      className="tablet-score-btn"
                      style={{ height: 80, fontSize: 22, gap: 12 }}
                    >
                      <span style={{ color: 'var(--tablet-blue2)' }}>{b}</span>
                      <span style={{ color: 'var(--tablet-muted)' }}>/</span>
                      <span style={{ color: 'var(--tablet-red2)' }}>{r}</span>
                    </button>
                  ))}
                </div>
                {judgeNum === 4 && (
                  <button
                    type="button"
                    onClick={() => submitSplit(0, 0, true)}
                    disabled={submitting}
                    className="tablet-btn-amber w-full mt-3"
                    style={{ height: 60, fontSize: 18 }}
                  >
                    Time Tied
                  </button>
                )}
                {/* v2.1.00 (10b) -- Air Tied only when the meet's Advanced
                    setting allows it (default: not allowed) */}
                {judgeNum === 3 && (activeMatch?.air_tie_allowed ?? 0) !== 0 && (
                  <button
                    type="button"
                    onClick={() => submitSplit(0, 0, false, true)}
                    disabled={submitting}
                    className="tablet-btn-amber w-full mt-3"
                    style={{ height: 60, fontSize: 18 }}
                  >
                    Air Tied
                  </button>
                )}
                {error && <div className="mt-3 px-4 py-3 text-sm rounded-lg" style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--tablet-red2)' }}>{error}</div>}
              </div>
            ) : (
              <div className="tablet-card" style={{ padding: 32, textAlign: 'center', borderColor: 'var(--tablet-green2)', borderWidth: 2 }}>
                <div className="tablet-display" style={{ fontSize: 64, color: 'var(--tablet-green2)' }}>&#10003;</div>
                <div className="text-xl font-bold mt-2" style={{ color: 'var(--tablet-green2)' }}>Score Submitted</div>
                {mySubmission && mySubmission.time_tied === 1 ? (
                  <div className="mt-3 text-lg font-bold" style={{ color: 'var(--tablet-amber2)' }}>Time Tied</div>
                ) : mySubmission && mySubmission.air_tied === 1 ? (
                  <div className="mt-3 text-lg font-bold" style={{ color: 'var(--tablet-amber2)' }}>Air Tied</div>
                ) : mySubmission && (
                  <div className="mt-3 flex items-center justify-center gap-4 text-lg">
                    <span className="font-bold" style={{ color: 'var(--tablet-blue2)' }}>Blue {mySubmission.blue_points}</span>
                    <span style={{ color: 'var(--tablet-muted)' }}>/</span>
                    <span className="font-bold" style={{ color: 'var(--tablet-red2)' }}>{mySubmission.red_points} Red</span>
                  </div>
                )}
                {j4Overridden && (
                  <div className="text-xs mt-2" style={{ color: 'var(--tablet-amber2)' }}>Recorded — overridden by the NJ call</div>
                )}
                <div className="text-sm mt-4" style={{ color: 'var(--tablet-dim)' }}>Waiting for next match...</div>
              </div>
            )}

            {/* v1.29.00 (FS-18) -- NJ (Past Chop) panel: Air Judge only.
                Two independent toggles reflecting SERVER state; each confirmed
                change posts at once, independent of the air split, and stays
                editable until HJ approval. */}
            {/* v2.1.00 (10a) -- NJ controls only when the meet's Advanced
                setting enables the FS-18 chop rule (default: disabled).
                Data-driven displays (banner, badges) are untouched. */}
            {judgeNum === 3 && (activeMatch?.nj_rule_enabled ?? 0) !== 0 && (
              <div className="tablet-card" style={{ padding: 18 }}>
                <div className="text-sm font-semibold uppercase tracking-wide mb-1" style={{ color: '#fff' }}>
                  NJ (Past Chop)
                </div>
                <div className="text-xs mb-3" style={{ color: 'var(--tablet-dim)' }}>
                  Mark a competitor whose bottom air landed past the landing zone. Independent of your air split.
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setNjConfirm({ athlete: 'blue', value: !njBlue })}
                    disabled={njPosting || activeMatch.status === 'complete'}
                    className="rounded-xl font-bold"
                    style={{
                      height: 64, fontSize: 17,
                      background: njBlue ? '#1d4ed8' : 'rgba(14,144,229,0.12)',
                      border: njBlue ? '2px solid var(--tablet-blue2)' : '1.5px solid #1d4ed8',
                      color: njBlue ? '#fff' : 'var(--tablet-blue2)',
                    }}
                  >
                    {njBlue ? 'NJ — ' : 'Blue NJ '}{njBlue ? njName('blue') : ''}
                    {njBlue && <span style={{ display: 'block', fontSize: 11, fontWeight: 600 }}>tap to clear</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => setNjConfirm({ athlete: 'red', value: !njRed })}
                    disabled={njPosting || activeMatch.status === 'complete'}
                    className="rounded-xl font-bold"
                    style={{
                      height: 64, fontSize: 17,
                      background: njRed ? '#b91c1c' : 'rgba(239,68,68,0.12)',
                      border: njRed ? '2px solid var(--tablet-red2)' : '1.5px solid #b91c1c',
                      color: njRed ? '#fff' : 'var(--tablet-red2)',
                    }}
                  >
                    {njRed ? 'NJ — ' : 'Red NJ '}{njRed ? njName('red') : ''}
                    {njRed && <span style={{ display: 'block', fontSize: 11, fontWeight: 600 }}>tap to clear</span>}
                  </button>
                </div>
                {njConfirm && (
                  <div className="mt-3 p-3 rounded-lg" style={{ background: 'rgba(245,158,11,0.12)', border: '1.5px solid var(--tablet-amber2)' }}>
                    <div className="text-sm font-bold mb-2" style={{ color: 'var(--tablet-amber2)' }}>
                      {njConfirm.value
                        ? (njConfirm.athlete === 'blue' ? njRed : njBlue)
                          ? `Mark ${njName(njConfirm.athlete)} (${njConfirm.athlete === 'blue' ? 'Blue' : 'Red'}) as NJ, landed past chop?  Both NJ — speed is tied at 3 / 3.`
                          : `Mark ${njName(njConfirm.athlete)} (${njConfirm.athlete === 'blue' ? 'Blue' : 'Red'}) as NJ, landed past chop?  This sets their speed points to zero.`
                        : `Clear the NJ call for ${njName(njConfirm.athlete)} (${njConfirm.athlete === 'blue' ? 'Blue' : 'Red'})?  The Time Judge's entry will govern speed.`}
                    </div>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => postNj(njConfirm.athlete, njConfirm.value)}
                        disabled={njPosting}
                        className="tablet-btn-amber flex-1"
                        style={{ height: 48, fontSize: 15 }}
                      >
                        {njConfirm.value ? 'Confirm NJ' : 'Confirm Clear'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setNjConfirm(null)}
                        disabled={njPosting}
                        className="tablet-btn-neutral flex-1"
                        style={{ height: 48, fontSize: 15 }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="tablet-card" style={{ padding: 32, textAlign: 'center' }}>
            <div className="tablet-display" style={{ fontSize: 64, color: 'var(--tablet-muted)' }}>&#9203;</div>
            <div style={{ color: 'var(--tablet-dim)' }}>Waiting for next match...</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Multi-line jump-summary chip used in Air judge athlete bar (right side) ──
// Slide 01 prototype: small "JUMP 1" / "JUMP 2" label, big green Bebas Neue
// score (or "—"), then small mono "code · DD value" (or "pending").
function JumpChip({ label, code, dd, score }) {
  const hasScore = score != null
  const hasCode = code && code !== ''
  return (
    <div
      className="tablet-card"
      style={{
        padding: '8px 16px',
        minWidth: 96,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
      }}
    >
      <span
        style={{
          fontSize: 10,
          letterSpacing: 1.5,
          color: 'var(--tablet-dim)',
          textTransform: 'uppercase',
          fontWeight: 700,
        }}
      >
        {label}
      </span>
      <span
        className="tablet-display"
        style={{
          fontSize: 28,
          lineHeight: 1,
          color: hasScore ? 'var(--tablet-green2)' : 'var(--tablet-muted)',
        }}
      >
        {hasScore ? Number(score).toFixed(1) : '—'}
      </span>
      <span
        className="tablet-mono"
        style={{ fontSize: 11, color: 'var(--tablet-dim)' }}
      >
        {hasCode ? `${code}${dd != null ? ` · DD ${dd}` : ''}` : 'pending'}
      </span>
    </div>
  )
}

// ── Reference panel data ─────────────────────────────────────────────────────
const TL_NONCOMP_REF_SECTIONS = [
  {
    heading: 'T&L Total',
    rows: [
      { label: 'Excellent', quality: 'ex', value: '16.1 – 20', swatch: true },
      { label: 'Good',      quality: 'gd', value: '12.1 – 16', swatch: true },
      { label: 'Adequate',  quality: 'av', value: '8.1 – 12',  swatch: true },
      { label: 'Managing',  quality: 'mg', value: '4.1 – 8',   swatch: true },
      { label: 'Poor',      quality: 'po', value: '0.1 – 4',   swatch: true },
    ],
  },
  {
    heading: 'Deduction Tiers',
    rows: [
      { label: '0.1 – 2.0', value: 'Lt. touch / sm. stumble' },
      { label: '2.1 – 2.8', value: 'Med. touch (no stop)' },
      { label: '2.9 – 4.0', value: 'Hard touch / sliding' },
      { label: '4.1 – 5.9', value: 'Complete fall (no stop)' },
      { label: '6.0',       value: 'Any complete stop' },
    ],
  },
]

const COMP_COLUMN_REF = [
  { label: 'Excellent', quality: 'ex', swatch: true },
  { label: 'Good',      quality: 'gd', swatch: true },
  { label: 'Adequate',  quality: 'av', swatch: true },
  { label: 'Managing',  quality: 'mg', swatch: true },
  { label: 'Poor',      quality: 'po', swatch: true },
]
const COMP_RANGES_10 = ['8.1 – 10.0', '6.1 – 8.0', '4.1 – 6.0', '2.1 – 4.0', '0.1 – 2.0']
const COMP_RANGES_5  = ['4.1 – 5.0',  '3.1 – 4.0', '2.1 – 3.0', '1.1 – 2.0', '0.1 – 1.0']

const AIR_REF_SECTIONS = [
  {
    heading: 'Jump Quality',
    rows: [
      { label: 'Excellent', quality: 'ex', value: '8.1 – 10.0', swatch: true },
      { label: 'Good',      quality: 'gd', value: '6.1 – 8.0',  swatch: true },
      { label: 'Average',   quality: 'av', value: '4.1 – 6.0',  swatch: true },
      { label: 'Poor',      quality: 'po', value: '2.1 – 4.0',  swatch: true },
      { label: 'Very Poor', quality: 'po', value: '0.1 – 2.0' },
    ],
  },
  {
    heading: 'Quality Criteria',
    bullets: [
      'Athleticism displayed',
      'Control',
      'Balance',
      'Landing continuity of motion',
    ],
  },
]

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
          if (run && run.submitted && judgeId) {
            const alreadySubmitted = run.submitted.some(s => s.judge_id === judgeId)
            setSubmitted(alreadySubmitted)
          } else {
            setSubmitted(false)
          }
        } else if (run && run.submitted && judgeId) {
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
          // v2.3.00 -- same run: keep the jump-code mismatch state fresh so the
          // FIRST Air judge to submit sees the warning when the second judge's
          // codes disagree, and both see "reconciled" after the HJ accepts.
          // Guarded so an unchanged poll does not re-render every 3s.
          setActiveRun(prev => {
            if (!prev) return prev
            const changed = ['air_code_mismatch', 'air_codes_reconciled', 'jump1_code', 'jump2_code', 'jump1_dd', 'jump2_dd']
              .some(k => (prev[k] ?? null) !== (run[k] ?? null))
            return changed ? { ...prev, ...run } : prev
          })
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
            const rt = msg.data?.rejectedScoreType
            if (rt === 'turns') {
              setCarving(null)
              setAbsExt(null)
              setUpperBody(null)
              setDeduction(0)
            } else if (rt === 'air_jump1') {
              setAirJ1(null)
              setCode1('')
              setCodesSubmitted(false)
            } else if (rt === 'air_jump2') {
              setAirJ2(null)
              setCode2('')
              setCodesSubmitted(false)
            } else {
              setCarving(null); setAbsExt(null); setUpperBody(null); setDeduction(0)
              setAirJ1(null); setAirJ2(null)
              setCode1(''); setCode2('')
              setCodesSubmitted(false)
            }
            setStatus('Score rejected -- please resubmit')
          } else {
            setStatus('Score recorded')
          }
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

  if (isDual && judge) {
    return <DualJudgeView eventId={eventId} judge={judge} hc={hc} toggleHc={toggleHc} />
  }

  // Returns true on success, false on any failure (validation or server error).
  // v2.3.00: codes that differ from the other Air judge's are no longer a 409
  // -- the server keeps the first judge's codes as the run's official pair,
  // answers codes_mismatch:true, and this judge's scores still go in (each
  // carrying this judge's code). The mismatch is shown on the Score Submitted
  // screen and resolved by the Head Judge.
  const submitCodes = async () => {
    if (!activeRun) { setError('No active run'); return false }
    if (!code1 || (numJumps >= 2 && !code2)) {
      setError(numJumps >= 2 ? 'Both jump codes are required' : 'Jump code is required'); return false
    }
    setError('')
    try {
      const codeBody = { jump1_code: code1.trim() }
      if (numJumps >= 2) codeBody.jump2_code = code2.trim()
      const res = await fetch(`${API}/events/${eventId}/runs/${activeRun.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(codeBody)
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.error || 'Failed to submit jump codes')
        return false
      }
      const updated = await res.json()
      setActiveRun(prev => ({ ...prev, ...updated, ...(updated.codes_mismatch ? { air_code_mismatch: true } : {}) }))
      setCodesSubmitted(true)
      return true
    } catch (e) {
      setError(e.message || 'Network error submitting jump codes')
      return false
    }
  }

  // Combined Submit handler for Air judge: PUT codes first, then POST scores.
  // If codes PUT fails (e.g., 409 mismatch with the other Air Judge), the
  // server's error text is surfaced and the score POSTs are NOT fired. All
  // local state (codes + scores) is preserved so the judge can correct and
  // retry. Mirrors the existing two-call flow but on a single user action.
  const submitAirAll = async () => {
    if (!activeRun) { setError('No active run'); return }
    // Validate scores locally before any server call
    if (airJ1 === null) { setError('Jump 1 score is required'); return }
    if (numJumps >= 2 && airJ2 === null) { setError('Jump 2 score is required'); return }
    const ok = await submitCodes()
    if (!ok) return
    await submitScore()
  }

  // T&L total — preserves the existing additive formula bit-for-bit.
  // (See CLAUDE.md v1.18.05: README claimed weighted; codebase is additive
  // 0–10 / 0–5 / 0–5; mathematically equivalent.)
  const turnsTotal = isTurns
    ? (componentScoring
        ? Math.max(0.1, Math.min(20, (carving || 0) + (absExt || 0) + (upperBody || 0) - (deduction || 0)))
        : Math.max(0.1, Math.min(20, (carving || 0) - (deduction || 0))))
    : null

  const submitScore = async () => {
    if (!activeRun || !judgeId) return
    setError('')

    // v2.1.00 (Mock Comp Issue 7b) -- SOFT stop on implausible deductions: the
    // presets top out at 6.0 (stop/fall), so anything beyond is almost always
    // a score typed into the deduction field. Confirm, never refuse.
    if (isTurns && (deduction || 0) > 6.0) {
      const ok = window.confirm(`Deduction of ${(deduction || 0).toFixed(1)} exceeds the full-fall maximum of 6.0.  Are you sure?`)
      if (!ok) return
    }

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
      // v2.3.00 -- each air row records the code THIS judge scored against
      // (mismatch reconciliation on the HJ tablet).
      submissions.push({ score_type: 'air_jump1', raw_score: airJ1, jump_code: code1.trim() })
      if (numJumps >= 2) submissions.push({ score_type: 'air_jump2', raw_score: airJ2, jump_code: code2.trim() })
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

  // ── Full-screen states ───────────────────────────────────────────────────
  if (eventCompleted) return (
    <div className={`tablet-root min-h-screen flex items-center justify-center ${hc ? 'hc' : ''}`} data-hc={hc ? '1' : '0'}>
      <div className="text-center">
        <div className="tablet-display" style={{ fontSize: 56, color: 'var(--tablet-green2)', marginBottom: 12 }}>Event Completed</div>
        <div className="text-xl" style={{ color: 'var(--tablet-dim)' }}>Thank You for Your Work</div>
      </div>
    </div>
  )

  if (!judgeId) return (
    <div className={`tablet-root min-h-screen flex items-center justify-center p-6 ${hc ? 'hc' : ''}`} data-hc={hc ? '1' : '0'}>
      <div className="text-center space-y-4">
        <div style={{ fontSize: 48 }}>&#9975;</div>
        <div className="text-xl font-bold"><span style={{ color: '#fff' }}>Stick</span><span style={{ color: '#EF4444' }}>It</span></div>
        <div style={{ color: 'var(--tablet-dim)' }}>No judge ID provided. Use the link from the admin console.</div>
      </div>
    </div>
  )

  // ── Helpers for the main render ──────────────────────────────────────────
  const isRestricted = eventDivision === 'devo' || eventDivision === 'rqs_eqs'
  const FREQ_CODES = isRestricted ? DEVO_FREQ_CODES : COMP_FREQ_CODES
  const filteredAllCodes = isRestricted
    ? jumpDDs.filter(d => !/^[bfl]|o/.test(d.jump_code))
    : jumpDDs

  const athleteName = activeRun
    ? (activeRun.is_forerunner ? 'FORERUNNER' : `${activeRun.last_name?.toUpperCase() || ''}${activeRun.first_name ? `, ${activeRun.first_name}` : ''}`)
    : '—'
  const athleteBib = activeRun && !activeRun.is_forerunner ? activeRun.bib_number : ''

  // Athlete bar meta line — varies by judge role per the prototype:
  //   • Air judge:           NOW SCORING · Athlete N of M · Air J1 — <name>
  //   • TL non-component:    NOW SCORING · Athlete N of M · Jump 1: <code> · Jump 2: <code>
  //   • TL component:        NOW SCORING · Athlete N of M · TL1 — <name>
  // For TL non-component, judge identity moves to the right-cluster role label
  // so meta has room for the jump codes the TL judge needs to see.
  const athleteMeta = []
  if (activeRun) {
    athleteMeta.push(activeRun.is_forerunner ? <span style={{ color: '#fb923c' }}>FORERUNNER (Judge Test)</span> : 'NOW SCORING')
    if (activeRun.run_position != null && activeRun.total_runners != null) {
      athleteMeta.push(<>Athlete <strong>{activeRun.run_position}</strong> of <strong>{activeRun.total_runners}</strong></>)
    }
    if (isTurns && !componentScoring) {
      // TL non-component: show jump codes (not judge identity — that's on the right)
      if (activeRun.jump1_code) athleteMeta.push(<>Jump 1: <strong>{activeRun.jump1_code}</strong></>)
      if (activeRun.jump2_code && numJumps >= 2) athleteMeta.push(<>Jump 2: <strong>{activeRun.jump2_code}</strong></>)
    } else {
      // Air or TL component: show judge identity in meta
      if (judge?.role || judge?.name) {
        athleteMeta.push(
          <>
            <strong style={{ color: 'var(--tablet-blue2)' }}>{roleDisplay(judge?.role)}</strong>
            {judge?.name && <> — {judge.name}</>}
          </>
        )
      }
    }
  }

  // ── Athlete bar right cluster (per-judge-role variant) ───────────────────
  let athleteBarRight = null
  if (isAir && activeRun) {
    const chipDd = (localCode, runCode, runDd) => {
      if (!localCode) return runDd
      if (localCode === runCode) return runDd
      const row = jumpDDs.find(d => d.jump_code === localCode)
      return row ? row.dd_value : null
    }
    athleteBarRight = (
      <>
        {/* v2.3.00 -- the chip shows THIS judge's own pick once made (with its DD
            from the event's DD list); before a pick it falls back to the run's
            official code. Previously the run's code won, which read wrong on the
            judge whose codes differ during a mismatch. */}
        <JumpChip
          label="JUMP 1"
          code={code1 || activeRun.jump1_code}
          dd={chipDd(code1, activeRun.jump1_code, activeRun.jump1_dd)}
          score={airJ1}
        />
        {numJumps >= 2 && (
          <JumpChip
            label="JUMP 2"
            code={code2 || activeRun.jump2_code}
            dd={chipDd(code2, activeRun.jump2_code, activeRun.jump2_dd)}
            score={airJ2}
          />
        )}
        <HCModeButton hc={hc} onToggle={toggleHc} />
      </>
    )
  } else if (isTurns && componentScoring && activeRun) {
    const total = (carving !== null && absExt !== null && upperBody !== null)
      ? Math.max(0.1, Math.min(20, turnsTotal)).toFixed(1)
      : '—'
    athleteBarRight = (
      <>
        <div className="flex flex-col items-end gap-1">
          <HCModeButton hc={hc} onToggle={toggleHc} />
          <div className="flex items-baseline gap-2">
            <span className="text-xs uppercase tracking-widest" style={{ color: 'var(--tablet-dim)' }}>T&L Total</span>
            <span className="tablet-display" style={{ fontSize: 64, color: 'var(--tablet-blue2)', lineHeight: 1 }}>{total}</span>
          </div>
        </div>
      </>
    )
  } else if (isTurns && activeRun) {
    // TL non-component: judge role label on right (per slide 02)
    athleteBarRight = (
      <>
        <span
          className="tablet-display"
          style={{ fontSize: 22, letterSpacing: 1, color: 'var(--tablet-text)' }}
        >
          {roleDisplay(judge?.role)}
        </span>
        <HCModeButton hc={hc} onToggle={toggleHc} />
      </>
    )
  } else {
    athleteBarRight = <HCModeButton hc={hc} onToggle={toggleHc} />
  }

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

        <AthleteBar
          bib={athleteBib}
          name={athleteName}
          meta={athleteMeta}
          right={athleteBarRight}
        />

        {!activeRun && (
          <div className="tablet-card" style={{ padding: 32, textAlign: 'center' }}>
            <div className="tablet-display" style={{ fontSize: 64, color: 'var(--tablet-muted)' }}>&#9203;</div>
            <div style={{ color: 'var(--tablet-dim)' }}>Waiting for next athlete...</div>
          </div>
        )}

        {activeRun && activeRun.jump1_code && activeRun.jump2_code &&
         activeRun.jump1_code.trim().toLowerCase().replace(/r/g,'') === activeRun.jump2_code.trim().toLowerCase().replace(/r/g,'') && (
          <div className="tablet-warn-banner">
            <span style={{ fontWeight: 800, letterSpacing: 1 }}>DUPLICATE JUMP CODES</span>
            <span>Jump 2 receives DD 0.00 (no credit for repeated jump).</span>
          </div>
        )}

        {scoreRejected && activeRun && !submitted && (
          <div className="tablet-card" style={{ padding: 14, borderColor: 'var(--tablet-red2)', borderWidth: 2 }}>
            <div className="font-bold" style={{ color: 'var(--tablet-red2)' }}>Your score was rejected</div>
            <div className="text-sm mt-1" style={{ color: 'var(--tablet-dim)' }}>The Head Judge has rejected your previous score. Please enter and submit a new score below.</div>
          </div>
        )}

        {/* ── Air Judge ─────────────────────────────────────────────────── */}
        {activeRun && !submitted && isAir && (
          <AirJudgePanel
            numJumps={numJumps}
            freqCodes={FREQ_CODES}
            allCodes={filteredAllCodes}
            code1={code1} setCode1={setCode1}
            code2={code2} setCode2={setCode2}
            airJ1={airJ1} setAirJ1={setAirJ1}
            airJ2={airJ2} setAirJ2={setAirJ2}
            error={error}
            submitAll={submitAirAll}
            activeRun={activeRun}
          />
        )}

        {/* ── TL Judge (component) ──────────────────────────────────────── */}
        {activeRun && !submitted && isTurns && componentScoring && (
          <TLComponentPanel
            carving={carving} setCarving={setCarving}
            absExt={absExt} setAbsExt={setAbsExt}
            upperBody={upperBody} setUpperBody={setUpperBody}
            deduction={deduction} setDeduction={setDeduction}
            turnsTotal={turnsTotal}
            error={error}
            submitScore={submitScore}
          />
        )}

        {/* ── TL Judge (non-component) ──────────────────────────────────── */}
        {activeRun && !submitted && isTurns && !componentScoring && (
          <TLNonComponentPanel
            carving={carving} setCarving={setCarving}
            deduction={deduction} setDeduction={setDeduction}
            turnsTotal={turnsTotal}
            error={error}
            submitScore={submitScore}
          />
        )}

        {submitted && activeRun && (
          <div className="tablet-card" style={{ padding: 32, textAlign: 'center', borderColor: 'var(--tablet-green2)', borderWidth: 2 }}>
            <div className="tablet-display" style={{ fontSize: 64, color: 'var(--tablet-green2)' }}>&#10003;</div>
            <div className="text-xl font-bold mt-2" style={{ color: 'var(--tablet-green2)' }}>Score Submitted</div>
            {isTurns && turnsTotal !== null && (
              <div className="text-lg mt-3" style={{ color: '#fff' }}>
                <div className="tablet-display" style={{ fontSize: 36 }}>T&L Total: {Math.max(0.1, Math.min(20, turnsTotal)).toFixed(1)}</div>
                <div className="text-sm tablet-mono mt-1" style={{ color: 'var(--tablet-dim)' }}>
                  {componentScoring
                    ? `${(carving || 0).toFixed(1)} + ${(absExt || 0).toFixed(1)} + ${(upperBody || 0).toFixed(1)} - ${(deduction || 0).toFixed(1)} = ${Math.max(0.1, Math.min(20, turnsTotal)).toFixed(1)}`
                    : `${(carving || 0).toFixed(1)} - ${(deduction || 0).toFixed(1)} = ${Math.max(0.1, Math.min(20, turnsTotal)).toFixed(1)}`
                  }
                </div>
              </div>
            )}
            {isAir && (
              <div className="text-lg mt-3" style={{ color: '#fff' }}>
                {airJ1 !== null && <div>Jump 1: {code1 && <span className="tablet-mono" style={{ color: 'var(--tablet-blue2)' }}>{code1} </span>}<span className="tablet-mono">{Number(airJ1).toFixed(1)}</span></div>}
                {airJ2 !== null && <div>Jump 2: {code2 && <span className="tablet-mono" style={{ color: 'var(--tablet-blue2)' }}>{code2} </span>}<span className="tablet-mono">{Number(airJ2).toFixed(1)}</span></div>}
              </div>
            )}
            {/* v2.3.00 -- jump-code mismatch: prominent warning on BOTH Air judge tablets
                until the Head Judge reconciles; then the reconciled notice replaces it. */}
            {isAir && activeRun.air_code_mismatch && (
              <div className="mt-5 rounded-xl" style={{ padding: '18px 20px', background: 'rgba(239,68,68,0.15)', border: '3px solid var(--tablet-red2)' }}>
                <div className="tablet-display" style={{ fontSize: 30, color: 'var(--tablet-red2)', letterSpacing: 1 }}>WARNING &mdash; JUMP CODES DO NOT MATCH</div>
                <div className="text-lg font-bold mt-2" style={{ color: '#fff' }}>Please see the Head Judge to reconcile.</div>
                <div className="text-sm mt-2" style={{ color: 'var(--tablet-dim)' }}>Your scores were recorded. The Head Judge will accept one judge&rsquo;s codes or reject both.</div>
              </div>
            )}
            {isAir && !activeRun.air_code_mismatch && !!activeRun.air_codes_reconciled && (
              <div className="mt-5 rounded-xl" style={{ padding: '16px 20px', background: 'rgba(34,197,94,0.12)', border: '2px solid var(--tablet-green2)' }}>
                <div className="tablet-display" style={{ fontSize: 26, color: 'var(--tablet-green2)', letterSpacing: 1 }}>Air Codes Reconciled by Head Judge</div>
                <div className="text-sm mt-1 tablet-mono" style={{ color: '#fff' }}>
                  Jump 1: {activeRun.jump1_code || '--'}{numJumps >= 2 && <> &middot; Jump 2: {activeRun.jump2_code || '--'}</>}
                </div>
              </div>
            )}
            <div className="text-sm mt-4" style={{ color: 'var(--tablet-dim)' }}>Waiting for next athlete...</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Air Judge Panel ─────────────────────────────────────────────────────────
// Single-screen flow per slide 01 prototype:
//   [Jump 1 column]  [Jump 2 column]  [Reference 260px sidebar]
//   ↳ each jump column: header pill + JUMP CODE grid + All-codes dropdown
//     + SCORE grid (mixed step) + Fine-tune row
//   ↳ one full-width Submit button at the bottom
// On Submit: PUT codes → POST scores. If codes PUT returns the 409 mismatch
// from the other Air Judge, the server's exact error text is surfaced and
// score POSTs are NOT fired. State preserved for retry.
function AirJudgePanel({
  numJumps, freqCodes, allCodes,
  code1, setCode1, code2, setCode2,
  airJ1, setAirJ1, airJ2, setAirJ2,
  error, submitAll, activeRun,
}) {
  const codesPicked = !!code1 && (numJumps < 2 || !!code2)
  // v2.3.00 -- column pill DD follows THIS judge's pick (looked up in the DD
  // list) when it differs from the run's official code; see chipDd above.
  const pillDd = (localCode, runCode, runDd) => {
    if (!localCode || localCode === runCode) return runDd
    const row = (allCodes || []).find(d => d.jump_code === localCode)
    return row ? row.dd_value : null
  }
  const scoresPicked = airJ1 !== null && (numJumps < 2 || airJ2 !== null)
  const canSubmit = codesPicked && scoresPicked
  const submitLabel =
    !codesPicked && !scoresPicked ? 'Submit Both Scores — pick codes + scores'
    : !codesPicked                ? (numJumps >= 2 ? 'Submit Both Scores — pick both jump codes' : 'Submit Score — pick a jump code')
    : !scoresPicked               ? (numJumps >= 2 ? 'Submit Both Scores — enter both jump scores' : 'Submit Score — enter a score')
    :                                (numJumps >= 2 ? 'Submit Both Scores' : 'Submit Score')

  const cols = numJumps >= 2
    ? '1fr 1fr 260px'   // Jump 1, Jump 2, Reference
    : '1fr 260px'        // Devo: Jump 1 only + Reference

  return (
    <div className="space-y-4">
      <div className="grid gap-4" style={{ gridTemplateColumns: cols }}>
        <AirJumpColumn
          jumpLabel="Jump 1"
          freqCodes={freqCodes}
          allCodes={allCodes}
          code={code1}
          setCode={(c) => { setCode1(c); if (c === 'NJ') setAirJ1(0) }}
          activeRunCode={activeRun.jump1_code}
          dd={pillDd(code1, activeRun.jump1_code, activeRun.jump1_dd)}
          value={airJ1}
          onChange={setAirJ1}
          isActive={airJ1 === null && !!code1}
        />
        {numJumps >= 2 && (
          <AirJumpColumn
            jumpLabel="Jump 2"
            freqCodes={freqCodes}
            allCodes={allCodes}
            code={code2}
            setCode={(c) => { setCode2(c); if (c === 'NJ') setAirJ2(0) }}
            activeRunCode={activeRun.jump2_code}
            dd={pillDd(code2, activeRun.jump2_code, activeRun.jump2_dd)}
            value={airJ2}
            onChange={setAirJ2}
            isActive={!!code1 && airJ1 !== null && airJ2 === null}
          />
        )}
        <ReferencePanel title="Scoring Reference" sections={AIR_REF_SECTIONS} width={260} />
      </div>
      {numJumps >= 2 && code1 && code2 && code1.trim().toLowerCase().replace(/r/g,'') === code2.trim().toLowerCase().replace(/r/g,'') && (
        <div className="tablet-warn-banner">
          <span style={{ fontWeight: 800, letterSpacing: 1 }}>DUPLICATE JUMP CODES</span>
          <span>Jump 2 will receive DD 0.00 (no credit for repeated jump).</span>
        </div>
      )}
      {error && (
        <div
          className="tablet-card"
          style={{ padding: 14, borderColor: 'var(--tablet-red2)', borderWidth: 2 }}
        >
          <div className="font-bold" style={{ color: 'var(--tablet-red2)' }}>{error}</div>
        </div>
      )}
      <button
        type="button"
        onClick={submitAll}
        disabled={!canSubmit}
        className="tablet-btn-submit w-full"
        style={{ height: 68, fontSize: 24 }}
      >
        {submitLabel}
      </button>
    </div>
  )
}

// One column on the Air judge screen. Combines code grid + score grid + fine-tune.
function AirJumpColumn({
  jumpLabel, freqCodes, allCodes, code, setCode,
  activeRunCode, dd, value, onChange, isActive,
}) {
  // Display code: prefer locally-picked code (drives UI immediately) then
  // fall back to whatever's already on the run record.
  const displayCode = code || activeRunCode || ''
  return (
    <div
      className={`tablet-card ${isActive ? 'is-active' : ''}`}
      style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      {/* Header pill: column label · selected code · DD · score */}
      <div className="flex items-center justify-between">
        <span className="tablet-display" style={{ fontSize: 22, letterSpacing: 1 }}>{jumpLabel.toUpperCase()}</span>
        <div
          className="flex items-center gap-2 px-3 py-1 rounded-lg"
          style={{
            background: value !== null ? 'rgba(74, 222, 128, 0.10)' : 'var(--tablet-navy3)',
            border: `1.5px solid ${value !== null ? 'rgba(74,222,128,0.5)' : 'var(--tablet-navy4)'}`,
          }}
        >
          <span
            className="dot"
            style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: 4,
              background: value !== null ? 'var(--tablet-green2)' : 'var(--tablet-blue2)',
            }}
          />
          <span className="tablet-mono" style={{ fontSize: 14, color: '#fff' }}>{displayCode || '—'}</span>
          {dd != null && (
            <span style={{ fontSize: 12, color: 'var(--tablet-dim)' }}>DD {dd}</span>
          )}
          <span style={{ color: 'var(--tablet-muted)', fontSize: 14 }}>→</span>
          <span
            className="tablet-display"
            style={{
              fontSize: 22, lineHeight: 1,
              color: value !== null ? 'var(--tablet-green2)' : 'var(--tablet-muted)',
            }}
          >
            {value !== null ? Number(value).toFixed(1) : '—'}
          </span>
        </div>
      </div>

      {/* JUMP CODE subheading + grid */}
      <div
        className="text-xs uppercase font-bold"
        style={{ color: 'var(--tablet-dim)', letterSpacing: 1.5, marginTop: 4 }}
      >
        Jump Code
      </div>
      <JumpCodeGrid
        freqCodes={freqCodes}
        allCodes={allCodes}
        selected={code}
        onSelect={setCode}
      />

      {/* SCORE subheading + mixed-step grid */}
      <div
        className="text-xs uppercase font-bold"
        style={{ color: 'var(--tablet-dim)', letterSpacing: 1.5, marginTop: 4 }}
      >
        Score (0–10) · Tap any value
      </div>
      <ScoreButtonGrid
        values={VALUES_AIR_15}
        cols={6}
        rowHeight={52}
        zones={ZONES_AIR}
        value={value}
        onChange={onChange}
      />

      {/* Fine-tune label + row */}
      <div className="flex items-center gap-3" style={{ marginTop: 4 }}>
        <span
          className="text-xs uppercase font-bold"
          style={{ color: 'var(--tablet-dim)', letterSpacing: 1.5 }}
        >
          Fine tune:
        </span>
        <div style={{ flex: 1 }}>
          <FineTuneRow value={value} onChange={onChange} min={0} max={10} step={0.1} size="sm" />
        </div>
      </div>
    </div>
  )
}

// ── TL Component Panel (slide 03) ───────────────────────────────────────────
function TLComponentPanel({
  carving, setCarving, absExt, setAbsExt, upperBody, setUpperBody,
  deduction, setDeduction, turnsTotal, error, submitScore,
}) {
  const allEntered = carving !== null && absExt !== null && upperBody !== null
  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        <ComponentColumn
          title="CARVING"
          weight="50%"
          value={carving}
          onChange={setCarving}
          min={0} max={10} cols={7} rowHeight={48} fontSize={16}
          isActive={carving === null}
        />
        <ComponentColumn
          title="AB / EXT"
          weight="25%"
          value={absExt}
          onChange={setAbsExt}
          min={0} max={5} cols={6} rowHeight={48} fontSize={16}
          isActive={carving !== null && absExt === null}
        />
        <ComponentColumn
          title="UPPER BODY"
          weight="25%"
          value={upperBody}
          onChange={setUpperBody}
          min={0} max={5} cols={6} rowHeight={48} fontSize={16}
          isActive={carving !== null && absExt !== null && upperBody === null}
        />
      </div>
      <div className="tablet-card" style={{ padding: 16 }}>
        <div className="flex items-center justify-between mb-2">
          <div className="tablet-display" style={{ fontSize: 22, letterSpacing: 1 }}>DEDUCTION</div>
          {allEntered && (
            <div className="text-sm tablet-mono" style={{ color: 'var(--tablet-dim)' }}>
              {(carving || 0).toFixed(1)} + {(absExt || 0).toFixed(1)} + {(upperBody || 0).toFixed(1)} − {(deduction || 0).toFixed(1)} = {Math.max(0.1, Math.min(20, turnsTotal)).toFixed(1)}
            </div>
          )}
        </div>
        <DeductionPad value={deduction} onChange={setDeduction} />
      </div>
      {error && <div className="px-4 py-3 text-sm rounded-lg" style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--tablet-red2)' }}>{error}</div>}
      <button
        type="button"
        onClick={submitScore}
        disabled={!allEntered}
        className="tablet-btn-submit w-full"
        style={{ height: 68, fontSize: 24 }}
      >
        {allEntered ? 'Submit Score' : 'Submit Score — enter all three components first'}
      </button>
    </>
  )
}

// Slide-03 reference pills: 4 colored badges below each component column.
// Carving uses 0-10 ranges, Ab/Ext + Upper Body use 0-5 ranges.
const PILLS_10 = [
  { label: 'Excellent', quality: 'ex', range: '8.1–10' },
  { label: 'Good',      quality: 'gd', range: '6.1–8'  },
  { label: 'Adequate',  quality: 'av', range: '4.1–6'  },
  { label: 'Poor',      quality: 'po', range: '0.1–4'  },
]
const PILLS_5 = [
  { label: 'Excellent', quality: 'ex', range: '4.1–5' },
  { label: 'Good',      quality: 'gd', range: '3.1–4' },
  { label: 'Adequate',  quality: 'av', range: '2.1–3' },
  { label: 'Poor',      quality: 'po', range: '0.1–1' },
]
// Subtitles per the prototype: "0–10 · Good range: 6.1–8" etc.
const COMP_GOOD_RANGE = { 10: '6.1–8', 5: '3.1–4' }

function ComponentColumn({ title, weight, value, onChange, min, max, cols, rowHeight, fontSize, isActive }) {
  const pills = max === 10 ? PILLS_10 : PILLS_5
  const subtitle = value !== null
    ? `${min}–${max} · Good range: ${COMP_GOOD_RANGE[max]}`
    : `${min}–${max} · Not yet entered`
  return (
    <div className={`tablet-card ${isActive ? 'is-active' : ''}`} style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="flex items-baseline justify-between">
        <span className="tablet-display" style={{ fontSize: 22, letterSpacing: 1 }}>{title}</span>
        <span
          className="tablet-display"
          style={{
            fontSize: 32, lineHeight: 1,
            color: value !== null ? 'var(--tablet-green2)' : 'var(--tablet-muted)',
          }}
        >
          {value !== null ? Number(value).toFixed(1) : '—'}
        </span>
      </div>
      <div className="text-xs" style={{ color: 'var(--tablet-dim)' }}>
        <strong style={{ color: 'var(--tablet-blue2)' }}>{weight}</strong> · {subtitle}
      </div>
      <ScoreButtonGrid
        min={min} max={max} step={0.5}
        cols={cols}
        rowHeight={rowHeight}
        fontSize={fontSize}
        zones={max === 10 ? ZONES_AIR : ZONES_COMP_5}
        value={value}
        onChange={onChange}
      />
      <FineTuneRow value={value} onChange={onChange} min={min} max={max} step={0.1} size="sm" />
      <RefPillRow pills={pills} />
    </div>
  )
}

// ── TL Non-Component Panel (slide 02) ───────────────────────────────────────
function TLNonComponentPanel({ carving, setCarving, deduction, setDeduction, turnsTotal, error, submitScore }) {
  const has = carving !== null
  // Final score amber when inside Adequate range (8.1–12), else uses zone color.
  const finalForColor = has ? Math.max(0.1, Math.min(20, turnsTotal)) : null
  const finalColor =
    finalForColor === null         ? 'var(--tablet-muted)' :
    finalForColor >= 16.5          ? '#4ade80' :
    finalForColor >= 12.5          ? '#86efac' :
    finalForColor >= 8.5           ? '#fbbf24' :
    finalForColor >= 4.5           ? '#fb923c' :
                                     '#f87171'

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
      <div className="space-y-4">
        <div className="tablet-card" style={{ padding: 16 }}>
          <div className="flex items-center justify-between mb-2">
            <div className="tablet-display" style={{ fontSize: 22, letterSpacing: 1 }}>RAW T&L SCORE</div>
            <span className="tablet-display" style={{ fontSize: 56, color: has ? 'var(--tablet-blue2)' : 'var(--tablet-muted)', lineHeight: 1 }}>
              {has ? Number(carving).toFixed(1) : '—'}
            </span>
          </div>
          <ScoreButtonGrid
            min={0} max={20} step={0.5}
            cols={11}
            rowHeight={66}
            zones={ZONES_TL}
            value={carving}
            onChange={setCarving}
          />
          <div className="mt-3">
            <FineTuneRow value={carving} onChange={setCarving} min={0} max={20} step={0.1} size="lg" />
          </div>
        </div>
        <div className="tablet-card" style={{ padding: 16 }}>
          <div className="tablet-display mb-2" style={{ fontSize: 22, letterSpacing: 1 }}>DEDUCTION</div>
          <DeductionPad value={deduction} onChange={setDeduction} />
        </div>
        {error && <div className="px-4 py-3 text-sm rounded-lg" style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--tablet-red2)' }}>{error}</div>}
      </div>
      <div className="space-y-4">
        <div className="tablet-card" style={{ padding: 18, textAlign: 'center' }}>
          <div className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--tablet-dim)', letterSpacing: 2 }}>Final T&L Score</div>
          <div className="tablet-display" style={{ fontSize: 84, color: finalColor, lineHeight: 1 }}>
            {has ? Math.max(0.1, Math.min(20, turnsTotal)).toFixed(1) : '—'}
          </div>
          {has && (
            <div className="text-sm tablet-mono mt-2" style={{ color: 'var(--tablet-dim)' }}>
              {(carving || 0).toFixed(1)} − {(deduction || 0).toFixed(1)} = {Math.max(0.1, Math.min(20, turnsTotal)).toFixed(1)}
            </div>
          )}
        </div>
        <ReferencePanel title="T&L Reference" sections={TL_NONCOMP_REF_SECTIONS} width="100%" />
        <button
          type="button"
          onClick={submitScore}
          disabled={!has}
          className="tablet-btn-submit w-full"
          style={{ height: 68, fontSize: 22 }}
        >
          {has ? 'Submit Score' : 'Submit Score — enter score first'}
        </button>
      </div>
    </div>
  )
}
