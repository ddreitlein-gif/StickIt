import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import api from '../../utils/api'
import { clearRoleMemory, setRoleMemory, judgeRoleLabel, venueRoleLabel, disciplineLabel } from './venueShared'
import { SeatPicker } from './venueWidgets'

/**
 * v2.0.00 (Step 3, FR-15) — auto-follow role wrapper.
 *
 * The tablet's URL is a stable venue role page (/venue/role/judge?seat=J2,
 * /venue/role/hj, /venue/role/timekeeper, /venue/role/scoreboard). The page
 * embeds the EXISTING role page for the active event in an iframe and swaps it
 * automatically as interleaved runs alternate — the role pages themselves are
 * untouched and no device ever needs its URL changed mid-day.
 *
 * FR-10: when the meet enters check-in, every role page freezes with a clear
 * "checking in / checked in — stop" screen so a volunteer cannot keep scoring
 * into a dead end.
 *
 * v2.4.00 (physical test T-2/T-7) — leaving a role. Judge, Head Judge and
 * Timekeeper tablets carry a slim bar ABOVE the embedded page (the iframe is
 * simply shorter, nothing is covered) naming the device's role, seat, judge
 * and the event it follows, with:
 *   - Leave seat (judge only): releases the seat on the server, forgets the
 *     role, returns straight to the seat picker (Crew PIN already entered).
 *   - Change role: releases the seat if any, forgets the role, returns to the
 *     venue menu where each tile asks its own PIN.
 * Both confirm first. The Scoreboard is a TV display — no bar, just a small
 * "Change role" corner button. A reload or reboot still returns the tablet to
 * its remembered role (FR-15); only these explicit actions change it.
 *
 * Same-day discipline switch (singles → duals): seats are positional (J3 is
 * T&L 3 in moguls but the Air judge in duals), so when the followed event's
 * discipline changes the bar turns amber and says what this seat means now,
 * so the judge can keep going or Leave seat and pick the right one.
 *
 * v2.5.03 — Head Judge who also scores as a judge. On the Head Judge page the
 * bar offers "Also score as a judge": the same seat picker the Judge tile
 * uses claims a seat, and the page becomes two in-app tabs — Head Judge and
 * Judge Jn — with BOTH role pages kept mounted (the inactive one is hidden
 * with visibility, never unmounted), so switching is one tap, no PIN, no
 * reload, and a half-entered score survives a hop to the Head Judge tab. The
 * device remembers "hj + seat" as one role (/venue/role/hj?seat=Jn), so a
 * reboot or reload brings both tabs back. "Leave seat" on the judge tab frees
 * only the seat and keeps the Head Judge; "Change role" frees both. The seat
 * auto-follows the active event exactly like a plain judge tablet, including
 * the amber singles ↔ duals notice. The role pages themselves are untouched.
 */

// Only remount an embedded page when its target actually changes.
function sameTarget(prev, t) {
  return !!prev && prev.url === t.url && prev.meet_state === t.meet_state && prev.error === t.error
    && prev.event_name === t.event_name && (prev.judge && prev.judge.id) === (t.judge && t.judge.id)
}

