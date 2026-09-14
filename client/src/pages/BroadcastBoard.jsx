import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import useResolveIds from '../hooks/useResolveIds';
import BroadcastFrame from '../components/broadcast/BroadcastFrame';
import LeaderRows, { fmtScore } from '../components/broadcast/LeaderRows';
import StillToCome from '../components/broadcast/StillToCome';
import MeetLogoPanel from '../components/broadcast/MeetLogoPanel';
import LatestResult from '../components/broadcast/LatestResult';
import { DualRoundRows, DualFinalsRows, DualComingUp } from '../components/broadcast/DualPairingRows';
import { Podium, PlacesTable } from '../components/broadcast/Podium';
import { dualPosition, isOpen, isPlayable } from '../components/broadcast/broadcastDual';

// StickIt v2.6.00 -- Broadcast Board (/broadcast/:eventId).
//
// A public, read-only, full-screen 1920x1080 results board for the live
// stream crew (YoloBox / OBS browser source), cut to during breaks between
// athletes. It never shows an on-course athlete, is completely
// non-interactive, and rotates its own pages on a timer (12 s per page,
// ?page=4..30 override). Data comes from the same public endpoints the
// Scoreboard and Overlay use (plain fetch, no auth) plus the v2.6.00 logo
// image endpoints; refresh on the WebSocket with a 3 s poll fallback for
// encoders that drop sockets. Nothing here writes.
//
// Board state (derived from data only, never from operator input):
//   waiting          no scored result yet          -> Frame 1 with START LIST
//   moguls_live      mogul / aerials in progress   -> Frame 1 pages (+ Frame 2 after each once a
//                                                     published score exists in the round)
//   dual_round       dual, semifinal block not done -> Frame 3 pages
//   dual_finals      dual, finals block             -> Frame 4
//   placings         every run / the championship complete but not finalized -> Frame 5 UNOFFICIAL
//   complete         event status complete          -> Frame 5 OFFICIAL
// (David's rulings 09-14-26: unfilled dual sides carry feeder placeholders on
// no course; Final Placings show UNOFFICIAL before the Head Judge finalizes.)

const DISCIPLINE_LABEL = { mogul: 'Moguls', dual_mogul: 'Dual Moguls', aerials: 'Aerials' };
const GENDER_LABEL = { M: "Men's", F: "Women's", X: 'Mixed' };
const EN_DASH = '–';
const PAGE_ROWS = 8;
const PLACES_ROWS = 7;
const DEFAULT_PAGE_SECONDS = 12;

function pageSecondsFrom(search) {
  const raw = parseInt(search.get('page'), 10);
  if (!Number.isFinite(raw)) return DEFAULT_PAGE_SECONDS;
  return Math.min(30, Math.max(4, raw));
}

function fmtTime(t) {
  if (t == null || t === '' || isNaN(Number(t))) return null;
  return Number(t).toFixed(2);
}

const fullName = r => [r.first_name, r.last_name].filter(Boolean).join(' ');
const isScored = r => !r.run_status && !r.effective_status;

function genderWordFrom(gender) {
  const g = String(gender || '').trim().toUpperCase();
  if (g === 'F' || g === 'W' || g === 'FEMALE' || g === 'WOMEN' || g === "WOMEN'S") return 'F';
  if (g === 'X' || g === 'MIXED') return 'X';
  return 'M';
}

function formatLine(format, isDual) {
  if (isDual) return 'DUAL BRACKET';
  if (format === 'best_of_2') return 'TWO RUNS, BEST COUNTS';
  if (format === 'qualifier_finals') return 'QUALIFIER + FINALS';
  return 'SINGLE RUN';
}

function getFormat(phases) {
  if (!phases || phases.length === 0) return 'none';
  const types = phases.map(p => p.phase_type);
  if (types.includes('final_1') || types.includes('final_2') || types.includes('qualifier_2')) return 'qualifier_finals';
  if (types.includes('best_of_2')) return 'best_of_2';
  return 'single';
}

async function getJson(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch (_) { return null; }
}

