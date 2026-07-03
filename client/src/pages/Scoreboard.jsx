import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import useResolveIds from '../hooks/useResolveIds';
import PublicLayout from '../components/public/PublicLayout';
import LiveDot from '../components/public/LiveDot';
import StatusPill from '../components/public/StatusPill';
import RankChip from '../components/public/RankChip';
import BibChip from '../components/public/BibChip';
import AthleteCard from '../components/public/AthleteCard';
import DualMatchCard from '../components/public/DualMatchCard';

const DISCIPLINE_LABEL = { mogul: 'MOGULS', dual_mogul: 'DUAL MOGULS', aerials: 'AERIALS' };

function fmt2(n) { if (n == null || n === '' || isNaN(Number(n))) return '–'; return Number(n).toFixed(2); }
function fmt1(n) { if (n == null || n === '' || isNaN(Number(n))) return '–'; return Number(n).toFixed(1); }

export default function Scoreboard() {
  const { eventId: rawEventId } = useParams();
  const { eventId: rEvt, loading: resolving, resolveError } = useResolveIds({ event: rawEventId });
  const eventId = rEvt || rawEventId;

  const [results, setResults] = useState([]);
  const [phaseData, setPhaseData] = useState(null);
  const [event, setEvent] = useState(null);
  const [activeRun, setActiveRun] = useState(null);
  const [dualState, setDualState] = useState(null);
  const [bracketMatches, setBracketMatches] = useState([]);
  const [reviewStatus, setReviewStatus] = useState(null);
  const [expandedRegId, setExpandedRegId] = useState(null);
  const [judgePointsByMatch, setJudgePointsByMatch] = useState({});
  const [expandedMatchId, setExpandedMatchId] = useState(null);
  const [dualTab, setDualTab] = useState('match');
  const [placements, setPlacements] = useState([]);
  const [judgeScores, setJudgeScores] = useState({});
  const [allRuns, setAllRuns] = useState([]);
  const [upcoming, setUpcoming] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const wsRef = useRef(null);
  // Timestamp of the last state-mutating WebSocket message. The 5-second poll
  // skips one cycle if a WS message already refreshed state recently — avoids
  // a stale poll response landing after a fresh WS-triggered load.
  const lastWsAtRef = useRef(0);

  const isDual = event && event.discipline === 'dual_mogul';

  const downloadPdf = async (endpoint, suffix) => {
    if (!event || event.status !== 'complete' || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/pdf/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: event.id }),
      });
      if (!res.ok) throw new Error('PDF failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(event.name || 'event').replace(/\s+/g, '_')}_${suffix}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('PDF download failed:', e);
    } finally {
      setDownloading(false);
    }
  };

  const loadEvent = async () => {
    try {
      const ev = await fetch(`/api/events/${eventId}`).then(r => r.json());
      setEvent(ev);
    } catch {}
  };

  const loadResults = async () => {
    try {
      const [res, active, pd, jsData, up] = await Promise.all([
        fetch(`/api/events/${eventId}/results`).then(r => r.json()),
        fetch(`/api/events/${eventId}/runs/active`).then(r => r.json()),
        fetch(`/api/events/${eventId}/phases/results`).then(r => r.json()).catch(() => null),
        fetch(`/api/events/${eventId}/results/judge-scores`).then(r => r.json()).catch(() => null),
        fetch(`/api/events/${eventId}/runs/upcoming`).then(r => r.json()).catch(() => null),
      ]);
      setResults(res);
      setActiveRun(active && !active.event_completed ? active : null);
      setPhaseData(pd && pd.format !== 'none' ? pd : null);
      if (jsData) {
        setJudgeScores(jsData.judgeScores || {});
        setAllRuns(jsData.runs || []);
      }
      setUpcoming(up && Array.isArray(up.athletes) ? up : null);
    } catch {}
  };

  const loadActiveDual = async () => {
    try {
      const r = await fetch(`/api/events/${eventId}/dual/active-match`);
      if (!r.ok) return;
      const data = await r.json();
      if (!data || !data.id) {
        setDualState(null);
        return;
      }
      setDualState(prev => ({
        matchId: data.id,
        blue: { bib: data.blue_bib || '', name: [data.blue_first, data.blue_last].filter(Boolean).join(' '), first: data.blue_first, last: data.blue_last },
        red: { bib: data.red_bib || '', name: [data.red_first, data.red_last].filter(Boolean).join(' '), first: data.red_first, last: data.red_last },
        blueTotal: prev && prev.matchId === data.id ? prev.blueTotal : null,
        redTotal: prev && prev.matchId === data.id ? prev.redTotal : null,
        winner: prev && prev.matchId === data.id ? prev.winner : null,
        scored: prev && prev.matchId === data.id ? prev.scored : false,
        njCall: data.nj_call || null,   // v1.29.00 (FS-18)
      }));
    } catch {}
  };

  const loadBracket = async () => {
    try {
      const r = await fetch(`/api/events/${eventId}/dual`);
      if (!r.ok) return;
      const data = await r.json();
      const matches = Array.isArray(data) ? data : [];
      setBracketMatches(matches);
      loadJudgePointsForBracket(matches);
    } catch {}
  };

  const loadJudgePointsForBracket = async (matches) => {
    try {
      const eligible = matches.filter(m => !m.is_bye && m.status === 'complete');
      if (eligible.length === 0) {
        setJudgePointsByMatch({});
        return;
      }
      const results = await Promise.all(
        eligible.map(m =>
          fetch(`/api/events/${eventId}/dual/${m.id}/judge-points`)
            .then(r => r.ok ? r.json() : null)
            // v1.29.00 -- keep the engine result too: effectiveBreakdown
            // carries the NJ-overridden / tie-credited per-judge values
            .then(data => [m.id, {
              rows: Array.isArray(data?.rows) ? data.rows : [],
              result: data?.result || null,
            }])
            .catch(() => [m.id, { rows: [], result: null }])
        )
      );
      const map = {};
      for (const [id, entry] of results) map[id] = entry;
      setJudgePointsByMatch(map);
    } catch {}
  };

  const loadPlacements = async () => {
    try {
      const r = await fetch(`/api/events/${eventId}/results`);
      if (!r.ok) return;
      const data = await r.json();
      setPlacements(Array.isArray(data) ? data : []);
    } catch {}
  };

  const loadReviewState = async () => {
    try {
      const r = await fetch(`/api/events/${eventId}/dual/review-state`);
      if (!r.ok) return;
      const data = await r.json();
      setReviewStatus(data.status || null);
    } catch {}
  };

  useEffect(() => { if (!resolving && !resolveError) loadEvent(); }, [eventId, resolving, resolveError]);

  useEffect(() => {
    if (event == null) return;
    if (isDual) {
      loadActiveDual();
      loadBracket();
      loadPlacements();
      loadReviewState();
    } else {
      loadResults();
    }

    const iv = setInterval(() => {
      // If a WebSocket message refreshed state within the last 4s, the WS
      // pipeline already covered this cycle — skip to avoid a stale fetch
      // overwriting fresher data.
      if (Date.now() - lastWsAtRef.current < 4000) return;
      if (isDual) {
        loadActiveDual();
        loadBracket();
        loadPlacements();
        loadReviewState();
      } else {
        loadResults();
      }
    }, 5000);

    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProto}//${location.host}`);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.eventId !== eventId) return;
        const d = msg.data || {};
        lastWsAtRef.current = Date.now();
        if (isDual) {
          if (msg.type === 'dual_match_started') {
            loadActiveDual();
            loadBracket();
            loadPlacements();
          } else if (msg.type === 'score_update' && d.isDual) {
            setDualState(prev => {
              const base = prev || {
                matchId: d.matchId,
                blue: d.blue ? { bib: d.blue.bib || '', name: d.blue.name || '', first: d.blue.first, last: d.blue.last } : { bib: '', name: '' },
                red: d.red ? { bib: d.red.bib || '', name: d.red.name || '', first: d.red.first, last: d.red.last } : { bib: '', name: '' },
              };
              let winner = null;
              if (d.winner && d.blue && d.winner.registrationId === d.blue.registrationId) winner = 'blue';
              else if (d.winner && d.red && d.winner.registrationId === d.red.registrationId) winner = 'red';
              return {
                ...base,
                matchId: d.matchId || base.matchId,
                blueTotal: d.blueTotal,
                redTotal: d.redTotal,
                winner,
                scored: true,
              };
            });
            loadBracket();
            loadPlacements();
          } else if (msg.type === 'run_updated' && d.dualComplete) {
            loadBracket();
            loadPlacements();
          } else if (msg.type === 'dual_nj_update' || msg.type === 'dual_points_update') {
            // v1.29.00 -- NJ call set/cleared or live points changed
            loadActiveDual();
            loadBracket();
          } else if (msg.type === 'dual_match_cleared') {
            setDualState(null);
            loadBracket();
            loadPlacements();
          } else if (msg.type === 'dual_bracket_review' || msg.type === 'dual_bracket_sent_back') {
            loadReviewState();
            loadBracket();
            loadPlacements();
          } else if (msg.type === 'event_finalized') {
            setReviewStatus('approved');
            loadEvent();
            loadBracket();
            loadPlacements();
          }
        } else {
          if (msg.type === 'score_update' || msg.type === 'run_started' || msg.type === 'run_updated') {
            loadResults();
          }
        }
      } catch {}
    };
    wsRef.current = ws;
    return () => { clearInterval(iv); ws.close(); };
  }, [eventId, event, isDual]);

  useEffect(() => {
    if (expandedMatchId && !bracketMatches.some(m => m.id === expandedMatchId)) {
      setExpandedMatchId(null);
    }
  }, [bracketMatches, expandedMatchId]);

  const toggleExpand = (regId) => setExpandedRegId(prev => prev === regId ? null : regId);

  const getRunsForReg = (regId) => allRuns
    .filter(r => r.registration_id === regId)
    .sort((a, b) => a.run_number - b.run_number);

  const eventLabel = event ? `${(event.gender === 'M' ? 'MEN' : event.gender === 'F' ? 'WOMEN' : '')} ${DISCIPLINE_LABEL[event.discipline] || ''}`.trim() : '';

  // Short-code resolution failed — show a clear not-found state instead of a
  // blank page. Caller probably has a bad/stale URL or scanned an outdated QR.
  if (!resolving && resolveError) {
    return (
      <PublicLayout>
        <div style={{ minHeight: '100vh', background: 'var(--gradient-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 480, textAlign: 'center', background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 16, padding: 32 }}>
            <div className="sk-display" style={{ fontSize: 28, color: 'var(--fg)', marginBottom: 12 }}>Event not found</div>
            <div style={{ color: 'var(--fg-muted)', fontSize: 14, lineHeight: 1.5 }}>
              The link or short code <span className="sk-mono" style={{ color: 'var(--fg)' }}>{rawEventId}</span> doesn't match any event. The event may have been deleted, or the URL may be mistyped or out of date.
            </div>
            <a href="/livescores" style={{ display: 'inline-block', marginTop: 20, padding: '10px 18px', borderRadius: 8, background: 'var(--blue)', color: '#fff', textDecoration: 'none', fontWeight: 600 }}>View live scores</a>
          </div>
        </div>
      </PublicLayout>
    );
  }

  // -----------------------------
  //  DUAL MOGUL
  // -----------------------------
  if (isDual) {
    return (
      <PublicLayout>
        <DualScoreboard
          event={event}
          eventLabel={eventLabel}
          dualState={dualState}
          bracketMatches={bracketMatches}
          judgePointsByMatch={judgePointsByMatch}
          placements={placements}
          reviewStatus={reviewStatus}
          dualTab={dualTab}
          setDualTab={setDualTab}
          expandedMatchId={expandedMatchId}
          setExpandedMatchId={setExpandedMatchId}
          downloading={downloading}
          downloadPdf={downloadPdf}
        />
      </PublicLayout>
    );
  }

  // -----------------------------
  //  MOGUL / AERIALS
  // -----------------------------
  return (
    <PublicLayout>
      <div style={{ minHeight: '100vh', background: 'var(--gradient-bg)', paddingBottom: 80 }}>
        <ScoreboardHeader event={event} eventLabel={eventLabel} />
        {activeRun && <NowCompetingBanner run={activeRun} />}
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 16px' }}>
          {event?.status === 'complete' && (
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <button
                disabled={downloading}
                onClick={() => downloadPdf('event-results-detailed', 'event_results_detailed')}
                className="sk-display"
                style={{
                  padding: '10px 22px',
                  borderRadius: 10,
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border)',
                  color: 'var(--fg)',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  cursor: downloading ? 'wait' : 'pointer',
                  opacity: downloading ? 0.6 : 1
                }}
              >
                {downloading ? 'PREPARING…' : '↓ DOWNLOAD PDF'}
              </button>
            </div>
          )}

          {phaseData && phaseData.format === 'best_of_2' ? (
            <BestOfTwoLayout
              phaseData={phaseData}
              event={event}
              expandedRegId={expandedRegId}
              toggleExpand={toggleExpand}
              judgeScores={judgeScores}
              getRunsForReg={getRunsForReg}
            />
          ) : phaseData && phaseData.format === 'qualifier_finals' ? (
            <QualifierFinalsLayout
              phaseData={phaseData}
              event={event}
              expandedRegId={expandedRegId}
              toggleExpand={toggleExpand}
              judgeScores={judgeScores}
              getRunsForReg={getRunsForReg}
            />
          ) : (
            <StandardLayout
              results={results}
              event={event}
              expandedRegId={expandedRegId}
              toggleExpand={toggleExpand}
              judgeScores={judgeScores}
              getRunsForReg={getRunsForReg}
            />
          )}

          <UpcomingAthletes data={upcoming} />
        </div>
      </div>
    </PublicLayout>
  );
}

