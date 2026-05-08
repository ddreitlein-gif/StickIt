import { useState, useEffect, useRef, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import useHighContrast from '../hooks/useHighContrast'
import useResolveIds from '../hooks/useResolveIds'
import HCModeButton from '../components/tablet/HCModeButton'
import StatusSquare from '../components/tablet/StatusSquare'
import AthleteBar from '../components/tablet/AthleteBar'
import CalculatedScorePanel from '../components/tablet/CalculatedScorePanel'
import RunStatusGrid from '../components/tablet/RunStatusGrid'

const ROLE_DISPLAY_HJ = {
  TL1: 'T&L 1', TL2: 'T&L 2', TL3: 'T&L 3',
  Air1: 'Air J1', Air2: 'Air J2', HJ: 'Head Judge',
}
const roleDisp = (r) => ROLE_DISPLAY_HJ[r] || ROLE_LABELS[r] || r || ''

const API = '/api'

const fmt = (n) => (n != null ? Number(n).toFixed(2) : '--')
const fmt1 = (n) => (n != null ? Number(n).toFixed(1) : '--')

const SCORE_LABELS = {
  turns:     'T&L',
  air_jump1: 'Air J1',
  air_jump2: 'Air J2',
  form:      'Form',
  landing:   'Landing',
  // v1.18.00 — Aerials v2 per-judge-per-jump
  ae_air_j1:  'Air J1',
  ae_air_j2:  'Air J2',
  ae_form_j1: 'Form J1',
  ae_form_j2: 'Form J2',
  ae_land_j1: 'Land J1',
  ae_land_j2: 'Land J2',
}

const ROLE_LABELS = {
  TL1: 'T&L 1', TL2: 'T&L 2', TL3: 'T&L 3',
  Air1: 'Air 1', Air2: 'Air 2', HJ: 'Head Judge',
  // v1.18.00 — Aerials v2
  AeJudge1: 'Judge 1', AeJudge2: 'Judge 2', AeJudge3: 'Judge 3', AeJudge4: 'Judge 4',
  AeJudge5: 'Judge 5', AeJudge6: 'Judge 6', AeJudge7: 'Judge 7',
  // Aerials legacy
  AirJudge1: 'Air Judge 1', AirJudge2: 'Air Judge 2', AirJudge3: 'Air Judge 3',
  FormJudge1: 'Form Judge 1', FormJudge2: 'Form Judge 2', FormJudge3: 'Form Judge 3',
  LandingJudge1: 'Landing 1', LandingJudge2: 'Landing 2', LandingJudge3: 'Landing 3',
}

const DUAL_ROLE_LABELS = {
  DualTurns1: 'Turns 1', DualTurns2: 'Turns 2',
  DualAir: 'Air', DualTime: 'Time', DualOverall: 'Overall',
}

// ── v1.16.17 -- Bracket Review Panel for Dual Mogul HJ Final Approval ────────
function BracketReviewPanel({ bracket, onApprove, onSendBack, finalizing, sendingBack }) {
  const matches = (bracket || []).filter(m => !m.is_bye)
  const mainMatches = matches.filter(m => !m.is_small_final)
  const consolMatches = matches.filter(m => m.is_small_final)

  // Group by round, descending (earliest round = highest number first)
  const groupByRound = (arr) => {
    const rounds = {}
    arr.forEach(m => { (rounds[m.bracket_round] = rounds[m.bracket_round] || []).push(m) })
    Object.values(rounds).forEach(g => g.sort((a, b) => a.bracket_position - b.bracket_position))
    return Object.entries(rounds)
      .sort(([a], [b]) => Number(b) - Number(a))
      .map(([round, ms]) => ({ round: Number(round), matches: ms }))
  }

  const roundLabel = (round, isConsol = false) => {
    if (isConsol) return round === 1 ? 'Small Final' : `Consol R${round}`
    if (round === 1) return 'FINAL'
    if (round === 2) return 'Semifinal'
    if (round === 3) return 'Quarterfinal'
    if (round === 4) return 'Round of 16'
    if (round === 5) return 'Round of 32'
    return `Round of ${2 ** round}`
  }

  const renderMatch = (m) => {
    const blueWon = m.winner_registration_id && m.winner_registration_id === m.registration_id_blue
    const redWon  = m.winner_registration_id && m.winner_registration_id === m.registration_id_red
    return (
      <div key={m.id} className="tablet-card text-sm" style={{ padding: 8, minWidth: 180 }}>
        <div
          className="flex items-center justify-between px-2 py-1 rounded"
          style={{
            background: blueWon ? 'rgba(14,144,229,0.30)' : 'transparent',
            color: blueWon ? '#fff' : 'var(--tablet-dim)',
            fontWeight: blueWon ? 700 : 400,
          }}
        >
          <span className="tablet-mono text-xs mr-2">{m.blue_bib != null ? `#${m.blue_bib}` : ''}</span>
          <span className="truncate flex-1">{m.blue_last || (m.registration_id_blue ? '...' : 'BYE')}</span>
          {blueWon && <span className="ml-2 font-bold" style={{ color: 'var(--tablet-green2)' }}>W</span>}
        </div>
        <div
          className="flex items-center justify-between px-2 py-1 rounded mt-0.5"
          style={{
            background: redWon ? 'rgba(239,68,68,0.30)' : 'transparent',
            color: redWon ? '#fff' : 'var(--tablet-dim)',
            fontWeight: redWon ? 700 : 400,
          }}
        >
          <span className="tablet-mono text-xs mr-2">{m.red_bib != null ? `#${m.red_bib}` : ''}</span>
          <span className="truncate flex-1">{m.red_last || (m.registration_id_red ? '...' : 'BYE')}</span>
          {redWon && <span className="ml-2 font-bold" style={{ color: 'var(--tablet-green2)' }}>W</span>}
        </div>
      </div>
    )
  }

  const renderColumns = (groups, isConsol) => (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {groups.map(g => (
        <div key={`${isConsol}-${g.round}`} className="flex-shrink-0">
          <div className="text-xs uppercase mb-2 font-semibold" style={{ color: 'var(--tablet-muted)', letterSpacing: 1.5 }}>
            {roundLabel(g.round, isConsol)}
          </div>
          <div className="flex flex-col gap-2 justify-around min-h-full">
            {g.matches.map(renderMatch)}
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <div className="tablet-card" style={{ padding: 20, borderColor: 'var(--tablet-blue)', borderWidth: 2 }}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="tablet-display" style={{ fontSize: 28, color: 'var(--tablet-blue2)' }}>Bracket Complete — Final Review</div>
          <div className="text-xs mt-1" style={{ color: 'var(--tablet-dim)' }}>
            Review the completed bracket below, then approve to finalize the event or send back to scoring for edits.
          </div>
        </div>
      </div>

      <div className="tablet-card mb-4" style={{ padding: 12, background: 'var(--tablet-navy)', overflow: 'hidden' }}>
        <div className="text-xs uppercase tracking-widest mb-2 font-semibold" style={{ color: 'var(--tablet-green2)', letterSpacing: 1.5 }}>Main Bracket</div>
        {renderColumns(groupByRound(mainMatches), false)}
      </div>

      {consolMatches.length > 0 && (
        <div className="tablet-card mb-4" style={{ padding: 12, background: 'var(--tablet-navy)', overflow: 'hidden' }}>
          <div className="text-xs uppercase tracking-widest mb-2 font-semibold" style={{ color: 'var(--tablet-amber2)', letterSpacing: 1.5 }}>Consolation Bracket</div>
          {renderColumns(groupByRound(consolMatches), true)}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onApprove}
          disabled={finalizing || sendingBack}
          className="tablet-btn-submit"
          style={{ height: 64, fontSize: 20 }}
        >
          {finalizing ? 'Finalizing...' : '✓ Approve & Finalize Event'}
        </button>
        <button
          type="button"
          onClick={onSendBack}
          disabled={finalizing || sendingBack}
          className="tablet-btn-amber"
          style={{ height: 64, fontSize: 20 }}
        >
          {sendingBack ? 'Sending Back...' : 'Send Back to Scoring'}
        </button>
      </div>
    </div>
  )
}

// ── Dual Mogul Head Judge View ────────────────────────────────────────────────
function DualHeadJudgeView({ meetId, eventId, hc, toggleHc }) {
  const [activeMatch,  setActiveMatch]  = useState(null)
  const [judgePoints,  setJudgePoints]  = useState([])
  const [pointResult,  setPointResult]  = useState(null)
  const [statusMsg,    setStatusMsg]    = useState('')
  const [error,        setError]        = useState('')
  const [approving,    setApproving]    = useState(false)
  const [confirmReject, setConfirmReject] = useState(null)
  const [rejecting,    setRejecting]    = useState(false)
  const [settingStatus, setSettingStatus] = useState(false)
  // v1.5 Feature 4: Next Pairing state (HJ tablet can start next dual run)
  const [nextMatch, setNextMatch] = useState(null)
  const [startingNext, setStartingNext] = useState(false)
  // v1.16.17 -- bracket complete -> HJ final review state
  const [reviewStatus, setReviewStatus] = useState(null)   // null | 'pending' | 'sent_back' | 'approved'
  const [bracketAll, setBracketAll]     = useState([])
  const [eventCompleted, setEventCompleted] = useState(false)
  const [finalizing, setFinalizing]     = useState(false)
  const [sendingBack, setSendingBack]   = useState(false)
  const pollRef = useRef(null)
  const wsRef   = useRef(null)

  const loadReviewState = async () => {
    try {
      const [rs, br] = await Promise.all([
        fetch(`${API}/events/${eventId}/dual/review-state`).then(r => r.ok ? r.json() : null),
        fetch(`${API}/events/${eventId}/dual`).then(r => r.ok ? r.json() : []),
      ])
      if (rs) {
        setReviewStatus(rs.status || null)
        if (rs.eventCompleted) setEventCompleted(true)
      }
      setBracketAll(Array.isArray(br) ? br : [])
    } catch {}
  }

  // v1.5 F4: load the next pending match (ready-to-start) from the bracket
  const loadNextMatch = async () => {
    try {
      const r = await fetch(`${API}/events/${eventId}/dual`)
      if (!r.ok) return
      const bracket = await r.json()
      // A match is "ready" if both sides are assigned, not started, not a bye.
      const ready = (bracket || [])
        .filter(m => m.status === 'pending'
                  && m.registration_id_blue && m.registration_id_red
                  && !m.is_bye)
        // Earliest round first (bracket_round descending = earlier rounds first
        // in this schema where higher round = earlier -- match the existing UI's
        // activeRoundNum logic by sorting high-round then low-position).
        .sort((a, b) => (b.bracket_round - a.bracket_round) || (a.bracket_position - b.bracket_position))
      setNextMatch(ready[0] || null)
    } catch {}
  }

  // v1.5 F4: start the next run -- mirrors EventDetail.jsx startMatch exactly.
  const startNextRun = async () => {
    if (!nextMatch) return
    setStartingNext(true); setError(''); setStatusMsg('')
    try {
      const res = await fetch(`${API}/events/${eventId}/dual/active-match`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_id: nextMatch.id }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `Server error ${res.status}`)
      }
      setStatusMsg('Next match started.')
      await loadMatch()
      await loadNextMatch()
    } catch (e) {
      setError('Start run failed: ' + e.message)
    } finally { setStartingNext(false) }
  }

  const loadMatch = async () => {
    try {
      const r = await fetch(`${API}/events/${eventId}/dual/active-match`)
      const data = await r.json()
      const match = data?.id ? data : null
      setActiveMatch(match)
      if (match) {
        // Load judge points for this match
        const pr = await fetch(`${API}/events/${eventId}/dual/${match.id}/judge-points`)
        const pd = await pr.json()
        setJudgePoints(pd.rows || [])
        setPointResult(pd.result || null)
      } else {
        setJudgePoints([])
        setPointResult(null)
      }
    } catch {}
  }

  useEffect(() => {
    loadMatch()
    loadNextMatch()
    loadReviewState()
    pollRef.current = setInterval(() => { loadMatch(); loadNextMatch(); loadReviewState() }, 3000)
    return () => clearInterval(pollRef.current)
  }, [eventId])

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}`)
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.eventId !== eventId) return
        if (['dual_points_update', 'dual_match_started', 'dual_match_cleared', 'score_update', 'run_updated'].includes(msg.type)) {
          loadMatch()
          loadNextMatch()
          loadReviewState()
        }
        if (['dual_bracket_review', 'dual_bracket_sent_back'].includes(msg.type)) {
          loadReviewState()
        }
        if (msg.type === 'event_finalized' || (msg.type === 'run_round_status' && msg.data?.event_completed)) {
          setEventCompleted(true)
        }
      } catch {}
    }
    wsRef.current = ws
    return () => ws.close()
  }, [eventId])

  // Reject a judge's point entry (delete it so they can resubmit)
  const executeReject = async () => {
    if (!confirmReject || !activeMatch) return
    setRejecting(true); setError('')
    try {
      // When rejecting J4 (Time), also clear J5 (Overall) since their point
      // total depends on whether time is tied.
      let remaining = judgePoints.filter(p => p.judge_number !== confirmReject.judgeNumber)
      if (confirmReject.judgeNumber === 4) {
        remaining = remaining.filter(p => p.judge_number !== 5)
      }
      // Clear all points
      await fetch(`${API}/events/${eventId}/dual/${activeMatch.id}/judge-points`, { method: 'DELETE' })
      // Re-add the ones we want to keep
      for (const p of remaining) {
        const payload = { judge_number: p.judge_number, blue_points: p.blue_points, red_points: p.red_points }
        if (p.time_tied === 1) payload.time_tied = true
        await fetch(`${API}/events/${eventId}/dual/${activeMatch.id}/judge-points`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }
      const msg = confirmReject.judgeNumber === 4
        ? 'Judge 4 (Time) score rejected. Judge 5 (Overall) must also rescore.'
        : `Judge ${confirmReject.judgeNumber} score rejected.  Judge may resubmit.`
      setStatusMsg(msg)
      setConfirmReject(null)
      await loadMatch()
    } catch (e) {
      setError('Rejection failed: ' + e.message)
    } finally { setRejecting(false) }
  }

  // Approve and submit the match -- calls the server approve endpoint which
  // marks the match complete, broadcasts the winner, and advances the bracket.
  const approveMatch = async () => {
    if (!activeMatch) return
    setApproving(true); setError(''); setStatusMsg('')
    try {
      const res = await fetch(`${API}/events/${eventId}/dual/${activeMatch.id}/approve`, {
        method: 'POST',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Server error ${res.status}`)
      }
      setStatusMsg('Match approved and finalized.')
      await loadMatch()
    } catch (e) {
      setError('Approval failed: ' + e.message)
    } finally { setApproving(false) }
  }

  const finalizeEvent = async () => {
    setFinalizing(true); setError(''); setStatusMsg('')
    try {
      const r = await fetch(`${API}/events/${eventId}/finalize`, { method: 'POST' })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error || `Server error ${r.status}`)
      }
      setEventCompleted(true)
    } catch (e) { setError('Finalize failed: ' + e.message) }
    finally { setFinalizing(false) }
  }

  const sendBackToScoring = async () => {
    setSendingBack(true); setError(''); setStatusMsg('')
    try {
      const r = await fetch(`${API}/events/${eventId}/dual/send-back-to-scoring`, { method: 'POST' })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error || `Server error ${r.status}`)
      }
      setStatusMsg('Bracket sent back to scoring for edits.')
      await loadReviewState()
    } catch (e) { setError('Send back failed: ' + e.message) }
    finally { setSendingBack(false) }
  }

  const matchComplete = activeMatch?.status === 'complete'
  const hjPending = activeMatch?.status === 'hj_pending'
  const hasWinner = pointResult && pointResult.winner

  // v1.16.17 -- event completed full-screen message
  if (eventCompleted) {
    return (
      <div className={`tablet-root min-h-screen flex items-center justify-center ${hc ? 'hc' : ''}`} data-hc={hc ? '1' : '0'}>
        <div className="text-center">
          <div className="tablet-display" style={{ fontSize: 56, color: 'var(--tablet-green2)', marginBottom: 12 }}>Event Completed</div>
          <div className="text-xl" style={{ color: 'var(--tablet-dim)' }}>Thank You for Your Work</div>
        </div>
      </div>
    )
  }

  return (
    <div className={`tablet-root min-h-screen ${hc ? 'hc' : ''}`} data-hc={hc ? '1' : '0'}>
      {/* Header */}
      <div className="tablet-card flex items-center justify-between" style={{ borderRadius: 0, padding: '14px 24px' }}>
        <div>
          <div className="tablet-display" style={{ fontSize: 22, lineHeight: 1, letterSpacing: 1 }}>HEAD JUDGE</div>
          <div className="text-xs mt-1" style={{ color: 'var(--tablet-dim)' }}><span style={{ color: '#fff' }}>Stick</span><span style={{ color: '#EF4444' }}>It</span> System · Dual Moguls</div>
        </div>
        <div className="flex items-center gap-3">
          <HCModeButton hc={hc} onToggle={toggleHc} />
          {activeMatch && !matchComplete && !hjPending && (
            <div className="text-xs px-3 py-1.5 rounded-full bg-blue-900/40 text-blue-400">
              Match in progress
            </div>
          )}
          {hjPending && (
            <div className="text-xs px-3 py-1.5 rounded-full bg-amber-900/50 text-amber-400 font-semibold animate-pulse">
              Awaiting Approval
            </div>
          )}
          {matchComplete && (
            <div className="text-xs px-3 py-1.5 rounded-full bg-green-900/50 text-green-400">
              Match Complete
            </div>
          )}
          {!activeMatch && (
            <div className="text-xs px-3 py-1.5 rounded-full bg-slate-800 text-slate-500">
              Waiting
            </div>
          )}
        </div>
      </div>

      <div className="p-4">

        {/* Status/error messages */}
        {statusMsg && (
          <div className="bg-green-900/30 border border-green-800 text-green-400 rounded-xl px-4 py-3 text-sm font-medium mb-4">
            {statusMsg}
          </div>
        )}
        {error && (
          <div className="bg-red-900/30 border border-red-800 text-red-400 rounded-xl px-4 py-3 text-sm mb-4">
            {error}
          </div>
        )}

        {/* v1.16.17 -- Bracket complete: HJ final review (highest priority when no active match) */}
        {!activeMatch && reviewStatus === 'pending' && (
          <BracketReviewPanel
            bracket={bracketAll}
            onApprove={finalizeEvent}
            onSendBack={sendBackToScoring}
            finalizing={finalizing}
            sendingBack={sendingBack}
          />
        )}

        {/* v1.16.17 -- Bracket sent back to scoring */}
        {!activeMatch && reviewStatus === 'sent_back' && (
          <div className="bg-amber-900/20 rounded-2xl p-8 text-center border border-amber-700">
            <div className="text-amber-400 text-lg font-semibold mb-2">Awaiting Scoring Edits</div>
            <div className="text-slate-300 text-sm">
              The bracket has been sent back to scoring. The scoring person will edit scores and resend for approval.
            </div>
          </div>
        )}

        {/* No active match */}
        {!activeMatch && !nextMatch && !reviewStatus && (
          <div className="bg-slate-800 rounded-2xl p-8 text-center border border-slate-700">
            <div className="text-4xl mb-3 text-slate-500">--</div>
            <div className="text-slate-400 text-lg">Waiting for next match...</div>
          </div>
        )}

        {/* Next Pairing — full width (hidden when bracket is in HJ review or sent back) */}
        {((!activeMatch) || matchComplete) && nextMatch && !reviewStatus && (
          <div className="bg-slate-900 rounded-2xl p-5 border border-green-700 mb-4">
            <div className="text-xs text-green-400 uppercase tracking-wide mb-3 font-semibold">
              Next Pairing{nextMatch.pairing_label ? ` — ${nextMatch.pairing_label}` : ''}
            </div>
            <div className="grid grid-cols-5 gap-2 items-center mb-4">
              <div className="col-span-2 p-3 rounded-lg bg-blue-900/30 border border-blue-800">
                <div className="text-xs text-blue-400 font-bold mb-0.5">Blue</div>
                <div className="text-white font-semibold text-sm">
                  {nextMatch.blue_first ? `${nextMatch.blue_first} ${nextMatch.blue_last}` : 'TBD'}
                </div>
                {nextMatch.blue_bib != null && (
                  <div className="text-xs text-slate-500 mt-0.5">Bib {nextMatch.blue_bib}</div>
                )}
              </div>
              <div className="text-center text-slate-600 font-bold text-sm">vs</div>
              <div className="col-span-2 p-3 rounded-lg bg-red-900/30 border border-red-800">
                <div className="text-xs text-red-400 font-bold mb-0.5">Red</div>
                <div className="text-white font-semibold text-sm">
                  {nextMatch.red_first ? `${nextMatch.red_first} ${nextMatch.red_last}` : 'TBD'}
                </div>
                {nextMatch.red_bib != null && (
                  <div className="text-xs text-slate-500 mt-0.5">Bib {nextMatch.red_bib}</div>
                )}
              </div>
            </div>
            <button
              onClick={startNextRun}
              disabled={startingNext}
              className="w-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 text-white font-bold text-lg py-4 rounded-xl transition-colors"
            >
              {startingNext ? 'Starting...' : 'Start Run'}
            </button>
          </div>
        )}

        {/* Active match — landscape two-column layout */}
        {activeMatch && (
          <>
            {/* Full-width athlete bar */}
            <div className="bg-slate-800 rounded-2xl px-5 py-3 border border-slate-700 mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-blue-400 font-semibold uppercase tracking-wide">Blue</span>
                  <span className="text-xl font-bold text-white">
                    {activeMatch.blue_first} {activeMatch.blue_last}
                  </span>
                  {activeMatch.blue_bib && (
                    <span className="text-sm text-slate-400 font-mono">#{activeMatch.blue_bib}</span>
                  )}
                </div>
                <div className="text-center px-4">
                  <div className="text-slate-600 font-bold text-sm">vs</div>
                  {activeMatch.pairing_label && (
                    <div className="text-xs font-bold text-slate-400">{activeMatch.pairing_label}</div>
                  )}
                  <div className="text-xs text-slate-500">
                    Round {activeMatch.bracket_round} &middot; Pos {activeMatch.bracket_position}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {activeMatch.red_bib && (
                    <span className="text-sm text-slate-400 font-mono">#{activeMatch.red_bib}</span>
                  )}
                  <span className="text-xl font-bold text-white">
                    {activeMatch.red_first} {activeMatch.red_last}
                  </span>
                  <span className="text-xs text-red-400 font-semibold uppercase tracking-wide">Red</span>
                </div>
              </div>
            </div>

            {/* Two-column grid */}
            <div className="grid grid-cols-[1.5fr_1fr] gap-4 items-start">

              {/* ── LEFT COLUMN: Judge Scores ─────────────────────────── */}
              <div className="bg-slate-900 rounded-2xl p-5 border border-slate-700 space-y-3">
                <div className="text-xs text-slate-400 uppercase tracking-wide font-semibold">
                  Judge Scores
                </div>
                {judgePoints.length === 0 && (
                  <div className="text-slate-600 text-sm">No scores submitted yet.</div>
                )}
                {judgePoints.map(p => {
                  const isConfirming = confirmReject?.judgeNumber === p.judge_number
                  return (
                    <div key={p.judge_number}>
                      {!isConfirming && (
                        <div className="flex items-center justify-between py-2">
                          <div className="flex items-center gap-4">
                            <span className="text-xs text-slate-500 w-28">Judge {p.judge_number}{p.judge_number <= 2 ? ' (Turns)' : p.judge_number === 3 ? ' (Air)' : p.judge_number === 4 ? ' (Time)' : ' (Overall)'}</span>
                            {p.time_tied === 1 ? (
                              <span className="font-bold text-amber-400 text-lg">Time Tied</span>
                            ) : (
                              <div className="flex items-center gap-3">
                                <span className="font-mono font-bold text-blue-400 text-lg">{p.blue_points}</span>
                                <span className="text-slate-600">/</span>
                                <span className="font-mono font-bold text-red-400 text-lg">{p.red_points}</span>
                              </div>
                            )}
                          </div>
                          {!matchComplete && (
                            <button
                              onClick={() => { setConfirmReject({ judgeNumber: p.judge_number, bluePoints: p.blue_points, redPoints: p.red_points }); setError(''); setStatusMsg('') }}
                              className="text-xs px-3 py-1.5 rounded-lg bg-red-900/30 text-red-400 border border-red-800 hover:bg-red-900/60 active:bg-red-900/80 font-semibold transition-colors"
                            >
                              Reject
                            </button>
                          )}
                        </div>
                      )}

                      {/* Inline reject confirmation */}
                      {isConfirming && (
                        <div className="rounded-xl border border-red-700 bg-red-900/20 px-4 py-3 space-y-3">
                          <div className="text-sm text-red-300 font-semibold">Reject this score?</div>
                          <div className="text-sm text-slate-300">
                            Judge {p.judge_number}: {p.time_tied === 1
                              ? <span className="font-bold text-amber-400">Time Tied</span>
                              : <><span className="font-mono font-bold text-blue-400">{p.blue_points}</span> / <span className="font-mono font-bold text-red-400">{p.red_points}</span></>
                            }
                          </div>
                          {confirmReject?.judgeNumber === 4 && (
                            <p className="text-xs text-amber-400 font-semibold">
                              Warning: Rejecting the Time Judge will also clear the Overall Judge's score. Both must rescore.
                            </p>
                          )}
                          <p className="text-xs text-red-400">
                            The judge will be prompted to resubmit their point split.
                          </p>
                          <div className="flex gap-3">
                            <button
                              onClick={executeReject}
                              disabled={rejecting}
                              className="flex-1 bg-red-600 hover:bg-red-500 active:bg-red-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl transition-colors text-sm"
                            >
                              {rejecting ? 'Rejecting...' : 'Confirm Reject'}
                            </button>
                            <button
                              onClick={() => setConfirmReject(null)}
                              disabled={rejecting}
                              className="flex-1 bg-slate-700 hover:bg-slate-600 active:bg-slate-500 disabled:opacity-50 text-slate-200 font-bold py-2.5 rounded-xl transition-colors text-sm"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* ── RIGHT COLUMN: Result & Actions ────────────────────── */}
              <div className="space-y-4">

                {/* Running totals / Final result */}
                {pointResult && (
                  <div className={`rounded-2xl p-5 border ${hjPending ? 'border-amber-700 bg-amber-900/10' : hasWinner ? 'border-green-800 bg-green-900/10' : 'border-blue-800 bg-blue-900/10'}`}>
                    <div className="text-xs text-slate-400 uppercase tracking-wide mb-3 font-semibold">
                      {hjPending ? 'Awaiting Approval' : hasWinner ? 'Final Result' : 'Running Totals'}
                      {pointResult.timeTied && <span className="ml-2 text-amber-400 normal-case">(Time Tied &mdash; max 19 pts)</span>}
                    </div>
                    <div className="grid grid-cols-2 gap-4 mb-3">
                      <div className="text-center">
                        <div className="text-xs text-blue-400 mb-1">Blue</div>
                        <div className={`font-mono font-bold text-3xl hc-score ${hasWinner && pointResult.winner === 'blue' ? 'text-blue-300' : 'text-slate-200'}`}>
                          {pointResult.blueTotal}
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-red-400 mb-1">Red</div>
                        <div className={`font-mono font-bold text-3xl hc-score ${hasWinner && pointResult.winner === 'red' ? 'text-red-300' : 'text-slate-200'}`}>
                          {pointResult.redTotal}
                        </div>
                      </div>
                    </div>
                    <div className="text-center text-xs text-slate-500">
                      {pointResult.judgeCount} judge{pointResult.judgeCount !== 1 ? 's' : ''} scored
                    </div>
                    {hasWinner && (
                      <div className="text-center mt-2">
                        <span className={`text-sm font-bold ${pointResult.winner === 'blue' ? 'text-blue-400' : 'text-red-400'}`}>
                          {pointResult.winner === 'blue'
                            ? `${activeMatch.blue_first} ${activeMatch.blue_last}`
                            : `${activeMatch.red_first} ${activeMatch.red_last}`
                          } wins
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Score status — judges pending */}
                {!pointResult && !matchComplete && (
                  <div className="rounded-2xl p-4 border border-slate-700 bg-slate-900">
                    <div className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-2">Score Status</div>
                    <div className="text-sm text-amber-400 font-semibold">
                      {judgePoints.length} / 5 judges scored
                    </div>
                  </div>
                )}

                {/* Accept and Submit Score button (HJ approval) */}
                {hjPending && (
                  <button
                    onClick={approveMatch}
                    disabled={approving}
                    className="w-full bg-green-600 hover:bg-green-500 active:bg-green-700 disabled:opacity-50 text-white font-bold text-xl py-5 rounded-2xl transition-colors"
                  >
                    {approving ? 'Submitting...' : 'Accept and Submit Score'}
                  </button>
                )}

                {/* DNS / DNF for match */}
                {!matchComplete && (
                  <div className="bg-slate-900 rounded-2xl p-4 border border-slate-700">
                    <div className="text-xs text-slate-400 uppercase tracking-wide mb-3 font-semibold">Set Match Status</div>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={async () => {
                          setSettingStatus(true); setError(''); setStatusMsg('')
                          try {
                            const winnerId = activeMatch.registration_id_red
                            const res = await fetch(`${API}/events/${eventId}/dual/${activeMatch.id}/winner`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ winner_registration_id: winnerId, loser_status: 'DNS' }),
                            })
                            if (!res.ok) throw new Error('Failed')
                            await fetch(`${API}/events/${eventId}/dual/active-match`, { method: 'DELETE' })
                            setStatusMsg('Blue DNS recorded.  Red advances.')
                            await loadMatch()
                          } catch (e) { setError(e.message) } finally { setSettingStatus(false) }
                        }}
                        disabled={settingStatus}
                        className="py-3 rounded-xl font-bold text-blue-400 bg-blue-900/30 hover:bg-blue-900/50 active:bg-blue-900/60 border border-blue-800 disabled:opacity-50 transition-colors text-sm"
                      >
                        Blue DNS
                      </button>
                      <button
                        onClick={async () => {
                          setSettingStatus(true); setError(''); setStatusMsg('')
                          try {
                            const winnerId = activeMatch.registration_id_blue
                            const res = await fetch(`${API}/events/${eventId}/dual/${activeMatch.id}/winner`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ winner_registration_id: winnerId, loser_status: 'DNS' }),
                            })
                            if (!res.ok) throw new Error('Failed')
                            await fetch(`${API}/events/${eventId}/dual/active-match`, { method: 'DELETE' })
                            setStatusMsg('Red DNS recorded.  Blue advances.')
                            await loadMatch()
                          } catch (e) { setError(e.message) } finally { setSettingStatus(false) }
                        }}
                        disabled={settingStatus}
                        className="py-3 rounded-xl font-bold text-red-400 bg-red-900/30 hover:bg-red-900/50 active:bg-red-900/60 border border-red-800 disabled:opacity-50 transition-colors text-sm"
                      >
                        Red DNS
                      </button>
                      <button
                        onClick={async () => {
                          setSettingStatus(true); setError(''); setStatusMsg('')
                          try {
                            const winnerId = activeMatch.registration_id_red
                            const res = await fetch(`${API}/events/${eventId}/dual/${activeMatch.id}/winner`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ winner_registration_id: winnerId, loser_status: 'DNF' }),
                            })
                            if (!res.ok) throw new Error('Failed')
                            await fetch(`${API}/events/${eventId}/dual/active-match`, { method: 'DELETE' })
                            setStatusMsg('Blue DNF recorded.  Red advances.')
                            await loadMatch()
                          } catch (e) { setError(e.message) } finally { setSettingStatus(false) }
                        }}
                        disabled={settingStatus}
                        className="py-3 rounded-xl font-bold text-blue-400 bg-blue-900/30 hover:bg-blue-900/50 active:bg-blue-900/60 border border-blue-800 disabled:opacity-50 transition-colors text-sm"
                      >
                        Blue DNF
                      </button>
                      <button
                        onClick={async () => {
                          setSettingStatus(true); setError(''); setStatusMsg('')
                          try {
                            const winnerId = activeMatch.registration_id_blue
                            const res = await fetch(`${API}/events/${eventId}/dual/${activeMatch.id}/winner`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ winner_registration_id: winnerId, loser_status: 'DNF' }),
                            })
                            if (!res.ok) throw new Error('Failed')
                            await fetch(`${API}/events/${eventId}/dual/active-match`, { method: 'DELETE' })
                            setStatusMsg('Red DNF recorded.  Blue advances.')
                            await loadMatch()
                          } catch (e) { setError(e.message) } finally { setSettingStatus(false) }
                        }}
                        disabled={settingStatus}
                        className="py-3 rounded-xl font-bold text-red-400 bg-red-900/30 hover:bg-red-900/50 active:bg-red-900/60 border border-red-800 disabled:opacity-50 transition-colors text-sm"
                      >
                        Red DNF
                      </button>
                    </div>
                    <p className="text-xs text-slate-600 mt-2 text-center">
                      Advances the opponent without requiring judge scores.
                    </p>
                  </div>
                )}

              </div>{/* end right column */}

            </div>{/* end two-column grid */}
          </>
        )}
      </div>
    </div>
  )
}

