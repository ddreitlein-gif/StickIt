import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import useResolveIds from '../hooks/useResolveIds';
import OverlayRibbon from '../components/public/OverlayRibbon';
import OverlayAthleteCard from '../components/public/OverlayAthleteCard';
import OverlayScoreReveal from '../components/public/OverlayScoreReveal';
import OverlayDualVS from '../components/public/OverlayDualVS';

// StickIt v1.17.00 Overlay -- 1920x1080 transparent canvas for YoloBox / OBS browser source.
//
// Single mogul / aerials:
//   - run_started -> show athlete card lower-left
//   - score_update with total -> swap to score reveal (animated, centered)
//   - State persists until next run_started. No auto-hide timer.
//
// Dual mogul:
//   - dual_match_started -> fetch active match, show dual VS frame (no scores yet)
//   - score_update (isDual) -> reveal totals + WINNER label on winning side
//   - State persists; reset on next dual_match_started.
//
// Polling (every 3 s) provides a fallback for hardware encoders (YoloBox) that
// do not maintain persistent WebSocket connections.
//
// Server payloads are wrapped: { type, data, eventId }.

const STYLE_ID = 'stickit-overlay-styles';
const FONT_LINK_ID = 'stickit-overlay-fonts';

function injectOverlayStyles() {
  if (typeof document === 'undefined') return;

  if (!document.getElementById(FONT_LINK_ID)) {
    const link = document.createElement('link');
    link.id = FONT_LINK_ID;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700;800&family=Barlow+Condensed:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap';
    document.head.appendChild(link);
  }

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .stickit-overlay-root {
        --bg: #070d1a;
        --bg-panel: #0e1628;
        --bg-elev: #142036;
        --border: #1f2c44;
        --fg: #f5f7fb;
        --fg-muted: #94a3b8;
        --fg-dim: #64748b;
        --red: #e63946;
        --red-dim: #b02a36;
        --blue: #3b7dd8;
        --blue-dim: #2a5ca8;
        --gold: #f5c518;
        --silver: #c0c5cf;
        --bronze: #cd7f32;
        --gradient-red: linear-gradient(135deg, #e63946 0%, #b02a36 100%);
        --gradient-blue: linear-gradient(135deg, #3b7dd8 0%, #1e4d8f 100%);
        font-family: 'Inter Tight', system-ui, -apple-system, sans-serif;
        color: var(--fg);
      }
      .stickit-overlay-root .sk-display {
        font-family: 'Barlow Condensed', 'Inter Tight', sans-serif;
        font-weight: 700;
        letter-spacing: 0.02em;
        text-transform: uppercase;
      }
      .stickit-overlay-root .sk-mono {
        font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
        font-variant-numeric: tabular-nums;
      }
      @keyframes sk-pulse {
        0%   { opacity: 1;   transform: scale(1); }
        50%  { opacity: 0.4; transform: scale(1.6); }
        100% { opacity: 1;   transform: scale(1); }
      }
      @keyframes sk-fade-in {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes sk-score-reveal {
        0%   { opacity: 0; transform: scale(0.6); }
        100% { opacity: 1; transform: scale(1); }
      }
      .stickit-overlay-root .sk-score-reveal {
        animation: sk-score-reveal 480ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
      }
      .stickit-overlay-root .sk-fade-in {
        animation: sk-fade-in 320ms ease-out both;
      }
    `;
    document.head.appendChild(style);
  }
}

const DISCIPLINE_LABEL = { mogul: 'MOGULS', dual_mogul: 'DUAL MOGULS', aerials: 'AERIALS' };
const GENDER_LABEL = { M: 'MEN', F: 'WOMEN', X: 'MIXED' };

function ordinal(n) {
  if (n == null) return '';
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function dualRoundLabel(round, isSmallFinal) {
  if (round === 1) return isSmallFinal ? 'SMALL FINAL' : 'FINAL';
  if (round === 2) return 'SEMIFINAL';
  if (round === 3) return 'QUARTERFINAL';
  if (round === 4) return 'ROUND OF 16';
  if (round === 5) return 'ROUND OF 32';
  if (round === 6) return 'ROUND OF 64';
  return `ROUND ${round}`;
}

export default function Overlay() {
  const { eventId: rawEventId } = useParams();
  const { eventId: rEvt, loading: resolving } = useResolveIds({ event: rawEventId });
  const eventId = rEvt || rawEventId;

  const [event, setEvent] = useState(null);
  const [singleMode, setSingleMode] = useState('idle');  // 'idle' | 'name' | 'score'
  const [currentAthlete, setCurrentAthlete] = useState(null);
  const [currentScore, setCurrentScore] = useState(null);

  const [dualActive, setDualActive] = useState(false);
  const [dualState, setDualState] = useState(null);

  const lastAthleteRef = useRef(null);
  const dualActiveRef = useRef(false);
  const containerRef = useRef(null);
  useEffect(() => { dualActiveRef.current = dualActive; }, [dualActive]);

  const discipline = event?.discipline || null;

  // Inject font link + style block (no body background mutation -- transparent for OBS)
  useLayoutEffect(() => {
    injectOverlayStyles();
  }, []);

  // Make body and html transparent so OBS / YoloBox browser sources show a clear canvas.
  // setProperty 'important' overrides any stylesheet rule (Tailwind @layer base, etc.).
  useLayoutEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    html.style.setProperty('background',       'transparent', 'important');
    html.style.setProperty('background-color', 'transparent', 'important');
    body.style.setProperty('background',       'transparent', 'important');
    body.style.setProperty('background-color', 'transparent', 'important');
    return () => {
      html.style.removeProperty('background');
      html.style.removeProperty('background-color');
      body.style.removeProperty('background');
      body.style.removeProperty('background-color');
    };
  }, []);

  // Scale 1920x1080 canvas to fit viewport. At 1920x1080 in OBS this is exactly 1.0.
  useLayoutEffect(() => {
    const updateScale = () => {
      if (!containerRef.current) return;
      const sx = window.innerWidth / 1920;
      const sy = window.innerHeight / 1080;
      containerRef.current.style.transform = `scale(${Math.min(sx, sy)})`;
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  const fetchActiveDual = async () => {
    try {
      const r = await fetch(`/api/events/${eventId}/dual/active-match`);
      if (!r.ok) return;
      const data = await r.json();
      if (!data || !data.id) return;
      setDualActive(true);
      setDualState({
        matchId: data.id,
        blue: {
          bib_number: data.blue_bib || '',
          first_name: data.blue_first || '',
          last_name: data.blue_last || '',
          club_name: data.blue_club || '',
        },
        red: {
          bib_number: data.red_bib || '',
          first_name: data.red_first || '',
          last_name: data.red_last || '',
          club_name: data.red_club || '',
        },
        blueTotal: null,
        redTotal: null,
        scored: false,
        winnerSide: null,
        bracketRound: data.bracket_round,
        isSmallFinal: !!data.is_small_final,
      });
    } catch (_) {}
  };

  // Hydrate display state on mount (overlay opened mid-event)
  useEffect(() => {
    if (!eventId || resolving) return;
    fetch(`/api/events/${eventId}`)
      .then(r => r.ok ? r.json() : null)
      .then(async ev => {
        if (!ev) return;
        setEvent(ev);
        if (ev.discipline === 'dual_mogul') {
          fetchActiveDual();
          return;
        }
        const active = await fetch(`/api/events/${eventId}/runs/active`).then(r => r.ok ? r.json() : null).catch(() => null);
        if (active && active.id) {
          const athlete = {
            bib_number: active.is_forerunner ? '' : (active.bib_number || ''),
            first_name: active.is_forerunner ? 'Forerunner' : (active.first_name || ''),
            last_name: active.is_forerunner ? '' : (active.last_name || ''),
            club: active.is_forerunner ? '' : (active.club || ''),
          };
          lastAthleteRef.current = athlete;
          setCurrentAthlete(athlete);
          setCurrentScore(null);
          setSingleMode('name');
          return;
        }
        const results = await fetch(`/api/events/${eventId}/results`).then(r => r.ok ? r.json() : null).catch(() => null);
        if (results && results.length > 0) {
          const nonManual = results.filter(r => !r.manually_entered);
          if (nonManual.length > 0) {
            const latest = nonManual.reduce((a, b) => (a.updated_at > b.updated_at ? a : b));
            lastAthleteRef.current = {
              bib_number: latest.bib_number,
              first_name: latest.first_name,
              last_name: latest.last_name,
              club: latest.club || '',
            };
            setCurrentScore({
              total: latest.total_score,
              place: latest.rank,
              first_name: latest.first_name,
              last_name: latest.last_name,
              turns: latest.turns_score,
              air: latest.air_score,
              time: latest.run_time,
              speed: latest.speed_score,
              status: null,
            });
            setSingleMode('score');
          }
        }
      })
      .catch(() => {});
  }, [eventId, resolving]);

  // Polling fallback (3s) for hardware encoders without persistent WS
  useEffect(() => {
    if (!eventId || !discipline || resolving) return;

    const poll = async () => {
      if (discipline === 'dual_mogul') {
        await fetchActiveDual();
        return;
      }
      const active = await fetch(`/api/events/${eventId}/runs/active`).then(r => r.ok ? r.json() : null).catch(() => null);
      if (active && active.id) {
        const athlete = {
          bib_number: active.is_forerunner ? '' : (active.bib_number || ''),
          first_name: active.is_forerunner ? 'Forerunner' : (active.first_name || ''),
          last_name: active.is_forerunner ? '' : (active.last_name || ''),
          club: active.is_forerunner ? '' : (active.club || ''),
        };
        lastAthleteRef.current = athlete;
        setCurrentAthlete(athlete);
        setCurrentScore(null);
        setSingleMode('name');
        return;
      }
      const results = await fetch(`/api/events/${eventId}/results`).then(r => r.ok ? r.json() : null).catch(() => null);
      if (results && results.length > 0) {
        const nonManual = results.filter(r => !r.manually_entered);
        if (nonManual.length > 0) {
          const latest = nonManual.reduce((a, b) => (a.updated_at > b.updated_at ? a : b));
          lastAthleteRef.current = {
            bib_number: latest.bib_number,
            first_name: latest.first_name,
            last_name: latest.last_name,
            club: latest.club || '',
          };
          setCurrentScore({
            total: latest.total_score,
            place: latest.rank,
            first_name: latest.first_name,
            last_name: latest.last_name,
            turns: latest.turns_score,
            air: latest.air_score,
            time: latest.run_time,
            speed: latest.speed_score,
            status: null,
          });
          setSingleMode('score');
        } else {
          setSingleMode('idle');
          setCurrentAthlete(null);
          setCurrentScore(null);
        }
      } else {
        setSingleMode('idle');
        setCurrentAthlete(null);
        setCurrentScore(null);
      }
    };

    poll();
    const iv = setInterval(poll, 3000);
    return () => clearInterval(iv);
  }, [eventId, discipline]);

  // WebSocket
  useEffect(() => {
    if (!eventId) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.eventId && msg.eventId !== eventId) return;
        const d = msg.data || {};

        if (msg.type === 'run_started') {
          if (dualActiveRef.current) return;
          const athlete = {
            bib_number: d.is_forerunner ? '' : (d.bib || d.bib_number || ''),
            first_name: d.is_forerunner ? 'Forerunner' : (d.first_name || ''),
            last_name: d.is_forerunner ? '' : (d.last_name || ''),
            club: d.is_forerunner ? '' : (d.club || ''),
          };
          lastAthleteRef.current = athlete;
          setCurrentAthlete(athlete);
          setCurrentScore(null);
          setSingleMode('name');
          return;
        }

        if (msg.type === 'score_update') {
          if (d.is_forerunner) {
            setSingleMode('idle');
            setCurrentAthlete(null);
            setCurrentScore(null);
            lastAthleteRef.current = null;
            return;
          }
          if (d.isDual) {
            setDualActive(true);
            setDualState(prev => {
              const base = prev || {};
              const blue = d.blue
                ? {
                    bib_number: d.blue.bib_number ?? d.blue.bib ?? base.blue?.bib_number ?? '',
                    first_name: d.blue.first_name ?? base.blue?.first_name ?? '',
                    last_name: d.blue.last_name ?? base.blue?.last_name ?? '',
                    club_name: d.blue.club_name ?? d.blue.club ?? base.blue?.club_name ?? '',
                  }
                : base.blue;
              const red = d.red
                ? {
                    bib_number: d.red.bib_number ?? d.red.bib ?? base.red?.bib_number ?? '',
                    first_name: d.red.first_name ?? base.red?.first_name ?? '',
                    last_name: d.red.last_name ?? base.red?.last_name ?? '',
                    club_name: d.red.club_name ?? d.red.club ?? base.red?.club_name ?? '',
                  }
                : base.red;
              return {
                ...base,
                matchId: d.matchId || base.matchId,
                blue,
                red,
                blueTotal: d.blueTotal,
                redTotal: d.redTotal,
                scored: true,
                winnerSide: (d.blueTotal > d.redTotal) ? 'blue' : 'red',
                bracketRound: d.bracketRound ?? base.bracketRound,
                isSmallFinal: d.isSmallFinal != null ? !!d.isSmallFinal : !!base.isSmallFinal,
              };
            });
            return;
          }

          if (d.total == null && d.score == null) return;
          const total = d.total ?? d.score;
          const place = d.rank ?? d.place ?? null;
          const ath = lastAthleteRef.current;
          setCurrentScore({
            total,
            place,
            first_name: ath?.first_name || '',
            last_name: ath?.last_name || '',
            turns: d.turns_score ?? d.turns ?? null,
            air: d.air_score ?? d.air ?? null,
            time: d.run_time ?? d.time ?? null,
            speed: d.speed_score ?? d.speed ?? null,
            status: d.run_status || null,
          });
          setSingleMode('score');
          return;
        }

        if (msg.type === 'dual_match_started') {
          fetchActiveDual();
          return;
        }

        if (msg.type === 'OVERLAY_HIDE') {
          setSingleMode('idle');
          setCurrentAthlete(null);
          setCurrentScore(null);
          setDualActive(false);
          setDualState(null);
        }
      } catch (_) {}
    };

    return () => { try { ws.close(); } catch (_) {} };
  }, [eventId]);

  const eventLabel = event
    ? [GENDER_LABEL[event.gender], DISCIPLINE_LABEL[event.discipline]].filter(Boolean).join(' ')
    : '';

  let dualBlueLabel = null;
  let dualRedLabel = null;
  if (dualState?.scored) {
    if (dualState.bracketRound === 1) {
      if (dualState.isSmallFinal) {
        dualBlueLabel = dualState.winnerSide === 'blue' ? '3RD' : '4TH';
        dualRedLabel = dualState.winnerSide === 'red' ? '3RD' : '4TH';
      } else {
        dualBlueLabel = dualState.winnerSide === 'blue' ? '1ST' : '2ND';
        dualRedLabel = dualState.winnerSide === 'red' ? '1ST' : '2ND';
      }
    } else {
      dualBlueLabel = dualState.winnerSide === 'blue' ? 'WINNER' : null;
      dualRedLabel = dualState.winnerSide === 'red' ? 'WINNER' : null;
    }
  }

  const showRibbon = !!event;
  const dualRound = dualState ? dualRoundLabel(dualState.bracketRound, dualState.isSmallFinal) : null;

  return (
    <div
      ref={containerRef}
      className="stickit-overlay-root"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '1920px',
        height: '1080px',
        background: 'transparent',
        transformOrigin: 'top left',
        overflow: 'hidden',
      }}
    >
      {/* Ribbon top center -- only shown when we have event context AND something is on screen */}
      {showRibbon && (singleMode !== 'idle' || dualActive) && (
        <div style={{ position: 'absolute', top: 36, left: '50%', transform: 'translateX(-50%)' }}>
          <OverlayRibbon
            eventLabel={eventLabel}
            roundLabel={dualActive ? dualRound : null}
            live={true}
          />
        </div>
      )}

      {/* Dual mogul VS frame */}
      {dualActive && dualState && (
        <div style={{ position: 'absolute', left: '50%', bottom: 100, transform: 'translateX(-50%)' }}>
          <OverlayDualVS
            blueAthlete={dualState.blue}
            redAthlete={dualState.red}
            blueTotal={dualState.scored ? dualState.blueTotal : null}
            redTotal={dualState.scored ? dualState.redTotal : null}
            blueLabel={dualBlueLabel || 'BLUE'}
            redLabel={dualRedLabel || 'RED'}
          />
        </div>
      )}

      {/* Single mogul / aerials -- name (athlete card) */}
      {!dualActive && singleMode === 'name' && currentAthlete && (
        <div style={{ position: 'absolute', left: 80, bottom: 120 }}>
          <OverlayAthleteCard
            bib={currentAthlete.bib_number}
            firstName={currentAthlete.first_name}
            lastName={currentAthlete.last_name}
            club={currentAthlete.club}
          />
        </div>
      )}

      {/* Single mogul / aerials -- score reveal */}
      {!dualActive && singleMode === 'score' && currentScore && (
        <div style={{ position: 'absolute', left: '50%', bottom: 100, transform: 'translateX(-50%)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            {(currentScore.first_name || currentScore.last_name) && (
              <div className="sk-fade-in" style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 14,
                padding: '10px 22px',
                borderRadius: 12,
                background: 'rgba(7,13,26,0.92)',
                border: '1px solid rgba(255,255,255,0.1)',
                backdropFilter: 'blur(10px)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              }}>
                <span className="sk-display" style={{ fontSize: 18, color: '#94a3b8', letterSpacing: '0.1em' }}>
                  {(currentScore.first_name || '').toUpperCase()}
                </span>
                <span className="sk-display" style={{ fontSize: 28, fontWeight: 800, color: '#fff', letterSpacing: '0.04em' }}>
                  {(currentScore.last_name || '').toUpperCase()}
                </span>
              </div>
            )}
            <OverlayScoreReveal
              key={`${currentScore.total}-${currentScore.place}`}
              rank={currentScore.place}
              turns={currentScore.turns}
              air={currentScore.air}
              time={currentScore.time}
              speed={currentScore.speed}
              total={currentScore.total}
              status={currentScore.status}
            />
          </div>
        </div>
      )}
    </div>
  );
}