export default function BroadcastBoard() {
  const { eventId: rawEventId } = useParams();
  const [search] = useSearchParams();
  const pageSeconds = pageSecondsFrom(search);
  const { eventId: rEvt, loading: resolving, resolveError } = useResolveIds({ event: rawEventId });
  const eventId = rEvt || rawEventId;

  const [event, setEvent] = useState(null);
  const [meet, setMeet] = useState(null);
  const [clubByReg, setClubByReg] = useState({});   // registration_id -> club (Still To Come team names)
  const [dataLoaded, setDataLoaded] = useState(false);
  const [logos, setLogos] = useState({ hasLogo: false, hasBottomLogo: false });
  const [notFound, setNotFound] = useState(false);

  // Moguls / aerials
  const [results, setResults] = useState([]);
  const [phasesStatus, setPhasesStatus] = useState([]);
  const [phaseResults, setPhaseResults] = useState(null);
  const [upcoming, setUpcoming] = useState(null);
  const [activeRun, setActiveRun] = useState(null);
  const [latestRunId, setLatestRunId] = useState(null);

  // Dual
  const [bracket, setBracket] = useState([]);
  const [activeMatchId, setActiveMatchId] = useState(null);
  const [roundState, setRoundState] = useState(null);
  const [placements, setPlacements] = useState([]);

  const [pageIndex, setPageIndex] = useState(0);

  const loadSeq = useRef(0);
  const knownRunIds = useRef(null);       // scored run ids of the active round at the last load
  const disciplineRef = useRef(null);

  // ── Event + meet ────────────────────────────────────────────────────────
  const loadEvent = async () => {
    const ev = await getJson(`/api/events/${eventId}`);
    if (!ev || !ev.id) { setNotFound(true); return null; }
    setNotFound(false);
    setEvent(ev);
    disciplineRef.current = ev.discipline;
    if (ev.meet_id) {
      const m = await getJson(`/api/meets/${ev.meet_id}`);
      if (m && m.id) setMeet({ id: m.id, name: m.name });
      // The public /runs/upcoming rows carry no team; the meet-scoped event
      // GET (public, read-only) lists every registration with the club.
      const full = await getJson(`/api/meets/${ev.meet_id}/events/${ev.id}`);
      if (full && Array.isArray(full.registrations)) {
        const map = {};
        for (const r of full.registrations) map[r.id] = r.club || '';
        setClubByReg(map);
      }
      const [l, b] = await Promise.all([
        getJson(`/api/pdf/logo/${ev.meet_id}`),
        getJson(`/api/pdf/bottom-logo/${ev.meet_id}`),
      ]);
      setLogos({ hasLogo: !!(l && l.hasLogo), hasBottomLogo: !!(b && b.hasLogo) });
    }
    return ev;
  };

  // ── Data (discipline-specific) ──────────────────────────────────────────
  const loadData = async () => {
    const seq = ++loadSeq.current;
    const discipline = disciplineRef.current;
    if (!discipline) return;
    if (discipline === 'dual_mogul') {
      const [rows, active, rs, placed] = await Promise.all([
        getJson(`/api/events/${eventId}/dual`),
        getJson(`/api/events/${eventId}/dual/active-match`),
        getJson(`/api/events/${eventId}/dual/round-state`),
        getJson(`/api/events/${eventId}/results`),
      ]);
      if (seq !== loadSeq.current) return;   // a newer load already landed
      setBracket(Array.isArray(rows) ? rows : []);
      setActiveMatchId(active && active.id ? active.id : null);
      setRoundState(rs && typeof rs === 'object' ? rs : null);
      setPlacements(Array.isArray(placed) ? placed : []);
      setDataLoaded(true);
      return;
    }
    const [res, ps, pr, up, act] = await Promise.all([
      getJson(`/api/events/${eventId}/results`),
      getJson(`/api/events/${eventId}/phases/status`),
      getJson(`/api/events/${eventId}/phases/results`),
      getJson(`/api/events/${eventId}/runs/upcoming`),
      getJson(`/api/events/${eventId}/runs/active`),
    ]);
    if (seq !== loadSeq.current) return;
    const resultRows = Array.isArray(res) ? res : [];
    const phaseRows = Array.isArray(ps) ? ps : [];
    const upcomingData = up && Array.isArray(up.athletes) ? up : { run_number: null, phase_label: null, athletes: [] };
    setResults(resultRows);
    setPhasesStatus(phaseRows);
    setPhaseResults(pr && pr.format && pr.format !== 'none' ? pr : null);
    setUpcoming(upcomingData);
    setActiveRun(act && act.id && !act.event_completed ? act : null);
    setDataLoaded(true);

    // Latest Result detection: the scored runs of the active round. A run id
    // that is new since the last load is the latest; on the very first load
    // fall back to the most recently updated results row of that round.
    const round = activeRoundNumber(upcomingData, resultRows, phaseRows);
    const roundRuns = runsOfRound(pr, resultRows, round);
    const ids = new Set(roundRuns.map(r => r.id));
    if (knownRunIds.current === null) {
      const inRound = resultRows.filter(r => isScored(r) && Number(r.run_number) === round && r.updated_at);
      const latest = inRound.length ? inRound.reduce((a, b) => (a.updated_at > b.updated_at ? a : b)) : null;
      setLatestRunId(latest ? latest.id : null);
    } else {
      const fresh = roundRuns.filter(r => !knownRunIds.current.has(r.id));
      if (fresh.length) setLatestRunId(fresh[fresh.length - 1].id);
      else setLatestRunId(prev => (prev && !ids.has(prev) ? null : prev));
    }
    knownRunIds.current = ids;
  };

  // ── Initial load, 3 s poll, WebSocket ───────────────────────────────────
  useEffect(() => {
    if (!eventId || resolving || resolveError) return;
    let dead = false;
    let tick = 0;
    const cycle = async () => {
      if (dead) return;
      // Re-read the event row every 5th cycle (status / name changes) and on the first.
      if (tick % 5 === 0 || !disciplineRef.current) {
        const ev = await loadEvent();
        if (!ev) { tick++; return; }
      }
      tick++;
      await loadData();
    };
    cycle();
    const iv = setInterval(cycle, 3000);

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws = null;
    let pending = null;
    try {
      ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      ws.onopen = () => { try { ws.send(JSON.stringify({ type: 'subscribe', eventId })); } catch (_) {} };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (!msg || !msg.type || msg.type === 'connected' || msg.type === 'subscribed') return;
          if (msg.eventId && msg.eventId !== eventId) return;
          const d = msg.data || {};
          if (msg.type === 'score_update' && d.runId && (d.total != null || d.score != null) && !d.is_forerunner && !d.isDual) {
            setLatestRunId(d.runId);
          }
          const reloadEvent = /event_status_changed|run_round_status|event_finalized|dual_bracket_review|sync_applied/.test(msg.type);
          if (pending) clearTimeout(pending);
          pending = setTimeout(async () => {
            pending = null;
            if (dead) return;
            if (reloadEvent) await loadEvent();
            await loadData();
          }, 250);
        } catch (_) {}
      };
    } catch (_) {}

    return () => {
      dead = true;
      clearInterval(iv);
      if (pending) clearTimeout(pending);
      try { if (ws) ws.close(); } catch (_) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, resolving, resolveError]);

  // ── Derived state ───────────────────────────────────────────────────────
  const isDual = event?.discipline === 'dual_mogul';
  const isAerials = event?.discipline === 'aerials';
  const isComplete = event?.status === 'complete';
  const format = getFormat(phasesStatus);

  const scored = useMemo(() => results.filter(isScored), [results]);
  const activeRound = useMemo(() => activeRoundNumber(upcoming, results, phasesStatus), [upcoming, results, phasesStatus]);
  const phaseLabel = useMemo(() => {
    if (isDual || !phasesStatus.length) return null;
    const p = phasesStatus.find(x => Number(x.run_number) === activeRound) || phasesStatus[phasesStatus.length - 1];
    if (!p) return null;
    const m = /^Run (\d+)$/i.exec(p.label || '');
    if (m && phasesStatus.length > 1 && format === 'best_of_2') return `Run ${m[1]} of ${phasesStatus.length}`;
    return p.label || null;
  }, [phasesStatus, activeRound, isDual, format]);

  const latest = useMemo(() => {
    if (isDual || !latestRunId) return null;
    const run = runsOfRound(phaseResults, results, activeRound).find(r => r.id === latestRunId);
    if (!run) return null;
    const row = results.find(r => r.registration_id === run.registration_id);
    if (!row) return null;
    return {
      registration_id: run.registration_id,
      bib: row.bib_number,
      name: fullName(row),
      time: fmtTime(run.run_time),
      total: fmtScore(run.total_score),
      rank: row.rank,
    };
  }, [isDual, latestRunId, phaseResults, results, activeRound]);

  const dual = useMemo(() => {
    if (!isDual) return null;
    return dualPosition(bracket, event?.runoff_option || 'runoff_to_4th', activeMatchId);
  }, [isDual, bracket, event, activeMatchId]);

  // Moguls: every phase complete and nobody still to come -> placings (UNOFFICIAL).
  const mogulsAllDone = !isDual && !isComplete && phasesStatus.length > 0
    && phasesStatus.every(p => p.status === 'complete' || p.status === 'finalized')
    && !activeRun && scored.length > 0 && !(upcoming && upcoming.athletes.length > 0);

  let boardState;
  if (notFound) boardState = 'not_found';
  else if (!event || !dataLoaded) boardState = 'loading';
  else if (isComplete) boardState = 'complete';
  else if (isDual) {
    if (dual.championshipDone) boardState = 'placings';
    else if (dual.current && dual.current.key === 'finals') boardState = 'dual_finals';
    else boardState = 'dual_round';
  } else if (mogulsAllDone) boardState = 'placings';
  else if (scored.length === 0) boardState = 'waiting';
  else boardState = 'moguls_live';

  // ── Pages ───────────────────────────────────────────────────────────────
  const pages = useMemo(() => {
    const out = [];
    if (boardState === 'waiting') {
      const list = upcoming ? upcoming.athletes : [];
      const n = Math.max(1, Math.ceil(list.length / PAGE_ROWS));
      for (let i = 0; i < n; i++) out.push({ kind: 'start', page: i });
      return out;
    }
    if (boardState === 'moguls_live') {
      const n = Math.max(1, Math.ceil(scored.length / PAGE_ROWS));
      for (let i = 0; i < n; i++) {
        out.push({ kind: 'leaders', page: i });
        if (latest) out.push({ kind: 'latest', page: i });
      }
      return out;
    }
    if (boardState === 'dual_round') {
      const rows = dual.current ? dual.current.matches.filter(m => !m.is_bye) : [];
      const n = Math.max(1, Math.ceil(rows.length / PAGE_ROWS));
      for (let i = 0; i < n; i++) out.push({ kind: 'round', page: i });
      return out;
    }
    if (boardState === 'dual_finals') return [{ kind: 'finals', page: 0 }];
    if (boardState === 'placings' || boardState === 'complete') {
      const total = isDual ? placements.length : results.length;
      const rest = Math.max(0, total - 3);
      const n = Math.max(1, Math.ceil(rest / PLACES_ROWS));
      for (let i = 0; i < n; i++) out.push({ kind: 'placings', page: i });
      return out;
    }
    return [{ kind: 'blank', page: 0 }];
  }, [boardState, upcoming, scored, latest, dual, isDual, placements, results]);

  // Page timer: never reset by a data refresh; reset only when the board state changes.
  useEffect(() => { setPageIndex(0); }, [boardState]);
  useEffect(() => {
    const iv = setInterval(() => setPageIndex(i => i + 1), pageSeconds * 1000);
    return () => clearInterval(iv);
  }, [pageSeconds, boardState]);

  const pageCount = pages.length;
  const cur = pages[((pageIndex % pageCount) + pageCount) % pageCount] || pages[0];
  const pageKey = `${boardState}-${cur.kind}-${cur.page}`;

  // ── Header pieces ───────────────────────────────────────────────────────
  const meetName = meet?.name || '';
  const title = event ? (event.name || [GENDER_LABEL[genderWordFrom(event.gender)], DISCIPLINE_LABEL[event.discipline]].filter(Boolean).join(' ')) : '';
  const genderWord = roundState?.gender_word || (event ? (genderWordFrom(event.gender) === 'F' ? 'Female' : 'Male') : '');

  // ── Frames ──────────────────────────────────────────────────────────────
  if (boardState === 'not_found' || (resolveError && !event)) {
    return (
      <BroadcastFrame meetName="" title="StickIt" caption="" pageCount={1} pageIndex={0} pageKey="nf">
        <div className="bb-notice" data-testid="bb-not-found">Event not found</div>
      </BroadcastFrame>
    );
  }
  if (boardState === 'loading') {
    return (
      <BroadcastFrame meetName="" title="" caption="" pageCount={1} pageIndex={0} pageKey="ld">
        <div className="bb-notice">&nbsp;</div>
      </BroadcastFrame>
    );
  }

  const logoPanel = (logos.hasLogo || logos.hasBottomLogo) && event?.meet_id
    ? <MeetLogoPanel meetId={event.meet_id} hasLogo={logos.hasLogo} hasBottomLogo={logos.hasBottomLogo} />
    : null;

  // Frame 1 (+ START LIST) ---------------------------------------------------
  if (cur.kind === 'start' || cur.kind === 'leaders') {
    const start = cur.kind === 'start';
    const source = start ? (upcoming ? upcoming.athletes : []) : scored;
    const from = cur.page * PAGE_ROWS;
    const slice = source.slice(from, from + PAGE_ROWS);
    const rows = slice.map((r, i) => start
      ? { key: r.id, rank: from + i + 1, noMedal: true, bib: r.bib_number, name: fullName(r), time: null, total: null }
      : { key: r.registration_id || r.id, rank: r.rank, bib: r.bib_number, name: fullName(r), time: isAerials ? null : fmtTime(r.run_time), total: fmtScore(r.total_score) });
    const caption = start
      ? `START LIST · ${source.length} ATHLETE${source.length === 1 ? '' : 'S'}`
      : `LEADERS · RANKS ${from + 1}${EN_DASH}${Math.min(from + PAGE_ROWS, source.length)} OF ${source.length}`;
    return (
      <BroadcastFrame meetName={meetName} title={title} phaseLabel={phaseLabel} caption={caption}
                      pageCount={pageCount} pageIndex={pageIndex} pageKey={pageKey}>
        <div className="bb-two-col">
          <div className="bb-main">
            <LeaderRows rows={rows} heading={start ? 'Start list' : 'Leaders'} rankLabel={start ? 'Order' : 'Rank'} showTime={!isAerials}
                        emptyText={start ? 'Start list not set' : 'No results yet'} />
          </div>
          <div className="bb-side">
            <StillToCome athletes={start ? [] : (upcoming ? upcoming.athletes.map(a => ({ ...a, club: clubByReg[a.id] || '' })) : [])}
                         emptyText={start ? 'Waiting for the first run' : 'Round complete'} />
            {logoPanel}
          </div>
        </div>
      </BroadcastFrame>
    );
  }

  // Frame 2 -------------------------------------------------------------------
  if (cur.kind === 'latest' && latest) {
    const top5 = scored.slice(0, 5);
    let rows = top5;
    if (!top5.some(r => r.registration_id === latest.registration_id)) {
      const me = scored.find(r => r.registration_id === latest.registration_id);
      rows = me ? [...scored.slice(0, 4), me] : top5;
    }
    const leaderRows = rows.map(r => ({
      key: r.registration_id, rank: r.rank, bib: r.bib_number, name: fullName(r),
      time: isAerials ? null : fmtTime(r.run_time), total: fmtScore(r.total_score),
      highlight: r.registration_id === latest.registration_id,
    }));
    const caption = `LATEST RESULT · UNOFFICIAL · RANKS 1${EN_DASH}${Math.min(5, scored.length)} OF ${scored.length}`;
    return (
      <BroadcastFrame meetName={meetName} title={title} phaseLabel={phaseLabel} caption={caption}
                      pageCount={pageCount} pageIndex={pageIndex} pageKey={pageKey}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, height: '100%' }}>
          <LatestResult bib={latest.bib} name={latest.name} time={latest.time} total={latest.total} rank={latest.rank} showTime={!isAerials} />
          <LeaderRows rows={leaderRows} heading="Leaders" showTime={!isAerials} />
        </div>
      </BroadcastFrame>
    );
  }

  // Frame 3 -------------------------------------------------------------------
  if (cur.kind === 'round') {
    const block = dual.current;
    const rows = block ? block.matches.filter(m => !m.is_bye) : [];
    const from = cur.page * PAGE_ROWS;
    const slice = rows.slice(from, from + PAGE_ROWS);
    const roundTitle = block
      ? (block.key === 'semis' ? `${genderWord} Semifinals` : (roundState?.active_round_label && dual.nextMatch && dual.nextMatch.id === activeMatchId
          ? roundState.active_round_label
          : `${genderWord} ${(slice[0] && slice[0].round_name) || block.name}`))
      : null;
    const nums = slice.map(m => m.pairing_number).filter(n => n != null);
    const caption = block
      ? `${block.name.toUpperCase()}${nums.length ? ` · PAIRINGS ${nums[0]}${EN_DASH}${nums[nums.length - 1]}` : ''}${rows.length > PAGE_ROWS ? ` OF ${rows.length}` : ''}`
      : 'WAITING FOR THE BRACKET';
    return (
      <BroadcastFrame meetName={meetName} title={title} phaseLabel={roundTitle} caption={caption} legend
                      pageCount={pageCount} pageIndex={pageIndex} pageKey={pageKey}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, height: '100%' }}>
          <DualRoundRows rows={slice} matches={bracket} nextMatchId={dual.nextMatch ? dual.nextMatch.id : null}
                         showRoundChip={!!block && block.key === 'semis'} />
          <DualComingUp block={dual.nextBlock} matches={bracket} />
        </div>
      </BroadcastFrame>
    );
  }

  // Frame 4 -------------------------------------------------------------------
  if (cur.kind === 'finals') {
    const finals = bracket.filter(m => Number(m.bracket_round) === 1 && !m.is_bye);
    const order = m => (!m.is_small_final ? 0 : Number(m.bracket_position));   // championship, 3/4, 5/6, 7/8
    const rows = finals.slice().sort((a, b) => order(a) - order(b));
    return (
      <BroadcastFrame meetName={meetName} title={title} phaseLabel={`${genderWord} Finals`} caption="FINALS BLOCK · RUNS IN REVERSE PLACE ORDER" legend
                      pageCount={pageCount} pageIndex={pageIndex} pageKey={pageKey}>
        <DualFinalsRows rows={rows} matches={bracket} nextMatchId={dual.nextMatch ? dual.nextMatch.id : null} />
      </BroadcastFrame>
    );
  }

  // Frame 5 -------------------------------------------------------------------
  if (cur.kind === 'placings') {
    const official = boardState === 'complete';
    const entries = (isDual ? placements : results).map(r => ({
      key: r.registration_id || `${r.rank}-${r.bib_number}`,
      rank: r.rank, bib: r.bib_number, name: fullName(r), team: r.club || '',
      total: isDual ? null : fmtScore(r.total_score),
      status: r.effective_status || r.run_status || null,
    }));
    const from = 3 + cur.page * PLACES_ROWS;
    const slice = entries.slice(from, from + PLACES_ROWS);
    const last = Math.min(from + PLACES_ROWS, entries.length);
    // Page 1 shows places 1-10 (podium + table); later pages 11-17, 18-24, ...
    const firstShown = cur.page === 0 ? 1 : from + 1;
    const caption = `PLACES ${entries.length ? `${firstShown}${EN_DASH}${Math.max(last, Math.min(3, entries.length))}` : '0'} OF ${entries.length} · ${formatLine(format, isDual)}`;
    return (
      <BroadcastFrame meetName={meetName} title={title} phaseLabel="Final Results" badge={official ? 'OFFICIAL' : 'UNOFFICIAL'}
                      caption={caption} pageCount={pageCount} pageIndex={pageIndex} pageKey={pageKey}>
        <div style={{ display: 'flex', gap: 48, height: '100%' }}>
          <div style={{ width: 872, flexShrink: 0 }}>
            <Podium entries={entries.slice(0, 3)} showTotal={!isDual} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <PlacesTable entries={slice} showTotal={!isDual} />
          </div>
        </div>
      </BroadcastFrame>
    );
  }

  return (
    <BroadcastFrame meetName={meetName} title={title} caption="" pageCount={1} pageIndex={0} pageKey="blank">
      <div className="bb-notice">&nbsp;</div>
    </BroadcastFrame>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────
/** The round the board is "in": the queue's run number, else the highest scored round. */
function activeRoundNumber(upcoming, results, phases) {
  if (upcoming && upcoming.run_number != null) return Number(upcoming.run_number);
  const scoredRounds = (results || []).filter(isScored).map(r => Number(r.run_number)).filter(Number.isFinite);
  if (scoredRounds.length) return Math.max(...scoredRounds);
  if (phases && phases.length) return Number(phases[phases.length - 1].run_number);
  return 1;
}

/** Scored runs (run_status null, total present) of one round: [{ id, registration_id, total_score, run_time }]. */
function runsOfRound(phaseResults, results, round) {
  const out = [];
  if (phaseResults && Array.isArray(phaseResults.results)) {
    for (const r of phaseResults.results) {
      const run = r.runs && r.runs[String(round)];
      if (run && run.id && !run.run_status && run.total_score != null) {
        out.push({ id: run.id, registration_id: r.registration_id, total_score: run.total_score, run_time: run.run_time });
      }
    }
    return out;
  }
  for (const r of results || []) {
    if (isScored(r) && Number(r.run_number) === round && r.id && r.total_score != null) {
      out.push({ id: r.id, registration_id: r.registration_id, total_score: r.total_score, run_time: r.run_time });
    }
  }
  return out;
}
