import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import api from '../../utils/api'
import { fetchVenueStatus, getRoleMemory, setRoleMemory, roleUrl } from './venueShared'

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
      setErr(e.message === 'pin_incorrect' ? 'Wrong PIN — try again.' : e.message)
    } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-sm text-center">
        <h2 className="font-display text-2xl text-white mb-1">{title}</h2>
        {hint && <p className="text-slate-500 text-sm mb-3">{hint}</p>}
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          maxLength={4}
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
        {data?.active_event && <p className="text-slate-500 text-sm text-center mb-4">Now scoring: {data.active_event.name}</p>}
        {err && <p className="text-red-400 text-sm text-center mb-3">{err}</p>}
        <div className="grid grid-cols-2 gap-3 mb-4">
          {(data?.seats || []).map(s => (
            <div key={s.seat} className={`p-3 rounded-xl border ${s.claimed ? 'border-slate-800 bg-slate-800/40 opacity-70' : 'border-mountain-700 bg-mountain-900/20'}`}>
              <div className="flex items-center justify-between">
                <span className="font-display text-2xl text-white">{s.seat}</span>
                {s.claimed
                  ? <span className="text-xs text-amber-400">in use{s.device_label ? ` — ${s.device_label}` : ''}</span>
                  : <button onClick={() => claim(s.seat)} className="btn-primary text-sm px-4 py-1.5">Take</button>}
              </div>
              <div className="text-xs text-slate-500 mt-1">{s.judge ? `${s.judge.role} — ${s.judge.name}` : 'No judge for this seat in the active event'}</div>
              {s.claimed && (
                <button onClick={() => setForceFor(s.seat)} className="text-xs text-red-400 underline mt-1">Force release…</button>
              )}
            </div>
          ))}
        </div>
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
  const [status, setStatus] = useState(null)
  const [pins, setPins] = useState(null)
  const [code, setCode] = useState('')
  const [adoptErr, setAdoptErr] = useState('')
  const [adoptBusy, setAdoptBusy] = useState(false)
  const [pinModal, setPinModal] = useState(null) // { kind, then }
  const [showSeats, setShowSeats] = useState(false)
  const [checkinBusy, setCheckinBusy] = useState(null)
  const [checkinErr, setCheckinErr] = useState('')

  // v2.0.00 (Step 5) — Hand Back / Check In: Control PIN, confirm, run, report.
  const startCheckin = (mode) => {
    const doIt = async (token) => {
      const label = mode === 'handback' ? 'Hand Back to Cloud' : 'Check In Meet'
      if (!window.confirm(mode === 'handback'
        ? 'Hand this meet back to the cloud?\n\nScoring STOPS on this server. All results are verified against stickitski.com first. Do this only after the last run of the day.'
        : 'Check this meet in?\n\nThis is final: results are verified against stickitski.com and scoring closes on this server for good.')) return
      setCheckinBusy(`${label} — verifying every score against the cloud…`)
      setCheckinErr('')
      try {
        await api.venueCheckin(mode, token)
        await refresh()
      } catch (e) {
        setCheckinErr(e.message)
      } finally { setCheckinBusy(null) }
    }
    if (pins?.control_set) {
      setPinModal({ kind: 'control', then: (r) => { setPinModal(null); doIt(r.token) } })
    } else {
      doIt(null)
    }
  }

  const refresh = () => Promise.all([
    fetchVenueStatus(true).then(setStatus),
    api.venuePinsStatus().then(setPins).catch(() => setPins({ control_set: false, crew_set: false })),
  ])

  useEffect(() => { refresh() }, [])
  useEffect(() => { const id = setInterval(() => refresh(), 10000); return () => clearInterval(id) }, [])

  // Device role memory: a rebooted tablet goes straight back to its role page.
  useEffect(() => {
    if (stayOnMenu || !status) return
    const mem = getRoleMemory()
    if (mem && status.adopted_meet && (status.meet_state === 'adopted' || status.meet_state === 'checking_in')) {
      const url = roleUrl(mem)
      if (url) navigate(url, { replace: true })
    }
  }, [status, stayOnMenu])

  const adopt = async (replace = false) => {
    setAdoptBusy(true); setAdoptErr('')
    try {
      await api.venueAdopt(code.trim().toUpperCase(), replace ? { replace: true } : {})
      setCode('')
      await refresh()
    } catch (e) {
      if (/already exists|Replace/i.test(e.message)) {
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
      if (/already exists|Replace/i.test(e.message)) {
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
          {status.meet_state === 'handed_back' && status.adopted_meet && (
            <div className="card mt-6 border-mountain-800 bg-mountain-900/10 text-mountain-300 text-sm">
              "{status.adopted_meet.name}" was handed back to the cloud for tonight — brackets are
              built on stickitski.com. In the morning, adopt it again with the NEW release code
              (this server will offer to replace its local copy).
            </div>
          )}
          {status.meet_state === 'checked_in' && status.adopted_meet && (
            <div className="card mt-6 border-green-800 bg-green-900/10 text-green-300 text-sm">
              "{status.adopted_meet.name}" was checked in to the cloud. This server is ready for the next meet.
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
            </div>
          )}

          {pins && !pins.control_set && <PinSetupCard onDone={refresh} />}

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
              <div className="text-slate-500 text-sm">Pick a seat J1–J7 (Crew PIN)</div>
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
