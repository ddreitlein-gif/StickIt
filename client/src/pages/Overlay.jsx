import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import useResolveIds from '../hooks/useResolveIds'

// StickIt v1.6.05 Overlay -- 1920x1080 transparent canvas for YoloBox / OBS browser source.
//
// Single mogul:
//   - run_started -> show name overlay (bib + name + club) lower-left
//   - score_update with total -> show score overlay (name + score + place) center-lower
//   - Score persists until next run_started.  No auto-hide timer.
//
// Dual mogul:
//   - dual_match_started -> fetch active match, show blue + red bars (bib + name only)
//   - score_update (isDual) -> reveal totals on each bar + WINNER/place label
//   - Bars persist; reset on next dual_match_started.
//
// Polling (every 3 s) provides a fallback for hardware encoders (YoloBox) that
// do not maintain persistent WebSocket connections.
//
// Server payloads are wrapped: { type, data, eventId }.

const ACCENT_COLOR = '#00D4FF'
const RED_TXT  = '#EF4444'
const TEXT_SHADOW = '0 2px 6px rgba(0,0,0,0.6), 0 1px 2px rgba(0,0,0,0.4)'

// Broadcast-style gradient backgrounds — fade but keep minimum opacity for text readability
const NAME_GRADIENT  = 'linear-gradient(to right, rgba(10,22,72,0.95) 0%, rgba(10,22,72,0.90) 55%, rgba(10,22,72,0.75) 100%)'
const SCORE_GRADIENT = 'linear-gradient(to right, rgba(10,22,72,0.95) 0%, rgba(10,22,72,0.90) 60%, rgba(10,22,72,0.75) 100%)'
const BLUE_GRADIENT  = 'linear-gradient(to right, rgba(29,78,216,0.95) 0%, rgba(29,78,216,0.90) 55%, rgba(29,78,216,0.75) 100%)'
const RED_GRADIENT   = 'linear-gradient(to right, rgba(220,38,38,0.95) 0%, rgba(220,38,38,0.90) 55%, rgba(220,38,38,0.75) 100%)'