// =============================================================================
// Header
// =============================================================================
function ScoreboardHeader({ event, eventLabel }) {
  return (
    <div style={{
      maxWidth: 760,
      margin: '0 auto',
      padding: '24px 16px 16px',
      textAlign: 'center'
    }}>
      <div className="sk-display" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.3em', color: 'var(--fg-dim)', marginBottom: 4 }}>
        STICKIT · LIVE SCOREBOARD
      </div>
      <div className="sk-display" style={{ fontSize: 26, fontWeight: 800, letterSpacing: '0.04em', color: 'var(--fg)' }}>
        {eventLabel || 'EVENT'}
      </div>
      {event?.name && (
        <div style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 4 }}>
          {event.name}
        </div>
      )}
      {event && (
        <div style={{ marginTop: 10, display: 'flex', justifyContent: 'center' }}>
          <StatusPill status={event.status} />
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Now Competing banner
// =============================================================================
function NowCompetingBanner({ run }) {
  return (
    // Outer container centers the banner and provides 16px horizontal padding
    // so it doesn't touch the screen edges on narrow viewports. The inner
    // element holds the gradient background and content.
    <div style={{ maxWidth: 760, margin: '0 auto 20px', padding: '0 16px' }}>
      <div style={{
        padding: '16px 20px',
        background: 'var(--gradient-red)',
        borderRadius: 14,
        boxShadow: '0 6px 24px rgba(230,57,70,0.35)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        gap: 14
      }}>
        <LiveDot size={10} color="#fff" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sk-display" style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.2em', opacity: 0.9 }}>
            NOW COMPETING
          </div>
          <div className="sk-display" style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.1 }}>
            {(run.last_name || '').toUpperCase()}, {run.first_name || ''}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="sk-display" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', opacity: 0.85 }}>
            BIB
          </div>
          <div className="sk-mono" style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>
            {run.bib_number ?? '–'}
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Standard layout
// =============================================================================
function buildAthleteRowsStd(results) {
  return results.map(r => {
    const status = r.run_status && ['DNS', 'DNF', 'DSQ', 'RNS', 'SCR'].includes(r.run_status) ? r.run_status : null;
    const bestRun = {
      id: r.run_id || r.id,
      run_id: r.run_id || r.id,
      total_score: r.total_score,
      turns_score: r.turns_score,
      air_score: r.air_score,
      speed_score: r.speed_score,
      run_time: r.run_time,
      run_number: r.run_number,
      jump1_code: r.jump1_code,
      jump2_code: r.jump2_code,
      run_status: r.run_status,
    };
    return {
      regId: r.registration_id || r.id,
      rank: r.rank,
      bib: r.bib_number,
      first: r.first_name,
      last: r.last_name,
      club: r.club,
      total: r.total_score,
      status,
      bestRun
    };
  });
}

function StandardLayout({ results, event, expandedRegId, toggleExpand, judgeScores, getRunsForReg }) {
  const rows = useMemo(() => buildAthleteRowsStd(results), [results]);
  if (rows.length === 0) {
    return <EmptyState />;
  }
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map(row => {
        const allRuns = getRunsForReg(row.regId).map(r => ({ ...r, phaseLabel: `Run ${r.run_number}` }));
        return (
          <AthleteCard
            key={row.regId}
            rank={row.rank}
            bib={row.bib}
            firstName={row.first}
            lastName={row.last}
            club={row.club}
            bestRun={row.bestRun}
            allRuns={allRuns}
            judgeScoresMap={judgeScores}
            totalScore={row.total}
            status={row.status}
            expanded={expandedRegId === row.regId}
            onToggle={() => toggleExpand(row.regId)}
          />
        );
      })}
    </div>
  );
}