// ── Standard Mogul / Aerials Head Judge ───────────────────────────────────────

export default function HeadJudgeTablet() {
  const { meetId: rawMeetId, eventId: rawEventId } = useParams()
  const { eventId: rEvt, meetId: rMeet, loading: resolving } = useResolveIds({ event: rawEventId, meet: rawMeetId })
  const eventId = rEvt || rawEventId
  const meetId = rMeet || rawMeetId

  const [hc, toggleHc] = useHighContrast()
  const [activeRun,     setActiveRun]     = useState(null)
  const [eventCfg,      setEventCfg]      = useState(null)
  const [approving,     setApproving]     = useState(false)
  const [finalizing,    setFinalizing]    = useState(false)
  const [settingStatus, setSettingStatus] = useState(false)
  const [statusMsg,     setStatusMsg]     = useState('')
  const [error,         setError]         = useState('')
  // confirmReject: { scoreId, judgeName, scoreType, rawScore } | null
  const [confirmReject, setConfirmReject] = useState(null)
  const [rejecting,     setRejecting]     = useState(false)
  const [confirmTimeReject, setConfirmTimeReject] = useState(false)
  const [rejectingTime, setRejectingTime] = useState(false)
  const [pendingSince, setPendingSince]   = useState(null)
  const [pendingElapsed, setPendingElapsed] = useState(0)
  const [ageGroupTransition, setAgeGroupTransition] = useState(null)
  // v1.8.03: Run round review mode
  const [reviewMode,     setReviewMode]     = useState(null) // { run_number }
  const [reviewData,     setReviewData]     = useState([])
  const [reviewLoading,  setReviewLoading]  = useState(false)
  const [reviewAction,   setReviewAction]   = useState('')
  const reviewModeRef = useRef(null)
  const [nextUp, setNextUp] = useState(null)
  const [startingNext, setStartingNext] = useState(false)
  const [eventCompleted, setEventCompleted] = useState(false)
  const [finalReview, setFinalReview] = useState(null)
  const [eventFinalized, setEventFinalized] = useState(false)
  const wsRef   = useRef(null)
  const pollRef = useRef(null)
  const pendingTimerRef = useRef(null)

  // ── HJ pending chime and timer ────────────────────────────────────────────
  useEffect(() => {
    const isNowPending = activeRun?.hj_pending === 1
    if (isNowPending && !pendingSince) {
      setPendingSince(Date.now())
      setPendingElapsed(0)
      // Play chime to alert HJ
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)()
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.frequency.value = 880
        osc.type = 'sine'
        gain.gain.value = 0.3
        osc.start()
        osc.stop(ctx.currentTime + 0.15)
        setTimeout(() => {
          const osc2 = ctx.createOscillator()
          const gain2 = ctx.createGain()
          osc2.connect(gain2)
          gain2.connect(ctx.destination)
          osc2.frequency.value = 1100
          osc2.type = 'sine'
          gain2.gain.value = 0.3
          osc2.start()
          osc2.stop(ctx.currentTime + 0.2)
        }, 180)
      } catch (_) {}
      // Vibrate if supported
      try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]) } catch (_) {}
    } else if (!isNowPending) {
      setPendingSince(null)
      setPendingElapsed(0)
    }
  }, [activeRun?.hj_pending, activeRun?.id])

  useEffect(() => {
    if (pendingSince) {
      pendingTimerRef.current = setInterval(() => {
        setPendingElapsed(Math.floor((Date.now() - pendingSince) / 1000))
      }, 1000)
      return () => clearInterval(pendingTimerRef.current)
    } else {
      if (pendingTimerRef.current) clearInterval(pendingTimerRef.current)
    }
  }, [pendingSince])

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadActive = async () => {
    try {
      const r = await fetch(`${API}/events/${eventId}/runs/active`)
      const run = await r.json()
      if (run?.event_completed) { setEventCompleted(true); setActiveRun(null); return }
      setActiveRun(run || null)
    } catch {}
  }

  const fetchNextUp = async () => {
    try {
      const r = await fetch(`${API}/events/${eventId}/runs/next-up`)
      const data = await r.json()
      setNextUp(data?.id ? data : null)
    } catch { setNextUp(null) }
  }

  const startNextRun = async () => {
    if (!nextUp) return
    setStartingNext(true); setError(''); setStatusMsg('')
    try {
      const res = await fetch(`${API}/events/${eventId}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registration_id: nextUp.id, run_number: nextUp.run_number || 1, round: 'qualification' }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to start run')
      }
      setStatusMsg('Run started.')
      setNextUp(null)
      await loadActive()
    } catch (e) {
      setError('Start run failed: ' + e.message)
    } finally { setStartingNext(false) }
  }

  useEffect(() => {
    if (resolving) return
    fetch(`${API}/meets/${meetId}/events/${eventId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setEventCfg(d) })
      .catch(() => {})
  }, [eventId, meetId, resolving])

  // v1.9.00: Check for run round review status (phase-aware labels)
  // Uses reviewModeRef to avoid stale closure in polling interval
  const checkReviewStatus = async () => {
    try {
      const r = await fetch(`${API}/events/${eventId}/runs/round-status`)
      if (!r.ok) return
      const statuses = await r.json()
      const inReview = statuses.find(s => s.status === 'hj_review')
      const currentReview = reviewModeRef.current
      if (inReview && (!currentReview || currentReview.run_number !== inReview.run_number)) {
        const newMode = { run_number: inReview.run_number, name: inReview.name || `Run ${inReview.run_number}` }
        setReviewMode(newMode)
        reviewModeRef.current = newMode
        setReviewLoading(true)
        try {
          const rr = await fetch(`${API}/events/${eventId}/runs/round-review/${inReview.run_number}`)
          if (rr.ok) setReviewData(await rr.json())
        } catch {}
        setReviewLoading(false)
      } else if (!inReview && currentReview) {
        setReviewMode(null)
        reviewModeRef.current = null
        setReviewData([])
      }
    } catch {}
  }

  useEffect(() => {
    if (resolving) return
    loadActive()
    checkReviewStatus()
    fetchNextUp()
    pollRef.current = setInterval(() => { loadActive(); checkReviewStatus(); fetchNextUp() }, 3000)
    return () => clearInterval(pollRef.current)
  }, [eventId, resolving])

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}`)
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.eventId === eventId && ['score_update', 'run_updated', 'run_started'].includes(msg.type)) {
          loadActive()
          fetchNextUp()
          if (msg.data?.age_group_transition) {
            setAgeGroupTransition(msg.data.age_group_transition)
            setTimeout(() => setAgeGroupTransition(null), 15000)
          }
        }
        if (msg.eventId === eventId && msg.type === 'run_round_status') {
          if (msg.data?.event_completed) setEventCompleted(true)
          checkReviewStatus()
        }
      } catch {}
    }
    wsRef.current = ws
    return () => ws.close()
  }, [eventId])

  // ── Fetch final results when event is completed ───────────────────────────
  useEffect(() => {
    if (!eventCompleted || finalReview) return
    const fetchFinal = async () => {
      try {
        const r = await fetch(`${API}/events/${eventId}/phases/results`)
        if (r.ok) {
          const data = await r.json()
          setFinalReview(data)
        }
      } catch {}
    }
    fetchFinal()
  }, [eventCompleted])

  // ── Actions ───────────────────────────────────────────────────────────────

  const approveScore = async () => {
    if (!activeRun || !activeRun.hj_pending) return
    setApproving(true); setError(''); setStatusMsg('')
    try {
      const res = await fetch(`${API}/events/${eventId}/runs/${activeRun.id}/approve`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Server error ${res.status}`)
      }
      setStatusMsg('Score approved and published.')
      await loadActive()
    } catch (e) {
      setError('Approval failed: ' + e.message)
    } finally { setApproving(false) }
  }

  const finalizeScore = async () => {
    if (!activeRun) return
    setFinalizing(true); setError(''); setStatusMsg('')
    try {
      const res = await fetch(`${API}/events/${eventId}/runs/${activeRun.id}/approve`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Server error ${res.status}`)
      }
      setStatusMsg('Score finalized and published.')
      await loadActive()
    } catch (e) {
      setError(e.message)
    } finally { setFinalizing(false) }
  }

  // Note: confirmation is handled by RunStatusGrid's modal (preserves the
  // v1.16.16 confirm-dialog UX). No window.confirm here to avoid duplicate prompts.
  const setRunStatus = async (run_status) => {
    if (!activeRun) return
    setSettingStatus(true); setError(''); setStatusMsg('')
    try {
      const res = await fetch(`${API}/events/${eventId}/runs/${activeRun.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_status }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Server error ${res.status}`)
      }
      setStatusMsg(`${run_status} recorded.`)
      await loadActive()
    } catch (e) {
      setError('Could not set status: ' + e.message)
    } finally { setSettingStatus(false) }
  }

  const initiateReject = (score) => {
    setConfirmReject({
      scoreId:   score.id,
      judgeId:   score.judge_id,
      judgeName: score.name || score.role,
      scoreType: score.score_type,
      rawScore:  score.raw_score,
    })
    setError('')
    setStatusMsg('')
  }

  const cancelReject = () => setConfirmReject(null)

  const executeReject = async () => {
    if (!confirmReject || !activeRun) return
    setRejecting(true); setError('')
    try {
      const res = await fetch(
        `${API}/events/${eventId}/runs/${activeRun.id}/scores/${confirmReject.scoreId}/reject`,
        { method: 'POST' }
      )
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Rejection failed')
      }
      const label = `${confirmReject.judgeName} -- ${SCORE_LABELS[confirmReject.scoreType] || confirmReject.scoreType} ${fmt(confirmReject.rawScore)}`
      setStatusMsg(`Score rejected: ${label}.  Run is open for rescoring.`)
      setConfirmReject(null)
      await loadActive()
    } catch (e) {
      setError('Rejection failed: ' + e.message)
    } finally { setRejecting(false) }
  }

  const executeTimeReject = async () => {
    if (!activeRun) return
    setRejectingTime(true); setError('')
    try {
      const res = await fetch(
        `${API}/events/${eventId}/runs/${activeRun.id}/time`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Time rejection failed')
      }
      setStatusMsg('Finish time rejected.  Timekeeper may resubmit.')
      setConfirmTimeReject(false)
      await loadActive()
    } catch (e) {
      setError('Time rejection failed: ' + e.message)
    } finally { setRejectingTime(false) }
  }

  // ── Score breakdown helpers ───────────────────────────────────────────────

  const submitted = activeRun?.submitted || []

  const byRole = {}
  for (const s of submitted) {
    if (!byRole[s.role]) byRole[s.role] = []
    byRole[s.role].push(s)
  }

  const tlRoles  = Object.entries(byRole).filter(([r]) => /^TL/.test(r)  || (eventCfg?.discipline === 'aerials' && /^Form/.test(r)))
  const airRoles = Object.entries(byRole).filter(([r]) => /^Air/.test(r) || (eventCfg?.discipline === 'aerials' && /^(AirJudge|Landing)/.test(r)))

  // v1.18.00 — Aerials v2 detection for the grid panel.
  const isAerialsV2 = eventCfg?.discipline === 'aerials' && eventCfg?.aerials_panel_size != null
  const aeJudgeRoles = isAerialsV2
    ? Object.entries(byRole).filter(([r]) => /^AeJudge/.test(r)).sort((a, b) => {
        const an = parseInt((a[0].match(/\d+$/) || ['99'])[0])
        const bn = parseInt((b[0].match(/\d+$/) || ['99'])[0])
        return an - bn
      })
    : []

  const hasComputed = activeRun && (activeRun.hj_pending || activeRun.status === 'complete') && activeRun.total_score != null
  const awaitingApproval = activeRun?.hj_pending === 1

  // ── Client-side running score computation ─────────────────────────────────
  const runningScore = useMemo(() => {
    if (!activeRun || submitted.length === 0) return null

    // Turns: filter TL role scores
    const numTl = eventCfg?.num_tl_judges || 3
    const tlScores = submitted.filter(s => s.score_type === 'turns' && /^TL/.test(s.role)).map(s => Number(s.raw_score))
    let turnsVal = null
    if (tlScores.length > 0) {
      if (tlScores.length <= 3) {
        turnsVal = tlScores.reduce((a, b) => a + b, 0)
      } else {
        const sorted = [...tlScores].sort((a, b) => a - b)
        const trimmed = sorted.slice(1, sorted.length - 1)
        turnsVal = trimmed.reduce((a, b) => a + b, 0)
      }
      // Scale up for non-standard panels (e.g. 2 judges × 1.5 = 60 max)
      if (numTl < 3) turnsVal = (3 / numTl) * turnsVal
      turnsVal = Math.round(turnsVal * 100) / 100
    }

    // Air
    const numJumps = eventCfg?.num_jumps || 2
    const dd1 = activeRun.jump1_dd
    const dd2 = activeRun.jump2_dd
    const a1Scores = submitted.filter(s => s.score_type === 'air_jump1').map(s => Number(s.raw_score))
    const a2Scores = submitted.filter(s => s.score_type === 'air_jump2').map(s => Number(s.raw_score))
    let airVal = null
    if (numJumps === 1) {
      if (dd1 != null && a1Scores.length > 0) {
        const avg1 = a1Scores.reduce((a, b) => a + b, 0) / a1Scores.length
        airVal = Math.round(Math.min(avg1 * dd1 * 2, 20.0) * 100) / 100
      }
    } else {
      if (dd1 != null && dd2 != null && a1Scores.length > 0 && a2Scores.length > 0) {
        const avg1 = a1Scores.reduce((a, b) => a + b, 0) / a1Scores.length
        const avg2 = a2Scores.reduce((a, b) => a + b, 0) / a2Scores.length
        const j1 = Math.round(avg1 * dd1 * 100) / 100
        const j2 = Math.round(avg2 * dd2 * 100) / 100
        airVal = Math.round(Math.min(j1 + j2, 20.0) * 100) / 100
      }
    }

    // Speed
    const hasSpeed = eventCfg?.has_speed
    let speedVal = null
    if (hasSpeed && activeRun.run_time && activeRun.run_time != -1 && eventCfg?.pace_time) {
      const raw = 48 - 32 * (activeRun.run_time / eventCfg.pace_time)
      speedVal = Math.round(Math.max(0, Math.min(raw, 20)) * 100) / 100
    } else if (hasSpeed && activeRun.run_time == -1) {
      speedVal = 0
    }

    const total = Math.round(((turnsVal || 0) + (airVal || 0) + (speedVal || 0)) * 100) / 100

    return { turnsVal, airVal, speedVal, hasSpeed, total }
  }, [activeRun, submitted, eventCfg])

  // ── Render ────────────────────────────────────────────────────────────────

  // Dual mogul: use completely different view
  if (eventCfg && eventCfg.discipline === 'dual_mogul') {
    return <DualHeadJudgeView meetId={meetId} eventId={eventId} hc={hc} toggleHc={toggleHc} />
  }

  // v1.16.13: Event completed — show final results + finalize button
  if (eventCompleted) {
    if (eventFinalized) return (
      <div className={`tablet-root min-h-screen flex items-center justify-center ${hc ? 'hc' : ''}`} data-hc={hc ? '1' : '0'}>
        <div className="text-center">
          <div className="tablet-display" style={{ fontSize: 56, color: 'var(--tablet-green2)', marginBottom: 12 }}>Event Completed</div>
          <div className="text-xl" style={{ color: 'var(--tablet-dim)' }}>Thank You for Your Work</div>
        </div>
      </div>
    )

    const finalizeEvent = async () => {
      try {
        const r = await fetch(`${API}/events/${eventId}/finalize`, { method: 'POST' })
        if (r.ok) setEventFinalized(true)
      } catch {}
    }

    return (
      <div className={`tablet-root min-h-screen ${hc ? 'hc' : ''}`} data-hc={hc ? '1' : '0'}>
        <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
          <div>
            <div className="font-bold text-white text-lg">Head Judge — Final Review</div>
            <div className="text-xs text-slate-400"><span className="text-white">Stick</span><span style={{ color: '#EF4444' }}>It</span> System</div>
          </div>
          <HCModeButton hc={hc} onToggle={toggleHc} />
        </div>
        <div className="p-4 max-w-4xl mx-auto">
          <div className="text-center mb-4">
            <div className="text-emerald-400 text-lg font-semibold">All Runs Complete</div>
            <div className="text-slate-400 text-sm">Review final results and finalize the event</div>
          </div>
          {finalReview && finalReview.results ? (
            <div className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-800 text-slate-400 text-xs uppercase tracking-wider">
                    <th className="px-3 py-2 text-left w-12">Place</th>
                    <th className="px-3 py-2 text-left w-12">Bib</th>
                    <th className="px-3 py-2 text-left">Athlete</th>
                    {finalReview.phases && finalReview.phases.map(p => (
                      <th key={p.run_number} className="px-3 py-2 text-right">{p.label}</th>
                    ))}
                    <th className="px-3 py-2 text-right font-bold text-white">Best Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {finalReview.results.map((r, i) => (
                    <tr key={r.registration_id || i} className={r.rank <= 3 ? 'bg-slate-800/40' : ''}>
                      <td className="px-3 py-2 font-bold text-white">{r.rank}</td>
                      <td className="px-3 py-2 font-mono text-slate-300">{r.bib_number}</td>
                      <td className="px-3 py-2 text-white">{r.last_name}, {r.first_name}</td>
                      {finalReview.phases && finalReview.phases.map(p => {
                        const runScore = r.runs && r.runs[p.run_number]
                        const status = runScore?.run_status
                        return (
                          <td key={p.run_number} className="px-3 py-2 text-right font-mono text-slate-300">
                            {status ? status : runScore?.total_score != null ? Number(runScore.total_score).toFixed(2) : '–'}
                          </td>
                        )
                      })}
                      <td className="px-3 py-2 text-right font-mono font-bold text-emerald-400">
                        {r.run_status ? r.run_status : r.best_score != null ? Number(r.best_score).toFixed(2) : '–'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center text-slate-500 py-8">Loading results...</div>
          )}
          <div className="space-y-3">
            <button
              onClick={finalizeEvent}
              className="w-full bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-bold text-xl py-5 rounded-2xl transition-colors"
            >
              Finalize Event
            </button>
            <button
              onClick={async () => {
                try {
                  const r = await fetch(`${API}/events/${eventId}/return-to-scoring`, { method: 'POST' })
                  if (r.ok) {
                    setEventCompleted(false)
                    setFinalReview(null)
                    setReviewMode(null)
                    reviewModeRef.current = null
                    loadActive()
                    checkReviewStatus()
                    fetchNextUp()
                  }
                } catch {}
              }}
              className="w-full bg-red-700 hover:bg-red-600 active:bg-red-800 text-white font-bold text-lg py-4 rounded-2xl transition-colors"
            >
              Return to Scoring
            </button>
          </div>
        </div>
      </div>
    )
  }

  // v1.8.03: Run Round Review mode -- replaces normal view when a run is sent for HJ review
  if (reviewMode) {
    const approveRound = async () => {
      setReviewAction('approving')
      try {
        const r = await fetch(`${API}/events/${eventId}/runs/round-status/${reviewMode.run_number}/approve`, { method: 'POST' })
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Failed')
        setReviewMode(null)
        setReviewData([])
      } catch (e) { setError(e.message) }
      setReviewAction('')
    }
    const returnRound = async () => {
      setReviewAction('returning')
      try {
        const r = await fetch(`${API}/events/${eventId}/runs/round-status/${reviewMode.run_number}/return`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Run returned for review by Head Judge' }),
        })
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Failed')
        setReviewMode(null)
        setReviewData([])
      } catch (e) { setError(e.message) }
      setReviewAction('')
    }

    return (
      <div className={`tablet-root min-h-screen ${hc ? 'hc' : ''}`} data-hc={hc ? '1' : '0'}>
        <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
          <div>
            <div className="font-bold text-white text-lg">Head Judge — {reviewMode.name || `Run ${reviewMode.run_number}`} Review</div>
            <div className="text-xs text-slate-400"><span className="text-white">Stick</span><span style={{ color: '#EF4444' }}>It</span> System</div>
          </div>
          <div className="flex items-center gap-2">
            <HCModeButton hc={hc} onToggle={toggleHc} />
            <div className="text-xs px-3 py-1.5 rounded-full bg-amber-900/50 text-amber-400 font-semibold animate-pulse">
              Review Pending
            </div>
          </div>
        </div>
        <div className="p-4">
          {error && (
            <div className="bg-red-900/30 border border-red-800 text-red-400 rounded-xl px-4 py-3 text-sm mb-4">{error}</div>
          )}
          {reviewLoading ? (
            <div className="text-slate-500 text-center py-12">Loading review data...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-800 text-slate-300 text-xs uppercase tracking-wide">
                    <th className="px-3 py-2 text-left">Place</th>
                    <th className="px-3 py-2 text-left">Athlete</th>
                    <th className="px-3 py-2 text-center">Bib</th>
                    {Array.from({ length: eventCfg?.num_tl_judges || 3 }, (_, i) => (
                      <th key={`tl${i}`} className="px-3 py-2 text-center">TL{i + 1}</th>
                    ))}
                    {Array.from({ length: eventCfg?.num_air_judges || 2 }, (_, i) => (
                      <th key={`air${i}`} className="px-3 py-2 text-center">Air{i + 1}</th>
                    ))}
                    {eventCfg?.has_speed ? <th className="px-3 py-2 text-center">Time Pts</th> : null}
                    {eventCfg?.has_speed ? <th className="px-3 py-2 text-center">Time</th> : null}
                    <th className="px-3 py-2 text-center">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewData.map((row, idx) => (
                    <tr key={row.run_id} className={idx % 2 === 0 ? 'bg-slate-900' : 'bg-slate-900/50'}>
                      <td className="px-3 py-2 text-slate-400 font-mono">{row.run_status ? row.run_status : row.place}</td>
                      <td className="px-3 py-2 text-white">{row.last_name}, {row.first_name}</td>
                      <td className="px-3 py-2 text-center text-slate-300 font-mono">{row.bib_number || '--'}</td>
                      {Array.from({ length: eventCfg?.num_tl_judges || 3 }, (_, i) => {
                        const tlScore = row.tl_scores.find(s => s.role === `TL${i + 1}`)
                        return <td key={`tl${i}`} className="px-3 py-2 text-center font-mono text-slate-300">{tlScore ? Number(tlScore.raw_score).toFixed(1) : '--'}</td>
                      })}
                      {Array.from({ length: eventCfg?.num_air_judges || 2 }, (_, i) => {
                        const airScores = row.air_scores.filter(s => s.role === `Air${i + 1}`)
                        const airTotal = airScores.reduce((sum, s) => sum + (s.raw_score || 0), 0)
                        return <td key={`air${i}`} className="px-3 py-2 text-center font-mono text-slate-300">{airScores.length > 0 ? airTotal.toFixed(1) : '--'}</td>
                      })}
                      {eventCfg?.has_speed ? <td className="px-3 py-2 text-center font-mono text-slate-300">{row.speed_score != null ? Number(row.speed_score).toFixed(2) : '--'}</td> : null}
                      {eventCfg?.has_speed ? <td className="px-3 py-2 text-center font-mono text-slate-300">{row.run_time != null ? (row.run_time == -1 ? 'NT' : Number(row.run_time).toFixed(2)) : '--'}</td> : null}
                      <td className="px-3 py-2 text-center font-mono font-bold text-white">{row.total_score != null ? Number(row.total_score).toFixed(2) : '--'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Action buttons at bottom */}
          <div className="mt-6 flex flex-col gap-3">
            <button
              onClick={approveRound}
              disabled={!!reviewAction}
              className="w-full bg-emerald-700 hover:bg-emerald-600 active:bg-emerald-800 disabled:opacity-50 text-white font-bold text-lg py-4 rounded-2xl transition-colors"
            >
              {reviewAction === 'approving' ? 'Approving...' : 'Approve and Finalize Run'}
            </button>
            <button
              onClick={returnRound}
              disabled={!!reviewAction}
              className="w-full bg-amber-700 hover:bg-amber-600 active:bg-amber-800 disabled:opacity-50 text-white font-bold text-lg py-4 rounded-2xl transition-colors"
            >
              {reviewAction === 'returning' ? 'Returning...' : 'Return to Scoring for Review'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`tablet-root min-h-screen ${hc ? 'hc' : ''}`} data-hc={hc ? '1' : '0'}>

      <div className="p-4 max-w-7xl mx-auto">
        {/* Athlete bar / header */}
        {activeRun ? (
          <AthleteBar
            bib={activeRun.is_forerunner ? '' : activeRun.bib_number}
            name={activeRun.is_forerunner
              ? 'FORERUNNER'
              : `${activeRun.last_name?.toUpperCase() || ''}${activeRun.first_name ? `, ${activeRun.first_name}` : ''}`}
            meta={[
              activeRun.is_forerunner ? <span style={{ color: '#fb923c' }}>FORERUNNER (Judge Test)</span> : 'NOW SCORING',
              activeRun.run_position != null && activeRun.total_runners != null
                ? <>Athlete <strong>{activeRun.run_position}</strong> of <strong>{activeRun.total_runners}</strong></>
                : null,
              !activeRun.is_forerunner ? <>Run <strong>#{activeRun.run_number}</strong></> : null,
            ].filter(Boolean)}
            right={
              <>
                <span
                  className="tablet-display"
                  style={{ fontSize: 22, letterSpacing: 1, color: 'var(--tablet-text)' }}
                >
                  Head Judge
                </span>
                <HCModeButton hc={hc} onToggle={toggleHc} />
              </>
            }
            className="mb-4"
          />
        ) : (
          <div className="tablet-card flex items-center justify-between mb-4" style={{ padding: '14px 24px' }}>
            <span className="tablet-display" style={{ fontSize: 22, letterSpacing: 1 }}>HEAD JUDGE</span>
            <HCModeButton hc={hc} onToggle={toggleHc} />
          </div>
        )}

        {/* Status/error messages - full width */}
        {statusMsg && (
          <div className="bg-green-900/30 border border-green-800 text-green-400 rounded-xl px-4 py-3 text-sm font-medium mb-4">
            {statusMsg}
          </div>
        )}
        {error && (
          <div className="bg-red-900/30 border border-red-800 text-red-400 rounded-xl px-4 py-3 text-sm mb-4">
            {error}
          </div>
        )}

        {ageGroupTransition && (
          <div
            onClick={() => setAgeGroupTransition(null)}
            className="mb-4 bg-amber-600 text-black font-bold text-center text-lg py-4 px-6 rounded-2xl cursor-pointer animate-pulse"
          >
            {ageGroupTransition.completed} group complete {ageGroupTransition.next ? `\u2014 ${ageGroupTransition.next} up next` : '\u2014 All groups complete'}
          </div>
        )}

        {/* No active run */}
        {!activeRun && (
          <div className="bg-slate-800 rounded-2xl p-8 text-center border border-slate-700 space-y-4">
            <div className="text-4xl mb-3 text-slate-500">--</div>
            <div className="text-slate-400 text-lg">Waiting for next athlete...</div>
            {nextUp && (
              <div className="mt-3 border-t border-slate-700 pt-4 space-y-3">
                <div className="text-xs text-slate-500 uppercase tracking-wide">Next Up{nextUp.phase_label ? ` — ${nextUp.phase_label}` : ''}</div>
                <div className="text-xl font-bold text-white">{nextUp.last_name}, {nextUp.first_name}</div>
                <div className="text-sm text-slate-400">Bib #{nextUp.bib_number} {nextUp.run_order != null && <span className="ml-2">Order: {nextUp.run_order}</span>}</div>
                <div className="flex gap-2">
                  <button
                    onClick={startNextRun}
                    disabled={startingNext}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-lg py-4 rounded-2xl transition-colors"
                  >
                    {startingNext ? 'Starting...' : `Start ${nextUp.phase_label || 'Run'}`}
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
                        await loadActive();
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

        {/* 3-column status bar (slide 05): T&L count · Air count · Time */}
        {activeRun && eventCfg && (() => {
          const isAerials = eventCfg.discipline === 'aerials'
          const tlCount   = submitted.filter(s => s.score_type === 'turns').length
          const a1Count   = submitted.filter(s => s.score_type === 'air_jump1').length
          const a2Count   = submitted.filter(s => s.score_type === 'air_jump2').length
          const formCount = submitted.filter(s => s.score_type === 'form').length
          const landCount = submitted.filter(s => s.score_type === 'landing').length
          const needTL    = eventCfg.num_tl_judges || 3
          const needAir   = eventCfg.num_air_judges || 2
          const nJumps    = eventCfg.num_jumps || 2
          const hasTime   = activeRun?.run_time != null
          const needSpeed = !isAerials && !!eventCfg.has_speed

          let col1Done, col2Done, speedDone
          let col1Label, col1Text, col2Label, col2Text, speedText

          if (isAerials) {
            const needForm = eventCfg.num_tl_judges || 1
            const needLand = eventCfg.num_air_judges || 1
            col1Done  = formCount >= needForm
            col1Label = 'FORM JUDGES'
            col1Text  = `${formCount} / ${needForm}`
            col2Done  = a1Count >= needAir && a2Count >= needAir && landCount >= needLand
            col2Label = 'AIR / LANDING'
            col2Text  = `${Math.min(a1Count, a2Count)} air, ${landCount} land / ${needAir}`
            speedDone = true
            speedText = 'N/A'
          } else {
            col1Done  = tlCount >= needTL
            col1Label = 'T&L JUDGES'
            col1Text  = `${tlCount} / ${needTL}`
            col2Done  = nJumps === 1 ? a1Count >= needAir : (a1Count >= needAir && a2Count >= needAir)
            col2Label = 'AIR JUDGES'
            col2Text  = nJumps === 1 ? `${a1Count} / ${needAir}` : `${Math.min(a1Count, a2Count)} / ${needAir}`
            speedDone = !needSpeed || hasTime
            speedText = !needSpeed ? 'N/A' : hasTime ? 'IN ✓' : 'PENDING'
          }
          return (
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="tablet-card flex items-center gap-3" style={{ padding: 14 }}>
                <StatusSquare active={col1Done} />
                <div>
                  <div className="text-xs uppercase font-bold" style={{ color: 'var(--tablet-dim)', letterSpacing: 1.5 }}>{col1Label}</div>
                  <div className="tablet-display" style={{ fontSize: 24, color: col1Done ? 'var(--tablet-green2)' : 'var(--tablet-amber2)' }}>{col1Text}</div>
                </div>
              </div>
              <div className="tablet-card flex items-center gap-3" style={{ padding: 14 }}>
                <StatusSquare active={col2Done} />
                <div>
                  <div className="text-xs uppercase font-bold" style={{ color: 'var(--tablet-dim)', letterSpacing: 1.5 }}>{col2Label}</div>
                  <div className="tablet-display" style={{ fontSize: 24, color: col2Done ? 'var(--tablet-green2)' : 'var(--tablet-amber2)' }}>{col2Text}</div>
                </div>
              </div>
              <div className="tablet-card flex items-center gap-3" style={{ padding: 14 }}>
                <StatusSquare active={speedDone} />
                <div>
                  <div className="text-xs uppercase font-bold" style={{ color: 'var(--tablet-dim)', letterSpacing: 1.5 }}>TIME</div>
                  <div className="tablet-display" style={{ fontSize: 24, color: speedDone ? 'var(--tablet-green2)' : 'var(--tablet-amber2)' }}>{speedText}</div>
                </div>
              </div>
            </div>
          )
        })()}

        {/* v1.18.00 — Aerials v2 per-judge-per-jump grid */}
        {activeRun && isAerialsV2 && (
          <div className="bg-slate-900 rounded-2xl p-5 border border-slate-700 mb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-slate-400 uppercase tracking-wide font-semibold">Aerials Scoring Panel</div>
              <div className="text-xs text-slate-500">
                Panel: {eventCfg.aerials_panel_size} judges
                {eventCfg.aerials_panel_size <= 4 && ` · Reduction: ${eventCfg.aerials_reduction_method || 'sum_all'}`}
                {eventCfg.aerials_panel_size >= 5 && ' · Drop H/L per component'}
              </div>
            </div>

            {(activeRun.jump1_code || activeRun.jump2_code) && (
              <div className="flex flex-wrap gap-4 mb-3 text-sm text-slate-400">
                {activeRun.jump1_code && (
                  <span>J1: <strong className="text-white">{activeRun.jump1_code}</strong> <span className="text-slate-500">(DD {activeRun.jump1_dd})</span></span>
                )}
                {activeRun.jump2_code && (
                  <span>J2: <strong className="text-white">{activeRun.jump2_code}</strong> <span className="text-slate-500">(DD {activeRun.jump2_dd})</span></span>
                )}
              </div>
            )}

            {aeJudgeRoles.length === 0 ? (
              <div className="text-slate-600 text-sm">No scores submitted yet.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 uppercase">
                    <th className="text-left py-1">Judge</th>
                    <th className="text-right py-1 px-2">J1 Air</th>
                    <th className="text-right py-1 px-2">J1 Form</th>
                    <th className="text-right py-1 px-2">J1 Land</th>
                    {(eventCfg.num_jumps || 2) >= 2 && <>
                      <th className="text-right py-1 px-2">J2 Air</th>
                      <th className="text-right py-1 px-2">J2 Form</th>
                      <th className="text-right py-1 px-2">J2 Land</th>
                    </>}
                  </tr>
                </thead>
                <tbody>
                  {aeJudgeRoles.map(([role, scores]) => {
                    const sByType = {}
                    for (const s of scores) sByType[s.score_type] = s
                    const cell = (t) => {
                      const s = sByType[t]
                      return s != null ? <span className="font-mono text-white">{fmt1(s.raw_score)}</span> : <span className="text-slate-700">—</span>
                    }
                    return (
                      <tr key={role} className="border-t border-slate-800">
                        <td className="py-1 text-slate-300">
                          <span className="font-semibold">{ROLE_LABELS[role] || role}</span>
                          {scores[0]?.name && <span className="text-slate-500 italic ml-2">— {scores[0].name}</span>}
                        </td>
                        <td className="text-right px-2 py-1">{cell('ae_air_j1')}</td>
                        <td className="text-right px-2 py-1">{cell('ae_form_j1')}</td>
                        <td className="text-right px-2 py-1">{cell('ae_land_j1')}</td>
                        {(eventCfg.num_jumps || 2) >= 2 && <>
                          <td className="text-right px-2 py-1">{cell('ae_air_j2')}</td>
                          <td className="text-right px-2 py-1">{cell('ae_form_j2')}</td>
                          <td className="text-right px-2 py-1">{cell('ae_land_j2')}</td>
                        </>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}

            {hasComputed && (
              <div className="mt-4 pt-3 border-t border-slate-700 grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="text-xs text-slate-500 uppercase">Total Form</div>
                  <div className="font-mono text-xl font-bold text-sky-400">{fmt(activeRun.turns_score)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 uppercase">Total Air</div>
                  <div className="font-mono text-xl font-bold text-amber-400">{fmt(activeRun.air_score)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 uppercase">Total Landing</div>
                  <div className="font-mono text-xl font-bold text-purple-400">{fmt(activeRun.speed_score)}</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 3-column grid when active run.
            For aerials v2, the LEFT and CENTER columns will show "no scores" — the actual
            per-judge breakdown is in the v2 grid above. The RIGHT column (running score,
            approve buttons, etc.) still drives the v2 event finalize/approve workflow. */}
        {activeRun && (
          <div className="grid grid-cols-[1.5fr_1.5fr_1fr] gap-4 items-start">

            {/* ── LEFT COLUMN: T&L Judges ──────────────────────────────── */}
            <div>
              <div className="tablet-card" style={{ padding: 18 }}>
                <div className="tablet-display mb-3" style={{ fontSize: 16, letterSpacing: 1.5, color: 'var(--tablet-dim)' }}>T&amp;L JUDGES</div>
                {tlRoles.length === 0 && (
                  <div className="text-sm" style={{ color: 'var(--tablet-muted)' }}>No T&amp;L scores submitted yet.</div>
                )}
                {tlRoles.map(([role, scores]) => (
                  <div key={role} className="space-y-2 mb-3 last:mb-0">
                    <div className="text-xs uppercase font-bold" style={{ color: 'var(--tablet-blue2)', letterSpacing: 1 }}>
                      {ROLE_LABELS[role] || role}
                      {scores[0]?.name && <span className="normal-case italic ml-1" style={{ color: 'var(--tablet-dim)' }}>— {scores[0].name}</span>}
                    </div>
                    {scores.map(s => {
                      const isConfirming = confirmReject?.scoreId === s.id
                      return (
                        <div key={s.score_type}>
                          {!isConfirming && (
                            <div className="flex items-center justify-between py-1">
                              <div className="flex items-center gap-3 flex-wrap">
                                <span className="tablet-mono font-bold text-lg" style={{ color: '#fff' }}>{fmt1(s.raw_score)}</span>
                                {s.score_type === 'turns' && eventCfg?.component_scoring !== 0 && (s.tl_carving != null || s.tl_abext != null || s.tl_upper_body != null) && (
                                  <span className="text-xs tablet-mono" style={{ color: 'var(--tablet-dim)' }}>
                                    Crv {fmt1(s.tl_carving)} / UB {fmt1(s.tl_upper_body)} / A&amp;E {fmt1(s.tl_abext)} / Ded {fmt1(s.tl_deduction)}
                                  </span>
                                )}
                                {s.score_type === 'turns' && eventCfg?.component_scoring === 0 && s.tl_deduction != null && (
                                  <span className="text-xs tablet-mono" style={{ color: 'var(--tablet-dim)' }}>
                                    Ded {s.tl_deduction}
                                  </span>
                                )}
                              </div>
                              {activeRun.status !== 'complete' && (
                                <button
                                  onClick={() => initiateReject(s)}
                                  className="tablet-btn-danger flex-shrink-0"
                                  style={{ height: 32, fontSize: 13, padding: '0 12px' }}
                                >
                                  Reject
                                </button>
                              )}
                            </div>
                          )}
                          {isConfirming && (
                            <div className="tablet-card space-y-3" style={{ padding: '14px 16px', borderColor: 'var(--tablet-red2)', borderWidth: 2 }}>
                              <div className="text-sm font-bold" style={{ color: 'var(--tablet-red2)' }}>Reject this score?</div>
                              <div className="text-sm" style={{ color: 'var(--tablet-text)' }}>
                                <span className="font-bold">{s.name || ROLE_LABELS[role] || role}</span>
                                {' -- '}
                                {SCORE_LABELS[s.score_type] || s.score_type}
                                {': '}
                                <span className="tablet-mono font-bold" style={{ color: '#fff' }}>{fmt1(s.raw_score)}</span>
                              </div>
                              <p className="text-xs" style={{ color: 'var(--tablet-dim)' }}>
                                The judge will be prompted to resubmit.  The run will return to scoring state.
                              </p>
                              <div className="flex gap-3">
                                <button
                                  onClick={executeReject}
                                  disabled={rejecting}
                                  className="tablet-btn-danger flex-1"
                                  style={{ height: 40, fontSize: 14 }}
                                >
                                  {rejecting ? 'Rejecting...' : 'Confirm Reject'}
                                </button>
                                <button
                                  onClick={cancelReject}
                                  disabled={rejecting}
                                  className="tablet-btn-neutral flex-1"
                                  style={{ height: 40, fontSize: 14 }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* ── CENTER COLUMN: Air Judges + Timekeeper ───────────────── */}
            <div className="space-y-4">

              {/* Air Judges */}
              <div className="tablet-card" style={{ padding: 18 }}>
                <div className="tablet-display mb-3" style={{ fontSize: 16, letterSpacing: 1.5, color: 'var(--tablet-dim)' }}>AIR JUDGES</div>

                {/* Jump codes */}
                {(activeRun.jump1_code || activeRun.jump2_code) && (
                  <div className="flex flex-wrap gap-4 mb-4 text-sm items-center" style={{ color: 'var(--tablet-dim)' }}>
                    {activeRun.jump1_code && (
                      <span>J1: <strong className="tablet-mono" style={{ color: 'var(--tablet-blue2)' }}>{activeRun.jump1_code}</strong> <span style={{ color: 'var(--tablet-muted)' }}>(DD {activeRun.jump1_dd})</span></span>
                    )}
                    {activeRun.jump2_code && (
                      <span>J2: <strong className="tablet-mono" style={{ color: 'var(--tablet-blue2)' }}>{activeRun.jump2_code}</strong> <span style={{ color: 'var(--tablet-muted)' }}>(DD {activeRun.jump2_dd})</span></span>
                    )}
                    {activeRun.status !== 'complete' && (
                      <button
                        onClick={async () => {
                          if (!confirm('Clear jump codes so they can be re-entered?')) return
                          setError(''); setStatusMsg('')
                          try {
                            const r = await fetch(`${API}/events/${eventId}/runs/${activeRun.id}`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ clear_jump_codes: true }),
                            })
                            if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'Failed') }
                            setStatusMsg('Jump codes cleared.  Air judge may resubmit.')
                            await loadActive()
                          } catch (e) { setError(e.message) }
                        }}
                        className="text-xs text-amber-400 hover:text-amber-300 underline"
                      >
                        Clear Codes
                      </button>
                    )}
                  </div>
                )}

                {/* Air judge scores */}
                {airRoles.length === 0 && (
                  <div className="text-sm" style={{ color: 'var(--tablet-muted)' }}>No air scores submitted yet.</div>
                )}
                {airRoles.map(([role, scores]) => (
                  <div key={role} className="space-y-2 mb-3 last:mb-0">
                    <div className="text-xs uppercase font-bold" style={{ color: 'var(--tablet-blue2)', letterSpacing: 1 }}>
                      {ROLE_LABELS[role] || role}
                      {scores[0]?.name && <span className="normal-case italic ml-1" style={{ color: 'var(--tablet-dim)' }}>— {scores[0].name}</span>}
                    </div>
                    {scores.map(s => {
                      const isConfirming = confirmReject?.scoreId === s.id
                      return (
                        <div key={s.score_type}>
                          {!isConfirming && (
                            <div className="flex items-center justify-between py-1">
                              <div className="flex items-center gap-3">
                                <span className="text-xs w-14" style={{ color: 'var(--tablet-muted)' }}>{SCORE_LABELS[s.score_type] || s.score_type}</span>
                                {s.score_type === 'air_jump1' && activeRun.jump1_code && (
                                  <span className="text-xs tablet-mono" style={{ color: 'var(--tablet-blue2)' }}>{activeRun.jump1_code}</span>
                                )}
                                {s.score_type === 'air_jump2' && activeRun.jump2_code && (
                                  <span className="text-xs tablet-mono" style={{ color: 'var(--tablet-blue2)' }}>{activeRun.jump2_code}</span>
                                )}
                                <span className="tablet-mono font-bold text-lg" style={{ color: '#fff' }}>{fmt1(s.raw_score)}</span>
                              </div>
                              {activeRun.status !== 'complete' && (
                                <button
                                  onClick={() => initiateReject(s)}
                                  className="tablet-btn-danger"
                                  style={{ height: 32, fontSize: 13, padding: '0 12px' }}
                                >
                                  Reject
                                </button>
                              )}
                            </div>
                          )}
                          {isConfirming && (
                            <div className="tablet-card space-y-3" style={{ padding: '14px 16px', borderColor: 'var(--tablet-red2)', borderWidth: 2 }}>
                              <div className="text-sm font-bold" style={{ color: 'var(--tablet-red2)' }}>Reject this score?</div>
                              <div className="text-sm" style={{ color: 'var(--tablet-text)' }}>
                                <span className="font-bold">{s.name || ROLE_LABELS[role] || role}</span>
                                {' -- '}
                                {SCORE_LABELS[s.score_type] || s.score_type}
                                {': '}
                                <span className="tablet-mono font-bold" style={{ color: '#fff' }}>{fmt1(s.raw_score)}</span>
                              </div>
                              <p className="text-xs" style={{ color: 'var(--tablet-dim)' }}>
                                The judge will be prompted to resubmit.  The run will return to scoring state.
                              </p>
                              <div className="flex gap-3">
                                <button
                                  onClick={executeReject}
                                  disabled={rejecting}
                                  className="tablet-btn-danger flex-1"
                                  style={{ height: 40, fontSize: 14 }}
                                >
                                  {rejecting ? 'Rejecting...' : 'Confirm Reject'}
                                </button>
                                <button
                                  onClick={cancelReject}
                                  disabled={rejecting}
                                  className="tablet-btn-neutral flex-1"
                                  style={{ height: 40, fontSize: 14 }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>

              {/* Timekeeper */}
              {activeRun.run_time != null && (
                <div className="tablet-card space-y-3" style={{ padding: 16 }}>
                  <div className="tablet-display" style={{ fontSize: 16, letterSpacing: 1.5, color: 'var(--tablet-dim)' }}>TIMEKEEPER</div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm" style={{ color: 'var(--tablet-dim)' }}>Time</span>
                    <span className="tablet-mono font-bold text-xl" style={{ color: activeRun.run_time == -1 ? 'var(--tablet-red2)' : 'var(--tablet-green2)' }}>
                      {activeRun.run_time == -1 ? 'NT' : `${Number(activeRun.run_time).toFixed(2)} s`}
                    </span>
                  </div>
                  {eventCfg?.has_speed && eventCfg?.pace_time && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm" style={{ color: 'var(--tablet-dim)' }}>Time Points</span>
                      <span className="tablet-mono font-bold text-lg" style={{ color: 'var(--tablet-blue2)' }}>
                        {activeRun.run_time == -1 ? '0.00' : (() => {
                          const sp = 48 - 32 * (activeRun.run_time / eventCfg.pace_time)
                          return (Math.round(Math.max(0, Math.min(sp, 20)) * 100) / 100).toFixed(2)
                        })()}
                      </span>
                    </div>
                  )}
                  {activeRun.status !== 'complete' && !confirmTimeReject && (
                    <button
                      onClick={() => { setConfirmTimeReject(true); setError(''); setStatusMsg('') }}
                      className="tablet-btn-amber"
                      style={{ height: 36, fontSize: 14 }}
                    >
                      Reject Time
                    </button>
                  )}
                  {confirmTimeReject && (
                    <div className="tablet-card space-y-3" style={{ padding: '14px 16px', borderColor: 'var(--tablet-red2)', borderWidth: 2 }}>
                      <div className="text-sm font-bold" style={{ color: 'var(--tablet-red2)' }}>Reject this time?</div>
                      <div className="text-sm" style={{ color: 'var(--tablet-text)' }}>
                        <span className="tablet-mono font-bold" style={{ color: '#fff' }}>{activeRun.run_time == -1 ? 'NT' : `${Number(activeRun.run_time).toFixed(2)} s`}</span>
                      </div>
                      <p className="text-xs" style={{ color: 'var(--tablet-dim)' }}>
                        The timekeeper will need to resubmit.  Computed scores will be cleared.
                      </p>
                      <div className="flex gap-3">
                        <button
                          onClick={executeTimeReject}
                          disabled={rejectingTime}
                          className="tablet-btn-danger flex-1"
                          style={{ height: 40, fontSize: 14 }}
                        >
                          {rejectingTime ? 'Rejecting...' : 'Confirm Reject'}
                        </button>
                        <button
                          onClick={() => setConfirmTimeReject(false)}
                          disabled={rejectingTime}
                          className="tablet-btn-neutral flex-1"
                          style={{ height: 40, fontSize: 14 }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── RIGHT COLUMN: Run Summary ────────────────────────────── */}
            <div className="space-y-4">

              {/* Running Score */}
              {runningScore && !hasComputed && (
                <div className="rounded-2xl p-5 border border-blue-800 bg-blue-900/10">
                  <div className="text-xs text-blue-400 uppercase tracking-wide mb-3 font-semibold">Running Score</div>
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div className="text-center">
                      <div className="text-xs text-slate-500">Turns</div>
                      <div className="font-mono font-bold text-slate-200 text-lg">{runningScore.turnsVal != null ? runningScore.turnsVal.toFixed(1) : '--'}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-slate-500">Air</div>
                      <div className="font-mono font-bold text-slate-200 text-lg">{runningScore.airVal != null ? runningScore.airVal.toFixed(2) : '--'}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-slate-500">Speed</div>
                      <div className="font-mono font-bold text-slate-200 text-lg">
                        {runningScore.hasSpeed === false ? 'N/A' : runningScore.speedVal != null ? runningScore.speedVal.toFixed(2) : '--'}
                      </div>
                    </div>
                  </div>
                  {/* Per-judge T&L spread */}
                  {(() => {
                    const tlScores = submitted.filter(s => s.score_type === 'turns' && /^TL/.test(s.role))
                    if (tlScores.length >= 2) {
                      const vals = tlScores.map(s => Number(s.raw_score))
                      const spread = Math.max(...vals) - Math.min(...vals)
                      const threshold = eventCfg?.score_spread_threshold ?? 2.0
                      const isHigh = spread >= threshold
                      return (
                        <div className={`text-xs px-3 py-2 rounded-lg mb-2 ${isHigh ? 'bg-red-900/30 border border-red-700 text-red-400' : 'bg-slate-800/50 text-slate-500'}`}>
                          T&L range: {Math.min(...vals).toFixed(1)} -- {Math.max(...vals).toFixed(1)}, spread: <span className={`font-bold ${isHigh ? 'text-red-300' : ''}`}>{spread.toFixed(1)}</span>
                          {isHigh && <span className="ml-2 font-semibold">Review before approving.</span>}
                        </div>
                      )
                    }
                    return null
                  })()}
                  {/* Per-judge Air spread */}
                  {(() => {
                    const a1Scores = submitted.filter(s => s.score_type === 'air_jump1')
                    const a2Scores = submitted.filter(s => s.score_type === 'air_jump2')
                    if (a1Scores.length >= 2 || a2Scores.length >= 2) {
                      const threshold = eventCfg?.score_spread_threshold ?? 2.0
                      const lines = []
                      if (a1Scores.length >= 2) {
                        const vals = a1Scores.map(s => Number(s.raw_score))
                        const sp = Math.max(...vals) - Math.min(...vals)
                        lines.push({ label: 'Air J1', min: Math.min(...vals), max: Math.max(...vals), spread: sp, high: sp >= threshold })
                      }
                      if (a2Scores.length >= 2) {
                        const vals = a2Scores.map(s => Number(s.raw_score))
                        const sp = Math.max(...vals) - Math.min(...vals)
                        lines.push({ label: 'Air J2', min: Math.min(...vals), max: Math.max(...vals), spread: sp, high: sp >= threshold })
                      }
                      const anyHigh = lines.some(l => l.high)
                      return (
                        <div className={`text-xs px-3 py-2 rounded-lg mb-2 ${anyHigh ? 'bg-red-900/30 border border-red-700 text-red-400' : 'bg-slate-800/50 text-slate-500'}`}>
                          {lines.map(l => (
                            <div key={l.label}>{l.label} range: {l.min.toFixed(1)} -- {l.max.toFixed(1)}, spread: <span className={`font-bold ${l.high ? 'text-red-300' : ''}`}>{l.spread.toFixed(1)}</span>{l.high ? ' -- Review before approving.' : ''}</div>
                          ))}
                        </div>
                      )
                    }
                    return null
                  })()}
                  <div className="text-center border-t border-blue-800/50 pt-3">
                    <div className="text-xs text-slate-500 mb-1">Total</div>
                    <div className="font-mono font-bold text-4xl text-blue-300 hc-score">
                      {runningScore.total.toFixed(2)}
                    </div>
                  </div>
                </div>
              )}

              {/* Calculated Score */}
              {hasComputed && (
                <div className={`rounded-2xl p-5 border ${awaitingApproval ? 'border-amber-700 bg-amber-900/10' : 'border-green-800 bg-green-900/10'}`}>
                  <div className="text-xs text-slate-400 uppercase tracking-wide mb-3 font-semibold">Calculated Score</div>
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div className="text-center">
                      <div className="text-xs text-slate-500">Turns</div>
                      <div className="font-mono font-bold text-slate-200 text-lg">{fmt1(activeRun.turns_score)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-slate-500">Air</div>
                      <div className="font-mono font-bold text-slate-200 text-lg">{fmt1(activeRun.air_score)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-slate-500">Speed</div>
                      <div className="font-mono font-bold text-slate-200 text-lg">{fmt1(activeRun.speed_score)}</div>
                    </div>
                  </div>
                  <div className="text-center border-t border-slate-700 pt-3">
                    <div className="text-xs text-slate-500 mb-1">Total</div>
                    <div className={`font-mono font-bold text-4xl hc-score ${awaitingApproval ? 'text-amber-300' : 'text-green-400'}`}>
                      {fmt(activeRun.total_score)}
                    </div>
                  </div>
                </div>
              )}

              {/* Approve button */}
              {awaitingApproval && (
                <>
                  {/* Pending timeout warning */}
                  {pendingElapsed >= 60 && (
                    <div className="bg-red-900/40 border-2 border-red-600 rounded-xl px-4 py-3 text-center animate-pulse">
                      <div className="text-red-300 font-bold text-base">Score pending approval for {Math.floor(pendingElapsed / 60)}:{String(pendingElapsed % 60).padStart(2, '0')}</div>
                      <div className="text-red-400 text-xs mt-1">Tap Approve Score below to publish.</div>
                    </div>
                  )}
                  {/* Spread warning at approval time */}
                  {(() => {
                    const threshold = eventCfg?.score_spread_threshold ?? 2.0
                    const tlScores = submitted.filter(s => s.score_type === 'turns' && /^TL/.test(s.role))
                    const warnings = []
                    if (tlScores.length >= 2) {
                      const vals = tlScores.map(s => Number(s.raw_score))
                      const sp = Math.max(...vals) - Math.min(...vals)
                      if (sp >= threshold) warnings.push(`T&L score spread: ${sp.toFixed(1)} points`)
                    }
                    const a1 = submitted.filter(s => s.score_type === 'air_jump1')
                    if (a1.length >= 2) {
                      const vals = a1.map(s => Number(s.raw_score))
                      const sp = Math.max(...vals) - Math.min(...vals)
                      if (sp >= threshold) warnings.push(`Air J1 spread: ${sp.toFixed(1)} points`)
                    }
                    const a2 = submitted.filter(s => s.score_type === 'air_jump2')
                    if (a2.length >= 2) {
                      const vals = a2.map(s => Number(s.raw_score))
                      const sp = Math.max(...vals) - Math.min(...vals)
                      if (sp >= threshold) warnings.push(`Air J2 spread: ${sp.toFixed(1)} points`)
                    }
                    if (warnings.length === 0) return null
                    return (
                      <div className="bg-red-900/30 border border-red-700 rounded-xl px-4 py-3 text-sm text-red-400 font-semibold animate-pulse">
                        {warnings.join('.  ')}.  Review before approving.
                      </div>
                    )
                  })()}
                  <button
                    onClick={approveScore}
                    disabled={approving}
                    className="w-full bg-green-600 hover:bg-green-500 active:bg-green-700 disabled:opacity-50 text-white font-bold text-xl py-5 rounded-2xl transition-colors"
                  >
                    {approving ? 'Approving...' : 'Approve Score'}
                  </button>
                </>
              )}

              {/* Finalize button */}
              {!awaitingApproval && activeRun.status !== 'complete' && (
                <div className="space-y-2">
                  <button
                    onClick={finalizeScore}
                    disabled={finalizing}
                    className="w-full bg-amber-600 hover:bg-amber-500 active:bg-amber-700 disabled:opacity-50 text-white font-bold text-lg py-4 rounded-2xl transition-colors"
                  >
                    {finalizing ? 'Finalizing...' : 'Finalize and Publish Score'}
                  </button>
                  <p className="text-xs text-amber-600 text-center px-2">
                    Use Finalize only if all judges have submitted -- this will publish whatever scores are currently recorded.
                  </p>
                </div>
              )}

              {/* Set Run Status — RunStatusGrid wraps each click in a confirm dialog */}
              <div className="tablet-card" style={{ padding: 18 }}>
                <div className="text-xs uppercase font-bold mb-3" style={{ color: 'var(--tablet-dim)', letterSpacing: 1.5 }}>SET RUN STATUS</div>
                <RunStatusGrid
                  athleteName={activeRun ? `${activeRun.first_name} ${activeRun.last_name}` : 'this athlete'}
                  onSelect={setRunStatus}
                  disabled={settingStatus}
                />
                <p className="text-xs mt-2 text-center" style={{ color: 'var(--tablet-muted)' }}>
                  These do not require judge scores or time.
                </p>
              </div>

            </div>{/* end right column */}

          </div>
        )}
      </div>
    </div>
  )
}