export default function Overlay() {
  const { eventId: rawEventId } = useParams()
  const { eventId: rEvt, loading: resolving } = useResolveIds({ event: rawEventId })
  const eventId = rEvt || rawEventId

  const [discipline, setDiscipline]             = useState(null)
  const [singleMode, setSingleMode]             = useState('idle')
  const [currentAthlete, setCurrentAthlete]     = useState(null)
  const [currentScore, setCurrentScore]         = useState(null)

  const [dualActive, setDualActive] = useState(false)
  const [dualState,  setDualState]  = useState(null)

  const lastAthleteRef = useRef(null)
  const dualActiveRef  = useRef(false)
  const containerRef   = useRef(null)
  useEffect(() => { dualActiveRef.current = dualActive }, [dualActive])

  // Make body and html transparent so OBS/YoloBox browser sources show a clear canvas.
  // useLayoutEffect fires before the browser paints — no dark flash on load.
  // setProperty with 'important' overrides any stylesheet rule including Tailwind @layer base.
  useLayoutEffect(() => {
    const html = document.documentElement
    const body = document.body
    html.style.setProperty('background',       'transparent', 'important')
    html.style.setProperty('background-color', 'transparent', 'important')
    body.style.setProperty('background',       'transparent', 'important')
    body.style.setProperty('background-color', 'transparent', 'important')
    return () => {
      html.style.removeProperty('background')
      html.style.removeProperty('background-color')
      body.style.removeProperty('background')
      body.style.removeProperty('background-color')
    }
  }, [])

  // Scale the 1920×1080 canvas to fit whatever viewport is rendering it.
  // In YoloBox / OBS at 1920×1080 the scale is exactly 1.0 — no visual change.
  // In a smaller Chrome window the canvas scales down so the lower-thirds are visible.
  useLayoutEffect(() => {
    const updateScale = () => {
      if (!containerRef.current) return
      const sx = window.innerWidth  / 1920
      const sy = window.innerHeight / 1080
      containerRef.current.style.transform = `scale(${Math.min(sx, sy)})`
    }
    updateScale()
    window.addEventListener('resize', updateScale)
    return () => window.removeEventListener('resize', updateScale)
  }, [])

  const fetchActiveDual = async () => {
    try {
      const r = await fetch(`/api/events/${eventId}/dual/active-match`)
      if (!r.ok) return
      const data = await r.json()
      if (!data || !data.id) return
      setDualActive(true)
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
        scored: false,
        winnerSide: null,
        bracketRound: data.bracket_round,
        isSmallFinal: !!data.is_small_final,
      })
    } catch (_) {}
  }

  // On load, hydrate current display state so the overlay shows correctly when opened mid-event
  useEffect(() => {
    if (!eventId || resolving) return
    fetch(`/api/events/${eventId}`)
      .then(r => r.ok ? r.json() : null)
      .then(async ev => {
        if (!ev) return
        setDiscipline(ev.discipline)
        if (ev.discipline === 'dual_mogul') {
          fetchActiveDual()
          return
        }
        // Single mogul / aerials: check for an active (in-progress) run first
        const active = await fetch(`/api/events/${eventId}/runs/active`).then(r => r.ok ? r.json() : null).catch(() => null)
        if (active && active.id) {
          const athlete = {
            bib:        active.is_forerunner ? '' : (active.bib_number || ''),
            first_name: active.is_forerunner ? 'Forerunner' : (active.first_name || ''),
            last_name:  active.is_forerunner ? '' : (active.last_name  || ''),
            club:       active.is_forerunner ? '' : (active.club || ''),
          }
          lastAthleteRef.current = athlete
          setCurrentAthlete(athlete)
          setCurrentScore(null)
          setSingleMode('name')
          return
        }
        // No active run — show the most recently completed score (skip manually-entered runs)
        const results = await fetch(`/api/events/${eventId}/results`).then(r => r.ok ? r.json() : null).catch(() => null)
        if (results && results.length > 0) {
          const nonManual = results.filter(r => !r.manually_entered)
          if (nonManual.length > 0) {
            const latest = nonManual.reduce((a, b) => (a.updated_at > b.updated_at ? a : b))
            const name = `${latest.first_name} ${latest.last_name}`.trim()
            lastAthleteRef.current = { bib: latest.bib_number, first_name: latest.first_name, last_name: latest.last_name, club: latest.club || '' }
            setCurrentScore({ total: latest.total_score, place: latest.rank, name })
            setSingleMode('score')
          }
        }
      })
      .catch(() => {})
  }, [eventId, resolving])

  // Polling fallback (3 s) — keeps the overlay in sync when WebSocket is unavailable
  // (e.g. YoloBox browser source does not maintain persistent WS connections).
  useEffect(() => {
    if (!eventId || !discipline || resolving) return

    const poll = async () => {
      if (discipline === 'dual_mogul') {
        await fetchActiveDual()
        return
      }
      // Single mogul / aerials
      const active = await fetch(`/api/events/${eventId}/runs/active`).then(r => r.ok ? r.json() : null).catch(() => null)
      if (active && active.id) {
        const athlete = {
          bib:        active.is_forerunner ? '' : (active.bib_number || ''),
          first_name: active.is_forerunner ? 'Forerunner' : (active.first_name || ''),
          last_name:  active.is_forerunner ? '' : (active.last_name  || ''),
          club:       active.is_forerunner ? '' : (active.club || ''),
        }
        lastAthleteRef.current = athlete
        setCurrentAthlete(athlete)
        setCurrentScore(null)
        setSingleMode('name')
        return
      }
      // No active run — show last score (skip manually-entered runs)
      const results = await fetch(`/api/events/${eventId}/results`).then(r => r.ok ? r.json() : null).catch(() => null)
      if (results && results.length > 0) {
        const nonManual = results.filter(r => !r.manually_entered)
        if (nonManual.length > 0) {
          const latest = nonManual.reduce((a, b) => (a.updated_at > b.updated_at ? a : b))
          const name = `${latest.first_name} ${latest.last_name}`.trim()
          lastAthleteRef.current = { bib: latest.bib_number, first_name: latest.first_name, last_name: latest.last_name, club: latest.club || '' }
          setCurrentScore({ total: latest.total_score, place: latest.rank, name })
          setSingleMode('score')
        } else {
          // All results are manual entries — return to idle
          setSingleMode('idle')
          setCurrentAthlete(null)
          setCurrentScore(null)
        }
      } else {
        // No results yet — return to idle
        setSingleMode('idle')
        setCurrentAthlete(null)
        setCurrentScore(null)
      }
    }

    poll()  // fire once immediately; interval handles subsequent ticks
    const iv = setInterval(poll, 3000)
    return () => clearInterval(iv)
  }, [eventId, discipline])

  useEffect(() => {
    if (!eventId) return
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}`)

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.eventId && msg.eventId !== eventId) return
        const d = msg.data || {}

        if (msg.type === 'run_started') {
          if (dualActiveRef.current) return
          const athlete = {
            bib:        d.is_forerunner ? '' : (d.bib || d.bib_number || ''),
            first_name: d.is_forerunner ? 'Forerunner' : (d.first_name || ''),
            last_name:  d.is_forerunner ? '' : (d.last_name || ''),
            club:       d.is_forerunner ? '' : (d.club || ''),
          }
          lastAthleteRef.current = athlete
          setCurrentAthlete(athlete)
          setCurrentScore(null)
          setSingleMode('name')
          return
        }

        if (msg.type === 'score_update') {
          // Forerunner approval — clear overlay entirely
          if (d.is_forerunner) {
            setSingleMode('idle')
            setCurrentAthlete(null)
            setCurrentScore(null)
            lastAthleteRef.current = null
            return
          }
          if (d.isDual) {
            setDualActive(true)
            setDualState(prev => ({
              ...(prev || {}),
              matchId:   d.matchId   || (prev && prev.matchId),
              blue:      d.blue      || (prev && prev.blue),
              red:       d.red       || (prev && prev.red),
              blueTotal: d.blueTotal,
              redTotal:  d.redTotal,
              scored:    true,
              winnerSide: (d.blueTotal > d.redTotal) ? 'blue' : 'red',
              bracketRound: d.bracketRound,
              isSmallFinal: !!d.isSmallFinal,
            }))
            return
          }

          if (d.total == null && d.score == null) return
          const total = d.total ?? d.score
          const place = d.rank ?? d.place ?? null
          const ath = lastAthleteRef.current
          const name = ath ? `${ath.first_name} ${ath.last_name}`.trim() : ''
          setCurrentScore({ total, place, name })
          setSingleMode('score')
          return
        }

        if (msg.type === 'dual_match_started') {
          fetchActiveDual()
          return
        }

        if (msg.type === 'OVERLAY_HIDE') {
          setSingleMode('idle')
          setCurrentAthlete(null)
          setCurrentScore(null)
          setDualActive(false)
          setDualState(null)
        }
      } catch (_) {}
    }

    return () => { try { ws.close() } catch (_) {} }
  }, [eventId])

  return (
    <div ref={containerRef} style={{
      position: 'fixed', top: 0, left: 0,
      width: '1920px', height: '1080px',
      background: 'transparent',
      transformOrigin: 'top left',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: 'white',
      overflow: 'hidden',
    }}>
      {dualActive && dualState && (
        <>
          <DualBar side="blue"
                   bib={dualState.blue?.bib}
                   name={dualState.blue?.name}
                   total={dualState.scored ? dualState.blueTotal : null}
                   label={getDualLabel(dualState, 'blue')}
                   xLeft={60} />
          <DualBar side="red"
                   bib={dualState.red?.bib}
                   name={dualState.red?.name}
                   total={dualState.scored ? dualState.redTotal : null}
                   label={getDualLabel(dualState, 'red')}
                   xLeft={1020} />
        </>
      )}

      {!dualActive && singleMode === 'name' && currentAthlete && (
        <div style={{
          position: 'absolute', left: '60px', top: '760px',
          background: NAME_GRADIENT, borderRadius: '8px 0 0 8px',
          padding: '26px 80px 26px 40px', display: 'flex', alignItems: 'center', gap: '36px',
          maxWidth: '1300px', boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          borderBottom: `3px solid ${ACCENT_COLOR}`,
        }}>
          <div style={{ fontSize: '96px', fontWeight: 900, lineHeight: 1, flexShrink: 0, textShadow: TEXT_SHADOW }}>
            {currentAthlete.bib}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '46px', fontWeight: 800, lineHeight: 1.05, whiteSpace: 'nowrap', textShadow: TEXT_SHADOW }}>
              {currentAthlete.first_name} {currentAthlete.last_name}
            </div>
            {currentAthlete.club && (
              <>
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.45)', margin: '8px 0' }} />
                <div style={{ fontSize: '32px', fontWeight: 500, opacity: 0.85, lineHeight: 1.1, whiteSpace: 'nowrap', textShadow: TEXT_SHADOW }}>
                  {currentAthlete.club}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {!dualActive && singleMode === 'score' && currentScore && (
        <div style={{
          position: 'absolute', left: '50%', top: '820px',
          transform: 'translateX(-50%)',
          background: SCORE_GRADIENT, borderRadius: '8px',
          padding: '28px 80px', display: 'flex', alignItems: 'center', gap: '44px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          borderBottom: `3px solid ${ACCENT_COLOR}`,
        }}>
          {currentScore.name && (
            <div style={{ fontSize: '42px', fontWeight: 700, textShadow: TEXT_SHADOW }}>{currentScore.name}</div>
          )}
          <div style={{ fontSize: '56px', fontWeight: 900, color: RED_TXT, textShadow: TEXT_SHADOW }}>
            {currentScore.total != null ? Number(currentScore.total).toFixed(2) : '--'}
          </div>
          {currentScore.place != null && (
            <div style={{ fontSize: '38px', fontWeight: 700, opacity: 0.9, textShadow: TEXT_SHADOW }}>
              {ordinal(currentScore.place)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DualBar({ side, bib, name, total, label, xLeft }) {
  const bg = side === 'blue' ? BLUE_GRADIENT : RED_GRADIENT
  const accentLine = side === 'blue' ? '#60A5FA' : '#F87171'
  const hasLabel = !!label
  const top    = hasLabel ? 740 : 820
  const height = hasLabel ? 260 : 180
  return (
    <div style={{
      position: 'absolute', left: `${xLeft}px`, top: `${top}px`,
      width: '840px', height: `${height}px`,
      background: bg, borderRadius: side === 'blue' ? '0 8px 8px 0' : '8px 0 0 8px',
      display: 'flex', flexDirection: 'column',
      boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
      borderBottom: `3px solid ${accentLine}`,
    }}>
      {hasLabel && (
        <div style={{
          fontSize: '46px', fontWeight: 900, textAlign: 'center',
          padding: '14px 0 0 0', letterSpacing: '3px', textShadow: TEXT_SHADOW,
        }}>
          {label}
        </div>
      )}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '32px', padding: '0 44px' }}>
        <div style={{ fontSize: '92px', fontWeight: 900, lineHeight: 1, textShadow: TEXT_SHADOW }}>{bib}</div>
        <div style={{ fontSize: '50px', fontWeight: 800, flex: 1, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textShadow: TEXT_SHADOW }}>
          {name}
        </div>
        {total != null && (
          <div style={{ fontSize: '74px', fontWeight: 900, textShadow: TEXT_SHADOW }}>
            {Number(total).toFixed(0)}
          </div>
        )}
      </div>
    </div>
  )
}

function getDualLabel(state, side) {
  if (!state || !state.scored) return null
  const isWinner = state.winnerSide === side
  if (state.bracketRound !== 1) return isWinner ? 'WINNER' : null
  if (state.isSmallFinal) return isWinner ? '3rd' : '4th'
  return isWinner ? '1st' : '2nd'
}

function ordinal(n) {
  if (n == null) return ''
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