// =============================================================================
// Best of 2 layout
// =============================================================================
function BestOfTwoLayout({ phaseData, event, expandedRegId, toggleExpand, judgeScores, getRunsForReg }) {
  const phases = phaseData.phases || [];
  const rows = phaseData.results || [];
  if (rows.length === 0) {
    return <EmptyState />;
  }
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map(r => {
        const regId = r.registration_id || r.id;
        const status = r.run_status && ['DNS', 'DNF', 'DSQ', 'RNS', 'SCR'].includes(r.run_status) ? r.run_status : null;
        const phaseRuns = r.runs || {};

        // Identify the run that produced the best total
        const sortedRuns = Object.values(phaseRuns)
          .filter(rr => !rr.run_status)
          .sort((a, b) => (b.total_score || 0) - (a.total_score || 0));
        const bestRun = sortedRuns[0] || null;
        const allRuns = phases.map(p => {
          const rd = phaseRuns[p.run_number];
          return rd ? { ...rd, phaseLabel: p.label } : { run_number: p.run_number, phaseLabel: p.label };
        });

        return (
          <AthleteCard
            key={regId}
            rank={r.rank}
            bib={r.bib_number}
            firstName={r.first_name}
            lastName={r.last_name}
            club={r.club}
            bestRun={bestRun}
            allRuns={allRuns}
            judgeScoresMap={judgeScores}
            totalScore={r.total_score}
            status={status}
            expanded={expandedRegId === regId}
            onToggle={() => toggleExpand(regId)}
          />
        );
      })}
    </div>
  );
}

