import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import api, { saveFile } from '../../utils/api'
import { fetchVenueStatus, getRoleMemory, setRoleMemory, roleUrl, judgeRoleLabel, disciplineLabel, describeMemory } from './venueShared'

/**
 * v2.0.00 (Step 3, D9 / 6.2) — venue home screen: a role menu, not a login page.
 * State 1 (no meet): Adopt Meet (release code) + Import from file (USB).
 * State 2 (meet adopted): role tiles — Scoring Computer + Head Judge behind the
 * Control PIN, Judge (seat picker) + Timekeeper behind the Crew PIN,
 * Scoreboard open, plus Connection Info. Volunteer-first copy throughout.
 */

const tileStyle = 'w-full text-left p-5 rounded-2xl border border-slate-700 bg-slate-800/60 hover:bg-slate-700/60 transition-colors'

function PinModal({ title, kind, onOk, onClose, hint }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!/^\d{4}$/.test(pin)) { setErr('Enter the 4-digit PIN.'); return }
    setBusy(true); setErr('')
    try {
      const r = await api.venueVerifyPin(kind, pin)
      onOk(r)
    } catch (e) {
      setErr(e.code === 'pin_incorrect' ? 'Wrong PIN — try again.' : e.message)
    } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-sm text-center">
        <h2 className="font-display text-2xl text-white mb-1">{title}</h2>
        {hint && <p className="text-slate-500 text-sm mb-3">{hint}</p>}
        {/* v2.4.00: a masked numeric field rather than type="password" — a
            4-digit venue PIN must not trigger iPad keychain / password-manager
            prompts or "save this password?" sheets for volunteers. */}
        <input
          autoFocus
          type="tel"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          data-testid="venue-pin"
          style={{ WebkitTextSecurity: 'disc' }}
          className="input text-center text-3xl tracking-[0.5em] font-mono mb-3"
          value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
          onKeyDown={e => e.key === 'Enter' && submit()}
        />
        {err && <p className="text-red-400 text-sm mb-3">{err}</p>}
        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button onClick={submit} disabled={busy} className="btn-primary flex-1">{busy ? '…' : 'OK'}</button>
        </div>
      </div>
    </div>
  )
}

function SeatPicker({ onPicked, onClose }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [forceFor, setForceFor] = useState(null) // seat pending force-release PIN
  const load = () => api.venueSeats().then(setData).catch(e => setErr(e.message))
  useEffect(() => { load(); const id = setInterval(load, 4000); return () => clearInterval(id) }, [])

  const claim = async (seat) => {
    try {
      await api.venueClaimSeat(seat, navigator.userAgent.includes('iPad') ? 'iPad' : 'Tablet')
      onPicked(seat)
    } catch (e) { setErr(e.message); load() }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-lg">
        <h2 className="font-display text-2xl text-white mb-1 text-center">Pick Your Judge Seat</h2>
        {/* v2.4.00 (T-4): only the seats the active event's format uses are
            offered, each with its role, and the list re-reads every 4 s so a
            singles → duals switch shows the dual roles as soon as it happens. */}
        {data?.active_event
          ? <p className="text-slate-500 text-sm text-center mb-4">Now scoring: <span className="text-slate-300">{data.active_event.name}</span> ({disciplineLabel(data.active_event.discipline)}) — {data.seat_count} seats</p>
          : (data && <p className="text-slate-500 text-sm text-center mb-4">No event has started yet — all seats shown.</p>)}
        {err && <p className="text-red-400 text-sm text-center mb-3">{err}</p>}
        <div className="grid grid-cols-2 gap-3 mb-4">
          {(data?.seats || []).filter(s => s.in_event !== false).map(s => (
            <div key={s.seat} className={`p-3 rounded-xl border ${s.claimed ? 'border-slate-800 bg-slate-800/40 opacity-70' : 'border-mountain-700 bg-mountain-900/20'}`}>
              <div className="flex items-center justify-between">
                <span className="font-display text-2xl text-white">{s.seat}<span className="text-sm text-slate-400 font-sans ml-2">{s.role ? judgeRoleLabel(s.role) : ''}</span></span>
                {s.claimed
                  ? <span className="text-xs text-amber-400">in use{s.device_label ? ` — ${s.device_label}` : ''}</span>
                  : <button onClick={() => claim(s.seat)} className="btn-primary text-sm px-4 py-1.5">Take</button>}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {s.judge ? s.judge.name : (s.role ? 'No judge assigned to this role yet' : 'No judge for this seat in the active event')}
              </div>
              {s.claimed && (
                <button onClick={() => setForceFor(s.seat)} className="text-xs text-red-400 underline mt-1">Force release…</button>
              )}
            </div>
          ))}
        </div>
        {(data?.seats || []).some(s => s.in_event === false) && (
          <div className="text-xs text-slate-500 mb-4">
            Also in use, but not part of this event:{' '}
            {(data.seats).filter(s => s.in_event === false).map(s => (
              <span key={s.seat} className="mr-3">{s.seat}{s.device_label ? ` (${s.device_label})` : ''} <button onClick={() => setForceFor(s.seat)} className="text-red-400 underline">Force release…</button></span>
            ))}
          </div>
        )}
        <p className="text-xs text-slate-600 mb-3 text-center">A seat "in use" from a dead tablet: tap Force release under it (Control PIN) — the backup tablet can then take it.</p>
        <button onClick={onClose} className="btn-secondary w-full">Cancel</button>
        {forceFor && (
          <PinModal
            title={`Force release ${forceFor}`}
            kind="control"
            hint="Only the Scoring Computer (Control PIN) can free a taken seat."
            onClose={() => setForceFor(null)}
            onOk={async (r) => {
              try {
                await api.venueForceReleaseSeat(forceFor, r.token)
                setForceFor(null)
                load()
              } catch (e) { setErr(e.message); setForceFor(null) }
            }}
          />
        )}
      </div>
    </div>
  )
}

