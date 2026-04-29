import React, { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import useResolveIds from '../hooks/useResolveIds'

// StickIt v1.6.05 Scoreboard
// - Single / aerials: classic results table + now-competing banner.
// - Dual mogul: compact current-match banner + completed bracket results table.

export default function Scoreboard() {
  const { eventId: rawEventId } = useParams()
  const { eventId: rEvt, loading: resolving } = useResolveIds({ event: rawEventId })
  const eventId = rEvt || rawEventId
  const [results, setResults] = useState([])
  const [phaseData, setPhaseData] = useState(null)
  const [event, setEvent] = useState(null)
  const [activeRun, setActiveRun] = useState(null)
  const [dualState, setDualState] = useState(null)
  const [bracketMatches, setBracketMatches] = useState([])
  const [reviewStatus, setReviewStatus] = useState(null)
  const [expandedRegId, setExpandedRegId] = useState(null)
  const [judgePointsByMatch, setJudgePointsByMatch] = useState({})
  const [expandedMatchId, setExpandedMatchId] = useState(null)
  const [dualTab, setDualTab] = useState('bracket')
  const [placements, setPlacements] = useState([])
  const [judgeScores, setJudgeScores] = useState({})
  const [allRuns, setAllRuns] = useState([])
  const wsRef = useRef(null)

  const loadEvent = async () => {
    try {
      const ev = await fetch(`/api/events/${eventId}`).then(r => r.json())
      setEvent(ev)
    } catch {}
  }

  const isDual = event && event.discipline === 'dual_mogul'

  const loadResults = async () => {
    try {
      const [res, active, pd, jsData] = await Promise.all([
        fetch(`/api/events/${eventId}/results`).then(r => r.json()),
        fetch(`/api/events/${eventId}/runs/active`).then(r => r.json()),
        fetch(`/api/events/${eventId}/phases/results`).then(r => r.json()).catch(() => null),
        fetch(`/api/events/${eventId}/results/judge-scores`).then(r => r.json()).catch(() => null),
      ])
      setResults(res)
      setActiveRun(active && !active.event_completed ? active : null)
      setPhaseData(pd && pd.format !== 'none' ? pd : null)
      if (jsData) {
        setJudgeScores(jsData.judgeScores || {})
        setAllRuns(jsData.runs || [])
      }
    } catch {}
  }

  const loadActiveDual = async () => {
    try {
      const r = await fetch(`/api/events/${eventId}/dual/active-match`)
      if (!r.ok) return
      const data = await r.json()
      if (!data || !data.id) {
        setDualState(null)
        return
      }
      setDualState({
        matchId: data.id,
        blue: {
          bib:  data.blue_bib  || '',
          name: [data.blue_first, data.blue_last].filter(Boolean).join(' '),
        },
        red: {
          bib:  data.red_bib  || '',
          name: [data.red_first, data.red_last].filter(Boolean).join(' '),
        },
        blueTotal: null,
        redTotal:  null,
        winner:    null,
        scored:    false,
      })
    } catch {}
  }

  const loadBracket = async () => {
    try {
      const r = await fetch(`/api/events/${eventId}/dual`)
      if (!r.ok) return
      const data = await r.json()
      const matches = Array.isArray(data) ? data : []
      setBracketMatches(matches)
      loadJudgePointsForBracket(matches)
    } catch {}
  }

  const loadJudgePointsForBracket = async (matches) => {
    try {
      const eligible = matches.filter(m => !m.is_bye && m.status === 'complete')
      if (eligible.length === 0) {
        setJudgePointsByMatch({})
        return
      }
      const results = await Promise.all(
        eligible.map(m =>
          fetch(`/api/events/${eventId}/dual/${m.id}/judge-points`)
            .then(r => r.ok ? r.json() : null)
            .then(data => [m.id, Array.isArray(data?.rows) ? data.rows : []])
            .catch(() => [m.id, []])
        )
      )
      const map = {}
      for (const [id, rows] of results) map[id] = rows
      setJudgePointsByMatch(map)
    } catch {}
  }

  const loadPlacements = async () => {
    try {
      const r = await fetch(`/api/events/${eventId}/results`)
      if (!r.ok) return
      const data = await r.json()
      setPlacements(Array.isArray(data) ? data : [])
    } catch {}
  }

  // v1.16.17 -- bracket-complete review state for dual mogul scoreboard banner
  const loadReviewState = async () => {
    try {
      const r = await fetch(`/api/events/${eventId}/dual/review-state`)
      if (!r.ok) return
      const data = await r.json()
      setReviewStatus(data.status || null)
    } catch {}
  }

  useEffect(() => { if (!resolving) loadEvent() }, [eventId, resolving])

  useEffect(() => {
    if (event == null) return
    if (isDual) {
      loadActiveDual()
      loadBracket()
      loadPlacements()
      loadReviewState()
    } else {
      loadResults()
    }

    const iv = setInterval(() => {
      if (isDual) {
        loadActiveDual()
        loadBracket()
        loadPlacements()
        loadReviewState()
      } else {
        loadResults()
      }
    }, 5000)

    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${wsProto}//${location.host}`)
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.eventId !== eventId) return
        const d = msg.data || {}
        if (isDual) {
          if (msg.type === 'dual_match_started') {
            loadActiveDual()
            loadBracket()
            loadPlacements()
          } else if (msg.type === 'score_update' && d.isDual) {
            setDualState(prev => {
              const base = prev || {
                matchId: d.matchId,
                blue: d.blue ? { bib: d.blue.bib || '', name: d.blue.name || '' } : { bib: '', name: '' },
                red:  d.red  ? { bib: d.red.bib  || '', name: d.red.name  || '' } : { bib: '', name: '' },
              }
              let winner = null
              if (d.winner && d.blue && d.winner.registrationId === d.blue.registrationId) winner = 'blue'
              else if (d.winner && d.red && d.winner.registrationId === d.red.registrationId) winner = 'red'
              return {
                ...base,
                matchId:   d.matchId || base.matchId,
                blueTotal: d.blueTotal,
                redTotal:  d.redTotal,
                winner,
                scored:    true,
              }
            })
            loadBracket()
            loadPlacements()
          } else if (msg.type === 'run_updated' && d.dualComplete) {
            loadBracket()
            loadPlacements()
          } else if (msg.type === 'dual_match_cleared') {
            setDualState(null)
            loadBracket()
            loadPlacements()
          } else if (msg.type === 'dual_bracket_review' || msg.type === 'dual_bracket_sent_back') {
            // v1.16.17 -- bracket-complete review state changed
            loadReviewState()
            loadBracket()
            loadPlacements()
          } else if (msg.type === 'event_finalized') {
            // v1.16.17 -- event finalized -> show "Finalized" banner
            setReviewStatus('approved')
            loadEvent()
            loadBracket()
            loadPlacements()
          }
        } else {
          if (msg.type === 'score_update' || msg.type === 'run_started' || msg.type === 'run_updated') {
            loadResults()
          }
        }
      } catch {}
    }
    wsRef.current = ws
    return () => { clearInterval(iv); ws.close() }
  }, [eventId, event, isDual])

  // --- Click-to-expand score detail ---
  const toggleExpand = (regId) => setExpandedRegId(prev => prev === regId ? null : regId)

  // Clear expanded match if it's no longer in the bracket
  useEffect(() => {
    if (expandedMatchId && !bracketMatches.some(m => m.id === expandedMatchId)) {
      setExpandedMatchId(null)
    }
  }, [bracketMatches, expandedMatchId])

  // Get runs for a given registration_id, grouped from allRuns
  const getRunsForReg = (regId) => allRuns.filter(r => r.registration_id === regId).sort((a, b) => a.run_number - b.run_number)

  const ScoreDetailRow = ({ regId, colSpan, phaseRuns }) => {
    // phaseRuns is used for best_of_2 where r.runs is already provided
    let runs
    if (phaseRuns) {
      runs = Object.values(phaseRuns).sort((a, b) => a.run_number - b.run_number)
    } else {
      runs = getRunsForReg(regId)
    }
    if (!runs.length) return null

    return (
      <tr className="bg-gray-800/60">
        <td colSpan={colSpan} className="px-4 py-2">
          {runs.map(run => {
            if (run.run_status) {
              return (
                <div key={run.run_number} className="text-xs font-mono text-gray-400">
                  <span className="text-gray-500">Run {run.run_number}:</span>{' '}
                  <span className="text-red-400 font-semibold">{run.run_status}</span>
                </div>
              )
            }
            const js = judgeScores[run.id] || { tl: [], air1: [], air2: [] }
            const codes = [run.jump1_code, run.jump2_code].filter(Boolean).join('/')
            return (
              <div key={run.run_number} className="text-xs font-mono text-gray-300 whitespace-nowrap overflow-x-auto">
                <span className="text-gray-500">Run {run.run_number}:</span>
                {js.tl.map((s, i) => (
                  <span key={`tl${i}`} className="ml-3">
                    <span className="text-gray-500">TL{i + 1}</span> {s != null ? s.toFixed(1) : '–'}
                  </span>
                ))}
                {codes && <span className="ml-3 text-blue-400">{codes}</span>}
                {js.air1.map((s, i) => (
                  <span key={`a${i}`} className="ml-3">
                    <span className="text-gray-500">A{i + 1}</span> {s != null ? s.toFixed(1) : '–'}
                  </span>
                ))}
                {run.run_time != null && (
                  <span className="ml-3">
                    <span className="text-gray-500">T:</span> {run.run_time == -1 ? 'NT' : Number(run.run_time).toFixed(2)}
                  </span>
                )}
                {run.speed_score != null && (
                  <span className="ml-3">
                    <span className="text-gray-500">TPt:</span> {run.speed_score.toFixed(2)}
                  </span>
                )}
                <span className="ml-3 text-white font-semibold">
                  <span className="text-gray-500">Total:</span> {run.total_score != null ? run.total_score.toFixed(2) : '–'}
                </span>
              </div>
            )
          })}
        </td>
      </tr>
    )
  }

  if (isDual) {
    // Bracket tree data processing
    const mainMatches = bracketMatches.filter(m => !m.is_small_final)
    const consolMatches = bracketMatches.filter(m => m.is_small_final).sort((a, b) => a.bracket_position - b.bracket_position)
    const totalRound = mainMatches.length > 0 ? Math.max(...mainMatches.map(m => m.bracket_round)) : 0
    const roundMatches = {}
    for (const m of mainMatches) {
      if (!roundMatches[m.bracket_round]) roundMatches[m.bracket_round] = []
      roundMatches[m.bracket_round].push(m)
    }
    for (const r in roundMatches) roundMatches[r].sort((a, b) => a.bracket_position - b.bracket_position)
    const rounds = []
    for (let r = totalRound; r >= 1; r--) rounds.push(r)

    const CARD_H = 44
    const GAP = 6

    const sbRoundLabel = (r) => {
      if (r === 1) return 'Big Final'
      if (r === 2) return 'Semifinals'
      if (r === 3) return 'Quarterfinals'
      return `Round of ${Math.pow(2, r)}`
    }

    const SbMatchCard = ({ m }) => {
      const blueWon = m.status === 'complete' && m.winner_registration_id === m.registration_id_blue
      const redWon = m.status === 'complete' && m.winner_registration_id === m.registration_id_red
      const isDone = m.status === 'complete'
      const blueLost = isDone && redWon
      const redLost = isDone && blueWon
      const redOnTop = !m.is_small_final && (totalRound - m.bracket_round) % 2 === 1

      if (m.is_bye) {
        return (
          <div className="bg-gray-800/30 border border-gray-700 rounded text-xs" style={{ minWidth: 150 }}>
            <div className="border-b border-gray-700 px-2 py-1 flex justify-between items-center">
              <span className="text-blue-400 font-medium">{m.blue_first ? `${m.blue_last}, ${m.blue_first}` : 'TBD'}</span>
              <span className="text-gray-600 text-[10px]">BYE</span>
            </div>
            <div className="px-2 py-1 text-gray-600">—</div>
          </div>
        )
      }

      const athleteRow = (course, first, last, won, lost, total, loserStatus, isTop) => (
        <div className={`${isTop ? 'border-b border-gray-700' : ''} px-2 py-1 flex justify-between items-center gap-1 ${won ? (course === 'blue' ? 'bg-blue-900/40' : 'bg-red-900/40') : 'bg-gray-800/50'}`}>
          <div className="flex items-center gap-1 min-w-0 flex-1">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${course === 'blue' ? 'bg-blue-500' : 'bg-red-500'}`}></span>
            <span className={`truncate ${won ? 'text-white font-semibold' : first ? 'text-gray-300' : 'text-gray-600'}`}>
              {first ? `${last}, ${first}` : 'TBD'}
            </span>
          </div>
          {isDone && total != null && (
            <span className={`font-bold flex-shrink-0 ml-1 ${won ? 'text-white' : 'text-gray-500'}`}>{total}</span>
          )}
          {lost && loserStatus && (
            <span className="font-bold flex-shrink-0 ml-1 text-white">{loserStatus}</span>
          )}
        </div>
      )

      const blueRow = (isTop) => athleteRow('blue', m.blue_first, m.blue_last, blueWon, blueLost, m.blue_total, blueLost && m.loser_status ? m.loser_status : null, isTop)
      const redRow = (isTop) => athleteRow('red', m.red_first, m.red_last, redWon, redLost, m.red_total, redLost && m.loser_status ? m.loser_status : null, isTop)

      const isExpandable = !m.is_bye && isDone
      const isExpanded = isExpandable && expandedMatchId === m.id
      const onCardClick = () => {
        if (!isExpandable) return
        setExpandedMatchId(prev => prev === m.id ? null : m.id)
      }

      const renderDetailRow = () => {
        const points = judgePointsByMatch[m.id] || []
        const fmt = (rows, side) => {
          if (!rows.length) return null
          const parts = rows.map(p => {
            if (p.time_tied) return 'TT'
            return String(side === 'blue' ? (p.blue_points ?? 0) : (p.red_points ?? 0))
          })
          const sum = rows.reduce((acc, p) => acc + (side === 'blue' ? (p.blue_points || 0) : (p.red_points || 0)), 0)
          return { expr: parts.join('+'), sum }
        }
        const blue = fmt(points, 'blue')
        const red = fmt(points, 'red')
        return (
          <div className="border-t border-gray-700 px-2 py-1 bg-gray-900/60 text-[10px] font-mono tabular-nums leading-tight">
            <div className="flex justify-between items-center">
              <span className="text-blue-400">{blue ? blue.expr : '–'}</span>
              <span className="text-blue-300 font-semibold">{blue ? `= ${blue.sum}` : ''}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-red-400">{red ? red.expr : '–'}</span>
              <span className="text-red-300 font-semibold">{red ? `= ${red.sum}` : ''}</span>
            </div>
          </div>
        )
      }

      return (
        <div
          className={`border rounded text-xs ${isDone ? 'border-gray-600' : 'border-gray-700'} ${isExpandable ? 'cursor-pointer active:bg-gray-700/30' : ''}`}
          style={{ minWidth: 150 }}
          onClick={isExpandable ? onCardClick : undefined}
          onTouchEnd={isExpandable ? (e) => { e.preventDefault(); onCardClick() } : undefined}
          role={isExpandable ? 'button' : undefined}
          tabIndex={isExpandable ? 0 : undefined}
        >
          {redOnTop ? redRow(true) : blueRow(true)}
          {redOnTop ? blueRow(false) : redRow(false)}
          {isExpanded && renderDetailRow()}
        </div>
      )
    }

    return (
      <div className="min-h-screen bg-gray-950 text-white font-sans p-6 flex flex-col gap-4">
        <div className="text-center">
          <div className="text-4xl font-black tracking-tight">
            <span className="text-white">Stick</span><span style={{ color: '#EF4444' }}>It</span>
            <span className="text-white"> DUAL MOGULS</span>
          </div>
          <div className="text-blue-400 text-lg mt-1">Live Scoreboard</div>
        </div>

        {/* Current match */}
        {dualState ? (
          <div className="bg-blue-900/40 border border-blue-800 rounded-2xl p-4">
            <div className="text-xs uppercase tracking-widest text-blue-300 text-center mb-3 font-bold">
              Now Competing
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
              <DualCard
                side="blue"
                bib={dualState.blue.bib}
                name={dualState.blue.name}
                total={dualState.blueTotal}
                isWinner={dualState.winner === 'blue'}
                isLoser={dualState.scored && dualState.winner && dualState.winner !== 'blue'}
              />
              <div className="text-gray-500 text-2xl font-bold text-center">vs</div>
              <DualCard
                side="red"
                bib={dualState.red.bib}
                name={dualState.red.name}
                total={dualState.redTotal}
                isWinner={dualState.winner === 'red'}
                isLoser={dualState.scored && dualState.winner && dualState.winner !== 'red'}
              />
            </div>
          </div>
        ) : (event && event.status === 'complete') || reviewStatus === 'approved' ? (
          <div className="bg-emerald-900/30 border border-emerald-700 rounded-2xl p-4 text-center text-emerald-300 text-xl font-semibold">
            Finalized
          </div>
        ) : reviewStatus === 'pending' || reviewStatus === 'sent_back' ? (
          <div className="bg-amber-900/20 border border-amber-700 rounded-2xl p-4 text-center text-amber-300 text-xl">
            Awaiting Head Judge Approval
          </div>
        ) : (
          <div className="bg-blue-900/20 border border-blue-900 rounded-2xl p-4 text-center text-blue-500 text-xl">
            Waiting for next match...
          </div>
        )}

        {/* Bracket / Place tabs */}
        {bracketMatches.length > 0 ? (
          <div className="bg-gray-900 rounded-2xl overflow-hidden border border-gray-800 flex-1">
            <div className="px-2 pt-2 bg-gray-800 flex gap-1 border-b border-gray-700">
              {['bracket', 'place'].map(t => (
                <button
                  key={t}
                  onClick={() => setDualTab(t)}
                  className={`px-4 py-2 text-xs uppercase tracking-wider font-semibold border-b-2 -mb-px transition-colors ${dualTab === t ? 'text-white border-blue-500' : 'text-gray-400 border-transparent hover:text-gray-200'}`}
                >
                  {t === 'bracket' ? 'Bracket' : 'Place'}
                </button>
              ))}
            </div>
            {dualTab === 'bracket' ? (
              <div className="overflow-x-auto p-4">
                <div className="flex gap-3 items-start" style={{ minWidth: rounds.length * 170 }}>
                  {rounds.map((r, colIdx) => {
                    const matches = roundMatches[r] || []
                    const spacingMultiplier = Math.pow(2, colIdx)
                    const isFinalCol = r === 1
                    return (
                      <div key={r} className="flex-shrink-0" style={{ width: 170 }}>
                        <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2 text-center">
                          {sbRoundLabel(r)}
                        </div>
                        {isFinalCol && consolMatches.length > 0 ? (
                          <div>
                            <div style={{ paddingTop: (spacingMultiplier - 1) * (CARD_H + GAP) / 2 }}>
                              {matches.map(m => (
                                <SbMatchCard key={m.id} m={m} />
                              ))}
                            </div>
                            <div className="space-y-3" style={{ marginTop: 32 }}>
                              {consolMatches.sort((a, b) => {
                                if (a.bracket_round !== b.bracket_round) return a.bracket_round - b.bracket_round
                                return a.bracket_position - b.bracket_position
                              }).map(m => {
                                const label = m.bracket_round === 1 && m.bracket_position === 2 ? 'Small Final'
                                  : m.bracket_round === 2 && m.bracket_position === 3 ? '5th/6th Runoff'
                                  : m.bracket_round === 2 && m.bracket_position === 4 ? '7th/8th Runoff'
                                  : 'Consolation'
                                return (
                                  <div key={m.id}>
                                    <div className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide mb-1 text-center">{label}</div>
                                    <SbMatchCard m={m} />
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1" style={{ paddingTop: (spacingMultiplier - 1) * (CARD_H + GAP) / 2 }}>
                            {matches.map(m => (
                              <div key={m.id} style={{ marginBottom: (spacingMultiplier - 1) * (CARD_H + GAP) }}>
                                <SbMatchCard m={m} />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-800/50 text-gray-500 text-xs uppercase tracking-wider">
                      <th className="px-4 py-2 text-left w-16">Place</th>
                      <th className="px-4 py-2 text-left w-12">Bib</th>
                      <th className="px-4 py-2 text-left w-12">Gp</th>
                      <th className="px-4 py-2 text-left">Name</th>
                      <th className="px-4 py-2 text-left">Club</th>
                      <th className="px-4 py-2 text-right font-bold text-white">Points</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {placements.map((r) => {
                      const flagged = (r.run_status === 'DNS' || r.run_status === 'DSQ' || r.reg_status === 'scratched')
                      return (
                        <tr key={r.registration_id} className={r.rank === 1 ? 'bg-yellow-900/20' : r.rank <= 3 ? 'bg-gray-800/40' : ''}>
                          <td className="px-4 py-3">
                            {flagged ? (
                              <span className="text-red-400 font-semibold text-sm">{r.run_status === 'DSQ' ? 'DSQ' : (r.reg_status === 'scratched' ? 'SCR' : 'DNS')}</span>
                            ) : (
                              <span className={`font-bold text-lg ${r.rank === 1 ? 'text-yellow-400' : r.rank === 2 ? 'text-gray-300' : r.rank === 3 ? 'text-amber-600' : 'text-gray-500'}`}>
                                {r.rank}
                              </span>
                            )}
                            {r.run_status === 'DNF' && <span className="ml-2 text-xs text-amber-400">DNF</span>}
                          </td>
                          <td className="px-4 py-3 text-gray-400">{r.bib_number}</td>
                          <td className="px-4 py-3 text-gray-400 font-mono">{r.gp}</td>
                          <td className="px-4 py-3 font-semibold">{r.last_name}, {r.first_name}</td>
                          <td className="px-4 py-3 text-gray-400">{r.club}</td>
                          <td className="px-4 py-3 text-right font-mono text-white">
                            {r.ffsp != null ? Number(r.ffsp).toFixed(2) : '—'}
                          </td>
                        </tr>
                      )
                    })}
                    {!placements.length && (
                      <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-600">No placements yet</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : !dualState ? (
          <div className="flex-1 flex items-center justify-center text-gray-700 text-xl">
            No results yet
          </div>
        ) : null}

        <div className="text-center text-[11px] text-gray-500 tracking-wide pt-1 pb-2">
          <span className="text-gray-400 font-semibold mr-2">Judge Roles:</span>
          J1 Turns • J2 Turns • J3 Air • J4 Time • J5 Overall
        </div>
      </div>
    )
  }

  // Best of 2 scoreboard: show both runs side by side
  if (phaseData && phaseData.format === 'best_of_2') {
    const pd = phaseData
    return (
      <div className="min-h-screen bg-gray-950 text-white font-sans p-6">
        <div className="text-center mb-8">
          <div className="text-4xl font-black tracking-tight"><span className="text-white">Stick</span><span style={{ color: '#EF4444' }}>It</span><span className="text-white"> MOGULS</span></div>
          <div className="text-blue-400 text-lg mt-1">Live Scoreboard — Best of 2</div>
        </div>
        {activeRun && (
          <div className="bg-blue-600 rounded-2xl p-5 mb-6 text-center animate-pulse-slow">
            <div className="text-xs uppercase tracking-widest text-blue-200 mb-1">Now Competing</div>
            <div className="text-4xl font-black">{activeRun.first_name} {activeRun.last_name}</div>
            <div className="text-blue-200 mt-1">Bib #{activeRun.bib_number}</div>
          </div>
        )}
        <div className="bg-gray-900 rounded-2xl overflow-hidden border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-800 text-gray-400 text-xs uppercase tracking-wider">
                <th className="px-4 py-3 text-left w-12">Rank</th>
                <th className="px-4 py-3 text-left w-12">Bib</th>
                <th className="px-4 py-3 text-left">Name</th>
                {pd.phases.map(p => (
                  <th key={p.run_number} className="px-4 py-3 text-right">{p.label}</th>
                ))}
                <th className="px-4 py-3 text-right font-bold text-white">Final Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {pd.results.map((r, i) => {
                const regId = r.registration_id || r.id
                return (
                  <React.Fragment key={regId}>
                    <tr className={`cursor-pointer active:bg-gray-800/70 ${r.rank === 1 ? 'bg-yellow-900/20' : r.rank <= 3 ? 'bg-gray-800/40' : ''}`} onClick={() => toggleExpand(regId)} onTouchEnd={(e) => { e.preventDefault(); toggleExpand(regId) }}>
                      <td className="px-4 py-3">
                        <span className={`font-bold text-lg ${r.rank === 1 ? 'text-yellow-400' : r.rank === 2 ? 'text-gray-300' : r.rank === 3 ? 'text-amber-600' : 'text-gray-500'}`}>
                          {r.rank || '–'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400">{r.bib_number}</td>
                      <td className="px-4 py-3 font-semibold">{r.last_name}, {r.first_name}</td>
                      {pd.phases.map(p => {
                        const runData = r.runs && r.runs[p.run_number]
                        return (
                          <td key={p.run_number} className="px-4 py-3 text-right text-gray-300 font-mono">
                            {runData ? (runData.run_status || Number(runData.total_score).toFixed(2)) : '–'}
                          </td>
                        )
                      })}
                      <td className="px-4 py-3 text-right font-bold text-white text-lg">
                        {r.total_score != null ? Number(r.total_score).toFixed(2) : (r.run_status || '–')}
                      </td>
                    </tr>
                    {expandedRegId === regId && <ScoreDetailRow regId={regId} colSpan={pd.phases.length + 4} phaseRuns={r.runs} />}
                  </React.Fragment>
                )
              })}
              {!pd.results.length && (
                <tr><td colSpan={pd.phases.length + 4} className="px-4 py-10 text-center text-gray-600">No results yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // Qualifier/Finals scoreboard: sections per phase, latest on top
  if (phaseData && phaseData.format === 'qualifier_finals') {
    const pd = phaseData
    // Group results by tier
    const tiers = {}
    for (const r of pd.results) {
      const t = r.tier || 'qualifier'
      if (!tiers[t]) tiers[t] = []
      tiers[t].push(r)
    }

    // Order: final_2, final_1, qualifier (latest on top)
    const tierOrder = ['final_2', 'final_1', 'qualifier', 'flagged']
    const tierLabels = { final_2: 'Final 2', final_1: 'Final 1', qualifier: 'Qualification', flagged: '' }

    return (
      <div className="min-h-screen bg-gray-950 text-white font-sans p-6">
        <div className="text-center mb-8">
          <div className="text-4xl font-black tracking-tight"><span className="text-white">Stick</span><span style={{ color: '#EF4444' }}>It</span><span className="text-white"> MOGULS</span></div>
          <div className="text-blue-400 text-lg mt-1">Live Scoreboard</div>
        </div>
        {activeRun && (
          <div className="bg-blue-600 rounded-2xl p-5 mb-6 text-center animate-pulse-slow">
            <div className="text-xs uppercase tracking-widest text-blue-200 mb-1">Now Competing</div>
            <div className="text-4xl font-black">{activeRun.first_name} {activeRun.last_name}</div>
            <div className="text-blue-200 mt-1">Bib #{activeRun.bib_number}</div>
          </div>
        )}
        <div className="space-y-4">
          {tierOrder.map(tier => {
            const rows = tiers[tier]
            if (!rows || rows.length === 0) return null
            return (
              <div key={tier} className="bg-gray-900 rounded-2xl overflow-hidden border border-gray-800">
                {tierLabels[tier] && (
                  <div className="px-4 py-2 bg-gray-800 text-xs uppercase tracking-wider text-gray-400 font-semibold">
                    {tierLabels[tier]}
                  </div>
                )}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-800/50 text-gray-500 text-xs uppercase tracking-wider">
                      <th className="px-4 py-2 text-left w-12">Rank</th>
                      <th className="px-4 py-2 text-left w-12">Bib</th>
                      <th className="px-4 py-2 text-left">Name</th>
                      <th className="px-4 py-2 text-right">Turns</th>
                      <th className="px-4 py-2 text-right">Air</th>
                      {event?.discipline !== 'aerials' && <th className="px-4 py-2 text-right">Time</th>}
                      <th className="px-4 py-2 text-right">Speed</th>
                      <th className="px-4 py-2 text-right font-bold text-white">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {rows.map((r, i) => {
                      const regId = r.registration_id || r.id
                      const colCount = event?.discipline !== 'aerials' ? 8 : 7
                      return (
                        <React.Fragment key={regId}>
                          <tr className={`cursor-pointer active:bg-gray-800/70 ${r.rank === 1 ? 'bg-yellow-900/20' : r.rank <= 3 ? 'bg-gray-800/40' : ''}`} onClick={() => toggleExpand(regId)} onTouchEnd={(e) => { e.preventDefault(); toggleExpand(regId) }}>
                            <td className="px-4 py-3">
                              <span className={`font-bold text-lg ${r.rank === 1 ? 'text-yellow-400' : r.rank === 2 ? 'text-gray-300' : r.rank === 3 ? 'text-amber-600' : 'text-gray-500'}`}>
                                {r.rank || (r.run_status || '–')}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-gray-400">{r.bib_number}</td>
                            <td className="px-4 py-3 font-semibold">{r.last_name}, {r.first_name}</td>
                            <td className="px-4 py-3 text-right text-gray-300">{r.turns_score?.toFixed(1) || '–'}</td>
                            <td className="px-4 py-3 text-right text-gray-300">{r.air_score?.toFixed(2) || '–'}</td>
                            {event?.discipline !== 'aerials' && <td className="px-4 py-3 text-right text-gray-400 font-mono">{r.run_time != null ? (r.run_time == -1 ? 'NT' : Number(r.run_time).toFixed(2)) : '–'}</td>}
                            <td className="px-4 py-3 text-right text-gray-300">{r.speed_score?.toFixed(2) || '–'}</td>
                            <td className="px-4 py-3 text-right font-bold text-white text-lg">{r.run_status || r.total_score?.toFixed(2) || '–'}</td>
                          </tr>
                          {expandedRegId === regId && <ScoreDetailRow regId={regId} colSpan={colCount} />}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })}
          {pd.results.length === 0 && (
            <div className="bg-gray-900 rounded-2xl p-10 text-center text-gray-600 border border-gray-800">No results yet</div>
          )}
        </div>
      </div>
    )
  }

  // Standard scoreboard (legacy or single run)
  return (
    <div className="min-h-screen bg-gray-950 text-white font-sans p-6">
      <div className="text-center mb-8">
        <div className="text-4xl font-black tracking-tight"><span className="text-white">Stick</span><span style={{ color: '#EF4444' }}>It</span><span className="text-white"> MOGULS</span></div>
        <div className="text-blue-400 text-lg mt-1">Live Scoreboard</div>
      </div>

      {activeRun && (
        <div className="bg-blue-600 rounded-2xl p-5 mb-6 text-center animate-pulse-slow">
          <div className="text-xs uppercase tracking-widest text-blue-200 mb-1">Now Competing</div>
          <div className="text-4xl font-black">{activeRun.first_name} {activeRun.last_name}</div>
          <div className="text-blue-200 mt-1">Bib #{activeRun.bib_number}</div>
        </div>
      )}

      <div className="bg-gray-900 rounded-2xl overflow-hidden border border-gray-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-800 text-gray-400 text-xs uppercase tracking-wider">
              <th className="px-4 py-3 text-left w-12">Rank</th>
              <th className="px-4 py-3 text-left w-12">Bib</th>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-right">Turns</th>
              <th className="px-4 py-3 text-right">Air</th>
              {event?.discipline !== 'aerials' && <th className="px-4 py-3 text-right">Time</th>}
              <th className="px-4 py-3 text-right">Speed</th>
              <th className="px-4 py-3 text-right font-bold text-white">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {results.map((r, i) => {
              const regId = r.registration_id || r.id
              const colCount = event?.discipline !== 'aerials' ? 8 : 7
              return (
                <React.Fragment key={regId}>
                  <tr className={`cursor-pointer active:bg-gray-800/70 ${r.rank === 1 ? 'bg-yellow-900/20' : r.rank <= 3 ? 'bg-gray-800/40' : ''}`} onClick={() => toggleExpand(regId)} onTouchEnd={(e) => { e.preventDefault(); toggleExpand(regId) }}>
                    <td className="px-4 py-3">
                      <span className={`font-bold text-lg ${r.rank === 1 ? 'text-yellow-400' : r.rank === 2 ? 'text-gray-300' : r.rank === 3 ? 'text-amber-600' : 'text-gray-500'}`}>
                        {r.rank}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{r.bib_number}</td>
                    <td className="px-4 py-3 font-semibold">{r.last_name}, {r.first_name}</td>
                    <td className="px-4 py-3 text-right text-gray-300">{r.turns_score?.toFixed(1)}</td>
                    <td className="px-4 py-3 text-right text-gray-300">{r.air_score?.toFixed(2)}</td>
                    {event?.discipline !== 'aerials' && <td className="px-4 py-3 text-right text-gray-400 font-mono">{r.run_time != null ? (r.run_time == -1 ? 'NT' : Number(r.run_time).toFixed(2)) : '–'}</td>}
                    <td className="px-4 py-3 text-right text-gray-300">{r.speed_score?.toFixed(2) || '–'}</td>
                    <td className="px-4 py-3 text-right font-bold text-white text-lg">{r.run_status || r.total_score?.toFixed(2) || '–'}</td>
                  </tr>
                  {expandedRegId === regId && <ScoreDetailRow regId={regId} colSpan={colCount} />}
                </React.Fragment>
              )
            })}
            {!results.length && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-600">No results yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DualCard({ side, bib, name, total, isWinner, isLoser }) {
  const baseBg = side === 'blue' ? '#1D4ED8' : '#DC2626'
  return (
    <div
      className="rounded-xl p-4 flex flex-col items-center transition-all duration-500"
      style={{ backgroundColor: baseBg, opacity: isLoser ? 0.45 : 1 }}
    >
      <div className="text-xs uppercase tracking-widest text-white/70 mb-1 font-bold">{side}</div>
      {bib && <div className="text-lg text-white/80 font-semibold">Bib #{bib}</div>}
      <div className="text-3xl font-black text-white text-center leading-tight my-1">{name || '—'}</div>
      {total != null ? (
        <div className="text-5xl font-black text-white tabular-nums">{Number(total).toFixed(0)}</div>
      ) : (
        <div className="text-lg text-white/50">Awaiting scores</div>
      )}
      {isWinner && (
        <div className="mt-2 px-4 py-1 bg-white text-black text-sm font-black rounded-full">WINNER</div>
      )}
    </div>
  )
}

function roundLabel(m) {
  if (m.bracket_round === 1) return m.is_small_final ? '3rd Place' : 'Final'
  if (m.bracket_round === 2) return m.is_small_final ? 'Semi 3/4' : 'Semifinal'
  if (m.bracket_round === 3) return m.is_small_final ? 'QF 3/4' : 'Quarterfinal'
  return `Round ${m.bracket_round}`
}
