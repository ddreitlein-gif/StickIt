import { useState, useEffect } from 'react'
import api from '../../utils/api'
import { judgeRoleLabel, disciplineLabel } from './venueShared'

/**
 * v2.5.03 — shared venue widgets. PinModal + SeatPicker moved here VERBATIM
 * from VenueHome.jsx so the Head Judge role page can open the same seat picker
 * ("Also score as a judge"). Behavior and markup are unchanged; VenueHome
 * imports them from here.
 */

export function PinModal({ title, kind, onOk, onClose, hint }) {
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

export function SeatPicker({ onPicked, onClose }) {
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