export default function VenueRole() {
  const { role } = useParams()
  const [searchParams] = useSearchParams()
  const seat = searchParams.get('seat') || undefined
  const navigate = useNavigate()
  const [target, setTarget] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [switched, setSwitched] = useState(null) // { from, to } after a discipline change
  const prevDisciplineRef = useRef(null)

  // v2.5.03: on the Head Judge page, ?seat=Jn means "also scoring from seat Jn".
  const isHj = role === 'hj'
  const alsoSeat = isHj ? seat : undefined
  const [judgeTarget, setJudgeTarget] = useState(null) // hj + seat only
  const [tab, setTab] = useState('hj') // 'hj' | 'judge' (hj + seat only)
  const [showSeats, setShowSeats] = useState(false)
  const activeTab = alsoSeat ? tab : 'hj'

  useEffect(() => {
    let alive = true
    if (!alsoSeat) setJudgeTarget(null)
    const poll = async () => {
      try {
        // The Head Judge target never depends on a seat; only judge tablets pass one.
        const t = await api.venueRoleTarget(role, isHj ? undefined : seat)
        // v2.5.03: the judge seat the Head Judge also scores from, read in the
        // same pass so the amber switch notice and the judge pane agree.
        const jt = alsoSeat ? await api.venueRoleTarget('judge', alsoSeat) : null
        if (!alive) return
        setErr('')
        if (t && t.discipline) {
          if (prevDisciplineRef.current && prevDisciplineRef.current !== t.discipline) {
            setSwitched({ from: prevDisciplineRef.current, to: t.discipline })
          }
          prevDisciplineRef.current = t.discipline
        }
        setTarget(prev => (sameTarget(prev, t) ? prev : t))
        if (jt) setJudgeTarget(prev => (sameTarget(prev, jt) ? prev : jt))
      } catch (e) { if (alive) setErr(e.message) }
    }
    poll()
    const id = setInterval(poll, 3000)
    return () => { alive = false; clearInterval(id) }
  }, [role, seat])

  // Free this device's judge seat, if it holds one (judge tablet, or hj + seat).
  const releaseIfJudge = async () => {
    if ((role === 'judge' || isHj) && seat) { try { await api.venueReleaseSeat(seat) } catch (_) {} }
  }

  // Leave seat: free the seat, forget the role, back to the seat picker.
  // v2.5.03 (hj + seat): free only the seat — the tablet stays the Head Judge.
  const leaveSeat = async () => {
    if (isHj) {
      if (!window.confirm(`Leave seat ${seat}?\n\nThe seat frees up for another tablet. This tablet stays the Head Judge.`)) return
      setBusy(true)
      await releaseIfJudge()
      setRoleMemory({ role: 'hj' })
      setTab('hj')
      setBusy(false)
      navigate('/venue/role/hj', { replace: true })
      return
    }
    if (!window.confirm(`Leave seat ${seat}?\n\nThe seat frees up for another tablet and you pick a seat again.`)) return
    setBusy(true)
    clearRoleMemory()
    await releaseIfJudge()
    navigate('/?menu=1&pick=judge')
  }

  // Change role: forget the role (and free the seat), back to the venue menu.
  const changeRole = async (confirmFirst = true) => {
    if (confirmFirst) {
      const what = isHj && seat
        ? `${venueRoleLabel(role)} + Judge (seat ${seat})`
        : `${venueRoleLabel(role)}${seat ? ` (seat ${seat})` : ''}`
      if (!window.confirm(`Change this tablet's role?\n\nIt stops being "${what}" and returns to the venue menu.`)) return
    }
    setBusy(true)
    clearRoleMemory()
    await releaseIfJudge()
    navigate('/?menu=1')
  }

  // v2.5.03: "Also score as a judge" — the seat picker has already claimed the
  // seat on the server when it calls back; remember hj + seat as ONE role.
  const alsoPicked = (picked) => {
    setShowSeats(false)
    setRoleMemory({ role: 'hj', seat: picked })
    setTab('judge')
    navigate(`/venue/role/hj?seat=${encodeURIComponent(picked)}`, { replace: true })
  }

  // Scoreboard is a read-only broadcast surface — keep showing results through
  // check-in/handback (awards, overnight), same carve-out as VenueOverlay.
  const frozen = target && role !== 'scoreboard' && (target.meet_state === 'checking_in' || target.meet_state === 'checked_in' || target.meet_state === 'handed_back')
  const hasBar = role !== 'scoreboard'

  // ── Role bar (judge / HJ / timekeeper) ───────────────────────────────────
  const barBtn = switched
    ? 'px-3 py-1 rounded-md text-xs font-semibold bg-black/20 text-black border border-black/30 disabled:opacity-50'
    : 'px-3 py-1 rounded-md text-xs font-semibold bg-slate-800 text-slate-200 border border-slate-600 hover:bg-slate-700 disabled:opacity-50'
  const tabBtn = (on) => switched
    ? `px-3 py-1 rounded-md text-xs font-semibold border ${on ? 'bg-black/30 text-black border-black/40' : 'bg-transparent text-black/70 border-black/20'}`
    : `px-3 py-1 rounded-md text-xs font-semibold border ${on ? 'bg-mountain-600 text-white border-mountain-500' : 'bg-slate-800 text-slate-300 border-slate-600 hover:bg-slate-700'}`
  let barText
  if (switched && target) {
    let seatNote = ''
    if (role === 'judge') {
      seatNote = target.judge
        ? ` You are ${judgeRoleLabel(target.judge.role)} in seat ${seat} here.`
        : ` Seat ${seat} has no judge in this event — Leave seat and pick the right one.`
    } else if (alsoSeat) {
      seatNote = judgeTarget && judgeTarget.judge
        ? ` You are ${judgeRoleLabel(judgeTarget.judge.role)} in seat ${alsoSeat} here.`
        : ` Seat ${alsoSeat} has no judge in this event — Leave seat and pick the right one.`
    } else if (role === 'timekeeper' && target.discipline === 'dual_mogul') {
      seatNote = ' Duals have no timekeeper — the Time judge scores time.'
    }
    barText = (
      <span onClick={() => setSwitched(null)} className="cursor-pointer">
        <b>Now following {target.event_name} ({disciplineLabel(target.discipline)}).</b>{seatNote} <span className="opacity-70">Tap to dismiss.</span>
      </span>
    )
  } else if (alsoSeat) {
    barText = (
      <>
        {target?.event_name ? <span className="text-slate-400">{target.event_name}</span> : null}
        {judgeTarget?.error === 'no_judge' ? <span className="text-amber-400"> · no judge for seat {alsoSeat} in the active event</span> : null}
      </>
    )
  } else {
    barText = (
      <>
        <b className="text-white">{venueRoleLabel(role)}{seat ? ` ${seat}` : ''}</b>
        {target?.judge ? <span> · {target.judge.name} <span className="text-slate-500">({judgeRoleLabel(target.judge.role)})</span></span> : null}
        {target?.event_name ? <span className="text-slate-400"> · {target.event_name}</span> : null}
        {target?.error === 'no_judge' && !switched ? <span className="text-amber-400"> · no judge for this seat in the active event</span> : null}
      </>
    )
  }
  // v2.5.03: the two in-app tabs of a Head Judge who also scores.
  const tabs = alsoSeat ? (
    <div className="flex gap-1 flex-shrink-0" data-testid="venue-role-tabs">
      <button onClick={() => setTab('hj')} className={tabBtn(activeTab === 'hj')} data-testid="venue-role-tab-hj">⚖️ Head Judge</button>
      <button onClick={() => setTab('judge')} className={tabBtn(activeTab === 'judge')} data-testid="venue-role-tab-judge">
        🎿 Judge {alsoSeat}{judgeTarget?.judge ? ` · ${judgeTarget.judge.name} (${judgeRoleLabel(judgeTarget.judge.role)})` : ''}
      </button>
    </div>
  ) : null
  const bar = hasBar ? (
    <div
      data-testid="venue-role-bar"
      className={`flex items-center justify-between gap-3 px-3 text-sm select-none ${switched ? 'bg-amber-400 text-black' : 'bg-slate-900 text-slate-300 border-b border-slate-800'}`}
      style={{ height: 40, flex: '0 0 auto' }}
    >
      <div className="flex items-center gap-3 min-w-0">
        {tabs}
        <div className="truncate min-w-0">{barText}</div>
      </div>
      <div className="flex gap-2 flex-shrink-0">
        {isHj && !alsoSeat && !frozen && (
          <button onClick={() => setShowSeats(true)} disabled={busy} className={barBtn} title="Take a judge seat on this tablet as well — the two screens become tabs up here">Also score as a judge</button>
        )}
        {(role === 'judge' || (alsoSeat && activeTab === 'judge')) && (
          <button onClick={leaveSeat} disabled={busy} className={barBtn} title={isHj ? 'Free this seat and stay the Head Judge' : 'Free this seat and pick a seat again'}>Leave seat</button>
        )}
        <button onClick={() => changeRole(true)} disabled={busy} className={barBtn} title="Forget this tablet's role and return to the venue menu">Change role</button>
      </div>
    </div>
  ) : null

  // ── Body ─────────────────────────────────────────────────────────────────
  let body
  if (frozen) {
    const done = target.meet_state !== 'checking_in'
    // L-6: handed_back gets its own copy — on night 1 of a two-day meet,
    // "checked in … power tablets down" would be wrong and confusing.
    const handedBack = target.meet_state === 'handed_back'
    body = (
      <div className="flex-1 bg-slate-950 text-white flex flex-col items-center justify-center p-8 text-center">
        <div className="text-6xl mb-6">{done ? (handedBack ? '🌙' : '✅') : '⏳'}</div>
        <h1 className="font-display text-4xl mb-3">
          {done
            ? (handedBack ? 'Handed back for tonight — you can stop' : 'Meet checked in — you can stop')
            : 'Meet is checking in…'}
        </h1>
        <p className="text-slate-400 max-w-md">
          {done
            ? (handedBack
              ? 'Today\'s results are safely on stickitski.com and tonight\'s work (brackets, run orders) happens there. Scoring is done here for today — in the morning the meet is adopted again with a NEW release code.'
              : 'All results are safely on stickitski.com. Scoring is closed on this server — thank you for your work today. You can power tablets down.')
            : 'The Scoring Computer is sending final results to the cloud. Please stop scoring — this screen will update when it finishes.'}
        </p>
        {!hasBar && <button onClick={() => changeRole(false)} className="mt-8 text-sm text-slate-600 underline">Change role</button>}
      </div>
    )
  } else if (target && target.error) {
    body = (
      <div className="flex-1 bg-slate-950 text-white flex flex-col items-center justify-center p-8 text-center">
        <h1 className="font-display text-3xl mb-3">Waiting…</h1>
        <p className="text-slate-400 max-w-md">{target.message || target.error}</p>
        {role === 'judge' && target.error === 'no_judge' && (
          <p className="text-slate-500 text-sm max-w-md mt-3">
            If you should be scoring this event, tap <b>Leave seat</b> above and pick the seat that matches your role.
          </p>
        )}
        {!hasBar && <button onClick={() => changeRole(false)} className="mt-8 text-sm text-slate-600 underline">Change role</button>}
      </div>
    )
  } else if (!target) {
    body = <div className="flex-1 bg-slate-950 flex items-center justify-center text-slate-500">{err || 'Connecting…'}</div>
  } else if (isHj) {
    // v2.5.03: the Head Judge page is a stack — the Head Judge iframe plus,
    // when a seat is held, the judge pane. Both stay mounted; the inactive one
    // is hidden with visibility (it keeps its full size, so the embedded page
    // never sees a 0×0 viewport) and cannot receive taps.
    const pane = (on) => ({ position: 'absolute', inset: 0, width: '100%', height: '100%', visibility: on ? 'visible' : 'hidden', pointerEvents: on ? 'auto' : 'none' })
    let judgePane = null
    if (alsoSeat) {
      const on = activeTab === 'judge'
      if (!judgeTarget) {
        judgePane = <div style={pane(on)} className="bg-slate-950 flex items-center justify-center text-slate-500">Connecting…</div>
      } else if (judgeTarget.error) {
        judgePane = (
          <div style={pane(on)} className="bg-slate-950 text-white flex flex-col items-center justify-center p-8 text-center">
            <h1 className="font-display text-3xl mb-3">Waiting…</h1>
            <p className="text-slate-400 max-w-md">{judgeTarget.message || judgeTarget.error}</p>
            {judgeTarget.error === 'no_judge' && (
              <p className="text-slate-500 text-sm max-w-md mt-3">
                If you should be scoring this event, tap <b>Leave seat</b> above and take the seat that matches your judge role.
              </p>
            )}
          </div>
        )
      } else {
        judgePane = (
          <iframe
            key={judgeTarget.url}
            src={judgeTarget.url}
            title="venue-hj-judge"
            data-testid="venue-hj-judge-frame"
            style={{ ...pane(on), border: 'none' }}
            allow="fullscreen"
          />
        )
      }
    }
    body = (
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <iframe
          key={target.url}
          src={target.url}
          title={`venue-${role}`}
          style={{ ...pane(activeTab === 'hj'), border: 'none' }}
          allow="fullscreen"
        />
        {judgePane}
      </div>
    )
  } else {
    body = (
      <iframe
        key={target.url}
        src={target.url}
        title={`venue-${role}`}
        style={{ flex: 1, width: '100%', border: 'none', minHeight: 0 }}
        allow="fullscreen"
      />
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#020617', display: 'flex', flexDirection: 'column' }}>
      {bar}
      {body}
      {/* Scoreboard (TV): no bar — a small, deliberate corner button instead. */}
      {!hasBar && !frozen && target && !target.error && (
        <button
          onClick={() => changeRole(true)}
          title="Forget this display's role and return to the venue menu"
          style={{
            position: 'fixed', left: 8, bottom: 8, zIndex: 50,
            background: 'rgba(15,23,42,0.75)', color: '#94a3b8',
            border: '1px solid #334155', borderRadius: 8,
            fontSize: 12, padding: '6px 10px',
          }}
        >
          ⌂ Change role
        </button>
      )}
      {/* v2.5.03: "Also score as a judge" — the Judge tile's seat picker, no extra PIN
          (the Control PIN that opened the Head Judge outranks the Crew PIN). */}
      {showSeats && <SeatPicker onClose={() => setShowSeats(false)} onPicked={alsoPicked} />}
    </div>
  )
}