function PinSetupCard({ onDone }) {
  const [control, setControl] = useState('')
  const [crew, setCrew] = useState('')
  const [err, setErr] = useState('')
  const save = async () => {
    if (!/^\d{4}$/.test(control) || !/^\d{4}$/.test(crew)) { setErr('Both PINs must be 4 digits.'); return }
    try {
      await api.venueSetPins(control, crew)
      onDone()
    } catch (e) { setErr(e.message) }
  }
  return (
    <div className="card border-amber-800 bg-amber-900/10 mb-6">
      <h3 className="font-display text-xl text-amber-300 mb-2">Set the two PINs</h3>
      <p className="text-sm text-slate-400 mb-3">
        The <b>Control PIN</b> opens the Scoring Computer and Head Judge. The <b>Crew PIN</b> opens Judge seats and the Timekeeper.
        Write both on the run sheet.
      </p>
      <div className="flex gap-3 mb-3">
        <div className="flex-1">
          <label className="label">Control PIN</label>
          <input className="input font-mono text-center" inputMode="numeric" maxLength={4} value={control} onChange={e => setControl(e.target.value.replace(/\D/g, ''))} />
        </div>
        <div className="flex-1">
          <label className="label">Crew PIN</label>
          <input className="input font-mono text-center" inputMode="numeric" maxLength={4} value={crew} onChange={e => setCrew(e.target.value.replace(/\D/g, ''))} />
        </div>
      </div>
      {err && <p className="text-red-400 text-sm mb-2">{err}</p>}
      <button onClick={save} className="btn-primary w-full">Save PINs</button>
    </div>
  )
}