// =============================================================================
// Qualifier / Finals layout
// =============================================================================
function QualifierFinalsLayout({ phaseData, event, expandedRegId, toggleExpand, judgeScores, getRunsForReg }) {
  const tiers = {};
  for (const r of phaseData.results || []) {
    const t = r.tier || 'qualifier';
    if (!tiers[t]) tiers[t] = [];
    tiers[t].push(r);
  }
  // v1.26.00: DNF/RNS/DNS athletes carry their real tier key (they sit at the
  // bottom of that tier); only DSQ athletes land in the event-bottom 'flagged'
  // group, so it is labeled DSQ.
  const tierOrder = ['final_2', 'final_1', 'qualifier', 'flagged'];
  const tierLabels = { final_2: 'FINAL 2', final_1: 'FINAL 1', qualifier: 'QUALIFICATION', flagged: 'DSQ' };

  if ((phaseData.results || []).length === 0) return <EmptyState />;

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      {tierOrder.map(tier => {
        const rows = tiers[tier];
        if (!rows || rows.length === 0) return null;
        return (
          <div key={tier}>
            {tierLabels[tier] && (
              <div className="sk-display" style={{
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: '0.2em',
                color: 'var(--fg-muted)',
                paddingLeft: 4,
                marginBottom: 10
              }}>
                {tierLabels[tier]}
              </div>
            )}
            <div style={{ display: 'grid', gap: 10 }}>
              {rows.map(r => {
                const regId = r.registration_id || r.id;
                const status = r.run_status && ['DNS', 'DNF', 'DSQ', 'RNS', 'SCR'].includes(r.run_status) ? r.run_status : null;
                const bestRun = {
                  id: r.run_id || r.id,
                  run_id: r.run_id || r.id,
                  total_score: r.total_score,
                  turns_score: r.turns_score,
                  air_score: r.air_score,
                  speed_score: r.speed_score,
                  run_time: r.run_time,
                  jump1_code: r.jump1_code,
                  jump2_code: r.jump2_code,
                };
                const allRuns = getRunsForReg(regId).map(rr => ({ ...rr, phaseLabel: `Run ${rr.run_number}` }));
                return (
                  <AthleteCard
                    key={regId}
                    rank={r.rank}
                    bib={r.bib_number}
                    firstName={r.first_name}
                    lastName={r.last_name}
                    club={r.club}
                    bestRun={bestRun}
                    allRuns={allRuns}
                    judgeScoresMap={judgeScores}
                    totalScore={r.total_score}
                    status={status}
                    expanded={expandedRegId === regId}
                    onToggle={() => toggleExpand(regId)}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{
      padding: '60px 20px',
      textAlign: 'center',
      color: 'var(--fg-dim)',
      background: 'var(--bg-panel)',
      borderRadius: 14,
      border: '1px solid var(--border)'
    }}>
      No results yet
    </div>
  );
}

// =============================================================================
// Upcoming Athletes
// =============================================================================
function UpcomingAthletes({ data }) {
  if (!data || !Array.isArray(data.athletes) || data.athletes.length === 0) return null;
  const heading = data.phase_label ? `${data.phase_label} — Up Next` : 'Up Next';
  return (
    <div style={{
      marginTop: 24,
      background: 'var(--bg-panel)',
      borderRadius: 14,
      border: '1px solid var(--border)',
      overflow: 'hidden',
      opacity: 0.85
    }}>
      <div className="sk-display" style={{
        padding: '10px 16px',
        fontSize: 11,
        letterSpacing: '0.2em',
        color: 'var(--fg-muted)',
        fontWeight: 700,
        background: 'var(--bg-elev)',
        borderBottom: '1px solid var(--border)'
      }}>
        {heading}
      </div>
      <div>
        {data.athletes.map((a, i) => (
          <div
            key={a.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 16px',
              borderBottom: i < data.athletes.length - 1 ? '1px solid var(--border)' : 'none'
            }}
          >
            <span className="sk-mono" style={{ fontSize: 12, color: 'var(--fg-dim)', minWidth: 30 }}>
              {a.run_order}
            </span>
            <BibChip bib={a.bib_number} size="sm" />
            <span className="sk-display" style={{ fontSize: 13, color: 'var(--fg)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {a.last_name}, {a.first_name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// DUAL Scoreboard
// =============================================================================
function DualScoreboard({
  event, eventLabel, dualState, bracketMatches, judgePointsByMatch,
  placements, reviewStatus, dualTab, setDualTab,
  expandedMatchId, setExpandedMatchId, downloading, downloadPdf
}) {
  // Find the most recently completed match for fallback (by updated_at DESC, not bracket order)
  const recentCompleted = useMemo(() => {
    const done = bracketMatches.filter(m => !m.is_bye && m.status === 'complete');
    if (done.length === 0) return null;
    const sorted = [...done].sort((a, b) => {
      const aT = a.updated_at || '';
      const bT = b.updated_at || '';
      if (aT !== bT) return bT.localeCompare(aT);
      // tie-break by deepest round (closer to finals) then position
      if (a.bracket_round !== b.bracket_round) return a.bracket_round - b.bracket_round;
      return (a.bracket_position || 0) - (b.bracket_position || 0);
    });
    return sorted[0];
  }, [bracketMatches]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--gradient-bg)', paddingBottom: 80 }}>
      <ScoreboardHeader event={event} eventLabel={eventLabel} />

      {/* Banner row */}
      <div style={{ maxWidth: 880, margin: '0 auto 16px', padding: '0 16px' }}>
        {dualState ? (
          <div style={{
            padding: '14px 18px',
            background: 'var(--gradient-red)',
            borderRadius: 14,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            boxShadow: '0 6px 24px rgba(230,57,70,0.3)'
          }}>
            <LiveDot size={10} color="#fff" />
            <div className="sk-display" style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.15em' }}>
              NOW COMPETING — {dualState.blue.last || ''} VS {dualState.red.last || ''}
            </div>
          </div>
        ) : (event && event.status === 'complete') || reviewStatus === 'approved' ? (
          <div style={{
            padding: '14px 18px',
            background: 'var(--bg-panel)',
            borderRadius: 14,
            border: '1px solid var(--blue)',
            color: 'var(--fg)',
            textAlign: 'center'
          }}>
            <div className="sk-display" style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.15em', color: 'var(--blue)' }}>
              EVENT FINALIZED
            </div>
          </div>
        ) : reviewStatus === 'pending' || reviewStatus === 'sent_back' ? (
          <div style={{
            padding: '14px 18px',
            background: 'var(--bg-panel)',
            borderRadius: 14,
            border: '1px solid var(--gold)',
            color: 'var(--fg)',
            textAlign: 'center'
          }}>
            <div className="sk-display" style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.15em', color: 'var(--gold)' }}>
              AWAITING HEAD JUDGE APPROVAL
            </div>
          </div>
        ) : null}
      </div>

      {/* Tabs */}
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '0 16px' }}>
        <div style={{
          display: 'flex',
          gap: 2,
          background: 'var(--bg-panel)',
          padding: 4,
          borderRadius: 12,
          border: '1px solid var(--border)',
          marginBottom: 20
        }}>
          {['match', 'bracket', 'place'].map(t => (
            <button
              key={t}
              onClick={() => setDualTab(t)}
              className="sk-display"
              style={{
                flex: 1,
                padding: '10px 12px',
                borderRadius: 8,
                background: dualTab === t ? 'var(--gradient-red)' : 'transparent',
                border: 'none',
                color: dualTab === t ? '#fff' : 'var(--fg-muted)',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.15em',
                cursor: 'pointer'
              }}
            >
              {t.toUpperCase()}
            </button>
          ))}
          {event?.status === 'complete' && (
            <button
              disabled={downloading}
              onClick={() => downloadPdf(
                dualTab === 'bracket' ? 'dual-bracket' : 'dual-results',
                dualTab === 'bracket' ? 'dual_bracket' : 'dual_results',
              )}
              className="sk-display"
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                background: 'var(--bg-elev)',
                border: '1px solid var(--border)',
                color: 'var(--fg)',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.1em',
                cursor: downloading ? 'wait' : 'pointer',
                marginLeft: 8
              }}
            >
              {downloading ? '…' : '↓ PDF'}
            </button>
          )}
        </div>

        {dualTab === 'match' && (
          <DualMatchTab
            dualState={dualState}
            recentCompleted={recentCompleted}
            judgePointsByMatch={judgePointsByMatch}
          />
        )}
        {dualTab === 'bracket' && (
          <DualBracketTab
            bracketMatches={bracketMatches}
            judgePointsByMatch={judgePointsByMatch}
            expandedMatchId={expandedMatchId}
            setExpandedMatchId={setExpandedMatchId}
          />
        )}
        {dualTab === 'place' && (
          <DualPlaceTab
            placements={placements}
            isComplete={(event && event.status === 'complete') || reviewStatus === 'approved'}
          />
        )}
      </div>
    </div>
  );
}

function DualMatchTab({ dualState, recentCompleted, judgePointsByMatch }) {
  if (dualState) {
    const blueAth = { bib_number: dualState.blue.bib, first_name: dualState.blue.first, last_name: dualState.blue.last };
    const redAth = { bib_number: dualState.red.bib, first_name: dualState.red.first, last_name: dualState.red.last };
    const blueP = []; const redP = [];
    return (
      <DualMatchCard
        match={{ round_label: 'CURRENT MATCH' }}
        blueAthlete={blueAth}
        redAthlete={redAth}
        bluePoints={dualState.blueTotal != null ? [dualState.blueTotal] : blueP}
        redPoints={dualState.redTotal != null ? [dualState.redTotal] : redP}
        isLive={true}
        isFinal={false}
        njBlue={dualState.njCall === 'blue' || dualState.njCall === 'both'}
        njRed={dualState.njCall === 'red' || dualState.njCall === 'both'}
      />
    );
  }
  if (recentCompleted) {
    const m = recentCompleted;
    const entry = judgePointsByMatch[m.id] || {};
    // v1.29.00 -- render the EFFECTIVE per-judge values (NJ override, 3/3
    // speed-tie credit, 0/0 air-tie) from the engine, not the raw rows
    const eff = entry.result?.effectiveBreakdown || [];
    const rows = eff.length ? eff : (entry.rows || []).map(p => ({
      bluePoints: p.time_tied ? 0 : (p.blue_points || 0),
      redPoints: p.time_tied ? 0 : (p.red_points || 0),
    }));
    const bluePoints = rows.map(p => p.bluePoints || 0);
    const redPoints = rows.map(p => p.redPoints || 0);
    const winnerSide =
      m.winner_registration_id && m.winner_registration_id === m.registration_id_blue ? 'blue' :
      m.winner_registration_id && m.winner_registration_id === m.registration_id_red  ? 'red'  : null;
    const blueStatus = m.loser_status && winnerSide === 'red' ? m.loser_status : null;
    const redStatus  = m.loser_status && winnerSide === 'blue' ? m.loser_status : null;
    return (
      <div>
        <DualMatchCard
          match={{ round_label: roundLabel(m).toUpperCase() }}
          blueAthlete={{ bib_number: m.blue_bib, first_name: m.blue_first, last_name: m.blue_last }}
          redAthlete={{ bib_number: m.red_bib, first_name: m.red_first, last_name: m.red_last }}
          bluePoints={bluePoints}
          redPoints={redPoints}
          isLive={false}
          isFinal={true}
          winnerSide={winnerSide}
          blueStatus={blueStatus}
          redStatus={redStatus}
          njBlue={m.nj_call === 'blue' || m.nj_call === 'both'}
          njRed={m.nj_call === 'red' || m.nj_call === 'both'}
          tieNote={[entry.result?.speedTied ? 'Speed Tied 3/3' : null, entry.result?.airTied ? 'Air Tied 0/0' : null].filter(Boolean).join(' · ') || null}
        />
        <div className="sk-display" style={{ textAlign: 'center', fontSize: 11, color: 'var(--fg-dim)', letterSpacing: '0.15em', marginTop: 16 }}>
          MOST RECENT COMPLETED MATCH
        </div>
      </div>
    );
  }
  return (
    <div style={{
      padding: 60,
      textAlign: 'center',
      background: 'var(--bg-panel)',
      borderRadius: 14,
      border: '1px solid var(--border)',
      color: 'var(--fg-dim)'
    }}>
      <div className="sk-display" style={{ fontSize: 14, letterSpacing: '0.15em', marginBottom: 8 }}>
        WAITING FOR FIRST MATCH
      </div>
      <div style={{ fontSize: 12 }}>Check the Bracket tab for the upcoming schedule.</div>
    </div>
  );
}

function DualBracketTab({ bracketMatches, judgePointsByMatch, expandedMatchId, setExpandedMatchId }) {
  const mainMatches = bracketMatches.filter(m => !m.is_small_final);
  // F-2: order the consolation block 3/4 final, 5-8 semis, then 5/6 & 7/8 finals.
  const consolOrder = (m) => {
    if (m.bracket_round === 1 && m.bracket_position === 2) return 0; // 3/4 final
    if (m.bracket_round === 2 && m.bracket_position === 3) return 1; // 5-8 semi A
    if (m.bracket_round === 2 && m.bracket_position === 4) return 2; // 5-8 semi B
    if (m.bracket_round === 1 && m.bracket_position === 3) return 3; // 5/6 final
    if (m.bracket_round === 1 && m.bracket_position === 4) return 4; // 7/8 final
    return 9;
  };
  const consolAll = bracketMatches.filter(m => m.is_small_final);
  const hasNew58 = consolAll.some(m => m.bracket_round === 1 && m.bracket_position === 3);
  const consolMatches = consolAll.sort((a, b) => consolOrder(a) - consolOrder(b));
  const totalRound = mainMatches.length > 0 ? Math.max(...mainMatches.map(m => m.bracket_round)) : 0;
  const roundMatches = {};
  for (const m of mainMatches) {
    if (!roundMatches[m.bracket_round]) roundMatches[m.bracket_round] = [];
    roundMatches[m.bracket_round].push(m);
  }
  for (const r in roundMatches) roundMatches[r].sort((a, b) => a.bracket_position - b.bracket_position);
  const rounds = [];
  for (let r = totalRound; r >= 1; r--) rounds.push(r);

  if (bracketMatches.length === 0) {
    return <EmptyState />;
  }

  const sbRoundLabel = (r) => {
    if (r === 1) return 'BIG FINAL';
    if (r === 2) return 'SEMIFINALS';
    if (r === 3) return 'QUARTERFINALS';
    return `ROUND OF ${Math.pow(2, r)}`;
  };

  const CARD_H = 52;
  const GAP = 8;

  return (
    <div style={{
      background: 'var(--bg-panel)',
      borderRadius: 14,
      border: '1px solid var(--border)',
      padding: 16,
      overflowX: 'auto'
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', minWidth: rounds.length * 200 }}>
        {rounds.map((r, colIdx) => {
          const matches = roundMatches[r] || [];
          const spacingMultiplier = Math.pow(2, colIdx);
          const isFinalCol = r === 1;
          return (
            <div key={r} style={{ flexShrink: 0, width: 200 }}>
              <div className="sk-display" style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.15em',
                color: 'var(--fg-muted)',
                marginBottom: 10,
                textAlign: 'center'
              }}>
                {sbRoundLabel(r)}
              </div>
              {isFinalCol && consolMatches.length > 0 ? (
                <div>
                  <div style={{ paddingTop: (spacingMultiplier - 1) * (CARD_H + GAP) / 2 }}>
                    {matches.map(m => (
                      <BracketMatchCard key={m.id} m={m}
                        totalRound={totalRound}
                        expandedMatchId={expandedMatchId}
                        setExpandedMatchId={setExpandedMatchId}
                        judgePointsByMatch={judgePointsByMatch}
                      />
                    ))}
                  </div>
                  <div style={{ display: 'grid', gap: 10, marginTop: 24 }}>
                    {consolMatches.map(m => {
                      // F-2: in the new 5-8 bracket, round-2 small finals are semis
                      // feeding the round-1 5/6 & 7/8 finals. Legacy events kept the
                      // round-2 matches as terminal 5/6 & 7/8 runoffs.
                      const label = m.bracket_round === 1 && m.bracket_position === 2 ? '3RD/4TH'
                        : m.bracket_round === 1 && m.bracket_position === 3 ? '5TH/6TH'
                        : m.bracket_round === 1 && m.bracket_position === 4 ? '7TH/8TH'
                        : m.bracket_round === 2 && m.bracket_position === 3 ? (hasNew58 ? '5-8 SEMIFINAL' : '5TH/6TH RUNOFF')
                        : m.bracket_round === 2 && m.bracket_position === 4 ? (hasNew58 ? '5-8 SEMIFINAL' : '7TH/8TH RUNOFF')
                        : 'CONSOLATION';
                      return (
                        <div key={m.id}>
                          <div className="sk-display" style={{
                            fontSize: 9,
                            fontWeight: 800,
                            letterSpacing: '0.15em',
                            color: 'var(--gold)',
                            marginBottom: 4,
                            textAlign: 'center'
                          }}>
                            {label}
                          </div>
                          <BracketMatchCard m={m}
                            totalRound={totalRound}
                            expandedMatchId={expandedMatchId}
                            setExpandedMatchId={setExpandedMatchId}
                            judgePointsByMatch={judgePointsByMatch}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div style={{ paddingTop: (spacingMultiplier - 1) * (CARD_H + GAP) / 2 }}>
                  {matches.map(m => (
                    <div key={m.id} style={{ marginBottom: (spacingMultiplier - 1) * (CARD_H + GAP) || GAP }}>
                      <BracketMatchCard m={m}
                        totalRound={totalRound}
                        expandedMatchId={expandedMatchId}
                        setExpandedMatchId={setExpandedMatchId}
                        judgePointsByMatch={judgePointsByMatch}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BracketMatchCard({ m, totalRound, expandedMatchId, setExpandedMatchId, judgePointsByMatch }) {
  const blueWon = m.status === 'complete' && m.winner_registration_id === m.registration_id_blue;
  const redWon = m.status === 'complete' && m.winner_registration_id === m.registration_id_red;
  const isDone = m.status === 'complete';
  const blueLost = isDone && redWon;
  const redLost = isDone && blueWon;
  const redOnTop = !m.is_small_final && (totalRound - m.bracket_round) % 2 === 1;

  if (m.is_bye) {
    return (
      <div style={{
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        fontSize: 11,
        padding: 8,
        opacity: 0.6
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--blue)' }}>{m.blue_first ? `${m.blue_last}, ${m.blue_first}` : 'TBD'}</span>
          <span className="sk-display" style={{ fontSize: 9, color: 'var(--fg-dim)', letterSpacing: '0.1em' }}>BYE</span>
        </div>
      </div>
    );
  }

  const isExpandable = isDone;
  const isExpanded = isExpandable && expandedMatchId === m.id;

  const Row = ({ side, first, last, won, lost, total, loserStatus, isTop, nj }) => {
    const grad = side === 'blue' ? 'rgba(59,125,216,0.18)' : 'rgba(230,57,70,0.18)';
    const accentColor = side === 'blue' ? 'var(--blue)' : 'var(--red)';
    return (
      <div style={{
        padding: '6px 10px',
        background: won ? grad : 'transparent',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        borderBottom: isTop ? '1px solid var(--border)' : 'none'
      }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: accentColor, flexShrink: 0 }} />
        <span style={{
          fontSize: 11,
          color: won ? 'var(--fg)' : (first ? 'var(--fg-muted)' : 'var(--fg-dim)'),
          fontWeight: won ? 700 : 500,
          flex: 1,
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          {first ? `${last}, ${first}` : 'TBD'}
        </span>
        {nj && (
          <span className="sk-mono" title="Chop violation — No Jump on bottom air" style={{ fontSize: 10, color: 'var(--gold)', fontWeight: 700 }}>NJ</span>
        )}
        {isDone && total != null && (
          <span className="sk-mono" style={{ fontSize: 11, fontWeight: 700, color: won ? 'var(--fg)' : 'var(--fg-dim)' }}>
            {total}
          </span>
        )}
        {lost && loserStatus && (
          <span className="sk-mono" style={{ fontSize: 10, color: 'var(--red)', fontWeight: 700 }}>{loserStatus}</span>
        )}
      </div>
    );
  };

  const blueRow = (isTop) => <Row side="blue" first={m.blue_first} last={m.blue_last} won={blueWon} lost={blueLost} total={m.blue_total} loserStatus={blueLost && m.loser_status ? m.loser_status : null} isTop={isTop} nj={m.nj_call === 'blue' || m.nj_call === 'both'} />;
  const redRow = (isTop) => <Row side="red" first={m.red_first} last={m.red_last} won={redWon} lost={redLost} total={m.red_total} loserStatus={redLost && m.loser_status ? m.loser_status : null} isTop={isTop} nj={m.nj_call === 'red' || m.nj_call === 'both'} />;

  const onClick = () => isExpandable && setExpandedMatchId(prev => prev === m.id ? null : m.id);

  const renderDetail = () => {
    // v1.29.00 -- expanded detail shows the EFFECTIVE per-judge values (NJ
    // override, 3/3 speed-tie credit, 0/0 air-tie) from the engine result
    const entry = judgePointsByMatch[m.id] || {};
    const eff = entry.result?.effectiveBreakdown || [];
    const rows = eff.length ? eff : (entry.rows || []).map(p => ({
      bluePoints: p.time_tied ? 0 : (p.blue_points ?? 0),
      redPoints: p.time_tied ? 0 : (p.red_points ?? 0),
    }));
    const fmt = (side) => {
      if (!rows.length) return null;
      const parts = rows.map(p => String(side === 'blue' ? (p.bluePoints ?? 0) : (p.redPoints ?? 0)));
      const sum = rows.reduce((acc, p) => acc + (side === 'blue' ? (p.bluePoints || 0) : (p.redPoints || 0)), 0);
      return { expr: parts.join('+'), sum };
    };
    const blue = fmt('blue');
    const red = fmt('red');
    return (
      <div style={{
        padding: '6px 10px',
        background: 'var(--bg)',
        borderTop: '1px solid var(--border)',
        fontSize: 10,
        fontFamily: 'JetBrains Mono, monospace'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--blue)' }}>
          <span>{blue ? blue.expr : '–'}</span>
          <span style={{ fontWeight: 700 }}>{blue ? `= ${blue.sum}` : ''}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--red)' }}>
          <span>{red ? red.expr : '–'}</span>
          <span style={{ fontWeight: 700 }}>{red ? `= ${red.sum}` : ''}</span>
        </div>
      </div>
    );
  };

  return (
    <div
      onClick={isExpandable ? onClick : undefined}
      onTouchEnd={isExpandable ? (e) => { e.preventDefault(); onClick(); } : undefined}
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        overflow: 'hidden',
        cursor: isExpandable ? 'pointer' : 'default'
      }}
    >
      {redOnTop ? redRow(true) : blueRow(true)}
      {redOnTop ? blueRow(false) : redRow(false)}
      {isExpanded && renderDetail()}
    </div>
  );
}

function DualPlaceTab({ placements, isComplete }) {
  if (!isComplete) {
    return (
      <div style={{
        padding: 60,
        textAlign: 'center',
        background: 'var(--bg-panel)',
        borderRadius: 14,
        border: '1px solid var(--border)',
        color: 'var(--fg-dim)'
      }}>
        <div className="sk-display" style={{ fontSize: 14, letterSpacing: '0.15em', marginBottom: 8, color: 'var(--fg-muted)' }}>
          PENDING EVENT RESULTS
        </div>
        <div style={{ fontSize: 12 }}>Final placements will appear once the event is finalized.</div>
      </div>
    );
  }
  if (!placements || placements.length === 0) return <EmptyState />;
  const showFfsp = placements.some(p => p.ffsp != null);
  return (
    <div style={{ background: 'var(--bg-panel)', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '60px 50px 50px 1fr 1fr 80px',
        gap: 10,
        padding: '10px 14px',
        background: 'var(--bg-elev)',
        borderBottom: '1px solid var(--border)',
        fontSize: 10,
        letterSpacing: '0.15em',
        color: 'var(--fg-muted)',
        fontWeight: 700
      }} className="sk-display">
        <span>PLACE</span>
        <span>BIB</span>
        <span>GP</span>
        <span>NAME</span>
        <span>CLUB</span>
        <span style={{ textAlign: 'right' }}>POINTS</span>
      </div>
      {placements.map(r => {
        const flagged = r.run_status === 'DNS' || r.run_status === 'DSQ' || r.reg_status === 'scratched';
        const isTop3 = !flagged && r.rank <= 3;
        return (
          <div
            key={r.registration_id}
            style={{
              display: 'grid',
              gridTemplateColumns: '60px 50px 50px 1fr 1fr 80px',
              gap: 10,
              alignItems: 'center',
              padding: '12px 14px',
              borderBottom: '1px solid var(--border)',
              background: r.rank === 1 ? 'rgba(245,197,24,0.08)' : 'transparent'
            }}
          >
            <span>
              {flagged ? (
                <span className="sk-display" style={{ color: 'var(--red)', fontSize: 12, fontWeight: 700 }}>
                  {r.run_status === 'DSQ' ? 'DSQ' : (r.reg_status === 'scratched' ? 'SCR' : 'DNS')}
                </span>
              ) : (
                <RankChip rank={r.rank} size={28} />
              )}
              {r.run_status === 'DNF' && (
                <span className="sk-display" style={{ marginLeft: 6, fontSize: 10, color: 'var(--gold)', fontWeight: 700 }}>DNF</span>
              )}
            </span>
            <span className="sk-mono" style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{r.bib_number}</span>
            <span className="sk-mono" style={{ fontSize: 11, color: 'var(--fg-dim)' }}>{r.gp}</span>
            <span style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.last_name}, {r.first_name}
            </span>
            <span style={{ fontSize: 12, color: 'var(--fg-muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.club}
            </span>
            <span className="sk-mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg)', textAlign: 'right' }}>
              {r.ffsp != null ? Number(r.ffsp).toFixed(2) : '—'}
            </span>
          </div>
        );
      })}
      {showFfsp && (
        <div style={{
          padding: '10px 14px',
          fontSize: 10,
          color: 'var(--fg-dim)',
          fontStyle: 'italic',
          textAlign: 'center'
        }}>
          Official FFSP scores are calculated by U.S. Ski and Snowboard and are subject to change.
        </div>
      )}
    </div>
  );
}

function roundLabel(m) {
  // F-2: round-1 small finals decide 3/4 (pos 2), 5/6 (pos 3), 7/8 (pos 4);
  // round-2 small finals are the 5-8 consolation semis.
  if (m.bracket_round === 1) {
    if (!m.is_small_final) return 'Final';
    if (m.bracket_position === 3) return '5th Place';
    if (m.bracket_position === 4) return '7th Place';
    return '3rd Place';
  }
  if (m.bracket_round === 2) return m.is_small_final ? '5-8 Semi' : 'Semifinal';
  if (m.bracket_round === 3) return m.is_small_final ? 'QF Consol' : 'Quarterfinal';
  return `Round ${m.bracket_round}`;
}