export default function VenueHome() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const stayOnMenu = searchParams.get('menu') === '1'
  // v2.4.00 (T-2): "Leave seat" on a judge tablet lands here to pick again —
  // the Crew PIN was already entered on this device, so open the picker directly.
  const pickJudge = searchParams.get('pick') === 'judge'
  // v2.4.00 (T-7): the menu reached on purpose (?menu=1) shows which role this
  // device remembers, with a way back — the memory itself is untouched.
  const [remembered] = useState(() => getRoleMemory())
  const [status, setStatus] = useState(null)
  const [pins, setPins] = useState(null)
  const [code, setCode] = useState('')
  const [adoptErr, setAdoptErr] = useState('')
  const [adoptBusy, setAdoptBusy] = useState(false)
  const [pinModal, setPinModal] = useState(null) // { kind, then }
  const [showSeats, setShowSeats] = useState(false)
  const [checkinBusy, setCheckinBusy] = useState(null)
  const [checkinErr, setCheckinErr] = useState('')
  const [update, setUpdate] = useState(null)
  const [updating, setUpdating] = useState(false)
  // v2.5.01 — live progress of the update script (polled from /update-status):
  // { state: launched|running|restarting|done|failed, step, message, log_tail, at }
  const [updProgress, setUpdProgress] = useState(null)
  // v2.5.00 — offline return (file): the offer after a failed online attempt,
  // the explicit "no internet" chooser, and the archived-state card.
  const [returnOffer, setReturnOffer] = useState(null) // { mode, token } after the cloud proved unreachable
  const [returnPick, setReturnPick] = useState(false)  // explicit "Return via file" mode chooser
  const [returnStatus, setReturnStatus] = useState(null)
  const [returnBusy, setReturnBusy] = useState('')
  const [returnMsg, setReturnMsg] = useState(null) // { ok, text }

  // v2.5.00 — write the return file (freeze + archive, exactly like a
  // successful online return — ruling 2), then the volunteer downloads it.
  const doReturnFile = async (mode, token) => {
    const label = mode === 'handback' ? 'Hand Back' : 'Check In'
    if (!window.confirm(`Return this meet via file (${label})?\n\nScoring STOPS on this server now, exactly like a normal ${label}. A return file is written here; download it onto the USB drive and import it on stickitski.com from a computer with internet (meet page → More → Import venue return file).`)) return
    setCheckinBusy(`${label} via file — writing the return file…`)
    setCheckinErr('')
    setReturnOffer(null)
    setReturnPick(false)
    try {
      const r = await api.venueReturnFile(mode, token)
      setReturnMsg({ ok: true, text: `Return file written (${Math.round((r.file?.bytes || 0) / 1024)} KB)${r.file?.snapshot_copy ? ' — a copy is also on the backup stick' : ''}. Download it below.` })
      await refresh()
    } catch (e) {
      setCheckinErr(e.message)
    } finally { setCheckinBusy(null) }
  }

  const withControl = (fn) => {
    if (pins?.control_set) setPinModal({ kind: 'control', then: (r) => { setPinModal(null); fn(r.token) } })
    else fn(null)
  }

  // v2.0.00 (Step 5) — Hand Back / Check In: Control PIN, confirm, run, report.
  const startCheckin = (mode) => {
    const doIt = async (token) => {
      const label = mode === 'handback' ? 'Hand Back to Cloud' : 'Check In Meet'
      if (!window.confirm(mode === 'handback'
        ? 'Hand this meet back to the cloud?\n\nScoring STOPS on this server. All results are verified against stickitski.com first. Do this only after the last run of the day.'
        : 'Check this meet in?\n\nThis is final: results are verified against stickitski.com and scoring closes on this server for good.')) return
      setCheckinBusy(`${label} — verifying every score against the cloud…`)
      setCheckinErr('')
      setReturnOffer(null)
      try {
        await api.venueCheckin(mode, token)
        await refresh()
      } catch (e) {
        setCheckinErr(e.message)
        // v2.5.00: the cloud is unreachable — offer the file path with the
        // same token (the venue reverted to 'adopted'; nothing rotated yet).
        const offline = (e.code === 'flush_failed' && e.body && e.body.reason === 'offline') || e.code === 'cloud_unreachable'
        if (offline) setReturnOffer({ mode, token })
      } finally { setCheckinBusy(null) }
    }
    withControl(doIt)
  }

  // v2.5.00 — archived-state actions.
  const downloadReturnFile = () => withControl(async (token) => {
    setReturnBusy('download'); setReturnMsg(null)
    try {
      const res = await saveFile('StickIt_Return.json', () => api.venueReturnFileBlob(token))
      if (res.saved !== 'cancelled') setReturnMsg({ ok: true, text: `Saved ${res.fileName}. Copy it onto the USB drive if it went to Downloads.` })
    } catch (e) { setReturnMsg({ ok: false, text: 'Download failed: ' + e.message }) }
    finally { setReturnBusy('') }
  })
  const sendReturnFile = () => withControl(async (token) => {
    setReturnBusy('send'); setReturnMsg(null)
    try {
      const r = await api.venueReturnSend(token)
      setReturnMsg({ ok: true, text: r.already_received ? (r.message || 'The cloud already has this meet.') : 'Delivered — stickitski.com has verified and received the meet.' })
      setReturnStatus(await api.venueReturnStatus(true).catch(() => null))
    } catch (e) { setReturnMsg({ ok: false, text: e.message }) }
    finally { setReturnBusy('') }
  })

  // M-13: keep the previous status when a refresh poll fails — one transient
  // failure must not re-render the operator console as the Adopt screen.
  const refresh = () => Promise.all([
    fetchVenueStatus(true).then(setStatus).catch(() => {}),
    api.venuePinsStatus().then(setPins).catch(() => setPins({ control_set: false, crew_set: false })),
  ])

  useEffect(() => { refresh() }, [])
  // v2.0.00 (Step 6) — update check, only meaningful with no meet adopted.
  // v2.4.01: gate on the meet STATE, not on the presence of a remembered meet —
  // after Check In the server still reports the checked-in meet, so the card
  // never reappeared and the Update button was unreachable until the next
  // adoption (found on the test Pi the first time an update existed). The
  // server refuses /update only while adopted / checking_in / handed_back.
  const updateBlocked = !status || ['adopted', 'checking_in', 'handed_back'].includes(status.meet_state)
  useEffect(() => {
    if (updateBlocked) { setUpdate(null); return }
    api.venueUpdateCheck().then(setUpdate).catch(() => setUpdate(null))
    // A failed earlier attempt stays visible (the script's message + log tail)
    // until the next attempt replaces it — the reason an update "did nothing".
    api.venueUpdateStatus().then(s => { if (s.state === 'failed') setUpdProgress(s) }).catch(() => {})
  }, [updateBlocked, status?.meet_state])

  // v2.5.01 — Update StickIt: no PIN (David's ruling 09-06-26; the server
  // refuses only while a meet is on the box). After the POST, poll the status
  // file the script writes: steps → "Restarting…" while the box is down →
  // done (reload onto the new version) or failed (message + log tail shown).
  const doUpdate = async () => {
    if (!window.confirm(`Update StickIt from ${update.current} to ${update.latest}? The server restarts itself — takes a minute or two.`)) return
    setUpdating(true)
    setUpdProgress({ state: 'launched', message: 'Starting the update…' })
    try {
      await api.venueUpdate()
    } catch (e) {
      setUpdProgress({ state: 'failed', message: e.message })
      setUpdating(false)
      return
    }
    const startVersion = update.current
    const t0 = Date.now()
    let wasDown = false
    const tick = async () => {
      if (Date.now() - t0 > 12 * 60 * 1000) {
        setUpdProgress({ state: 'failed', message: 'The update is taking longer than 12 minutes. Check the box (journalctl -u stickit-venue) or update over SSH: sudo /opt/stickit/update-stickit.sh' })
        setUpdating(false)
        return
      }
      try {
        const s = await api.venueUpdateStatus()
        if (s.state === 'done' || (wasDown && s.current && s.current !== startVersion)) {
          setUpdProgress({ state: 'done', message: `Updated to ${s.current || s.tag}. Reloading…` })
          setTimeout(() => window.location.reload(), 1500)
          return
        }
        if (s.state === 'failed') { setUpdProgress(s); setUpdating(false); return }
        setUpdProgress(s.state === 'idle' ? { state: 'launched', message: 'Starting the update…' } : s)
      } catch (_) {
        wasDown = true
        setUpdProgress({ state: 'restarting', message: 'Restarting the box on the new version…' })
      }
      setTimeout(tick, 2000)
    }
    setTimeout(tick, 2000)
  }
  useEffect(() => { const id = setInterval(() => refresh(), 10000); return () => clearInterval(id) }, [])
  // v2.5.00 — while a return file is stored (archived venue), ask whether the
  // cloud has received it (public probe; 30 s cadence).
  const returnAvailable = !!(status && status.return_file && status.return_file.available)
  useEffect(() => {
    if (!returnAvailable) { setReturnStatus(null); return }
    let alive = true
    const tick = () => api.venueReturnStatus().then(r => { if (alive) setReturnStatus(r) }).catch(() => {})
    tick()
    const id = setInterval(tick, 30000)
    return () => { alive = false; clearInterval(id) }
  }, [returnAvailable, status?.meet_state])

  // Device role memory: a rebooted tablet goes straight back to its role page.
  useEffect(() => {
    if (stayOnMenu || !status) return
    const mem = getRoleMemory()
    if (mem && status.adopted_meet && (status.meet_state === 'adopted' || status.meet_state === 'checking_in')) {
      const url = roleUrl(mem)
      if (url) navigate(url, { replace: true })
    }
  }, [status, stayOnMenu])

  // v2.4.00 (T-2): arriving from "Leave seat" — straight to the seat picker.
  useEffect(() => {
    if (pickJudge && status && status.adopted_meet && (status.meet_state === 'adopted' || status.meet_state === 'checking_in')) setShowSeats(true)
  }, [pickJudge, status?.adopted_meet ? 1 : 0, status?.meet_state])

  const adopt = async (replace = false) => {
    setAdoptBusy(true); setAdoptErr('')
    try {
      await api.venueAdopt(code.trim().toUpperCase(), replace ? { replace: true } : {})
      setCode('')
      await refresh()
    } catch (e) {
      // H-9: branch on the machine code — apiFetch previously threw the bare
      // code as the message, so the old text regex could never match and the
      // day-2 replace offer was unreachable from the UI.
      if (e.code === 'meet_exists') {
        if (window.confirm(e.message + '\n\nReplace the local copy with the current cloud version?')) {
          setAdoptBusy(false)
          return adopt(true)
        }
      }
      setAdoptErr(e.message)
    } finally { setAdoptBusy(false) }
  }

  const importFile = async (file, replace = false) => {
    setAdoptErr('')
    try {
      const text = await file.text()
      const pkg = JSON.parse(text)
      await api.venueImportPackage(pkg, replace ? { replace: true } : {})
      await refresh()
    } catch (e) {
      if (e.code === 'meet_exists') {
        if (window.confirm(e.message + '\n\nReplace the local copy with the current cloud version?')) {
          return importFile(file, true)
        }
      }
      setAdoptErr('Import failed: ' + e.message)
    }
  }

  const openRole = (mem, pinKind) => {
    const go = (token) => {
      if (token) localStorage.setItem('stickit_auth_token', token)
      if (mem.role === 'judge') { setShowSeats(true); return }
      setRoleMemory(mem)
      navigate(mem.role === 'dashboard' ? '/dashboard' : roleUrl(mem))
    }
    if (!pinKind || !pins?.control_set) { go(null); return }
    setPinModal({
      kind: pinKind,
      then: (r) => { setPinModal(null); go(r.token || null) },
    })
  }

  if (!status) return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-500">Starting…</div>

  const adopted = status.adopted_meet && (status.meet_state === 'adopted' || status.meet_state === 'checking_in')

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 max-w-2xl mx-auto">
      <div className="text-center mb-8 pt-6">
        <h1 className="font-display text-5xl tracking-wide">STICKIT <span className="text-mountain-400">VENUE</span></h1>
        <p className="text-slate-500 text-sm mt-1">Venue server · {status.version} · sync protocol v{status.protocol_version}</p>
      </div>

      {!adopted ? (
        <>
          {/* State 1 — no meet adopted */}
          <div className="card mb-6">
            <h2 className="font-display text-2xl mb-2">Adopt Meet</h2>
            <p className="text-slate-400 text-sm mb-4">
              Type the release code from the official (shown on the stickitski.com meet page, or read to you over the phone).
              Adoption needs internet for a moment.
            </p>
            <div className="flex gap-3">
              <input
                className="input font-mono text-2xl tracking-[0.25em] text-center uppercase"
                placeholder="RELEASE CODE"
                maxLength={8}
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && adopt()}
              />
              <button onClick={() => adopt()} disabled={adoptBusy || code.trim().length < 6} className="btn-primary px-8">
                {adoptBusy ? 'Adopting…' : 'Adopt'}
              </button>
            </div>
            {adoptErr && <p className="text-red-400 text-sm mt-3">{adoptErr}</p>}
          </div>
          <div className="card">
            <h2 className="font-display text-xl mb-2 text-slate-300">Import from file (backup plan)</h2>
            <p className="text-slate-500 text-sm mb-3">If the internet is down right now, use the "Export for Adoption" file from a USB stick.</p>
            <input type="file" accept=".json,application/json" className="text-sm text-slate-400"
              onChange={e => e.target.files?.[0] && importFile(e.target.files[0])} />
          </div>

          {/* v2.0.00 (Step 6) — routine update: "plug the Pi in at home, open
              stickit.local, click Update." Shown only with internet reachable.
              v2.5.01: no PIN; progress + result shown inline. */}
          {update && update.internet && (
            <div className="card mt-6" data-testid="update-card">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-display text-xl text-slate-300">StickIt software</h2>
                  <p className="text-slate-500 text-sm">
                    Installed: {update.current} · Latest: {update.latest}
                    {!update.update_available && <span className="text-green-400"> — up to date</span>}
                  </p>
                </div>
                {update.update_available && (
                  <button className="btn-primary" disabled={updating} onClick={doUpdate} data-testid="update-btn">
                    {updating ? 'Updating…' : 'Update StickIt'}
                  </button>
                )}
              </div>
              {updProgress && updProgress.state !== 'idle' && (
                <div
                  data-testid="update-progress"
                  className={`mt-3 rounded border px-3 py-2 text-sm ${
                    updProgress.state === 'failed' ? 'border-red-800 bg-red-900/20 text-red-300'
                    : updProgress.state === 'done' ? 'border-green-800 bg-green-900/20 text-green-300'
                    : 'border-mountain-800 bg-mountain-900/20 text-mountain-200'}`}
                >
                  {updProgress.state === 'failed' ? (
                    <>
                      <div className="font-semibold">Update failed{updProgress.at ? ` (${new Date(updProgress.at).toLocaleString()})` : ''}</div>
                      <div>{updProgress.message}</div>
                      {updProgress.log_tail && updProgress.log_tail.length > 0 && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-red-400">Show details</summary>
                          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-slate-400">{updProgress.log_tail.join('\n')}</pre>
                        </details>
                      )}
                      <div className="mt-1 text-xs text-slate-500">You can press Update StickIt again. SSH fallback: sudo /opt/stickit/update-stickit.sh</div>
                    </>
                  ) : (
                    <div>
                      {updProgress.state !== 'done' && <span className="inline-block animate-pulse mr-2">●</span>}
                      {updProgress.message || updProgress.step}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {status.meet_state === 'handed_back' && status.adopted_meet && (
            <div className="card mt-6 border-mountain-800 bg-mountain-900/10 text-mountain-300 text-sm">
              "{status.adopted_meet.name}" was handed back to the cloud for tonight — brackets are
              built on stickitski.com. In the morning, adopt it again with the NEW release code
              (this server will offer to replace its local copy).
            </div>
          )}
          {status.meet_state === 'checked_in' && status.adopted_meet && (
            <div className="card mt-6 border-green-800 bg-green-900/10 text-green-300 text-sm">
              "{status.adopted_meet.name}" was {returnAvailable ? 'checked in via return file' : 'checked in to the cloud'}. This server is ready for the next meet.
            </div>
          )}
          {/* v2.5.00 — offline return: the stored return file + whether the cloud has it */}
          {returnAvailable && (
            <div className="card mt-6 border-mountain-800 bg-mountain-900/10" data-testid="return-file-card">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-xl text-white">Return file</h2>
                  <p className="text-slate-400 text-sm">
                    {status.return_file.mode === 'handback' ? 'Hand Back' : 'Check In'} · written{' '}
                    {status.return_file.exported_at ? new Date(status.return_file.exported_at).toLocaleString() : ''}
                  </p>
                </div>
                <div className="text-sm text-right">
                  {!returnStatus && <span className="text-slate-500">Checking stickitski.com…</span>}
                  {returnStatus?.cloud === 'received' && <span className="text-green-400">✓ Received by stickitski.com</span>}
                  {returnStatus?.cloud === 'pending' && <span className="text-amber-300">Not yet received by stickitski.com</span>}
                  {returnStatus?.cloud === 'unknown' && <span className="text-slate-400">stickitski.com unreachable</span>}
                  {returnStatus?.cloud === 'unlocked' && <span className="text-amber-300">stickitski.com no longer expects this file</span>}
                </div>
              </div>
              <p className="text-slate-500 text-sm mt-3">
                {returnStatus?.cloud === 'received'
                  ? 'Nothing more to do — the cloud has verified and stored every score. Keep the file until the results are published.'
                  : returnStatus?.cloud === 'unlocked'
                    ? 'The meet was unlocked on stickitski.com (handback imported, or force-unlocked). If the results are missing there, call the office — the file is still stored here.'
                    : 'Download the file onto the USB drive, take the laptop somewhere with internet, and import it on stickitski.com: open the meet → More → Import venue return file. Or, once this box has internet, send it directly.'}
              </p>
              <div className="flex flex-wrap gap-3 mt-4">
                <button className="btn-primary text-sm" disabled={!!returnBusy} onClick={downloadReturnFile}>
                  {returnBusy === 'download' ? 'Preparing…' : '💾 Download return file'}
                </button>
                {returnStatus && returnStatus.cloud !== 'received' && returnStatus.cloud !== 'unlocked' && (
                  <button className="btn-secondary text-sm" disabled={!!returnBusy} onClick={sendReturnFile}>
                    {returnBusy === 'send' ? 'Sending…' : '☁️ Send to cloud now'}
                  </button>
                )}
              </div>
              {returnMsg && <p className={`text-sm mt-3 ${returnMsg.ok ? 'text-green-400' : 'text-red-400'}`}>{returnMsg.text}</p>}
            </div>
          )}
        </>
      ) : (
        <>
          {/* State 2 — meet adopted */}
          <div className="card mb-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-display text-3xl">{status.adopted_meet.name}</h2>
                <p className="text-slate-500 text-sm">{status.adopted_meet.location} · {status.adopted_meet.date}</p>
              </div>
              <div className="text-right text-sm">
                <div className="text-slate-400">Sync: <span className={status.sync && status.sync.state !== 'up_to_date' ? 'text-amber-300' : 'text-green-400'}>{status.sync ? status.sync.label : '—'}</span></div>
                {status.snapshot && status.snapshot.warning && (
                  <div className={status.snapshot.configured ? 'text-amber-400 text-xs mt-1' : 'text-slate-600 text-xs mt-1'}>
                    💾 {status.snapshot.warning}
                  </div>
                )}
              </div>
            </div>
          </div>
          {status.sync && status.sync.revoked && (
            <div className="card mb-6 border-red-800 bg-red-900/20 text-red-300 text-sm">
              ⚠️ This adoption was revoked on the cloud — scores entered here are NOT reaching
              stickitski.com. Nothing local is lost. Call the office before continuing.
              <button
                className="btn-secondary w-full mt-3 text-sm"
                onClick={() => {
                  // H-5: recovery from a dead adoption without DB surgery.
                  const doAbandon = async (token) => {
                    if (!window.confirm('Abandon this adoption?\n\nThe meet data stays on this server (USB recovery still works), but this server stops trying to sync and can adopt a meet again.')) return
                    try { await api.venueAbandon(token); await refresh() }
                    catch (e) { alert('Could not abandon: ' + e.message) }
                  }
                  if (pins?.control_set) {
                    setPinModal({ kind: 'control', then: (r) => { setPinModal(null); doAbandon(r.token) } })
                  } else doAbandon(null)
                }}
              >
                Abandon this adoption (Control PIN)
              </button>
            </div>
          )}
          {status.sync && status.sync.capture_failures > 0 && (
            <div className="card mb-6 border-red-800 bg-red-900/20 text-red-300 text-sm">
              ⚠️ {status.sync.capture_failures} score change{status.sync.capture_failures === 1 ? '' : 's'} could not be
              recorded for cloud sync. Scoring still works and nothing local is lost — the differences
              will be repaired at check-in — but call support if this number keeps growing.
            </div>
          )}
          {status.sync && status.sync.stuck && (
            <div className="card mb-6 border-amber-800 bg-amber-900/20 text-amber-300 text-sm">
              ⚠️ Cloud sync is stuck on one change (seq {status.sync.stuck.seq}
              {status.sync.stuck.table ? `, table ${status.sync.stuck.table}` : ''}). Scoring still works
              and everything is saved locally; call the office if this does not clear.
            </div>
          )}

          {pins && !pins.control_set && <PinSetupCard onDone={refresh} />}

          {/* v2.4.00 (T-7): reached on purpose with a role remembered — say so,
              offer the way back. Picking any tile below replaces the memory. */}
          {stayOnMenu && remembered && remembered.role && !pickJudge && (
            <div className="card mb-6 border-mountain-800 bg-mountain-900/10 flex items-center justify-between gap-4 text-sm">
              <div className="text-slate-300">
                This device is set up as <b className="text-white">{describeMemory(remembered)}</b>.
                Pick a different role below to change it.
              </div>
              <button className="btn-secondary text-sm whitespace-nowrap" onClick={() => navigate(roleUrl(remembered))}>
                Back to {describeMemory(remembered)}
              </button>
            </div>
          )}

          <div className="space-y-3">
            <button className={tileStyle} onClick={() => openRole({ role: 'dashboard' }, 'control')}>
              <div className="font-display text-2xl">🖥 Scoring Computer</div>
              <div className="text-slate-500 text-sm">Full officials console — run orders, manual entry, results, reports (Control PIN)</div>
            </button>
            <button className={tileStyle} onClick={() => openRole({ role: 'hj' }, 'control')}>
              <div className="font-display text-2xl">⚖️ Head Judge</div>
              <div className="text-slate-500 text-sm">Review and approve scores (Control PIN)</div>
            </button>
            <button className={tileStyle} onClick={() => openRole({ role: 'judge' }, 'crew')}>
              <div className="font-display text-2xl">🎿 Judge</div>
              <div className="text-slate-500 text-sm">Pick your seat (Crew PIN)</div>
            </button>
            <button className={tileStyle} onClick={() => openRole({ role: 'timekeeper' }, 'crew')}>
              <div className="font-display text-2xl">⏱ Timekeeper</div>
              <div className="text-slate-500 text-sm">Enter run times (Crew PIN)</div>
            </button>
            <button className={tileStyle} onClick={() => openRole({ role: 'scoreboard' }, null)}>
              <div className="font-display text-2xl">📺 Scoreboard</div>
              <div className="text-slate-500 text-sm">Live results display — no PIN needed</div>
            </button>
            <button className={tileStyle} onClick={() => navigate('/venue/connection')}>
              <div className="font-display text-2xl">📶 Connection Info</div>
              <div className="text-slate-500 text-sm">Address + QR code for new tablets · overlay URL for the livestream box</div>
            </button>
          </div>

          {/* v2.0.00 (Step 5, D8/FR-10) — end-of-day actions (Control PIN) */}
          <div className="mt-8 p-4 rounded-2xl border border-slate-800 bg-slate-900/60">
            <div className="text-slate-500 text-xs uppercase tracking-wide mb-3">End of day (see the run sheet)</div>
            {checkinBusy ? (
              <div className="text-amber-300 text-sm">⏳ {checkinBusy}</div>
            ) : (
              <div className="flex gap-3">
                <button
                  className="btn-secondary flex-1 text-sm"
                  onClick={() => startCheckin('handback')}
                >
                  🌙 Hand Back to Cloud
                  <span className="block text-xs text-slate-500">Two-day meet: tonight's bracket work happens on stickitski.com</span>
                </button>
                <button
                  className="btn-secondary flex-1 text-sm"
                  onClick={() => startCheckin('checkin')}
                >
                  ✅ Check In Meet
                  <span className="block text-xs text-slate-500">Meet is finished — results become the permanent cloud record</span>
                </button>
              </div>
            )}
            {checkinErr && <p className="text-red-400 text-sm mt-3">{checkinErr}</p>}
            {/* v2.5.00 — the cloud proved unreachable: offer the file path */}
            {returnOffer && !checkinBusy && (
              <div className="mt-3 p-3 rounded-xl border border-amber-800 bg-amber-900/20 text-amber-200 text-sm">
                <div className="font-semibold">No internet right now.</div>
                <div className="text-amber-300/80 mt-1">
                  You can return the meet via file instead: scoring stops here exactly as with a normal
                  {returnOffer.mode === 'handback' ? ' Hand Back' : ' Check In'}, and you download a return file to carry to
                  a computer with internet. Or leave the box powered and try again when the internet is back.
                </div>
                <div className="flex gap-3 mt-3">
                  <button className="btn-primary text-sm" data-testid="return-file-offer" onClick={() => doReturnFile(returnOffer.mode, returnOffer.token)}>
                    Return via file instead
                  </button>
                  <button className="btn-secondary text-sm" onClick={() => setReturnOffer(null)}>Not now</button>
                </div>
              </div>
            )}
            {!checkinBusy && !returnOffer && (
              <div className="mt-3 text-xs text-slate-500">
                No internet?{' '}
                <button className="underline hover:text-slate-300" data-testid="return-file-link" onClick={() => setReturnPick(p => !p)}>
                  Return via file instead…
                </button>
                {returnPick && (
                  <div className="flex gap-3 mt-2">
                    <button className="btn-secondary text-sm flex-1" onClick={() => withControl(token => doReturnFile('handback', token))}>
                      🌙 Hand Back via file
                    </button>
                    <button className="btn-secondary text-sm flex-1" onClick={() => withControl(token => doReturnFile('checkin', token))}>
                      ✅ Check In via file
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {pinModal && (
        <PinModal
          title={pinModal.kind === 'control' ? 'Control PIN' : 'Crew PIN'}
          kind={pinModal.kind}
          onClose={() => setPinModal(null)}
          onOk={pinModal.then}
        />
      )}
      {showSeats && (
        <SeatPicker
          onClose={() => setShowSeats(false)}
          onPicked={(seat) => {
            setShowSeats(false)
            setRoleMemory({ role: 'judge', seat })
            navigate(`/venue/role/judge?seat=${seat}`)
          }}
        />
      )}
    </div>
  )
}
